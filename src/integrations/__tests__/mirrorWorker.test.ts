import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCryptoOperations } from 'nearbytes-crypto';
import { volumeIdFromPublicKey } from '../../domain/fileCrypto.js';
import { createEncryptedData, EMPTY_HASH, EventType } from 'nearbytes-crypto';
import { createSecret } from 'nearbytes-crypto';
import { serializeEvent, serializeEventEnvelope } from 'nearbytes-log';
import { MirrorWorker } from '../mirrorWorker.js';
import type { MirrorRemoteAdapter, MirrorRemoteEntry } from '../adapters.js';
import { createSignedEvent } from '../../domain/eventEnvelope.js';

class FakeRemote implements MirrorRemoteAdapter {
  readonly entries = new Map<string, Uint8Array>();
  readonly unconfirmedPaths = new Set<string>();

  constructor(initial: Record<string, string> = {}) {
    for (const [relativePath, value] of Object.entries(initial)) {
      this.entries.set(relativePath, new TextEncoder().encode(value));
    }
  }

  async list(): Promise<MirrorRemoteEntry[]> {
    return Array.from(this.entries.entries()).map(([relativePath, bytes]) => ({
      path: relativePath,
      size: bytes.byteLength,
    }));
  }

  async download(relativePath: string): Promise<Uint8Array> {
    const bytes = this.entries.get(relativePath);
    if (!bytes) {
      throw new Error(`Missing remote entry: ${relativePath}`);
    }
    return bytes;
  }

  async upload(relativePath: string, data: Uint8Array): Promise<void> {
    this.entries.set(relativePath, new Uint8Array(data));
  }

  async confirmEntry(relativePath: string, expectedSize: number): Promise<boolean> {
    const normalizedPath = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
    if (this.unconfirmedPaths.has(normalizedPath)) {
      return false;
    }
    const bytes = this.entries.get(normalizedPath);
    return Boolean(bytes && bytes.byteLength === expectedSize);
  }

  reconcileUploadsByRemoteSize(): boolean {
    return true;
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
  const storedEvent = await createSignedEvent(crypto, keyPair, payload, []);
  return {
    volumeId: volumeIdFromPublicKey(keyPair.publicKey),
    eventHash: await crypto.computeHash(serializeEventEnvelope(storedEvent.envelope)),
    bytes: bytes(JSON.stringify(serializeEvent(storedEvent))),
  };
}

describe('MirrorWorker', () => {
  const worker = new MirrorWorker();
  let tempDir: string;
  let localBlock: Awaited<ReturnType<typeof createStoredBlock>>;
  let localEvent: Awaited<ReturnType<typeof createStoredDeleteEvent>>;
  let remoteBlock: Awaited<ReturnType<typeof createStoredBlock>>;
  let remoteEvent: Awaited<ReturnType<typeof createStoredDeleteEvent>>;

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nearbytes-mirror-worker-'));
    localBlock = await createStoredBlock('local-only');
    localEvent = await createStoredDeleteEvent('nearbytes-mirror-local', 'local.txt');
    remoteBlock = await createStoredBlock('remote-only');
    remoteEvent = await createStoredDeleteEvent('nearbytes-mirror-remote', 'remote.txt');
    await fs.mkdir(path.join(tempDir, 'blocks'), { recursive: true });
    await fs.mkdir(path.join(tempDir, 'channels', localEvent.volumeId), { recursive: true });
    await fs.writeFile(path.join(tempDir, 'blocks', `${localBlock.hash}.bin`), localBlock.bytes);
    await fs.writeFile(
      path.join(tempDir, 'channels', localEvent.volumeId, `${localEvent.eventHash}.bin`),
      localEvent.bytes
    );
  });

  afterAll(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('uploads missing local files and downloads missing remote files without overwriting existing ones', async () => {
    const remote = new FakeRemote({
      [`blocks/${localBlock.hash}.bin`]: 'remote-ignored',
      [`blocks/${remoteBlock.hash}.bin`]: new TextDecoder().decode(remoteBlock.bytes),
      [`channels/${remoteEvent.volumeId}/${remoteEvent.eventHash}.bin`]: new TextDecoder().decode(remoteEvent.bytes),
    });

    const result = await worker.sync(tempDir, remote);

    expect(result.uploaded.sort()).toEqual(
      [`blocks/${localBlock.hash}.bin`, `channels/${localEvent.volumeId}/${localEvent.eventHash}.bin`].sort()
    );
    expect(result.downloaded).toEqual([
      `blocks/${remoteBlock.hash}.bin`,
      `channels/${remoteEvent.volumeId}/${remoteEvent.eventHash}.bin`,
    ]);
    expect(result.skipped).toEqual([]);

    expect(await fs.readFile(path.join(tempDir, 'blocks', `${remoteBlock.hash}.bin`), 'utf8')).toBe('remote-only');
    expect(
      await fs.readFile(path.join(tempDir, 'channels', remoteEvent.volumeId, `${remoteEvent.eventHash}.bin`), 'utf8')
    ).toBe(new TextDecoder().decode(remoteEvent.bytes));
    expect(
      new TextDecoder().decode(remote.entries.get(`channels/${localEvent.volumeId}/${localEvent.eventHash}.bin`)!)
    ).toBe(new TextDecoder().decode(localEvent.bytes));
    expect(new TextDecoder().decode(remote.entries.get(`blocks/${localBlock.hash}.bin`)!)).toBe('local-only');
  });

  it('skips invalid local and remote storage files', async () => {
    const localRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nearbytes-mirror-worker-invalid-'));
    try {
      const event = await createStoredDeleteEvent('nearbytes-mirror-invalid', 'local.txt');
      const block = await createStoredBlock('local-block');
      const invalidLocalPath = `channels/${event.volumeId}/${event.eventHash} (1).bin`;
      await fs.mkdir(path.join(localRoot, 'blocks'), { recursive: true });
      await fs.mkdir(path.join(localRoot, 'channels', event.volumeId), { recursive: true });
      await fs.writeFile(path.join(localRoot, 'blocks', `${block.hash}.bin`), block.bytes);
      const invalidRemotePath = `channels/${remoteEvent.volumeId}/${remoteEvent.eventHash} (1).bin`;
      await fs.writeFile(path.join(localRoot, invalidLocalPath), 'duplicate', 'utf8');

      const remote = new FakeRemote({
        [invalidRemotePath]: 'remote-duplicate',
      });

      const result = await worker.sync(localRoot, remote);

      expect(result.uploaded).toEqual([`blocks/${block.hash}.bin`]);
      expect(result.downloaded).toEqual([]);
      expect(result.skipped).toEqual([invalidLocalPath, invalidRemotePath]);
      await expect(fs.readFile(path.join(localRoot, invalidRemotePath), 'utf8')).rejects.toThrow();
    } finally {
      await fs.rm(localRoot, { recursive: true, force: true });
    }
  });

  it('uploads when a reported remote file cannot be confirmed', async () => {
    const remote = new FakeRemote({
      [`blocks/${localBlock.hash}.bin`]: 'stale-remote',
    });
    remote.unconfirmedPaths.add(`blocks/${localBlock.hash}.bin`);

    const result = await worker.sync(tempDir, remote);

    expect(result.uploaded).toContain(`blocks/${localBlock.hash}.bin`);
    expect(new TextDecoder().decode(remote.entries.get(`blocks/${localBlock.hash}.bin`)!)).toBe('local-only');
  });
});
