import { createCipheriv, randomBytes } from 'crypto';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCryptoOperations } from '../../crypto/index.js';
import { createChatService } from '../../domain/chatService.js';
import { createFileService } from '../../domain/fileService.js';
import { createSecret } from '../../types/keys.js';
import { bytesToHex } from '../../utils/encoding.js';
import type { RootsConfig } from '../../config/roots.js';
import { MegaTransportAdapter } from '../../integrations/mega.js';
import { ManagedShareService } from '../../integrations/managedShares.js';
import { createIntegrationRuntime, type ProviderSecretStore } from '../../integrations/runtime.js';
import { MultiRootStorageBackend } from '../../storage/multiRoot.js';
import { createApp } from '../app.js';

const SECRET = 'nearbytes-mega-api-secret';
const ZERO_IV = Buffer.alloc(16, 0);

interface ProviderAccountsResponseBody {
  accounts: Array<{
    id: string;
    provider: string;
  }>;
  providers: Array<{
    provider: string;
  }>;
}

interface OpenResponseBody {
  volumeId: string;
}

interface ManagedShareMutationResponseBody {
  summary: {
    share: {
      id: string;
      provider: string;
      localPath: string;
      sourceId?: string;
    };
    state: {
      status: string;
    };
  };
}

interface ManagedSharesResponseBody {
  shares: Array<{
    share: {
      id: string;
      provider: string;
      role: string;
      localPath: string;
      remoteDescriptor: Record<string, unknown>;
    };
    state: {
      status: string;
      detail: string;
      badges: string[];
    };
  }>;
}

function typedBody<T>(value: { body: unknown }): T {
  return value.body as T;
}

