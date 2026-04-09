import { openDB, type IDBPDatabase } from 'idb';

import { createCryptoOperations } from '../../../../src/crypto/index.js';
import { createChatService, type ChatService } from '../../../../src/domain/chatService.js';
import { createFileService, type FileService } from '../../../../src/domain/fileService.js';
import { createSecret, type Secret } from '../../../../src/types/keys.js';
import { defaultPathMapper, type StorageBackend } from '../../../../src/types/storage.js';
import type {
  AppConfig,
  AppConfigResponse,
  ChatAttachment,
  DiscoverSourcesResponse,
  DurableCommitAck,
  EventDetailResponse,
  EventStorageLocationsResponse,
  FileMetadata,
  IdentityProfile,
  LocalNetworkPeer,
  LocalNetworkPeerMutationResponse,
  ListFilesResponse,
  LocalNetworkPeersResponse,
  LocalNetworkServiceState,
  OpenVolumeResponse,
  PublishIdentityResponse,
  ReconcileSourcesResponse,
  ReferenceExportResponse,
  ReferenceImportResponse,
  RecipientReferenceBundle,
  RenameFileResponse,
  RenameFolderResponse,
  RootRuntimeStatus,
  RootsConfig,
  RootsConfigResponse,
  RootsRuntimeSnapshot,
  SendChatMessageResponse,
  SourceReferenceBundle,
  SourceUsageSummary,
  SourceVolumeUsage,
  TimelineDeltaResponse,
  TimelineEvent,
  TimelineResponse,
  UploadResponse,
  VolumeWatchReady,
  VolumeWatchUpdate,
  VolumeChatState,
} from '../api.js';
import {
  importCompatibilityEventDetail,
  importCompatibilityTimelineDelta,
  importCompatibilityTimelineSnapshot,
  importCompatibilityVolumeSnapshot,
  readMirrorTimelineSnapshot,
  readMirrorVolumeSnapshot,
  writeMirrorCheckpoint,
} from '../mirror/browserMirror.js';
import {
  parseCanonicalBlockRelativePath,
  parseCanonicalEventRelativePath,
  validateBlockBytes,
  validateEventBytes,
} from '../../../../src/storage/integrity.js';
import type {
  LanTransportHello,
  LanTransportObservationPage,
  LanTransportRpcRequest,
  LanTransportStorageCommand,
  LanTransportVolumeInventory,
} from '../../../../src/integrations/lanPeerTransport.js';
import {
  clearLanLatencyTraces,
  listLanLatencyTraces,
  recordLanLatencyTrace,
  type LanLatencyTraceEntry,
} from './lanLatencyTrace.js';

interface StoredPathRecord {
  path: string;
  data: Uint8Array;
  updatedAt: number;
}

interface EmbeddedPhoneRuntimeServices {
  storage: StorageBackend;
  fileService: FileService;
  chatService: ChatService;
}

interface InMemoryPathStore {
  files: Map<string, StoredPathRecord>;
  directories: Set<string>;
  settings: Map<string, { key: string; value: string; updatedAt: number }>;
}

const DB_NAME = 'nearbytes-embedded-phone-runtime';
const DB_VERSION = 3;
const PHONE_LAN_PEER_ID_KEY = 'phoneLanPeerId';
const PHONE_LAN_LABEL_KEY = 'phoneLanLabel';
const PHONE_LAN_SERVICE_STATE_KEY = 'phoneLanServiceState';
const PHONE_LAN_PEER_OVERLAYS_KEY = 'phoneLanPeerOverlays';
const PHONE_LAN_ROUTE_STATES_KEY = 'phoneLanRouteStates';
const PHONE_PENDING_COMMITS_KEY = 'phonePendingCommits';
const PHONE_COMMIT_RECEIPTS_KEY = 'phoneCommitReceipts';
const PHONE_RUNTIME_HEADS_KEY = 'phoneRuntimeHeads';
const PHONE_ROOTS_CONFIG_KEY = 'phoneRootsConfig';
const PHONE_APP_CONFIG_KEY = 'phoneAppConfig';
const EMBEDDED_PHONE_SOURCE_ID = 'src-embedded-phone';
const embeddedPhoneKnownVolumeSecrets = new Map<string, string>();

interface EmbeddedPhoneLanRouteState {
  peerId: string;
  lastAckedObservationId: string | null;
  lastAttemptedObservationId: string | null;
  updatedAt: number;
}

interface EmbeddedPhoneLanPeerOverlay {
  lastSyncAt?: number | null;
  lastSyncStartedAt?: number | null;
  lastSyncError?: string | null;
  lastSyncNotice?: string | null;
  status?: LocalNetworkPeer['status'];
  detail?: string;
  lastImportedEvents?: number;
  lastImportedBlocks?: number;
  remoteCursorObservationId?: string | null;
  lastRemoteHeadObservationId?: string | null;
  volumeIds?: string[];
}

interface EmbeddedPhoneVolumeWatchSubscription {
  ready: VolumeWatchReady;
  unsubscribe(): void;
}

type EmbeddedPhoneCommitKind =
  | 'upload-file'
  | 'delete-file'
  | 'rename-file'
  | 'rename-folder'
  | 'import-source-references'
  | 'import-recipient-references'
  | 'publish-identity'
  | 'send-chat-message';

interface EmbeddedPhonePendingCommit {
  id: string;
  kind: EmbeddedPhoneCommitKind;
  secret: string;
  payload: Record<string, unknown>;
  enqueuedAt: number;
}

interface EmbeddedPhoneCommitReceipt {
  commitId: string;
  kind: EmbeddedPhoneCommitKind;
  durableAt: number;
  resumed: boolean;
  result: unknown;
}

interface EmbeddedPhoneRuntimeHead {
  volumeId: string;
  fileCount: number;
  eventCount: number;
  lastEventHash: string | null;
  updatedAt: number;
}

interface EmbeddedPhoneRuntimeMetrics {
  refreshReads: number;
  bootstrappedReads: number;
  fullRefreshReads: number;
  incrementalRefreshReads: number;
  cursorResetRefreshReads: number;
}

let dbPromise: Promise<IDBPDatabase | null> | null = null;
let inMemoryStore: InMemoryPathStore | null = null;
let servicesPromise: Promise<EmbeddedPhoneRuntimeServices> | null = null;
let embeddedPhoneVolumeWatcherId = 1;
let embeddedPhoneCommitSequence = 1;
let embeddedPhoneCommitDrainPromise: Promise<void> | null = null;
let embeddedPhoneRuntimeMetrics: EmbeddedPhoneRuntimeMetrics = {
  refreshReads: 0,
  bootstrappedReads: 0,
  fullRefreshReads: 0,
  incrementalRefreshReads: 0,
  cursorResetRefreshReads: 0,
};

const embeddedPhoneVolumeWatchers = new Map<string, Map<number, (update: VolumeWatchUpdate) => void>>();

function shouldUseIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined';
}

function getInMemoryStore(): InMemoryPathStore {
  if (!inMemoryStore) {
    inMemoryStore = {
      files: new Map(),
      directories: new Set(),
      settings: new Map(),
    };
  }
  return inMemoryStore;
}

async function getIndexedDb(): Promise<IDBPDatabase | null> {
  if (!shouldUseIndexedDb()) {
    return null;
  }
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('files')) {
          db.createObjectStore('files', { keyPath: 'path' });
        }
        if (!db.objectStoreNames.contains('directories')) {
          db.createObjectStore('directories', { keyPath: 'path' });
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      },
    });
  }
  return dbPromise;
}

function normalizePath(path: string): string {
  return path.replace(/^\/+/, '').replace(/\/+/g, '/').replace(/\/$/, '').trim();
}

function normalizeDirectoryPath(path: string): string {
  const normalized = normalizePath(path);
  return normalized === '' ? '' : `${normalized}/`;
}

async function putRecord(path: string, data: Uint8Array): Promise<void> {
  const record: StoredPathRecord = {
    path,
    data,
    updatedAt: Date.now(),
  };
  const db = await getIndexedDb();
  if (db) {
    await db.put('files', record);
    return;
  }
  getInMemoryStore().files.set(path, record);
}

async function getRecord(path: string): Promise<StoredPathRecord | null> {
  const db = await getIndexedDb();
  if (db) {
    return (await db.get('files', path)) as StoredPathRecord | null;
  }
  return getInMemoryStore().files.get(path) ?? null;
}

async function deleteRecord(path: string): Promise<void> {
  const db = await getIndexedDb();
  if (db) {
    await db.delete('files', path);
    return;
  }
  getInMemoryStore().files.delete(path);
}

async function putDirectory(path: string): Promise<void> {
  const normalized = normalizePath(path);
  const db = await getIndexedDb();
  if (db) {
    await db.put('directories', { path: normalized, updatedAt: Date.now() });
    return;
  }
  getInMemoryStore().directories.add(normalized);
}

