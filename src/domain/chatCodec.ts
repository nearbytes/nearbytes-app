import type { CryptoOperations } from '../crypto/index.js';
import type { KeyPair, PublicKey } from '../types/keys.js';
import { createPublicKey } from '../types/keys.js';
import { createHash, createSignature } from '../types/events.js';
import { base64UrlToBytes, bytesToBase64Url, bytesToHex, hexToBytes } from '../utils/encoding.js';
import {
  canonicalJsonBytes,
  canonicalJsonString,
  type SourceFileReference,
  parseSourceFileReferenceValue,
} from './fileReferenceCodec.js';

export interface IdentityProfile {
  readonly displayName: string;
  readonly bio?: string;
}

export interface IdentityRecord {
  readonly p: 'nb.identity.record.v1';
  readonly k: string;
  readonly ts: number;
  readonly profile: IdentityProfile;
  readonly sig: string;
}

export interface IdentitySnapshot {
  readonly p: 'nb.identity.snapshot.v1';
  readonly k: string;
  readonly ts: number;
  readonly ref: {
    readonly channel: string;
    readonly eventHash: string;
  };
  readonly record: IdentityRecord;
  readonly sig: string;
}

export interface ChatAttachment {
  readonly kind: 'nb.src.ref.v1';
  readonly name: string;
  readonly mime?: string;
  readonly createdAt?: number;
  readonly ref: SourceFileReference;
}

export interface ChatMessage {
  readonly p: 'nb.chat.message.v1';
  readonly k: string;
  readonly ts: number;
  readonly body?: string;
  readonly attachment?: ChatAttachment;
  readonly sig: string;
}

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { readonly [key: string]: JsonValue };

export async function createIdentityRecord(
  crypto: CryptoOperations,
  keyPair: KeyPair,
  profile: IdentityProfile,
  timestamp: number
): Promise<IdentityRecord> {
  const unsigned = canonicalIdentityRecord(keyPair.publicKey, profile, timestamp);
  const signature = await crypto.signPR(canonicalJsonBytes(unsigned as unknown as JsonValue), keyPair.privateKey);
  return {
    ...unsigned,
    sig: bytesToBase64Url(signature),
  };
}

export async function verifyIdentityRecord(
  crypto: CryptoOperations,
  record: IdentityRecord
): Promise<boolean> {
  const publicKey = publicKeyFromHex(record.k);
  const unsigned = canonicalIdentityRecord(publicKey, record.profile, record.ts);
  return crypto.verifyPU(
    canonicalJsonBytes(unsigned as unknown as JsonValue),
    createSignature(base64UrlToBytes(record.sig)),
    publicKey
  );
}

export async function createChatMessage(
  crypto: CryptoOperations,
  keyPair: KeyPair,
  input: {
    body?: string;
    attachment?: ChatAttachment;
    timestamp: number;
  }
): Promise<ChatMessage> {
  const unsigned = canonicalChatMessage(keyPair.publicKey, input.body, input.attachment, input.timestamp);
  const signature = await crypto.signPR(canonicalJsonBytes(unsigned as unknown as JsonValue), keyPair.privateKey);
  return {
    ...unsigned,
    sig: bytesToBase64Url(signature),
  };
}

export async function verifyChatMessage(
  crypto: CryptoOperations,
  message: ChatMessage
): Promise<boolean> {
  const publicKey = publicKeyFromHex(message.k);
  const unsigned = canonicalChatMessage(publicKey, message.body, message.attachment, message.ts);
  return crypto.verifyPU(
    canonicalJsonBytes(unsigned as unknown as JsonValue),
    createSignature(base64UrlToBytes(message.sig)),
    publicKey
  );
}

export async function createIdentitySnapshot(
  crypto: CryptoOperations,
  keyPair: KeyPair,
  input: {
    record: IdentityRecord;
    ref: {
      channel: string;
      eventHash: string;
    };
    timestamp: number;
  }
): Promise<IdentitySnapshot> {
  const unsigned = canonicalIdentitySnapshot(keyPair.publicKey, input.record, input.ref, input.timestamp);
  const signature = await crypto.signPR(canonicalJsonBytes(unsigned as unknown as JsonValue), keyPair.privateKey);
  return {
    ...unsigned,
    sig: bytesToBase64Url(signature),
  };
}

export async function verifyIdentitySnapshot(
  crypto: CryptoOperations,
  snapshot: IdentitySnapshot
): Promise<boolean> {
  const publicKey = publicKeyFromHex(snapshot.k);
  if (!(await verifyIdentityRecord(crypto, snapshot.record))) {
    return false;
  }
  const unsigned = canonicalIdentitySnapshot(publicKey, snapshot.record, snapshot.ref, snapshot.ts);
  return crypto.verifyPU(
    canonicalJsonBytes(unsigned as unknown as JsonValue),
    createSignature(base64UrlToBytes(snapshot.sig)),
    publicKey
  );
}

