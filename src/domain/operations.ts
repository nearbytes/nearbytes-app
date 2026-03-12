import type { Secret, PublicKey } from '../types/keys.js';
import type { Hash, SignedEvent, EventPayload } from '../types/events.js';
import { EventType } from '../types/events.js';
import type { CryptoOperations } from '../crypto/index.js';
import type { StorageBackend, ChannelPathMapper } from '../types/storage.js';
import { ChannelStorage } from '../storage/channel.js';
import { defaultPathMapper } from '../types/storage.js';
import { createEncryptedData } from '../types/events.js';
import { createSymmetricKey } from '../types/keys.js';
import { computeHash } from '../crypto/hash.js';
import { serializeEventPayload } from '../storage/serialization.js';

/**
 * Sets up a new channel from a secret
 * @param secret - Channel secret (e.g., "channelname:password")
 * @param crypto - Cryptographic operations
 * @param storage - Storage backend
 * @param pathMapper - Function to map public key to channel path
 * @returns Public key and channel path
 */
export async function setupChannel(
  secret: Secret,
  crypto: CryptoOperations,
  storage: StorageBackend,
  pathMapper: ChannelPathMapper = defaultPathMapper
): Promise<{ publicKey: PublicKey; channelPath: string }> {
  // Derive key pair from secret
  const keyPair = await crypto.deriveKeys(secret);

  // Create channel directory
  const channelPath = pathMapper(keyPair.publicKey);
  await storage.createDirectory(channelPath);

  return {
    publicKey: keyPair.publicKey,
    channelPath,
  };
}

/**
 * Stores data in a channel
 * @param data - Plaintext data to store
 * @param fileName - Name of the file
 * @param secret - Channel secret
 * @param crypto - Cryptographic operations
 * @param channelStorage - Channel storage instance
 * @returns Event hash and data hash
 */
export async function storeData(
  data: Uint8Array,
  fileName: string,
  secret: Secret,
  crypto: CryptoOperations,
  channelStorage: ChannelStorage
): Promise<{ eventHash: Hash; dataHash: Hash }> {
  // 1. Derive keys from secret
  const keyPair = await crypto.deriveKeys(secret);

  // 2. Generate symmetric key for data encryption
  const symmetricKey = await crypto.generateSymmetricKey();

  // 3. Encrypt data
  const encryptedData = await crypto.encryptSym(data, symmetricKey);

  // 4. Compute hash of encrypted data
  const dataHash = await computeHash(encryptedData);

  // 5. Store encrypted data
  await channelStorage.storeEncryptedData(dataHash, encryptedData, false, keyPair.publicKey);

  // 6. Derive symmetric key for encrypting the data encryption key
  const keyEncryptionKey = await crypto.deriveSymKey(keyPair.privateKey);

  // 7. Encrypt the symmetric key
  const encryptedKey = await crypto.encryptSym(symmetricKey, keyEncryptionKey);

  // 8. Create event payload
  const payload: EventPayload = {
    type: EventType.CREATE_FILE,
    fileName,
    hash: dataHash,
    encryptedKey: createEncryptedData(encryptedKey),
  };

  // 9. Serialize payload and compute event hash
  const payloadBytes = serializeEventPayload(payload);
  const eventHash = await computeHash(payloadBytes);

  // 10. Sign the payload
  const signature = await crypto.signPR(payloadBytes, keyPair.privateKey);

  // 11. Create signed event
  const signedEvent: SignedEvent = {
    payload,
    signature,
  };

  // 12. Store signed event
  await channelStorage.storeEvent(keyPair.publicKey, signedEvent);

  return { eventHash, dataHash };
}

/**
 * Retrieves data from a channel
 * @param eventHash - Event hash
 * @param secret - Channel secret
 * @param crypto - Cryptographic operations
 * @param channelStorage - Channel storage instance
 * @returns Decrypted plaintext data
 */
