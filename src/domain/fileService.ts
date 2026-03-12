import type { KeyPair, Secret } from '../types/keys.js';
import { createSecret } from '../types/keys.js';
import type { CryptoOperations } from '../crypto/index.js';
import type { StorageBackend, ChannelPathMapper } from '../types/storage.js';
import type { EventPayload, Hash, EncryptedData } from '../types/events.js';
import { createEncryptedData, EMPTY_HASH, EventType } from '../types/events.js';
import { createCryptoOperations } from '../crypto/index.js';
import { DecryptionError } from '../crypto/errors.js';
import { FilesystemStorageBackend } from '../storage/filesystem.js';
import { ChannelStorage } from '../storage/channel.js';
import { getDefaultStorageDir } from '../storagePath.js';
import { defaultPathMapper } from '../types/storage.js';
import { serializeEventPayload } from '../storage/serialization.js';
import { openVolume, loadEventLog, verifyEventLog } from './volume.js';
import type { FileMetadata } from './fileEvents.js';
import type { EventLogEntry } from '../types/volume.js';
import {
  parseChatMessageJson,
  parseIdentityRecordJson,
  parseIdentitySnapshotJson,
  type ChatMessage,
  type IdentityRecord,
} from './chatCodec.js';
import {
  createRecipientKeyCapsule,
  decryptFileForVolume,
  encryptFileForVolume,
  publicKeyFromVolumeId,
  unwrapFileKeyForVolume,
  unwrapRecipientKeyCapsule,
  volumeIdFromPublicKey,
  wrapFileKeyForVolume,
} from './fileCrypto.js';
import {
  decodeWrappedKey,
  encodeWrappedKey,
  parseRecipientReferenceBundle,
  parseSourceReferenceBundle,
  serializeRecipientReferenceBundle,
  serializeSourceReferenceBundle,
  type FileContentType,
  type RecipientReferenceBundle,
  type SourceReferenceBundle,
} from './fileReferenceCodec.js';
import { dedupeOrderedFilenames, resolveImportedFilename } from './fileCommands.js';

const SNAPSHOT_FILE_NAME = 'snapshot.latest.json';
const SNAPSHOT_VERSION = 1;

interface StoredVolumeSnapshot {
  version: number;
  generatedAt: number;
  eventCount: number;
  lastEventHash: string | null;
  files: FileMetadata[];
}

export interface SnapshotSummary {
  generatedAt: number;
  eventCount: number;
  fileCount: number;
  lastEventHash: string | null;
}

export interface ReferenceExportResult<TBundle> {
  bundle: TBundle;
  serialized: string;
  upgradedCount: number;
}

export interface SourceImportResult {
  imported: FileMetadata[];
}

export interface RecipientImportResult {
  imported: FileMetadata[];
}

export interface TimelineEvent {
  eventHash: string;
  type: EventType;
  filename: string;
  timestamp: number;
  toFilename?: string;
  blobHash?: string;
  contentType?: FileContentType;
  size?: number;
  mimeType?: string;
  createdAt?: number;
  deletedAt?: number;
  renamedAt?: number;
  publishedAt?: number;
  authorPublicKey?: string;
  displayName?: string;
  body?: string;
  attachmentName?: string;
  summary?: string;
  record?: IdentityRecord;
  message?: ChatMessage;
}

export interface RenameFolderSummary {
  fromFolder: string;
  toFolder: string;
  movedFiles: number;
  mergedConflicts: number;
}

export interface RenameFileSummary {
  fromName: string;
  toName: string;
}

export interface FileServiceDependencies {
  crypto: CryptoOperations;
  storage: StorageBackend;
  pathMapper?: ChannelPathMapper;
  now?: () => number;
}

export interface FileService {
  addFile(
    secret: string,
    filename: string,
    data: Buffer,
    mimeType?: string
  ): Promise<FileMetadata>;
  deleteFile(secret: string, filename: string): Promise<void>;
  listFiles(secret: string): Promise<FileMetadata[]>;
  getFile(secret: string, blobHash: string): Promise<Buffer>;
  renameFile(secret: string, fromName: string, toName: string): Promise<RenameFileSummary>;
  renameFolder(
    secret: string,
    fromFolder: string,
    toFolder: string,
    options?: { merge?: boolean }
  ): Promise<RenameFolderSummary>;
  computeSnapshot(secret: string): Promise<SnapshotSummary>;
  getTimeline(secret: string): Promise<TimelineEvent[]>;
  exportSourceReferences(
    secret: string,
    filenames: string[]
  ): Promise<ReferenceExportResult<SourceReferenceBundle>>;
  importSourceReferences(
    destinationSecret: string,
    bundle: unknown,
    sourceSecret: string
  ): Promise<SourceImportResult>;
  exportRecipientReferences(
    secret: string,
    filenames: string[],
    recipientVolumeId: string
  ): Promise<ReferenceExportResult<RecipientReferenceBundle>>;
  importRecipientReferences(
    secret: string,
    bundle: unknown
  ): Promise<RecipientImportResult>;
}

interface StoredFileRecord extends FileMetadata {
  encryptedKey: EncryptedData;
  contentType: FileContentType;
}

interface StoredTimelineRow {
  eventHash: string;
  type: EventType;
  filename: string;
  timestamp: number;
  hasExplicitTimestamp: boolean;
  sequence: number;
  toFilename?: string;
  blobHash?: string;
  encryptedKey?: EncryptedData;
  contentType?: FileContentType;
  size?: number;
  mimeType?: string;
  createdAt?: number;
  deletedAt?: number;
  renamedAt?: number;
  publishedAt?: number;
  authorPublicKey?: string;
  displayName?: string;
  body?: string;
  attachmentName?: string;
  summary?: string;
  record?: IdentityRecord;
  message?: ChatMessage;
}

/**
 * Creates a dependency-injected file service for testing or custom storage.
 * @param dependencies - Crypto, storage, and optional path mapper/time source
 * @returns File service implementation
 */
