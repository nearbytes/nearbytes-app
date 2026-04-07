import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const uiRoot = path.join(repoRoot, 'ui');

export function trimOrNull(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function trimOrDefault(value, fallback) {
  return trimOrNull(value) ?? fallback;
}

export function readPositiveIntEnv(name, fallback) {
  const raw = trimOrNull(process.env[name]);
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

export function normalize(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function buildYarnInvocation(args = []) {
  if (process.platform === 'win32') {
    const commandLine = ['yarn.cmd', ...args.map(quoteForWindowsCmd)].join(' ');
    return [process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', commandLine]];
  }
  return ['yarn', args];
}

export function resolveLocalCorepack() {
  const explicit = trimOrNull(process.env.NEARBYTES_DEV2_LOCAL_COREPACK);
  if (explicit) {
    return explicit;
  }
  const sibling = path.join(path.dirname(process.execPath), 'corepack');
  return existsSync(sibling) ? sibling : 'corepack';
}

export function ensureRepoBuild() {
  const result = spawnSync(...buildYarnInvocation(['build']), {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit',
    shell: false,
  });
  if ((result.status ?? 1) !== 0) {
    throw new Error(`Build failed with exit code ${result.status ?? 1}.`);
  }
}

export function loadDotEnvIfPresent(filePath) {
  if (!existsSync(filePath)) {
    return;
  }
  for (const rawLine of readFileSync(filePath, 'utf8').split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const eq = line.indexOf('=');
    if (eq <= 0) {
      continue;
    }
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

export function appendLog(filePath, text) {
  try {
    mkdirSync(path.dirname(filePath), { recursive: true });
    appendFileSync(filePath, text);
  } catch {
    // Best effort logging only.
  }
}

export function startLoggedProcess({
  label,
  command,
  args,
  cwd = repoRoot,
  env = process.env,
  logPath,
}) {
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => appendLog(logPath, `[${label}:stdout] ${chunk}`));
  child.stderr.on('data', (chunk) => appendLog(logPath, `[${label}:stderr] ${chunk}`));
  child.once('exit', (code, signal) => {
    appendLog(logPath, `[${label}] exited with code=${code} signal=${signal}\n`);
  });

  return child;
}

export async function waitForHttpEndpoint(url, timeoutMs, child, label) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (child && child.exitCode !== null) {
      throw new Error(`${label} exited before becoming ready (exit code ${child.exitCode}).`);
    }
    if (await isHttpEndpointReady(url, 1_000)) {
      return;
    }
    await sleep(250);
  }
  throw new Error(`${label} did not become ready within ${Math.ceil(timeoutMs / 1000)} seconds.`);
}

export async function isHttpEndpointReady(url, timeoutMs) {
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

export async function isHealthy(url, headers = {}) {
  try {
    const response = await fetch(url, { method: 'GET', headers });
    return response.ok;
  } catch {
    return false;
  }
}

export async function waitForHealth(baseUrl, timeoutMs, child, logPath, headers = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Dev instance for ${baseUrl} exited before becoming healthy. Check ${logPath}.`);
    }
    if (await isHealthy(`${baseUrl}/health`, headers)) {
      return;
    }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for ${baseUrl}/health. Check ${logPath}.`);
}

export async function requestJson(baseUrl, method, pathName, body, headers = {}) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${method} ${baseUrl}${pathName} failed with ${response.status}: ${text}`);
  }
  return text.trim() ? JSON.parse(text) : null;
}

export async function clearPorts(ports) {
  for (const port of ports) {
    const command = `for pid in $(lsof -ti tcp:${port} -sTCP:LISTEN 2>/dev/null); do kill $pid >/dev/null 2>&1 || true; done`;
    await new Promise((resolve) => {
      const child = spawn('zsh', ['-lc', command], {
        cwd: repoRoot,
        stdio: 'ignore',
      });
      child.once('exit', () => resolve());
    });
  }
}

export function openSystemBrowser(url) {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'darwin'
    ? [url]
    : process.platform === 'win32'
      ? ['/c', 'start', '', url]
      : [url];
  const child = spawn(command, args, {
    stdio: 'ignore',
    detached: true,
  });
  child.unref();
}

export function waitForExit(child) {
  return new Promise((resolve) => {
    child.once('exit', resolve);
  });
}

export function createManualTestPaths(home) {
  const nearbytesDir = path.join(home, '.nearbytes');
  const integrationStatePath = path.join(nearbytesDir, 'integrations.json');
  const serverSecretStorePath = path.join(nearbytesDir, 'integration-secrets.json');
  const desktopUserDataDir = resolveElectronUserDataDir(home);
  return {
    home,
    nearbytesDir,
    rootsConfigPath: path.join(nearbytesDir, 'roots.json'),
    appConfigPath: path.join(nearbytesDir, 'app-config.json'),
    integrationStatePath,
    serverSecretStorePath,
    desktopUserDataDir,
    desktopSecretStorePath: path.join(desktopUserDataDir, 'integration-secrets.json'),
    desktopSessionPath: path.join(nearbytesDir, 'desktop-session.json'),
    devRunSessionPath: path.join(home, '.nearbytes-dev-run.json'),
    webSessionPath: path.join(home, '.nearbytes-web-dev.json'),
    localRootPath: path.join(home, 'nearbytes', 'local'),
  };
}

export function resolveElectronUserDataDir(home, appName = 'Nearbytes') {
  return path.join(resolveElectronAppDataDir(home), appName);
}

function resolveElectronAppDataDir(home) {
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support');
  }
  if (process.platform === 'win32') {
    return path.join(home, 'AppData', 'Roaming');
  }
  return path.join(home, '.config');
}

export function seedManualTestConfig({ home, rootsConfigPath, appConfigPath, localRootPath, providers }) {
  const nearbytesDir = path.join(home, '.nearbytes');
  const sourceId = 'src-default';
  mkdirSync(nearbytesDir, { recursive: true });
  mkdirSync(localRootPath, { recursive: true });

  writeFileSync(
    rootsConfigPath,
    `${JSON.stringify({
      version: 2,
      sources: [
        {
          id: sourceId,
          provider: 'local',
          path: localRootPath,
          enabled: true,
          writable: true,
          reservePercent: 5,
          opportunisticPolicy: 'block-writes',
        },
      ],
      defaultVolume: {
        destinations: [
          {
            sourceId,
            enabled: true,
            storeEvents: true,
            storeBlocks: true,
            copySourceBlocks: true,
            reservePercent: 5,
            fullPolicy: 'block-writes',
          },
        ],
      },
      volumes: [],
    }, null, 2)}\n`,
    'utf8'
  );

  writeFileSync(
    appConfigPath,
    `${JSON.stringify({
      version: 1,
      features: {
        providers: {
          googleDrive: false,
          mega: providers.mega,
          github: false,
          localNetwork: providers.localNetwork,
        },
        performance: {
          appMetrics: false,
        },
      },
    }, null, 2)}\n`,
    'utf8'
  );
}

export async function confirmDestructiveWipe({ firstLabel, secondLabel, mode, summary }) {
  if (mode === 'wipe') {
    console.error('[manual-dev] destructive wipe forced by --wipe');
    return true;
  }
  if (mode === 'skip') {
    console.error('[manual-dev] destructive wipe skipped by --no-wipe');
    return false;
  }
  console.error('[manual-dev] destructive action available');
  console.error(`[manual-dev] first target: ${firstLabel}`);
  console.error(`[manual-dev] second target: ${secondLabel}`);
  console.error(`[manual-dev] ${summary}`);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });
  try {
    const answer = await rl.question('[manual-dev] continue with destructive wipe? type yes to confirm: ');
    return answer.trim().toLowerCase() === 'yes';
  } finally {
    rl.close();
  }
}

export function parseWipeMode(argv) {
  let wipeMode = 'prompt';
  for (const arg of argv) {
    if (arg === '--wipe') {
      wipeMode = 'wipe';
      continue;
    }
    if (arg === '--no-wipe') {
      wipeMode = 'skip';
    }
  }
  return wipeMode;
}

export async function waitForDesktopSession(sessionPath, timeoutMs, child) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (child && child.exitCode !== null) {
      throw new Error(`Desktop runtime exited before publishing a session (exit code ${child.exitCode}).`);
    }
    const session = await readJsonFile(sessionPath);
    if (
      session &&
      typeof session.port === 'number' &&
      session.port > 0 &&
      typeof session.token === 'string' &&
      session.token.trim().length > 0
    ) {
      return session;
    }
    await sleep(250);
  }
  throw new Error(`Desktop runtime did not publish a session within ${Math.ceil(timeoutMs / 1000)} seconds.`);
}

export function buildCorsOrigin(currentValue, port) {
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

async function readJsonFile(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
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