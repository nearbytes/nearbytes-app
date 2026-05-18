import type { DecryptedEvent, Hash } from 'nearbytes-crypto';
import type { PublicKey } from 'nearbytes-crypto';

/**
 * Event domain model
 * Represents a signed event in a Nearbytes channel
 */
export class Event {
  constructor(
    public readonly hash: Hash,
    public readonly signedEvent: DecryptedEvent,
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
  get encryptedKey(): import('nearbytes-crypto').EncryptedData {
    return this.signedEvent.payload.encryptedKey;
  }
}

