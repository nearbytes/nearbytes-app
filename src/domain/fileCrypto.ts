import type { CryptoOperations } from '../crypto/index.js';
import type { EncryptedData, Hash } from '../types/events.js';
import { createEncryptedData } from '../types/events.js';
import type { PrivateKey, PublicKey, SymmetricKey } from '../types/keys.js';
import { createPublicKey, createSymmetricKey } from '../types/keys.js';
import { bytesToHex, bytesToBase64Url, base64UrlToBytes, hexToBytes } from '../utils/encoding.js';
import type { ContentDescriptor } from './fileReferenceCodec.js';
import { canonicalJsonBytes } from './fileReferenceCodec.js';

const AES_GCM_NONCE_BYTES = 12;
const AES_GCM_TAG_BITS = 128;
const HKDF_INFO = new TextEncoder().encode('nb-ref-wrap-v1');
const HKDF_SALT_LABEL = new TextEncoder().encode('nb.ref.v1');
const EC_P256_PUBLIC_KEY_BYTES = 65;

export interface EncryptedFileWrite {
  readonly blobHash: Hash;
  readonly encryptedData: EncryptedData;
  readonly encryptedKey: EncryptedData;
  readonly contentType: 'b';
}

export interface RecipientKeyCapsuleBytes {
  readonly recipientVolumeId: string;
  readonly ephemeralPublicKey: string;
  readonly nonce: string;
  readonly wrappedKey: string;
}

export async function encryptFileForVolume(
  crypto: CryptoOperations,
  volumePrivateKey: PrivateKey,
  data: Uint8Array
): Promise<EncryptedFileWrite> {
  const fileKey = await crypto.generateSymmetricKey();
  const encryptedData = await crypto.encryptSym(data, fileKey);
  const blobHash = await crypto.computeHash(encryptedData);
  const encryptedKey = await wrapFileKeyForVolume(crypto, volumePrivateKey, fileKey);

  return {
    blobHash,
    encryptedData,
    encryptedKey,
    contentType: 'b',
  };
}

export async function wrapFileKeyForVolume(
  crypto: CryptoOperations,
  volumePrivateKey: PrivateKey,
  fileKey: SymmetricKey
): Promise<EncryptedData> {
  const wrappingKey = await crypto.deriveSymKey(volumePrivateKey);
  return crypto.encryptSym(fileKey, wrappingKey);
}

export async function unwrapFileKeyForVolume(
  crypto: CryptoOperations,
  volumePrivateKey: PrivateKey,
  encryptedKey: Uint8Array
): Promise<SymmetricKey> {
  const wrappingKey = await crypto.deriveSymKey(volumePrivateKey);
  const plaintextKey = await crypto.decryptSym(createEncryptedData(new Uint8Array(encryptedKey)), wrappingKey);
  return createSymmetricKey(plaintextKey);
}

export async function decryptFileForVolume(
  crypto: CryptoOperations,
  volumePrivateKey: PrivateKey,
  encryptedData: EncryptedData,
  encryptedKey: Uint8Array
): Promise<Uint8Array> {
  if (encryptedKey.length === 0) {
    const legacyKey = await crypto.deriveSymKey(volumePrivateKey);
    return crypto.decryptSym(encryptedData, legacyKey);
  }

  const fileKey = await unwrapFileKeyForVolume(crypto, volumePrivateKey, encryptedKey);
  return crypto.decryptSym(encryptedData, fileKey);
}

