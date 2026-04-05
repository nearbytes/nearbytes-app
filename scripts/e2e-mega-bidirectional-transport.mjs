#!/usr/bin/env node
/**
 * End-to-end: MEGA as transport only (no Nearbytes HTTP server).
 * Two isolated peers (separate storage + integration state); each connects one MEGA account,
 * cross-invites writable shares, and validates owner->recipient plus recipient->owner bytes
 * on both shared folders before exiting.
 *
 * This is a fast smoke test by default: it is meant to replicate the first minute or two of
 * app behavior, not a long soak. Override the env timeouts below only when doing slower manual
 * diagnostics against MEGA.
 *
 * Requires: `yarn build`
 * Env: `.env.e2e` (optional auto-load), plus:
 *   - NEARBYTES_E2E_MEGA_OWNER_EMAIL (user A)
 *   - NEARBYTES_E2E_MEGA_RECIPIENT_EMAIL (user B)
 *   - NEARBYTES_E2E_MEGA_PASSWORD
 * Optional:
 *   - NEARBYTES_E2E_SKIP_MEGA_WIPE=1
 *   - NEARBYTES_E2E_MEGA_REMOTE_BASE_PATH=/test
 *
 * Usage: `yarn e2e:mega-bidirectional-transport`
 */

import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const envE2ePath = path.join(__dirname, '..', '.env.e2e');
if (existsSync(envE2ePath)) {
  for (const rawLine of readFileSync(envE2ePath, 'utf8').split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
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

const emailA = process.env.NEARBYTES_E2E_MEGA_OWNER_EMAIL?.trim();
const emailB = process.env.NEARBYTES_E2E_MEGA_RECIPIENT_EMAIL?.trim();
const password = process.env.NEARBYTES_E2E_MEGA_PASSWORD ?? '';
const configuredRemoteBasePath = process.env.NEARBYTES_E2E_MEGA_REMOTE_BASE_PATH?.trim()
  ?? process.env.NEARBYTES_MEGA_REMOTE_BASE?.trim()
  ?? '/test';
const remoteBasePath = `/${configuredRemoteBasePath.replace(/^\/+|\/+$/gu, '') || 'test'}`;
const remoteShareName = path.posix.basename(remoteBasePath);
process.env.NEARBYTES_MEGA_REMOTE_BASE = remoteBasePath;

if (!emailA || !emailB || !password) {
  console.error(
    'Missing env: NEARBYTES_E2E_MEGA_OWNER_EMAIL, NEARBYTES_E2E_MEGA_RECIPIENT_EMAIL, NEARBYTES_E2E_MEGA_PASSWORD'
  );
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readPositiveIntEnv(name, fallback) {
  const raw = process.env[name]?.trim();
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
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) {
    return fallback;
  }
  if (raw === 'read' || raw === 'read/write' || raw === 'full access') {
    return raw;
  }
  throw new Error(`${name} must be one of: read, read/write, full access.`);
}

const WIPE_TIMEOUT_MS = readPositiveIntEnv('NEARBYTES_E2E_MEGA_WIPE_TIMEOUT_MS', 20 * 60 * 1000);
const CONNECT_ACCOUNT_TIMEOUT_MS = readPositiveIntEnv('NEARBYTES_E2E_MEGA_CONNECT_TIMEOUT_MS', 20_000);
const OWNER_READY_TIMEOUT_MS = readPositiveIntEnv('NEARBYTES_E2E_MEGA_OWNER_READY_TIMEOUT_MS', 45_000);
/** Serial incoming polls remain more reliable because MEGA `-3` is more likely if two accounts hammer `f` concurrently. */
const INCOMING_OFFER_TIMEOUT_MS = readPositiveIntEnv('NEARBYTES_E2E_MEGA_INCOMING_OFFER_TIMEOUT_MS', 45_000);
const RECIPIENT_READY_TIMEOUT_MS = readPositiveIntEnv('NEARBYTES_E2E_MEGA_RECIPIENT_READY_TIMEOUT_MS', 60_000);
const MIRROR_FILE_TIMEOUT_MS = readPositiveIntEnv('NEARBYTES_E2E_MEGA_MIRROR_FILE_TIMEOUT_MS', 90_000);
const SECOND_ACCOUNT_COOLDOWN_MS = readPositiveIntEnv('NEARBYTES_E2E_MEGA_SECOND_ACCOUNT_COOLDOWN_MS', 1_000);
const PRE_INVITE_DELAY_MS = readPositiveIntEnv('NEARBYTES_E2E_MEGA_PRE_INVITE_DELAY_MS', 1_000);
const BETWEEN_INVITES_DELAY_MS = readPositiveIntEnv('NEARBYTES_E2E_MEGA_BETWEEN_INVITES_DELAY_MS', 1_000);
const POST_INVITE_CONTACT_DELAY_MS = readPositiveIntEnv('NEARBYTES_E2E_MEGA_POST_INVITE_CONTACT_DELAY_MS', 1_000);
const POST_INVITE_SETTLE_MS = readPositiveIntEnv('NEARBYTES_E2E_MEGA_POST_INVITE_SETTLE_MS', 4_000);
const SYNC_INTERVAL_MS = readPositiveIntEnv('NEARBYTES_E2E_MEGA_SYNC_INTERVAL_MS', 60_000);
const SYNC_TIMEOUT_MS = readPositiveIntEnv('NEARBYTES_E2E_MEGA_SYNC_TIMEOUT_MS', 60_000);
const CLEANUP_TIMEOUT_MS = readPositiveIntEnv('NEARBYTES_E2E_MEGA_CLEANUP_TIMEOUT_MS', 5_000);
const PAYLOAD_BYTES = readPositiveIntEnv('NEARBYTES_E2E_MEGA_PAYLOAD_BYTES', 1024);
const SKIP_MEGA_WIPE = process.env.NEARBYTES_E2E_SKIP_MEGA_WIPE?.trim() === '1';
const CLEAR_REMOTE_BASE = process.env.NEARBYTES_E2E_MEGA_CLEAR_REMOTE_BASE
  ? process.env.NEARBYTES_E2E_MEGA_CLEAR_REMOTE_BASE.trim() === '1'
  : true;
const SKIP_MEGA_REVOKE = process.env.NEARBYTES_E2E_SKIP_MEGA_REVOKE
  ? process.env.NEARBYTES_E2E_SKIP_MEGA_REVOKE.trim() === '1'
  : true;
const WRITABLE_INVITE_ACCESS_LEVEL = readMegaInviteAccessLevelEnv(
  'NEARBYTES_E2E_MEGA_SHARE_ACCESS_LEVEL',
  'read/write'
);

function sha256Hex(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

async function withTimeout(label, timeoutMs, operation) {
  let timer;
  try {
    return await Promise.race([
      operation(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out within ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function createPayload(direction) {
  const prefix = Buffer.from(`${direction}:${Date.now()}\n`, 'utf8');
  if (prefix.length >= PAYLOAD_BYTES) {
    return prefix.subarray(0, PAYLOAD_BYTES);
  }
  const fill = Buffer.alloc(PAYLOAD_BYTES - prefix.length, direction === 'A→B' ? 0x41 : 0x42);
  return Buffer.concat([prefix, fill]);
}

async function cleanupPeer(peer, label) {
  if (!peer) {
    return;
  }
  await withTimeout(`${label} dispose`, CLEANUP_TIMEOUT_MS, () => peer.service.dispose()).catch(() => {});
  await withTimeout(`${label} rm`, CLEANUP_TIMEOUT_MS, () => rm(peer.base, { recursive: true, force: true })).catch(() => {});
}

async function wipeBothIfEnabled() {
  process.env.NEARBYTES_ALLOW_DESTRUCTIVE_MEGA_E2E_WIPE = '1';
  const { revokeMegaOutgoingSharesForPeers, wipeMegaCloudDriveContentsForE2e } = await import('../dist/integrations/mega.js');
  const pair = [emailA, emailB];
  if (!SKIP_MEGA_REVOKE) {
    for (const email of pair) {
      const peers = pair.filter((e) => e !== email);
      console.error(`[mega-bidir] revoke outgoing shares ${email} → peers…`);
      const rc = new AbortController();
      const rt = setTimeout(() => rc.abort(), WIPE_TIMEOUT_MS);
      try {
        const { revokedCount } = await revokeMegaOutgoingSharesForPeers({
          email,
          password,
          peerEmails: peers,
          signal: rc.signal,
        });
        console.error(`[mega-bidir] revoked ${revokedCount} row(s) for ${email}`);
      } finally {
        clearTimeout(rt);
      }
    }
  } else {
    console.error('[mega-bidir] skip revoke enabled');
  }

  if (SKIP_MEGA_WIPE) {
    console.error('[mega-bidir] skip wipe enabled');
    return;
  }

  for (const email of pair) {
    console.error(`[mega-bidir] wipe ${email}…`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WIPE_TIMEOUT_MS);
    try {
      const { deletedNodeCount } = await wipeMegaCloudDriveContentsForE2e({ email, password, signal: controller.signal });
      console.error(`[mega-bidir] wipe ${email} deleted ${deletedNodeCount} node(s)`);
    } finally {
      clearTimeout(timer);
    }
  }
}

async function clearRemoteBasePathIfEnabled() {
  process.env.NEARBYTES_ALLOW_DESTRUCTIVE_MEGA_E2E_WIPE = '1';
  if (!CLEAR_REMOTE_BASE) {
    console.error('[mega-bidir] skip remote base clear enabled');
    return;
  }

  const { clearMegaRemotePathForE2e } = await import('../dist/integrations/mega.js');
  for (const email of [emailA, emailB]) {
    console.error(`[mega-bidir] clear ${email}:${remoteBasePath}…`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WIPE_TIMEOUT_MS);
    try {
      const { deletedNodeCount } = await clearMegaRemotePathForE2e({
        email,
        password,
        remotePath: remoteBasePath,
        signal: controller.signal,
      });
      console.error(`[mega-bidir] clear ${email}:${remoteBasePath} removed ${deletedNodeCount} root(s)`);
    } finally {
      clearTimeout(timer);
    }
  }
}

function createRootsConfig(mainRoot) {
  return {
    version: 2,
    sources: [
      {
        id: 'src-main',
        provider: 'local',
        path: mainRoot,
        enabled: true,
        writable: true,
        reservePercent: 10,
        opportunisticPolicy: 'drop-older-blocks',
      },
    ],
    defaultVolume: {
      destinations: [
        {
          sourceId: 'src-main',
          enabled: true,
          storeEvents: true,
          storeBlocks: true,
          copySourceBlocks: true,
          reservePercent: 10,
          fullPolicy: 'block-writes',
        },
      ],
    },
    volumes: [],
  };
}

async function createPeerTransport(peerLabel) {
  const base = await mkdtemp(path.join(tmpdir(), `nearbytes-mega-transport-${peerLabel}-`));
  const mainRoot = path.join(base, 'main-root');
  const rootsConfigPath = path.join(base, 'roots.json');
  const integrationStatePath = path.join(base, 'integrations.json');
  await mkdir(mainRoot, { recursive: true });
  await writeFile(rootsConfigPath, `${JSON.stringify(createRootsConfig(mainRoot), null, 2)}\n`, 'utf8');

  const { MultiRootStorageBackend } = await import('../dist/storage/multiRoot.js');
  const { ManagedShareService } = await import('../dist/integrations/managedShares.js');
  const { MegaTransportAdapter } = await import('../dist/integrations/mega.js');
  const { createIntegrationRuntime } = await import('../dist/integrations/runtime.js');
  const { JsonFileSecretStore } = await import('../dist/integrations/secretStore.js');

  const storage = new MultiRootStorageBackend(createRootsConfig(mainRoot));
  const runtime = createIntegrationRuntime({
    secretStore: new JsonFileSecretStore({ filePath: path.join(base, 'integration-secrets.json') }),
    mega: {
      remoteBasePath,
      /** Keep the safety-net in seconds, not minutes: this smoke test is meant to validate prompt startup behavior. */
      syncIntervalMs: SYNC_INTERVAL_MS,
      syncTimeoutMs: SYNC_TIMEOUT_MS,
    },
    logger: {
      log: (...args) => console.error(`[mega-bidir][${peerLabel}]`, ...args),
      warn: (...args) => console.error(`[mega-bidir][${peerLabel}] WARN`, ...args),
    },
  });
  const service = new ManagedShareService({
    storage,
    rootsConfigPath,
    integrationStatePath,
    adapters: [new MegaTransportAdapter(runtime)],
    readMaintenanceMode: 'background',
  });
  return { base, service, mainRoot, integrationStatePath };
}

async function waitShareReady(service, shareId, label, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const st = await service.getManagedShareState(shareId);
    if (st.state?.status === 'ready') {
      return;
    }
    await sleep(1_000);
  }
  throw new Error(`${label}: share ${shareId} not ready within ${timeoutMs}ms (last ${(await service.getManagedShareState(shareId)).state?.status})`);
}

async function waitShareStarted(service, shareId, label, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = (await service.getManagedShareState(shareId)).state?.status;
    if (status === 'ready' || status === 'syncing') {
      return;
    }
    await sleep(1_000);
  }
  throw new Error(`${label}: share ${shareId} did not start within ${timeoutMs}ms (last ${(await service.getManagedShareState(shareId)).state?.status})`);
}

async function clearMegaRecipientManifest(peer, shareId) {
  const secretsPath = path.join(peer.base, 'integration-secrets.json');
  let snapshot;
  try {
    snapshot = JSON.parse(await readFile(secretsPath, 'utf8'));
  } catch {
    return;
  }
  if (!snapshot || typeof snapshot !== 'object' || typeof snapshot.entries !== 'object' || !snapshot.entries) {
    return;
  }
  const key = `provider-share:mega:manifest:${shareId}`;
  if (!(key in snapshot.entries)) {
    console.error('[mega-bidir] recipient manifest cursor already absent.', { shareId, secretsPath });
    return;
  }
  delete snapshot.entries[key];
  await writeFile(secretsPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  console.error('[mega-bidir] recipient manifest cursor cleared.', { shareId, secretsPath });
}

async function syncRecipientShareNow(peer, shareId, label) {
  await clearMegaRecipientManifest(peer, shareId);
  const state = await peer.service.loadState();
  const share = state.managedShares.find((entry) => entry.id === shareId);
  if (!share) {
    throw new Error(`${label}: managed share ${shareId} not found`);
  }
  console.error('[mega-bidir] explicit recipient sync requested.', {
    label,
    shareId,
    role: share.role,
    localPath: share.localPath,
  });
  const adapter = peer.service.adapters?.get?.('mega');
  if (!adapter || typeof adapter.syncShare !== 'function') {
    throw new Error(`${label}: MEGA adapter syncShare is unavailable`);
  }
  const account = state.accounts.find((entry) => entry.id === share.accountId) ?? null;
  await adapter.syncShare(share, account);
  console.error('[mega-bidir] explicit recipient sync completed.', { label, shareId });
}

async function pickOwnerShare(integrationStatePath) {
  const state = JSON.parse(await readFile(integrationStatePath, 'utf8'));
  const owner = state.managedShares?.find?.((share) => share?.provider === 'mega' && share?.role === 'owner');
  if (!owner) {
    throw new Error('No MEGA owner managed share after connect');
  }
  return { share: owner };
}

function isMegaTransientLockError(err) {
  if (typeof err?.code === 'number' && err.code === -3) {
    return true;
  }
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return /MEGA API error -3\b/u.test(msg);
}

async function inviteManagedShareWithMegaRetry(service, shareId, emails, label, accessLevel) {
  const maxAttempts = 12;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      await service.inviteManagedShare(shareId, emails, accessLevel);
      return;
    } catch (err) {
      if (isMegaTransientLockError(err) && attempt + 1 < maxAttempts) {
        const delay = Math.min(25_000, 2_000 + attempt * 2_000);
        console.error(`[mega-bidir] ${label}: invite MEGA -3, backing off ${delay}ms (${attempt + 1}/${maxAttempts})`);
        await sleep(delay);
        continue;
      }
      throw err;
    }
  }
}

/** MEGA often requires accepting a contact request before the folder share appears in incoming. */
async function acceptAllMegaContactInvites(service, label) {
  try {
    const { invites } = await service.listIncomingProviderContactInvites();
    for (const inv of invites ?? []) {
      if (inv.provider !== 'mega') {
        continue;
      }
      console.error(`[mega-bidir] ${label}: accept MEGA contact invite`, inv.id);
      await service.acceptIncomingProviderContactInvite('mega', inv.accountId, inv.id);
    }
  } catch (err) {
    console.error(`[mega-bidir] ${label}: contact invite step`, err?.message ?? err);
  }
}

async function waitOutgoingShareDescriptor(service, ownerEmail, shareName, accessLevel, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const inventory = await service.debugProviderShareInventory('mega');
    const account = inventory.accounts?.[0];
    const outgoing = account?.outgoing ?? [];
    const match = outgoing.find((entry) => entry.label === shareName);
    if (match?.shareHandle || match?.rootHandle) {
      const shareHandle = match.shareHandle?.trim() || match.rootHandle?.trim();
      const rootHandle = match.rootHandle?.trim() || match.shareHandle?.trim();
      return {
        remotePath: `${ownerEmail}:${shareName}`,
        shareName,
        ownerEmail,
        accessLevel,
        shareHandle,
        rootHandle,
      };
    }
    await sleep(1_500);
  }
  throw new Error(`No outgoing MEGA share descriptor for ${ownerEmail}:${shareName} within ${timeoutMs}ms`);
}

function normalizeIdentity(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function matchesRecipientShare(share, ownerEmail, shareName) {
  const descriptor = share?.remoteDescriptor ?? {};
  return share?.provider === 'mega' &&
    share?.role === 'recipient' &&
    normalizeIdentity(descriptor.ownerEmail) === normalizeIdentity(ownerEmail) &&
    normalizeIdentity(descriptor.shareName ?? share.label) === normalizeIdentity(shareName);
}

async function findExistingRecipientShare(service, ownerEmail, shareName) {
  const { shares } = await service.listManagedShares({ fast: true });
  return shares.find((summary) => matchesRecipientShare(summary.share, ownerEmail, shareName));
}

function matchesIncomingDescriptor(candidate, expectedDescriptor, offerLabel) {
  const expectedShareHandle = normalizeIdentity(expectedDescriptor.shareHandle);
  const expectedRootHandle = normalizeIdentity(expectedDescriptor.rootHandle);
  const candidateShareHandle = normalizeIdentity(candidate.shareHandle);
  const candidateRootHandle = normalizeIdentity(candidate.rootHandle);

  if (expectedShareHandle && (candidateShareHandle === expectedShareHandle || candidateRootHandle === expectedShareHandle)) {
    return true;
  }
  if (expectedRootHandle && (candidateRootHandle === expectedRootHandle || candidateShareHandle === expectedRootHandle)) {
    return true;
  }

  return (
    normalizeIdentity(candidate.ownerEmail) === normalizeIdentity(expectedDescriptor.ownerEmail) &&
    normalizeIdentity(candidate.shareName ?? offerLabel) === normalizeIdentity(expectedDescriptor.shareName)
  );
}

async function waitIncomingShareDescriptor(service, expectedDescriptor, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const existing = await findExistingRecipientShare(service, expectedDescriptor.ownerEmail, expectedDescriptor.shareName);
    if (existing?.share?.remoteDescriptor) {
      return existing.share.remoteDescriptor;
    }
    const { shares } = await service.listIncomingManagedShares();
    const match = shares.find((offer) => {
      if (offer.provider !== 'mega') {
        return false;
      }
      return matchesIncomingDescriptor(offer.remoteDescriptor ?? {}, expectedDescriptor, offer.label);
    });
    if (match?.remoteDescriptor) {
      return match.remoteDescriptor;
    }
    await sleep(1_500);
  }
  throw new Error(
    `No incoming MEGA share offer for ${expectedDescriptor.ownerEmail}:${expectedDescriptor.shareName} within ${timeoutMs}ms`
  );
}

async function waitMirrorFile(filePath, expectedBytes, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await access(filePath);
      const got = await readFile(filePath);
      if (Buffer.compare(got, Buffer.from(expectedBytes)) === 0) {
        return;
      }
    } catch {
      /* not yet */
    }
    await sleep(2_000);
  }
  throw new Error(`Mirror file missing or mismatch: ${filePath}`);
}

async function main() {
  console.error(`[mega-bidir] reusable remote root ${remoteBasePath}`);
  console.error('[mega-bidir] smoke budget', {
    connectAccountTimeoutMs: CONNECT_ACCOUNT_TIMEOUT_MS,
    ownerReadyTimeoutMs: OWNER_READY_TIMEOUT_MS,
    incomingOfferTimeoutMs: INCOMING_OFFER_TIMEOUT_MS,
    recipientReadyTimeoutMs: RECIPIENT_READY_TIMEOUT_MS,
    mirrorFileTimeoutMs: MIRROR_FILE_TIMEOUT_MS,
    syncIntervalMs: SYNC_INTERVAL_MS,
    syncTimeoutMs: SYNC_TIMEOUT_MS,
    cleanupTimeoutMs: CLEANUP_TIMEOUT_MS,
    payloadBytes: PAYLOAD_BYTES,
    remoteShareName,
    writableInviteAccessLevel: WRITABLE_INVITE_ACCESS_LEVEL,
    clearRemoteBase: CLEAR_REMOTE_BASE,
    skipMegaRevoke: SKIP_MEGA_REVOKE,
  });
  await wipeBothIfEnabled();
  await clearRemoteBasePathIfEnabled();

  /** Two simultaneous MEGA sessions often hit API -3 (temporary lock); bring A to `ready` before connecting B. */
  let peerA;
  let peerB;
  try {
    console.error('[mega-bidir] boot peer A (owner email env)…');
    peerA = await createPeerTransport('A');
    await withTimeout('connect peer A', CONNECT_ACCOUNT_TIMEOUT_MS, () =>
      peerA.service.connectAccount({
        provider: 'mega',
        credentials: { email: emailA, password },
        preferred: true,
      })
    );
    const ownerA = await pickOwnerShare(peerA.integrationStatePath);
    console.error('[mega-bidir] wait owner A bootstrap…');
    await waitShareStarted(peerA.service, ownerA.share.id, 'ownerA', OWNER_READY_TIMEOUT_MS);

    console.error('[mega-bidir] cooldown before second MEGA account…');
    await sleep(SECOND_ACCOUNT_COOLDOWN_MS);

    console.error('[mega-bidir] boot peer B…');
    peerB = await createPeerTransport('B');
    await withTimeout('connect peer B', CONNECT_ACCOUNT_TIMEOUT_MS, () =>
      peerB.service.connectAccount({
        provider: 'mega',
        credentials: { email: emailB, password },
        preferred: true,
      })
    );
    const ownerB = await pickOwnerShare(peerB.integrationStatePath);
    console.error('[mega-bidir] wait owner B bootstrap…');
    await waitShareStarted(peerB.service, ownerB.share.id, 'ownerB', OWNER_READY_TIMEOUT_MS);

    console.error('[mega-bidir] cross-invite writable shares…');
    await sleep(PRE_INVITE_DELAY_MS);
    await inviteManagedShareWithMegaRetry(
      peerA.service,
      ownerA.share.id,
      [emailB],
      'A→B',
      WRITABLE_INVITE_ACCESS_LEVEL
    );
    await sleep(POST_INVITE_CONTACT_DELAY_MS);
    await acceptAllMegaContactInvites(peerB.service, 'B after A invite');
    await sleep(BETWEEN_INVITES_DELAY_MS);
    await inviteManagedShareWithMegaRetry(
      peerB.service,
      ownerB.share.id,
      [emailA],
      'B→A',
      WRITABLE_INVITE_ACCESS_LEVEL
    );
    await sleep(POST_INVITE_CONTACT_DELAY_MS);
    await acceptAllMegaContactInvites(peerA.service, 'A after B invite');

    await sleep(POST_INVITE_SETTLE_MS);
    console.error('[mega-bidir] resolve outgoing A→B share descriptor…');
    const descriptorAToB = await waitOutgoingShareDescriptor(
      peerA.service,
      emailA,
      remoteShareName,
      WRITABLE_INVITE_ACCESS_LEVEL,
      INCOMING_OFFER_TIMEOUT_MS
    );
    console.error('[mega-bidir] resolve outgoing B→A share descriptor…');
    const descriptorBToA = await waitOutgoingShareDescriptor(
      peerB.service,
      emailB,
      remoteShareName,
      WRITABLE_INVITE_ACCESS_LEVEL,
      INCOMING_OFFER_TIMEOUT_MS
    );
    console.error('[mega-bidir] wait recipient B to list the incoming A→B share…');
    const incomingDescriptorAToB = await waitIncomingShareDescriptor(
      peerB.service,
      descriptorAToB,
      INCOMING_OFFER_TIMEOUT_MS
    );
    console.error('[mega-bidir] wait recipient A to list the incoming B→A share…');
    const incomingDescriptorBToA = await waitIncomingShareDescriptor(
      peerA.service,
      descriptorBToA,
      INCOMING_OFFER_TIMEOUT_MS
    );

    const existingRecipientB = await findExistingRecipientShare(peerB.service, emailA, descriptorAToB.shareName);
    const existingRecipientA = await findExistingRecipientShare(peerA.service, emailB, descriptorBToA.shareName);
    const mirrorB = existingRecipientB?.share?.localPath ?? await mkdtemp(path.join(tmpdir(), 'nb-mirror-b-reads-a-'));
    const mirrorA = existingRecipientA?.share?.localPath ?? await mkdtemp(path.join(tmpdir(), 'nb-mirror-a-reads-b-'));

    const acceptedB = existingRecipientB
      ? { share: existingRecipientB.share }
      : await withTimeout('accept share B←A', CONNECT_ACCOUNT_TIMEOUT_MS, () =>
          peerB.service.acceptManagedShare({
            provider: 'mega',
            accountId: ownerB.share.accountId,
            label: descriptorAToB.shareName,
            localPath: mirrorB,
            remoteDescriptor: incomingDescriptorAToB,
          })
        );
    const acceptedA = existingRecipientA
      ? { share: existingRecipientA.share }
      : await withTimeout('accept share A←B', CONNECT_ACCOUNT_TIMEOUT_MS, () =>
          peerA.service.acceptManagedShare({
            provider: 'mega',
            accountId: ownerA.share.accountId,
            label: descriptorBToA.shareName,
            localPath: mirrorA,
            remoteDescriptor: incomingDescriptorBToA,
          })
        );

    console.error('[mega-bidir] wait writable incoming shares ready…');
    await Promise.all([
      waitShareReady(peerB.service, acceptedB.share.id, 'recipient B (A→B)', RECIPIENT_READY_TIMEOUT_MS),
      waitShareReady(peerA.service, acceptedA.share.id, 'recipient A (B→A)', RECIPIENT_READY_TIMEOUT_MS),
    ]);

    const bytesOwnerAToRecipientB = createPayload('A owner→B recipient');
    const relOwnerAToRecipientB = `blocks/${sha256Hex(bytesOwnerAToRecipientB)}.bin`;
    await mkdir(path.join(ownerA.share.localPath, 'blocks'), { recursive: true });
    await writeFile(path.join(ownerA.share.localPath, relOwnerAToRecipientB), bytesOwnerAToRecipientB);
    console.error('[mega-bidir] A owner force-push → expect B recipient copy…');
    await withTimeout('force upload A→B', CONNECT_ACCOUNT_TIMEOUT_MS, () =>
      peerA.service.forceManagedShareUpload(ownerA.share.id, relOwnerAToRecipientB)
    );
    await withTimeout('recipient sync B←A', CONNECT_ACCOUNT_TIMEOUT_MS, () =>
      syncRecipientShareNow(peerB, acceptedB.share.id, 'recipient B (A→B)')
    );
    await waitMirrorFile(
      path.join(mirrorB, relOwnerAToRecipientB),
      bytesOwnerAToRecipientB,
      MIRROR_FILE_TIMEOUT_MS
    );

    const bytesOwnerBToRecipientA = createPayload('B owner→A recipient');
    const relOwnerBToRecipientA = `blocks/${sha256Hex(bytesOwnerBToRecipientA)}.bin`;
    await mkdir(path.join(ownerB.share.localPath, 'blocks'), { recursive: true });
    await writeFile(path.join(ownerB.share.localPath, relOwnerBToRecipientA), bytesOwnerBToRecipientA);
    console.error('[mega-bidir] B owner force-push → expect A recipient copy…');
    await withTimeout('force upload B→A', CONNECT_ACCOUNT_TIMEOUT_MS, () =>
      peerB.service.forceManagedShareUpload(ownerB.share.id, relOwnerBToRecipientA)
    );
    await withTimeout('recipient sync A←B', CONNECT_ACCOUNT_TIMEOUT_MS, () =>
      syncRecipientShareNow(peerA, acceptedA.share.id, 'recipient A (B→A)')
    );
    await waitMirrorFile(
      path.join(mirrorA, relOwnerBToRecipientA),
      bytesOwnerBToRecipientA,
      MIRROR_FILE_TIMEOUT_MS
    );

    console.error('[mega-bidir] OK writable bidirectional MEGA shared-folder sync via transport (no HTTP server).');
  } finally {
    await Promise.allSettled([cleanupPeer(peerA, 'peer A'), cleanupPeer(peerB, 'peer B')]);
  }
}

main().catch((err) => {
  console.error('[mega-bidir] FAILED:', err);
  process.exit(1);
});
