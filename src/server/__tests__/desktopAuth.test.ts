import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCryptoOperations } from '../../crypto/index.js';
import { createFileService } from '../../domain/fileService.js';
import { type RootsConfig } from '../../config/roots.js';
import { MultiRootStorageBackend } from '../../storage/multiRoot.js';
import { createApp } from '../app.js';

describe('Desktop API token enforcement', () => {
  let tempDir: string;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nearbytes-desktop-auth-'));
    const mainRoot = path.join(tempDir, 'main-root');
    const rootsConfigPath = path.join(tempDir, 'roots.json');
    await fs.mkdir(mainRoot, { recursive: true });

    const rootsConfig: RootsConfig = {
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
      ],
    };
    await fs.writeFile(rootsConfigPath, `${JSON.stringify(rootsConfig, null, 2)}\n`, 'utf8');

    const storage = new MultiRootStorageBackend(rootsConfig);
    const crypto = createCryptoOperations();
    const fileService = createFileService({ crypto, storage });
    app = createApp({
      fileService,
      crypto,
      storage,
      corsOrigin: true,
      maxUploadBytes: 5 * 1024 * 1024,
      rootsConfigPath,
      resolvedStorageDir: mainRoot,
      desktopApiToken: 'desktop-token-value',
    });
  });

  afterAll(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('allows health checks without desktop token', async () => {
    const res = await request(app).get('/health').expect(200);
    expect(res.body.ok).toBe(true);
  });

  it('requires desktop token on API routes', async () => {
    await request(app).get('/config/roots').expect(401);

    const allowed = await request(app)
      .get('/config/roots')
      .set('x-nearbytes-desktop-token', 'desktop-token-value')
      .expect(200);

    expect(Array.isArray(allowed.body.config?.roots)).toBe(true);
  });
});

