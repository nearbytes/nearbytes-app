import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { access, mkdir, mkdtemp, readFile, writeFile } from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { test, expect } from '@playwright/test';

const repoRoot = path.join(fileURLToPath(new URL('.', import.meta.url)), '..');

async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function waitForHealth(baseUrl: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl.replace(/\/$/u, '')}/health`);
      if (res.ok) {
        return;
      }
    } catch {
      /* ignore */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Server did not become healthy: ${baseUrl}`);
}

function startServer(opts: { port: number; storageDir: string; rootsConfigPath: string }): ChildProcessWithoutNullStreams {
  return spawn(process.execPath, [path.join(repoRoot, 'dist/server/index.js')], {
    env: {
      ...process.env,
      PORT: String(opts.port),
      NEARBYTES_STORAGE_DIR: opts.storageDir,
      NEARBYTES_ROOTS_CONFIG: opts.rootsConfigPath,
    },
    cwd: repoRoot,
    stdio: 'pipe',
  });
}

async function killServer(proc: ChildProcessWithoutNullStreams | null): Promise<void> {
  if (!proc?.pid) {
    return;
  }
  proc.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 1_500));
  if (!proc.killed) {
    proc.kill('SIGKILL');
  }
}

type SharesList = {
  shares?: Array<{
    share: { id: string; provider: string; role: string; localPath: string };
    state?: { status?: string };
  }>;
};

type IncomingList = {
  shares?: Array<{
    id: string;
    provider: string;
    accountId: string;
    label: string;
    remoteDescriptor: Record<string, unknown>;
    ownerLabel?: string;
  }>;
};

/**
 * Live two-account MEGA flow: owner invites recipient, recipient accepts readonly mirror,
 * owner pushes a block; recipient local mirror should contain the same file.
 *
 * Env (see `.env.e2e`, gitignored):
 *   - NEARBYTES_E2E_MEGA_OWNER_EMAIL
 *   - NEARBYTES_E2E_MEGA_RECIPIENT_EMAIL
 *   - NEARBYTES_E2E_MEGA_PASSWORD (shared)
 * Optional:
 *   - NEARBYTES_E2E_SKIP_MEGA_WIPE=1 — skip cloud wipe in beforeAll
 *
 * Prerequisite: `yarn build` (uses dist/server + dist/integrations).
 */
test.describe.configure({ mode: 'serial', timeout: 420_000 });

