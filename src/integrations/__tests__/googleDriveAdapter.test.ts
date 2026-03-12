import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GoogleDriveTransportAdapter } from '../googleDrive.js';
import { createIntegrationRuntime, type ProviderSecretStore } from '../runtime.js';
import type { ManagedShare } from '../types.js';

interface FakeDriveRecord {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  webViewLink?: string;
}

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

function createFakeGoogleFetch(state: {
  records: Map<string, FakeDriveRecord>;
  permissions: Array<{ fileId: string; email: string; role: string }>;
  nextId: number;
}): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const parsed = new URL(url);

    if (parsed.hostname === 'oauth2.googleapis.com' && parsed.pathname === '/token') {
      return jsonResponse({
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        expires_in: 3600,
        token_type: 'Bearer',
      });
    }

    if (parsed.hostname === 'www.googleapis.com' && parsed.pathname === '/upload/drive/v3/files') {
      const text = typeof init?.body === 'string' ? init.body : init?.body instanceof Blob ? await init.body.text() : '';
      const nameMatch = text.match(/"name"\s*:\s*"([^"]+)"/u);
      const parentMatch = text.match(/"parents"\s*:\s*\[\s*"([^"]+)"/u);
      const id = `file-${state.nextId++}`;
      state.records.set(id, {
        id,
        name: nameMatch?.[1] ?? `file-${state.nextId}`,
        mimeType: 'application/octet-stream',
        parents: parentMatch?.[1] ? [parentMatch[1]] : ['root'],
      });
      return jsonResponse({ id });
    }

    if (parsed.pathname === '/drive/v3/about') {
      return jsonResponse({
        user: {
          displayName: 'Drive Owner',
          emailAddress: 'owner@example.com',
        },
      });
    }

    if (parsed.pathname.startsWith('/drive/v3/files/') && parsed.pathname.endsWith('/permissions')) {
      const fileId = parsed.pathname.split('/')[4] ?? '';
      const body = JSON.parse(String(init?.body ?? '{}')) as { emailAddress?: string; role?: string };
      state.permissions.push({
        fileId,
        email: body.emailAddress ?? '',
        role: body.role ?? '',
      });
      return jsonResponse({ id: `perm-${state.permissions.length}` });
    }

    if (parsed.pathname === '/drive/v3/files' && init?.method === 'POST') {
      const metadata = JSON.parse(String(init.body ?? '{}')) as { name: string; mimeType?: string; parents?: string[] };
      const id = `folder-${state.nextId++}`;
      state.records.set(id, {
        id,
        name: metadata.name,
        mimeType: metadata.mimeType ?? 'application/octet-stream',
        parents: metadata.parents ?? ['root'],
        webViewLink: `https://drive.example/${id}`,
      });
      return jsonResponse({ id, name: metadata.name, webViewLink: `https://drive.example/${id}` });
    }

    if (parsed.pathname === '/drive/v3/files' && init?.method !== 'POST') {
      const decodedQuery = decodeURIComponent(parsed.searchParams.get('q') ?? '');
      const parentMatch = decodedQuery.match(/'([^']+)' in parents/u);
      const nameMatch = decodedQuery.match(/name = '([^']+)'/u);
      const mimeMatch = decodedQuery.match(/mimeType = '([^']+)'/u);
      const parentId = parentMatch?.[1] ?? 'root';
      const files = Array.from(state.records.values()).filter(
        (record) =>
          record.parents.includes(parentId) &&
          (!nameMatch || record.name === nameMatch[1]) &&
          (!mimeMatch || record.mimeType === mimeMatch[1])
      );
      return jsonResponse({ files });
    }

    if (parsed.pathname.startsWith('/drive/v3/files/')) {
      const fileId = parsed.pathname.split('/').at(-1) ?? '';
      const record = state.records.get(fileId);
      if (!record) {
        return jsonResponse({ error: { message: 'Not found' } }, 404);
      }
      return jsonResponse(record);
    }

    throw new Error(`Unhandled fake Google request: ${url}`);
  }) as typeof fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

