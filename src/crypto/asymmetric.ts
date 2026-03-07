import type { Secret, KeyPair, PrivateKey, PublicKey, SymmetricKey } from '../types/keys.js';
import type { Signature } from '../types/events.js';
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
 * Note: Due to Web Crypto API limitations, this implementation uses a workaround
 * for public key derivation. In production, you'd compute the public key from the
 * private key using EC point multiplication.
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

    // Create PKCS8 structure and import it
    const pkcs8 = createPKCS8PrivateKey(crypto, privateKeyScalar);
    const privateCryptoKey = await crypto.importKey(
      'pkcs8',
      pkcs8,
      {
        name: 'ECDSA',
        namedCurve: 'P-256',
      },
      true, // extractable
      ['sign']
    );

    // Export private key as JWK to get the public key coordinates
    const jwk = await crypto.exportKey('jwk', privateCryptoKey);
    if (!jwk.x || !jwk.y) {
      throw new KeyDerivationError('Failed to extract public key coordinates from JWK');
    }

    // Convert JWK coordinates to raw format (0x04 + x + y)
    const xBytes = base64UrlToBytes(jwk.x);
    const yBytes = base64UrlToBytes(jwk.y);
    const publicKeyBytes = new Uint8Array(65);
    publicKeyBytes[0] = 0x04; // Uncompressed point
    publicKeyBytes.set(xBytes, 1);
    publicKeyBytes.set(yBytes, 33);

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
 * Creates a PKCS8 private key structure for ECDSA P-256 from scratch
 * Constructs a minimal valid PKCS8 structure without public key
 */
