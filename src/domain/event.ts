import type { Hash, SignedEvent } from '../types/events.js';
import type { PublicKey } from '../types/keys.js';

/**
 * Event domain model
 * Represents a signed event in a Nearbytes channel
 */
export class Event {
  constructor(
    public readonly hash: Hash,
    public readonly signedEvent: SignedEvent,
    public readonly publicKey: PublicKey
  ) {}

  /**
   * Gets the data hash from the event payload
   */
  get dataHash(): Hash {
    return this.signedEvent.payload.hash;
  }

  /**
   * Gets the encrypted key from the event payload
   */
  get encryptedKey(): import('../types/events.js').EncryptedData {
    return this.signedEvent.payload.encryptedKey;
  }
}

