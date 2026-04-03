import { createHash } from 'crypto';
import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import { MultiRootStorageBackend, type VolumeSyncInventory } from '../storage/multiRoot.js';
import { normalizeHash, normalizeVolumeId, validateBlockBytes, validateEventBytes } from '../storage/integrity.js';
import { getDefaultRuntimeHomeDir, resolveStorageHomeDir } from '../storagePath.js';
import { PersistentProviderQueue, type ProviderQueueObservationPage } from './providerQueue.js';
import type { ProviderQueueObservation } from './types.js';
import type { LanPeerTransport, LanTransportDiscoveredPeer } from './lanPeerTransport.js';
import { QuicDnsSdLanTransport } from './quicDnsSdLanTransport.js';

const LAN_SYNC_PROTOCOL = 'nearbytes.lan-sync.v1';
const ADVERTISEMENT_REFRESH_INTERVAL_MS = 10_000;
const PEER_STALE_AFTER_MS = 18_000;
const PEER_FORGET_AFTER_MS = 120_000;
const PEER_SYNC_INTERVAL_MS = 8_000;
const OBSERVATION_PAGE_LIMIT = 512;
const LOCAL_NETWORK_PROVIDER = 'local-network';
const LOCAL_NETWORK_RUNTIME_FOLDER = 'local-network';

interface PeerHelloResponse {
  readonly protocol: typeof LAN_SYNC_PROTOCOL;
  readonly peerId: string;
  readonly label: string;
  readonly port: number;
  readonly capabilities: string[];
  readonly volumeIds: string[];
  readonly observationHeadId: string | null;
  readonly generatedAt: number;
}

interface VolumeListResponse {
  readonly protocol: typeof LAN_SYNC_PROTOCOL;
  readonly peerId: string;
  readonly volumeIds: string[];
  readonly generatedAt: number;
}

interface ObservationListResponse extends ProviderQueueObservationPage {
  readonly protocol: typeof LAN_SYNC_PROTOCOL;
  readonly peerId: string;
  readonly generatedAt: number;
}

interface SyncHintBody {
  readonly reason?: string;
}

interface LocalPeerState {
  readonly peerId: string;
  label: string;
  address: string;
  port: number;
  endpointUrl: string;
  capabilities: string[];
  volumeIds: string[];
  announcementCounter: number;
  firstSeenAt: number;
  lastSeenAt: number;
  lastHelloAt: number | null;
  lastSyncAt: number | null;
  lastSyncStartedAt: number | null;
  lastSyncError: string | null;
  lastSyncTransient: boolean;
  lastSyncNotice: string | null;
  lastImportedEvents: number;
  lastImportedBlocks: number;
  remoteCursorObservationId: string | null;
  lastRemoteHeadObservationId: string | null;
  syncing: boolean;
  queued: boolean;
}

export interface LocalNetworkPeerSnapshot {
  readonly peerId: string;
  readonly label: string;
  readonly address: string;
  readonly port: number;
  readonly endpointUrl: string;
  readonly capabilities: string[];
  readonly volumeIds: string[];
  readonly firstSeenAt: number;
  readonly lastSeenAt: number;
  readonly lastHelloAt: number | null;
  readonly lastSyncAt: number | null;
  readonly lastSyncStartedAt: number | null;
  readonly lastSyncError: string | null;
  readonly lastSyncNotice: string | null;
  readonly lastImportedEvents: number;
  readonly lastImportedBlocks: number;
  readonly remoteCursorObservationId: string | null;
  readonly lastRemoteHeadObservationId: string | null;
  readonly status: 'ready' | 'syncing' | 'error' | 'stale';
  readonly detail: string;
}

export interface LocalNetworkServiceSnapshot {
  readonly protocol: typeof LAN_SYNC_PROTOCOL;
  readonly peerId: string;
  readonly label: string;
  readonly listening: boolean;
  readonly port: number | null;
  readonly discovery: 'dns-sd';
  readonly transport: 'quic';
  readonly serviceType: string;
  readonly announceIntervalMs: number;
  readonly peerCount: number;
}

