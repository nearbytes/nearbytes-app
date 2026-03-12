import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { type RootsConfig } from '../../config/roots.js';
import { MultiRootStorageBackend } from '../multiRoot.js';

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function createConfig(args: {
  mainPath: string;
  sources?: RootsConfig['sources'];
  volumes?: RootsConfig['volumes'];
}): RootsConfig {
  const mainSource =
    args.sources?.find((source) => source.id === 'src-main') ?? {
      id: 'src-main',
      provider: 'local' as const,
      path: args.mainPath,
      enabled: true,
      writable: true,
      reservePercent: 10,
      opportunisticPolicy: 'drop-older-blocks' as const,
    };

  return {
    version: 2,
    sources: args.sources ?? [mainSource],
    defaultVolume: {
      destinations: [
        {
          sourceId: mainSource.id,
          enabled: true,
          storeEvents: true,
          storeBlocks: true,
          copySourceBlocks: true,
          reservePercent: 10,
          fullPolicy: 'block-writes',
        },
      ],
    },
    volumes: args.volumes ?? [],
  };
}

describe('MultiRootStorageBackend', () => {
  it('writes channel files to the default durable source and explicit volume destinations', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nearbytes-mr-'));
    const mainRoot = join(dir, 'main');
    const backupRoot = join(dir, 'backup');
    await mkdir(mainRoot, { recursive: true });
    await mkdir(backupRoot, { recursive: true });

    const keyHex = 'a'.repeat(130);
    const config = createConfig({
      mainPath: mainRoot,
      sources: [
        {
          id: 'src-main',
          provider: 'local',
          path: mainRoot,
          enabled: true,
          writable: true,
          reservePercent: 10,
          opportunisticPolicy: 'drop-older-blocks',
        },
        {
          id: 'src-backup',
          provider: 'dropbox',
          path: backupRoot,
          enabled: true,
          writable: true,
          reservePercent: 10,
          opportunisticPolicy: 'drop-older-blocks',
        },
      ],
      volumes: [
        {
          volumeId: keyHex,
          destinations: [
            {
              sourceId: 'src-backup',
              enabled: true,
              storeEvents: true,
              storeBlocks: true,
              copySourceBlocks: true,
              reservePercent: 10,
              fullPolicy: 'block-writes',
            },
          ],
        },
      ],
    });

    const storage = new MultiRootStorageBackend(config);
    const relativePath = `channels/${keyHex}/event.bin`;
    await storage.writeFileForChannel(relativePath, bytes('hello'), keyHex);

    const mainValue = await readFile(join(mainRoot, relativePath), 'utf8');
    const backupValue = await readFile(join(backupRoot, relativePath), 'utf8');
    expect(mainValue).toBe('hello');
    expect(backupValue).toBe('hello');

    await rm(dir, { recursive: true, force: true });
  });

  it('requires at least one writable destination for the volume', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nearbytes-mr-'));
    const mainRoot = join(dir, 'main');
    await mkdir(mainRoot, { recursive: true });

    const keyHex = 'b'.repeat(130);
    const config = createConfig({
      mainPath: mainRoot,
      sources: [
        {
          id: 'src-main',
          provider: 'local',
          path: mainRoot,
          enabled: true,
          writable: false,
          reservePercent: 10,
          opportunisticPolicy: 'drop-older-blocks',
        },
      ],
    });

    const storage = new MultiRootStorageBackend(config);
    await expect(
      storage.writeFileForChannel(`channels/${keyHex}/event.bin`, bytes('value'), keyHex)
    ).rejects.toThrow(/No writable event destinations configured/i);

    await rm(dir, { recursive: true, force: true });
  });

  it('keeps secondary destination failures best effort and records failure status', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nearbytes-mr-'));
    const mainRoot = join(dir, 'main');
    const brokenBackupPath = join(dir, 'backup-file');
    await mkdir(mainRoot, { recursive: true });
    await writeFile(brokenBackupPath, 'not-a-directory', 'utf8');

    const keyHex = 'c'.repeat(130);
    const config = createConfig({
      mainPath: mainRoot,
      sources: [
        {
          id: 'src-main',
          provider: 'local',
          path: mainRoot,
          enabled: true,
          writable: true,
          reservePercent: 10,
          opportunisticPolicy: 'drop-older-blocks',
        },
        {
          id: 'src-secondary',
          provider: 'gdrive',
          path: brokenBackupPath,
          enabled: true,
          writable: true,
          reservePercent: 10,
          opportunisticPolicy: 'drop-older-blocks',
        },
      ],
      volumes: [
        {
          volumeId: keyHex,
          destinations: [
            {
              sourceId: 'src-secondary',
              enabled: true,
              storeEvents: true,
              storeBlocks: true,
              copySourceBlocks: true,
              reservePercent: 10,
              fullPolicy: 'block-writes',
            },
          ],
        },
      ],
    });

    const storage = new MultiRootStorageBackend(config);
    const relativePath = `channels/${keyHex}/event.bin`;

    await storage.writeFileForChannel(relativePath, bytes('value'), keyHex);

    const mainValue = await readFile(join(mainRoot, relativePath), 'utf8');
    expect(mainValue).toBe('value');

    const snapshot = await storage.getRuntimeSnapshot();
    expect(snapshot.writeFailures.length).toBeGreaterThanOrEqual(1);
    const backupFailure = snapshot.writeFailures.find((failure) => failure.rootId === 'src-secondary');
    expect(backupFailure).toBeDefined();

    await rm(dir, { recursive: true, force: true });
  });

  it('consolidates one source into another and removes the source from config', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nearbytes-mr-'));
    const mainRoot = join(dir, 'main');
    const sourcePath = join(dir, 'source-a');
    const targetPath = join(dir, 'source-b');
    await mkdir(mainRoot, { recursive: true });
    await mkdir(sourcePath, { recursive: true });
    await mkdir(targetPath, { recursive: true });

    const keyHex = 'd'.repeat(130);
    const config = createConfig({
      mainPath: mainRoot,
      sources: [
        {
          id: 'src-main',
          provider: 'local',
          path: mainRoot,
          enabled: true,
          writable: true,
          reservePercent: 10,
          opportunisticPolicy: 'drop-older-blocks',
        },
        {
          id: 'src-source',
          provider: 'mega',
          path: sourcePath,
          enabled: true,
          writable: true,
          reservePercent: 10,
          opportunisticPolicy: 'drop-older-blocks',
        },
        {
          id: 'src-target',
          provider: 'dropbox',
          path: targetPath,
          enabled: true,
          writable: true,
          reservePercent: 10,
          opportunisticPolicy: 'drop-older-blocks',
          moveFromSourceId: 'src-source',
        },
      ],
      volumes: [
        {
          volumeId: keyHex,
          destinations: [
            {
              sourceId: 'src-source',
              enabled: true,
              storeEvents: true,
              storeBlocks: true,
              copySourceBlocks: true,
              reservePercent: 10,
              fullPolicy: 'block-writes',
            },
            {
              sourceId: 'src-target',
              enabled: true,
              storeEvents: true,
              storeBlocks: true,
              copySourceBlocks: true,
              reservePercent: 10,
              fullPolicy: 'block-writes',
            },
          ],
        },
      ],
    });

    await mkdir(join(sourcePath, 'blocks'), { recursive: true });
    await writeFile(join(sourcePath, 'blocks', 'x.bin'), 'block-data', 'utf8');
    await mkdir(join(sourcePath, 'channels', keyHex), { recursive: true });
    await writeFile(join(sourcePath, 'channels', keyHex, 'event.bin'), 'event-data', 'utf8');

    const storage = new MultiRootStorageBackend(config);
    const plan = await storage.getConsolidationPlan('src-source');
    const candidate = plan.candidates.find((entry) => entry.id === 'src-target');
    expect(candidate?.eligible).toBe(true);

    const consolidated = await storage.consolidateRoot('src-source', 'src-target');
    expect(consolidated.result.movedFiles).toBeGreaterThanOrEqual(2);
    expect(consolidated.config.sources.some((source) => source.id === 'src-source')).toBe(false);
    expect(consolidated.config.volumes[0].destinations.some((destination) => destination.sourceId === 'src-source')).toBe(
      false
    );
    expect(consolidated.config.sources.find((source) => source.id === 'src-target')?.moveFromSourceId).toBeUndefined();

    const movedBlock = await readFile(join(targetPath, 'blocks', 'x.bin'), 'utf8');
    const movedEvent = await readFile(join(targetPath, 'channels', keyHex, 'event.bin'), 'utf8');
    expect(movedBlock).toBe('block-data');
    expect(movedEvent).toBe('event-data');

    await expect(readFile(join(sourcePath, 'blocks', 'x.bin'), 'utf8')).rejects.toThrow();

    await rm(dir, { recursive: true, force: true });
  });

  it('rejects consolidation candidates when one source is disabled', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nearbytes-mr-'));
    const mainRoot = join(dir, 'main');
    const sourcePath = join(dir, 'source-a');
    const targetPath = join(dir, 'source-b');
    await mkdir(mainRoot, { recursive: true });
    await mkdir(sourcePath, { recursive: true });
    await mkdir(targetPath, { recursive: true });

    const config = createConfig({
      mainPath: mainRoot,
      sources: [
        {
          id: 'src-main',
          provider: 'local',
          path: mainRoot,
          enabled: true,
          writable: true,
          reservePercent: 10,
          opportunisticPolicy: 'drop-older-blocks',
        },
        {
          id: 'src-source',
          provider: 'mega',
          path: sourcePath,
          enabled: true,
          writable: true,
          reservePercent: 10,
          opportunisticPolicy: 'drop-older-blocks',
        },
        {
          id: 'src-target',
          provider: 'dropbox',
          path: targetPath,
          enabled: false,
          writable: true,
          reservePercent: 10,
          opportunisticPolicy: 'drop-older-blocks',
        },
      ],
    });

    const storage = new MultiRootStorageBackend(config);
    const plan = await storage.getConsolidationPlan('src-source');
    const candidate = plan.candidates.find((entry) => entry.id === 'src-target');
    expect(candidate?.eligible).toBe(false);
    expect(candidate?.reason).toMatch(/Both sources must be enabled/i);

    await expect(storage.consolidateRoot('src-source', 'src-target')).rejects.toThrow(
      /Both sources must be enabled/i
    );

    await rm(dir, { recursive: true, force: true });
  });

  it('backfills historical events and referenced blocks when a new destination is added', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nearbytes-mr-'));
    const mainRoot = join(dir, 'main');
    const backupRoot = join(dir, 'backup');
    await mkdir(mainRoot, { recursive: true });
    await mkdir(backupRoot, { recursive: true });

    const keyHex = 'e'.repeat(130);
    const blockHash = 'f'.repeat(64);
    const config = createConfig({
      mainPath: mainRoot,
      sources: [
        {
          id: 'src-main',
          provider: 'local',
          path: mainRoot,
          enabled: true,
          writable: true,
          reservePercent: 10,
          opportunisticPolicy: 'drop-older-blocks',
        },
        {
          id: 'src-backup',
          provider: 'dropbox',
          path: backupRoot,
          enabled: true,
          writable: true,
          reservePercent: 10,
          opportunisticPolicy: 'drop-older-blocks',
        },
      ],
      volumes: [],
    });

    await mkdir(join(mainRoot, 'blocks'), { recursive: true });
    await writeFile(join(mainRoot, 'blocks', `${blockHash}.bin`), 'block-data', 'utf8');
    await mkdir(join(mainRoot, 'channels', keyHex), { recursive: true });
    await writeFile(
      join(mainRoot, 'channels', keyHex, 'event-a.bin'),
      JSON.stringify({
        payload: {
          type: 'CREATE_FILE',
          hash: blockHash,
        },
      }),
      'utf8'
    );
    await writeFile(
      join(mainRoot, 'channels', keyHex, 'event-b.bin'),
      JSON.stringify({
        payload: {
          type: 'DELETE_FILE',
        },
      }),
      'utf8'
    );

    const storage = new MultiRootStorageBackend(config);
    storage.updateRootsConfig({
      ...config,
      volumes: [
        {
          volumeId: keyHex,
          destinations: [
            {
              sourceId: 'src-backup',
              enabled: true,
              storeEvents: true,
              storeBlocks: true,
              copySourceBlocks: true,
              reservePercent: 10,
              fullPolicy: 'block-writes',
            },
          ],
        },
      ],
    });

    await storage.reconcileConfiguredVolumes();

    expect(await readFile(join(backupRoot, 'blocks', `${blockHash}.bin`), 'utf8')).toBe('block-data');
    expect(await readFile(join(backupRoot, 'channels', keyHex, 'event-a.bin'), 'utf8')).toContain(blockHash);
    expect(await readFile(join(backupRoot, 'channels', keyHex, 'event-b.bin'), 'utf8')).toContain('DELETE_FILE');

    await rm(dir, { recursive: true, force: true });
  });
});