export function serializeIdentityRecord(record: IdentityRecord): string {
  return canonicalJsonString(record as unknown as JsonValue);
}

export function serializeIdentitySnapshot(snapshot: IdentitySnapshot): string {
  return canonicalJsonString(snapshot as unknown as JsonValue);
}

export function serializeChatMessage(message: ChatMessage): string {
  return canonicalJsonString(message as unknown as JsonValue);
}

export function parseIdentityRecord(value: unknown): IdentityRecord {
  const object = asObject(value, 'Identity record must be an object');
  if (object.p !== 'nb.identity.record.v1') {
    throw new Error('Unsupported identity record protocol');
  }
  const publicKey = parsePublicKeyHex(object.k, 'Identity record public key is invalid');
  const ts = parseTimestamp(object.ts, 'Identity record timestamp is invalid');
  const profile = parseIdentityProfile(object.profile);
  const sig = parseBase64UrlString(object.sig, 'Identity record signature is invalid');
  return {
    p: 'nb.identity.record.v1',
    k: publicKey,
    ts,
    profile,
    sig,
  };
}

export function parseIdentityRecordJson(text: string): IdentityRecord | null {
  const parsed = parseJsonProtocol(text);
  if (!parsed || parsed.p !== 'nb.identity.record.v1') {
    return null;
  }
  return parseIdentityRecord(parsed);
}

export function parseIdentitySnapshot(value: unknown): IdentitySnapshot {
  const object = asObject(value, 'Identity snapshot must be an object');
  if (object.p !== 'nb.identity.snapshot.v1') {
    throw new Error('Unsupported identity snapshot protocol');
  }
  const publicKey = parsePublicKeyHex(object.k, 'Identity snapshot public key is invalid');
  const ts = parseTimestamp(object.ts, 'Identity snapshot timestamp is invalid');
  const ref = parseIdentitySnapshotRef(object.ref);
  const record = parseIdentityRecord(object.record);
  if (record.k !== publicKey) {
    throw new Error('Identity snapshot record key does not match snapshot public key');
  }
  if (ref.channel !== publicKey) {
    throw new Error('Identity snapshot channel does not match snapshot public key');
  }
  const sig = parseBase64UrlString(object.sig, 'Identity snapshot signature is invalid');
  return {
    p: 'nb.identity.snapshot.v1',
    k: publicKey,
    ts,
    ref,
    record,
    sig,
  };
}

export function parseIdentitySnapshotJson(text: string): IdentitySnapshot | null {
  const parsed = parseJsonProtocol(text);
  if (!parsed || parsed.p !== 'nb.identity.snapshot.v1') {
    return null;
  }
  return parseIdentitySnapshot(parsed);
}

export function parseChatMessage(value: unknown): ChatMessage {
  const object = asObject(value, 'Chat message must be an object');
  if (object.p !== 'nb.chat.message.v1') {
    throw new Error('Unsupported chat message protocol');
  }
  const publicKey = parsePublicKeyHex(object.k, 'Chat message public key is invalid');
  const ts = parseTimestamp(object.ts, 'Chat message timestamp is invalid');
  const body = parseOptionalTrimmedString(object.body, 'Chat message body is invalid');
  const attachment = object.attachment === undefined ? undefined : parseChatAttachment(object.attachment);
  if (!body && !attachment) {
    throw new Error('Chat message must contain text or an attachment');
  }
  const sig = parseBase64UrlString(object.sig, 'Chat message signature is invalid');
  return {
    p: 'nb.chat.message.v1',
    k: publicKey,
    ts,
    body,
    attachment,
    sig,
  };
}

export function parseChatMessageJson(text: string): ChatMessage | null {
  const parsed = parseJsonProtocol(text);
  if (!parsed || parsed.p !== 'nb.chat.message.v1') {
    return null;
  }
  return parseChatMessage(parsed);
}

export function parseChatAttachmentValue(value: unknown): ChatAttachment {
  return parseChatAttachment(value);
}

function canonicalIdentityRecord(
  publicKey: PublicKey,
  profile: IdentityProfile,
  timestamp: number
): Omit<IdentityRecord, 'sig'> {
  return {
    p: 'nb.identity.record.v1',
    k: bytesToHex(publicKey),
    ts: timestamp,
    profile: normalizeIdentityProfile(profile),
  };
}

function canonicalIdentitySnapshot(
  publicKey: PublicKey,
  record: IdentityRecord,
  ref: {
    channel: string;
    eventHash: string;
  },
  timestamp: number
): Omit<IdentitySnapshot, 'sig'> {
  const normalizedRecord = parseIdentityRecord(record);
  const snapshotPublicKey = bytesToHex(publicKey);
  if (normalizedRecord.k !== snapshotPublicKey) {
    throw new Error('Identity snapshot record key does not match signer key');
  }
  const channel = parsePublicKeyHex(ref.channel, 'Identity snapshot channel is invalid');
  if (channel !== snapshotPublicKey) {
    throw new Error('Identity snapshot channel does not match signer key');
  }
  return {
    p: 'nb.identity.snapshot.v1',
    k: snapshotPublicKey,
    ts: timestamp,
    ref: {
      channel,
      eventHash: parseEventHashHex(ref.eventHash, 'Identity snapshot event hash is invalid'),
    },
    record: normalizedRecord,
  };
}

