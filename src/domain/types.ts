import type { DecryptedEvent, Hash } from 'nearbytes-crypto';

/**
 * In-memory decrypted event log entry.
 * The log (nearbytes-log) only knows about SignedEvent.
 * Decryption and hydration into EventLogEntry happens in the app's domain layer.
 */
export interface EventLogEntry {
  readonly eventHash: Hash;
  readonly signedEvent: DecryptedEvent;
}
