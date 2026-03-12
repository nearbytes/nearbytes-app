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
  .description('NearBytes cryptographic storage protocol CLI')
  .version('0.1.3');

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
