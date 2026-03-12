import type { Command } from 'commander';
import { readFile } from 'fs/promises';
import { basename } from 'path';
import { createCryptoOperations } from '../../crypto/index.js';
import { FilesystemStorageBackend } from '../../storage/filesystem.js';
import { ChannelStorage } from '../../storage/channel.js';
import { openVolume } from '../../domain/volume.js';
import { storeData } from '../../domain/operations.js';
import { green, red } from '../output/colors.js';
import { validateSecret, validateFilePath } from '../validation.js';
import { defaultPathMapper } from '../../types/storage.js';
import { getDefaultStorageDir } from '../../storagePath.js';

export interface FileAddOptions {
  path: string;
  secret: string;
  name?: string;
  dataDir?: string;
}

/**
 * File add command handler
 * Adds a file to a volume
 */
export async function handleFileAdd(options: FileAddOptions): Promise<void> {
  try {
    // Validate inputs
    const secret = validateSecret(options.secret);
    await validateFilePath(options.path);

    // Determine file name
    const fileName = options.name || basename(options.path);
    if (!fileName || fileName.trim().length === 0) {
      throw new Error('File name cannot be empty');
    }

    // Read file data
    const fileBuffer = await readFile(options.path);
    const data = new Uint8Array(fileBuffer);

    // Initialize crypto and storage
    const crypto = createCryptoOperations();
    const storage = new FilesystemStorageBackend(options.dataDir ?? getDefaultStorageDir());
    const channelStorage = new ChannelStorage(storage, defaultPathMapper);

    // Open volume (ensures it exists)
    await openVolume(secret, crypto, storage);

    // Store file
    const result = await storeData(data, fileName, secret, crypto, channelStorage);

    // Output result
    console.log(green('✓ File added successfully'));
    console.log(`File Name: ${fileName}`);
    console.log(`Event Hash: ${result.eventHash}`);
    console.log(`Data Hash: ${result.dataHash}`);
    console.log(`Size: ${data.length} bytes`);
  } catch (error) {
    console.error(red(`✗ Error: ${error instanceof Error ? error.message : 'unknown error'}`));
    if (error instanceof Error && error.stack) {
      console.error(red(`Stack: ${error.stack}`));
    }
    process.exit(1);
  }
}

/**
 * Registers the file add command
 */
export function registerFileAddCommand(program: Command): void {
  program
    .command('file add')
    .description('Add a file to a volume')
    .requiredOption('-p, --path <path>', 'Path to file to add')
    .requiredOption('-s, --secret <secret>', 'Volume secret')
    .option('-n, --name <name>', 'File name in volume (defaults to basename of path)')
    .option('-d, --data-dir <path>', 'Storage directory (default: ~/nearbytes)', getDefaultStorageDir())
    .action(handleFileAdd);
}
