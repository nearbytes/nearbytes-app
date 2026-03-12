import type { Secret } from '../types/keys.js';
import { EventType } from '../types/events.js';
import type { CryptoOperations } from '../crypto/index.js';
import type { StorageBackend, ChannelPathMapper } from '../types/storage.js';
import type { Volume, FileSystemState, FileMetadata, EventLogEntry } from '../types/volume.js';
import { createVolume } from '../types/volume.js';
import { ChannelStorage } from '../storage/channel.js';
import { defaultPathMapper } from '../types/storage.js';
import { serializeEventPayload } from '../storage/serialization.js';

/**
 * Opens a volume from a secret
 * Derives keys, creates volume object, and ensures storage directory exists
 * 
 * This is a pure function: same secret always produces same volume
 * 
 * @param secret - Volume secret
 * @param crypto - Cryptographic operations
 * @param storage - Storage backend
 * @param pathMapper - Function to map public key to volume path
 * @returns Volume object
 */
export async function openVolume(
  secret: Secret,
  crypto: CryptoOperations,
  storage: StorageBackend,
  pathMapper: ChannelPathMapper = defaultPathMapper
): Promise<Volume> {
  // Derive key pair from secret (deterministic)
  const keyPair = await crypto.deriveKeys(secret);

  // Derive storage path from public key (deterministic)
  const path = pathMapper(keyPair.publicKey);

  // Ensure directory exists (idempotent)
  await storage.createDirectory(path);

  // Create and return volume
  return createVolume(secret, keyPair.publicKey, path);
}

/**
 * Loads all events from a volume's event log
 * Events are loaded from storage and returned in deterministic order
 * 
 * @param volume - Volume to load events from
 * @param channelStorage - Channel storage instance
 * @returns Array of event log entries, sorted by event hash (deterministic)
 */
export async function loadEventLog(
  volume: Volume,
  channelStorage: ChannelStorage
): Promise<EventLogEntry[]> {
  // List all event hashes
  const eventHashes = await channelStorage.listEvents(volume.publicKey);

  // Load all events
  const entries: EventLogEntry[] = [];
  for (const eventHash of eventHashes) {
    const signedEvent = await channelStorage.retrieveEvent(volume.publicKey, eventHash);
    entries.push({
      eventHash,
      signedEvent,
    });
  }

  // Sort by event hash (deterministic ordering)
  entries.sort((a, b) => {
    if (a.eventHash < b.eventHash) return -1;
    if (a.eventHash > b.eventHash) return 1;
    return 0;
  });

  return entries;
}

/**
 * Verifies all events in the event log
 * Checks that all events are signed by the volume's public key
 * 
 * @param entries - Event log entries to verify
 * @param volume - Volume (contains public key)
 * @param crypto - Cryptographic operations
 * @throws Error if any event signature is invalid
 */
export async function verifyEventLog(
  entries: EventLogEntry[],
  volume: Volume,
  crypto: CryptoOperations
): Promise<void> {
  for (const entry of entries) {
    const payloadBytes = serializeEventPayload(entry.signedEvent.payload);
    const isValid = await crypto.verifyPU(
      payloadBytes,
      entry.signedEvent.signature,
      volume.publicKey
    );

    if (!isValid) {
      throw new Error(
        `Event signature verification failed for event ${entry.eventHash}`
      );
    }
  }
}

/**
 * Replays events to materialize the file system state
 * Processes events in order and builds the final file system state
 * 
 * This is a pure function: deterministic replay produces deterministic state
 * 
 * @param entries - Event log entries (must be sorted and verified)
 * @returns Materialized file system state
 */
export function replayEvents(entries: EventLogEntry[]): FileSystemState {
  const files = new Map<string, FileMetadata>();

  for (const entry of entries) {
    const { signedEvent } = entry;
    const { type, fileName, hash } = signedEvent.payload;

    if (type === EventType.CREATE_FILE) {
      // Add or update file
      files.set(fileName, {
        name: fileName,
        contentAddress: hash,
        eventHash: entry.eventHash,
      });
    } else if (type === EventType.DELETE_FILE) {
      // Remove file (idempotent: no-op if file doesn't exist)
      files.delete(fileName);
    } else if (type === EventType.RENAME_FILE) {
      const existing = files.get(fileName);
      if (!existing) {
        continue;
      }
      files.delete(fileName);
      files.set(signedEvent.payload.toFileName ?? fileName, {
        ...existing,
        name: signedEvent.payload.toFileName ?? fileName,
        eventHash: entry.eventHash,
      });
    }
  }

  return {
    files: new Map(files), // Make immutable
  };
}

/**
 * Materializes a volume's file system state
 * Loads event log, verifies signatures, and replays events
 * 
 * This is the main function for getting the current state of a volume
 * 
 * @param volume - Volume to materialize
 * @param channelStorage - Channel storage instance
 * @param crypto - Cryptographic operations
 * @returns Materialized file system state
 */
export async function materializeVolume(
  volume: Volume,
  channelStorage: ChannelStorage,
  crypto: CryptoOperations
): Promise<FileSystemState> {
  // 1. Load all events
  const entries = await loadEventLog(volume, channelStorage);

  // 2. Verify all event signatures
  await verifyEventLog(entries, volume, crypto);

  // 3. Replay events to materialize state
  return replayEvents(entries);
}

/**
 * Gets a file from a materialized volume
 * 
 * @param fileSystemState - Materialized file system state
 * @param fileName - Name of the file to get
 * @returns File metadata, or undefined if file doesn't exist
 */
export function getFile(
  fileSystemState: FileSystemState,
  fileName: string
): FileMetadata | undefined {
  return fileSystemState.files.get(fileName);
}

/**
 * Lists all files in a materialized volume
 * 
 * @param fileSystemState - Materialized file system state
 * @returns Array of file metadata, sorted by file name
 */
export function listFiles(fileSystemState: FileSystemState): FileMetadata[] {
  const files = Array.from(fileSystemState.files.values());
  files.sort((a, b) => {
    if (a.name < b.name) return -1;
    if (a.name > b.name) return 1;
    return 0;
  });
  return files;
}
