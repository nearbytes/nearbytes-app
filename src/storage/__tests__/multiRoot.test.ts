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

  it('consolidates one backup root into another and removes source root from config', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nearbytes-mr-'));
    const mainRoot = join(dir, 'main');
    const backupSource = join(dir, 'backup-source');
    const backupTarget = join(dir, 'backup-target');
    await mkdir(mainRoot, { recursive: true });
    await mkdir(backupSource, { recursive: true });
    await mkdir(backupTarget, { recursive: true });

    const keyHex = 'd'.repeat(130);
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
          id: 'backup-source',
          kind: 'backup',
          provider: 'mega',
          path: backupSource,
          enabled: true,
          writable: true,
          strategy: { name: 'allowlist', channelKeys: [keyHex] },
        },
        {
          id: 'backup-target',
          kind: 'backup',
          provider: 'dropbox',
          path: backupTarget,
          enabled: true,
          writable: true,
          strategy: { name: 'allowlist', channelKeys: [keyHex] },
        },
      ],
    };

    await mkdir(join(backupSource, 'blocks'), { recursive: true });
    await writeFile(join(backupSource, 'blocks', 'x.bin'), 'block-data', 'utf8');
    await mkdir(join(backupSource, 'channels', keyHex), { recursive: true });
    await writeFile(join(backupSource, 'channels', keyHex, 'event.bin'), 'event-data', 'utf8');

    const storage = new MultiRootStorageBackend(config);
    const plan = await storage.getConsolidationPlan('backup-source');
    const candidate = plan.candidates.find((entry) => entry.id === 'backup-target');
    expect(candidate?.eligible).toBe(true);

    const consolidated = await storage.consolidateRoot('backup-source', 'backup-target');
    expect(consolidated.result.movedFiles).toBeGreaterThanOrEqual(2);
    expect(consolidated.config.roots.some((root) => root.id === 'backup-source')).toBe(false);

    const movedBlock = await readFile(join(backupTarget, 'blocks', 'x.bin'), 'utf8');
    const movedEvent = await readFile(join(backupTarget, 'channels', keyHex, 'event.bin'), 'utf8');
    expect(movedBlock).toBe('block-data');
    expect(movedEvent).toBe('event-data');

    await expect(readFile(join(backupSource, 'blocks', 'x.bin'), 'utf8')).rejects.toThrow();

    await rm(dir, { recursive: true, force: true });
  });

  it('rejects consolidation candidates with mismatched backup allowlists', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nearbytes-mr-'));
    const mainRoot = join(dir, 'main');
    const backupSource = join(dir, 'backup-source');
    const backupTarget = join(dir, 'backup-target');
    await mkdir(mainRoot, { recursive: true });
    await mkdir(backupSource, { recursive: true });
    await mkdir(backupTarget, { recursive: true });

    const sourceKey = 'e'.repeat(130);
    const targetKey = 'f'.repeat(130);
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
          id: 'backup-source',
          kind: 'backup',
          provider: 'mega',
          path: backupSource,
          enabled: true,
          writable: true,
          strategy: { name: 'allowlist', channelKeys: [sourceKey] },
        },
        {
          id: 'backup-target',
          kind: 'backup',
          provider: 'dropbox',
          path: backupTarget,
          enabled: true,
          writable: true,
          strategy: { name: 'allowlist', channelKeys: [targetKey] },
        },
      ],
    };

    const storage = new MultiRootStorageBackend(config);
    const plan = await storage.getConsolidationPlan('backup-source');
    const candidate = plan.candidates.find((entry) => entry.id === 'backup-target');
    expect(candidate?.eligible).toBe(false);
    expect(candidate?.reason).toMatch(/same allowed volume keys/i);

    await expect(storage.consolidateRoot('backup-source', 'backup-target')).rejects.toThrow(
      /same allowed volume keys/i
    );

    await rm(dir, { recursive: true, force: true });
  });
});
