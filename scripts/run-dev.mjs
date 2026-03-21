#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const repoRoot = process.cwd();
const args = process.argv.slice(2);
const killFirst = args.includes('--kill');
const killOnly = killFirst && args.length === 1;
const { debugValue, passthroughArgs } = extractDebugFlag(args.filter((arg) => arg !== '--kill'));
const forwardedArgs = passthroughArgs;
const devSessionPath = path.join(repoRoot, '.nearbytes-dev-run.json');
const desktopSessionPath =
  process.env.NEARBYTES_DESKTOP_SESSION_FILE && process.env.NEARBYTES_DESKTOP_SESSION_FILE.trim().length > 0
    ? path.resolve(process.env.NEARBYTES_DESKTOP_SESSION_FILE)
    : path.join(os.homedir(), '.nearbytes', 'desktop-session.json');
const devUiUrl = 'http://127.0.0.1:5173';

await main();

async function main() {
  await killExistingDevProcesses();
  if (killOnly) {
    return;
  }

  const childEnv = {
    ...process.env,
    ...(debugValue
      ? {
          DEBUG: process.env.DEBUG && process.env.DEBUG.trim().length > 0
            ? `${process.env.DEBUG.trim()},${debugValue}`
            : debugValue,
        }
      : {}),
  };

  let uiChild = null;
  console.log(`[dev-run] starting renderer dev server on ${devUiUrl}`);
  uiChild = spawn(
    ...buildSpawnInvocation('yarn', ['--cwd', 'ui', 'dev', '--host', '127.0.0.1', '--port', '5173', '--strictPort']),
    {
      cwd: repoRoot,
      env: childEnv,
      stdio: 'inherit',
      shell: false,
    }
  );
  uiChild.once('error', (error) => {
    console.error(`[dev-run] renderer dev server failed to start: ${formatError(error)}`);
  });
  console.log(`[dev-run] waiting for renderer dev server at ${devUiUrl}`);
  await waitForHttpEndpoint(devUiUrl, 30_000, uiChild, 'renderer dev server');

  console.log('[dev-run] starting desktop runtime');
  const desktopStartedAt = Date.now();
  const desktopChild = spawn(...buildSpawnInvocation('yarn', ['desktop:run', ...forwardedArgs]), {
    cwd: repoRoot,
    env: {
      ...childEnv,
      NEARBYTES_EXTERNAL_DEV_SERVER: '1',
    },
    stdio: 'inherit',
    shell: false,
  });

  await writeDevSession({
    launcherPid: process.pid,
    childPid: desktopChild.pid ?? null,
    desktopPid: desktopChild.pid ?? null,
    uiPid: uiChild?.pid ?? null,
    createdAt: Date.now(),
  });

  const desktopSession = await waitForDesktopSession(desktopSessionPath, desktopStartedAt, 30_000, desktopChild);
  console.log(`[dev-run] desktop API ready on http://127.0.0.1:${desktopSession.port}`);

  let cleanupPromise = null;
  const cleanup = async () => {
    if (cleanupPromise) {
      return cleanupPromise;
    }
    cleanupPromise = (async () => {
      if (desktopChild.pid) {
        await killManagedProcess(desktopChild.pid, 'SIGTERM');
      }
      if (uiChild?.pid) {
        await killManagedProcess(uiChild.pid, 'SIGTERM');
      }
      await clearDevSession();
    })();
    return cleanupPromise;
  };

  const cleanupSync = () => {
    if (desktopChild.pid) {
      killManagedProcessSync(desktopChild.pid, 'SIGTERM');
    }
    if (uiChild?.pid) {
      killManagedProcessSync(uiChild.pid, 'SIGTERM');
    }
    clearDevSessionSync();
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
    console.error(`[dev-run] unhandled error: ${formatError(error)}`);
    void cleanup().finally(() => process.exit(1));
  });
  process.on('unhandledRejection', (error) => {
    console.error(`[dev-run] unhandled rejection: ${formatError(error)}`);
    void cleanup().finally(() => process.exit(1));
  });
  process.on('exit', () => {
    cleanupSync();
  });

  const result = await new Promise((resolve, reject) => {
    desktopChild.once('error', reject);
    desktopChild.once('exit', (code, signal) => {
      resolve({ code, signal });
    });
  });

  await cleanup();
  if (result.signal) {
    process.kill(process.pid, result.signal);
    return;
  }
  process.exit(result.code ?? 0);
}

