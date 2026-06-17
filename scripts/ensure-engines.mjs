#!/usr/bin/env node
/**
 * Enforce package.json `engines` before dev/build.
 * For Electron apps, also verify the bundled runtime exposes `node:sqlite`
 * (nearbytes-log projection persistence; requires Electron >= 36.7).
 */
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

function parseMinVersion(range) {
  if (typeof range !== 'string') return null;
  const m = />=?\s*([\d.]+)/.exec(range);
  return m?.[1] ?? null;
}

function versionGte(actual, required) {
  const a = actual.split('.').map((n) => Number(n));
  const r = required.split('.').map((n) => Number(n));
  for (let i = 0; i < Math.max(a.length, r.length); i++) {
    const av = a[i] ?? 0;
    const rv = r[i] ?? 0;
    if (av > rv) return true;
    if (av < rv) return false;
  }
  return true;
}

const minNode = parseMinVersion(pkg.engines?.node);
if (minNode && !versionGte(process.versions.node, minNode)) {
  console.error(
    `[engines] shell Node ${process.versions.node} is too old; need >= ${minNode} ` +
      `(see package.json engines.node).\n` +
      `  Tip: yarn dev auto-installs Node from .nvmrc under .local/toolchain, or use fnm/nvm.`,
  );
  process.exit(1);
}

const checkElectron = process.argv.includes('--electron');
if (!checkElectron || !pkg.devDependencies?.electron) {
  if (minNode) {
    console.log(`[engines] ok — node ${process.versions.node} (>= ${minNode})`);
  }
  process.exit(0);
}

const electronCli = resolve(root, 'node_modules/electron/cli.js');
if (!existsSync(electronCli)) {
  console.error('[engines] electron is not installed — run yarn install first.');
  process.exit(1);
}

const probe = spawnSync(
  electronCli,
  ['-e', "import('node:sqlite').then(()=>process.exit(0)).catch(()=>process.exit(2))"],
  {
    cwd: root,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'pipe',
    timeout: 15_000,
  },
);

if (probe.status === 0) {
  const electronPkg = require('electron/package.json');
  console.log(
    `[engines] ok — shell node ${process.versions.node}, electron ${electronPkg.version} ` +
      `(node:sqlite in Electron runtime)`,
  );
  process.exit(0);
}

const electronPkg = require('electron/package.json');
console.error(
  `[engines] electron ${electronPkg.version} lacks built-in node:sqlite.\n` +
    `  nearbytes-log projection persistence needs Electron >= 36.7 (Node 22+).\n` +
    `  Fix: yarn up electron@^36.7.0`,
);
process.exit(1);