export interface LocalNetworkPeersResponse {
  readonly service: LocalNetworkServiceSnapshot;
  readonly peers: LocalNetworkPeerSnapshot[];
}

export class LocalNetworkSyncService {
  private readonly storageHomeDir: string;
  private readonly runtimeDir: string;
  private readonly providerQueue: PersistentProviderQueue;
  private readonly peerTransport: LanPeerTransport;
  private readonly peers = new Map<string, LocalPeerState>();
  private peerId = '';
  private label = defaultPeerLabel();
  private httpPort: number | null = null;
  private upkeepTimer: ReturnType<typeof setInterval> | null = null;
  private started = false;

  constructor(
    private readonly storage: MultiRootStorageBackend,
    options?: {
      readonly storageDir?: string;
      readonly peerTransport?: LanPeerTransport;
    }
  ) {
    this.storageHomeDir = resolveStorageHomeDir(options?.storageDir ?? storage.getRootsConfig().sources[0]?.path ?? process.cwd());
    this.runtimeDir = resolveLocalNetworkRuntimeDir(this.storageHomeDir);
    this.providerQueue = new PersistentProviderQueue(storage, this.runtimeDir);
    this.peerTransport = options?.peerTransport ?? new QuicDnsSdLanTransport(this.runtimeDir);
  }

  async start(httpPort: number): Promise<void> {
    if (this.started) {
      this.httpPort = httpPort;
      await this.peerTransport.refreshAdvertisement?.();
      return;
    }
    this.started = true;
    this.httpPort = httpPort;
    await this.loadIdentity();
    await this.providerQueue.start();
    await this.peerTransport.start({
      getAdvertisement: async () => this.buildHello(),
      onPeerDiscovered: (peer) => this.upsertDiscoveredPeer(peer),
      onPeerExpired: (peerId) => {
        const existing = this.peers.get(peerId);
        if (existing) {
          existing.lastSeenAt = Date.now() - PEER_STALE_AFTER_MS;
        }
      },
      handleRequest: async (request) => this.handleTransportRequest(request),
    });
    this.upkeepTimer = setInterval(() => {
      this.expirePeers();
      void this.syncActivePeers(false);
    }, Math.min(ADVERTISEMENT_REFRESH_INTERVAL_MS, PEER_SYNC_INTERVAL_MS));
  }

  async stop(): Promise<void> {
    this.started = false;
    if (this.upkeepTimer) {
      clearInterval(this.upkeepTimer);
      this.upkeepTimer = null;
    }
    await this.peerTransport.stop();
    await this.providerQueue.stop();
  }

  getHello(): PeerHelloResponse {
    return {
      protocol: LAN_SYNC_PROTOCOL,
      peerId: this.peerId,
      label: this.label,
      port: this.httpPort ?? 0,
      capabilities: ['observation-log', 'inventory', 'pull-sync', 'push-hint'],
      volumeIds: [],
      observationHeadId: this.providerQueue.getHeadObservationId(),
      generatedAt: Date.now(),
    };
  }

  async buildHello(): Promise<PeerHelloResponse> {
    const knownVolumeIds = await this.storage.listKnownVolumeIds();
    const observedVolumeIds = this.providerQueue.listObservedVolumeIds();
    return {
      ...this.getHello(),
      volumeIds: dedupeVolumeIds([...knownVolumeIds, ...observedVolumeIds]),
      generatedAt: Date.now(),
    };
  }

  async listVolumes(): Promise<VolumeListResponse> {
    const knownVolumeIds = await this.storage.listKnownVolumeIds();
    const observedVolumeIds = this.providerQueue.listObservedVolumeIds();
    return {
      protocol: LAN_SYNC_PROTOCOL,
      peerId: this.peerId,
      volumeIds: dedupeVolumeIds([...knownVolumeIds, ...observedVolumeIds]),
      generatedAt: Date.now(),
    };
  }

