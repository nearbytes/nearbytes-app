#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  appendLog,
  clearPorts,
  confirmDestructiveWipe,
  createManualTestPaths,
  ensureRepoBuild,
  loadDotEnvIfPresent,
  normalize,
  openSystemBrowser,
  parseWipeMode,
  readPositiveIntEnv,
  repoRoot,
  requestJson,
  resolveLocalCorepack,
  seedManualTestConfig as seedSharedManualTestConfig,
  sleep,
  trimOrDefault,
  trimOrNull,
  waitForExit,
  waitForHealth,
} from './lib/dev-orchestration.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dotEnvPath = path.join(repoRoot, '.env.e2e');

loadDotEnvIfPresent(dotEnvPath);

const localPort = readPositiveIntEnv('NEARBYTES_DEV2_LOCAL_PORT', 3200);
const remotePort = readPositiveIntEnv('NEARBYTES_DEV2_REMOTE_PORT', 3201);
const localUiPort = readPositiveIntEnv('NEARBYTES_DEV2_LOCAL_UI_PORT', 5181);
const remoteUiPort = readPositiveIntEnv('NEARBYTES_DEV2_REMOTE_UI_PORT', 5182);
const startupTimeoutMs = readPositiveIntEnv('NEARBYTES_DEV2_STARTUP_TIMEOUT_MS', 90_000);
const localHome = trimOrDefault(process.env.NEARBYTES_DEV2_LOCAL_HOME, '/tmp/nearbytes-dev2-local-home');
const remoteHome = trimOrDefault(process.env.NEARBYTES_DEV2_REMOTE_HOME, '/tmp/nearbytes-dev2-remote-home');
const logsDir = path.join(os.homedir(), '.nearbytes', 'logs');
const localLogPath = path.join(logsDir, 'dev-2-local.log');
const remoteLogPath = path.join(logsDir, 'dev-2-remote.log');
const localEmail = trimOrDefault(
  process.env.NEARBYTES_E2E_MEGA_LOCAL_EMAIL,
  trimOrDefault(process.env.NEARBYTES_E2E_MEGA_RECIPIENT_EMAIL, '')
);
const remoteEmail = trimOrDefault(
  process.env.NEARBYTES_E2E_MEGA_REMOTE_EMAIL,
  trimOrDefault(process.env.NEARBYTES_E2E_MEGA_OWNER_EMAIL, '')
);
const megaPassword = process.env.NEARBYTES_E2E_MEGA_PASSWORD ?? '';
const localCorepack = resolveLocalCorepack();
const localRootsConfigPath = path.join(localHome, '.nearbytes', 'roots.json');
const remoteRootsConfigPath = path.join(remoteHome, '.nearbytes', 'roots.json');
const localAppConfigPath = path.join(localHome, '.nearbytes', 'app-config.json');
const remoteAppConfigPath = path.join(remoteHome, '.nearbytes', 'app-config.json');

if (!localEmail || !remoteEmail || !megaPassword) {
  console.error('Missing .env.e2e values for the two MEGA test accounts.');
  process.exit(1);
}

const localBaseUrl = `http://127.0.0.1:${localPort}`;
const remoteBaseUrl = `http://127.0.0.1:${remotePort}`;
const localUiUrl = `http://127.0.0.1:${localUiPort}`;
const remoteUiUrl = `http://127.0.0.1:${remoteUiPort}`;
const cliOptions = { wipeMode: parseWipeMode(process.argv.slice(2)) };

const children = [];
let shuttingDown = false;

process.on('SIGINT', () => {
  void shutdown(130);
});
process.on('SIGTERM', () => {
  void shutdown(143);
});

