import { openDB, type IDBPDatabase } from 'idb';

import { createCryptoOperations } from '../../../../src/crypto/index.js';
import type { TransportAdapter } from '../../../../src/integrations/adapters.js';
import { MegaTransportAdapter } from '../../../../src/integrations/mega.js';
import {
  ManagedShareService,
  type ManagedShareFileHost,
  type ManagedShareRootHost,
  type ManagedShareRootsConfigStore,
  type ManagedShareStateStore,
  type ManagedShareStorageHost,
} from '../../../../src/integrations/managedShares.js';
import type { MegaOwnerMirrorSource } from '../../../../src/integrations/runtime.js';
import type { IntegrationStateSnapshot } from '../../../../src/integrations/store.js';
import type { ProviderAccount, TransportState } from '../../../../src/integrations/types.js';
import type { ChatService } from '../../../../src/domain/chatService.js';
import type { FileService } from '../../../../src/domain/fileService.js';
import {
  createRuntimeCoreServices,
  type RuntimeCoreServices,
} from '../../../../src/runtime/coreServices.js';
import { deserializeEvent } from '../../../../src/storage/serialization.js';
import {
  createInMemoryPathRecordStore,
  normalizeStoragePath,
  PathRecordStorageBackend,
  type InMemoryPathRecordStore,
  type StoredPathRecord,
} from '../../../../src/storage/backend.js';
import { createSecret, type Secret } from '../../../../src/types/keys.js';
import {
  defaultPathMapper,
  type StorageBackend,
  type StorageWriteEvent,
  type StorageWriteListener,
} from '../../../../src/types/storage.js';
import type {
  AppConfig,
  AppConfigResponse,
  ChatAttachment,
  ConnectProviderAccountResponse,
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
  ProviderAccountsResponse,
  ReconcileProviderManagedSharesResponse,
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
  ManagedSharesResponse,
  IncomingManagedSharesResponse,
  IncomingProviderContactInvitesResponse,
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
  addNativeLanIncomingSignalListener,
  clearNativeAutomationCommand,
  completeNativeLanSignalRequest,
  getNativeAutomationCommand,
  clearLanLatencyTraces,
  listLanLatencyTraces,
  recordLanLatencyTrace,
  type LanLatencyTraceEntry,
} from './lanLatencyTrace.js';
import {
  hasNativeLanPlugin,
  listNativeLanDiscoveredPeers,
  nativeLanHttpRequest,
  postNativeLanSignal,
  setNativeAutomationResult,
  startNativeLanRuntime,
  stopNativeLanRuntime,
} from './nativeLanPlugin.js';
import { configureNativeProvider, getNativeProviderSetupState, installNativeProvider } from './nativeProviderPlugin.js';

// Architecture guardrail: the phone app is self-contained. It must use the shared embedded runtime/backend
// implementation in this process for provider-managed storage and push reactivity, not proxy those runtime
// responsibilities through the separate dev API server.

interface EmbeddedPhoneMegaFsStatsLike {
  isFile(): boolean;
  isDirectory(): boolean;
}

interface EmbeddedPhoneMegaFsShim {
  mkdir(targetPath: string, options?: { readonly recursive?: boolean }): Promise<void>;
  readFile(targetPath: string): Promise<Uint8Array>;
  writeFile(targetPath: string, data: Uint8Array): Promise<void>;
  access(targetPath: string): Promise<void>;
  rm(
    targetPath: string,
    options?: {
      readonly recursive?: boolean;
      readonly force?: boolean;
    }
  ): Promise<void>;
  stat(targetPath: string): Promise<EmbeddedPhoneMegaFsStatsLike>;
  readdir(targetPath: string): Promise<string[]>;
}

declare global {
  interface Window {
    __nearbytesMegaFs?: EmbeddedPhoneMegaFsShim;
  }
}

interface EmbeddedPhoneRuntimeServices extends RuntimeCoreServices {}

interface InMemoryPathStore extends InMemoryPathRecordStore {
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
const PHONE_KNOWN_VOLUME_SECRETS_KEY = 'phoneKnownVolumeSecrets';
const PHONE_ROOTS_CONFIG_KEY = 'phoneRootsConfig';
const PHONE_APP_CONFIG_KEY = 'phoneAppConfig';
const PHONE_INTEGRATION_STATE_KEY = 'phoneIntegrationState';
const PHONE_PROVIDER_SECRETS_KEY = 'phoneProviderSecrets';
const EMBEDDED_PHONE_SOURCE_ID = 'src-embedded-phone';
const embeddedPhoneKnownVolumeSecrets = new Map<string, string>();
const EMBEDDED_PHONE_CHANNEL_DIRECTORY_REGEX = /^channels\/([a-f0-9]{130})(?:\/|$)/i;

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
const EMBEDDED_PHONE_MANAGED_SHARE_SYNC_NUDGE_MIN_INTERVAL_MS = 5_000;
let embeddedPhoneRootsConfigCache: RootsConfig | null = null;
let embeddedPhoneAppConfigCache: AppConfig | null = null;
let embeddedPhoneManagedShareServicePromise: Promise<ManagedShareService> | null = null;
let embeddedPhoneDevBootstrapPromise: Promise<void> | null = null;

const embeddedPhoneVolumeWatchers = new Map<string, Map<number, (update: VolumeWatchUpdate) => void>>();
const embeddedPhoneManagedShareSyncNudges = new Map<string, number>();
const embeddedPhoneStorageWriteListeners = new Set<StorageWriteListener>();

function emitEmbeddedPhoneStorageWrite(event: StorageWriteEvent): void {
  for (const listener of embeddedPhoneStorageWriteListeners) {
    try {
      listener(event);
    } catch {
      // Keep durable embedded phone writes authoritative even if an observer fails.
    }
  }
}

function shouldUseIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined';
}

