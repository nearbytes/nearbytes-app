#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createServer as createNetServer } from 'node:net';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const dotEnvPath = path.join(repoRoot, '.env.e2e');

loadDotEnvIfPresent(dotEnvPath);

const config = {
  remoteMode: trimOrDefault(process.env.NEARBYTES_E2E_TIGHT_REMOTE_MODE, 'ssh'),
  attempts: readPositiveIntEnv('NEARBYTES_E2E_TIGHT_ATTEMPTS', 1),
  buildTimeoutMs: readPositiveIntEnv('NEARBYTES_E2E_TIGHT_BUILD_TIMEOUT_MS', 120_000),
  startupTimeoutMs: readPositiveIntEnv('NEARBYTES_E2E_TIGHT_STARTUP_TIMEOUT_MS', 90_000),
  runTimeoutMs: readPositiveIntEnv('NEARBYTES_E2E_TIGHT_RUN_TIMEOUT_MS', 180_000),
  settleDelayMs: readPositiveIntEnv('NEARBYTES_E2E_TIGHT_SETTLE_DELAY_MS', 1_000),
  localPort: readPositiveIntEnv('NEARBYTES_E2E_TIGHT_LOCAL_PORT', 3100),
  remotePort: readPositiveIntEnv('NEARBYTES_E2E_TIGHT_REMOTE_PORT', 3101),
  localUiPort: readPositiveIntEnv('NEARBYTES_E2E_TIGHT_LOCAL_UI_PORT', 5179),
  remoteUiPort: readPositiveIntEnv('NEARBYTES_E2E_TIGHT_REMOTE_UI_PORT', 5180),
  localHome: trimOrDefault(process.env.NEARBYTES_E2E_TIGHT_LOCAL_HOME, '/tmp/nearbytes-e2e-local-home'),
  remoteHome: trimOrDefault(process.env.NEARBYTES_E2E_TIGHT_REMOTE_HOME, '/tmp/nearbytes-e2e-remote-home'),
  remoteSsh: trimOrDefault(process.env.NEARBYTES_E2E_REMOTE_SSH, 'pc-ciancia'),
  localCorepack: resolveLocalCorepack(),
  remoteCorepack: trimOrDefault(process.env.NEARBYTES_E2E_TIGHT_REMOTE_COREPACK, '/usr/bin/corepack'),
  logsDir: path.join(os.homedir(), '.nearbytes', 'logs'),
  hubScriptPath: path.join(repoRoot, 'scripts', 'e2e-mega-crosshost-hub.mjs'),
};

let buildCompleted = false;

