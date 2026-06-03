#!/usr/bin/env node
/**
 * Fetch + build the freshest NearBytes packages straight from GitHub.
 *
 * There are NO local-sibling dependencies. Every UI/engine package is consumed
 * as `github:nearbytes/<pkg>` and built by its own `prepare`/`prepack` script
 * during install. This script re-resolves those git refs to the latest commit
 * on their default branch (Yarn rebuilds only the ones that actually moved),
 * then drops the Vite dep pre-bundle cache so the renderer never serves a stale
 * copy of a UI package.
 *
 * Run automatically by `yarn dev` / `yarn build`; also available as `yarn refresh`.
 */
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const NEARBYTES_PACKAGES = [
  'nearbytes-crypto',
  'nearbytes-log',
  'nearbytes-skeleton',
  'nearbytes-files',
  'nearbytes-chat',
  'nearbytes-sync',
  'nearbytes-engine',
  'nearbytes-widgets',
  'nearbytes-components',
];

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: appRoot, stdio: 'inherit', shell: true, env: process.env });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

// Git dependencies must be re-resolved by their FULL descriptor — a bare
// `yarn up <name>` is interpreted as a semver range and fails for git refs.
const descriptors = NEARBYTES_PACKAGES.map((name) => `${name}@github:nearbytes/${name}`);

console.log('[refresh] re-resolving nearbytes-* to latest GitHub HEAD (rebuilds what changed)…');
run('yarn', ['up', ...descriptors]);

// Never let Vite serve a stale pre-bundle of a just-updated UI package.
try {
  rmSync(resolve(appRoot, 'node_modules/.vite'), { recursive: true, force: true });
  console.log('[refresh] cleared node_modules/.vite');
} catch {
  /* nothing to clear */
}

console.log('[refresh] fresh build pipeline ready.');
