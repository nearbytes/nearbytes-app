import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { createCryptoOperations } from '../../crypto/index.js';
import { volumeIdFromPublicKey } from '../../domain/fileCrypto.js';
import { createEncryptedData, EMPTY_HASH, EventType } from '../../types/events.js';
import { createSecret } from '../../types/keys.js';
import { serializeEvent, serializeEventPayload } from '../../storage/serialization.js';
import {
  ProviderRefreshWorker,
  type ProviderRefreshManifest,
  type ProviderRefreshRemoteAdapter,
  type ProviderRefreshRemoteEntry,
} from '../providerRefreshWorker.js';

class FakeReadonlyRemote implements ProviderRefreshRemoteAdapter {
  constructor(
    private readonly entries: ProviderRefreshRemoteEntry[],
    private readonly contents: Record<string, string>
  ) {}

  async list(): Promise<readonly ProviderRefreshRemoteEntry[]> {
    return this.entries;
  }

  async download(relativePath: string): Promise<Uint8Array> {
    const value = this.contents[relativePath];
    if (typeof value !== 'string') {
      throw new Error(`Missing remote entry: ${relativePath}`);
    }
    return new TextEncoder().encode(value);
  }
}

const crypto = createCryptoOperations();

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

async function createStoredBlock(value: string): Promise<{ hash: string; bytes: Uint8Array }> {
  const data = bytes(value);
  return {
    hash: await crypto.computeHash(data),
    bytes: data,
  };
}

async function createStoredDeleteEvent(secretValue: string, fileName: string): Promise<{
  volumeId: string;
  eventHash: string;
  bytes: Uint8Array;
}> {
  const keyPair = await crypto.deriveKeys(createSecret(secretValue));
  const payload = {
    type: EventType.DELETE_FILE,
    fileName,
    hash: EMPTY_HASH,
    encryptedKey: createEncryptedData(new Uint8Array(0)),
  };
  const payloadBytes = serializeEventPayload(payload);
  const signature = await crypto.signPR(payloadBytes, keyPair.privateKey);
  return {
    volumeId: volumeIdFromPublicKey(keyPair.publicKey),
    eventHash: await crypto.computeHash(payloadBytes),
    bytes: bytes(JSON.stringify(serializeEvent({ payload, signature }))),
  };
}

describe('ProviderRefreshWorker', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((tempDir) => fs.rm(tempDir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it('downloads changed files, preserves unchanged ones, and removes obsolete manifest entries', async () => {
    const worker = new ProviderRefreshWorker();
    const localRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nearbytes-provider-refresh-'));
    tempDirs.push(localRoot);
    const keepBlock = await createStoredBlock('keep');
    const replaceBlock = await createStoredBlock('new-value-2');
    const staleBlock = await createStoredBlock('stale');
    const remoteEvent = await createStoredDeleteEvent('nearbytes-provider-refresh', 'event.txt');

    await fs.mkdir(path.join(localRoot, 'blocks'), { recursive: true });
    await fs.mkdir(path.join(localRoot, 'channels', remoteEvent.volumeId), { recursive: true });
    await fs.writeFile(path.join(localRoot, 'blocks', `${keepBlock.hash}.bin`), keepBlock.bytes);
    await fs.writeFile(path.join(localRoot, 'blocks', `${replaceBlock.hash}.bin`), 'old-value', 'utf8');
    await fs.writeFile(path.join(localRoot, 'blocks', `${staleBlock.hash}.bin`), staleBlock.bytes);

    const previousManifest: ProviderRefreshManifest = {
      entries: {
        [`blocks/${keepBlock.hash}.bin`]: { kind: 'file', fingerprint: 'keep-v1', size: 4 },
        [`blocks/${replaceBlock.hash}.bin`]: { kind: 'file', fingerprint: 'replace-v1', size: 9 },
        [`blocks/${staleBlock.hash}.bin`]: { kind: 'file', fingerprint: 'stale-v1', size: 5 },
      },
    };

    const remote = new FakeReadonlyRemote(
      [
        { path: 'blocks', kind: 'folder', fingerprint: 'folder-blocks' },
        { path: `channels/${remoteEvent.volumeId}`, kind: 'folder', fingerprint: 'folder-volume' },
        { path: `blocks/${keepBlock.hash}.bin`, kind: 'file', fingerprint: 'keep-v1', size: 4 },
        { path: `blocks/${replaceBlock.hash}.bin`, kind: 'file', fingerprint: 'replace-v2', size: 11 },
        {
          path: `channels/${remoteEvent.volumeId}/${remoteEvent.eventHash}.bin`,
          kind: 'file',
          fingerprint: 'event-v1',
          size: remoteEvent.bytes.byteLength,
        },
      ],
      {
        [`blocks/${keepBlock.hash}.bin`]: 'keep',
        [`blocks/${replaceBlock.hash}.bin`]: 'new-value-2',
        [`channels/${remoteEvent.volumeId}/${remoteEvent.eventHash}.bin`]: new TextDecoder().decode(remoteEvent.bytes),
      }
    );

    const result = await worker.refresh(localRoot, remote, previousManifest);

    expect(result.downloaded).toEqual([
      `blocks/${replaceBlock.hash}.bin`,
      `channels/${remoteEvent.volumeId}/${remoteEvent.eventHash}.bin`,
    ]);
    expect(result.removed).toEqual([`blocks/${staleBlock.hash}.bin`]);
    expect(result.skipped).toEqual([`blocks/${keepBlock.hash}.bin`]);
    expect(result.invalid).toEqual([]);

    await expect(fs.readFile(path.join(localRoot, 'blocks', `${keepBlock.hash}.bin`), 'utf8')).resolves.toBe('keep');
    await expect(fs.readFile(path.join(localRoot, 'blocks', `${replaceBlock.hash}.bin`), 'utf8')).resolves.toBe('new-value-2');
    await expect(
      fs.readFile(path.join(localRoot, 'channels', remoteEvent.volumeId, `${remoteEvent.eventHash}.bin`), 'utf8')
    ).resolves.toContain('DELETE_FILE');
    await expect(fs.stat(path.join(localRoot, 'blocks', `${staleBlock.hash}.bin`))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(result.manifest.entries[`blocks/${replaceBlock.hash}.bin`]).toEqual({
      kind: 'file',
      fingerprint: 'replace-v2',
      size: 11,
    });
  });

  it('skips invalid remote canonical-storage files', async () => {
    const worker = new ProviderRefreshWorker();
    const localRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nearbytes-provider-refresh-'));
    tempDirs.push(localRoot);

    const invalidVolumeId = (await createStoredDeleteEvent('nearbytes-provider-refresh-invalid', 'event.txt')).volumeId;
    const invalidPath = `channels/${invalidVolumeId}/deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef (1).bin`;
    const remote = new FakeReadonlyRemote(
      [{ path: invalidPath, kind: 'file', fingerprint: 'bad', size: 3 }],
      { [invalidPath]: 'bad' }
    );

    const result = await worker.refresh(localRoot, remote);

    expect(result.downloaded).toEqual([]);
    expect(result.skipped).toEqual([invalidPath]);
    expect(result.invalid).toEqual([invalidPath]);
    expect(result.skippedDetails[invalidPath]).toMatchObject({
      code: 'invalid-storage-path',
    });
    await expect(fs.readFile(path.join(localRoot, invalidPath), 'utf8')).rejects.toThrow();
  });
});