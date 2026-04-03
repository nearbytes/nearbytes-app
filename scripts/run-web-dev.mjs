#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const uiDir = path.join(repoRoot, 'ui');
const sessionPath = path.join(repoRoot, '.nearbytes-web-dev.json');
const devRunSessionPath = path.join(repoRoot, '.nearbytes-dev-run.json');
const desktopSessionPath =
  process.env.NEARBYTES_DESKTOP_SESSION_FILE && process.env.NEARBYTES_DESKTOP_SESSION_FILE.trim().length > 0
    ? path.resolve(process.env.NEARBYTES_DESKTOP_SESSION_FILE)
    : path.join(os.homedir(), '.nearbytes', 'desktop-session.json');
const apiUrl = 'http://127.0.0.1:3000/config/roots';
const devUiPort = parsePort(process.env.NEARBYTES_WEB_DEV_PORT, 5177);
const devUiHost = '127.0.0.1';
const devUiUrl = `http://${devUiHost}:${devUiPort}`;

await main();

async function main() {
  await killPreviousSession();
  await ensureBackendBuild();

  const backend = spawn(process.execPath, ['dist/server/index.js'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      NEARBYTES_CORS_ORIGIN: buildCorsOrigin(process.env.NEARBYTES_CORS_ORIGIN, devUiPort),
    },
    stdio: 'inherit',
    shell: false,
  });

  backend.once('error', (error) => {
    console.error(`[web-dev] backend failed to start: ${formatError(error)}`);
  });

  await writeSession({ launcherPid: process.pid, backendPid: backend.pid ?? null, startedAt: Date.now() });
  await waitForHttpEndpoint(apiUrl, 30_000, backend, 'Nearbytes backend');

  const ui = spawn(...buildYarnInvocation(['dev:raw']), {
    cwd: uiDir,
    env: {
      ...process.env,
      NEARBYTES_WEB_DEV_PORT: String(devUiPort),
      VITE_NEARBYTES_WEB_DEV_PORT: String(devUiPort),
    },
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
  const result = spawnSync(...buildYarnInvocation(['build']), {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit',
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(`backend build failed with exit code ${result.status ?? 1}`);
  }
}

function buildYarnInvocation(args) {
  if (process.platform === 'win32') {
    const commandLine = ['yarn.cmd', ...args.map(quoteForWindowsCmd)].join(' ');
    return [process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', commandLine]];
  }
  return ['yarn', args];
}

function parsePort(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function buildCorsOrigin(currentValue, port) {
  const origins = new Set(
    (currentValue ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
  );
  origins.add(`http://127.0.0.1:${port}`);
  origins.add(`http://localhost:${port}`);
  return Array.from(origins).join(',');
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
  const devRunSession = await readJsonFile(devRunSessionPath);
  await killManagedProcess(devRunSession?.childPid ?? null);
  await killManagedProcess(devRunSession?.desktopPid ?? null);
  await killManagedProcess(devRunSession?.uiPid ?? null);
  await killManagedProcess(devRunSession?.launcherPid ?? null);
  const desktopSession = await readJsonFile(desktopSessionPath);
  await killManagedProcess(desktopSession?.pid ?? null);
  if (process.platform === 'win32') {
    for (const pid of await findWindowsCurrentRepoDevProcesses()) {
      await killManagedProcess(pid);
    }
  }
  await clearSession();
  await clearDevRunSession();
  await clearDesktopSession();
}

async function killManagedProcess(pid) {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) {
    return;
  }
  if (process.platform === 'win32') {
    await killWindowsProcessTree(pid);
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
  if (process.platform === 'win32') {
    killWindowsProcessTreeSync(pid);
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

async function clearDevRunSession() {
  try {
    await fs.unlink(devRunSessionPath);
  } catch {}
}

async function clearDesktopSession() {
  try {
    await fs.unlink(desktopSessionPath);
  } catch {}
}

function clearSessionSync() {
  try {
    fsSync.unlinkSync(sessionPath);
  } catch {}
}

async function findWindowsCurrentRepoDevProcesses() {
  const script = `
$repoPath = '${escapeForPowerShellSingleQuotedString(repoRoot)}'
$patterns = @(
  (Join-Path $repoPath 'scripts\\run-web-dev.mjs'),
  (Join-Path $repoPath 'scripts\\run-dev.mjs'),
  (Join-Path $repoPath 'dist\\server\\index.js'),
  (Join-Path $repoPath 'dist-electron\\electron\\main.js'),
  (Join-Path $repoPath 'node_modules\\vite\\bin\\vite.js'),
  (Join-Path $repoPath 'node_modules\\electron\\cli.js')
)
Get-CimInstance Win32_Process |
  Where-Object {
    $cmd = $_.CommandLine
    if (-not $cmd) { return $false }
    foreach ($pattern in $patterns) {
      if ($cmd.Contains($pattern)) { return $true }
    }
    return $false
  } |
  Select-Object -ExpandProperty ProcessId
`;

  const output = await captureCommandOutput('powershell', ['-NoProfile', '-Command', script]);
  return output
    .split(/\r?\n/u)
    .map((line) => Number.parseInt(line.trim(), 10))
    .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);
}

function escapeForPowerShellSingleQuotedString(value) {
  return value.replace(/'/gu, "''");
}

async function killWindowsProcessTree(pid) {
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
}

function killWindowsProcessTreeSync(pid) {
  const result = spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
    stdio: 'ignore',
    windowsHide: true,
  });
  const status = result.status;
  if (status === 0 || status === 128 || status === 255) {
    return;
  }
}

async function captureCommandOutput(command, args) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const stdoutChunks = [];
    const stderrChunks = [];
    child.stdout.on('data', (chunk) => {
      stdoutChunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderrChunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) {
        resolve(Buffer.concat(stdoutChunks).toString('utf8'));
        return;
      }
      const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
      reject(new Error(`${command} exited with code ${code ?? 'unknown'}${stderr ? `: ${stderr}` : ''}.`));
    });
  });
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