function getInMemoryStore(): InMemoryPathStore {
  if (!inMemoryStore) {
    inMemoryStore = {
      ...createInMemoryPathRecordStore(),
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

async function listIndexedDbStoreKeysWithCursor(
  db: IDBPDatabase,
  storeName: 'files' | 'directories'
): Promise<string[]> {
  const transaction = db.transaction(storeName, 'readonly');
  const keys: string[] = [];
  let cursor = await transaction.store.openKeyCursor();
  while (cursor) {
    const key = typeof cursor.primaryKey === 'string' ? cursor.primaryKey : typeof cursor.key === 'string' ? cursor.key : '';
    if (key) {
      keys.push(key);
    }
    cursor = await cursor.continue();
  }
  await transaction.done;
  return keys;
}

async function listIndexedDbFileRecordsWithCursor(db: IDBPDatabase): Promise<StoredPathRecord[]> {
  const transaction = db.transaction('files', 'readonly');
  const records: StoredPathRecord[] = [];
  let cursor = await transaction.store.openCursor();
  while (cursor) {
    const value = cursor.value as StoredPathRecord;
    records.push({
      path: value.path,
      data: new Uint8Array(value.data),
      updatedAt: value.updatedAt,
    });
    cursor = await cursor.continue();
  }
  await transaction.done;
  return records;
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
  const normalized = normalizeStoragePath(path);
  const db = await getIndexedDb();
  if (db) {
    await db.put('directories', { path: normalized, updatedAt: Date.now() });
    return;
  }
  getInMemoryStore().directories.add(normalized);
}

async function hasDirectory(path: string): Promise<boolean> {
  const normalized = normalizeStoragePath(path);
  const db = await getIndexedDb();
  if (db) {
    return Boolean(await db.get('directories', normalized));
  }
  return getInMemoryStore().directories.has(normalized);
}

async function listStoredPaths(): Promise<string[]> {
  const db = await getIndexedDb();
  if (db) {
    try {
      return (await db.getAllKeys('files')) as string[];
    } catch {
      return listIndexedDbStoreKeysWithCursor(db, 'files');
    }
  }
  return Array.from(getInMemoryStore().files.keys());
}

async function listStoredDirectories(): Promise<string[]> {
  const db = await getIndexedDb();
  if (db) {
    try {
      return ((await db.getAllKeys('directories')) as string[]).map((value) => normalizeStoragePath(value));
    } catch {
      return (await listIndexedDbStoreKeysWithCursor(db, 'directories')).map((value) => normalizeStoragePath(value));
    }
  }
  return Array.from(getInMemoryStore().directories.values()).map((value) => normalizeStoragePath(value));
}

function resolveEmbeddedPhoneSourceStoragePath(sourcePath: string, relativePath: string): string {
  const normalizedSourcePath = normalizeStoragePath(sourcePath);
  const normalizedRelativePath = normalizeStoragePath(relativePath);
  if (!normalizedSourcePath) {
    return normalizedRelativePath;
  }
  if (!normalizedRelativePath) {
    return normalizedSourcePath;
  }
  return `${normalizedSourcePath}/${normalizedRelativePath}`;
}

function parseEmbeddedPhoneVolumeIdFromRelativePath(relativePath: string): string | null {
  const normalizedRelativePath = normalizeStoragePath(relativePath);
  const eventPath = parseCanonicalEventRelativePath(normalizedRelativePath);
  if (eventPath) {
    return eventPath.volumeId;
  }
  const match = EMBEDDED_PHONE_CHANNEL_DIRECTORY_REGEX.exec(normalizedRelativePath);
  return match?.[1]?.trim().toLowerCase() || null;
}

async function listEmbeddedPhoneSourceFiles(sourcePath: string, directory: string): Promise<string[]> {
  const prefix = normalizeStoragePath(resolveEmbeddedPhoneSourceStoragePath(sourcePath, directory));
  const directoryPrefix = prefix ? `${prefix}/` : '';
  const storedPaths = await listStoredPaths();
  const files = new Set<string>();
  for (const storedPath of storedPaths) {
    const normalizedPath = normalizeStoragePath(storedPath);
    if (directoryPrefix) {
      if (!normalizedPath.startsWith(directoryPrefix)) {
        continue;
      }
    } else if (!normalizedPath) {
      continue;
    }
    const remainder = directoryPrefix ? normalizedPath.slice(directoryPrefix.length) : normalizedPath;
    if (!remainder || remainder.includes('/')) {
      continue;
    }
    files.add(remainder);
  }
  return Array.from(files).sort((left, right) => left.localeCompare(right));
}

async function getEmbeddedPhoneEnabledSources() {
  const config = await readEmbeddedPhoneRootsConfigValue();
  return config.sources.filter((source) => source.enabled);
}

async function getEmbeddedPhoneWritableSourcesForRelativePath(relativePath: string) {
  const config = await readEmbeddedPhoneRootsConfigValue();
  const volumeId = parseEmbeddedPhoneVolumeIdFromRelativePath(relativePath);
  if (!volumeId) {
    return config.sources.filter((source) => source.enabled && source.writable);
  }
  const destinations = resolveEmbeddedPhoneVolumeDestinations(config, volumeId);
  return destinations
    .filter((destination) => destination.enabled)
    .map((destination) => config.sources.find((source) => source.id === destination.sourceId) ?? null)
    .filter((source): source is RootsConfig['sources'][number] => Boolean(source && source.enabled && source.writable));
}

function resolveEmbeddedPhoneVolumeDestinations(
  config: RootsConfig,
  volumeId: string
): RootsConfig['defaultVolume']['destinations'] {
  // Keep the phone bundle self-contained: importing the Node-oriented roots module here
  // regresses mobile builds by dragging fs/os/path into the browser runtime.
  const normalizedVolumeId = volumeId.trim().toLowerCase();
  const merged = new Map<string, RootsConfig['defaultVolume']['destinations'][number]>();
  for (const destination of config.defaultVolume.destinations) {
    merged.set(destination.sourceId, { ...destination });
  }
  const explicit = config.volumes.find((entry) => entry.volumeId.trim().toLowerCase() === normalizedVolumeId);
  if (explicit) {
    for (const destination of explicit.destinations) {
      merged.set(destination.sourceId, { ...destination });
    }
  }
  return Array.from(merged.values());
}

function createEmbeddedPhoneRuntimeStorage(): StorageBackend {
  const storage = {
    async writeFile(relativePath: string, data: Uint8Array): Promise<void> {
      const targets = await getEmbeddedPhoneWritableSourcesForRelativePath(relativePath);
      if (targets.length === 0) {
        throw new Error(`No writable embedded phone sources configured for ${relativePath}`);
      }
      const normalizedRelativePath = normalizeStoragePath(relativePath);
      await Promise.all(targets.map(async (source) => {
        const targetPath = resolveEmbeddedPhoneSourceStoragePath(source.path, relativePath);
        await putDirectory(getEmbeddedPhoneManagedShareDirname(targetPath));
        await putRecord(targetPath, data);
        emitEmbeddedPhoneStorageWrite({
          sourceId: source.id,
          path: normalizedRelativePath,
          size: data.length,
        });
      }));
    },
    async readFile(relativePath: string): Promise<Uint8Array> {
      const sources = await getEmbeddedPhoneEnabledSources();
      for (const source of sources) {
        const record = await getRecord(resolveEmbeddedPhoneSourceStoragePath(source.path, relativePath));
        if (record) {
          return record.data;
        }
      }
      throw new Error(`File not found: ${relativePath}`);
    },
    async readValidatedFile(
      relativePath: string,
      validate: (data: Uint8Array) => Promise<{ ok: boolean; detail?: string }>
    ): Promise<Uint8Array> {
      const bytes = await storage.readFile(relativePath);
      const validation = await validate(bytes);
      if (!validation.ok) {
        throw new Error(validation.detail ?? `Validation failed for ${relativePath}`);
      }
      return bytes;
    },
    async listFiles(directory: string): Promise<string[]> {
      const sources = await getEmbeddedPhoneEnabledSources();
      const files = new Set<string>();
      for (const source of sources) {
        const listed = await listEmbeddedPhoneSourceFiles(source.path, directory);
        for (const file of listed) {
          files.add(file);
        }
      }
      return Array.from(files).sort((left, right) => left.localeCompare(right));
    },
    async createDirectory(relativePath: string): Promise<void> {
      const targets = await getEmbeddedPhoneWritableSourcesForRelativePath(relativePath);
      if (targets.length === 0) {
        throw new Error(`No writable embedded phone sources configured for ${relativePath}`);
      }
      await Promise.all(targets.map((source) => putDirectory(resolveEmbeddedPhoneSourceStoragePath(source.path, relativePath))));
    },
    async exists(relativePath: string): Promise<boolean> {
      const sources = await getEmbeddedPhoneEnabledSources();
      for (const source of sources) {
        const candidatePath = resolveEmbeddedPhoneSourceStoragePath(source.path, relativePath);
        if ((await getRecord(candidatePath)) || (await hasDirectory(candidatePath))) {
          return true;
        }
        const directoryPrefix = `${normalizeStoragePath(candidatePath)}/`;
        const storedPaths = await listStoredPaths();
        if (storedPaths.some((storedPath) => normalizeStoragePath(storedPath).startsWith(directoryPrefix))) {
          return true;
        }
      }
      return false;
    },
    async deleteFile(relativePath: string): Promise<void> {
      const sources = await getEmbeddedPhoneWritableSourcesForRelativePath(relativePath);
      await Promise.all(
        sources.map(async (source) => {
          await deleteRecord(resolveEmbeddedPhoneSourceStoragePath(source.path, relativePath));
        })
      );
    },
    async writeFileForChannel(relativePath: string, data: Uint8Array, _channelKeyHex: string): Promise<void> {
      await storage.writeFile(relativePath, data);
    },
    async readValidatedFileForChannel(
      relativePath: string,
      _channelKeyHex: string,
      validate: (data: Uint8Array) => Promise<{ ok: boolean; detail?: string }>
    ): Promise<Uint8Array> {
      return storage.readValidatedFile(relativePath, validate);
    },
    async listFilesAcrossRoots(directory: string): Promise<string[]> {
      return storage.listFiles(directory);
    },
    async existsForChannel(relativePath: string, _channelKeyHex: string): Promise<boolean> {
      return storage.exists(relativePath);
    },
  } satisfies StorageBackend & {
    writeFileForChannel(path: string, data: Uint8Array, channelKeyHex: string): Promise<void>;
    readValidatedFile(path: string, validate: (data: Uint8Array) => Promise<{ ok: boolean; detail?: string }>): Promise<Uint8Array>;
    readValidatedFileForChannel(
      path: string,
      channelKeyHex: string,
      validate: (data: Uint8Array) => Promise<{ ok: boolean; detail?: string }>
    ): Promise<Uint8Array>;
    listFilesAcrossRoots(directory: string): Promise<string[]>;
    existsForChannel(path: string, channelKeyHex: string): Promise<boolean>;
  };
  return storage;
}

async function listStoredFileRecords(): Promise<StoredPathRecord[]> {
  const db = await getIndexedDb();
  if (db) {
    try {
      return (await db.getAll('files')) as StoredPathRecord[];
    } catch {
      return listIndexedDbFileRecordsWithCursor(db);
    }
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

async function readEmbeddedPhoneKnownVolumeSecrets(): Promise<Record<string, string>> {
  const stored = await getSetting(PHONE_KNOWN_VOLUME_SECRETS_KEY);
  if (!stored) {
    return {};
  }
  try {
    const parsed = JSON.parse(stored) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed)
        .map(([volumeId, secret]) => [volumeId.trim().toLowerCase(), typeof secret === 'string' ? secret.trim() : ''])
        .filter((entry) => entry[0].length > 0 && entry[1].length > 0)
    );
  } catch {
    return {};
  }
}

async function writeEmbeddedPhoneKnownVolumeSecrets(secrets: Record<string, string>): Promise<void> {
  await putSetting(PHONE_KNOWN_VOLUME_SECRETS_KEY, JSON.stringify(secrets));
}

async function rememberEmbeddedPhoneKnownVolumeSecret(volumeId: string, secret: string): Promise<void> {
  const normalizedVolumeId = volumeId.trim().toLowerCase();
  const normalizedSecret = secret.trim();
  if (!normalizedVolumeId || !normalizedSecret) {
    return;
  }
  embeddedPhoneKnownVolumeSecrets.set(normalizedVolumeId, normalizedSecret);
  const secrets = await readEmbeddedPhoneKnownVolumeSecrets();
  secrets[normalizedVolumeId] = normalizedSecret;
  await writeEmbeddedPhoneKnownVolumeSecrets(secrets);
}

async function getEmbeddedPhoneKnownVolumeSecret(volumeId: string): Promise<string | null> {
  const normalizedVolumeId = volumeId.trim().toLowerCase();
  if (!normalizedVolumeId) {
    return null;
  }
  const cached = embeddedPhoneKnownVolumeSecrets.get(normalizedVolumeId);
  if (cached) {
    return cached;
  }
  const secrets = await readEmbeddedPhoneKnownVolumeSecrets();
  const restored = secrets[normalizedVolumeId]?.trim();
  if (restored) {
    embeddedPhoneKnownVolumeSecrets.set(normalizedVolumeId, restored);
    return restored;
  }
  return null;
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

function parseEmbeddedPhoneProviderOverride(value: unknown): boolean | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') {
    return true;
  }
  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') {
    return false;
  }
  return undefined;
}

function decodeEmbeddedPhoneDevBootstrap<T>(value: unknown): T | undefined {
  if (typeof value !== 'string' || value.trim() === '') {
    return undefined;
  }
  try {
    return JSON.parse(Buffer.from(value, 'base64').toString('utf8')) as T;
  } catch {
    return undefined;
  }
}

function normalizeEmbeddedPhoneBootstrapIntegrationState(
  snapshot: IntegrationStateSnapshot | undefined,
  sourcePaths: ReadonlyMap<string, string> = new Map()
): IntegrationStateSnapshot | undefined {
  if (!snapshot || typeof snapshot !== 'object') {
    return undefined;
  }
  return {
    version: 1,
    preferredProviders: Array.isArray(snapshot.preferredProviders) ? [...snapshot.preferredProviders] : [],
    accounts: Array.isArray(snapshot.accounts) ? [...snapshot.accounts] : [],
    managedShares: Array.isArray(snapshot.managedShares)
      ? snapshot.managedShares.map((share) => ({
          ...share,
          localPath: share.sourceId ? (sourcePaths.get(share.sourceId) ?? share.localPath) : share.localPath,
        }))
      : [],
    maintenance: snapshot.maintenance,
  };
}

function normalizeEmbeddedPhoneBootstrapProviderSecrets(
  value: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const entries = value.entries;
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) {
    return value;
  }
  const normalized: Record<string, unknown> = {};
  for (const [key, encoded] of Object.entries(entries)) {
    if (typeof encoded !== 'string' || encoded.trim() === '') {
      continue;
    }
    try {
      normalized[key] = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) as unknown;
    } catch {
      normalized[key] = encoded;
    }
  }
  return normalized;
}

