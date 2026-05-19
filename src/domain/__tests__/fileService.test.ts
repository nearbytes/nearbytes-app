import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { createCryptoOperations } from 'nearbytes-crypto';
import type { RootsConfig } from '../../config/roots.js';
import { storeData } from 'nearbytes-files';
import { serializeEvent, serializeEventEnvelope } from 'nearbytes-log';
import { createLog } from 'nearbytes-log';
import { FilesystemStorageBackend } from 'nearbytes-storage';
import { MultiRootStorageBackend } from '../../storage/multiRoot.js';
import { loadEventLog, openVolume } from 'nearbytes-files';
import { createEncryptedData, createSignature, EventType } from 'nearbytes-crypto';
import { createSecret } from 'nearbytes-crypto';
import { defaultPathMapper } from 'nearbytes-storage';
import { createFileService } from 'nearbytes-files';
import { createSignedEvent } from 'nearbytes-log';
import { hydrateSignedEvent } from 'nearbytes-log';

const START_TIME = 1700000000000;

describe('FileService', () => {
  it('adds a file and lists it', async () => {
    const { service, cleanup } = await createTestService(START_TIME);

    const data = Buffer.from('hello file');
    const result = await service.addFile('test:secret:one', 'hello.txt', data, 'text/plain');
    const files = await service.listFiles('test:secret:one');

    expect(result.filename).toBe('hello.txt');
    expect(result.size).toBe(data.length);
    expect(result.mimeType).toBe('text/plain');
    expect(result.createdAt).toBe(START_TIME);

    expect(files).toHaveLength(1);
    expect(files[0].filename).toBe('hello.txt');
    expect(files[0].size).toBe(data.length);
    expect(files[0].createdAt).toBe(START_TIME);

    await cleanup();
  });

  it('removes corrupt block and event replicas while reading from multi-root storage', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nearbytes-files-'));
    const mainRoot = join(dir, 'main');
    const backupRoot = join(dir, 'backup');
    await mkdir(mainRoot, { recursive: true });
    await mkdir(backupRoot, { recursive: true });

    const crypto = createCryptoOperations();
    const secret = createSecret('test:secret:repair-read');
    const keyPair = await crypto.deriveKeys(secret);
    const volumeId = Buffer.from(keyPair.publicKey).toString('hex');
    const storage = new MultiRootStorageBackend(createMultiRootConfig(mainRoot, backupRoot, [volumeId]));
    const channelStorage = createLog(storage, defaultPathMapper);
    const backupStorage = new FilesystemStorageBackend(backupRoot);
    const backupChannelStorage = createLog(backupStorage, defaultPathMapper);

    const plaintext = Buffer.from('validated payload');
    const symmetricKey = await crypto.deriveSymKey(keyPair.privateKey);
    const encryptedData = await crypto.encryptSym(plaintext, symmetricKey);
    const blobHash = await crypto.computeHash(encryptedData);
    await backupChannelStorage.blocks.store(blobHash, encryptedData, false, keyPair.publicKey);

    const payload = {
      type: EventType.CREATE_FILE,
      fileName: 'validated.txt',
      hash: blobHash,
      encryptedKey: createEncryptedData(new Uint8Array(0)),
      size: plaintext.length,
      createdAt: START_TIME,
    } as const;
    const storedEvent = await createSignedEvent(crypto, keyPair, payload, [blobHash]);
    const eventHash = await crypto.computeHash(serializeEventEnvelope(storedEvent.envelope));
    await backupChannelStorage.events.storeEvent(keyPair.publicKey, storedEvent);

    const channelPath = defaultPathMapper(keyPair.publicKey);
    await mkdir(join(mainRoot, 'blocks'), { recursive: true });
    await mkdir(join(mainRoot, channelPath), { recursive: true });
    await writeFile(join(mainRoot, 'blocks', `${blobHash}.bin`), 'corrupt-block', 'utf8');
    await writeFile(
      join(mainRoot, channelPath, `${eventHash}.bin`),
      JSON.stringify(serializeEvent({ ...storedEvent, signature: createSignature(new Uint8Array(storedEvent.signature.length)) })),
      'utf8'
    );

    await expect(channelStorage.blocks.retrieve(blobHash, keyPair.publicKey)).resolves.toEqual(encryptedData);
    const repairedEvent = await hydrateSignedEvent(
      crypto,
      keyPair.privateKey,
      await channelStorage.events.retrieveEvent(keyPair.publicKey, eventHash)
    );
    expect(repairedEvent.payload.fileName).toBe('validated.txt');

    await expect(readFile(join(mainRoot, 'blocks', `${blobHash}.bin`), 'utf8')).rejects.toThrow();
    await expect(readFile(join(mainRoot, channelPath, `${eventHash}.bin`), 'utf8')).rejects.toThrow();
    await expect(readFile(join(backupRoot, 'blocks', `${blobHash}.bin`))).resolves.toBeDefined();
    await expect(readFile(join(backupRoot, channelPath, `${eventHash}.bin`), 'utf8')).resolves.toBe(
      JSON.stringify(serializeEvent(storedEvent))
    );

    await rm(dir, { recursive: true, force: true });
  });

  it('deletes a file and it disappears from the list', async () => {
    const { service, cleanup } = await createTestService(START_TIME);

    await service.addFile('test:secret:two', 'remove.txt', Buffer.from('remove me'));
    await service.deleteFile('test:secret:two', 'remove.txt');
    const files = await service.listFiles('test:secret:two');

    expect(files).toHaveLength(0);

    await cleanup();
  });

  it('keeps the latest version when the same filename is added twice', async () => {
    const { service, cleanup } = await createTestService(START_TIME);

    await service.addFile('test:secret:three', 'notes.txt', Buffer.from('first'));
    await service.addFile('test:secret:three', 'notes.txt', Buffer.from('second'));
    const files = await service.listFiles('test:secret:three');

    expect(files).toHaveLength(1);
    expect(files[0].filename).toBe('notes.txt');
    expect(files[0].size).toBe(Buffer.from('second').length);
    expect(files[0].createdAt).toBe(START_TIME + 1000);

    await cleanup();
  });

  it('rebuilds state from the event log', async () => {
    const { service, dir, cleanup } = await createTestService(START_TIME);

    await service.addFile('test:secret:four', 'a.txt', Buffer.from('alpha'));
    await service.addFile('test:secret:four', 'b.txt', Buffer.from('beta'));
    await service.deleteFile('test:secret:four', 'a.txt');

    const reconstructedStorage = new FilesystemStorageBackend(dir);
    const reconstructed = createFileService({
      log: createLog(reconstructedStorage, defaultPathMapper),
      crypto: createCryptoOperations(),
      now: () => START_TIME,
    });

    const files = await reconstructed.listFiles('test:secret:four');

    expect(files).toHaveLength(1);
    expect(files[0].filename).toBe('b.txt');

    await cleanup();
  });

  it('isolates file spaces between different secrets', async () => {
    const { service, cleanup } = await createTestService(START_TIME);

    await service.addFile('test:secret:five', 'shared.txt', Buffer.from('one'));
    const filesSecretA = await service.listFiles('test:secret:five');
    const filesSecretB = await service.listFiles('test:secret:six');

    expect(filesSecretA).toHaveLength(1);
    expect(filesSecretB).toHaveLength(0);

    await cleanup();
  });

  it('computes snapshots on demand', async () => {
    const { service, cleanup } = await createTestService(START_TIME);
    const secret = 'test:secret:snapshot';

    await service.addFile(secret, 'snap.txt', Buffer.from('snap'));
    const summary = await service.computeSnapshot(secret);

    expect(summary.eventCount).toBe(1);
    expect(summary.fileCount).toBe(1);
    expect(summary.generatedAt).toBe(START_TIME + 1000);
    expect(summary.lastEventHash).toMatch(/^[0-9a-f]{64}$/);

    await cleanup();
  });

  it('returns a deterministic timeline for playback UIs', async () => {
    const { service, cleanup } = await createTestService(START_TIME);
    const secret = 'test:secret:timeline';

    await service.addFile(secret, 'a.txt', Buffer.from('a'));
    await service.addFile(secret, 'b.txt', Buffer.from('b'));
    await service.deleteFile(secret, 'a.txt');

    const timeline = await service.getTimeline(secret);

    expect(timeline).toHaveLength(3);
    expect(timeline[0].type).toBe('CREATE_FILE');
    expect(timeline[1].type).toBe('CREATE_FILE');
    expect(timeline[2].type).toBe('DELETE_FILE');
    expect(timeline[0].timestamp).toBe(START_TIME);
    expect(timeline[1].timestamp).toBe(START_TIME + 1000);
    expect(timeline[2].timestamp).toBe(START_TIME + 2000);

    await cleanup();
  });

  it('returns only newer timeline events after a hash cursor', async () => {
    const { service, cleanup } = await createTestService(START_TIME);
    const secret = 'test:secret:timeline-delta';

    await service.addFile(secret, 'a.txt', Buffer.from('a'));
    await service.addFile(secret, 'b.txt', Buffer.from('b'));
    await service.deleteFile(secret, 'a.txt');

    const timeline = await service.getTimeline(secret);
    const delta = await service.getTimelineDelta(secret, timeline[0].eventHash);

    expect(delta.reset).toBe(false);
    expect(delta.acceptedCursor).toBe(timeline[0].eventHash);
    expect(delta.nextCursor).toBe(timeline[2].eventHash);
    expect(delta.totalEventCount).toBe(3);
    expect(delta.events).toHaveLength(2);
    expect(delta.events.map((event) => event.type)).toEqual(['CREATE_FILE', 'DELETE_FILE']);

    await cleanup();
  });

  it('falls back to a full replay when the hash cursor is unknown', async () => {
    const { service, cleanup } = await createTestService(START_TIME);
    const secret = 'test:secret:timeline-delta-reset';

    await service.addFile(secret, 'a.txt', Buffer.from('a'));
    await service.addFile(secret, 'b.txt', Buffer.from('b'));

    const delta = await service.getTimelineDelta(secret, 'deadbeef');

    expect(delta.reset).toBe(true);
    expect(delta.acceptedCursor).toBeNull();
    expect(delta.requestedCursor).toBe('deadbeef');
    expect(delta.events).toHaveLength(2);
    expect(delta.totalEventCount).toBe(2);

    await cleanup();
  });

  it('renames a folder prefix across all nested files', async () => {
    const { service, cleanup } = await createTestService(START_TIME);
    const secret = 'test:secret:rename-folder';

    await service.addFile(secret, 'photos/a.jpg', Buffer.from('a'));
    await service.addFile(secret, 'photos/2024/b.jpg', Buffer.from('b'));
    await service.addFile(secret, 'notes/todo.txt', Buffer.from('todo'));

    const renamed = await service.renameFolder(secret, 'photos', 'archive/photos');
    const files = await service.listFiles(secret);
    const names = files.map((file) => file.filename).sort((left, right) => left.localeCompare(right));

    expect(renamed.fromFolder).toBe('photos');
    expect(renamed.toFolder).toBe('archive/photos');
    expect(renamed.movedFiles).toBe(2);
    expect(renamed.mergedConflicts).toBe(0);
    expect(names).toEqual(['archive/photos/2024/b.jpg', 'archive/photos/a.jpg', 'notes/todo.txt']);

    await cleanup();
  });

  it('renames a single file with a first-class rename event', async () => {
    const { service, cleanup } = await createTestService(START_TIME);
    const secret = 'test:secret:rename-file';

    await service.addFile(secret, 'draft.txt', Buffer.from('hello'));

    const renamed = await service.renameFile(secret, 'draft.txt', 'final.txt');
    const files = await service.listFiles(secret);
    const timeline = await service.getTimeline(secret);

    expect(renamed.fromName).toBe('draft.txt');
    expect(renamed.toName).toBe('final.txt');
    expect(files).toHaveLength(1);
    expect(files[0].filename).toBe('final.txt');
    expect(timeline.at(-1)?.type).toBe('RENAME_FILE');
    expect(timeline.at(-1)?.filename).toBe('draft.txt');
    expect(timeline.at(-1)?.toFilename).toBe('final.txt');

    await cleanup();
  });

  it('requires merge when destination folder already contains files', async () => {
    const { service, cleanup } = await createTestService(START_TIME);
    const secret = 'test:secret:rename-merge';

    await service.addFile(secret, 'src/a.txt', Buffer.from('src-version'));
    await service.addFile(secret, 'dst/a.txt', Buffer.from('dst-version'));

    await expect(service.renameFolder(secret, 'src', 'dst')).rejects.toThrow(
      'Destination folder already contains 1 file(s). Retry with merge enabled.'
    );

    const renamed = await service.renameFolder(secret, 'src', 'dst', { merge: true });
    const files = await service.listFiles(secret);
    const moved = files.find((file) => file.filename === 'dst/a.txt');

    expect(renamed.movedFiles).toBe(1);
    expect(renamed.mergedConflicts).toBe(1);
    expect(files.some((file) => file.filename.startsWith('src/'))).toBe(false);
    expect(moved).toBeDefined();

    const payload = await service.getFile(secret, moved!.blobHash);
    expect(payload.toString('utf8')).toBe('src-version');

    await cleanup();
  });

  it('includes legacy log events without metadata in timeline replay', async () => {
    const { service, dir, cleanup } = await createTestService(START_TIME);
    const secret = 'test:secret:legacy';
    const crypto = createCryptoOperations();
    const storage = new FilesystemStorageBackend(dir);
    const channelStorage = createLog(storage, defaultPathMapper);

    await storeData(
      new Uint8Array(Buffer.from('legacy-file')),
      'legacy.txt',
      createSecret(secret),
      crypto,
      channelStorage
    );

    const timeline = await service.getTimeline(secret);
    expect(timeline).toHaveLength(1);
    expect(timeline[0].type).toBe('CREATE_FILE');
    expect(timeline[0].filename).toBe('legacy.txt');

    const files = await service.listFiles(secret);
    expect(files).toHaveLength(1);
    expect(files[0].filename).toBe('legacy.txt');

    await cleanup();
  });

  it('stores new files with wrapped FEKs and decrypts them', async () => {
    const { service, dir, cleanup } = await createTestService(START_TIME);
    const secret = 'test:secret:fek-modern';

    const created = await service.addFile(secret, 'wrapped.txt', Buffer.from('wrapped payload'));
    const entries = await loadEntries(dir, secret);
    const payload = entries[0].signedEvent.payload;
    const decrypted = await service.getFile(secret, created.blobHash);

    expect(payload.contentType).toBe('b');
    expect(payload.encryptedKey.length).toBeGreaterThan(0);
    expect(decrypted.toString('utf8')).toBe('wrapped payload');

    await cleanup();
  });

  it('upgrades legacy volume-key files when exporting source references', async () => {
    const { service, dir, cleanup } = await createTestService(START_TIME);
    const secret = 'test:secret:legacy-upgrade';

    await appendLegacyVolumeKeyFile(dir, secret, 'legacy-upgrade.txt', Buffer.from('legacy-data'), START_TIME);

    const exported = await service.exportSourceReferences(secret, ['legacy-upgrade.txt']);
    const files = await service.listFiles(secret);
    const entries = await loadEntries(dir, secret);

    expect(exported.upgradedCount).toBe(1);
    expect(exported.bundle.items).toHaveLength(1);
    expect(exported.bundle.items[0].ref.x.length).toBeGreaterThan(0);
    expect(files).toHaveLength(1);
    expect(entries).toHaveLength(2);
    const upgradedEvent = entries.find((entry) => entry.signedEvent.payload.encryptedKey.length > 0);
    expect(upgradedEvent).toBeDefined();
    expect(upgradedEvent?.signedEvent.payload.contentType).toBe('b');

    await cleanup();
  });

  it('exports and imports source references across volumes without rewriting blobs', async () => {
    const { service, dir, cleanup } = await createTestService(START_TIME);
    const sourceSecret = 'test:secret:source-copy';
    const destinationSecret = 'test:secret:destination-copy';

    const sourceCreated = await service.addFile(sourceSecret, 'share.txt', Buffer.from('shared payload'));
    const exported = await service.exportSourceReferences(sourceSecret, ['share.txt']);
    const imported = await service.importSourceReferences(destinationSecret, exported.bundle, sourceSecret);
    const destinationFiles = await service.listFiles(destinationSecret);
    const destinationEntries = await loadEntries(dir, destinationSecret);
    const decrypted = await service.getFile(destinationSecret, destinationFiles[0].blobHash);

    expect(imported.imported).toHaveLength(1);
    expect(destinationFiles).toHaveLength(1);
    expect(destinationFiles[0].filename).toBe('share.txt');
    expect(destinationFiles[0].blobHash).toBe(sourceCreated.blobHash);
    expect(destinationEntries[0].signedEvent.payload.encryptedKey.length).toBeGreaterThan(0);
    expect(decrypted.toString('utf8')).toBe('shared payload');

    await cleanup();
  });

  it('copies referenced encrypted blocks into new destination locations during source-reference import', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nearbytes-file-service-mr-'));
    const mainRoot = join(dir, 'main');
    const backupRoot = join(dir, 'backup');
    await mkdir(mainRoot, { recursive: true });
    await mkdir(backupRoot, { recursive: true });

    const sourceSecret = 'test:secret:source-mr-copy';
    const destinationSecret = 'test:secret:destination-mr-copy';
    const crypto = createCryptoOperations();
    const now = createNow(START_TIME);

    const destinationKeyPair = await crypto.deriveKeys(createSecret(destinationSecret));
    const destinationVolumeId = Buffer.from(destinationKeyPair.publicKey).toString('hex');
    const storage = new MultiRootStorageBackend(
      createMultiRootConfig(mainRoot, backupRoot, [destinationVolumeId])
    );
    const service = createFileService({ log: createLog(storage, defaultPathMapper), crypto, now });

    const created = await service.addFile(sourceSecret, 'share.txt', Buffer.from('shared payload'));
    const exported = await service.exportSourceReferences(sourceSecret, ['share.txt']);
    await service.importSourceReferences(destinationSecret, exported.bundle, sourceSecret);

    expect(await readFile(join(backupRoot, 'blocks', `${created.blobHash}.bin`))).toBeDefined();
    expect((await service.getFile(destinationSecret, created.blobHash)).toString('utf8')).toBe('shared payload');

    await rm(dir, { recursive: true, force: true });
  });

  it('auto-renames conflicting pasted files with Finder-style copy suffixes', async () => {
    const { service, cleanup } = await createTestService(START_TIME);
    const sourceSecret = 'test:secret:source-conflict';
    const destinationSecret = 'test:secret:destination-conflict';

    await service.addFile(sourceSecret, 'notes.txt', Buffer.from('source version'));
    await service.addFile(destinationSecret, 'notes.txt', Buffer.from('destination version'));

    const exported = await service.exportSourceReferences(sourceSecret, ['notes.txt']);
    await service.importSourceReferences(destinationSecret, exported.bundle, sourceSecret);

    const files = await service.listFiles(destinationSecret);
    const names = files.map((file) => file.filename).sort((left, right) => left.localeCompare(right));
    const copied = files.find((file) => file.filename === 'notes copy.txt');

    expect(names).toEqual(['notes copy.txt', 'notes.txt']);
    expect(copied).toBeDefined();
    expect((await service.getFile(destinationSecret, copied!.blobHash)).toString('utf8')).toBe('source version');

    await cleanup();
  });

  it('exports and imports recipient-bound references only into the targeted volume', async () => {
    const { service, dir, cleanup } = await createTestService(START_TIME);
    const sourceSecret = 'test:secret:recipient-source';
    const recipientSecret = 'test:secret:recipient-target';
    const otherSecret = 'test:secret:recipient-other';

    await service.addFile(sourceSecret, 'sealed.txt', Buffer.from('recipient payload'));
    const recipientVolumeId = await getVolumeId(dir, recipientSecret);
    const exported = await service.exportRecipientReferences(sourceSecret, ['sealed.txt'], recipientVolumeId);

    await expect(service.importRecipientReferences(otherSecret, exported.bundle)).rejects.toThrow(
      'Recipient reference bundle does not match the active volume'
    );

    const imported = await service.importRecipientReferences(recipientSecret, exported.bundle);
    const files = await service.listFiles(recipientSecret);

    expect(imported.imported).toHaveLength(1);
    expect(files).toHaveLength(1);
    expect(files[0].filename).toBe('sealed.txt');
    expect((await service.getFile(recipientSecret, files[0].blobHash)).toString('utf8')).toBe('recipient payload');

    await cleanup();
  });
});

