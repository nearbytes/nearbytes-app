import { Buffer } from 'buffer';
import { ecb as nobleAesEcb, gcm as nobleAesGcm } from '@noble/ciphers/aes.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import {
  MEGA_PAIRWISE_KEY_LABEL,
  MEGA_PRIVATE_ATTRIBUTE_ENCRYPTION_PARAMETERS,
  type MegaPrivateKey,
} from './core.js';
import { ensureMegaNodeCrypto, getMegaWebCrypto, randomBytes } from './runtime.js';
import { decodeMegaBase64Url, encodeMegaBase64Url } from './protocol.js';

export function xorBuffers(left: Buffer, right: Buffer): Buffer {
  const result = Buffer.alloc(Math.min(left.length, right.length));
  for (let index = 0; index < result.length; index += 1) {
    result[index] = left[index]! ^ right[index]!;
  }
  return result;
}

export function encryptAesEcb(value: Buffer, key: Buffer): Buffer {
  return Buffer.from(nobleAesEcb(key.subarray(0, 16), { disablePadding: true }).encrypt(value));
}

export function decryptAesEcb(value: Buffer, key: Buffer): Buffer {
  return Buffer.from(nobleAesEcb(key.subarray(0, 16), { disablePadding: true }).decrypt(value));
}

export function decodeMegaPrivateAttributeRecordsForTesting(encodedValue: string, masterKey: Buffer): ReadonlyMap<string, Buffer> {
  return parseMegaPrivateAttributeRecords(decodeMegaBase64Url(encodedValue), masterKey);
}

export function decryptMegaKeyManagerContainer(container: Buffer, masterKey: Buffer): Buffer {
  if (container.length <= 14 || container[0] !== 20) {
    throw new Error('MEGA key-manager container is invalid.');
  }

  const ivLength = 12;
  const authTagLength = 16;
  if (container.length <= 2 + ivLength + authTagLength) {
    throw new Error('MEGA key-manager container is truncated.');
  }

  const derivedKey = deriveMegaKeyManagerKey(masterKey);
  const iv = container.subarray(2, 2 + ivLength);
  const encrypted = container.subarray(2 + ivLength);
  const ciphertext = encrypted.subarray(0, encrypted.length - authTagLength);
  const authTag = encrypted.subarray(encrypted.length - authTagLength);
  return Buffer.from(nobleAesGcm(derivedKey, iv).decrypt(Buffer.concat([ciphertext, authTag])));
}

export function encryptMegaKeyManagerContainer(plaintext: Buffer, masterKey: Buffer): Buffer {
  const iv = randomBytes(12);
  const encrypted = Buffer.from(nobleAesGcm(deriveMegaKeyManagerKey(masterKey), iv).encrypt(plaintext));
  const authTag = encrypted.subarray(encrypted.length - 16);
  const ciphertext = encrypted.subarray(0, encrypted.length - 16);
  return Buffer.concat([Buffer.from([20, 0]), iv, ciphertext, authTag]);
}

export function validateTemporarySessionId(sessionId: string, masterKey: Buffer): void {
  const raw = decodeMegaBase64Url(sessionId);
  if (raw.length < 32) {
    throw new Error('MEGA temporary session id is invalid.');
  }
  const left = raw.subarray(0, 16);
  const right = raw.subarray(16, 32);
  if (!encryptAesEcb(left, masterKey).equals(right)) {
    throw new Error('MEGA temporary session id verification failed.');
  }
}

export function decryptMegaPrivateKey(encryptedPrivateKey: Buffer, masterKey: Buffer): Buffer {
  if (encryptedPrivateKey.length === 0 || encryptedPrivateKey.length % 16 !== 0) {
    throw new Error('MEGA private key payload is invalid.');
  }
  return decryptAesEcb(encryptedPrivateKey, masterKey);
}

export function encodeMegaKeyManagerPrivateRsaFromLogin(encryptedPrivateKey: string | undefined, masterKey: Buffer): Buffer {
  if (!encryptedPrivateKey) {
    throw new Error('MEGA login response is missing the RSA private key required to rebuild ^!keys.');
  }
  const decryptedPrivateKey = decryptMegaPrivateKey(decodeMegaBase64Url(encryptedPrivateKey), masterKey);
  return extractMegaPrivateKeyComponents(decryptedPrivateKey, 3);
}

