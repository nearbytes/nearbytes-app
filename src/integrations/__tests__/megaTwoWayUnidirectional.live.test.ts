import { existsSync, readFileSync } from 'fs';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { describe, expect, it } from 'vitest';
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

const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
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
  accessLevel: 'read';
  shareHandle: string;
  rootHandle: string;
};

type PayloadResult = {
  relativePath: string;
  sha256: string;
  uploadDurationMs: number;
  mirrorDurationMs: number;
};

function sha256Hex(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

function createRootsConfig(mainRoot: string) {
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

async function createPeer(label: 'A' | 'B'): Promise<LivePeer> {
  const base = await mkdtemp(path.join(tmpdir(), `nearbytes-mega-live-seq-${label}-`));
  const mainRoot = path.join(base, 'main-root');
  const rootsConfigPath = path.join(base, 'roots.json');
  const integrationStatePath = path.join(base, 'integrations.json');
  await mkdir(mainRoot, { recursive: true });
  await writeFile(rootsConfigPath, `${JSON.stringify(createRootsConfig(mainRoot), null, 2)}\n`, 'utf8');

  const storage = new MultiRootStorageBackend(createRootsConfig(mainRoot));
  const runtime = createIntegrationRuntime({
    secretStore: new JsonFileSecretStore({ filePath: path.join(base, 'integration-secrets.json') }),
    mega: {
      remoteBasePath,
      syncIntervalMs: SYNC_INTERVAL_MS,
      syncTimeoutMs: SYNC_TIMEOUT_MS,
    },
    logger: {
      log: (...args: unknown[]) => console.error(`[mega-seq][${label}]`, ...args),
      warn: (...args: unknown[]) => console.error(`[mega-seq][${label}] WARN`, ...args),
      error: (...args: unknown[]) => console.error(`[mega-seq][${label}] ERROR`, ...args),
    },
  });
  const service = new ManagedShareService({
    storage,
    rootsConfigPath,
    integrationStatePath,
    adapters: [new MegaTransportAdapter(runtime)],
    readMaintenanceMode: 'background',
  });
  return { label, base, mainRoot, integrationStatePath, service };
}

async function cleanupPeer(peer: LivePeer | undefined): Promise<void> {
  if (!peer) {
    return;
  }
  await withTimeout(`dispose ${peer.label}`, CLEANUP_TIMEOUT_MS, () => peer.service.dispose()).catch(() => {});
  await withTimeout(`rm ${peer.label}`, CLEANUP_TIMEOUT_MS, () => rm(peer.base, { recursive: true, force: true })).catch(() => {});
}

function summarizePeer(peer: LivePeer): Record<string, string> {
  return {
    label: peer.label,
    base: peer.base,
    mainRoot: peer.mainRoot,
    integrationStatePath: peer.integrationStatePath,
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

async function inviteManagedShareWithRetry(
  peer: LivePeer,
  shareId: string,
  emails: readonly string[]
): Promise<void> {
  const maxAttempts = 10;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      await withTimeout(`invite from ${peer.label}`, INVITE_TIMEOUT_MS, () =>
        peer.service.inviteManagedShare(shareId, emails, 'read')
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
          accessLevel: 'read',
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
          const connected = await withTimeout('connect peer A', CONNECT_TIMEOUT_MS, () =>
            peerA!.service.connectAccount({
              provider: 'mega',
              credentials: { email: emailA, password },
              preferred: true,
            })
          );
          return {
            status: connected.status,
            accountId: connected.account?.id,
            email: connected.account?.email,
          };
        });

        const ownerA = await runStep('resolve peer A owner share', async () => await pickOwnerShare(peerA));
        await runStep('wait peer A owner share ready', async () => {
          const summary = await waitForShareReady(peerA!, ownerA.id, OWNER_READY_TIMEOUT_MS);
          return {
            shareId: summary.share.id,
            localPath: summary.share.localPath,
            state: summary.state,
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
          const connected = await withTimeout('connect peer B', CONNECT_TIMEOUT_MS, () =>
            peerB!.service.connectAccount({
              provider: 'mega',
              credentials: { email: emailB, password },
              preferred: true,
            })
          );
          return {
            status: connected.status,
            accountId: connected.account?.id,
            email: connected.account?.email,
          };
        });

        const ownerB = await runStep('resolve peer B owner share', async () => await pickOwnerShare(peerB));
        await runStep('wait peer B owner share ready', async () => {
          const summary = await waitForShareReady(peerB!, ownerB.id, OWNER_READY_TIMEOUT_MS);
          return {
            shareId: summary.share.id,
            localPath: summary.share.localPath,
            state: summary.state,
          };
        });

        await runStep('invite A owner share to B as read-only', async () => {
          await sleep(PRE_INVITE_DELAY_MS);
          await inviteManagedShareWithRetry(peerA!, ownerA.id, [emailB]);
          return { invitee: emailB, accessLevel: 'read' };
        });

        await runStep('accept B-side MEGA contact invites', async () => {
          const accepted = await acceptAllMegaContactInvites(peerB!);
          await sleep(POST_CONTACT_SETTLE_MS);
          return { accepted, settleMs: POST_CONTACT_SETTLE_MS };
        });

        const autoAtoB = await runStep('observe whether B auto-attaches A channel', async () =>
          await observeAutoAdoptedRecipientShare(peerB!, emailA, remoteShareName, AUTO_DISCOVERY_OBSERVE_MS)
        );

        const descriptorAtoB = await runStep('resolve outgoing descriptor for A channel', async () =>
          await waitOutgoingDescriptor(peerA!, emailA, remoteShareName, DESCRIPTOR_TIMEOUT_MS)
        );

        const mirrorB = await runStep('materialize B recipient mirror for A channel', async () => {
          const mirrorDir = await mkdtemp(path.join(tmpdir(), 'nearbytes-a-to-b-recipient-'));
          const summary = await materializeRecipientShare(peerB!, ownerB.accountId, descriptorAtoB, mirrorDir);
          return {
            requestedMirrorDir: mirrorDir,
            actualShareId: summary.share.id,
            actualLocalPath: summary.share.localPath,
            observation: autoAtoB,
          };
        });

        await runStep('wait B recipient share ready for A channel', async () => {
          const summary = await waitForShareReady(peerB!, String(mirrorB.actualShareId), RECIPIENT_READY_TIMEOUT_MS);
          return {
            shareId: summary.share.id,
            localPath: summary.share.localPath,
            state: summary.state,
          };
        });

        await runStep('invite B owner share to A as read-only', async () => {
          await sleep(PRE_INVITE_DELAY_MS);
          await inviteManagedShareWithRetry(peerB!, ownerB.id, [emailA]);
          return { invitee: emailA, accessLevel: 'read' };
        });

        await runStep('accept A-side MEGA contact invites', async () => {
          const accepted = await acceptAllMegaContactInvites(peerA!);
          await sleep(POST_CONTACT_SETTLE_MS);
          return { accepted, settleMs: POST_CONTACT_SETTLE_MS };
        });

        const autoBtoA = await runStep('observe whether A auto-attaches B channel', async () =>
          await observeAutoAdoptedRecipientShare(peerA!, emailB, remoteShareName, AUTO_DISCOVERY_OBSERVE_MS)
        );

        const descriptorBtoA = await runStep('resolve outgoing descriptor for B channel', async () =>
          await waitOutgoingDescriptor(peerB!, emailB, remoteShareName, DESCRIPTOR_TIMEOUT_MS)
        );

        const mirrorA = await runStep('materialize A recipient mirror for B channel', async () => {
          const mirrorDir = await mkdtemp(path.join(tmpdir(), 'nearbytes-b-to-a-recipient-'));
          const summary = await materializeRecipientShare(peerA!, ownerA.accountId, descriptorBtoA, mirrorDir);
          return {
            requestedMirrorDir: mirrorDir,
            actualShareId: summary.share.id,
            actualLocalPath: summary.share.localPath,
            observation: autoBtoA,
          };
        });

        await runStep('wait A recipient share ready for B channel', async () => {
          const summary = await waitForShareReady(peerA!, String(mirrorA.actualShareId), RECIPIENT_READY_TIMEOUT_MS);
          return {
            shareId: summary.share.id,
            localPath: summary.share.localPath,
            state: summary.state,
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