  listObservations(options: {
    readonly afterObservationId?: string | null;
    readonly volumeIds?: readonly string[];
    readonly limit?: number;
  } = {}): ObservationListResponse {
    const page = this.providerQueue.listObservations(options);
    return {
      protocol: LAN_SYNC_PROTOCOL,
      peerId: this.peerId,
      observations: page.observations,
      headObservationId: page.headObservationId,
      generatedAt: Date.now(),
    };
  }

  async getVolumeInventory(volumeId: string): Promise<VolumeSyncInventory> {
    return this.storage.getVolumeSyncInventory(volumeId);
  }

  async readEventBytes(volumeId: string, eventHash: string): Promise<Uint8Array> {
    const normalizedVolumeId = normalizeVolumeId(volumeId);
    const normalizedEventHash = normalizeHash(eventHash);
    if (!normalizedVolumeId || !normalizedEventHash) {
      throw new Error('Invalid event request');
    }
    return this.storage.readValidatedFileForChannel(
      `channels/${normalizedVolumeId}/${normalizedEventHash}.bin`,
      normalizedVolumeId,
      (data) => validateEventBytes(normalizedVolumeId, normalizedEventHash, data)
    );
  }

  async readBlockBytes(blockHash: string): Promise<Uint8Array> {
    const normalizedBlockHash = normalizeHash(blockHash);
    if (!normalizedBlockHash) {
      throw new Error('Invalid block request');
    }
    return this.storage.readValidatedFile(`blocks/${normalizedBlockHash}.bin`, (data) =>
      validateBlockBytes(normalizedBlockHash, data)
    );
  }

  notifySyncHint(_body?: SyncHintBody): void {
    void this.syncActivePeers(true);
  }

  private async handleTransportRequest(request: import('./lanPeerTransport.js').LanTransportRpcRequest): Promise<import('./lanPeerTransport.js').LanPeerTransportResponse> {
    switch (request.action) {
      case 'hello':
        return {
          kind: 'json',
          value: await this.buildHello(),
        };
      case 'volumes':
        return {
          kind: 'json',
          value: await this.listVolumes(),
        };
      case 'observations':
        return {
          kind: 'json',
          value: this.listObservations({
            afterObservationId: request.afterObservationId,
            volumeIds: request.volumeIds,
            limit: request.limit,
          }),
        };
      case 'inventory':
        return {
          kind: 'json',
          value: await this.getVolumeInventory(request.volumeId),
        };
      case 'event':
        return {
          kind: 'bytes',
          value: await this.readEventBytes(request.volumeId, request.eventHash),
        };
      case 'block':
        return {
          kind: 'bytes',
          value: await this.readBlockBytes(request.blockHash),
        };
      case 'sync-hint':
        this.notifySyncHint({ reason: request.reason });
        return {
          kind: 'json',
          value: { ok: true, acceptedAt: Date.now() },
        };
      default:
        throw new Error(`Unsupported LAN transport request`);
    }
  }

  getPeersResponse(): LocalNetworkPeersResponse {
    return {
      service: {
        protocol: LAN_SYNC_PROTOCOL,
        peerId: this.peerId,
        label: this.label,
        listening: this.started && this.httpPort !== null,
        port: this.httpPort,
        discovery: 'dns-sd',
        transport: 'quic',
        serviceType: '_nearbytes._udp.local',
        announceIntervalMs: ADVERTISEMENT_REFRESH_INTERVAL_MS,
        peerCount: this.peers.size,
      },
      peers: Array.from(this.peers.values())
        .map((peer) => this.toPeerSnapshot(peer))
        .sort((left, right) => left.label.localeCompare(right.label) || left.peerId.localeCompare(right.peerId)),
    };
  }

  async syncPeer(peerId: string): Promise<LocalNetworkPeerSnapshot | null> {
    const peer = this.peers.get(peerId);
    if (!peer) {
      return null;
    }
    await this.performPeerSync(peer, true);
    return this.toPeerSnapshot(peer);
  }

