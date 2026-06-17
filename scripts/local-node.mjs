/**
 * Download and cache official Node binaries under `.local/toolchain/`.
 * Used when fnm/nvm are unavailable but `.nvmrc` requires a newer runtime.
 */
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDir = dirname(fileURLToPath(import.meta.url));

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

export function projectRoot(from = scriptsDir) {
  return resolve(from, '..');
}

export function readNvmrcVersion(root) {
  const raw = readFileSync(resolve(root, '.nvmrc'), 'utf8').trim().replace(/^v/, '');
  if (!raw) throw new Error('.nvmrc is empty');
  return raw;
}

function nodePlatformTag() {
  const { platform, arch } = process;
  if (platform === 'darwin' && arch === 'arm64') return 'darwin-arm64';
  if (platform === 'darwin' && arch === 'x64') return 'darwin-x64';
  if (platform === 'linux' && arch === 'x64') return 'linux-x64';
  if (platform === 'linux' && arch === 'arm64') return 'linux-arm64';
  throw new Error(`Unsupported platform for local Node: ${platform}-${arch}`);
}

function fetchText(url) {
  for (const [cmd, args] of [
    ['curl', ['-fsSL', url]],
    ['wget', ['-qO-', url]],
  ]) {
    const r = spawnSync(cmd, args, { encoding: 'utf8' });
    if (r.status === 0 && r.stdout) return r.stdout;
  }
  throw new Error('curl or wget is required to download Node (see .nvmrc)');
}

/** Map `.nvmrc` major.minor to the newest matching official release. */
function resolveFullNodeVersion(partial) {
  const trimmed = partial.trim().replace(/^v/, '');
  const parts = trimmed.split('.');
  if (parts.length >= 3) return trimmed;

  const prefix = `v${trimmed}`;
  const index = JSON.parse(fetchText('https://nodejs.org/dist/index.json'));
  const matches = index
    .map((entry) => entry.version)
    .filter((version) => version === prefix || version.startsWith(`${prefix}.`));
  if (matches.length === 0) {
    throw new Error(`No official Node release matches .nvmrc "${partial}"`);
  }
  matches.sort((a, b) => {
    const av = a.slice(1).split('.').map(Number);
    const bv = b.slice(1).split('.').map(Number);
    for (let i = 0; i < 3; i++) {
      if (av[i] !== bv[i]) return av[i] - bv[i];
    }
    return 0;
  });
  return matches[matches.length - 1].slice(1);
}

function localNodeHome(root, fullVersion, platform = nodePlatformTag()) {
  return resolve(root, '.local', 'toolchain', `node-v${fullVersion}-${platform}`);
}

function localNodeBin(root, fullVersion, platform = nodePlatformTag()) {
  return resolve(localNodeHome(root, fullVersion, platform), 'bin', 'node');
}

function nodeBinaryReady(bin, fullVersion) {
  if (!existsSync(bin)) return false;
  const r = spawnSync(bin, ['-p', 'process.versions.node'], { encoding: 'utf8' });
  if (r.status !== 0) return false;
  const actual = (r.stdout ?? '').trim();
  return actual === fullVersion || versionGte(actual, fullVersion);
}

function installLocalNode(root, fullVersion, platform) {
  const toolchainDir = resolve(root, '.local', 'toolchain');
  const home = localNodeHome(root, fullVersion, platform);
  const archive = `node-v${fullVersion}-${platform}.tar.xz`;
  const url = `https://nodejs.org/dist/v${fullVersion}/${archive}`;
  const script = `
set -euo pipefail
mkdir -p ${JSON.stringify(toolchainDir)}
cd ${JSON.stringify(toolchainDir)}
if [ ! -x ${JSON.stringify(resolve(home, 'bin', 'node'))} ]; then
  echo "[node] downloading Node v${fullVersion} (${platform})…"
  tmp=${JSON.stringify(resolve(toolchainDir, archive))}
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL ${JSON.stringify(url)} -o "$tmp"
  elif command -v wget >/dev/null 2>&1; then
    wget -q ${JSON.stringify(url)} -O "$tmp"
  else
    echo "curl or wget is required to download Node v${fullVersion}" >&2
    exit 127
  fi
  tar -xJf "$tmp"
  rm -f "$tmp"
fi
`;
  const r = spawnSync('bash', ['-c', script], { cwd: root, stdio: 'inherit' });
  if (r.status !== 0) {
    throw new Error(`Failed to install local Node v${fullVersion} under .local/toolchain`);
  }
}

/** Ensure `.local/toolchain` contains the `.nvmrc` Node and return its `node` path. */
export function ensureLocalNodeBin(root, nvmrcVersion = readNvmrcVersion(root)) {
  const fullVersion = resolveFullNodeVersion(nvmrcVersion);
  const platform = nodePlatformTag();
  const bin = localNodeBin(root, fullVersion, platform);
  if (!nodeBinaryReady(bin, fullVersion)) {
    installLocalNode(root, fullVersion, platform);
  }
  if (!nodeBinaryReady(bin, fullVersion)) {
    throw new Error(`Local Node v${fullVersion} is missing after install (${bin})`);
  }
  return bin;
}
