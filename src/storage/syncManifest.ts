import type { EventPayload, EventType, Hash } from '../types/events.js';

export const NEARBYTES_SYNC_DIR = '.nearbytes-sync';
export const NEARBYTES_SYNC_INDEX_PATH = `${NEARBYTES_SYNC_DIR}/index.json`;
export const NEARBYTES_SYNC_CHANNELS_DIR = `${NEARBYTES_SYNC_DIR}/channels`;

export interface NearbytesSyncIndex {
  readonly version: 1;
  readonly generatedAt: number;
  readonly channels: Record<string, NearbytesSyncChannelRef>;
}

export interface NearbytesSyncChannelRef {
  readonly manifestPath: string;
  readonly revision: number;
  readonly eventCount: number;
  readonly updatedAt: number;
}

export interface NearbytesSyncChannelManifest {
  readonly version: 1;
  readonly channelId: string;
  readonly revision: number;
  readonly updatedAt: number;
  readonly events: readonly NearbytesSyncEventRecord[];
}

export interface NearbytesSyncEventRecord {
  readonly eventHash: string;
  readonly eventPath: string;
  readonly type: EventType;
  readonly fileName: string;
  readonly toFileName?: string;
  readonly createdAt?: number;
  readonly deletedAt?: number;
  readonly renamedAt?: number;
  readonly contentType?: 'b' | 'm';
  readonly size?: number;
  readonly mimeType?: string;
  readonly blockPath?: string;
  readonly blockHash?: string;
}

export function getNearbytesSyncChannelManifestPath(channelHex: string): string {
  return `${NEARBYTES_SYNC_CHANNELS_DIR}/${channelHex.toLowerCase()}.json`;
}

export function createNearbytesSyncEventRecord(
  channelHex: string,
  eventHash: Hash,
  payload: EventPayload
): NearbytesSyncEventRecord {
  const normalizedChannel = channelHex.toLowerCase();
  return {
    eventHash,
    eventPath: `channels/${normalizedChannel}/${eventHash}.bin`,
    type: payload.type,
    fileName: payload.fileName,
    toFileName: payload.toFileName,
    createdAt: payload.createdAt,
    deletedAt: payload.deletedAt,
    renamedAt: payload.renamedAt,
    contentType: payload.contentType,
    size: payload.size,
    mimeType: payload.mimeType,
    blockPath: hasBlockReference(payload) ? `blocks/${payload.hash}.bin` : undefined,
    blockHash: hasBlockReference(payload) ? payload.hash : undefined,
  };
}

export function isNearbytesSyncPath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  return normalized === NEARBYTES_SYNC_DIR || normalized.startsWith(`${NEARBYTES_SYNC_DIR}/`);
}

function hasBlockReference(payload: EventPayload): boolean {
  return payload.type === 'CREATE_FILE' && payload.hash.trim() !== '' && !/^0{64}$/u.test(payload.hash);
}