export function extractMegaPrivateKeyComponents(value: Buffer, componentCount: number): Buffer {
  let offset = 0;
  for (let index = 0; index < componentCount; index += 1) {
    if (offset + 2 > value.length) {
      throw new Error('MEGA private key blob is truncated.');
    }
    const bitLength = ((value[offset] ?? 0) << 8) + (value[offset + 1] ?? 0);
    const byteLength = Math.ceil(bitLength / 8);
    const nextOffset = offset + 2 + byteLength;
    if (nextOffset > value.length) {
      throw new Error('MEGA private key blob is malformed.');
    }
    offset = nextOffset;
  }
  return Buffer.from(value.subarray(0, offset));
}

export function decryptSessionIdFromCsid(ciphertext: Buffer, privateKey: MegaPrivateKey, userHandle: string): string {
  const cleartext = rsaRawDecryptMpi(ciphertext, privateKey);
  if (cleartext.length !== 255) {
    throw new Error(`MEGA session id length is invalid: ${cleartext.length}.`);
  }
  const sid = encodeMegaBase64Url(cleartext.subarray(0, 43));
  const embeddedUserHandle = cleartext.subarray(16, 27).toString('latin1');
  if (embeddedUserHandle !== userHandle) {
    throw new Error('MEGA session id user-handle validation failed.');
  }
  return sid;
}

export function rsaRawDecryptMpi(ciphertext: Buffer, privateKey: MegaPrivateKey): Buffer {
  if (ciphertext.length < 2) {
    throw new Error('MEGA RSA ciphertext is invalid.');
  }
  const bitLength = ((ciphertext[0] ?? 0) << 8) + (ciphertext[1] ?? 0);
  const byteLength = Math.ceil(bitLength / 8);
  const payload = ciphertext.subarray(2, 2 + byteLength);
  const decrypted = modPow(bytesToBigInt(payload), privateKey.privateExponent, privateKey.modulus);
  let result = bigIntToBuffer(decrypted, privateKey.modulusLength);
  if (result[1] !== 0) {
    result = Buffer.concat([Buffer.from([0]), result]);
  }
  return result.subarray(2);
}

export function decodeMegaPrivateKey(value: Buffer): MegaPrivateKey {
  const parts: bigint[] = [];
  let offset = 0;
  for (let index = 0; index < 4; index += 1) {
    if (offset + 2 > value.length) {
      throw new Error('MEGA private key blob is truncated.');
    }
    const bitLength = ((value[offset] ?? 0) << 8) + (value[offset + 1] ?? 0);
    const byteLength = Math.ceil(bitLength / 8);
    offset += 2;
    if (offset + byteLength > value.length) {
      throw new Error('MEGA private key blob is malformed.');
    }
    parts.push(bytesToBigInt(value.subarray(offset, offset + byteLength)));
    offset += byteLength;
  }
  const [q, p, d] = parts;
  return {
    modulus: p * q,
    privateExponent: d,
    modulusLength: bufferLengthForBigInt(p * q),
  };
}

export function bytesToBigInt(value: Buffer): bigint {
  const hex = value.toString('hex');
  return hex ? BigInt(`0x${hex}`) : 0n;
}

export function bigIntToBuffer(value: bigint, length: number): Buffer {
  return Buffer.from(value.toString(16).padStart(length * 2, '0'), 'hex');
}

export function bufferLengthForBigInt(value: bigint): number {
  return Math.ceil(value.toString(16).length / 2);
}

export function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  if (modulus === 1n) {
    return 0n;
  }
  let result = 1n;
  let currentBase = base % modulus;
  let currentExponent = exponent;
  while (currentExponent > 0n) {
    if ((currentExponent & 1n) === 1n) {
      result = (result * currentBase) % modulus;
    }
    currentExponent >>= 1n;
    currentBase = (currentBase * currentBase) % modulus;
  }
  return result;
}

export async function deriveV2PasswordKey(password: string, saltBase64: string): Promise<{ masterKey: Buffer; authKey: Buffer }> {
  const passwordBytes = new TextEncoder().encode(password);
  const saltBytes = decodeMegaBase64Url(saltBase64);
  const subtle = getMegaWebCrypto().subtle;
  const key = await subtle.importKey('raw', passwordBytes, 'PBKDF2', false, ['deriveBits']);
  const derived = Buffer.from(
    await subtle.deriveBits(
      {
        name: 'PBKDF2',
        hash: 'SHA-512',
        salt: Uint8Array.from(saltBytes),
        iterations: 100000,
      },
      key,
      256
    )
  );
  return {
    masterKey: derived.subarray(0, 16),
    authKey: derived.subarray(16, 32),
  };
}

