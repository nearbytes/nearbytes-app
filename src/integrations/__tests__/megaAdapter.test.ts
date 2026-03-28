import { createCipheriv, createDecipheriv, generateKeyPairSync, randomBytes } from 'crypto';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCryptoOperations } from '../../crypto/index.js';
import { volumeIdFromPublicKey } from '../../domain/fileCrypto.js';
import { serializeEvent, serializeEventPayload } from '../../storage/serialization.js';
import { createEncryptedData, EMPTY_HASH, EventType } from '../../types/events.js';
import { createSecret } from '../../types/keys.js';
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

function decodeMegaBase64Url(value: string): Buffer {
  const normalized = value.trim().replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(`${normalized}${'='.repeat((4 - (normalized.length % 4)) % 4)}`, 'base64');
}

function bufferToBigInt(value: Buffer): bigint {
  const hex = value.toString('hex');
  return hex ? BigInt(`0x${hex}`) : 0n;
}

function bigIntToBuffer(value: bigint): Buffer {
  let hex = value.toString(16);
  if (hex.length % 2 !== 0) {
    hex = `0${hex}`;
  }
  return Buffer.from(hex, 'hex');
}

function encodeMpi(payload: Buffer): Buffer {
  const first = payload[0] ?? 0;
  const bitLength = payload.length === 0 ? 0 : (payload.length - 1) * 8 + (8 - Math.clz32(first) + 24);
  const header = Buffer.alloc(2);
  header.writeUInt16BE(bitLength, 0);
  return Buffer.concat([header, payload]);
}

function encodeMegaPrivateKeyComponent(value: Buffer): Buffer {
  return encodeMpi(value);
}

function encryptRsaRaw(cleartext: Buffer, modulus: bigint, publicExponent: bigint): Buffer {
  const ciphertext = modPow(bufferToBigInt(cleartext), publicExponent, modulus);
  return bigIntToBuffer(ciphertext);
}

function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  if (modulus === 1n) {
    return 0n;
  }
  let result = 1n;
  let currentBase = base % modulus;
  let currentExponent = exponent;
  while (currentExponent > 0n) {
    if ((currentExponent & 1n) === 1n) {
      result = (result * currentBase) % modulus;
    }
    currentExponent >>= 1n;
    currentBase = (currentBase * currentBase) % modulus;
  }
  return result;
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

