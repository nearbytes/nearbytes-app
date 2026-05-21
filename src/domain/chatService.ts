import type { CryptoOperations } from 'nearbytes-crypto';
import type { KeyPair, PublicKey, Secret } from 'nearbytes-crypto';
import { createSecret } from 'nearbytes-crypto';
import type { EventPayload } from 'nearbytes-crypto';
import { EventType } from 'nearbytes-crypto';
import type { EventLogEntry, Log, ChannelPathMapper } from 'nearbytes-log';
import { serializeEventEnvelope } from 'nearbytes-log';
import { createSignedEvent, hydrateSignedEvent, loadEventLog, openChannel, verifyEventLog } from 'nearbytes-log';
import { volumeIdFromPublicKey } from 'nearbytes-files';
import {
  createChatMessage,
  createIdentityRecord,
  createIdentitySnapshot,
  parseChatMessageJson,
  parseIdentityRecordJson,
  parseIdentitySnapshotJson,
  serializeChatMessage,
  serializeIdentityRecord,
  serializeIdentitySnapshot,
  verifyChatMessage,
  verifyIdentityRecord,
  verifyIdentitySnapshot,
  type ChatMessage,
  type IdentityProfile,
  type IdentityRecord,
} from 'nearbytes-files';

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
  readonly log: Log;
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
    input: { body: string }
  ): Promise<PublishedChatMessage>;
}

type IdentitySource = 'legacy' | 'canonical' | 'snapshot';

interface ResolvedPublishedIdentity extends PublishedIdentity {
  readonly source: IdentitySource;
  readonly channelPublicKey?: string;
  readonly channelEventHash?: string;
}

interface IdentityChannelRecord extends PublishedIdentity {}

interface ChatTimelineRow {
  readonly eventHash: string;
  readonly kind: 'identity' | 'message';
  readonly source?: IdentitySource;
  readonly authorPublicKey: string;
  readonly publishedAt: number;
  readonly recordText?: string;
  readonly messageText?: string;
}

export function createChatService(dependencies: ChatServiceDependencies): ChatService {
  const channelStorage = dependencies.log;
  const now = dependencies.now ?? (() => Date.now());

  return {
    listChat: async (secret) =>
      listChatWithDeps(secret, dependencies.crypto, channelStorage),
    publishIdentity: async (volumeSecret, identitySecret, profile) =>
      publishIdentityWithDeps(
        volumeSecret,
        identitySecret,
        profile,
        dependencies.crypto,
        channelStorage,
        now
      ),
    sendMessage: async (volumeSecret, identitySecret, input) =>
      sendMessageWithDeps(
        volumeSecret,
        identitySecret,
        input,
        dependencies.crypto,
        channelStorage,
        now
      ),
  };
}

async function listChatWithDeps(
  secret: string,
  crypto: CryptoOperations,
  channelStorage: Log
): Promise<VolumeChatState> {
  const volume = await openChannel(normalizeSecret(secret), crypto);
  const entries = await loadEventLog(volume, channelStorage, crypto);
  await verifyEventLog(entries, volume, crypto);

  const chatState = await materializeChatState(entries, crypto);
  return {
    identities: chatState.identities.map(stripResolvedIdentity),
    messages: chatState.messages,
  };
}

async function publishIdentityWithDeps(
  volumeSecret: string,
  identitySecret: string,
  profile: IdentityProfile,
  crypto: CryptoOperations,
  channelStorage: Log,
  now: () => number
): Promise<PublishedIdentity> {
  const normalizedVolumeSecret = normalizeSecret(volumeSecret);
  const normalizedIdentitySecret = normalizeSecret(identitySecret);
  const volume = await openChannel(normalizedVolumeSecret, crypto);
  const volumeEntries = await loadEventLog(volume, channelStorage, crypto);
  await verifyEventLog(volumeEntries, volume, crypto);

  const volumeKeyPair = await crypto.deriveKeys(normalizedVolumeSecret);
  const identityKeyPair = await crypto.deriveKeys(normalizedIdentitySecret);
  const canonicalIdentity = await ensureCanonicalIdentityRecord(
    identityKeyPair,
    profile,
    crypto,
    channelStorage,
    now
  );
  const visibleIdentity = await ensureIdentityVisibleInVolume(
    volumeKeyPair,
    volumeEntries,
    identityKeyPair,
    canonicalIdentity,
    crypto,
    channelStorage,
    now
  );

  return stripResolvedIdentity(visibleIdentity);
}

