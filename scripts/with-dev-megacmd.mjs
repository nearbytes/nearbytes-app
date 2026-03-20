#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { ensureMegaCmdForDev } from './megacmd-helper.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

const childCommand = process.argv[2];
const childArgs = process.argv.slice(3);

if (!childCommand) {
  console.error('Usage: node scripts/with-dev-megacmd.mjs <command> [args...]');
  process.exit(1);
}

const commandDirectory = await ensureMegaCmdForDev(repoRoot);
const exitCode = await runChildProcess(childCommand, childArgs, {
  ...process.env,
  NEARBYTES_MEGACMD_DIR: commandDirectory,
});
process.exit(exitCode);

async function runChildProcess(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveCommand(command), args, {
      cwd: repoRoot,
      env,
      stdio: 'inherit',
      shell: false,
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
        return;
      }
      resolve(code ?? 0);
    });
  });
}

function resolveCommand(command) {
  if (process.platform !== 'win32') {
    return command;
  }

  const extension = path.extname(command);
  if (extension.length > 0) {
    return command;
  }

  if (command === 'yarn' || command === 'npm' || command === 'npx' || command === 'pnpm') {
    return `${command}.cmd`;
  }

  return `${command}.exe`;
}