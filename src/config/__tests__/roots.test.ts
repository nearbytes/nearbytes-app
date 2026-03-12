import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  createDefaultRootsConfig,
  loadOrCreateRootsConfig,
  parseRootsConfig,
  saveRootsConfig,
  type RootsConfig,
} from '../roots.js';

describe('roots config', () => {
  it('migrates legacy main/backup roots into v2 sources and volume policies', () => {
    const parsed = parseRootsConfig({
      version: 1,
      roots: [
        {
          id: 'main-a',
          kind: 'main',
          provider: 'local',
          path: './storage-a',
          enabled: true,
          writable: true,
          strategy: { name: 'all-keys' },
        },
        {
          id: 'backup-a',
          kind: 'backup',
          provider: 'dropbox',
          path: './storage-b',
          enabled: true,
          writable: false,
          strategy: {
            name: 'allowlist',
            channelKeys: ['ABCD'.repeat(16), 'abcd'.repeat(16)],
          },
        },
      ],
    });

    expect(parsed.version).toBe(2);
    expect(parsed.sources).toHaveLength(2);
    expect(parsed.sources[0].path).not.toBe('./storage-a');
    expect(parsed.defaultVolume.destinations).toEqual([
      expect.objectContaining({
        sourceId: 'main-a',
        storeEvents: true,
        storeBlocks: true,
        fullPolicy: 'block-writes',
      }),
    ]);
    expect(parsed.volumes).toEqual([
      expect.objectContaining({
        volumeId: 'abcd'.repeat(16),
        destinations: [
          expect.objectContaining({
            sourceId: 'backup-a',
          }),
        ],
      }),
    ]);
  });

  it('rejects invalid legacy strategy combinations', () => {
    expect(() =>
      parseRootsConfig({
        version: 1,
        roots: [
          {
            id: 'bad-main',
            kind: 'main',
            provider: 'local',
            path: '/tmp/root',
            enabled: true,
            writable: true,
            strategy: { name: 'allowlist', channelKeys: [] },
          },
        ],
      })
    ).toThrow(/all-keys/i);
  });

  it('creates a default manifest when missing and saves atomically', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nearbytes-roots-config-'));
    const configPath = join(dir, 'roots.json');

    const loaded = await loadOrCreateRootsConfig({
      configPath,
      defaultRootPath: join(dir, 'bootstrap-root'),
    });

    expect(loaded.created).toBe(true);
    expect(loaded.config.sources).toHaveLength(1);
    expect(loaded.config.defaultVolume.destinations).toHaveLength(1);

    const updated: RootsConfig = {
      version: 2,
      sources: [
        ...loaded.config.sources,
        {
          id: 'src-backup',
          provider: 'mega',
          path: join(dir, 'backup-root'),
          enabled: true,
          writable: true,
          reservePercent: 5,
          opportunisticPolicy: 'drop-older-blocks',
        },
      ],
      defaultVolume: loaded.config.defaultVolume,
      volumes: [
        {
          volumeId: 'a'.repeat(130),
          destinations: [
            {
              sourceId: 'src-backup',
              enabled: true,
              storeEvents: true,
              storeBlocks: true,
              copySourceBlocks: true,
              reservePercent: 5,
              fullPolicy: 'block-writes',
            },
          ],
        },
      ],
    };

    await saveRootsConfig(configPath, updated);
    const raw = await readFile(configPath, 'utf8');
    const parsed = parseRootsConfig(JSON.parse(raw));
    expect(parsed.sources).toHaveLength(2);
    expect(parsed.volumes).toHaveLength(1);

    await rm(dir, { recursive: true, force: true });
  });

  it('builds a valid default config', () => {
    const config = createDefaultRootsConfig('/tmp/nearbytes-default-root');
    expect(config.version).toBe(2);
    expect(config.sources).toHaveLength(1);
    expect(config.sources[0].provider).toBe('local');
    expect(config.defaultVolume.destinations).toEqual([
      expect.objectContaining({
        sourceId: config.sources[0].id,
        fullPolicy: 'block-writes',
      }),
    ]);
  });

  it('defaults provider to local when omitted for backward compatibility', () => {
    const parsed = parseRootsConfig({
      version: 1,
      roots: [
        {
          id: 'legacy-main',
          kind: 'main',
          path: '/tmp/legacy-root',
          enabled: true,
          writable: true,
          strategy: { name: 'all-keys' },
        },
      ],
    });
    expect(parsed.sources[0].provider).toBe('local');
  });

  it('rejects configs without any durable default storage location', () => {
    expect(() =>
      parseRootsConfig({
        version: 2,
        sources: [
          {
            id: 'src-local',
            provider: 'local',
            path: '/tmp/nearbytes-no-default',
            enabled: true,
            writable: true,
            reservePercent: 5,
            opportunisticPolicy: 'drop-older-blocks',
          },
        ],
        defaultVolume: {
          destinations: [],
        },
        volumes: [],
      })
    ).toThrow(/durable default storage location/i);
  });

  it('preserves a valid pending move marker', () => {
    const parsed = parseRootsConfig({
      version: 2,
      sources: [
        {
          id: 'src-main',
          provider: 'local',
          path: '/tmp/source-main',
          enabled: true,
          writable: true,
          reservePercent: 5,
          opportunisticPolicy: 'drop-older-blocks',
        },
        {
          id: 'src-move-target',
          provider: 'local',
          path: '/tmp/source-target',
          enabled: true,
          writable: true,
          reservePercent: 5,
          opportunisticPolicy: 'drop-older-blocks',
          moveFromSourceId: 'src-main',
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
      volumes: [],
    });

    expect(parsed.sources.find((source) => source.id === 'src-move-target')?.moveFromSourceId).toBe('src-main');
  });

  it('rejects invalid pending move markers', () => {
    expect(() =>
      parseRootsConfig({
        version: 2,
        sources: [
          {
            id: 'src-main',
            provider: 'local',
            path: '/tmp/source-main',
            enabled: true,
            writable: true,
            reservePercent: 5,
            opportunisticPolicy: 'drop-older-blocks',
          },
          {
            id: 'src-move-target',
            provider: 'local',
            path: '/tmp/source-target',
            enabled: true,
            writable: true,
            reservePercent: 5,
            opportunisticPolicy: 'drop-older-blocks',
            moveFromSourceId: 'src-missing',
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
        volumes: [],
      })
    ).toThrow(/Pending move source not found/i);

    expect(() =>
      parseRootsConfig({
        version: 2,
        sources: [
          {
            id: 'src-main',
            provider: 'local',
            path: '/tmp/source-main',
            enabled: true,
            writable: true,
            reservePercent: 5,
            opportunisticPolicy: 'drop-older-blocks',
            moveFromSourceId: 'src-main',
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
        volumes: [],
      })
    ).toThrow(/cannot move from itself/i);
  });

  it('self-heals existing configs by restoring the home Nearbytes location as a default route', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nearbytes-roots-config-'));
    const configPath = join(dir, 'roots.json');
    const bootstrapRoot = join(dir, 'home-nearbytes');
    await writeFile(
      configPath,
      `${JSON.stringify({
        version: 2,
        sources: [
          {
            id: 'src-orphan',
            provider: 'local',
            path: join(dir, 'orphan-root'),
            enabled: true,
            writable: true,
            reservePercent: 5,
            opportunisticPolicy: 'drop-older-blocks',
          },
        ],
        defaultVolume: {
          destinations: [],
        },
        volumes: [],
      }, null, 2)}\n`,
      'utf8'
    );

    const loaded = await loadOrCreateRootsConfig({
      configPath,
      defaultRootPath: bootstrapRoot,
    });

    expect(
      loaded.config.sources.some((source) => source.path === bootstrapRoot && source.provider === 'local')
    ).toBe(true);
    expect(loaded.config.defaultVolume.destinations.length).toBeGreaterThan(0);
    const saved = parseRootsConfig(JSON.parse(await readFile(configPath, 'utf8')));
    expect(
      saved.defaultVolume.destinations.some((destination) => {
        const source = saved.sources.find((entry) => entry.id === destination.sourceId);
        return source?.path === bootstrapRoot;
      })
    ).toBe(true);

    await rm(dir, { recursive: true, force: true });
  });
});
