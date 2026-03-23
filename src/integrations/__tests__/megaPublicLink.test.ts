import { createCipheriv } from 'crypto';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MegaTransportAdapter } from '../mega.js';
import { createIntegrationRuntime, type ProviderSecretStore } from '../runtime.js';
import type { ManagedShare, ProviderAccount } from '../types.js';

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

const ZERO_IV = Buffer.alloc(16, 0);

function encodeMegaBase64Url(value: Buffer): string {
  return value
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/u, '');
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

describe('Mega public link mirroring', () => {
  const tempDirs: string[] = [];
  const originalFetch = globalThis.fetch;

  afterEach(async () => {
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
    await Promise.all(tempDirs.map((tempDir) => fs.rm(tempDir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it('mirrors a MEGA public folder link without invoking the MEGAcmd CLI', async () => {
    const rootHandle = 'R00T0001';
    const blocksHandle = 'BL0CK001';
    const channelsHandle = 'CHAN0001';
    const blockFileHandle = 'BFILE001';
    const channelFileHandle = 'CFILE001';
    const rootKey = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
    const blocksKey = Buffer.from('102132435465768798a9babbdcddf0f1', 'hex');
    const channelsKey = Buffer.from('11223344556677889900aabbccddeeff', 'hex');
    const blockFileKey = Buffer.from('00112233445566778899aabbccddeeff102132435465768798a9babbdcddf0f1', 'hex');
    const channelFileKey = Buffer.from('ffeeddccbbaa009988776655443322111234567890abcdef0011223344556677', 'hex');
    const blockPlaintext = Buffer.from('encrypted-nearbytes-block', 'utf8');
    const channelPlaintext = Buffer.from('{"event":true}\n', 'utf8');
    const blockCiphertext = encryptFileContent(blockPlaintext, blockFileKey);
    const channelCiphertext = encryptFileContent(channelPlaintext, channelFileKey);
    const publicLink = `https://mega.nz/folder/${rootHandle}#${encodeMegaBase64Url(rootKey)}`;
    const apiNodes = [
      {
        h: rootHandle,
        p: '',
        t: 1,
        a: encryptAttributes('nearbytes', rootKey),
      },
      {
        h: blocksHandle,
        p: rootHandle,
        t: 1,
        a: encryptAttributes('blocks', blocksKey),
        k: encryptNodeKey(blocksKey, rootKey, rootHandle),
      },
      {
        h: channelsHandle,
        p: rootHandle,
        t: 1,
        a: encryptAttributes('channels', channelsKey),
        k: encryptNodeKey(channelsKey, rootKey, rootHandle),
      },
      {
        h: blockFileHandle,
        p: blocksHandle,
        t: 0,
        s: blockPlaintext.length,
        a: encryptAttributes('aa.bin', blockFileKey),
        k: encryptNodeKey(blockFileKey, rootKey, rootHandle),
      },
      {
        h: channelFileHandle,
        p: channelsHandle,
        t: 0,
        s: channelPlaintext.length,
        a: encryptAttributes('bb.json', channelFileKey),
        k: encryptNodeKey(channelFileKey, rootKey, rootHandle),
      },
    ];

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.startsWith('https://g.api.mega.co.nz/cs')) {
        const payload = JSON.parse(String(init?.body ?? '[]'))[0] as { a?: string; n?: string };
        if (payload.a === 'f') {
          return new Response(JSON.stringify([{ f: apiNodes }]), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        if (payload.a === 'g' && payload.n === blockFileHandle) {
          return new Response(JSON.stringify([{ g: `https://download.test/${blockFileHandle}`, s: blockPlaintext.length }]), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        if (payload.a === 'g' && payload.n === channelFileHandle) {
          return new Response(JSON.stringify([{ g: `https://download.test/${channelFileHandle}`, s: channelPlaintext.length }]), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        throw new Error(`Unexpected MEGA API payload: ${JSON.stringify(payload)}`);
      }
      if (url === `https://download.test/${blockFileHandle}`) {
        return new Response(new Uint8Array(blockCiphertext), { status: 200 });
      }
      if (url === `https://download.test/${channelFileHandle}`) {
        return new Response(new Uint8Array(channelCiphertext), { status: 200 });
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    }) as typeof fetch;

    const cliInvocations: string[] = [];
    const runtime = createIntegrationRuntime({
      secretStore: createMemorySecretStore(),
      commandExecutor: {
        async run(invocation) {
          cliInvocations.push(`${invocation.command} ${(invocation.args ?? []).join(' ')}`.trim());
          throw new Error('Unexpected MEGAcmd invocation while mirroring a public link.');
        },
      },
      mega: {
        syncIntervalMs: 60_000,
        remoteBasePath: '/nearbytes',
      },
      logger: {
        log() {},
        warn() {},
      },
    });
    const adapter = new MegaTransportAdapter(runtime);
    const account: ProviderAccount = {
      id: 'acct-mega-public-1',
      provider: 'mega',
      label: 'MEGA',
      email: 'reader@mega.example',
      state: 'connected',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const localPath = await fs.mkdtemp(path.join(os.tmpdir(), 'nearbytes-mega-public-'));
    tempDirs.push(localPath);

    const created = await adapter.createManagedShare(
      {
        provider: 'mega',
        accountId: account.id,
        label: 'Readonly Link',
        localPath,
        role: 'link',
        remoteDescriptor: {
          publicLink,
        },
      },
      account
    );

    expect(created.capabilities).toEqual(['mirror', 'read']);
    expect(created.remoteDescriptor).toMatchObject({
      publicLink,
    });

    const share: ManagedShare = {
      id: 'share-mega-public-1',
      provider: 'mega',
      accountId: account.id,
      label: 'Readonly Link',
      role: 'link',
      localPath,
      sourceId: 'src-mega-public-1',
      syncMode: 'mirror',
      remoteDescriptor: created.remoteDescriptor ?? { publicLink },
      capabilities: created.capabilities ?? ['mirror', 'read'],
      invitationEmails: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await adapter.ensureSync(share, account);

    await expect(fs.readFile(path.join(localPath, 'blocks', 'aa.bin'), 'utf8')).resolves.toBe(blockPlaintext.toString('utf8'));
    await expect(fs.readFile(path.join(localPath, 'channels', 'bb.json'), 'utf8')).resolves.toBe(channelPlaintext.toString('utf8'));
    expect(cliInvocations).toEqual([]);

    const state = await adapter.getState(share, null);
    expect(state.status).toBe('ready');
    expect(state.detail).toContain('local read-only copy');

    await adapter.detachManagedShare(share, account);
  });

});