try {
  for (let attempt = 1; attempt <= config.attempts; attempt += 1) {
    const result = await runAttempt(attempt);
    if (result.ok) {
      console.error('[tight-loop] SUCCESS', { attempt });
      process.exit(0);
    }
    console.error('[tight-loop] FAILURE', {
      attempt,
      category: result.category,
      message: result.message,
    });
    if (result.summary) {
      console.error('[tight-loop] summary', result.summary);
    }
    if (attempt < config.attempts) {
      await sleep(config.settleDelayMs);
    }
  }
  process.exit(1);
} catch (error) {
  console.error('[tight-loop] FATAL', error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
}

async function runAttempt(attempt) {
  const localLogPath = path.join(config.logsDir, `e2e-tight-local-${attempt}.log`);
  const remoteLogPath = path.posix.join('~/.nearbytes/logs', `e2e-tight-remote-${attempt}.log`);
  const remoteLogRealPath = remoteLogPath.replace(/^~/u, '$HOME');
  const state = {
    localChild: null,
    remoteLocalChild: null,
    remotePid: null,
  };

  mkdirSync(config.logsDir, { recursive: true });
  mkdirSync(config.localHome, { recursive: true });

  try {
    if (!buildCompleted) {
      console.error('[tight-loop] building once before attempts');
      await runCommand(
        buildYarnCommand(['build']),
        {
          cwd: repoRoot,
          env: process.env,
          logPrefix: '[tight-loop][build]',
        },
        config.buildTimeoutMs
      );
      buildCompleted = true;
    }

    await clearDedicatedPorts();

    console.error('[tight-loop] starting clean local dev');
    state.localChild = startLocalDev(localLogPath);
    await waitForLocalHealth(config.localPort, config.startupTimeoutMs, state.localChild, localLogPath);

    let remoteBaseUrl;
    if (config.remoteMode === 'local') {
      console.error('[tight-loop] starting second clean local dev as remote peer');
      state.remoteLocalChild = startSecondaryLocalDev(remoteLogRealPath.replace(/^\$HOME/u, os.homedir()));
      await waitForLocalHealth(
        config.remotePort,
        config.startupTimeoutMs,
        state.remoteLocalChild,
        remoteLogRealPath.replace(/^\$HOME/u, os.homedir())
      );
      remoteBaseUrl = `http://127.0.0.1:${config.remotePort}`;
    } else {
      console.error('[tight-loop] starting clean remote dev');
      state.remotePid = await startRemoteDev(remoteLogRealPath);
      await waitForRemoteHealth(config.remoteSsh, config.remotePort, config.startupTimeoutMs, remoteLogRealPath);
      remoteBaseUrl = `http://127.0.0.1:${await reservePort()}`;
    }

    console.error('[tight-loop] running bounded cross-host attempt');
    const harnessEnv = {
      ...process.env,
      NEARBYTES_E2E_SKIP_DIAGNOSTICS: '1',
      NEARBYTES_E2E_LOCAL_BASE_URL: `http://127.0.0.1:${config.localPort}`,
      ...(config.remoteMode === 'local'
        ? {
            NEARBYTES_E2E_REMOTE_BASE_URL: remoteBaseUrl,
          }
        : {
            NEARBYTES_E2E_REMOTE_TARGET_PORT: String(config.remotePort),
            NEARBYTES_E2E_REMOTE_TUNNEL_PORT: String(Number.parseInt(remoteBaseUrl.split(':').at(-1) ?? '0', 10)),
          }),
      NEARBYTES_E2E_MEGA_CROSSHOST_ITERATIONS: '1',
      NEARBYTES_E2E_MEGA_OWNER_READY_TIMEOUT_MS: String(readPositiveIntEnv('NEARBYTES_E2E_MEGA_OWNER_READY_TIMEOUT_MS', 60_000)),
      NEARBYTES_E2E_MEGA_INCOMING_OFFER_TIMEOUT_MS: String(readPositiveIntEnv('NEARBYTES_E2E_MEGA_INCOMING_OFFER_TIMEOUT_MS', 60_000)),
      NEARBYTES_E2E_MEGA_RECIPIENT_READY_TIMEOUT_MS: String(readPositiveIntEnv('NEARBYTES_E2E_MEGA_RECIPIENT_READY_TIMEOUT_MS', 60_000)),
      NEARBYTES_E2E_MEGA_FILE_TIMEOUT_MS: String(readPositiveIntEnv('NEARBYTES_E2E_MEGA_FILE_TIMEOUT_MS', 75_000)),
      NEARBYTES_E2E_MEGA_TUNNEL_TIMEOUT_MS: String(readPositiveIntEnv('NEARBYTES_E2E_MEGA_TUNNEL_TIMEOUT_MS', 15_000)),
      NEARBYTES_E2E_MEGA_WIPE_TIMEOUT_MS: String(readPositiveIntEnv('NEARBYTES_E2E_MEGA_WIPE_TIMEOUT_MS', 240_000)),
    };
    const harness = await runCommand(
      [process.execPath, [config.hubScriptPath]],
      {
        cwd: repoRoot,
        env: harnessEnv,
        capture: true,
        logPrefix: '[tight-loop][harness]',
      },
      config.runTimeoutMs
    );

    if (harness.exitCode === 0) {
      return { ok: true };
    }

    const localTail = readLocalTail(localLogPath, 80);
    const remoteTail = await readAttemptRemoteTail(remoteLogRealPath, 80);
    return buildFailureResult(harness.output, localTail, remoteTail, `Harness exited with ${harness.exitCode}.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const localTail = readLocalTail(localLogPath, 80);
    const remoteTail = await readAttemptRemoteTail(remoteLogRealPath, 80);
    return buildFailureResult('', localTail, remoteTail, message);
  } finally {
    await teardownAttempt(state);
  }
}

async function readAttemptRemoteTail(remoteLogRealPath, lineCount) {
  if (config.remoteMode === 'local') {
    return readLocalTail(remoteLogRealPath.replace(/^\$HOME/u, os.homedir()), lineCount);
  }
  return await readRemoteTail(config.remoteSsh, remoteLogRealPath, lineCount);
}

function startLocalDev(logPath) {
  const logFd = openSync(logPath, 'w');
  const child = spawn(config.localCorepack, ['yarn', 'dev'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
      COREPACK_HOME: path.join(os.homedir(), '.cache', 'node', 'corepack'),
      HOME: config.localHome,
      PORT: String(config.localPort),
      NEARBYTES_WEB_DEV_PORT: String(config.localUiPort),
      NEARBYTES_WEB_DEV_SESSION_FILE: path.join(config.localHome, '.nearbytes-web-dev.json'),
      NEARBYTES_DEV_RUN_SESSION_FILE: path.join(config.localHome, '.nearbytes-dev-run.json'),
      NEARBYTES_DESKTOP_SESSION_FILE: path.join(config.localHome, '.nearbytes', 'desktop-session.json'),
    },
    stdio: ['ignore', logFd, logFd],
    detached: false,
  });
  return child;
}

function startSecondaryLocalDev(logPath) {
  mkdirSync(config.remoteHome, { recursive: true });
  const logFd = openSync(logPath, 'w');
  return spawn(config.localCorepack, ['yarn', 'dev'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
      COREPACK_HOME: path.join(os.homedir(), '.cache', 'node', 'corepack'),
      HOME: config.remoteHome,
      PORT: String(config.remotePort),
      NEARBYTES_WEB_DEV_PORT: String(config.remoteUiPort),
      NEARBYTES_WEB_DEV_SESSION_FILE: path.join(config.remoteHome, '.nearbytes-web-dev.json'),
      NEARBYTES_DEV_RUN_SESSION_FILE: path.join(config.remoteHome, '.nearbytes-dev-run.json'),
      NEARBYTES_DESKTOP_SESSION_FILE: path.join(config.remoteHome, '.nearbytes', 'desktop-session.json'),
    },
    stdio: ['ignore', logFd, logFd],
    detached: false,
  });
}

async function startRemoteDev(remoteLogPath) {
  const command = [
    'cd ~/data/local/repos/nearbytes-app',
    `mkdir -p ${shellQuote(config.remoteHome)} ~/.nearbytes/logs ~/.cache/node/corepack`,
    `nohup env COREPACK_ENABLE_DOWNLOAD_PROMPT=0 COREPACK_HOME=~/.cache/node/corepack HOME=${shellQuote(config.remoteHome)} PORT=${config.remotePort} NEARBYTES_WEB_DEV_PORT=${config.remoteUiPort} ${shellQuote(config.remoteCorepack)} yarn dev > ${remoteLogPath} 2>&1 < /dev/null & echo $!`,
  ].join(' && ');
  const result = await runCommand(
    ['ssh', [config.remoteSsh, 'bash', '-lc', command]],
    {
      cwd: repoRoot,
      env: process.env,
      capture: true,
      logPrefix: '[tight-loop][remote-start]',
    },
    20_000
  );
  const pid = Number.parseInt(result.output.trim().split(/\s+/u).at(-1) ?? '', 10);
  if (!Number.isInteger(pid) || pid <= 0) {
    console.error('[tight-loop] remote dev pid unavailable, continuing with health-based supervision');
    return null;
  }
  return pid;
}

async function waitForLocalHealth(port, timeoutMs, child, logPath) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Local dev exited before health. Log tail:\n${readLocalTail(logPath, 40)}`);
    }
    if (await isHttpHealthy(`http://127.0.0.1:${port}/health`)) {
      return;
    }
    await sleep(500);
  }
  throw new Error(`Local dev health timeout after ${timeoutMs}ms. Log tail:\n${readLocalTail(logPath, 40)}`);
}