export function createFileService(dependencies: FileServiceDependencies): FileService {
  const pathMapper = dependencies.pathMapper ?? defaultPathMapper;
  const channelStorage = new ChannelStorage(dependencies.storage, pathMapper);
  const now = dependencies.now ?? (() => Date.now());

  return {
    addFile: async (secret, filename, data, mimeType) =>
      addFileWithDeps(
        secret,
        filename,
        data,
        mimeType,
        dependencies.crypto,
        dependencies.storage,
        channelStorage,
        pathMapper,
        now
      ),
    deleteFile: async (secret, filename) =>
      deleteFileWithDeps(
        secret,
        filename,
        dependencies.crypto,
        dependencies.storage,
        channelStorage,
        pathMapper,
        now
      ),
    listFiles: async (secret) =>
      listFilesWithDeps(secret, dependencies.crypto, dependencies.storage, channelStorage, pathMapper),
    getFile: async (secret, blobHash) =>
      getFileWithDeps(
        secret,
        blobHash,
        dependencies.crypto,
        dependencies.storage,
        channelStorage,
        pathMapper
      ),
    renameFile: async (secret, fromName, toName) =>
      renameFileWithDeps(
        secret,
        fromName,
        toName,
        dependencies.crypto,
        dependencies.storage,
        channelStorage,
        pathMapper,
        now
      ),
    renameFolder: async (secret, fromFolder, toFolder, options) =>
      renameFolderWithDeps(
        secret,
        fromFolder,
        toFolder,
        options?.merge ?? false,
        dependencies.crypto,
        dependencies.storage,
        channelStorage,
        pathMapper,
        now
      ),
    computeSnapshot: async (secret) =>
      computeSnapshotWithDeps(
        secret,
        dependencies.crypto,
        dependencies.storage,
        channelStorage,
        pathMapper,
        now
      ),
    getTimeline: async (secret) =>
      getTimelineWithDeps(secret, dependencies.crypto, dependencies.storage, channelStorage, pathMapper),
    exportSourceReferences: async (secret, filenames) =>
      exportSourceReferencesWithDeps(
        secret,
        filenames,
        dependencies.crypto,
        dependencies.storage,
        channelStorage,
        pathMapper,
        now
      ),
    importSourceReferences: async (destinationSecret, bundle, sourceSecret) =>
      importSourceReferencesWithDeps(
        destinationSecret,
        bundle,
        sourceSecret,
        dependencies.crypto,
        dependencies.storage,
        channelStorage,
        pathMapper,
        now
      ),
    exportRecipientReferences: async (secret, filenames, recipientVolumeId) =>
      exportRecipientReferencesWithDeps(
        secret,
        filenames,
        recipientVolumeId,
        dependencies.crypto,
        dependencies.storage,
        channelStorage,
        pathMapper,
        now
      ),
    importRecipientReferences: async (secret, bundle) =>
      importRecipientReferencesWithDeps(
        secret,
        bundle,
        dependencies.crypto,
        dependencies.storage,
        channelStorage,
        pathMapper,
        now
      ),
  };
}

/**
 * Adds a file to the secret-derived channel.
 * @param secret - Channel secret used for deterministic key derivation
 * @param filename - Logical filename within the channel
 * @param data - Plaintext file contents
 * @param mimeType - Optional MIME type
 * @returns File metadata for the created file
 */
export async function addFile(
  secret: string,
  filename: string,
  data: Buffer,
  mimeType?: string
): Promise<FileMetadata> {
  const service = getDefaultFileService();
  return service.addFile(secret, filename, data, mimeType);
}

/**
 * Appends a delete event for a file in the secret-derived channel.
 * @param secret - Channel secret used for deterministic key derivation
 * @param filename - Logical filename to delete
 */
export async function deleteFile(secret: string, filename: string): Promise<void> {
  const service = getDefaultFileService();
  return service.deleteFile(secret, filename);
}

/**
 * Lists the current file set by replaying the channel event log.
 * @param secret - Channel secret used for deterministic key derivation
 * @returns Array of file metadata sorted by creation time
 */
export async function listFiles(secret: string): Promise<FileMetadata[]> {
  const service = getDefaultFileService();
  return service.listFiles(secret);
}

/**
 * Retrieves and decrypts a file blob by its encrypted blob hash.
 * @param secret - Channel secret used for deterministic key derivation
 * @param blobHash - Hash of the encrypted blob to retrieve
 * @returns Decrypted file contents
 */
export async function getFile(secret: string, blobHash: string): Promise<Buffer> {
  const service = getDefaultFileService();
  return service.getFile(secret, blobHash);
}

export async function renameFile(
  secret: string,
  fromName: string,
  toName: string
): Promise<RenameFileSummary> {
  const service = getDefaultFileService();
  return service.renameFile(secret, fromName, toName);
}

/**
 * Renames a virtual folder by replaying metadata events for every file under it.
 */
export async function renameFolder(
  secret: string,
  fromFolder: string,
  toFolder: string,
  options?: { merge?: boolean }
): Promise<RenameFolderSummary> {
  const service = getDefaultFileService();
  return service.renameFolder(secret, fromFolder, toFolder, options);
}

/**
 * Computes and persists a point-in-time snapshot of the current volume state.
 * Snapshot generation is explicit (on-demand) and never automatic.
 */
export async function computeSnapshot(secret: string): Promise<SnapshotSummary> {
  const service = getDefaultFileService();
  return service.computeSnapshot(secret);
}

/**
 * Returns a deterministic, chronological timeline of all volume events.
 */
export async function getTimeline(secret: string): Promise<TimelineEvent[]> {
  const service = getDefaultFileService();
  return service.getTimeline(secret);
}

export async function exportSourceReferences(
  secret: string,
  filenames: string[]
): Promise<ReferenceExportResult<SourceReferenceBundle>> {
  const service = getDefaultFileService();
  return service.exportSourceReferences(secret, filenames);
}

export async function importSourceReferences(
  destinationSecret: string,
  bundle: unknown,
  sourceSecret: string
): Promise<SourceImportResult> {
  const service = getDefaultFileService();
  return service.importSourceReferences(destinationSecret, bundle, sourceSecret);
}

