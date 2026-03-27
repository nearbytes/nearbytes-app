import { createCryptoOperations, type CryptoOperations } from '../crypto/index.js';
import {
  EMPTY_HASH,
  EventType,
  createHash,
  type EventPayload,
  type Hash,
  type SerializedEvent,
  type SignedEvent,
} from '../types/events.js';
import { computeHash } from '../crypto/hash.js';
import { verifyPU } from '../crypto/asymmetric.js';
import { createPublicKey, type PublicKey } from '../types/keys.js';
import {
  parseChatMessageJson,
  parseIdentityRecordJson,
  parseIdentitySnapshotJson,
  verifyChatMessage,
  verifyIdentityRecord,
  verifyIdentitySnapshot,
} from '../domain/chatCodec.js';
import { deserializeEvent, serializeEventPayload } from './serialization.js';

export interface IntegrityValidationResult {
  readonly ok: boolean;
  readonly code?: string;
  readonly detail?: string;
}

export const HASH_HEX_REGEX = /^[a-f0-9]{64}$/i;
export const VOLUME_ID_HEX_REGEX = /^[a-f0-9]{130}$/i;
const BLOCK_RELATIVE_PATH_REGEX = /^blocks\/([a-f0-9]{64})\.bin$/i;
const EVENT_RELATIVE_PATH_REGEX = /^channels\/([a-f0-9]{130})\/([a-f0-9]{64})\.bin$/i;

let integrityCrypto: CryptoOperations | null = null;

function getIntegrityCrypto(): CryptoOperations {
  integrityCrypto ??= createCryptoOperations();
  return integrityCrypto;
}

export async function validateBlockBytes(expectedHash: string, data: Uint8Array): Promise<IntegrityValidationResult> {
  const normalizedHash = normalizeHash(expectedHash);
  if (!normalizedHash) {
    return {
      ok: false,
      code: 'invalid-block-path',
      detail: `Block path does not contain a valid hash: ${expectedHash}`,
    };
  }
  const actualHash = await computeHash(data);
  if (actualHash !== normalizedHash) {
    return {
      ok: false,
      code: 'block-hash-mismatch',
      detail: `Expected block hash ${normalizedHash}, got ${actualHash}`,
    };
  }
  return { ok: true };
}

export async function validateEventBytes(
  publicKeyHex: string,
  expectedEventHash: string,
  data: Uint8Array
): Promise<IntegrityValidationResult> {
  const publicKey = publicKeyFromHex(publicKeyHex);
  if (!publicKey) {
    return {
      ok: false,
      code: 'invalid-channel-path',
      detail: `Channel path does not contain a valid public key: ${publicKeyHex}`,
    };
  }

  const normalizedHash = normalizeHash(expectedEventHash);
  if (!normalizedHash) {
    return {
      ok: false,
      code: 'invalid-event-path',
      detail: `Event path does not contain a valid hash: ${expectedEventHash}`,
    };
  }

  let parsedEvent: SignedEvent;
  try {
    parsedEvent = deserializeEvent(JSON.parse(new TextDecoder().decode(data)) as SerializedEvent);
  } catch (error) {
    return {
      ok: false,
      code: 'event-deserialize-failed',
      detail: error instanceof Error ? error.message : 'Event data is not readable',
    };
  }

  const payloadBytes = serializeEventPayload(parsedEvent.payload);
  const payloadHash = await computeHash(payloadBytes);
  if (payloadHash !== normalizedHash) {
    return {
      ok: false,
      code: 'event-hash-mismatch',
      detail: `Expected event hash ${normalizedHash}, got ${payloadHash}`,
    };
  }

  const signatureValid = await verifyPU(payloadBytes, parsedEvent.signature, publicKey).catch(() => false);
  if (!signatureValid) {
    return {
      ok: false,
      code: 'event-signature-invalid',
      detail: `Signature verification failed for event ${normalizedHash}`,
    };
  }

  const payloadValidation = await validateEventPayload(parsedEvent.payload);
  if (!payloadValidation.ok) {
    return payloadValidation;
  }

  return { ok: true };
}

export function normalizeHash(value: string): Hash | null {
  try {
    return createHash(value.trim().toLowerCase());
  } catch {
    return null;
  }
}

export function normalizeVolumeId(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  return VOLUME_ID_HEX_REGEX.test(normalized) ? normalized : null;
}

export function parseCanonicalBlockRelativePath(relativePath: string): { readonly hash: Hash } | null {
  const match = BLOCK_RELATIVE_PATH_REGEX.exec(normalizeRelativePath(relativePath));
  if (!match || !match[1]) {
    return null;
  }
  const hash = normalizeHash(match[1]);
  return hash ? { hash } : null;
}

