import type { Command } from 'commander';
import { readFile } from 'fs/promises';
import { basename } from 'path';
import { createCryptoOperations } from '../../crypto/index.js';
import { FilesystemStorageBackend } from '../../storage/filesystem.js';
import { ChannelStorage } from '../../storage/channel.js';
import { storeData } from '../../domain/operations.js';
import { green, red } from '../output/colors.js';
import { validateSecret, validateFilePath } from '../validation.js';
import { getDefaultStorageDir } from '../../storagePath.js';

export interface StoreOptions {
  file: string;
  secret: string;
  dataDir?: string;
}

/**
 * Store command handler
 */
export async function handleStore(options: StoreOptions): Promise<void> {
  try {
    // Validate inputs
    const secret = validateSecret(options.secret);
    await validateFilePath(options.file);

    // Read file data
    const fileBuffer = await readFile(options.file);
    const data = new Uint8Array(fileBuffer);

    // Initialize crypto and storage
    const crypto = createCryptoOperations();
    const storage = new FilesystemStorageBackend(options.dataDir ?? getDefaultStorageDir());
    const channelStorage = new ChannelStorage(storage, (pubKey) =>
      Array.from(pubKey)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
    );

    // Store data
    const fileName = basename(options.file);
    const result = await storeData(data, fileName, secret, crypto, channelStorage);

    // Output result
    console.log(green('✓ Data stored successfully'));
    console.log(`Event Hash: ${result.eventHash}`);
    console.log(`Data Hash: ${result.dataHash}`);
  } catch (error) {
    console.error(red(`✗ Error: ${error instanceof Error ? error.message : 'unknown error'}`));
    process.exit(1);
  }
}

/**
 * Registers the store command
 */
export function registerStoreCommand(program: Command): void {
  program
    .command('store')
    .description('Store data in a channel')
    .requiredOption('-f, --file <path>', 'Path to data file')
    .requiredOption('-s, --secret <secret>', 'Channel secret')
    .option('-d, --data-dir <path>', 'Storage directory (default: ~/nearbytes)', getDefaultStorageDir())
    .action(handleStore);
}