async function waitForRemoteHealth(sshHost, port, timeoutMs, remoteLogPath) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await runCommand(
      ['ssh', [sshHost, 'bash', '-lc', `curl -fsS http://127.0.0.1:${port}/health`]],
      {
        cwd: repoRoot,
        env: process.env,
        capture: true,
        quietOnFailure: true,
      },
      10_000,
      true
    );
    if (result.exitCode === 0) {
      return;
    }
    await sleep(500);
  }
  const remoteTail = await readRemoteTail(sshHost, remoteLogPath, 40);
  throw new Error(`Remote dev health timeout after ${timeoutMs}ms. Log tail:\n${remoteTail}`);
}

async function teardownAttempt(state) {
  if (state.localChild && state.localChild.exitCode === null) {
    state.localChild.kill('SIGTERM');
    await sleep(2_000);
    if (state.localChild.exitCode === null) {
      state.localChild.kill('SIGKILL');
    }
  }
  if (state.remoteLocalChild && state.remoteLocalChild.exitCode === null) {
    state.remoteLocalChild.kill('SIGTERM');
    await sleep(2_000);
    if (state.remoteLocalChild.exitCode === null) {
      state.remoteLocalChild.kill('SIGKILL');
    }
  }
  if (state.remotePid) {
    await runCommand(
      ['ssh', [config.remoteSsh, 'bash', '-lc', `kill ${state.remotePid} >/dev/null 2>&1 || true`]],
      {
        cwd: repoRoot,
        env: process.env,
        capture: true,
        quietOnFailure: true,
      },
      10_000,
      true
    );
  }
}

