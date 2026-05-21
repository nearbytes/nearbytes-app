import type { EncryptedData, Hash, PublicKey, SerializedEvent, SignedEvent } from 'nearbytes-crypto';
import { StorageError, computeHash, verifyPU } from 'nearbytes-crypto';
import type { BlockStoreApi, EventLogApi, Log } from 'nearbytes-log';
import {
  deserializeEvent,
  publicKeyToHex,
  serializeEvent,
  serializeEventEnvelope,
  validateBlockBytes,
  validateEventBytes,
} from 'nearbytes-log';
import { blockPath, eventPath, eventHashFromFileName, defaultPathMapper } from 'nearbytes-log';
import type { ChannelPathMapper } from 'nearbytes-log';
import type { MultiRootStorageBackend } from './multiRoot.js';

/**
 * `Log` view over a `MultiRootStorageBackend` (channel-routed reads/writes).
 */
export function createMultiRootLog(
  storage: MultiRootStorageBackend,
  pathMapper: ChannelPathMapper = defaultPathMapper,
): Log {
  return {
    events: createMultiRootEventLog(storage, pathMapper),
    blocks: createMultiRootBlockStore(storage),
  };
}

function createMultiRootEventLog(
  storage: MultiRootStorageBackend,
  pathMapper: ChannelPathMapper,
): EventLogApi {
  const storeEvent = async (publicKey: PublicKey, event: SignedEvent): Promise<Hash> => {
    try {
      const envelopeBytes = serializeEventEnvelope(event.envelope);
      const eventHash = await computeHash(envelopeBytes);
      const serialized = serializeEvent(event);
      const eventBytes = new TextEncoder().encode(JSON.stringify(serialized));
      const channelHex = publicKeyToHex(publicKey);
      await storage.writeFileForChannel(eventPath(pathMapper, publicKey, eventHash), eventBytes, channelHex);
      return eventHash;
    } catch (error) {
      throw new StorageError(
        `Failed to store event: ${error instanceof Error ? error.message : 'unknown error'}`,
        error instanceof Error ? error : undefined,
      );
    }
  };

  const retrieveEvent = async (publicKey: PublicKey, eventHash: Hash): Promise<SignedEvent> => {
    const channelHex = publicKeyToHex(publicKey);
    const path = eventPath(pathMapper, publicKey, eventHash);
    try {
      const eventBytes = await storage.readValidatedFileForChannel(
        path,
        channelHex,
        (data) => validateEventBytes(channelHex, eventHash, data),
      );
      const serialized = JSON.parse(new TextDecoder().decode(eventBytes)) as SerializedEvent;
      const event = deserializeEvent(serialized);
      const envelopeBytes = serializeEventEnvelope(event.envelope);
      const payloadHash = await computeHash(envelopeBytes);
      if (payloadHash !== eventHash) {
        await storage.deleteFile(path).catch(() => undefined);
        throw new StorageError(`Failed to retrieve event: event hash mismatch for ${eventHash}`);
      }
      const valid = await verifyPU(envelopeBytes, event.signature, publicKey).catch(() => false);
      if (!valid) {
        await storage.deleteFile(path).catch(() => undefined);
        throw new StorageError(`Failed to retrieve event: signature verification failed for ${eventHash}`);
      }
      return event;
    } catch (error) {
      if (error instanceof StorageError) {
        throw error;
      }
      throw new StorageError(
        `Failed to retrieve event: ${error instanceof Error ? error.message : 'unknown error'}`,
        error instanceof Error ? error : undefined,
      );
    }
  };

  const listEvents = async (publicKey: PublicKey): Promise<Hash[]> => {
    try {
      const files = await storage.listFilesAcrossRoots(pathMapper(publicKey));
      return files
        .map((file) => eventHashFromFileName(file))
        .filter((hash): hash is Hash => hash !== null);
    } catch (error) {
      throw new StorageError(
        `Failed to list events: ${error instanceof Error ? error.message : 'unknown error'}`,
        error instanceof Error ? error : undefined,
      );
    }
  };

  return { storeEvent, retrieveEvent, listEvents };
}

function createMultiRootBlockStore(storage: MultiRootStorageBackend): BlockStoreApi {
  const store = async (hash: Hash, data: EncryptedData, skipIfExists = false): Promise<void> => {
    const path = blockPath(hash);
    try {
      if (skipIfExists && (await storage.exists(path))) {
        return;
      }
      await storage.writeFile(path, data);
    } catch (error) {
      throw new StorageError(
        `Failed to store block: ${error instanceof Error ? error.message : 'unknown error'}`,
        error instanceof Error ? error : undefined,
      );
    }
  };

  const retrieve = async (hash: Hash): Promise<EncryptedData> => {
    const path = blockPath(hash);
    try {
      const bytes = await storage.readValidatedFile(path, (data) => validateBlockBytes(hash, data));
      return bytes as EncryptedData;
    } catch (error) {
      if (error instanceof StorageError) {
        throw error;
      }
      throw new StorageError(
        `Failed to retrieve block: ${error instanceof Error ? error.message : 'unknown error'}`,
        error instanceof Error ? error : undefined,
      );
    }
  };

  const has = async (hash: Hash): Promise<boolean> => storage.exists(blockPath(hash));

  return { store, retrieve, has };
}
