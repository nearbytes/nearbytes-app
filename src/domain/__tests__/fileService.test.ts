import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { createCryptoOperations } from '../../crypto/index.js';
import type { RootsConfig } from '../../config/roots.js';
import { storeData } from '../../domain/operations.js';
import { serializeEventPayload } from '../../storage/serialization.js';
import { ChannelStorage } from '../../storage/channel.js';
import { FilesystemStorageBackend } from '../../storage/filesystem.js';
import { MultiRootStorageBackend } from '../../storage/multiRoot.js';
import { loadEventLog, openVolume } from '../../domain/volume.js';
import { createEncryptedData, EventType } from '../../types/events.js';
import { createSecret } from '../../types/keys.js';
import { defaultPathMapper } from '../../types/storage.js';
import { createFileService } from '../fileService.js';

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

    const reconstructed = createFileService({
      crypto: createCryptoOperations(),
      storage: new FilesystemStorageBackend(dir),
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

  it('computes and persists snapshots on demand', async () => {
    const { service, dir, cleanup } = await createTestService(START_TIME);
    const secret = 'test:secret:snapshot';

    await service.addFile(secret, 'snap.txt', Buffer.from('snap'));
    const summary = await service.computeSnapshot(secret);

    expect(summary.eventCount).toBe(1);
    expect(summary.fileCount).toBe(1);
    expect(summary.generatedAt).toBe(START_TIME + 1000);
    expect(summary.lastEventHash).toMatch(/^[0-9a-f]{64}$/);

    const keyPair = await createCryptoOperations().deriveKeys(createSecret(secret));
    const channelPath = defaultPathMapper(keyPair.publicKey);
    const snapshotPath = join(dir, channelPath, 'snapshot.latest.json');
    const snapshotRaw = await readFile(snapshotPath, 'utf8');
    const snapshot = JSON.parse(snapshotRaw) as {
      version: number;
      files: { filename: string }[];
    };

    expect(snapshot.version).toBe(1);
    expect(snapshot.files).toHaveLength(1);
    expect(snapshot.files[0].filename).toBe('snap.txt');

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
    const channelStorage = new ChannelStorage(storage, defaultPathMapper);

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
    const service = createFileService({ crypto, storage, now });

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
  const service = createFileService({ crypto, storage, now });

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
  const channelStorage = new ChannelStorage(storage, defaultPathMapper);
  const volume = await openVolume(createSecret(secret), crypto, storage, defaultPathMapper);
  return loadEventLog(volume, channelStorage);
}

async function getVolumeId(dir: string, secret: string): Promise<string> {
  const crypto = createCryptoOperations();
  const storage = new FilesystemStorageBackend(dir);
  const volume = await openVolume(createSecret(secret), crypto, storage, defaultPathMapper);
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
  const channelStorage = new ChannelStorage(storage, defaultPathMapper);
  const normalizedSecret = createSecret(secret);
  const volume = await openVolume(normalizedSecret, crypto, storage, defaultPathMapper);
  const keyPair = await crypto.deriveKeys(normalizedSecret);
  const symmetricKey = await crypto.deriveSymKey(keyPair.privateKey);
  const encryptedData = await crypto.encryptSym(data, symmetricKey);
  const blobHash = await crypto.computeHash(encryptedData);
  await channelStorage.storeEncryptedData(blobHash, encryptedData, true, keyPair.publicKey);

  const payload = {
    type: EventType.CREATE_FILE,
    fileName: filename,
    hash: blobHash,
    encryptedKey: createEncryptedData(new Uint8Array(0)),
    size: data.length,
    createdAt,
  } as const;
  const signature = await crypto.signPR(serializeEventPayload(payload), keyPair.privateKey);
  await channelStorage.storeEvent(volume.publicKey, { payload, signature });
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
