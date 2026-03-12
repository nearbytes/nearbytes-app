import type { Command } from 'commander';
import { createCryptoOperations } from '../../crypto/index.js';
import { FilesystemStorageBackend } from '../../storage/filesystem.js';
import { ChannelStorage } from '../../storage/channel.js';
import { openVolume, materializeVolume, getFile } from '../../domain/volume.js';
import { deleteFile } from '../../domain/operations.js';
import { green, red, yellow } from '../output/colors.js';
import { validateSecret } from '../validation.js';
import { defaultPathMapper } from '../../types/storage.js';
import { getDefaultStorageDir } from '../../storagePath.js';

export interface FileRemoveOptions {
  name: string;
  secret: string;
  dataDir?: string;
  force?: boolean;
}

/**
 * File remove command handler
 * Removes a file from a volume
 */
export async function handleFileRemove(options: FileRemoveOptions): Promise<void> {
  try {
    // Validate inputs
    const secret = validateSecret(options.secret);
    if (!options.name || options.name.trim().length === 0) {
      throw new Error('File name cannot be empty');
    }

    // Initialize crypto and storage
    const crypto = createCryptoOperations();
    const storage = new FilesystemStorageBackend(options.dataDir ?? getDefaultStorageDir());
    const channelStorage = new ChannelStorage(storage, defaultPathMapper);

    // Open volume
    const volume = await openVolume(secret, crypto, storage);

    // Check if file exists
    const fileSystemState = await materializeVolume(volume, channelStorage, crypto);
    const file = getFile(fileSystemState, options.name);

    if (!file) {
      if (options.force) {
        console.log(yellow(`ℹ File "${options.name}" does not exist, but continuing (--force)`));
      } else {
        throw new Error(`File "${options.name}" does not exist in volume`);
      }
    }

    // Confirm deletion (unless --force)
    if (!options.force && file) {
      console.log(yellow(`⚠ Warning: This will remove file "${options.name}" from the volume.`));
      console.log(yellow('The encrypted data block will remain in storage (content-addressed).'));
      console.log(yellow('This action cannot be undone (the file will disappear from the volume).'));
      // In a real implementation, you might want to prompt for confirmation here
      // For MVP, we'll proceed (idempotent operation)
    }

    // Delete file (creates DELETE_FILE event)
    const result = await deleteFile(options.name, secret, crypto, channelStorage);

    // Output result
    if (file) {
      console.log(green('✓ File removed successfully'));
      console.log(`File Name: ${options.name}`);
      console.log(`Event Hash: ${result.eventHash}`);
    } else {
      console.log(yellow('ℹ File was already removed (idempotent operation)'));
      console.log(`Event Hash: ${result.eventHash}`);
    }
  } catch (error) {
    console.error(red(`✗ Error: ${error instanceof Error ? error.message : 'unknown error'}`));
    if (error instanceof Error && error.stack) {
      console.error(red(`Stack: ${error.stack}`));
    }
    process.exit(1);
  }
}

/**
 * Registers the file remove command
 */
export function registerFileRemoveCommand(program: Command): void {
  program
    .command('file remove')
    .alias('file rm')
    .description('Remove a file from a volume')
    .requiredOption('-n, --name <name>', 'File name to remove')
    .requiredOption('-s, --secret <secret>', 'Volume secret')
    .option('-f, --force', 'Force removal (no error if file does not exist)')
    .option('-d, --data-dir <path>', 'Storage directory (default: ~/nearbytes)', getDefaultStorageDir())
    .action(handleFileRemove);
}
