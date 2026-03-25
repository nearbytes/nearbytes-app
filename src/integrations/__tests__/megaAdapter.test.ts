import { createCipheriv, generateKeyPairSync } from 'crypto';
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
    const eventPlaintext = Buffer.from('channel-event', 'utf8');
    const fileCiphertext = encryptFileContent(filePlaintext, fileNodeKey);
    const updatedCiphertext = encryptFileContent(updatedPlaintext, fileNodeKey);
    const eventCiphertext = encryptFileContent(eventPlaintext, eventNodeKey);
    const commandInvocations: string[] = [];
    let partialFetchCount = 0;
    let blockDownloadVersion = 0;

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
          a: encryptAttributes('room-a', roomNodeKey),
          k: encryptNodeKey(roomNodeKey, shareKey, shareHandle),
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
          h: eventHandle,
          p: roomHandle,
          t: 0,
          s: eventPlaintext.length,
          a: encryptAttributes('event.bin', eventNodeKey),
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
              JSON.stringify([payload.n ? (partialFetchCount >= 2 ? updatedPartialSnapshot : partialSnapshot) : fullSnapshot]),
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
              return new Response(JSON.stringify([{ g: `https://download.test/${String(payload.n)}`, s: eventPlaintext.length }]), {
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
          return new Response(JSON.stringify({ a: [{ a: 'u', n: fileHandle }], sn: 'cursor-3' }), {
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

    await adapter.ensureSync(share, account);

    await expect(fs.readFile(path.join(localPath, 'blocks', 'aa.bin'), 'utf8')).resolves.toBe(filePlaintext.toString('utf8'));
    await expect(fs.readFile(path.join(localPath, 'channels', 'room-a', 'event.bin'), 'utf8')).resolves.toBe(
      eventPlaintext.toString('utf8')
    );
    expect(partialFetchCount).toBe(1);

    await adapter.ensureSync(share, account);
    await expect(fs.readFile(path.join(localPath, 'blocks', 'aa.bin'), 'utf8')).resolves.toBe(filePlaintext.toString('utf8'));
    expect(partialFetchCount).toBe(1);

    await adapter.ensureSync(share, account);
    await expect(fs.readFile(path.join(localPath, 'blocks', 'aa.bin'), 'utf8')).resolves.toBe(updatedPlaintext.toString('utf8'));
    expect(partialFetchCount).toBe(2);

    const pushLogs = logSpy.mock.calls.filter(([message]) => message === 'MEGA push update received.');
    expect(pushLogs).toHaveLength(2);
    expect(pushLogs[0]?.[1]).toMatchObject({
      shareId: share.id,
      packetCount: 1,
      actions: ['u'],
      touchesShare: false,
      previousScsn: 'cursor-1',
      nextScsn: 'cursor-2',
    });
    expect(pushLogs[1]?.[1]).toMatchObject({
      shareId: share.id,
      packetCount: 1,
      actions: ['u'],
      touchesShare: true,
      previousScsn: 'cursor-2',
      nextScsn: 'cursor-3',
    });

    const newBlockLogs = logSpy.mock.calls.filter(([message]) => message === 'MEGA readonly share reported new block.');
    expect(newBlockLogs).toHaveLength(1);
    expect(newBlockLogs[0]?.[1]).toMatchObject({
      shareId: share.id,
      path: 'blocks/aa.bin',
      size: filePlaintext.length,
    });

    const newFileLogs = logSpy.mock.calls.filter(([message]) => message === 'MEGA readonly share reported new file.');
    expect(newFileLogs).toHaveLength(1);
    expect(newFileLogs[0]?.[1]).toMatchObject({
      shareId: share.id,
      path: 'channels/room-a/event.bin',
      size: eventPlaintext.length,
    });

    const updatedBlockLogs = logSpy.mock.calls.filter(([message]) => message === 'MEGA readonly share reported updated block.');
    expect(updatedBlockLogs).toHaveLength(1);
    expect(updatedBlockLogs[0]?.[1]).toMatchObject({
      shareId: share.id,
      path: 'blocks/aa.bin',
      previousSize: filePlaintext.length,
      size: updatedPlaintext.length,
    });

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

    await expect(secretStore.get('provider-account:mega:acct-mega-bad')).resolves.toBeNull();
  });

  it('uses the helper bridge for MEGA owner invitations and collaborator listing', async () => {
    const secretStore = createMemorySecretStore();
    await secretStore.set('provider-account:mega:acct-mega-owner', {
      email: 'owner@example.com',
      password: 'secret',
      sid: 'helper-session',
      masterKey: encodeMegaBase64Url(Buffer.from('00112233445566778899aabbccddeeff', 'hex')),
      userHandle: 'ownerhandle',
      accountVersion: 2,
    });

    const commands: Array<{ command: string; args: readonly string[] | undefined }> = [];
    const runtime = createIntegrationRuntime({
      secretStore,
      commandExecutor: {
        async run(invocation) {
          commands.push({ command: String(invocation.command), args: invocation.args });
          if (invocation.command === 'mega-whoami') {
            return { stdout: 'owner@example.com\n', stderr: '', exitCode: 0 };
          }
          if (invocation.command === 'mega-share' && invocation.args?.[0] === '-a') {
            return { stdout: '', stderr: '', exitCode: 0 };
          }
          if (invocation.command === 'mega-share' && invocation.args?.[0] === '-p') {
            return {
              stdout:
                'nearbytes, shared with active@example.com (read-only)\nnearbytes, shared (still pending) with invited@example.com (read-only)\n',
              stderr: '',
              exitCode: 0,
            };
          }
          throw new Error(`Unexpected helper command: ${invocation.command} ${(invocation.args ?? []).join(' ')}`);
        },
      },
      logger: {
        log() {},
        warn() {},
      },
    });

    const adapter = new MegaTransportAdapter(runtime, {
      fetchImpl: vi.fn() as unknown as typeof fetch,
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

    await adapter.invite(share, { emails: ['active@example.com', 'active@example.com', 'invited@example.com'] }, account);
    const collaborators = await adapter.getCollaborators(share, account);

    expect(commands).toEqual([
      { command: 'mega-whoami', args: [] },
      { command: 'mega-share', args: ['-a', '--with=active@example.com', '--level=0', '/nearbytes'] },
      { command: 'mega-share', args: ['-a', '--with=invited@example.com', '--level=0', '/nearbytes'] },
      { command: 'mega-whoami', args: [] },
      { command: 'mega-share', args: ['-p', '/nearbytes'] },
    ]);
    expect(collaborators).toEqual([
      {
        label: 'active@example.com',
        email: 'active@example.com',
        role: 'read-only',
        status: 'active',
        source: 'provider',
      },
      {
        label: 'invited@example.com',
        email: 'invited@example.com',
        role: 'read-only',
        status: 'invited',
        source: 'provider',
      },
    ]);
  });

  it('uses the helper bridge for incoming MEGA contact invites', async () => {
    const secretStore = createMemorySecretStore();
    await secretStore.set('provider-account:mega:acct-mega-owner', {
      email: 'owner@example.com',
      password: 'secret',
      sid: 'helper-session',
      masterKey: encodeMegaBase64Url(Buffer.from('00112233445566778899aabbccddeeff', 'hex')),
      userHandle: 'ownerhandle',
      accountVersion: 2,
    });

    const commands: Array<{ command: string; args: readonly string[] | undefined }> = [];
    const runtime = createIntegrationRuntime({
      secretStore,
      commandExecutor: {
        async run(invocation) {
          commands.push({ command: String(invocation.command), args: invocation.args });
          if (invocation.command === 'mega-whoami') {
            return { stdout: 'owner@example.com\n', stderr: '', exitCode: 0 };
          }
          if (invocation.command === 'mega-showpcr') {
            return {
              stdout: 'peer@example.com (id: abc123, creation: 2025-03-01, modification: 2025-03-01)\n',
              stderr: '',
              exitCode: 0,
            };
          }
          if (invocation.command === 'mega-ipc') {
            return { stdout: '', stderr: '', exitCode: 0 };
          }
          throw new Error(`Unexpected helper command: ${invocation.command} ${(invocation.args ?? []).join(' ')}`);
        },
      },
      logger: {
        log() {},
        warn() {},
      },
    });

    const adapter = new MegaTransportAdapter(runtime, {
      fetchImpl: vi.fn() as unknown as typeof fetch,
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
    expect(commands).toEqual([
      { command: 'mega-whoami', args: [] },
      { command: 'mega-showpcr', args: ['--in'] },
      { command: 'mega-whoami', args: [] },
      { command: 'mega-ipc', args: ['abc123', '-a'] },
    ]);
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
          a: encryptAttributes('aa.bin', fileNodeKey),
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
    await expect(fs.readFile(path.join(localPath, 'blocks', 'aa.bin'), 'utf8')).resolves.toBe(filePlaintext.toString('utf8'));
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
          a: encryptAttributes('aa.bin', fileNodeKey),
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
    await expect(fs.readFile(path.join(localPath, 'blocks', 'aa.bin'), 'utf8')).resolves.toBe(filePlaintext.toString('utf8'));
    expect(partialFetchCalls).toBeGreaterThanOrEqual(1);
    expect(fullFetchCalls).toBe(1);
  });

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

  it('treats recovered legacy local MEGA folders as locally attached shares', async () => {
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

    await expect(
      adapter.ensureSync(share, {
        id: 'acct-mega-1',
        provider: 'mega',
        label: 'MEGA',
        state: 'connected',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    ).resolves.toBeUndefined();

    await expect(adapter.getState(share, null)).resolves.toMatchObject({
      status: 'ready',
      badges: ['Local'],
    });
  });

  it('treats MEGA owner folders as local shares without starting recipient sync', async () => {
    const runtime = createIntegrationRuntime({
      secretStore: createMemorySecretStore(),
      logger: {
        log() {},
        warn() {},
      },
    });
    const fetchImpl = vi.fn() as unknown as typeof fetch;
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
    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(adapter.getState(share, account)).resolves.toMatchObject({
      status: 'ready',
      badges: ['Local'],
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
    const encryptedPrivateKey = encryptAesEcb(
      Buffer.concat([
        encodeMegaPrivateKeyComponent(q),
        encodeMegaPrivateKeyComponent(p),
        encodeMegaPrivateKeyComponent(d),
        encodeMegaPrivateKeyComponent(qi),
        Buffer.alloc(8, 0),
      ]),
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
