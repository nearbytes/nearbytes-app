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

interface IncomingSharesResponseBody {
  shares: Array<{
    provider: string;
    accountId: string;
    label: string;
    remoteDescriptor: Record<string, unknown>;
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

function typedBody<T>(value: { body: unknown }): T {
  return value.body as T;
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
    const shareHandle = 'share00001';
    const blocksHandle = 'blocks0001';
    const fileHandle = 'file000001';
    const shareKey = Buffer.from('0f1e2d3c4b5a69788796a5b4c3d2e1f0', 'hex');
    const rootNodeKey = Buffer.from('102132435465768798a9babbdcddf0f1', 'hex');
    const blocksNodeKey = Buffer.from('11223344556677889900aabbccddeeff', 'hex');
    const fileNodeKey = Buffer.from('00112233445566778899aabbccddeeff102132435465768798a9babbdcddf0f1', 'hex');
    const filePlaintext = Buffer.from('native-mega-share-data', 'utf8');
    const fileCiphertext = encryptFileContent(filePlaintext, fileNodeKey);

    const fullSnapshot = {
      f: [
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

    const incomingRes = await request(app).get('/integrations/shares/incoming').expect(200);
    const offer = typedBody<IncomingSharesResponseBody>(incomingRes).shares.find((entry) => entry.provider === 'mega');
    expect(offer).toBeDefined();
    expect(offer?.accountId).toBe(accountId);

    const openRes = await request(app).post('/open').send({ secret: SECRET }).expect(200);
    const openBody = typedBody<OpenResponseBody>(openRes);

    const acceptRes = await request(app)
      .post('/integrations/shares/accept')
      .send({
        provider: 'mega',
        accountId,
        label: offer?.label,
        volumeId: openBody.volumeId,
        remoteDescriptor: offer?.remoteDescriptor,
      })
      .expect(200);
    const acceptBody = typedBody<ManagedShareMutationResponseBody>(acceptRes);

    expect(acceptBody.summary.share.provider).toBe('mega');
    expect(acceptBody.summary.share.sourceId).toBeTruthy();
    expect(acceptBody.summary.state.status).toBe('ready');
    await expect(fs.readFile(path.join(acceptBody.summary.share.localPath, 'blocks', 'aa.bin'), 'utf8')).resolves.toBe(
      filePlaintext.toString('utf8')
    );

    const stateRes = await request(app)
      .get(`/integrations/shares/${encodeURIComponent(acceptBody.summary.share.id)}/state`)
      .expect(200);
    expect(typedBody<ManagedShareMutationResponseBody>(stateRes).summary.state.status).toBe('ready');
  });
});