function normalizeEmbeddedPhoneBootstrapRootsConfig(snapshot: RootsConfig | undefined): RootsConfig | undefined {
  if (!snapshot || typeof snapshot !== 'object') {
    return undefined;
  }
  if (snapshot.version !== 2 || !Array.isArray(snapshot.sources) || !snapshot.defaultVolume || !Array.isArray(snapshot.volumes)) {
    return undefined;
  }
  return {
    ...snapshot,
    sources: snapshot.sources.map((source, index) => ({
      ...source,
      path: normalizeEmbeddedPhoneBootstrapSourcePath(source, index),
    })),
  };
}

function normalizeEmbeddedPhoneBootstrapSourcePath(source: RootsConfig['sources'][number], index: number): string {
  if (index === 0) {
    return source.path;
  }
  if (source.integration?.kind === 'provider-managed') {
    const id = source.integration.managedShareId || source.id;
    return `local/provider-managed/${source.provider}/${id}`;
  }
  return source.path;
}

function applyEmbeddedPhoneProviderEnvOverrides(config: AppConfig): AppConfig {
  const mega = parseEmbeddedPhoneProviderOverride(import.meta.env.VITE_NEARBYTES_EMBEDDED_PHONE_MEGA_ENABLED);
  const localNetwork = parseEmbeddedPhoneProviderOverride(import.meta.env.VITE_NEARBYTES_EMBEDDED_PHONE_LOCAL_NETWORK_ENABLED);
  if (mega === undefined && localNetwork === undefined) {
    return config;
  }
  return {
    ...config,
    features: {
      ...config.features,
      providers: {
        ...config.features.providers,
        mega: mega ?? config.features.providers.mega,
        localNetwork: localNetwork ?? config.features.providers.localNetwork,
      },
    },
  };
}

async function ensureEmbeddedPhoneDevBootstrap(): Promise<void> {
  if (embeddedPhoneDevBootstrapPromise) {
    return embeddedPhoneDevBootstrapPromise;
  }
  embeddedPhoneDevBootstrapPromise = (async () => {
    const rootsConfig = normalizeEmbeddedPhoneBootstrapRootsConfig(
      decodeEmbeddedPhoneDevBootstrap<RootsConfig>(
        import.meta.env.VITE_NEARBYTES_EMBEDDED_PHONE_ROOTS_CONFIG_B64
      )
    );
    const sourcePaths = new Map((rootsConfig?.sources ?? []).map((source) => [source.id, source.path]));
    const integrationState = normalizeEmbeddedPhoneBootstrapIntegrationState(
      decodeEmbeddedPhoneDevBootstrap<IntegrationStateSnapshot>(
        import.meta.env.VITE_NEARBYTES_EMBEDDED_PHONE_INTEGRATION_STATE_B64
      ),
      sourcePaths
    );
    const providerSecrets = normalizeEmbeddedPhoneBootstrapProviderSecrets(
      decodeEmbeddedPhoneDevBootstrap<Record<string, unknown>>(
        import.meta.env.VITE_NEARBYTES_EMBEDDED_PHONE_PROVIDER_SECRETS_B64
      )
    );
    if (integrationState) {
      await putSetting(PHONE_INTEGRATION_STATE_KEY, JSON.stringify(integrationState));
    }
    if (providerSecrets) {
      await putSetting(PHONE_PROVIDER_SECRETS_KEY, JSON.stringify(providerSecrets));
    }
    if (rootsConfig) {
      await putSetting(PHONE_ROOTS_CONFIG_KEY, JSON.stringify(rootsConfig));
    }
  })();
  return embeddedPhoneDevBootstrapPromise;
}

