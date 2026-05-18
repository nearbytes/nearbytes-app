import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { createCryptoOperations } from 'nearbytes-crypto';
import { type RootsConfig } from '../../config/roots.js';
import { NEARBYTES_MARKER_FILE } from '../../config/sourceDiscovery.js';
import { volumeIdFromPublicKey } from '../../domain/fileCrypto.js';
import { createEncryptedData, EMPTY_HASH, EventType, type EventPayload, type Hash } from 'nearbytes-crypto';
import { createSecret } from 'nearbytes-crypto';
import { serializeEvent, serializeEventEnvelope } from '../serialization.js';
import { MultiRootStorageBackend, type MultiRootRuntimeSnapshot } from '../multiRoot.js';
import { createSignedEvent } from '../../domain/eventEnvelope.js';

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

const crypto = createCryptoOperations();

async function createStoredBlock(value: string): Promise<{ hash: Hash; bytes: Uint8Array }> {
  const data = bytes(value);
  return {
    hash: await crypto.computeHash(data),
    bytes: data,
  };
}

async function createSignedStoredEvent(
  secretValue: string,
  payload: EventPayload
): Promise<{ volumeId: string; eventHash: Hash; bytes: Uint8Array }> {
  const keyPair = await crypto.deriveKeys(createSecret(secretValue));
  const storedEvent = await createSignedEvent(
    crypto,
    keyPair,
    payload,
    payload.hash === EMPTY_HASH ? [] : [payload.hash]
  );
  const eventHash = await crypto.computeHash(serializeEventEnvelope(storedEvent.envelope));
  return {
    volumeId: volumeIdFromPublicKey(keyPair.publicKey),
    eventHash,
    bytes: bytes(JSON.stringify(serializeEvent(storedEvent))),
  };
}

function createCreateFilePayload(fileName: string, blockHash: Hash): EventPayload {
  return {
    type: EventType.CREATE_FILE,
    fileName,
    hash: blockHash,
    encryptedKey: createEncryptedData(new Uint8Array(0)),
  };
}

