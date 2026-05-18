#!/usr/bin/env node
/**
 * Cross-host end-to-end: local dev server + remote dev server, one shared hub, MEGA transport.
 *
 * The flow is intentionally close to the real app path:
 * 1. Reuse the saved MEGA accounts when they are already connected.
 * 2. Wipe both MEGA accounts' cloud drives and revoke cross-shares.
 * 3. Reuse the real Nearbytes HTTP API to invite, accept, attach, and upload.
 * 4. Verify byte-identical file transfer local -> remote, then remote -> local.
 *
 * The remote host's integration endpoints are local-only, so this script opens an SSH tunnel
 * by default and talks to the remote API through localhost.
 *
 * Requires:
 *   - local `yarn dev` already running (default http://127.0.0.1:3000)
 *   - remote `yarn dev` already running on the SSH target (default alias: pc-ciancia)
 *   - `yarn build`
 *   - `.env.e2e` with the MEGA credentials
 *
 * Optional env:
 *   - NEARBYTES_E2E_LOCAL_BASE_URL=http://127.0.0.1:3000
 *   - NEARBYTES_E2E_REMOTE_SSH=pc-ciancia
 *   - NEARBYTES_E2E_REMOTE_TARGET_PORT=3000
 *   - NEARBYTES_E2E_REMOTE_BASE_URL=http://127.0.0.1:43100
 *   - NEARBYTES_E2E_REMOTE_TUNNEL_PORT=43100
 *   - NEARBYTES_E2E_LOCAL_LABEL=local
 *   - NEARBYTES_E2E_REMOTE_LABEL=pc-ciancia
 *   - NEARBYTES_E2E_HUB_SECRET=test2
 *   - NEARBYTES_E2E_HUB_PASSWORD=
 *   - NEARBYTES_E2E_MEGA_LOCAL_EMAIL / NEARBYTES_E2E_MEGA_REMOTE_EMAIL
 *   - NEARBYTES_E2E_MEGA_PASSWORD
 *   - NEARBYTES_E2E_MEGA_CROSSHOST_ITERATIONS=2
 *   - NEARBYTES_E2E_MEGA_OWNER_READY_TIMEOUT_MS=180000
 *   - NEARBYTES_E2E_MEGA_INCOMING_OFFER_TIMEOUT_MS=180000
 *   - NEARBYTES_E2E_MEGA_RECIPIENT_READY_TIMEOUT_MS=180000
 *   - NEARBYTES_E2E_MEGA_FILE_TIMEOUT_MS=240000
 *   - NEARBYTES_E2E_MEGA_TUNNEL_TIMEOUT_MS=30000
 *   - NEARBYTES_E2E_MEGA_WIPE_TIMEOUT_MS=1200000
 *   - NEARBYTES_E2E_MEGA_SHARE_ACCESS_LEVEL=read/write
 */

import { spawn } from 'child_process';
import { createHash } from 'crypto';
import { once } from 'events';
import { existsSync, readFileSync } from 'fs';
import { createServer as createNetServer } from 'net';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadDotEnvIfPresent(path.join(__dirname, '..', '.env.e2e'));

const localBaseUrl = trimOrDefault(process.env.NEARBYTES_E2E_LOCAL_BASE_URL, 'http://127.0.0.1:3000');
const remoteBaseUrlOverride = trimOrNull(process.env.NEARBYTES_E2E_REMOTE_BASE_URL);
const localRuntimeToken = trimOrNull(process.env.NEARBYTES_E2E_LOCAL_RUNTIME_TOKEN);
const remoteRuntimeToken = trimOrNull(process.env.NEARBYTES_E2E_REMOTE_RUNTIME_TOKEN);
const remoteSshHost = trimOrDefault(process.env.NEARBYTES_E2E_REMOTE_SSH, 'pc-ciancia');
const remoteTargetPort = readPositiveIntEnv('NEARBYTES_E2E_REMOTE_TARGET_PORT', 3000);
const localLabel = trimOrDefault(process.env.NEARBYTES_E2E_LOCAL_LABEL, 'local');
const remoteLabel = trimOrDefault(process.env.NEARBYTES_E2E_REMOTE_LABEL, 'pc-ciancia');
const hubSeed = trimOrDefault(process.env.NEARBYTES_E2E_HUB_SECRET, 'test2');
const hubPassword = trimOrDefault(process.env.NEARBYTES_E2E_HUB_PASSWORD, '');
const hubSecret = hubPassword ? `${hubSeed}:${hubPassword}` : hubSeed;
const localMegaEmail = trimOrDefault(
  process.env.NEARBYTES_E2E_MEGA_LOCAL_EMAIL,
  trimOrDefault(process.env.NEARBYTES_E2E_MEGA_RECIPIENT_EMAIL, '')
);
const remoteMegaEmail = trimOrDefault(
  process.env.NEARBYTES_E2E_MEGA_REMOTE_EMAIL,
  trimOrDefault(process.env.NEARBYTES_E2E_MEGA_OWNER_EMAIL, '')
);
const megaPassword = process.env.NEARBYTES_E2E_MEGA_PASSWORD ?? '';

