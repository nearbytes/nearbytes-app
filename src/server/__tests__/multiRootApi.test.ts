import { randomBytes } from 'crypto';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import type { Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCryptoOperations } from '../../crypto/index.js';
import { createChatService } from '../../domain/chatService.js';
import { createFileService } from '../../domain/fileService.js';
import { createSecret } from '../../types/keys.js';
import { bytesToHex } from '../../utils/encoding.js';
import { type RootsConfig } from '../../config/roots.js';
import { MultiRootStorageBackend } from '../../storage/multiRoot.js';
import { createApp } from '../app.js';

const SECRET = 'nearbytes-multi-root-secret';

interface ConfigRootsResponseBody {
  configPath: string | null;
  config: RootsConfig;
}

interface ConsolidationPlanResponseBody {
  plan: {
    source: {
      id: string;
      fileCount: number;
    };
    candidates: Array<{
      id: string;
      eligible: boolean;
    }>;
  };
}

interface ConsolidationResponseBody extends ConfigRootsResponseBody {
  result: {
    sourceId: string;
    targetId: string;
    movedFiles: number;
  };
}

interface OpenResponseBody {
  token?: string;
  volumeId: string;
}

interface UploadResponseBody {
  created: {
    blobHash: string;
    filename: string;
  };
}

interface ListFilesResponseBody {
  files: Array<{
    filename: string;
  }>;
}

interface DiscoverSourcesResponseBody {
  sourceCount: number;
  sources: Array<{
    path: string;
  }>;
}

function typedBody<T>(response: Response): T {
  return response.body as unknown as T;
}

