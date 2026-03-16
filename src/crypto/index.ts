import type { Hash, EncryptedData, Signature } from '../types/events.js';
import type { Secret, KeyPair, PrivateKey, PublicKey, SymmetricKey } from '../types/keys.js';
import { computeHash } from './hash.js';
import { generateSymmetricKey, encryptSym, decryptSym } from './symmetric.js';
import { deriveKeys, signPR, verifyPU, deriveSymKey } from './asymmetric.js';

/**
 * Core cryptographic operations interface
 * Provides all cryptographic primitives needed by the Nearbytes protocol
 */
export interface CryptoOperations {
  /**
   * Computes SHA-256 hash of data
   */
  computeHash(data: Uint8Array): Promise<Hash>;

  /**
   * Generates a random 32-byte symmetric key
   */
  generateSymmetricKey(): Promise<SymmetricKey>;

  /**
   * Encrypts data using AES-256-GCM
   */
  encryptSym(data: Uint8Array, key: SymmetricKey): Promise<EncryptedData>;

  /**
   * Decrypts data using AES-256-GCM
   */
  decryptSym(encrypted: EncryptedData, key: SymmetricKey): Promise<Uint8Array>;

  /**
   * Derives a key pair from a secret (deterministic)
   */
  deriveKeys(secret: Secret): Promise<KeyPair>;

  /**
   * Signs data using ECDSA P-256
   */
  signPR(data: Uint8Array, privateKey: PrivateKey): Promise<Signature>;

  /**
   * Verifies a signature using ECDSA P-256
   */
  verifyPU(data: Uint8Array, signature: Signature, publicKey: PublicKey): Promise<boolean>;

  /**
   * Derives a symmetric key from a private key
   */
  deriveSymKey(privateKey: PrivateKey): Promise<SymmetricKey>;
}

/**
 * Gets the Web Crypto API SubtleCrypto instance
 * Works in both browser and Node.js environments
 */
function getCryptoSubtle(): SubtleCrypto {
  // Try globalThis.crypto first (browser, Node.js 18+)
  if (globalThis.crypto?.subtle) {
    return globalThis.crypto.subtle;
  }

  throw new Error('Web Crypto API not available');
}

/**
 * Creates a concrete implementation of CryptoOperations using Web Crypto API
 * @returns CryptoOperations implementation
 * @throws Error if Web Crypto API is not available
 */
export function createCryptoOperations(): CryptoOperations {
  // Verify Web Crypto API is available (should be set up by test setup file in test env)
  const crypto = getCryptoSubtle();
  if (!crypto) {
    throw new Error('Web Crypto API not available');
  }

  return {
    computeHash,
    generateSymmetricKey,
    encryptSym,
    decryptSym,
    deriveKeys,
    signPR,
    verifyPU,
    deriveSymKey,
  };
}