async function hasDirectory(path: string): Promise<boolean> {
  const normalized = normalizePath(path);
  const db = await getIndexedDb();
  if (db) {
    return Boolean(await db.get('directories', normalized));
  }
  return getInMemoryStore().directories.has(normalized);
}

async function listStoredPaths(): Promise<string[]> {
  const db = await getIndexedDb();
  if (db) {
    return (await db.getAllKeys('files')) as string[];
  }
  return Array.from(getInMemoryStore().files.keys());
}

async function listStoredFileRecords(): Promise<StoredPathRecord[]> {
  const db = await getIndexedDb();
  if (db) {
    return (await db.getAll('files')) as StoredPathRecord[];
  }
  return Array.from(getInMemoryStore().files.values()).map((record) => ({
    path: record.path,
    data: new Uint8Array(record.data),
    updatedAt: record.updatedAt,
  }));
}

async function putSetting(key: string, value: string): Promise<void> {
  const db = await getIndexedDb();
  const record = { key, value, updatedAt: Date.now() };
  if (db) {
    await db.put('settings', record);
    return;
  }
  getInMemoryStore().settings.set(key, record);
}

async function getSetting(key: string): Promise<string | null> {
  const db = await getIndexedDb();
  if (db) {
    const record = await db.get('settings', key) as { key: string; value: string } | undefined;
    return record?.value ?? null;
  }
  return getInMemoryStore().settings.get(key)?.value ?? null;
}

function createEmbeddedPhoneCommitId(kind: EmbeddedPhoneCommitKind): string {
  const sequence = embeddedPhoneCommitSequence;
  embeddedPhoneCommitSequence += 1;
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `${kind}-${globalThis.crypto.randomUUID().toLowerCase()}-${sequence}`;
  }
  return `${kind}-${Date.now()}-${sequence}`;
}

async function readEmbeddedPhonePendingCommits(): Promise<EmbeddedPhonePendingCommit[]> {
  const stored = await getSetting(PHONE_PENDING_COMMITS_KEY);
  if (!stored) {
    return [];
  }
  try {
    return JSON.parse(stored) as EmbeddedPhonePendingCommit[];
  } catch {
    return [];
  }
}

async function writeEmbeddedPhonePendingCommits(commits: EmbeddedPhonePendingCommit[]): Promise<void> {
  await putSetting(PHONE_PENDING_COMMITS_KEY, JSON.stringify(commits));
}

async function readEmbeddedPhoneCommitReceipts(): Promise<Record<string, EmbeddedPhoneCommitReceipt>> {
  const stored = await getSetting(PHONE_COMMIT_RECEIPTS_KEY);
  if (!stored) {
    return {};
  }
  try {
    return JSON.parse(stored) as Record<string, EmbeddedPhoneCommitReceipt>;
  } catch {
    return {};
  }
}

async function writeEmbeddedPhoneCommitReceipts(
  receipts: Record<string, EmbeddedPhoneCommitReceipt>
): Promise<void> {
  await putSetting(PHONE_COMMIT_RECEIPTS_KEY, JSON.stringify(receipts));
}

async function readEmbeddedPhoneRuntimeHeads(): Promise<Record<string, EmbeddedPhoneRuntimeHead>> {
  const stored = await getSetting(PHONE_RUNTIME_HEADS_KEY);
  if (!stored) {
    return {};
  }
  try {
    return JSON.parse(stored) as Record<string, EmbeddedPhoneRuntimeHead>;
  } catch {
    return {};
  }
}

async function writeEmbeddedPhoneRuntimeHeads(heads: Record<string, EmbeddedPhoneRuntimeHead>): Promise<void> {
  await putSetting(PHONE_RUNTIME_HEADS_KEY, JSON.stringify(heads));
}

async function writeEmbeddedPhoneRuntimeHead(head: EmbeddedPhoneRuntimeHead): Promise<void> {
  const heads = await readEmbeddedPhoneRuntimeHeads();
  heads[head.volumeId] = head;
  await writeEmbeddedPhoneRuntimeHeads(heads);
}

async function deleteEmbeddedPhoneRuntimeHead(volumeId: string): Promise<void> {
  const heads = await readEmbeddedPhoneRuntimeHeads();
  delete heads[volumeId];
  await writeEmbeddedPhoneRuntimeHeads(heads);
}

async function readEmbeddedPhoneRuntimeHead(volumeId: string): Promise<EmbeddedPhoneRuntimeHead | null> {
  const heads = await readEmbeddedPhoneRuntimeHeads();
  return heads[volumeId] ?? null;
}

function createDefaultEmbeddedPhoneRootsConfig(): RootsConfig {
  return {
    version: 2,
    sources: [
      {
        id: EMBEDDED_PHONE_SOURCE_ID,
        provider: 'local',
        path: '',
        enabled: true,
        writable: true,
        reservePercent: 5,
        opportunisticPolicy: 'block-writes',
      },
    ],
    defaultVolume: {
      destinations: [
        {
          sourceId: EMBEDDED_PHONE_SOURCE_ID,
          enabled: true,
          storeEvents: true,
          storeBlocks: true,
          copySourceBlocks: true,
          reservePercent: 5,
          fullPolicy: 'block-writes',
        },
      ],
    },
    volumes: [],
  };
}

function createDefaultEmbeddedPhoneAppConfig(): AppConfig {
  return {
    version: 1,
    features: {
      providers: {
        googleDrive: false,
        mega: false,
        github: false,
        localNetwork: true,
      },
      performance: {
        appMetrics: false,
      },
    },
  };
}

function createEmptyEmbeddedPhoneUsageSummary(): SourceUsageSummary {
  return {
    totalBytes: 0,
    channelBytes: 0,
    blockBytes: 0,
    otherBytes: 0,
    blockCount: 0,
    volumeUsages: [],
  };
}

async function readEmbeddedPhoneRootsConfigValue(): Promise<RootsConfig> {
  const stored = await getSetting(PHONE_ROOTS_CONFIG_KEY);
  if (!stored) {
    return createDefaultEmbeddedPhoneRootsConfig();
  }
  try {
    return JSON.parse(stored) as RootsConfig;
  } catch {
    return createDefaultEmbeddedPhoneRootsConfig();
  }
}

async function writeEmbeddedPhoneRootsConfigValue(config: RootsConfig): Promise<void> {
  await putSetting(PHONE_ROOTS_CONFIG_KEY, JSON.stringify(config));
}

async function readEmbeddedPhoneAppConfigValue(): Promise<AppConfig> {
  const stored = await getSetting(PHONE_APP_CONFIG_KEY);
  if (!stored) {
    return createDefaultEmbeddedPhoneAppConfig();
  }
  try {
    return JSON.parse(stored) as AppConfig;
  } catch {
    return createDefaultEmbeddedPhoneAppConfig();
  }
}

async function writeEmbeddedPhoneAppConfigValue(config: AppConfig): Promise<void> {
  await putSetting(PHONE_APP_CONFIG_KEY, JSON.stringify(config));
}

async function buildEmbeddedPhoneSourceUsageSummary(): Promise<SourceUsageSummary> {
  const records = await listStoredFileRecords();
  const volumeUsages = new Map<string, SourceVolumeUsage>();
  let totalBytes = 0;
  let channelBytes = 0;
  let blockBytes = 0;
  let otherBytes = 0;
  let blockCount = 0;

  for (const record of records) {
    const size = record.data.byteLength;
    totalBytes += size;

    const parsedEvent = parseCanonicalEventRelativePath(record.path);
    if (parsedEvent) {
      channelBytes += size;
      const current = volumeUsages.get(parsedEvent.volumeId) ?? {
        volumeId: parsedEvent.volumeId,
        historyBytes: 0,
        historyFileCount: 0,
        fileBytes: 0,
        fileCount: 0,
      };
      current.historyBytes += size;
      current.historyFileCount += 1;
      volumeUsages.set(parsedEvent.volumeId, current);
      continue;
    }

    if (parseCanonicalBlockRelativePath(record.path)) {
      blockBytes += size;
      blockCount += 1;
      continue;
    }

    otherBytes += size;
  }

  for (const usage of volumeUsages.values()) {
    const snapshot = await readMirrorVolumeSnapshot(usage.volumeId);
    if (!snapshot) {
      continue;
    }
    usage.fileCount = snapshot.files.length;
    usage.fileBytes = snapshot.files.reduce((sum, file) => sum + file.size, 0);
  }

  return {
    totalBytes,
    channelBytes,
    blockBytes,
    otherBytes,
    blockCount,
    volumeUsages: Array.from(volumeUsages.values()).sort((left, right) => left.volumeId.localeCompare(right.volumeId)),
  };
}

