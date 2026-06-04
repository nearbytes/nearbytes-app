#!/usr/bin/env node
/**
 * Re-resolve every `github:nearbytes/*` dependency to latest main (`yarn up`).
 * Run from `yarn dev` or explicitly via `yarn refresh`.
 */
import { readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function nearbytesDescriptors() {
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  const out = new Set();
  for (const section of [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
    'resolutions',
  ]) {
    const deps = pkg[section];
    if (!deps || typeof deps !== 'object') continue;
    for (const [name, spec] of Object.entries(deps)) {
      if (typeof spec !== 'string') continue;
      const m = /^github:nearbytes\/([^#]+)/.exec(spec);
      if (m) out.add(`${name}@github:nearbytes/${m[1]}`);
    }
  }
  return [...out];
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: true, env: process.env });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const descriptors = nearbytesDescriptors();
if (descriptors.length === 0) {
  console.log('[refresh] no github:nearbytes dependencies — skip');
  process.exit(0);
}

console.log(
  `[refresh] re-resolving ${descriptors.length} nearbytes-* package(s) to latest GitHub HEAD…`,
);
run('yarn', ['up', ...descriptors]);

if (pkg.devDependencies?.['electron-vite'] !== undefined) {
  try {
    rmSync(resolve(root, 'node_modules/.vite'), { recursive: true, force: true });
    console.log('[refresh] cleared node_modules/.vite');
  } catch {
    /* nothing to clear */
  }
}

console.log('[refresh] done.');
