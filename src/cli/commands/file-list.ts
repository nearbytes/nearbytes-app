import type { Command } from 'commander';
import { createCryptoOperations } from '../../crypto/index.js';
import { FilesystemStorageBackend } from '../../storage/filesystem.js';
import { ChannelStorage } from '../../storage/channel.js';
import { openVolume, materializeVolume, listFiles } from '../../domain/volume.js';
import { green, red, yellow } from '../output/colors.js';
import { validateSecret } from '../validation.js';
import { defaultPathMapper } from '../../types/storage.js';
import { getDefaultStorageDir } from '../../storagePath.js';

export interface FileListOptions {
  secret: string;
  dataDir?: string;
  format?: string;
}

/**
 * File list command handler
 * Lists all files in a volume
 */
export async function handleFileList(options: FileListOptions): Promise<void> {
  try {
    // Validate inputs
    const secret = validateSecret(options.secret);
    const format = (options.format || 'table') as 'table' | 'json' | 'plain';

    // Initialize crypto and storage
    const crypto = createCryptoOperations();
    const storage = new FilesystemStorageBackend(options.dataDir ?? getDefaultStorageDir());
    const channelStorage = new ChannelStorage(storage, defaultPathMapper);

    // Open volume
    const volume = await openVolume(secret, crypto, storage);

    // Materialize file system state
    const fileSystemState = await materializeVolume(volume, channelStorage, crypto);

    // List files
    const files = listFiles(fileSystemState);

    // Output result
    if (format === 'json') {
      console.log(JSON.stringify(files, null, 2));
    } else if (format === 'plain') {
      if (files.length === 0) {
        console.log('(no files)');
      } else {
        for (const file of files) {
          console.log(file.name);
        }
      }
    } else {
      // Table format (default)
      if (files.length === 0) {
        console.log(yellow('No files in volume'));
      } else {
        console.log(green(`✓ Found ${files.length} file(s) in volume:`));
        console.log('');
        console.log('File Name'.padEnd(40) + 'Content Address'.padEnd(66) + 'Event Hash');
        console.log('-'.repeat(120));
        for (const file of files) {
          const name = file.name.length > 38 ? file.name.substring(0, 35) + '...' : file.name;
          const contentAddr = file.contentAddress.substring(0, 64);
          const eventHash = file.eventHash.substring(0, 16) + '...';
          console.log(name.padEnd(40) + contentAddr.padEnd(66) + eventHash);
        }
      }
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
 * Registers the file list command
 */
export function registerFileListCommand(program: Command): void {
  program
    .command('file list')
    .alias('file ls')
    .description('List all files in a volume')
    .requiredOption('-s, --secret <secret>', 'Volume secret')
    .option('-d, --data-dir <path>', 'Storage directory (default: ~/nearbytes)', getDefaultStorageDir())
    .option('-f, --format <format>', 'Output format (table, json, plain)', 'table')
    .action(handleFileList);
}
