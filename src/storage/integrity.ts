import { createHash, type Hash, type SerializedEvent, type SignedEvent } from '../types/events.js';
import { computeHash } from '../crypto/hash.js';
import { verifyPU } from '../crypto/asymmetric.js';
import { createPublicKey, type PublicKey } from '../types/keys.js';
import { deserializeEvent, serializeEventPayload } from './serialization.js';

export interface IntegrityValidationResult {
  readonly ok: boolean;
  readonly code?: string;
  readonly detail?: string;
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

  return { ok: true };
}

export function normalizeHash(value: string): Hash | null {
  try {
    return createHash(value.trim().toLowerCase());
  } catch {
    return null;
  }
}

export function publicKeyFromHex(value: string): PublicKey | null {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-f0-9]{130}$/i.test(normalized)) {
    return null;
  }
  const bytes = new Uint8Array(normalized.length / 2);
  for (let index = 0; index < normalized.length; index += 2) {
    bytes[index / 2] = Number.parseInt(normalized.slice(index, index + 2), 16);
  }
  return createPublicKey(bytes);
}