async function sendMessageWithDeps(
  volumeSecret: string,
  identitySecret: string,
  input: { body: string },
  crypto: CryptoOperations,
  channelStorage: Log,
  now: () => number
): Promise<PublishedChatMessage> {
  const normalizedVolumeSecret = normalizeSecret(volumeSecret);
  const normalizedIdentitySecret = normalizeSecret(identitySecret);
  const volume = await openChannel(normalizedVolumeSecret, crypto);
  const volumeEntries = await loadEventLog(volume, channelStorage, crypto);
  await verifyEventLog(volumeEntries, volume, crypto);

  const volumeKeyPair = await crypto.deriveKeys(normalizedVolumeSecret);
  const identityKeyPair = await crypto.deriveKeys(normalizedIdentitySecret);
  const canonicalIdentity = await getLatestIdentityChannelRecord(identityKeyPair, crypto, channelStorage);
  if (!canonicalIdentity) {
    throw new Error('The selected identity has not been published yet');
  }

  const visibleIdentity = await ensureIdentityVisibleInVolume(
    volumeKeyPair,
    volumeEntries,
    identityKeyPair,
    canonicalIdentity,
    crypto,
    channelStorage,
    now
  );
  const basePublishedAt = nextPublishedTimestamp(volumeEntries, now());
  const publishedAt = Math.max(
    basePublishedAt,
    canonicalIdentity.publishedAt + 1,
    visibleIdentity.publishedAt + 1
  );
  const message = await createChatMessage(crypto, identityKeyPair, {
    body: input.body,
    timestamp: publishedAt,
  });
  const eventHash = await appendAppRecord(channelStorage, crypto, volumeKeyPair, {
    authorPublicKey: message.k,
    protocol: message.p,
    record: serializeChatMessage(message),
    publishedAt,
  });

  return {
    eventHash,
    authorPublicKey: message.k,
    publishedAt,
    message,
  };
}

