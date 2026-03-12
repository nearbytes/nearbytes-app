import { ValidationError } from './errors.js';

/**
 * Branded type for SHA-256 hashes (64-character hex string)
 */
export type Hash = string & { readonly __brand: 'Hash' };

/**
 * Empty hash constant (all zeros)
 * Used for DELETE_FILE events where no data hash is needed
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

/**
 * Creates a hash from a hex string with validation
 * @param hex - 64-character hexadecimal string
 * @returns Branded Hash
 * @throws InvalidHashError if hex string is invalid
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

/**
 * Creates encrypted data from a byte array
 * @param bytes - Encrypted bytes
 * @returns Branded EncryptedData
 */
export function createEncryptedData(bytes: Uint8Array): EncryptedData {
  return bytes as EncryptedData;
}

/**
 * Creates a signature from a byte array
 * @param bytes - Signature bytes
 * @returns Branded Signature
 */
export function createSignature(bytes: Uint8Array): Signature {
  return bytes as Signature;
}

/**
 * Event type discriminator
 * CREATE_FILE: Adds a file to the volume
 * DELETE_FILE: Removes a file from the volume
 * RENAME_FILE: Renames a logical filename within the volume
 * DECLARE_IDENTITY: Legacy outer event for identity records
 * CHAT_MESSAGE: Legacy outer event for chat messages
 * APP_RECORD: Generic outer event for canonical JSON application records
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
 * Event payload structure containing event type, file name, hash, and encrypted key
 * 
 * For CREATE_FILE events:
 * - fileName: The name of the file being created
 * - hash: Content hash of the encrypted data block
 * - encryptedKey: Encrypted symmetric key used to encrypt the data
 * 
 * For DELETE_FILE events:
 * - fileName: The name of the file being deleted
 * - hash: Must be empty hash (all zeros) - not used for deletion
 * - encryptedKey: Must be empty - not used for deletion
 *
 * For RENAME_FILE events:
 * - fileName: The source logical filename
 * - toFileName: The destination logical filename
 * - hash: Must be empty hash (all zeros) - not used for rename
 * - encryptedKey: Must be empty - not used for rename
 *
 * For DECLARE_IDENTITY events:
 * - fileName: Reserved, MUST be empty
 * - hash: Must be empty hash (all zeros)
 * - encryptedKey: Must be empty
 * - authorPublicKey: Signer identity public key hex
 * - record: Canonical JSON string encoding of nb.identity.record.v1
 * - publishedAt: Event publication timestamp
 *
 * For CHAT_MESSAGE events:
 * - fileName: Reserved, MUST be empty
 * - hash: Must be empty hash (all zeros)
 * - encryptedKey: Must be empty
 * - authorPublicKey: Signer identity public key hex
 * - message: Canonical JSON string encoding of nb.chat.message.v1
 * - publishedAt: Event publication timestamp
 *
 * For APP_RECORD events:
 * - fileName: Reserved, MUST be empty
 * - hash: Must be empty hash (all zeros)
 * - encryptedKey: Must be empty
 * - authorPublicKey: Nested signer identity/public key hex
 * - protocol: Nested canonical JSON protocol id (must equal nested p field)
 * - record: Canonical JSON string encoding of the nested app record
 * - publishedAt: Event publication timestamp
 */
export interface EventPayload {
  readonly type: EventType;
  readonly fileName: string;
  readonly toFileName?: string;
  readonly hash: Hash;
  readonly encryptedKey: EncryptedData;
  /**
   * Ciphertext descriptor type for CREATE_FILE ('b' = block, 'm' = manifest)
   */
  readonly contentType?: 'b' | 'm';
  /**
   * Original plaintext size in bytes (CREATE_FILE only)
   */
  readonly size?: number;
  /**
   * Optional MIME type of the file (CREATE_FILE only)
   */
  readonly mimeType?: string;
  /**
   * Unix timestamp in milliseconds when the file was created (CREATE_FILE only)
   */
  readonly createdAt?: number;
  /**
   * Unix timestamp in milliseconds when the file was deleted (DELETE_FILE only)
   */
  readonly deletedAt?: number;
  /**
   * Unix timestamp in milliseconds when the file was renamed (RENAME_FILE only)
   */
  readonly renamedAt?: number;
  /**
   * Identity/public key hex for DECLARE_IDENTITY, CHAT_MESSAGE, and APP_RECORD events
   */
  readonly authorPublicKey?: string;
  /**
   * Nested app record protocol id for APP_RECORD events
   */
  readonly protocol?: string;
  /**
   * Canonical JSON string encoding of nested record data
   */
  readonly record?: string;
  /**
   * Canonical JSON string encoding of nb.chat.message.v1
   */
  readonly message?: string;
  /**
   * Unix timestamp in milliseconds when the chat/identity event was published
   */
  readonly publishedAt?: number;
}

/**
 * Signed event structure containing payload and signature
 */
export interface SignedEvent {
  readonly payload: EventPayload;
  readonly signature: Signature;
}

/**
 * JSON-serializable event format
 */
export interface SerializedEvent {
  readonly payload: {
    readonly type: string; // EventType as string
    readonly fileName: string;
    readonly toFileName?: string;
    readonly hash: string;
    readonly encryptedKey: string; // Base64
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
  };
  readonly signature: string; // Base64
}

/**
 * Error thrown when a hash is invalid
 */
export class InvalidHashError extends ValidationError {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidHashError';
  }
}
