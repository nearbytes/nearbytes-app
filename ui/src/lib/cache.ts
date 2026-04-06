/**
 * Compatibility wrapper over the browser mirror volume snapshots.
 * Preserves the old cache API while Phase 1 moves shared state into the mirror.
 */

import type { FileMetadata } from './api.js';
import {
  clearMirrorVolumeSnapshots,
  importCompatibilityVolumeSnapshot,
  readMirrorVolumeSnapshot,
  readMirrorVolumeTimestamp,
} from './mirror/browserMirror.js';

/**
 * Gets cached files for a volumeId.
 * Returns null if not cached or cache is stale (> 24 hours).
 */
export async function getCachedFiles(volumeId: string): Promise<FileMetadata[] | null> {
  const cached = await readMirrorVolumeSnapshot(volumeId);
  return cached?.files ?? null;
}

/**
 * Stores file listing for a volumeId.
 */
export async function setCachedFiles(volumeId: string, files: FileMetadata[]): Promise<void> {
  await importCompatibilityVolumeSnapshot({ volumeId, files });
}

/**
 * Clears all cached volumes.
 */
export async function clearCache(): Promise<void> {
  await clearMirrorVolumeSnapshots();
}

/**
 * Gets the cache timestamp for a volumeId.
 */
export async function getCacheTimestamp(volumeId: string): Promise<number | null> {
  return readMirrorVolumeTimestamp(volumeId);
}
