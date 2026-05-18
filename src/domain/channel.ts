import type { PublicKey, Secret } from 'nearbytes-crypto';
import type { StorageBackend, ChannelPathMapper } from 'nearbytes-storage';
import { defaultPathMapper } from 'nearbytes-storage';

/**
 * Channel domain model
 * Represents a Nearbytes channel identified by a public key
 */
export class Channel {
  constructor(
    public readonly publicKey: PublicKey,
    public readonly path: string
  ) {}

  /**
   * Creates a new channel from a secret
   */
  static async create(
    secret: Secret,
    crypto: import('nearbytes-crypto').CryptoOperations,
    storage: StorageBackend,
    pathMapper: ChannelPathMapper = defaultPathMapper
  ): Promise<Channel> {
    // Derive key pair from secret
    const keyPair = await crypto.deriveKeys(secret);

    // Create channel directory
    const channelPath = pathMapper(keyPair.publicKey);
    await storage.createDirectory(channelPath);

    return new Channel(keyPair.publicKey, channelPath);
  }
}

