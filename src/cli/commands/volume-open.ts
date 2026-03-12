import type { Command } from 'commander';
import { createCryptoOperations } from '../../crypto/index.js';
import { FilesystemStorageBackend } from '../../storage/filesystem.js';
import { ChannelStorage } from '../../storage/channel.js';
import { openVolume, materializeVolume } from '../../domain/volume.js';
import { green, red, yellow } from '../output/colors.js';
import { validateSecret } from '../validation.js';
import { defaultPathMapper } from '../../types/storage.js';
import { getDefaultStorageDir } from '../../storagePath.js';

export interface VolumeOpenOptions {
  secret: string;
  dataDir?: string;
}

/**
 * Volume open command handler
 * Opens a volume from a secret and displays volume information
 */
export async function handleVolumeOpen(options: VolumeOpenOptions): Promise<void> {
  try {
    // Validate inputs
    const secret = validateSecret(options.secret);

    // Initialize crypto and storage
    const crypto = createCryptoOperations();
    const storage = new FilesystemStorageBackend(options.dataDir ?? getDefaultStorageDir());
    const channelStorage = new ChannelStorage(storage, defaultPathMapper);

    // Open volume
    const volume = await openVolume(secret, crypto, storage);

    // Materialize file system state
    const fileSystemState = await materializeVolume(volume, channelStorage, crypto);

    // Output result
    console.log(green('✓ Volume opened successfully'));
    console.log(`Public Key: ${Buffer.from(volume.publicKey).toString('hex')}`);
    console.log(`Volume Path: ${volume.path}`);
    console.log(`Files: ${fileSystemState.files.size}`);

    if (fileSystemState.files.size > 0) {
      console.log(yellow('\nFiles in volume:'));
      const files = Array.from(fileSystemState.files.values()).sort((a, b) => 
        a.name.localeCompare(b.name)
      );
      for (const file of files) {
        console.log(`  - ${file.name} (${file.contentAddress.substring(0, 16)}...)`);
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
 * Registers the volume open command
 */
export function registerVolumeOpenCommand(program: Command): void {
  program
    .command('volume open')
    .description('Open a volume from a secret and display information')
    .requiredOption('-s, --secret <secret>', 'Volume secret')
    .option('-d, --data-dir <path>', 'Storage directory (default: ~/nearbytes)', getDefaultStorageDir())
    .action(handleVolumeOpen);
}
