import dgram, { type RemoteInfo, type Socket } from 'dgram';
import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import type { Request } from 'express';
import { MultiRootStorageBackend, type VolumeSyncInventory } from '../storage/multiRoot.js';
import { normalizeHash, normalizeVolumeId, validateBlockBytes, validateEventBytes } from '../storage/integrity.js';
import { getDefaultRuntimeHomeDir, resolveStorageHomeDir } from '../storagePath.js';
import { PersistentProviderQueue, type ProviderQueueObservationPage } from './providerQueue.js';
import type { ProviderQueueObservation } from './types.js';

const LAN_SYNC_PROTOCOL = 'nearbytes.lan-sync.v1';
const DEFAULT_MULTICAST_GROUP = '239.255.40.41';
const DEFAULT_MULTICAST_PORT = 40441;
const ANNOUNCE_INTERVAL_MS = 3_000;
const PEER_STALE_AFTER_MS = 18_000;
const PEER_FORGET_AFTER_MS = 120_000;
const PEER_SYNC_INTERVAL_MS = 8_000;
const REQUEST_TIMEOUT_MS = 4_500;
const OBSERVATION_PAGE_LIMIT = 512;
const LOCAL_NETWORK_PROVIDER = 'local-network';
const LOCAL_NETWORK_RUNTIME_FOLDER = 'local-network';

interface LocalAnnouncement {
  readonly protocol: typeof LAN_SYNC_PROTOCOL;
  readonly peerId: string;
  readonly label: string;
  readonly port: number;
  readonly capabilities: string[];
  readonly timestamp: number;
  readonly counter: number;
}

interface PeerHelloResponse {
  readonly protocol: typeof LAN_SYNC_PROTOCOL;
  readonly peerId: string;
  readonly label: string;
  readonly port: number;
  readonly capabilities: string[];
  readonly volumeIds: string[];
  readonly observationHeadSequence: number;
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
  lastImportedEvents: number;
  lastImportedBlocks: number;
  remoteCursorSequence: number;
  lastRemoteHeadSequence: number;
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
  readonly lastImportedEvents: number;
  readonly lastImportedBlocks: number;
  readonly remoteCursorSequence: number;
  readonly lastRemoteHeadSequence: number;
  readonly status: 'ready' | 'syncing' | 'error' | 'stale';
  readonly detail: string;
}

export interface LocalNetworkServiceSnapshot {
  readonly protocol: typeof LAN_SYNC_PROTOCOL;
  readonly peerId: string;
  readonly label: string;
  readonly listening: boolean;
  readonly port: number | null;
  readonly multicastGroup: string;
  readonly multicastPort: number;
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
  private readonly peers = new Map<string, LocalPeerState>();
  private readonly multicastGroup: string;
  private readonly multicastPort: number;
  private socket: Socket | null = null;
  private peerId = '';
  private label = defaultPeerLabel();
  private httpPort: number | null = null;
  private announceCounter = 0;
  private announceTimer: ReturnType<typeof setInterval> | null = null;
  private upkeepTimer: ReturnType<typeof setInterval> | null = null;
  private started = false;

  constructor(
    private readonly storage: MultiRootStorageBackend,
    options?: {
      readonly storageDir?: string;
      readonly multicastGroup?: string;
      readonly multicastPort?: number;
    }
  ) {
    this.storageHomeDir = resolveStorageHomeDir(options?.storageDir ?? storage.getRootsConfig().sources[0]?.path ?? process.cwd());
    this.runtimeDir = resolveLocalNetworkRuntimeDir(this.storageHomeDir);
    this.providerQueue = new PersistentProviderQueue(storage, this.runtimeDir);
    this.multicastGroup = options?.multicastGroup ?? DEFAULT_MULTICAST_GROUP;
    this.multicastPort = options?.multicastPort ?? DEFAULT_MULTICAST_PORT;
  }

  async start(httpPort: number): Promise<void> {
    if (this.started) {
      this.httpPort = httpPort;
      return;
    }
    this.started = true;
    this.httpPort = httpPort;
    await this.loadIdentity();
    await this.providerQueue.start();
    await this.openSocket();
    this.announce();
    this.announceTimer = setInterval(() => this.announce(), ANNOUNCE_INTERVAL_MS);
    this.upkeepTimer = setInterval(() => {
      this.expirePeers();
      void this.syncActivePeers(false);
    }, Math.min(ANNOUNCE_INTERVAL_MS, PEER_SYNC_INTERVAL_MS));
  }

