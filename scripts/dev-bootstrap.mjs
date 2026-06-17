#!/usr/bin/env node
/**
 * Dev entry bootstrap: install deps, optional update, refresh nearbytes-* to main.
 * Wired from `yarn dev` in consumer repos.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { maybeReexecNvmrc } from './maybe-reexec-nvmrc.mjs';
import { runNode, runYarn } from './toolchain.mjs';

const entry = fileURLToPath(import.meta.url);
maybeReexecNvmrc(entry);
const root = resolve(dirname(entry), '..');

const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

const linkLocal = resolve(root, '../nearbytes-engine/scripts/link-local-deps.mjs');
if (existsSync(linkLocal)) {
  console.log('[dev] link local nearbytes deps');
  runNode(root, [linkLocal]);
}

console.log('[dev] yarn install');
runYarn(root, ['install']);

console.log('[dev] ensure engines');
runNode(root, ['scripts/ensure-engines.mjs', '--electron']);

if (pkg.scripts?.update) {
  console.log('[dev] yarn update');
  runYarn(root, ['update']);
}

if (pkg.scripts?.refresh) {
  console.log('[dev] yarn refresh');
  runYarn(root, ['refresh']);
}

console.log('[dev] bootstrap done.');
