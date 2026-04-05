import { test, expect, type Page } from '@playwright/test';

/**
 * Logs into mega.nz in a real browser. Useful when server-side MEGA API calls return HTTP 402
 * or are otherwise blocked outside a normal browser context, and as a parity check for
 * Cursor IDE browser MCP flows.
 *
 * Credentials: same as other live MEGA e2e — `NEARBYTES_E2E_MEGA_EMAIL` and
 * `NEARBYTES_E2E_MEGA_PASSWORD` (e.g. repo-root `.env.e2e`, gitignored).
 *
 * Run: `yarn test:e2e e2e/mega-browser-login.spec.ts`
 *
 * Requires: `yarn playwright install chromium` (project devDependency; no global install).
 */
async function dismissOptionalBlockingUi(page: Page): Promise<void> {
  const tryClick = async (pattern: RegExp): Promise<void> => {
    const btn = page.getByRole('button', { name: pattern }).first();
    try {
      await btn.click({ timeout: 2000 });
    } catch {
      /* not shown */
    }
  };
  await tryClick(/^Update$/iu);
  await tryClick(/accept all|accept|agree|allow all|only necessary/iu);
}

test.describe('MEGA browser login (live mega.nz)', () => {
  test('reaches logged-in file manager / Cloud drive', async ({ page }) => {
    const email = process.env.NEARBYTES_E2E_MEGA_EMAIL?.trim();
    const password = process.env.NEARBYTES_E2E_MEGA_PASSWORD ?? '';
    test.skip(!email || !password, 'Set NEARBYTES_E2E_MEGA_EMAIL and NEARBYTES_E2E_MEGA_PASSWORD');

    await page.goto('https://mega.nz/login', { waitUntil: 'domcontentloaded' });
    await dismissOptionalBlockingUi(page);

    await page.getByRole('textbox', { name: /your email address/i }).fill(email!);
    await page.getByRole('textbox', { name: /^password$/iu }).fill(password);
    await dismissOptionalBlockingUi(page);

    await page.getByRole('button', { name: /^log in$/iu }).click();

    await expect
      .poll(
        async () => {
          if (/mega\.nz\/fm(?:\/|\?|$)/u.test(page.url())) {
            return true;
          }
          return page.getByText('Cloud drive', { exact: true }).isVisible();
        },
        { timeout: 120_000 }
      )
      .toBe(true);
  });
});
