import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'fs/promises';
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
  it('parses and normalizes main/backup roots', () => {
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

    expect(parsed.version).toBe(1);
    expect(parsed.roots[0].path).not.toBe('./storage-a');
    expect(parsed.roots[1].kind).toBe('backup');
    expect(parsed.roots[1].strategy.name).toBe('allowlist');
    if (parsed.roots[1].strategy.name === 'allowlist') {
      expect(parsed.roots[1].strategy.channelKeys).toEqual(['abcd'.repeat(16)]);
    }
  });

  it('rejects invalid strategy combinations', () => {
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
    expect(loaded.config.roots).toHaveLength(1);
    expect(loaded.config.roots[0].kind).toBe('main');

    const updated: RootsConfig = {
      version: 1,
      roots: [
        ...loaded.config.roots,
        {
          id: 'backup-a',
          kind: 'backup',
          provider: 'mega',
          path: join(dir, 'backup-root'),
          enabled: true,
          writable: true,
          strategy: {
            name: 'allowlist',
            channelKeys: ['a'.repeat(130)],
          },
        },
      ],
    };

    await saveRootsConfig(configPath, updated);
    const raw = await readFile(configPath, 'utf8');
    const parsed = parseRootsConfig(JSON.parse(raw));
    expect(parsed.roots).toHaveLength(2);

    await rm(dir, { recursive: true, force: true });
  });

  it('builds a valid default config', () => {
    const config = createDefaultRootsConfig('/tmp/nearbytes-default-root');
    expect(config.version).toBe(1);
    expect(config.roots).toHaveLength(1);
    expect(config.roots[0].provider).toBe('local');
    expect(config.roots[0].strategy.name).toBe('all-keys');
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
    expect(parsed.roots[0].provider).toBe('local');
  });
});