async function waitForManagedShareState(
  app: ReturnType<typeof createApp>,
  shareId: string,
  status: string,
  attempts = 10
): Promise<ManagedShareMutationResponseBody> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await request(app)
      .get(`/integrations/shares/${encodeURIComponent(shareId)}/state`)
      .expect(200);
    const body = typedBody<ManagedShareMutationResponseBody>(response);
    if (body.summary.state.status === status) {
      return body;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for managed share ${shareId} to reach state ${status}.`);
}

function createMemorySecretStore(): ProviderSecretStore {
  const entries = new Map<string, unknown>();
  return {
    async get<T>(key: string): Promise<T | null> {
      return (entries.get(key) as T | undefined) ?? null;
    },
    async set<T>(key: string, value: T): Promise<void> {
      entries.set(key, value);
    },
    async delete(key: string): Promise<void> {
      entries.delete(key);
    },
  };
}

function encodeMegaBase64Url(value: Buffer): string {
  return value.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

function xorBuffers(left: Buffer, right: Buffer): Buffer {
  const result = Buffer.alloc(Math.min(left.length, right.length));
  for (let index = 0; index < result.length; index += 1) {
    result[index] = left[index]! ^ right[index]!;
  }
  return result;
}

function deriveAttributeKey(nodeKey: Buffer): Buffer {
  if (nodeKey.length >= 32) {
    return xorBuffers(nodeKey.subarray(0, 16), nodeKey.subarray(16, 32));
  }
  return nodeKey.subarray(0, 16);
}

function encryptAesEcb(value: Buffer, key: Buffer): Buffer {
  const cipher = createCipheriv('aes-128-ecb', key.subarray(0, 16), null);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(value), cipher.final()]);
}

function encryptAesCbc(value: Buffer, key: Buffer): Buffer {
  const cipher = createCipheriv('aes-128-cbc', key.subarray(0, 16), ZERO_IV);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(value), cipher.final()]);
}

function encryptAttributes(name: string, nodeKey: Buffer): string {
  const raw = Buffer.from(`MEGA${JSON.stringify({ n: name })}`, 'utf8');
  const paddedLength = Math.ceil(raw.length / 16) * 16;
  const padded = Buffer.concat([raw, Buffer.alloc(paddedLength - raw.length, 0)]);
  return encodeMegaBase64Url(encryptAesCbc(padded, deriveAttributeKey(nodeKey)));
}

function encryptNodeKey(nodeKey: Buffer, shareKey: Buffer, shareHandle: string): string {
  return `${shareHandle}:${encodeMegaBase64Url(encryptAesEcb(nodeKey, shareKey))}`;
}

function encryptFileContent(value: Buffer, nodeKey: Buffer): Buffer {
  const key = deriveAttributeKey(nodeKey);
  const iv = Buffer.alloc(16, 0);
  nodeKey.copy(iv, 0, 16, 24);
  const cipher = createCipheriv('aes-128-ctr', key, iv);
  return Buffer.concat([cipher.update(value), cipher.final()]);
}

async function deriveV2MasterKey(password: string, salt: string): Promise<Buffer> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const derived = Buffer.from(
    await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        hash: 'SHA-512',
        salt: Buffer.from(salt, 'base64url'),
        iterations: 100000,
      },
      key,
      256
    )
  );
  return derived.subarray(0, 16);
}

describe('MEGA managed share API', () => {
  const tempDirs: string[] = [];
  const previousHome = process.env.HOME;
  const services: ManagedShareService[] = [];

  afterEach(async () => {
    await Promise.all(services.splice(0).map((service) => service.dispose()));
    process.env.HOME = previousHome;
    vi.restoreAllMocks();
    await Promise.all(tempDirs.map((tempDir) => fs.rm(tempDir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it('connects, lists an incoming share, accepts it through the local API, and materializes the managed root', async () => {
    const email = 'reader@example.com';
    const password = 'correct horse battery staple';
    const salt = encodeMegaBase64Url(Buffer.from('0123456789abcdeffedcba9876543210', 'hex'));
    const passwordKey = await deriveV2MasterKey(password, salt);
    const masterKey = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
    const encryptedMasterKey = encryptAesEcb(masterKey, passwordKey);
    const tsidLeft = Buffer.from('11223344556677889900aabbccddeeff', 'hex');
    const tsid = encodeMegaBase64Url(Buffer.concat([tsidLeft, encryptAesEcb(tsidLeft, masterKey)]));
    const userHandle = 'usrhandle01';
    const ownerHandle = 'owner000001';
    const cloudRootHandle = 'root000001';
    const nearbytesHandle = 'nearbytes0';
    const ownerBlocksHandle = 'ownblocks01';
    const ownerChannelsHandle = 'ownchans001';
    const shareHandle = 'share00001';
    const blocksHandle = 'blocks0001';
    const fileHandle = 'file000001';
    const shareKey = Buffer.from('0f1e2d3c4b5a69788796a5b4c3d2e1f0', 'hex');
    const rootNodeKey = Buffer.from('102132435465768798a9babbdcddf0f1', 'hex');
    const cloudRootNodeKey = Buffer.from('66778899aabbccddeeff001122334455', 'hex');
    const nearbytesNodeKey = Buffer.from('5566778899aabbccddeeff0011223344', 'hex');
    const ownerBlocksNodeKey = Buffer.from('445566778899aabbccddeeff00112233', 'hex');
    const ownerChannelsNodeKey = Buffer.from('33445566778899aabbccddeeff001122', 'hex');
    const blocksNodeKey = Buffer.from('11223344556677889900aabbccddeeff', 'hex');
    const fileNodeKey = Buffer.from('00112233445566778899aabbccddeeff102132435465768798a9babbdcddf0f1', 'hex');
    const filePlaintext = Buffer.from('native-mega-share-data', 'utf8');
    const fileCiphertext = encryptFileContent(filePlaintext, fileNodeKey);

    const fullSnapshot = {
      f: [
        {
          h: cloudRootHandle,
          t: 1,
          a: encryptAttributes('Cloud Drive', cloudRootNodeKey),
          k: encodeMegaBase64Url(encryptAesEcb(cloudRootNodeKey, masterKey)),
        },
        {
          h: nearbytesHandle,
          p: cloudRootHandle,
          t: 1,
          a: encryptAttributes('nearbytes', nearbytesNodeKey),
          k: encodeMegaBase64Url(encryptAesEcb(nearbytesNodeKey, masterKey)),
        },
        {
          h: ownerBlocksHandle,
          p: nearbytesHandle,
          t: 1,
          a: encryptAttributes('blocks', ownerBlocksNodeKey),
          k: encodeMegaBase64Url(encryptAesEcb(ownerBlocksNodeKey, masterKey)),
        },
        {
          h: ownerChannelsHandle,
          p: nearbytesHandle,
          t: 1,
          a: encryptAttributes('channels', ownerChannelsNodeKey),
          k: encodeMegaBase64Url(encryptAesEcb(ownerChannelsNodeKey, masterKey)),
        },
        {
          h: shareHandle,
          t: 1,
          a: encryptAttributes('Team Space', rootNodeKey),
          k: encryptNodeKey(rootNodeKey, shareKey, shareHandle),
          su: ownerHandle,
          sk: encodeMegaBase64Url(encryptAesEcb(shareKey, masterKey)),
          r: 0,
        },
        {
          h: blocksHandle,
          p: shareHandle,
          t: 1,
          a: encryptAttributes('blocks', blocksNodeKey),
          k: encryptNodeKey(blocksNodeKey, shareKey, shareHandle),
        },
        {
          h: fileHandle,
          p: blocksHandle,
          t: 0,
          s: filePlaintext.length,
          a: encryptAttributes('aa.bin', fileNodeKey),
          k: encryptNodeKey(fileNodeKey, shareKey, shareHandle),
        },
      ],
      u: [{ u: ownerHandle, m: 'owner@example.com' }],
    };

    const partialSnapshot = {
      f: fullSnapshot.f,
      u: fullSnapshot.u,
      sn: 'cursor-1',
    };

    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.startsWith('https://g.api.mega.co.nz/cs')) {
        const payload = JSON.parse(String(init?.body ?? '[]'))[0] as Record<string, unknown>;
        switch (payload.a) {
          case 'us0':
            return new Response(JSON.stringify([{ v: 2, s: salt }]), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            });
          case 'us':
            return new Response(
              JSON.stringify([{ k: encodeMegaBase64Url(encryptedMasterKey), u: userHandle, tsid }]),
              { status: 200, headers: { 'content-type': 'application/json' } }
            );
          case 'ug':
            return new Response(JSON.stringify([{ u: userHandle, email }]), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            });
          case 'f':
            return new Response(JSON.stringify([payload.n ? partialSnapshot : fullSnapshot]), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            });
          case 'g':
            return new Response(JSON.stringify([{ g: `https://download.test/${String(payload.n)}`, s: filePlaintext.length }]), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            });
          default:
            throw new Error(`Unexpected MEGA API payload: ${JSON.stringify(payload)}`);
        }
      }
      if (url.startsWith('https://g.api.mega.co.nz/sc')) {
        return new Response(JSON.stringify({ a: [], sn: 'cursor-2' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === `https://download.test/${fileHandle}`) {
        return new Response(new Uint8Array(fileCiphertext), { status: 200 });
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    }) as typeof fetch;

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nearbytes-mega-api-'));
    tempDirs.push(tempDir);
    process.env.HOME = tempDir;

    const mainRoot = path.join(tempDir, 'main-root');
    const rootsConfigPath = path.join(tempDir, 'roots.json');
    await fs.mkdir(mainRoot, { recursive: true });

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
      ],
    };
    await fs.writeFile(rootsConfigPath, `${JSON.stringify(rootsConfig, null, 2)}\n`, 'utf8');

    const storage = new MultiRootStorageBackend(rootsConfig);
    const fileService = createFileService({ crypto, storage });
    const chatService = createChatService({ crypto, storage });
    const runtime = createIntegrationRuntime({
      secretStore: createMemorySecretStore(),
      mega: {
        remoteBasePath: '/nearbytes',
        syncIntervalMs: 60_000,
      },
      logger: {
        log() {},
        warn() {},
      },
    });
    const managedShareService = new ManagedShareService({
      storage,
      rootsConfigPath,
      adapters: [new MegaTransportAdapter(runtime, { fetchImpl })],
    });
    services.push(managedShareService);
    const app = createApp({
      fileService,
      chatService,
      crypto,
      storage,
      tokenKey: randomBytes(32),
      corsOrigin: true,
      maxUploadBytes: 5 * 1024 * 1024,
      rootsConfigPath,
      resolvedStorageDir: mainRoot,
      managedShareService,
    });

    const accountsBefore = await request(app).get('/integrations/accounts').expect(200);
    expect(typedBody<ProviderAccountsResponseBody>(accountsBefore).providers.some((provider) => provider.provider === 'mega')).toBe(true);

    const connectRes = await request(app)
      .post('/integrations/accounts/connect')
      .send({
        provider: 'mega',
        label: 'MEGA',
        credentials: { email, password },
      })
      .expect(200);
    const accountId = typedBody<{ account: { id: string } }>(connectRes).account.id;

    const openRes = await request(app).post('/open').send({ secret: SECRET }).expect(200);
    const openBody = typedBody<OpenResponseBody>(openRes);

    const acceptRes = await request(app)
      .post('/integrations/shares/accept')
      .send({
        provider: 'mega',
        accountId,
        label: 'Team Space',
        volumeId: openBody.volumeId,
        remoteDescriptor: {
          rootHandle: shareHandle,
          shareHandle,
          shareName: 'Team Space',
          ownerEmail: 'owner@example.com',
          accessLevel: 'read',
        },
      })
      .expect(200);
    const acceptBody = typedBody<ManagedShareMutationResponseBody>(acceptRes);

    expect(acceptBody.summary.share.provider).toBe('mega');
    expect(acceptBody.summary.share.sourceId).toBeTruthy();
    await expect(fs.readFile(path.join(acceptBody.summary.share.localPath, 'blocks', 'aa.bin'), 'utf8')).resolves.toBe(
      filePlaintext.toString('utf8')
    );

    const stateBody = await waitForManagedShareState(app, acceptBody.summary.share.id, 'ready');
    expect(stateBody.summary.state.status).toBe('ready');
  });

  it('creates the default writable MEGA owner share and reports it ready through the local API', async () => {
    const email = 'owner@example.com';
    const password = 'correct horse battery staple';
    const salt = encodeMegaBase64Url(Buffer.from('0123456789abcdeffedcba9876543210', 'hex'));
    const passwordKey = await deriveV2MasterKey(password, salt);
    const masterKey = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
    const encryptedMasterKey = encryptAesEcb(masterKey, passwordKey);
    const tsidLeft = Buffer.from('11223344556677889900aabbccddeeff', 'hex');
    const tsid = encodeMegaBase64Url(Buffer.concat([tsidLeft, encryptAesEcb(tsidLeft, masterKey)]));
    const userHandle = 'usrhandle01';

    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (!url.startsWith('https://g.api.mega.co.nz/cs')) {
        throw new Error(`Unexpected fetch URL: ${url}`);
      }
      const payload = JSON.parse(String(init?.body ?? '[]'))[0] as Record<string, unknown>;
      switch (payload.a) {
        case 'us0':
          return new Response(JSON.stringify([{ v: 2, s: salt }]), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        case 'us':
          return new Response(
            JSON.stringify([{ k: encodeMegaBase64Url(encryptedMasterKey), u: userHandle, tsid }]),
            { status: 200, headers: { 'content-type': 'application/json' } }
          );
        case 'ug':
          return new Response(JSON.stringify([{ u: userHandle, email }]), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        case 'f':
          return new Response(
            JSON.stringify([
              {
                f: [
                  {
                    h: 'root000001',
                    t: 1,
                    a: encryptAttributes('Cloud Drive', Buffer.from('102132435465768798a9babbdcddf0f1', 'hex')),
                    k: encodeMegaBase64Url(
                      encryptAesEcb(Buffer.from('102132435465768798a9babbdcddf0f1', 'hex'), masterKey)
                    ),
                  },
                  {
                    h: 'nearbytes0',
                    p: 'root000001',
                    t: 1,
                    a: encryptAttributes('nearbytes', Buffer.from('00112233445566778899aabbccddeeff', 'hex')),
                    k: encodeMegaBase64Url(
                      encryptAesEcb(Buffer.from('00112233445566778899aabbccddeeff', 'hex'), masterKey)
                    ),
                  },
                  {
                    h: 'blocks0001',
                    p: 'nearbytes0',
                    t: 1,
                    a: encryptAttributes('blocks', Buffer.from('11223344556677889900aabbccddeeff', 'hex')),
                    k: encodeMegaBase64Url(
                      encryptAesEcb(Buffer.from('11223344556677889900aabbccddeeff', 'hex'), masterKey)
                    ),
                  },
                  {
                    h: 'chans00001',
                    p: 'nearbytes0',
                    t: 1,
                    a: encryptAttributes('channels', Buffer.from('2233445566778899aabbccddeeff0011', 'hex')),
                    k: encodeMegaBase64Url(
                      encryptAesEcb(Buffer.from('2233445566778899aabbccddeeff0011', 'hex'), masterKey)
                    ),
                  },
                ],
                u: [],
                sn: 'cursor-1',
              },
            ]),
            {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }
          );
        default:
          throw new Error(`Unexpected MEGA API payload: ${JSON.stringify(payload)}`);
      }
    }) as typeof fetch;

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nearbytes-mega-owner-api-'));
    tempDirs.push(tempDir);
    process.env.HOME = tempDir;

    const mainRoot = path.join(tempDir, 'main-root');
    const rootsConfigPath = path.join(tempDir, 'roots.json');
    await fs.mkdir(mainRoot, { recursive: true });

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
    const runtime = createIntegrationRuntime({
      secretStore: createMemorySecretStore(),
      mega: {
        remoteBasePath: '/nearbytes',
        syncIntervalMs: 60_000,
      },
      logger: {
        log() {},
        warn() {},
      },
    });
    const managedShareService = new ManagedShareService({
      storage,
      rootsConfigPath,
      adapters: [new MegaTransportAdapter(runtime, { fetchImpl })],
    });
    services.push(managedShareService);
    const app = createApp({
      fileService,
      chatService,
      crypto,
      storage,
      tokenKey: randomBytes(32),
      corsOrigin: true,
      maxUploadBytes: 5 * 1024 * 1024,
      rootsConfigPath,
      resolvedStorageDir: mainRoot,
      managedShareService,
    });

    const connectRes = await request(app)
      .post('/integrations/accounts/connect')
      .send({
        provider: 'mega',
        label: 'MEGA',
        accountId: 'acct-mega-1',
        credentials: { email, password },
      })
      .expect(200);
    expect(typedBody<{ account: { id: string } }>(connectRes).account.id).toContain('acct-mega-1');

    const sharesRes = await request(app).get('/integrations/shares').expect(200);
    const sharesBody = typedBody<ManagedSharesResponseBody>(sharesRes);
    const ownerShare = sharesBody.shares.find((entry) => entry.share.provider === 'mega' && entry.share.role === 'owner');
    expect(ownerShare).toBeDefined();
    await expect(fs.stat(path.join(ownerShare!.share.localPath, 'blocks'))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(ownerShare!.share.localPath, 'channels'))).resolves.toBeTruthy();
    const nextRootsConfig = JSON.parse(await fs.readFile(rootsConfigPath, 'utf8')) as RootsConfig;
    const megaSource = nextRootsConfig.sources.find(
      (source) =>
        source.integration?.kind === 'provider-managed' &&
        source.integration.provider === 'mega' &&
        source.integration.managedShareId === ownerShare!.share.id
    );
    expect(megaSource).toBeTruthy();
    expect(
      nextRootsConfig.defaultVolume.destinations.some((destination) => destination.sourceId === megaSource?.id)
    ).toBe(true);

    let ownerStateStatus = ownerShare!.state.status;
    for (let attempt = 0; attempt < 20 && ownerStateStatus !== 'ready'; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      const nextSharesRes = await request(app).get('/integrations/shares').expect(200);
      const nextOwnerShare = typedBody<ManagedSharesResponseBody>(nextSharesRes).shares.find(
        (entry) => entry.share.id === ownerShare!.share.id
      );
      ownerStateStatus = nextOwnerShare?.state.status ?? ownerStateStatus;
    }
    expect(ownerStateStatus).toBe('ready');
    expect(fetchImpl).toHaveBeenCalled();
  });
});