export async function createRecipientKeyCapsule(
  fileKey: SymmetricKey,
  recipientVolumeId: string,
  descriptor: ContentDescriptor
): Promise<RecipientKeyCapsuleBytes> {
  const recipientPublicKey = parseVolumeId(recipientVolumeId);
  const subtle = getSubtleCrypto();
  const ephemeralKeyPair = await subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  );
  const ephemeralPublicKeyBytes = new Uint8Array(await subtle.exportKey('raw', ephemeralKeyPair.publicKey));
  const recipientPublicKeyHandle = await subtle.importKey(
    'raw',
    toArrayBuffer(recipientPublicKey),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );
  const sharedSecret = new Uint8Array(
    await subtle.deriveBits(
      {
        name: 'ECDH',
        public: recipientPublicKeyHandle,
      },
      ephemeralKeyPair.privateKey,
      256
    )
  );
  const keyEncryptionKey = await deriveReferenceKeyEncryptionKey(sharedSecret);
  const nonce = randomBytes(AES_GCM_NONCE_BYTES);
  const aad = createRecipientReferenceAad(recipientVolumeId, descriptor);
  const wrappedKey = await aesGcmEncrypt(fileKey, keyEncryptionKey, nonce, aad);

  return {
    recipientVolumeId,
    ephemeralPublicKey: bytesToBase64Url(ephemeralPublicKeyBytes),
    nonce: bytesToBase64Url(nonce),
    wrappedKey: bytesToBase64Url(wrappedKey),
  };
}

export async function unwrapRecipientKeyCapsule(
  recipientPrivateKey: PrivateKey,
  recipientVolumeId: string,
  descriptor: ContentDescriptor,
  capsule: {
    readonly e: string;
    readonly n: string;
    readonly w: string;
  }
): Promise<SymmetricKey> {
  const subtle = getSubtleCrypto();
  const ephemeralPublicKey = decodePublicKey(capsule.e);
  const recipientPrivateKeyHandle = await subtle.importKey(
    'pkcs8',
    createPkcs8PrivateKey(recipientPrivateKey),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits']
  );
  const ephemeralPublicKeyHandle = await subtle.importKey(
    'raw',
    toArrayBuffer(ephemeralPublicKey),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );
  const sharedSecret = new Uint8Array(
    await subtle.deriveBits(
      {
        name: 'ECDH',
        public: ephemeralPublicKeyHandle,
      },
      recipientPrivateKeyHandle,
      256
    )
  );
  const keyEncryptionKey = await deriveReferenceKeyEncryptionKey(sharedSecret);
  const aad = createRecipientReferenceAad(recipientVolumeId, descriptor);
  const fileKeyBytes = await aesGcmDecrypt(
    base64UrlToBytes(capsule.w),
    keyEncryptionKey,
    base64UrlToBytes(capsule.n),
    aad
  );
  return createSymmetricKey(fileKeyBytes);
}

export function volumeIdFromPublicKey(publicKey: PublicKey): string {
  return bytesToHex(publicKey);
}

export function publicKeyFromVolumeId(volumeId: string): PublicKey {
  return createPublicKey(parseVolumeId(volumeId));
}

function createRecipientReferenceAad(recipientVolumeId: string, descriptor: ContentDescriptor): Uint8Array {
  return canonicalJsonBytes({
    p: 'nb.ref.v1',
    c: {
      t: descriptor.t,
      h: descriptor.h,
      z: descriptor.z,
    },
    r: recipientVolumeId,
  });
}

async function deriveReferenceKeyEncryptionKey(sharedSecret: Uint8Array): Promise<Uint8Array> {
  const subtle = getSubtleCrypto();
  const hkdfKey = await subtle.importKey('raw', toArrayBuffer(sharedSecret), 'HKDF', false, ['deriveBits']);
  const salt = new Uint8Array(await subtle.digest('SHA-256', toArrayBuffer(HKDF_SALT_LABEL)));
  const bits = await subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: toArrayBuffer(salt),
      info: toArrayBuffer(HKDF_INFO),
    },
    hkdfKey,
    256
  );
  return new Uint8Array(bits);
}

async function aesGcmEncrypt(
  plaintext: Uint8Array,
  keyBytes: Uint8Array,
  nonce: Uint8Array,
  aad: Uint8Array
): Promise<Uint8Array> {
  const subtle = getSubtleCrypto();
  const key = await subtle.importKey(
    'raw',
    toArrayBuffer(keyBytes),
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );
  const ciphertext = await subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(nonce),
      additionalData: toArrayBuffer(aad),
      tagLength: AES_GCM_TAG_BITS,
    },
    key,
    toArrayBuffer(plaintext)
  );
  return new Uint8Array(ciphertext);
}