export async function retrieveData(
  eventHash: Hash,
  secret: Secret,
  crypto: CryptoOperations,
  channelStorage: ChannelStorage
): Promise<Uint8Array> {
  // 1. Derive keys from secret
  const keyPair = await crypto.deriveKeys(secret);

  // 2. Retrieve signed event
  const signedEvent = await channelStorage.retrieveEvent(keyPair.publicKey, eventHash);

  // 3. Serialize payload and verify signature
  const payloadBytes = serializeEventPayload(signedEvent.payload);
  const isValid = await crypto.verifyPU(payloadBytes, signedEvent.signature, keyPair.publicKey);

  if (!isValid) {
    throw new Error('Event signature verification failed');
  }

  // 4. Derive symmetric key for decrypting the data encryption key
  const keyEncryptionKey = await crypto.deriveSymKey(keyPair.privateKey);

  // 5. Decrypt the symmetric key
  const symmetricKeyBytes = await crypto.decryptSym(signedEvent.payload.encryptedKey, keyEncryptionKey);
  const symmetricKey = createSymmetricKey(symmetricKeyBytes);

  // 6. Retrieve encrypted data
  const encryptedData = await channelStorage.retrieveEncryptedData(
    signedEvent.payload.hash,
    keyPair.publicKey
  );

  // 7. Decrypt data
  const plaintext = await crypto.decryptSym(encryptedData, symmetricKey);

  return plaintext;
}

/**
 * Stores data in a channel with deduplication
 * If the encrypted data block already exists (same hash), it will be reused
 * @param data - Plaintext data to store
 * @param fileName - Name of the file
 * @param secret - Channel secret
 * @param crypto - Cryptographic operations
 * @param channelStorage - Channel storage instance
 * @returns Event hash and data hash, and whether data was deduplicated
 */
export async function storeDataDeduplicated(
  data: Uint8Array,
  fileName: string,
  secret: Secret,
  crypto: CryptoOperations,
  channelStorage: ChannelStorage
): Promise<{ eventHash: Hash; dataHash: Hash; wasDeduplicated: boolean }> {
  // 1. Derive keys from secret
  const keyPair = await crypto.deriveKeys(secret);

  // 2. Generate symmetric key for data encryption
  const symmetricKey = await crypto.generateSymmetricKey();

  // 3. Encrypt data
  const encryptedData = await crypto.encryptSym(data, symmetricKey);

  // 4. Compute hash of encrypted data
  const dataHash = await computeHash(encryptedData);

  // 5. Check if data already exists
  const dataExists = await channelStorage.hasEncryptedData(dataHash, keyPair.publicKey);

  // 6. Store encrypted data (skip if already exists)
  await channelStorage.storeEncryptedData(dataHash, encryptedData, true, keyPair.publicKey);

  // 7. Derive symmetric key for encrypting the data encryption key
  const keyEncryptionKey = await crypto.deriveSymKey(keyPair.privateKey);

  // 8. Encrypt the symmetric key
  const encryptedKey = await crypto.encryptSym(symmetricKey, keyEncryptionKey);

  // 9. Create event payload
  const payload: EventPayload = {
    type: EventType.CREATE_FILE,
    fileName,
    hash: dataHash,
    encryptedKey: createEncryptedData(encryptedKey),
  };

  // 10. Serialize payload and compute event hash
  const payloadBytes = serializeEventPayload(payload);
  const eventHash = await computeHash(payloadBytes);

  // 11. Sign the payload
  const signature = await crypto.signPR(payloadBytes, keyPair.privateKey);

  // 12. Create signed event
  const signedEvent: SignedEvent = {
    payload,
    signature,
  };

  // 13. Store signed event
  await channelStorage.storeEvent(keyPair.publicKey, signedEvent);

  return { eventHash, dataHash, wasDeduplicated: dataExists };
}

/**
 * Deletes a file from a channel
 * @param fileName - Name of the file to delete
 * @param secret - Channel secret
 * @param crypto - Cryptographic operations
 * @param channelStorage - Channel storage instance
 * @returns Event hash
 */
export async function deleteFile(
  fileName: string,
  secret: Secret,
  crypto: CryptoOperations,
  channelStorage: ChannelStorage
): Promise<{ eventHash: Hash }> {
  // 1. Derive keys from secret
  const keyPair = await crypto.deriveKeys(secret);

  // 2. Create empty hash and encrypted key for DELETE_FILE events
  const emptyHash = await computeHash(new Uint8Array(0));
  const emptyEncryptedKey = createEncryptedData(new Uint8Array(0));

  // 3. Create event payload
  const payload: EventPayload = {
    type: EventType.DELETE_FILE,
    fileName,
    hash: emptyHash,
    encryptedKey: emptyEncryptedKey,
  };

  // 4. Serialize payload and compute event hash
  const payloadBytes = serializeEventPayload(payload);
  const eventHash = await computeHash(payloadBytes);

  // 5. Sign the payload
  const signature = await crypto.signPR(payloadBytes, keyPair.privateKey);

  // 6. Create signed event
  const signedEvent: SignedEvent = {
    payload,
    signature,
  };

  // 7. Store signed event
  await channelStorage.storeEvent(keyPair.publicKey, signedEvent);

  return { eventHash };
}