export async function exportRecipientReferences(
  secret: string,
  filenames: string[],
  recipientVolumeId: string
): Promise<ReferenceExportResult<RecipientReferenceBundle>> {
  const service = getDefaultFileService();
  return service.exportRecipientReferences(secret, filenames, recipientVolumeId);
}

export async function importRecipientReferences(
  secret: string,
  bundle: unknown
): Promise<RecipientImportResult> {
  const service = getDefaultFileService();
  return service.importRecipientReferences(secret, bundle);
}

function getDefaultFileService(): FileService {
  if (!defaultFileService) {
    const storageDir = getDefaultStorageDir();
    defaultFileService = createFileService({
      crypto: createCryptoOperations(),
      storage: new FilesystemStorageBackend(storageDir),
      pathMapper: defaultPathMapper,
    });
  }
  return defaultFileService;
}

let defaultFileService: FileService | null = null;

async function addFileWithDeps(
  secret: string,
  filename: string,
  data: Buffer,
  mimeType: string | undefined,
  crypto: CryptoOperations,
  storage: StorageBackend,
  channelStorage: ChannelStorage,
  pathMapper: ChannelPathMapper,
  now: () => number
): Promise<FileMetadata> {
  assertNonEmptyFilename(filename);
  const normalizedSecret = normalizeSecret(secret);
  await openVolume(normalizedSecret, crypto, storage, pathMapper);

  const keyPair = await crypto.deriveKeys(normalizedSecret);
  const encrypted = await encryptFileForVolume(crypto, keyPair.privateKey, data);
  await channelStorage.storeEncryptedData(
    encrypted.blobHash,
    encrypted.encryptedData,
    true,
    keyPair.publicKey
  );

  const createdAt = now();
  await appendCreateEvent(channelStorage, crypto, keyPair, {
    filename,
    blobHash: encrypted.blobHash,
    encryptedKey: encrypted.encryptedKey,
    contentType: encrypted.contentType,
    size: data.length,
    mimeType,
    createdAt,
  });

  return {
    filename,
    blobHash: encrypted.blobHash,
    contentType: encrypted.contentType,
    size: data.length,
    mimeType,
    createdAt,
  };
}

async function deleteFileWithDeps(
  secret: string,
  filename: string,
  crypto: CryptoOperations,
  storage: StorageBackend,
  channelStorage: ChannelStorage,
  pathMapper: ChannelPathMapper,
  now: () => number
): Promise<void> {
  assertNonEmptyFilename(filename);
  const normalizedSecret = normalizeSecret(secret);
  await openVolume(normalizedSecret, crypto, storage, pathMapper);

  const keyPair = await crypto.deriveKeys(normalizedSecret);
  const deletedAt = now();
  await appendDeleteEvent(channelStorage, crypto, keyPair, filename, deletedAt);
}

async function renameFolderWithDeps(
  secret: string,
  fromFolder: string,
  toFolder: string,
  merge: boolean,
  crypto: CryptoOperations,
  storage: StorageBackend,
  channelStorage: ChannelStorage,
  pathMapper: ChannelPathMapper,
  now: () => number
): Promise<RenameFolderSummary> {
  const normalizedFrom = normalizeFolderPath(fromFolder);
  const normalizedTo = normalizeFolderPath(toFolder);
  if (normalizedFrom.length === 0 || normalizedTo.length === 0) {
    throw new Error('Folder names are required');
  }
  if (normalizedFrom === normalizedTo) {
    throw new Error('Source and destination folders are the same');
  }

  const normalizedSecret = normalizeSecret(secret);
  const volume = await openVolume(normalizedSecret, crypto, storage, pathMapper);
  const entries = await loadEventLog(volume, channelStorage);
  await verifyEventLog(entries, volume, crypto);

  const files = materializeFilesFromEntries(entries);
  const sourceFiles = files.filter((file) => file.filename.startsWith(`${normalizedFrom}/`));
  if (sourceFiles.length === 0) {
    throw new Error(`Folder "${normalizedFrom}" is empty or does not exist`);
  }

  const existingByName = new Map<string, FileMetadata>(files.map((file) => [file.filename, file]));
  const sourceNameSet = new Set(sourceFiles.map((file) => file.filename));

  const plan = sourceFiles
    .map((file) => ({
      fromName: file.filename,
      toName: `${normalizedTo}/${file.filename.slice(normalizedFrom.length + 1)}`,
      file,
    }))
    .sort((left, right) => left.fromName.localeCompare(right.fromName));

  const duplicateTargets = new Set<string>();
  const targetSet = new Set<string>();
  for (const item of plan) {
    if (targetSet.has(item.toName)) {
      duplicateTargets.add(item.toName);
      continue;
    }
    targetSet.add(item.toName);
  }
  if (duplicateTargets.size > 0) {
    throw new Error('Rename would produce duplicate target paths');
  }

  const conflicts = plan.filter((item) => {
    const existing = existingByName.get(item.toName);
    if (!existing) return false;
    return !sourceNameSet.has(item.toName);
  });

  if (conflicts.length > 0 && !merge) {
    throw new Error(
      `Destination folder already contains ${conflicts.length} file(s). Retry with merge enabled.`
    );
  }

  const timeline = mapEntriesToTimeline(entries);
  const maxTimestamp = timeline.reduce((max, event) => Math.max(max, event.timestamp), 0);
  const baseTimestamp = Math.max(now(), maxTimestamp + 1);
  const keyPair = await crypto.deriveKeys(normalizedSecret);

  let cursor = baseTimestamp;
  for (const item of plan) {
    await appendRenameEvent(channelStorage, crypto, keyPair, item.fromName, item.toName, cursor);
    cursor += 1;
  }

  return {
    fromFolder: normalizedFrom,
    toFolder: normalizedTo,
    movedFiles: plan.length,
    mergedConflicts: conflicts.length,
  };
}

