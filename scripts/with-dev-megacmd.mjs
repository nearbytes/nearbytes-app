#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
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
    const child = spawn(...buildSpawnInvocation(command, args), {
      cwd: repoRoot,
      env,
      stdio: 'inherit',
      shell: false,
    });

    let cleanupPromise = null;
    const cleanup = async () => {
      if (cleanupPromise) {
        return cleanupPromise;
      }
      cleanupPromise = killManagedProcess(child.pid, 'SIGTERM');
      return cleanupPromise;
    };

    const cleanupSync = () => {
      killManagedProcessSync(child.pid, 'SIGTERM');
    };

    process.on('SIGINT', () => {
      void cleanup().finally(() => process.exit(130));
    });
    process.on('SIGTERM', () => {
      void cleanup().finally(() => process.exit(143));
    });
    process.on('SIGHUP', () => {
      void cleanup().finally(() => process.exit(129));
    });
    process.on('uncaughtException', (error) => {
      console.error(`[with-dev-megacmd] unhandled error: ${formatError(error)}`);
      void cleanup().finally(() => process.exit(1));
    });
    process.on('unhandledRejection', (error) => {
      console.error(`[with-dev-megacmd] unhandled rejection: ${formatError(error)}`);
      void cleanup().finally(() => process.exit(1));
    });
    process.on('exit', () => {
      cleanupSync();
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

function buildSpawnInvocation(command, args) {
  const packageManagerInvocation = buildPackageManagerInvocation(command, args);
  if (packageManagerInvocation) {
    return packageManagerInvocation;
  }

  const resolvedCommand = resolveCommand(command);

  if (process.platform === 'win32' && isWindowsCommandScript(resolvedCommand)) {
    const commandLine = [quoteForWindowsCmd(resolvedCommand), ...args.map(quoteForWindowsCmd)].join(' ');
    return [process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', commandLine]];
  }

  return [resolvedCommand, args];
}

function buildPackageManagerInvocation(command, args) {
  const normalized = command.trim().toLowerCase();
  if (!['yarn', 'npm', 'npx', 'pnpm'].includes(normalized)) {
    return null;
  }

  const packageManagerEntrypoint = process.env.npm_execpath?.trim();
  if (!packageManagerEntrypoint || !isNodeScriptPath(packageManagerEntrypoint)) {
    return null;
  }

  return [process.execPath, [packageManagerEntrypoint, ...args]];
}

function isNodeScriptPath(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return extension === '.js' || extension === '.cjs' || extension === '.mjs';
}

function isWindowsCommandScript(command) {
  const extension = path.extname(command).toLowerCase();
  return extension === '.cmd' || extension === '.bat';
}

function quoteForWindowsCmd(value) {
  if (value.length === 0) {
    return '""';
  }

  if (!/[\s"]/u.test(value)) {
    return value;
  }

  return `"${value.replace(/"/gu, '""')}"`;
}

async function killManagedProcess(pid, signal) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return;
  }

  if (process.platform === 'win32') {
    await new Promise((resolve, reject) => {
      const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      killer.once('error', reject);
      killer.once('close', (code) => {
        if (code === 0 || code === 128 || code === 255) {
          resolve();
          return;
        }
        reject(new Error(`taskkill failed for PID ${pid} with exit code ${code ?? 'unknown'}.`));
      });
    }).catch((error) => {
      const message = formatError(error);
      if (/not found|no running instance|process .* not found|cannot find the process/i.test(message)) {
        return;
      }
      throw error;
    });
    return;
  }

  safeKill(pid, signal);
}

function killManagedProcessSync(pid, signal) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return;
  }

  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    return;
  }

  safeKill(pid, signal);
}

function safeKill(pid, signal) {
  try {
    process.kill(pid, signal);
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? error.code
        : undefined;
    if (code !== 'ESRCH') {
      throw error;
    }
  }
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}