import type { Command } from 'commander';
import { createCryptoOperations } from '../../crypto/index.js';
import { FilesystemStorageBackend } from '../../storage/filesystem.js';
import { ChannelStorage } from '../../storage/channel.js';
import { setupChannel } from '../../domain/operations.js';
import { red } from '../output/colors.js';
import { validateSecret } from '../validation.js';
import { getDefaultStorageDir } from '../../storagePath.js';
import {
  formatEventsAsJson,
  formatEventsAsTable,
  formatEventsAsPlain,
  type OutputFormat,
} from '../output/formatters.js';

export interface ListOptions {
  secret: string;
  dataDir?: string;
  format?: string;
}

/**
 * List command handler
 */
export async function handleList(options: ListOptions): Promise<void> {
  try {
    // Validate inputs
    const secret = validateSecret(options.secret);
    const format = (options.format || 'table') as OutputFormat;

    // Initialize crypto and storage
    const crypto = createCryptoOperations();
    const storage = new FilesystemStorageBackend(options.dataDir ?? getDefaultStorageDir());
    const channelStorage = new ChannelStorage(storage, (pubKey) =>
      Array.from(pubKey)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
    );

    // Get channel public key
    const { publicKey } = await setupChannel(secret, crypto, storage);

    // List events
    const events = await channelStorage.listEvents(publicKey);

    // Format and output
    let output: string;
    switch (format) {
      case 'json':
        output = formatEventsAsJson(events);
        break;
      case 'plain':
        output = formatEventsAsPlain(events);
        break;
      case 'table':
      default:
        output = formatEventsAsTable(events);
        break;
    }

    console.log(output);
  } catch (error) {
    console.error(red(`✗ Error: ${error instanceof Error ? error.message : 'unknown error'}`));
    process.exit(1);
  }
}

/**
 * Registers the list command
 */
export function registerListCommand(program: Command): void {
  program
    .command('list')
    .description('List events in a channel')
    .requiredOption('-s, --secret <secret>', 'Channel secret')
    .option('-d, --data-dir <path>', 'Storage directory (default: ~/nearbytes)', getDefaultStorageDir())
    .option('-f, --format <format>', 'Output format (json, table, plain)', 'table')
    .action(handleList);
}

