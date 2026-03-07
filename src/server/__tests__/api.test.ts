import { randomBytes } from 'crypto';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createCryptoOperations } from '../../crypto/index.js';
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

    app = createApp({
      fileService,
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
});