async function renameFileWithDeps(
  secret: string,
  fromName: string,
  toName: string,
  crypto: CryptoOperations,
  storage: StorageBackend,
  channelStorage: ChannelStorage,
  pathMapper: ChannelPathMapper,
  now: () => number
): Promise<RenameFileSummary> {
  assertNonEmptyFilename(fromName);
  assertNonEmptyFilename(toName);
  if (fromName === toName) {
    throw new Error('Source and destination file names are the same');
  }

  const normalizedSecret = normalizeSecret(secret);
  const volume = await openVolume(normalizedSecret, crypto, storage, pathMapper);
  const entries = await loadEventLog(volume, channelStorage);
  await verifyEventLog(entries, volume, crypto);

  const files = materializeFilesFromEntries(entries);
  if (!files.some((file) => file.filename === fromName)) {
    throw new Error(`File "${fromName}" does not exist`);
  }
  if (files.some((file) => file.filename === toName)) {
    throw new Error(`File "${toName}" already exists`);
  }

  const timeline = mapEntriesToTimeline(entries);
  const maxTimestamp = timeline.reduce((max, event) => Math.max(max, event.timestamp), 0);
  const renamedAt = Math.max(now(), maxTimestamp + 1);
  const keyPair = await crypto.deriveKeys(normalizedSecret);

  await appendRenameEvent(channelStorage, crypto, keyPair, fromName, toName, renamedAt);

  return {
    fromName,
    toName,
  };
}

async function listFilesWithDeps(
  secret: string,
  crypto: CryptoOperations,
  storage: StorageBackend,
  channelStorage: ChannelStorage,
  pathMapper: ChannelPathMapper
): Promise<FileMetadata[]> {
  const volume = await openVolume(normalizeSecret(secret), crypto, storage, pathMapper);
  const entries = await loadEventLog(volume, channelStorage);
  await verifyEventLog(entries, volume, crypto);
  return materializeFilesFromEntries(entries);
}

async function getFileWithDeps(
  secret: string,
  blobHash: string,
  crypto: CryptoOperations,
  storage: StorageBackend,
  channelStorage: ChannelStorage,
  pathMapper: ChannelPathMapper
): Promise<Buffer> {
  const normalizedSecret = normalizeSecret(secret);
  const volume = await openVolume(normalizedSecret, crypto, storage, pathMapper);
  const entries = await loadEventLog(volume, channelStorage);
  await verifyEventLog(entries, volume, crypto);

  const currentFile = materializeStoredFilesFromEntries(entries).find((file) => file.blobHash === blobHash);
  if (!currentFile) {
    throw new DecryptionError('File is not available in the active volume');
  }

  const keyPair = await crypto.deriveKeys(normalizedSecret);
  const encryptedData = await channelStorage.retrieveEncryptedData(blobHash as Hash, keyPair.publicKey);
  const plaintext = await decryptFileForVolume(
    crypto,
    keyPair.privateKey,
    encryptedData,
    currentFile.encryptedKey
  );
  return Buffer.from(plaintext);
}

async function computeSnapshotWithDeps(
  secret: string,
  crypto: CryptoOperations,
  storage: StorageBackend,
  channelStorage: ChannelStorage,
  pathMapper: ChannelPathMapper,
  now: () => number
): Promise<SnapshotSummary> {
  const volume = await openVolume(normalizeSecret(secret), crypto, storage, pathMapper);
  const entries = await loadEventLog(volume, channelStorage);
  await verifyEventLog(entries, volume, crypto);

  const snapshot: StoredVolumeSnapshot = {
    version: SNAPSHOT_VERSION,
    generatedAt: now(),
    eventCount: entries.length,
    lastEventHash: entries.length > 0 ? entries[entries.length - 1].eventHash : null,
    files: materializeFilesFromEntries(entries),
  };

  const snapshotPath = `${volume.path}/${SNAPSHOT_FILE_NAME}`;
  const snapshotBytes = new TextEncoder().encode(JSON.stringify(snapshot));
  await storage.writeFile(snapshotPath, snapshotBytes);

  return {
    generatedAt: snapshot.generatedAt,
    eventCount: snapshot.eventCount,
    fileCount: snapshot.files.length,
    lastEventHash: snapshot.lastEventHash,
  };
}

async function getTimelineWithDeps(
  secret: string,
  crypto: CryptoOperations,
  storage: StorageBackend,
  channelStorage: ChannelStorage,
  pathMapper: ChannelPathMapper
): Promise<TimelineEvent[]> {
  const volume = await openVolume(normalizeSecret(secret), crypto, storage, pathMapper);
  const entries = await loadEventLog(volume, channelStorage);
  await verifyEventLog(entries, volume, crypto);
  return mapEntriesToTimeline(entries);
}

async function exportSourceReferencesWithDeps(
  secret: string,
  filenames: string[],
  crypto: CryptoOperations,
  storage: StorageBackend,
  channelStorage: ChannelStorage,
  pathMapper: ChannelPathMapper,
  now: () => number
): Promise<ReferenceExportResult<SourceReferenceBundle>> {
  const normalizedSecret = normalizeSecret(secret);
  const orderedFilenames = dedupeOrderedFilenames(filenames);
  if (orderedFilenames.length === 0) {
    throw new Error('At least one filename is required');
  }

  const volume = await openVolume(normalizedSecret, crypto, storage, pathMapper);
  const keyPair = await crypto.deriveKeys(normalizedSecret);
  let { files } = await loadVolumeFiles(crypto, channelStorage, volume);
  let upgradedCount = 0;

  upgradedCount += await upgradeLegacyFilesForExport(
    orderedFilenames,
    files,
    keyPair,
    crypto,
    channelStorage,
    now
  );
  if (upgradedCount > 0) {
    ({ files } = await loadVolumeFiles(crypto, channelStorage, volume));
  }

  const fileMap = new Map(files.map((file) => [file.filename, file]));
  const bundle: SourceReferenceBundle = {
    p: 'nb.src.refs.v1',
    s: volumeIdFromPublicKey(keyPair.publicKey),
    items: orderedFilenames.map((filename) => {
      const file = requireStoredFile(fileMap, filename);
      return {
        name: file.filename,
        mime: file.mimeType,
        createdAt: file.createdAt,
        ref: {
          p: 'nb.src.ref.v1',
          s: volumeIdFromPublicKey(keyPair.publicKey),
          c: {
            t: file.contentType,
            h: file.blobHash,
            z: file.size,
          },
          x: encodeWrappedKey(file.encryptedKey),
        },
      };
    }),
  };

  return {
    bundle,
    serialized: serializeSourceReferenceBundle(bundle),
    upgradedCount,
  };
}

