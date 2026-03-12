import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  classifyNearbytesProviderName,
  discoverNearbytesRoots,
  discoverNearbytesSources,
  ensureNearbytesMarker,
  inspectNearbytesRoot,
  NEARBYTES_LEGACY_MARKER_FILE,
  NEARBYTES_MARKER_FILE,
} from '../sourceDiscovery.js';

describe('source discovery', () => {
  const previousScanDirs = process.env.NEARBYTES_SOURCE_SCAN_DIRS;

  afterEach(() => {
    process.env.NEARBYTES_SOURCE_SCAN_DIRS = previousScanDirs;
  });

  it('deduplicates duplicate scan paths that resolve to same directory', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'nearbytes-source-discovery-'));
    const markerRoot = path.join(tempDir, 'shared-root');
    await mkdir(markerRoot, { recursive: true });
    await writeFile(path.join(markerRoot, NEARBYTES_MARKER_FILE), 'marker\n', 'utf8');

    const aliasPath = path.join(markerRoot, '..', path.basename(markerRoot));
    process.env.NEARBYTES_SOURCE_SCAN_DIRS = `${markerRoot};${aliasPath}`;

    const sources = await discoverNearbytesSources({
      maxDepth: 1,
      maxDirectories: 200,
    });

    const realRoot = await pathReal(markerRoot);
    const discoveredForRoot = sources.filter((source) => path.resolve(source.path) === realRoot);
    expect(discoveredForRoot).toHaveLength(1);

    await rm(tempDir, { recursive: true, force: true });
  });

  it('creates and recreates marker file when missing', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'nearbytes-marker-'));
    const root = path.join(tempDir, 'root');

    const created = await ensureNearbytesMarker(root);
    expect(created).toBe(true);

    const markerPath = path.join(root, NEARBYTES_MARKER_FILE);
    const markerPayload = await readFile(markerPath, 'utf8');
    expect(markerPayload).toContain('Nearbytes storage location');

    const second = await ensureNearbytesMarker(root);
    expect(second).toBe(false);

    await rm(markerPath, { force: true });
    const recreated = await ensureNearbytesMarker(root);
    expect(recreated).toBe(true);

    await rm(tempDir, { recursive: true, force: true });
  });

  it('discovers existing storage layout even without a marker file', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'nearbytes-source-layout-'));
    const root = path.join(tempDir, 'shared-root');
    await mkdir(path.join(root, 'channels', 'a'.repeat(64)), { recursive: true });
    await mkdir(path.join(root, 'blocks'), { recursive: true });

    process.env.NEARBYTES_SOURCE_SCAN_DIRS = root;

    const sources = await discoverNearbytesRoots({
      maxDepth: 1,
      maxDirectories: 100,
      includeDefaultRoots: false,
    });
    const expectedRoot = await pathReal(root);

    expect(sources).toHaveLength(1);
    expect(sources[0]?.path).toBe(expectedRoot);
    expect(sources[0]?.sourceType).toBe('layout');
    expect(sources[0]?.hasChannels).toBe(true);
    expect(sources[0]?.hasBlocks).toBe(true);
    expect(sources[0]?.volumeIds).toEqual(['a'.repeat(64)]);

    const manualSources = await discoverNearbytesSources({
      maxDepth: 1,
      maxDirectories: 100,
      includeDefaultRoots: false,
    });
    expect(manualSources.some((source) => source.path === expectedRoot && source.sourceType === 'layout')).toBe(true);

    await rm(tempDir, { recursive: true, force: true });
  });

  it('inspects marker-only roots without requiring channels or blocks', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'nearbytes-source-inspect-'));
    const root = path.join(tempDir, 'marker-root');
    await mkdir(root, { recursive: true });
    await writeFile(path.join(root, NEARBYTES_MARKER_FILE), 'marker\n', 'utf8');

    const inspection = await inspectNearbytesRoot(root);
    expect(inspection).not.toBeNull();
    expect(inspection?.sourceType).toBe('marker');
    expect(inspection?.hasMarker).toBe(true);
    expect(inspection?.hasChannels).toBe(false);
    expect(inspection?.hasBlocks).toBe(false);
    expect(inspection?.volumeIds).toEqual([]);

    await rm(tempDir, { recursive: true, force: true });
  });

  it('detects legacy hidden marker files for compatibility', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'nearbytes-source-legacy-marker-'));
    const root = path.join(tempDir, 'legacy-root');
    await mkdir(root, { recursive: true });
    await writeFile(path.join(root, NEARBYTES_LEGACY_MARKER_FILE), 'legacy-marker\n', 'utf8');

    const inspection = await inspectNearbytesRoot(root);
    expect(inspection).not.toBeNull();
    expect(inspection?.markerFile).toBe(path.join(root, NEARBYTES_LEGACY_MARKER_FILE));

    await rm(tempDir, { recursive: true, force: true });
  });

  it('classifies additional synced providers', () => {
    expect(classifyNearbytesProviderName('OneDrive - Research')).toBe('onedrive');
    expect(classifyNearbytesProviderName('iCloud Drive')).toBe('icloud');
    expect(classifyNearbytesProviderName('Apple Shared')).toBe('icloud');
    expect(classifyNearbytesProviderName('Dropbox')).toBe('dropbox');
  });
});

async function pathReal(value: string): Promise<string> {
  return path.resolve(await realpath(value));
}
