import { ValidationError } from './errors.js';

/**
 * Branded type for SHA-256 hashes (64-character hex string)
 */
export type Hash = string & { readonly __brand: 'Hash' };

/**
 * Empty hash constant retained for inner compatibility payloads.
 */
export const EMPTY_HASH: Hash = '0000000000000000000000000000000000000000000000000000000000000000' as Hash;

/**
 * Branded type for encrypted data
 */
export type EncryptedData = Uint8Array & { readonly __brand: 'EncryptedData' };

/**
 * Branded type for cryptographic signatures
 */
export type Signature = Uint8Array & { readonly __brand: 'Signature' };

export const EVENT_ENVELOPE_VERSION = '0.2' as const;
export type EventEnvelopeVersion = typeof EVENT_ENVELOPE_VERSION;

/**
 * Creates a hash from a hex string with validation
 */
export function createHash(hex: string): Hash {
  const normalized = hex.toLowerCase().trim();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new InvalidHashError(
      `Hash must be 64-character hex string, got: ${hex.substring(0, 20)}...`
    );
  }
  return normalized as Hash;
}

export function createEncryptedData(bytes: Uint8Array): EncryptedData {
  return bytes as EncryptedData;
}

export function createSignature(bytes: Uint8Array): Signature {
  return bytes as Signature;
}

/**
 * Inner semantic event type discriminator.
 */
export enum EventType {
  CREATE_FILE = 'CREATE_FILE',
  DELETE_FILE = 'DELETE_FILE',
  RENAME_FILE = 'RENAME_FILE',
  DECLARE_IDENTITY = 'DECLARE_IDENTITY',
  CHAT_MESSAGE = 'CHAT_MESSAGE',
  APP_RECORD = 'APP_RECORD',
}

/**
 * Inner encrypted event payload structure.
 */
export interface EventPayload {
  readonly type: EventType;
  readonly fileName: string;
  readonly toFileName?: string;
  readonly hash: Hash;
  readonly encryptedKey: EncryptedData;
  readonly contentType?: 'b' | 'm';
  readonly size?: number;
  readonly mimeType?: string;
  readonly createdAt?: number;
  readonly deletedAt?: number;
  readonly renamedAt?: number;
  readonly authorPublicKey?: string;
  readonly protocol?: string;
  readonly record?: string;
  readonly message?: string;
  readonly publishedAt?: number;
}

/**
 * Outer visible event envelope.
 */
export interface EventEnvelope {
  readonly version: EventEnvelopeVersion;
  readonly publicKey: string;
  readonly blockRefs: readonly Hash[];
  readonly ciphertext: EncryptedData;
}

/**
 * Stored signed event. The semantic payload is encrypted and not persisted in cleartext.
 */
export interface SignedEvent {
  readonly envelope: EventEnvelope;
  readonly payload?: EventPayload;
  readonly signature: Signature;
}

/**
 * In-memory signed event with decrypted payload attached.
 */
export interface DecryptedEvent extends SignedEvent {
  readonly payload: EventPayload;
}

/**
 * JSON-serializable stored event format.
 */
export interface SerializedEvent {
  readonly envelope: {
    readonly version: EventEnvelopeVersion;
    readonly publicKey: string;
    readonly blockRefs: readonly string[];
    readonly ciphertext: string;
  };
  readonly signature: string;
}

/**
 * JSON-serializable decrypted payload format used only in trusted local APIs/tests.
 */
export interface SerializedEventPayload {
  readonly type: string;
  readonly fileName: string;
  readonly toFileName?: string;
  readonly hash: string;
  readonly encryptedKey: string;
  readonly contentType?: 'b' | 'm';
  readonly size?: number;
  readonly mimeType?: string;
  readonly createdAt?: number;
  readonly deletedAt?: number;
  readonly renamedAt?: number;
  readonly authorPublicKey?: string;
  readonly protocol?: string;
  readonly record?: string;
  readonly message?: string;
  readonly publishedAt?: number;
}

export class InvalidHashError extends ValidationError {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidHashError';
  }
}