async function importSourceReferencesWithDeps(
  destinationSecret: string,
  bundleValue: unknown,
  sourceSecret: string,
  crypto: CryptoOperations,
  storage: StorageBackend,
  channelStorage: ChannelStorage,
  pathMapper: ChannelPathMapper,
  now: () => number
): Promise<SourceImportResult> {
  const bundle = parseSourceReferenceBundle(bundleValue);
  const normalizedDestinationSecret = normalizeSecret(destinationSecret);
  const normalizedSourceSecret = normalizeSecret(sourceSecret);
  const destinationKeyPair = await crypto.deriveKeys(normalizedDestinationSecret);
  const sourceKeyPair = await crypto.deriveKeys(normalizedSourceSecret);
  const sourceVolumeId = volumeIdFromPublicKey(sourceKeyPair.publicKey);
  if (bundle.s !== sourceVolumeId) {
    throw new Error('Source reference bundle does not match the provided source volume');
  }

  const destinationVolume = await openVolume(normalizedDestinationSecret, crypto, storage, pathMapper);
  const { entries, files } = await loadVolumeFiles(crypto, channelStorage, destinationVolume);
  const imported = await importSourceBundleItems(
    bundle,
    files,
    entries,
    destinationKeyPair,
    sourceKeyPair,
    crypto,
    storage,
    channelStorage,
    now
  );

  return { imported };
}

async function exportRecipientReferencesWithDeps(
  secret: string,
  filenames: string[],
  recipientVolumeId: string,
  crypto: CryptoOperations,
  storage: StorageBackend,
  channelStorage: ChannelStorage,
  pathMapper: ChannelPathMapper,
  now: () => number
): Promise<ReferenceExportResult<RecipientReferenceBundle>> {
  const normalizedSecret = normalizeSecret(secret);
  const orderedFilenames = dedupeOrderedFilenames(filenames);
  if (orderedFilenames.length === 0) {
    throw new Error('At least one filename is required');
  }

  publicKeyFromVolumeId(recipientVolumeId);

  const volume = await openVolume(normalizedSecret, crypto, storage, pathMapper);
  const keyPair = await crypto.deriveKeys(normalizedSecret);
  let { files } = await loadVolumeFiles(crypto, channelStorage, volume);
  let upgradedCount = 0;

  upgradedCount += await upgradeLegacyFilesForExport(
    orderedFilenames,
    files,
    keyPair,
    crypto,
    channelStorage,
    now
  );
  if (upgradedCount > 0) {
    ({ files } = await loadVolumeFiles(crypto, channelStorage, volume));
  }

  const fileMap = new Map(files.map((file) => [file.filename, file]));
  const items: RecipientReferenceBundle['items'] = [];
  for (const filename of orderedFilenames) {
    const file = requireStoredFile(fileMap, filename);
    const fileKey = await unwrapFileKeyForVolume(crypto, keyPair.privateKey, file.encryptedKey);
    const capsule = await createRecipientKeyCapsule(
      fileKey,
      recipientVolumeId,
      {
        t: file.contentType,
        h: file.blobHash,
        z: file.size,
      }
    );
    items.push({
      name: file.filename,
      mime: file.mimeType,
      createdAt: file.createdAt,
      ref: {
        p: 'nb.ref.v1',
        c: {
          t: file.contentType,
          h: file.blobHash,
          z: file.size,
        },
        k: {
          r: capsule.recipientVolumeId,
          e: capsule.ephemeralPublicKey,
          n: capsule.nonce,
          w: capsule.wrappedKey,
        },
      },
    });
  }

  const bundle: RecipientReferenceBundle = {
    p: 'nb.refs.v1',
    r: recipientVolumeId.toLowerCase(),
    items,
  };

  return {
    bundle,
    serialized: serializeRecipientReferenceBundle(bundle),
    upgradedCount,
  };
}

async function importRecipientReferencesWithDeps(
  secret: string,
  bundleValue: unknown,
  crypto: CryptoOperations,
  storage: StorageBackend,
  channelStorage: ChannelStorage,
  pathMapper: ChannelPathMapper,
  now: () => number
): Promise<RecipientImportResult> {
  const bundle = parseRecipientReferenceBundle(bundleValue);
  const normalizedSecret = normalizeSecret(secret);
  const destinationKeyPair = await crypto.deriveKeys(normalizedSecret);
  const activeVolumeId = volumeIdFromPublicKey(destinationKeyPair.publicKey);
  if (bundle.r !== activeVolumeId) {
    throw new Error('Recipient reference bundle does not match the active volume');
  }

  const destinationVolume = await openVolume(normalizedSecret, crypto, storage, pathMapper);
  const { entries, files } = await loadVolumeFiles(crypto, channelStorage, destinationVolume);
  const takenNames = new Set(files.map((file) => file.filename));
  const imported: FileMetadata[] = [];
  let nextTimestamp = nextCreateTimestamp(entries, now());

  for (const item of bundle.items) {
    const finalName = resolveImportedFilename(item.name, takenNames);
    takenNames.add(finalName);

    const descriptor = item.ref.c;
    const fileKey = await unwrapRecipientKeyCapsule(
      destinationKeyPair.privateKey,
      activeVolumeId,
      descriptor,
      item.ref.k
    );
    await ensureDestinationBlockAvailable(storage, channelStorage, descriptor.h, destinationKeyPair.publicKey);
    const encryptedKey = await wrapFileKeyForVolume(crypto, destinationKeyPair.privateKey, fileKey);
    const createdAt = resolveImportedCreatedAt(item.createdAt, nextTimestamp);

    await appendCreateEvent(channelStorage, crypto, destinationKeyPair, {
      filename: finalName,
      blobHash: descriptor.h,
      encryptedKey,
      contentType: descriptor.t,
      size: descriptor.z,
      mimeType: item.mime,
      createdAt,
    });

    imported.push({
      filename: finalName,
      blobHash: descriptor.h,
      contentType: descriptor.t,
      size: descriptor.z,
      mimeType: item.mime,
      createdAt,
    });
    nextTimestamp = createdAt + 1;
  }

  return { imported };
}

