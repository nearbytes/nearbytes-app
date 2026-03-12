import { ValidationError } from './errors.js';

/**
 * Branded type for symmetric encryption keys (32 bytes)
 */
export type SymmetricKey = Uint8Array & { readonly __brand: 'SymmetricKey' };

/**
 * Branded type for private keys
 */
export type PrivateKey = Uint8Array & { readonly __brand: 'PrivateKey' };

/**
 * Branded type for public keys
 */
export type PublicKey = Uint8Array & { readonly __brand: 'PublicKey' };

/**
 * Branded type for channel secrets
 */
export type Secret = string & { readonly __brand: 'Secret' };

/**
 * Key pair structure for asymmetric cryptography
 */
export interface KeyPair {
  readonly publicKey: PublicKey;
  readonly privateKey: PrivateKey;
}

/**
 * Creates a symmetric key from a byte array with validation
 * @param bytes - 32-byte array
 * @returns Branded SymmetricKey
 * @throws InvalidKeyError if bytes length is not 32
 */
export function createSymmetricKey(bytes: Uint8Array): SymmetricKey {
  if (bytes.length !== 32) {
    throw new InvalidKeyError(`Symmetric key must be 32 bytes, got ${bytes.length}`);
  }
  return bytes as SymmetricKey;
}

/**
 * Creates a secret from a string with validation
 * @param input - Secret string (e.g., "channelname:password")
 * @returns Branded Secret
 * @throws InvalidSecretError if secret is empty
 */
export function createSecret(input: string): Secret {
  if (input.length < 1) {
    throw new InvalidSecretError('Secret is required');
  }
  return input as Secret;
}

/**
 * Creates a private key from a byte array
 * @param bytes - Private key bytes
 * @returns Branded PrivateKey
 */
export function createPrivateKey(bytes: Uint8Array): PrivateKey {
  return bytes as PrivateKey;
}

/**
 * Creates a public key from a byte array
 * @param bytes - Public key bytes
 * @returns Branded PublicKey
 */
export function createPublicKey(bytes: Uint8Array): PublicKey {
  return bytes as PublicKey;
}

/**
 * Error thrown when a key is invalid
 */
export class InvalidKeyError extends ValidationError {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidKeyError';
  }
}

/**
 * Error thrown when a secret is invalid
 */
export class InvalidSecretError extends ValidationError {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidSecretError';
  }
}
