import type { MirrorRemoteAdapter } from './adapters.js';
import { managedSharePath as path } from './managedSharePath.js';
import { validateCanonicalStorageFile } from 'nearbytes-storage';

type MirrorWorkerFsModule = typeof import('node:fs/promises') | typeof import('fs/promises');
let mirrorWorkerFsPromise: Promise<MirrorWorkerFsModule> | null = null;

async function getMirrorWorkerFs(): Promise<MirrorWorkerFsModule> {
  if (!mirrorWorkerFsPromise) {
    mirrorWorkerFsPromise = import('node:fs/promises').catch(() => import('fs/promises'));
  }
  return mirrorWorkerFsPromise;
}

export interface MirrorSyncResult {
  readonly uploaded: string[];
  readonly downloaded: string[];
  readonly skipped: string[];
}

export class MirrorWorker {
  async sync(localRoot: string, remote: MirrorRemoteAdapter): Promise<MirrorSyncResult> {
    const fs = await getMirrorWorkerFs();
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
        const confirmed = remote.confirmEntry ? await remote.confirmEntry(entry.path, entry.size) : true;
        if (!confirmed) {
          debugMirrorWarn('[MirrorWorker] remote entry could not be confirmed; forcing upload.', {
            path: entry.path,
            expectedSize: entry.size,
          });
          remoteMap.delete(entry.path);
        } else {
        debugMirrorLog('[MirrorWorker] skip (already on remote).', { path: entry.path, size: entry.size, sizeAwarePush });
        skipped.push(entry.path);
        continue;
        }
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
  const fs = await getMirrorWorkerFs();
  const result: Array<{ path: string; size: number }> = [];
  await walk(fs, path.join(localRoot, 'channels'), localRoot, result);
  await walk(fs, path.join(localRoot, 'blocks'), localRoot, result);
  return result.sort(compareMirrorUploadPriority);
}

function compareMirrorUploadPriority(
  left: { path: string; size: number },
  right: { path: string; size: number }
): number {
  const leftChannel = Number(left.path.startsWith('channels/'));
  const rightChannel = Number(right.path.startsWith('channels/'));
  if (leftChannel !== rightChannel) {
    return rightChannel - leftChannel;
  }
  return left.path.localeCompare(right.path);
}

async function walk(
  fs: MirrorWorkerFsModule,
  currentPath: string,
  localRoot: string,
  result: Array<{ path: string; size: number }>
): Promise<void> {
  let entries: Array<{ name: string; isDirectory(): boolean }>;
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
      await walk(fs, entryPath, localRoot, result);
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
