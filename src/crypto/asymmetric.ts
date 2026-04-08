import type { Secret, KeyPair, PrivateKey, PublicKey, SymmetricKey } from '../types/keys.js';
import type { Signature } from '../types/events.js';
import { p256 } from '@noble/curves/nist.js';
import { createPrivateKey, createPublicKey, createSymmetricKey } from '../types/keys.js';
import { createSignature } from '../types/events.js';
import { KeyDerivationError, SigningError, VerificationError } from './errors.js';
import { computeHash } from './hash.js';
import { hexToBytes, bytesToHex, base64UrlToBytes } from '../utils/encoding.js';

const PBKDF2_ITERATIONS = 100000;
const PBKDF2_HASH = 'SHA-256';
const PRIVATE_KEY_SALT = new TextEncoder().encode('nearbytes-private-key-v1');
const SYMMETRIC_KEY_SALT = new TextEncoder().encode('nearbytes-sym-key-derivation-v1');
const FILE_SECRET_PREFIX = 'nb-file-secret:v1:';

// ECDSA P-256 curve order (n) in hex
// n = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551
const CURVE_ORDER_HEX = 'FFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551';

/**
 * Derives a deterministic key pair from a secret using PBKDF2
 * Public key derivation uses direct P-256 point multiplication from the private
 * scalar so the result stays deterministic across engines without depending on
 * browser-specific PKCS#8 import behavior.
 * @param secret - Channel secret string
 * @returns KeyPair with public and private keys
 * @throws KeyDerivationError if key derivation fails
 */
export async function deriveKeys(secret: Secret): Promise<KeyPair> {
  try {
    const crypto = globalThis.crypto?.subtle;
    if (!crypto) {
      throw new KeyDerivationError('Web Crypto API not available');
    }

    const secretBytes = decodeSecretBytes(secret);

    // Derive private key seed
    const privateKeySeed = await deriveSeed(crypto, secretBytes, PRIVATE_KEY_SALT, 32);
    const privateKeyScalar = reduceModuloCurveOrder(privateKeySeed);

    const publicKeyBytes = derivePublicKeyBytes(privateKeyScalar);

    return {
      privateKey: createPrivateKey(privateKeyScalar),
      publicKey: createPublicKey(publicKeyBytes),
    };
  } catch (error) {
    throw new KeyDerivationError(
      `Failed to derive keys: ${error instanceof Error ? error.message : 'unknown error'}`,
      error instanceof Error ? error : undefined
    );
  }
}

function derivePublicKeyBytes(privateKeyScalar: Uint8Array): Uint8Array {
  return p256.getPublicKey(privateKeyScalar, false);
}

function decodeSecretBytes(secret: Secret): Uint8Array {
  const secretValue = secret as string;
  if (!secretValue.startsWith(FILE_SECRET_PREFIX)) {
    return new TextEncoder().encode(secretValue);
  }

  const encodedPayload = secretValue.slice(FILE_SECRET_PREFIX.length);
  if (encodedPayload.length === 0) {
    throw new KeyDerivationError('File-backed secret payload is empty');
  }

  return new Uint8Array(base64UrlToBytes(encodedPayload));
}

/**
 * Derives a seed using PBKDF2
 */
async function deriveSeed(
  crypto: SubtleCrypto,
  secretBytes: Uint8Array,
  salt: Uint8Array,
  lengthBytes: number
): Promise<Uint8Array> {
  // Create new Uint8Array to avoid branded type issues
  const secretBytesArray = new Uint8Array(secretBytes);
  const saltArray = new Uint8Array(salt);
  
  const seedKey = await crypto.importKey(
    'raw',
    secretBytesArray,
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const seedBits = await crypto.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltArray,
      iterations: PBKDF2_ITERATIONS,
      hash: PBKDF2_HASH,
    },
    seedKey,
    lengthBytes * 8
  );

  return new Uint8Array(seedBits);
}

/**
 * Reduces a value modulo the curve order to get a valid private key scalar
 */
function reduceModuloCurveOrder(seed: Uint8Array): Uint8Array {
  // Convert to BigInt for proper modulo arithmetic
  const seedBigInt = BigInt('0x' + bytesToHex(seed));
  const curveOrderBigInt = BigInt('0x' + CURVE_ORDER_HEX);
  
  // Reduce modulo curve order, ensure it's in range [1, n-1]
  let result = seedBigInt % curveOrderBigInt;
  if (result === 0n) {
    result = 1n; // Ensure it's not zero
  }
  
  // Convert back to bytes
  const resultHex = result.toString(16).padStart(64, '0');
  return hexToBytes(resultHex);
}

/**
 * Signs data using ECDSA P-256
 * @param data - Data to sign
 * @param privateKey - Private key scalar (32 bytes)
 * @returns Signature
 * @throws SigningError if signing fails
 */
export async function signPR(data: Uint8Array, privateKey: PrivateKey): Promise<Signature> {
  try {
    const dataHash = await computeHash(data);
    const dataHashBytes = hexToBytes(dataHash);

    const signature = p256.sign(dataHashBytes, privateKey, {
      lowS: false,
      prehash: false,
    });
    return createSignature(signature.toCompactRawBytes());
  } catch (error) {
    throw new SigningError(
      `Failed to sign data: ${error instanceof Error ? error.message : 'unknown error'}`,
      error instanceof Error ? error : undefined
    );
  }
}

/**
 * Verifies a signature using ECDSA P-256
 * @param data - Original data
 * @param signature - Signature to verify
 * @param publicKey - Public key (65 bytes: 0x04 + x + y)
 * @returns True if signature is valid
 * @throws VerificationError if verification fails
 */
export async function verifyPU(
  data: Uint8Array,
  signature: Signature,
  publicKey: PublicKey
): Promise<boolean> {
  try {
    const dataHash = await computeHash(data);
    const dataHashBytes = hexToBytes(dataHash);

    if (publicKey.length !== 65) {
      throw new VerificationError(`Invalid public key length: expected 65 bytes, got ${publicKey.length}`);
    }
    return p256.verify(signature, dataHashBytes, publicKey, {
      lowS: false,
      prehash: false,
    });

  } catch (error) {
    throw new VerificationError(
      `Failed to verify signature: ${error instanceof Error ? error.message : 'unknown error'}`,
      error instanceof Error ? error : undefined
    );
  }
}

/**
 * Derives a symmetric key from a private key using HKDF
 * @param privateKey - Private key scalar
 * @returns 32-byte symmetric key
 * @throws KeyDerivationError if derivation fails
 */
export async function deriveSymKey(privateKey: PrivateKey): Promise<SymmetricKey> {
  try {
    const crypto = globalThis.crypto?.subtle;
    if (!crypto) {
      throw new KeyDerivationError('Web Crypto API not available');
    }

    // Use HKDF to derive symmetric key from private key
    const privateKeyArray = new Uint8Array(privateKey);
    const baseKey = await crypto.importKey(
      'raw',
      privateKeyArray,
      'HKDF',
      false,
      ['deriveBits']
    );

    const derivedBits = await crypto.deriveBits(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: SYMMETRIC_KEY_SALT,
        info: new TextEncoder().encode('nearbytes-symmetric-key'),
      },
      baseKey,
      256 // 32 bytes
    );

    return createSymmetricKey(new Uint8Array(derivedBits));
  } catch (error) {
    throw new KeyDerivationError(
      `Failed to derive symmetric key: ${error instanceof Error ? error.message : 'unknown error'}`,
      error instanceof Error ? error : undefined
    );
  }
}
