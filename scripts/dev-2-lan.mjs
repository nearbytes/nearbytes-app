#!/usr/bin/env node

import { mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import {
  clearPorts,
  createManualTestPaths,
  ensureRepoBuild,
  openSystemBrowser,
  repoRoot,
  seedManualTestConfig,
  sleep,
  startLoggedProcess,
  trimOrDefault,
  waitForDesktopSession,
  waitForExit,
  waitForHealth,
} from './lib/dev-orchestration.mjs';

const desktopUiPort = 6177;
const remoteApiPort = readPort('NEARBYTES_DEV2_LAN_REMOTE_PORT', 3201);
const remoteUiPort = readPort('NEARBYTES_DEV2_LAN_REMOTE_UI_PORT', 5182);
const startupTimeoutMs = readPort('NEARBYTES_DEV2_LAN_STARTUP_TIMEOUT_MS', 90_000);

const desktopHome = trimOrDefault(process.env.NEARBYTES_DEV2_LAN_DESKTOP_HOME, '/tmp/nearbytes-dev-2-lan-desktop-home');
const remoteHome = trimOrDefault(process.env.NEARBYTES_DEV2_LAN_REMOTE_HOME, '/tmp/nearbytes-dev-2-lan-remote-home');

const logsDir = path.join(os.homedir(), '.nearbytes', 'logs');
const desktopLogPath = path.join(logsDir, 'dev-2-lan-desktop.log');
const remoteLogPath = path.join(logsDir, 'dev-2-lan-remote.log');

const desktopPaths = createManualTestPaths(desktopHome);
const remotePaths = createManualTestPaths(remoteHome);

const children = [];
let shuttingDown = false;

process.on('SIGINT', () => {
  void shutdown(130);
});
process.on('SIGTERM', () => {
  void shutdown(143);
});

try {
  console.error('[dev-2-lan] preparing desktop + remote-browser LAN environment');
  mkdirSync(logsDir, { recursive: true });
  mkdirSync(desktopHome, { recursive: true });
  mkdirSync(remoteHome, { recursive: true });

  seedManualTestConfig({
    ...desktopPaths,
    providers: { mega: false, localNetwork: true },
  });
  seedManualTestConfig({
    ...remotePaths,
    providers: { mega: false, localNetwork: true },
  });

  console.error('[dev-2-lan] building project');
  ensureRepoBuild();
  console.error('[dev-2-lan] clearing dedicated ports', { desktopUiPort, remoteApiPort, remoteUiPort });
  await clearPorts([desktopUiPort, remoteApiPort, remoteUiPort]);

  console.error('[dev-2-lan] starting local desktop runtime');
  const desktopStartedAt = Date.now();
  const desktopChild = startLoggedProcess({
    label: 'desktop',
    command: process.execPath,
    args: [path.join(repoRoot, 'scripts', 'run-dev.mjs')],
    env: {
      ...process.env,
      HOME: desktopHome,
      NEARBYTES_ROOTS_CONFIG: desktopPaths.rootsConfigPath,
      NEARBYTES_APP_CONFIG: desktopPaths.appConfigPath,
      NEARBYTES_SKIP_BOOTSTRAP_DEFAULT_DESTINATION: '1',
      NEARBYTES_WEB_DEV_PORT: String(desktopUiPort),
      VITE_NEARBYTES_WEB_DEV_PORT: String(desktopUiPort),
      NEARBYTES_WEB_DEV_SESSION_FILE: desktopPaths.webSessionPath,
      NEARBYTES_DEV_RUN_SESSION_FILE: desktopPaths.devRunSessionPath,
      NEARBYTES_DESKTOP_SESSION_FILE: desktopPaths.desktopSessionPath,
    },
    logPath: desktopLogPath,
  });
  children.push(desktopChild);

  console.error('[dev-2-lan] waiting for local desktop runtime');
  const desktopSession = await waitForDesktopSession(
    desktopPaths.desktopSessionPath,
    desktopStartedAt,
    startupTimeoutMs,
    desktopChild
  );
  const desktopApiUrl = `http://127.0.0.1:${desktopSession.port}`;
  const desktopHeaders = { 'x-nearbytes-runtime-token': desktopSession.token };
  await waitForHealth(desktopApiUrl, startupTimeoutMs, desktopChild, desktopLogPath, desktopHeaders);

  console.error('[dev-2-lan] starting remote browser runtime');
  const remoteChild = startLoggedProcess({
    label: 'remote-web',
    command: process.execPath,
    args: [path.join(repoRoot, 'scripts', 'run-web-dev.mjs')],
    env: {
      ...process.env,
      HOME: remoteHome,
      PORT: String(remoteApiPort),
      NEARBYTES_ROOTS_CONFIG: remotePaths.rootsConfigPath,
      NEARBYTES_APP_CONFIG: remotePaths.appConfigPath,
      NEARBYTES_SKIP_BOOTSTRAP_DEFAULT_DESTINATION: '1',
      NEARBYTES_WEB_DEV_PORT: String(remoteUiPort),
      VITE_NEARBYTES_WEB_DEV_PORT: String(remoteUiPort),
      NEARBYTES_WEB_DEV_SESSION_FILE: remotePaths.webSessionPath,
      NEARBYTES_DEV_RUN_SESSION_FILE: remotePaths.devRunSessionPath,
      NEARBYTES_DESKTOP_SESSION_FILE: remotePaths.desktopSessionPath,
    },
    logPath: remoteLogPath,
  });
  children.push(remoteChild);

  const remoteApiUrl = `http://127.0.0.1:${remoteApiPort}`;
  await waitForHealth(remoteApiUrl, startupTimeoutMs, remoteChild, remoteLogPath);

  const remoteUiUrl = `http://127.0.0.1:${remoteUiPort}`;
  openSystemBrowser(remoteUiUrl);

  console.error('[dev-2-lan] ready for manual LAN testing');
  console.error(`[dev-2-lan] local desktop UI: http://127.0.0.1:${desktopUiPort}`);
  console.error(`[dev-2-lan] local desktop API: ${desktopApiUrl}`);
  console.error(`[dev-2-lan] remote browser UI: ${remoteUiUrl}`);
  console.error(`[dev-2-lan] remote API: ${remoteApiUrl}`);
  console.error('[dev-2-lan] both participants run with LAN enabled and MEGA disabled');
  console.error('[dev-2-lan] press Ctrl-C to stop both processes');

  await Promise.all(children.map((child) => waitForExit(child)));
  await shutdown(0);
} catch (error) {
  console.error('[dev-2-lan] FAILED', error instanceof Error ? error.stack ?? error.message : String(error));
  await shutdown(1);
}

async function shutdown(exitCode) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  for (const child of children) {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await sleep(1_500);
      if (child.exitCode === null) {
        child.kill('SIGKILL');
      }
    }
  }
  process.exit(exitCode);
}

function readPort(name, fallback) {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}