export function prepareV1PasswordKey(password: string): Buffer {
  const words = strToA32(Buffer.from(password, 'utf8'));
  const keys: Buffer[] = [];
  for (let index = 0; index < words.length; index += 4) {
    keys.push(wordsToBuffer([words[index] ?? 0, words[index + 1] ?? 0, words[index + 2] ?? 0, words[index + 3] ?? 0]));
  }

  let pkey = wordsToBuffer([0x93c467e3, 0x7db0c7a4, 0xd1be3f81, 0x0152cb56]);
  for (let round = 0; round < 65536; round += 1) {
    for (const key of keys) {
      pkey = encryptAesEcb(pkey, key);
    }
  }
  return pkey;
}

export function stringHash(email: string, passwordKey: Buffer): string {
  const words = strToA32(Buffer.from(email, 'utf8'));
  const hash = [0, 0, 0, 0];
  for (let index = 0; index < words.length; index += 1) {
    hash[index & 3] = (hash[index & 3] ?? 0) ^ (words[index] ?? 0);
  }
  let state = wordsToBuffer(hash);
  for (let round = 0; round < 16384; round += 1) {
    state = encryptAesEcb(state, passwordKey);
  }
  return encodeMegaBase64Url(Buffer.concat([state.subarray(0, 4), state.subarray(8, 12)]));
}

export function strToA32(value: Buffer): number[] {
  const words = new Array<number>((value.length + 3) >> 2).fill(0);
  for (let index = 0; index < value.length; index += 1) {
    words[index >> 2] |= (value[index] ?? 0) << (24 - (index & 3) * 8);
  }
  return words;
}

export function wordsToBuffer(words: readonly number[]): Buffer {
  const buffer = Buffer.alloc(words.length * 4);
  for (let index = 0; index < words.length; index += 1) {
    buffer.writeUInt32BE((words[index] ?? 0) >>> 0, index * 4);
  }
  return buffer;
}

export async function deriveMegaPairwiseKey(privateCu25519: Buffer, publicCu25519: Buffer): Promise<Buffer> {
  const sharedSecret = Buffer.from(x25519.getSharedSecret(privateCu25519, publicCu25519));
  const step1 = await signMegaHmacSha256(Buffer.alloc(0), sharedSecret);
  return (await signMegaHmacSha256(step1, MEGA_PAIRWISE_KEY_LABEL)).subarray(0, 16);
}

export async function signMegaHmacSha256(key: Buffer, data: Buffer): Promise<Buffer> {
  const normalizedKey = key.length > 64 ? await digestMegaSha256(key) : Buffer.from(key);
  const paddedKey = Buffer.alloc(64, 0);
  normalizedKey.copy(paddedKey, 0, 0, Math.min(normalizedKey.length, 64));
  const innerPad = Buffer.alloc(64);
  const outerPad = Buffer.alloc(64);
  for (let index = 0; index < 64; index += 1) {
    innerPad[index] = paddedKey[index]! ^ 0x36;
    outerPad[index] = paddedKey[index]! ^ 0x5c;
  }
  const innerDigest = await digestMegaSha256(Buffer.concat([innerPad, data]));
  return digestMegaSha256(Buffer.concat([outerPad, innerDigest]));
}

export async function digestMegaSha256(data: Buffer): Promise<Buffer> {
  const crypto = globalThis.crypto?.subtle
    ? getMegaWebCrypto()
    : ((await ensureMegaNodeCrypto()).webcrypto as Crypto);
  return Buffer.from(await crypto.subtle.digest('SHA-256', Uint8Array.from(data)));
}

export function parseMegaPrivateAttributeRecords(container: Buffer, masterKey: Buffer): Map<string, Buffer> {
  const plaintext = decryptMegaPrivateAttributeContainer(container, masterKey);
  return decodeMegaPrivateAttributeRecords(plaintext);
}

function decryptMegaPrivateAttributeContainer(container: Buffer, masterKey: Buffer): Buffer {
  const mode = container[0];
  const parameters = mode === undefined ? undefined : MEGA_PRIVATE_ATTRIBUTE_ENCRYPTION_PARAMETERS[mode];
  if (!parameters) {
    throw new Error('MEGA private attribute encryption mode is unsupported.');
  }

  const minLength = 1 + parameters.nonceSize + parameters.authTagSize;
  if (container.length < minLength) {
    throw new Error('MEGA private attribute payload is truncated.');
  }

  const nonce = container.subarray(1, 1 + parameters.nonceSize);
  const encrypted = container.subarray(1 + parameters.nonceSize);
  const ciphertext = encrypted.subarray(0, encrypted.length - parameters.authTagSize);
  const authTag = encrypted.subarray(encrypted.length - parameters.authTagSize);
  const key = masterKey.subarray(0, 16);

  if (parameters.algorithm === 'aes-128-ccm') {
    return decryptMegaPrivateAttributeCcm(ciphertext, authTag, key, nonce, parameters.authTagSize);
  }

  return Buffer.from(nobleAesGcm(key, nonce).decrypt(Buffer.concat([ciphertext, authTag])));
}

