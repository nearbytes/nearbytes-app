import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { type RootsConfig } from '../../config/roots.js';
import { MultiRootStorageBackend } from '../multiRoot.js';

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

describe('MultiRootStorageBackend', () => {
  it('writes channel files to main and allowlisted backup roots', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nearbytes-mr-'));
    const mainRoot = join(dir, 'main');
    const backupRoot = join(dir, 'backup');
    await mkdir(mainRoot, { recursive: true });
    await mkdir(backupRoot, { recursive: true });

    const keyHex = 'a'.repeat(130);
    const config: RootsConfig = {
      version: 1,
      roots: [
        {
          id: 'main-1',
          kind: 'main',
          provider: 'local',
          path: mainRoot,
          enabled: true,
          writable: true,
          strategy: { name: 'all-keys' },
        },
        {
          id: 'backup-1',
          kind: 'backup',
          provider: 'dropbox',
          path: backupRoot,
          enabled: true,
          writable: true,
          strategy: { name: 'allowlist', channelKeys: [keyHex] },
        },
      ],
    };

    const storage = new MultiRootStorageBackend(config);
    const relativePath = `channels/${keyHex}/event.bin`;
    await storage.writeFileForChannel(relativePath, bytes('hello'), keyHex);

    const mainValue = await readFile(join(mainRoot, relativePath), 'utf8');
    const backupValue = await readFile(join(backupRoot, relativePath), 'utf8');
    expect(mainValue).toBe('hello');
    expect(backupValue).toBe('hello');

    await rm(dir, { recursive: true, force: true });
  });

  it('requires at least one writable main root', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nearbytes-mr-'));
    const backupRoot = join(dir, 'backup');
    await mkdir(backupRoot, { recursive: true });

    const keyHex = 'b'.repeat(130);
    const config: RootsConfig = {
      version: 1,
      roots: [
        {
          id: 'main-1',
          kind: 'main',
          provider: 'local',
          path: join(dir, 'main-missing'),
          enabled: true,
          writable: false,
          strategy: { name: 'all-keys' },
        },
        {
          id: 'backup-1',
          kind: 'backup',
          provider: 'mega',
          path: backupRoot,
          enabled: true,
          writable: true,
          strategy: { name: 'allowlist', channelKeys: [keyHex] },
        },
      ],
    };

    const storage = new MultiRootStorageBackend(config);
    await expect(
      storage.writeFileForChannel(`channels/${keyHex}/event.bin`, bytes('value'), keyHex)
    ).rejects.toThrow(/main roots/i);

    await rm(dir, { recursive: true, force: true });
  });

  it('keeps backup failures best effort and records failure status', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nearbytes-mr-'));
    const mainRoot = join(dir, 'main');
    const brokenBackupPath = join(dir, 'backup-file');
    await mkdir(mainRoot, { recursive: true });
    await writeFile(brokenBackupPath, 'not-a-directory', 'utf8');

    const keyHex = 'c'.repeat(130);
    const config: RootsConfig = {
      version: 1,
      roots: [
        {
          id: 'main-1',
          kind: 'main',
          provider: 'local',
          path: mainRoot,
          enabled: true,
          writable: true,
          strategy: { name: 'all-keys' },
        },
        {
          id: 'backup-1',
          kind: 'backup',
          provider: 'gdrive',
          path: brokenBackupPath,
          enabled: true,
          writable: true,
          strategy: { name: 'allowlist', channelKeys: [keyHex] },
        },
      ],
    };

    const storage = new MultiRootStorageBackend(config);
    const relativePath = `channels/${keyHex}/event.bin`;

    await storage.writeFileForChannel(relativePath, bytes('value'), keyHex);

    const mainValue = await readFile(join(mainRoot, relativePath), 'utf8');
    expect(mainValue).toBe('value');

    const snapshot = await storage.getRuntimeSnapshot();
    expect(snapshot.writeFailures.length).toBeGreaterThanOrEqual(1);
    const backupFailure = snapshot.writeFailures.find((failure) => failure.rootId === 'backup-1');
    expect(backupFailure).toBeDefined();

    await rm(dir, { recursive: true, force: true });
  });
});
