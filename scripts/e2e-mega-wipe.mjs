#!/usr/bin/env node
/**
 * Destructively revokes outgoing cross-shares between listed accounts, then clears Cloud Drive + Rubbish Bin.
 *
 * Requires:
 *   - `yarn build`
 *   - NEARBYTES_ALLOW_DESTRUCTIVE_MEGA_E2E_WIPE=1 (set automatically below)
 *   - NEARBYTES_E2E_MEGA_PASSWORD
 *   - NEARBYTES_E2E_MEGA_ACCOUNTS — comma-separated emails, OR
 *     NEARBYTES_E2E_MEGA_OWNER_EMAIL + NEARBYTES_E2E_MEGA_RECIPIENT_EMAIL
 *
 * Loads repo-root `.env.e2e` when present (same keys as Playwright).
 *
 * Usage: `yarn e2e:mega-wipe`
 */

import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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

process.env.NEARBYTES_ALLOW_DESTRUCTIVE_MEGA_E2E_WIPE = '1';

const { revokeMegaOutgoingSharesForPeers, wipeMegaCloudDriveContentsForE2e } = await import('../dist/integrations/mega.js');

const WIPE_TIMEOUT_MS = 20 * 60 * 1000;

const password = process.env.NEARBYTES_E2E_MEGA_PASSWORD ?? '';
const fromList = process.env.NEARBYTES_E2E_MEGA_ACCOUNTS?.trim();
const owner = process.env.NEARBYTES_E2E_MEGA_OWNER_EMAIL?.trim();
const recipient = process.env.NEARBYTES_E2E_MEGA_RECIPIENT_EMAIL?.trim();
const emails = (
  fromList
    ? fromList.split(',').map((s) => s.trim())
    : [owner, recipient].filter(Boolean)
).filter((e, i, a) => e.length > 0 && a.indexOf(e) === i);

if (!password || emails.length === 0) {
  console.error(
    'Missing env: NEARBYTES_E2E_MEGA_PASSWORD and either NEARBYTES_E2E_MEGA_ACCOUNTS or OWNER+RECIPIENT emails.'
  );
  process.exit(1);
}

for (const email of emails) {
  const peers = emails.filter((e) => e !== email);
  console.error(`[e2e-mega-wipe] ${email}: revoke outgoing shares to peers…`);
  const revokeController = new AbortController();
  const revokeTimer = setTimeout(() => revokeController.abort(), WIPE_TIMEOUT_MS);
  try {
    const { revokedCount } = await revokeMegaOutgoingSharesForPeers({
      email,
      password,
      peerEmails: peers,
      signal: revokeController.signal,
    });
    console.error(`[e2e-mega-wipe] ${email} revoked ${revokedCount} outgoing share row(s).`);
  } finally {
    clearTimeout(revokeTimer);
  }
}

for (const email of emails) {
  console.error(`[e2e-mega-wipe] ${email}: wipe Cloud Drive + Rubbish…`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WIPE_TIMEOUT_MS);
  try {
    const { deletedNodeCount } = await wipeMegaCloudDriveContentsForE2e({ email, password, signal: controller.signal });
    console.error(`[e2e-mega-wipe] ${email} deleted ${deletedNodeCount} node(s).`);
  } finally {
    clearTimeout(timer);
  }
}
