import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ProviderRefreshWorker,
  type ProviderRefreshManifest,
  type ProviderRefreshRemoteAdapter,
  type ProviderRefreshRemoteEntry,
} from '../providerRefreshWorker.js';

class FakeReadonlyRemote implements ProviderRefreshRemoteAdapter {
  constructor(
    private readonly entries: ProviderRefreshRemoteEntry[],
    private readonly contents: Record<string, string>
  ) {}

  async list(): Promise<readonly ProviderRefreshRemoteEntry[]> {
    return this.entries;
  }

  async download(relativePath: string): Promise<Uint8Array> {
    const value = this.contents[relativePath];
    if (typeof value !== 'string') {
      throw new Error(`Missing remote entry: ${relativePath}`);
    }
    return new TextEncoder().encode(value);
  }
}

describe('ProviderRefreshWorker', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((tempDir) => fs.rm(tempDir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it('downloads changed files, preserves unchanged ones, and removes obsolete manifest entries', async () => {
    const worker = new ProviderRefreshWorker();
    const localRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nearbytes-provider-refresh-'));
    tempDirs.push(localRoot);

    await fs.mkdir(path.join(localRoot, 'blocks'), { recursive: true });
    await fs.mkdir(path.join(localRoot, 'channels', 'room-a'), { recursive: true });
    await fs.writeFile(path.join(localRoot, 'blocks', 'keep.bin'), 'keep', 'utf8');
    await fs.writeFile(path.join(localRoot, 'blocks', 'replace.bin'), 'old-value', 'utf8');
    await fs.writeFile(path.join(localRoot, 'blocks', 'stale.bin'), 'stale', 'utf8');

    const previousManifest: ProviderRefreshManifest = {
      entries: {
        'blocks/keep.bin': { kind: 'file', fingerprint: 'keep-v1', size: 4 },
        'blocks/replace.bin': { kind: 'file', fingerprint: 'replace-v1', size: 9 },
        'blocks/stale.bin': { kind: 'file', fingerprint: 'stale-v1', size: 5 },
      },
    };

    const remote = new FakeReadonlyRemote(
      [
        { path: 'blocks', kind: 'folder', fingerprint: 'folder-blocks' },
        { path: 'channels/room-a', kind: 'folder', fingerprint: 'folder-room-a' },
        { path: 'blocks/keep.bin', kind: 'file', fingerprint: 'keep-v1', size: 4 },
        { path: 'blocks/replace.bin', kind: 'file', fingerprint: 'replace-v2', size: 11 },
        { path: 'channels/room-a/event.bin', kind: 'file', fingerprint: 'event-v1', size: 5 },
      ],
      {
        'blocks/keep.bin': 'keep',
        'blocks/replace.bin': 'new-value-2',
        'channels/room-a/event.bin': 'event',
      }
    );

    const result = await worker.refresh(localRoot, remote, previousManifest);

    expect(result.downloaded).toEqual(['blocks/replace.bin', 'channels/room-a/event.bin']);
    expect(result.removed).toEqual(['blocks/stale.bin']);
    expect(result.skipped).toEqual(['blocks/keep.bin']);

    await expect(fs.readFile(path.join(localRoot, 'blocks', 'keep.bin'), 'utf8')).resolves.toBe('keep');
    await expect(fs.readFile(path.join(localRoot, 'blocks', 'replace.bin'), 'utf8')).resolves.toBe('new-value-2');
    await expect(fs.readFile(path.join(localRoot, 'channels', 'room-a', 'event.bin'), 'utf8')).resolves.toBe('event');
    await expect(fs.stat(path.join(localRoot, 'blocks', 'stale.bin'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(result.manifest.entries['blocks/replace.bin']).toEqual({
      kind: 'file',
      fingerprint: 'replace-v2',
      size: 11,
    });
  });
});