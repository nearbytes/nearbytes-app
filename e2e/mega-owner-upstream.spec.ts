import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { test, expect } from '@playwright/test';

async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

type SharesResponse = {
  shares?: Array<{
    share: { id: string; provider: string; role: string; localPath: string };
    state?: { status?: string };
  }>;
};

type StateResponse = {
  summary?: { state?: { status?: string } };
};

/**
 * Verifies the writable MEGA owner mirror can push a canonical storage file to MEGA via the API.
 *
 * **Fully automatic (recommended):** set credentials (never commit them; use `.env.e2e` — gitignored — or your shell):
 *   - `NEARBYTES_E2E_MEGA_EMAIL`
 *   - `NEARBYTES_E2E_MEGA_PASSWORD`
 *   The test connects MEGA, picks the default owner share, writes a content-addressed block under its
 *   `localPath`, waits until the share is `ready`, then push-path + remote-entry probe.
 *
 * **Manual:** skip credentials and set:
 *   - `NEARBYTES_E2E_API` — base URL (default in playwright.config is http://127.0.0.1:3000)
 *   - `NEARBYTES_E2E_MEGA_SHARE_ID`
 *   - `NEARBYTES_E2E_BLOCK_REL_PATH` — e.g. blocks/<64-hex>.bin
 *
 * Run: `yarn test:e2e e2e/mega-owner-upstream.spec.ts`
 */
test.describe('MEGA owner upstream (live API)', () => {
  test(
    'force push-path then remote-entry probe shows file on MEGA',
    async ({ request, baseURL }) => {
      const apiRoot = (process.env.NEARBYTES_E2E_API ?? baseURL ?? '').replace(/\/$/u, '');
      test.skip(!apiRoot, 'Set NEARBYTES_E2E_API or playwright baseURL');

      const megaEmail = process.env.NEARBYTES_E2E_MEGA_EMAIL?.trim();
      const megaPassword = process.env.NEARBYTES_E2E_MEGA_PASSWORD ?? '';
      let shareId = process.env.NEARBYTES_E2E_MEGA_SHARE_ID?.trim();
      let relPath = process.env.NEARBYTES_E2E_BLOCK_REL_PATH?.trim();

      if (megaEmail && megaPassword) {
        const connect = await request.post(`${apiRoot}/integrations/accounts/connect`, {
          data: {
            provider: 'mega',
            credentials: { email: megaEmail, password: megaPassword },
            preferred: true,
          },
        });
        expect(
          connect.ok(),
          `MEGA connect failed: ${connect.status()} ${await connect.text()}`
        ).toBeTruthy();

        const list = await request.get(`${apiRoot}/integrations/shares?fast=1`);
        expect(list.ok(), `list shares failed: ${list.status()} ${await list.text()}`).toBeTruthy();
        const body = (await list.json()) as SharesResponse;
        const shares = body.shares ?? [];

        const pick =
          (shareId
            ? shares.find((s) => s.share.id === shareId)
            : undefined) ??
          shares.find((s) => s.share.provider === 'mega' && s.share.role === 'owner');

        expect(pick, 'No MEGA owner managed share found after connect').toBeTruthy();
        shareId = pick!.share.id;

        if (!relPath) {
          const payload = new TextEncoder().encode(`nearbytes-e2e-${Date.now()}\n`);
          const hash = await sha256Hex(payload);
          relPath = `blocks/${hash}.bin`;
          const blockAbs = path.join(pick!.share.localPath, relPath);
          await mkdir(path.dirname(blockAbs), { recursive: true });
          await writeFile(blockAbs, payload);
        }

        const deadline = Date.now() + 120_000;
        while (Date.now() < deadline) {
          const st = await request.get(
            `${apiRoot}/integrations/shares/${encodeURIComponent(shareId!)}/state?fast=1`
          );
          if (st.ok()) {
            const stateBody = (await st.json()) as StateResponse;
            if (stateBody.summary?.state?.status === 'ready') {
              break;
            }
          }
          await new Promise((r) => setTimeout(r, 2000));
        }
        const finalState = await request.get(
          `${apiRoot}/integrations/shares/${encodeURIComponent(shareId!)}/state?fast=1`
        );
        expect(finalState.ok()).toBeTruthy();
        const finalJson = (await finalState.json()) as StateResponse;
        expect(finalJson.summary?.state?.status, 'Owner share did not reach ready in time').toBe('ready');
      } else {
        test.skip(
          !shareId || !relPath,
          'Set NEARBYTES_E2E_MEGA_EMAIL and NEARBYTES_E2E_MEGA_PASSWORD for full auto, or SHARE_ID and BLOCK_REL_PATH'
        );
      }

      const push = await request.post(
        `${apiRoot}/__debug/integrations/shares/${encodeURIComponent(shareId!)}/push-path`,
        {
          data: { path: relPath },
        }
      );
      expect(push.ok(), `push-path failed: ${push.status()} ${await push.text()}`).toBeTruthy();

      const probe = await request.get(
        `${apiRoot}/__debug/integrations/shares/${encodeURIComponent(shareId!)}/remote-entry?path=${encodeURIComponent(relPath!)}`
      );
      expect(probe.ok(), `remote-entry failed: ${probe.status()} ${await probe.text()}`).toBeTruthy();

      const probeBody = (await probe.json()) as { exists?: boolean; entry?: { kind?: string } };
      expect(
        probeBody.exists,
        'Remote entry missing after push — owner upstream not visible on MEGA yet'
      ).toBe(true);
      expect(probeBody.entry?.kind).toBe('file');
    },
    { timeout: 180_000 }
  );
});
