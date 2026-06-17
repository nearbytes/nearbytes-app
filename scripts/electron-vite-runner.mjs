#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2];

if (!mode || !['dev', 'preview'].includes(mode)) {
  console.error('Usage: node scripts/electron-vite-runner.mjs <dev|preview>');
  process.exit(2);
}

const extraArgs = process.argv.slice(3);
const args = [mode, ...extraArgs];
if (process.platform === 'linux') {
  args.push('--', '--no-sandbox', '--disable-setuid-sandbox');
}

const r = spawnSync(resolve(root, 'node_modules/.bin/electron-vite'), args, {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
});
process.exit(r.status ?? 0);
