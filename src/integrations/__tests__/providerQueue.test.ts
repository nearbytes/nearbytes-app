import { mkdtemp, mkdir, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import type { RootsConfig } from '../../config/roots.js';
import { MultiRootStorageBackend } from '../../storage/multiRoot.js';
import { PersistentProviderQueue } from '../providerQueue.js';

const TEST_VOLUME_ID = 'ab'.repeat(65);
const TEST_EVENT_HASH = 'cd'.repeat(32);
const TEST_BLOCK_HASH = 'ef'.repeat(32);

const cleanupPaths: string[] = [];

afterEach(async () => {
  while (cleanupPaths.length > 0) {
    const target = cleanupPaths.pop();
    if (!target) {
      continue;
    }
    await rm(target, { recursive: true, force: true });
  }
});

describe('PersistentProviderQueue', () => {
  it('records typed observations from storage writes and deduplicates them', async () => {
    const { storage, runtimeDir } = await createStorageHarness('nearbytes-provider-queue-');
    const queue = new PersistentProviderQueue(storage, runtimeDir);
    await queue.start();

    await storage.writeFileForChannel(`channels/${TEST_VOLUME_ID}/${TEST_EVENT_HASH}.bin`, new TextEncoder().encode('event'), TEST_VOLUME_ID);
    await storage.writeFile(`blocks/${TEST_BLOCK_HASH}.bin`, new TextEncoder().encode('block'));
    await storage.writeFile(`blocks/${TEST_BLOCK_HASH}.bin`, new TextEncoder().encode('block'));

    const page = queue.listObservations();
    expect(page.observations).toHaveLength(2);
    expect(page.observations.map((entry) => `${entry.kind}:${entry.hash}`)).toEqual([
      `event:${TEST_EVENT_HASH}`,
      `block:${TEST_BLOCK_HASH}`,
    ]);

    await queue.stop();
  });

  it('persists observations and route acknowledgements across restarts', async () => {
    const { storage, runtimeDir } = await createStorageHarness('nearbytes-provider-queue-persist-');
    const queue = new PersistentProviderQueue(storage, runtimeDir);
    await queue.start();
    await storage.writeFileForChannel(`channels/${TEST_VOLUME_ID}/${TEST_EVENT_HASH}.bin`, new TextEncoder().encode('event'), TEST_VOLUME_ID);
    await queue.acknowledgeRoute('local-network', 'peer:alpha:pull', 1);
    await queue.stop();

    const reloaded = new PersistentProviderQueue(storage, runtimeDir);
    await reloaded.start();

    expect(reloaded.listObservations().observations).toHaveLength(1);
    expect(reloaded.getRouteState('local-network', 'peer:alpha:pull').lastAckedSequence).toBe(1);

    const persisted = JSON.parse(await readFile(path.join(runtimeDir, 'provider-queue.json'), 'utf8')) as {
      observations: Array<{ sequence: number }>;
      routes: Array<{ lastAckedSequence: number }>;
    };
    expect(persisted.observations).toHaveLength(1);
    expect(persisted.routes[0]?.lastAckedSequence).toBe(1);

    await reloaded.stop();
  });

  it('filters observations by volume id while retaining the global head sequence', async () => {
    const otherVolumeId = '12'.repeat(65);
    const otherEventHash = '34'.repeat(32);
    const { storage, runtimeDir } = await createStorageHarness('nearbytes-provider-queue-filter-', [TEST_VOLUME_ID, otherVolumeId]);
    const queue = new PersistentProviderQueue(storage, runtimeDir);
    await queue.start();

    await storage.writeFileForChannel(`channels/${TEST_VOLUME_ID}/${TEST_EVENT_HASH}.bin`, new TextEncoder().encode('event-a'), TEST_VOLUME_ID);
    await storage.writeFileForChannel(`channels/${otherVolumeId}/${otherEventHash}.bin`, new TextEncoder().encode('event-b'), otherVolumeId);
    await storage.writeFile(`blocks/${TEST_BLOCK_HASH}.bin`, new TextEncoder().encode('block'));

    const filtered = queue.listObservations({ volumeIds: [TEST_VOLUME_ID] });
    expect(filtered.headSequence).toBe(3);
    expect(filtered.observations).toHaveLength(1);
    expect(filtered.observations[0]?.volumeId).toBe(TEST_VOLUME_ID);

    await queue.stop();
  });
});

async function createStorageHarness(prefix: string, volumeIds: readonly string[] = [TEST_VOLUME_ID]): Promise<{
  storage: MultiRootStorageBackend;
  runtimeDir: string;
}> {
  const baseDir = await mkdtemp(path.join(tmpdir(), prefix));
  cleanupPaths.push(baseDir);
  const mainRoot = path.join(baseDir, 'main');
  const runtimeDir = path.join(baseDir, 'runtime');
  await mkdir(mainRoot, { recursive: true });
  await mkdir(runtimeDir, { recursive: true });
  return {
    storage: new MultiRootStorageBackend(createConfig(mainRoot, volumeIds)),
    runtimeDir,
  };
}

function createConfig(mainRoot: string, volumeIds: readonly string[]): RootsConfig {
  return {
    version: 2,
    sources: [
      {
        id: 'src-main',
        provider: 'local',
        path: mainRoot,
        enabled: true,
        writable: true,
        reservePercent: 5,
        opportunisticPolicy: 'drop-older-blocks',
      },
    ],
    defaultVolume: {
      destinations: [
        {
          sourceId: 'src-main',
          enabled: true,
          storeEvents: true,
          storeBlocks: true,
          copySourceBlocks: true,
          reservePercent: 5,
          fullPolicy: 'block-writes',
        },
      ],
    },
    volumes: volumeIds.map((volumeId) => ({
      volumeId,
      destinations: [
        {
          sourceId: 'src-main',
          enabled: true,
          storeEvents: true,
          storeBlocks: true,
          copySourceBlocks: true,
          reservePercent: 5,
          fullPolicy: 'block-writes',
        },
      ],
    })),
  };
}
