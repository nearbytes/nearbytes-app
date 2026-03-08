import type { CryptoOperations } from '../crypto/index.js';
import type { KeyPair, Secret } from '../types/keys.js';
import { createSecret } from '../types/keys.js';
import type { StorageBackend, ChannelPathMapper } from '../types/storage.js';
import type { EventPayload, Hash } from '../types/events.js';
import { createEncryptedData, EMPTY_HASH, EventType } from '../types/events.js';
import { defaultPathMapper } from '../types/storage.js';
import { ChannelStorage } from '../storage/channel.js';
import { serializeEventPayload } from '../storage/serialization.js';
import { loadEventLog, openVolume, verifyEventLog } from './volume.js';
import {
  createChatMessage,
  createIdentityRecord,
  parseChatAttachmentValue,
  parseChatMessageJson,
  parseIdentityRecordJson,
  serializeChatMessage,
  serializeIdentityRecord,
  verifyChatMessage,
  verifyIdentityRecord,
  type ChatAttachment,
  type ChatMessage,
  type IdentityProfile,
  type IdentityRecord,
} from './chatCodec.js';

export interface PublishedIdentity {
  readonly eventHash: string;
  readonly authorPublicKey: string;
  readonly publishedAt: number;
  readonly record: IdentityRecord;
}

export interface PublishedChatMessage {
  readonly eventHash: string;
  readonly authorPublicKey: string;
  readonly publishedAt: number;
  readonly message: ChatMessage;
}

export interface VolumeChatState {
  readonly identities: PublishedIdentity[];
  readonly messages: PublishedChatMessage[];
}

export interface ChatServiceDependencies {
  readonly crypto: CryptoOperations;
  readonly storage: StorageBackend;
  readonly pathMapper?: ChannelPathMapper;
  readonly now?: () => number;
}

export interface ChatService {
  listChat(secret: string): Promise<VolumeChatState>;
  publishIdentity(
    volumeSecret: string,
    identitySecret: string,
    profile: IdentityProfile
  ): Promise<PublishedIdentity>;
  sendMessage(
    volumeSecret: string,
    identitySecret: string,
    input: { body?: string; attachment?: unknown }
  ): Promise<PublishedChatMessage>;
}

interface ChatTimelineRow {
  readonly eventHash: string;
  readonly type: EventType.DECLARE_IDENTITY | EventType.CHAT_MESSAGE;
  readonly authorPublicKey: string;
  readonly publishedAt: number;
  readonly record?: string;
  readonly message?: string;
}

export function createChatService(dependencies: ChatServiceDependencies): ChatService {
  const pathMapper = dependencies.pathMapper ?? defaultPathMapper;
  const channelStorage = new ChannelStorage(dependencies.storage, pathMapper);
  const now = dependencies.now ?? (() => Date.now());

  return {
    listChat: async (secret) =>
      listChatWithDeps(secret, dependencies.crypto, dependencies.storage, channelStorage, pathMapper),
    publishIdentity: async (volumeSecret, identitySecret, profile) =>
      publishIdentityWithDeps(
        volumeSecret,
        identitySecret,
        profile,
        dependencies.crypto,
        dependencies.storage,
        channelStorage,
        pathMapper,
        now
      ),
    sendMessage: async (volumeSecret, identitySecret, input) =>
      sendMessageWithDeps(
        volumeSecret,
        identitySecret,
        input,
        dependencies.crypto,
        dependencies.storage,
        channelStorage,
        pathMapper,
        now
      ),
  };
}

