import { existsSync, readFileSync } from 'fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import type { RootsConfig } from '../../config/roots.js';
import { MultiRootStorageBackend } from '../../storage/multiRoot.js';
import { ManagedShareService } from '../managedShares.js';
import { createManagedShareNodeSupport } from '../managedSharesNodeSupport.js';
import { MegaTransportAdapter } from '../mega.js';
import { createIntegrationRuntime } from '../runtime.js';
import { JsonFileSecretStore } from '../secretStore.js';
import type { ManagedShare, ManagedShareSummary } from '../types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, '../../..');
const envE2ePath = path.join(workspaceRoot, '.env.e2e');

for (const rawLine of existsSync(envE2ePath) ? readFileSync(envE2ePath, 'utf8').split(/\r?\n/u) : []) {
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

const emailA = process.env.NEARBYTES_E2E_MEGA_OWNER_EMAIL?.trim() ?? '';
const emailB = process.env.NEARBYTES_E2E_MEGA_RECIPIENT_EMAIL?.trim() ?? '';
const password = process.env.NEARBYTES_E2E_MEGA_PASSWORD?.trim() ?? '';

function readPositiveIntEnv(name: string, fallback: number): number {
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

function readMegaInviteAccessLevelEnv(
  name: string,
  fallback: 'read' | 'read/write' | 'full access'
): 'read' | 'read/write' | 'full access' {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) {
    return fallback;
  }
  if (raw === 'read' || raw === 'read/write' || raw === 'full access') {
    return raw;
  }
  throw new Error(`${name} must be one of: read, read/write, full access.`);
}

const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const remoteBasePath = `/nearbytes-live-descriptor-${runId}`;
const remoteShareName = path.posix.basename(remoteBasePath);

const CONNECT_TIMEOUT_MS = readPositiveIntEnv('NEARBYTES_E2E_MEGA_CONNECT_TIMEOUT_MS', 120_000);
const OWNER_READY_TIMEOUT_MS = readPositiveIntEnv('NEARBYTES_E2E_MEGA_OWNER_READY_TIMEOUT_MS', 120_000);
const DESCRIPTOR_TIMEOUT_MS = readPositiveIntEnv('NEARBYTES_E2E_MEGA_DESCRIPTOR_TIMEOUT_MS', 90_000);
const SERVICE_CALL_TIMEOUT_MS = readPositiveIntEnv('NEARBYTES_E2E_MEGA_SERVICE_CALL_TIMEOUT_MS', 10_000);
const INVITE_TIMEOUT_MS = readPositiveIntEnv('NEARBYTES_E2E_MEGA_INVITE_TIMEOUT_MS', 120_000);
const CONTACT_INVITE_TIMEOUT_MS = readPositiveIntEnv('NEARBYTES_E2E_MEGA_CONTACT_INVITE_TIMEOUT_MS', 30_000);
const INVENTORY_TIMEOUT_MS = readPositiveIntEnv('NEARBYTES_E2E_MEGA_INVENTORY_TIMEOUT_MS', 120_000);
const CLEANUP_TIMEOUT_MS = readPositiveIntEnv('NEARBYTES_E2E_MEGA_CLEANUP_TIMEOUT_MS', 5_000);
const SECOND_ACCOUNT_COOLDOWN_MS = readPositiveIntEnv('NEARBYTES_E2E_MEGA_SECOND_ACCOUNT_COOLDOWN_MS', 2_000);
const PRE_INVITE_DELAY_MS = readPositiveIntEnv('NEARBYTES_E2E_MEGA_PRE_INVITE_DELAY_MS', 1_000);
const POST_CONTACT_SETTLE_MS = readPositiveIntEnv('NEARBYTES_E2E_MEGA_POST_CONTACT_SETTLE_MS', 2_000);
const SYNC_INTERVAL_MS = readPositiveIntEnv('NEARBYTES_E2E_MEGA_SYNC_INTERVAL_MS', 5 * 60_000);
const SYNC_TIMEOUT_MS = readPositiveIntEnv('NEARBYTES_E2E_MEGA_SYNC_TIMEOUT_MS', 60_000);
const OVERALL_TIMEOUT_MS = readPositiveIntEnv('NEARBYTES_E2E_MEGA_OUTGOING_DESCRIPTOR_OVERALL_TIMEOUT_MS', 5 * 60_000);
const INVITE_ACCESS_LEVEL = readMegaInviteAccessLevelEnv('NEARBYTES_E2E_MEGA_SHARE_ACCESS_LEVEL', 'read/write');

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type LivePeer = {
  label: 'A' | 'B';
  base: string;
  mainRoot: string;
  integrationStatePath: string;
  secretsPath: string;
  service: ManagedShareService;
};

type ChannelDescriptor = {
  remotePath: string;
  shareName: string;
  ownerEmail: string;
  accessLevel: 'read' | 'read/write' | 'full access';
  shareHandle: string;
  rootHandle: string;
};

function createRootsConfig(mainRoot: string): RootsConfig {
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

async function withTimeout<T>(label: string, timeoutMs: number, operation: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out within ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function createPeer(label: 'A' | 'B'): Promise<LivePeer> {
  const base = await mkdtemp(path.join(tmpdir(), `nearbytes-mega-outgoing-${label}-`));
  const mainRoot = path.join(base, 'main-root');
  const rootsConfigPath = path.join(base, 'roots.json');
  const integrationStatePath = path.join(base, 'integrations.json');
  const secretsPath = path.join(base, 'integration-secrets.json');
  await mkdir(mainRoot, { recursive: true });
  await writeFile(rootsConfigPath, `${JSON.stringify(createRootsConfig(mainRoot), null, 2)}\n`, 'utf8');

  const storage = new MultiRootStorageBackend(createRootsConfig(mainRoot));
  const runtime = createIntegrationRuntime({
    secretStore: new JsonFileSecretStore({ filePath: secretsPath }),
    mega: {
      remoteBasePath,
      syncIntervalMs: SYNC_INTERVAL_MS,
      syncTimeoutMs: SYNC_TIMEOUT_MS,
    },
    logger: {
      log: (...args: unknown[]) => console.error(`[mega-descriptor][${label}]`, ...args),
      warn: (...args: unknown[]) => console.error(`[mega-descriptor][${label}] WARN`, ...args),
    },
  });
  const service = new ManagedShareService({
    storage,
    rootsConfigPath,
    ...createManagedShareNodeSupport({ rootsConfigPath, integrationStatePath }),
    integrationRuntime: runtime,
    mirrorRoot: mainRoot,
    adapters: [new MegaTransportAdapter(runtime)],
    readMaintenanceMode: 'background',
  });
  return { label, base, mainRoot, integrationStatePath, secretsPath, service };
}

async function cleanupPeer(peer: LivePeer | undefined): Promise<void> {
  if (!peer) {
    return;
  }
  await withTimeout(`dispose ${peer.label}`, CLEANUP_TIMEOUT_MS, () => peer.service.dispose()).catch(() => {});
  await withTimeout(`rm ${peer.label}`, CLEANUP_TIMEOUT_MS, () => rm(peer.base, { recursive: true, force: true })).catch(() => {});
}

async function serviceCall<T>(label: string, operation: () => Promise<T>): Promise<T> {
  return await withTimeout(label, SERVICE_CALL_TIMEOUT_MS, operation);
}

async function readPersistedManagedShares(peer: LivePeer): Promise<ManagedShare[]> {
  const state = JSON.parse(await readFile(peer.integrationStatePath, 'utf8')) as { managedShares?: ManagedShare[] };
  return Array.isArray(state.managedShares) ? state.managedShares : [];
}

async function pickOwnerShare(peer: LivePeer): Promise<ManagedShare> {
  const owner = (await readPersistedManagedShares(peer)).find(
    (share) => share.provider === 'mega' && share.role === 'owner'
  );
  if (!owner) {
    throw new Error(`Peer ${peer.label} has no persisted MEGA owner share.`);
  }
  return owner;
}

async function ensureConnectedPeer(
  peer: LivePeer,
  email: string
): Promise<{ status: string; accountId?: string; email?: string }> {
  const connected = await withTimeout(`connect peer ${peer.label}`, CONNECT_TIMEOUT_MS, () =>
    peer.service.connectAccount({
      provider: 'mega',
      credentials: { email, password },
      preferred: true,
    })
  );
  return {
    status: connected.status,
    accountId: connected.account?.id,
    email: connected.account?.email,
  };
}

function formatShareState(summary: ManagedShareSummary): string {
  return `${summary.share.role}:${summary.state.status}:${summary.state.detail}`;
}

function isTerminalShareState(summary: ManagedShareSummary): boolean {
  return (
    summary.state.status === 'attention' ||
    summary.state.status === 'needs-auth' ||
    summary.state.status === 'unsupported'
  );
}

async function assertMegaAccountHealthy(peer: LivePeer): Promise<void> {
  const accounts = await serviceCall(`list accounts ${peer.label}`, () => peer.service.listAccounts({ fast: true }));
  const megaAccount = accounts.accounts.find((account) => account.provider === 'mega');
  if (!megaAccount) {
    throw new Error(`Peer ${peer.label} has no MEGA account in managed share state.`);
  }
  if (megaAccount.state === 'attention' || megaAccount.state === 'unsupported') {
    throw new Error(
      `Peer ${peer.label} MEGA account entered ${megaAccount.state}: ${megaAccount.detail || 'no detail provided.'}`
    );
  }
}

async function waitForShareReady(peer: LivePeer, shareId: string, timeoutMs: number): Promise<ManagedShareSummary> {
  const deadline = Date.now() + timeoutMs;
  let lastSummary: ManagedShareSummary | undefined;
  while (Date.now() < deadline) {
    const summary = await serviceCall(`get share state ${peer.label}:${shareId}`, () =>
      peer.service.getManagedShareState(shareId)
    );
    lastSummary = summary;
    if (summary.state.status === 'ready') {
      return summary;
    }
    if (isTerminalShareState(summary)) {
      throw new Error(`Peer ${peer.label} share ${shareId} failed before ready: ${formatShareState(summary)}`);
    }
    await assertMegaAccountHealthy(peer);
    await sleep(1_000);
  }
  throw new Error(
    `Peer ${peer.label} share ${shareId} was not ready within ${timeoutMs}ms${
      lastSummary ? ` (last ${formatShareState(lastSummary)})` : ''
    }`
  );
}

async function inviteManagedShareWithRetry(peer: LivePeer, shareId: string, emails: readonly string[]): Promise<void> {
  const maxAttempts = 10;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      await withTimeout(`invite from ${peer.label}`, INVITE_TIMEOUT_MS, () =>
        peer.service.inviteManagedShare(shareId, emails, INVITE_ACCESS_LEVEL)
      );
      return;
    } catch (error) {
      const message = safeErrorMessage(error);
      if (/MEGA API error -3\b/u.test(message) && attempt + 1 < maxAttempts) {
        const delay = Math.min(20_000, 2_000 + attempt * 2_000);
        console.error(`[mega-descriptor] peer ${peer.label} invite retry after -3 in ${delay}ms (${attempt + 1}/${maxAttempts})`);
        await sleep(delay);
        continue;
      }
      throw error;
    }
  }
}

async function acceptAllMegaContactInvites(peer: LivePeer): Promise<number> {
  const invites = await withTimeout(`list contact invites ${peer.label}`, CONTACT_INVITE_TIMEOUT_MS, () =>
    peer.service.listIncomingProviderContactInvites()
  );
  let accepted = 0;
  for (const invite of invites.invites) {
    if (invite.provider !== 'mega') {
      continue;
    }
    await withTimeout(`accept contact invite ${peer.label}:${invite.id}`, CONTACT_INVITE_TIMEOUT_MS, () =>
      peer.service.acceptIncomingProviderContactInvite('mega', invite.accountId, invite.id)
    );
    accepted += 1;
  }
  return accepted;
}

async function waitOutgoingDescriptor(
  peer: LivePeer,
  ownerEmail: string,
  shareName: string,
  timeoutMs: number
): Promise<ChannelDescriptor> {
  const deadline = Date.now() + timeoutMs;
  let seenLabels: string[] = [];
  while (Date.now() < deadline) {
    const inventory = await withTimeout(`debug inventory ${peer.label}`, INVENTORY_TIMEOUT_MS, () =>
      peer.service.debugProviderShareInventory('mega')
    );
    seenLabels = inventory.accounts.flatMap((account) => account.outgoing.map((entry) => entry.label));
    const match = inventory.accounts
      .flatMap((account) => account.outgoing)
      .find((entry) => entry.label === shareName && (entry.shareHandle || entry.rootHandle));
    if (match) {
      const shareHandle = match.shareHandle?.trim() || match.rootHandle?.trim() || '';
      const rootHandle = match.rootHandle?.trim() || match.shareHandle?.trim() || '';
      if (shareHandle && rootHandle) {
        return {
          remotePath: `${ownerEmail}:${shareName}`,
          shareName,
          ownerEmail,
          accessLevel: INVITE_ACCESS_LEVEL,
          shareHandle,
          rootHandle,
        };
      }
    }
    await assertMegaAccountHealthy(peer);
    await sleep(1_500);
  }
  throw new Error(
    `Peer ${peer.label} did not expose an outgoing descriptor for ${shareName} within ${timeoutMs}ms${
      seenLabels.length > 0 ? ` (seen labels: ${seenLabels.join(', ')})` : ''
    }`
  );
}

describe('MEGA live outgoing descriptor discovery', () => {
  it(
    'exposes an outgoing descriptor for A after inviting B',
    async () => {
      if (!emailA || !emailB || !password) {
        throw new Error('Missing env: NEARBYTES_E2E_MEGA_OWNER_EMAIL, NEARBYTES_E2E_MEGA_RECIPIENT_EMAIL, NEARBYTES_E2E_MEGA_PASSWORD');
      }

      process.env.NEARBYTES_MEGA_REMOTE_BASE = remoteBasePath;

      let peerA: LivePeer | undefined;
      let peerB: LivePeer | undefined;
      try {
        peerA = await createPeer('A');
        peerB = await createPeer('B');

        await ensureConnectedPeer(peerA, emailA);
        const ownerA = await pickOwnerShare(peerA);
        const ownerAReady = await waitForShareReady(peerA, ownerA.id, OWNER_READY_TIMEOUT_MS);

        await sleep(SECOND_ACCOUNT_COOLDOWN_MS);

        await ensureConnectedPeer(peerB, emailB);

        await sleep(PRE_INVITE_DELAY_MS);
        await inviteManagedShareWithRetry(peerA, ownerA.id, [emailB]);
        const accepted = await acceptAllMegaContactInvites(peerB);
        await sleep(POST_CONTACT_SETTLE_MS);

        const descriptor = await waitOutgoingDescriptor(peerA, emailA, remoteShareName, DESCRIPTOR_TIMEOUT_MS);

        expect(ownerAReady.share.id).toBe(ownerA.id);
        expect(accepted).toBeGreaterThanOrEqual(0);
        expect(descriptor.ownerEmail).toBe(emailA);
        expect(descriptor.shareName).toBe(remoteShareName);
        expect(descriptor.accessLevel).toBe(INVITE_ACCESS_LEVEL);
        expect(descriptor.remotePath).toBe(`${emailA}:${remoteShareName}`);
        expect(descriptor.shareHandle.length).toBeGreaterThan(0);
        expect(descriptor.rootHandle.length).toBeGreaterThan(0);
      } finally {
        await cleanupPeer(peerB);
        await cleanupPeer(peerA);
      }
    },
    OVERALL_TIMEOUT_MS
  );
});