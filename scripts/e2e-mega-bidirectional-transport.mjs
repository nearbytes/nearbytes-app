#!/usr/bin/env node
/**
 * End-to-end: MEGA as transport only (no Nearbytes HTTP server).
 * Two isolated peers (separate storage + integration state); each connects one MEGA account,
 * cross-invites read-only shares, then verifies owner→recipient mirror in BOTH directions.
 *
 * Requires: `yarn build`
 * Env: `.env.e2e` (optional auto-load), plus:
 *   - NEARBYTES_E2E_MEGA_OWNER_EMAIL (user A)
 *   - NEARBYTES_E2E_MEGA_RECIPIENT_EMAIL (user B)
 *   - NEARBYTES_E2E_MEGA_PASSWORD
 * Optional:
 *   - NEARBYTES_E2E_SKIP_MEGA_WIPE=1
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
const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const remoteBasePath = `/nearbytes-e2e-${runId}`;
process.env.NEARBYTES_MEGA_REMOTE_BASE = remoteBasePath;

if (!emailA || !emailB || !password) {
  console.error(
    'Missing env: NEARBYTES_E2E_MEGA_OWNER_EMAIL, NEARBYTES_E2E_MEGA_RECIPIENT_EMAIL, NEARBYTES_E2E_MEGA_PASSWORD'
  );
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WIPE_TIMEOUT_MS = 20 * 60 * 1000;

function sha256Hex(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

async function wipeBothIfEnabled() {
  if (process.env.NEARBYTES_E2E_SKIP_MEGA_WIPE?.trim() === '1') {
    return;
  }
  process.env.NEARBYTES_ALLOW_DESTRUCTIVE_MEGA_E2E_WIPE = '1';
  const { wipeMegaCloudDriveContentsForE2e } = await import('../dist/integrations/mega.js');
  for (const email of [emailA, emailB]) {
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
      /** Long interval reduces overlap with first full mirror while E2E polls `getManagedShareState`. */
      syncIntervalMs: 120_000,
      /** Default 180s is too tight when pulling a large existing Cloud drive /nearbytes tree. */
      syncTimeoutMs: 900_000,
    },
    logger: {
      log: (...args) => console.error(`[mega-bidir][${peerLabel}]`, ...args),
      warn: (...args) => console.error(`[mega-bidir][${peerLabel}] WARN`, ...args),
    },
  });
  const service = new ManagedShareService({
    storage,
    rootsConfigPath,
    integrationStatePath: path.join(base, 'integrations.json'),
    adapters: [new MegaTransportAdapter(runtime)],
    readMaintenanceMode: 'inline',
  });
  return { base, service, mainRoot };
}

async function waitShareReady(service, shareId, label, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const st = await service.getManagedShareState(shareId);
    if (st.state?.status === 'ready') {
      return;
    }
    await sleep(2_000);
  }
  throw new Error(`${label}: share ${shareId} not ready within ${timeoutMs}ms (last ${(await service.getManagedShareState(shareId)).state?.status})`);
}

async function pickOwnerShare(service) {
  const { shares } = await service.listManagedShares({ fast: true });
  const owner = shares.find((s) => s.share.provider === 'mega' && s.share.role === 'owner');
  if (!owner) {
    throw new Error('No MEGA owner managed share after connect');
  }
  return owner;
}

function offerFromOwner(offers, ownerEmail) {
  const want = ownerEmail.toLowerCase();
  return offers.find((o) => {
    const oe = o.remoteDescriptor?.ownerEmail;
    return typeof oe === 'string' && oe.toLowerCase() === want;
  });
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

async function pollIncomingFromOwner(service, ownerEmail, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await acceptAllMegaContactInvites(service, 'incoming-poll');
    const { shares } = await service.listIncomingManagedShares();
    const offer = offerFromOwner(shares ?? [], ownerEmail);
    if (offer) {
      return offer;
    }
    await sleep(3_000);
  }
  throw new Error(`No incoming MEGA offer from ${ownerEmail} within ${timeoutMs}ms`);
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
    await sleep(4_000);
  }
  throw new Error(`Mirror file missing or mismatch: ${filePath}`);
}

