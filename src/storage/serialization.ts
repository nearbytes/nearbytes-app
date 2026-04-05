import type {
  DecryptedEvent,
  EventEnvelope,
  EventPayload,
  SerializedEvent,
  SerializedEventPayload,
  SignedEvent,
} from '../types/events.js';
import {
  EVENT_ENVELOPE_VERSION,
  EventType,
  createEncryptedData,
  createHash,
  createSignature,
} from '../types/events.js';
import { base64ToBytes, bytesToBase64 } from '../utils/encoding.js';

export function serializeEvent(event: SignedEvent): SerializedEvent {
  return {
    envelope: {
      version: event.envelope.version,
      publicKey: event.envelope.publicKey,
      blockRefs: event.envelope.blockRefs,
      ciphertext: bytesToBase64(event.envelope.ciphertext),
    },
    signature: bytesToBase64(event.signature),
  };
}

export function deserializeEvent(data: SerializedEvent): SignedEvent {
  if (data.envelope.version !== EVENT_ENVELOPE_VERSION) {
    throw new Error(`Unsupported event envelope version: ${String(data.envelope.version)}`);
  }
  if (typeof data.envelope.publicKey !== 'string' || !/^[0-9a-f]{130}$/i.test(data.envelope.publicKey)) {
    throw new Error('Invalid event public key');
  }
  if (!Array.isArray(data.envelope.blockRefs)) {
    throw new Error('Invalid event blockRefs');
  }
  const blockRefs = data.envelope.blockRefs.map((value) => {
    if (typeof value !== 'string') {
      throw new Error('Invalid event blockRef');
    }
    return createHash(value);
  });

  return {
    envelope: {
      version: EVENT_ENVELOPE_VERSION,
      publicKey: data.envelope.publicKey.toLowerCase(),
      blockRefs,
      ciphertext: createEncryptedData(base64ToBytes(data.envelope.ciphertext)),
    },
    signature: createSignature(base64ToBytes(data.signature)),
  };
}

export function serializeEventEnvelope(envelope: EventEnvelope): Uint8Array {
  if (envelope.version !== EVENT_ENVELOPE_VERSION) {
    throw new Error(`Unsupported event envelope version: ${String(envelope.version)}`);
  }
  if (!/^[0-9a-f]{130}$/i.test(envelope.publicKey)) {
    throw new Error('Invalid event public key');
  }
  const encoded = JSON.stringify({
    version: envelope.version,
    publicKey: envelope.publicKey.toLowerCase(),
    blockRefs: envelope.blockRefs,
    ciphertext: bytesToBase64(envelope.ciphertext),
  });
  return new TextEncoder().encode(encoded);
}

export function serializeInnerEventPayload(payload: EventPayload): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(serializeInnerEventPayloadJson(payload)));
}

export function deserializeInnerEventPayload(data: Uint8Array): EventPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(data));
  } catch (error) {
    throw new Error(`Invalid inner event payload JSON: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
  return deserializeInnerEventPayloadJson(parsed);
}

export function serializeInnerEventPayloadJson(payload: EventPayload): SerializedEventPayload {
  const result: Record<string, unknown> = {
    type: payload.type,
    fileName: payload.fileName,
    hash: payload.hash,
    encryptedKey: bytesToBase64(payload.encryptedKey),
  };

  if (payload.toFileName !== undefined) result.toFileName = payload.toFileName;
  if (payload.contentType !== undefined) result.contentType = payload.contentType;
  if (payload.size !== undefined) result.size = payload.size;
  if (payload.mimeType !== undefined) result.mimeType = payload.mimeType;
  if (payload.createdAt !== undefined) result.createdAt = payload.createdAt;
  if (payload.deletedAt !== undefined) result.deletedAt = payload.deletedAt;
  if (payload.renamedAt !== undefined) result.renamedAt = payload.renamedAt;
  if (payload.authorPublicKey !== undefined) result.authorPublicKey = payload.authorPublicKey;
  if (payload.protocol !== undefined) result.protocol = payload.protocol;
  if (payload.record !== undefined) result.record = payload.record;
  if (payload.message !== undefined) result.message = payload.message;
  if (payload.publishedAt !== undefined) result.publishedAt = payload.publishedAt;

  return result as unknown as SerializedEventPayload;
}

// Transitional alias while callers move from cleartext payload signing to envelope signing.
export const serializeEventPayload = serializeInnerEventPayload;

export function deserializeInnerEventPayloadJson(data: unknown): EventPayload {
  if (typeof data !== 'object' || data === null) {
    throw new Error('Event payload must be an object');
  }
  const payload = data as Record<string, unknown>;
  if (!Object.values(EventType).includes(payload.type as EventType)) {
    throw new Error(`Invalid event type: ${String(payload.type)}`);
  }
  if (typeof payload.fileName !== 'string') {
    throw new Error('Invalid fileName');
  }
  if (typeof payload.hash !== 'string') {
    throw new Error('Invalid hash');
  }
  if (typeof payload.encryptedKey !== 'string') {
    throw new Error('Invalid encryptedKey');
  }
  if (payload.toFileName !== undefined && typeof payload.toFileName !== 'string') {
    throw new Error('Invalid toFileName');
  }
  if (payload.contentType !== undefined && payload.contentType !== 'b' && payload.contentType !== 'm') {
    throw new Error('Invalid contentType');
  }
  if (payload.size !== undefined) assertFiniteUint(payload.size, 'size');
  if (payload.createdAt !== undefined) assertFiniteUint(payload.createdAt, 'createdAt');
  if (payload.deletedAt !== undefined) assertFiniteUint(payload.deletedAt, 'deletedAt');
  if (payload.renamedAt !== undefined) assertFiniteUint(payload.renamedAt, 'renamedAt');
  if (payload.publishedAt !== undefined) assertFiniteUint(payload.publishedAt, 'publishedAt');
  if (payload.mimeType !== undefined && typeof payload.mimeType !== 'string') throw new Error('Invalid mimeType');
  if (payload.authorPublicKey !== undefined && typeof payload.authorPublicKey !== 'string') {
    throw new Error('Invalid authorPublicKey');
  }
  if (payload.protocol !== undefined && typeof payload.protocol !== 'string') throw new Error('Invalid protocol');
  if (payload.record !== undefined && typeof payload.record !== 'string') throw new Error('Invalid record');
  if (payload.message !== undefined && typeof payload.message !== 'string') throw new Error('Invalid message');

  return {
    type: payload.type as EventType,
    fileName: payload.fileName,
    toFileName: payload.toFileName as string | undefined,
    hash: createHash(payload.hash),
    encryptedKey: createEncryptedData(base64ToBytes(payload.encryptedKey)),
    contentType: payload.contentType as 'b' | 'm' | undefined,
    size: payload.size as number | undefined,
    mimeType: payload.mimeType as string | undefined,
    createdAt: payload.createdAt as number | undefined,
    deletedAt: payload.deletedAt as number | undefined,
    renamedAt: payload.renamedAt as number | undefined,
    authorPublicKey: payload.authorPublicKey as string | undefined,
    protocol: payload.protocol as string | undefined,
    record: payload.record as string | undefined,
    message: payload.message as string | undefined,
    publishedAt: payload.publishedAt as number | undefined,
  };
}

export function withDecryptedPayload(event: SignedEvent, payload: EventPayload): DecryptedEvent {
  return {
    ...event,
    payload,
  };
}

function assertFiniteUint(value: unknown, label: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid ${label}`);
  }
}
