#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as fsSync from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const uiDir = path.join(repoRoot, 'ui');
const sessionPath = path.join(repoRoot, '.nearbytes-web-dev.json');
const apiUrl = 'http://127.0.0.1:3000/config/roots';

await main();

async function main() {
  await killPreviousSession();
  await ensureBackendBuild();

  const backend = spawn(process.execPath, ['dist/server/index.js'], {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit',
    shell: false,
  });

  backend.once('error', (error) => {
    console.error(`[web-dev] backend failed to start: ${formatError(error)}`);
  });

  await writeSession({ launcherPid: process.pid, backendPid: backend.pid ?? null, startedAt: Date.now() });
  await waitForHttpEndpoint(apiUrl, 30_000, backend, 'Nearbytes backend');

  const ui = spawn(...buildPackageManagerInvocation('yarn', ['dev:raw']), {
    cwd: uiDir,
    env: process.env,
    stdio: 'inherit',
    shell: false,
  });

  ui.once('error', (error) => {
    console.error(`[web-dev] UI dev server failed to start: ${formatError(error)}`);
  });

  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) {
      return;
    }
    cleaned = true;
    await killManagedProcess(ui.pid ?? null);
    await killManagedProcess(backend.pid ?? null);
    await clearSession();
  };

  process.on('SIGINT', () => {
    void cleanup().finally(() => process.exit(130));
  });
  process.on('SIGTERM', () => {
    void cleanup().finally(() => process.exit(143));
  });
  process.on('exit', () => {
    if (ui.pid) {
      killManagedProcessSync(ui.pid);
    }
    if (backend.pid) {
      killManagedProcessSync(backend.pid);
    }
    clearSessionSync();
  });

  const result = await new Promise((resolve, reject) => {
    ui.once('error', reject);
    ui.once('exit', (code, signal) => resolve({ code, signal }));
  });

  await cleanup();
  if (result.signal) {
    process.kill(process.pid, result.signal);
    return;
  }
  process.exit(result.code ?? 0);
}

async function ensureBackendBuild() {
  const result = spawnSync(...buildPackageManagerInvocation('yarn', ['build']), {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit',
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(`backend build failed with exit code ${result.status ?? 1}`);
  }
}

function buildPackageManagerInvocation(command, args) {
  const packageManagerEntrypoint = process.env.npm_execpath?.trim();
  if (packageManagerEntrypoint && /\.(c?m?js)$/i.test(path.extname(packageManagerEntrypoint))) {
    return [process.execPath, [packageManagerEntrypoint, ...args]];
  }
  if (process.platform === 'win32') {
    return [process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `${command}.cmd ${args.join(' ')}`]];
  }
  return [command, args];
}

async function waitForHttpEndpoint(url, timeoutMs, child, label) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (child?.exitCode !== null) {
      throw new Error(`${label} exited before becoming ready (exit code ${child.exitCode}).`);
    }
    if (await isHttpEndpointReady(url, 1_000)) {
      return;
    }
    await delay(250);
  }
  throw new Error(`${label} did not become ready within ${Math.ceil(timeoutMs / 1000)} seconds.`);
}

async function isHttpEndpointReady(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const response = await fetch(url, { method: 'GET', signal: controller.signal });
    return response.ok || response.status >= 400;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function delay(timeoutMs) {
  return new Promise((resolve) => setTimeout(resolve, timeoutMs));
}

async function killPreviousSession() {
  const session = await readJsonFile(sessionPath);
  await killManagedProcess(session?.backendPid ?? null);
  await killManagedProcess(session?.launcherPid ?? null);
  await clearSession();
}

async function killManagedProcess(pid) {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) {
    return;
  }
  try {
    process.kill(pid, 'SIGTERM');
  } catch {}
}

function killManagedProcessSync(pid) {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) {
    return;
  }
  try {
    process.kill(pid, 'SIGTERM');
  } catch {}
}

async function writeSession(value) {
  await fs.writeFile(sessionPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function clearSession() {
  try {
    await fs.unlink(sessionPath);
  } catch {}
}

function clearSessionSync() {
  try {
    fsSync.unlinkSync(sessionPath);
  } catch {}
}

async function readJsonFile(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}
