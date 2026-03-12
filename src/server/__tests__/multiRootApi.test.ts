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
import type { TransportAdapter } from '../../integrations/adapters.js';
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

interface ReconcileSourcesResponseBody extends ConfigRootsResponseBody {
  runKey: string;
  changed: boolean;
  summary: {
    sourcesAdded: number;
    volumeTargetsAdded: number;
  };
  items: Array<{
    configuredSourceId?: string;
    addedTargetVolumeIds: string[];
  }>;
}

interface ProviderAccountsResponseBody {
  accounts: Array<{
    id: string;
    provider: string;
  }>;
  providers: Array<{
    provider: string;
    isConnected: boolean;
    setup?: {
      status: string;
      config?: {
        clientId?: string;
        hasClientSecret?: boolean;
      };
    };
  }>;
}

interface ManagedShareSummaryBody {
  share: {
    id: string;
    provider: string;
    label: string;
    sourceId?: string;
    localPath: string;
  };
  attachments: Array<{
    volumeId: string;
    sourceId: string;
  }>;
  state: {
    status: string;
  };
}

interface ManagedShareMutationResponseBody {
  summary: ManagedShareSummaryBody;
}

interface JoinLinkParseResponseBody {
  plan: {
    attachments: Array<{
      selectedEndpoint: {
        endpoint: {
          provider?: string;
        };
      } | null;
    }>;
  };
}

interface JoinLinkOpenResponseBody extends JoinLinkParseResponseBody {
  secret: string;
  volumeId: string | null;
  actions: Array<{
    attachmentId: string;
    status: string;
    shareId?: string;
  }>;
}

function typedBody<T>(response: Response): T {
  return response.body as unknown as T;
}

function createWritableSource(
  id: string,
  rootPath: string,
  overrides: Partial<RootsConfig['sources'][number]> = {}
): RootsConfig['sources'][number] {
  return {
    id,
    provider: 'local',
    path: rootPath,
    enabled: true,
    writable: true,
    reservePercent: 5,
    opportunisticPolicy: 'drop-older-blocks',
    ...overrides,
  };
}

class FakeProviderAdapter implements TransportAdapter {
  private googleClientId?: string;

  constructor(
    readonly provider: string,
    readonly label: string,
    readonly description: string
  ) {}

  readonly supportsAccountConnection = true;

  async getSetupState() {
    if (this.provider === 'gdrive' && !this.googleClientId) {
      return {
        status: 'needs-config' as const,
        detail: 'Google Drive needs a Desktop app OAuth client ID.',
        config: {
          hasClientSecret: false,
        },
      };
    }
    return {
      status: 'ready' as const,
      detail: `${this.label} is ready.`,
      config: this.provider === 'gdrive'
        ? {
            clientId: this.googleClientId,
            hasClientSecret: false,
          }
        : undefined,
    };
  }

  async configure(input: { clientId?: string }) {
    if (this.provider === 'gdrive') {
      this.googleClientId = input.clientId?.trim() || undefined;
    }
    return this.getSetupState();
  }

  async probe(endpoint: { transport: string; provider?: string }) {
    if (endpoint.transport === 'provider-share' && endpoint.provider === this.provider) {
      return {
        status: 'ready' as const,
        detail: `${this.label} is available.`,
        badges: ['Fake'],
      };
    }
    return {
      status: 'unsupported' as const,
      detail: `${this.label} is not available for this endpoint.`,
      badges: ['Fake'],
    };
  }

  async connect(input: { accountId?: string; email?: string; label?: string; provider: string }) {
    return {
      status: 'connected' as const,
      account: {
        id: input.accountId ?? `acct-${this.provider}-test`,
        provider: this.provider,
        label: input.label ?? this.label,
        email: input.email,
        state: 'connected' as const,
        detail: `${this.label} is connected.`,
        createdAt: 0,
        updatedAt: 0,
      },
    };
  }

  async createManagedShare(input: { remoteDescriptor?: Record<string, unknown> }) {
    return {
      remoteDescriptor: {
        ...(input.remoteDescriptor ?? {}),
        remoteId: (input.remoteDescriptor?.remoteId as string | undefined) ?? `${this.provider}-remote-id`,
      },
      capabilities: ['mirror', 'read', 'write', 'invite'],
    };
  }