if (!localMegaEmail || !remoteMegaEmail || !megaPassword) {
  console.error(
    'Missing env: NEARBYTES_E2E_MEGA_LOCAL_EMAIL/RECIPIENT_EMAIL, NEARBYTES_E2E_MEGA_REMOTE_EMAIL/OWNER_EMAIL, NEARBYTES_E2E_MEGA_PASSWORD'
  );
  process.exit(1);
}

const ITERATIONS = readPositiveIntEnv('NEARBYTES_E2E_MEGA_CROSSHOST_ITERATIONS', 2);
const OWNER_READY_TIMEOUT_MS = readPositiveIntEnv('NEARBYTES_E2E_MEGA_OWNER_READY_TIMEOUT_MS', 180_000);
const INCOMING_OFFER_TIMEOUT_MS = readPositiveIntEnv('NEARBYTES_E2E_MEGA_INCOMING_OFFER_TIMEOUT_MS', 180_000);
const RECIPIENT_READY_TIMEOUT_MS = readPositiveIntEnv('NEARBYTES_E2E_MEGA_RECIPIENT_READY_TIMEOUT_MS', 180_000);
const FILE_TIMEOUT_MS = readPositiveIntEnv('NEARBYTES_E2E_MEGA_FILE_TIMEOUT_MS', 240_000);
const TUNNEL_TIMEOUT_MS = readPositiveIntEnv('NEARBYTES_E2E_MEGA_TUNNEL_TIMEOUT_MS', 30_000);
const WIPE_TIMEOUT_MS = readPositiveIntEnv('NEARBYTES_E2E_MEGA_WIPE_TIMEOUT_MS', 20 * 60 * 1000);
const BETWEEN_STEPS_DELAY_MS = readPositiveIntEnv('NEARBYTES_E2E_MEGA_BETWEEN_STEPS_DELAY_MS', 1_000);
const INVITE_ACCESS_LEVEL = readMegaInviteAccessLevelEnv(
  'NEARBYTES_E2E_MEGA_SHARE_ACCESS_LEVEL',
  'read/write'
);
const SKIP_DIAGNOSTICS = process.env.NEARBYTES_E2E_SKIP_DIAGNOSTICS === '1';

const { revokeMegaOutgoingSharesForPeers, wipeMegaCloudDriveContentsForE2e } = await import('../dist/integrations/mega.js');

const tunnels = [];
let shuttingDown = false;

process.on('SIGINT', () => {
  void cleanup(130);
});
process.on('SIGTERM', () => {
  void cleanup(143);
});

