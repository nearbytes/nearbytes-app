#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import {
  buildCorsOrigin,
  buildYarnInvocation,
  clearPorts,
  confirmDestructiveWipe,
  createManualTestPaths,
  ensureRepoBuild,
  loadDotEnvIfPresent,
  normalize,
  parseWipeMode,
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

const dotEnvPath = path.join(repoRoot, '.env.e2e');
loadDotEnvIfPresent(dotEnvPath);

const desktopUiPort = 5177;
const phoneApiPort = readPort('NEARBYTES_DEV2_IPHONE_MEGA_PHONE_PORT', 3300);
const phoneUiPort = readPort('NEARBYTES_DEV2_IPHONE_MEGA_PHONE_UI_PORT', 5181);
const startupTimeoutMs = readPort('NEARBYTES_DEV2_IPHONE_MEGA_STARTUP_TIMEOUT_MS', 90_000);
const desktopHome = trimOrDefault(process.env.NEARBYTES_DEV2_IPHONE_MEGA_DESKTOP_HOME, '/tmp/nearbytes-dev2-iphone-mega-desktop-home');
const phoneHome = trimOrDefault(process.env.NEARBYTES_DEV2_IPHONE_MEGA_PHONE_HOME, '/tmp/nearbytes-dev2-iphone-mega-phone-home');
const logsDir = path.join(os.homedir(), '.nearbytes', 'logs');
const desktopLogPath = path.join(logsDir, 'dev2-iphone-mega-desktop.log');
const phoneBackendLogPath = path.join(logsDir, 'dev2-iphone-mega-phone-backend.log');
const phoneUiLogPath = path.join(logsDir, 'dev2-iphone-mega-phone-ui.log');
const desktopPaths = createManualTestPaths(desktopHome);
const phonePaths = createManualTestPaths(phoneHome);
const phoneApiUrl = `http://127.0.0.1:${phoneApiPort}`;
const phoneUiUrl = `http://127.0.0.1:${phoneUiPort}`;
const phoneEmail = trimOrDefault(
  process.env.NEARBYTES_DEV2_IPHONE_MEGA_PHONE_EMAIL,
  trimOrDefault(process.env.NEARBYTES_E2E_MEGA_LOCAL_EMAIL, trimOrDefault(process.env.NEARBYTES_E2E_MEGA_RECIPIENT_EMAIL, ''))
);
const desktopEmail = trimOrDefault(
  process.env.NEARBYTES_DEV2_IPHONE_MEGA_DESKTOP_EMAIL,
  trimOrDefault(process.env.NEARBYTES_E2E_MEGA_REMOTE_EMAIL, trimOrDefault(process.env.NEARBYTES_E2E_MEGA_OWNER_EMAIL, ''))
);
const megaPassword = trimOrDefault(process.env.NEARBYTES_DEV2_IPHONE_MEGA_PASSWORD, process.env.NEARBYTES_E2E_MEGA_PASSWORD ?? '');
const wipeMode = parseWipeMode(process.argv.slice(2));

if (!phoneEmail || !desktopEmail || !megaPassword) {
  console.error('Missing .env.e2e values for the two MEGA test accounts.');
  process.exit(1);
}

const children = [];
let shuttingDown = false;

process.on('SIGINT', () => {
  void shutdown(130);
});
process.on('SIGTERM', () => {
  void shutdown(143);
});

