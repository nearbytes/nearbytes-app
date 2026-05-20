#!/usr/bin/env node

import { Command } from 'commander';
import { registerDesktopCommand } from './commands/desktop.js';

const program = new Command();

program
  .name('nearbytes')
  .description('Nearbytes desktop runtime CLI')
  .version('0.1.3')
  .option('--debug [scopes]', 'Enable DEBUG logging and debug-only APIs (default: nearbytes)');

program.hook('preAction', (command) => {
  const rawValue = command.optsWithGlobals().debug;
  if (rawValue === undefined || rawValue === false) {
    return;
  }
  const debugValue =
    typeof rawValue === 'string' && rawValue.trim().length > 0 ? rawValue.trim() : 'nearbytes';
  const existing = process.env.DEBUG?.trim();
  process.env.DEBUG = existing ? `${existing},${debugValue}` : debugValue;
});

registerDesktopCommand(program);

program.parse();
