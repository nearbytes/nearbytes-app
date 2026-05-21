import type { PublicKey, Secret } from 'nearbytes-crypto';
import type { ChannelPathMapper, Log } from 'nearbytes-log';
import { defaultPathMapper } from 'nearbytes-log';

/**
 * Channel domain model — a Nearbytes channel identified by a public key.
 */
export interface Channel {
  readonly publicKey: PublicKey;
  readonly path: string;
}

/**
 * Ensures the channel directory exists and returns a `Channel` handle.
 */
export async function openChannel(
  secret: Secret,
  crypto: import('nearbytes-crypto').CryptoOperations,
  log: Log,
  pathMapper: ChannelPathMapper = defaultPathMapper,
): Promise<Channel> {
  const keyPair = await crypto.deriveKeys(secret);
  const channelPath = pathMapper(keyPair.publicKey);
  await log.events.listEvents(keyPair.publicKey);
  return { publicKey: keyPair.publicKey, path: channelPath };
}
