import { randomBytes } from 'crypto';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createCryptoOperations } from '../../crypto/index.js';
import { createChatService } from '../../domain/chatService.js';
import { createFileService } from '../../domain/fileService.js';
import { FilesystemStorageBackend } from '../../storage/filesystem.js';
import { createApp } from '../app.js';

const SECRET_OPEN = 'nearbytes-open-secret';
const SECRET_UPLOAD = 'nearbytes-upload-secret';
const SECRET_ISOLATION = 'nearbytes-isolation-secret';
const SECRET_OTHER = 'nearbytes-other-secret';
const SECRET_SNAPSHOT = 'nearbytes-snapshot-secret';
const SECRET_TIMELINE = 'nearbytes-timeline-secret';
const SECRET_RENAME_FOLDER = 'nearbytes-rename-folder-secret';
const SECRET_REFERENCE_SOURCE = 'nearbytes-reference-source-secret';
const SECRET_REFERENCE_DESTINATION = 'nearbytes-reference-destination-secret';
const SECRET_REFERENCE_OTHER = 'nearbytes-reference-other-secret';
const FILE_SECRET_PREFIX = 'nb-file-secret:v1:';

describe('Nearbytes API', () => {
  let tempDir: string;
  let app: ReturnType<typeof createApp>;
  let tokenKey: Uint8Array;

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nearbytes-api-'));
    tokenKey = randomBytes(32);

    const crypto = createCryptoOperations();
    const storage = new FilesystemStorageBackend(tempDir);
    const fileService = createFileService({ crypto, storage });
    const chatService = createChatService({ crypto, storage });

    app = createApp({
      fileService,
      chatService,
      crypto,
      storage,
      tokenKey,
      corsOrigin: true,
      maxUploadBytes: 5 * 1024 * 1024,
    });
  });

  afterAll(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('returns health status', async () => {
    const res = await request(app).get('/health').expect(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('opens a volume and returns a token', async () => {
    const res = await request(app).post('/open').send({ secret: SECRET_OPEN }).expect(200);
    expect(res.body.volumeId).toMatch(/^[0-9a-f]+$/);
    expect(res.body.fileCount).toBe(0);
    expect(res.body.files).toEqual([]);
    expect(res.body.token).toBeTypeOf('string');
  });

  it('uploads, lists, downloads, and deletes files', async () => {
    const openRes = await request(app).post('/open').send({ secret: SECRET_UPLOAD }).expect(200);
    const token = openRes.body.token as string;

    const uploadRes = await request(app)
      .post('/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('hello world'), 'hello.txt')
      .expect(200);

    const created = uploadRes.body.created;
    expect(created.filename).toBe('hello.txt');
    expect(created.blobHash).toBeTypeOf('string');
    expect(created.size).toBe(11);

    const listRes = await request(app)
      .get('/files')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(listRes.body.files).toHaveLength(1);
    expect(listRes.body.files[0].blobHash).toBe(created.blobHash);

    const downloadRes = await request(app)
      .get(`/file/${created.blobHash}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // For text/plain responses, supertest returns body as string
    // Check both body and text properties
    let bodyText: string;
    if (typeof downloadRes.body === 'string') {
      bodyText = downloadRes.body;
    } else if (downloadRes.body instanceof Buffer) {
      bodyText = downloadRes.body.toString('utf8');
    } else {
      // Try accessing the text property directly
      const response = downloadRes as any;
      bodyText = response.text || response.body?.toString() || String(response.body);
    }
    
    expect(bodyText).toBe('hello world');
    expect(downloadRes.headers['content-disposition']).toContain('hello.txt');

    await request(app)
      .delete(`/files/${encodeURIComponent('hello.txt')}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const emptyList = await request(app)
      .get('/files')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(emptyList.body.files).toHaveLength(0);
  });

  it('renames folders and supports merge mode', async () => {
    const openRes = await request(app).post('/open').send({ secret: SECRET_RENAME_FOLDER }).expect(200);
    const token = openRes.body.token as string;

    await request(app)
      .post('/upload')
      .set('Authorization', `Bearer ${token}`)
      .field('filename', 'alpha/a.txt')
      .attach('file', Buffer.from('alpha-payload'), 'a.txt')
      .expect(200);

    await request(app)
      .post('/upload')
      .set('Authorization', `Bearer ${token}`)
      .field('filename', 'beta/a.txt')
      .attach('file', Buffer.from('beta-payload'), 'a.txt')
      .expect(200);

    await request(app)
      .post('/folders/rename')
      .set('Authorization', `Bearer ${token}`)
      .send({ from: 'alpha', to: 'beta' })
      .expect(500);

    const renameRes = await request(app)
      .post('/folders/rename')
      .set('Authorization', `Bearer ${token}`)
      .send({ from: 'alpha', to: 'beta', merge: true })
      .expect(200);

    expect(renameRes.body.renamed.movedFiles).toBe(1);
    expect(renameRes.body.renamed.mergedConflicts).toBe(1);

    const listRes = await request(app)
      .get('/files')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(listRes.body.files.some((file: { filename: string }) => file.filename.startsWith('alpha/'))).toBe(
      false
    );
    const moved = listRes.body.files.find((file: { filename: string }) => file.filename === 'beta/a.txt');
    expect(moved).toBeDefined();

    const downloadRes = await request(app)
      .get(`/file/${moved.blobHash as string}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const downloaded =
      typeof downloadRes.body === 'string'
        ? downloadRes.body
        : downloadRes.body instanceof Buffer
          ? downloadRes.body.toString('utf8')
          : (downloadRes as any).text || '';

    expect(downloaded).toBe('alpha-payload');
  });

  it('renames a single file', async () => {
    const openRes = await request(app).post('/open').send({ secret: SECRET_RENAME_FOLDER }).expect(200);
    const token = openRes.body.token as string;

    await request(app)
      .post('/upload')
      .set('Authorization', `Bearer ${token}`)
      .field('filename', 'draft.txt')
      .attach('file', Buffer.from('rename-me'), 'draft.txt')
      .expect(200);

    const renameRes = await request(app)
      .post('/files/rename')
      .set('Authorization', `Bearer ${token}`)
      .send({ from: 'draft.txt', to: 'final.txt' })
      .expect(200);

    expect(renameRes.body.renamed.fromName).toBe('draft.txt');
    expect(renameRes.body.renamed.toName).toBe('final.txt');

    const listRes = await request(app)
      .get('/files')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(listRes.body.files.some((file: { filename: string }) => file.filename === 'draft.txt')).toBe(false);
    expect(listRes.body.files.some((file: { filename: string }) => file.filename === 'final.txt')).toBe(true);
  });

  it('rejects wrong secrets and isolates volumes', async () => {
    const openRes = await request(app)
      .post('/open')
      .send({ secret: SECRET_ISOLATION })
      .expect(200);
    const token = openRes.body.token as string;

    const uploadRes = await request(app)
      .post('/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('secret data'), 'secret.txt')
      .expect(200);

    const blobHash = uploadRes.body.created.blobHash as string;

    const otherOpen = await request(app)
      .post('/open')
      .send({ secret: SECRET_OTHER })
      .expect(200);
    const otherToken = otherOpen.body.token as string;

    const otherList = await request(app)
      .get('/files')
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(200);

    expect(otherList.body.files).toHaveLength(0);

    const badDownload = await request(app)
      .get(`/file/${blobHash}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(401);

    expect(badDownload.body.error.code).toBe('UNAUTHORIZED');
  });

  it('computes snapshots on demand', async () => {
    const openRes = await request(app).post('/open').send({ secret: SECRET_SNAPSHOT }).expect(200);
    const token = openRes.body.token as string;

    await request(app)
      .post('/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('snapshot payload'), 'snapshot.txt')
      .expect(200);

    const snapshotRes = await request(app)
      .post('/snapshot')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(snapshotRes.body.snapshot).toBeDefined();
    expect(snapshotRes.body.snapshot.fileCount).toBe(1);
    expect(snapshotRes.body.snapshot.eventCount).toBe(1);
    expect(snapshotRes.body.snapshot.generatedAt).toBeTypeOf('number');
    expect(snapshotRes.body.snapshot.lastEventHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns timeline events in chronological order', async () => {
    const openRes = await request(app).post('/open').send({ secret: SECRET_TIMELINE }).expect(200);
    const token = openRes.body.token as string;

    await request(app)
      .post('/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('alpha'), 'a.txt')
      .expect(200);

    await request(app)
      .post('/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('beta'), 'b.txt')
      .expect(200);

    await request(app)
      .delete(`/files/${encodeURIComponent('a.txt')}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const timelineRes = await request(app)
      .get('/timeline')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(timelineRes.body.eventCount).toBe(3);
    expect(timelineRes.body.events).toHaveLength(3);
    expect(timelineRes.body.events[0].type).toBe('CREATE_FILE');
    expect(timelineRes.body.events[1].type).toBe('CREATE_FILE');
    expect(timelineRes.body.events[2].type).toBe('DELETE_FILE');
    expect(timelineRes.body.events[0].timestamp).toBeLessThanOrEqual(
      timelineRes.body.events[1].timestamp
    );
    expect(timelineRes.body.events[1].timestamp).toBeLessThanOrEqual(
      timelineRes.body.events[2].timestamp
    );
  });

  it('exports and imports source-bound references through the API', async () => {
    const sourceOpen = await request(app).post('/open').send({ secret: SECRET_REFERENCE_SOURCE }).expect(200);
    const sourceToken = sourceOpen.body.token as string;

    await request(app)
      .post('/upload')
      .set('Authorization', `Bearer ${sourceToken}`)
      .attach('file', Buffer.from('source-reference-payload'), 'copy-me.txt')
      .expect(200);

    const exportRes = await request(app)
      .post('/references/source/export')
      .set('Authorization', `Bearer ${sourceToken}`)
      .send({ filenames: ['copy-me.txt'] })
      .expect(200);

    expect(exportRes.body.bundle.p).toBe('nb.src.refs.v1');
    expect(exportRes.body.bundle.items).toHaveLength(1);
    expect(exportRes.body.serialized).toContain('nb.src.refs.v1');

    const destinationOpen = await request(app)
      .post('/open')
      .send({ secret: SECRET_REFERENCE_DESTINATION })
      .expect(200);
    const destinationToken = destinationOpen.body.token as string;

    const importRes = await request(app)
      .post('/references/source/import')
      .set('Authorization', `Bearer ${destinationToken}`)
      .send({
        sourceSecret: SECRET_REFERENCE_SOURCE,
        bundle: exportRes.body.bundle,
      })
      .expect(200);

    expect(importRes.body.importedCount).toBe(1);
    expect(importRes.body.imported[0].filename).toBe('copy-me.txt');

    const listRes = await request(app)
      .get('/files')
      .set('Authorization', `Bearer ${destinationToken}`)
      .expect(200);

    expect(listRes.body.files).toHaveLength(1);
    expect(listRes.body.files[0].filename).toBe('copy-me.txt');
  });

  it('rejects recipient-bound imports into the wrong destination volume', async () => {
    const sourceOpen = await request(app).post('/open').send({ secret: SECRET_REFERENCE_SOURCE }).expect(200);
    const sourceToken = sourceOpen.body.token as string;

    const uploadRes = await request(app)
      .post('/upload')
      .set('Authorization', `Bearer ${sourceToken}`)
      .attach('file', Buffer.from('recipient-reference-payload'), 'targeted.txt')
      .expect(200);

    const destinationOpen = await request(app)
      .post('/open')
      .send({ secret: SECRET_REFERENCE_DESTINATION })
      .expect(200);
    const destinationToken = destinationOpen.body.token as string;
    const destinationVolumeId = destinationOpen.body.volumeId as string;

    const exportRes = await request(app)
      .post('/references/recipient/export')
      .set('Authorization', `Bearer ${sourceToken}`)
      .send({
        filenames: ['targeted.txt'],
        recipientVolumeId: destinationVolumeId,
      })
      .expect(200);

    expect(exportRes.body.bundle.p).toBe('nb.refs.v1');
    expect(exportRes.body.bundle.items[0].ref.c.h).toBe(uploadRes.body.created.blobHash);

    const otherOpen = await request(app)
      .post('/open')
      .send({ secret: SECRET_REFERENCE_OTHER })
      .expect(200);
    const otherToken = otherOpen.body.token as string;

    await request(app)
      .post('/references/recipient/import')
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ bundle: exportRes.body.bundle })
      .expect(500);

    const importRes = await request(app)
      .post('/references/recipient/import')
      .set('Authorization', `Bearer ${destinationToken}`)
      .send({ bundle: exportRes.body.bundle })
      .expect(200);

    expect(importRes.body.importedCount).toBe(1);
  });

  it('returns compact bearer tokens for file-backed secrets', async () => {
    const payloadBytes = Buffer.alloc(24 * 1024, 0x61);
    const fileBackedSecret = `${FILE_SECRET_PREFIX}${payloadBytes.toString('base64url')}`;

    const openRes = await request(app)
      .post('/open')
      .send({ secret: fileBackedSecret })
      .expect(200);

    const token = openRes.body.token as string;
    expect(token).toBeTypeOf('string');
    expect(token.length).toBeLessThan(128);

    const listRes = await request(app)
      .get('/files')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(Array.isArray(listRes.body.files)).toBe(true);
  });

  it('publishes signed identities and chat messages through the API', async () => {
    const volumeSecret = 'nearbytes-chat-volume-secret';
    const identitySecret = 'nearbytes-chat-identity-secret';

    const openRes = await request(app).post('/open').send({ secret: volumeSecret }).expect(200);
    const token = openRes.body.token as string;

    const identityRes = await request(app)
      .post('/chat/identities')
      .set('Authorization', `Bearer ${token}`)
      .send({
        identitySecret,
        profile: {
          displayName: 'Ada',
          bio: 'Volume chat sender',
        },
      })
      .expect(200);

    expect(identityRes.body.published.record.profile.displayName).toBe('Ada');

    await request(app)
      .post('/upload')
      .set('Authorization', `Bearer ${token}`)
      .field('filename', 'chat.txt')
      .attach('file', Buffer.from('chat attachment'), 'chat.txt')
      .expect(200);

    const exportRes = await request(app)
      .post('/references/source/export')
      .set('Authorization', `Bearer ${token}`)
      .send({ filenames: ['chat.txt'] })
      .expect(200);

    const item = exportRes.body.bundle.items[0];

    const messageRes = await request(app)
      .post('/chat/messages')
      .set('Authorization', `Bearer ${token}`)
      .send({
        identitySecret,
        body: 'hello',
        attachment: {
          kind: 'nb.src.ref.v1',
          name: item.name,
          mime: item.mime,
          createdAt: item.createdAt,
          ref: item.ref,
        },
      })
      .expect(200);

    expect(messageRes.body.sent.message.body).toBe('hello');

    const chatRes = await request(app)
      .get('/chat')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(chatRes.body.identities).toHaveLength(1);
    expect(chatRes.body.messages).toHaveLength(1);
    expect(chatRes.body.messages[0].message.attachment.name).toBe('chat.txt');
  });
});