function createPKCS8PrivateKey(
  _crypto: SubtleCrypto,
  privateKeyScalar: Uint8Array
): ArrayBuffer {
  // Construct PKCS8 structure from scratch
  // Structure:
  // SEQUENCE {
  //   version INTEGER (1)
  //   AlgorithmIdentifier SEQUENCE {
  //     algorithm OID (EC: 1.2.840.10045.2.1)
  //     parameters SEQUENCE {
  //       namedCurve OID (P-256: 1.2.840.10045.3.1.7)
  //     }
  //   }
  //   PrivateKey OCTET STRING {
  //     ECPrivateKey SEQUENCE {
  //       version INTEGER (1)
  //       privateKey OCTET STRING (32 bytes)
  //     }
  //   }
  // }
  
  // Calculate sizes based on actual PKCS8 structure analysis
  // Real structure: 138 bytes total, 135 bytes content (with public key)
  // Without public key (70 bytes): 68 bytes total, 65 bytes content
  
  const privateKeySize = 32;
  
  // ECPrivateKey SEQUENCE content (without public key):
  // - version INTEGER: 3 bytes (0x02 0x01 0x01)
  // - privateKey OCTET STRING: 34 bytes (0x04 0x20 + 32 bytes)
  // Total content: 37 bytes
  const ecPrivateKeyContentSize = 37;
  // ECPrivateKey SEQUENCE: 1 (tag) + 1 (length) + 37 (content) = 39 bytes
  const ecPrivateKeySeqSize = 39;
  
  // OCTET STRING containing ECPrivateKey
  // The length field value is the size of the ECPrivateKey SEQUENCE (39 bytes)
  const octetStringLengthValue = ecPrivateKeySeqSize;
  
  // AlgorithmIdentifier SEQUENCE content: EC OID (9 bytes) + P-256 OID (10 bytes) = 19 bytes
  // Note: Parameters is just an OID, not a SEQUENCE containing an OID
  const algorithmIdContentSize = 19;
  // AlgorithmIdentifier SEQUENCE: 1 (tag) + 1 (length) + 19 (content) = 21 bytes
  const algorithmIdSeqSize = 21;
  
  // Version INTEGER: 3 bytes
  const versionSize = 3;
  
  // OCTET STRING: 1 (tag) + 1 (length) + 39 (ECPrivateKey) = 41 bytes
  const octetStringSize = 1 + 1 + ecPrivateKeySeqSize;
  
  // Outer SEQUENCE content: 3 + 21 + 41 = 65 bytes
  const outerSeqContentSize = versionSize + algorithmIdSeqSize + octetStringSize;
  
  // Allocate buffer with some extra space for safety
  const lengthByteSize = outerSeqContentSize < 128 ? 1 : 2;
  const totalSize = 1 + lengthByteSize + outerSeqContentSize;
  const pkcs8 = new Uint8Array(totalSize);
  let offset = 0;
  
  // Outer SEQUENCE
  pkcs8[offset++] = 0x30; // SEQUENCE
  if (outerSeqContentSize < 128) {
    pkcs8[offset++] = outerSeqContentSize;
  } else {
    pkcs8[offset++] = 0x81;
    pkcs8[offset++] = outerSeqContentSize - 1;
  }
  
  // Version INTEGER (1)
  pkcs8[offset++] = 0x02; // INTEGER
  pkcs8[offset++] = 0x01; // Length
  pkcs8[offset++] = 0x00; // Value (version 0 for PKCS8)
  
  // AlgorithmIdentifier SEQUENCE
  pkcs8[offset++] = 0x30; // SEQUENCE
  pkcs8[offset++] = algorithmIdContentSize;
  
  // algorithm OID: EC (1.2.840.10045.2.1)
  pkcs8[offset++] = 0x06; // OID
  pkcs8[offset++] = 0x07; // Length
  pkcs8[offset++] = 0x2a; // 1.2.840.10045.2.1
  pkcs8[offset++] = 0x86;
  pkcs8[offset++] = 0x48;
  pkcs8[offset++] = 0xce;
  pkcs8[offset++] = 0x3d;
  pkcs8[offset++] = 0x02;
  pkcs8[offset++] = 0x01;
  
  // parameters: namedCurve OID: P-256 (1.2.840.10045.3.1.7)
  // Note: This is just an OID, not a SEQUENCE containing an OID
  pkcs8[offset++] = 0x06; // OID
  pkcs8[offset++] = 0x08; // Length
  pkcs8[offset++] = 0x2a; // 1.2.840.10045.3.1.7
  pkcs8[offset++] = 0x86;
  pkcs8[offset++] = 0x48;
  pkcs8[offset++] = 0xce;
  pkcs8[offset++] = 0x3d;
  pkcs8[offset++] = 0x03;
  pkcs8[offset++] = 0x01;
  pkcs8[offset++] = 0x07;
  
  // PrivateKey OCTET STRING
  pkcs8[offset++] = 0x04; // OCTET STRING
  pkcs8[offset++] = octetStringLengthValue;
  
  // ECPrivateKey SEQUENCE
  pkcs8[offset++] = 0x30; // SEQUENCE
  pkcs8[offset++] = ecPrivateKeyContentSize;
  
  // version INTEGER (1)
  pkcs8[offset++] = 0x02; // INTEGER
  pkcs8[offset++] = 0x01; // Length
  pkcs8[offset++] = 0x01; // Value (version 1 for ECPrivateKey)
  
  // privateKey OCTET STRING
  pkcs8[offset++] = 0x04; // OCTET STRING
  pkcs8[offset++] = 0x20; // Length (32 bytes)
  pkcs8.set(privateKeyScalar, offset);
  offset += privateKeySize;
  
  return pkcs8.buffer;
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
    const crypto = globalThis.crypto?.subtle;
    if (!crypto) {
      throw new SigningError('Web Crypto API not available');
    }

    // Compute hash of data
    const dataHash = await computeHash(data);
    const dataHashBytes = hexToBytes(dataHash);

    // Create PKCS8 private key using workaround
    const pkcs8 = createPKCS8PrivateKey(crypto, privateKey);

    // Import private key
    const cryptoKey = await crypto.importKey(
      'pkcs8',
      pkcs8,
      {
        name: 'ECDSA',
        namedCurve: 'P-256',
      },
      false,
      ['sign']
    );

    // Sign the hash
    const dataHashArray = new Uint8Array(dataHashBytes);
    const signatureBuffer = await crypto.sign(
      {
        name: 'ECDSA',
        hash: 'SHA-256',
      },
      cryptoKey,
      dataHashArray
    );

    return createSignature(new Uint8Array(signatureBuffer));
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
    const crypto = globalThis.crypto?.subtle;
    if (!crypto) {
      throw new VerificationError('Web Crypto API not available');
    }

    // Compute hash of data
    const dataHash = await computeHash(data);
    const dataHashBytes = hexToBytes(dataHash);

    // Import public key (raw format for P-256 is 65 bytes)
    if (publicKey.length !== 65) {
      throw new VerificationError(`Invalid public key length: expected 65 bytes, got ${publicKey.length}`);
    }

    const publicKeyArray = new Uint8Array(publicKey);
    const cryptoKey = await crypto.importKey(
      'raw',
      publicKeyArray,
      {
        name: 'ECDSA',
        namedCurve: 'P-256',
      },
      false,
      ['verify']
    );

    // Verify signature
    const signatureArray = new Uint8Array(signature);
    const dataHashArray = new Uint8Array(dataHashBytes);
    return await crypto.verify(
      {
        name: 'ECDSA',
        hash: 'SHA-256',
      },
      cryptoKey,
      signatureArray,
      dataHashArray
    );
  } catch (error) {
    if (error instanceof VerificationError) {
      throw error;
    }
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
