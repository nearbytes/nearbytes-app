#!/usr/bin/env node
/**
 * Re-exec `entryScript` under Node from `.nvmrc` when needed.
 * Order: keep current Node if sufficient -> fnm/nvm -> `.local/toolchain` download.
 */
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureLocalNodeBin, readNvmrcVersion } from './local-node.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const reexecFlag = 'NB_NVMRC_REEXEC';

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

export function maybeReexecNvmrc(entryScript, extraArgs = []) {
  if (process.env[reexecFlag] === '1') return;
  if (!existsSync(resolve(root, '.nvmrc'))) return;

  const wanted = readNvmrcVersion(root);
  if (versionGte(process.versions.node, wanted)) return;

  const script = `
set -e
cd ${JSON.stringify(root)}
if command -v fnm >/dev/null 2>&1; then
  eval "$(fnm env)"
  fnm use
elif [ -s "$HOME/.nvm/nvm.sh" ]; then
  . "$HOME/.nvm/nvm.sh"
  nvm use
else
  exit 2
fi
export ${reexecFlag}=1
exec node ${JSON.stringify(entryScript)} ${extraArgs.map((a) => JSON.stringify(a)).join(' ')}
`;

  const r = spawnSync('bash', ['-c', script], { cwd: root, stdio: 'inherit', env: process.env });
  if (r.status === 2) {
    const bin = ensureLocalNodeBin(root, wanted);
    const env = { ...process.env, [reexecFlag]: '1' };
    const r2 = spawnSync(bin, [entryScript, ...extraArgs], { cwd: root, stdio: 'inherit', env });
    process.exit(r2.status ?? 0);
  }
  process.exit(r.status ?? 0);
}
