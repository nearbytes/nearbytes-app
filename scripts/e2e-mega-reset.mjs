#!/usr/bin/env node
/**
 * Destructively resets the E2E MEGA accounts:
 * 1. revoke cross-account shares,
 * 2. wipe Cloud Drive + Rubbish Bin,
 * 3. rebuild the ^!keys attribute from the surviving account keys so official clients stay usable.
 *
 * Requires the same env as the wipe script and sets
 * NEARBYTES_ALLOW_DESTRUCTIVE_MEGA_E2E_WIPE=1 internally.
 *
 * Usage: yarn e2e:mega-reset
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

const {
  rebuildMegaSecurityAttributeForE2e,
  revokeMegaOutgoingSharesForPeers,
  wipeMegaCloudDriveContentsForE2e,
} = await import('../dist/integrations/mega.js');

const RESET_TIMEOUT_MS = Number.parseInt(
  process.env.NEARBYTES_E2E_MEGA_RESET_TIMEOUT_MS ?? String(20 * 60 * 1000),
  10
);

function startOptionalTimeout(controller) {
  if (!Number.isFinite(RESET_TIMEOUT_MS) || RESET_TIMEOUT_MS <= 0) {
    return null;
  }
  return setTimeout(() => controller.abort(), RESET_TIMEOUT_MS);
}

function clearOptionalTimeout(timer) {
  if (timer) {
    clearTimeout(timer);
  }
}

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
  const peers = emails.filter((entry) => entry !== email);
  const revokeController = new AbortController();
  const revokeTimer = startOptionalTimeout(revokeController);
  try {
    console.error(`[e2e-mega-reset] ${email}: revoke outgoing shares to peers...`);
    const { revokedCount } = await revokeMegaOutgoingSharesForPeers({
      email,
      password,
      peerEmails: peers,
      signal: revokeController.signal,
    });
    console.error(`[e2e-mega-reset] ${email}: revoked ${revokedCount} outgoing share row(s).`);
  } finally {
    clearOptionalTimeout(revokeTimer);
  }
}

for (const email of emails) {
  const wipeController = new AbortController();
  const wipeTimer = startOptionalTimeout(wipeController);
  try {
    console.error(`[e2e-mega-reset] ${email}: wipe Cloud Drive + Rubbish Bin...`);
    const { deletedNodeCount } = await wipeMegaCloudDriveContentsForE2e({
      email,
      password,
      signal: wipeController.signal,
    });
    console.error(`[e2e-mega-reset] ${email}: deleted ${deletedNodeCount} top-level node(s).`);
  } finally {
    clearOptionalTimeout(wipeTimer);
  }
}

for (const email of emails) {
  const resetController = new AbortController();
  const resetTimer = startOptionalTimeout(resetController);
  try {
    console.error(`[e2e-mega-reset] ${email}: rebuild ^!keys security attribute...`);
    const { generation } = await rebuildMegaSecurityAttributeForE2e({
      email,
      password,
      signal: resetController.signal,
    });
    console.error(`[e2e-mega-reset] ${email}: ^!keys rebuilt at generation ${generation}.`);
  } finally {
    clearOptionalTimeout(resetTimer);
  }
}

console.error('[e2e-mega-reset] completed.');