function canonicalChatMessage(
  publicKey: PublicKey,
  body: string | undefined,
  attachment: ChatAttachment | undefined,
  timestamp: number
): Omit<ChatMessage, 'sig'> {
  const normalizedBody = normalizeOptionalString(body);
  const normalizedAttachment = attachment ? normalizeAttachment(attachment) : undefined;
  if (!normalizedBody && !normalizedAttachment) {
    throw new Error('Chat message must contain text or an attachment');
  }
  return {
    p: 'nb.chat.message.v1',
    k: bytesToHex(publicKey),
    ts: timestamp,
    body: normalizedBody,
    attachment: normalizedAttachment,
  };
}

function normalizeIdentityProfile(profile: IdentityProfile): IdentityProfile {
  const displayName = profile.displayName.trim();
  if (displayName.length === 0) {
    throw new Error('Identity displayName is required');
  }
  const bio = normalizeOptionalString(profile.bio);
  return bio ? { displayName, bio } : { displayName };
}

function normalizeAttachment(attachment: ChatAttachment): ChatAttachment {
  const name = attachment.name.trim();
  if (name.length === 0) {
    throw new Error('Attachment name is required');
  }
  const mime = normalizeOptionalString(attachment.mime);
  const createdAt = attachment.createdAt;
  if (createdAt !== undefined && (!Number.isSafeInteger(createdAt) || createdAt < 0)) {
    throw new Error('Attachment createdAt must be a non-negative integer');
  }
  return {
    kind: 'nb.src.ref.v1',
    name,
    mime,
    createdAt,
    ref: parseSourceFileReferenceValue(attachment.ref),
  };
}

function parseIdentityProfile(value: unknown): IdentityProfile {
  const object = asObject(value, 'Identity profile must be an object');
  return normalizeIdentityProfile({
    displayName: parseRequiredString(object.displayName, 'Identity display name is invalid'),
    bio: parseOptionalTrimmedString(object.bio, 'Identity bio is invalid'),
  });
}

function parseChatAttachment(value: unknown): ChatAttachment {
  const object = asObject(value, 'Chat attachment must be an object');
  if (object.kind !== 'nb.src.ref.v1') {
    throw new Error('Unsupported chat attachment kind');
  }
  const createdAt =
    object.createdAt === undefined
      ? undefined
      : parseTimestamp(object.createdAt, 'Chat attachment createdAt is invalid');
  return normalizeAttachment({
    kind: 'nb.src.ref.v1',
    name: parseRequiredString(object.name, 'Chat attachment name is invalid'),
    mime: parseOptionalTrimmedString(object.mime, 'Chat attachment mime is invalid'),
    createdAt,
    ref: parseSourceFileReferenceValue(object.ref),
  });
}

function parseIdentitySnapshotRef(
  value: unknown
): {
  channel: string;
  eventHash: string;
} {
  const object = asObject(value, 'Identity snapshot ref must be an object');
  return {
    channel: parsePublicKeyHex(object.channel, 'Identity snapshot channel is invalid'),
    eventHash: parseEventHashHex(object.eventHash, 'Identity snapshot event hash is invalid'),
  };
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parsePublicKeyHex(value: unknown, message: string): string {
  if (typeof value !== 'string') {
    throw new Error(message);
  }
  return bytesToHex(publicKeyFromHex(value));
}

function parseEventHashHex(value: unknown, message: string): string {
  if (typeof value !== 'string') {
    throw new Error(message);
  }
  return createHash(value);
}

export function publicKeyFromHex(value: string): PublicKey {
  const bytes = hexToBytes(value.toLowerCase());
  if (bytes.length !== 65) {
    throw new Error('Identity public key must be 65 bytes');
  }
  return createPublicKey(bytes);
}

function parseRequiredString(value: unknown, message: string): string {
  if (typeof value !== 'string') {
    throw new Error(message);
  }
  return value;
}

function parseOptionalTrimmedString(value: unknown, message: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new Error(message);
  }
  return normalizeOptionalString(value);
}

function parseTimestamp(value: unknown, message: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(message);
  }
  return value;
}

function parseBase64UrlString(value: unknown, message: string): string {
  if (typeof value !== 'string') {
    throw new Error(message);
  }
  const bytes = base64UrlToBytes(value);
  if (bytes.length === 0) {
    throw new Error(message);
  }
  return bytesToBase64Url(bytes);
}

function parseJsonProtocol(text: string): { readonly p?: string } | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed as { readonly p?: string };
  } catch {
    return null;
  }
}

function asObject(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(message);
  }
  return value as Record<string, unknown>;
}
