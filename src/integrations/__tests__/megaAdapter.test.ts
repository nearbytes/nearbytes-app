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

describe('MegaTransportAdapter', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(tempDirs.map((tempDir) => fs.rm(tempDir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it('connects natively, lists incoming shares, and mirrors them without invoking a command executor', async () => {
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
    const updatedPlaintext = Buffer.from('native-mega-share-data-v2', 'utf8');
    const fileCiphertext = encryptFileContent(filePlaintext, fileNodeKey);
    const updatedCiphertext = encryptFileContent(updatedPlaintext, fileNodeKey);
    const commandInvocations: string[] = [];
    let partialFetchCount = 0;
    let downloadVersion = 0;

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

    const updatedPartialSnapshot = {
      f: [
        fullSnapshot.f[0],
        fullSnapshot.f[1],
        {
          ...fullSnapshot.f[2],
          s: updatedPlaintext.length,
        },
      ],
      u: fullSnapshot.u,
      sn: 'cursor-3',
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
            if (payload.n) {
              partialFetchCount += 1;
            }
            return new Response(
              JSON.stringify([payload.n ? (partialFetchCount >= 2 ? updatedPartialSnapshot : partialSnapshot) : fullSnapshot]),
              {
                status: 200,
                headers: { 'content-type': 'application/json' },
              }
            );
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
        const currentCursor = new URL(url).searchParams.get('sn');
        if (currentCursor === 'cursor-1') {
          return new Response(JSON.stringify({ a: [{ a: 'u', n: 'outside0001' }], sn: 'cursor-2' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        if (currentCursor === 'cursor-2') {
          return new Response(JSON.stringify({ a: [{ a: 'u', n: fileHandle }], sn: 'cursor-3' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        throw new Error(`Unexpected SC cursor: ${currentCursor}`);
      }
      if (url === `https://download.test/${fileHandle}`) {
        const body = downloadVersion === 0 ? fileCiphertext : updatedCiphertext;
        downloadVersion += 1;
        return new Response(new Uint8Array(body), { status: 200 });
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    }) as typeof fetch;

    const runtime = createIntegrationRuntime({
      secretStore: createMemorySecretStore(),
      commandExecutor: {
        async run(invocation) {
          commandInvocations.push(`${invocation.command} ${(invocation.args ?? []).join(' ')}`.trim());
          throw new Error('The native MEGA adapter must not invoke external commands.');
        },
      },
      mega: {
        remoteBasePath: '/nearbytes',
        syncIntervalMs: 60000,
      },
      logger: {
        log() {},
        warn() {},
      },
    });

    const adapter = new MegaTransportAdapter(runtime, { fetchImpl });
    const connected = await adapter.connect({
      provider: 'mega',
      label: 'MEGA',
      credentials: { email, password },
    });

    expect(connected.status).toBe('connected');
    const account = connected.account as ProviderAccount;
    expect(account.email).toBe(email);

    const offers = await adapter.listIncomingShares(account);
    expect(offers).toHaveLength(1);
    expect(offers[0]?.remoteDescriptor).toMatchObject({
      ownerEmail: 'owner@example.com',
      shareName: 'Team Space',
      rootHandle: shareHandle,
    });

    const accepted = await adapter.acceptInvite(
      {
        provider: 'mega',
        accountId: account.id,
        label: 'Team Space',
        remoteDescriptor: offers[0]?.remoteDescriptor,
      },
      account
    );
    expect(accepted.capabilities).toEqual(['mirror', 'read', 'accept']);

    const localPath = await fs.mkdtemp(path.join(os.tmpdir(), 'nearbytes-mega-native-'));
    tempDirs.push(localPath);
    const share: ManagedShare = {
      id: 'share-mega-recipient-1',
      provider: 'mega',
      accountId: account.id,
      label: 'Team Space',
      role: 'recipient',
      localPath,
      sourceId: 'src-mega-recipient-1',
      syncMode: 'mirror',
      remoteDescriptor: accepted.remoteDescriptor ?? offers[0]!.remoteDescriptor,
      capabilities: accepted.capabilities ?? ['mirror', 'read', 'accept'],
      invitationEmails: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await adapter.ensureSync(share, account);

    await expect(fs.readFile(path.join(localPath, 'blocks', 'aa.bin'), 'utf8')).resolves.toBe(filePlaintext.toString('utf8'));
    expect(partialFetchCount).toBe(1);

    await adapter.ensureSync(share, account);
    await expect(fs.readFile(path.join(localPath, 'blocks', 'aa.bin'), 'utf8')).resolves.toBe(filePlaintext.toString('utf8'));
    expect(partialFetchCount).toBe(1);

    await adapter.ensureSync(share, account);
    await expect(fs.readFile(path.join(localPath, 'blocks', 'aa.bin'), 'utf8')).resolves.toBe(updatedPlaintext.toString('utf8'));
    expect(partialFetchCount).toBe(2);

    expect(commandInvocations).toEqual([]);

    const state = await adapter.getState(share, account);
    expect(state.status).toBe('ready');
    expect(state.detail).toContain('up to date');

    await adapter.detachManagedShare(share, account);
    await adapter.dispose();
  });
});
