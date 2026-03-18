import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { type RootsConfig } from '../../config/roots.js';
import { MultiRootStorageBackend, type MultiRootRuntimeSnapshot } from '../multiRoot.js';

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
  it('reruns scheduled reconciliation without overlapping active work', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nearbytes-mr-'));
    const mainRoot = join(dir, 'main');
    await mkdir(mainRoot, { recursive: true });

    const storage = new MultiRootStorageBackend(createConfig({ mainPath: mainRoot }));
    const originalReconcile = storage.reconcileConfiguredVolumes.bind(storage);
    let runs = 0;

    storage.reconcileConfiguredVolumes = vi.fn(async () => {
      runs += 1;
      if (runs === 1) {
        storage.scheduleReconcileConfiguredVolumes();
      }
      await new Promise((resolve) => setTimeout(resolve, 15));
      await originalReconcile();
    });

    storage.scheduleReconcileConfiguredVolumes();
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(runs).toBe(2);
    expect(storage.isReconcileScheduled()).toBe(false);

    await rm(dir, { recursive: true, force: true });
  });

  it('audits incomplete full-copy destinations in the background and stops once healthy', async () => {
    vi.useFakeTimers();
    try {
      const dir = await mkdtemp(join(tmpdir(), 'nearbytes-mr-'));
      const mainRoot = join(dir, 'main');
      const backupRoot = join(dir, 'backup');
      await mkdir(mainRoot, { recursive: true });
      await mkdir(backupRoot, { recursive: true });

      const volumeId = '1'.repeat(130);
      const storage = new MultiRootStorageBackend(
        createConfig({
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
              volumeId,
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
        })
      );

      const realSnapshot = storage.getRuntimeSnapshot.bind(storage);
      const realSchedule = storage.scheduleReconcileConfiguredVolumes.bind(storage);
      let reconciles = 0;
      let healthy = false;

      const healthySnapshot: MultiRootRuntimeSnapshot = {
        sources: [
          {
            id: 'src-main',
            kind: 'source',
            path: mainRoot,
            enabled: true,
            writable: true,
            provider: 'local',
            reservePercent: 10,
            opportunisticPolicy: 'drop-older-blocks',
            exists: true,
            isDirectory: true,
            canWrite: true,
            usage: {
              totalBytes: 10,
              channelBytes: 5,
              blockBytes: 5,
              otherBytes: 0,
              blockCount: 1,
              volumeUsages: [{ volumeId, historyBytes: 5, historyFileCount: 1, fileBytes: 5, fileCount: 1 }],
            },
          },
          {
            id: 'src-backup',
            kind: 'source',
            path: backupRoot,
            enabled: true,
            writable: true,
            provider: 'dropbox',
            reservePercent: 10,
            opportunisticPolicy: 'drop-older-blocks',
            exists: true,
            isDirectory: true,
            canWrite: true,
            usage: {
              totalBytes: 10,
              channelBytes: 5,
              blockBytes: 5,
              otherBytes: 0,
              blockCount: 1,
              volumeUsages: [{ volumeId, historyBytes: 5, historyFileCount: 1, fileBytes: 5, fileCount: 1 }],
            },
          },
        ],
        writeFailures: [],
      };
      const incompleteSnapshot: MultiRootRuntimeSnapshot = {
        sources: [
          {
            id: 'src-main',
            kind: 'source',
            path: mainRoot,
            enabled: true,
            writable: true,
            provider: 'local',
            reservePercent: 10,
            opportunisticPolicy: 'drop-older-blocks',
            exists: true,
            isDirectory: true,
            canWrite: true,
            usage: {
              totalBytes: 10,
              channelBytes: 5,
              blockBytes: 5,
              otherBytes: 0,
              blockCount: 1,
              volumeUsages: [{ volumeId, historyBytes: 5, historyFileCount: 1, fileBytes: 5, fileCount: 1 }],
            },
          },
          {
            id: 'src-backup',
            kind: 'source',
            path: backupRoot,
            enabled: true,
            writable: true,
            provider: 'dropbox',
            reservePercent: 10,
            opportunisticPolicy: 'drop-older-blocks',
            exists: true,
            isDirectory: true,
            canWrite: true,
            usage: {
              totalBytes: 5,
              channelBytes: 5,
              blockBytes: 0,
              otherBytes: 0,
              blockCount: 0,
              volumeUsages: [{ volumeId, historyBytes: 5, historyFileCount: 1, fileBytes: 0, fileCount: 0 }],
            },
          },
        ],
        writeFailures: [],
      };
      storage.getRuntimeSnapshot = vi.fn(async (): Promise<MultiRootRuntimeSnapshot> => {
        return healthy ? healthySnapshot : incompleteSnapshot;
      });
      storage.scheduleReconcileConfiguredVolumes = vi.fn(() => {
        reconciles += 1;
        realSchedule();
      });
      storage.reconcileConfiguredVolumes = vi.fn(async () => {
        healthy = true;
      });

      storage.startRepairMonitor({ repairableDelayMs: 20, blockedDelayMs: 40, healthyDelayMs: 200 });
      await vi.advanceTimersByTimeAsync(25);
      expect(reconciles).toBeGreaterThan(0);

      await vi.advanceTimersByTimeAsync(60);
      expect(reconciles).toBe(1);

      storage.stopRepairMonitor();
      storage.getRuntimeSnapshot = realSnapshot;
      storage.scheduleReconcileConfiguredVolumes = realSchedule;
      await rm(dir, { recursive: true, force: true });
    } finally {
      vi.useRealTimers();
    }
  });

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

  it('resolves source conflicts by merging monotonic data, rewriting the marker, and removing stale metadata', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nearbytes-mr-'));
    const mainRoot = join(dir, 'main');
    const backupRoot = join(dir, 'backup');
    await mkdir(mainRoot, { recursive: true });
    await mkdir(backupRoot, { recursive: true });

    const keyHex = 'f'.repeat(130);
    const blockHash = 'e'.repeat(64);
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
          provider: 'mega',
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

    await mkdir(join(mainRoot, 'blocks'), { recursive: true });
    await writeFile(join(mainRoot, 'blocks', `${blockHash}.bin`), 'block-data', 'utf8');
    await mkdir(join(mainRoot, 'channels', keyHex), { recursive: true });
    await writeFile(
      join(mainRoot, 'channels', keyHex, 'event.bin'),
      JSON.stringify({
        payload: {
          type: 'CREATE_FILE',
          hash: blockHash,
        },
      }),
      'utf8'
    );
    await writeFile(join(backupRoot, 'Nearbytes.html'), 'stale marker\n', 'utf8');
    await writeFile(join(backupRoot, 'Nearbytes.json'), '{"legacy":true}\n', 'utf8');

    const storage = new MultiRootStorageBackend(config);
    const resolved = await storage.resolveSourceConflicts({
      sourceIds: ['src-backup'],
    });

    expect(resolved.sourceIds).toEqual(['src-backup']);
    expect(resolved.rewrittenMarkers).toBe(1);
    expect(resolved.removedLegacyMetadata).toBe(1);
    expect(resolved.clearedSources).toBe(0);
    expect(await readFile(join(backupRoot, 'blocks', `${blockHash}.bin`), 'utf8')).toBe('block-data');
    expect(await readFile(join(backupRoot, 'channels', keyHex, 'event.bin'), 'utf8')).toContain(blockHash);
    expect(await readFile(join(backupRoot, 'Nearbytes.html'), 'utf8')).toContain('Nearbytes storage location');
    await expect(readFile(join(backupRoot, 'Nearbytes.json'), 'utf8')).rejects.toThrow();

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

  it('collects orphaned blocks into the local root during reconciliation', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nearbytes-mr-'));
    const localRoot = join(dir, 'local');
    const remoteRoot = join(dir, 'remote');
    await mkdir(join(localRoot, 'blocks'), { recursive: true });
    await mkdir(join(remoteRoot, 'blocks'), { recursive: true });

    const orphanHash = '1'.repeat(64);
    const config = createConfig({
      mainPath: localRoot,
      sources: [
        {
          id: 'src-main',
          provider: 'local',
          path: localRoot,
          enabled: true,
          writable: true,
          reservePercent: 10,
          opportunisticPolicy: 'drop-older-blocks',
        },
        {
          id: 'src-remote',
          provider: 'mega',
          path: remoteRoot,
          enabled: true,
          writable: true,
          reservePercent: 10,
          opportunisticPolicy: 'drop-older-blocks',
        },
      ],
      volumes: [],
    });

    await writeFile(join(remoteRoot, 'blocks', `${orphanHash}.bin`), 'orphan-data', 'utf8');

    const storage = new MultiRootStorageBackend(config);
    await storage.reconcileConfiguredVolumes();

    expect(await readFile(join(localRoot, 'blocks', `${orphanHash}.bin`), 'utf8')).toBe('orphan-data');
    await expect(readFile(join(remoteRoot, 'blocks', `${orphanHash}.bin`), 'utf8')).rejects.toThrow();

    await rm(dir, { recursive: true, force: true });
  });

  it('keeps referenced blocks in place while still backfilling them to local storage', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nearbytes-mr-'));
    const localRoot = join(dir, 'local');
    const remoteRoot = join(dir, 'remote');
    await mkdir(join(localRoot, 'blocks'), { recursive: true });
    await mkdir(join(remoteRoot, 'blocks'), { recursive: true });

    const volumeId = 'f'.repeat(130);
    const knownHash = '2'.repeat(64);
    const orphanHash = '3'.repeat(64);
    const eventPayload = JSON.stringify({ payload: { type: 'CREATE_FILE', hash: knownHash } });

    const config = createConfig({
      mainPath: localRoot,
      sources: [
        {
          id: 'src-main',
          provider: 'local',
          path: localRoot,
          enabled: true,
          writable: true,
          reservePercent: 10,
          opportunisticPolicy: 'drop-older-blocks',
        },
        {
          id: 'src-remote',
          provider: 'mega',
          path: remoteRoot,
          enabled: true,
          writable: true,
          reservePercent: 10,
          opportunisticPolicy: 'drop-older-blocks',
        },
      ],
      volumes: [
        {
          volumeId,
          destinations: [
            {
              sourceId: 'src-remote',
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

    await mkdir(join(remoteRoot, 'channels', volumeId), { recursive: true });
    await writeFile(join(remoteRoot, 'channels', volumeId, 'event.bin'), eventPayload, 'utf8');
    await writeFile(join(remoteRoot, 'blocks', `${knownHash}.bin`), 'known-data', 'utf8');
    await writeFile(join(remoteRoot, 'blocks', `${orphanHash}.bin`), 'orphan-data', 'utf8');

    const storage = new MultiRootStorageBackend(config);
    await storage.reconcileConfiguredVolumes();

    expect(await readFile(join(localRoot, 'blocks', `${knownHash}.bin`), 'utf8')).toBe('known-data');
    expect(await readFile(join(localRoot, 'blocks', `${orphanHash}.bin`), 'utf8')).toBe('orphan-data');
    expect(await readFile(join(remoteRoot, 'blocks', `${knownHash}.bin`), 'utf8')).toBe('known-data');
    await expect(readFile(join(remoteRoot, 'blocks', `${orphanHash}.bin`), 'utf8')).rejects.toThrow();

    await rm(dir, { recursive: true, force: true });
  });

  it('reconciles tracked volumes that only exist on disk using default rules', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nearbytes-mr-'));
    const localRoot = join(dir, 'local');
    const remoteRoot = join(dir, 'remote');
    await mkdir(join(localRoot, 'blocks'), { recursive: true });
    await mkdir(join(remoteRoot, 'blocks'), { recursive: true });

    const volumeId = '9'.repeat(130);
    const blockHash = 'a'.repeat(64);
    const eventPayload = JSON.stringify({ payload: { type: 'CREATE_FILE', hash: blockHash } });

    const config = createConfig({
      mainPath: localRoot,
      sources: [
        {
          id: 'src-main',
          provider: 'local',
          path: localRoot,
          enabled: true,
          writable: true,
          reservePercent: 10,
          opportunisticPolicy: 'drop-older-blocks',
        },
        {
          id: 'src-remote',
          provider: 'mega',
          path: remoteRoot,
          enabled: true,
          writable: true,
          reservePercent: 10,
          opportunisticPolicy: 'drop-older-blocks',
        },
      ],
      volumes: [],
    });

    await mkdir(join(remoteRoot, 'channels', volumeId), { recursive: true });
    await writeFile(join(remoteRoot, 'channels', volumeId, 'event.bin'), eventPayload, 'utf8');
    await writeFile(join(remoteRoot, 'blocks', `${blockHash}.bin`), 'referenced-data', 'utf8');

    const storage = new MultiRootStorageBackend(config);
    await storage.reconcileConfiguredVolumes();

    expect(await readFile(join(localRoot, 'channels', volumeId, 'event.bin'), 'utf8')).toContain(blockHash);
    expect(await readFile(join(localRoot, 'blocks', `${blockHash}.bin`), 'utf8')).toBe('referenced-data');
    expect(await readFile(join(remoteRoot, 'blocks', `${blockHash}.bin`), 'utf8')).toBe('referenced-data');

    await rm(dir, { recursive: true, force: true });
  });
});
