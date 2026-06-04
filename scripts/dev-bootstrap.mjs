#!/usr/bin/env node
/**
 * Dev entry bootstrap: install deps, optional update, refresh nearbytes-* to main.
 * Wired from `yarn dev` in consumer repos.
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: true, env: process.env });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

console.log('[dev] yarn install');
run('yarn', ['install']);

if (pkg.scripts?.update) {
  console.log('[dev] yarn update');
  run('yarn', ['update']);
}

if (pkg.scripts?.refresh) {
  console.log('[dev] yarn refresh');
  run('yarn', ['refresh']);
}

console.log('[dev] bootstrap done.');