describe('Nearbytes API (multi-root)', () => {
  let tempDir: string;
  let app: ReturnType<typeof createApp>;
  let tokenKey: Uint8Array;
  let rootsConfigPath: string;
  let mainRoot: string;
  let backupRoot: string;
  let backupRoot2: string;

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nearbytes-multi-root-api-'));
    mainRoot = path.join(tempDir, 'main-root');
    backupRoot = path.join(tempDir, 'backup-root');
    backupRoot2 = path.join(tempDir, 'backup-root-2');
    rootsConfigPath = path.join(tempDir, 'roots.json');
    tokenKey = randomBytes(32);

    await fs.mkdir(mainRoot, { recursive: true });
    await fs.mkdir(backupRoot, { recursive: true });
    await fs.mkdir(backupRoot2, { recursive: true });

    const crypto = createCryptoOperations();
    const keyPair = await crypto.deriveKeys(createSecret(SECRET));
    const volumeId = bytesToHex(keyPair.publicKey);

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
        {
          id: 'src-backup-1',
          provider: 'mega',
          path: backupRoot,
          enabled: true,
          writable: true,
          reservePercent: 10,
          opportunisticPolicy: 'drop-older-blocks',
        },
        {
          id: 'src-backup-2',
          provider: 'dropbox',
          path: backupRoot2,
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
      volumes: [
        {
          volumeId,
          destinations: [
            {
              sourceId: 'src-backup-1',
              enabled: true,
              storeEvents: true,
              storeBlocks: true,
              copySourceBlocks: true,
              reservePercent: 10,
              fullPolicy: 'block-writes',
            },
            {
              sourceId: 'src-backup-2',
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
    };

    await fs.writeFile(rootsConfigPath, `${JSON.stringify(rootsConfig, null, 2)}\n`, 'utf8');

    const storage = new MultiRootStorageBackend(rootsConfig);
    const fileService = createFileService({ crypto, storage });
    const chatService = createChatService({ crypto, storage });

    app = createApp({
      fileService,
      chatService,
      crypto,
      storage,
      tokenKey,
      corsOrigin: true,
      maxUploadBytes: 5 * 1024 * 1024,
      rootsConfigPath,
      resolvedStorageDir: mainRoot,
    });
  });

  afterAll(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('allows local root config access and blocks forwarded non-loopback requests', async () => {
    const localRes = await request(app).get('/config/roots').expect(200);
    const localBody = typedBody<ConfigRootsResponseBody>(localRes);
    expect(localBody.config).toBeDefined();
    expect(localBody.config.sources).toHaveLength(3);

    await request(app)
      .get('/config/roots')
      .set('x-forwarded-for', '198.51.100.10')
      .expect(403);
  });

  it('updates source config and persists to disk', async () => {
    const current = await request(app).get('/config/roots').expect(200);
    const currentBody = typedBody<ConfigRootsResponseBody>(current);
    const nextConfig = {
      ...currentBody.config,
      sources: currentBody.config.sources.map((source) =>
        source.id === 'src-backup-1' ? { ...source, writable: false } : source
      ),
    };

    const updateRes = await request(app)
      .put('/config/roots')
      .send({ config: nextConfig })
      .expect(200);
    const updateBody = typedBody<ConfigRootsResponseBody>(updateRes);

    const backupSource = updateBody.config.sources.find((source) => source.id === 'src-backup-1');
    expect(backupSource?.writable).toBe(false);

    const diskConfigRaw = await fs.readFile(rootsConfigPath, 'utf8');
    const diskConfig = JSON.parse(diskConfigRaw) as { sources: Array<{ id: string; writable: boolean }> };
    const persistedBackup = diskConfig.sources.find((source) => source.id === 'src-backup-1');
    expect(persistedBackup?.writable).toBe(false);
  });

  it('reads event logs across sources and retrieves blocks when key data is split', async () => {
    const configRes = await request(app).get('/config/roots').expect(200);
    const configBody = typedBody<ConfigRootsResponseBody>(configRes);
    const writableConfig = {
      ...configBody.config,
      sources: configBody.config.sources.map((source) =>
        source.id === 'src-backup-1' ? { ...source, writable: true } : source
      ),
    };
    await request(app).put('/config/roots').send({ config: writableConfig }).expect(200);

    const openRes = await request(app).post('/open').send({ secret: SECRET }).expect(200);
    const openBody = typedBody<OpenResponseBody>(openRes);
    expect(openBody.token).toBeTypeOf('string');
    const token = openBody.token as string;
    const volumeId = openBody.volumeId;

    const uploadRes = await request(app)
      .post('/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('split-root-content'), 'split.txt')
      .expect(200);
    const uploadBody = typedBody<UploadResponseBody>(uploadRes);
    const blobHash = uploadBody.created.blobHash;

    const channelDirMain = path.join(mainRoot, 'channels', volumeId);
    const eventFilesMain = await fs.readdir(channelDirMain);
    const eventFileName = eventFilesMain.find((name) => name.endsWith('.bin'));
    expect(eventFileName).toBeDefined();

    await fs.rm(path.join(mainRoot, 'channels', volumeId, eventFileName!), { force: true });
    await fs.rm(path.join(backupRoot, 'blocks', `${blobHash}.bin`), { force: true });

    const listRes = await request(app)
      .get('/files')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const listBody = typedBody<ListFilesResponseBody>(listRes);
    expect(listBody.files).toHaveLength(1);
    expect(listBody.files[0].filename).toBe('split.txt');

    const downloadRes = await request(app)
      .get(`/file/${blobHash}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const bodyText =
      typeof downloadRes.body === 'string'
        ? downloadRes.body
        : downloadRes.body instanceof Buffer
          ? downloadRes.body.toString('utf8')
          : (downloadRes as unknown as { text?: string }).text ?? '';

    expect(bodyText).toBe('split-root-content');
  });

  it('discovers .nearbytes marker sources in configured scan paths', async () => {
    const markerPath = path.join(backupRoot, '.nearbytes');
    await fs.writeFile(markerPath, 'nearbytes-source', 'utf8');
    const originalScanPaths = process.env.NEARBYTES_SOURCE_SCAN_DIRS;
    process.env.NEARBYTES_SOURCE_SCAN_DIRS = tempDir;

    try {
      const res = await request(app).get('/sources/discover').expect(200);
      const body = typedBody<DiscoverSourcesResponseBody>(res);
      expect(body.sourceCount).toBeGreaterThanOrEqual(1);
      const expectedRoot = path.resolve(await fs.realpath(backupRoot));
      const found = body.sources.some((source) => path.resolve(source.path) === expectedRoot);
      expect(found).toBe(true);
    } finally {
      process.env.NEARBYTES_SOURCE_SCAN_DIRS = originalScanPaths;
    }
  });

  it('recreates .nearbytes marker after deletion for configured sources', async () => {
    const openRes = await request(app).post('/open').send({ secret: SECRET }).expect(200);
    const token = typedBody<OpenResponseBody>(openRes).token as string;

    await request(app)
      .post('/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('marker-seed'), 'marker-seed.txt')
      .expect(200);

    const markerPath = path.join(mainRoot, '.nearbytes');
    await fs.stat(markerPath);
    await fs.rm(markerPath, { force: true });

    await request(app)
      .post('/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('marker-recreate'), 'marker-recreate.txt')
      .expect(200);

    await fs.stat(markerPath);
  });

  it('provides consolidation candidates and consolidates one source into another', async () => {
    const openRes = await request(app).post('/open').send({ secret: SECRET }).expect(200);
    const token = typedBody<OpenResponseBody>(openRes).token as string;

    await request(app)
      .post('/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('consolidate-me'), 'consolidate-me.txt')
      .expect(200);

    const planRes = await request(app)
      .get('/config/roots/consolidate/src-backup-1/plan')
      .expect(200);
    const planBody = typedBody<ConsolidationPlanResponseBody>(planRes);
    const destination = planBody.plan.candidates.find((candidate) => candidate.id === 'src-backup-2');
    expect(destination?.eligible).toBe(true);

    const consolidateRes = await request(app)
      .post('/config/roots/consolidate')
      .send({ sourceId: 'src-backup-1', targetId: 'src-backup-2' })
      .expect(200);
    const consolidateBody = typedBody<ConsolidationResponseBody>(consolidateRes);
    expect(consolidateBody.result.sourceId).toBe('src-backup-1');
    expect(consolidateBody.result.targetId).toBe('src-backup-2');
    expect(consolidateBody.config.sources.some((source) => source.id === 'src-backup-1')).toBe(false);
    expect(consolidateBody.config.sources.some((source) => source.id === 'src-backup-2')).toBe(true);
  });
});
