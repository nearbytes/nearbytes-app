import {
  createHash,
  type Hash,
  type SerializedEvent,
  type SignedEvent,
} from '../types/events.js';
import { computeHash } from '../crypto/hash.js';
import { verifyPU } from '../crypto/asymmetric.js';
import { createPublicKey, type PublicKey } from '../types/keys.js';
import { deserializeEvent, serializeEventEnvelope } from './serialization.js';

export interface IntegrityValidationResult {
  readonly ok: boolean;
  readonly code?: string;
  readonly detail?: string;
}

export const HASH_HEX_REGEX = /^[a-f0-9]{64}$/i;
export const VOLUME_ID_HEX_REGEX = /^[a-f0-9]{130}$/i;
const BLOCK_RELATIVE_PATH_REGEX = /^blocks\/([a-f0-9]{64})\.bin$/i;
const EVENT_RELATIVE_PATH_REGEX = /^channels\/([a-f0-9]{130})\/([a-f0-9]{64})\.bin$/i;

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

  const envelopeBytes = serializeEventEnvelope(parsedEvent.envelope);
  const payloadHash = await computeHash(envelopeBytes);
  if (payloadHash !== normalizedHash) {
    return {
      ok: false,
      code: 'event-hash-mismatch',
      detail: `Expected event hash ${normalizedHash}, got ${payloadHash}`,
    };
  }

  const signatureValid = await verifyPU(envelopeBytes, parsedEvent.signature, publicKey).catch(() => false);
  if (!signatureValid) {
    return {
      ok: false,
      code: 'event-signature-invalid',
      detail: `Signature verification failed for event ${normalizedHash}`,
    };
  }

  if (parsedEvent.envelope.publicKey !== publicKeyHex.toLowerCase()) {
    return {
      ok: false,
      code: 'event-format-invalid',
      detail: 'Event envelope public key does not match channel path',
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

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+/u, '').trim();
}