async function ensureCanonicalIdentityRecord(
  identityKeyPair: KeyPair,
  profile: IdentityProfile,
  crypto: CryptoOperations,
  channelStorage: Log,
  now: () => number
): Promise<IdentityChannelRecord> {
  const identityEntries = await loadVerifiedChannelEntries(identityKeyPair, crypto, channelStorage);
  const latest = await getLatestIdentityChannelRecordFromEntries(identityEntries, crypto);
  if (latest && profilesEqual(latest.record.profile, profile)) {
    return latest;
  }

  const publishedAt = nextPublishedTimestamp(identityEntries, now());
  const record = await createIdentityRecord(crypto, identityKeyPair, profile, publishedAt);
  const eventHash = await appendAppRecord(channelStorage, crypto, identityKeyPair, {
    authorPublicKey: record.k,
    protocol: record.p,
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

async function getLatestIdentityChannelRecord(
  identityKeyPair: KeyPair,
  crypto: CryptoOperations,
  channelStorage: Log
): Promise<IdentityChannelRecord | null> {
  const entries = await loadVerifiedChannelEntries(identityKeyPair, crypto, channelStorage);
  return getLatestIdentityChannelRecordFromEntries(entries, crypto);
}

async function getLatestIdentityChannelRecordFromEntries(
  entries: readonly EventLogEntry[],
  crypto: CryptoOperations
): Promise<IdentityChannelRecord | null> {
  const rows = extractChatRows(entries);
  let latest: IdentityChannelRecord | null = null;

  for (const row of rows) {
    if (row.kind !== 'identity' || row.source !== 'canonical' || !row.recordText) {
      continue;
    }
    const record = parseIdentityRecordJson(row.recordText);
    if (!record || record.k !== row.authorPublicKey) {
      continue;
    }
    if (!(await verifyIdentityRecord(crypto, record))) {
      continue;
    }
    const published: IdentityChannelRecord = {
      eventHash: row.eventHash,
      authorPublicKey: row.authorPublicKey,
      publishedAt: row.publishedAt,
      record,
    };
    if (
      !latest ||
      comparePublished(latest.publishedAt, latest.eventHash, published.publishedAt, published.eventHash) < 0
    ) {
      latest = published;
    }
  }

  return latest;
}

async function ensureIdentityVisibleInVolume(
  volumeKeyPair: KeyPair,
  volumeEntries: readonly EventLogEntry[],
  identityKeyPair: KeyPair,
  canonicalIdentity: IdentityChannelRecord,
  crypto: CryptoOperations,
  channelStorage: Log,
  now: () => number
): Promise<ResolvedPublishedIdentity> {
  if (publicKeysEqual(volumeKeyPair.publicKey, identityKeyPair.publicKey)) {
    return {
      ...canonicalIdentity,
      source: 'canonical',
    };
  }

  const localChatState = await materializeChatState(volumeEntries, crypto);
  const existing = localChatState.latestIdentityByAuthor.get(canonicalIdentity.authorPublicKey);
  if (
    existing &&
    existing.source === 'snapshot' &&
    existing.channelPublicKey === canonicalIdentity.authorPublicKey &&
    existing.channelEventHash === canonicalIdentity.eventHash
  ) {
    return existing;
  }

  const publishedAt = nextPublishedTimestamp(volumeEntries, now());
  const snapshot = await createIdentitySnapshot(crypto, identityKeyPair, {
    record: canonicalIdentity.record,
    ref: {
      channel: volumeIdFromPublicKey(identityKeyPair.publicKey),
      eventHash: canonicalIdentity.eventHash,
    },
    timestamp: publishedAt,
  });
  const eventHash = await appendAppRecord(channelStorage, crypto, volumeKeyPair, {
    authorPublicKey: snapshot.k,
    protocol: snapshot.p,
    record: serializeIdentitySnapshot(snapshot),
    publishedAt,
  });

  return {
    eventHash,
    authorPublicKey: snapshot.k,
    publishedAt,
    record: snapshot.record,
    source: 'snapshot',
    channelPublicKey: snapshot.ref.channel,
    channelEventHash: snapshot.ref.eventHash,
  };
}

async function materializeChatState(
  entries: readonly EventLogEntry[],
  crypto: CryptoOperations
): Promise<{
  identities: ResolvedPublishedIdentity[];
  latestIdentityByAuthor: Map<string, ResolvedPublishedIdentity>;
  messages: PublishedChatMessage[];
}> {
  const rows = extractChatRows(entries);
  const latestIdentityByAuthor = new Map<string, ResolvedPublishedIdentity>();
  const messages: PublishedChatMessage[] = [];

  for (const row of rows) {
    if (row.kind === 'identity') {
      const identity = await resolveIdentityRow(row, crypto);
      if (!identity) {
        continue;
      }
      const existing = latestIdentityByAuthor.get(identity.authorPublicKey);
      if (
        !existing ||
        comparePublished(existing.publishedAt, existing.eventHash, identity.publishedAt, identity.eventHash) < 0
      ) {
        latestIdentityByAuthor.set(identity.authorPublicKey, identity);
      }
      continue;
    }

    const message = await resolveMessageRow(row, crypto);
    if (message) {
      messages.push(message);
    }
  }

  messages.sort((left, right) =>
    comparePublished(left.publishedAt, left.eventHash, right.publishedAt, right.eventHash)
  );

  const identities = Array.from(latestIdentityByAuthor.values());
  identities.sort((left, right) =>
    comparePublished(left.publishedAt, left.eventHash, right.publishedAt, right.eventHash)
  );

  return {
    identities,
    latestIdentityByAuthor,
    messages,
  };
}

async function resolveIdentityRow(
  row: ChatTimelineRow,
  crypto: CryptoOperations
): Promise<ResolvedPublishedIdentity | null> {
  if (row.kind !== 'identity' || !row.recordText || !row.source) {
    return null;
  }

  if (row.source === 'snapshot') {
    const snapshot = parseIdentitySnapshotJson(row.recordText);
    if (!snapshot || snapshot.k !== row.authorPublicKey) {
      return null;
    }
    if (!(await verifyIdentitySnapshot(crypto, snapshot))) {
      return null;
    }
    return {
      eventHash: row.eventHash,
      authorPublicKey: row.authorPublicKey,
      publishedAt: row.publishedAt,
      record: snapshot.record,
      source: 'snapshot',
      channelPublicKey: snapshot.ref.channel,
      channelEventHash: snapshot.ref.eventHash,
    };
  }

  const record = parseIdentityRecordJson(row.recordText);
  if (!record || record.k !== row.authorPublicKey) {
    return null;
  }
  if (!(await verifyIdentityRecord(crypto, record))) {
    return null;
  }
  return {
    eventHash: row.eventHash,
    authorPublicKey: row.authorPublicKey,
    publishedAt: row.publishedAt,
    record,
    source: row.source,
  };
}

async function resolveMessageRow(
  row: ChatTimelineRow,
  crypto: CryptoOperations
): Promise<PublishedChatMessage | null> {
  if (row.kind !== 'message' || !row.messageText) {
    return null;
  }

  const message = parseChatMessageJson(row.messageText);
  if (!message || message.k !== row.authorPublicKey) {
    return null;
  }
  if (!(await verifyChatMessage(crypto, message))) {
    return null;
  }
  return {
    eventHash: row.eventHash,
    authorPublicKey: row.authorPublicKey,
    publishedAt: row.publishedAt,
    message,
  };
}

function stripResolvedIdentity(identity: ResolvedPublishedIdentity): PublishedIdentity {
  return {
    eventHash: identity.eventHash,
    authorPublicKey: identity.authorPublicKey,
    publishedAt: identity.publishedAt,
    record: identity.record,
  };
}

async function appendAppRecord(
  channelStorage: Log,
  crypto: CryptoOperations,
  channelKeyPair: KeyPair,
  input: {
    authorPublicKey: string;
    protocol: string;
    record: string;
    publishedAt: number;
  }
): Promise<string> {
  const payload: EventPayload = {
    type: EventType.APP_RECORD,
    authorPublicKey: input.authorPublicKey,
    protocol: input.protocol,
    record: input.record,
    publishedAt: input.publishedAt,
  };
  const event = await createSignedEvent(crypto, channelKeyPair, payload, []);
  return channelStorage.events.storeEvent(channelKeyPair.publicKey, event);
}

function extractChatRows(entries: readonly EventLogEntry[]): ChatTimelineRow[] {
  const rows: ChatTimelineRow[] = [];

  for (const entry of entries) {
    const payload = entry.signedEvent.payload;
    if (
      payload.type !== EventType.DECLARE_IDENTITY &&
      payload.type !== EventType.CHAT_MESSAGE &&
      payload.type !== EventType.APP_RECORD
    ) {
      continue;
    }
    if (!payload.authorPublicKey || payload.publishedAt === undefined) {
      continue;
    }

    if (payload.type === EventType.DECLARE_IDENTITY && payload.record) {
      rows.push({
        eventHash: entry.eventHash,
        kind: 'identity',
        source: 'legacy',
        authorPublicKey: payload.authorPublicKey,
        publishedAt: payload.publishedAt,
        recordText: payload.record,
      });
      continue;
    }

    if (payload.type === EventType.CHAT_MESSAGE && payload.message) {
      rows.push({
        eventHash: entry.eventHash,
        kind: 'message',
        authorPublicKey: payload.authorPublicKey,
        publishedAt: payload.publishedAt,
        messageText: payload.message,
      });
      continue;
    }

    if (payload.type !== EventType.APP_RECORD || !payload.protocol || !payload.record) {
      continue;
    }

    if (payload.protocol === 'nb.identity.record.v1') {
      rows.push({
        eventHash: entry.eventHash,
        kind: 'identity',
        source: 'canonical',
        authorPublicKey: payload.authorPublicKey,
        publishedAt: payload.publishedAt,
        recordText: payload.record,
      });
      continue;
    }

    if (payload.protocol === 'nb.identity.snapshot.v1') {
      rows.push({
        eventHash: entry.eventHash,
        kind: 'identity',
        source: 'snapshot',
        authorPublicKey: payload.authorPublicKey,
        publishedAt: payload.publishedAt,
        recordText: payload.record,
      });
      continue;
    }

    if (payload.protocol === 'nb.chat.message.v1') {
      rows.push({
        eventHash: entry.eventHash,
        kind: 'message',
        authorPublicKey: payload.authorPublicKey,
        publishedAt: payload.publishedAt,
        messageText: payload.record,
      });
    }
  }

  rows.sort((left, right) =>
    comparePublished(left.publishedAt, left.eventHash, right.publishedAt, right.eventHash)
  );
  return rows;
}

async function loadVerifiedChannelEntries(
  keyPair: KeyPair,
  crypto: CryptoOperations,
  channelStorage: Log
): Promise<EventLogEntry[]> {
  const eventHashes = await channelStorage.events.listEvents(keyPair.publicKey);
  const entries: EventLogEntry[] = [];

  for (const eventHash of eventHashes) {
    const signedEvent = await channelStorage.events.retrieveEvent(keyPair.publicKey, eventHash);
    const payloadBytes = serializeEventEnvelope(signedEvent.envelope);
    const isValid = await crypto.verifyPU(payloadBytes, signedEvent.signature, keyPair.publicKey);
    if (!isValid) {
      throw new Error(`Event signature verification failed for event ${eventHash}`);
    }
    entries.push({
      eventHash,
      signedEvent: await hydrateSignedEvent(crypto, keyPair.privateKey, signedEvent),
    });
  }

  entries.sort((left, right) => {
    if (left.eventHash < right.eventHash) return -1;
    if (left.eventHash > right.eventHash) return 1;
    return 0;
  });

  return entries;
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

function payloadTimestamp(payload: EventPayload): number {
  switch (payload.type) {
    case EventType.CREATE_FILE:
      return payload.createdAt;
    case EventType.DELETE_FILE:
      return payload.deletedAt;
    case EventType.RENAME_FILE:
      return payload.renamedAt;
    case EventType.APP_RECORD:
    case EventType.CHAT_MESSAGE:
    case EventType.DECLARE_IDENTITY:
      return payload.publishedAt ?? 0;
    default:
      return 0;
  }
}

function nextPublishedTimestamp(
  entries: readonly { signedEvent: { payload: EventPayload } }[],
  fallbackNow: number
): number {
  let maxTimestamp = 0;
  for (const entry of entries) {
    const payload = entry.signedEvent.payload;
    const value = payloadTimestamp(payload);
    if (value > maxTimestamp) {
      maxTimestamp = value;
    }
  }
  return Math.max(fallbackNow, maxTimestamp + 1);
}

function profilesEqual(left: IdentityProfile, right: IdentityProfile): boolean {
  const leftBio = left.bio?.trim() ?? '';
  const rightBio = right.bio?.trim() ?? '';
  return left.displayName.trim() === right.displayName.trim() && leftBio === rightBio;
}

function publicKeysEqual(left: PublicKey, right: PublicKey): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

function normalizeSecret(secret: string): Secret {
  return createSecret(secret);
}
