#!/usr/bin/env node

import { Command } from 'commander';
import { registerSetupCommand } from './commands/setup.js';
import { registerStoreCommand } from './commands/store.js';
import { registerRetrieveCommand } from './commands/retrieve.js';
import { registerListCommand } from './commands/list.js';
import { registerVolumeOpenCommand } from './commands/volume-open.js';
import { registerFileAddCommand } from './commands/file-add.js';
import { registerFileRemoveCommand } from './commands/file-remove.js';
import { registerFileListCommand } from './commands/file-list.js';
import { registerFileGetCommand } from './commands/file-get.js';
import { registerDesktopCommand } from './commands/desktop.js';

const program = new Command();

program
  .name('nearbytes')
  .description('Nearbytes cryptographic storage protocol CLI')
  .version('0.1.3')
  .option('--debug [scopes]', 'Enable DEBUG logging and debug-only APIs (default: nearbytes)');

program.hook('preAction', (command) => {
  const rawValue = command.optsWithGlobals().debug;
  if (rawValue === undefined || rawValue === false) {
    return;
  }
  const debugValue = typeof rawValue === 'string' && rawValue.trim().length > 0 ? rawValue.trim() : 'nearbytes';
  const existing = process.env.DEBUG?.trim();
  process.env.DEBUG = existing ? `${existing},${debugValue}` : debugValue;
});

// Register all commands
registerSetupCommand(program);
registerStoreCommand(program);
registerRetrieveCommand(program);
registerListCommand(program);

// Register new volume and file commands
registerVolumeOpenCommand(program);
registerFileAddCommand(program);
registerFileRemoveCommand(program);
registerFileListCommand(program);
registerFileGetCommand(program);
registerDesktopCommand(program);

// Parse arguments and execute
program.parse();