try {
  console.error('[dev2-iphone-mega] preparing desktop + iPhone MEGA environment');
  mkdirSync(logsDir, { recursive: true });
  mkdirSync(desktopHome, { recursive: true });
  mkdirSync(phoneHome, { recursive: true });

  seedManualTestConfig({
    ...desktopPaths,
    providers: { mega: true, localNetwork: false },
  });
  seedManualTestConfig({
    ...phonePaths,
    providers: { mega: true, localNetwork: false },
  });

  console.error('[dev2-iphone-mega] building project');
  ensureRepoBuild();
  console.error('[dev2-iphone-mega] clearing dedicated ports', { desktopUiPort, phoneApiPort, phoneUiPort });
  await clearPorts([desktopUiPort, phoneApiPort, phoneUiPort]);

  console.error('[dev2-iphone-mega] starting desktop runtime');
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

  console.error('[dev2-iphone-mega] starting phone backend');
  const phoneBackendChild = startLoggedProcess({
    label: 'phone-backend',
    command: process.execPath,
    args: [
      path.join(repoRoot, 'dist', 'server', 'index.js'),
      '--roots-config',
      phonePaths.rootsConfigPath,
      '--app-config',
      phonePaths.appConfigPath,
    ],
    env: {
      ...process.env,
      HOME: phoneHome,
      PORT: String(phoneApiPort),
      NEARBYTES_CORS_ORIGIN: buildCorsOrigin(process.env.NEARBYTES_CORS_ORIGIN, phoneUiPort),
    },
    logPath: phoneBackendLogPath,
  });
  children.push(phoneBackendChild);

  console.error('[dev2-iphone-mega] waiting for desktop runtime and phone backend');
  const desktopSession = await waitForDesktopSession(desktopPaths.desktopSessionPath, startupTimeoutMs, desktopChild);
  await waitForHealth(phoneApiUrl, startupTimeoutMs, phoneBackendChild, phoneBackendLogPath);

  console.error('[dev2-iphone-mega] starting phone UI dev server');
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
      PORT: String(phoneApiPort),
      NEARBYTES_WEB_DEV_PORT: String(phoneUiPort),
      VITE_NEARBYTES_WEB_DEV_PORT: String(phoneUiPort),
      NEARBYTES_DESKTOP_SESSION_FILE: phonePaths.desktopSessionPath,
    },
    logPath: phoneUiLogPath,
  });
  children.push(phoneUiChild);

  await waitForHttpEndpoint(phoneUiUrl, startupTimeoutMs, phoneUiChild, 'Phone UI dev server');

  console.error('[dev2-iphone-mega] launching iPhone simulator app');
  runIphoneLauncher(phoneUiUrl, phoneHome, phoneUiPort);

  const desktopApiUrl = `http://127.0.0.1:${desktopSession.port}`;
  const desktopHeaders = { 'x-nearbytes-runtime-token': desktopSession.token };

  console.error('[dev2-iphone-mega] connecting phone MEGA account', { email: phoneEmail });
  const phoneAccount = await ensureExpectedMegaAccount(phoneApiUrl, phoneEmail);
  console.error('[dev2-iphone-mega] connecting desktop MEGA account', { email: desktopEmail });
  const desktopAccount = await ensureExpectedMegaAccount(desktopApiUrl, desktopEmail, desktopHeaders);

  const shouldWipe = await confirmDestructiveWipe({
    firstLabel: phoneEmail,
    secondLabel: desktopEmail,
    mode: wipeMode,
    summary: 'wipe will revoke cross-shares and delete cloud-drive contents on both MEGA accounts',
  });

  if (shouldWipe) {
    process.env.NEARBYTES_ALLOW_DESTRUCTIVE_MEGA_E2E_WIPE = '1';
    const {
      rebuildMegaSecurityAttributeForE2e,
      revokeMegaOutgoingSharesForPeers,
      wipeMegaCloudDriveContentsForE2e,
    } = await import('../dist/integrations/mega.js');

    console.error('[dev2-iphone-mega] wiping both MEGA test accounts');
    await withMegaTimeout((signal) => revokeMegaOutgoingSharesForPeers({
      email: desktopEmail,
      password: megaPassword,
      peerEmails: [phoneEmail],
      signal,
    }));
    await withMegaTimeout((signal) => revokeMegaOutgoingSharesForPeers({
      email: phoneEmail,
      password: megaPassword,
      peerEmails: [desktopEmail],
      signal,
    }));
    await withMegaTimeout((signal) => wipeMegaCloudDriveContentsForE2e({
      email: desktopEmail,
      password: megaPassword,
      signal,
    }));
    await withMegaTimeout((signal) => wipeMegaCloudDriveContentsForE2e({
      email: phoneEmail,
      password: megaPassword,
      signal,
    }));
    await withMegaTimeout((signal) => rebuildMegaSecurityAttributeForE2e({
      email: desktopEmail,
      password: megaPassword,
      signal,
    }));
    await withMegaTimeout((signal) => rebuildMegaSecurityAttributeForE2e({
      email: phoneEmail,
      password: megaPassword,
      signal,
    }));
    await removeRecipientMegaShares(desktopApiUrl, desktopHeaders);
    await removeRecipientMegaShares(phoneApiUrl);
    console.error('[dev2-iphone-mega] wipe completed');
  } else {
    console.error('[dev2-iphone-mega] wipe skipped by user; continuing with connected instances');
  }

  console.error('[dev2-iphone-mega] ready for manual MEGA testing');
  console.error(`[dev2-iphone-mega] desktop UI: http://127.0.0.1:${desktopUiPort}`);
  console.error(`[dev2-iphone-mega] desktop API: ${desktopApiUrl}`);
  console.error(`[dev2-iphone-mega] phone UI: ${phoneUiUrl}`);
  console.error(`[dev2-iphone-mega] phone API: ${phoneApiUrl}`);
  console.error('[dev2-iphone-mega] both participants run with MEGA enabled and LAN disabled');
  console.error('[dev2-iphone-mega] connected accounts', {
    phoneAccountId: phoneAccount.id,
    desktopAccountId: desktopAccount.id,
  });
  console.error('[dev2-iphone-mega] press Ctrl-C to stop all processes');

  await Promise.all(children.map((child) => waitForExit(child)));
  await shutdown(0);
} catch (error) {
  console.error('[dev2-iphone-mega] FAILED', error instanceof Error ? error.stack ?? error.message : String(error));
  await shutdown(1);
}