try {
  const remoteBaseUrl = remoteBaseUrlOverride ?? await startRemoteTunnel();
  const localHost = createHost(localLabel, localBaseUrl, localMegaEmail, localRuntimeToken);
  const remoteHost = createHost(remoteLabel, remoteBaseUrl, remoteMegaEmail, remoteRuntimeToken);

  await Promise.all([assertHealthy(localHost), assertHealthy(remoteHost)]);

  const localAccount = await ensureExpectedMegaAccount(localHost);
  const remoteAccount = await ensureExpectedMegaAccount(remoteHost);

  for (let iteration = 1; iteration <= ITERATIONS; iteration += 1) {
    await runIteration(iteration, localHost, remoteHost, localAccount.id, remoteAccount.id);
  }

  console.error('[mega-crosshost] OK all iterations completed without manual reconnect or reinvite.');
  await cleanup(0);
} catch (error) {
  console.error('[mega-crosshost] FAILED:', error instanceof Error ? error.stack ?? error.message : error);
  if (!SKIP_DIAGNOSTICS) {
    await dumpDiagnosticsOnFailure(localBaseUrl, remoteBaseUrlOverride);
  }
  await cleanup(1);
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

function trimOrNull(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
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
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function readMegaInviteAccessLevelEnv(name, fallback) {
  const raw = trimOrNull(process.env[name]);
  if (!raw) {
    return fallback;
  }
  const normalized = raw.toLowerCase();
  if (normalized === 'read' || normalized === 'read/write' || normalized === 'full access') {
    return normalized;
  }
  throw new Error(`${name} must be one of: read, read/write, full access.`);
}

function createHost(label, baseUrl, megaEmail, runtimeToken = null) {
  const defaultHeaders = {};
  if (runtimeToken) {
    defaultHeaders['x-nearbytes-runtime-token'] = runtimeToken;
  }
  return {
    label,
    baseUrl: baseUrl.replace(/\/+$/u, ''),
    megaEmail: megaEmail.trim().toLowerCase(),
    defaultHeaders,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetriableFetchError(error) {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const causeCode = (
    error &&
    typeof error === 'object' &&
    'cause' in error &&
    error.cause &&
    typeof error.cause === 'object' &&
    'code' in error.cause
  )
    ? String(error.cause.code)
    : '';
  return /fetch failed|ECONNRESET|ECONNREFUSED|EPIPE|ETIMEDOUT|UND_ERR/u.test(message)
    || /ECONNRESET|ECONNREFUSED|EPIPE|ETIMEDOUT/u.test(causeCode);
}

async function fetchWithRetry(url, init, label) {
  const maxAttempts = 5;
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fetch(url, init);
    } catch (error) {
      lastError = error;
      if (!isRetriableFetchError(error) || attempt >= maxAttempts) {
        break;
      }
      const delayMs = Math.min(4_000, 250 * (2 ** (attempt - 1)));
      await sleep(delayMs);
    }
  }
  throw new Error(`${label} transport failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function normalizeIdentity(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

async function reserveTunnelPort() {
  const preferred = trimOrNull(process.env.NEARBYTES_E2E_REMOTE_TUNNEL_PORT);
  if (preferred) {
    const parsed = Number.parseInt(preferred, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error('NEARBYTES_E2E_REMOTE_TUNNEL_PORT must be a positive integer.');
    }
    return parsed;
  }
  const server = createNetServer();
  server.unref();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  if (!port) {
    throw new Error('Failed to reserve a local SSH tunnel port.');
  }
  return port;
}

async function startRemoteTunnel() {
  const port = await reserveTunnelPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(
    'ssh',
    [
      '-N',
      '-o',
      'BatchMode=yes',
      '-o',
      'ExitOnForwardFailure=yes',
      '-o',
      'ConnectTimeout=10',
      '-L',
      `${port}:127.0.0.1:${remoteTargetPort}`,
      remoteSshHost,
    ],
    {
      stdio: ['ignore', 'ignore', 'pipe'],
    }
  );

  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-8_000);
  });

  tunnels.push(child);

  child.once('exit', (code, signal) => {
    if (!shuttingDown) {
      console.error('[mega-crosshost] remote tunnel exited unexpectedly.', { code, signal, stderr: stderr.trim() });
    }
  });

  await waitForJsonEndpoint(baseUrl, '/health', TUNNEL_TIMEOUT_MS, `remote tunnel ${remoteSshHost}`, () => stderr);
  console.error('[mega-crosshost] remote tunnel ready.', { sshHost: remoteSshHost, baseUrl });
  return baseUrl;
}

async function waitForJsonEndpoint(baseUrl, pathName, timeoutMs, label, stderrProvider = () => '') {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}${pathName}`, { method: 'GET' });
      if (response.ok) {
        return await response.json();
      }
    } catch {
      // wait and retry
    }
    await sleep(250);
  }
  const stderr = stderrProvider();
  throw new Error(`${label} did not become ready within ${timeoutMs}ms.${stderr ? ` Stderr: ${stderr}` : ''}`);
}

async function cleanup(exitCode) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  for (const child of tunnels.splice(0, tunnels.length)) {
    if (!child.killed) {
      child.kill('SIGTERM');
      await Promise.race([once(child, 'exit').catch(() => undefined), sleep(2_000)]);
      if (!child.killed && child.exitCode === null) {
        child.kill('SIGKILL');
      }
    }
  }
  process.exit(exitCode);
}

async function assertHealthy(host) {
  const health = await requestJson(host, 'GET', '/health');
  if (!health?.ok) {
    throw new Error(`${host.label}: health check failed.`);
  }
  console.error('[mega-crosshost] host healthy.', { host: host.label, baseUrl: host.baseUrl });
}

async function requestJson(host, method, pathName, body, extraHeaders = {}) {
  const headers = {
    ...(host.defaultHeaders ?? {}),
    ...extraHeaders,
  };
  let payload;
  if (body !== undefined && body !== null) {
    payload = typeof body === 'string' || body instanceof Uint8Array || body instanceof ArrayBuffer || body instanceof FormData
      ? body
      : JSON.stringify(body);
    if (!(payload instanceof FormData) && !('content-type' in lowerCaseKeys(headers))) {
      headers['content-type'] = 'application/json';
    }
  }

  const response = await fetchWithRetry(`${host.baseUrl}${pathName}`, {
    method,
    headers,
    body: payload,
  }, `${host.label}: ${method} ${pathName}`);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${host.label}: ${method} ${pathName} failed with ${response.status}: ${formatErrorBody(text)}`);
  }
  if (!text.trim()) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${host.label}: ${method} ${pathName} returned non-JSON: ${text}`);
  }
}

async function requestBytes(host, method, pathName, secret) {
  const response = await fetchWithRetry(`${host.baseUrl}${pathName}`, {
    method,
    headers: {
      ...(host.defaultHeaders ?? {}),
      'x-nearbytes-secret': secret,
    },
  }, `${host.label}: ${method} ${pathName}`);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${host.label}: ${method} ${pathName} failed with ${response.status}: ${formatErrorBody(text)}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function lowerCaseKeys(object) {
  return Object.fromEntries(Object.entries(object).map(([key, value]) => [key.toLowerCase(), value]));
}

function formatErrorBody(text) {
  const trimmed = text.trim();
  if (!trimmed) {
    return '(empty response body)';
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed?.error?.message) {
      return parsed.error.message;
    }
    return JSON.stringify(parsed);
  } catch {
    return trimmed;
  }
}

async function listAccounts(host) {
  return await requestJson(host, 'GET', '/integrations/accounts');
}

