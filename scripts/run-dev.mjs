#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const repoRoot = process.cwd();
const args = process.argv.slice(2);
const killFirst = args.includes('--kill');
const forwardedArgs = args.filter((arg) => arg !== '--kill');
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

  const child = spawn('yarn', ['dev-run:raw', ...forwardedArgs], {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
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