  private async loadIdentity(): Promise<void> {
    const identityPath = path.join(this.runtimeDir, 'identity.json');
    await fs.mkdir(this.runtimeDir, { recursive: true });
    try {
      const raw = JSON.parse(await fs.readFile(identityPath, 'utf8')) as { peerId?: unknown; label?: unknown };
      if (typeof raw.peerId === 'string' && raw.peerId.trim().length > 0) {
        this.peerId = raw.peerId.trim();
      }
      if (typeof raw.label === 'string' && raw.label.trim().length > 0) {
        this.label = raw.label.trim();
      }
    } catch {
      // fall through
    }
    if (!this.peerId) {
      this.peerId = `${defaultPeerLabel().replace(/\s+/g, '-').toLowerCase()}-${Math.random().toString(16).slice(2, 10)}`;
    }
    await fs.writeFile(identityPath, JSON.stringify({ peerId: this.peerId, label: this.label }, null, 2), 'utf8');
  }

  private upsertDiscoveredPeer(discovered: LanTransportDiscoveredPeer): void {
    const now = Date.now();
    const existing = this.peers.get(discovered.peerId);
    if (existing) {
      existing.label = discovered.label || existing.label;
      existing.address = discovered.address;
      existing.port = discovered.port;
      existing.endpointUrl = `quic://${discovered.address}:${discovered.port}`;
      existing.capabilities = [...discovered.capabilities];
      existing.lastSeenAt = now;
      if (!existing.lastSyncAt || now - existing.lastSyncAt >= PEER_SYNC_INTERVAL_MS) {
        void this.performPeerSync(existing, false);
      }
      return;
    }

    const peer: LocalPeerState = {
      peerId: discovered.peerId,
      label: discovered.label || `Peer ${discovered.peerId.slice(0, 8)}`,
      address: discovered.address,
      port: discovered.port,
      endpointUrl: `quic://${discovered.address}:${discovered.port}`,
      capabilities: [...discovered.capabilities],
      volumeIds: [],
      announcementCounter: 0,
      firstSeenAt: now,
      lastSeenAt: now,
      lastHelloAt: null,
      lastSyncAt: null,
      lastSyncStartedAt: null,
      lastSyncError: null,
      lastSyncTransient: false,
      lastSyncNotice: null,
      lastImportedEvents: 0,
      lastImportedBlocks: 0,
      remoteCursorObservationId: null,
      lastRemoteHeadObservationId: null,
      syncing: false,
      queued: false,
    };
    this.peers.set(peer.peerId, peer);
    void this.performPeerSync(peer, true);
  }

  private expirePeers(): void {
    const now = Date.now();
    for (const [peerId, peer] of this.peers.entries()) {
      if (now - peer.lastSeenAt >= PEER_FORGET_AFTER_MS) {
        this.peers.delete(peerId);
      }
    }
  }

  private async syncActivePeers(force: boolean): Promise<void> {
    const now = Date.now();
    const activePeers = Array.from(this.peers.values()).filter(
      (peer) => force || now - peer.lastSeenAt < PEER_STALE_AFTER_MS
    );
    for (const peer of activePeers) {
      if (force || !peer.lastSyncAt || now - peer.lastSyncAt >= PEER_SYNC_INTERVAL_MS) {
        await this.performPeerSync(peer, force);
      }
    }
  }

