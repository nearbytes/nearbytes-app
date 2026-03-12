import type { Command } from 'commander';
import { createCryptoOperations } from '../../crypto/index.js';
import { FilesystemStorageBackend } from '../../storage/filesystem.js';
import { setupChannel } from '../../domain/operations.js';
import { green, red } from '../output/colors.js';
import { validateSecret } from '../validation.js';
import { getDefaultStorageDir } from '../../storagePath.js';

export interface SetupOptions {
  secret: string;
  dataDir?: string;
}

/**
 * Setup command handler
 */
export async function handleSetup(options: SetupOptions): Promise<void> {
  try {
    // Validate secret
    const secret = validateSecret(options.secret);

    // Initialize crypto and storage
    const crypto = createCryptoOperations();
    const storage = new FilesystemStorageBackend(options.dataDir ?? getDefaultStorageDir());

    // Setup channel
    const result = await setupChannel(secret, crypto, storage);

    // Output result
    console.log(green('✓ Channel initialized successfully'));
    console.log(`Public Key: ${Buffer.from(result.publicKey).toString('hex')}`);
    console.log(`Channel Path: ${result.channelPath}`);
  } catch (error) {
    console.error(red(`✗ Error: ${error instanceof Error ? error.message : 'unknown error'}`));
    process.exit(1);
  }
}

/**
 * Registers the setup command
 */
export function registerSetupCommand(program: Command): void {
  program
    .command('setup')
    .description('Initialize a new channel')
    .requiredOption('-s, --secret <secret>', 'Channel secret (e.g., "channelname:password")')
    .option('-d, --data-dir <path>', 'Storage directory (default: ~/nearbytes)', getDefaultStorageDir())
    .action(handleSetup);
}

