import { promises as fs } from 'fs';
import path from 'path';
import type { MirrorRemoteAdapter } from './adapters.js';
import { validateCanonicalStorageFile } from '../storage/integrity.js';

export interface MirrorSyncResult {
  readonly uploaded: string[];
  readonly downloaded: string[];
  readonly skipped: string[];
}

export class MirrorWorker {
  async sync(localRoot: string, remote: MirrorRemoteAdapter): Promise<MirrorSyncResult> {
    console.log('[MirrorWorker] sync started.', { localRoot });
    let localEntries = await listMirrorFiles(localRoot);
    debugMirrorLog('[MirrorWorker] local entries found.', { count: localEntries.length, paths: localEntries.map((e) => e.path) });
    let remoteEntries = await remote.list();
    debugMirrorLog('[MirrorWorker] remote entries found.', { count: remoteEntries.length, paths: remoteEntries.map((e) => e.path) });
    let remoteMap = new Map(remoteEntries.map((entry) => [normalizeRelativePath(entry.path), entry]));
    let localMap = new Map(localEntries.map((entry) => [entry.path, entry]));

    const uploaded: string[] = [];
    const downloaded: string[] = [];
    const skipped: string[] = [];

    const sizeAwarePush = remote.reconcileUploadsByRemoteSize?.() === true;
    for (const entry of localEntries) {
      const remoteEntry = remoteMap.get(entry.path);
      if (remoteEntry && (!sizeAwarePush || remoteEntry.size === entry.size)) {
        debugMirrorLog('[MirrorWorker] skip (already on remote).', { path: entry.path, size: entry.size, sizeAwarePush });
        skipped.push(entry.path);
        continue;
      }
      const localBytes = new Uint8Array(await fs.readFile(path.join(localRoot, entry.path)));
      const localValidation = await validateCanonicalStorageFile(entry.path, localBytes);
      if (!localValidation.ok) {
        debugMirrorWarn('[MirrorWorker] skip invalid local storage file.', {
          path: entry.path,
          code: localValidation.code,
          detail: localValidation.detail,
        });
        skipped.push(entry.path);
        continue;
      }
      debugMirrorLog('[MirrorWorker] uploading local → remote.', { path: entry.path, size: entry.size });
      try {
        await remote.upload(entry.path, localBytes);
        debugMirrorLog('[MirrorWorker] upload succeeded.', { path: entry.path });
        uploaded.push(entry.path);
        remoteEntries = await remote.list();
        remoteMap = new Map(remoteEntries.map((e) => [normalizeRelativePath(e.path), e]));
      } catch (error) {
        console.error('[MirrorWorker] upload FAILED.', { path: entry.path, error: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    }

    localEntries = await listMirrorFiles(localRoot);
    localMap = new Map(localEntries.map((e) => [e.path, e]));
    remoteEntries = await remote.list();

    for (const remoteEntry of remoteEntries) {
      const normalizedPath = normalizeRelativePath(remoteEntry.path);
      if (localMap.has(normalizedPath)) {
        continue;
      }
      const fullPath = path.join(localRoot, normalizedPath);
      let remoteBytes: Uint8Array;
      try {
        remoteBytes = await remote.download(normalizedPath);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (
          /^MEGA owner folder is missing /i.test(msg) ||
          /^MEGA mirror entry not found:/i.test(msg)
        ) {
          debugMirrorWarn('[MirrorWorker] skip download; remote path not resolvable (tree skew or node removed).', {
            path: normalizedPath,
            detail: msg,
          });
          skipped.push(normalizedPath);
          continue;
        }
        throw error;
      }
      const remoteValidation = await validateCanonicalStorageFile(normalizedPath, remoteBytes);
      if (!remoteValidation.ok) {
        debugMirrorWarn('[MirrorWorker] skip invalid remote storage file.', {
          path: normalizedPath,
          code: remoteValidation.code,
          detail: remoteValidation.detail,
        });
        skipped.push(normalizedPath);
        continue;
      }
      debugMirrorLog('[MirrorWorker] downloading remote → local.', { path: normalizedPath, size: remoteEntry.size });
      try {
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, remoteBytes);
        debugMirrorLog('[MirrorWorker] download succeeded.', { path: normalizedPath });
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

function isMirrorDebugEnabled(): boolean {
  const value = process.env.DEBUG?.trim();
  return Boolean(value);
}

function debugMirrorLog(...args: unknown[]): void {
  if (isMirrorDebugEnabled()) {
    console.log(...args);
  }
}

function debugMirrorWarn(...args: unknown[]): void {
  if (isMirrorDebugEnabled()) {
    console.warn(...args);
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