async function listChatWithDeps(
  secret: string,
  crypto: CryptoOperations,
  storage: StorageBackend,
  channelStorage: ChannelStorage,
  pathMapper: ChannelPathMapper
): Promise<VolumeChatState> {
  const volume = await openVolume(normalizeSecret(secret), crypto, storage, pathMapper);
  const entries = await loadEventLog(volume, channelStorage);
  await verifyEventLog(entries, volume, crypto);

  const rows = extractChatRows(entries);
  const latestIdentityByAuthor = new Map<string, PublishedIdentity>();
  const messages: PublishedChatMessage[] = [];

  for (const row of rows) {
    if (row.type === EventType.DECLARE_IDENTITY) {
      if (!row.record) {
        continue;
      }
      let record: IdentityRecord | null;
      try {
        record = parseIdentityRecordJson(row.record);
      } catch {
        continue;
      }
      if (!record || record.k !== row.authorPublicKey) {
        continue;
      }
      let verified = false;
      try {
        verified = await verifyIdentityRecord(crypto, record);
      } catch {
        verified = false;
      }
      if (!verified) {
        continue;
      }
      const published: PublishedIdentity = {
        eventHash: row.eventHash,
        authorPublicKey: row.authorPublicKey,
        publishedAt: row.publishedAt,
        record,
      };
      const existing = latestIdentityByAuthor.get(row.authorPublicKey);
      if (!existing || comparePublished(existing.publishedAt, existing.eventHash, published.publishedAt, published.eventHash) < 0) {
        latestIdentityByAuthor.set(row.authorPublicKey, published);
      }
      continue;
    }

    if (!row.message) {
      continue;
    }
    let message: ChatMessage | null;
    try {
      message = parseChatMessageJson(row.message);
    } catch {
      continue;
    }
    if (!message || message.k !== row.authorPublicKey) {
      continue;
    }
    let verified = false;
    try {
      verified = await verifyChatMessage(crypto, message);
    } catch {
      verified = false;
    }
    if (!verified) {
      continue;
    }
    messages.push({
      eventHash: row.eventHash,
      authorPublicKey: row.authorPublicKey,
      publishedAt: row.publishedAt,
      message,
    });
  }

  messages.sort((left, right) => comparePublished(left.publishedAt, left.eventHash, right.publishedAt, right.eventHash));

  const identities = Array.from(latestIdentityByAuthor.values());
  identities.sort((left, right) => comparePublished(left.publishedAt, left.eventHash, right.publishedAt, right.eventHash));

  return {
    identities,
    messages,
  };
}

async function publishIdentityWithDeps(
  volumeSecret: string,
  identitySecret: string,
  profile: IdentityProfile,
  crypto: CryptoOperations,
  storage: StorageBackend,
  channelStorage: ChannelStorage,
  pathMapper: ChannelPathMapper,
  now: () => number
): Promise<PublishedIdentity> {
  const normalizedVolumeSecret = normalizeSecret(volumeSecret);
  const normalizedIdentitySecret = normalizeSecret(identitySecret);
  const volume = await openVolume(normalizedVolumeSecret, crypto, storage, pathMapper);
  const entries = await loadEventLog(volume, channelStorage);
  await verifyEventLog(entries, volume, crypto);

  const volumeKeyPair = await crypto.deriveKeys(normalizedVolumeSecret);
  const identityKeyPair = await crypto.deriveKeys(normalizedIdentitySecret);
  const publishedAt = nextPublishedTimestamp(entries, now());
  const record = await createIdentityRecord(crypto, identityKeyPair, profile, publishedAt);
  const eventHash = await appendAppEvent(channelStorage, crypto, volumeKeyPair, {
    type: EventType.DECLARE_IDENTITY,
    authorPublicKey: record.k,
    record: serializeIdentityRecord(record),
    publishedAt,
  });

  return {
    eventHash,
    authorPublicKey: record.k,
    publishedAt,
    record,
  };
}