function createDeleteFilePayload(fileName: string): EventPayload {
  return {
    type: EventType.DELETE_FILE,
    fileName,
    hash: EMPTY_HASH,
    encryptedKey: createEncryptedData(new Uint8Array(0)),
  };
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

  it('deduplicates concurrent runtime snapshot work', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nearbytes-mr-'));
    const mainRoot = join(dir, 'main');
    await mkdir(mainRoot, { recursive: true });

    const block = await createStoredBlock('block-data');
    const event = await createSignedStoredEvent(
      'nearbytes-test-runtime-snapshot',
      createCreateFilePayload('snapshot.txt', block.hash)
    );
    const volumeId = event.volumeId;
    await mkdir(join(mainRoot, 'channels', volumeId), { recursive: true });
    await writeFile(join(mainRoot, 'channels', volumeId, `${event.eventHash}.bin`), event.bytes);
    await mkdir(join(mainRoot, 'blocks'), { recursive: true });
    await writeFile(join(mainRoot, 'blocks', `${block.hash}.bin`), block.bytes);

    const storage = new MultiRootStorageBackend(createConfig({ mainPath: mainRoot }));
    const storageInternals = storage as unknown as {
      getReferencedBlockHashIndex: () => Promise<Map<string, Set<string>>>;
    };
    const originalGetReferencedBlockHashIndex = storageInternals.getReferencedBlockHashIndex.bind(storage);
    let calls = 0;

    storageInternals.getReferencedBlockHashIndex = vi.fn(async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 15));
      return originalGetReferencedBlockHashIndex();
    });

    const [first, second] = await Promise.all([storage.getRuntimeSnapshot(), storage.getRuntimeSnapshot()]);

    expect(calls).toBe(1);
    expect(second).toEqual(first);

    await rm(dir, { recursive: true, force: true });
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

  it('pushes new block writes to publish-only destinations without backfilling them as full copies', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nearbytes-mr-'));
    const mainRoot = join(dir, 'main');
    const publishRoot = join(dir, 'publish');
    await mkdir(mainRoot, { recursive: true });
    await mkdir(publishRoot, { recursive: true });

    const keyHex = 'a'.repeat(130);
    const blockHash = '1'.repeat(64);
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
          id: 'src-publish',
          provider: 'mega',
          path: publishRoot,
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
              sourceId: 'src-publish',
              enabled: true,
              storeEvents: true,
              storeBlocks: true,
              copySourceBlocks: false,
              reservePercent: 10,
              fullPolicy: 'drop-older-blocks',
            },
          ],
        },
      ],
    });

    const storage = new MultiRootStorageBackend(config);
    await storage.writeFileForChannel(`blocks/${blockHash}.bin`, bytes('block-data'), keyHex);
    await storage.writeFileForChannel(`channels/${keyHex}/event.bin`, bytes('event-data'), keyHex);

    expect(await readFile(join(mainRoot, 'blocks', `${blockHash}.bin`), 'utf8')).toBe('block-data');
    expect(await readFile(join(publishRoot, 'blocks', `${blockHash}.bin`), 'utf8')).toBe('block-data');
    expect(await readFile(join(publishRoot, 'channels', keyHex, 'event.bin'), 'utf8')).toBe('event-data');

    await rm(dir, { recursive: true, force: true });
  });

  it('reads a missing block from any enabled source when the prioritized destination does not have it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nearbytes-mr-'));
    const mainRoot = join(dir, 'main');
    const publishRoot = join(dir, 'publish');
    await mkdir(join(mainRoot, 'blocks'), { recursive: true });
    await mkdir(publishRoot, { recursive: true });

    const keyHex = 'b'.repeat(130);
    const blockHash = '2'.repeat(64);
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
          id: 'src-publish',
          provider: 'mega',
          path: publishRoot,
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
              sourceId: 'src-publish',
              enabled: true,
              storeEvents: true,
              storeBlocks: true,
              copySourceBlocks: false,
              reservePercent: 10,
              fullPolicy: 'drop-older-blocks',
            },
          ],
        },
      ],
    });

    await writeFile(join(mainRoot, 'blocks', `${blockHash}.bin`), 'fallback-data', 'utf8');

    const storage = new MultiRootStorageBackend(config);
    const bytesValue = await storage.readFileForChannel(`blocks/${blockHash}.bin`, keyHex);

    expect(new TextDecoder().decode(bytesValue)).toBe('fallback-data');

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

  it('allows writes when a destination is already below reserve but still has real free space', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nearbytes-mr-'));
    const mainRoot = join(dir, 'main');
    await mkdir(mainRoot, { recursive: true });

    const keyHex = 'e'.repeat(130);
    const storage = new MultiRootStorageBackend(createConfig({ mainPath: mainRoot }));
    (storage as unknown as { capacityProbe: { getAvailableBytes(path: string): Promise<number | undefined>; getTotalBytes(path: string): Promise<number | undefined> } }).capacityProbe = {
      getAvailableBytes: async () => 50,
      getTotalBytes: async () => 1000,
    };

    try {
      await expect(
        storage.writeFileForChannel(`channels/${keyHex}/event.bin`, bytes('value'), keyHex)
      ).resolves.toBeUndefined();
      expect(await readFile(join(mainRoot, 'channels', keyHex, 'event.bin'), 'utf8')).toBe('value');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('still blocks writes that would newly cross the reserve watermark', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nearbytes-mr-'));
    const mainRoot = join(dir, 'main');
    await mkdir(mainRoot, { recursive: true });

    const keyHex = 'f'.repeat(130);
    const storage = new MultiRootStorageBackend(createConfig({ mainPath: mainRoot }));
    (storage as unknown as { capacityProbe: { getAvailableBytes(path: string): Promise<number | undefined>; getTotalBytes(path: string): Promise<number | undefined> } }).capacityProbe = {
      getAvailableBytes: async () => 120,
      getTotalBytes: async () => 1000,
    };

    try {
      await expect(
        storage.writeFileForChannel(`channels/${keyHex}/event.bin`, bytes('x'.repeat(30)), keyHex)
      ).rejects.toThrow(/does not have enough free space/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
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

    const block = await createStoredBlock('block-data');
    const event = await createSignedStoredEvent(
      'nearbytes-test-resolve-source-conflicts',
      createCreateFilePayload('conflict.txt', block.hash)
    );
    const keyHex = event.volumeId;
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
    await writeFile(join(mainRoot, 'blocks', `${block.hash}.bin`), block.bytes);
    await mkdir(join(mainRoot, 'channels', keyHex), { recursive: true });
    await writeFile(join(mainRoot, 'channels', keyHex, `${event.eventHash}.bin`), event.bytes);
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
    expect(await readFile(join(backupRoot, 'blocks', `${block.hash}.bin`), 'utf8')).toBe('block-data');
    expect(await readFile(join(backupRoot, 'channels', keyHex, `${event.eventHash}.bin`), 'utf8')).toContain(block.hash);
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

    const block = await createStoredBlock('block-data');
    const createEvent = await createSignedStoredEvent(
      'nearbytes-test-reconcile-source',
      createCreateFilePayload('doc.txt', block.hash)
    );
    const deleteEvent = await createSignedStoredEvent(
      'nearbytes-test-reconcile-source',
      createDeleteFilePayload('doc.txt')
    );
    const keyHex = createEvent.volumeId;
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
    await writeFile(join(mainRoot, 'blocks', `${block.hash}.bin`), block.bytes);
    await mkdir(join(mainRoot, 'channels', keyHex), { recursive: true });
    await writeFile(join(mainRoot, 'channels', keyHex, `${createEvent.eventHash}.bin`), createEvent.bytes);
    await writeFile(join(mainRoot, 'channels', keyHex, `${deleteEvent.eventHash}.bin`), deleteEvent.bytes);

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

    expect(await readFile(join(backupRoot, 'blocks', `${block.hash}.bin`), 'utf8')).toBe('block-data');
    expect(await readFile(join(backupRoot, 'channels', keyHex, `${createEvent.eventHash}.bin`), 'utf8')).toContain(block.hash);
    expect(await readFile(join(backupRoot, 'channels', keyHex, `${deleteEvent.eventHash}.bin`), 'utf8')).toBe(
      new TextDecoder().decode(deleteEvent.bytes)
    );

    await rm(dir, { recursive: true, force: true });
  });

  it('collects orphaned blocks into the local root during reconciliation', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nearbytes-mr-'));
    const localRoot = join(dir, 'local');
    const remoteRoot = join(dir, 'remote');
    await mkdir(join(localRoot, 'blocks'), { recursive: true });
    await mkdir(join(remoteRoot, 'blocks'), { recursive: true });

    const orphanBlock = await createStoredBlock('orphan-data');
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

    await writeFile(join(remoteRoot, 'blocks', `${orphanBlock.hash}.bin`), orphanBlock.bytes);

    const storage = new MultiRootStorageBackend(config);
    await storage.reconcileConfiguredVolumes();

    expect(await readFile(join(localRoot, 'blocks', `${orphanBlock.hash}.bin`), 'utf8')).toBe('orphan-data');
    await expect(readFile(join(remoteRoot, 'blocks', `${orphanBlock.hash}.bin`), 'utf8')).rejects.toThrow();

    await rm(dir, { recursive: true, force: true });
  });

  it('keeps referenced blocks in place while still backfilling them to local storage', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nearbytes-mr-'));
    const localRoot = join(dir, 'local');
    const remoteRoot = join(dir, 'remote');
    await mkdir(join(localRoot, 'blocks'), { recursive: true });
    await mkdir(join(remoteRoot, 'blocks'), { recursive: true });

    const knownBlock = await createStoredBlock('known-data');
    const orphanBlock = await createStoredBlock('orphan-data');
    const createEvent = await createSignedStoredEvent(
      'nearbytes-test-remote-reference',
      createCreateFilePayload('known.txt', knownBlock.hash)
    );
    const volumeId = createEvent.volumeId;

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
    await writeFile(join(remoteRoot, 'channels', volumeId, `${createEvent.eventHash}.bin`), createEvent.bytes);
    await writeFile(join(remoteRoot, 'blocks', `${knownBlock.hash}.bin`), knownBlock.bytes);
    await writeFile(join(remoteRoot, 'blocks', `${orphanBlock.hash}.bin`), orphanBlock.bytes);

    const storage = new MultiRootStorageBackend(config);
    await storage.reconcileConfiguredVolumes();

    expect(await readFile(join(localRoot, 'blocks', `${knownBlock.hash}.bin`), 'utf8')).toBe('known-data');
    expect(await readFile(join(localRoot, 'blocks', `${orphanBlock.hash}.bin`), 'utf8')).toBe('orphan-data');
    expect(await readFile(join(remoteRoot, 'blocks', `${knownBlock.hash}.bin`), 'utf8')).toBe('known-data');
    await expect(readFile(join(remoteRoot, 'blocks', `${orphanBlock.hash}.bin`), 'utf8')).rejects.toThrow();

    await rm(dir, { recursive: true, force: true });
  });

  it('reconciles tracked volumes that only exist on disk using default rules', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nearbytes-mr-'));
    const localRoot = join(dir, 'local');
    const remoteRoot = join(dir, 'remote');
    await mkdir(join(localRoot, 'blocks'), { recursive: true });
    await mkdir(join(remoteRoot, 'blocks'), { recursive: true });

    const block = await createStoredBlock('referenced-data');
    const createEvent = await createSignedStoredEvent(
      'nearbytes-test-disk-only-volume',
      createCreateFilePayload('tracked.txt', block.hash)
    );
    const volumeId = createEvent.volumeId;

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
    await writeFile(join(remoteRoot, 'channels', volumeId, `${createEvent.eventHash}.bin`), createEvent.bytes);
    await writeFile(join(remoteRoot, 'blocks', `${block.hash}.bin`), block.bytes);

    const storage = new MultiRootStorageBackend(config);
    await storage.reconcileConfiguredVolumes();

    expect(await readFile(join(localRoot, 'channels', volumeId, `${createEvent.eventHash}.bin`), 'utf8')).toContain(block.hash);
    expect(await readFile(join(localRoot, 'blocks', `${block.hash}.bin`), 'utf8')).toBe('referenced-data');
    expect(await readFile(join(remoteRoot, 'blocks', `${block.hash}.bin`), 'utf8')).toBe('referenced-data');

    await rm(dir, { recursive: true, force: true });
  });

  it('does not reconcile malformed event files with non-canonical filenames', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nearbytes-mr-'));
    const mainRoot = join(dir, 'main');
    const backupRoot = join(dir, 'backup');
    await mkdir(join(mainRoot, 'channels'), { recursive: true });
    await mkdir(backupRoot, { recursive: true });

    const validEvent = await createSignedStoredEvent(
      'nearbytes-test-invalid-filename',
      createDeleteFilePayload('ignored.txt')
    );
    const invalidFileName = `${validEvent.eventHash} (1).bin`;
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
          volumeId: validEvent.volumeId,
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

    await mkdir(join(mainRoot, 'channels', validEvent.volumeId), { recursive: true });
    await writeFile(join(mainRoot, 'channels', validEvent.volumeId, invalidFileName), validEvent.bytes);

    const storage = new MultiRootStorageBackend(config);
    await storage.reconcileConfiguredVolumes();

    await expect(readFile(join(backupRoot, 'channels', validEvent.volumeId, invalidFileName), 'utf8')).rejects.toThrow();

    await rm(dir, { recursive: true, force: true });
  });

  it('audits and deletes spurious or invalid files from a storage location', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nearbytes-mr-'));
    const mainRoot = join(dir, 'main');
    await mkdir(join(mainRoot, 'blocks'), { recursive: true });
    await mkdir(join(mainRoot, 'channels'), { recursive: true });
    await writeFile(join(mainRoot, NEARBYTES_MARKER_FILE), 'marker', 'utf8');
    await writeFile(join(mainRoot, 'rogue.txt'), 'rogue', 'utf8');
    await writeFile(join(mainRoot, 'blocks', 'not-a-hash.bin'), 'bad', 'utf8');
    await writeFile(join(mainRoot, 'blocks', `${'a'.repeat(64)}.bin`), 'wrong-data', 'utf8');

    const storage = new MultiRootStorageBackend(createConfig({ mainPath: mainRoot }));
    const report = await storage.inspectStorageLocation('src-main');

    expect(report.issueCount).toBe(3);
    expect(report.issues.map((issue) => issue.code).sort()).toEqual([
      'block-hash-mismatch',
      'invalid-block-file-name',
      'unexpected-top-level-entry',
    ]);

    const result = await storage.repairStorageLocation('src-main', 'delete');
    expect(result.removedCount).toBe(3);
    await expect(readFile(join(mainRoot, 'rogue.txt'), 'utf8')).rejects.toThrow();
    await expect(readFile(join(mainRoot, 'blocks', 'not-a-hash.bin'), 'utf8')).rejects.toThrow();
    await expect(readFile(join(mainRoot, 'blocks', `${'a'.repeat(64)}.bin`), 'utf8')).rejects.toThrow();

    await rm(dir, { recursive: true, force: true });
  });

  it('audits and deletes malformed provider conflict copies from blocks and channels', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nearbytes-mr-'));
    const mainRoot = join(dir, 'main');
    const volumeId = 'b'.repeat(130);
    const validEventName = `${'c'.repeat(64)}.bin`;
    await mkdir(join(mainRoot, 'blocks', 'conflicts'), { recursive: true });
    await mkdir(join(mainRoot, 'channels', volumeId, 'duplicates'), { recursive: true });
    await writeFile(join(mainRoot, NEARBYTES_MARKER_FILE), 'marker', 'utf8');
    await writeFile(join(mainRoot, 'blocks', `${'a'.repeat(64)} (1).bin`), 'duplicate', 'utf8');
    await writeFile(join(mainRoot, 'channels', volumeId, `${'d'.repeat(64)} (1).bin`), 'duplicate', 'utf8');
    await writeFile(join(mainRoot, 'channels', volumeId, validEventName), 'not-a-real-event', 'utf8');

    const storage = new MultiRootStorageBackend(createConfig({ mainPath: mainRoot }));
    const report = await storage.inspectStorageLocation('src-main');

    expect(report.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(['event-deserialize-failed']));
    expect(report.issues.map((issue) => issue.detail)).toEqual(
      expect.arrayContaining([
        `Invalid block filename: ${'a'.repeat(64)} (1).bin`,
        'Unexpected directory inside blocks: conflicts',
        `Invalid event filename: ${'d'.repeat(64)} (1).bin`,
        'Unexpected directory inside channel: duplicates',
      ])
    );

    const result = await storage.repairStorageLocation('src-main', 'delete');
    expect(result.removedCount).toBeGreaterThanOrEqual(4);
    await expect(readFile(join(mainRoot, 'blocks', `${'a'.repeat(64)} (1).bin`), 'utf8')).rejects.toThrow();
    await expect(readFile(join(mainRoot, 'blocks', 'conflicts'), 'utf8')).rejects.toThrow();
    await expect(readFile(join(mainRoot, 'channels', volumeId, `${'d'.repeat(64)} (1).bin`), 'utf8')).rejects.toThrow();
    await expect(readFile(join(mainRoot, 'channels', volumeId, 'duplicates'), 'utf8')).rejects.toThrow();
    await expect(readFile(join(mainRoot, 'channels', volumeId, validEventName), 'utf8')).rejects.toThrow();

    await rm(dir, { recursive: true, force: true });
  });

  it('refuses destructive cleanup when Nearbytes.html is missing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nearbytes-mr-'));
    const mainRoot = join(dir, 'main');
    await mkdir(join(mainRoot, 'blocks'), { recursive: true });
    await mkdir(join(mainRoot, 'channels'), { recursive: true });
    await writeFile(join(mainRoot, 'blocks', 'not-a-hash.bin'), 'bad', 'utf8');

    const storage = new MultiRootStorageBackend(createConfig({ mainPath: mainRoot }));

    await expect(storage.repairStorageLocation('src-main', 'delete')).rejects.toThrow(
      'Cleanup is only allowed for storage locations that contain Nearbytes.html.'
    );

    await rm(dir, { recursive: true, force: true });
  });
});
