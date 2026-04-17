#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import {
  buildYarnInvocation,
  clearPorts,
  createManualTestPaths,
  ensureRepoBuild,
  repoRoot,
  requestJson,
  seedManualTestConfig,
  sleep,
  startLoggedProcess,
  trimOrDefault,
  waitForDesktopSession,
  waitForExit,
  waitForHealth,
  waitForHttpEndpoint,
} from './lib/dev-orchestration.mjs';

const desktopUiPort = 5177;
const phoneUiPort = readPort('NEARBYTES_DEV2_IPHONE_LAN_PHONE_UI_PORT', 5181);
const startupTimeoutMs = readPort('NEARBYTES_DEV2_IPHONE_LAN_STARTUP_TIMEOUT_MS', 90_000);
const desktopHome = trimOrDefault(process.env.NEARBYTES_DEV2_IPHONE_LAN_DESKTOP_HOME, '/tmp/nearbytes-dev-2-iphone-lan-desktop-home');
const phoneHome = trimOrDefault(process.env.NEARBYTES_DEV2_IPHONE_LAN_PHONE_HOME, '/tmp/nearbytes-dev-2-iphone-lan-phone-home');
const logsDir = path.join(os.homedir(), '.nearbytes', 'logs');
const desktopLogPath = path.join(logsDir, 'dev-2-iphone-lan-desktop.log');
const phoneUiLogPath = path.join(logsDir, 'dev-2-iphone-lan-phone-ui.log');
const desktopPaths = createManualTestPaths(desktopHome);
const phonePaths = createManualTestPaths(phoneHome);
const phoneUiUrl = `http://127.0.0.1:${phoneUiPort}`;
const recordedMobileServerPath = path.join(repoRoot, '.nearbytes', 'last-mobile-server-url.json');

const children = [];
let shuttingDown = false;

process.on('SIGINT', () => {
  void shutdown(130);
});
process.on('SIGTERM', () => {
  void shutdown(143);
});

try {
  console.error('[dev-2-iphone-lan] preparing desktop + iPhone LAN environment');
  mkdirSync(logsDir, { recursive: true });
  mkdirSync(desktopHome, { recursive: true });
  mkdirSync(phoneHome, { recursive: true });

  seedManualTestConfig({
    ...desktopPaths,
    providers: { mega: false, localNetwork: true },
  });
  seedManualTestConfig({
    ...phonePaths,
    providers: { mega: false, localNetwork: true },
  });

  console.error('[dev-2-iphone-lan] building project');
  ensureRepoBuild();
  console.error('[dev-2-iphone-lan] clearing dedicated ports', { desktopUiPort, phoneUiPort });
  await clearPorts([desktopUiPort, phoneUiPort]);

  console.error('[dev-2-iphone-lan] starting desktop runtime');
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

  console.error('[dev-2-iphone-lan] waiting for desktop runtime');
  const desktopSession = await waitForDesktopSession(
    desktopPaths.desktopSessionPath,
    desktopStartedAt,
    startupTimeoutMs,
    desktopChild
  );
  const desktopApiUrl = `http://127.0.0.1:${desktopSession.port}`;
  const desktopHeaders = { 'x-nearbytes-runtime-token': desktopSession.token };
  await waitForHealth(desktopApiUrl, startupTimeoutMs, desktopChild, desktopLogPath, desktopHeaders);
  writeDevApiDescriptor(desktopPaths.nearbytesDir, {
    label: 'desktop',
    baseUrl: desktopApiUrl,
    headers: desktopHeaders,
    lanPeersUrl: `${desktopApiUrl}/integrations/local-network/peers`,
    lanSyncUrl: `${desktopApiUrl}/integrations/local-network/peers/:peerId/sync`,
  });

  console.error('[dev-2-iphone-lan] starting phone UI dev server');
  const [phoneUiCommand, phoneUiArgs] = buildYarnInvocation([
    '--cwd',
    'ui',
    'dev:raw',
    '--host',
    '127.0.0.1',
    '--port',
    String(phoneUiPort),
    '--strictPort',
  ]);
  const phoneUiChild = startLoggedProcess({
    label: 'phone-ui',
    command: phoneUiCommand,
    args: phoneUiArgs,
    env: {
      ...process.env,
      HOME: phoneHome,
      NEARBYTES_WEB_DEV_PORT: String(phoneUiPort),
      VITE_NEARBYTES_WEB_DEV_PORT: String(phoneUiPort),
      VITE_NEARBYTES_EMBEDDED_PHONE_MEGA_ENABLED: '0',
      VITE_NEARBYTES_EMBEDDED_PHONE_LOCAL_NETWORK_ENABLED: '1',
    },
    logPath: phoneUiLogPath,
  });
  children.push(phoneUiChild);

  await waitForHttpEndpoint(phoneUiUrl, startupTimeoutMs, phoneUiChild, 'Phone UI dev server');
  writeRecordedMobileServerUrl(phoneUiUrl);

  if (process.platform === 'darwin') {
    console.error('[dev-2-iphone-lan] launching iPhone simulator app');
    runIphoneLauncher(phoneUiUrl);
  } else {
    console.error(`[dev-2-iphone-lan] skipping iPhone simulator launch on ${process.platform}; use the phone UI URL on a physical device.`);
  }

  await requestJson(desktopApiUrl, 'GET', '/health', undefined, {
    'x-nearbytes-runtime-token': desktopSession.token,
  }).catch(async () => {
    await sleep(500);
  });

  console.error('[dev-2-iphone-lan] ready for manual LAN testing');
  console.error(`[dev-2-iphone-lan] desktop UI: http://127.0.0.1:${desktopUiPort}`);
  console.error(`[dev-2-iphone-lan] desktop API: ${desktopApiUrl}`);
  console.error(`[dev-2-iphone-lan] phone UI: ${phoneUiUrl}`);
  console.error(`[dev-2-iphone-lan] desktop dev api descriptor: ${path.join(desktopPaths.nearbytesDir, 'dev-api.json')}`);
  console.error('[dev-2-iphone-lan] both participants run with LAN enabled and MEGA disabled');
  console.error('[dev-2-iphone-lan] the phone runtime stays embedded; no phone backend process is started');
  console.error('[dev-2-iphone-lan] press Ctrl-C to stop all processes');

  await Promise.all(children.map((child) => waitForExit(child)));
  await shutdown(0);
} catch (error) {
  console.error('[dev-2-iphone-lan] FAILED', error instanceof Error ? error.stack ?? error.message : String(error));
  await shutdown(1);
}

function runIphoneLauncher(phoneUiUrl) {
  const result = spawnSync(process.execPath, [path.join(repoRoot, 'scripts', 'run-iphone-dev.mjs')], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: phoneHome,
      NEARBYTES_MOBILE_SERVER_URL: phoneUiUrl,
      NEARBYTES_WEB_DEV_PORT: String(phoneUiPort),
    },
    stdio: 'inherit',
    shell: false,
  });
  if ((result.status ?? 1) !== 0) {
    throw new Error(`iPhone launcher failed with exit code ${result.status ?? 1}.`);
  }
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

function writeDevApiDescriptor(dirPath, descriptor) {
  writeFileSync(path.join(dirPath, 'dev-api.json'), `${JSON.stringify(descriptor, null, 2)}\n`, 'utf8');
}

function writeRecordedMobileServerUrl(url) {
  mkdirSync(path.dirname(recordedMobileServerPath), { recursive: true });
  writeFileSync(recordedMobileServerPath, `${JSON.stringify({ url }, null, 2)}\n`, 'utf8');
}