async function ensureExpectedMegaAccount(baseUrl, expectedEmail, headers = {}) {
  const accountsResponse = await requestJson(baseUrl, 'GET', '/integrations/accounts', undefined, headers);
  const megaAccounts = (accountsResponse?.accounts ?? []).filter((entry) => normalize(entry.provider) === 'mega');
  const matching = megaAccounts.find((entry) => normalize(entry.email) === normalize(expectedEmail) && entry.state === 'connected');
  if (matching && megaAccounts.length === 1) {
    return matching;
  }
  for (const account of megaAccounts) {
    await requestJson(baseUrl, 'DELETE', `/integrations/accounts/${encodeURIComponent(account.id)}?mode=reset`, undefined, headers);
  }
  const response = await requestJson(baseUrl, 'POST', '/integrations/accounts/connect', {
    provider: 'mega',
    label: 'MEGA',
    preferred: true,
    email: expectedEmail,
    credentials: {
      email: expectedEmail,
      password: megaPassword,
    },
  }, headers);
  if (response?.status !== 'connected' || !response.account?.id) {
    throw new Error(`Failed to connect ${expectedEmail} on ${baseUrl}.`);
  }
  return response.account;
}

async function removeRecipientMegaShares(baseUrl, headers = {}) {
  const sharesResponse = await requestJson(baseUrl, 'GET', '/integrations/shares?fast=1', undefined, headers);
  const recipientShares = (sharesResponse?.shares ?? []).filter(
    (entry) => normalize(entry?.share?.provider) === 'mega' && entry?.share?.role === 'recipient'
  );
  for (const summary of recipientShares) {
    await requestJson(
      baseUrl,
      'DELETE',
      `/integrations/shares/${encodeURIComponent(summary.share.id)}?mode=reset`,
      undefined,
      headers
    );
  }
}

async function withMegaTimeout(run) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5 * 60 * 1000);
  try {
    await run(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

function runIphoneLauncher(phoneUiUrl, phoneHome, phoneUiPort) {
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