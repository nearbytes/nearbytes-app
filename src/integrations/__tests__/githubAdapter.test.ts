import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { GitHubTransportAdapter } from '../github.js';
import { createIntegrationRuntime, type ProviderSecretStore } from '../runtime.js';
import type { ManagedShare } from '../types.js';

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

function createFakeGitHubFetch(state: {
  tokenPolls: number;
  openedUploads: string[];
  blobs: Map<string, Uint8Array>;
  pathsToSha: Map<string, string>;
  nextBlobId: number;
}): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const parsed = new URL(url);

    if (parsed.hostname === 'github.com' && parsed.pathname === '/login/device/code') {
      return jsonResponse({
        device_code: 'device-code',
        user_code: 'CODE-1234',
        verification_uri: 'https://github.com/login/device',
        expires_in: 900,
        interval: 1,
      });
    }

    if (parsed.hostname === 'github.com' && parsed.pathname === '/login/oauth/access_token') {
      state.tokenPolls += 1;
      return jsonResponse({
        access_token: 'github-access-token',
        token_type: 'bearer',
        scope: 'repo read:user user:email',
      });
    }

    if (parsed.hostname === 'api.github.com' && parsed.pathname === '/user') {
      return jsonResponse({
        login: 'octocat',
        name: 'Octo Cat',
        email: null,
      });
    }

    if (parsed.hostname === 'api.github.com' && parsed.pathname === '/user/emails') {
      return jsonResponse([
        {
          email: 'octo@example.com',
          primary: true,
          verified: true,
        },
      ]);
    }

    if (parsed.hostname === 'api.github.com' && parsed.pathname === '/repos/nearbytes/demo-repo') {
      return jsonResponse({
        full_name: 'nearbytes/demo-repo',
        default_branch: 'main',
      });
    }

    if (parsed.hostname === 'api.github.com' && parsed.pathname === '/repos/nearbytes/demo-repo/branches/main') {
      return jsonResponse({
        commit: {
          commit: {
            tree: {
              sha: 'tree-main',
            },
          },
        },
      });
    }

    if (parsed.hostname === 'api.github.com' && parsed.pathname === '/repos/nearbytes/demo-repo/git/trees/tree-main') {
      return jsonResponse({
        tree: Array.from(state.pathsToSha.entries()).map(([repoPath, sha]) => ({
          path: repoPath,
          type: 'blob',
          size: state.blobs.get(sha)?.byteLength ?? 0,
          sha,
        })),
      });
    }

    if (parsed.hostname === 'api.github.com' && parsed.pathname.startsWith('/repos/nearbytes/demo-repo/git/blobs/')) {
      const sha = parsed.pathname.split('/').at(-1) ?? '';
      const blob = state.blobs.get(sha);
      if (!blob) {
        return jsonResponse({ message: 'Not found' }, 404);
      }
      return jsonResponse({
        content: Buffer.from(blob).toString('base64'),
        encoding: 'base64',
      });
    }

    if (
      parsed.hostname === 'api.github.com' &&
      parsed.pathname.startsWith('/repos/nearbytes/demo-repo/contents/') &&
      init?.method === 'PUT'
    ) {
      const repoPath = decodeURIComponent(parsed.pathname.replace('/repos/nearbytes/demo-repo/contents/', ''));
      const payload = JSON.parse(String(init.body ?? '{}')) as { content?: string };
      const blob = Buffer.from(payload.content ?? '', 'base64');
      const sha = `blob-${state.nextBlobId++}`;
      state.blobs.set(sha, blob);
      state.pathsToSha.set(repoPath, sha);
      state.openedUploads.push(repoPath);
      return jsonResponse({ content: { path: repoPath, sha } });
    }

    throw new Error(`Unhandled fake GitHub request: ${url}`);
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

describe('GitHubTransportAdapter', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((tempDir) => fs.rm(tempDir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it('completes device auth and syncs a repo-backed share', async () => {
    const remoteExistingSha = 'blob-remote-existing';
    const githubState = {
      tokenPolls: 0,
      openedUploads: [] as string[],
      blobs: new Map<string, Uint8Array>([
        [remoteExistingSha, Buffer.from('from-remote', 'utf8')],
      ]),
      pathsToSha: new Map<string, string>([
        ['nearbytes/alpha/channels/room/remote.bin', remoteExistingSha],
      ]),
      nextBlobId: 1,
    };
    const openedUrls: string[] = [];
    let now = 1_700_000_000_000;
    const runtime = createIntegrationRuntime({
      secretStore: createMemorySecretStore(),
      openExternalUrl: async (url) => {
        openedUrls.push(url);
      },
      now: () => now,
      github: {
        syncIntervalMs: 60_000,
      },
      logger: {
        log() {},
        warn() {},
      },
    });
    const adapter = new GitHubTransportAdapter(runtime, createFakeGitHubFetch(githubState));

    const setupBefore = await adapter.getSetupState();
    expect(setupBefore.status).toBe('needs-config');

    await adapter.configure({
      provider: 'github',
      clientId: 'github-client-id',
    });
    const setupAfter = await adapter.getSetupState();
    expect(setupAfter.status).toBe('ready');
    expect(setupAfter.config?.clientId).toBe('github-client-id');

    const pending = await adapter.connect({
      provider: 'github',
      accountId: 'acct-github-1',
      label: 'GitHub',
    });
    expect(pending.status).toBe('pending');
    expect(openedUrls).toEqual(['https://github.com/login/device']);

    now += 1_500;
    const connected = await adapter.connect({
      provider: 'github',
      authSessionId: pending.authSession!.id,
    });
    expect(connected.status).toBe('connected');
    expect(connected.account?.label).toBe('Octo Cat');
    expect(connected.account?.email).toBe('octo@example.com');
    expect(githubState.tokenPolls).toBe(1);

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nearbytes-github-'));
    tempDirs.push(tempDir);
    await fs.mkdir(path.join(tempDir, 'blocks'), { recursive: true });
    await fs.mkdir(path.join(tempDir, 'channels', 'room'), { recursive: true });
    await fs.writeFile(path.join(tempDir, 'blocks', 'alpha.bin'), 'alpha', 'utf8');

    const remoteShare = await adapter.createManagedShare(
      {
        provider: 'github',
        accountId: 'acct-github-1',
        label: 'Alpha repo share',
        localPath: tempDir,
        remoteDescriptor: {
          repoOwner: 'nearbytes',
          repoName: 'demo-repo',
          branch: 'main',
          basePath: 'nearbytes/alpha',
        },
      },
      connected.account!
    );
    expect(remoteShare.remoteDescriptor?.repoFullName).toBe('nearbytes/demo-repo');

    const share: ManagedShare = {
      id: 'share-github-1',
      provider: 'github',
      accountId: 'acct-github-1',
      label: 'Alpha repo share',
      role: 'owner',
      localPath: tempDir,
      sourceId: 'src-github-managed-1',
      syncMode: 'mirror',
      remoteDescriptor: remoteShare.remoteDescriptor ?? {},
      capabilities: ['mirror', 'read', 'write'],
      invitationEmails: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await adapter.ensureSync(share, connected.account!);
    const state = await adapter.getState(share, connected.account!);
    expect(state.status).toBe('ready');
    expect(githubState.openedUploads).toContain('nearbytes/alpha/blocks/alpha.bin');
    const downloaded = await fs.readFile(path.join(tempDir, 'channels', 'room', 'remote.bin'), 'utf8');
    expect(downloaded).toBe('from-remote');

    await adapter.detachManagedShare(share);
    await adapter.disconnect(connected.account!);
  });
});