try {
  console.error('[dev-2] preparing dual local dev environment');
  mkdirSync(logsDir, { recursive: true });
  mkdirSync(localHome, { recursive: true });
  mkdirSync(remoteHome, { recursive: true });
  seedManualTestConfig(localHome, localRootsConfigPath, localAppConfigPath);
  seedManualTestConfig(remoteHome, remoteRootsConfigPath, remoteAppConfigPath);

  console.error('[dev-2] building project');
  ensureRepoBuild();
  console.error('[dev-2] clearing dedicated ports', { localPort, remotePort });
  await clearPorts([localPort, remotePort]);

  console.error('[dev-2] starting first dev instance', { apiPort: localPort, uiPort: localUiPort, home: localHome });
  const localChild = startDevInstance({
    name: 'local',
    home: localHome,
    port: localPort,
    uiPort: localUiPort,
    logPath: localLogPath,
  });
  const remoteChild = startDevInstance({
    name: 'remote',
    home: remoteHome,
    port: remotePort,
    uiPort: remoteUiPort,
    logPath: remoteLogPath,
  });
  children.push(localChild, remoteChild);

  console.error('[dev-2] waiting for both instances to become healthy');
  await Promise.all([
    waitForHealth(localBaseUrl, startupTimeoutMs, localChild, localLogPath),
    waitForHealth(remoteBaseUrl, startupTimeoutMs, remoteChild, remoteLogPath),
  ]);
  console.error('[dev-2] both instances are healthy');

  console.error('[dev-2] connecting local MEGA account', { email: localEmail, baseUrl: localBaseUrl });
  const localAccount = await ensureExpectedMegaAccount(localBaseUrl, localEmail);
  console.error('[dev-2] connecting remote MEGA account', { email: remoteEmail, baseUrl: remoteBaseUrl });
  const remoteAccount = await ensureExpectedMegaAccount(remoteBaseUrl, remoteEmail);

  const {
    rebuildMegaSecurityAttributeForE2e,
    revokeMegaOutgoingSharesForPeers,
    wipeMegaCloudDriveContentsForE2e,
  } = await import('../dist/integrations/mega.js');

  const shouldWipe = await confirmDestructiveWipe({
    firstLabel: localEmail,
    secondLabel: remoteEmail,
    mode: cliOptions.wipeMode,
    summary: 'wipe will revoke cross-shares and delete cloud-drive contents on both MEGA accounts',
  });
  if (shouldWipe) {
    process.env.NEARBYTES_ALLOW_DESTRUCTIVE_MEGA_E2E_WIPE = '1';
    console.error('[dev-2] wiping both MEGA test accounts');
    const revokeRemoteController = new AbortController();
    const revokeRemoteTimer = setTimeout(() => revokeRemoteController.abort(), 5 * 60 * 1000);
    try {
      await revokeMegaOutgoingSharesForPeers({
        email: remoteEmail,
        password: megaPassword,
        peerEmails: [localEmail],
        signal: revokeRemoteController.signal,
      });
    } finally {
      clearTimeout(revokeRemoteTimer);
    }

    const revokeLocalController = new AbortController();
    const revokeLocalTimer = setTimeout(() => revokeLocalController.abort(), 5 * 60 * 1000);
    try {
      await revokeMegaOutgoingSharesForPeers({
        email: localEmail,
        password: megaPassword,
        peerEmails: [remoteEmail],
        signal: revokeLocalController.signal,
      });
    } finally {
      clearTimeout(revokeLocalTimer);
    }

    const wipeRemoteController = new AbortController();
    const wipeRemoteTimer = setTimeout(() => wipeRemoteController.abort(), 5 * 60 * 1000);
    try {
      await wipeMegaCloudDriveContentsForE2e({
        email: remoteEmail,
        password: megaPassword,
        signal: wipeRemoteController.signal,
      });
    } finally {
      clearTimeout(wipeRemoteTimer);
    }

    const wipeLocalController = new AbortController();
    const wipeLocalTimer = setTimeout(() => wipeLocalController.abort(), 5 * 60 * 1000);
    try {
      await wipeMegaCloudDriveContentsForE2e({
        email: localEmail,
        password: megaPassword,
        signal: wipeLocalController.signal,
      });
    } finally {
      clearTimeout(wipeLocalTimer);
    }

    const rebuildRemoteController = new AbortController();
    const rebuildRemoteTimer = setTimeout(() => rebuildRemoteController.abort(), 5 * 60 * 1000);
    try {
      await rebuildMegaSecurityAttributeForE2e({
        email: remoteEmail,
        password: megaPassword,
        signal: rebuildRemoteController.signal,
      });
    } finally {
      clearTimeout(rebuildRemoteTimer);
    }

    const rebuildLocalController = new AbortController();
    const rebuildLocalTimer = setTimeout(() => rebuildLocalController.abort(), 5 * 60 * 1000);
    try {
      await rebuildMegaSecurityAttributeForE2e({
        email: localEmail,
        password: megaPassword,
        signal: rebuildLocalController.signal,
      });
    } finally {
      clearTimeout(rebuildLocalTimer);
    }

    await Promise.all([
      removeRecipientMegaShares(localBaseUrl),
      removeRecipientMegaShares(remoteBaseUrl),
    ]);
    console.error('[dev-2] wipe completed');
  } else {
    console.error('[dev-2] wipe skipped by user; continuing with connected instances');
  }

  console.error('[dev-2] MEGA accounts connected and wiped', {
    localAccountId: localAccount.id,
    remoteAccountId: remoteAccount.id,
    localUiUrl,
    remoteUiUrl,
  });

  openSystemBrowser(localUiUrl);
  openSystemBrowser(remoteUiUrl);

  console.error('[dev-2] ready for manual end-to-end testing');
  console.error(`[dev-2] local UI: ${localUiUrl}`);
  console.error(`[dev-2] remote UI: ${remoteUiUrl}`);
  console.error('[dev-2] press Ctrl-C to stop both instances');

  await Promise.all(children.map((child) => waitForExit(child)));
  await shutdown(0);
} catch (error) {
  console.error('[dev-2] FAILED', error instanceof Error ? error.stack ?? error.message : String(error));
  await shutdown(1);
}

