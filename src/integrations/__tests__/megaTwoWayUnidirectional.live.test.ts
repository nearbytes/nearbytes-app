import { existsSync, readFileSync } from 'fs';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { describe, expect, it } from 'vitest';
import type { RootsConfig } from '../../config/roots.js';
import { MultiRootStorageBackend } from '../../storage/multiRoot.js';
import { ManagedShareService } from '../managedShares.js';
import {
  MegaTransportAdapter,
  revokeMegaOutgoingSharesForPeers,
  wipeMegaCloudDriveContentsForE2e,
} from '../mega.js';
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
const CACHE_KEY = process.env.NEARBYTES_E2E_MEGA_CACHE_KEY?.trim() ?? '';
const USE_CACHE = CACHE_KEY.length > 0;

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

function normalizeRemoteBasePath(input: string): string {
  const normalized = path.posix.normalize(input.trim().replace(/\\/gu, '/'));
  if (!normalized || normalized === '.') {
    return '/nearbytes';
  }
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

const runId = USE_CACHE
  ? CACHE_KEY
  : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const remoteBasePath = normalizeRemoteBasePath(
  process.env.NEARBYTES_E2E_MEGA_REMOTE_BASE?.trim() || `/nearbytes-live-seq-${runId}`
);
const remoteShareName = path.posix.basename(remoteBasePath);
process.env.NEARBYTES_MEGA_REMOTE_BASE = remoteBasePath;

const CONNECT_TIMEOUT_MS = readPositiveIntEnv('NEARBYTES_E2E_MEGA_CONNECT_TIMEOUT_MS', 45_000);
const OWNER_READY_TIMEOUT_MS = readPositiveIntEnv('NEARBYTES_E2E_MEGA_OWNER_READY_TIMEOUT_MS', 60_000);
const DESCRIPTOR_TIMEOUT_MS = readPositiveIntEnv('NEARBYTES_E2E_MEGA_DESCRIPTOR_TIMEOUT_MS', 45_000);
const CONTACT_SETTLE_TIMEOUT_MS = readPositiveIntEnv('NEARBYTES_E2E_MEGA_CONTACT_SETTLE_TIMEOUT_MS', 12_000);
const RECIPIENT_READY_TIMEOUT_MS = readPositiveIntEnv('NEARBYTES_E2E_MEGA_RECIPIENT_READY_TIMEOUT_MS', 60_000);
const MIRROR_FILE_TIMEOUT_MS = readPositiveIntEnv('NEARBYTES_E2E_MEGA_MIRROR_FILE_TIMEOUT_MS', 60_000);
const FORCE_UPLOAD_TIMEOUT_MS = readPositiveIntEnv('NEARBYTES_E2E_MEGA_FORCE_UPLOAD_TIMEOUT_MS', 60_000);
const SERVICE_CALL_TIMEOUT_MS = readPositiveIntEnv('NEARBYTES_E2E_MEGA_SERVICE_CALL_TIMEOUT_MS', 10_000);
const INVITE_TIMEOUT_MS = readPositiveIntEnv('NEARBYTES_E2E_MEGA_INVITE_TIMEOUT_MS', 90_000);
const CONTACT_INVITE_TIMEOUT_MS = readPositiveIntEnv('NEARBYTES_E2E_MEGA_CONTACT_INVITE_TIMEOUT_MS', 30_000);
const INVENTORY_TIMEOUT_MS = readPositiveIntEnv('NEARBYTES_E2E_MEGA_INVENTORY_TIMEOUT_MS', 60_000);
const WIPE_TIMEOUT_MS = readPositiveIntEnv('NEARBYTES_E2E_MEGA_WIPE_TIMEOUT_MS', 5 * 60_000);
const CLEANUP_TIMEOUT_MS = readPositiveIntEnv('NEARBYTES_E2E_MEGA_CLEANUP_TIMEOUT_MS', 5_000);
const SECOND_ACCOUNT_COOLDOWN_MS = readPositiveIntEnv('NEARBYTES_E2E_MEGA_SECOND_ACCOUNT_COOLDOWN_MS', 2_000);
const PRE_INVITE_DELAY_MS = readPositiveIntEnv('NEARBYTES_E2E_MEGA_PRE_INVITE_DELAY_MS', 1_000);
const POST_CONTACT_SETTLE_MS = readPositiveIntEnv('NEARBYTES_E2E_MEGA_POST_CONTACT_SETTLE_MS', 2_000);
const AUTO_DISCOVERY_OBSERVE_MS = readPositiveIntEnv('NEARBYTES_E2E_MEGA_AUTO_DISCOVERY_OBSERVE_MS', 10_000);
const PAYLOAD_BYTES = readPositiveIntEnv('NEARBYTES_E2E_MEGA_PAYLOAD_BYTES', 1024);
const SYNC_INTERVAL_MS = readPositiveIntEnv('NEARBYTES_E2E_MEGA_SYNC_INTERVAL_MS', 5 * 60_000);
const SYNC_TIMEOUT_MS = readPositiveIntEnv('NEARBYTES_E2E_MEGA_SYNC_TIMEOUT_MS', 60_000);
const OVERALL_TIMEOUT_MS = readPositiveIntEnv('NEARBYTES_E2E_MEGA_OVERALL_TIMEOUT_MS', 8 * 60_000);

const skipMegaWipeRaw = process.env.NEARBYTES_E2E_SKIP_MEGA_WIPE?.trim();
const SKIP_MEGA_WIPE = skipMegaWipeRaw === undefined ? true : skipMegaWipeRaw === '1';
const skipMegaRevokeRaw = process.env.NEARBYTES_E2E_SKIP_MEGA_REVOKE?.trim();
const SKIP_MEGA_REVOKE = skipMegaRevokeRaw === undefined ? true : skipMegaRevokeRaw === '1';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type LivePeer = {
  label: 'A' | 'B';
  base: string;
  mainRoot: string;
  integrationStatePath: string;
  secretsPath: string;
  reusedCache: boolean;
  service: ManagedShareService;
};

type StepRecord = {
  index: number;
  name: string;
  status: 'running' | 'passed' | 'failed';
  startedAt: number;
  finishedAt?: number;
  durationMs?: number;
  detail?: unknown;
  error?: string;
};

type ChannelDescriptor = {
  remotePath: string;
  shareName: string;
  ownerEmail: string;
  accessLevel: 'read' | 'read/write' | 'full access';
  shareHandle?: string;
  rootHandle?: string;
};

type MaterializedRecipient = {
  shareId: string;
  localPath: string;
  requestedMirrorDir: string;
  reused: boolean;
};

type PayloadResult = {
  relativePath: string;
  sha256: string;
  uploadDurationMs: number;
  mirrorDurationMs: number;
};

type ShareReadyResult = {
  summary: ManagedShareSummary;
  reusedCachedState: boolean;
};

function sha256Hex(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

const INVITE_ACCESS_LEVEL = readMegaInviteAccessLevelEnv('NEARBYTES_E2E_MEGA_SHARE_ACCESS_LEVEL', 'read');

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

function loadRootsConfig(mainRoot: string, rootsConfigPath: string) {
  if (!existsSync(rootsConfigPath)) {
    return createRootsConfig(mainRoot);
  }
  return JSON.parse(readFileSync(rootsConfigPath, 'utf8')) as ReturnType<typeof createRootsConfig>;
}

async function createPeer(label: 'A' | 'B'): Promise<LivePeer> {
  const base = USE_CACHE
    ? path.join(workspaceRoot, 'test-results', 'mega-live-cache', CACHE_KEY, label)
    : await mkdtemp(path.join(tmpdir(), `nearbytes-mega-live-seq-${label}-`));
  const mainRoot = path.join(base, 'main-root');
  const rootsConfigPath = path.join(base, 'roots.json');
  const integrationStatePath = path.join(base, 'integrations.json');
  const secretsPath = path.join(base, 'integration-secrets.json');
  const reusedCache = USE_CACHE && (existsSync(integrationStatePath) || existsSync(secretsPath));
  await mkdir(mainRoot, { recursive: true });
  if (!existsSync(rootsConfigPath)) {
    await writeFile(rootsConfigPath, `${JSON.stringify(createRootsConfig(mainRoot), null, 2)}\n`, 'utf8');
  }
  const rootsConfig = loadRootsConfig(mainRoot, rootsConfigPath);

  const storage = new MultiRootStorageBackend(rootsConfig);
  const runtime = createIntegrationRuntime({
    secretStore: new JsonFileSecretStore({ filePath: secretsPath }),
    mega: {
      remoteBasePath,
      syncIntervalMs: SYNC_INTERVAL_MS,
      syncTimeoutMs: SYNC_TIMEOUT_MS,
    },
    logger: {
      log: (...args: unknown[]) => console.error(`[mega-seq][${label}]`, ...args),
      warn: (...args: unknown[]) => console.error(`[mega-seq][${label}] WARN`, ...args),
    },
  });
  const service = new ManagedShareService({
    storage,
    rootsConfigPath,
    integrationStatePath,
    mirrorRoot: mainRoot,
    adapters: [new MegaTransportAdapter(runtime)],
    readMaintenanceMode: 'background',
  });
  return { label, base, mainRoot, integrationStatePath, secretsPath, reusedCache, service };
}

async function cleanupPeer(peer: LivePeer | undefined): Promise<void> {
  if (!peer) {
    return;
  }
  await withTimeout(`dispose ${peer.label}`, CLEANUP_TIMEOUT_MS, () => peer.service.dispose()).catch(() => {});
  if (!USE_CACHE) {
    await withTimeout(`rm ${peer.label}`, CLEANUP_TIMEOUT_MS, () => rm(peer.base, { recursive: true, force: true })).catch(() => {});
  }
}

function summarizePeer(peer: LivePeer): Record<string, string> {
  return {
    label: peer.label,
    base: peer.base,
    mainRoot: peer.mainRoot,
    integrationStatePath: peer.integrationStatePath,
    secretsPath: peer.secretsPath,
    reusedCache: String(peer.reusedCache),
  };
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

async function ensureConnectedPeer(peer: LivePeer, email: string): Promise<{ status: string; accountId?: string; email?: string; reused: boolean }> {
  const accounts = await serviceCall(`list accounts ${peer.label}`, () => peer.service.listAccounts({ fast: true }));
  const existing = accounts.accounts.find((account) => account.provider === 'mega');
  if (existing) {
    return {
      status: existing.state === 'connected' ? 'reused-connected' : `reused-${existing.state}`,
      accountId: existing.id,
      email: existing.email,
      reused: true,
    };
  }
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
    reused: false,
  };
}

async function serviceCall<T>(label: string, operation: () => Promise<T>): Promise<T> {
  return await withTimeout(label, SERVICE_CALL_TIMEOUT_MS, operation);
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

function formatShareState(summary: ManagedShareSummary): string {
  const state = summary.state;
  const diagnostic = state.diagnostic
    ? `${state.diagnostic.title}: ${state.diagnostic.summary}${state.diagnostic.detail ? ` (${state.diagnostic.detail})` : ''}`
    : '';
  return `${summary.share.role}:${state.status}:${state.detail}${diagnostic ? ` | ${diagnostic}` : ''}`;
}

function isTerminalShareState(summary: ManagedShareSummary): boolean {
  return (
    summary.state.status === 'attention' ||
    summary.state.status === 'needs-auth' ||
    summary.state.status === 'unsupported'
  );
}

function canReuseCachedShareState(peer: LivePeer, summary: ManagedShareSummary): boolean {
  if (!peer.reusedCache || !USE_CACHE || isTerminalShareState(summary)) {
    return false;
  }
  const localPath = summary.share.localPath?.trim();
  if (!localPath || !existsSync(localPath)) {
    return false;
  }
  return path.resolve(localPath).startsWith(path.resolve(peer.base));
}

async function waitForShareReady(peer: LivePeer, shareId: string, timeoutMs: number): Promise<ShareReadyResult> {
  const deadline = Date.now() + timeoutMs;
  let lastSummary: ManagedShareSummary | undefined;
  while (Date.now() < deadline) {
    const summary = await serviceCall(`get share state ${peer.label}:${shareId}`, () =>
      peer.service.getManagedShareState(shareId)
    );
    lastSummary = summary;
    if (summary.state.status === 'ready') {
      return { summary, reusedCachedState: false };
    }
    if (canReuseCachedShareState(peer, summary)) {
      return { summary, reusedCachedState: true };
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

async function inviteManagedShareWithRetry(
  peer: LivePeer,
  shareId: string,
  emails: readonly string[]
): Promise<void> {
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
        console.error(`[mega-seq] peer ${peer.label} invite retry after -3 in ${delay}ms (${attempt + 1}/${maxAttempts})`);
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

function normalizeIdentity(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function readDescriptorString(descriptor: Record<string, unknown>, key: string): string | undefined {
  const value = descriptor[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function matchesRecipientShare(summary: ManagedShareSummary, ownerEmail: string, shareName: string): boolean {
  return summary.share.provider === 'mega' &&
    summary.share.role === 'recipient' &&
    normalizeIdentity(summary.share.remoteDescriptor.ownerEmail) === normalizeIdentity(ownerEmail) &&
    normalizeIdentity(summary.share.remoteDescriptor.shareName ?? summary.share.label) === normalizeIdentity(shareName);
}

async function observeAutoAdoptedRecipientShare(
  peer: LivePeer,
  ownerEmail: string,
  shareName: string,
  timeoutMs: number
): Promise<{ status: 'attached' | 'not-attached'; shareId?: string; localPath?: string }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const shares = await serviceCall(`list managed shares ${peer.label}`, () => peer.service.listManagedShares({ fast: true }));
    const match = shares.shares.find((summary) => matchesRecipientShare(summary, ownerEmail, shareName));
    if (match) {
      return {
        status: 'attached',
        shareId: match.share.id,
        localPath: match.share.localPath,
      };
    }
    await assertMegaAccountHealthy(peer);
    await sleep(1_000);
  }
  return { status: 'not-attached' };
}

async function waitIncomingOfferDescriptor(
  peer: LivePeer,
  ownerEmail: string,
  shareName: string,
  timeoutMs: number
): Promise<ChannelDescriptor> {
  const deadline = Date.now() + timeoutMs;
  let seenOffers: string[] = [];
  while (Date.now() < deadline) {
    const incoming = await withTimeout(`list incoming shares ${peer.label}`, INVENTORY_TIMEOUT_MS, () =>
      peer.service.listIncomingManagedShares()
    );
    seenOffers = incoming.shares
      .filter((offer) => offer.provider === 'mega')
      .map((offer) => `${normalizeIdentity(offer.remoteDescriptor.ownerEmail)}:${normalizeIdentity(offer.remoteDescriptor.shareName ?? offer.label)}`);
    const match = incoming.shares.find((offer) =>
      offer.provider === 'mega' &&
      normalizeIdentity(offer.remoteDescriptor.ownerEmail) === normalizeIdentity(ownerEmail) &&
      normalizeIdentity(offer.remoteDescriptor.shareName ?? offer.label) === normalizeIdentity(shareName)
    );
    if (match) {
      return {
        remotePath: readDescriptorString(match.remoteDescriptor, 'remotePath') ?? `${ownerEmail}:${shareName}`,
        shareName: readDescriptorString(match.remoteDescriptor, 'shareName') ?? shareName,
        ownerEmail: readDescriptorString(match.remoteDescriptor, 'ownerEmail') ?? ownerEmail,
        accessLevel: INVITE_ACCESS_LEVEL,
        shareHandle: readDescriptorString(match.remoteDescriptor, 'shareHandle'),
        rootHandle: readDescriptorString(match.remoteDescriptor, 'rootHandle'),
      };
    }
    await assertMegaAccountHealthy(peer);
    await sleep(1_500);
  }
  throw new Error(
    `Peer ${peer.label} did not expose an incoming MEGA share offer for ${ownerEmail}:${shareName} within ${timeoutMs}ms${
      seenOffers.length > 0 ? ` (seen offers: ${seenOffers.join(', ')})` : ''
    }`
  );
}

async function materializeRecipientShare(
  peer: LivePeer,
  accountId: string,
  descriptor: ChannelDescriptor,
  mirrorDir: string
): Promise<ManagedShareSummary> {
  return await serviceCall(`accept managed share ${peer.label}:${descriptor.ownerEmail}`, () =>
    peer.service.acceptManagedShare({
      provider: 'mega',
      accountId,
      label: descriptor.shareName,
      localPath: mirrorDir,
      remoteDescriptor: descriptor,
    })
  );
}

async function findExistingRecipientShare(
  peer: LivePeer,
  ownerEmail: string,
  shareName: string
): Promise<ManagedShareSummary | undefined> {
  const shares = await serviceCall(`list managed shares ${peer.label}`, () => peer.service.listManagedShares({ fast: true }));
  return shares.shares.find((summary) => matchesRecipientShare(summary, ownerEmail, shareName));
}

function cachedMirrorDir(direction: 'a-to-b' | 'b-to-a'): string {
  return path.join(workspaceRoot, 'test-results', 'mega-live-cache', CACHE_KEY, direction);
}

async function getOrCreateRecipientShare(
  peer: LivePeer,
  accountId: string,
  descriptor: ChannelDescriptor,
  requestedMirrorDir: string
): Promise<MaterializedRecipient> {
  const existing = USE_CACHE
    ? await findExistingRecipientShare(peer, descriptor.ownerEmail, descriptor.shareName)
    : undefined;
  if (existing) {
    return {
      shareId: existing.share.id,
      localPath: existing.share.localPath,
      requestedMirrorDir,
      reused: true,
    };
  }
  await mkdir(requestedMirrorDir, { recursive: true });
  const summary = await materializeRecipientShare(peer, accountId, descriptor, requestedMirrorDir);
  return {
    shareId: summary.share.id,
    localPath: summary.share.localPath,
    requestedMirrorDir,
    reused: false,
  };
}

function createPayload(tag: string): Buffer {
  const prefix = Buffer.from(`${tag}:${Date.now()}\n`, 'utf8');
  if (prefix.length >= PAYLOAD_BYTES) {
    return prefix.subarray(0, PAYLOAD_BYTES);
  }
  const fill = Buffer.alloc(PAYLOAD_BYTES - prefix.length, tag.charCodeAt(0) || 0x58);
  return Buffer.concat([prefix, fill]);
}

async function waitForMirrorFile(filePath: string, expectedBytes: Buffer, timeoutMs: number): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  const startedAt = Date.now();
  while (Date.now() < deadline) {
    try {
      await access(filePath);
      const got = await readFile(filePath);
      if (Buffer.compare(got, expectedBytes) === 0) {
        return Date.now() - startedAt;
      }
    } catch {
      // Wait for the file to materialize.
    }
    await sleep(1_000);
  }
  throw new Error(`Mirror file missing or mismatched: ${filePath}`);
}

async function sendOwnerPayload(
  peer: LivePeer,
  ownerShare: ManagedShare,
  tag: string,
  recipientRoot: string
): Promise<PayloadResult> {
  const payload = createPayload(tag);
  const relativePath = `blocks/${sha256Hex(payload)}.bin`;
  await mkdir(path.join(ownerShare.localPath, 'blocks'), { recursive: true });
  await writeFile(path.join(ownerShare.localPath, relativePath), payload);
  const uploadStartedAt = Date.now();
  await withTimeout(`force upload ${peer.label}:${relativePath}`, FORCE_UPLOAD_TIMEOUT_MS, () =>
    peer.service.forceManagedShareUpload(ownerShare.id, relativePath)
  );
  const uploadDurationMs = Date.now() - uploadStartedAt;
  const mirrorDurationMs = await waitForMirrorFile(path.join(recipientRoot, relativePath), payload, MIRROR_FILE_TIMEOUT_MS);
  return {
    relativePath,
    sha256: sha256Hex(payload),
    uploadDurationMs,
    mirrorDurationMs,
  };
}

async function wipeAccountsIfEnabled(): Promise<void> {
  if (SKIP_MEGA_WIPE && SKIP_MEGA_REVOKE) {
    return;
  }
  process.env.NEARBYTES_ALLOW_DESTRUCTIVE_MEGA_E2E_WIPE = '1';
  const pair = [emailA, emailB];
  if (!SKIP_MEGA_REVOKE) {
    for (const email of pair) {
      const peers = pair.filter((entry) => entry !== email);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), WIPE_TIMEOUT_MS);
      try {
        await revokeMegaOutgoingSharesForPeers({
          email,
          password,
          peerEmails: peers,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
    }
  }
  if (!SKIP_MEGA_WIPE) {
    for (const email of pair) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), WIPE_TIMEOUT_MS);
      try {
        await wipeMegaCloudDriveContentsForE2e({ email, password, signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
    }
  }
}

async function collectPeerDiagnostics(peer: LivePeer | undefined): Promise<unknown> {
  if (!peer) {
    return null;
  }
  const diagnostics: Record<string, unknown> = {
    label: peer.label,
    integrationStatePath: peer.integrationStatePath,
  };
  diagnostics.accounts = await serviceCall(`diag accounts ${peer.label}`, () => peer.service.listAccounts({ fast: true }))
    .then((value) => value.accounts)
    .catch((error) => ({ error: safeErrorMessage(error) }));
  diagnostics.shares = await serviceCall(`diag shares ${peer.label}`, () => peer.service.listManagedShares({ fast: true }))
    .then((value) =>
      value.shares.map((summary) => ({
        id: summary.share.id,
        role: summary.share.role,
        label: summary.share.label,
        localPath: summary.share.localPath,
        remoteDescriptor: summary.share.remoteDescriptor,
        state: summary.state,
      }))
    )
    .catch((error) => ({ error: safeErrorMessage(error) }));
  diagnostics.inventory = await serviceCall(`diag inventory ${peer.label}`, () => peer.service.debugProviderShareInventory('mega'))
    .catch((error) => ({ error: safeErrorMessage(error) }));
  return diagnostics;
}

describe('MEGA live two-way one-directional transport progress', () => {
  it(
    'proves A→B and B→A owner-to-recipient delivery with real-time second-packet reception',
    async () => {
      if (!emailA || !emailB || !password) {
        throw new Error(
          'Missing live MEGA credentials: NEARBYTES_E2E_MEGA_OWNER_EMAIL, NEARBYTES_E2E_MEGA_RECIPIENT_EMAIL, NEARBYTES_E2E_MEGA_PASSWORD'
        );
      }

      const reportDir = path.join(workspaceRoot, 'test-results');
      const reportPath = path.join(reportDir, `mega-two-way-unidirectional-progress-${runId}.json`);
      const steps: StepRecord[] = [];
      let peerA: LivePeer | undefined;
      let peerB: LivePeer | undefined;
      let result: 'running' | 'passed' | 'failed' = 'running';
      let persistentReportExtra: Record<string, unknown> = {};

      async function flushReport(extra: Record<string, unknown> = {}): Promise<void> {
        await mkdir(reportDir, { recursive: true });
        await writeFile(
          reportPath,
          `${JSON.stringify(
            {
              result,
              runId,
              remoteBasePath,
              remoteShareName,
              reportPath,
              config: {
                connectTimeoutMs: CONNECT_TIMEOUT_MS,
                ownerReadyTimeoutMs: OWNER_READY_TIMEOUT_MS,
                descriptorTimeoutMs: DESCRIPTOR_TIMEOUT_MS,
                contactSettleTimeoutMs: CONTACT_SETTLE_TIMEOUT_MS,
                recipientReadyTimeoutMs: RECIPIENT_READY_TIMEOUT_MS,
                mirrorFileTimeoutMs: MIRROR_FILE_TIMEOUT_MS,
                forceUploadTimeoutMs: FORCE_UPLOAD_TIMEOUT_MS,
                serviceCallTimeoutMs: SERVICE_CALL_TIMEOUT_MS,
                inviteTimeoutMs: INVITE_TIMEOUT_MS,
                contactInviteTimeoutMs: CONTACT_INVITE_TIMEOUT_MS,
                inventoryTimeoutMs: INVENTORY_TIMEOUT_MS,
                syncIntervalMs: SYNC_INTERVAL_MS,
                syncTimeoutMs: SYNC_TIMEOUT_MS,
                payloadBytes: PAYLOAD_BYTES,
                inviteAccessLevel: INVITE_ACCESS_LEVEL,
                skipMegaWipe: SKIP_MEGA_WIPE,
                skipMegaRevoke: SKIP_MEGA_REVOKE,
              },
              steps,
              ...persistentReportExtra,
              ...extra,
            },
            null,
            2
          )}\n`,
          'utf8'
        );
      }

      async function runStep<T>(name: string, operation: () => Promise<T>): Promise<T> {
        const step: StepRecord = {
          index: steps.length + 1,
          name,
          status: 'running',
          startedAt: Date.now(),
        };
        steps.push(step);
        console.error(`[mega-seq] START ${step.index}: ${name}`);
        await flushReport();
        try {
          const value = await operation();
          step.status = 'passed';
          step.finishedAt = Date.now();
          step.durationMs = step.finishedAt - step.startedAt;
          step.detail = value;
          console.error(`[mega-seq] OK ${step.index}: ${name} (${step.durationMs}ms)`);
          await flushReport();
          return value;
        } catch (error) {
          step.status = 'failed';
          step.finishedAt = Date.now();
          step.durationMs = step.finishedAt - step.startedAt;
          step.error = safeErrorMessage(error);
          result = 'failed';
          console.error(`[mega-seq] FAIL ${step.index}: ${name} (${step.durationMs}ms)`, error);
          persistentReportExtra = {
            error: safeErrorMessage(error),
            diagnostics: {
              peerA: await collectPeerDiagnostics(peerA),
              peerB: await collectPeerDiagnostics(peerB),
            },
          };
          await flushReport();
          throw error;
        }
      }

      try {
        await runStep('optional revoke/wipe cleanup', async () => {
          await wipeAccountsIfEnabled();
          return {
            skippedWipe: SKIP_MEGA_WIPE,
            skippedRevoke: SKIP_MEGA_REVOKE,
          };
        });

        await runStep('create peer A sandbox', async () => {
          peerA = await createPeer('A');
          return summarizePeer(peerA);
        });
        await runStep('connect peer A to MEGA', async () => {
          return await ensureConnectedPeer(peerA!, emailA);
        });

        const ownerA = await runStep('resolve peer A owner share', async () => await pickOwnerShare(peerA!));
        await runStep('wait peer A owner share ready', async () => {
          const result = await waitForShareReady(peerA!, ownerA.id, OWNER_READY_TIMEOUT_MS);
          const summary = result.summary;
          return {
            shareId: summary.share.id,
            localPath: summary.share.localPath,
            state: summary.state,
            reusedCachedState: result.reusedCachedState,
          };
        });

        await runStep('cool down before second MEGA account', async () => {
          await sleep(SECOND_ACCOUNT_COOLDOWN_MS);
          return { cooldownMs: SECOND_ACCOUNT_COOLDOWN_MS };
        });

        await runStep('create peer B sandbox', async () => {
          peerB = await createPeer('B');
          return summarizePeer(peerB);
        });
        await runStep('connect peer B to MEGA', async () => {
          return await ensureConnectedPeer(peerB!, emailB);
        });

        const ownerB = await runStep('resolve peer B owner share', async () => await pickOwnerShare(peerB!));
        await runStep('wait peer B owner share ready', async () => {
          const result = await waitForShareReady(peerB!, ownerB.id, OWNER_READY_TIMEOUT_MS);
          const summary = result.summary;
          return {
            shareId: summary.share.id,
            localPath: summary.share.localPath,
            state: summary.state,
            reusedCachedState: result.reusedCachedState,
          };
        });

        await runStep(`invite A owner share to B with ${INVITE_ACCESS_LEVEL} access`, async () => {
          if (USE_CACHE) {
            const existing = await findExistingRecipientShare(peerB!, emailA, remoteShareName);
            if (existing) {
              return { invitee: emailB, accessLevel: INVITE_ACCESS_LEVEL, reused: true, shareId: existing.share.id };
            }
          }
          await sleep(PRE_INVITE_DELAY_MS);
          await inviteManagedShareWithRetry(peerA!, ownerA.id, [emailB]);
          return { invitee: emailB, accessLevel: INVITE_ACCESS_LEVEL };
        });

        await runStep('accept B-side MEGA contact invites', async () => {
          if (USE_CACHE) {
            const existing = await findExistingRecipientShare(peerB!, emailA, remoteShareName);
            if (existing) {
              return { accepted: 0, settleMs: 0, reused: true };
            }
          }
          const accepted = await acceptAllMegaContactInvites(peerB!);
          await sleep(POST_CONTACT_SETTLE_MS);
          return { accepted, settleMs: POST_CONTACT_SETTLE_MS };
        });

        const autoAtoB = await runStep('observe whether B auto-attaches A channel', async () =>
          await observeAutoAdoptedRecipientShare(peerB!, emailA, remoteShareName, AUTO_DISCOVERY_OBSERVE_MS)
        );

        const descriptorAtoB = await runStep('resolve incoming offer for A channel on B', async () =>
          await waitIncomingOfferDescriptor(peerB!, emailA, remoteShareName, DESCRIPTOR_TIMEOUT_MS)
        );

        const mirrorB = await runStep('materialize B recipient mirror for A channel', async () => {
          const mirrorDir = USE_CACHE
            ? cachedMirrorDir('a-to-b')
            : await mkdtemp(path.join(tmpdir(), 'nearbytes-a-to-b-recipient-'));
          const summary = await getOrCreateRecipientShare(peerB!, ownerB.accountId, descriptorAtoB, mirrorDir);
          return {
            requestedMirrorDir: summary.requestedMirrorDir,
            actualShareId: summary.shareId,
            actualLocalPath: summary.localPath,
            reused: summary.reused,
            observation: autoAtoB,
          };
        });

        await runStep('wait B recipient share ready for A channel', async () => {
          const result = await waitForShareReady(peerB!, String(mirrorB.actualShareId), RECIPIENT_READY_TIMEOUT_MS);
          const summary = result.summary;
          return {
            shareId: summary.share.id,
            localPath: summary.share.localPath,
            state: summary.state,
            reusedCachedState: result.reusedCachedState,
          };
        });

        await runStep(`invite B owner share to A with ${INVITE_ACCESS_LEVEL} access`, async () => {
          if (USE_CACHE) {
            const existing = await findExistingRecipientShare(peerA!, emailB, remoteShareName);
            if (existing) {
              return { invitee: emailA, accessLevel: INVITE_ACCESS_LEVEL, reused: true, shareId: existing.share.id };
            }
          }
          await sleep(PRE_INVITE_DELAY_MS);
          await inviteManagedShareWithRetry(peerB!, ownerB.id, [emailA]);
          return { invitee: emailA, accessLevel: INVITE_ACCESS_LEVEL };
        });

        await runStep('accept A-side MEGA contact invites', async () => {
          if (USE_CACHE) {
            const existing = await findExistingRecipientShare(peerA!, emailB, remoteShareName);
            if (existing) {
              return { accepted: 0, settleMs: 0, reused: true };
            }
          }
          const accepted = await acceptAllMegaContactInvites(peerA!);
          await sleep(POST_CONTACT_SETTLE_MS);
          return { accepted, settleMs: POST_CONTACT_SETTLE_MS };
        });

        const autoBtoA = await runStep('observe whether A auto-attaches B channel', async () =>
          await observeAutoAdoptedRecipientShare(peerA!, emailB, remoteShareName, AUTO_DISCOVERY_OBSERVE_MS)
        );

        const descriptorBtoA = await runStep('resolve incoming offer for B channel on A', async () =>
          await waitIncomingOfferDescriptor(peerA!, emailB, remoteShareName, DESCRIPTOR_TIMEOUT_MS)
        );

        const mirrorA = await runStep('materialize A recipient mirror for B channel', async () => {
          const mirrorDir = USE_CACHE
            ? cachedMirrorDir('b-to-a')
            : await mkdtemp(path.join(tmpdir(), 'nearbytes-b-to-a-recipient-'));
          const summary = await getOrCreateRecipientShare(peerA!, ownerA.accountId, descriptorBtoA, mirrorDir);
          return {
            requestedMirrorDir: summary.requestedMirrorDir,
            actualShareId: summary.shareId,
            actualLocalPath: summary.localPath,
            reused: summary.reused,
            observation: autoBtoA,
          };
        });

        await runStep('wait A recipient share ready for B channel', async () => {
          const result = await waitForShareReady(peerA!, String(mirrorA.actualShareId), RECIPIENT_READY_TIMEOUT_MS);
          const summary = result.summary;
          return {
            shareId: summary.share.id,
            localPath: summary.share.localPath,
            state: summary.state,
            reusedCachedState: result.reusedCachedState,
          };
        });

        const flowAtoB = await runStep('prove A owner sends two sequential payloads to B recipient', async () => {
          const first = await sendOwnerPayload(peerA!, ownerA, 'A1', String(mirrorB.actualLocalPath));
          const second = await sendOwnerPayload(peerA!, ownerA, 'A2', String(mirrorB.actualLocalPath));
          return { first, second };
        });

        const flowBtoA = await runStep('prove B owner sends two sequential payloads to A recipient', async () => {
          const first = await sendOwnerPayload(peerB!, ownerB, 'B1', String(mirrorA.actualLocalPath));
          const second = await sendOwnerPayload(peerB!, ownerB, 'B2', String(mirrorA.actualLocalPath));
          return { first, second };
        });

        expect(flowAtoB.second.mirrorDurationMs).toBeLessThan(SYNC_INTERVAL_MS);
        expect(flowBtoA.second.mirrorDurationMs).toBeLessThan(SYNC_INTERVAL_MS);

        result = 'passed';
        await flushReport({
          assertions: {
            secondPacketAtoBLatencyMs: flowAtoB.second.mirrorDurationMs,
            secondPacketBtoALatencyMs: flowBtoA.second.mirrorDurationMs,
            syncIntervalMs: SYNC_INTERVAL_MS,
          },
        });
      } finally {
        await Promise.allSettled([cleanupPeer(peerA), cleanupPeer(peerB)]);
        await flushReport();
      }
    },
    OVERALL_TIMEOUT_MS
  );
});