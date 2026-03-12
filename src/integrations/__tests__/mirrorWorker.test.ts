import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MirrorWorker } from '../mirrorWorker.js';
import type { MirrorRemoteAdapter, MirrorRemoteEntry } from '../adapters.js';

class FakeRemote implements MirrorRemoteAdapter {
  readonly entries = new Map<string, Uint8Array>();

  constructor(initial: Record<string, string> = {}) {
    for (const [relativePath, value] of Object.entries(initial)) {
      this.entries.set(relativePath, new TextEncoder().encode(value));
    }
  }

  async list(): Promise<MirrorRemoteEntry[]> {
    return Array.from(this.entries.entries()).map(([relativePath, bytes]) => ({
      path: relativePath,
      size: bytes.byteLength,
    }));
  }

  async download(relativePath: string): Promise<Uint8Array> {
    const bytes = this.entries.get(relativePath);
    if (!bytes) {
      throw new Error(`Missing remote entry: ${relativePath}`);
    }
    return bytes;
  }

  async upload(relativePath: string, data: Uint8Array): Promise<void> {
    this.entries.set(relativePath, new Uint8Array(data));
  }
}

describe('MirrorWorker', () => {
  const worker = new MirrorWorker();
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nearbytes-mirror-worker-'));
    await fs.mkdir(path.join(tempDir, 'blocks'), { recursive: true });
    await fs.mkdir(path.join(tempDir, 'channels', 'abc123'), { recursive: true });
    await fs.writeFile(path.join(tempDir, 'blocks', 'local.bin'), 'local-only', 'utf8');
    await fs.writeFile(path.join(tempDir, 'channels', 'abc123', 'local-event.json'), 'local-event', 'utf8');
  });

  afterAll(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('uploads missing local files and downloads missing remote files without overwriting existing ones', async () => {
    const remote = new FakeRemote({
      'blocks/local.bin': 'remote-ignored',
      'blocks/remote.bin': 'remote-only',
      'channels/abc123/remote-event.json': 'remote-event',
    });

    const result = await worker.sync(tempDir, remote);

    expect(result.uploaded).toEqual(['channels/abc123/local-event.json']);
    expect(result.downloaded).toEqual(['blocks/remote.bin', 'channels/abc123/remote-event.json']);
    expect(result.skipped).toEqual(['blocks/local.bin']);

    expect(await fs.readFile(path.join(tempDir, 'blocks', 'remote.bin'), 'utf8')).toBe('remote-only');
    expect(await fs.readFile(path.join(tempDir, 'channels', 'abc123', 'remote-event.json'), 'utf8')).toBe('remote-event');
    expect(new TextDecoder().decode(remote.entries.get('channels/abc123/local-event.json')!)).toBe('local-event');
    expect(new TextDecoder().decode(remote.entries.get('blocks/local.bin')!)).toBe('remote-ignored');
  });
});
