import { promises as fs } from 'fs';
import path from 'path';
import type { MirrorRemoteAdapter } from './adapters.js';

export interface MirrorSyncResult {
  readonly uploaded: string[];
  readonly downloaded: string[];
  readonly skipped: string[];
}

export class MirrorWorker {
  async sync(localRoot: string, remote: MirrorRemoteAdapter): Promise<MirrorSyncResult> {
    console.log('[MirrorWorker] sync started.', { localRoot });
    const localEntries = await listMirrorFiles(localRoot);
    console.log('[MirrorWorker] local entries found.', { count: localEntries.length, paths: localEntries.map((e) => e.path) });
    const remoteEntries = await remote.list();
    console.log('[MirrorWorker] remote entries found.', { count: remoteEntries.length, paths: remoteEntries.map((e) => e.path) });
    const remoteMap = new Map(remoteEntries.map((entry) => [normalizeRelativePath(entry.path), entry]));
    const localMap = new Map(localEntries.map((entry) => [entry.path, entry]));

    const uploaded: string[] = [];
    const downloaded: string[] = [];
    const skipped: string[] = [];

    for (const entry of localEntries) {
      if (remoteMap.has(entry.path)) {
        console.log('[MirrorWorker] skip (already remote).', { path: entry.path, size: entry.size });
        skipped.push(entry.path);
        continue;
      }
      console.log('[MirrorWorker] uploading local → remote.', { path: entry.path, size: entry.size });
      try {
        await remote.upload(entry.path, await fs.readFile(path.join(localRoot, entry.path)));
        console.log('[MirrorWorker] upload succeeded.', { path: entry.path });
        uploaded.push(entry.path);
      } catch (error) {
        console.error('[MirrorWorker] upload FAILED.', { path: entry.path, error: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    }

    for (const remoteEntry of remoteEntries) {
      const normalizedPath = normalizeRelativePath(remoteEntry.path);
      if (localMap.has(normalizedPath)) {
        continue;
      }
      const fullPath = path.join(localRoot, normalizedPath);
      console.log('[MirrorWorker] downloading remote → local.', { path: normalizedPath, size: remoteEntry.size });
      try {
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, await remote.download(normalizedPath));
        console.log('[MirrorWorker] download succeeded.', { path: normalizedPath });
        downloaded.push(normalizedPath);
      } catch (error) {
        console.error('[MirrorWorker] download FAILED.', { path: normalizedPath, error: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    }

    console.log('[MirrorWorker] sync completed.', { uploaded: uploaded.length, downloaded: downloaded.length, skipped: skipped.length });
    return {
      uploaded,
      downloaded,
      skipped,
    };
  }
}

async function listMirrorFiles(localRoot: string): Promise<Array<{ path: string; size: number }>> {
  const result: Array<{ path: string; size: number }> = [];
  await walk(path.join(localRoot, 'blocks'), localRoot, result);
  await walk(path.join(localRoot, 'channels'), localRoot, result);
  return result.sort((left, right) => left.path.localeCompare(right.path));
}

async function walk(
  currentPath: string,
  localRoot: string,
  result: Array<{ path: string; size: number }>
): Promise<void> {
  let entries: import('fs').Dirent[];
  try {
    entries = await fs.readdir(currentPath, { withFileTypes: true, encoding: 'utf8' });
  } catch (error) {
    if (isFileNotFound(error)) {
      return;
    }
    throw error;
  }

  for (const entry of entries) {
    const entryPath = path.join(currentPath, entry.name);
    if (entry.isDirectory()) {
      await walk(entryPath, localRoot, result);
      continue;
    }
    const relativePath = normalizeRelativePath(path.relative(localRoot, entryPath));
    if (!isMirrorRelativePath(relativePath)) {
      continue;
    }
    const stats = await fs.stat(entryPath);
    result.push({
      path: relativePath,
      size: stats.size,
    });
  }
}

function isMirrorRelativePath(value: string): boolean {
  return value.startsWith('blocks/') || value.startsWith('channels/');
}

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+/u, '');
}

function isFileNotFound(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'ENOENT');
}