export function parseCanonicalEventRelativePath(
  relativePath: string
): { readonly volumeId: string; readonly eventHash: Hash } | null {
  const match = EVENT_RELATIVE_PATH_REGEX.exec(normalizeRelativePath(relativePath));
  if (!match || !match[1] || !match[2]) {
    return null;
  }
  const volumeId = normalizeVolumeId(match[1]);
  const eventHash = normalizeHash(match[2]);
  if (!volumeId || !eventHash) {
    return null;
  }
  return { volumeId, eventHash };
}

export async function validateCanonicalStorageFile(
  relativePath: string,
  data: Uint8Array
): Promise<IntegrityValidationResult> {
  const block = parseCanonicalBlockRelativePath(relativePath);
  if (block) {
    return validateBlockBytes(block.hash, data);
  }

  const event = parseCanonicalEventRelativePath(relativePath);
  if (event) {
    return validateEventBytes(event.volumeId, event.eventHash, data);
  }

  return {
    ok: false,
    code: 'invalid-storage-path',
    detail: `Path is not canonical Nearbytes storage data: ${relativePath}`,
  };
}

export function publicKeyFromHex(value: string): PublicKey | null {
  const normalized = normalizeVolumeId(value);
  if (!normalized) {
    return null;
  }
  const bytes = new Uint8Array(normalized.length / 2);
  for (let index = 0; index < normalized.length; index += 2) {
    bytes[index / 2] = Number.parseInt(normalized.slice(index, index + 2), 16);
  }
  return createPublicKey(bytes);
}

async function validateEventPayload(payload: EventPayload): Promise<IntegrityValidationResult> {
  switch (payload.type) {
    case EventType.CREATE_FILE:
      return payload.fileName.trim().length > 0
        ? { ok: true }
        : invalidEventPayload('CREATE_FILE must have a non-empty fileName');
    case EventType.DELETE_FILE:
      if (payload.fileName.trim().length === 0) {
        return invalidEventPayload('DELETE_FILE must have a non-empty fileName');
      }
      if (payload.hash !== EMPTY_HASH) {
        return invalidEventPayload('DELETE_FILE must use EMPTY_HASH');
      }
      if (payload.encryptedKey.length !== 0) {
        return invalidEventPayload('DELETE_FILE must use an empty encryptedKey');
      }
      return { ok: true };
    case EventType.RENAME_FILE:
      if (payload.fileName.trim().length === 0 || !payload.toFileName || payload.toFileName.trim().length === 0) {
        return invalidEventPayload('RENAME_FILE must have non-empty source and destination filenames');
      }
      if (payload.hash !== EMPTY_HASH) {
        return invalidEventPayload('RENAME_FILE must use EMPTY_HASH');
      }
      if (payload.encryptedKey.length !== 0) {
        return invalidEventPayload('RENAME_FILE must use an empty encryptedKey');
      }
      return { ok: true };
    case EventType.DECLARE_IDENTITY:
      return validateLegacyIdentityPayload(payload);
    case EventType.CHAT_MESSAGE:
      return validateLegacyChatPayload(payload);
    case EventType.APP_RECORD:
      return validateAppRecordPayload(payload);
    default:
      return invalidEventPayload(`Unsupported event type: ${String((payload as { type?: unknown }).type ?? 'unknown')}`);
  }
}

async function validateLegacyIdentityPayload(payload: EventPayload): Promise<IntegrityValidationResult> {
  const reservedValidation = validateReservedAppCarrierFields(payload, 'DECLARE_IDENTITY');
  if (!reservedValidation.ok) {
    return reservedValidation;
  }
  if (!payload.authorPublicKey) {
    return invalidEventPayload('DECLARE_IDENTITY must include authorPublicKey');
  }
  if (!payload.record) {
    return invalidEventPayload('DECLARE_IDENTITY must include record');
  }
  if (payload.publishedAt === undefined) {
    return invalidEventPayload('DECLARE_IDENTITY must include publishedAt');
  }
  const record = parseIdentityRecordJson(payload.record);
  if (!record) {
    return invalidEventPayload('DECLARE_IDENTITY record must be a valid nb.identity.record.v1 payload');
  }
  if (record.k !== payload.authorPublicKey) {
    return invalidEventPayload('DECLARE_IDENTITY authorPublicKey must match the nested identity record key');
  }
  if (!(await verifyIdentityRecord(getIntegrityCrypto(), record))) {
    return {
      ok: false,
      code: 'nested-signature-invalid',
      detail: 'DECLARE_IDENTITY nested identity signature verification failed',
    };
  }
  return { ok: true };
}

