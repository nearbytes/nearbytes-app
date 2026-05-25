import type { EncryptedData, Hash, PublicKey, SerializedEvent, SignedEvent } from 'nearbytes-crypto';
import { StorageError, computeHash, verifyPU } from 'nearbytes-crypto';
import type { BlockStoreApi, EventLogApi, Log } from 'nearbytes-log';
import type { ReceptionApi, ReceptionObjectRef, SyncActivityApi } from 'nearbytes-log';
import {
  deserializeEvent,
  publicKeyFromHex,
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
    reception: createInMemoryReception(),
    sync: createInMemorySyncActivity(),
  };
}

/**
 * The multi-root `Log` view is a read/write surface over the on-disk root set;
 * reception and sync journals belong to the local-node lifecycle and are not
 * shared across roots, so we keep an in-memory buffer here. Persistence of
 * reception journals across nearbytes-app process restarts is handled by the
 * upper layer (the `createFilesystemLog`-based primary log), not by this
 * multi-root view.
 */
function createInMemoryReception(): ReceptionApi {
  const refs: ReceptionObjectRef[] = [];
  let counter = 0;
  return {
    appendReception: async (ref) => {
      refs.push(ref);
      counter += 1;
      return String(counter);
    },
    listAfter: async (cursor, limit) => {
      const start = cursor === undefined ? 0 : Math.max(0, Math.min(refs.length, Number(cursor)));
      const window = limit === undefined ? refs.slice(start) : refs.slice(start, start + limit);
      const next = start + window.length;
      return { refs: window, next: next < refs.length ? String(next) : undefined, more: next < refs.length };
    },
    listHubDelta: async () => ({ refs: [], more: false }),
  };
}

function createInMemorySyncActivity(): SyncActivityApi {
  const lines: string[] = [];
  return {
    appendMarker: async (line) => {
      lines.push(line);
    },
    readMarkers: async () => lines.slice(),
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

  const listChannels = async (): Promise<PublicKey[]> => {
    try {
      const files = await storage.listFilesAcrossRoots('channels');
      const seen = new Set<string>();
      const out: PublicKey[] = [];
      for (const entry of files) {
        const parts = entry.split('/');
        if (parts.length === 0) continue;
        const candidate = parts[0]?.toLowerCase();
        if (!candidate || seen.has(candidate)) continue;
        if (!/^[a-f0-9]{130}$/.test(candidate)) continue;
        const pk = publicKeyFromHex(candidate);
        if (pk) {
          out.push(pk);
          seen.add(candidate);
        }
      }
      return out;
    } catch (error) {
      throw new StorageError(
        `Failed to list channels: ${error instanceof Error ? error.message : 'unknown error'}`,
        error instanceof Error ? error : undefined,
      );
    }
  };

  return { storeEvent, retrieveEvent, listEvents, listChannels };
}

function createMultiRootBlockStore(storage: MultiRootStorageBackend): BlockStoreApi {
  const writeAt = async (hash: Hash, data: EncryptedData, skipIfExists: boolean): Promise<void> => {
    const path = blockPath(hash);
    if (skipIfExists && (await storage.exists(path))) {
      return;
    }
    await storage.writeFile(path, data);
  };

  const store = async (data: EncryptedData, skipIfExists = false): Promise<Hash> => {
    try {
      const hash = await computeHash(data);
      await writeAt(hash, data, skipIfExists);
      return hash;
    } catch (error) {
      if (error instanceof StorageError) throw error;
      throw new StorageError(
        `Failed to store block: ${error instanceof Error ? error.message : 'unknown error'}`,
        error instanceof Error ? error : undefined,
      );
    }
  };

  const storeAlreadyVerified = async (
    hash: Hash,
    data: EncryptedData,
    skipIfExists = false,
  ): Promise<void> => {
    try {
      await writeAt(hash, data, skipIfExists);
    } catch (error) {
      if (error instanceof StorageError) throw error;
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

  return { store, storeAlreadyVerified, retrieve, has };
}