async function main() {
  console.error(`[mega-bidir] isolated remote root ${remoteBasePath}`);

  /** Two simultaneous MEGA sessions often hit API -3 (temporary lock); bring A to `ready` before connecting B. */
  let peerA;
  let peerB;
  try {
    console.error('[mega-bidir] boot peer A (owner email env)…');
    peerA = await createPeerTransport('A');
    await peerA.service.connectAccount({
      provider: 'mega',
      credentials: { email: emailA, password },
      preferred: true,
    });
    const ownerA = await pickOwnerShare(peerA.service);
    console.error('[mega-bidir] wait owner A ready…');
    await waitShareReady(peerA.service, ownerA.share.id, 'ownerA', 960_000);

    console.error('[mega-bidir] cooldown before second MEGA account…');
    await sleep(8_000);

    console.error('[mega-bidir] boot peer B…');
    peerB = await createPeerTransport('B');
    await peerB.service.connectAccount({
      provider: 'mega',
      credentials: { email: emailB, password },
      preferred: true,
    });
    const ownerB = await pickOwnerShare(peerB.service);
    console.error('[mega-bidir] wait owner B ready…');
    await waitShareReady(peerB.service, ownerB.share.id, 'ownerB', 960_000);

    console.error('[mega-bidir] cross-invite readonly shares…');
    await peerA.service.inviteManagedShare(ownerA.share.id, [emailB]);
    await sleep(5_000);
    await acceptAllMegaContactInvites(peerB.service, 'B after A invite');
    await peerB.service.inviteManagedShare(ownerB.share.id, [emailA]);
    await sleep(5_000);
    await acceptAllMegaContactInvites(peerA.service, 'A after B invite');

    const offerB = await pollIncomingFromOwner(peerB.service, emailA, 300_000);
    const offerA = await pollIncomingFromOwner(peerA.service, emailB, 300_000);

    const mirrorB = await mkdtemp(path.join(tmpdir(), 'nb-mirror-b-reads-a-'));
    const mirrorA = await mkdtemp(path.join(tmpdir(), 'nb-mirror-a-reads-b-'));

    const acceptedB = await peerB.service.acceptManagedShare({
      provider: 'mega',
      accountId: offerB.accountId,
      label: offerB.label,
      localPath: mirrorB,
      remoteDescriptor: offerB.remoteDescriptor,
    });
    const acceptedA = await peerA.service.acceptManagedShare({
      provider: 'mega',
      accountId: offerA.accountId,
      label: offerA.label,
      localPath: mirrorA,
      remoteDescriptor: offerA.remoteDescriptor,
    });

    console.error('[mega-bidir] wait readonly mirrors ready…');
    await waitShareReady(peerB.service, acceptedB.share.id, 'recipient B (A→B)', 960_000);
    await waitShareReady(peerA.service, acceptedA.share.id, 'recipient A (B→A)', 960_000);

    const bytesAToB = new TextEncoder().encode(`bidir-a-to-b-${Date.now()}\n`);
    const relAToB = `blocks/${sha256Hex(bytesAToB)}.bin`;
    await mkdir(path.join(ownerA.share.localPath, 'blocks'), { recursive: true });
    await writeFile(path.join(ownerA.share.localPath, relAToB), bytesAToB);
    console.error('[mega-bidir] A force-push → expect B mirror…');
    await peerA.service.forceManagedShareUpload(ownerA.share.id, relAToB);
    await waitMirrorFile(path.join(mirrorB, relAToB), bytesAToB, 300_000);

    const bytesBToA = new TextEncoder().encode(`bidir-b-to-a-${Date.now()}\n`);
    const relBToA = `blocks/${sha256Hex(bytesBToA)}.bin`;
    await mkdir(path.join(ownerB.share.localPath, 'blocks'), { recursive: true });
    await writeFile(path.join(ownerB.share.localPath, relBToA), bytesBToA);
    console.error('[mega-bidir] B force-push → expect A mirror…');
    await peerB.service.forceManagedShareUpload(ownerB.share.id, relBToA);
    await waitMirrorFile(path.join(mirrorA, relBToA), bytesBToA, 300_000);

    console.error('[mega-bidir] OK bidirectional readonly mirror via MEGA transport (no HTTP server).');
  } finally {
    await peerA?.service?.dispose?.().catch(() => {});
    await peerB?.service?.dispose?.().catch(() => {});
    await rm(peerA?.base, { recursive: true, force: true }).catch(() => {});
    await rm(peerB?.base, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((err) => {
  console.error('[mega-bidir] FAILED:', err);
  process.exit(1);
});
