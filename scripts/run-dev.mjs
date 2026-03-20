#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const repoRoot = process.cwd();
const args = process.argv.slice(2);
const killFirst = args.includes('--kill');
const { debugValue, passthroughArgs } = extractDebugFlag(args.filter((arg) => arg !== '--kill'));
const forwardedArgs = passthroughArgs;
const devSessionPath = path.join(repoRoot, '.nearbytes-dev-run.json');
const desktopSessionPath =
  process.env.NEARBYTES_DESKTOP_SESSION_FILE && process.env.NEARBYTES_DESKTOP_SESSION_FILE.trim().length > 0
    ? path.resolve(process.env.NEARBYTES_DESKTOP_SESSION_FILE)
    : path.join(os.homedir(), '.nearbytes', 'desktop-session.json');

await main();

async function main() {
  if (killFirst) {
    await killExistingDevProcesses();
  }

  const child = spawn(...buildSpawnInvocation('yarn', ['dev-run:raw', ...forwardedArgs]), {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...(debugValue
        ? {
            DEBUG: process.env.DEBUG && process.env.DEBUG.trim().length > 0
              ? `${process.env.DEBUG.trim()},${debugValue}`
              : debugValue,
          }
        : {}),
    },
    stdio: 'inherit',
    shell: false,
  });

  await writeDevSession({
    launcherPid: process.pid,
    childPid: child.pid ?? null,
    createdAt: Date.now(),
  });

  const cleanup = async () => {
    await clearDevSession();
  };

  process.on('SIGINT', () => {
    void cleanup().finally(() => process.exit(130));
  });
  process.on('SIGTERM', () => {
    void cleanup().finally(() => process.exit(143));
  });
  process.on('exit', () => {
    void cleanup();
  });

  child.on('exit', (code, signal) => {
    void cleanup().finally(() => {
      if (signal) {
        process.kill(process.pid, signal);
        return;
      }
      process.exit(code ?? 0);
    });
  });
}

function buildSpawnInvocation(command, args) {
  if (process.platform === 'win32') {
    const resolved = `${command}.cmd`;
    const commandLine = [quoteForWindowsCmd(resolved), ...args.map(quoteForWindowsCmd)].join(' ');
    return [process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', commandLine]];
  }

  return [command, args];
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

async function killExistingDevProcesses() {
  const pids = new Set();

  const devSession = await readJsonFile(devSessionPath);
  if (isPositiveInteger(devSession?.childPid)) {
    pids.add(devSession.childPid);
  }
  if (isPositiveInteger(devSession?.launcherPid)) {
    pids.add(devSession.launcherPid);
  }

  const desktopSession = await readJsonFile(desktopSessionPath);
  if (isPositiveInteger(desktopSession?.pid)) {
    pids.add(desktopSession.pid);
  }

  for (const pid of pids) {
    if (pid === process.pid) {
      continue;
    }
    safeKill(pid, 'SIGTERM');
  }

  await clearDevSession();
}

async function writeDevSession(session) {
  await fs.writeFile(devSessionPath, `${JSON.stringify(session, null, 2)}\n`, 'utf8');
}

async function clearDevSession() {
  try {
    await fs.unlink(devSessionPath);
  } catch (error) {
    if (!isFileNotFound(error)) {
      throw error;
    }
  }
}

async function readJsonFile(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
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

function isPositiveInteger(value) {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isFileNotFound(error) {
  return (
    !!error &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}

function extractDebugFlag(rawArgs) {
  const passthroughArgs = [];
  let debugValue = null;

  for (let index = 0; index < rawArgs.length; index += 1) {
    const entry = rawArgs[index];
    if (entry === '--debug') {
      const next = rawArgs[index + 1];
      if (next && !next.startsWith('-')) {
        debugValue = next.trim() || 'nearbytes';
        index += 1;
      } else {
        debugValue = 'nearbytes';
      }
      continue;
    }
    if (entry.startsWith('--debug=')) {
      debugValue = entry.slice('--debug='.length).trim() || 'nearbytes';
      continue;
    }
    passthroughArgs.push(entry);
  }

  return {
    debugValue,
    passthroughArgs,
  };
}
