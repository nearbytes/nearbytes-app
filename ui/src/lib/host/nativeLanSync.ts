import { deserializeEvent } from '../../../../src/storage/serialization.js';
import type { SerializedEvent } from '../../../../src/types/events.js';
import { buildLanDiscoveryTxtRecord } from '../../../../src/integrations/lanTransportProfile.js';
import type {
  LanTransportDiscoveredPeer,
  LanPeerTransportSignalRequest,
  LanTransportRpcRequest,
  LanTransportSignalPeer,
  LanTransportStorageCommand,
  LanTransportVolumeInventory,
} from '../../../../src/integrations/lanPeerTransport.js';
import type { ProviderQueueObservation } from '../../../../src/integrations/types.js';
import type {
  LocalNetworkPeer,
  LocalNetworkPeerMutationResponse,
  LocalNetworkPeersResponse,
} from '../api.js';
import {
  embeddedPhoneFinalizeLanVolumeImport,
  embeddedPhoneBuildLanHello,
  embeddedPhoneGetLanRouteState,
  embeddedPhoneGetLanVolumeInventory,
  embeddedPhoneHandleLanRpcRequest,
  embeddedPhoneImportLanBlock,
  embeddedPhoneImportLanEvent,
  embeddedPhoneLanPeersResponse,
  embeddedPhoneSyncPeer,
  embeddedPhoneUpdateLanPeer,
  embeddedPhoneUpdateLanServiceState,
  embeddedPhoneUpdateLanRouteState,
} from './embeddedPhoneServices.js';
import { BrowserLanTransport } from './browserLanTransport.js';
import {
  addNativeLanIncomingSignalListener,
  completeNativeLanSignalRequest,
  listNativeLanDiscoveredPeers,
  postNativeLanSignal,
  startNativeLanRuntime,
  stopNativeLanRuntime,
  type NativeLanDiscoveredPeer,
} from './nativeLanPlugin.js';

const OBSERVATION_PAGE_LIMIT = 512;
const DEFAULT_NATIVE_LAN_ANNOUNCE_INTERVAL_MS = 5_000;
const PHONE_PEER_STALE_AFTER_MS = 20_000;

interface PeerHelloResponse {
  protocol: string;
  peerId: string;
  label: string;
  capabilities: string[];
  volumeIds: string[];
  observationHeadId: string | null;
}

interface ObservationListResponse {
  protocol: string;
  peerId: string;
  observations: ProviderQueueObservation[];
  headObservationId: string | null;
  generatedAt: number;
}

interface SyncLanPeerOptions {
  preferredVolumeIds?: readonly string[];
}

export interface LanSyncRpcClient {
  requestJson<T>(request: LanTransportRpcRequest): Promise<T>;
  requestBytes(request: LanTransportRpcRequest): Promise<Uint8Array>;
}

const transports = new Map<string, BrowserLanTransport>();
const signaledPeers = new Map<string, NativeLanDiscoveredPeer>();
let runtimeState: NativeLanRuntimeState | null = null;
let runtimeStartPromise: Promise<NativeLanRuntimeState> | null = null;
let runtimeListenerHandle: { remove: () => Promise<void> } | null = null;
let runtimeListenerPromise: Promise<void> | null = null;
let proactiveSignalTimer: ReturnType<typeof setInterval> | null = null;

interface NativeLanRuntimeState {
  listening: boolean;
  port: number | null;
  address?: string | null;
  announceIntervalMs: number;
  serviceType: string;
}