async function clearDedicatedPorts() {
  await runCommand(
    ['zsh', ['-lc', `for pid in $(lsof -ti tcp:${config.localPort} -sTCP:LISTEN 2>/dev/null); do kill $pid >/dev/null 2>&1 || true; done`]],
    {
      cwd: repoRoot,
      env: process.env,
      capture: true,
      quietOnFailure: true,
    },
    10_000,
    true
  );
  if (config.remoteMode === 'local') {
    await runCommand(
      ['zsh', ['-lc', `for pid in $(lsof -ti tcp:${config.remotePort} -sTCP:LISTEN 2>/dev/null); do kill $pid >/dev/null 2>&1 || true; done`]],
      {
        cwd: repoRoot,
        env: process.env,
        capture: true,
        quietOnFailure: true,
      },
      10_000,
      true
    );
  } else {
    await runCommand(
      ['ssh', [config.remoteSsh, 'bash', '-lc', `for pid in $(lsof -ti tcp:${config.remotePort} -sTCP:LISTEN 2>/dev/null); do kill $pid >/dev/null 2>&1 || true; done`]],
      {
        cwd: repoRoot,
        env: process.env,
        capture: true,
        quietOnFailure: true,
      },
      10_000,
      true
    );
  }
}

async function runCommand(commandTuple, options, timeoutMs, allowFailure = false) {
  const [command, args] = commandTuple;
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });

  let output = '';
  if (options.capture) {
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
  }

  const timeout = setTimeout(() => {
    child.kill('SIGTERM');
    setTimeout(() => {
      if (child.exitCode === null) {
        child.kill('SIGKILL');
      }
    }, 2_000).unref?.();
  }, timeoutMs);
  timeout.unref?.();

  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 0));
  }).finally(() => clearTimeout(timeout));

  if (!allowFailure && exitCode !== 0) {
    const suffix = options.capture && output.trim() ? `\n${truncate(output.trim(), 8_000)}` : '';
    throw new Error(`${options.logPrefix ?? command} failed with exit code ${exitCode}.${suffix}`);
  }
  return { exitCode, output };
}

