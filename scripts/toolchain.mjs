/**
 * Run yarn/node via the active Node toolchain (never distro corepack on PATH).
 */
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

function corepackBin() {
  return resolve(dirname(process.execPath), 'corepack');
}

function run(argv, { cwd, env = process.env }) {
  const r = spawnSync(argv[0], argv.slice(1), { cwd, stdio: 'inherit', env });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

/** Run a Node script with this same Node binary. */
export function runNode(cwd, nodeArgs, env = process.env) {
  run([process.execPath, ...nodeArgs], { cwd, env });
}

/** Run Yarn via corepack next to `process.execPath` (no global corepack enable). */
export function runYarn(cwd, yarnArgs, env = process.env) {
  const corepack = corepackBin();
  if (existsSync(corepack)) {
    run([corepack, 'yarn', ...yarnArgs], { cwd, env });
    return;
  }
  run(['yarn', ...yarnArgs], { cwd, env });
}