  private async performPeerSync(peer: LocalPeerState, force: boolean): Promise<void> {
    if (peer.syncing) {
      peer.queued = true;
      return;
    }
    peer.syncing = true;
    peer.queued = false;
    peer.lastSyncStartedAt = Date.now();
    try {
      const hello = await this.peerTransport.requestJson<PeerHelloResponse>(this.toTransportPeer(peer), {
        action: 'hello',
      });
      peer.label = hello.label || peer.label;
      peer.capabilities = Array.isArray(hello.capabilities) ? hello.capabilities : peer.capabilities;
      peer.volumeIds = dedupeVolumeIds(hello.volumeIds);
      peer.lastRemoteHeadObservationId = hello.observationHeadId ?? null;
      peer.lastHelloAt = Date.now();
      const routeKey = routeKeyForPeer(peer.peerId);
      const routeState = this.providerQueue.getRouteState(LOCAL_NETWORK_PROVIDER, routeKey);
      peer.remoteCursorObservationId = routeState.lastAckedObservationId;

      const observationDelta = await this.pullObservations(peer, routeState.lastAckedObservationId);

      let importedEvents = observationDelta.importedEvents;
      let importedBlocks = observationDelta.importedBlocks;
      if (force || routeState.lastAckedObservationId === null || importedEvents > 0 || importedBlocks > 0) {
        for (const volumeId of peer.volumeIds) {
          const delta = await this.pullVolume(peer, volumeId);
          importedEvents += delta.importedEvents;
          importedBlocks += delta.importedBlocks;
        }
      }
      peer.lastImportedEvents = importedEvents;
      peer.lastImportedBlocks = importedBlocks;
      peer.lastSyncAt = Date.now();
      peer.lastSyncError = null;
      peer.lastSyncTransient = false;
      peer.lastSyncNotice = null;

      if ((importedEvents > 0 || importedBlocks > 0) && (force || !peer.queued)) {
        this.storage.scheduleReconcileConfiguredVolumes();
      }
    } catch (error) {
      peer.lastSyncAt = Date.now();
      peer.lastSyncTransient = isAbortLikeError(error);
      peer.lastSyncNotice = peer.lastSyncTransient ? 'Peer timed out; Nearbytes will retry automatically.' : null;
      peer.lastSyncError = peer.lastSyncTransient
        ? null
        : error instanceof Error
          ? error.message
          : String(error);
    } finally {
      peer.syncing = false;
      const shouldRunAgain = peer.queued;
      peer.queued = false;
      if (shouldRunAgain) {
        await this.performPeerSync(peer, true);
      }
    }
  }

  private async pullVolume(
    peer: LocalPeerState,
    volumeId: string
  ): Promise<{ importedEvents: number; importedBlocks: number }> {
    const remoteInventory = await this.peerTransport.requestJson<VolumeSyncInventory>(this.toTransportPeer(peer), {
      action: 'inventory',
      volumeId,
    });
    const localInventory = await this.storage.getVolumeSyncInventory(volumeId);
    const localEvents = new Set(localInventory.eventHashes);
    const localBlocks = new Set(localInventory.blockHashes);
    const missingEvents = remoteInventory.eventHashes.filter((hash) => !localEvents.has(hash));
    const missingBlocks = remoteInventory.blockHashes.filter((hash) => !localBlocks.has(hash));

    let importedEvents = 0;
    let importedBlocks = 0;

    for (const eventHash of missingEvents) {
      const bytes = await this.requestEventBytesOrNull(peer, volumeId, eventHash);
      if (!bytes) {
        continue;
      }
      const validation = await validateEventBytes(volumeId, eventHash, bytes);
      if (!validation.ok) {
        throw new Error(validation.detail ?? `Invalid event ${eventHash} from ${peer.label}`);
      }
      await this.storage.writeFileForChannel(`channels/${volumeId}/${eventHash}.bin`, bytes, volumeId);
      importedEvents += 1;
    }

    for (const blockHash of missingBlocks) {
      const bytes = await this.requestBlockBytesOrNull(peer, blockHash);
      if (!bytes) {
        continue;
      }
      const validation = await validateBlockBytes(blockHash, bytes);
      if (!validation.ok) {
        throw new Error(validation.detail ?? `Invalid block ${blockHash} from ${peer.label}`);
      }
      await this.storage.writeFile(`blocks/${blockHash}.bin`, bytes);
      importedBlocks += 1;
    }

    return {
      importedEvents,
      importedBlocks,
    };
  }

