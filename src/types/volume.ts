import type { PublicKey, Secret } from './keys.js';
import type { Hash } from './events.js';

/**
 * Content address for encrypted data blocks
 * This is the SHA-256 hash of the encrypted data
 */
export type ContentAddress = Hash;

/**
 * File metadata stored in the volume
 * Represents a file that exists in the materialized file system
 */
export interface FileMetadata {
  readonly name: string;
  readonly contentAddress: ContentAddress;
  readonly eventHash: Hash; // The event that created this file
}

/**
 * Event log entry
 * Represents a single event in the append-only log
 */
export interface EventLogEntry {
  readonly eventHash: Hash;
  readonly signedEvent: import('./events.js').SignedEvent;
}

/**
 * Volume represents a Nearbytes volume
 * A volume is deterministically derived from a secret seed
 * and materializes a file system through event log replay
 * 
 * Properties:
 * - Immutable: Volume state is derived, not mutated
 * - Serializable: Can be serialized for storage/transmission
 * - Deterministic: Same secret always produces same volume
 * - No UI concerns: Pure domain model
 */
export interface Volume {
  readonly publicKey: PublicKey;
  readonly secret: Secret; // Not stored, but needed for operations
  readonly path: string; // Storage path for this volume
}

/**
 * Materialized file system state
 * Represents the current state of files in a volume
 * after replaying all events in the event log
 */
export interface FileSystemState {
  readonly files: ReadonlyMap<string, FileMetadata>; // Map<fileName, FileMetadata>
}

/**
 * Creates a Volume from a secret
 * This is a factory function, not a constructor
 */
export function createVolume(
  secret: Secret,
  publicKey: PublicKey,
  path: string
): Volume {
  return {
    publicKey,
    secret,
    path,
  };
}