test.describe('MEGA two-account invite + mirror (live)', () => {
  let ownerProc: ChildProcessWithoutNullStreams | null = null;
  let recipientProc: ChildProcessWithoutNullStreams | null = null;
  let ownerBase: string;
  let recipientBase: string;
  let ownerShareId: string;
  let ownerLocalPath: string;
  let recipientShareId: string;
  let recipientLocalPath: string;
  let blockRelPath: string;
  let blockBytes: Uint8Array;

  test.beforeAll(async () => {
    const ownerEmail = process.env.NEARBYTES_E2E_MEGA_OWNER_EMAIL?.trim();
    const recipientEmail = process.env.NEARBYTES_E2E_MEGA_RECIPIENT_EMAIL?.trim();
    const password = process.env.NEARBYTES_E2E_MEGA_PASSWORD ?? '';
    test.skip(!(ownerEmail && recipientEmail && password), 'Set NEARBYTES_E2E_MEGA_OWNER_EMAIL, RECIPIENT_EMAIL, PASSWORD');

    if (process.env.NEARBYTES_E2E_SKIP_MEGA_WIPE?.trim() === '1') {
      return;
    }
    process.env.NEARBYTES_ALLOW_DESTRUCTIVE_MEGA_E2E_WIPE = '1';
    const { wipeMegaCloudDriveContentsForE2e } = await import('../dist/integrations/mega.js');
    for (const email of [ownerEmail!, recipientEmail!]) {
      await wipeMegaCloudDriveContentsForE2e({ email, password });
    }
  });

  test('owner + recipient servers, invite, accept, push, mirrored block', async ({ request }) => {
    const ownerEmail = process.env.NEARBYTES_E2E_MEGA_OWNER_EMAIL!.trim();
    const recipientEmail = process.env.NEARBYTES_E2E_MEGA_RECIPIENT_EMAIL!.trim();
    const password = process.env.NEARBYTES_E2E_MEGA_PASSWORD!;

    const ownerDir = await mkdtemp(path.join(os.tmpdir(), 'nearbytes-e2e-owner-'));
    const recipientDir = await mkdtemp(path.join(os.tmpdir(), 'nearbytes-e2e-recipient-'));
    const ownerStorage = path.join(ownerDir, 'storage');
    const recipientStorage = path.join(recipientDir, 'storage');
    await mkdir(ownerStorage, { recursive: true });
    await mkdir(recipientStorage, { recursive: true });
    const ownerRoots = path.join(ownerDir, 'roots.json');
    const recipientRoots = path.join(recipientDir, 'roots.json');

    const ownerPort = 31_701;
    const recipientPort = 31_702;
    ownerBase = `http://127.0.0.1:${ownerPort}`;
    recipientBase = `http://127.0.0.1:${recipientPort}`;

    ownerProc = startServer({ port: ownerPort, storageDir: ownerStorage, rootsConfigPath: ownerRoots });
    await waitForHealth(ownerBase);

    const ownerConnect = await request.post(`${ownerBase}/integrations/accounts/connect`, {
      data: {
        provider: 'mega',
        credentials: { email: ownerEmail, password },
        preferred: true,
      },
    });
    expect(ownerConnect.ok(), await ownerConnect.text()).toBeTruthy();

    const ownerSharesRes = await request.get(`${ownerBase}/integrations/shares?fast=1`);
    expect(ownerSharesRes.ok()).toBeTruthy();
    const ownerSharesBody = (await ownerSharesRes.json()) as SharesList;
    const ownerShare = ownerSharesBody.shares?.find(
      (s) => s.share.provider === 'mega' && s.share.role === 'owner'
    );
    expect(ownerShare, 'owner managed share').toBeTruthy();
    ownerShareId = ownerShare!.share.id;
    ownerLocalPath = ownerShare!.share.localPath;

    const ownerStateDeadline = Date.now() + 120_000;
    while (Date.now() < ownerStateDeadline) {
      const st = await request.get(`${ownerBase}/integrations/shares/${encodeURIComponent(ownerShareId)}/state?fast=1`);
      if (st.ok()) {
        const j = (await st.json()) as { summary?: { state?: { status?: string } } };
        if (j.summary?.state?.status === 'ready') {
          break;
        }
      }
      await new Promise((r) => setTimeout(r, 2_000));
    }

    const invite = await request.post(`${ownerBase}/integrations/shares/${encodeURIComponent(ownerShareId)}/invite`, {
      data: { emails: [recipientEmail] },
    });
    expect(invite.ok(), await invite.text()).toBeTruthy();

    recipientProc = startServer({ port: recipientPort, storageDir: recipientStorage, rootsConfigPath: recipientRoots });
    await waitForHealth(recipientBase);

    const recipientConnect = await request.post(`${recipientBase}/integrations/accounts/connect`, {
      data: {
        provider: 'mega',
        credentials: { email: recipientEmail, password },
        preferred: true,
      },
    });
    expect(recipientConnect.ok(), await recipientConnect.text()).toBeTruthy();

    let offer:
      | NonNullable<IncomingList['shares']>[number]
      | undefined;
    const incomingDeadline = Date.now() + 180_000;
    while (Date.now() < incomingDeadline) {
      const inc = await request.get(`${recipientBase}/integrations/shares/incoming`);
      expect(inc.ok(), await inc.text()).toBeTruthy();
      const body = (await inc.json()) as IncomingList;
      offer = body.shares?.find((s) => s.provider === 'mega');
      if (offer) {
        break;
      }
      await new Promise((r) => setTimeout(r, 3_000));
    }
    expect(offer, 'incoming MEGA share not visible yet').toBeTruthy();

    recipientLocalPath = await mkdtemp(path.join(os.tmpdir(), 'nearbytes-e2e-recipient-mirror-'));
    const accept = await request.post(`${recipientBase}/integrations/shares/accept`, {
      data: {
        provider: 'mega',
        accountId: offer!.accountId,
        label: offer!.label,
        localPath: recipientLocalPath,
        remoteDescriptor: offer!.remoteDescriptor,
      },
    });
    expect(accept.ok(), await accept.text()).toBeTruthy();
    const acceptBody = (await accept.json()) as { summary?: { share?: { id: string } } };
    recipientShareId = acceptBody.summary!.share!.id;

    const recipientReadyDeadline = Date.now() + 240_000;
    while (Date.now() < recipientReadyDeadline) {
      const st = await request.get(
        `${recipientBase}/integrations/shares/${encodeURIComponent(recipientShareId)}/state?fast=1`
      );
      if (st.ok()) {
        const j = (await st.json()) as { summary?: { state?: { status?: string } } };
        if (j.summary?.state?.status === 'ready') {
          break;
        }
      }
      await new Promise((r) => setTimeout(r, 3_000));
    }
    const rs = await request.get(`${recipientBase}/integrations/shares/${encodeURIComponent(recipientShareId)}/state?fast=1`);
    const rsj = (await rs.json()) as { summary?: { state?: { status?: string } } };
    expect(rsj.summary?.state?.status, 'recipient share not ready').toBe('ready');

    blockBytes = new TextEncoder().encode(`two-account-e2e-${Date.now()}\n`);
    const hash = await sha256Hex(blockBytes);
    blockRelPath = `blocks/${hash}.bin`;
    await mkdir(path.join(ownerLocalPath, 'blocks'), { recursive: true });
    await writeFile(path.join(ownerLocalPath, blockRelPath), blockBytes);

    const push = await request.post(
      `${ownerBase}/__debug/integrations/shares/${encodeURIComponent(ownerShareId)}/push-path`,
      { data: { path: blockRelPath } }
    );
    expect(push.ok(), await push.text()).toBeTruthy();

    const mirrorDeadline = Date.now() + 300_000;
    const targetFile = path.join(recipientLocalPath, blockRelPath);
    while (Date.now() < mirrorDeadline) {
      try {
        await access(targetFile);
        const got = await readFile(targetFile);
        expect(Buffer.from(got).equals(Buffer.from(blockBytes))).toBe(true);
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 4_000));
      }
    }
    throw new Error(`Recipient mirror never received ${blockRelPath}`);
  });

  test.afterAll(async () => {
    await killServer(ownerProc);
    await killServer(recipientProc);
  });
});
