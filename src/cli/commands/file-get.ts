import type { Command } from 'commander';
import { writeFile } from 'fs/promises';
import { createCryptoOperations } from '../../crypto/index.js';
import { FilesystemStorageBackend } from '../../storage/filesystem.js';
import { ChannelStorage } from '../../storage/channel.js';
import { openVolume, materializeVolume, getFile } from '../../domain/volume.js';
import { retrieveData } from '../../domain/operations.js';
import { green, red } from '../output/colors.js';
import { validateSecret, validateOutputPath } from '../validation.js';
import { defaultPathMapper } from '../../types/storage.js';
import { getDefaultStorageDir } from '../../storagePath.js';

export interface FileGetOptions {
  name: string;
  secret: string;
  output: string;
  dataDir?: string;
}

/**
 * File get command handler
 * Retrieves a file from a volume by name
 */
export async function handleFileGet(options: FileGetOptions): Promise<void> {
  try {
    // Validate inputs
    const secret = validateSecret(options.secret);
    if (!options.name || options.name.trim().length === 0) {
      throw new Error('File name cannot be empty');
    }
    await validateOutputPath(options.output);

    // Initialize crypto and storage
    const crypto = createCryptoOperations();
    const storage = new FilesystemStorageBackend(options.dataDir ?? getDefaultStorageDir());
    const channelStorage = new ChannelStorage(storage, defaultPathMapper);

    // Open volume
    const volume = await openVolume(secret, crypto, storage);

    // Materialize file system state
    const fileSystemState = await materializeVolume(volume, channelStorage, crypto);

    // Get file metadata
    const file = getFile(fileSystemState, options.name);
    if (!file) {
      throw new Error(`File "${options.name}" does not exist in volume`);
    }

    // Retrieve file data
    const data = await retrieveData(file.eventHash, secret, crypto, channelStorage);

    // Write to output file
    await writeFile(options.output, data);

    // Output result
    console.log(green('✓ File retrieved successfully'));
    console.log(`File Name: ${options.name}`);
    console.log(`Output Path: ${options.output}`);
    console.log(`Size: ${data.length} bytes`);
    console.log(`Content Address: ${file.contentAddress}`);
    console.log(`Event Hash: ${file.eventHash}`);
  } catch (error) {
    console.error(red(`✗ Error: ${error instanceof Error ? error.message : 'unknown error'}`));
    if (error instanceof Error && error.stack) {
      console.error(red(`Stack: ${error.stack}`));
    }
    process.exit(1);
  }
}

/**
 * Registers the file get command
 */
export function registerFileGetCommand(program: Command): void {
  program
    .command('file get')
    .description('Retrieve a file from a volume by name')
    .requiredOption('-n, --name <name>', 'File name to retrieve')
    .requiredOption('-s, --secret <secret>', 'Volume secret')
    .requiredOption('-o, --output <path>', 'Output file path')
    .option('-d, --data-dir <path>', 'Storage directory (default: ~/nearbytes)', getDefaultStorageDir())
    .action(handleFileGet);
}