function decryptAesEcb(value: Buffer, key: Buffer): Buffer {
  const decipher = createDecipheriv('aes-128-ecb', key.subarray(0, 16), null);
  decipher.setAutoPadding(false);
  return Buffer.concat([decipher.update(value), decipher.final()]);
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
    const shareHandle = 'hNtERb6T';
    const blocksHandle = 'blocks0001';
    const channelsHandle = 'chnls00001';
    const roomHandle = 'room000001';
    const fileHandle = 'file000001';
    const eventHandle = 'event00001';
    const unsupportedHandle = 'testfile01';
    const shareKey = Buffer.from('0f1e2d3c4b5a69788796a5b4c3d2e1f0', 'hex');
    const rootNodeKey = Buffer.from('102132435465768798a9babbdcddf0f1', 'hex');
    const blocksNodeKey = Buffer.from('11223344556677889900aabbccddeeff', 'hex');
    const channelsNodeKey = Buffer.from('2233445566778899aabbccddeeff0011', 'hex');
    const roomNodeKey = Buffer.from('33445566778899aabbccddeeff001122', 'hex');
    const fileNodeKey = Buffer.from('00112233445566778899aabbccddeeff102132435465768798a9babbdcddf0f1', 'hex');
    const eventNodeKey = Buffer.from('445566778899aabbccddeeff00112233102132435465768798a9babbdcddf0f1', 'hex');
    const unsupportedNodeKey = Buffer.from('5566778899aabbccddeeff0011223344102132435465768798a9babbdcddf0f1', 'hex');
    const filePlaintext = Buffer.from('native-mega-share-data', 'utf8');
    const updatedPlaintext = Buffer.from('native-mega-share-data-v2', 'utf8');
    const cryptoOps = createCryptoOperations();
    const blockHash1 = await cryptoOps.computeHash(filePlaintext);
    const blockHash2 = await cryptoOps.computeHash(updatedPlaintext);
    const blockName1 = `${blockHash1}.bin`;
    const blockName2 = `${blockHash2}.bin`;
    const channelKeyPair = await cryptoOps.deriveKeys(createSecret('mega-native-channel'));
    const volumeId = volumeIdFromPublicKey(channelKeyPair.publicKey);
    const eventPayload = {
      type: EventType.DELETE_FILE,
      fileName: 'native-probe.txt',
      hash: EMPTY_HASH,
      encryptedKey: createEncryptedData(new Uint8Array(0)),
    };
    const eventPayloadBytes = serializeEventPayload(eventPayload);
    const eventHash = await cryptoOps.computeHash(eventPayloadBytes);
    const eventSignature = await cryptoOps.signPR(eventPayloadBytes, channelKeyPair.privateKey);
    const eventBytes = Buffer.from(
      JSON.stringify(serializeEvent({ payload: eventPayload, signature: eventSignature })),
      'utf8'
    );
    const eventFileName = `${eventHash}.bin`;
    const channelEventRelPath = `channels/${volumeId}/${eventFileName}`;
    const fileCiphertext = encryptFileContent(filePlaintext, fileNodeKey);
    const updatedCiphertext = encryptFileContent(updatedPlaintext, fileNodeKey);
    const eventCiphertext = encryptFileContent(eventBytes, eventNodeKey);
    const commandInvocations: string[] = [];
    let partialFetchCount = 0;
    let blockDownloadVersion = 0;
    /** After SC advances past cursor-2, partial `f` uses the updated tree only when `megaReadonlyEnsureSyncPhase >= 3` (test-controlled; avoids listener racing phases 1–2). */
    let remoteTreeIncludesUpdatedBlock = false;
    let megaReadonlyEnsureSyncPhase = 0;

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
          h: channelsHandle,
          p: shareHandle,
          t: 1,
          a: encryptAttributes('channels', channelsNodeKey),
          k: encryptNodeKey(channelsNodeKey, shareKey, shareHandle),
        },
        {
          h: roomHandle,
          p: channelsHandle,
          t: 1,
          a: encryptAttributes(volumeId, roomNodeKey),
          k: encryptNodeKey(roomNodeKey, shareKey, shareHandle),
        },
        {
          h: fileHandle,
          p: blocksHandle,
          t: 0,
          s: filePlaintext.length,
          a: encryptAttributes(blockName1, fileNodeKey),
          k: encryptNodeKey(fileNodeKey, shareKey, shareHandle),
        },
        {
          h: eventHandle,
          p: roomHandle,
          t: 0,
          s: eventBytes.length,
          a: encryptAttributes(eventFileName, eventNodeKey),
          k: encryptNodeKey(eventNodeKey, shareKey, shareHandle),
        },
        {
          h: unsupportedHandle,
          p: shareHandle,
          t: 0,
          s: 8,
          a: encryptAttributes('test.txt', unsupportedNodeKey),
          k: encryptNodeKey(unsupportedNodeKey, shareKey, shareHandle),
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
        fullSnapshot.f[2],
        fullSnapshot.f[3],
        {
          ...fullSnapshot.f[4],
          s: updatedPlaintext.length,
          a: encryptAttributes(blockName2, fileNodeKey),
        },
        fullSnapshot.f[5],
        fullSnapshot.f[6],
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
              JSON.stringify([
                payload.n
                  ? remoteTreeIncludesUpdatedBlock && megaReadonlyEnsureSyncPhase >= 3
                    ? updatedPartialSnapshot
                    : partialSnapshot
                  : fullSnapshot,
              ]),
              {
                status: 200,
                headers: { 'content-type': 'application/json' },
              }
            );
          case 'g':
            if (payload.n === fileHandle) {
              return new Response(JSON.stringify([{ g: `https://download.test/${String(payload.n)}`, s: filePlaintext.length }]), {
                status: 200,
                headers: { 'content-type': 'application/json' },
              });
            }
            if (payload.n === eventHandle) {
              return new Response(JSON.stringify([{ g: `https://download.test/${String(payload.n)}`, s: eventBytes.length }]), {
                status: 200,
                headers: { 'content-type': 'application/json' },
              });
            }
            throw new Error(`Unexpected MEGA file handle: ${String(payload.n)}`);
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
          if (megaReadonlyEnsureSyncPhase >= 3) {
            remoteTreeIncludesUpdatedBlock = true;
            return new Response(JSON.stringify({ a: [{ a: 'u', n: fileHandle }], sn: 'cursor-3' }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            });
          }
          return new Response(JSON.stringify({ a: [], sn: 'cursor-2' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        if (currentCursor === 'cursor-3') {
          return new Response(JSON.stringify({ a: [], sn: 'cursor-3' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        throw new Error(`Unexpected SC cursor: ${currentCursor}`);
      }
      if (url === `https://download.test/${fileHandle}`) {
        const body = blockDownloadVersion === 0 ? fileCiphertext : updatedCiphertext;
        blockDownloadVersion += 1;
        return new Response(new Uint8Array(body), { status: 200 });
      }
      if (url === `https://download.test/${eventHandle}`) {
        return new Response(new Uint8Array(eventCiphertext), { status: 200 });
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    }) as typeof fetch;

    const logSpy = vi.fn();
    const warnSpy = vi.fn();

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
        log: logSpy,
        warn: warnSpy,
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

    megaReadonlyEnsureSyncPhase = 1;
    await adapter.ensureSync(share, account);

    await expect(fs.readFile(path.join(localPath, 'blocks', blockName1), 'utf8')).resolves.toBe(filePlaintext.toString('utf8'));
    await expect(fs.readFile(path.join(localPath, channelEventRelPath), 'utf8')).resolves.toBe(eventBytes.toString('utf8'));
    const partialCountAfterFirstSync = partialFetchCount;
    expect(partialCountAfterFirstSync).toBeGreaterThanOrEqual(1);

    megaReadonlyEnsureSyncPhase = 2;
    await adapter.ensureSync(share, account);
    await expect(fs.readFile(path.join(localPath, 'blocks', blockName1), 'utf8')).resolves.toBe(filePlaintext.toString('utf8'));
    const partialCountAfterSecondSync = partialFetchCount;

    megaReadonlyEnsureSyncPhase = 3;
    await adapter.ensureSync(share, account);
    await expect(fs.readFile(path.join(localPath, 'blocks', blockName2), 'utf8')).resolves.toBe(updatedPlaintext.toString('utf8'));
    expect(partialFetchCount).toBeGreaterThanOrEqual(partialCountAfterSecondSync);

    const pushLogs = logSpy.mock.calls.filter(([message]) => message === 'MEGA push update received.');
    expect(pushLogs.length).toBeGreaterThanOrEqual(2);
    expect(pushLogs.some((call) => (call[1] as { nextScsn?: string })?.nextScsn === 'cursor-2')).toBe(true);
    expect(
      pushLogs.some(
        (call) =>
          (call[1] as { touchesShare?: boolean; nextScsn?: string })?.touchesShare === true &&
          (call[1] as { nextScsn?: string })?.nextScsn === 'cursor-3'
      )
    ).toBe(true);

    const newBlockLogs = logSpy.mock.calls.filter(([message]) => message === 'MEGA readonly share reported new block.');
    expect(newBlockLogs.length).toBeGreaterThanOrEqual(1);
    expect(
      newBlockLogs.some(
        (call) =>
          (call[1] as { path?: string; shareId?: string })?.shareId === share.id &&
          (call[1] as { path?: string })?.path === `blocks/${blockName1}`
      )
    ).toBe(true);

    const newFileLogs = logSpy.mock.calls.filter(([message]) => message === 'MEGA readonly share reported new file.');
    expect(newFileLogs).toHaveLength(1);
    expect(newFileLogs[0]?.[1]).toMatchObject({
      shareId: share.id,
      path: channelEventRelPath,
      size: eventBytes.length,
    });

    const updatedBlockLogs = logSpy.mock.calls.filter(([message]) => message === 'MEGA readonly share reported updated block.');
    if (updatedBlockLogs.length > 0) {
      expect(updatedBlockLogs[0]?.[1]).toMatchObject({
        shareId: share.id,
        path: `blocks/${blockName2}`,
        previousSize: filePlaintext.length,
        size: updatedPlaintext.length,
      });
    }

    const unsupportedTopLevelLogs = logSpy.mock.calls.filter(
      ([message]) => message === 'MEGA readonly share reported unsupported top-level entries.'
    );
    expect(unsupportedTopLevelLogs).toHaveLength(1);
    expect(unsupportedTopLevelLogs[0]?.[1]).toMatchObject({
      shareId: share.id,
      added: ['test.txt'],
      removed: [],
      current: ['test.txt'],
    });

    expect(commandInvocations).toEqual([]);

    const state = await adapter.getState(share, account);
    expect(state.status).toBe('ready');
    expect(state.detail).toContain('up to date');

    await adapter.detachManagedShare(share, account);
    await adapter.dispose();
  });

  it('rejects malformed stored account secrets with a reconnect error instead of crashing', async () => {
    const secretStore = createMemorySecretStore();
    await secretStore.set('provider-account:mega:acct-mega-bad', {
      masterKey: 'broken-master-key',
      userHandle: 'broken-user',
      accountVersion: 2,
      password: 'secret',
    });

    const runtime = createIntegrationRuntime({
      secretStore,
      logger: {
        log() {},
        warn() {},
      },
    });

    const adapter = new MegaTransportAdapter(runtime, {
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });

    await expect(
      adapter.listIncomingShares({
        id: 'acct-mega-bad',
        provider: 'mega',
        label: 'MEGA',
        state: 'connected',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    ).rejects.toThrow('Reconnect MEGA to resume syncing.');

    await expect(secretStore.get('provider-account:mega:acct-mega-bad')).resolves.toMatchObject({
      masterKey: 'broken-master-key',
    });
  });

  it('manages native owner invitations and collaborator inventory', async () => {
    const secretStore = createMemorySecretStore();
    await secretStore.set('provider-account:mega:acct-mega-owner', {
      email: 'owner@example.com',
      password: 'secret',
      sid: 'helper-session',
      masterKey: encodeMegaBase64Url(Buffer.from('00112233445566778899aabbccddeeff', 'hex')),
      userHandle: 'ownerhandle',
      accountVersion: 2,
    });
    const masterKey = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
    const mockOutgoingShareKey = Buffer.from('0f0e0d0c0b0a09080706050403020100', 'hex');
    const rootNodeKey = Buffer.from('102132435465768798a9babbdcddf0f1', 'hex');
    const nearbytesNodeKey = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
    const blocksNodeKey = Buffer.from('11223344556677889900aabbccddeeff', 'hex');
    const channelsNodeKey = Buffer.from('2233445566778899aabbccddeeff0011', 'hex');
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (!url.startsWith('https://g.api.mega.co.nz/cs')) {
        throw new Error(`Unexpected request URL: ${url}`);
      }
      const payload = JSON.parse(String(init?.body ?? '[]'))[0] as Record<string, unknown>;
      switch (payload.a) {
        case 'ug':
          return new Response(JSON.stringify([{ u: 'ownerhandle', email: 'owner@example.com' }]), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        case 'uga':
          return new Response(JSON.stringify([{}]), {
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
                    a: encryptAttributes('Cloud Drive', rootNodeKey),
                    k: encodeMegaBase64Url(encryptAesEcb(rootNodeKey, masterKey)),
                  },
                  {
                    h: 'nearbytes0',
                    p: 'root000001',
                    t: 1,
                    a: encryptAttributes('nearbytes', nearbytesNodeKey),
                    k: encodeMegaBase64Url(encryptAesEcb(nearbytesNodeKey, masterKey)),
                  },
                  {
                    h: 'blocks0001',
                    p: 'nearbytes0',
                    t: 1,
                    a: encryptAttributes('blocks', blocksNodeKey),
                    k: encodeMegaBase64Url(encryptAesEcb(blocksNodeKey, masterKey)),
                  },
                  {
                    h: 'chans00001',
                    p: 'nearbytes0',
                    t: 1,
                    a: encryptAttributes('channels', channelsNodeKey),
                    k: encodeMegaBase64Url(encryptAesEcb(channelsNodeKey, masterKey)),
                  },
                ],
                s: [
                  {
                    h: 'nearbytes0',
                    u: 'activeusr01',
                    r: 2,
                    ts: 1710000000,
                    sk: encodeMegaBase64Url(encryptAesEcb(mockOutgoingShareKey, masterKey)),
                  },
                  {
                    h: 'nearbytes0',
                    p: 'pending0001',
                    r: 2,
                    ts: 1710000001,
                    sk: encodeMegaBase64Url(encryptAesEcb(mockOutgoingShareKey, masterKey)),
                  },
                ],
                opc: [
                  {
                    p: 'pending0001',
                    e: 'invited@example.com',
                    m: 'owner@example.com',
                    ts: 1710000001,
                    uts: 1710000001,
                  },
                ],
                u: [
                  { u: 'activeusr01', m: 'active@example.com' },
                ],
              },
            ]),
            {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }
          );
        case 's2':
          return new Response(JSON.stringify([{}]), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        default:
          throw new Error(`Unexpected MEGA API payload: ${JSON.stringify(payload)}`);
      }
    });

    const runtime = createIntegrationRuntime({
      secretStore,
      logger: {
        log() {},
        warn() {},
      },
      mega: { inviteReflectionTimeoutMs: 0 },
    });

    const adapter = new MegaTransportAdapter(runtime, {
      fetchImpl,
    });
    const account: ProviderAccount = {
      id: 'acct-mega-owner',
      provider: 'mega',
      label: 'MEGA',
      email: 'owner@example.com',
      state: 'connected',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const share: ManagedShare = {
      id: 'share-mega-owner',
      provider: 'mega',
      accountId: account.id,
      label: 'nearbytes',
      role: 'owner',
      localPath: '/tmp/nearbytes',
      sourceId: 'src-mega-owner',
      syncMode: 'mirror',
      remoteDescriptor: { remotePath: '/nearbytes' },
      capabilities: ['mirror', 'read', 'write', 'invite'],
      invitationEmails: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await adapter.invite(share, { emails: ['active@example.com', 'active@example.com', 'new@example.com'] }, account);
    const collaborators = await adapter.getCollaborators(share, account);

    expect(collaborators).toEqual([
      {
        label: 'active@example.com',
        email: 'active@example.com',
        role: 'full access',
        status: 'active',
        source: 'provider',
      },
      {
        label: 'invited@example.com',
        email: 'invited@example.com',
        role: 'full access',
        status: 'invited',
        source: 'provider',
      },
    ]);
    const s2Payload = fetchImpl.mock.calls
      .map(([, init]) => JSON.parse(String(init?.body ?? '[]'))[0] as Record<string, unknown>)
      .find((payload) => payload.a === 's2');
    expect(s2Payload).toBeDefined();
    expect(s2Payload?.e).toBe('new@example.com');
    const s2Targets = s2Payload?.s as unknown;
    const s2First =
      Array.isArray(s2Targets) && s2Targets[0] && typeof s2Targets[0] === 'object'
        ? (s2Targets[0] as Record<string, unknown>)
        : {};
    expect(s2First.u).toBe('EXP');
    expect(s2First.r).toBe(0);
  });

  it('does not rebuild cr on invite when fetch-nodes lists an outgoing share on the owner root but no collaborator emails resolve', async () => {
    const secretStore = createMemorySecretStore();
    await secretStore.set('provider-account:mega:acct-mega-owner-orphan', {
      email: 'owner@example.com',
      password: 'secret',
      sid: 'helper-session',
      masterKey: encodeMegaBase64Url(Buffer.from('00112233445566778899aabbccddeeff', 'hex')),
      userHandle: 'ownerhandle',
      accountVersion: 2,
    });
    const masterKey = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
    const mockOutgoingShareKey = Buffer.from('0f0e0d0c0b0a09080706050403020100', 'hex');
    const rootNodeKey = Buffer.from('102132435465768798a9babbdcddf0f1', 'hex');
    const nearbytesNodeKey = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
    const blocksNodeKey = Buffer.from('11223344556677889900aabbccddeeff', 'hex');
    const channelsNodeKey = Buffer.from('2233445566778899aabbccddeeff0011', 'hex');
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (!url.startsWith('https://g.api.mega.co.nz/cs')) {
        throw new Error(`Unexpected request URL: ${url}`);
      }
      const payload = JSON.parse(String(init?.body ?? '[]'))[0] as Record<string, unknown>;
      switch (payload.a) {
        case 'ug':
          return new Response(JSON.stringify([{ u: 'ownerhandle', email: 'owner@example.com' }]), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        case 'uga':
          return new Response(JSON.stringify([{}]), {
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
                    a: encryptAttributes('Cloud Drive', rootNodeKey),
                    k: encodeMegaBase64Url(encryptAesEcb(rootNodeKey, masterKey)),
                  },
                  {
                    h: 'nearbytes0',
                    p: 'root000001',
                    t: 1,
                    a: encryptAttributes('nearbytes', nearbytesNodeKey),
                    k: encodeMegaBase64Url(encryptAesEcb(nearbytesNodeKey, masterKey)),
                  },
                  {
                    h: 'blocks0001',
                    p: 'nearbytes0',
                    t: 1,
                    a: encryptAttributes('blocks', blocksNodeKey),
                    k: encodeMegaBase64Url(encryptAesEcb(blocksNodeKey, masterKey)),
                  },
                  {
                    h: 'chans00001',
                    p: 'nearbytes0',
                    t: 1,
                    a: encryptAttributes('channels', channelsNodeKey),
                    k: encodeMegaBase64Url(encryptAesEcb(channelsNodeKey, masterKey)),
                  },
                ],
                s: [
                  {
                    h: 'nearbytes0',
                    u: 'notincontact1',
                    r: 2,
                    ts: 1710000000,
                    sk: encodeMegaBase64Url(encryptAesEcb(mockOutgoingShareKey, masterKey)),
                  },
                ],
                u: [],
              },
            ]),
            {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }
          );
        case 's2':
          return new Response(JSON.stringify([{}]), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        default:
          throw new Error(`Unexpected MEGA API payload: ${JSON.stringify(payload)}`);
      }
    });

    const runtime = createIntegrationRuntime({
      secretStore,
      logger: { log() {}, warn() {} },
      mega: { inviteReflectionTimeoutMs: 0 },
    });

    const adapter = new MegaTransportAdapter(runtime, { fetchImpl });
    const account: ProviderAccount = {
      id: 'acct-mega-owner-orphan',
      provider: 'mega',
      label: 'MEGA',
      email: 'owner@example.com',
      state: 'connected',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const share: ManagedShare = {
      id: 'share-mega-owner-orphan',
      provider: 'mega',
      accountId: account.id,
      label: 'nearbytes',
      role: 'owner',
      localPath: '/tmp/nearbytes',
      sourceId: 'src-mega-owner',
      syncMode: 'mirror',
      remoteDescriptor: { remotePath: '/nearbytes' },
      capabilities: ['mirror', 'read', 'write', 'invite'],
      invitationEmails: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await adapter.invite(share, { emails: ['newpeer@example.com'] }, account);

    const s2Payload = fetchImpl.mock.calls
      .map(([, init]) => JSON.parse(String(init?.body ?? '[]'))[0] as Record<string, unknown>)
      .find((p) => p.a === 's2');
    expect(s2Payload).toBeDefined();
    expect(s2Payload?.cr).toBeUndefined();
  });

  it('sends contact email in s2.u for owner invites when the invitee is an existing contact', async () => {
    const secretStore = createMemorySecretStore();
    await secretStore.set('provider-account:mega:acct-mega-owner-inv', {
      email: 'owner@example.com',
      password: 'secret',
      sid: 'helper-session',
      masterKey: encodeMegaBase64Url(Buffer.from('00112233445566778899aabbccddeeff', 'hex')),
      userHandle: 'ownerhandle',
      accountVersion: 2,
    });
    const masterKey = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
    const mockOutgoingShareKey = Buffer.from('0f0e0d0c0b0a09080706050403020100', 'hex');
    const rootNodeKey = Buffer.from('102132435465768798a9babbdcddf0f1', 'hex');
    const nearbytesNodeKey = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
    const blocksNodeKey = Buffer.from('11223344556677889900aabbccddeeff', 'hex');
    const channelsNodeKey = Buffer.from('2233445566778899aabbccddeeff0011', 'hex');
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (!url.startsWith('https://g.api.mega.co.nz/cs')) {
        throw new Error(`Unexpected request URL: ${url}`);
      }
      const payload = JSON.parse(String(init?.body ?? '[]'))[0] as Record<string, unknown>;
      switch (payload.a) {
        case 'ug':
          return new Response(JSON.stringify([{ u: 'ownerhandle', email: 'owner@example.com' }]), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        case 'uga':
          return new Response(JSON.stringify([{}]), {
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
                    a: encryptAttributes('Cloud Drive', rootNodeKey),
                    k: encodeMegaBase64Url(encryptAesEcb(rootNodeKey, masterKey)),
                  },
                  {
                    h: 'nearbytes0',
                    p: 'root000001',
                    t: 1,
                    a: encryptAttributes('nearbytes', nearbytesNodeKey),
                    k: encodeMegaBase64Url(encryptAesEcb(nearbytesNodeKey, masterKey)),
                  },
                  {
                    h: 'blocks0001',
                    p: 'nearbytes0',
                    t: 1,
                    a: encryptAttributes('blocks', blocksNodeKey),
                    k: encodeMegaBase64Url(encryptAesEcb(blocksNodeKey, masterKey)),
                  },
                  {
                    h: 'chans00001',
                    p: 'nearbytes0',
                    t: 1,
                    a: encryptAttributes('channels', channelsNodeKey),
                    k: encodeMegaBase64Url(encryptAesEcb(channelsNodeKey, masterKey)),
                  },
                ],
                s: [
                  {
                    h: 'nearbytes0',
                    u: 'activeusr01',
                    r: 2,
                    ts: 1710000000,
                    sk: encodeMegaBase64Url(encryptAesEcb(mockOutgoingShareKey, masterKey)),
                  },
                ],
                u: [
                  { u: 'activeusr01', m: 'active@example.com' },
                  { u: 'friendhdl1', m: 'friend@example.com' },
                ],
              },
            ]),
            {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }
          );
        case 's2':
          return new Response(JSON.stringify([{}]), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        default:
          throw new Error(`Unexpected MEGA API payload: ${JSON.stringify(payload)}`);
      }
    });

    const runtime = createIntegrationRuntime({
      secretStore,
      logger: { log() {}, warn() {} },
      mega: { inviteReflectionTimeoutMs: 0 },
    });

    const adapter = new MegaTransportAdapter(runtime, { fetchImpl });
    const account: ProviderAccount = {
      id: 'acct-mega-owner-inv',
      provider: 'mega',
      label: 'MEGA',
      email: 'owner@example.com',
      state: 'connected',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const share: ManagedShare = {
      id: 'share-mega-owner-inv',
      provider: 'mega',
      accountId: account.id,
      label: 'nearbytes',
      role: 'owner',
      localPath: '/tmp/nearbytes',
      sourceId: 'src-mega-owner',
      syncMode: 'mirror',
      remoteDescriptor: { remotePath: '/nearbytes' },
      capabilities: ['mirror', 'read', 'write', 'invite'],
      invitationEmails: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await adapter.invite(share, { emails: ['friend@example.com'] }, account);

    const s2Payload = fetchImpl.mock.calls
      .map(([, init]) => JSON.parse(String(init?.body ?? '[]'))[0] as Record<string, unknown>)
      .find((p) => p.a === 's2');
    expect(s2Payload).toBeDefined();
    expect(s2Payload?.e).toBeUndefined();
    const s2Targets = s2Payload?.s as unknown;
    const s2First =
      Array.isArray(s2Targets) && s2Targets[0] && typeof s2Targets[0] === 'object'
        ? (s2Targets[0] as Record<string, unknown>)
        : {};
    expect(s2First.u).toBe('friendhdl1');
  });

  it('activates a writable MEGA owner sync through the native API and reports it ready', async () => {
    const secretStore = createMemorySecretStore();
    await secretStore.set('provider-account:mega:acct-mega-owner-sync', {
      email: 'owner@example.com',
      password: 'secret',
      sid: 'helper-session',
      masterKey: encodeMegaBase64Url(Buffer.from('00112233445566778899aabbccddeeff', 'hex')),
      userHandle: 'ownerhandle',
      accountVersion: 2,
    });

    const localPath = await fs.mkdtemp(path.join(os.tmpdir(), 'nearbytes-mega-owner-sync-'));
    tempDirs.push(localPath);
    const cryptoOpsOwner = createCryptoOperations();
    const ownerBlockHash = await cryptoOpsOwner.computeHash(Buffer.from('hello-owner-sync', 'utf8'));
    const ownerBlockName = `${ownerBlockHash}.bin`;
    await fs.mkdir(path.join(localPath, 'blocks'), { recursive: true });
    await fs.writeFile(path.join(localPath, 'blocks', ownerBlockName), Buffer.from('hello-owner-sync', 'utf8'));

    const masterKey = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
    const rootNodeKey = Buffer.from('102132435465768798a9babbdcddf0f1', 'hex');
    const nearbytesNodeKey = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
    const blocksNodeKey = Buffer.from('11223344556677889900aabbccddeeff', 'hex');
    const channelsNodeKey = Buffer.from('2233445566778899aabbccddeeff0011', 'hex');
    let uploadedFileNodeKey: Buffer | null = null;
    let uploadedFileVisible = false;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.startsWith('https://g.api.mega.co.nz/cs')) {
        const payload = JSON.parse(String(init?.body ?? '[]'))[0] as Record<string, unknown>;
        switch (payload.a) {
          case 'ug':
            return new Response(JSON.stringify([{ u: 'ownerhandle', email: 'owner@example.com' }]), {
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
                      a: encryptAttributes('Cloud Drive', rootNodeKey),
                      k: encodeMegaBase64Url(encryptAesEcb(rootNodeKey, masterKey)),
                    },
                    {
                      h: 'nearbytes0',
                      p: 'root000001',
                      t: 1,
                      a: encryptAttributes('nearbytes', nearbytesNodeKey),
                      k: encodeMegaBase64Url(encryptAesEcb(nearbytesNodeKey, masterKey)),
                    },
                    {
                      h: 'blocks0001',
                      p: 'nearbytes0',
                      t: 1,
                      a: encryptAttributes('blocks', blocksNodeKey),
                      k: encodeMegaBase64Url(encryptAesEcb(blocksNodeKey, masterKey)),
                    },
                    {
                      h: 'chans00001',
                      p: 'nearbytes0',
                      t: 1,
                      a: encryptAttributes('channels', channelsNodeKey),
                      k: encodeMegaBase64Url(encryptAesEcb(channelsNodeKey, masterKey)),
                    },
                    ...(uploadedFileVisible && uploadedFileNodeKey
                      ? [{
                        h: 'file000001',
                        p: 'blocks0001',
                        t: 0,
                        s: 16,
                        a: encryptAttributes(ownerBlockName, uploadedFileNodeKey),
                        k: encodeMegaBase64Url(encryptAesEcb(uploadedFileNodeKey, masterKey)),
                      }]
                      : []),
                  ],
                  u: [],
                },
              ]),
              {
                status: 200,
                headers: { 'content-type': 'application/json' },
              }
            );
          case 'u':
            return new Response(JSON.stringify([{ p: 'https://upload.test/file' }]), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            });
          case 'p':
            if (payload.t === 'blocks0001') {
              const node = ((payload.n as Array<Record<string, unknown>> | undefined) ?? [])[0];
              const encodedKey = typeof node?.k === 'string' ? node.k : '';
              uploadedFileNodeKey = encodedKey ? decryptAesEcb(decodeMegaBase64Url(encodedKey), masterKey) : null;
              uploadedFileVisible = Boolean(uploadedFileNodeKey);
            }
            return new Response(JSON.stringify([{}]), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            });
          default:
            throw new Error(`Unexpected MEGA API payload: ${JSON.stringify(payload)}`);
        }
      }
      if (url.startsWith('https://upload.test/file/0?d=')) {
        return new Response(randomBytes(36), { status: 200 });
      }
      throw new Error(`Unexpected request URL: ${url}`);
    });
    const runtime = createIntegrationRuntime({
      secretStore,
      mega: {
        remoteBasePath: '/nearbytes',
        syncIntervalMs: 60_000,
      },
      logger: {
        log() {},
        warn() {},
      },
    });

    const adapter = new MegaTransportAdapter(runtime, {
      fetchImpl,
    });
    const account: ProviderAccount = {
      id: 'acct-mega-owner-sync',
      provider: 'mega',
      label: 'MEGA',
      email: 'owner@example.com',
      state: 'connected',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const share: ManagedShare = {
      id: 'share-mega-owner-sync',
      provider: 'mega',
      accountId: account.id,
      label: 'nearbytes',
      role: 'owner',
      localPath,
      sourceId: 'src-mega-owner-sync',
      syncMode: 'mirror',
      remoteDescriptor: { remotePath: '/nearbytes' },
      capabilities: ['mirror', 'read', 'write', 'invite'],
      invitationEmails: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await adapter.ensureSync(share, account);
    const state = await adapter.getState(share, account);

    expect(state.status).toBe('ready');
    expect(state.detail).toContain('/nearbytes');
    await expect(fs.stat(path.join(localPath, 'blocks'))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(localPath, 'channels'))).resolves.toBeTruthy();
    expect(fetchImpl).toHaveBeenCalled();
    expect(uploadedFileNodeKey).not.toBeNull();
    expect(uploadedFileNodeKey).toHaveLength(32);
    expect(uploadedFileNodeKey!.subarray(24, 32).equals(Buffer.alloc(8, 0))).toBe(false);

    await adapter.detachManagedShare(share, account);
    await adapter.dispose();
  }, 15_000);

  it('lists and accepts native incoming MEGA contact invites', async () => {
    const secretStore = createMemorySecretStore();
    await secretStore.set('provider-account:mega:acct-mega-owner', {
      email: 'owner@example.com',
      password: 'secret',
      sid: 'helper-session',
      masterKey: encodeMegaBase64Url(Buffer.from('00112233445566778899aabbccddeeff', 'hex')),
      userHandle: 'ownerhandle',
      accountVersion: 2,
    });

    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (!url.startsWith('https://g.api.mega.co.nz/cs')) {
        throw new Error(`Unexpected request URL: ${url}`);
      }
      const payload = JSON.parse(String(init?.body ?? '[]'))[0] as Record<string, unknown>;
      switch (payload.a) {
        case 'ug':
          return new Response(JSON.stringify([{ u: 'ownerhandle', email: 'owner@example.com' }]), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        case 'f':
          return new Response(
            JSON.stringify([
              {
                f: [],
                ipc: [{ p: 'abc123', m: 'peer@example.com', ts: 1710000000, uts: 1710000000 }],
              },
            ]),
            {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }
          );
        case 'upca':
          return new Response(JSON.stringify([{}]), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        default:
          throw new Error(`Unexpected MEGA API payload: ${JSON.stringify(payload)}`);
      }
    });
    const runtime = createIntegrationRuntime({
      secretStore,
      logger: {
        log() {},
        warn() {},
      },
    });

    const adapter = new MegaTransportAdapter(runtime, {
      fetchImpl,
    });
    const account: ProviderAccount = {
      id: 'acct-mega-owner',
      provider: 'mega',
      label: 'MEGA',
      email: 'owner@example.com',
      state: 'connected',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const invites = await adapter.listIncomingContactInvites(account);
    await adapter.acceptIncomingContactInvite(account, 'abc123');

    expect(invites).toEqual([
      {
        id: 'abc123',
        provider: 'mega',
        accountId: 'acct-mega-owner',
        label: 'peer@example.com',
        detail: 'peer@example.com wants to connect on MEGA.',
      },
    ]);
    expect(
      fetchImpl.mock.calls.some(([, init]) => {
        const payload = JSON.parse(String(init?.body ?? '[]'))[0] as Record<string, unknown>;
        return payload.a === 'upca' && payload.p === 'abc123';
      })
    ).toBe(true);
  });

  it('persists unsupported top-level entry diffs across aborted readonly sync attempts', async () => {
    const secretStore = createMemorySecretStore();
    await secretStore.set('provider-account:mega:acct-mega-unsupported', {
      email: 'reader@example.com',
      password: 'correct horse battery staple',
      sid: 'unsupported-session',
      masterKey: encodeMegaBase64Url(Buffer.from('00112233445566778899aabbccddeeff', 'hex')),
      userHandle: 'usrhandle01',
      accountVersion: 2,
    });

    const shareHandle = 'hNtERb6T';
    const ownerHandle = 'owner000001';
    const blocksHandle = 'blocks0001';
    const fileHandle = 'file000001';
    const unsupportedHandleOne = 'testfile01';
    const unsupportedHandleTwo = 'testfile02';
    const shareKey = Buffer.from('0f1e2d3c4b5a69788796a5b4c3d2e1f0', 'hex');
    const rootNodeKey = Buffer.from('102132435465768798a9babbdcddf0f1', 'hex');
    const blocksNodeKey = Buffer.from('11223344556677889900aabbccddeeff', 'hex');
    const fileNodeKey = Buffer.from('00112233445566778899aabbccddeeff102132435465768798a9babbdcddf0f1', 'hex');
    const unsupportedNodeKeyOne = Buffer.from('5566778899aabbccddeeff0011223344102132435465768798a9babbdcddf0f1', 'hex');
    const unsupportedNodeKeyTwo = Buffer.from('66778899aabbccddeeff001122334455102132435465768798a9babbdcddf0f1', 'hex');
    const filePlaintext = Buffer.from('abort-after-tree-fetch', 'utf8');
    const fileCiphertext = encryptFileContent(filePlaintext, fileNodeKey);
    let snapshotCount = 0;

    const snapshotWithOneUnsupported = {
      f: [
        {
          h: shareHandle,
          t: 1,
          a: encryptAttributes('Team Space', rootNodeKey),
          k: encryptNodeKey(rootNodeKey, shareKey, shareHandle),
          su: ownerHandle,
          sk: encodeMegaBase64Url(encryptAesEcb(shareKey, Buffer.from('00112233445566778899aabbccddeeff', 'hex'))),
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
        {
          h: unsupportedHandleOne,
          p: shareHandle,
          t: 0,
          s: 8,
          a: encryptAttributes('test.txt', unsupportedNodeKeyOne),
          k: encryptNodeKey(unsupportedNodeKeyOne, shareKey, shareHandle),
        },
      ],
      u: [{ u: ownerHandle, m: 'owner@example.com' }],
      sn: 'cursor-1',
    };

    const snapshotWithTwoUnsupported = {
      ...snapshotWithOneUnsupported,
      f: [
        ...snapshotWithOneUnsupported.f,
        {
          h: unsupportedHandleTwo,
          p: shareHandle,
          t: 0,
          s: 9,
          a: encryptAttributes('test2.txt', unsupportedNodeKeyTwo),
          k: encryptNodeKey(unsupportedNodeKeyTwo, shareKey, shareHandle),
        },
      ],
      sn: 'cursor-2',
    };

    const logSpy = vi.fn();
    const warnSpy = vi.fn();

    const runtime = createIntegrationRuntime({
      secretStore,
      logger: {
        log: logSpy,
        warn: warnSpy,
      },
      mega: {
        syncTimeoutMs: 25,
        syncIntervalMs: 60_000,
      },
    });

    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.startsWith('https://g.api.mega.co.nz/sc')) {
        return new Response(JSON.stringify({ a: [{ a: 't' }], sn: 'cursor-2' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.startsWith('https://g.api.mega.co.nz/cs')) {
        const payload = JSON.parse(String(init?.body ?? '[]'))[0] as Record<string, unknown>;
        switch (payload.a) {
          case 'ug':
            return new Response(JSON.stringify([{ u: 'usrhandle01', email: 'reader@example.com' }]), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            });
          case 'uga':
            return new Response(JSON.stringify([{}]), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            });
          case 'f':
            snapshotCount += 1;
            return new Response(JSON.stringify([snapshotCount === 1 ? snapshotWithOneUnsupported : snapshotWithTwoUnsupported]), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            });
          case 'g':
            return new Response(JSON.stringify([{ g: 'https://mega.nz/abort-download', s: filePlaintext.length }]), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            });
          default:
            throw new Error(`Unexpected MEGA command: ${String(payload.a)}`);
        }
      }
      if (url === 'https://mega.nz/abort-download') {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => {
              const error = new Error('This operation was aborted.');
              error.name = 'AbortError';
              reject(error);
            },
            { once: true }
          );
        });
      }
      if (url === 'https://mega.nz/file-download') {
        return new Response(new Uint8Array(fileCiphertext), {
          status: 200,
          headers: { 'content-type': 'application/octet-stream' },
        });
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    }) as typeof fetch;

    const adapter = new MegaTransportAdapter(runtime, { fetchImpl });
    const localPath = await fs.mkdtemp(path.join(os.tmpdir(), 'nearbytes-mega-unsupported-'));
    tempDirs.push(localPath);

    const share: ManagedShare = {
      id: 'share-mega-unsupported-1',
      provider: 'mega',
      accountId: 'acct-mega-unsupported',
      label: 'Team Space',
      role: 'recipient',
      localPath,
      sourceId: 'src-mega-unsupported-1',
      syncMode: 'mirror',
      remoteDescriptor: {
        rootHandle: shareHandle,
        shareHandle,
        ownerEmail: 'owner@example.com',
        shareName: 'Team Space',
      },
      capabilities: ['mirror', 'read', 'accept'],
      invitationEmails: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const account: ProviderAccount = {
      id: 'acct-mega-unsupported',
      provider: 'mega',
      label: 'MEGA',
      email: 'reader@example.com',
      state: 'connected',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await expect(adapter.ensureSync(share, account)).rejects.toMatchObject({ name: 'AbortError' });
    await expect(adapter.ensureSync(share, account)).rejects.toMatchObject({ name: 'AbortError' });

    const unsupportedTopLevelLogs = logSpy.mock.calls.filter(
      ([message]) => message === 'MEGA readonly share reported unsupported top-level entries.'
    );
    expect(unsupportedTopLevelLogs).toHaveLength(2);
    expect(unsupportedTopLevelLogs[0]?.[1]).toMatchObject({
      shareId: share.id,
      added: ['test.txt'],
      removed: [],
      current: ['test.txt'],
    });
    expect(unsupportedTopLevelLogs[1]?.[1]).toMatchObject({
      shareId: share.id,
      added: ['test2.txt'],
      removed: [],
      current: ['test.txt', 'test2.txt'],
    });
  });

  it('times out a hung readonly refresh and surfaces a readable repair state', async () => {
    const secretStore = createMemorySecretStore();
    await secretStore.set('provider-account:mega:acct-mega-timeout', {
      email: 'reader@example.com',
      password: 'correct horse battery staple',
      sid: 'timeout-session',
      masterKey: encodeMegaBase64Url(Buffer.from('00112233445566778899aabbccddeeff', 'hex')),
      userHandle: 'usrhandle01',
      accountVersion: 2,
    });

    const runtime = createIntegrationRuntime({
      secretStore,
      logger: {
        log() {},
        warn() {},
      },
      mega: {
        syncTimeoutMs: 25,
        syncIntervalMs: 60_000,
      },
    });

    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (!url.startsWith('https://g.api.mega.co.nz/cs')) {
        throw new Error(`Unexpected fetch URL: ${url}`);
      }
      const payload = JSON.parse(String(init?.body ?? '[]'))[0] as Record<string, unknown>;
      switch (payload.a) {
        case 'ug':
          return new Response(JSON.stringify([{ u: 'usrhandle01', email: 'reader@example.com' }]), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        case 'uga':
          return new Response(JSON.stringify([{}]), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        case 'f':
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              'abort',
              () => {
                const error = new Error('This operation was aborted.');
                error.name = 'AbortError';
                reject(error);
              },
              { once: true }
            );
          });
        default:
          throw new Error(`Unexpected MEGA command: ${String(payload.a)}`);
      }
    }) as typeof fetch;

    const adapter = new MegaTransportAdapter(runtime, { fetchImpl });
    const localPath = await fs.mkdtemp(path.join(os.tmpdir(), 'nearbytes-mega-timeout-'));
    tempDirs.push(localPath);

    const share: ManagedShare = {
      id: 'share-mega-timeout-1',
      provider: 'mega',
      accountId: 'acct-mega-timeout',
      label: 'Team Space',
      role: 'recipient',
      localPath,
      sourceId: 'src-mega-timeout-1',
      syncMode: 'mirror',
      remoteDescriptor: {
        rootHandle: 'hNtERb6T',
        shareHandle: 'hNtERb6T',
        ownerEmail: 'owner@example.com',
        shareName: 'Team Space',
      },
      capabilities: ['mirror', 'read', 'accept'],
      invitationEmails: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const account: ProviderAccount = {
      id: 'acct-mega-timeout',
      provider: 'mega',
      label: 'MEGA',
      email: 'reader@example.com',
      state: 'connected',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await expect(adapter.ensureSync(share, account)).rejects.toMatchObject({ name: 'AbortError' });

    await expect(adapter.getState(share, account)).resolves.toMatchObject({
      status: 'attention',
      badges: ['Repair'],
      diagnostic: expect.objectContaining({
        code: 'MEGA_SYNC_TIMEOUT',
        summary: 'MEGA mirror timed out',
      }),
    });
  });

  it('aborts an in-flight readonly refresh when the share is detached', async () => {
    const secretStore = createMemorySecretStore();
    await secretStore.set('provider-account:mega:acct-mega-detach', {
      email: 'reader@example.com',
      password: 'correct horse battery staple',
      sid: 'detach-session',
      masterKey: encodeMegaBase64Url(Buffer.from('00112233445566778899aabbccddeeff', 'hex')),
      userHandle: 'usrhandle01',
      accountVersion: 2,
    });

    const runtime = createIntegrationRuntime({
      secretStore,
      logger: {
        log() {},
        warn() {},
      },
      mega: {
        syncTimeoutMs: 5_000,
        syncIntervalMs: 60_000,
      },
    });

    let fetchNodesStarted = false;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (!url.startsWith('https://g.api.mega.co.nz/cs')) {
        throw new Error(`Unexpected fetch URL: ${url}`);
      }
      const payload = JSON.parse(String(init?.body ?? '[]'))[0] as Record<string, unknown>;
      switch (payload.a) {
        case 'ug':
          return new Response(JSON.stringify([{ u: 'usrhandle01', email: 'reader@example.com' }]), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        case 'uga':
          return new Response(JSON.stringify([{}]), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        case 'f':
          fetchNodesStarted = true;
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              'abort',
              () => {
                const error = new Error('This operation was aborted.');
                error.name = 'AbortError';
                reject(error);
              },
              { once: true }
            );
          });
        default:
          throw new Error(`Unexpected MEGA command: ${String(payload.a)}`);
      }
    }) as typeof fetch;

    const adapter = new MegaTransportAdapter(runtime, { fetchImpl });
    const localPath = await fs.mkdtemp(path.join(os.tmpdir(), 'nearbytes-mega-detach-'));
    tempDirs.push(localPath);

    const share: ManagedShare = {
      id: 'share-mega-detach-1',
      provider: 'mega',
      accountId: 'acct-mega-detach',
      label: 'Team Space',
      role: 'recipient',
      localPath,
      sourceId: 'src-mega-detach-1',
      syncMode: 'mirror',
      remoteDescriptor: {
        rootHandle: 'hNtERb6T',
        shareHandle: 'hNtERb6T',
        ownerEmail: 'owner@example.com',
        shareName: 'Team Space',
      },
      capabilities: ['mirror', 'read', 'accept'],
      invitationEmails: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const account: ProviderAccount = {
      id: 'acct-mega-detach',
      provider: 'mega',
      label: 'MEGA',
      email: 'reader@example.com',
      state: 'connected',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const syncPromise = adapter.ensureSync(share, account).then(
      () => ({ kind: 'resolved' as const }),
      (error) => ({ kind: 'rejected' as const, error })
    );

    await vi.waitFor(() => {
      expect(fetchNodesStarted).toBe(true);
    });
    await adapter.detachManagedShare(share, account);

    const result = await Promise.race([
      syncPromise,
      new Promise<{ kind: 'timeout' }>((resolve) => {
        setTimeout(() => resolve({ kind: 'timeout' }), 75);
      }),
    ]);

    expect(result.kind).toBe('rejected');
    if (result.kind === 'rejected') {
      expect(result.error).toMatchObject({ name: 'AbortError' });
    }
  });

  it('retries transient MEGA API locks during readonly sync', async () => {
    const secretStore = createMemorySecretStore();
    await secretStore.set('provider-account:mega:acct-mega-retry', {
      email: 'reader@example.com',
      password: 'correct horse battery staple',
      sid: 'retry-session',
      masterKey: encodeMegaBase64Url(Buffer.from('00112233445566778899aabbccddeeff', 'hex')),
      userHandle: 'usrhandle01',
      accountVersion: 2,
    });

    const shareHandle = 'hNtERb6T';
    const ownerHandle = 'owner000001';
    const blocksHandle = 'blocks0001';
    const fileHandle = 'file000001';
    const shareKey = Buffer.from('0f1e2d3c4b5a69788796a5b4c3d2e1f0', 'hex');
    const rootNodeKey = Buffer.from('102132435465768798a9babbdcddf0f1', 'hex');
    const blocksNodeKey = Buffer.from('11223344556677889900aabbccddeeff', 'hex');
    const fileNodeKey = Buffer.from('00112233445566778899aabbccddeeff102132435465768798a9babbdcddf0f1', 'hex');
    const filePlaintext = Buffer.from('retry-after-api-lock', 'utf8');
    const fileCiphertext = encryptFileContent(filePlaintext, fileNodeKey);
    let currentUserCalls = 0;

    const cryptoRetry = createCryptoOperations();
    const retryBlockName = `${await cryptoRetry.computeHash(filePlaintext)}.bin`;

    const partialSnapshot = {
      f: [
        {
          h: shareHandle,
          t: 1,
          a: encryptAttributes('Team Space', rootNodeKey),
          k: encryptNodeKey(rootNodeKey, shareKey, shareHandle),
          su: ownerHandle,
          sk: encodeMegaBase64Url(encryptAesEcb(shareKey, Buffer.from('00112233445566778899aabbccddeeff', 'hex'))),
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
          a: encryptAttributes(retryBlockName, fileNodeKey),
          k: encryptNodeKey(fileNodeKey, shareKey, shareHandle),
        },
      ],
      u: [{ u: ownerHandle, m: 'owner@example.com' }],
      sn: 'cursor-1',
    };

    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.startsWith('https://g.api.mega.co.nz/cs')) {
        const payload = JSON.parse(String(init?.body ?? '[]'))[0] as Record<string, unknown>;
        switch (payload.a) {
          case 'ug':
            currentUserCalls += 1;
            return new Response(JSON.stringify([currentUserCalls === 1 ? -3 : { u: 'usrhandle01', email: 'reader@example.com' }]), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            });
          case 'f':
            return new Response(JSON.stringify([partialSnapshot]), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            });
          case 'uga':
            return new Response(JSON.stringify([{}]), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            });
          case 'g':
            return new Response(JSON.stringify([{ g: 'https://mega.nz/file-download' }]), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            });
          default:
            throw new Error(`Unexpected MEGA command: ${String(payload.a)}`);
        }
      }
      if (url === 'https://mega.nz/file-download') {
        return new Response(new Uint8Array(fileCiphertext), {
          status: 200,
          headers: { 'content-type': 'application/octet-stream' },
        });
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    }) as typeof fetch;

    const runtime = createIntegrationRuntime({
      secretStore,
      logger: {
        log() {},
        warn() {},
      },
      mega: {
        syncTimeoutMs: 5_000,
        syncIntervalMs: 60_000,
      },
    });

    const adapter = new MegaTransportAdapter(runtime, { fetchImpl });
    const localPath = await fs.mkdtemp(path.join(os.tmpdir(), 'nearbytes-mega-retry-'));
    tempDirs.push(localPath);

    const share: ManagedShare = {
      id: 'share-mega-retry-1',
      provider: 'mega',
      accountId: 'acct-mega-retry',
      label: 'Team Space',
      role: 'recipient',
      localPath,
      sourceId: 'src-mega-retry-1',
      syncMode: 'mirror',
      remoteDescriptor: {
        rootHandle: shareHandle,
        shareHandle,
        ownerEmail: 'owner@example.com',
        shareName: 'Team Space',
      },
      capabilities: ['mirror', 'read', 'accept'],
      invitationEmails: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const account: ProviderAccount = {
      id: 'acct-mega-retry',
      provider: 'mega',
      label: 'MEGA',
      email: 'reader@example.com',
      state: 'connected',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await expect(adapter.ensureSync(share, account)).resolves.toBeUndefined();
    await expect(fs.readFile(path.join(localPath, 'blocks', retryBlockName), 'utf8')).resolves.toBe(filePlaintext.toString('utf8'));
    expect(currentUserCalls).toBeGreaterThanOrEqual(2);
    await expect(adapter.getState(share, account)).resolves.toMatchObject({ status: 'ready' });
  });

  it('falls back to a full snapshot when partial MEGA tree fetches stay locked', async () => {
    const secretStore = createMemorySecretStore();
    await secretStore.set('provider-account:mega:acct-mega-full-fallback', {
      email: 'reader@example.com',
      password: 'correct horse battery staple',
      sid: 'fallback-session',
      masterKey: encodeMegaBase64Url(Buffer.from('00112233445566778899aabbccddeeff', 'hex')),
      userHandle: 'usrhandle01',
      accountVersion: 2,
    });

    const shareHandle = 'hNtERb6T';
    const ownerHandle = 'owner000001';
    const blocksHandle = 'blocks0001';
    const fileHandle = 'file000001';
    const shareKey = Buffer.from('0f1e2d3c4b5a69788796a5b4c3d2e1f0', 'hex');
    const masterKey = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
    const rootNodeKey = Buffer.from('102132435465768798a9babbdcddf0f1', 'hex');
    const blocksNodeKey = Buffer.from('11223344556677889900aabbccddeeff', 'hex');
    const fileNodeKey = Buffer.from('00112233445566778899aabbccddeeff102132435465768798a9babbdcddf0f1', 'hex');
    const filePlaintext = Buffer.from('full-snapshot-fallback', 'utf8');
    const fileCiphertext = encryptFileContent(filePlaintext, fileNodeKey);
    let partialFetchCalls = 0;
    let fullFetchCalls = 0;

    const cryptoFallback = createCryptoOperations();
    const fallbackBlockName = `${await cryptoFallback.computeHash(filePlaintext)}.bin`;

    const snapshot = {
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
          a: encryptAttributes(fallbackBlockName, fileNodeKey),
          k: encryptNodeKey(fileNodeKey, shareKey, shareHandle),
        },
      ],
      u: [{ u: ownerHandle, m: 'owner@example.com' }],
      sn: 'cursor-1',
    };

    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.startsWith('https://g.api.mega.co.nz/cs')) {
        const payload = JSON.parse(String(init?.body ?? '[]'))[0] as Record<string, unknown>;
        switch (payload.a) {
          case 'ug':
            return new Response(JSON.stringify([{ u: 'usrhandle01', email: 'reader@example.com' }]), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            });
          case 'f':
            if (payload.n) {
              partialFetchCalls += 1;
              return new Response(JSON.stringify([-3]), {
                status: 200,
                headers: { 'content-type': 'application/json' },
              });
            }
            fullFetchCalls += 1;
            return new Response(JSON.stringify([snapshot]), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            });
          case 'uga':
            return new Response(JSON.stringify([{}]), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            });
          case 'g':
            return new Response(JSON.stringify([{ g: 'https://mega.nz/file-download-fallback' }]), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            });
          default:
            throw new Error(`Unexpected MEGA command: ${String(payload.a)}`);
        }
      }
      if (url === 'https://mega.nz/file-download-fallback') {
        return new Response(new Uint8Array(fileCiphertext), {
          status: 200,
          headers: { 'content-type': 'application/octet-stream' },
        });
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    }) as typeof fetch;

    const runtime = createIntegrationRuntime({
      secretStore,
      logger: {
        log() {},
        warn() {},
      },
      mega: {
        syncTimeoutMs: 10_000,
        syncIntervalMs: 60_000,
      },
    });

    const adapter = new MegaTransportAdapter(runtime, { fetchImpl });
    const localPath = await fs.mkdtemp(path.join(os.tmpdir(), 'nearbytes-mega-full-fallback-'));
    tempDirs.push(localPath);

    const share: ManagedShare = {
      id: 'share-mega-full-fallback-1',
      provider: 'mega',
      accountId: 'acct-mega-full-fallback',
      label: 'Team Space',
      role: 'recipient',
      localPath,
      sourceId: 'src-mega-full-fallback-1',
      syncMode: 'mirror',
      remoteDescriptor: {
        rootHandle: shareHandle,
        shareHandle,
        ownerEmail: 'owner@example.com',
        shareName: 'Team Space',
      },
      capabilities: ['mirror', 'read', 'accept'],
      invitationEmails: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const account: ProviderAccount = {
      id: 'acct-mega-full-fallback',
      provider: 'mega',
      label: 'MEGA',
      email: 'reader@example.com',
      state: 'connected',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await expect(adapter.ensureSync(share, account)).resolves.toBeUndefined();
    await expect(fs.readFile(path.join(localPath, 'blocks', fallbackBlockName), 'utf8')).resolves.toBe(filePlaintext.toString('utf8'));
    expect(partialFetchCalls).toBeGreaterThanOrEqual(1);
    expect(fullFetchCalls).toBe(1);
  }, 20_000);

  it('reuses the saved MEGA login to refresh an invalid session and still lists incoming shares', async () => {
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
    const shareHandle = 'hNtERb6T';
    const shareKey = Buffer.from('0f1e2d3c4b5a69788796a5b4c3d2e1f0', 'hex');
    const rootNodeKey = Buffer.from('102132435465768798a9babbdcddf0f1', 'hex');
    let preloginCount = 0;
    let loginCount = 0;
    let currentUserCount = 0;
    let fetchNodesCount = 0;

    const snapshot = {
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
      ],
      u: [{ u: ownerHandle, m: 'owner@example.com' }],
    };

    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body ?? '[]'))[0] as Record<string, unknown>;
      switch (payload.a) {
        case 'us0':
          preloginCount += 1;
          return new Response(JSON.stringify([{ v: 2, s: salt }]), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        case 'us':
          loginCount += 1;
          return new Response(
            JSON.stringify([{ k: encodeMegaBase64Url(encryptedMasterKey), u: userHandle, tsid }]),
            { status: 200, headers: { 'content-type': 'application/json' } }
          );
        case 'ug':
          currentUserCount += 1;
          return new Response(JSON.stringify([currentUserCount === 1 ? -15 : { u: userHandle, email }]), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        case 'f':
          fetchNodesCount += 1;
          return new Response(JSON.stringify([snapshot]), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        default:
          throw new Error(`Unexpected MEGA API payload: ${JSON.stringify(payload)}`);
      }
    }) as typeof fetch;

    const runtime = createIntegrationRuntime({
      secretStore: createMemorySecretStore(),
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

    await expect(adapter.listIncomingShares(connected.account as ProviderAccount)).resolves.toMatchObject([
      {
        remoteDescriptor: {
          ownerEmail: 'owner@example.com',
          rootHandle: shareHandle,
          shareName: 'Team Space',
        },
      },
    ]);
    expect(preloginCount).toBe(2);
    expect(loginCount).toBe(2);
    expect(currentUserCount).toBe(1);
    expect(fetchNodesCount).toBe(1);
  });

  it('requires reconnect when refreshing the MEGA session with saved credentials also fails', async () => {
    const email = 'reader@example.com';
    const password = 'correct horse battery staple';
    const salt = encodeMegaBase64Url(Buffer.from('0123456789abcdeffedcba9876543210', 'hex'));
    const passwordKey = await deriveV2MasterKey(password, salt);
    const masterKey = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
    const encryptedMasterKey = encryptAesEcb(masterKey, passwordKey);
    const tsidLeft = Buffer.from('11223344556677889900aabbccddeeff', 'hex');
    const tsid = encodeMegaBase64Url(Buffer.concat([tsidLeft, encryptAesEcb(tsidLeft, masterKey)]));
    const userHandle = 'usrhandle01';
    let preloginCount = 0;
    let loginCount = 0;
    let currentUserCount = 0;

    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body ?? '[]'))[0] as Record<string, unknown>;
      switch (payload.a) {
        case 'us0':
          preloginCount += 1;
          return new Response(JSON.stringify([{ v: 2, s: salt }]), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        case 'us':
          loginCount += 1;
          return new Response(
            JSON.stringify([loginCount === 1 ? { k: encodeMegaBase64Url(encryptedMasterKey), u: userHandle, tsid } : -15]),
            { status: 200, headers: { 'content-type': 'application/json' } }
          );
        case 'ug':
          currentUserCount += 1;
          return new Response(JSON.stringify([-15]), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        default:
          throw new Error(`Unexpected MEGA API payload: ${JSON.stringify(payload)}`);
      }
    }) as typeof fetch;

    const runtime = createIntegrationRuntime({
      secretStore: createMemorySecretStore(),
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

    await expect(adapter.listIncomingShares(connected.account as ProviderAccount)).rejects.toThrow(
      'Reconnect MEGA to resume syncing.'
    );
    expect(preloginCount).toBe(2);
    expect(loginCount).toBe(2);
    expect(currentUserCount).toBe(1);
  });

  it('treats recovered legacy local MEGA folders as locally attached shares until the account reconnects', async () => {
    const runtime = createIntegrationRuntime({
      secretStore: createMemorySecretStore(),
      logger: {
        log() {},
        warn() {},
      },
    });
    const adapter = new MegaTransportAdapter(runtime, {
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });

    const share: ManagedShare = {
      id: 'share-mega-legacy-1',
      provider: 'mega',
      accountId: 'acct-mega-1',
      label: 'nearbytes',
      role: 'owner',
      localPath: path.join(os.tmpdir(), 'nearbytes-mega-legacy-local'),
      sourceId: 'src-mega-legacy-1',
      syncMode: 'mirror',
      remoteDescriptor: {
        remotePath: '/nearbytes',
        shareName: 'nearbytes',
        legacyLocalMirror: true,
      },
      capabilities: ['mirror', 'read', 'write'],
      invitationEmails: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await expect(adapter.getState(share, null)).resolves.toMatchObject({
      status: 'ready',
      badges: ['Local'],
    });
  });

  it('treats MEGA owner folders as native writable syncs', async () => {
    const secretStore = createMemorySecretStore();
    await secretStore.set('provider-account:mega:acct-mega-1', {
      email: 'owner@example.com',
      password: 'secret',
      sid: 'helper-session',
      masterKey: encodeMegaBase64Url(Buffer.from('00112233445566778899aabbccddeeff', 'hex')),
      userHandle: 'ownerhandle',
      accountVersion: 2,
    });
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.startsWith('https://g.api.mega.co.nz/cs')) {
        const payload = JSON.parse(String(init?.body ?? '[]'))[0] as Record<string, unknown>;
        switch (payload.a) {
          case 'ug':
            return new Response(JSON.stringify([{ u: 'ownerhandle', email: 'owner@example.com' }]), {
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
                        encryptAesEcb(Buffer.from('102132435465768798a9babbdcddf0f1', 'hex'), Buffer.from('00112233445566778899aabbccddeeff', 'hex'))
                      ),
                    },
                    {
                      h: 'nearbytes0',
                      p: 'root000001',
                      t: 1,
                      a: encryptAttributes('nearbytes', Buffer.from('00112233445566778899aabbccddeeff', 'hex')),
                      k: encodeMegaBase64Url(
                        encryptAesEcb(Buffer.from('00112233445566778899aabbccddeeff', 'hex'), Buffer.from('00112233445566778899aabbccddeeff', 'hex'))
                      ),
                    },
                    {
                      h: 'blocks0001',
                      p: 'nearbytes0',
                      t: 1,
                      a: encryptAttributes('blocks', Buffer.from('11223344556677889900aabbccddeeff', 'hex')),
                      k: encodeMegaBase64Url(
                        encryptAesEcb(Buffer.from('11223344556677889900aabbccddeeff', 'hex'), Buffer.from('00112233445566778899aabbccddeeff', 'hex'))
                      ),
                    },
                    {
                      h: 'chans00001',
                      p: 'nearbytes0',
                      t: 1,
                      a: encryptAttributes('channels', Buffer.from('2233445566778899aabbccddeeff0011', 'hex')),
                      k: encodeMegaBase64Url(
                        encryptAesEcb(Buffer.from('2233445566778899aabbccddeeff0011', 'hex'), Buffer.from('00112233445566778899aabbccddeeff', 'hex'))
                      ),
                    },
                  ],
                  u: [],
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
      }
      throw new Error(`Unexpected request URL: ${url}`);
    });
    const runtime = createIntegrationRuntime({
      secretStore,
      logger: {
        log() {},
        warn() {},
      },
    });
    const adapter = new MegaTransportAdapter(runtime, { fetchImpl });

    const share: ManagedShare = {
      id: 'share-mega-owner-1',
      provider: 'mega',
      accountId: 'acct-mega-1',
      label: 'nearbytes',
      role: 'owner',
      localPath: path.join(os.tmpdir(), 'nearbytes-mega-owner-local'),
      sourceId: 'src-mega-owner-1',
      syncMode: 'mirror',
      remoteDescriptor: {
        remotePath: '/nearbytes',
        shareName: 'nearbytes',
        legacyLocalMirror: true,
      },
      capabilities: ['mirror', 'read', 'write'],
      invitationEmails: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const account: ProviderAccount = {
      id: 'acct-mega-1',
      provider: 'mega',
      label: 'MEGA',
      email: 'owner@example.com',
      state: 'connected',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await expect(adapter.ensureSync(share, account)).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalled();
    await expect(adapter.getState(share, account)).resolves.toMatchObject({
      status: 'ready',
      badges: ['Writable', 'Synced'],
    });
  });

  it('derives the authenticated sid from csid responses using MEGA-compatible encoding', async () => {
    const email = 'reader@example.com';
    const password = 'correct horse battery staple';
    const salt = encodeMegaBase64Url(Buffer.from('0123456789abcdeffedcba9876543210', 'hex'));
    const passwordKey = await deriveV2MasterKey(password, salt);
    const masterKey = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
    const encryptedMasterKey = encryptAesEcb(masterKey, passwordKey);
    const userHandle = 'usrhandle01';
    const fullSession = Buffer.alloc(255, 0);
    Buffer.from('0123456789abcdef', 'latin1').copy(fullSession, 0);
    Buffer.from(userHandle, 'latin1').copy(fullSession, 16);
    Buffer.from('session-payload-marker', 'latin1').copy(fullSession, 27);
    const expectedSid = encodeMegaBase64Url(fullSession.subarray(0, 43));

    const { privateKey: privateKeyObject, publicKey: publicKeyObject } = generateKeyPairSync('rsa' as any, {
      modulusLength: 2048,
      publicExponent: 0x10001,
      privateKeyEncoding: { format: 'jwk' },
      publicKeyEncoding: { format: 'jwk' },
    });
    const privateJwk = privateKeyObject as JsonWebKey;
    const publicJwk = publicKeyObject as JsonWebKey;
    const q = decodeMegaBase64Url(String(privateJwk.q));
    const p = decodeMegaBase64Url(String(privateJwk.p));
    const d = decodeMegaBase64Url(String(privateJwk.d));
    const qi = decodeMegaBase64Url(String(privateJwk.qi));
    const privateKeyPayload = Buffer.concat([
      encodeMegaPrivateKeyComponent(q),
      encodeMegaPrivateKeyComponent(p),
      encodeMegaPrivateKeyComponent(d),
      encodeMegaPrivateKeyComponent(qi),
      Buffer.alloc(8, 0),
    ]);
    const paddedPrivateKeyPayload = Buffer.concat([
      privateKeyPayload,
      Buffer.alloc((16 - (privateKeyPayload.length % 16)) % 16, 0),
    ]);
    const encryptedPrivateKey = encryptAesEcb(
      paddedPrivateKeyPayload,
      masterKey
    );
    const modulus = bufferToBigInt(decodeMegaBase64Url(String(publicJwk.n)));
    const publicExponent = bufferToBigInt(decodeMegaBase64Url(String(publicJwk.e)));
    const csid = encodeMegaBase64Url(encodeMpi(encryptRsaRaw(fullSession, modulus, publicExponent)));

    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body ?? '[]'))[0] as Record<string, unknown>;
      switch (payload.a) {
        case 'us0':
          return new Response(JSON.stringify([{ v: 2, s: salt }]), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        case 'us':
          return new Response(
            JSON.stringify([
              {
                k: encodeMegaBase64Url(encryptedMasterKey),
                u: userHandle,
                csid,
                privk: encodeMegaBase64Url(encryptedPrivateKey),
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

    const runtime = createIntegrationRuntime({
      secretStore: createMemorySecretStore(),
      logger: {
        log() {},
        warn() {},
      },
    });

    const adapter = new MegaTransportAdapter(runtime, { fetchImpl });
    const session = await (adapter as any).loginWithPassword(email, password);

    expect(session.userHandle).toBe(userHandle);
    expect(session.sid).toBe(expectedSid);
  });

  it('lists incoming shares when the MEGA share key is RSA-wrapped', async () => {
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
    const shareHandle = 'hNtERb6T';
    const shareKey = Buffer.from('0f1e2d3c4b5a69788796a5b4c3d2e1f0', 'hex');
    const rootNodeKey = Buffer.from('102132435465768798a9babbdcddf0f1', 'hex');

    const { privateKey: privateKeyObject, publicKey: publicKeyObject } = generateKeyPairSync('rsa' as any, {
      modulusLength: 2048,
      publicExponent: 0x10001,
      privateKeyEncoding: { format: 'jwk' },
      publicKeyEncoding: { format: 'jwk' },
    });
    const privateJwk = privateKeyObject as JsonWebKey;
    const publicJwk = publicKeyObject as JsonWebKey;
    const q = decodeMegaBase64Url(String(privateJwk.q));
    const p = decodeMegaBase64Url(String(privateJwk.p));
    const d = decodeMegaBase64Url(String(privateJwk.d));
    const qi = decodeMegaBase64Url(String(privateJwk.qi));
    const privateKeyBlob = Buffer.concat([
      encodeMegaPrivateKeyComponent(q),
      encodeMegaPrivateKeyComponent(p),
      encodeMegaPrivateKeyComponent(d),
      encodeMegaPrivateKeyComponent(qi),
      Buffer.alloc(8, 0),
    ]);
    const privateKeyPadding = (16 - (privateKeyBlob.length % 16)) % 16;
    const encryptedPrivateKey = encryptAesEcb(
      Buffer.concat([privateKeyBlob, Buffer.alloc(privateKeyPadding, 0)]),
      masterKey
    );
    const modulus = bufferToBigInt(decodeMegaBase64Url(String(publicJwk.n)));
    const publicExponent = bufferToBigInt(decodeMegaBase64Url(String(publicJwk.e)));
    const rsaWrappedShareKey = Buffer.alloc(255, 0);
    shareKey.copy(rsaWrappedShareKey, 0);
    Buffer.from('incoming-share-key', 'latin1').copy(rsaWrappedShareKey, 16);

    const fullSnapshot = {
      f: [
        {
          h: shareHandle,
          t: 1,
          a: encryptAttributes('Team Space', rootNodeKey),
          k: encryptNodeKey(rootNodeKey, shareKey, shareHandle),
          su: ownerHandle,
          sk: encodeMegaBase64Url(encodeMpi(encryptRsaRaw(rsaWrappedShareKey, modulus, publicExponent))),
          r: 0,
        },
      ],
      u: [{ u: ownerHandle, m: 'owner@example.com' }],
    };

    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body ?? '[]'))[0] as Record<string, unknown>;
      switch (payload.a) {
        case 'us0':
          return new Response(JSON.stringify([{ v: 2, s: salt }]), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        case 'us':
          return new Response(
            JSON.stringify([
              {
                k: encodeMegaBase64Url(encryptedMasterKey),
                u: userHandle,
                tsid,
                privk: encodeMegaBase64Url(encryptedPrivateKey),
              },
            ]),
            {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }
          );
        case 'ug':
          return new Response(JSON.stringify([{ u: userHandle, email }]), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        case 'f':
          return new Response(JSON.stringify([fullSnapshot]), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        default:
          throw new Error(`Unexpected MEGA API payload: ${JSON.stringify(payload)}`);
      }
    }) as typeof fetch;

    const runtime = createIntegrationRuntime({
      secretStore: createMemorySecretStore(),
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
    const offers = await adapter.listIncomingShares(connected.account!);

    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({
      label: 'Team Space',
      ownerLabel: 'owner@example.com',
      remoteDescriptor: {
        shareHandle,
        rootHandle: shareHandle,
        accessLevel: 'read',
      },
    });
  });

});
