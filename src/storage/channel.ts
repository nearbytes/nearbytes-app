import type { PublicKey } from '../types/keys.js';
import type { Hash as HashType, SignedEvent, EncryptedData } from '../types/events.js';
import type { StorageBackend, ChannelPathMapper } from '../types/storage.js';
import { createHash } from '../types/events.js';
import { StorageError } from '../types/errors.js';
import { serializeEvent, deserializeEvent, serializeEventPayload } from './serialization.js';
import { computeHash } from '../crypto/hash.js';
import { isMultiRootStorageBackend } from './multiRoot.js';

/**
 * Channel storage operations
 * Handles storing and retrieving events and encrypted data blocks
 */
export class ChannelStorage {
  constructor(
    private readonly storage: StorageBackend,
    private readonly pathMapper: ChannelPathMapper
  ) {}

  /**
   * Gets the channel directory path for a public key
   * Returns path like: channels/[public-key-hex]
   */
  private getChannelPath(publicKey: PublicKey): string {
    return this.pathMapper(publicKey);
  }

  /**
   * Gets the path for an event file
   */
  private getEventPath(publicKey: PublicKey, eventHash: HashType): string {
    const channelPath = this.getChannelPath(publicKey);
    return `${channelPath}/${eventHash}.bin`;
  }

  /**
   * Gets the path for an encrypted data block
   */
  private getDataPath(dataHash: HashType): string {
    return `blocks/${dataHash}.bin`;
  }

  /**
   * Stores a signed event in the channel
   * @param publicKey - Channel public key
   * @param event - Signed event to store
   * @returns Event hash
   */
  async storeEvent(publicKey: PublicKey, event: SignedEvent): Promise<HashType> {
    try {
      // Compute event hash from serialized payload
      const payloadBytes = serializeEventPayload(event.payload);
      const eventHash = await computeHash(payloadBytes);

      // Serialize the full event
      const serialized = serializeEvent(event);
      const eventBytes = new TextEncoder().encode(JSON.stringify(serialized));

      // Store event file
      const eventPath = this.getEventPath(publicKey, eventHash);
      const channelHex = publicKeyToHex(publicKey);
      if (isMultiRootStorageBackend(this.storage)) {
        await this.storage.writeFileForChannel(eventPath, eventBytes, channelHex);
      } else {
        await this.storage.writeFile(eventPath, eventBytes);
      }

      return eventHash;
    } catch (error) {
      throw new StorageError(
        `Failed to store event: ${error instanceof Error ? error.message : 'unknown error'}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Retrieves a signed event from the channel
   * @param publicKey - Channel public key
   * @param eventHash - Event hash
   * @returns Signed event
   */
  async retrieveEvent(publicKey: PublicKey, eventHash: HashType): Promise<SignedEvent> {
    try {
      const eventPath = this.getEventPath(publicKey, eventHash);
      const channelHex = publicKeyToHex(publicKey);
      const eventBytes = isMultiRootStorageBackend(this.storage)
        ? await this.storage.readFileForChannel(eventPath, channelHex)
        : await this.storage.readFile(eventPath);
      const serialized = JSON.parse(new TextDecoder().decode(eventBytes)) as import('../types/events.js').SerializedEvent;

      return deserializeEvent(serialized);
    } catch (error) {
      if (error instanceof StorageError) {
        throw error;
      }
      throw new StorageError(
        `Failed to retrieve event: ${error instanceof Error ? error.message : 'unknown error'}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Lists all events in a channel
   * @param publicKey - Channel public key
   * @returns Array of event hashes
   */
  async listEvents(publicKey: PublicKey): Promise<HashType[]> {
    try {
      const channelPath = this.getChannelPath(publicKey);
      const files = isMultiRootStorageBackend(this.storage)
        ? await this.storage.listFilesAcrossRoots(channelPath)
        : await this.storage.listFiles(channelPath);
      
      // Filter for .bin files and extract hashes
      const eventHashes = files
        .filter((file) => file.endsWith('.bin'))
        .map((file) => file.slice(0, -4)) // Remove .bin extension
        .map((hash) => createHash(hash));

      return eventHashes;
    } catch (error) {
      throw new StorageError(
        `Failed to list events: ${error instanceof Error ? error.message : 'unknown error'}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Stores an encrypted data block
   * @param dataHash - Hash of the encrypted data
   * @param encryptedData - Encrypted data to store
   * @param skipIfExists - If true, skip storing if the data already exists
   */
  async storeEncryptedData(
    dataHash: HashType,
    encryptedData: EncryptedData,
    skipIfExists: boolean = false,
    publicKey?: PublicKey
  ): Promise<void> {
    try {
      const dataPath = this.getDataPath(dataHash);
      const channelHex = publicKey ? publicKeyToHex(publicKey) : undefined;
      
      // Check if data already exists
      if (
        skipIfExists &&
        (isMultiRootStorageBackend(this.storage) && channelHex
          ? await this.storage.existsForChannel(dataPath, channelHex)
          : await this.storage.exists(dataPath))
      ) {
        return; // Skip storing if it already exists
      }

      if (isMultiRootStorageBackend(this.storage)) {
        if (!channelHex) {
          throw new StorageError('Public key is required for multi-root block writes');
        }
        await this.storage.writeFileForChannel(dataPath, encryptedData, channelHex);
      } else {
        await this.storage.writeFile(dataPath, encryptedData);
      }
    } catch (error) {
      throw new StorageError(
        `Failed to store encrypted data: ${error instanceof Error ? error.message : 'unknown error'}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Retrieves an encrypted data block
   * @param dataHash - Hash of the encrypted data
   * @returns Encrypted data
   */
  async retrieveEncryptedData(dataHash: HashType, publicKey?: PublicKey): Promise<EncryptedData> {
    try {
      const dataPath = this.getDataPath(dataHash);
      const channelHex = publicKey ? publicKeyToHex(publicKey) : undefined;
      const data = isMultiRootStorageBackend(this.storage) && channelHex
        ? await this.storage.readFileForChannel(dataPath, channelHex)
        : await this.storage.readFile(dataPath);
      return data as EncryptedData;
    } catch (error) {
      if (error instanceof StorageError) {
        throw error;
      }
      throw new StorageError(
        `Failed to retrieve encrypted data: ${error instanceof Error ? error.message : 'unknown error'}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Checks if an encrypted data block exists
   * @param dataHash - Hash of the encrypted data
   * @returns True if the data block exists
   */
  async hasEncryptedData(dataHash: HashType, publicKey?: PublicKey): Promise<boolean> {
    const dataPath = this.getDataPath(dataHash);
    const channelHex = publicKey ? publicKeyToHex(publicKey) : undefined;
    if (isMultiRootStorageBackend(this.storage) && channelHex) {
      return await this.storage.existsForChannel(dataPath, channelHex);
    }
    return await this.storage.exists(dataPath);
  }
}

function publicKeyToHex(publicKey: PublicKey): string {
  return Array.from(publicKey)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toLowerCase();
}