function materializeFilesFromEntries(entries: EventLogEntry[]): FileMetadata[] {
  const files = materializeStoredFilesFromEntries(entries).map((file) => ({
    filename: file.filename,
    blobHash: file.blobHash,
    contentType: file.contentType,
    size: file.size,
    mimeType: file.mimeType,
    createdAt: file.createdAt,
  }));
  files.sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
    if (a.filename < b.filename) return -1;
    if (a.filename > b.filename) return 1;
    return 0;
  });
  return files;
}

function mapEntriesToTimeline(entries: EventLogEntry[]): TimelineEvent[] {
  return buildTimelineRows(entries).map((row) => ({
    eventHash: row.eventHash,
    type: row.type,
    filename: row.filename,
    timestamp: row.timestamp,
    toFilename: row.toFilename,
    blobHash: row.blobHash,
    contentType: row.contentType,
    size: row.size,
    mimeType: row.mimeType,
    createdAt: row.createdAt,
    deletedAt: row.deletedAt,
    renamedAt: row.renamedAt,
    publishedAt: row.publishedAt,
    authorPublicKey: row.authorPublicKey,
    displayName: row.displayName,
    body: row.body,
    attachmentName: row.attachmentName,
    summary: row.summary,
    record: row.record,
    message: row.message,
  }));
}

function materializeStoredFilesFromEntries(entries: EventLogEntry[]): StoredFileRecord[] {
  const files = new Map<string, StoredFileRecord>();

  for (const row of buildTimelineRows(entries)) {
    if (row.type === 'CREATE_FILE') {
      if (
        row.blobHash === undefined ||
        row.encryptedKey === undefined ||
        row.size === undefined ||
        row.createdAt === undefined
      ) {
        continue;
      }
      files.set(row.filename, {
        filename: row.filename,
        blobHash: row.blobHash,
        encryptedKey: row.encryptedKey,
        contentType: row.contentType ?? 'b',
        size: row.size,
        mimeType: row.mimeType,
        createdAt: row.createdAt,
      });
      continue;
    }

    if (row.type === 'DELETE_FILE') {
      files.delete(row.filename);
      continue;
    }

    if (!row.toFilename) {
      continue;
    }

    const existing = files.get(row.filename);
    if (!existing) {
      continue;
    }
    files.delete(row.filename);
    files.set(row.toFilename, {
      ...existing,
      filename: row.toFilename,
    });
  }

  return Array.from(files.values()).sort((left, right) => {
    if (left.createdAt !== right.createdAt) return left.createdAt - right.createdAt;
    return left.filename.localeCompare(right.filename);
  });
}

function buildTimelineRows(entries: EventLogEntry[]): StoredTimelineRow[] {
  const rows: StoredTimelineRow[] = [];

  for (let sequence = 0; sequence < entries.length; sequence += 1) {
    const entry = entries[sequence];
    const payload = entry.signedEvent.payload;

    if (payload.type === EventType.CREATE_FILE) {
      const inferredTimestamp = payload.createdAt ?? sequence;
      rows.push({
        eventHash: entry.eventHash,
        type: EventType.CREATE_FILE,
        filename: payload.fileName,
        timestamp: inferredTimestamp,
        hasExplicitTimestamp: payload.createdAt !== undefined,
        sequence,
        blobHash: payload.hash,
        encryptedKey: payload.encryptedKey,
        contentType: payload.contentType ?? 'b',
        size: payload.size ?? 0,
        mimeType: payload.mimeType,
        createdAt: inferredTimestamp,
      });
      continue;
    }

    if (payload.type === EventType.DELETE_FILE) {
      const inferredTimestamp = payload.deletedAt ?? sequence;
      rows.push({
        eventHash: entry.eventHash,
        type: EventType.DELETE_FILE,
        filename: payload.fileName,
        timestamp: inferredTimestamp,
        hasExplicitTimestamp: payload.deletedAt !== undefined,
        sequence,
        deletedAt: inferredTimestamp,
      });
      continue;
    }

    if (payload.type === EventType.RENAME_FILE) {
      const inferredTimestamp = payload.renamedAt ?? sequence;
      rows.push({
        eventHash: entry.eventHash,
        type: EventType.RENAME_FILE,
        filename: payload.fileName,
        timestamp: inferredTimestamp,
        hasExplicitTimestamp: payload.renamedAt !== undefined,
        sequence,
        toFilename: payload.toFileName,
        renamedAt: inferredTimestamp,
      });
      continue;
    }

    if (payload.type === EventType.DECLARE_IDENTITY) {
      const inferredTimestamp = payload.publishedAt ?? sequence;
      const identityRecord = payload.record ? parseIdentityRecordJson(payload.record) : null;
      const displayName = identityRecord?.profile.displayName;
      rows.push({
        eventHash: entry.eventHash,
        type: EventType.DECLARE_IDENTITY,
        filename: '',
        timestamp: inferredTimestamp,
        hasExplicitTimestamp: payload.publishedAt !== undefined,
        sequence,
        publishedAt: inferredTimestamp,
        authorPublicKey: payload.authorPublicKey,
        displayName,
        summary: displayName ? `Published ${displayName}` : 'Published identity',
        record: identityRecord ?? undefined,
      });
      continue;
    }

    if (payload.type === EventType.CHAT_MESSAGE) {
      const inferredTimestamp = payload.publishedAt ?? sequence;
      const chatMessage = payload.message ? parseChatMessageJson(payload.message) : null;
      const body = timelineSnippet(chatMessage?.body);
      const attachmentName = chatMessage?.attachment?.name;
      rows.push({
        eventHash: entry.eventHash,
        type: EventType.CHAT_MESSAGE,
        filename: '',
        timestamp: inferredTimestamp,
        hasExplicitTimestamp: payload.publishedAt !== undefined,
        sequence,
        publishedAt: inferredTimestamp,
        authorPublicKey: payload.authorPublicKey,
        body,
        attachmentName,
        summary: body ?? attachmentName ?? 'Attachment message',
        message: chatMessage ?? undefined,
      });
      continue;
    }

    if (
      payload.type === EventType.APP_RECORD &&
      payload.authorPublicKey &&
      payload.publishedAt !== undefined &&
      payload.protocol &&
      payload.record
    ) {
      const inferredTimestamp = payload.publishedAt ?? sequence;

      if (payload.protocol === 'nb.identity.record.v1') {
        const identityRecord = parseIdentityRecordJson(payload.record);
        const displayName = identityRecord?.profile.displayName;
        rows.push({
          eventHash: entry.eventHash,
          type: EventType.DECLARE_IDENTITY,
          filename: '',
          timestamp: inferredTimestamp,
          hasExplicitTimestamp: true,
          sequence,
          publishedAt: inferredTimestamp,
          authorPublicKey: payload.authorPublicKey,
          displayName,
          summary: displayName ? `Published ${displayName}` : 'Published identity',
          record: identityRecord ?? undefined,
        });
        continue;
      }

      if (payload.protocol === 'nb.identity.snapshot.v1') {
        const snapshot = parseIdentitySnapshotJson(payload.record);
        const identityRecord = snapshot?.record;
        const displayName = identityRecord?.profile.displayName;
        rows.push({
          eventHash: entry.eventHash,
          type: EventType.DECLARE_IDENTITY,
          filename: '',
          timestamp: inferredTimestamp,
          hasExplicitTimestamp: true,
          sequence,
          publishedAt: inferredTimestamp,
          authorPublicKey: payload.authorPublicKey,
          displayName,
          summary: displayName ? `Synced ${displayName}` : 'Synced identity',
          record: identityRecord ?? undefined,
        });
        continue;
      }

      if (payload.protocol === 'nb.chat.message.v1') {
        const chatMessage = parseChatMessageJson(payload.record);
        const body = timelineSnippet(chatMessage?.body);
        const attachmentName = chatMessage?.attachment?.name;
        rows.push({
          eventHash: entry.eventHash,
          type: EventType.CHAT_MESSAGE,
          filename: '',
          timestamp: inferredTimestamp,
          hasExplicitTimestamp: true,
          sequence,
          publishedAt: inferredTimestamp,
          authorPublicKey: payload.authorPublicKey,
          body,
          attachmentName,
          summary: body ?? attachmentName ?? 'Attachment message',
          message: chatMessage ?? undefined,
        });
      }
    }
  }

  rows.sort(compareTimelineRows);
  return rows;
}