async function isHttpHealthy(url) {
  try {
    const response = await fetch(url, { method: 'GET' });
    return response.ok;
  } catch {
    return false;
  }
}

async function reservePort() {
  const server = createNetServer();
  server.unref();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (!port) {
    throw new Error('Failed to reserve local tunnel port.');
  }
  return port;
}

function buildFailureResult(harnessOutput, localTail, remoteTail, message) {
  const combined = [message, harnessOutput, localTail, remoteTail].filter(Boolean).join('\n');
  if (/remote-start|remote dev pid|local dev exited before health|health timeout|did not become ready within/iu.test(message)) {
    return {
      ok: false,
      category: 'startup-timeout',
      message,
      summary: 'A clean dev instance failed to boot correctly inside the startup budget.',
    };
  }
  if (/download target not found in tree/iu.test(combined)) {
    return {
      ok: false,
      category: 'tree-refresh-gap',
      message,
      summary: 'Owner sync saw the remote change but could not resolve it in the decrypted tree. This is an app self-healing gap, not a harness hang.',
    };
  }
  if (/MEGA API error -9/iu.test(combined)) {
    return {
      ok: false,
      category: 'credentials',
      message,
      summary: 'Fresh MEGA login failed with API_ENOENT. The saved credentials are invalid for a clean session.',
    };
  }
  if (/health timeout|did not become ready within/iu.test(combined)) {
    return {
      ok: false,
      category: 'startup-timeout',
      message,
      summary: 'A dev server failed to become healthy inside the startup budget.',
    };
  }
  if (/timed out|SIGTERM/iu.test(combined)) {
    return {
      ok: false,
      category: 'wall-clock-timeout',
      message,
      summary: 'The bounded attempt exceeded its wall-clock budget and was terminated.',
    };
  }
  return {
    ok: false,
    category: 'unknown',
    message,
    summary: truncate(combined, 600),
  };
}

function readLocalTail(filePath, lineCount) {
  if (!existsSync(filePath)) {
    return '';
  }
  const lines = readFileSync(filePath, 'utf8').split(/\r?\n/u);
  return lines.slice(-lineCount).join('\n');
}

async function readRemoteTail(sshHost, remoteLogPath, lineCount) {
  const result = await runCommand(
    ['ssh', [sshHost, 'bash', '-lc', `tail -n ${lineCount} ${remoteLogPath} 2>/dev/null || true`]],
    {
      cwd: repoRoot,
      env: process.env,
      capture: true,
      quietOnFailure: true,
    },
    10_000,
    true
  );
  return result.output.trim();
}

function loadDotEnvIfPresent(filePath) {
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

function resolveLocalCorepack() {
  const explicit = trimOrNull(process.env.NEARBYTES_E2E_TIGHT_LOCAL_COREPACK);
  if (explicit) {
    return explicit;
  }
  const sibling = path.join(path.dirname(process.execPath), 'corepack');
  return existsSync(sibling) ? sibling : 'corepack';
}

function buildYarnCommand(args) {
  if (process.platform === 'win32') {
    return [process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', ['yarn.cmd', ...args].join(' ')]];
  }
  return ['yarn', args];
}

function truncate(value, maxLength) {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;
}

function trimOrNull(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function trimOrDefault(value, fallback) {
  return trimOrNull(value) ?? fallback;
}

function readPositiveIntEnv(name, fallback) {
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

function shellQuote(value) {
  return `'${String(value).replace(/'/gu, `'\\''`)}'`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}