function cloneEmbeddedPhoneAppConfig(config: AppConfig): AppConfig {
  return {
    version: config.version,
    features: {
      providers: {
        googleDrive: config.features.providers.googleDrive,
        mega: config.features.providers.mega,
        github: config.features.providers.github,
        localNetwork: config.features.providers.localNetwork,
      },
      performance: {
        appMetrics: config.features.performance.appMetrics,
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
  await ensureEmbeddedPhoneDevBootstrap();
  if (embeddedPhoneRootsConfigCache) {
    return embeddedPhoneRootsConfigCache;
  }
  const stored = await getSetting(PHONE_ROOTS_CONFIG_KEY);
  if (!stored) {
    const config = createDefaultEmbeddedPhoneRootsConfig();
    embeddedPhoneRootsConfigCache = config;
    return config;
  }
  try {
    const config = JSON.parse(stored) as RootsConfig;
    embeddedPhoneRootsConfigCache = config;
    return config;
  } catch {
    const config = createDefaultEmbeddedPhoneRootsConfig();
    embeddedPhoneRootsConfigCache = config;
    return config;
  }
}

async function writeEmbeddedPhoneRootsConfigValue(config: RootsConfig): Promise<void> {
  embeddedPhoneRootsConfigCache = config;
  embeddedPhoneManagedShareServicePromise = null;
  await putSetting(PHONE_ROOTS_CONFIG_KEY, JSON.stringify(config));
}

async function readEmbeddedPhoneAppConfigValue(): Promise<AppConfig> {
  await ensureEmbeddedPhoneDevBootstrap();
  if (embeddedPhoneAppConfigCache) {
    return applyEmbeddedPhoneProviderEnvOverrides(embeddedPhoneAppConfigCache);
  }
  const stored = await getSetting(PHONE_APP_CONFIG_KEY);
  if (!stored) {
    const config = applyEmbeddedPhoneProviderEnvOverrides(createDefaultEmbeddedPhoneAppConfig());
    embeddedPhoneAppConfigCache = config;
    return config;
  }
  try {
    const config = applyEmbeddedPhoneProviderEnvOverrides(JSON.parse(stored) as AppConfig);
    embeddedPhoneAppConfigCache = config;
    return config;
  } catch {
    const config = applyEmbeddedPhoneProviderEnvOverrides(createDefaultEmbeddedPhoneAppConfig());
    embeddedPhoneAppConfigCache = config;
    return config;
  }
}

async function writeEmbeddedPhoneAppConfigValue(config: AppConfig): Promise<void> {
  embeddedPhoneAppConfigCache = config;
  embeddedPhoneManagedShareServicePromise = null;
  await putSetting(PHONE_APP_CONFIG_KEY, JSON.stringify(config));
}

function createDefaultEmbeddedPhoneIntegrationState(): IntegrationStateSnapshot {
  return {
    version: 1,
    preferredProviders: [],
    accounts: [],
    managedShares: [],
    maintenance: undefined,
  };
}

async function readEmbeddedPhoneIntegrationStateValue(): Promise<IntegrationStateSnapshot> {
  await ensureEmbeddedPhoneDevBootstrap();
  const stored = await getSetting(PHONE_INTEGRATION_STATE_KEY);
  if (!stored) {
    return createDefaultEmbeddedPhoneIntegrationState();
  }
  try {
    return JSON.parse(stored) as IntegrationStateSnapshot;
  } catch {
    return createDefaultEmbeddedPhoneIntegrationState();
  }
}

async function writeEmbeddedPhoneIntegrationStateValue(snapshot: IntegrationStateSnapshot): Promise<void> {
  await putSetting(PHONE_INTEGRATION_STATE_KEY, JSON.stringify(snapshot));
}

async function readEmbeddedPhoneProviderSecretsValue(): Promise<Record<string, unknown>> {
  await ensureEmbeddedPhoneDevBootstrap();
  const stored = await getSetting(PHONE_PROVIDER_SECRETS_KEY);
  if (!stored) {
    return {};
  }
  try {
    return JSON.parse(stored) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function writeEmbeddedPhoneProviderSecretsValue(secrets: Record<string, unknown>): Promise<void> {
  await putSetting(PHONE_PROVIDER_SECRETS_KEY, JSON.stringify(secrets));
}

const embeddedPhoneManagedShareStateStore: ManagedShareStateStore = {
  async load(): Promise<IntegrationStateSnapshot> {
    return readEmbeddedPhoneIntegrationStateValue();
  },
  async save(snapshot: IntegrationStateSnapshot): Promise<void> {
    await writeEmbeddedPhoneIntegrationStateValue(snapshot);
  },
};

const embeddedPhoneManagedShareRootsConfigStore: ManagedShareRootsConfigStore = {
  async save(config: RootsConfig): Promise<void> {
    await writeEmbeddedPhoneRootsConfigValue(config);
  },
};

function normalizeEmbeddedPhoneManagedSharePath(targetPath: string): string {
  return normalizeStoragePath(targetPath);
}

function getEmbeddedPhoneManagedShareDirname(targetPath: string): string {
  const normalized = normalizeEmbeddedPhoneManagedSharePath(targetPath);
  if (!normalized || !normalized.includes('/')) {
    return '';
  }
  return normalized.slice(0, normalized.lastIndexOf('/'));
}

function buildEmbeddedPhoneManagedSharePathPrefixes(targetPath: string): string[] {
  const normalized = normalizeEmbeddedPhoneManagedSharePath(targetPath);
  if (!normalized) {
    return [];
  }
  const segments = normalized.split('/').filter((segment) => segment.length > 0);
  const prefixes: string[] = [];
  for (let index = 0; index < segments.length; index += 1) {
    prefixes.push(segments.slice(0, index + 1).join('/'));
  }
  return prefixes;
}

function isEmbeddedPhoneManagedSharePathWithin(candidatePath: string, targetPath: string): boolean {
  const normalizedCandidate = normalizeEmbeddedPhoneManagedSharePath(candidatePath);
  const normalizedTarget = normalizeEmbeddedPhoneManagedSharePath(targetPath);
  return normalizedCandidate === normalizedTarget || normalizedCandidate.startsWith(`${normalizedTarget}/`);
}

async function embeddedPhoneManagedSharePathExists(targetPath: string): Promise<boolean> {
  const normalized = normalizeEmbeddedPhoneManagedSharePath(targetPath);
  if (!normalized) {
    return false;
  }
  if (await getRecord(normalized)) {
    return true;
  }
  if (await hasDirectory(normalized)) {
    return true;
  }
  const [storedPaths, storedDirectories] = await Promise.all([listStoredPaths(), listStoredDirectories()]);
  return [...storedPaths, ...storedDirectories].some((candidate) => isEmbeddedPhoneManagedSharePathWithin(candidate, normalized));
}

async function listEmbeddedPhoneManagedShareDirectoryEntries(dirPath: string): Promise<readonly ManagedShareDirectoryEntry[]> {
  const normalizedDirPath = normalizeEmbeddedPhoneManagedSharePath(dirPath);
  const prefix = normalizedDirPath ? `${normalizedDirPath}/` : '';
  const childKinds = new Map<string, boolean>();
  const [storedPaths, storedDirectories] = await Promise.all([listStoredPaths(), listStoredDirectories()]);

  for (const candidate of storedDirectories) {
    if (!candidate.startsWith(prefix) || candidate === normalizedDirPath) {
      continue;
    }
    const remainder = candidate.slice(prefix.length);
    const [child] = remainder.split('/');
    if (child) {
      childKinds.set(child, true);
    }
  }

  for (const candidate of storedPaths) {
    const normalizedCandidate = normalizeEmbeddedPhoneManagedSharePath(candidate);
    if (!normalizedCandidate.startsWith(prefix)) {
      continue;
    }
    const remainder = normalizedCandidate.slice(prefix.length);
    const [child, nested] = remainder.split('/');
    if (!child) {
      continue;
    }
    if (nested) {
      childKinds.set(child, true);
      continue;
    }
    if (!childKinds.has(child)) {
      childKinds.set(child, false);
    }
  }

  return Array.from(childKinds.entries())
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([name, directory]) => ({
      name,
      isDirectory() {
        return directory;
      },
    }));
}

async function copyEmbeddedPhoneManagedSharePath(sourcePath: string, targetPath: string): Promise<void> {
  const normalizedSource = normalizeEmbeddedPhoneManagedSharePath(sourcePath);
  const normalizedTarget = normalizeEmbeddedPhoneManagedSharePath(targetPath);
  const record = await getRecord(normalizedSource);
  if (record) {
    await Promise.all(
      buildEmbeddedPhoneManagedSharePathPrefixes(getEmbeddedPhoneManagedShareDirname(normalizedTarget)).map((entry) =>
        putDirectory(entry)
      )
    );
    await putRecord(normalizedTarget, record.data);
    return;
  }

  const [storedPaths, storedDirectories] = await Promise.all([listStoredPaths(), listStoredDirectories()]);
  const matchingDirectories = storedDirectories.filter((candidate) => isEmbeddedPhoneManagedSharePathWithin(candidate, normalizedSource));
  const matchingFiles = storedPaths.filter((candidate) => isEmbeddedPhoneManagedSharePathWithin(candidate, normalizedSource));
  if (matchingDirectories.length === 0 && matchingFiles.length === 0) {
    return;
  }
  for (const directoryPath of matchingDirectories) {
    const suffix = directoryPath.slice(normalizedSource.length).replace(/^\//, '');
    const nextDirectory = suffix ? `${normalizedTarget}/${suffix}` : normalizedTarget;
    await Promise.all(buildEmbeddedPhoneManagedSharePathPrefixes(nextDirectory).map((entry) => putDirectory(entry)));
  }
  for (const filePath of matchingFiles) {
    const record = await getRecord(filePath);
    if (!record) {
      continue;
    }
    const suffix = filePath.slice(normalizedSource.length).replace(/^\//, '');
    const nextFilePath = suffix ? `${normalizedTarget}/${suffix}` : normalizedTarget;
    await Promise.all(
      buildEmbeddedPhoneManagedSharePathPrefixes(getEmbeddedPhoneManagedShareDirname(nextFilePath)).map((entry) =>
        putDirectory(entry)
      )
    );
    await putRecord(nextFilePath, record.data);
  }
}

async function removeEmbeddedPhoneManagedSharePath(targetPath: string, recursive = false): Promise<void> {
  const normalizedTarget = normalizeEmbeddedPhoneManagedSharePath(targetPath);
  if (!normalizedTarget) {
    return;
  }
  const fileRecord = await getRecord(normalizedTarget);
  if (fileRecord) {
    await deleteRecord(normalizedTarget);
    return;
  }
  if (!recursive) {
    return;
  }
  const db = await getIndexedDb();
  const [storedPaths, storedDirectories] = await Promise.all([listStoredPaths(), listStoredDirectories()]);
  const fileTargets = storedPaths.filter((candidate) => isEmbeddedPhoneManagedSharePathWithin(candidate, normalizedTarget));
  const directoryTargets = storedDirectories.filter((candidate) => isEmbeddedPhoneManagedSharePathWithin(candidate, normalizedTarget));
  for (const filePath of fileTargets) {
    await deleteRecord(filePath);
  }
  if (db) {
    for (const directoryPath of directoryTargets) {
      await db.delete('directories', directoryPath);
    }
  } else {
    for (const directoryPath of directoryTargets) {
      getInMemoryStore().directories.delete(directoryPath);
    }
  }
}

const embeddedPhoneManagedShareFileHost: ManagedShareFileHost = {
  async ensureDirectory(targetPath: string): Promise<void> {
    for (const directoryPath of buildEmbeddedPhoneManagedSharePathPrefixes(targetPath)) {
      await putDirectory(directoryPath);
    }
  },
  async removePath(targetPath: string, options?: { readonly recursive?: boolean; readonly force?: boolean }): Promise<void> {
    if (!(await embeddedPhoneManagedSharePathExists(targetPath))) {
      if (options?.force) {
        return;
      }
      throw new Error(`Path not found: ${targetPath}`);
    }
    await removeEmbeddedPhoneManagedSharePath(targetPath, options?.recursive === true);
  },
  async renamePath(sourcePath: string, targetPath: string): Promise<void> {
    await copyEmbeddedPhoneManagedSharePath(sourcePath, targetPath);
    await removeEmbeddedPhoneManagedSharePath(sourcePath, true);
  },
  async copyFile(sourcePath: string, targetPath: string): Promise<void> {
    await copyEmbeddedPhoneManagedSharePath(sourcePath, targetPath);
  },
  async readDirectoryEntries(dirPath: string): Promise<readonly ManagedShareDirectoryEntry[]> {
    return listEmbeddedPhoneManagedShareDirectoryEntries(dirPath);
  },
  async statPath(targetPath: string): Promise<ManagedSharePathStats | null> {
    const normalizedTarget = normalizeEmbeddedPhoneManagedSharePath(targetPath);
    if (!normalizedTarget) {
      return {
        isFile() {
          return false;
        },
        isDirectory() {
          return true;
        },
      };
    }
    if (await hasDirectory(normalizedTarget)) {
      return {
        isFile() {
          return false;
        },
        isDirectory() {
          return true;
        },
      };
    }
    if (await getRecord(normalizedTarget)) {
      return {
        isFile() {
          return true;
        },
        isDirectory() {
          return false;
        },
      };
    }
    const entries = await listEmbeddedPhoneManagedShareDirectoryEntries(normalizedTarget);
    if (entries.length > 0) {
      return {
        isFile() {
          return false;
        },
        isDirectory() {
          return true;
        },
      };
    }
    return null;
  },
};

const embeddedPhoneMegaFsShim: EmbeddedPhoneMegaFsShim = {
  async mkdir(targetPath: string, options?: { readonly recursive?: boolean }): Promise<void> {
    const normalizedTarget = normalizeEmbeddedPhoneManagedSharePath(targetPath);
    if (!normalizedTarget) {
      return;
    }
    const directoryTargets = options?.recursive
      ? buildEmbeddedPhoneManagedSharePathPrefixes(normalizedTarget)
      : [normalizedTarget];
    for (const directoryPath of directoryTargets) {
      await putDirectory(directoryPath);
    }
  },
  async readFile(targetPath: string): Promise<Uint8Array> {
    const normalizedTarget = normalizeEmbeddedPhoneManagedSharePath(targetPath);
    const record = await getRecord(normalizedTarget);
    if (!record) {
      throw new Error(`File not found: ${targetPath}`);
    }
    return new Uint8Array(record.data);
  },
  async writeFile(targetPath: string, data: Uint8Array): Promise<void> {
    const normalizedTarget = normalizeEmbeddedPhoneManagedSharePath(targetPath);
    await embeddedPhoneMegaFsShim.mkdir(getEmbeddedPhoneManagedShareDirname(normalizedTarget), { recursive: true });
    await putRecord(normalizedTarget, data);
  },
  async access(targetPath: string): Promise<void> {
    if (await embeddedPhoneManagedSharePathExists(targetPath)) {
      return;
    }
    throw new Error(`Path not found: ${targetPath}`);
  },
  async rm(
    targetPath: string,
    options?: {
      readonly recursive?: boolean;
      readonly force?: boolean;
    }
  ): Promise<void> {
    if (!(await embeddedPhoneManagedSharePathExists(targetPath))) {
      if (options?.force) {
        return;
      }
      throw new Error(`Path not found: ${targetPath}`);
    }
    await removeEmbeddedPhoneManagedSharePath(targetPath, options?.recursive === true);
  },
  async stat(targetPath: string): Promise<EmbeddedPhoneMegaFsStatsLike> {
    const stats = await embeddedPhoneManagedShareFileHost.statPath(targetPath);
    if (!stats) {
      throw new Error(`Path not found: ${targetPath}`);
    }
    return stats;
  },
  async readdir(targetPath: string): Promise<string[]> {
    const entries = await embeddedPhoneManagedShareFileHost.readDirectoryEntries(targetPath);
    return entries.map((entry) => entry.name);
  },
};

// docs/specs/transport/phone-mega-port-plan-v0.1.md and docs/specs/storage-integration-stack-v1.md:
// keep the phone self-contained by letting the shared MEGA runtime materialize canonical files directly
// against the embedded managed-share store instead of falling back to Node fs or a separate dev server.
globalThis.__nearbytesMegaFs = embeddedPhoneMegaFsShim;

const embeddedPhoneManagedShareRootHost: ManagedShareRootHost = {
  async ensureMarkers() {
    return [];
  },
  async inspectRoot() {
    return null;
  },
  async normalizeRoot() {
    return {
      createdMarker: false,
      rewroteMarker: false,
      removedLegacyMetadata: false,
    };
  },
};

async function resolveEmbeddedPhoneAttachedVolumeIds(
  share: Parameters<MegaOwnerMirrorSource['listMirrorFiles']>[0]
): Promise<Set<string>> {
  const fromAttachments = (share.attachments ?? [])
    .map((attachment) => attachment.volumeId.trim().toLowerCase())
    .filter((volumeId) => volumeId.length > 0);
  if (fromAttachments.length > 0) {
    return new Set(fromAttachments);
  }
  if (!share.sourceId) {
    return new Set();
  }
  const config = await readEmbeddedPhoneRootsConfigValue();
  const explicitMatches = config.volumes
    .filter((volume) =>
      resolveEmbeddedPhoneVolumeDestinations(config, volume.volumeId).some(
        (destination) => destination.sourceId === share.sourceId
      )
    )
    .map((volume) => volume.volumeId.trim().toLowerCase())
    .filter((volumeId) => volumeId.length > 0);
  if (explicitMatches.length > 0) {
    return new Set(explicitMatches);
  }
  const attachedByDefault = config.defaultVolume.destinations.some(
    (destination) => destination.sourceId === share.sourceId && destination.enabled
  );
  if (!attachedByDefault) {
    return new Set();
  }
  // Keep phone owner publication tied to the volumes actively opened in this runtime instance.
  // Replaying every historically remembered volume turns phone startup into a giant catch-up sweep
  // and blocks live phone-to-desktop push behind unrelated archival traffic.
  const persistedSecrets = await readEmbeddedPhoneKnownVolumeSecrets();
  return new Set(
    new Set([
      ...Array.from(embeddedPhoneKnownVolumeSecrets.keys()),
      ...Object.keys(persistedSecrets),
    ].map((volumeId) => volumeId.trim().toLowerCase()).filter((volumeId) => volumeId.length > 0))
  );
}

const embeddedPhoneMegaOwnerMirrorSource: MegaOwnerMirrorSource = {
  async listMirrorFiles(share): Promise<readonly string[]> {
    const attachedVolumeIds = await resolveEmbeddedPhoneAttachedVolumeIds(share);
    const { storage } = await getEmbeddedPhoneRuntimeServices();
    const mirrorPaths = new Set<string>();
    const referencedBlockPaths = new Set<string>();
    for (const volumeId of attachedVolumeIds) {
      const eventFiles =
        'listFilesAcrossRoots' in storage && typeof storage.listFilesAcrossRoots === 'function'
          ? await storage.listFilesAcrossRoots(`channels/${volumeId}`)
          : await storage.listFiles(`channels/${volumeId}`);
      for (const fileName of eventFiles) {
        const normalizedPath = normalizeStoragePath(`channels/${volumeId}/${fileName}`);
        mirrorPaths.add(normalizedPath);
        try {
          const bytes = await storage.readFile(normalizedPath);
          const serialized = JSON.parse(new TextDecoder().decode(bytes)) as import('../../../../src/types/events.js').SerializedEvent;
          const parsed = deserializeEvent(serialized);
          for (const blockHash of parsed.envelope.blockRefs) {
            referencedBlockPaths.add(`blocks/${blockHash}`);
          }
        } catch {
          // Skip malformed historical records instead of blocking current live publication.
        }
      }
    }
    for (const normalizedPath of referencedBlockPaths) {
      if (await storage.exists(normalizedPath)) {
        mirrorPaths.add(normalizedPath);
      }
    }
    return Array.from(mirrorPaths).sort((left, right) => left.localeCompare(right));
  },
  async readMirrorFile(_share, relativePath): Promise<Uint8Array> {
    // The phone owner mirror enumerates canonical files directly from IndexedDB. Read the exact
    // record first so push sync does not fail just because routed source-prefix lookup differs.
    const exactRecord = await getRecord(normalizeStoragePath(relativePath));
    if (exactRecord) {
      return new Uint8Array(exactRecord.data);
    }
    const { storage } = await getEmbeddedPhoneRuntimeServices();
    return storage.readFile(normalizeStoragePath(relativePath));
  },
};

function encodeEmbeddedPhoneBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const value of bytes) {
    binary += String.fromCharCode(value);
  }
  return btoa(binary);
}

function decodeEmbeddedPhoneBase64(value: string): Uint8Array {
  if (!value) {
    return new Uint8Array();
  }
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function embeddedPhoneNativeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = input instanceof Request ? input : new Request(input, init);
  const startedAt = Date.now();
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });
  const bodyBuffer = request.method === 'GET' || request.method === 'HEAD' ? null : await request.arrayBuffer();
  console.log('[embedded-phone-fetch] request started.', {
    method: request.method,
    url: request.url,
    hasBody: bodyBuffer !== null,
  });
  try {
    const nativeResponse = await nativeLanHttpRequest({
      url: request.url,
      method: request.method,
      headers,
      bodyBase64: bodyBuffer ? encodeEmbeddedPhoneBase64(new Uint8Array(bodyBuffer)) : undefined,
    });
    console.log('[embedded-phone-fetch] request completed.', {
      method: request.method,
      url: request.url,
      status: nativeResponse.status,
      durationMs: Date.now() - startedAt,
    });
    return new Response(decodeEmbeddedPhoneBase64(nativeResponse.bodyBase64), {
      status: nativeResponse.status,
      headers: nativeResponse.headers,
    });
  } catch (error) {
    console.warn('[embedded-phone-fetch] request failed.', {
      method: request.method,
      url: request.url,
      durationMs: Date.now() - startedAt,
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

function createEmbeddedPhoneManagedShareRuntime() {
  return {
    secretStore: {
      async get<T>(key: string): Promise<T | null> {
        const secrets = await readEmbeddedPhoneProviderSecretsValue();
        return (secrets[key] as T | undefined) ?? null;
      },
      async set<T>(key: string, value: T): Promise<void> {
        const secrets = await readEmbeddedPhoneProviderSecretsValue();
        secrets[key] = value;
        await writeEmbeddedPhoneProviderSecretsValue(secrets);
      },
      async delete(key: string): Promise<void> {
        const secrets = await readEmbeddedPhoneProviderSecretsValue();
        delete secrets[key];
        await writeEmbeddedPhoneProviderSecretsValue(secrets);
      },
    },
    commandExecutor: {
      async run(): Promise<never> {
        throw new Error('Provider command execution is not available in the embedded phone runtime.');
      },
    },
    // Keep the phone self-contained: the embedded managed-share runtime must execute the shared
    // backend/integration code in-process, using native URLSession on device instead of the dev phone API server.
    fetch: hasNativeLanPlugin() ? embeddedPhoneNativeFetch : globalThis.fetch.bind(globalThis),
    createAbortController: () => new AbortController(),
    scheduler: {
      setTimeout(callback: () => void, delayMs: number) {
        const timer = setTimeout(callback, delayMs);
        return {
          cancel() {
            clearTimeout(timer);
          },
        };
      },
      setInterval(callback: () => void, intervalMs: number) {
        const timer = setInterval(callback, intervalMs);
        return {
          cancel() {
            clearInterval(timer);
          },
        };
      },
    },
    now: () => Date.now(),
    logger: console,
    google: {
      authorizationBaseUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      driveApiBaseUrl: 'https://www.googleapis.com/drive/v3',
      scopes: ['https://www.googleapis.com/auth/drive.file'],
      syncIntervalMs: 20_000,
    },
    mega: {
      remoteBasePath: '/nearbytes',
      // Keep periodic MEGA sweeps off by default. The phone path should rely on push and explicit
      // recovery, not a background polling loop.
      syncIntervalMs: 0,
      syncTimeoutMs: 180_000,
      inviteReflectionTimeoutMs: 5_000,
      inviteReflectionPollMs: 1_500,
      ownerMirrorSource: embeddedPhoneMegaOwnerMirrorSource,
    },
    github: {
      deviceCodeUrl: 'https://github.com/login/device/code',
      tokenUrl: 'https://github.com/login/oauth/access_token',
      apiBaseUrl: 'https://api.github.com',
      docsUrl: 'https://github.com/settings/applications/new',
      scopes: ['repo', 'read:user', 'user:email'],
      syncIntervalMs: 20_000,
    },
  };
}

function createEmbeddedPhoneProviderCatalogAdapter(
  provider: string,
  label: string,
  description: string
): TransportAdapter {
  const normalizedProvider = provider.trim().toLowerCase();
  return {
    provider,
    label,
    description,
    supportsAccountConnection: true,
    async getSetupState() {
      return getNativeProviderSetupState(normalizedProvider).catch(() => ({
        status: 'ready',
        detail: `${label} local account state is available on this phone.`,
      }));
    },
    async configure(input) {
      if (normalizedProvider === 'mega') {
        return configureNativeProvider({
          provider: normalizedProvider,
          clientId: input.clientId,
          clientSecret: input.clientSecret,
        });
      }
      return configureNativeProvider({
        provider: normalizedProvider,
        clientId: input.clientId,
        clientSecret: input.clientSecret,
      });
    },
    async install() {
      return installNativeProvider(normalizedProvider);
    },
    async probe(): Promise<TransportState> {
      return {
        status: 'unsupported',
        detail: 'Provider runtime is not available on this phone yet.',
        badges: ['Phone'],
      };
    },
  };
}

async function buildEmbeddedPhoneManagedShareAdapters(
  integrationRuntime: ReturnType<typeof createEmbeddedPhoneManagedShareRuntime>
): Promise<TransportAdapter[]> {
  const config = await readEmbeddedPhoneAppConfigValue();
  const adapters: TransportAdapter[] = [];
  if (config.features.providers.googleDrive) {
    adapters.push(createEmbeddedPhoneProviderCatalogAdapter('gdrive', 'Google Drive', 'Managed folders backed by Google Drive.'));
  }
  if (config.features.providers.mega) {
    adapters.push(new MegaTransportAdapter(integrationRuntime));
  }
  if (config.features.providers.github) {
    adapters.push(createEmbeddedPhoneProviderCatalogAdapter('github', 'GitHub', 'Managed folders backed by GitHub.'));
  }
  return adapters;
}

async function createEmbeddedPhoneManagedShareStorageHost(): Promise<ManagedShareStorageHost> {
  const config = await readEmbeddedPhoneRootsConfigValue();
  embeddedPhoneRootsConfigCache = config;
  return {
    getRootsConfig(): RootsConfig {
      return embeddedPhoneRootsConfigCache ?? createDefaultEmbeddedPhoneRootsConfig();
    },
    async getRuntimeSnapshot(options?: { readonly includeUsage?: boolean }) {
      return buildEmbeddedPhoneRootsRuntimeSnapshot(
        embeddedPhoneRootsConfigCache ?? createDefaultEmbeddedPhoneRootsConfig(),
        options?.includeUsage === true
      );
    },
    onWrite(listener: StorageWriteListener) {
      embeddedPhoneStorageWriteListeners.add(listener);
      return () => {
        embeddedPhoneStorageWriteListeners.delete(listener);
      };
    },
    async consolidateRoot() {
      return {
        config: embeddedPhoneRootsConfigCache ?? createDefaultEmbeddedPhoneRootsConfig(),
        result: {
          source: {
            id: EMBEDDED_PHONE_SOURCE_ID,
            kind: 'source',
            provider: 'local',
            path: '',
            fileCount: 0,
            totalBytes: 0,
          },
          target: {
            id: EMBEDDED_PHONE_SOURCE_ID,
            kind: 'source',
            provider: 'local',
            path: '',
            fileCount: 0,
            totalBytes: 0,
            sameDevice: true,
            filesToTransfer: 0,
            bytesToTransfer: 0,
          },
          movedFiles: 0,
          movedBytes: 0,
          skippedExisting: 0,
          removedSourceFiles: 0,
          startedAt: Date.now(),
          completedAt: Date.now(),
        },
      };
    },
    async resolveSourceConflicts() {
      return {
        config: embeddedPhoneRootsConfigCache ?? createDefaultEmbeddedPhoneRootsConfig(),
        repairs: [],
      };
    },
    async reconcileConfiguredVolumes(): Promise<void> {},
    updateRootsConfig(config: RootsConfig): void {
      embeddedPhoneRootsConfigCache = config;
    },
    scheduleReconcileConfiguredVolumes(): void {},
  };
}

async function getEmbeddedPhoneManagedShareService(): Promise<ManagedShareService> {
  if (!embeddedPhoneManagedShareServicePromise) {
    embeddedPhoneManagedShareServicePromise = (async () => {
      const appConfig = await readEmbeddedPhoneAppConfigValue();
      embeddedPhoneAppConfigCache = appConfig;
      const storage = await createEmbeddedPhoneManagedShareStorageHost();
      const integrationRuntime = createEmbeddedPhoneManagedShareRuntime();
      return new ManagedShareService({
        storage,
        rootsConfigPath: 'embedded-phone:roots',
        integrationRuntime,
        isProviderEnabled(provider: string): boolean {
          const providers = (embeddedPhoneAppConfigCache ?? createDefaultEmbeddedPhoneAppConfig()).features.providers;
          switch (provider.trim().toLowerCase()) {
            case 'gdrive':
            case 'google-drive':
            case 'google_drive':
            case 'googledrive':
              return providers.googleDrive;
            case 'mega':
              return providers.mega;
            case 'github':
              return providers.github;
            case 'local-network':
            case 'local_network':
            case 'lan':
              return providers.localNetwork;
            default:
              return true;
          }
        },
        stateStore: embeddedPhoneManagedShareStateStore,
        rootsConfigStore: embeddedPhoneManagedShareRootsConfigStore,
        fileHost: embeddedPhoneManagedShareFileHost,
        rootHost: embeddedPhoneManagedShareRootHost,
        defaultLocalSourcePath: 'local',
        mirrorRoot: 'local',
        adapters: await buildEmbeddedPhoneManagedShareAdapters(integrationRuntime),
        readMaintenanceMode: 'background',
      });
    })();
  }
  return embeddedPhoneManagedShareServicePromise;
}

export async function embeddedPhoneListProviderAccounts(options: { readonly fast?: boolean } = {}): Promise<ProviderAccountsResponse> {
  const service = await getEmbeddedPhoneManagedShareService();
  return service.listAccounts({ fast: options.fast });
}

export async function embeddedPhoneGetProviderShareInventoryDebug(provider: string): Promise<unknown> {
  const service = await getEmbeddedPhoneManagedShareService();
  return service.getProviderShareInventoryDebug(provider);
}

export async function embeddedPhoneConnectProviderAccount(input: {
  provider: string;
  mode?: 'login' | 'signup' | 'confirm-signup';
  label?: string;
  email?: string;
  preferred?: boolean;
  authSessionId?: string;
  accountId?: string;
  credentials?: {
    name?: string;
    email?: string;
    password?: string;
    mfaCode?: string;
    confirmationLink?: string;
  };
}): Promise<ConnectProviderAccountResponse> {
  const service = await getEmbeddedPhoneManagedShareService();
  return service.connectAccount(input);
}

export async function embeddedPhoneConfigureProviderSetup(
  provider: string,
  input: { clientId?: string; clientSecret?: string }
): Promise<ConfigureProviderResponse> {
  const service = await getEmbeddedPhoneManagedShareService();
  return {
    setup: await service.configureProvider({
      provider,
      clientId: input.clientId,
      clientSecret: input.clientSecret,
    }),
  };
}

export async function embeddedPhoneInstallProviderHelper(provider: string): Promise<ConfigureProviderResponse> {
  const service = await getEmbeddedPhoneManagedShareService();
  return {
    setup: await service.installProvider(provider),
  };
}

export async function embeddedPhoneDisconnectProviderAccount(accountId: string): Promise<void> {
  const service = await getEmbeddedPhoneManagedShareService();
  await service.disconnectAccount(accountId);
}

export async function embeddedPhoneReconcileProviderManagedShares(provider: string): Promise<ReconcileProviderManagedSharesResponse> {
  const service = await getEmbeddedPhoneManagedShareService();
  return service.reconcileProviderManagedShareInventory(provider);
}

export async function embeddedPhoneListManagedShares(options: { readonly fast?: boolean } = {}): Promise<ManagedSharesResponse> {
  const service = await getEmbeddedPhoneManagedShareService();
  return service.listManagedShares({ fast: options.fast });
}

export async function embeddedPhoneListIncomingManagedShares(
  options: { readonly fast?: boolean } = {}
): Promise<IncomingManagedSharesResponse> {
  const service = await getEmbeddedPhoneManagedShareService();
  return service.listIncomingManagedShares({ fast: options.fast });
}

export async function embeddedPhoneListIncomingProviderContactInvites(
  options: { readonly fast?: boolean } = {}
): Promise<IncomingProviderContactInvitesResponse> {
  const service = await getEmbeddedPhoneManagedShareService();
  return service.listIncomingProviderContactInvites({ fast: options.fast });
}

export async function embeddedPhoneAcceptIncomingProviderContactInvite(
  provider: string,
  accountId: string,
  inviteId: string
): Promise<void> {
  const service = await getEmbeddedPhoneManagedShareService();
  await service.acceptIncomingProviderContactInvite(provider, accountId, inviteId);
}

export async function embeddedPhoneGetManagedShareState(shareId: string): Promise<ManagedShareMutationResponse> {
  const service = await getEmbeddedPhoneManagedShareService();
  return {
    summary: await service.getManagedShareState(shareId),
  };
}

export async function embeddedPhoneTriggerManagedShareSync(shareId: string): Promise<void> {
  const service = await getEmbeddedPhoneManagedShareService();
  await service.triggerManagedShareSync(shareId);
}

export async function embeddedPhoneGetManagedShareUploadProbes(
  shareId: string,
  options: { readonly relativePath?: string; readonly limit?: number } = {}
): Promise<{ probes: unknown[] }> {
  const service = await getEmbeddedPhoneManagedShareService();
  return {
    probes: await service.getManagedShareUploadProbes(shareId, {
      relativePath: options.relativePath,
      limit: options.limit,
    }),
  };
}

export async function embeddedPhoneGetManagedShareReceiveProbes(
  shareId: string,
  options: { readonly relativePath?: string; readonly limit?: number } = {}
): Promise<{ probes: unknown[] }> {
  const service = await getEmbeddedPhoneManagedShareService();
  return {
    probes: await service.getManagedShareReceiveProbes(shareId, {
      relativePath: options.relativePath,
      limit: options.limit,
    }),
  };
}

export async function embeddedPhoneDebugListMegaOwnerMirrorFiles(
  shareId: string,
  limit = 20
): Promise<{ count: number; paths: string[] }> {
  const service = await getEmbeddedPhoneManagedShareService();
  const summary = await service.getManagedShareState(shareId);
  const paths = await embeddedPhoneMegaOwnerMirrorSource.listMirrorFiles(summary);
  return {
    count: paths.length,
    paths: paths.slice(0, Math.max(1, Math.min(Math.trunc(limit), 200))),
  };
}

export async function embeddedPhoneDebugReadMegaOwnerMirrorFile(
  shareId: string,
  relativePath: string
): Promise<{ path: string; size: number }> {
  const service = await getEmbeddedPhoneManagedShareService();
  const summary = await service.getManagedShareState(shareId);
  const bytes = await embeddedPhoneMegaOwnerMirrorSource.readMirrorFile(summary, relativePath);
  return {
    path: normalizeStoragePath(relativePath),
    size: bytes.length,
  };
}

export async function embeddedPhoneDebugListStoredPaths(
  prefix = '',
  limit = 200
): Promise<{ prefix: string; count: number; paths: string[] }> {
  const normalizedPrefix = normalizeStoragePath(prefix);
  const paths = (await listStoredPaths())
    .map((entry) => normalizeStoragePath(entry))
    .filter((entry) => !normalizedPrefix || entry.startsWith(normalizedPrefix))
    .sort((left, right) => left.localeCompare(right));
  return {
    prefix: normalizedPrefix,
    count: paths.length,
    paths: paths.slice(0, Math.max(1, Math.min(Math.trunc(limit), 500))),
  };
}

export async function embeddedPhoneDebugReadSetting(
  key: string
): Promise<{ key: string; value: string | null }> {
  const normalizedKey = key.trim();
  return {
    key: normalizedKey,
    value: normalizedKey ? await getSetting(normalizedKey) : null,
  };
}

export async function embeddedPhoneCreateManagedShare(input: {
  provider: string;
  accountId: string;
  label: string;
  localPath?: string;
  role?: 'owner' | 'recipient' | 'link';
  volumeId?: string;
  remoteDescriptor?: Record<string, unknown>;
  capabilities?: string[];
}): Promise<ManagedShareMutationResponse> {
  const service = await getEmbeddedPhoneManagedShareService();
  return {
    summary: await service.createManagedShare(input),
  };
}

export async function embeddedPhoneInviteManagedShare(
  shareId: string,
  emails: string[],
  accessLevel?: 'read' | 'read/write' | 'full access'
): Promise<ManagedShareMutationResponse> {
  const service = await getEmbeddedPhoneManagedShareService();
  return {
    summary: await service.inviteManagedShare(shareId, emails, accessLevel),
  };
}

export async function embeddedPhoneAttachManagedShare(
  shareId: string,
  volumeId: string
): Promise<ManagedShareMutationResponse> {
  const service = await getEmbeddedPhoneManagedShareService();
  return {
    summary: await service.attachManagedShare(shareId, { volumeId }),
  };
}

export async function embeddedPhoneRemoveManagedShare(shareId: string): Promise<void> {
  const service = await getEmbeddedPhoneManagedShareService();
  await service.removeManagedShare(shareId);
}

export async function embeddedPhoneAcceptManagedShare(input: {
  provider: string;
  accountId: string;
  label: string;
  volumeId?: string;
  localPath?: string;
  remoteDescriptor?: Record<string, unknown>;
  capabilities?: string[];
}): Promise<ManagedShareMutationResponse> {
  const service = await getEmbeddedPhoneManagedShareService();
  return {
    summary: await service.acceptManagedShare(input),
  };
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
      ...(function () {
        const isPrimaryEmbeddedSource = index === 0;
        const isLogicalEmbeddedSource = isEmbeddedPhoneLogicalSourcePath(source.path);
        const exists = isPrimaryEmbeddedSource || isLogicalEmbeddedSource;
        return {
          exists,
          isDirectory: exists,
          canWrite: exists && source.enabled && source.writable,
          usage: isPrimaryEmbeddedSource ? usage : createEmptyEmbeddedPhoneUsageSummary(),
        };
      })(),
      id: source.id,
      kind: 'source',
      provider: source.provider,
      path: source.path,
      enabled: source.enabled,
      writable: source.writable,
      reservePercent: source.reservePercent,
      opportunisticPolicy: source.opportunisticPolicy,
    })) satisfies RootRuntimeStatus[],
    writeFailures: [],
  };
}

function isEmbeddedPhoneLogicalSourcePath(sourcePath: string): boolean {
  const normalized = sourcePath.trim();
  if (!normalized) {
    return true;
  }
  if (normalized.startsWith('/')) {
    return false;
  }
  if (/^[A-Za-z]:[\\/]/.test(normalized)) {
    return false;
  }
  return normalized === 'local' || normalized.startsWith('local/');
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
    config: cloneEmbeddedPhoneAppConfig(await readEmbeddedPhoneAppConfigValue()),
  };
}

export async function embeddedPhoneUpdateProviderEnabled(provider: string, enabled: boolean): Promise<AppConfigResponse> {
  const config = cloneEmbeddedPhoneAppConfig(await readEmbeddedPhoneAppConfigValue());
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
  return { config: cloneEmbeddedPhoneAppConfig(config) };
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

async function getEmbeddedPhoneRuntimeServices(): Promise<EmbeddedPhoneRuntimeServices> {
  if (!servicesPromise) {
    servicesPromise = Promise.resolve().then(() => {
      const storage = createEmbeddedPhoneRuntimeStorage();
      return createRuntimeCoreServices({
        storage,
      }) satisfies EmbeddedPhoneRuntimeServices;
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

  await rememberEmbeddedPhoneKnownVolumeSecret(volumeId, secret);

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
  if (await isEmbeddedPhoneProviderManagedVolume(volumeId)) {
    return null;
  }
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
  void nudgeEmbeddedPhoneManagedShareSyncForVolume(snapshot.volumeId).catch(() => undefined);
  return { created };
}

async function performEmbeddedPhoneDeleteFile(secret: string, payload: { filename: string }): Promise<void> {
  const { fileService } = await getEmbeddedPhoneRuntimeServices();
  await fileService.deleteFile(secret, payload.filename);
  const snapshot = await refreshMirrors(secret);
  await emitEmbeddedPhoneVolumeUpdate(snapshot.volumeId, 'unlink', `channels/delete-file:${payload.filename}.json`);
  void nudgeEmbeddedPhoneManagedShareSyncForVolume(snapshot.volumeId).catch(() => undefined);
}

async function performEmbeddedPhoneRenameFile(
  secret: string,
  payload: { from: string; to: string }
): Promise<RenameFileResponse> {
  const { fileService } = await getEmbeddedPhoneRuntimeServices();
  const renamed = await fileService.renameFile(secret, payload.from, payload.to);
  const snapshot = await refreshMirrors(secret);
  await emitEmbeddedPhoneVolumeUpdate(snapshot.volumeId, 'change', `channels/rename-file:${payload.from}->${payload.to}.json`);
  void nudgeEmbeddedPhoneManagedShareSyncForVolume(snapshot.volumeId).catch(() => undefined);
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
  void nudgeEmbeddedPhoneManagedShareSyncForVolume(snapshot.volumeId).catch(() => undefined);
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
  void nudgeEmbeddedPhoneManagedShareSyncForVolume(snapshot.volumeId).catch(() => undefined);
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
  void nudgeEmbeddedPhoneManagedShareSyncForVolume(snapshot.volumeId).catch(() => undefined);
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
  void nudgeEmbeddedPhoneManagedShareSyncForVolume(snapshot.volumeId).catch(() => undefined);
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
  void nudgeEmbeddedPhoneManagedShareSyncForVolume(snapshot.volumeId).catch(() => undefined);
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
  // Keep the embedded phone managed-share observer attached before the mutation writes canonical
  // channels/* and blocks/* records, otherwise the first post-launch phone write misses the direct
  // MEGA owner push path and falls back to a slower reconciliation sync.
  await getEmbeddedPhoneManagedShareService();
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

async function isEmbeddedPhoneProviderManagedVolume(volumeId: string): Promise<boolean> {
  const config = await readEmbeddedPhoneRootsConfigValue();
  const sourceIds = new Set(
    config.sources
      .filter((source) => source.integration?.kind === 'provider-managed')
      .map((source) => source.id)
  );
  if (sourceIds.size === 0) {
    return false;
  }
  const normalizedVolumeId = volumeId.trim().toLowerCase();
  if (!normalizedVolumeId) {
    return false;
  }
  return config.volumes.some(
    (volume) =>
      volume.volumeId.trim().toLowerCase() === normalizedVolumeId &&
      volume.destinations.some((destination) => sourceIds.has(destination.sourceId))
  );
}

async function hasEmbeddedPhoneVolumeHistory(volumeId: string): Promise<boolean> {
  const normalizedVolumeId = volumeId.trim().toLowerCase();
  if (!normalizedVolumeId) {
    return false;
  }
  const { storage } = await getEmbeddedPhoneRuntimeServices();
  const eventFiles =
    'listFilesAcrossRoots' in storage && typeof storage.listFilesAcrossRoots === 'function'
      ? await storage.listFilesAcrossRoots(`channels/${normalizedVolumeId}`)
      : await storage.listFiles(`channels/${normalizedVolumeId}`);
  return eventFiles.length > 0;
}

async function readUnbackedEmbeddedPhoneProviderManagedState(volumeId: string): Promise<{
  volumeId: string;
  files: FileMetadata[];
  timeline: TimelineEvent[];
} | null> {
  if (!(await isEmbeddedPhoneProviderManagedVolume(volumeId))) {
    return null;
  }
  if (await hasEmbeddedPhoneVolumeHistory(volumeId)) {
    return null;
  }
  await deleteEmbeddedPhoneRuntimeHead(volumeId);
  await Promise.all([
    importCompatibilityVolumeSnapshot({
      volumeId,
      files: [],
    }),
    importCompatibilityTimelineSnapshot({
      volumeId,
      eventCount: 0,
      events: [],
    }),
  ]);
  return {
    volumeId,
    files: [],
    timeline: [],
  };
}

async function getEmbeddedPhoneProviderManagedSourceIds(volumeId: string): Promise<string[]> {
  const config = await readEmbeddedPhoneRootsConfigValue();
  const normalizedVolumeId = volumeId.trim().toLowerCase();
  if (!normalizedVolumeId) {
    return [];
  }
  const destinations = resolveEmbeddedPhoneVolumeDestinations(config, normalizedVolumeId);
  if (destinations.length === 0) {
    return [];
  }
  const providerManagedSourceIds = new Set(
    config.sources
      .filter((source) => source.integration?.kind === 'provider-managed')
      .map((source) => source.id)
  );
  return destinations
    .map((destination) => destination.sourceId)
    .filter((sourceId) => providerManagedSourceIds.has(sourceId));
}

async function getEmbeddedPhoneManagedShareIdsForVolume(volumeId: string): Promise<string[]> {
  const config = await readEmbeddedPhoneRootsConfigValue();
  const normalizedVolumeId = volumeId.trim().toLowerCase();
  const destinationSourceIds = new Set(
    resolveEmbeddedPhoneVolumeDestinations(config, normalizedVolumeId).map((destination) => destination.sourceId)
  );
  const managedShareIds = new Set(
    config.sources
      .filter((source) => source.integration?.kind === 'provider-managed')
      .flatMap((source) => {
        const managedShareId = source.integration?.managedShareId?.trim();
        if (!managedShareId) {
          return [];
        }
        const attached = destinationSourceIds.has(source.id);
        return attached ? [managedShareId] : [];
      })
  );
  return [...managedShareIds];
}

async function nudgeEmbeddedPhoneManagedShareSyncForVolume(volumeId: string): Promise<void> {
  const sourceIds = await getEmbeddedPhoneProviderManagedSourceIds(volumeId);
  if (sourceIds.length === 0) {
    return;
  }
  const now = Date.now();
  const lastNudgedAt = embeddedPhoneManagedShareSyncNudges.get(volumeId) ?? 0;
  if (now - lastNudgedAt < EMBEDDED_PHONE_MANAGED_SHARE_SYNC_NUDGE_MIN_INTERVAL_MS) {
    return;
  }
  embeddedPhoneManagedShareSyncNudges.set(volumeId, now);
  const service = await getEmbeddedPhoneManagedShareService();
  const shareIds = await getEmbeddedPhoneManagedShareIdsForVolume(volumeId);
  if (shareIds.length === 0) {
    await service.listManagedShares({ fast: false });
    return;
  }
  await Promise.all(
    shareIds.map(async (shareId) => {
      try {
        await service.triggerManagedShareSync(shareId);
      } catch {
        // Keep the phone self-contained and push-driven: fall back to a broad inventory refresh
        // if a direct share sync cannot be started for this attached managed share.
        await service.listManagedShares({ fast: false });
      }
    })
  );
}

async function rememberEmbeddedPhoneOpenedVolume(secret: string): Promise<string> {
  const volumeId = await deriveVolumeId(secret);
  await rememberEmbeddedPhoneKnownVolumeSecret(volumeId, secret);
  const managedShareService = await getEmbeddedPhoneManagedShareService();
  await managedShareService.rememberOpenedVolume(volumeId);
  void nudgeEmbeddedPhoneManagedShareSyncForVolume(volumeId).catch(() => undefined);
  return volumeId;
}

export async function embeddedPhoneOpenVolume(secret: string): Promise<OpenVolumeResponse> {
  await ensureEmbeddedPhonePendingCommitsDrained();
  const bootstrapped = await readBootstrappedEmbeddedPhoneMirror(secret);
  if (bootstrapped) {
    void rememberEmbeddedPhoneOpenedVolume(secret).catch(() => undefined);
    return {
      volumeId: bootstrapped.volumeId,
      fileCount: bootstrapped.files.length,
      files: bootstrapped.files,
    };
  }
  const volumeId = await rememberEmbeddedPhoneOpenedVolume(secret);
  const unbackedProviderManaged = await readUnbackedEmbeddedPhoneProviderManagedState(volumeId);
  if (unbackedProviderManaged) {
    return {
      volumeId,
      fileCount: 0,
      files: [],
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
  const bootstrapped = await readBootstrappedEmbeddedPhoneMirror(secret);
  if (bootstrapped) {
    void rememberEmbeddedPhoneOpenedVolume(secret).catch(() => undefined);
    return {
      volumeId: bootstrapped.volumeId,
      files: bootstrapped.files,
    };
  }
  const volumeId = await rememberEmbeddedPhoneOpenedVolume(secret);
  const unbackedProviderManaged = await readUnbackedEmbeddedPhoneProviderManagedState(volumeId);
  if (unbackedProviderManaged) {
    return {
      volumeId,
      files: [],
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
  const bootstrapped = await readBootstrappedEmbeddedPhoneMirror(secret);
  if (bootstrapped) {
    void rememberEmbeddedPhoneOpenedVolume(secret).catch(() => undefined);
    return {
      volumeId: bootstrapped.volumeId,
      eventCount: bootstrapped.timeline.length,
      events: bootstrapped.timeline,
    };
  }
  const volumeId = await rememberEmbeddedPhoneOpenedVolume(secret);
  const unbackedProviderManaged = await readUnbackedEmbeddedPhoneProviderManagedState(volumeId);
  if (unbackedProviderManaged) {
    return {
      volumeId,
      eventCount: 0,
      events: [],
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
  await rememberEmbeddedPhoneOpenedVolume(secret);
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
    void rememberEmbeddedPhoneOpenedVolume(secret).catch(() => undefined);
    return buildEmbeddedPhoneChatStateFromTimeline(bootstrapped.timeline);
  }
  await rememberEmbeddedPhoneOpenedVolume(secret);
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
  void embeddedPhoneManagedShareServicePromise?.then((service) => service.dispose()).catch(() => undefined);
  servicesPromise = null;
  dbPromise = null;
  embeddedPhoneKnownVolumeSecrets.clear();
  embeddedPhoneRootsConfigCache = null;
  embeddedPhoneAppConfigCache = null;
  embeddedPhoneManagedShareServicePromise = null;
  embeddedPhoneDevBootstrapPromise = null;
  embeddedPhoneVolumeWatchers.clear();
  embeddedPhoneVolumeWatcherId = 1;
  embeddedPhoneCommitSequence = 1;
  embeddedPhoneCommitDrainPromise = null;
  embeddedPhoneRuntimeMetrics = {
    refreshReads: 0,
    bootstrappedReads: 0,
  };
  inMemoryStore = {
    ...createInMemoryPathRecordStore(),
    settings: new Map(),
  };
}

export async function seedEmbeddedPhoneStoredRecordForTests(path: string, data: Uint8Array): Promise<void> {
  await putDirectory(getEmbeddedPhoneManagedShareDirname(path));
  await putRecord(path, data);
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

export async function seedEmbeddedPhoneIntegrationStateForTests(snapshot: IntegrationStateSnapshot): Promise<void> {
  await writeEmbeddedPhoneIntegrationStateValue(snapshot);
  embeddedPhoneManagedShareServicePromise = null;
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
  const secret = await getEmbeddedPhoneKnownVolumeSecret(normalizedVolumeId);
  if (secret) {
    await refreshMirrors(secret);
    await emitEmbeddedPhoneVolumeUpdate(normalizedVolumeId, 'change', options?.eventHash ? `channels/${options.eventHash}.json` : 'channels/lan-import.json');
    void nudgeEmbeddedPhoneManagedShareSyncForVolume(normalizedVolumeId).catch(() => undefined);
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