  async stop(): Promise<void> {
    this.started = false;
    if (this.announceTimer) {
      clearInterval(this.announceTimer);
      this.announceTimer = null;
    }
    if (this.upkeepTimer) {
      clearInterval(this.upkeepTimer);
      this.upkeepTimer = null;
    }
    const socket = this.socket;
    this.socket = null;
    await this.providerQueue.stop();
    if (socket) {
      await new Promise<void>((resolve) => {
        socket.close(() => resolve());
      });
    }
  }

  getHello(): PeerHelloResponse {
    return {
      protocol: LAN_SYNC_PROTOCOL,
      peerId: this.peerId,
      label: this.label,
      port: this.httpPort ?? 0,
      capabilities: ['observation-log', 'inventory', 'pull-sync', 'push-hint'],
      volumeIds: [],
      observationHeadSequence: this.providerQueue.getHeadSequence(),
      generatedAt: Date.now(),
    };
  }

  async buildHello(): Promise<PeerHelloResponse> {
    return {
      ...this.getHello(),
      volumeIds: await this.storage.listKnownVolumeIds(),
      generatedAt: Date.now(),
    };
  }

  async listVolumes(): Promise<VolumeListResponse> {
    return {
      protocol: LAN_SYNC_PROTOCOL,
      peerId: this.peerId,
      volumeIds: await this.storage.listKnownVolumeIds(),
      generatedAt: Date.now(),
    };
  }