async function sendMessageWithDeps(
  volumeSecret: string,
  identitySecret: string,
  input: { body?: string; attachment?: unknown },
  crypto: CryptoOperations,
  storage: StorageBackend,
  channelStorage: ChannelStorage,
  pathMapper: ChannelPathMapper,
  now: () => number
): Promise<PublishedChatMessage> {
  const normalizedVolumeSecret = normalizeSecret(volumeSecret);
  const normalizedIdentitySecret = normalizeSecret(identitySecret);
  const volume = await openVolume(normalizedVolumeSecret, crypto, storage, pathMapper);
  const entries = await loadEventLog(volume, channelStorage);
  await verifyEventLog(entries, volume, crypto);

  const volumeKeyPair = await crypto.deriveKeys(normalizedVolumeSecret);
  const identityKeyPair = await crypto.deriveKeys(normalizedIdentitySecret);
  const publishedAt = nextPublishedTimestamp(entries, now());
  const attachment = input.attachment === undefined ? undefined : parseChatAttachmentValue(input.attachment);
  const message = await createChatMessage(crypto, identityKeyPair, {
    body: input.body,
    attachment,
    timestamp: publishedAt,
  });
  const eventHash = await appendAppEvent(channelStorage, crypto, volumeKeyPair, {
    type: EventType.CHAT_MESSAGE,
    authorPublicKey: message.k,
    message: serializeChatMessage(message),
    publishedAt,
  });

  return {
    eventHash,
    authorPublicKey: message.k,
    publishedAt,
    message,
  };
}

async function appendAppEvent(
  channelStorage: ChannelStorage,
  crypto: CryptoOperations,
  volumeKeyPair: KeyPair,
  input: {
    type: EventType.DECLARE_IDENTITY | EventType.CHAT_MESSAGE;
    authorPublicKey: string;
    publishedAt: number;
    record?: string;
    message?: string;
  }
): Promise<string> {
  const payload: EventPayload = {
    type: input.type,
    fileName: '',
    hash: EMPTY_HASH,
    encryptedKey: createEncryptedData(new Uint8Array(0)),
    authorPublicKey: input.authorPublicKey,
    record: input.record,
    message: input.message,
    publishedAt: input.publishedAt,
  };
  const payloadBytes = serializeEventPayload(payload);
  const signature = await crypto.signPR(payloadBytes, volumeKeyPair.privateKey);
  return channelStorage.storeEvent(volumeKeyPair.publicKey, { payload, signature });
}

function extractChatRows(entries: readonly { eventHash: string; signedEvent: { payload: EventPayload } }[]): ChatTimelineRow[] {
  const rows: ChatTimelineRow[] = [];
  for (const entry of entries) {
    const payload = entry.signedEvent.payload;
    if (
      payload.type !== EventType.DECLARE_IDENTITY &&
      payload.type !== EventType.CHAT_MESSAGE
    ) {
      continue;
    }
    if (!payload.authorPublicKey || payload.publishedAt === undefined) {
      continue;
    }
    rows.push({
      eventHash: entry.eventHash,
      type: payload.type,
      authorPublicKey: payload.authorPublicKey,
      publishedAt: payload.publishedAt,
      record: payload.record,
      message: payload.message,
    });
  }
  rows.sort((left, right) => comparePublished(left.publishedAt, left.eventHash, right.publishedAt, right.eventHash));
  return rows;
}

function comparePublished(
  leftPublishedAt: number,
  leftEventHash: string,
  rightPublishedAt: number,
  rightEventHash: string
): number {
  if (leftPublishedAt !== rightPublishedAt) {
    return leftPublishedAt - rightPublishedAt;
  }
  if (leftEventHash < rightEventHash) {
    return -1;
  }
  if (leftEventHash > rightEventHash) {
    return 1;
  }
  return 0;
}

function nextPublishedTimestamp(
  entries: readonly { signedEvent: { payload: EventPayload } }[],
  fallbackNow: number
): number {
  let maxTimestamp = 0;
  for (const entry of entries) {
    const payload = entry.signedEvent.payload;
    const value =
      payload.createdAt ??
      payload.deletedAt ??
      payload.renamedAt ??
      payload.publishedAt ??
      0;
    if (value > maxTimestamp) {
      maxTimestamp = value;
    }
  }
  return Math.max(fallbackNow, maxTimestamp + 1);
}

function normalizeSecret(secret: string): Secret {
  return createSecret(secret);
}
