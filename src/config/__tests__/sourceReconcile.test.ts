import { mkdtemp, mkdir, realpath, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import type { RootsConfig } from '../roots.js';
import { reconcileDiscoveredSources } from '../sourceReconcile.js';
import { NEARBYTES_MARKER_FILE } from '../sourceDiscovery.js';

describe('source reconciliation', () => {
  const previousScanDirs = process.env.NEARBYTES_SOURCE_SCAN_DIRS;

  afterEach(() => {
    process.env.NEARBYTES_SOURCE_SCAN_DIRS = previousScanDirs;
  });

  it('adds a new source once and links matching known volumes as explicit destinations', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'nearbytes-source-reconcile-'));
    const mainRoot = path.join(tempDir, 'main-root');
    const sharedRoot = path.join(tempDir, 'dropbox-share');
    const knownVolumeId = 'a'.repeat(64);

    await mkdir(mainRoot, { recursive: true });
    await mkdir(path.join(sharedRoot, 'channels', knownVolumeId), { recursive: true });
    await mkdir(path.join(sharedRoot, 'blocks'), { recursive: true });
    process.env.NEARBYTES_SOURCE_SCAN_DIRS = sharedRoot;

    const config = createConfig(mainRoot);
    const first = await reconcileDiscoveredSources({
      currentConfig: config,
      knownVolumeIds: [knownVolumeId],
      includeDefaultRoots: false,
    });

    expect(first.summary.sourcesAdded).toBe(1);
    expect(first.summary.volumeTargetsAdded).toBe(1);
    expect(first.items).toHaveLength(1);
    expect(first.items[0]?.actions).toContain('added-source');
    expect(first.items[0]?.actions).toContain('added-volume-target');
    expect(first.items[0]?.addedTargetVolumeIds).toEqual([knownVolumeId]);

    const expectedSharedRoot = await realPath(sharedRoot);
    const addedSource = first.config.sources.find((source) => path.resolve(source.path) === expectedSharedRoot);
    expect(addedSource).toBeDefined();
    const volumePolicy = first.config.volumes.find((volume) => volume.volumeId === knownVolumeId);
    expect(volumePolicy?.destinations.some((destination) => destination.sourceId === addedSource?.id)).toBe(true);
    expect(first.config.defaultVolume.destinations).toHaveLength(1);

    const second = await reconcileDiscoveredSources({
      currentConfig: first.config,
      knownVolumeIds: [knownVolumeId],
      includeDefaultRoots: false,
    });

    expect(second.summary.sourcesAdded).toBe(0);
    expect(second.summary.volumeTargetsAdded).toBe(0);
    expect(second.config.sources.filter((source) => path.resolve(source.path) === expectedSharedRoot)).toHaveLength(1);

    await rm(tempDir, { recursive: true, force: true });
  });

  it('records newly available shares without auto-targeting unrelated volumes', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'nearbytes-source-reconcile-'));
    const mainRoot = path.join(tempDir, 'main-root');
    const sharedRoot = path.join(tempDir, 'icloud-share');
    const unknownVolumeId = 'b'.repeat(64);

    await mkdir(mainRoot, { recursive: true });
    await mkdir(path.join(sharedRoot, 'channels', unknownVolumeId), { recursive: true });
    await writeFile(path.join(sharedRoot, NEARBYTES_MARKER_FILE), '<html></html>\n', 'utf8');
    process.env.NEARBYTES_SOURCE_SCAN_DIRS = sharedRoot;

    const result = await reconcileDiscoveredSources({
      currentConfig: createConfig(mainRoot),
      knownVolumeIds: [],
      includeDefaultRoots: false,
    });

    expect(result.summary.sourcesAdded).toBe(1);
    expect(result.summary.volumeTargetsAdded).toBe(0);
    expect(result.summary.availableShares).toBe(1);
    expect(result.items[0]?.unknownVolumeIds).toEqual([unknownVolumeId]);
    expect(result.items[0]?.actions).toContain('available-share');
    expect(result.config.volumes).toHaveLength(0);

    await rm(tempDir, { recursive: true, force: true });
  });
});

function createConfig(mainRoot: string): RootsConfig {
  return {
    version: 2,
    sources: [
      {
        id: 'src-main-1',
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
          sourceId: 'src-main-1',
          enabled: true,
          storeEvents: true,
          storeBlocks: true,
          copySourceBlocks: true,
          reservePercent: 5,
          fullPolicy: 'block-writes',
        },
      ],
    },
    volumes: [],
  };
}

async function realPath(value: string): Promise<string> {
  return path.resolve(await realpath(value));
}