  listObservations(options: {
    readonly afterSequence?: number;
    readonly volumeIds?: readonly string[];
    readonly limit?: number;
  } = {}): ObservationListResponse {
    const page = this.providerQueue.listObservations(options);
    return {
      protocol: LAN_SYNC_PROTOCOL,
      peerId: this.peerId,
      observations: page.observations,
      headSequence: page.headSequence,
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

  notifySyncHint(_req: Request, _body?: SyncHintBody): void {
    void this.syncActivePeers(true);
  }

  getPeersResponse(): LocalNetworkPeersResponse {
    return {
      service: {
        protocol: LAN_SYNC_PROTOCOL,
        peerId: this.peerId,
        label: this.label,
        listening: this.socket !== null && this.httpPort !== null,
        port: this.httpPort,
        multicastGroup: this.multicastGroup,
        multicastPort: this.multicastPort,
        announceIntervalMs: ANNOUNCE_INTERVAL_MS,
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

  private async openSocket(): Promise<void> {
    if (this.socket) {
      return;
    }
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    await new Promise<void>((resolve, reject) => {
      socket.once('error', reject);
      socket.bind(this.multicastPort, '0.0.0.0', () => {
        try {
          socket.addMembership(this.multicastGroup);
          socket.setMulticastTTL(128);
          socket.setMulticastLoopback(true);
          socket.removeListener('error', reject);
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });
    socket.on('message', (message, info) => {
      this.handleAnnouncement(message, info);
    });
    this.socket = socket;
  }

  private announce(): void {
    if (!this.socket || this.httpPort === null) {
      return;
    }
    const payload: LocalAnnouncement = {
      protocol: LAN_SYNC_PROTOCOL,
      peerId: this.peerId,
      label: this.label,
      port: this.httpPort,
      capabilities: ['observation-log', 'inventory', 'pull-sync', 'push-hint'],
      timestamp: Date.now(),
      counter: ++this.announceCounter,
    };
    const bytes = Buffer.from(JSON.stringify(payload), 'utf8');
    this.socket.send(bytes, this.multicastPort, this.multicastGroup);
  }

  private handleAnnouncement(message: Buffer, info: RemoteInfo): void {
    let parsed: LocalAnnouncement | null = null;
    try {
      parsed = JSON.parse(message.toString('utf8')) as LocalAnnouncement;
    } catch {
      return;
    }
    if (!parsed || parsed.protocol !== LAN_SYNC_PROTOCOL || parsed.peerId === this.peerId) {
      return;
    }
    if (!Number.isInteger(parsed.port) || parsed.port <= 0) {
      return;
    }

    const now = Date.now();
    const nextEndpointUrl = `http://${info.address}:${parsed.port}`;
    const existing = this.peers.get(parsed.peerId);
    if (existing) {
      existing.label = parsed.label || existing.label;
      existing.address = info.address;
      existing.port = parsed.port;
      existing.endpointUrl = nextEndpointUrl;
      existing.capabilities = Array.isArray(parsed.capabilities) ? parsed.capabilities : existing.capabilities;
      existing.announcementCounter = Math.max(existing.announcementCounter, parsed.counter);
      existing.lastSeenAt = now;
      if (!existing.lastSyncAt || now - existing.lastSyncAt >= PEER_SYNC_INTERVAL_MS) {
        void this.performPeerSync(existing, false);
      }
      return;
    }

    const peer: LocalPeerState = {
      peerId: parsed.peerId,
      label: parsed.label || `Peer ${parsed.peerId.slice(0, 8)}`,
      address: info.address,
      port: parsed.port,
      endpointUrl: nextEndpointUrl,
      capabilities: Array.isArray(parsed.capabilities) ? parsed.capabilities : [],
      volumeIds: [],
      announcementCounter: parsed.counter,
      firstSeenAt: now,
      lastSeenAt: now,
      lastHelloAt: null,
      lastSyncAt: null,
      lastSyncStartedAt: null,
      lastSyncError: null,
      lastImportedEvents: 0,
      lastImportedBlocks: 0,
      remoteCursorSequence: 0,
      lastRemoteHeadSequence: 0,
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
      const hello = await this.fetchJson<PeerHelloResponse>(`${peer.endpointUrl}/lan/hello`);
      peer.label = hello.label || peer.label;
      peer.capabilities = Array.isArray(hello.capabilities) ? hello.capabilities : peer.capabilities;
      peer.volumeIds = dedupeVolumeIds(hello.volumeIds);
      peer.lastRemoteHeadSequence = Math.max(0, hello.observationHeadSequence ?? 0);
      peer.lastHelloAt = Date.now();
      const routeKey = routeKeyForPeer(peer.peerId);
      const routeState = this.providerQueue.getRouteState(LOCAL_NETWORK_PROVIDER, routeKey);
      peer.remoteCursorSequence = routeState.lastAckedSequence;

      const observationDelta = await this.pullObservations(peer, routeState.lastAckedSequence);

      let importedEvents = observationDelta.importedEvents;
      let importedBlocks = observationDelta.importedBlocks;
      if (force || routeState.lastAckedSequence === 0 || importedEvents > 0 || importedBlocks > 0) {
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

      if ((importedEvents > 0 || importedBlocks > 0) && (force || !peer.queued)) {
        this.storage.scheduleReconcileConfiguredVolumes();
      }
    } catch (error) {
      peer.lastSyncAt = Date.now();
      peer.lastSyncError = error instanceof Error ? error.message : String(error);
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
    const remoteInventory = await this.fetchJson<VolumeSyncInventory>(
      `${peer.endpointUrl}/lan/volumes/${encodeURIComponent(volumeId)}/inventory`
    );
    const localInventory = await this.storage.getVolumeSyncInventory(volumeId);
    const localEvents = new Set(localInventory.eventHashes);
    const localBlocks = new Set(localInventory.blockHashes);
    const missingEvents = remoteInventory.eventHashes.filter((hash) => !localEvents.has(hash));
    const missingBlocks = remoteInventory.blockHashes.filter((hash) => !localBlocks.has(hash));

    let importedEvents = 0;
    let importedBlocks = 0;

    for (const eventHash of missingEvents) {
      const bytes = await this.fetchBytesOrNull(
        `${peer.endpointUrl}/lan/volumes/${encodeURIComponent(volumeId)}/events/${encodeURIComponent(eventHash)}`
      );
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
      const bytes = await this.fetchBytesOrNull(`${peer.endpointUrl}/lan/blocks/${encodeURIComponent(blockHash)}`);
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
    afterSequence: number
  ): Promise<{ importedEvents: number; importedBlocks: number }> {
    let cursor = Math.max(0, afterSequence);
    let importedEvents = 0;
    let importedBlocks = 0;
    const routeKey = routeKeyForPeer(peer.peerId);

    while (true) {
      const page = await this.fetchJson<ObservationListResponse>(
        `${peer.endpointUrl}/lan/observations?after=${encodeURIComponent(String(cursor))}&limit=${encodeURIComponent(String(OBSERVATION_PAGE_LIMIT))}`
      );
      peer.lastRemoteHeadSequence = Math.max(peer.lastRemoteHeadSequence, page.headSequence);
      if (page.observations.length === 0) {
        break;
      }
      const lastSequence = page.observations.at(-1)?.sequence ?? cursor;
      await this.providerQueue.noteRouteAttempt(LOCAL_NETWORK_PROVIDER, routeKey, lastSequence);
      for (const observation of page.observations) {
        const imported = await this.importObservation(peer, observation);
        importedEvents += imported.importedEvents;
        importedBlocks += imported.importedBlocks;
        cursor = Math.max(cursor, observation.sequence);
      }
      await this.providerQueue.acknowledgeRoute(LOCAL_NETWORK_PROVIDER, routeKey, cursor);
      peer.remoteCursorSequence = cursor;
      if (cursor >= page.headSequence) {
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
      const bytes = await this.fetchBytes(
        `${peer.endpointUrl}/lan/volumes/${encodeURIComponent(volumeId)}/events/${encodeURIComponent(observation.hash)}`
      );
      const validation = await validateEventBytes(volumeId, observation.hash, bytes);
      if (!validation.ok) {
        throw new Error(validation.detail ?? `Invalid event ${observation.hash} from ${peer.label}`);
      }
      await this.storage.writeFileForChannel(`channels/${volumeId}/${observation.hash}.bin`, bytes, volumeId);
      return { importedEvents: 1, importedBlocks: 0 };
    }

    const bytes = await this.fetchBytes(`${peer.endpointUrl}/lan/blocks/${encodeURIComponent(observation.hash)}`);
    const validation = await validateBlockBytes(observation.hash, bytes);
    if (!validation.ok) {
      throw new Error(validation.detail ?? `Invalid block ${observation.hash} from ${peer.label}`);
    }
    await this.storage.writeFile(`blocks/${observation.hash}.bin`, bytes);
    return { importedEvents: 0, importedBlocks: 1 };
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const response = await this.fetchWithTimeout(url, {
      headers: {
        Accept: 'application/json',
      },
    });
    if (!response.ok) {
      throw new Error(`LAN request failed (${response.status}) for ${url}`);
    }
    return (await response.json()) as T;
  }

  private async fetchBytes(url: string): Promise<Uint8Array> {
    const response = await this.fetchWithTimeout(url);
    if (!response.ok) {
      throw new Error(`LAN request failed (${response.status}) for ${url}`);
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  private async fetchBytesOrNull(url: string): Promise<Uint8Array | null> {
    const response = await this.fetchWithTimeout(url);
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(`LAN request failed (${response.status}) for ${url}`);
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  private async fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(url, {
        ...options,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private toPeerSnapshot(peer: LocalPeerState): LocalNetworkPeerSnapshot {
    const stale = Date.now() - peer.lastSeenAt >= PEER_STALE_AFTER_MS;
    const status: LocalNetworkPeerSnapshot['status'] = peer.syncing
      ? 'syncing'
      : peer.lastSyncError
        ? 'error'
        : stale
          ? 'stale'
          : 'ready';
    const detail =
      status === 'syncing'
        ? 'Syncing with this peer now.'
        : status === 'error'
          ? peer.lastSyncError ?? 'Last sync failed.'
          : stale
          ? 'Peer is offline or quiet; Nearbytes will reconnect automatically.'
          : peer.lastSyncAt
              ? `Volumes visible: ${peer.volumeIds.length}. Cursor ${peer.remoteCursorSequence}/${peer.lastRemoteHeadSequence}. Last sync ${formatRelative(peer.lastSyncAt)}.`
              : `Peer discovered. Cursor ${peer.remoteCursorSequence}/${peer.lastRemoteHeadSequence}.`;

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
      lastImportedEvents: peer.lastImportedEvents,
      lastImportedBlocks: peer.lastImportedBlocks,
      remoteCursorSequence: peer.remoteCursorSequence,
      lastRemoteHeadSequence: peer.lastRemoteHeadSequence,
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

function resolveLocalNetworkRuntimeDir(storageHomeDir: string): string {
  const normalizedStorageHome = path.resolve(storageHomeDir);
  const defaultStorageHome = path.resolve(resolveStorageHomeDir(path.join(os.homedir(), 'nearbytes', 'local')));
  if (normalizedStorageHome === defaultStorageHome) {
    return path.join(normalizedStorageHome, LOCAL_NETWORK_RUNTIME_FOLDER);
  }
  return path.join(getDefaultRuntimeHomeDir(), LOCAL_NETWORK_RUNTIME_FOLDER);
}