async function validateLegacyChatPayload(payload: EventPayload): Promise<IntegrityValidationResult> {
  const reservedValidation = validateReservedAppCarrierFields(payload, 'CHAT_MESSAGE');
  if (!reservedValidation.ok) {
    return reservedValidation;
  }
  if (!payload.authorPublicKey) {
    return invalidEventPayload('CHAT_MESSAGE must include authorPublicKey');
  }
  if (!payload.message) {
    return invalidEventPayload('CHAT_MESSAGE must include message');
  }
  if (payload.publishedAt === undefined) {
    return invalidEventPayload('CHAT_MESSAGE must include publishedAt');
  }
  const message = parseChatMessageJson(payload.message);
  if (!message) {
    return invalidEventPayload('CHAT_MESSAGE message must be a valid nb.chat.message.v1 payload');
  }
  if (message.k !== payload.authorPublicKey) {
    return invalidEventPayload('CHAT_MESSAGE authorPublicKey must match the nested chat signer key');
  }
  if (!(await verifyChatMessage(getIntegrityCrypto(), message))) {
    return {
      ok: false,
      code: 'nested-signature-invalid',
      detail: 'CHAT_MESSAGE nested chat signature verification failed',
    };
  }
  return { ok: true };
}

async function validateAppRecordPayload(payload: EventPayload): Promise<IntegrityValidationResult> {
  const reservedValidation = validateReservedAppCarrierFields(payload, 'APP_RECORD');
  if (!reservedValidation.ok) {
    return reservedValidation;
  }
  if (!payload.authorPublicKey) {
    return invalidEventPayload('APP_RECORD must include authorPublicKey');
  }
  if (!payload.protocol || payload.protocol.trim().length === 0) {
    return invalidEventPayload('APP_RECORD must include protocol');
  }
  if (!payload.record) {
    return invalidEventPayload('APP_RECORD must include record');
  }
  if (payload.publishedAt === undefined) {
    return invalidEventPayload('APP_RECORD must include publishedAt');
  }

  if (payload.protocol === 'nb.identity.record.v1') {
    const record = parseIdentityRecordJson(payload.record);
    if (!record) {
      return invalidEventPayload('APP_RECORD record must match protocol nb.identity.record.v1');
    }
    if (record.k !== payload.authorPublicKey) {
      return invalidEventPayload('APP_RECORD authorPublicKey must match the nested identity record key');
    }
    if (!(await verifyIdentityRecord(getIntegrityCrypto(), record))) {
      return {
        ok: false,
        code: 'nested-signature-invalid',
        detail: 'APP_RECORD nested identity signature verification failed',
      };
    }
    return { ok: true };
  }

  if (payload.protocol === 'nb.identity.snapshot.v1') {
    const snapshot = parseIdentitySnapshotJson(payload.record);
    if (!snapshot) {
      return invalidEventPayload('APP_RECORD record must match protocol nb.identity.snapshot.v1');
    }
    if (snapshot.k !== payload.authorPublicKey) {
      return invalidEventPayload('APP_RECORD authorPublicKey must match the nested identity snapshot key');
    }
    if (!(await verifyIdentitySnapshot(getIntegrityCrypto(), snapshot))) {
      return {
        ok: false,
        code: 'nested-signature-invalid',
        detail: 'APP_RECORD nested identity snapshot signature verification failed',
      };
    }
    return { ok: true };
  }

  if (payload.protocol === 'nb.chat.message.v1') {
    const message = parseChatMessageJson(payload.record);
    if (!message) {
      return invalidEventPayload('APP_RECORD record must match protocol nb.chat.message.v1');
    }
    if (message.k !== payload.authorPublicKey) {
      return invalidEventPayload('APP_RECORD authorPublicKey must match the nested chat signer key');
    }
    if (!(await verifyChatMessage(getIntegrityCrypto(), message))) {
      return {
        ok: false,
        code: 'nested-signature-invalid',
        detail: 'APP_RECORD nested chat signature verification failed',
      };
    }
    return { ok: true };
  }

  return invalidEventPayload(`APP_RECORD uses unsupported protocol: ${payload.protocol}`);
}

function validateReservedAppCarrierFields(payload: EventPayload, eventType: string): IntegrityValidationResult {
  if (payload.fileName !== '') {
    return invalidEventPayload(`${eventType} must use an empty fileName`);
  }
  if (payload.hash !== EMPTY_HASH) {
    return invalidEventPayload(`${eventType} must use EMPTY_HASH`);
  }
  if (payload.encryptedKey.length !== 0) {
    return invalidEventPayload(`${eventType} must use an empty encryptedKey`);
  }
  return { ok: true };
}

function invalidEventPayload(detail: string): IntegrityValidationResult {
  return {
    ok: false,
    code: 'event-format-invalid',
    detail,
  };
}

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+/u, '').trim();
}