async function buildEmbeddedPhoneRootsRuntimeSnapshot(
  config: RootsConfig,
  includeUsage: boolean
): Promise<RootsRuntimeSnapshot> {
  const usage = includeUsage ? await buildEmbeddedPhoneSourceUsageSummary() : createEmptyEmbeddedPhoneUsageSummary();

  return {
    sources: config.sources.map((source, index) => ({
      id: source.id,
      kind: 'source',
      provider: source.provider,
      path: source.path,
      enabled: source.enabled,
      writable: source.writable,
      reservePercent: source.reservePercent,
      opportunisticPolicy: source.opportunisticPolicy,
      exists: index === 0,
      isDirectory: index === 0,
      canWrite: index === 0 && source.enabled && source.writable,
      usage: index === 0 ? usage : createEmptyEmbeddedPhoneUsageSummary(),
    })) satisfies RootRuntimeStatus[],
    writeFailures: [],
  };
}

export async function embeddedPhoneGetRootsConfig(includeUsage = false): Promise<RootsConfigResponse> {
  const config = await readEmbeddedPhoneRootsConfigValue();
  return {
    configPath: null,
    config,
    runtime: await buildEmbeddedPhoneRootsRuntimeSnapshot(config, includeUsage),
  };
}

export async function embeddedPhoneUpdateRootsConfig(config: RootsConfig): Promise<RootsConfigResponse> {
  await writeEmbeddedPhoneRootsConfigValue(config);
  return embeddedPhoneGetRootsConfig(true);
}

export async function embeddedPhoneGetAppConfig(): Promise<AppConfigResponse> {
  return {
    config: await readEmbeddedPhoneAppConfigValue(),
  };
}

export async function embeddedPhoneUpdateProviderEnabled(provider: string, enabled: boolean): Promise<AppConfigResponse> {
  const config = await readEmbeddedPhoneAppConfigValue();
  switch (provider) {
    case 'gdrive':
      config.features.providers.googleDrive = enabled;
      break;
    case 'mega':
      config.features.providers.mega = enabled;
      break;
    case 'github':
      config.features.providers.github = enabled;
      break;
    case 'local-network':
      config.features.providers.localNetwork = enabled;
      break;
    default:
      break;
  }
  await writeEmbeddedPhoneAppConfigValue(config);
  return { config };
}

export async function embeddedPhoneDiscoverSources(): Promise<DiscoverSourcesResponse> {
  return {
    scannedAt: Date.now(),
    sourceCount: 0,
    sources: [],
  };
}

export async function embeddedPhoneReconcileSources(knownVolumeIds: string[] = []): Promise<ReconcileSourcesResponse> {
  const roots = await embeddedPhoneGetRootsConfig(true);
  return {
    ...roots,
    runKey: `embedded-phone-${Date.now()}`,
    changed: false,
    knownVolumeIds,
    summary: {
      scannedAt: Date.now(),
      discoveredCount: 0,
      sourcesAdded: 0,
      volumeTargetsAdded: 0,
      availableShares: 0,
      meaningfulItemCount: 0,
      providers: {},
    },
    items: [],
  };
}

function buildEmbeddedPhoneCommitAck(receipt: EmbeddedPhoneCommitReceipt): DurableCommitAck {
  return {
    commitId: receipt.commitId,
    status: 'acknowledged',
    durableAt: receipt.durableAt,
    resumed: receipt.resumed,
  };
}

async function writeEmbeddedPhoneCommitCheckpoint(receipt: EmbeddedPhoneCommitReceipt): Promise<void> {
  await writeMirrorCheckpoint(`commit:${receipt.commitId}`, {
    kind: receipt.kind,
    status: 'acknowledged',
    durableAt: receipt.durableAt,
    resumed: receipt.resumed,
    source: 'embedded-phone-runtime',
  });
}

function attachEmbeddedPhoneCommitAck<T extends object>(
  result: T,
  receipt: EmbeddedPhoneCommitReceipt
): T & { commit: DurableCommitAck } {
  return {
    ...result,
    commit: buildEmbeddedPhoneCommitAck(receipt),
  };
}

function serializeEmbeddedPhoneFile(file: File): Promise<{ name: string; type: string; bytes: number[] }> {
  return file.arrayBuffer().then((buffer) => ({
    name: file.name,
    type: file.type || '',
    bytes: Array.from(new Uint8Array(buffer)),
  }));
}

async function enqueueEmbeddedPhoneCommit(
  kind: EmbeddedPhoneCommitKind,
  secret: string,
  payload: Record<string, unknown>
): Promise<EmbeddedPhonePendingCommit> {
  const commit: EmbeddedPhonePendingCommit = {
    id: createEmbeddedPhoneCommitId(kind),
    kind,
    secret,
    payload,
    enqueuedAt: Date.now(),
  };
  const pending = await readEmbeddedPhonePendingCommits();
  pending.push(commit);
  await writeEmbeddedPhonePendingCommits(pending);
  await writeMirrorCheckpoint(`commit:${commit.id}`, {
    kind,
    status: 'pending',
    enqueuedAt: commit.enqueuedAt,
    source: 'embedded-phone-runtime',
  });
  return commit;
}

function createEmbeddedPhonePeerId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `phone-${globalThis.crypto.randomUUID().toLowerCase()}`;
  }
  const random = new Uint8Array(16);
  globalThis.crypto?.getRandomValues?.(random);
  const suffix = Array.from(random)
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
  return `phone-${suffix}`;
}

async function getOrCreateEmbeddedPhonePeerId(): Promise<string> {
  const existing = await getSetting(PHONE_LAN_PEER_ID_KEY);
  if (existing && existing.trim() !== '') {
    return existing;
  }
  const created = createEmbeddedPhonePeerId();
  await putSetting(PHONE_LAN_PEER_ID_KEY, created);
  return created;
}

async function getOrCreateEmbeddedPhonePeerLabel(): Promise<string> {
  const existing = await getSetting(PHONE_LAN_LABEL_KEY);
  if (existing && existing.trim() !== '') {
    return existing;
  }
  const created = 'This phone';
  await putSetting(PHONE_LAN_LABEL_KEY, created);
  return created;
}

function defaultEmbeddedPhoneLanServiceState(peerId: string, label: string): LocalNetworkServiceState {
  return {
    protocol: 'nearbytes-lan-v1',
    peerId,
    label,
    listening: false,
    port: null,
    discovery: 'dns-sd+multicast-fallback',
    transport: 'webrtc',
    serviceType: '_nearbytes._udp',
    announceIntervalMs: 5000,
    peerCount: 0,
  };
}

async function readEmbeddedPhoneLanServiceState(): Promise<LocalNetworkServiceState> {
  const [peerId, label, stored] = await Promise.all([
    getOrCreateEmbeddedPhonePeerId(),
    getOrCreateEmbeddedPhonePeerLabel(),
    getSetting(PHONE_LAN_SERVICE_STATE_KEY),
  ]);
  const defaults = defaultEmbeddedPhoneLanServiceState(peerId, label);
  if (!stored) {
    return defaults;
  }
  try {
    const parsed = JSON.parse(stored) as Partial<LocalNetworkServiceState>;
    return {
      ...defaults,
      ...parsed,
      peerId,
      label,
      protocol: 'nearbytes-lan-v1',
      discovery: 'dns-sd+multicast-fallback',
      transport: 'webrtc',
      serviceType: '_nearbytes._udp',
    };
  } catch {
    return defaults;
  }
}

async function writeEmbeddedPhoneLanServiceState(state: LocalNetworkServiceState): Promise<void> {
  await putSetting(PHONE_LAN_SERVICE_STATE_KEY, JSON.stringify(state));
}

async function readEmbeddedPhoneLanPeerOverlays(): Promise<Record<string, EmbeddedPhoneLanPeerOverlay>> {
  const stored = await getSetting(PHONE_LAN_PEER_OVERLAYS_KEY);
  if (!stored) {
    return {};
  }
  try {
    return JSON.parse(stored) as Record<string, EmbeddedPhoneLanPeerOverlay>;
  } catch {
    return {};
  }
}

async function writeEmbeddedPhoneLanPeerOverlays(overlays: Record<string, EmbeddedPhoneLanPeerOverlay>): Promise<void> {
  await putSetting(PHONE_LAN_PEER_OVERLAYS_KEY, JSON.stringify(overlays));
}

async function readEmbeddedPhoneLanRouteStates(): Promise<Record<string, EmbeddedPhoneLanRouteState>> {
  const stored = await getSetting(PHONE_LAN_ROUTE_STATES_KEY);
  if (!stored) {
    return {};
  }
  try {
    return JSON.parse(stored) as Record<string, EmbeddedPhoneLanRouteState>;
  } catch {
    return {};
  }
}

