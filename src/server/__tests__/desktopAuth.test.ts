import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCryptoOperations } from '../../crypto/index.js';
import { createChatService } from '../../domain/chatService.js';
import { createFileService } from '../../domain/fileService.js';
import { type RootsConfig } from '../../config/roots.js';
import { MultiRootStorageBackend } from '../../storage/multiRoot.js';
import { createApp } from '../app.js';

describe('Desktop API token enforcement', () => {
  let tempDir: string;
  let uiDistDir: string;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nearbytes-desktop-auth-'));
    const mainRoot = path.join(tempDir, 'main-root');
    const rootsConfigPath = path.join(tempDir, 'roots.json');
    uiDistDir = path.join(tempDir, 'ui-dist');
    await fs.mkdir(mainRoot, { recursive: true });
    await fs.mkdir(uiDistDir, { recursive: true });
    await fs.writeFile(
      path.join(uiDistDir, 'index.html'),
      '<!doctype html><html><body>nearbytes-ui</body></html>\n',
      'utf8'
    );

    const rootsConfig: RootsConfig = {
      version: 2,
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
      ],
      defaultVolume: {
        destinations: [
          {
            sourceId: 'src-main',
            enabled: true,
            storeEvents: true,
            storeBlocks: true,
            copySourceBlocks: true,
            reservePercent: 10,
            fullPolicy: 'block-writes',
          },
        ],
      },
      volumes: [],
    };
    await fs.writeFile(rootsConfigPath, `${JSON.stringify(rootsConfig, null, 2)}\n`, 'utf8');

    const storage = new MultiRootStorageBackend(rootsConfig);
    const crypto = createCryptoOperations();
    const fileService = createFileService({ crypto, storage });
    const chatService = createChatService({ crypto, storage });
    app = createApp({
      fileService,
      chatService,
      crypto,
      storage,
      corsOrigin: true,
      maxUploadBytes: 5 * 1024 * 1024,
      rootsConfigPath,
      resolvedStorageDir: mainRoot,
      desktopApiToken: 'desktop-token-value',
      uiDistPath: uiDistDir,
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

    expect(Array.isArray(allowed.body.config?.sources)).toBe(true);
  });

  it('serves UI routes without desktop token in desktop mode', async () => {
    const res = await request(app).get('/').expect(200);
    expect(res.text).toContain('nearbytes-ui');
  });
});