function startDevInstance({ name, home, port, uiPort, logPath }) {
  const logDir = path.dirname(logPath);
  mkdirSync(logDir, { recursive: true });
  const child = spawn(localCorepack, ['yarn', 'dev'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
      COREPACK_HOME: path.join(os.homedir(), '.cache', 'node', 'corepack'),
      HOME: home,
      NEARBYTES_ROOTS_CONFIG: name === 'local' ? localRootsConfigPath : remoteRootsConfigPath,
      NEARBYTES_APP_CONFIG: name === 'local' ? localAppConfigPath : remoteAppConfigPath,
      NEARBYTES_SKIP_BOOTSTRAP_DEFAULT_DESTINATION: '1',
      PORT: String(port),
      NEARBYTES_WEB_DEV_PORT: String(uiPort),
      NEARBYTES_WEB_DEV_SESSION_FILE: path.join(home, '.nearbytes-web-dev.json'),
      NEARBYTES_DEV_RUN_SESSION_FILE: path.join(home, '.nearbytes-dev-run.json'),
      NEARBYTES_DESKTOP_SESSION_FILE: path.join(home, '.nearbytes', 'desktop-session.json'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => appendLog(logPath, `[${name}:stdout] ${chunk}`));
  child.stderr.on('data', (chunk) => appendLog(logPath, `[${name}:stderr] ${chunk}`));
  child.once('exit', (code, signal) => {
    appendLog(logPath, `[${name}] exited with code=${code} signal=${signal}\n`);
  });

  return child;
}

async function ensureExpectedMegaAccount(baseUrl, expectedEmail) {
  const accountsResponse = await requestJson(baseUrl, 'GET', '/integrations/accounts');
  const megaAccounts = (accountsResponse?.accounts ?? []).filter((entry) => normalize(entry.provider) === 'mega');
  const matching = megaAccounts.find((entry) => normalize(entry.email) === normalize(expectedEmail) && entry.state === 'connected');
  if (matching && megaAccounts.length === 1) {
    return matching;
  }
  for (const account of megaAccounts) {
    await requestJson(baseUrl, 'DELETE', `/integrations/accounts/${encodeURIComponent(account.id)}?mode=reset`);
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
  });
  if (response?.status !== 'connected' || !response.account?.id) {
    throw new Error(`Failed to connect ${expectedEmail} on ${baseUrl}.`);
  }
  return response.account;
}

async function removeRecipientMegaShares(baseUrl) {
  const sharesResponse = await requestJson(baseUrl, 'GET', '/integrations/shares?fast=1');
  const recipientShares = (sharesResponse?.shares ?? []).filter(
    (entry) => normalize(entry?.share?.provider) === 'mega' && entry?.share?.role === 'recipient'
  );
  for (const summary of recipientShares) {
    await requestJson(baseUrl, 'DELETE', `/integrations/shares/${encodeURIComponent(summary.share.id)}?mode=reset`);
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

function buildYarnCommand(args = []) {
  if (process.platform === 'win32') {
    return [process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', ['yarn.cmd', ...args].join(' ')]];
  }
  return ['yarn', args];
}
function seedManualTestConfig(home, rootsConfigPath, appConfigPath) {
  const paths = createManualTestPaths(home);
  seedSharedManualTestConfig({
    home,
    rootsConfigPath,
    appConfigPath,
    localRootPath: paths.localRootPath,
    providers: {
      mega: true,
      localNetwork: false,
    },
  });
}