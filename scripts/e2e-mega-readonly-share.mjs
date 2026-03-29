#!/usr/bin/env node
/**
 * End-to-end: read-only MEGA share sync.
 *
 * Peer A (owner) shares a folder with peer B (recipient, read-only).
 * A uploads a file, B should mirror it. Then A uploads a second file,
 * and B should mirror that too — proving real-time SC-channel updates.
 *
 * Much lighter on the MEGA API than the bidirectional test: only one
 * owner sync loop, one invite direction, no writable incoming logic.
 *
 * Requires: `yarn build`
 * Env: `.env.e2e` (optional auto-load), plus:
 *   - NEARBYTES_E2E_MEGA_OWNER_EMAIL    (user A)
 *   - NEARBYTES_E2E_MEGA_RECIPIENT_EMAIL (user B)
 *   - NEARBYTES_E2E_MEGA_PASSWORD
 * Optional:
 *   - NEARBYTES_E2E_SKIP_MEGA_WIPE=1
 *
 * Usage: `yarn e2e:mega-readonly-share`
 */

import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── env file loading ──
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
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

const emailA = process.env.NEARBYTES_E2E_MEGA_OWNER_EMAIL?.trim();
const emailB = process.env.NEARBYTES_E2E_MEGA_RECIPIENT_EMAIL?.trim();
const password = process.env.NEARBYTES_E2E_MEGA_PASSWORD ?? '';
const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const remoteBasePath = `/nearbytes-e2e-ro-${runId}`;
const remoteShareName = path.posix.basename(remoteBasePath);
process.env.NEARBYTES_MEGA_REMOTE_BASE = remoteBasePath;