async function aesGcmDecrypt(
  ciphertext: Uint8Array,
  keyBytes: Uint8Array,
  nonce: Uint8Array,
  aad: Uint8Array
): Promise<Uint8Array> {
  const subtle = getSubtleCrypto();
  const key = await subtle.importKey(
    'raw',
    toArrayBuffer(keyBytes),
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );
  const plaintext = await subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(nonce),
      additionalData: toArrayBuffer(aad),
      tagLength: AES_GCM_TAG_BITS,
    },
    key,
    toArrayBuffer(ciphertext)
  );
  return new Uint8Array(plaintext);
}

function parseVolumeId(volumeId: string): Uint8Array {
  const bytes = hexToBytes(volumeId.toLowerCase());
  if (bytes.length !== EC_P256_PUBLIC_KEY_BYTES) {
    throw new Error('Volume id must encode a 65-byte P-256 public key');
  }
  return bytes;
}

function decodePublicKey(encoded: string): Uint8Array {
  const bytes = base64UrlToBytes(encoded);
  if (bytes.length !== EC_P256_PUBLIC_KEY_BYTES) {
    throw new Error('Ephemeral public key must be 65 bytes');
  }
  return bytes;
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

function getSubtleCrypto(): SubtleCrypto {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Web Crypto API not available');
  }
  return globalThis.crypto.subtle;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function createPkcs8PrivateKey(privateKeyScalar: Uint8Array): ArrayBuffer {
  const privateKeySize = 32;
  const ecPrivateKeyContentSize = 37;
  const ecPrivateKeySeqSize = 39;
  const octetStringLengthValue = ecPrivateKeySeqSize;
  const algorithmIdContentSize = 19;
  const algorithmIdSeqSize = 21;
  const versionSize = 3;
  const octetStringSize = 1 + 1 + ecPrivateKeySeqSize;
  const outerSeqContentSize = versionSize + algorithmIdSeqSize + octetStringSize;
  const lengthByteSize = outerSeqContentSize < 128 ? 1 : 2;
  const totalSize = 1 + lengthByteSize + outerSeqContentSize;
  const pkcs8 = new Uint8Array(totalSize);
  let offset = 0;

  pkcs8[offset++] = 0x30;
  if (outerSeqContentSize < 128) {
    pkcs8[offset++] = outerSeqContentSize;
  } else {
    pkcs8[offset++] = 0x81;
    pkcs8[offset++] = outerSeqContentSize - 1;
  }

  pkcs8[offset++] = 0x02;
  pkcs8[offset++] = 0x01;
  pkcs8[offset++] = 0x00;

  pkcs8[offset++] = 0x30;
  pkcs8[offset++] = algorithmIdContentSize;

  pkcs8[offset++] = 0x06;
  pkcs8[offset++] = 0x07;
  pkcs8[offset++] = 0x2a;
  pkcs8[offset++] = 0x86;
  pkcs8[offset++] = 0x48;
  pkcs8[offset++] = 0xce;
  pkcs8[offset++] = 0x3d;
  pkcs8[offset++] = 0x02;
  pkcs8[offset++] = 0x01;

  pkcs8[offset++] = 0x06;
  pkcs8[offset++] = 0x08;
  pkcs8[offset++] = 0x2a;
  pkcs8[offset++] = 0x86;
  pkcs8[offset++] = 0x48;
  pkcs8[offset++] = 0xce;
  pkcs8[offset++] = 0x3d;
  pkcs8[offset++] = 0x03;
  pkcs8[offset++] = 0x01;
  pkcs8[offset++] = 0x07;

  pkcs8[offset++] = 0x04;
  pkcs8[offset++] = octetStringLengthValue;

  pkcs8[offset++] = 0x30;
  pkcs8[offset++] = ecPrivateKeyContentSize;

  pkcs8[offset++] = 0x02;
  pkcs8[offset++] = 0x01;
  pkcs8[offset++] = 0x01;

  pkcs8[offset++] = 0x04;
  pkcs8[offset++] = 0x20;
  pkcs8.set(privateKeyScalar, offset);
  offset += privateKeySize;

  return pkcs8.buffer;
}
