import type { PublicKey } from '../types/keys.js';
import type { Hash as HashType, SignedEvent, EncryptedData } from '../types/events.js';
import type { StorageBackend, ChannelPathMapper } from '../types/storage.js';
import { createHash } from '../types/events.js';
import { StorageError } from '../types/errors.js';
import { serializeEvent, deserializeEvent, serializeEventPayload } from './serialization.js';
import { computeHash } from '../crypto/hash.js';
import { isMultiRootStorageBackend } from './multiRoot.js';
import { verifyPU } from '../crypto/asymmetric.js';
import { validateBlockBytes } from './integrity.js';
import {
  NEARBYTES_SYNC_INDEX_PATH,
  createNearbytesSyncEventRecord,
  getNearbytesSyncChannelManifestPath,
  type NearbytesSyncChannelManifest,
  type NearbytesSyncIndex,
} from './syncManifest.js';

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

      await this.updateSyncManifest(channelHex, eventHash, event);

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
        ? await this.storage.readValidatedFileForChannel(eventPath, channelHex, async (data) => {
            const parsed = deserializeEvent(JSON.parse(new TextDecoder().decode(data)) as import('../types/events.js').SerializedEvent);
            const payloadBytes = serializeEventPayload(parsed.payload);
            const payloadHash = await computeHash(payloadBytes);
            if (payloadHash !== eventHash) {
              return {
                ok: false,
                code: 'event-hash-mismatch',
                detail: `Expected event hash ${eventHash}, got ${payloadHash}`,
              };
            }
            const valid = await verifyPU(payloadBytes, parsed.signature, publicKey).catch(() => false);
            return valid
              ? { ok: true }
              : {
                  ok: false,
                  code: 'event-signature-invalid',
                  detail: `Signature verification failed for event ${eventHash}`,
                };
          })
        : await this.storage.readFile(eventPath);
      const serialized = JSON.parse(new TextDecoder().decode(eventBytes)) as import('../types/events.js').SerializedEvent;
      const event = deserializeEvent(serialized);
      const payloadBytes = serializeEventPayload(event.payload);
      const payloadHash = await computeHash(payloadBytes);
      if (payloadHash !== eventHash) {
        await this.storage.deleteFile(eventPath).catch(() => undefined);
        throw new StorageError(`Failed to retrieve event: event hash mismatch for ${eventHash}`);
      }
      const valid = await verifyPU(payloadBytes, event.signature, publicKey).catch(() => false);
      if (!valid) {
        await this.storage.deleteFile(eventPath).catch(() => undefined);
        throw new StorageError(`Failed to retrieve event: signature verification failed for ${eventHash}`);
      }
      return event;
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

      // Only treat canonical 64-hex `.bin` names as event files.
      // Garbage files can exist in mirrored provider folders and must not break volume reads.
      const eventHashes = files
        .map((file) => normalizeEventHashFromFileName(file))
        .filter((hash): hash is HashType => hash !== null);

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
        ? await this.storage.readValidatedFileForChannel(dataPath, channelHex, (bytes) => validateBlockBytes(dataHash, bytes))
        : isMultiRootStorageBackend(this.storage)
          ? await this.storage.readValidatedFile(dataPath, (bytes) => validateBlockBytes(dataHash, bytes))
          : await this.storage.readFile(dataPath);
      if (!isMultiRootStorageBackend(this.storage)) {
        const validation = await validateBlockBytes(dataHash, data);
        if (!validation.ok) {
          await this.storage.deleteFile(dataPath).catch(() => undefined);
          throw new StorageError(`Failed to retrieve encrypted data: ${validation.detail ?? 'block hash mismatch'}`);
        }
      }
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

  private async updateSyncManifest(channelHex: string, eventHash: HashType, event: SignedEvent): Promise<void> {
    const manifestPath = getNearbytesSyncChannelManifestPath(channelHex);
    const existingManifest = await this.readSyncJson<NearbytesSyncChannelManifest>(manifestPath, channelHex);
    const currentEvents = existingManifest?.events ?? [];
    const alreadyPresent = currentEvents.some((entry) => entry.eventHash === eventHash);
    const nextManifest: NearbytesSyncChannelManifest = alreadyPresent
      ? {
          version: 1,
          channelId: channelHex,
          revision: existingManifest?.revision ?? 1,
          updatedAt: existingManifest?.updatedAt ?? Date.now(),
          events: currentEvents,
        }
      : {
          version: 1,
          channelId: channelHex,
          revision: (existingManifest?.revision ?? 0) + 1,
          updatedAt: Date.now(),
          events: [...currentEvents, createNearbytesSyncEventRecord(channelHex, eventHash, event.payload)],
        };

    await this.writeSyncJson(manifestPath, channelHex, nextManifest);

    const existingIndex = await this.readSyncJson<NearbytesSyncIndex>(NEARBYTES_SYNC_INDEX_PATH, channelHex);
    const nextIndex: NearbytesSyncIndex = {
      version: 1,
      generatedAt: Date.now(),
      channels: {
        ...(existingIndex?.channels ?? {}),
        [channelHex]: {
          manifestPath,
          revision: nextManifest.revision,
          eventCount: nextManifest.events.length,
          updatedAt: nextManifest.updatedAt,
        },
      },
    };

    await this.writeSyncJson(NEARBYTES_SYNC_INDEX_PATH, channelHex, nextIndex);
  }

  private async readSyncJson<T>(relativePath: string, channelHex: string): Promise<T | null> {
    try {
      const bytes = isMultiRootStorageBackend(this.storage)
        ? await this.storage.readFileForChannel(relativePath, channelHex)
        : await this.storage.readFile(relativePath);
      return JSON.parse(new TextDecoder().decode(bytes)) as T;
    } catch {
      return null;
    }
  }

  private async writeSyncJson(relativePath: string, channelHex: string, value: unknown): Promise<void> {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    if (isMultiRootStorageBackend(this.storage)) {
      await this.storage.writeFileForChannel(relativePath, bytes, channelHex);
      return;
    }
    await this.storage.writeFile(relativePath, bytes);
  }
}

function normalizeEventHashFromFileName(fileName: string): HashType | null {
  const normalized = fileName.trim();
  const match = normalized.match(/^([a-f0-9]{64})\.bin$/i);
  if (!match || !match[1]) {
    return null;
  }
  return createHash(match[1]);
}

function publicKeyToHex(publicKey: PublicKey): string {
  return Array.from(publicKey)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toLowerCase();
}
