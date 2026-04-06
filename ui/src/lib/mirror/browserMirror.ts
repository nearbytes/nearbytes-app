import { openDB, type IDBPDatabase } from 'idb';

import type {
  EventDetailResponse,
  ListFilesResponse,
  OpenVolumeResponse,
  TimelineResponse,
} from '../api.js';

interface MirrorVolumeSnapshot {
  volumeId: string;
  files: ListFilesResponse['files'];
  updatedAt: number;
}

interface MirrorTimelineSnapshot {
  volumeId: string;
  events: TimelineResponse['events'];
  eventCount: number;
  updatedAt: number;
}

interface MirrorEventDetailSnapshot {
  eventHash: string;
  event: EventDetailResponse['event'];
  decryptedPayload?: EventDetailResponse['decryptedPayload'];
  updatedAt: number;
}

interface MirrorCheckpointRecord {
  key: string;
  value: Record<string, unknown>;
  updatedAt: number;
}

interface MirrorLanPeerRecord {
  key: string;
  snapshot: Record<string, unknown>;
  updatedAt: number;
}

interface InMemoryMirrorStore {
  volumes: Map<string, MirrorVolumeSnapshot>;
  timelines: Map<string, MirrorTimelineSnapshot>;
  eventDetails: Map<string, MirrorEventDetailSnapshot>;
  lanPeers: Map<string, MirrorLanPeerRecord>;
  checkpoints: Map<string, MirrorCheckpointRecord>;
}

type MirrorStoreName = 'volumes' | 'timelines' | 'eventDetails' | 'lanPeers' | 'checkpoints';

const DB_NAME = 'nearbytes-browser-mirror';
const DB_VERSION = 1;
const mirrorListeners = new Set<(storeName: MirrorStoreName, key: string) => void>();

let dbPromise: Promise<IDBPDatabase> | null = null;
let inMemoryStore: InMemoryMirrorStore | null = null;

function createInMemoryMirrorStore(): InMemoryMirrorStore {
  return {
    volumes: new Map(),
    timelines: new Map(),
    eventDetails: new Map(),
    lanPeers: new Map(),
    checkpoints: new Map(),
  };
}

function shouldUseIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined';
}

async function getIndexedDb(): Promise<IDBPDatabase | null> {
  if (!shouldUseIndexedDb()) {
    return null;
  }

  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('volumes')) {
          db.createObjectStore('volumes', { keyPath: 'volumeId' });
        }
        if (!db.objectStoreNames.contains('timelines')) {
          db.createObjectStore('timelines', { keyPath: 'volumeId' });
        }
        if (!db.objectStoreNames.contains('eventDetails')) {
          db.createObjectStore('eventDetails', { keyPath: 'eventHash' });
        }
        if (!db.objectStoreNames.contains('lanPeers')) {
          db.createObjectStore('lanPeers', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('checkpoints')) {
          db.createObjectStore('checkpoints', { keyPath: 'key' });
        }
      },
    });
  }

  return dbPromise;
}

function getInMemoryStore(): InMemoryMirrorStore {
  if (!inMemoryStore) {
    inMemoryStore = createInMemoryMirrorStore();
  }
  return inMemoryStore;
}

function notifyMirrorListeners(storeName: MirrorStoreName, key: string): void {
  for (const listener of mirrorListeners) {
    listener(storeName, key);
  }
}

async function putRecord<T extends Record<string, unknown>>(
  storeName: MirrorStoreName,
  key: string,
  record: T
): Promise<void> {
  try {
    const db = await getIndexedDb();
    if (db) {
      await db.put(storeName, record);
    } else {
      getInMemoryStore()[storeName].set(key, record);
    }
    notifyMirrorListeners(storeName, key);
  } catch (error) {
    console.warn(`Failed to write browser mirror record for ${storeName}:${key}`, error);
  }
}

async function getRecord<T>(storeName: MirrorStoreName, key: string): Promise<T | null> {
  try {
    const db = await getIndexedDb();
    if (db) {
      return (await db.get(storeName, key)) as T | null;
    }
    return (getInMemoryStore()[storeName].get(key) as T | undefined) ?? null;
  } catch (error) {
    console.warn(`Failed to read browser mirror record for ${storeName}:${key}`, error);
    return null;
  }
}

export function subscribeBrowserMirror(listener: (storeName: MirrorStoreName, key: string) => void): () => void {
  mirrorListeners.add(listener);
  return () => {
    mirrorListeners.delete(listener);
  };
}

export async function importCompatibilityVolumeSnapshot(
  snapshot: Pick<OpenVolumeResponse, 'volumeId' | 'files'> | Pick<ListFilesResponse, 'volumeId' | 'files'>
): Promise<void> {
  await putRecord('volumes', snapshot.volumeId, {
    volumeId: snapshot.volumeId,
    files: snapshot.files,
    updatedAt: Date.now(),
  } satisfies MirrorVolumeSnapshot);
}

export async function readMirrorVolumeSnapshot(volumeId: string): Promise<MirrorVolumeSnapshot | null> {
  return getRecord<MirrorVolumeSnapshot>('volumes', volumeId);
}

export async function importCompatibilityTimelineSnapshot(snapshot: TimelineResponse): Promise<void> {
  await putRecord('timelines', snapshot.volumeId, {
    volumeId: snapshot.volumeId,
    events: snapshot.events,
    eventCount: snapshot.eventCount,
    updatedAt: Date.now(),
  } satisfies MirrorTimelineSnapshot);
}

export async function readMirrorTimelineSnapshot(volumeId: string): Promise<MirrorTimelineSnapshot | null> {
  return getRecord<MirrorTimelineSnapshot>('timelines', volumeId);
}

export async function importCompatibilityEventDetail(snapshot: EventDetailResponse): Promise<void> {
  await putRecord('eventDetails', snapshot.eventHash, {
    eventHash: snapshot.eventHash,
    event: snapshot.event,
    decryptedPayload: snapshot.decryptedPayload,
    updatedAt: Date.now(),
  } satisfies MirrorEventDetailSnapshot);
}

export async function readMirrorEventDetail(eventHash: string): Promise<MirrorEventDetailSnapshot | null> {
  return getRecord<MirrorEventDetailSnapshot>('eventDetails', eventHash);
}

export async function writeLanPeerSnapshot(key: string, snapshot: Record<string, unknown>): Promise<void> {
  await putRecord('lanPeers', key, {
    key,
    snapshot,
    updatedAt: Date.now(),
  } satisfies MirrorLanPeerRecord);
}

export async function writeMirrorCheckpoint(key: string, value: Record<string, unknown>): Promise<void> {
  await putRecord('checkpoints', key, {
    key,
    value,
    updatedAt: Date.now(),
  } satisfies MirrorCheckpointRecord);
}

export function resetBrowserMirrorForTests(): void {
  dbPromise = null;
  inMemoryStore = createInMemoryMirrorStore();
  mirrorListeners.clear();
}