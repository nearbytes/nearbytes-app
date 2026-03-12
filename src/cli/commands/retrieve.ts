import type { Command } from 'commander';
import { writeFile } from 'fs/promises';
import { createCryptoOperations } from '../../crypto/index.js';
import { FilesystemStorageBackend } from '../../storage/filesystem.js';
import { ChannelStorage } from '../../storage/channel.js';
import { retrieveData } from '../../domain/operations.js';
import { green, red } from '../output/colors.js';
import { validateSecret, validateHash, validateOutputPath } from '../validation.js';
import { getDefaultStorageDir } from '../../storagePath.js';

export interface RetrieveOptions {
  event: string;
  secret: string;
  output: string;
  dataDir?: string;
}

/**
 * Retrieve command handler
 */
export async function handleRetrieve(options: RetrieveOptions): Promise<void> {
  try {
    // Validate inputs
    const secret = validateSecret(options.secret);
    const eventHash = validateHash(options.event);
    await validateOutputPath(options.output);

    // Initialize crypto and storage
    const crypto = createCryptoOperations();
    const storage = new FilesystemStorageBackend(options.dataDir ?? getDefaultStorageDir());
    const channelStorage = new ChannelStorage(storage, (pubKey) =>
      Array.from(pubKey)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
    );

    // Retrieve data
    const data = await retrieveData(eventHash, secret, crypto, channelStorage);

    // Write to output file
    await writeFile(options.output, data);

    console.log(green(`✓ Data retrieved successfully to ${options.output}`));
  } catch (error) {
    console.error(red(`✗ Error: ${error instanceof Error ? error.message : 'unknown error'}`));
    process.exit(1);
  }
}

/**
 * Registers the retrieve command
 */
export function registerRetrieveCommand(program: Command): void {
  program
    .command('retrieve')
    .description('Retrieve data from a channel')
    .requiredOption('-e, --event <hash>', 'Event hash')
    .requiredOption('-s, --secret <secret>', 'Channel secret')
    .requiredOption('-o, --output <path>', 'Output file path')
    .option('-d, --data-dir <path>', 'Storage directory (default: ~/nearbytes)', getDefaultStorageDir())
    .action(handleRetrieve);
}