async function listManagedShares(host, fast = false) {
  const suffix = fast ? '?fast=1' : '';
  return await requestJson(host, 'GET', `/integrations/shares${suffix}`);
}

async function listIncomingShares(host) {
  return await requestJson(host, 'GET', '/integrations/shares/incoming');
}

async function listContactInvites(host) {
  return await requestJson(host, 'GET', '/integrations/providers/contact-invites');
}

async function debugShareInventory(host) {
  return await requestJson(host, 'GET', '/__debug/integrations/providers/mega/share-inventory');
}

async function getManagedShareState(host, shareId) {
  return await requestJson(host, 'GET', `/integrations/shares/${encodeURIComponent(shareId)}/state`);
}

async function connectMegaAccount(host) {
  const response = await requestJson(host, 'POST', '/integrations/accounts/connect', {
    provider: 'mega',
    label: 'MEGA',
    email: host.megaEmail,
    preferred: true,
    credentials: {
      email: host.megaEmail,
      password: megaPassword,
    },
  });
  if (response?.status !== 'connected' || !response.account?.id) {
    throw new Error(`${host.label}: MEGA connect did not finish immediately: ${JSON.stringify(response)}`);
  }
  console.error('[mega-crosshost] connected MEGA account.', { host: host.label, email: host.megaEmail, accountId: response.account.id });
  return response.account;
}

async function disconnectMegaAccount(host, accountId) {
  await requestJson(host, 'DELETE', `/integrations/accounts/${encodeURIComponent(accountId)}?mode=reset`);
  console.error('[mega-crosshost] disconnected MEGA account.', { host: host.label, accountId });
}

async function ensureExpectedMegaAccount(host) {
  const response = await listAccounts(host);
  const megaAccounts = (response?.accounts ?? []).filter((entry) => normalizeIdentity(entry.provider) === 'mega');
  const matchingConnected = megaAccounts.find(
    (entry) => normalizeIdentity(entry.email) === host.megaEmail && entry.state === 'connected'
  );
  if (matchingConnected && megaAccounts.length === 1) {
    console.error('[mega-crosshost] reusing connected MEGA account.', { host: host.label, accountId: matchingConnected.id, email: matchingConnected.email });
    return matchingConnected;
  }

  for (const account of megaAccounts) {
    await disconnectMegaAccount(host, account.id);
  }

  return await connectMegaAccount(host);
}

async function removeRecipientShares(host) {
  const response = await listManagedShares(host);
  const recipients = (response?.shares ?? []).filter(
    (entry) => normalizeIdentity(entry.share.provider) === 'mega' && entry.share.role === 'recipient'
  );
  for (const share of recipients) {
    await requestJson(host, 'DELETE', `/integrations/shares/${encodeURIComponent(share.share.id)}`);
    console.error('[mega-crosshost] removed recipient share.', { host: host.label, shareId: share.share.id, label: share.share.label });
  }
}

async function waitForOwnerShare(host, accountId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = 'missing';
  while (Date.now() < deadline) {
    const response = await listManagedShares(host);
    const owner = (response?.shares ?? []).find(
      (entry) =>
        normalizeIdentity(entry.share.provider) === 'mega' &&
        entry.share.accountId === accountId &&
        entry.share.role === 'owner'
    );
    if (owner) {
      lastStatus = owner.state?.status ?? 'unknown';
      if (lastStatus === 'ready') {
        return owner;
      }
    }
    await sleep(1_500);
  }
  throw new Error(`${host.label}: owner MEGA share was not ready within ${timeoutMs}ms (last status: ${lastStatus}).`);
}

async function waitForShareReady(host, shareId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = 'missing';
  while (Date.now() < deadline) {
    const response = await getManagedShareState(host, shareId);
    const status = response?.summary?.state?.status;
    if (typeof status === 'string') {
      lastStatus = status;
      if (status === 'ready') {
        return response.summary;
      }
    }
    await sleep(1_500);
  }
  throw new Error(`${host.label}: share ${shareId} did not become ready within ${timeoutMs}ms (last status: ${lastStatus}).`);
}

function isManagedShareNotFoundError(error) {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /failed with 404:/u.test(message);
}

async function waitForRecipientShareReady(host, initialShareId, expectedDescriptor, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let currentShareId = initialShareId;
  let lastStatus = 'missing';
  while (Date.now() < deadline) {
    try {
      const response = await getManagedShareState(host, currentShareId);
      const status = response?.summary?.state?.status;
      if (typeof status === 'string') {
        lastStatus = status;
        if (status === 'ready') {
          return {
            shareId: currentShareId,
            summary: response.summary,
          };
        }
      }
    } catch (error) {
      if (!isManagedShareNotFoundError(error)) {
        throw error;
      }
      const replacement = await findExistingRecipientShare(host, expectedDescriptor.ownerEmail, expectedDescriptor.shareName);
      const replacementId = typeof replacement?.share?.id === 'string' ? replacement.share.id : '';
      if (replacementId && replacementId !== currentShareId) {
        console.error('[mega-crosshost] recipient share id changed, following replacement.', {
          host: host.label,
          previousShareId: currentShareId,
          nextShareId: replacementId,
        });
        currentShareId = replacementId;
      }
    }
    await sleep(1_500);
  }
  throw new Error(`${host.label}: recipient share ${currentShareId} did not become ready within ${timeoutMs}ms (last status: ${lastStatus}).`);
}