export async function listNativeLanPeers(): Promise<LocalNetworkPeersResponse> {
  const runtime = await ensureNativeLanRuntimeStarted();
  const discovered = (await listNativeLanDiscoveredPeers()).filter(isFreshLanPeer);
  const nativeIds = new Set(discovered.map((peer) => peer.peerId));
  for (const [peerId, peer] of signaledPeers.entries()) {
    if (!isFreshLanPeer(peer)) {
      signaledPeers.delete(peerId);
    }
  }
  const merged = [
    ...discovered,
    ...[...signaledPeers.values()].filter((peer) => !nativeIds.has(peer.peerId) && isFreshLanPeer(peer)),
  ];
  return embeddedPhoneLanPeersResponse(merged.map((peer) => ({
    peerId: peer.peerId,
    label: peer.label,
    address: peer.address,
    port: peer.port,
    endpointUrl: `webrtc://${peer.peerId}`,
    capabilities: [...peer.capabilities],
    volumeIds: [],
    firstSeenAt: peer.firstSeenAt,
    lastSeenAt: peer.lastSeenAt,
    lastHelloAt: peer.lastSeenAt,
    lastSyncAt: null,
    lastSyncStartedAt: null,
    lastSyncError: null,
    lastSyncNotice: null,
    lastImportedEvents: 0,
    lastImportedBlocks: 0,
    remoteCursorObservationId: null,
    lastRemoteHeadObservationId: peer.headObservationId,
    status: 'ready',
    detail: peer.headObservationId
      ? `Peer discovered. Cursor none/${peer.headObservationId.slice(0, 12)}.`
      : 'Peer discovered. Waiting for the first shared volume or observation.',
  })), {
    listening: runtime.listening,
    port: runtime.port,
    announceIntervalMs: runtime.announceIntervalMs,
  });
}

export async function syncNativeLanPeer(peerId: string): Promise<LocalNetworkPeerMutationResponse> {
  return await syncNativeLanPeerWithOptions(peerId);
}