if (!emailA || !emailB || !password) {
  console.error('Missing env: NEARBYTES_E2E_MEGA_OWNER_EMAIL, NEARBYTES_E2E_MEGA_RECIPIENT_EMAIL, NEARBYTES_E2E_MEGA_PASSWORD');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readPositiveIntEnv(name, fallback) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer.`);
  return parsed;
}

const CONNECT_TIMEOUT_MS = readPositiveIntEnv('NEARBYTES_E2E_MEGA_CONNECT_TIMEOUT_MS', 20_000);
const OWNER_READY_TIMEOUT_MS = readPositiveIntEnv('NEARBYTES_E2E_MEGA_OWNER_READY_TIMEOUT_MS', 60_000);
const INCOMING_OFFER_TIMEOUT_MS = readPositiveIntEnv('NEARBYTES_E2E_MEGA_INCOMING_OFFER_TIMEOUT_MS', 60_000);
const RECIPIENT_READY_TIMEOUT_MS = readPositiveIntEnv('NEARBYTES_E2E_MEGA_RECIPIENT_READY_TIMEOUT_MS', 60_000);
const MIRROR_FILE_TIMEOUT_MS = readPositiveIntEnv('NEARBYTES_E2E_MEGA_MIRROR_FILE_TIMEOUT_MS', 60_000);
const SYNC_INTERVAL_MS = readPositiveIntEnv('NEARBYTES_E2E_MEGA_SYNC_INTERVAL_MS', 60_000);
const SYNC_TIMEOUT_MS = readPositiveIntEnv('NEARBYTES_E2E_MEGA_SYNC_TIMEOUT_MS', 60_000);
const UPLOAD_TIMEOUT_MS = readPositiveIntEnv('NEARBYTES_E2E_MEGA_UPLOAD_TIMEOUT_MS', 45_000);
const CLEANUP_TIMEOUT_MS = readPositiveIntEnv('NEARBYTES_E2E_MEGA_CLEANUP_TIMEOUT_MS', 5_000);
const PAYLOAD_BYTES = readPositiveIntEnv('NEARBYTES_E2E_MEGA_PAYLOAD_BYTES', 1024);
const SKIP_MEGA_WIPE = process.env.NEARBYTES_E2E_SKIP_MEGA_WIPE?.trim() === '1';
const SECOND_ACCOUNT_COOLDOWN_MS = readPositiveIntEnv('NEARBYTES_E2E_MEGA_SECOND_ACCOUNT_COOLDOWN_MS', 2_000);

function sha256Hex(buf) { return createHash('sha256').update(buf).digest('hex'); }

async function withTimeout(label, timeoutMs, operation) {
  let timer;
  try {
    return await Promise.race([
      operation(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out within ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally { clearTimeout(timer); }
}

function createPayload(tag) {
  const prefix = Buffer.from(`${tag}:${Date.now()}\n`, 'utf8');
  if (prefix.length >= PAYLOAD_BYTES) return prefix.subarray(0, PAYLOAD_BYTES);
  return Buffer.concat([prefix, Buffer.alloc(PAYLOAD_BYTES - prefix.length, 0x58)]);
}

function isMegaTransientLockError(err) {
  if (typeof err?.code === 'number' && err.code === -3) return true;
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return /MEGA API error -3\b/u.test(msg);
}

// ── peer construction ──

function createRootsConfig(mainRoot) {
  return {
    version: 2,
    sources: [{
      id: 'src-main', provider: 'local', path: mainRoot, enabled: true, writable: true,
      reservePercent: 10, opportunisticPolicy: 'drop-older-blocks',
    }],
    defaultVolume: {
      destinations: [{
        sourceId: 'src-main', enabled: true, storeEvents: true, storeBlocks: true,
        copySourceBlocks: true, reservePercent: 10, fullPolicy: 'block-writes',
      }],
    },
    volumes: [],
  };
}

async function createPeer(label) {
  const base = await mkdtemp(path.join(tmpdir(), `nearbytes-mega-ro-${label}-`));
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
    mega: { remoteBasePath, syncIntervalMs: SYNC_INTERVAL_MS, syncTimeoutMs: SYNC_TIMEOUT_MS },
    logger: {
      log: (...args) => console.error(`[ro-share][${label}]`, ...args),
      warn: (...args) => console.error(`[ro-share][${label}] WARN`, ...args),
    },
  });
  const service = new ManagedShareService({
    storage, rootsConfigPath, integrationStatePath,
    adapters: [new MegaTransportAdapter(runtime)],
    readMaintenanceMode: 'background',
  });
  return { base, service, mainRoot, integrationStatePath };
}

async function cleanupPeer(peer, label) {
  if (!peer) return;
  await withTimeout(`${label} dispose`, CLEANUP_TIMEOUT_MS, () => peer.service.dispose()).catch(() => {});
  await withTimeout(`${label} rm`, CLEANUP_TIMEOUT_MS, () => rm(peer.base, { recursive: true, force: true })).catch(() => {});
}

async function pickOwnerShare(integrationStatePath) {
  const state = JSON.parse(await readFile(integrationStatePath, 'utf8'));
  const owner = state.managedShares?.find?.((s) => s?.provider === 'mega' && s?.role === 'owner');
  if (!owner) throw new Error('No MEGA owner managed share after connect');
  return owner;
}

async function waitShareStarted(service, shareId, label, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = (await service.getManagedShareState(shareId)).state?.status;
    if (status === 'ready' || status === 'syncing') return;
    await sleep(1_000);
  }
  const status = (await service.getManagedShareState(shareId)).state?.status;
  throw new Error(`${label}: share ${shareId} not started within ${timeoutMs}ms (last: ${status})`);
}

async function waitShareReady(service, shareId, label, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const st = await service.getManagedShareState(shareId);
    if (st.state?.status === 'ready') return;
    await sleep(1_000);
  }
  const status = (await service.getManagedShareState(shareId)).state?.status;
  throw new Error(`${label}: share ${shareId} not ready within ${timeoutMs}ms (last: ${status})`);
}

async function inviteWithRetry(service, shareId, emails, label) {
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      await service.inviteManagedShare(shareId, emails, 'read');
      return;
    } catch (err) {
      if (isMegaTransientLockError(err) && attempt < 11) {
        const delay = Math.min(25_000, 2_000 + attempt * 2_000);
        console.error(`[ro-share] ${label}: invite -3, backoff ${delay}ms (${attempt + 1}/12)`);
        await sleep(delay);
        continue;
      }
      throw err;
    }
  }
}

async function acceptMegaContactInvites(service, label) {
  try {
    const { invites } = await service.listIncomingProviderContactInvites();
    for (const inv of invites ?? []) {
      if (inv.provider !== 'mega') continue;
      console.error(`[ro-share] ${label}: accept contact invite ${inv.id}`);
      await service.acceptIncomingProviderContactInvite('mega', inv.accountId, inv.id);
    }
  } catch (err) {
    console.error(`[ro-share] ${label}: contact invite step`, err?.message ?? err);
  }
}

async function waitIncomingOffer(service, ownerEmail, shareName, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { shares } = await service.listIncomingManagedShares();
    const match = shares.find((o) =>
      o.provider === 'mega' &&
      o.remoteDescriptor?.ownerEmail === ownerEmail &&
      o.remoteDescriptor?.shareName === shareName
    );
    if (match?.remoteDescriptor) return match.remoteDescriptor;
    await sleep(2_000);
  }
  throw new Error(`No incoming MEGA share offer for ${ownerEmail}:${shareName} within ${timeoutMs}ms`);
}

async function waitMirrorFile(filePath, expectedBytes, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await access(filePath);
      const got = await readFile(filePath);
      if (Buffer.compare(got, Buffer.from(expectedBytes)) === 0) return;
    } catch { /* not yet */ }
    await sleep(2_000);
  }
  throw new Error(`Mirror file missing or mismatch: ${filePath}`);
}

// ── main ──

async function main() {
  console.error(`[ro-share] remote root: ${remoteBasePath}`);
  console.error('[ro-share] config', {
    connectTimeoutMs: CONNECT_TIMEOUT_MS,
    ownerReadyTimeoutMs: OWNER_READY_TIMEOUT_MS,
    incomingOfferTimeoutMs: INCOMING_OFFER_TIMEOUT_MS,
    recipientReadyTimeoutMs: RECIPIENT_READY_TIMEOUT_MS,
    mirrorFileTimeoutMs: MIRROR_FILE_TIMEOUT_MS,
    syncIntervalMs: SYNC_INTERVAL_MS,
    payloadBytes: PAYLOAD_BYTES,
    remoteShareName,
    skipMegaWipe: SKIP_MEGA_WIPE,
  });

  if (!SKIP_MEGA_WIPE) {
    process.env.NEARBYTES_ALLOW_DESTRUCTIVE_MEGA_E2E_WIPE = '1';
    const { wipeMegaCloudDriveContentsForE2e } = await import('../dist/integrations/mega.js');
    for (const email of [emailA, emailB]) {
      console.error(`[ro-share] wipe ${email}…`);
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 5 * 60_000);
      try {
        const { deletedNodeCount } = await wipeMegaCloudDriveContentsForE2e({ email, password, signal: ac.signal });
        console.error(`[ro-share] wiped ${deletedNodeCount} node(s) for ${email}`);
      } finally { clearTimeout(t); }
    }
  } else {
    console.error('[ro-share] skip wipe enabled');
  }

  let peerA, peerB;
  try {
    // ── 1. Boot owner A ──
    console.error('[ro-share] 1/8 boot peer A (owner)…');
    peerA = await createPeer('A');
    await withTimeout('connect A', CONNECT_TIMEOUT_MS, () =>
      peerA.service.connectAccount({ provider: 'mega', credentials: { email: emailA, password }, preferred: true })
    );
    const ownerShare = await pickOwnerShare(peerA.integrationStatePath);
    console.error('[ro-share] 2/8 wait owner A ready…');
    await waitShareReady(peerA.service, ownerShare.id, 'ownerA', OWNER_READY_TIMEOUT_MS);

    // ── 2. Upload first test file as owner A ──
    console.error('[ro-share] 3/8 upload first file as owner A…');
    const payload1 = createPayload('file-1');
    const rel1 = `blocks/${sha256Hex(payload1)}.bin`;
    await mkdir(path.join(ownerShare.localPath, 'blocks'), { recursive: true });
    await writeFile(path.join(ownerShare.localPath, rel1), payload1);
    await withTimeout('force upload file-1', UPLOAD_TIMEOUT_MS, () =>
      peerA.service.forceManagedShareUpload(ownerShare.id, rel1)
    );
    console.error(`[ro-share]    uploaded ${rel1}`);

    // ── 3. Boot peer B, cooldown first ──
    console.error('[ro-share] 4/8 boot peer B (recipient)…');
    await sleep(SECOND_ACCOUNT_COOLDOWN_MS);
    peerB = await createPeer('B');
    await withTimeout('connect B', CONNECT_TIMEOUT_MS, () =>
      peerB.service.connectAccount({ provider: 'mega', credentials: { email: emailB, password }, preferred: true })
    );

    // ── 4. Invite B with read-only access ──
    console.error('[ro-share] 5/8 invite B (read-only)…');
    await sleep(1_000);
    await inviteWithRetry(peerA.service, ownerShare.id, [emailB], 'A→B');
    await sleep(1_000);
    await acceptMegaContactInvites(peerB.service, 'B');
    await sleep(3_000);

    // ── 5. B accepts the incoming share ──
    console.error('[ro-share] 6/8 B waits for incoming offer…');
    const descriptor = await waitIncomingOffer(peerB.service, emailA, remoteShareName, INCOMING_OFFER_TIMEOUT_MS);
    console.error('[ro-share]    incoming descriptor:', descriptor);
    const bOwnerShare = await pickOwnerShare(peerB.integrationStatePath);
    const mirrorDir = await mkdtemp(path.join(tmpdir(), 'nb-ro-mirror-'));
    const accepted = await withTimeout('accept share B←A', CONNECT_TIMEOUT_MS, () =>
      peerB.service.acceptManagedShare({
        provider: 'mega',
        accountId: bOwnerShare.accountId,
        label: remoteShareName,
        localPath: mirrorDir,
        remoteDescriptor: descriptor,
      })
    );
    console.error(`[ro-share]    accepted share ${accepted.share.id}, mirror: ${mirrorDir}`);

    // ── 6. Wait for B mirror to be ready and verify file-1 ──
    console.error('[ro-share] 7/8 wait mirror ready + verify file-1…');
    await waitShareReady(peerB.service, accepted.share.id, 'recipientB', RECIPIENT_READY_TIMEOUT_MS);
    await waitMirrorFile(path.join(mirrorDir, rel1), payload1, MIRROR_FILE_TIMEOUT_MS);
    console.error(`[ro-share]    ✓ file-1 mirrored to B`);

    // ── 7. Upload a second file as owner A, verify B picks it up (real-time) ──
    console.error('[ro-share] 8/8 upload file-2 as A, verify B mirrors it…');
    const payload2 = createPayload('file-2');
    const rel2 = `blocks/${sha256Hex(payload2)}.bin`;
    await writeFile(path.join(ownerShare.localPath, rel2), payload2);
    await withTimeout('force upload file-2', UPLOAD_TIMEOUT_MS, () =>
      peerA.service.forceManagedShareUpload(ownerShare.id, rel2)
    );
    console.error(`[ro-share]    uploaded ${rel2}`);
    await waitMirrorFile(path.join(mirrorDir, rel2), payload2, MIRROR_FILE_TIMEOUT_MS);
    console.error(`[ro-share]    ✓ file-2 mirrored to B`);

    console.error('[ro-share] ✓ READ-ONLY SHARE SYNC OK — owner uploads, recipient mirrors in real-time.');
  } finally {
    await Promise.allSettled([cleanupPeer(peerA, 'A'), cleanupPeer(peerB, 'B')]);
  }
}

main().catch((err) => {
  console.error('[ro-share] FAILED:', err);
  process.exit(1);
});