async function openHub(host) {
  return await requestJson(host, 'POST', '/open', { secret: hubSecret });
}

async function acceptAllMegaContactInvites(host) {
  const response = await listContactInvites(host);
  const megaInvites = (response?.invites ?? []).filter((entry) => normalizeIdentity(entry.provider) === 'mega');
  for (const invite of megaInvites) {
    await requestJson(host, 'POST', '/integrations/providers/contact-invites/accept', {
      provider: invite.provider,
      accountId: invite.accountId,
      inviteId: invite.id,
    });
    console.error('[mega-crosshost] accepted MEGA contact invite.', { host: host.label, inviteId: invite.id, label: invite.label });
  }
}

function isMegaTransientLockError(error) {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /MEGA API error -(3|11)\b/u.test(message);
}

async function inviteManagedShareWithRetry(host, shareId, targetEmails, accessLevel) {
  const maxAttempts = 12;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      await requestJson(host, 'POST', `/integrations/shares/${encodeURIComponent(shareId)}/invite`, {
        emails: [...targetEmails],
        accessLevel,
      });
      console.error('[mega-crosshost] invited collaborators.', { host: host.label, shareId, emails: targetEmails, accessLevel });
      return;
    } catch (error) {
      if (!isMegaTransientLockError(error) || attempt + 1 >= maxAttempts) {
        throw error;
      }
      const delay = Math.min(25_000, 2_000 + attempt * 2_000);
      console.error('[mega-crosshost] invite hit transient MEGA lock, retrying.', { host: host.label, shareId, attempt: attempt + 1, delayMs: delay });
      await sleep(delay);
    }
  }
}

async function waitOutgoingShareDescriptor(host, shareName, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const inventory = await debugShareInventory(host);
    const accounts = Array.isArray(inventory?.accounts) ? inventory.accounts : [];
    for (const account of accounts) {
      const outgoing = Array.isArray(account?.outgoing) ? account.outgoing : [];
      const match = outgoing.find((entry) => normalizeIdentity(entry.label) === normalizeIdentity(shareName));
      if (match?.shareHandle || match?.rootHandle) {
        return {
          ownerEmail: host.megaEmail,
          shareName,
          shareHandle: typeof match.shareHandle === 'string' ? match.shareHandle.trim() : '',
          rootHandle: typeof match.rootHandle === 'string' ? match.rootHandle.trim() : '',
        };
      }
    }
    await sleep(1_500);
  }
  throw new Error(`${host.label}: no outgoing MEGA descriptor found for ${shareName} within ${timeoutMs}ms.`);
}

function matchesRecipientShare(summary, ownerEmail, shareName) {
  const descriptor = summary?.share?.remoteDescriptor ?? {};
  return normalizeIdentity(summary?.share?.provider) === 'mega' &&
    summary?.share?.role === 'recipient' &&
    normalizeIdentity(descriptor.ownerEmail) === normalizeIdentity(ownerEmail) &&
    normalizeIdentity(descriptor.shareName ?? summary?.share?.label) === normalizeIdentity(shareName);
}

async function findExistingRecipientShare(host, ownerEmail, shareName) {
  const response = await listManagedShares(host, true);
  return (response?.shares ?? []).find((summary) => matchesRecipientShare(summary, ownerEmail, shareName));
}

function matchesIncomingDescriptor(candidate, expectedDescriptor, offerLabel) {
  const expectedShareHandle = normalizeIdentity(expectedDescriptor.shareHandle);
  const expectedRootHandle = normalizeIdentity(expectedDescriptor.rootHandle);
  const candidateShareHandle = normalizeIdentity(candidate?.shareHandle);
  const candidateRootHandle = normalizeIdentity(candidate?.rootHandle);

  if (expectedShareHandle && (candidateShareHandle === expectedShareHandle || candidateRootHandle === expectedShareHandle)) {
    return true;
  }
  if (expectedRootHandle && (candidateRootHandle === expectedRootHandle || candidateShareHandle === expectedRootHandle)) {
    return true;
  }
  return normalizeIdentity(candidate?.ownerEmail) === normalizeIdentity(expectedDescriptor.ownerEmail) &&
    normalizeIdentity(candidate?.shareName ?? offerLabel) === normalizeIdentity(expectedDescriptor.shareName);
}