async function loadVolumeFiles(
  crypto: CryptoOperations,
  channelStorage: ChannelStorage,
  volume: Awaited<ReturnType<typeof openVolume>>
): Promise<{ entries: EventLogEntry[]; files: StoredFileRecord[] }> {
  const entries = await loadEventLog(volume, channelStorage);
  await verifyEventLog(entries, volume, crypto);
  return {
    entries,
    files: materializeStoredFilesFromEntries(entries),
  };
}

async function upgradeLegacyFilesForExport(
  filenames: readonly string[],
  files: readonly StoredFileRecord[],
  keyPair: KeyPair,
  crypto: CryptoOperations,
  channelStorage: ChannelStorage,
  now: () => number
): Promise<number> {
  const fileMap = new Map(files.map((file) => [file.filename, file]));
  let upgradedCount = 0;
  let timestamp = Math.max(
    now(),
    ...files.map((file) => file.createdAt + 1),
    0
  );

  for (const filename of filenames) {
    const file = requireStoredFile(fileMap, filename);
    if (file.encryptedKey.length > 0) {
      continue;
    }

    const encryptedData = await channelStorage.retrieveEncryptedData(file.blobHash as Hash, keyPair.publicKey);
    const plaintext = await decryptFileForVolume(crypto, keyPair.privateKey, encryptedData, file.encryptedKey);
    const encrypted = await encryptFileForVolume(crypto, keyPair.privateKey, plaintext);
    await channelStorage.storeEncryptedData(
      encrypted.blobHash,
      encrypted.encryptedData,
      true,
      keyPair.publicKey
    );
    await appendCreateEvent(channelStorage, crypto, keyPair, {
      filename: file.filename,
      blobHash: encrypted.blobHash,
      encryptedKey: encrypted.encryptedKey,
      contentType: encrypted.contentType,
      size: file.size,
      mimeType: file.mimeType,
      createdAt: timestamp,
    });

    upgradedCount += 1;
    timestamp += 1;
  }

  return upgradedCount;
}

async function importSourceBundleItems(
  bundle: SourceReferenceBundle,
  existingFiles: readonly StoredFileRecord[],
  entries: readonly EventLogEntry[],
  destinationKeyPair: KeyPair,
  sourceKeyPair: KeyPair,
  crypto: CryptoOperations,
  storage: StorageBackend,
  channelStorage: ChannelStorage,
  now: () => number
): Promise<FileMetadata[]> {
  const takenNames = new Set(existingFiles.map((file) => file.filename));
  const imported: FileMetadata[] = [];
  let nextTimestamp = nextCreateTimestamp(entries, now());

  for (const item of bundle.items) {
    const finalName = resolveImportedFilename(item.name, takenNames);
    takenNames.add(finalName);

    const fileKey = await unwrapFileKeyForVolume(
      crypto,
      sourceKeyPair.privateKey,
      decodeWrappedKey(item.ref.x, 'Source reference wrapped key')
    );
    await ensureDestinationBlockAvailable(storage, channelStorage, item.ref.c.h, destinationKeyPair.publicKey);
    const encryptedKey = await wrapFileKeyForVolume(crypto, destinationKeyPair.privateKey, fileKey);
    const createdAt = resolveImportedCreatedAt(item.createdAt, nextTimestamp);

    await appendCreateEvent(channelStorage, crypto, destinationKeyPair, {
      filename: finalName,
      blobHash: item.ref.c.h,
      encryptedKey,
      contentType: item.ref.c.t,
      size: item.ref.c.z,
      mimeType: item.mime,
      createdAt,
    });

    imported.push({
      filename: finalName,
      blobHash: item.ref.c.h,
      contentType: item.ref.c.t,
      size: item.ref.c.z,
      mimeType: item.mime,
      createdAt,
    });
    nextTimestamp = createdAt + 1;
  }

  return imported;
}