  async acceptInvite(input: { remoteDescriptor?: Record<string, unknown> }) {
    return {
      remoteDescriptor: {
        ...(input.remoteDescriptor ?? {}),
      },
      capabilities: ['mirror', 'read', 'write', 'accept'],
    };
  }

  async getState() {
    return {
      status: 'ready' as const,
      detail: `${this.label} mirror is ready.`,
      badges: ['Fake'],
    };
  }
}

describe('Nearbytes API (multi-root)', () => {
  let tempDir: string;
  let app: ReturnType<typeof createApp>;
  let tokenKey: Uint8Array;
  let rootsConfigPath: string;
  let mainRoot: string;
  let backupRoot: string;
  let backupRoot2: string;
  const previousHome = process.env.HOME;

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nearbytes-multi-root-api-'));
    process.env.HOME = tempDir;
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
      integrationOptions: {
        adapters: [
          new FakeProviderAdapter('gdrive', 'Google Drive', 'Managed folders backed by Google Drive.'),
          new FakeProviderAdapter('mega', 'MEGA', 'Managed folders backed by MEGA CLI.'),
        ],
      },
    });
  });

  afterAll(async () => {
    process.env.HOME = previousHome;
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

  it('rejects invalid pending move markers in the roots config api', async () => {
    const invalidTargetRoot = path.join(tempDir, 'invalid-move-target');
    await fs.mkdir(invalidTargetRoot, { recursive: true });

    const current = await request(app).get('/config/roots').expect(200);
    const currentBody = typedBody<ConfigRootsResponseBody>(current);
    const invalidConfig = {
      ...currentBody.config,
      sources: [
        ...currentBody.config.sources,
        createWritableSource('src-invalid-move-target', invalidTargetRoot, {
          moveFromSourceId: 'src-missing-source',
        }),
      ],
    };

    const invalidRes = await request(app)
      .put('/config/roots')
      .send({ config: invalidConfig })
      .expect(400);

    expect((invalidRes.body as { error?: { message?: string } }).error?.message).toMatch(
      /Pending move source not found/i
    );
  });

  it('clears the pending move marker after consolidation through the api', async () => {
    const moveSourceRoot = path.join(tempDir, 'move-source-root');
    const moveTargetRoot = path.join(tempDir, 'move-target-root');
    await fs.mkdir(path.join(moveSourceRoot, 'blocks'), { recursive: true });
    await fs.mkdir(moveTargetRoot, { recursive: true });
    await fs.writeFile(path.join(moveSourceRoot, 'blocks', 'move.bin'), 'move-data', 'utf8');

    const current = await request(app).get('/config/roots').expect(200);
    const currentBody = typedBody<ConfigRootsResponseBody>(current);
    const nextConfig = {
      ...currentBody.config,
      sources: [
        ...currentBody.config.sources.filter(
          (source) => source.id !== 'src-move-source' && source.id !== 'src-move-target'
        ),
        createWritableSource('src-move-source', moveSourceRoot),
        createWritableSource('src-move-target', moveTargetRoot, {
          moveFromSourceId: 'src-move-source',
        }),
      ],
    };

    const updateRes = await request(app)
      .put('/config/roots')
      .send({ config: nextConfig })
      .expect(200);
    const updatedBody = typedBody<ConfigRootsResponseBody>(updateRes);
    expect(updatedBody.config.sources.find((source) => source.id === 'src-move-target')?.moveFromSourceId).toBe(
      'src-move-source'
    );

    const consolidateRes = await request(app)
      .post('/config/roots/consolidate')
      .send({ sourceId: 'src-move-source', targetId: 'src-move-target' })
      .expect(200);
    const consolidateBody = typedBody<ConsolidationResponseBody>(consolidateRes);

    expect(consolidateBody.config.sources.some((source) => source.id === 'src-move-source')).toBe(false);
    expect(consolidateBody.config.sources.find((source) => source.id === 'src-move-target')?.moveFromSourceId).toBeUndefined();
    expect(await fs.readFile(path.join(moveTargetRoot, 'blocks', 'move.bin'), 'utf8')).toBe('move-data');

    const persistedConfig = JSON.parse(await fs.readFile(rootsConfigPath, 'utf8')) as ConfigRootsResponseBody['config'];
    expect(persistedConfig.sources.some((source) => source.id === 'src-move-source')).toBe(false);
    expect(persistedConfig.sources.find((source) => source.id === 'src-move-target')?.moveFromSourceId).toBeUndefined();
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

  it('discovers Nearbytes.html marker sources in configured scan paths', async () => {
    const markerPath = path.join(backupRoot, 'Nearbytes.html');
    await fs.writeFile(markerPath, '<html></html>', 'utf8');
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

  it('reconciles discovered shares into sources and explicit volume destinations', async () => {
    const originalScanPaths = process.env.NEARBYTES_SOURCE_SCAN_DIRS;
    const discoveredRoot = path.join(tempDir, 'icloud-share');
    const openRes = await request(app).post('/open').send({ secret: SECRET }).expect(200);
    const openBody = typedBody<OpenResponseBody>(openRes);
    await fs.mkdir(path.join(discoveredRoot, 'channels', openBody.volumeId), { recursive: true });
    await fs.mkdir(path.join(discoveredRoot, 'blocks'), { recursive: true });

    process.env.NEARBYTES_SOURCE_SCAN_DIRS = discoveredRoot;

    try {
      const reconcileRes = await request(app)
        .post('/sources/reconcile')
        .send({ knownVolumeIds: [openBody.volumeId] })
        .expect(200);
      const reconcileBody = typedBody<ReconcileSourcesResponseBody>(reconcileRes);

      expect(reconcileBody.changed).toBe(true);
      expect(reconcileBody.summary.sourcesAdded).toBe(1);
      expect(reconcileBody.summary.volumeTargetsAdded).toBe(1);
      expect(reconcileBody.runKey).toMatch(/^[a-f0-9]{64}$/);

      const expectedRoot = path.resolve(await fs.realpath(discoveredRoot));
      const addedSource = reconcileBody.config.sources.find(
        (source) => path.resolve(source.path) === expectedRoot
      );
      expect(addedSource).toBeDefined();
      expect(reconcileBody.items[0]?.configuredSourceId).toBe(addedSource?.id);
      expect(reconcileBody.items[0]?.addedTargetVolumeIds).toEqual([openBody.volumeId]);

      const persistedConfigRaw = await fs.readFile(rootsConfigPath, 'utf8');
      const persistedConfig = JSON.parse(persistedConfigRaw) as ConfigRootsResponseBody['config'];
      expect(persistedConfig.sources.some((source) => path.resolve(source.path) === expectedRoot)).toBe(true);
    } finally {
      process.env.NEARBYTES_SOURCE_SCAN_DIRS = originalScanPaths;
    }
  });

  it('manages provider accounts, shares, and join-link planning', async () => {
    const accountsBefore = await request(app).get('/integrations/accounts').expect(200);
    const accountsBeforeBody = typedBody<ProviderAccountsResponseBody>(accountsBefore);
    expect(accountsBeforeBody.accounts).toEqual([]);
    expect(accountsBeforeBody.providers.some((provider) => provider.provider === 'gdrive')).toBe(true);

    await request(app)
      .post('/integrations/providers/gdrive/config')
      .send({
        clientId: '1234567890-test.apps.googleusercontent.com',
      })
      .expect(200);

    const connectRes = await request(app)
      .post('/integrations/accounts/connect')
      .send({
        provider: 'gdrive',
        label: 'Primary Drive',
        email: 'owner@example.com',
        preferred: true,
      })
      .expect(200);
    const accountId = typedBody<{ account?: { id: string } }>(connectRes).account?.id as string;

    const openRes = await request(app).post('/open').send({ secret: SECRET }).expect(200);
    const openBody = typedBody<OpenResponseBody>(openRes);

    const createShareRes = await request(app)
      .post('/integrations/shares')
      .send({
        provider: 'gdrive',
        accountId,
        label: 'Alpha Mirror',
        volumeId: openBody.volumeId,
        remoteDescriptor: {
          remoteId: 'drive-room-a',
        },
      })
      .expect(200);
    const createShareBody = typedBody<ManagedShareMutationResponseBody>(createShareRes);

    expect(createShareBody.summary.share.provider).toBe('gdrive');
    expect(createShareBody.summary.share.sourceId).toBeTruthy();
    expect(createShareBody.summary.attachments.map((attachment) => attachment.volumeId)).toContain(openBody.volumeId);

    const persistedConfig = JSON.parse(await fs.readFile(rootsConfigPath, 'utf8')) as ConfigRootsResponseBody['config'];
    const managedSource = persistedConfig.sources.find((source) => source.id === createShareBody.summary.share.sourceId);
    expect(managedSource?.integration).toEqual({
      kind: 'provider-managed',
      provider: 'gdrive',
      managedShareId: createShareBody.summary.share.id,
    });

    const parseRes = await request(app)
      .post('/links/join/parse')
      .send({
        link: {
          p: 'nb.join.v1',
          space: {
            mode: 'seed',
            value: SECRET,
          },
          attachments: [
            {
              id: 'att-gdrive',
              label: 'Drive mirror',
              recipe: {
                p: 'nb.transport.recipe.v1',
                id: 'recipe-gdrive',
                label: 'Drive mirror',
                purpose: 'mirror',
                endpoints: [
                  {
                    p: 'nb.transport.endpoint.v1',
                    transport: 'provider-share',
                    provider: 'gdrive',
                    priority: 100,
                    capabilities: ['mirror', 'read', 'write'],
                    descriptor: {
                      remoteId: 'drive-room-a',
                    },
                  },
                  {
                    p: 'nb.transport.endpoint.v1',
                    transport: 'provider-share',
                    provider: 'mega',
                    priority: 120,
                    capabilities: ['mirror', 'read', 'write'],
                    descriptor: {
                      remoteId: 'mega-room-a',
                    },
                  },
                ],
              },
            },
          ],
        },
      })
      .expect(200);
    const parseBody = typedBody<JoinLinkParseResponseBody>(parseRes);
    expect(parseBody.plan.attachments[0]?.selectedEndpoint?.endpoint.provider).toBe('gdrive');

    const openLinkRes = await request(app)
      .post('/links/join/open')
      .send({
        link: {
          p: 'nb.join.v1',
          space: {
            mode: 'seed',
            value: SECRET,
          },
          attachments: [
            {
              id: 'att-gdrive',
              label: 'Drive mirror',
              recipe: {
                p: 'nb.transport.recipe.v1',
                id: 'recipe-gdrive',
                label: 'Drive mirror',
                purpose: 'mirror',
                endpoints: [
                  {
                    p: 'nb.transport.endpoint.v1',
                    transport: 'provider-share',
                    provider: 'gdrive',
                    priority: 100,
                    capabilities: ['mirror', 'read', 'write'],
                    descriptor: {
                      remoteId: 'drive-room-a',
                    },
                  },
                ],
              },
            },
          ],
        },
      })
      .expect(200);
    const openLinkBody = typedBody<JoinLinkOpenResponseBody>(openLinkRes);
    expect(openLinkBody.secret).toBe(SECRET);
    expect(openLinkBody.volumeId).toBe(openBody.volumeId);
    expect(openLinkBody.actions[0]?.status).toBe('attached');
    expect(openLinkBody.actions[0]?.shareId).toBe(createShareBody.summary.share.id);
  });

  it('recreates Nearbytes.html marker after deletion for configured sources', async () => {
    const openRes = await request(app).post('/open').send({ secret: SECRET }).expect(200);
    const token = typedBody<OpenResponseBody>(openRes).token as string;

    await request(app)
      .post('/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('marker-seed'), 'marker-seed.txt')
      .expect(200);

    const markerPath = path.join(mainRoot, 'Nearbytes.html');
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

  it('stores Google provider setup with only a client id', async () => {
    const setupRes = await request(app)
      .post('/integrations/providers/gdrive/config')
      .send({
        clientId: '1234567890-test.apps.googleusercontent.com',
      })
      .expect(200);

    expect((setupRes.body as { setup?: { status?: string } }).setup?.status).toBe('ready');

    const accountsRes = await request(app).get('/integrations/accounts').expect(200);
    const accountsBody = typedBody<ProviderAccountsResponseBody>(accountsRes);
    const gdriveProvider = accountsBody.providers.find((provider) => provider.provider === 'gdrive');

    expect(gdriveProvider?.setup?.status).toBe('ready');
    expect(gdriveProvider?.setup?.config?.clientId).toBe('1234567890-test.apps.googleusercontent.com');
    expect(gdriveProvider?.setup?.config?.hasClientSecret).toBe(false);
  });
});