async function waitIncomingShareDescriptor(host, expectedDescriptor, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const existing = await findExistingRecipientShare(host, expectedDescriptor.ownerEmail, expectedDescriptor.shareName);
    if (existing?.share?.remoteDescriptor) {
      return existing.share.remoteDescriptor;
    }

    const response = await listIncomingShares(host);
    const match = (response?.shares ?? []).find((offer) =>
      normalizeIdentity(offer.provider) === 'mega' &&
      matchesIncomingDescriptor(offer.remoteDescriptor ?? {}, expectedDescriptor, offer.label)
    );
    if (match?.remoteDescriptor) {
      return match.remoteDescriptor;
    }
    await sleep(1_500);
  }
  throw new Error(
    `${host.label}: no incoming MEGA offer for ${expectedDescriptor.ownerEmail}:${expectedDescriptor.shareName} within ${timeoutMs}ms.`
  );
}

async function ensureRecipientShareAttached(host, accountId, volumeId, expectedDescriptor) {
  const existing = await findExistingRecipientShare(host, expectedDescriptor.ownerEmail, expectedDescriptor.shareName);
  if (existing) {
    if (!existing.attachments.some((attachment) => attachment.volumeId === volumeId)) {
      await requestJson(host, 'POST', `/integrations/shares/${encodeURIComponent(existing.share.id)}/attach`, { volumeId });
      console.error('[mega-crosshost] attached existing recipient share to hub.', { host: host.label, shareId: existing.share.id, volumeId });
    }
    return existing;
  }

  const remoteDescriptor = await waitIncomingShareDescriptor(host, expectedDescriptor, INCOMING_OFFER_TIMEOUT_MS);
  const response = await requestJson(host, 'POST', '/integrations/shares/accept', {
    provider: 'mega',
    accountId,
    label: expectedDescriptor.shareName,
    volumeId,
    remoteDescriptor,
  });
  console.error('[mega-crosshost] accepted incoming recipient share.', { host: host.label, shareId: response?.summary?.share?.id, volumeId });
  return response.summary;
}

async function uploadFile(host, secret, filename, bytes) {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'application/octet-stream' }), filename);
  form.append('filename', filename);
  const response = await fetchWithRetry(`${host.baseUrl}/upload`, {
    method: 'POST',
    headers: {
      ...(host.defaultHeaders ?? {}),
      'x-nearbytes-secret': secret,
    },
    body: form,
  }, `${host.label}: POST /upload`);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${host.label}: upload failed with ${response.status}: ${formatErrorBody(text)}`);
  }
  const parsed = JSON.parse(text);
  console.error('[mega-crosshost] uploaded file.', { host: host.label, filename, blobHash: parsed?.created?.blobHash });
  return parsed;
}

function getUploadedBlockPath(uploadResponse) {
  const blobHash = String(uploadResponse?.created?.blobHash ?? '').trim().toLowerCase();
  if (!/^[a-f0-9]{32,}$/u.test(blobHash)) {
    throw new Error(`Upload response missing valid blob hash: ${JSON.stringify(uploadResponse)}`);
  }
  return `blocks/${blobHash}.bin`;
}

async function forceSharePushPath(host, shareId, relativePath) {
  await requestJson(host, 'POST', `/integrations/shares/${encodeURIComponent(shareId)}/push-path`, {
    path: relativePath,
  });
  console.error('[mega-crosshost] forced owner push-path.', { host: host.label, shareId, relativePath });
}

async function triggerShareSyncNow(host, shareId, quiet = false) {
  await requestJson(host, 'POST', `/integrations/shares/${encodeURIComponent(shareId)}/sync`, {});
  if (!quiet) {
    console.error('[mega-crosshost] triggered recipient sync.', { host: host.label, shareId });
  }
}

async function listFiles(host, secret) {
  const response = await fetchWithRetry(`${host.baseUrl}/files`, {
    method: 'GET',
    headers: {
      ...(host.defaultHeaders ?? {}),
      'x-nearbytes-secret': secret,
    },
  }, `${host.label}: GET /files`);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${host.label}: list files failed with ${response.status}: ${formatErrorBody(text)}`);
  }
  return JSON.parse(text);
}

function parseSseEventBlock(block) {
  let event = 'message';
  const dataLines = [];
  for (const rawLine of block.split('\n')) {
    const line = rawLine.trimEnd();
    if (!line || line.startsWith(':')) {
      continue;
    }
    if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trim();
      continue;
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trimStart());
    }
  }
  const dataText = dataLines.join('\n');
  let data = null;
  if (dataText) {
    try {
      data = JSON.parse(dataText);
    } catch {
      data = dataText;
    }
  }
  return { event, data };
}