  private async pullObservations(
    peer: LocalPeerState,
    afterObservationId: string | null
  ): Promise<{ importedEvents: number; importedBlocks: number }> {
    let cursor = afterObservationId;
    let importedEvents = 0;
    let importedBlocks = 0;
    const routeKey = routeKeyForPeer(peer.peerId);

    while (true) {
      const page = await this.peerTransport.requestJson<ObservationListResponse>(this.toTransportPeer(peer), {
        action: 'observations',
        afterObservationId: cursor,
        limit: OBSERVATION_PAGE_LIMIT,
      });
      peer.lastRemoteHeadObservationId = page.headObservationId;
      if (page.observations.length === 0) {
        break;
      }
      const lastObservationId = page.observations.at(-1)?.observationId ?? cursor;
      await this.providerQueue.noteRouteAttempt(LOCAL_NETWORK_PROVIDER, routeKey, lastObservationId);
      for (const observation of page.observations) {
        const imported = await this.importObservation(peer, observation);
        importedEvents += imported.importedEvents;
        importedBlocks += imported.importedBlocks;
        cursor = observation.observationId;
      }
      await this.providerQueue.acknowledgeRoute(LOCAL_NETWORK_PROVIDER, routeKey, cursor);
      peer.remoteCursorObservationId = cursor;
      if (cursor !== null && cursor === page.headObservationId) {
        break;
      }
    }

    return {
      importedEvents,
      importedBlocks,
    };
  }

  private async importObservation(
    peer: LocalPeerState,
    observation: ProviderQueueObservation
  ): Promise<{ importedEvents: number; importedBlocks: number }> {
    if (observation.kind === 'event') {
      const volumeId = normalizeVolumeId(observation.volumeId ?? '');
      if (!volumeId) {
        throw new Error(`Peer ${peer.label} announced an event without a volume id`);
      }
      const bytes = await this.peerTransport.requestBytes(this.toTransportPeer(peer), {
        action: 'event',
        volumeId,
        eventHash: observation.hash,
      });
      const validation = await validateEventBytes(volumeId, observation.hash, bytes);
      if (!validation.ok) {
        throw new Error(validation.detail ?? `Invalid event ${observation.hash} from ${peer.label}`);
      }
      await this.storage.writeFileForChannel(`channels/${volumeId}/${observation.hash}.bin`, bytes, volumeId);
      return { importedEvents: 1, importedBlocks: 0 };
    }

    const bytes = await this.peerTransport.requestBytes(this.toTransportPeer(peer), {
      action: 'block',
      blockHash: observation.hash,
    });
    const validation = await validateBlockBytes(observation.hash, bytes);
    if (!validation.ok) {
      throw new Error(validation.detail ?? `Invalid block ${observation.hash} from ${peer.label}`);
    }
    await this.storage.writeFile(`blocks/${observation.hash}.bin`, bytes);
    return { importedEvents: 0, importedBlocks: 1 };
  }

  private async requestEventBytesOrNull(peer: LocalPeerState, volumeId: string, eventHash: string): Promise<Uint8Array | null> {
    try {
      return await this.peerTransport.requestBytes(this.toTransportPeer(peer), {
        action: 'event',
        volumeId,
        eventHash,
      });
    } catch (error) {
      if (isMissingLikeError(error)) {
        return null;
      }
      throw error;
    }
  }

  private async requestBlockBytesOrNull(peer: LocalPeerState, blockHash: string): Promise<Uint8Array | null> {
    try {
      return await this.peerTransport.requestBytes(this.toTransportPeer(peer), {
        action: 'block',
        blockHash,
      });
    } catch (error) {
      if (isMissingLikeError(error)) {
        return null;
      }
      throw error;
    }
  }

  private toTransportPeer(peer: LocalPeerState): LanTransportDiscoveredPeer {
    return {
      peerId: peer.peerId,
      label: peer.label,
      address: peer.address,
      port: peer.port,
      capabilities: [...peer.capabilities],
      headObservationId: peer.lastRemoteHeadObservationId,
    };
  }