function buildSpawnInvocation(command, args) {
  const packageManagerInvocation = buildPackageManagerInvocation(command, args);
  if (packageManagerInvocation) {
    return packageManagerInvocation;
  }

  if (process.platform === 'win32') {
    const resolved = `${command}.cmd`;
    const commandLine = [quoteForWindowsCmd(resolved), ...args.map(quoteForWindowsCmd)].join(' ');
    return [process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', commandLine]];
  }

  return [command, args];
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

async function waitForHttpEndpoint(url, timeoutMs, child, label) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (child && child.exitCode !== null) {
      throw new Error(`${label} exited before becoming ready (exit code ${child.exitCode}).`);
    }
    if (await isHttpEndpointReady(url, 1_000)) {
      return;
    }
    await delay(250);
  }
  throw new Error(`${label} did not become ready within ${Math.ceil(timeoutMs / 1000)} seconds at ${url}.`);
}

async function waitForDesktopSession(sessionPath, startedAt, timeoutMs, child) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (child && child.exitCode !== null) {
      throw new Error(`desktop runtime exited before publishing a desktop session (exit code ${child.exitCode}).`);
    }
    const session = await readJsonFile(sessionPath);
    if (
      session &&
      isPositiveInteger(session.pid) &&
      isPositiveInteger(session.port) &&
      typeof session.token === 'string' &&
      session.token.trim().length > 0 &&
      isPositiveInteger(session.createdAt) &&
      session.createdAt >= startedAt
    ) {
      return session;
    }
    await delay(250);
  }
  throw new Error(`desktop runtime did not publish a session within ${Math.ceil(timeoutMs / 1000)} seconds.`);
}

async function isHttpEndpointReady(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  timer.unref?.();
  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
    });
    return response.ok || response.status >= 400;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function delay(timeoutMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, timeoutMs);
  });
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
  if (isPositiveInteger(devSession?.desktopPid)) {
    pids.add(devSession.desktopPid);
  }
  if (isPositiveInteger(devSession?.uiPid)) {
    pids.add(devSession.uiPid);
  }
  if (isPositiveInteger(devSession?.launcherPid)) {
    pids.add(devSession.launcherPid);
  }

  if (process.platform === 'win32') {
    for (const pid of await findWindowsCurrentRepoDevProcesses()) {
      pids.add(pid);
    }
  }

  for (const pid of pids) {
    if (pid === process.pid) {
      continue;
    }
    await killManagedProcess(pid, 'SIGTERM');
  }

  await clearDevSession();
  await clearDesktopSession();
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

async function clearDesktopSession() {
  try {
    await fs.unlink(desktopSessionPath);
  } catch (error) {
    if (!isFileNotFound(error)) {
      throw error;
    }
  }
}

function clearDevSessionSync() {
  try {
    fsSync.unlinkSync(devSessionPath);
  } catch (error) {
    if (!isFileNotFound(error)) {
      throw error;
    }
  }
}

async function findWindowsCurrentRepoDevProcesses() {
  const script = `
$repoPath = '${escapeForPowerShellSingleQuotedString(repoRoot)}'
$patterns = @(
  (Join-Path $repoPath 'scripts\\run-dev.mjs'),
  (Join-Path $repoPath 'scripts\\with-dev-megacmd.mjs'),
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
    .filter((pid) => Number.isInteger(pid) && pid > 0);
}

function escapeForPowerShellSingleQuotedString(value) {
  return value.replace(/'/gu, "''");
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

async function killManagedProcess(pid, signal) {
  if (process.platform === 'win32') {
    await killWindowsProcessTree(pid);
    return;
  }
  safeKill(pid, signal);
}

function killManagedProcessSync(pid, signal) {
  if (process.platform === 'win32') {
    killWindowsProcessTreeSync(pid);
    return;
  }
  safeKill(pid, signal);
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

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
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