async function writeEmbeddedPhoneLanRouteStates(states: Record<string, EmbeddedPhoneLanRouteState>): Promise<void> {
  await putSetting(PHONE_LAN_ROUTE_STATES_KEY, JSON.stringify(states));
}

function applyEmbeddedPhoneLanPeerOverlay(
  peer: LocalNetworkPeer,
  overlay: EmbeddedPhoneLanPeerOverlay | undefined
): LocalNetworkPeer {
  if (!overlay) {
    return peer;
  }
  return {
    ...peer,
    lastSyncAt: overlay.lastSyncAt ?? peer.lastSyncAt,
    lastSyncStartedAt: overlay.lastSyncStartedAt ?? peer.lastSyncStartedAt,
    lastSyncError: overlay.lastSyncError ?? peer.lastSyncError,
    lastSyncNotice: overlay.lastSyncNotice ?? peer.lastSyncNotice,
    status: overlay.status ?? peer.status,
    detail: overlay.detail ?? peer.detail,
    lastImportedEvents: overlay.lastImportedEvents ?? peer.lastImportedEvents,
    lastImportedBlocks: overlay.lastImportedBlocks ?? peer.lastImportedBlocks,
    remoteCursorObservationId: overlay.remoteCursorObservationId ?? peer.remoteCursorObservationId,
    lastRemoteHeadObservationId: overlay.lastRemoteHeadObservationId ?? peer.lastRemoteHeadObservationId,
    volumeIds: overlay.volumeIds ?? peer.volumeIds,
  };
}

function getEmbeddedPhoneVolumeWatchBucket(volumeId: string): Map<number, (update: VolumeWatchUpdate) => void> {
  let bucket = embeddedPhoneVolumeWatchers.get(volumeId);
  if (!bucket) {
    bucket = new Map();
    embeddedPhoneVolumeWatchers.set(volumeId, bucket);
  }
  return bucket;
}

async function writeEmbeddedPhoneVolumeWatchReady(ready: VolumeWatchReady): Promise<void> {
  await writeMirrorCheckpoint(`watch:volume:${ready.volumeId}`, {
    kind: 'ready',
    autoUpdate: ready.autoUpdate,
    mode: ready.mode,
    providers: ready.providers,
    updatedAt: Date.now(),
    source: 'embedded-phone-runtime',
  });
}

async function emitEmbeddedPhoneVolumeUpdate(
  volumeId: string,
  change: VolumeWatchUpdate['change'],
  path: string
): Promise<void> {
  const update: VolumeWatchUpdate = {
    volumeId,
    change,
    path,
    timestamp: Date.now(),
  };
  await writeMirrorCheckpoint(`watch:volume:${volumeId}`, {
    kind: 'update',
    change: update.change,
    path: update.path,
    timestamp: update.timestamp,
    source: 'embedded-phone-runtime',
  });
  const watchers = embeddedPhoneVolumeWatchers.get(volumeId);
  if (!watchers) {
    return;
  }
  for (const listener of watchers.values()) {
    listener(update);
  }
}

class EmbeddedPhoneStorageBackend implements StorageBackend {
  async writeFile(path: string, data: Uint8Array): Promise<void> {
    await putRecord(normalizePath(path), new Uint8Array(data));
  }

  async readFile(path: string): Promise<Uint8Array> {
    const record = await getRecord(normalizePath(path));
    if (!record) {
      throw new Error(`File not found: ${path}`);
    }
    return new Uint8Array(record.data);
  }

  async listFiles(directory: string): Promise<string[]> {
    const prefix = normalizeDirectoryPath(directory);
    const paths = await listStoredPaths();
    const files = new Set<string>();

    for (const path of paths) {
      if (prefix !== '' && !path.startsWith(prefix)) {
        continue;
      }
      const remainder = prefix === '' ? path : path.slice(prefix.length);
      if (remainder === '' || remainder.includes('/')) {
        continue;
      }
      files.add(remainder);
    }

    return Array.from(files).sort((left, right) => left.localeCompare(right));
  }

  async createDirectory(_path: string): Promise<void> {
    await putDirectory(_path);
  }

  async exists(path: string): Promise<boolean> {
    const normalized = normalizePath(path);
    if (normalized === '') {
      return true;
    }
    if (await getRecord(normalized)) {
      return true;
    }
    if (await hasDirectory(normalized)) {
      return true;
    }
    const prefix = `${normalized}/`;
    const paths = await listStoredPaths();
    return paths.some((entry) => entry.startsWith(prefix));
  }

  async deleteFile(path: string): Promise<void> {
    await deleteRecord(normalizePath(path));
  }
}

async function getEmbeddedPhoneRuntimeServices(): Promise<EmbeddedPhoneRuntimeServices> {
  if (!servicesPromise) {
    servicesPromise = Promise.resolve().then(() => {
      const storage = new EmbeddedPhoneStorageBackend();
      const crypto = createCryptoOperations();
      return {
        storage,
        fileService: createFileService({ crypto, storage }),
        chatService: createChatService({ crypto, storage }),
      } satisfies EmbeddedPhoneRuntimeServices;
    });
  }
  return servicesPromise;
}

