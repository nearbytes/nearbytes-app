import { openDB, type IDBPDatabase } from 'idb';

import { createCryptoOperations } from '../../../../src/crypto/index.js';
import { createChatService, type ChatService } from '../../../../src/domain/chatService.js';
import { createFileService, type FileService } from '../../../../src/domain/fileService.js';
import { createSecret, type Secret } from '../../../../src/types/keys.js';
import { defaultPathMapper, type StorageBackend } from '../../../../src/types/storage.js';
import type {
  ChatAttachment,
  EventDetailResponse,
  FileMetadata,
  IdentityProfile,
  ListFilesResponse,
  OpenVolumeResponse,
  PublishIdentityResponse,
  ReferenceExportResponse,
  ReferenceImportResponse,
  RecipientReferenceBundle,
  RenameFileResponse,
  RenameFolderResponse,
  SendChatMessageResponse,
  SourceReferenceBundle,
  TimelineEvent,
  TimelineResponse,
  UploadResponse,
  VolumeChatState,
} from '../api.js';
import {
  importCompatibilityEventDetail,
  importCompatibilityTimelineSnapshot,
  importCompatibilityVolumeSnapshot,
} from '../mirror/browserMirror.js';

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
}

const DB_NAME = 'nearbytes-embedded-phone-runtime';
const DB_VERSION = 2;

let dbPromise: Promise<IDBPDatabase | null> | null = null;
let inMemoryStore: InMemoryPathStore | null = null;
let servicesPromise: Promise<EmbeddedPhoneRuntimeServices> | null = null;

function shouldUseIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined';
}

function getInMemoryStore(): InMemoryPathStore {
  if (!inMemoryStore) {
    inMemoryStore = {
      files: new Map(),
      directories: new Set(),
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
  const { fileService } = await getEmbeddedPhoneRuntimeServices();
  const [volumeId, files, timeline] = await Promise.all([
    deriveVolumeId(secret),
    fileService.listFiles(secret),
    fileService.getTimeline(secret) as Promise<TimelineEvent[]>,
  ]);

  await importCompatibilityVolumeSnapshot({ volumeId, files });
  await importCompatibilityTimelineSnapshot({
    volumeId,
    eventCount: timeline.length,
    events: timeline,
  });

  if (eventHash) {
    const detail = await fileService.getEvent(secret, eventHash);
    const response: EventDetailResponse = {
      eventHash: detail.eventHash,
      event: detail.event,
      decryptedPayload: detail.decryptedPayload,
    };
    await importCompatibilityEventDetail(response);
  }

  return {
    volumeId,
    files,
    timeline,
  };
}

export async function embeddedPhoneOpenVolume(secret: string): Promise<OpenVolumeResponse> {
  const { fileService } = await getEmbeddedPhoneRuntimeServices();
  await fileService.listFiles(secret);
  const snapshot = await refreshMirrors(secret);
  return {
    volumeId: snapshot.volumeId,
    fileCount: snapshot.files.length,
    files: snapshot.files,
  };
}

export async function embeddedPhoneListFiles(secret: string): Promise<ListFilesResponse> {
  const snapshot = await refreshMirrors(secret);
  return {
    volumeId: snapshot.volumeId,
    files: snapshot.files,
  };
}

export async function embeddedPhoneGetTimeline(secret: string): Promise<TimelineResponse> {
  const snapshot = await refreshMirrors(secret);
  return {
    volumeId: snapshot.volumeId,
    eventCount: snapshot.timeline.length,
    events: snapshot.timeline,
  };
}

export async function embeddedPhoneGetEventDetail(secret: string, eventHash: string): Promise<EventDetailResponse> {
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
  const { fileService } = await getEmbeddedPhoneRuntimeServices();
  const bytes = await fileService.getFile(secret, blobHash);
  return new Blob([bytes]);
}

export async function embeddedPhoneUploadFile(secret: string, file: File): Promise<UploadResponse> {
  const { fileService } = await getEmbeddedPhoneRuntimeServices();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const created = await fileService.addFile(secret, file.name, bytes as unknown as Buffer, file.type || undefined);
  await refreshMirrors(secret);
  return { created };
}

export async function embeddedPhoneDeleteFile(secret: string, filename: string): Promise<void> {
  const { fileService } = await getEmbeddedPhoneRuntimeServices();
  await fileService.deleteFile(secret, filename);
  await refreshMirrors(secret);
}

export async function embeddedPhoneRenameFile(secret: string, from: string, to: string): Promise<RenameFileResponse> {
  const { fileService } = await getEmbeddedPhoneRuntimeServices();
  const renamed = await fileService.renameFile(secret, from, to);
  await refreshMirrors(secret);
  return { renamed };
}

export async function embeddedPhoneRenameFolder(secret: string, from: string, to: string, merge: boolean): Promise<RenameFolderResponse> {
  const { fileService } = await getEmbeddedPhoneRuntimeServices();
  const renamed = await fileService.renameFolder(secret, from, to, { merge });
  await refreshMirrors(secret);
  return { renamed };
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
  const { fileService } = await getEmbeddedPhoneRuntimeServices();
  const result = await fileService.importSourceReferences(secret, bundle, sourceSecret);
  await refreshMirrors(secret);
  return {
    imported: result.imported,
    importedCount: result.imported.length,
  };
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
  const { fileService } = await getEmbeddedPhoneRuntimeServices();
  const result = await fileService.importRecipientReferences(secret, bundle);
  await refreshMirrors(secret);
  return {
    imported: result.imported,
    importedCount: result.imported.length,
  };
}

export async function embeddedPhoneListChat(secret: string): Promise<VolumeChatState> {
  const { chatService } = await getEmbeddedPhoneRuntimeServices();
  const state = await chatService.listChat(secret);
  await refreshMirrors(secret);
  return state;
}

export async function embeddedPhonePublishIdentity(
  secret: string,
  identitySecret: string,
  profile: IdentityProfile
): Promise<PublishIdentityResponse> {
  const { chatService } = await getEmbeddedPhoneRuntimeServices();
  const published = await chatService.publishIdentity(secret, identitySecret, profile);
  await refreshMirrors(secret, published.eventHash);
  return { published };
}

export async function embeddedPhoneSendChatMessage(
  secret: string,
  identitySecret: string,
  input: { body?: string; attachment?: ChatAttachment }
): Promise<SendChatMessageResponse> {
  const { chatService } = await getEmbeddedPhoneRuntimeServices();
  const sent = await chatService.sendMessage(secret, identitySecret, input);
  await refreshMirrors(secret, sent.eventHash);
  return { sent };
}

export function resetEmbeddedPhoneServicesForTests(): void {
  servicesPromise = null;
  dbPromise = null;
  inMemoryStore = {
    files: new Map(),
    directories: new Set(),
  };
}

export async function embeddedPhoneHasLocalVolume(secret: string): Promise<boolean> {
  const { storage } = await getEmbeddedPhoneRuntimeServices();
  return storage.exists(await getVolumeDirectory(secret));
}

export function embeddedPhoneAuthSecret(auth: { type: 'token'; token: string } | { type: 'secret'; secret: string }): string | null {
  return auth.type === 'secret' && normalizeSecret(auth.secret) ? auth.secret : null;
}