async function ensureDestinationBlockAvailable(
  storage: StorageBackend,
  channelStorage: ChannelStorage,
  blobHash: string,
  destinationPublicKey: KeyPair['publicKey']
): Promise<void> {
  const dataPath = `blocks/${blobHash}.bin`;
  const encryptedData = await storage.readFile(dataPath);
  await channelStorage.storeEncryptedData(blobHash as Hash, encryptedData as EncryptedData, false, destinationPublicKey);
}

function nextCreateTimestamp(entries: readonly EventLogEntry[], fallbackNow: number): number {
  const timeline = mapEntriesToTimeline([...entries]);
  const maxTimestamp = timeline.reduce((max, event) => Math.max(max, event.timestamp), 0);
  return Math.max(fallbackNow, maxTimestamp + 1);
}

function resolveImportedCreatedAt(
  preferredCreatedAt: number | undefined,
  minimumCreatedAt: number
): number {
  if (preferredCreatedAt === undefined) {
    return minimumCreatedAt;
  }
  return Math.max(preferredCreatedAt, minimumCreatedAt);
}

function requireStoredFile(
  files: ReadonlyMap<string, StoredFileRecord>,
  filename: string
): StoredFileRecord {
  const file = files.get(filename);
  if (!file) {
    throw new Error(`File "${filename}" does not exist`);
  }
  return file;
}

function compareTimelineRows(
  left: StoredTimelineRow,
  right: StoredTimelineRow
): number {
  if (left.hasExplicitTimestamp !== right.hasExplicitTimestamp) {
    return left.sequence - right.sequence;
  }

  if (left.hasExplicitTimestamp && right.hasExplicitTimestamp) {
    if (left.timestamp !== right.timestamp) {
      return left.timestamp - right.timestamp;
    }
  } else if (left.sequence !== right.sequence) {
    return left.sequence - right.sequence;
  }

  if (left.filename < right.filename) return -1;
  if (left.filename > right.filename) return 1;

  const leftTie =
    left.type === 'CREATE_FILE'
      ? `C:${left.blobHash ?? ''}`
      : left.type === 'RENAME_FILE'
        ? `R:${left.toFilename ?? ''}`
        : left.type === 'DELETE_FILE'
          ? 'D'
          : left.type === EventType.DECLARE_IDENTITY
            ? `I:${left.displayName ?? left.authorPublicKey ?? ''}`
            : `M:${left.body ?? left.attachmentName ?? left.authorPublicKey ?? ''}`;
  const rightTie =
    right.type === 'CREATE_FILE'
      ? `C:${right.blobHash ?? ''}`
      : right.type === 'RENAME_FILE'
        ? `R:${right.toFilename ?? ''}`
        : right.type === 'DELETE_FILE'
          ? 'D'
          : right.type === EventType.DECLARE_IDENTITY
            ? `I:${right.displayName ?? right.authorPublicKey ?? ''}`
            : `M:${right.body ?? right.attachmentName ?? right.authorPublicKey ?? ''}`;
  if (leftTie < rightTie) return -1;
  if (leftTie > rightTie) return 1;

  if (left.eventHash < right.eventHash) return -1;
  if (left.eventHash > right.eventHash) return 1;
  return 0;
}

function timelineSnippet(value: string | undefined, limit = 72): string | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized === '') {
    return undefined;
  }
  return normalized.length > limit ? `${normalized.slice(0, limit - 1)}…` : normalized;
}

function assertNonEmptyFilename(filename: string): void {
  if (!filename || filename.trim().length === 0) {
    throw new Error('File name cannot be empty');
  }
}

function normalizeFolderPath(folder: string): string {
  return folder
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\/{2,}/g, '/');
}

async function appendCreateEvent(
  channelStorage: ChannelStorage,
  crypto: CryptoOperations,
  keyPair: KeyPair,
  input: {
    filename: string;
    blobHash: string;
    encryptedKey: EncryptedData;
    contentType: FileContentType;
    size: number;
    mimeType?: string;
    createdAt: number;
  }
): Promise<void> {
  const payload: EventPayload = {
    type: EventType.CREATE_FILE,
    fileName: input.filename,
    hash: input.blobHash as Hash,
    encryptedKey: input.encryptedKey,
    contentType: input.contentType,
    size: input.size,
    mimeType: input.mimeType,
    createdAt: input.createdAt,
  };
  const payloadBytes = serializeEventPayload(payload);
  const signature = await crypto.signPR(payloadBytes, keyPair.privateKey);
  await channelStorage.storeEvent(keyPair.publicKey, { payload, signature });
}

async function appendDeleteEvent(
  channelStorage: ChannelStorage,
  crypto: CryptoOperations,
  keyPair: KeyPair,
  filename: string,
  deletedAt: number
): Promise<void> {
  const payload: EventPayload = {
    type: EventType.DELETE_FILE,
    fileName: filename,
    hash: EMPTY_HASH,
    encryptedKey: createEncryptedData(new Uint8Array(0)),
    deletedAt,
  };
  const payloadBytes = serializeEventPayload(payload);
  const signature = await crypto.signPR(payloadBytes, keyPair.privateKey);
  await channelStorage.storeEvent(keyPair.publicKey, { payload, signature });
}

async function appendRenameEvent(
  channelStorage: ChannelStorage,
  crypto: CryptoOperations,
  keyPair: KeyPair,
  fromName: string,
  toName: string,
  renamedAt: number
): Promise<void> {
  const payload: EventPayload = {
    type: EventType.RENAME_FILE,
    fileName: fromName,
    toFileName: toName,
    hash: EMPTY_HASH,
    encryptedKey: createEncryptedData(new Uint8Array(0)),
    renamedAt,
  };
  const payloadBytes = serializeEventPayload(payload);
  const signature = await crypto.signPR(payloadBytes, keyPair.privateKey);
  await channelStorage.storeEvent(keyPair.publicKey, { payload, signature });
}

function normalizeSecret(secret: string): Secret {
  return createSecret(secret);
}