async function syncNativeLanPeerWithOptions(
  peerId: string,
  options: SyncLanPeerOptions = {}
): Promise<LocalNetworkPeerMutationResponse> {
  await ensureNativeLanRuntimeStarted();
  const peersResponse = await listNativeLanPeers();
  const peer = peersResponse.peers.find((entry) => entry.peerId === peerId);
  if (!peer) {
    throw new Error(`Local network peer not found: ${peerId}`);
  }

  const starting = await embeddedPhoneSyncPeer(peerId, peersResponse.peers);
  const discoveredPeer = toTransportPeer(peer);
  const transport = await getOrCreateTransport(discoveredPeer);

  try {
    const result = await syncLanPeerInventoryWithClient(
      discoveredPeer,
      createTransportClient(transport, discoveredPeer),
      options.preferredVolumeIds
    );
    return await embeddedPhoneUpdateLanPeer(peerId, peersResponse.peers, {
      lastSyncStartedAt: starting.peer.lastSyncStartedAt,
      lastSyncAt: Date.now(),
      lastSyncError: null,
      lastSyncNotice: result.notice,
      lastImportedEvents: result.importedEvents,
      lastImportedBlocks: result.importedBlocks,
      remoteCursorObservationId: null,
      lastRemoteHeadObservationId: result.headObservationId,
      volumeIds: result.volumeIds,
      status: 'ready',
      detail: result.detail,
    });
  } catch (error) {
    return await embeddedPhoneUpdateLanPeer(peerId, peersResponse.peers, {
      lastSyncStartedAt: starting.peer.lastSyncStartedAt,
      lastSyncAt: Date.now(),
      lastSyncError: error instanceof Error ? error.message : String(error),
      lastSyncNotice: null,
      status: 'error',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function syncLanPeerInventoryWithClient(
  peer: LanTransportDiscoveredPeer,
  client: LanSyncRpcClient,
  preferredVolumeIds?: readonly string[]
): Promise<{
  importedEvents: number;
  importedBlocks: number;
  volumeIds: string[];
  headObservationId: string | null;
  detail: string;
  notice: string | null;
}> {
  const hello = await client.requestJson<PeerHelloResponse>({
    action: 'hello',
  });
  const selectedVolumeIds = normalizeVolumeIds(
    preferredVolumeIds && preferredVolumeIds.length > 0
      ? hello.volumeIds.filter((volumeId) => preferredVolumeIds.includes(volumeId))
      : hello.volumeIds
  );
  const routeState = await embeddedPhoneGetLanRouteState(peer.peerId);
  const observationDelta = hello.capabilities.includes('observation-log')
    ? await pullObservations(peer, client, routeState.lastAckedObservationId)
    : {
        importedEvents: 0,
        importedBlocks: 0,
        changedVolumeIds: new Set<string>(),
        headObservationId: hello.observationHeadId,
      };

  let importedEvents = observationDelta.importedEvents;
  let importedBlocks = observationDelta.importedBlocks;
  const finalizedVolumeIds = new Set(observationDelta.changedVolumeIds);
  const hintedVolumeIds = new Set(normalizeVolumeIds(preferredVolumeIds ?? []));
  for (const volumeId of observationDelta.changedVolumeIds) {
    hintedVolumeIds.add(volumeId);
  }
  const shouldPullVolumes =
    routeState.lastAckedObservationId === null ||
    importedEvents > 0 ||
    importedBlocks > 0 ||
    hintedVolumeIds.size > 0;

  const volumesToPull = !shouldPullVolumes
    ? []
    : routeState.lastAckedObservationId === null || hintedVolumeIds.size === 0
      ? selectedVolumeIds
      : selectedVolumeIds.filter((volumeId) => hintedVolumeIds.has(volumeId));

  for (const volumeId of volumesToPull) {
    const remoteInventory = await client.requestJson<LanTransportVolumeInventory>({
      action: 'inventory',
      volumeId,
    });
    const localInventory = await embeddedPhoneGetLanVolumeInventory(volumeId);
    const localEvents = new Set(localInventory.eventHashes);
    const localBlocks = new Set(localInventory.blockHashes);
    let importedVolumeData = false;

    for (const eventHash of remoteInventory.eventHashes) {
      if (localEvents.has(eventHash)) {
        continue;
      }
      const bytes = await requestBytesOrNull(client, { action: 'event', volumeId, eventHash });
      if (!bytes) {
        continue;
      }
      if (await embeddedPhoneImportLanEvent(volumeId, eventHash, bytes)) {
        importedEvents += 1;
        importedVolumeData = true;
      }
    }

    for (const blockHash of remoteInventory.blockHashes) {
      if (localBlocks.has(blockHash)) {
        continue;
      }
      const bytes = await requestBytesOrNull(client, { action: 'block', blockHash });
      if (!bytes) {
        continue;
      }
      if (await embeddedPhoneImportLanBlock(blockHash, bytes)) {
        importedBlocks += 1;
        importedVolumeData = true;
      }
    }

    if (importedVolumeData) {
      finalizedVolumeIds.add(volumeId);
    }
  }

  for (const volumeId of finalizedVolumeIds) {
    await embeddedPhoneFinalizeLanVolumeImport(volumeId);
  }

  if (selectedVolumeIds.length === 0 && !hello.observationHeadId) {
    return {
      importedEvents,
      importedBlocks,
      volumeIds: [],
      headObservationId: observationDelta.headObservationId,
      detail: 'Peer is reachable. It is not advertising separate LAN volumes yet. If both apps use the same mounted storage, no transfer is needed.',
      notice: null,
    };
  }

  if (importedEvents === 0 && importedBlocks === 0) {
    return {
      importedEvents,
      importedBlocks,
      volumeIds: selectedVolumeIds,
      headObservationId: observationDelta.headObservationId,
      detail: `Peer reachable. No missing LAN data was found across ${selectedVolumeIds.length} volume${selectedVolumeIds.length === 1 ? '' : 's'}.`,
      notice: 'This phone is already up to date for the advertised LAN volumes.',
    };
  }

  return {
    importedEvents,
    importedBlocks,
    volumeIds: selectedVolumeIds,
    headObservationId: observationDelta.headObservationId,
    detail: `Synced ${importedEvents} event${importedEvents === 1 ? '' : 's'} and ${importedBlocks} block${importedBlocks === 1 ? '' : 's'} from ${selectedVolumeIds.length} volume${selectedVolumeIds.length === 1 ? '' : 's'}.`,
    notice: null,
  };
}

export function resetNativeLanRuntimeForTests(): void {
  stopProactiveSignaling();
  if (runtimeListenerHandle) {
    void runtimeListenerHandle.remove().catch(() => undefined);
  }
  runtimeListenerHandle = null;
  runtimeListenerPromise = null;
  runtimeStartPromise = null;
  runtimeState = null;
  void stopNativeLanRuntime().catch(() => undefined);
  for (const transport of transports.values()) {
    transport.reset();
  }
  transports.clear();
  signaledPeers.clear();
}

async function getOrCreateTransport(peer: LanTransportDiscoveredPeer): Promise<BrowserLanTransport> {
  const selfPeer = await buildSelfSignalPeer();
  const existing = transports.get(peer.peerId);
  if (existing) {
    existing.updateSelfPeer(selfPeer);
    return existing;
  }
  const transport = new BrowserLanTransport({
    selfPeer,
    handleRequest: async (request, remotePeer) => {
      if (request.action === 'sync-hint') {
        void syncNativeLanPeerWithOptions(remotePeer.peerId, {
          preferredVolumeIds: request.volumeIds,
        }).catch(() => undefined);
      }
      return await embeddedPhoneHandleLanRpcRequest(request, async (command) => {
        await importStorageCommandFromPeer(remotePeer, command, transport);
      });
    },
  });
  transports.set(peer.peerId, transport);
  return transport;
}

async function ensureNativeLanRuntimeStarted(): Promise<NativeLanRuntimeState> {
  if (runtimeStartPromise) {
    return await runtimeStartPromise;
  }
  runtimeStartPromise = (async () => {
    await ensureNativeLanListenerRegistered();
    const nextState = await refreshNativeLanRuntime();
    runtimeState = nextState;
    startProactiveSignaling();
    return nextState;
  })();
  try {
    return await runtimeStartPromise;
  } catch (error) {
    runtimeStartPromise = null;
    throw error;
  }
}

async function ensureNativeLanListenerRegistered(): Promise<void> {
  if (runtimeListenerPromise) {
    await runtimeListenerPromise;
    return;
  }
  runtimeListenerPromise = (async () => {
    runtimeListenerHandle = await addNativeLanIncomingSignalListener((event) => {
      void handleIncomingNativeLanSignal(event).catch(async (error) => {
        await completeNativeLanSignalRequest({
          requestId: event.requestId,
          error: error instanceof Error ? error.message : String(error),
        }).catch(() => undefined);
      });
    });
  })();
  await runtimeListenerPromise;
}

async function refreshNativeLanRuntime(): Promise<NativeLanRuntimeState> {
  const hello = await embeddedPhoneBuildLanHello();
  const nextState = await startNativeLanRuntime({
    peerId: hello.peerId,
    label: hello.label,
    txtRecord: buildLanDiscoveryTxtRecord({
      peerId: hello.peerId,
      headObservationId: hello.observationHeadId,
      capabilities: hello.capabilities,
    }),
    announceIntervalMs: DEFAULT_NATIVE_LAN_ANNOUNCE_INTERVAL_MS,
  });
  await embeddedPhoneUpdateLanServiceState({
    listening: nextState.listening,
    port: nextState.port,
    announceIntervalMs: nextState.announceIntervalMs,
  });
  const selfPeer = await buildSelfSignalPeer(hello, nextState);
  for (const transport of transports.values()) {
    transport.updateSelfPeer(selfPeer);
  }
  return nextState;
}

async function buildSelfSignalPeer(
  hello?: Awaited<ReturnType<typeof embeddedPhoneBuildLanHello>>,
  state?: NativeLanRuntimeState | null
): Promise<LanTransportSignalPeer> {
  const currentHello = hello ?? await embeddedPhoneBuildLanHello();
  const currentState = state ?? runtimeState ?? await ensureNativeLanRuntimeStarted();
  return {
    peerId: currentHello.peerId,
    label: currentHello.label,
    address: currentState.address?.trim() || '0.0.0.0',
    port: currentState.port ?? 0,
    capabilities: [...currentHello.capabilities],
    headObservationId: currentHello.observationHeadId,
  };
}

function startProactiveSignaling(): void {
  if (proactiveSignalTimer) {
    return;
  }
  proactiveSignalTimer = setInterval(() => {
    void proactivelySignalKnownPeers().catch(() => undefined);
  }, DEFAULT_NATIVE_LAN_ANNOUNCE_INTERVAL_MS);
}

function stopProactiveSignaling(): void {
  if (proactiveSignalTimer) {
    clearInterval(proactiveSignalTimer);
    proactiveSignalTimer = null;
  }
}

async function proactivelySignalKnownPeers(): Promise<void> {
  const selfPeer = await buildSelfSignalPeer();
  if (!selfPeer.port || selfPeer.address === '0.0.0.0') {
    return;
  }
  const discovered = (await listNativeLanDiscoveredPeers()).filter(isFreshLanPeer);
  const allPeers = new Map<string, { address: string; port: number }>();
  for (const peer of discovered) {
    allPeers.set(peer.peerId, { address: peer.address, port: peer.port });
  }
  for (const [peerId, peer] of signaledPeers.entries()) {
    if (!isFreshLanPeer(peer)) {
      signaledPeers.delete(peerId);
      continue;
    }
    if (!allPeers.has(peer.peerId)) {
      allPeers.set(peer.peerId, { address: peer.address, port: peer.port });
    }
  }
  for (const [peerId, peer] of allPeers) {
    const transport = transports.get(peerId);
    if (transport?.hasActiveConnection(peerId)) {
      continue;
    }
    try {
      await postNativeLanSignal(peer.address, peer.port, {
        kind: 'connect',
        from: selfPeer,
      });
      const existing = signaledPeers.get(peerId);
      if (existing) {
        signaledPeers.set(peerId, { ...existing, lastSeenAt: Date.now() });
      }
    } catch {
      // Peer unreachable — keep for future retries
    }
  }
}

async function handleIncomingNativeLanSignal(event: {
  requestId: string;
  request: LanPeerTransportSignalRequest;
}): Promise<void> {
  rememberSignaledPeer(event.request.from);
  const transport = await getOrCreateTransport(toTransportPeerFromSignal(event.request.from));
  const response = await transport.handleSignal(event.request);
  await completeNativeLanSignalRequest({
    requestId: event.requestId,
    response,
  });
}

function isFreshLanPeer(peer: Pick<NativeLanDiscoveredPeer, 'lastSeenAt'>): boolean {
  return Date.now() - peer.lastSeenAt < PHONE_PEER_STALE_AFTER_MS;
}

function rememberSignaledPeer(peer: LanTransportSignalPeer): void {
  const now = Date.now();
  const existing = signaledPeers.get(peer.peerId);
  signaledPeers.set(peer.peerId, {
    peerId: peer.peerId,
    label: peer.label,
    address: peer.address,
    port: peer.port,
    capabilities: [...peer.capabilities],
    headObservationId: peer.headObservationId,
    firstSeenAt: existing?.firstSeenAt ?? now,
    lastSeenAt: now,
  });
}

function createTransportClient(transport: BrowserLanTransport, peer: LanTransportDiscoveredPeer): LanSyncRpcClient {
  return {
    requestJson<T>(request: LanTransportRpcRequest): Promise<T> {
      return transport.requestJson<T>(peer, request);
    },
    requestBytes(request: LanTransportRpcRequest): Promise<Uint8Array> {
      return transport.requestBytes(peer, request);
    },
  };
}

async function importStorageCommandFromPeer(
  peer: LanTransportDiscoveredPeer,
  command: LanTransportStorageCommand,
  transport: BrowserLanTransport
): Promise<void> {
  const client = createTransportClient(transport, peer);
  if (command.type === 'want-block') {
    const bytes = await requestBytesOrNull(client, {
      action: 'block',
      blockHash: command.blockHash,
    });
    if (bytes) {
      await embeddedPhoneImportLanBlock(command.blockHash, bytes);
    }
    return;
  }

  const bytes = await requestBytesOrNull(client, {
    action: 'event',
    volumeId: command.volumeId,
    eventHash: command.eventHash,
  });
  if (!bytes) {
    return;
  }
  const imported = await embeddedPhoneImportLanEvent(command.volumeId, command.eventHash, bytes);
  if (!imported) {
    return;
  }
  const parsed = deserializeEvent(JSON.parse(new TextDecoder().decode(bytes)) as SerializedEvent);
  for (const blockHash of parsed.envelope.blockRefs) {
    const blockBytes = await requestBytesOrNull(client, {
      action: 'block',
      blockHash,
    });
    if (!blockBytes) {
      continue;
    }
    await embeddedPhoneImportLanBlock(blockHash, blockBytes);
  }
}

async function requestBytesOrNull(client: LanSyncRpcClient, request: LanTransportRpcRequest): Promise<Uint8Array | null> {
  try {
    return await client.requestBytes(request);
  } catch (error) {
    if (error instanceof Error && /404|not found|missing/i.test(error.message)) {
      return null;
    }
    throw error;
  }
}

async function pullObservations(
  peer: LanTransportDiscoveredPeer,
  client: LanSyncRpcClient,
  afterObservationId: string | null
): Promise<{
  importedEvents: number;
  importedBlocks: number;
  changedVolumeIds: Set<string>;
  headObservationId: string | null;
}> {
  let cursor = afterObservationId;
  let importedEvents = 0;
  let importedBlocks = 0;
  let headObservationId: string | null = null;
  const changedVolumeIds = new Set<string>();

  while (true) {
    const page = await client.requestJson<ObservationListResponse>({
      action: 'observations',
      afterObservationId: cursor,
      limit: OBSERVATION_PAGE_LIMIT,
    });
    headObservationId = page.headObservationId;
    if (page.observations.length === 0) {
      break;
    }
    const lastObservationId = page.observations.at(-1)?.observationId ?? cursor;
    await embeddedPhoneUpdateLanRouteState(peer.peerId, {
      lastAttemptedObservationId: lastObservationId,
    });
    for (const observation of page.observations) {
      const imported = await importObservation(peer, client, observation);
      importedEvents += imported.importedEvents;
      importedBlocks += imported.importedBlocks;
      for (const volumeId of imported.changedVolumeIds) {
        changedVolumeIds.add(volumeId);
      }
      cursor = observation.observationId;
    }
    await embeddedPhoneUpdateLanRouteState(peer.peerId, {
      lastAckedObservationId: cursor,
      lastAttemptedObservationId: cursor,
    });
    if (cursor !== null && cursor === page.headObservationId) {
      break;
    }
  }

  return {
    importedEvents,
    importedBlocks,
    changedVolumeIds,
    headObservationId,
  };
}

async function importObservation(
  peer: LanTransportDiscoveredPeer,
  client: LanSyncRpcClient,
  observation: ProviderQueueObservation
): Promise<{ importedEvents: number; importedBlocks: number; changedVolumeIds: Set<string> }> {
  if (observation.kind === 'event') {
    const volumeId = normalizeVolumeId(observation.volumeId ?? '');
    if (!volumeId) {
      throw new Error(`Peer ${peer.label} announced an event without a volume id`);
    }
    const bytes = await requestBytesOrNull(client, {
      action: 'event',
      volumeId,
      eventHash: observation.hash,
    });
    if (!bytes) {
      return { importedEvents: 0, importedBlocks: 0, changedVolumeIds: new Set([volumeId]) };
    }
    const imported = await embeddedPhoneImportLanEvent(volumeId, observation.hash, bytes);
    return {
      importedEvents: imported ? 1 : 0,
      importedBlocks: 0,
      changedVolumeIds: new Set([volumeId]),
    };
  }

  const bytes = await requestBytesOrNull(client, {
    action: 'block',
    blockHash: observation.hash,
  });
  if (!bytes) {
    return { importedEvents: 0, importedBlocks: 0, changedVolumeIds: new Set() };
  }
  const imported = await embeddedPhoneImportLanBlock(observation.hash, bytes);
  return {
    importedEvents: 0,
    importedBlocks: imported ? 1 : 0,
    changedVolumeIds: new Set(),
  };
}

function normalizeVolumeIds(values: readonly string[]): string[] {
  return Array.from(new Set(values.map((value) => normalizeVolumeId(value)).filter((value): value is string => value.length > 0)))
    .sort((left, right) => left.localeCompare(right));
}

function normalizeVolumeId(value: string): string {
  return value.trim().toLowerCase();
}

function toTransportPeerFromSignal(peer: LanTransportSignalPeer): LanTransportDiscoveredPeer {
  return {
    peerId: peer.peerId,
    label: peer.label,
    address: peer.address,
    port: peer.port,
    capabilities: [...peer.capabilities],
    headObservationId: peer.headObservationId,
  };
}

function toTransportPeer(peer: LocalNetworkPeer): LanTransportDiscoveredPeer {
  return {
    peerId: peer.peerId,
    label: peer.label,
    address: peer.address,
    port: peer.port,
    capabilities: [...peer.capabilities],
    headObservationId: peer.lastRemoteHeadObservationId ?? null,
  };
}