import { Buffer } from 'buffer';
import type { MegaFsModuleLike, MegaFsWatcher } from './core.js';

type MegaNodeCryptoModule = typeof import('node:crypto') | typeof import('crypto');

interface MegaRuntimeGlobalScope {
  __nearbytesMegaFs?: MegaFsModuleLike;
}

let megaNodeCryptoModule: MegaNodeCryptoModule | null = null;
let megaNodeCryptoModulePromise: Promise<MegaNodeCryptoModule> | null = null;
let megaNodeFsModulePromise: Promise<typeof import('node:fs/promises') | typeof import('fs/promises')> | null = null;
let megaChokidarModulePromise: Promise<{ default: { watch(...args: unknown[]): MegaFsWatcher } }> | null = null;

export async function ensureMegaNodeCrypto(): Promise<MegaNodeCryptoModule> {
  if (megaNodeCryptoModule) {
    return megaNodeCryptoModule;
  }
  if (!megaNodeCryptoModulePromise) {
    megaNodeCryptoModulePromise = import('node:crypto')
      .catch(() => import('crypto'))
      .then((module) => {
        megaNodeCryptoModule = module;
        return module;
      });
  }
  return megaNodeCryptoModulePromise;
}

export function getMegaNodeCrypto(): MegaNodeCryptoModule {
  if (megaNodeCryptoModule) {
    return megaNodeCryptoModule;
  }
  throw new Error('MEGA Node crypto is not initialized.');
}

export function randomBytes(size: number): Buffer {
  if (megaNodeCryptoModule) {
    return megaNodeCryptoModule.randomBytes(size);
  }
  if (globalThis.crypto?.getRandomValues) {
    const bytes = new Uint8Array(size);
    globalThis.crypto.getRandomValues(bytes);
    return Buffer.from(bytes);
  }
  return getMegaNodeCrypto().randomBytes(size);
}

export function getMegaWebCrypto(): Crypto {
  if (globalThis.crypto?.subtle) {
    return globalThis.crypto;
  }
  return getMegaNodeCrypto().webcrypto as Crypto;
}

export async function getMegaChokidar(): Promise<{ default: { watch(...args: unknown[]): MegaFsWatcher } }> {
  if (!megaChokidarModulePromise) {
    const moduleName = 'chokidar';
    megaChokidarModulePromise = import(/* @vite-ignore */ moduleName) as Promise<{
      default: { watch(...args: unknown[]): MegaFsWatcher };
    }>;
  }
  return megaChokidarModulePromise;
}

export function isMegaFsModuleLike(
  value: unknown
): value is typeof import('node:fs/promises') | typeof import('fs/promises') | MegaFsModuleLike {
  return typeof (value as { mkdir?: unknown } | null)?.mkdir === 'function';
}

export function getMegaRuntimeFsShim(): MegaFsModuleLike | null {
  const shim = (globalThis as typeof globalThis & MegaRuntimeGlobalScope).__nearbytesMegaFs;
  return isMegaFsModuleLike(shim) ? shim : null;
}

export async function getMegaNodeFs(): Promise<typeof import('node:fs/promises') | typeof import('fs/promises') | MegaFsModuleLike> {
  if (!megaNodeFsModulePromise) {
    megaNodeFsModulePromise = import('node:fs/promises').catch(() => import('fs/promises'));
  }
  const moduleValue = await megaNodeFsModulePromise;
  if (isMegaFsModuleLike(moduleValue)) {
    return moduleValue;
  }
  const shim = getMegaRuntimeFsShim();
  if (shim) {
    // docs/specs/transport/mega-runtime-v0.1.md and docs/specs/storage-integration-stack-v1.md
    // require the self-contained phone runtime to materialize the same canonical MEGA files locally
    // without depending on a separate dev API server or Node-only filesystem modules.
    return shim;
  }
  throw new Error('MEGA filesystem runtime is unavailable.');
}
