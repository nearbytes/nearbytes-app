import { promises as fs } from 'fs';
import path from 'path';

export interface ProviderRefreshRemoteEntry {
  readonly path: string;
  readonly kind: 'file' | 'folder';
  readonly fingerprint: string;
  readonly size?: number;
}

export interface ProviderRefreshManifestEntry {
  readonly fingerprint: string;
  readonly kind: 'file' | 'folder';
  readonly size?: number;
}

export interface ProviderRefreshManifest {
  readonly entries: Record<string, ProviderRefreshManifestEntry>;
}

export interface ProviderRefreshRemoteAdapter {
  list(): Promise<readonly ProviderRefreshRemoteEntry[]>;
  download(path: string): Promise<Uint8Array>;
}

export interface ProviderRefreshResult {
  readonly downloaded: string[];
  readonly removed: string[];
  readonly skipped: string[];
  readonly manifest: ProviderRefreshManifest;
}

export class ProviderRefreshWorker {
  async refresh(
    localRoot: string,
    remote: ProviderRefreshRemoteAdapter,
    previousManifest: ProviderRefreshManifest = { entries: {} }
  ): Promise<ProviderRefreshResult> {
    const remoteEntries = [...(await remote.list())]
      .map((entry) => ({
        ...entry,
        path: normalizeRelativePath(entry.path),
      }))
      .filter((entry) => isMirrorRelativePath(entry.path))
      .sort((left, right) => left.path.localeCompare(right.path));

    const downloaded: string[] = [];
    const skipped: string[] = [];
    const desiredPaths = new Set<string>();
    const nextEntries = new Map<string, ProviderRefreshManifestEntry>();

    await fs.mkdir(localRoot, { recursive: true });

    for (const entry of remoteEntries) {
      desiredPaths.add(entry.path);
      nextEntries.set(entry.path, {
        fingerprint: entry.fingerprint,
        kind: entry.kind,
        size: entry.kind === 'file' ? entry.size ?? 0 : undefined,
      });

      const targetPath = path.join(localRoot, entry.path);
      if (entry.kind === 'folder') {
        await ensureDirectoryPath(targetPath);
        continue;
      }

      const previous = previousManifest.entries[entry.path];
      const stats = await fs.stat(targetPath).catch(() => null);
      if (
        previous?.kind === 'file' &&
        previous.fingerprint === entry.fingerprint &&
        stats?.isFile() &&
        stats.size === (entry.size ?? stats.size)
      ) {
        skipped.push(entry.path);
        continue;
      }

      if (stats?.isDirectory()) {
        await fs.rm(targetPath, { recursive: true, force: true });
      }
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, await remote.download(entry.path));
      downloaded.push(entry.path);
    }

    const removed = await removeObsoleteEntries(localRoot, previousManifest.entries, desiredPaths);

    return {
      downloaded,
      removed,
      skipped,
      manifest: {
        entries: Object.fromEntries(nextEntries.entries()),
      },
    };
  }
}

async function ensureDirectoryPath(targetPath: string): Promise<void> {
  const stats = await fs.stat(targetPath).catch(() => null);
  if (stats?.isFile()) {
    await fs.rm(targetPath, { recursive: true, force: true });
  }
  await fs.mkdir(targetPath, { recursive: true });
}

async function removeObsoleteEntries(
  localRoot: string,
  previousEntries: Record<string, ProviderRefreshManifestEntry>,
  desiredPaths: ReadonlySet<string>
): Promise<string[]> {
  const obsolete = Object.keys(previousEntries)
    .filter((entry) => !desiredPaths.has(entry))
    .sort((left, right) => right.length - left.length);
  const removed: string[] = [];
  for (const entry of obsolete) {
    await fs.rm(path.join(localRoot, entry), { recursive: true, force: true }).catch(() => undefined);
    removed.push(entry);
  }
  return removed;
}

function isMirrorRelativePath(value: string): boolean {
  return value.startsWith('blocks/') || value.startsWith('channels/');
}

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+/, '');
}