describe('GoogleDriveTransportAdapter', () => {
  const tempDirs: string[] = [];
  const previousGoogleClientId = process.env.NEARBYTES_GOOGLE_CLIENT_ID;
  const previousGoogleClientSecret = process.env.NEARBYTES_GOOGLE_CLIENT_SECRET;

  beforeEach(() => {
    delete process.env.NEARBYTES_GOOGLE_CLIENT_ID;
    delete process.env.NEARBYTES_GOOGLE_CLIENT_SECRET;
  });

  afterEach(async () => {
    await Promise.all(tempDirs.map((tempDir) => fs.rm(tempDir, { recursive: true, force: true })));
    tempDirs.length = 0;
    if (previousGoogleClientId === undefined) {
      delete process.env.NEARBYTES_GOOGLE_CLIENT_ID;
    } else {
      process.env.NEARBYTES_GOOGLE_CLIENT_ID = previousGoogleClientId;
    }
    if (previousGoogleClientSecret === undefined) {
      delete process.env.NEARBYTES_GOOGLE_CLIENT_SECRET;
    } else {
      process.env.NEARBYTES_GOOGLE_CLIENT_SECRET = previousGoogleClientSecret;
    }
  });

  it('completes OAuth, creates folders, invites users, and syncs a local mirror', async () => {
    const driveState = {
      records: new Map<string, FakeDriveRecord>(),
      permissions: [] as Array<{ fileId: string; email: string; role: string }>,
      nextId: 1,
    };
    const openedUrls: string[] = [];
    const runtime = createIntegrationRuntime({
      secretStore: createMemorySecretStore(),
      openExternalUrl: async (url) => {
        openedUrls.push(url);
      },
      google: {
        syncIntervalMs: 60_000,
      },
      logger: {
        log() {},
        warn() {},
      },
    });
    const adapter = new GoogleDriveTransportAdapter(runtime, createFakeGoogleFetch(driveState));
    const setupBefore = await adapter.getSetupState();
    expect(setupBefore.status).toBe('needs-config');
    await adapter.configure({
      provider: 'gdrive',
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
    });
    const setupAfter = await adapter.getSetupState();
    expect(setupAfter.status).toBe('ready');

    const pending = await adapter.connect(
      {
        provider: 'gdrive',
        accountId: 'acct-gdrive-1',
        label: 'Primary Drive',
      },
      { callbackBaseUrl: 'http://127.0.0.1:3010' }
    );
    expect(pending.status).toBe('pending');
    expect(openedUrls).toHaveLength(1);
    const authSession = pending.authSession!;
    const openedUrl = new URL(openedUrls[0]!);

    const callbackHtml = await adapter.handleOAuthCallback(
      new URLSearchParams({
        state: openedUrl.searchParams.get('state') ?? '',
        code: 'oauth-code',
      })
    );
    expect(callbackHtml).toContain('Google Drive is connected');

    const connected = await adapter.connect({
      provider: 'gdrive',
      authSessionId: authSession.id,
    });
    expect(connected.status).toBe('connected');
    const account = connected.account!;
    expect(account.email).toBe('owner@example.com');

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nearbytes-gdrive-'));
    tempDirs.push(tempDir);
    await fs.mkdir(path.join(tempDir, 'blocks'), { recursive: true });
    await fs.mkdir(path.join(tempDir, 'channels', 'room'), { recursive: true });
    await fs.writeFile(path.join(tempDir, 'blocks', 'alpha.bin'), 'alpha', 'utf8');
    await fs.writeFile(path.join(tempDir, 'channels', 'room', 'log.bin'), 'log', 'utf8');

    const remoteShare = await adapter.createManagedShare(
      {
        provider: 'gdrive',
        accountId: account.id,
        label: 'Alpha Mirror',
        localPath: tempDir,
      },
      account
    );
    expect(typeof remoteShare.remoteDescriptor?.folderId).toBe('string');

    const share: ManagedShare = {
      id: 'share-gdrive-1',
      provider: 'gdrive',
      accountId: account.id,
      label: 'Alpha Mirror',
      role: 'owner',
      localPath: tempDir,
      sourceId: 'src-managed-1',
      syncMode: 'mirror',
      remoteDescriptor: remoteShare.remoteDescriptor ?? {},
      capabilities: ['mirror', 'read', 'write', 'invite'],
      invitationEmails: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await adapter.invite(share, { emails: ['peer@example.com'] }, account);
    expect(driveState.permissions).toEqual([
      {
        fileId: String(share.remoteDescriptor.folderId),
        email: 'peer@example.com',
        role: 'writer',
      },
    ]);

    await adapter.ensureSync(share, account);
    const state = await adapter.getState(share, account);
    expect(state.status).toBe('ready');

    const uploadedNames = Array.from(driveState.records.values()).map((record) => record.name).sort();
    expect(uploadedNames).toContain('alpha.bin');
    expect(uploadedNames).toContain('log.bin');

    const accepted = await adapter.acceptInvite(
      {
        provider: 'gdrive',
        accountId: account.id,
        label: 'Joined mirror',
        remoteDescriptor: {
          folderId: share.remoteDescriptor.folderId,
        },
      },
      account
    );
    expect(accepted.remoteDescriptor?.folderId).toBe(share.remoteDescriptor.folderId);

    await adapter.detachManagedShare(share);
  });
});
