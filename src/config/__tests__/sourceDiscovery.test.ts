import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  discoverNearbytesSources,
  ensureNearbytesMarker,
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
    const matches = await Promise.all(
      sources.map(async (source) => ((await pathReal(source.path)) === realRoot ? source : null))
    );
    const discoveredForRoot = matches.filter((entry) => entry !== null);
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
    expect(markerPayload).toContain('nearbytes-root-marker');

    const second = await ensureNearbytesMarker(root);
    expect(second).toBe(false);

    await rm(markerPath, { force: true });
    const recreated = await ensureNearbytesMarker(root);
    expect(recreated).toBe(true);

    await rm(tempDir, { recursive: true, force: true });
  });
});

async function pathReal(value: string): Promise<string> {
  return path.resolve(await realpath(value));
}