async function createTestService(startTime: number): Promise<{
  service: ReturnType<typeof createFileService>;
  dir: string;
  cleanup: () => Promise<void>;
}> {
  const dir = await mkdtemp(join(tmpdir(), 'nearbytes-file-service-'));
  const storage = new FilesystemStorageBackend(dir);
  const crypto = createCryptoOperations();
  const now = createNow(startTime);
  const service = createFileService({ log: createLog(storage, defaultPathMapper), crypto, now });

  return {
    service,
    dir,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

function createNow(start: number): () => number {
  let current = start;
  return () => {
    const value = current;
    current += 1000;
    return value;
  };
}

async function loadEntries(dir: string, secret: string) {
  const crypto = createCryptoOperations();
  const storage = new FilesystemStorageBackend(dir);
  const channelStorage = createLog(storage, defaultPathMapper);
  const volume = await openVolume(createSecret(secret), crypto);
  return loadEventLog(volume, channelStorage, crypto);
}

async function getVolumeId(_dir: string, secret: string): Promise<string> {
  const crypto = createCryptoOperations();
  const volume = await openVolume(createSecret(secret), crypto);
  return Buffer.from(volume.publicKey).toString('hex');
}

async function appendLegacyVolumeKeyFile(
  dir: string,
  secret: string,
  filename: string,
  data: Buffer,
  createdAt: number
): Promise<void> {
  const crypto = createCryptoOperations();
  const storage = new FilesystemStorageBackend(dir);
  const channelStorage = createLog(storage, defaultPathMapper);
  const normalizedSecret = createSecret(secret);
  const volume = await openVolume(normalizedSecret, crypto);
  const keyPair = await crypto.deriveKeys(normalizedSecret);
  const symmetricKey = await crypto.deriveSymKey(keyPair.privateKey);
  const encryptedData = await crypto.encryptSym(data, symmetricKey);
  const blobHash = await crypto.computeHash(encryptedData);
  await channelStorage.blocks.store(blobHash, encryptedData, true, keyPair.publicKey);

  const payload = {
    type: EventType.CREATE_FILE,
    fileName: filename,
    hash: blobHash,
    encryptedKey: createEncryptedData(new Uint8Array(0)),
    size: data.length,
    createdAt,
  } as const;
  const storedEvent = await createSignedEvent(crypto, keyPair, payload, [payload.hash]);
  await channelStorage.events.storeEvent(volume.publicKey, storedEvent);
}

function createMultiRootConfig(mainRoot: string, backupRoot: string, volumeIds: readonly string[]): RootsConfig {
  return {
    version: 2,
    sources: [
      {
        id: 'src-main',
        provider: 'local',
        path: mainRoot,
        enabled: true,
        writable: true,
        reservePercent: 5,
        opportunisticPolicy: 'drop-older-blocks',
      },
      {
        id: 'src-backup',
        provider: 'dropbox',
        path: backupRoot,
        enabled: true,
        writable: true,
        reservePercent: 5,
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
          reservePercent: 5,
          fullPolicy: 'block-writes',
        },
      ],
    },
    volumes: volumeIds.map((volumeId) => ({
      volumeId,
      destinations: [
        {
          sourceId: 'src-backup',
          enabled: true,
          storeEvents: true,
          storeBlocks: true,
          copySourceBlocks: true,
          reservePercent: 5,
          fullPolicy: 'block-writes',
        },
      ],
    })),
  };
}