function decryptMegaPrivateAttributeCcm(
  ciphertext: Buffer,
  authTag: Buffer,
  key: Buffer,
  nonce: Buffer,
  authTagSize: number
): Buffer {
  const lengthSize = 15 - nonce.length;
  if (lengthSize < 2 || lengthSize > 8) {
    throw new Error('MEGA private attribute CCM nonce is invalid.');
  }

  const counter0 = buildMegaCcmCounterBlock(nonce, lengthSize, 0);
  const authMask = encryptAesEcb(counter0, key).subarray(0, authTagSize);
  const plaintext = Buffer.alloc(ciphertext.length);
  for (let offset = 0, counter = 1; offset < ciphertext.length; offset += 16, counter += 1) {
    const keystream = encryptAesEcb(buildMegaCcmCounterBlock(nonce, lengthSize, counter), key);
    const chunkLength = Math.min(16, ciphertext.length - offset);
    for (let index = 0; index < chunkLength; index += 1) {
      plaintext[offset + index] = ciphertext[offset + index]! ^ keystream[index]!;
    }
  }

  const expectedTag = computeMegaCcmMac(plaintext, key, nonce, authTagSize, lengthSize);
  if (!xorBuffers(authTag, authMask).equals(expectedTag)) {
    throw new Error('MEGA private attribute payload failed authentication.');
  }

  return plaintext;
}

function computeMegaCcmMac(
  plaintext: Buffer,
  key: Buffer,
  nonce: Buffer,
  authTagSize: number,
  lengthSize: number
): Buffer {
  let state = encryptAesEcb(buildMegaCcmB0(plaintext.length, nonce, authTagSize, lengthSize), key);
  for (let offset = 0; offset < plaintext.length; offset += 16) {
    const block = Buffer.alloc(16, 0);
    plaintext.copy(block, 0, offset, Math.min(offset + 16, plaintext.length));
    state = encryptAesEcb(xorBuffers(state, block), key);
  }
  return state.subarray(0, authTagSize);
}

function buildMegaCcmB0(plaintextLength: number, nonce: Buffer, authTagSize: number, lengthSize: number): Buffer {
  const flags = (((authTagSize - 2) / 2) << 3) | (lengthSize - 1);
  return Buffer.concat([Buffer.from([flags]), nonce, encodeMegaCcmLength(plaintextLength, lengthSize)]);
}

function buildMegaCcmCounterBlock(nonce: Buffer, lengthSize: number, counter: number): Buffer {
  return Buffer.concat([Buffer.from([lengthSize - 1]), nonce, encodeMegaCcmLength(counter, lengthSize)]);
}

function encodeMegaCcmLength(value: number, length: number): Buffer {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('MEGA private attribute CCM length is invalid.');
  }
  const result = Buffer.alloc(length, 0);
  let remaining = value;
  for (let index = length - 1; index >= 0; index -= 1) {
    result[index] = remaining & 0xff;
    remaining = Math.floor(remaining / 0x100);
  }
  if (remaining !== 0) {
    throw new Error('MEGA private attribute CCM payload is too large.');
  }
  return result;
}

function decodeMegaPrivateAttributeRecords(value: Buffer): Map<string, Buffer> {
  const records = new Map<string, Buffer>();
  if ((value[0] ?? 0) === 0 && value.length > 65_538) {
    records.set('', Buffer.from(value.subarray(3)));
    return records;
  }

  let offset = 0;
  while (offset < value.length) {
    const keyEnd = value.indexOf(0, offset);
    if (keyEnd < 0 || keyEnd + 3 > value.length) {
      throw new Error('MEGA private attribute TLV payload is malformed.');
    }
    const key = value.toString('ascii', offset, keyEnd);
    let payloadLength = value.readUInt16BE(keyEnd + 1);
    offset = keyEnd + 3;
    if (payloadLength === 0xffff) {
      payloadLength = value.length - offset;
    }
    if (offset + payloadLength > value.length) {
      throw new Error('MEGA private attribute TLV payload is malformed.');
    }
    records.set(key, Buffer.from(value.subarray(offset, offset + payloadLength)));
    offset += payloadLength;
  }
  return records;
}

export function deriveMegaKeyManagerKey(masterKey: Buffer): Buffer {
  return Buffer.from(hkdf(sha256, masterKey, Buffer.alloc(0), Buffer.from([1]), 16));
}