async function waitForFileBytes(host, secret, filename, expectedBytes, timeoutMs, onPushSync = null) {
  const checkFile = async () => {
    const listing = await listFiles(host, secret);
    const file = (listing?.files ?? []).find((entry) => entry.filename === filename);
    if (!file?.blobHash) {
      return null;
    }
    const bytes = await requestBytes(host, 'GET', `/file/${encodeURIComponent(file.blobHash)}`, secret);
    if (Buffer.compare(bytes, expectedBytes) !== 0) {
      return null;
    }
    return file;
  };

  const immediate = await checkFile();
  if (immediate) {
    return immediate;
  }

  if (typeof onPushSync === 'function') {
    try {
      await onPushSync();
    } catch {
      // Sync trigger can be transient; continue with event-driven wait.
    }
  }

  const controller = new AbortController();
  let reader = null;
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const secondCheck = await checkFile();
    if (secondCheck) {
      return secondCheck;
    }

    const response = await fetchWithRetry(`${host.baseUrl}/watch/volume-events`, {
      method: 'GET',
      headers: {
        ...(host.defaultHeaders ?? {}),
        'x-nearbytes-secret': secret,
      },
      signal: controller.signal,
    }, `${host.label}: GET /watch/volume-events`);
    if (!response.ok || !response.body) {
      const text = await response.text();
      throw new Error(`${host.label}: watch stream failed with ${response.status}: ${formatErrorBody(text)}`);
    }

    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      while (true) {
        const sep = buffer.indexOf('\n\n');
        if (sep < 0) {
          break;
        }
        const block = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const parsed = parseSseEventBlock(block);
        if (parsed.event === 'watch-ended') {
          throw new Error(`${host.label}: watch stream ended: ${JSON.stringify(parsed.data)}`);
        }
        if (parsed.event === 'watch-error') {
          throw new Error(`${host.label}: watch stream error: ${JSON.stringify(parsed.data)}`);
        }
        if (parsed.event === 'volume-event' || parsed.event === 'volume-update' || parsed.event === 'volume-event-ready') {
          if (typeof onPushSync === 'function') {
            try {
              await onPushSync();
            } catch {
              // Keep processing subsequent events.
            }
          }
          const file = await checkFile();
          if (file) {
            return file;
          }
        }
      }
    }
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`${host.label}: file ${filename} did not arrive with matching bytes within ${timeoutMs}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutHandle);
    controller.abort();
    if (reader) {
      await reader.cancel().catch(() => {});
    }
  }

  throw new Error(`${host.label}: file ${filename} did not arrive with matching bytes within ${timeoutMs}ms.`);
}

async function wipeMegaAccounts() {
  process.env.NEARBYTES_ALLOW_DESTRUCTIVE_MEGA_E2E_WIPE = '1';
  const emails = [remoteMegaEmail, localMegaEmail];
  for (const email of emails) {
    const peers = emails.filter((entry) => entry !== email);
    const revokeController = new AbortController();
    const revokeTimer = setTimeout(() => revokeController.abort(), WIPE_TIMEOUT_MS);
    try {
      console.error('[mega-crosshost] revoking outgoing shares.', { email, peers });
      const { revokedCount } = await revokeMegaOutgoingSharesForPeers({
        email,
        password: megaPassword,
        peerEmails: peers,
        signal: revokeController.signal,
      });
      console.error('[mega-crosshost] revoked outgoing shares.', { email, revokedCount });
    } finally {
      clearTimeout(revokeTimer);
    }
  }

  for (const email of emails) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WIPE_TIMEOUT_MS);
    try {
      console.error('[mega-crosshost] wiping cloud drive.', { email });
      const { deletedNodeCount } = await wipeMegaCloudDriveContentsForE2e({
        email,
        password: megaPassword,
        signal: controller.signal,
      });
      console.error('[mega-crosshost] wiped cloud drive.', { email, deletedNodeCount });
    } finally {
      clearTimeout(timer);
    }
  }
}

function buildPayload(tag) {
  return Buffer.from(`${tag}\nsha256=${sha256Hex(Buffer.from(tag, 'utf8'))}\n`, 'utf8');
}

async function runIteration(iteration, localHost, remoteHost, localAccountId, remoteAccountId) {
  console.error('[mega-crosshost] iteration start.', { iteration, hubSeed, localHost: localHost.label, remoteHost: remoteHost.label });

  await wipeMegaAccounts();
  await Promise.all([removeRecipientShares(localHost), removeRecipientShares(remoteHost)]);
  await sleep(BETWEEN_STEPS_DELAY_MS);

  const [localOwner, remoteOwner, localOpen, remoteOpen] = await Promise.all([
    waitForOwnerShare(localHost, localAccountId, OWNER_READY_TIMEOUT_MS),
    waitForOwnerShare(remoteHost, remoteAccountId, OWNER_READY_TIMEOUT_MS),
    openHub(localHost),
    openHub(remoteHost),
  ]);

  if (normalizeIdentity(localOpen?.volumeId) !== normalizeIdentity(remoteOpen?.volumeId)) {
    throw new Error(`Volume ids differ for hub ${hubSeed}: ${localOpen?.volumeId} vs ${remoteOpen?.volumeId}`);
  }

  const volumeId = String(localOpen.volumeId ?? '').trim().toLowerCase();
  if (!volumeId) {
    throw new Error(`Failed to open hub ${hubSeed}: missing volume id.`);
  }

  const localShareName = String(localOwner.share.remoteDescriptor?.shareName ?? localOwner.share.label).trim();
  const remoteShareName = String(remoteOwner.share.remoteDescriptor?.shareName ?? remoteOwner.share.label).trim();

  await inviteManagedShareWithRetry(localHost, localOwner.share.id, [remoteHost.megaEmail], INVITE_ACCESS_LEVEL);
  await sleep(BETWEEN_STEPS_DELAY_MS);
  await acceptAllMegaContactInvites(remoteHost);
  await sleep(BETWEEN_STEPS_DELAY_MS);
  await inviteManagedShareWithRetry(remoteHost, remoteOwner.share.id, [localHost.megaEmail], INVITE_ACCESS_LEVEL);
  await sleep(BETWEEN_STEPS_DELAY_MS);
  await acceptAllMegaContactInvites(localHost);

  const [localDescriptor, remoteDescriptor] = await Promise.all([
    waitOutgoingShareDescriptor(localHost, localShareName, INCOMING_OFFER_TIMEOUT_MS),
    waitOutgoingShareDescriptor(remoteHost, remoteShareName, INCOMING_OFFER_TIMEOUT_MS),
  ]);

  const [remoteRecipient, localRecipient] = await Promise.all([
    ensureRecipientShareAttached(remoteHost, remoteAccountId, volumeId, localDescriptor),
    ensureRecipientShareAttached(localHost, localAccountId, volumeId, remoteDescriptor),
  ]);

  const [readyRemoteRecipient, readyLocalRecipient] = await Promise.all([
    waitForRecipientShareReady(remoteHost, remoteRecipient.share.id, localDescriptor, RECIPIENT_READY_TIMEOUT_MS),
    waitForRecipientShareReady(localHost, localRecipient.share.id, remoteDescriptor, RECIPIENT_READY_TIMEOUT_MS),
  ]);

  const localToRemoteName = `e2e-${iteration}-local-to-remote-${Date.now()}.bin`;
  const localToRemoteBytes = buildPayload(`iteration=${iteration} direction=local->remote origin=${localHost.label}`);
  const localUpload = await uploadFile(localHost, hubSecret, localToRemoteName, localToRemoteBytes);
  const localUploadPath = getUploadedBlockPath(localUpload);
  await forceSharePushPath(localHost, localOwner.share.id, localUploadPath);
  await triggerShareSyncNow(remoteHost, readyRemoteRecipient.shareId);
  await waitForFileBytes(
    remoteHost,
    hubSecret,
    localToRemoteName,
    localToRemoteBytes,
    FILE_TIMEOUT_MS,
    async () => triggerShareSyncNow(remoteHost, readyRemoteRecipient.shareId, true)
  );

  const remoteToLocalName = `e2e-${iteration}-remote-to-local-${Date.now()}.bin`;
  const remoteToLocalBytes = buildPayload(`iteration=${iteration} direction=remote->local origin=${remoteHost.label}`);
  const remoteUpload = await uploadFile(remoteHost, hubSecret, remoteToLocalName, remoteToLocalBytes);
  const remoteUploadPath = getUploadedBlockPath(remoteUpload);
  await forceSharePushPath(remoteHost, remoteOwner.share.id, remoteUploadPath);
  await triggerShareSyncNow(localHost, readyLocalRecipient.shareId);
  await waitForFileBytes(
    localHost,
    hubSecret,
    remoteToLocalName,
    remoteToLocalBytes,
    FILE_TIMEOUT_MS,
    async () => triggerShareSyncNow(localHost, readyLocalRecipient.shareId, true)
  );

  console.error('[mega-crosshost] iteration complete.', {
    iteration,
    volumeId,
    localToRemoteName,
    remoteToLocalName,
  });
}

async function collectDiagnostics(host) {
  const tasks = {
    accounts: () => listAccounts(host),
    shares: () => listManagedShares(host),
    incomingShares: () => listIncomingShares(host),
    contactInvites: () => listContactInvites(host),
    inventory: () => debugShareInventory(host),
  };
  const output = { host: host.label, baseUrl: host.baseUrl };
  for (const [key, task] of Object.entries(tasks)) {
    try {
      output[key] = await task();
    } catch (error) {
      output[key] = { error: error instanceof Error ? error.message : String(error) };
    }
  }
  return output;
}

async function dumpDiagnosticsOnFailure(localBaseUrlValue, remoteBaseUrlOverrideValue) {
  try {
    const remoteBaseUrl = remoteBaseUrlOverrideValue ?? (tunnels[0] ? null : null);
    const localHost = createHost(localLabel, localBaseUrlValue, localMegaEmail);
    const hosts = [localHost];
    if (remoteBaseUrlOverrideValue) {
      hosts.push(createHost(remoteLabel, remoteBaseUrlOverrideValue, remoteMegaEmail));
    } else if (tunnels.length > 0) {
      const tunnel = tunnels[0];
      const localForwardArg = tunnel.spawnargs.find((arg) => /^\d+:127\.0\.0\.1:/u.test(arg));
      if (localForwardArg) {
        const localPort = localForwardArg.split(':', 1)[0];
        hosts.push(createHost(remoteLabel, `http://127.0.0.1:${localPort}`, remoteMegaEmail));
      }
    }
    for (const host of hosts) {
      console.error('[mega-crosshost] diagnostics.', JSON.stringify(await collectDiagnostics(host), null, 2));
    }
  } catch (error) {
    console.error('[mega-crosshost] failed to dump diagnostics.', error instanceof Error ? error.stack ?? error.message : error);
  }
}