async function deriveVolumeId(secret: string): Promise<string> {
  const keys = await createCryptoOperations().deriveKeys(createSecret(secret));
  return Array.from(keys.publicKey)
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

async function getVolumeDirectory(secret: string): Promise<string> {
  const keys = await createCryptoOperations().deriveKeys(createSecret(secret));
  return defaultPathMapper(keys.publicKey);
}

function normalizeSecret(secret: string): Secret {
  return createSecret(secret);
}

async function refreshMirrors(secret: string, eventHash?: string): Promise<{
  volumeId: string;
  files: FileMetadata[];
  timeline: TimelineEvent[];
}> {
  // docs/specs/application/hash-cursor-refresh-v0.1.md
  embeddedPhoneRuntimeMetrics.refreshReads += 1;
  const { fileService } = await getEmbeddedPhoneRuntimeServices();
  const volumeId = await deriveVolumeId(secret);
  const head = await readEmbeddedPhoneRuntimeHead(volumeId);
  const delta = await fileService.getTimelineDelta(secret, head?.lastEventHash ?? null);
  const snapshot = await importCompatibilityTimelineDelta({
    volumeId,
    requestedCursor: delta.requestedCursor,
    acceptedCursor: delta.acceptedCursor,
    nextCursor: delta.nextCursor,
    reset: delta.reset,
    eventCount: delta.eventCount,
    totalEventCount: delta.totalEventCount,
    events: delta.events,
  } satisfies TimelineDeltaResponse);

  if (head?.lastEventHash && !delta.reset) {
    embeddedPhoneRuntimeMetrics.incrementalRefreshReads += 1;
  } else {
    embeddedPhoneRuntimeMetrics.fullRefreshReads += 1;
    if (head?.lastEventHash && delta.reset) {
      embeddedPhoneRuntimeMetrics.cursorResetRefreshReads += 1;
    }
  }

  embeddedPhoneKnownVolumeSecrets.set(volumeId, secret);

  if (eventHash) {
    const detail = await fileService.getEvent(secret, eventHash);
    const response: EventDetailResponse = {
      eventHash: detail.eventHash,
      event: detail.event,
      decryptedPayload: detail.decryptedPayload,
    };
    await importCompatibilityEventDetail(response);
  }

  await writeEmbeddedPhoneRuntimeHead({
    volumeId,
    fileCount: snapshot.files.length,
    eventCount: snapshot.timeline.length,
    lastEventHash: snapshot.timeline.at(-1)?.eventHash ?? null,
    updatedAt: Date.now(),
  });

  return {
    volumeId,
    files: snapshot.files,
    timeline: snapshot.timeline,
  };
}

async function readBootstrappedEmbeddedPhoneMirror(secret: string): Promise<{
  volumeId: string;
  files: FileMetadata[];
  timeline: TimelineEvent[];
} | null> {
  return readBootstrappedEmbeddedPhoneMirrorInternal(secret, true);
}

async function readBootstrappedEmbeddedPhoneMirrorInternal(
  secret: string,
  recordRead: boolean
): Promise<{
  volumeId: string;
  files: FileMetadata[];
  timeline: TimelineEvent[];
} | null> {
  const volumeId = await deriveVolumeId(secret);
  const [head, volumeSnapshot, timelineSnapshot] = await Promise.all([
    readEmbeddedPhoneRuntimeHead(volumeId),
    readMirrorVolumeSnapshot(volumeId),
    readMirrorTimelineSnapshot(volumeId),
  ]);

  if (!head || !volumeSnapshot || !timelineSnapshot) {
    return null;
  }

  const lastEventHash = timelineSnapshot.events.at(-1)?.eventHash ?? null;
  if (
    volumeSnapshot.files.length !== head.fileCount ||
    timelineSnapshot.eventCount !== head.eventCount ||
    lastEventHash !== head.lastEventHash
  ) {
    return null;
  }

  if (recordRead) {
    embeddedPhoneRuntimeMetrics.bootstrappedReads += 1;
    await writeMirrorCheckpoint(`bootstrap:volume:${volumeId}`, {
      kind: 'head-bootstrap',
      fileCount: head.fileCount,
      eventCount: head.eventCount,
      lastEventHash: head.lastEventHash,
      updatedAt: Date.now(),
      source: 'embedded-phone-runtime',
    });
  }

  return {
    volumeId,
    files: volumeSnapshot.files,
    timeline: timelineSnapshot.events,
  };
}

function buildEmbeddedPhoneChatStateFromTimeline(events: TimelineEvent[]): VolumeChatState {
  const identitiesByPublicKey = new Map<string, VolumeChatState['identities'][number]>();
  const messages: VolumeChatState['messages'] = [];

  for (const event of events) {
    if (
      (event.type === 'DECLARE_IDENTITY' ||
        (event.type === 'APP_RECORD' &&
          (event.protocol === 'nb.identity.record.v1' || event.protocol === 'nb.identity.snapshot.v1'))) &&
      event.authorPublicKey &&
      event.record
    ) {
      identitiesByPublicKey.set(event.authorPublicKey, {
        eventHash: event.eventHash,
        authorPublicKey: event.authorPublicKey,
        publishedAt: event.publishedAt ?? event.timestamp,
        record: event.record,
      });
      continue;
    }

    if (
      (event.type === 'CHAT_MESSAGE' ||
        (event.type === 'APP_RECORD' && event.protocol === 'nb.chat.message.v1')) &&
      event.authorPublicKey &&
      event.message
    ) {
      messages.push({
        eventHash: event.eventHash,
        authorPublicKey: event.authorPublicKey,
        publishedAt: event.publishedAt ?? event.timestamp,
        message: event.message,
      });
    }
  }

  return {
    identities: Array.from(identitiesByPublicKey.values()),
    messages,
  };
}

async function performEmbeddedPhoneUploadFile(secret: string, payload: { name: string; type: string; bytes: number[] }): Promise<UploadResponse> {
  const { fileService } = await getEmbeddedPhoneRuntimeServices();
  const created = await fileService.addFile(
    secret,
    payload.name,
    new Uint8Array(payload.bytes) as unknown as Buffer,
    payload.type || undefined
  );
  const snapshot = await refreshMirrors(secret);
  await emitEmbeddedPhoneVolumeUpdate(snapshot.volumeId, 'add', `blocks/${created.blobHash}`);
  return { created };
}

async function performEmbeddedPhoneDeleteFile(secret: string, payload: { filename: string }): Promise<void> {
  const { fileService } = await getEmbeddedPhoneRuntimeServices();
  await fileService.deleteFile(secret, payload.filename);
  const snapshot = await refreshMirrors(secret);
  await emitEmbeddedPhoneVolumeUpdate(snapshot.volumeId, 'unlink', `channels/delete-file:${payload.filename}.json`);
}

async function performEmbeddedPhoneRenameFile(
  secret: string,
  payload: { from: string; to: string }
): Promise<RenameFileResponse> {
  const { fileService } = await getEmbeddedPhoneRuntimeServices();
  const renamed = await fileService.renameFile(secret, payload.from, payload.to);
  const snapshot = await refreshMirrors(secret);
  await emitEmbeddedPhoneVolumeUpdate(snapshot.volumeId, 'change', `channels/rename-file:${payload.from}->${payload.to}.json`);
  return { renamed };
}

async function performEmbeddedPhoneRenameFolder(
  secret: string,
  payload: { from: string; to: string; merge: boolean }
): Promise<RenameFolderResponse> {
  const { fileService } = await getEmbeddedPhoneRuntimeServices();
  const renamed = await fileService.renameFolder(secret, payload.from, payload.to, { merge: payload.merge });
  const snapshot = await refreshMirrors(secret);
  await emitEmbeddedPhoneVolumeUpdate(snapshot.volumeId, 'change', `channels/rename-folder:${payload.from}->${payload.to}.json`);
  return { renamed };
}

async function performEmbeddedPhoneImportSourceReferences(
  secret: string,
  payload: { bundle: SourceReferenceBundle; sourceSecret: string }
): Promise<ReferenceImportResponse> {
  const { fileService } = await getEmbeddedPhoneRuntimeServices();
  const result = await fileService.importSourceReferences(secret, payload.bundle, payload.sourceSecret);
  const snapshot = await refreshMirrors(secret);
  await emitEmbeddedPhoneVolumeUpdate(snapshot.volumeId, 'change', 'channels/import-source-references.json');
  return {
    imported: result.imported,
    importedCount: result.imported.length,
  };
}

async function performEmbeddedPhoneImportRecipientReferences(
  secret: string,
  payload: { bundle: RecipientReferenceBundle }
): Promise<ReferenceImportResponse> {
  const { fileService } = await getEmbeddedPhoneRuntimeServices();
  const result = await fileService.importRecipientReferences(secret, payload.bundle);
  const snapshot = await refreshMirrors(secret);
  await emitEmbeddedPhoneVolumeUpdate(snapshot.volumeId, 'change', 'channels/import-recipient-references.json');
  return {
    imported: result.imported,
    importedCount: result.imported.length,
  };
}

async function performEmbeddedPhonePublishIdentity(
  secret: string,
  payload: { identitySecret: string; profile: IdentityProfile }
): Promise<PublishIdentityResponse> {
  const { chatService } = await getEmbeddedPhoneRuntimeServices();
  const published = await chatService.publishIdentity(secret, payload.identitySecret, payload.profile);
  recordLanLatencyTrace(published.eventHash, 'phone.outgoing.identity.published');
  const snapshot = await refreshMirrors(secret, published.eventHash);
  await emitEmbeddedPhoneVolumeUpdate(snapshot.volumeId, 'change', `channels/${published.eventHash}.json`);
  return { published };
}

async function performEmbeddedPhoneSendChatMessage(
  secret: string,
  payload: { identitySecret: string; input: { body?: string; attachment?: ChatAttachment } }
): Promise<SendChatMessageResponse> {
  const { chatService } = await getEmbeddedPhoneRuntimeServices();
  const sent = await chatService.sendMessage(secret, payload.identitySecret, payload.input);
  recordLanLatencyTrace(sent.eventHash, 'phone.outgoing.chat.sent');
  const snapshot = await refreshMirrors(secret, sent.eventHash);
  await emitEmbeddedPhoneVolumeUpdate(snapshot.volumeId, 'change', `channels/${sent.eventHash}.json`);
  return { sent };
}

async function executeEmbeddedPhoneCommit(
  commit: EmbeddedPhonePendingCommit,
  resumed: boolean
): Promise<EmbeddedPhoneCommitReceipt> {
  let result: unknown;
  switch (commit.kind) {
    case 'upload-file':
      result = await performEmbeddedPhoneUploadFile(commit.secret, commit.payload as { name: string; type: string; bytes: number[] });
      break;
    case 'delete-file':
      result = await performEmbeddedPhoneDeleteFile(commit.secret, commit.payload as { filename: string });
      break;
    case 'rename-file':
      result = await performEmbeddedPhoneRenameFile(commit.secret, commit.payload as { from: string; to: string });
      break;
    case 'rename-folder':
      result = await performEmbeddedPhoneRenameFolder(commit.secret, commit.payload as { from: string; to: string; merge: boolean });
      break;
    case 'import-source-references':
      result = await performEmbeddedPhoneImportSourceReferences(
        commit.secret,
        commit.payload as { bundle: SourceReferenceBundle; sourceSecret: string }
      );
      break;
    case 'import-recipient-references':
      result = await performEmbeddedPhoneImportRecipientReferences(
        commit.secret,
        commit.payload as { bundle: RecipientReferenceBundle }
      );
      break;
    case 'publish-identity':
      result = await performEmbeddedPhonePublishIdentity(
        commit.secret,
        commit.payload as { identitySecret: string; profile: IdentityProfile }
      );
      break;
    case 'send-chat-message':
      result = await performEmbeddedPhoneSendChatMessage(
        commit.secret,
        commit.payload as { identitySecret: string; input: { body?: string; attachment?: ChatAttachment } }
      );
      break;
    default:
      throw new Error(`Unsupported embedded phone commit kind: ${String((commit as { kind?: unknown }).kind)}`);
  }
  return {
    commitId: commit.id,
    kind: commit.kind,
    durableAt: Date.now(),
    resumed,
    result,
  };
}

async function ensureEmbeddedPhonePendingCommitsDrained(): Promise<void> {
  if (embeddedPhoneCommitDrainPromise) {
    return embeddedPhoneCommitDrainPromise;
  }
  embeddedPhoneCommitDrainPromise = (async () => {
    let pending = await readEmbeddedPhonePendingCommits();
    if (pending.length === 0) {
      return;
    }
    const receipts = await readEmbeddedPhoneCommitReceipts();
    while (pending.length > 0) {
      const [commit, ...rest] = pending;
      pending = rest;
      const receipt = await executeEmbeddedPhoneCommit(commit, true);
      receipts[commit.id] = receipt;
      await writeEmbeddedPhoneCommitReceipts(receipts);
      await writeEmbeddedPhonePendingCommits(pending);
      await writeEmbeddedPhoneCommitCheckpoint(receipt);
    }
  })();
  try {
    await embeddedPhoneCommitDrainPromise;
  } finally {
    embeddedPhoneCommitDrainPromise = null;
  }
}

async function commitEmbeddedPhoneMutation<T extends object>(
  kind: EmbeddedPhoneCommitKind,
  secret: string,
  payload: Record<string, unknown>
): Promise<T & { commit: DurableCommitAck }> {
  const commit = await enqueueEmbeddedPhoneCommit(kind, secret, payload);
  const receipts = await readEmbeddedPhoneCommitReceipts();
  if (!receipts[commit.id]) {
    const receipt = await executeEmbeddedPhoneCommit(commit, false);
    receipts[commit.id] = receipt;
    const pending = await readEmbeddedPhonePendingCommits();
    await writeEmbeddedPhoneCommitReceipts(receipts);
    await writeEmbeddedPhonePendingCommits(pending.filter((entry) => entry.id !== commit.id));
    await writeEmbeddedPhoneCommitCheckpoint(receipt);
  }
  const storedReceipts = await readEmbeddedPhoneCommitReceipts();
  const storedReceipt = storedReceipts[commit.id];
  if (!storedReceipt) {
    throw new Error(`Embedded phone commit acknowledgement missing for ${commit.id}`);
  }
  return attachEmbeddedPhoneCommitAck(storedReceipt.result as T, storedReceipt);
}

export async function embeddedPhoneOpenVolume(secret: string): Promise<OpenVolumeResponse> {
  await ensureEmbeddedPhonePendingCommitsDrained();
  embeddedPhoneKnownVolumeSecrets.set(await deriveVolumeId(secret), secret);
  const bootstrapped = await readBootstrappedEmbeddedPhoneMirror(secret);
  if (bootstrapped) {
    return {
      volumeId: bootstrapped.volumeId,
      fileCount: bootstrapped.files.length,
      files: bootstrapped.files,
    };
  }
  const snapshot = await refreshMirrors(secret);
  return {
    volumeId: snapshot.volumeId,
    fileCount: snapshot.files.length,
    files: snapshot.files,
  };
}

export async function embeddedPhoneListFiles(secret: string): Promise<ListFilesResponse> {
  await ensureEmbeddedPhonePendingCommitsDrained();
  embeddedPhoneKnownVolumeSecrets.set(await deriveVolumeId(secret), secret);
  const bootstrapped = await readBootstrappedEmbeddedPhoneMirror(secret);
  if (bootstrapped) {
    return {
      volumeId: bootstrapped.volumeId,
      files: bootstrapped.files,
    };
  }
  const snapshot = await refreshMirrors(secret);
  return {
    volumeId: snapshot.volumeId,
    files: snapshot.files,
  };
}

export async function embeddedPhoneGetTimeline(secret: string): Promise<TimelineResponse> {
  await ensureEmbeddedPhonePendingCommitsDrained();
  embeddedPhoneKnownVolumeSecrets.set(await deriveVolumeId(secret), secret);
  const bootstrapped = await readBootstrappedEmbeddedPhoneMirror(secret);
  if (bootstrapped) {
    return {
      volumeId: bootstrapped.volumeId,
      eventCount: bootstrapped.timeline.length,
      events: bootstrapped.timeline,
    };
  }
  const snapshot = await refreshMirrors(secret);
  return {
    volumeId: snapshot.volumeId,
    eventCount: snapshot.timeline.length,
    events: snapshot.timeline,
  };
}

export async function embeddedPhoneGetEventDetail(secret: string, eventHash: string): Promise<EventDetailResponse> {
  await ensureEmbeddedPhonePendingCommitsDrained();
  embeddedPhoneKnownVolumeSecrets.set(await deriveVolumeId(secret), secret);
  const { fileService } = await getEmbeddedPhoneRuntimeServices();
  const detail = await fileService.getEvent(secret, eventHash);
  const response: EventDetailResponse = {
    eventHash: detail.eventHash,
    event: detail.event,
    decryptedPayload: detail.decryptedPayload,
  };
  await importCompatibilityEventDetail(response);
  return response;
}

export async function embeddedPhoneDownloadBlob(secret: string, blobHash: string): Promise<Blob> {
  await ensureEmbeddedPhonePendingCommitsDrained();
  const { fileService } = await getEmbeddedPhoneRuntimeServices();
  const bytes = await fileService.getFile(secret, blobHash);
  return new Blob([bytes]);
}

export async function embeddedPhoneUploadFile(secret: string, file: File): Promise<UploadResponse> {
  return commitEmbeddedPhoneMutation<UploadResponse>('upload-file', secret, await serializeEmbeddedPhoneFile(file));
}

export async function embeddedPhoneDeleteFile(secret: string, filename: string): Promise<void> {
  await commitEmbeddedPhoneMutation<Record<string, never>>('delete-file', secret, { filename });
}

export async function embeddedPhoneRenameFile(secret: string, from: string, to: string): Promise<RenameFileResponse> {
  return commitEmbeddedPhoneMutation<RenameFileResponse>('rename-file', secret, { from, to });
}

export async function embeddedPhoneRenameFolder(secret: string, from: string, to: string, merge: boolean): Promise<RenameFolderResponse> {
  return commitEmbeddedPhoneMutation<RenameFolderResponse>('rename-folder', secret, { from, to, merge });
}

export async function embeddedPhoneExportSourceReferences(
  secret: string,
  filenames: string[]
): Promise<ReferenceExportResponse<SourceReferenceBundle>> {
  const { fileService } = await getEmbeddedPhoneRuntimeServices();
  return fileService.exportSourceReferences(secret, filenames);
}

export async function embeddedPhoneImportSourceReferences(
  secret: string,
  bundle: SourceReferenceBundle,
  sourceSecret: string
): Promise<ReferenceImportResponse> {
  return commitEmbeddedPhoneMutation<ReferenceImportResponse>('import-source-references', secret, {
    bundle,
    sourceSecret,
  });
}

export async function embeddedPhoneExportRecipientReferences(
  secret: string,
  filenames: string[],
  recipientVolumeId: string
): Promise<ReferenceExportResponse<RecipientReferenceBundle>> {
  const { fileService } = await getEmbeddedPhoneRuntimeServices();
  return fileService.exportRecipientReferences(secret, filenames, recipientVolumeId);
}

export async function embeddedPhoneImportRecipientReferences(
  secret: string,
  bundle: RecipientReferenceBundle
): Promise<ReferenceImportResponse> {
  return commitEmbeddedPhoneMutation<ReferenceImportResponse>('import-recipient-references', secret, {
    bundle,
  });
}

export async function embeddedPhoneListChat(secret: string): Promise<VolumeChatState> {
  await ensureEmbeddedPhonePendingCommitsDrained();
  const bootstrapped = await readBootstrappedEmbeddedPhoneMirror(secret);
  if (bootstrapped) {
    return buildEmbeddedPhoneChatStateFromTimeline(bootstrapped.timeline);
  }
  const snapshot = await refreshMirrors(secret);
  return buildEmbeddedPhoneChatStateFromTimeline(snapshot.timeline);
}

export async function embeddedPhonePublishIdentity(
  secret: string,
  identitySecret: string,
  profile: IdentityProfile
): Promise<PublishIdentityResponse> {
  return commitEmbeddedPhoneMutation<PublishIdentityResponse>('publish-identity', secret, {
    identitySecret,
    profile,
  });
}

export async function embeddedPhoneSendChatMessage(
  secret: string,
  identitySecret: string,
  input: { body?: string; attachment?: ChatAttachment }
): Promise<SendChatMessageResponse> {
  return commitEmbeddedPhoneMutation<SendChatMessageResponse>('send-chat-message', secret, {
    identitySecret,
    input,
  });
}

export async function embeddedPhoneSubscribeVolumeWatch(
  secret: string,
  onUpdate: (update: VolumeWatchUpdate) => void
): Promise<EmbeddedPhoneVolumeWatchSubscription> {
  const volumeId = await deriveVolumeId(secret);
  const ready: VolumeWatchReady = {
    volumeId,
    autoUpdate: true,
    mode: 'filesystem',
    providers: ['local'],
  };
  await writeEmbeddedPhoneVolumeWatchReady(ready);
  const watcherId = embeddedPhoneVolumeWatcherId;
  embeddedPhoneVolumeWatcherId += 1;
  getEmbeddedPhoneVolumeWatchBucket(volumeId).set(watcherId, onUpdate);
  return {
    ready,
    unsubscribe() {
      const bucket = embeddedPhoneVolumeWatchers.get(volumeId);
      if (!bucket) {
        return;
      }
      bucket.delete(watcherId);
      if (bucket.size === 0) {
        embeddedPhoneVolumeWatchers.delete(volumeId);
      }
    },
  };
}

export function resetEmbeddedPhoneServicesForTests(): void {
  servicesPromise = null;
  dbPromise = null;
  embeddedPhoneVolumeWatchers.clear();
  embeddedPhoneVolumeWatcherId = 1;
  embeddedPhoneCommitSequence = 1;
  embeddedPhoneCommitDrainPromise = null;
  embeddedPhoneRuntimeMetrics = {
    refreshReads: 0,
    bootstrappedReads: 0,
  };
  inMemoryStore = {
    files: new Map(),
    directories: new Set(),
    settings: new Map(),
  };
}

export async function embeddedPhoneHasLocalVolume(secret: string): Promise<boolean> {
  await ensureEmbeddedPhonePendingCommitsDrained();
  const { storage } = await getEmbeddedPhoneRuntimeServices();
  return storage.exists(await getVolumeDirectory(secret));
}

export async function embeddedPhoneHasReadableVolume(secret: string): Promise<boolean> {
  await ensureEmbeddedPhonePendingCommitsDrained();
  const { storage } = await getEmbeddedPhoneRuntimeServices();
  if (await storage.exists(await getVolumeDirectory(secret))) {
    return true;
  }
  return (await readBootstrappedEmbeddedPhoneMirrorInternal(secret, false)) !== null;
}

export async function embeddedPhoneGetEventStorageLocations(
  secret: string,
  eventHash: string
): Promise<EventStorageLocationsResponse> {
  await ensureEmbeddedPhonePendingCommitsDrained();
  const normalizedEventHash = eventHash.trim().toLowerCase();
  const volumeId = await deriveVolumeId(secret);
  const detail = await embeddedPhoneGetEventDetail(secret, normalizedEventHash);
  const blockHash = detail.event.envelope.blockRefs[0]?.trim().toLowerCase() ?? null;
  const eventPath = `channels/${volumeId}/${normalizedEventHash}.bin`;
  const dataPath = blockHash ? `blocks/${blockHash}.bin` : null;
  const { storage } = await getEmbeddedPhoneRuntimeServices();
  const config = await readEmbeddedPhoneRootsConfigValue();
  const source = config.sources[0] ?? {
    id: EMBEDDED_PHONE_SOURCE_ID,
    provider: 'local',
    path: '',
  };

  return {
    eventHash: normalizedEventHash,
    volumeId,
    expectedEventRelativePath: eventPath,
    expectedDataRelativePath: dataPath,
    locations: [
      {
        rootId: source.id,
        provider: source.provider,
        rootPath: source.path,
        eventPath,
        dataPath,
        hasEventFile: await storage.exists(eventPath),
        hasDataBlock: dataPath ? await storage.exists(dataPath) : true,
      },
    ],
  };
}

export async function seedEmbeddedPhoneRuntimeHeadForTests(secret: string): Promise<void> {
  const volumeId = await deriveVolumeId(secret);
  const [volumeSnapshot, timelineSnapshot] = await Promise.all([
    readMirrorVolumeSnapshot(volumeId),
    readMirrorTimelineSnapshot(volumeId),
  ]);

  if (!volumeSnapshot || !timelineSnapshot) {
    throw new Error(`Missing mirror snapshots for embedded runtime head seed: ${volumeId}`);
  }

  await writeEmbeddedPhoneRuntimeHead({
    volumeId,
    fileCount: volumeSnapshot.files.length,
    eventCount: timelineSnapshot.eventCount,
    lastEventHash: timelineSnapshot.events.at(-1)?.eventHash ?? null,
    updatedAt: Date.now(),
  });
}

export async function seedEmbeddedPhonePendingUploadCommitForTests(secret: string, file: File): Promise<string> {
  const pending = await enqueueEmbeddedPhoneCommit('upload-file', secret, await serializeEmbeddedPhoneFile(file));
  return pending.id;
}

export function resetEmbeddedPhoneRuntimeMetricsForTests(): void {
  embeddedPhoneRuntimeMetrics = {
    refreshReads: 0,
    bootstrappedReads: 0,
    fullRefreshReads: 0,
    incrementalRefreshReads: 0,
    cursorResetRefreshReads: 0,
  };
}

export function readEmbeddedPhoneRuntimeMetricsForTests(): EmbeddedPhoneRuntimeMetrics {
  return {
    ...embeddedPhoneRuntimeMetrics,
  };
}

export async function embeddedPhoneLanServiceState(peerCount: number): Promise<LocalNetworkServiceState> {
  const current = await readEmbeddedPhoneLanServiceState();
  const next = {
    ...current,
    peerCount,
  } satisfies LocalNetworkServiceState;
  await writeEmbeddedPhoneLanServiceState(next);
  return next;
}

export async function embeddedPhoneLanPeersResponse(
  peers: LocalNetworkPeersResponse['peers'] = [],
  servicePatch: Partial<Pick<LocalNetworkServiceState, 'listening' | 'port' | 'announceIntervalMs'>> = {},
  options: { isOffline?: boolean } = {}
): Promise<LocalNetworkPeersResponse> {
  const overlays = await readEmbeddedPhoneLanPeerOverlays();
  const mergedPeers = peers.map((peer) => applyEmbeddedPhoneLanPeerOverlay(peer, overlays[peer.peerId]));
  return {
    service: await embeddedPhoneUpdateLanServiceState({
      ...servicePatch,
      peerCount: mergedPeers.length,
    }),
    peers: mergedPeers,
    isOffline: options.isOffline === true,
  };
}

export async function embeddedPhoneUpdateLanServiceState(
  input: Partial<Pick<LocalNetworkServiceState, 'listening' | 'port' | 'announceIntervalMs' | 'peerCount'>>
): Promise<LocalNetworkServiceState> {
  const current = await readEmbeddedPhoneLanServiceState();
  const next = {
    ...current,
    ...input,
  } satisfies LocalNetworkServiceState;
  await writeEmbeddedPhoneLanServiceState(next);
  return next;
}

export async function embeddedPhoneClearStaleLanPeerErrors(): Promise<void> {
  const overlays = await readEmbeddedPhoneLanPeerOverlays();
  let changed = false;
  for (const key of Object.keys(overlays)) {
    const overlay = overlays[key];
    if (overlay.lastSyncError) {
      overlay.lastSyncError = null;
      overlay.status = undefined;
      changed = true;
    }
  }
  if (changed) {
    await writeEmbeddedPhoneLanPeerOverlays(overlays);
  }
}

export async function embeddedPhoneSyncPeer(
  peerId: string,
  peers: LocalNetworkPeer[]
): Promise<LocalNetworkPeerMutationResponse> {
  const current = peers.find((peer) => peer.peerId === peerId);
  if (!current) {
    throw new Error(`Local network peer not found: ${peerId}`);
  }

  const overlays = await readEmbeddedPhoneLanPeerOverlays();
  const now = Date.now();
  const nextOverlay: EmbeddedPhoneLanPeerOverlay = {
    ...overlays[peerId],
    lastSyncStartedAt: now,
    lastSyncError: null,
    lastSyncNotice: 'Sync requested on this phone. Waiting for LAN runtime delivery.',
    status: 'syncing',
    detail: 'Sync requested on this phone.',
  };
  overlays[peerId] = nextOverlay;
  await writeEmbeddedPhoneLanPeerOverlays(overlays);

  return {
    peer: applyEmbeddedPhoneLanPeerOverlay(current, nextOverlay),
  };
}

export async function embeddedPhoneUpdateLanPeer(
  peerId: string,
  peers: LocalNetworkPeer[],
  patch: EmbeddedPhoneLanPeerOverlay
): Promise<LocalNetworkPeerMutationResponse> {
  const current = peers.find((peer) => peer.peerId === peerId);
  if (!current) {
    throw new Error(`Local network peer not found: ${peerId}`);
  }

  const overlays = await readEmbeddedPhoneLanPeerOverlays();
  const nextOverlay: EmbeddedPhoneLanPeerOverlay = {
    ...overlays[peerId],
    ...patch,
  };
  overlays[peerId] = nextOverlay;
  await writeEmbeddedPhoneLanPeerOverlays(overlays);

  return {
    peer: applyEmbeddedPhoneLanPeerOverlay(current, nextOverlay),
  };
}

export async function embeddedPhoneGetLanRouteState(peerId: string): Promise<EmbeddedPhoneLanRouteState> {
  const states = await readEmbeddedPhoneLanRouteStates();
  return states[peerId] ?? {
    peerId,
    lastAckedObservationId: null,
    lastAttemptedObservationId: null,
    updatedAt: 0,
  };
}

export async function embeddedPhoneUpdateLanRouteState(
  peerId: string,
  patch: Partial<Omit<EmbeddedPhoneLanRouteState, 'peerId'>>
): Promise<EmbeddedPhoneLanRouteState> {
  const states = await readEmbeddedPhoneLanRouteStates();
  const nextState: EmbeddedPhoneLanRouteState = {
    peerId,
    lastAckedObservationId: states[peerId]?.lastAckedObservationId ?? null,
    lastAttemptedObservationId: states[peerId]?.lastAttemptedObservationId ?? null,
    updatedAt: Date.now(),
    ...patch,
  };
  states[peerId] = nextState;
  await writeEmbeddedPhoneLanRouteStates(states);
  return nextState;
}

export async function embeddedPhoneGetLanIdentity(): Promise<{ peerId: string; label: string }> {
  const state = await readEmbeddedPhoneLanServiceState();
  return {
    peerId: state.peerId,
    label: state.label,
  };
}

export async function embeddedPhoneListLanVolumeIds(): Promise<string[]> {
  const storedPaths = await listStoredPaths();
  const volumeIds = new Set<string>();
  for (const storedPath of storedPaths) {
    const parsed = parseCanonicalEventRelativePath(storedPath);
    if (parsed) {
      volumeIds.add(parsed.volumeId);
    }
  }
  return Array.from(volumeIds).sort((left, right) => left.localeCompare(right));
}

export async function embeddedPhoneGetLanVolumeInventory(volumeId: string): Promise<LanTransportVolumeInventory> {
  const normalizedVolumeId = volumeId.trim().toLowerCase();
  const storedPaths = await listStoredPaths();
  const eventHashes = new Set<string>();
  const blockHashes = new Set<string>();
  for (const storedPath of storedPaths) {
    const parsedEvent = parseCanonicalEventRelativePath(storedPath);
    if (parsedEvent && parsedEvent.volumeId === normalizedVolumeId) {
      eventHashes.add(parsedEvent.eventHash);
      continue;
    }
    const parsedBlock = parseCanonicalBlockRelativePath(storedPath);
    if (parsedBlock) {
      blockHashes.add(parsedBlock.hash);
    }
  }
  return {
    volumeId: normalizedVolumeId,
    generatedAt: Date.now(),
    eventHashes: Array.from(eventHashes).sort((left, right) => left.localeCompare(right)),
    blockHashes: Array.from(blockHashes).sort((left, right) => left.localeCompare(right)),
  };
}

export async function embeddedPhoneReadLanEventBytes(volumeId: string, eventHash: string): Promise<Uint8Array> {
  const { storage } = await getEmbeddedPhoneRuntimeServices();
  return storage.readFile(`channels/${volumeId.trim().toLowerCase()}/${eventHash.trim().toLowerCase()}.bin`);
}

export async function embeddedPhoneReadLanBlockBytes(blockHash: string): Promise<Uint8Array> {
  const { storage } = await getEmbeddedPhoneRuntimeServices();
  return storage.readFile(`blocks/${blockHash.trim().toLowerCase()}.bin`);
}

export async function embeddedPhoneImportLanEvent(
  volumeId: string,
  eventHash: string,
  bytes: Uint8Array
): Promise<boolean> {
  const normalizedVolumeId = volumeId.trim().toLowerCase();
  const normalizedEventHash = eventHash.trim().toLowerCase();
  const validation = await validateEventBytes(normalizedVolumeId, normalizedEventHash, bytes);
  if (!validation.ok) {
    throw new Error(validation.detail ?? `Invalid LAN event ${normalizedEventHash}`);
  }
  const { storage } = await getEmbeddedPhoneRuntimeServices();
  const relativePath = `channels/${normalizedVolumeId}/${normalizedEventHash}.bin`;
  if (await storage.exists(relativePath)) {
    return false;
  }
  await storage.writeFile(relativePath, bytes);
  return true;
}

export async function embeddedPhoneImportLanBlock(blockHash: string, bytes: Uint8Array): Promise<boolean> {
  const normalizedBlockHash = blockHash.trim().toLowerCase();
  const validation = await validateBlockBytes(normalizedBlockHash, bytes);
  if (!validation.ok) {
    throw new Error(validation.detail ?? `Invalid LAN block ${normalizedBlockHash}`);
  }
  const { storage } = await getEmbeddedPhoneRuntimeServices();
  const relativePath = `blocks/${normalizedBlockHash}.bin`;
  if (await storage.exists(relativePath)) {
    return false;
  }
  await storage.writeFile(relativePath, bytes);
  return true;
}

export async function embeddedPhoneFinalizeLanVolumeImport(
  volumeId: string,
  options?: { readonly eventHash?: string | null }
): Promise<void> {
  const normalizedVolumeId = volumeId.trim().toLowerCase();
  const secret = embeddedPhoneKnownVolumeSecrets.get(normalizedVolumeId);
  if (secret) {
    await refreshMirrors(secret);
    await emitEmbeddedPhoneVolumeUpdate(normalizedVolumeId, 'change', options?.eventHash ? `channels/${options.eventHash}.json` : 'channels/lan-import.json');
    if (options?.eventHash) {
      recordLanLatencyTrace(options.eventHash, 'phone.incoming.event.materialized', normalizedVolumeId);
    }
    return;
  }
  await deleteEmbeddedPhoneRuntimeHead(normalizedVolumeId);
}

export function embeddedPhoneGetLanLatencyTraces(): LanLatencyTraceEntry[] {
  return listLanLatencyTraces();
}

export function embeddedPhoneClearLanLatencyTraces(): void {
  clearLanLatencyTraces();
}

export async function embeddedPhoneBuildLanHello(): Promise<LanTransportHello> {
  const identity = await embeddedPhoneGetLanIdentity();
  return {
    protocol: 'nearbytes.lan-sync.v1',
    peerId: identity.peerId,
    label: identity.label,
    port: 0,
    capabilities: ['webrtc', 'inventory', 'pull-sync', 'storage-command', 'push-hint'],
    volumeIds: await embeddedPhoneListLanVolumeIds(),
    observationHeadId: null,
    generatedAt: Date.now(),
  };
}

export async function embeddedPhoneListLanVolumes(): Promise<{
  protocol: string;
  peerId: string;
  volumeIds: string[];
  generatedAt: number;
}> {
  const identity = await embeddedPhoneGetLanIdentity();
  return {
    protocol: 'nearbytes.lan-sync.v1',
    peerId: identity.peerId,
    volumeIds: await embeddedPhoneListLanVolumeIds(),
    generatedAt: Date.now(),
  };
}

export async function embeddedPhoneListLanObservations(): Promise<LanTransportObservationPage<never>> {
  const identity = await embeddedPhoneGetLanIdentity();
  return {
    protocol: 'nearbytes.lan-sync.v1',
    peerId: identity.peerId,
    observations: [],
    headObservationId: null,
    generatedAt: Date.now(),
  };
}

export async function embeddedPhoneHandleLanRpcRequest(
  request: LanTransportRpcRequest,
  importFromPeer?: (command: LanTransportStorageCommand) => Promise<void>
): Promise<unknown> {
  switch (request.action) {
    case 'hello':
      return await embeddedPhoneBuildLanHello();
    case 'volumes':
      return await embeddedPhoneListLanVolumes();
    case 'observations':
      return await embeddedPhoneListLanObservations();
    case 'inventory':
      return await embeddedPhoneGetLanVolumeInventory(request.volumeId);
    case 'event':
      return await embeddedPhoneReadLanEventBytes(request.volumeId, request.eventHash);
    case 'block':
      return await embeddedPhoneReadLanBlockBytes(request.blockHash);
    case 'sync-hint':
      return {
        ok: true,
        acceptedAt: Date.now(),
      };
    case 'storage-command':
      if (importFromPeer) {
        await importFromPeer(request.command);
      }
      return {
        ok: true,
        acceptedAt: Date.now(),
      };
    default:
      throw new Error(`Unsupported embedded LAN request: ${String((request as { action?: unknown }).action ?? 'unknown')}`);
  }
}