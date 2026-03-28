import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Load `.env.e2e` if present; does not override variables already set in the environment. */
function applyEnvE2eFile(): void {
  const envPath = path.join(__dirname, '.env.e2e');
  if (!existsSync(envPath)) {
    return;
  }
  const text = readFileSync(envPath, 'utf8');
  for (const rawLine of text.split(/\r?\n/u)) {
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
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

applyEnvE2eFile();

/**
 * Live checks against a running Nearbytes API (loopback only; debug routes enforce local client).
 *
 * Optional: create repo-root `.env.e2e` (gitignored) with `NEARBYTES_E2E_MEGA_EMAIL` / `_PASSWORD` etc.
 *
 * Browsers: `yarn playwright install` (uses the project's devDependency, no global install).
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  use: {
    baseURL: process.env.NEARBYTES_E2E_API ?? 'http://127.0.0.1:3000',
  },
});
