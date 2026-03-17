/**
 * Default storage directory resolution.
 */

import path from 'path';
import os from 'os';

/** Default Nearbytes storage container. */
const DEFAULT_STORAGE_HOME_DIR = path.join(os.homedir(), 'nearbytes');

/** Default local storage path. Can be moved to any local or synced folder via NEARBYTES_STORAGE_DIR. */
const DEFAULT_STORAGE_DIR = path.join(DEFAULT_STORAGE_HOME_DIR, 'local');

/**
 * Returns the primary local storage root directory. If NEARBYTES_STORAGE_DIR is set,
 * uses that; otherwise uses the default local path ($HOME/nearbytes/local).
 */
export function getDefaultStorageDir(): string {
  if (typeof process !== 'undefined' && process.env?.NEARBYTES_STORAGE_DIR) {
    return process.env.NEARBYTES_STORAGE_DIR;
  }
  return DEFAULT_STORAGE_DIR;
}

/**
 * Returns the parent Nearbytes storage container that groups provider-specific roots.
 */
export function getDefaultStorageHomeDir(): string {
  return resolveStorageHomeDir(getDefaultStorageDir());
}

export function getProviderStorageFolderName(provider: string): string {
  const normalized = provider.trim().toLowerCase();
  if (normalized === 'github') {
    return 'git';
  }
  return normalized || 'shared';
}

export function resolveStorageHomeDir(localStorageDir: string): string {
  const resolved = path.resolve(localStorageDir);
  return path.basename(resolved).trim().toLowerCase() === 'local' ? path.dirname(resolved) : resolved;
}
