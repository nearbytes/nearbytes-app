import { openDB, type IDBPDatabase } from 'idb';

import type {
  EventDetailResponse,
  ListFilesResponse,
  LocalNetworkPeer,
  LocalNetworkPeersResponse,
  OpenVolumeResponse,
  TimelineDeltaResponse,
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

async function getAllRecords<T>(storeName: MirrorStoreName): Promise<T[]> {
  try {
    const db = await getIndexedDb();
    if (db) {
      return (await db.getAll(storeName)) as T[];
    }
    return Array.from(getInMemoryStore()[storeName].values()) as T[];
  } catch (error) {
    console.warn(`Failed to read browser mirror records for ${storeName}`, error);
    return [];
  }
}

async function clearStore(storeName: MirrorStoreName): Promise<void> {
  try {
    const db = await getIndexedDb();
    if (db) {
      await db.clear(storeName);
    } else {
      getInMemoryStore()[storeName].clear();
    }
  } catch (error) {
    console.warn(`Failed to clear browser mirror store ${storeName}`, error);
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

export async function clearMirrorVolumeSnapshots(): Promise<void> {
  await clearStore('volumes');
}

export async function readMirrorVolumeTimestamp(volumeId: string): Promise<number | null> {
  const snapshot = await readMirrorVolumeSnapshot(volumeId);
  return snapshot?.updatedAt ?? null;
}

export async function importCompatibilityTimelineSnapshot(snapshot: TimelineResponse): Promise<void> {
  await putRecord('timelines', snapshot.volumeId, {
    volumeId: snapshot.volumeId,
    events: snapshot.events,
    eventCount: snapshot.eventCount,
    updatedAt: Date.now(),
  } satisfies MirrorTimelineSnapshot);
}

function compareMirrorFiles(left: ListFilesResponse['files'][number], right: ListFilesResponse['files'][number]): number {
  if (left.createdAt !== right.createdAt) {
    return left.createdAt - right.createdAt;
  }
  return left.filename.localeCompare(right.filename);
}

function applyTimelineEventToFiles(
  files: Map<string, ListFilesResponse['files'][number]>,
  event: TimelineResponse['events'][number]
): void {
  if (event.type === 'CREATE_FILE') {
    if (!event.blobHash || event.size === undefined || event.createdAt === undefined) {
      return;
    }
    files.set(event.filename, {
      filename: event.filename,
      blobHash: event.blobHash,
      contentType: event.contentType,
      size: event.size,
      mimeType: event.mimeType,
      createdAt: event.createdAt,
    });
    return;
  }

  if (event.type === 'DELETE_FILE') {
    files.delete(event.filename);
    return;
  }

  if (event.type !== 'RENAME_FILE' || !event.toFilename) {
    return;
  }

  const existing = files.get(event.filename);
  if (!existing) {
    return;
  }
  files.delete(event.filename);
  files.set(event.toFilename, {
    ...existing,
    filename: event.toFilename,
  });
}

function materializeMirrorFilesFromTimeline(
  timeline: TimelineResponse['events'],
  existingFiles?: ListFilesResponse['files']
): ListFilesResponse['files'] {
  const files = new Map<string, ListFilesResponse['files'][number]>();
  if (existingFiles) {
    for (const file of existingFiles) {
      files.set(file.filename, file);
    }
  }
  for (const event of timeline) {
    applyTimelineEventToFiles(files, event);
  }
  return Array.from(files.values()).sort(compareMirrorFiles);
}

export async function importCompatibilityTimelineDelta(snapshot: TimelineDeltaResponse): Promise<{
  volumeId: string;
  files: ListFilesResponse['files'];
  timeline: TimelineResponse['events'];
}> {
  // docs/specs/application/hash-cursor-refresh-v0.1.md
  const previousTimeline = snapshot.reset ? null : await readMirrorTimelineSnapshot(snapshot.volumeId);
  const previousVolume = snapshot.reset ? null : await readMirrorVolumeSnapshot(snapshot.volumeId);
  const canAppend =
    previousTimeline !== null &&
    previousVolume !== null &&
    previousTimeline.events.at(-1)?.eventHash === snapshot.acceptedCursor;

  const timeline = canAppend
    ? [...previousTimeline.events, ...snapshot.events]
    : snapshot.events;
  const files = canAppend
    ? materializeMirrorFilesFromTimeline(snapshot.events, previousVolume.files)
    : materializeMirrorFilesFromTimeline(snapshot.events);

  await importCompatibilityTimelineSnapshot({
    volumeId: snapshot.volumeId,
    eventCount: snapshot.totalEventCount,
    events: timeline,
  });
  await importCompatibilityVolumeSnapshot({
    volumeId: snapshot.volumeId,
    files,
  });
  await writeMirrorCheckpoint(`cursor:timeline:${snapshot.volumeId}`, {
    kind: 'event-hash',
    requestedCursor: snapshot.requestedCursor,
    acceptedCursor: snapshot.acceptedCursor,
    nextCursor: snapshot.nextCursor,
    reset: snapshot.reset,
    totalEventCount: snapshot.totalEventCount,
    updatedAt: Date.now(),
    source: 'browser-mirror',
  });

  return {
    volumeId: snapshot.volumeId,
    files,
    timeline,
  };
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

export async function importLocalNetworkPeersSnapshot(response: LocalNetworkPeersResponse): Promise<void> {
  await clearStore('lanPeers');
  await writeMirrorCheckpoint('lan:service', response.service as Record<string, unknown>);
  await Promise.all(
    response.peers.map((peer) => writeLanPeerSnapshot(peer.peerId, peer as unknown as Record<string, unknown>))
  );
}

export async function readMirrorLocalNetworkPeers(): Promise<LocalNetworkPeersResponse | null> {
  const serviceRecord = await getRecord<MirrorCheckpointRecord>('checkpoints', 'lan:service');
  const peers = await getAllRecords<MirrorLanPeerRecord>('lanPeers');

  if (!serviceRecord) {
    return null;
  }

  return {
    service: serviceRecord.value as unknown as LocalNetworkPeersResponse['service'],
    peers: peers
      .map((entry) => entry.snapshot as unknown as LocalNetworkPeer)
      .sort((left, right) => left.label.localeCompare(right.label)),
  };
}

export async function writeMirrorCheckpoint(key: string, value: Record<string, unknown>): Promise<void> {
  await putRecord('checkpoints', key, {
    key,
    value,
    updatedAt: Date.now(),
  } satisfies MirrorCheckpointRecord);
}

export async function readMirrorCheckpoint(key: string): Promise<MirrorCheckpointRecord | null> {
  return getRecord<MirrorCheckpointRecord>('checkpoints', key);
}

export function resetBrowserMirrorForTests(): void {
  dbPromise = null;
  inMemoryStore = createInMemoryMirrorStore();
  mirrorListeners.clear();
}