  private toPeerSnapshot(peer: LocalPeerState): LocalNetworkPeerSnapshot {
    const stale = Date.now() - peer.lastSeenAt >= PEER_STALE_AFTER_MS;
    const status: LocalNetworkPeerSnapshot['status'] = peer.syncing
      ? 'syncing'
      : peer.lastSyncError && !peer.lastSyncTransient
        ? 'error'
        : stale
          ? 'stale'
          : 'ready';
    const detail =
      status === 'syncing'
        ? 'Syncing with this peer now.'
        : peer.lastSyncTransient
          ? peer.lastSyncNotice ?? 'Peer responded too slowly; Nearbytes will retry automatically.'
          : status === 'error'
          ? peer.lastSyncError ?? 'Last sync failed.'
          : stale
          ? 'Peer is offline or quiet; Nearbytes will reconnect automatically.'
          : peer.lastSyncAt && peer.volumeIds.length === 0 && !peer.lastRemoteHeadObservationId
            ? 'Peer is reachable. It is not advertising separate LAN volumes yet. If both apps use the same mounted storage, no transfer is needed.'
          : peer.lastSyncAt
              ? `Volumes visible: ${peer.volumeIds.length}. Cursor ${shortObservationId(peer.remoteCursorObservationId)}/${shortObservationId(peer.lastRemoteHeadObservationId)}. Last sync ${formatRelative(peer.lastSyncAt)}.`
              : peer.volumeIds.length > 0 || peer.lastRemoteHeadObservationId
                ? `Peer discovered. Cursor ${shortObservationId(peer.remoteCursorObservationId)}/${shortObservationId(peer.lastRemoteHeadObservationId)}.`
                : 'Peer discovered. Waiting for the first shared volume or observation.';

    return {
      peerId: peer.peerId,
      label: peer.label,
      address: peer.address,
      port: peer.port,
      endpointUrl: peer.endpointUrl,
      capabilities: [...peer.capabilities],
      volumeIds: [...peer.volumeIds],
      firstSeenAt: peer.firstSeenAt,
      lastSeenAt: peer.lastSeenAt,
      lastHelloAt: peer.lastHelloAt,
      lastSyncAt: peer.lastSyncAt,
      lastSyncStartedAt: peer.lastSyncStartedAt,
      lastSyncError: peer.lastSyncError,
      lastSyncNotice: peer.lastSyncNotice,
      lastImportedEvents: peer.lastImportedEvents,
      lastImportedBlocks: peer.lastImportedBlocks,
      remoteCursorObservationId: peer.remoteCursorObservationId,
      lastRemoteHeadObservationId: peer.lastRemoteHeadObservationId,
      status,
      detail,
    };
  }
}

function defaultPeerLabel(): string {
  return os.hostname().trim() || 'Nearbytes peer';
}

function dedupeVolumeIds(values: readonly string[]): string[] {
  const normalized = values
    .map((value) => normalizeVolumeId(value))
    .filter((value): value is string => value !== null);
  return Array.from(new Set(normalized)).sort((left, right) => left.localeCompare(right));
}

function formatRelative(timestamp: number): string {
  const delta = Math.max(0, Date.now() - timestamp);
  if (delta < 5_000) {
    return 'just now';
  }
  if (delta < 60_000) {
    return `${Math.round(delta / 1_000)}s ago`;
  }
  if (delta < 3_600_000) {
    return `${Math.round(delta / 60_000)}m ago`;
  }
  return `${Math.round(delta / 3_600_000)}h ago`;
}

function routeKeyForPeer(peerId: string): string {
  return `peer:${peerId}:pull`;
}

function shortObservationId(value: string | null): string {
  return value ? value.slice(0, 12) : 'none';
}

function isAbortLikeError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : error instanceof Error && error.name === 'AbortError';
}

function isMissingLikeError(error: unknown): boolean {
  return error instanceof Error && /not found|404|missing/i.test(error.message);
}

function resolveLocalNetworkRuntimeDir(storageHomeDir: string): string {
  const normalizedStorageHome = path.resolve(storageHomeDir);
  const defaultStorageHome = path.resolve(resolveStorageHomeDir(path.join(os.homedir(), 'nearbytes', 'local')));
  if (normalizedStorageHome === defaultStorageHome) {
    return path.join(normalizedStorageHome, LOCAL_NETWORK_RUNTIME_FOLDER);
  }
  const namespace = createHash('sha256').update(normalizedStorageHome).digest('hex').slice(0, 16);
  return path.join(getDefaultRuntimeHomeDir(), LOCAL_NETWORK_RUNTIME_FOLDER, namespace);
}
