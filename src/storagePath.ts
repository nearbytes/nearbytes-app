/**
 * Default storage directory resolution.
 */

import path from 'path';
import os from 'os';

/** Default local storage path. Can be moved to any local or synced folder via NEARBYTES_STORAGE_DIR. */
const DEFAULT_STORAGE_DIR = path.join(os.homedir(), 'nearbytes');

/**
 * Returns the storage root directory. If NEARBYTES_STORAGE_DIR is set, uses that;
 * otherwise uses the default local path ($HOME/nearbytes).
 */
export function getDefaultStorageDir(): string {
  if (typeof process !== 'undefined' && process.env?.NEARBYTES_STORAGE_DIR) {
    return process.env.NEARBYTES_STORAGE_DIR;
  }
  return DEFAULT_STORAGE_DIR;
}
