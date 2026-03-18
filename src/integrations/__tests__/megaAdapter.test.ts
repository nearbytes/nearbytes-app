import { promises as fs } from 'fs';
import os from 'os';
import path, { basename } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { MegaTransportAdapter } from '../mega.js';
import { MegaHelperInstaller } from '../megaInstaller.js';
import { createIntegrationRuntime, type CommandExecutor, type ProviderSecretStore } from '../runtime.js';
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

function createFakeMegaExecutor(state: {
  sessionToken: string;
  syncs: Array<{ id: string; localPath: string; remotePath: string; runState: string; status: string; error: string }>;
  downloads?: string[][];
  invitedEmails: string[];
  shareCommands: string[][];
  shareListings?: Map<string, string[]>;
  acceptedOwners: string[];
  createdFolders: string[];
  deletedSyncIds: string[];
  findResults: Map<string, string>;
  observedPaths: string[];
  signupCommands?: string[][];
  confirmCommands?: string[][];
  dfStdout?: string;
  dfError?: string;
  syncIssuesDetailStdout?: string;
  loginMode?: 'ok' | 'already-logged-in';
  requireExistingLocalSyncDir?: boolean;
  mkdirAlreadyExistsPaths?: Set<string>;
  mountError?: string;
  mountStdout?: string;
  missingSharePaths?: Set<string>;
}): CommandExecutor {
  return {
    async run(invocation) {
      const rawCommand = basename(invocation.command);
      const args = [...(invocation.args ?? [])];
      const command = rawCommand === 'MegaClient.exe' ? `mega-${args.shift() ?? ''}` : rawCommand;
      if (typeof invocation.env?.PATH === 'string') {
        state.observedPaths.push(invocation.env.PATH);
      }

      if (command === 'mega-login') {
        if (state.loginMode === 'already-logged-in') {
          throw new Error('Already logged in. Please log out first.');
        }
        return { stdout: 'OK\n', stderr: '', exitCode: 0 };
      }
      if (command === 'mega-session') {
        return { stdout: `${state.sessionToken}\n`, stderr: '', exitCode: 0 };
      }
      if (command === 'mega-signup') {
        state.signupCommands ??= [];
        state.signupCommands.push(args);
        return { stdout: 'Signup started\n', stderr: '', exitCode: 0 };
      }
      if (command === 'mega-confirm') {
        state.confirmCommands ??= [];
        state.confirmCommands.push(args);
        return { stdout: 'Account confirmed\n', stderr: '', exitCode: 0 };
      }
      if (command === 'mega-mkdir') {
        const remotePath = args.at(-1) ?? '';
        state.createdFolders.push(remotePath);
        if (state.mkdirAlreadyExistsPaths?.has(remotePath)) {
          return { stdout: '', stderr: `Folder already exists: ${basename(remotePath)}`, exitCode: 1 };
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      }
      if (command === 'mega-invite') {
        state.invitedEmails.push(args[0] ?? '');
        return { stdout: '', stderr: '', exitCode: 0 };
      }
      if (command === 'mega-share') {
        state.shareCommands.push(args);
        if (!args.includes('-a')) {
          const remotePath = args.at(-1) ?? '';
          if (state.missingSharePaths?.has(remotePath)) {
            return {
              stdout: '',
              stderr: `No shared found for given path: ${remotePath}`,
              exitCode: 1,
            };
          }
          return {
            stdout: `${(state.shareListings?.get(remotePath) ?? []).join('\n')}${state.shareListings?.get(remotePath)?.length ? '\n' : ''}`,
            stderr: '',
            exitCode: 0,
          };
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      }
      if (command === 'mega-mount') {
        if (state.mountError) {
          return { stdout: '', stderr: state.mountError, exitCode: 1 };
        }
        return { stdout: state.mountStdout ?? '', stderr: '', exitCode: 0 };
      }
      if (command === 'mega-ipc') {
        state.acceptedOwners.push(args[0] ?? '');
        return { stdout: '', stderr: '', exitCode: 0 };
      }
      if (command === 'mega-find') {
        const shareName = args[1] ?? '';
        const remotePath = state.findResults.get(shareName) ?? '';
        return { stdout: remotePath ? `${remotePath}\n` : '', stderr: '', exitCode: remotePath ? 0 : 1 };
      }
      if (command === 'mega-sync') {
        if (args[0] === '--path-display-size=0') {
          const header = 'ID\tLOCALPATH\tREMOTEPATH\tRUN_STATE\tSTATUS\tERROR\n';
          const rows = state.syncs
            .map((sync) => `${sync.id}\t${sync.localPath}\t${sync.remotePath}\t${sync.runState}\t${sync.status}\t${sync.error}`)
            .join('\n');
          return { stdout: `${header}${rows}\n`, stderr: '', exitCode: 0 };
        }
        if (args[0] === '-d') {
          const syncId = args[1] ?? '';
          state.deletedSyncIds.push(syncId);
          state.syncs = state.syncs.filter((sync) => sync.id !== syncId);
          return { stdout: '', stderr: '', exitCode: 0 };
        }
        const [localPath, remotePath] = args;
        if (state.requireExistingLocalSyncDir && localPath) {
          try {
            const stats = await fs.stat(localPath);
            if (!stats.isDirectory()) {
              return { stdout: '', stderr: `Local directory ${localPath} does not exist`, exitCode: 1 };
            }
          } catch {
            return { stdout: '', stderr: `Local directory ${localPath} does not exist`, exitCode: 1 };
          }
        }
        if (!state.syncs.some((sync) => sync.localPath === localPath)) {
          state.syncs.push({
            id: String(state.syncs.length + 1),
            localPath: localPath ?? '',
            remotePath: remotePath ?? '',
            runState: 'Running',
            status: 'Synced',
            error: '',
          });
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      }
      if (command === 'mega-get') {
        state.downloads ??= [];
        state.downloads.push(args);
        const destination = args.at(-1);
        if (destination) {
          await fs.mkdir(destination, { recursive: true });
          await fs.writeFile(path.join(destination, 'Nearbytes.json'), '{}\n', 'utf8');
        }
        return { stdout: 'Download finished\n', stderr: '', exitCode: 0 };
      }
      if (command === 'mega-logout') {
        return { stdout: '', stderr: '', exitCode: 0 };
      }
      if (command === 'mega-df') {
        if (state.dfError) {
          return {
            stdout: '',
            stderr: state.dfError,
            exitCode: 1,
          };
        }
        return {
          stdout: state.dfStdout ?? 'USED STORAGE: 1048576 bytes of 1073741824 bytes\n',
          stderr: '',
          exitCode: 0,
        };
      }
      if (command === 'mega-sync-issues') {
        return {
          stdout: state.syncIssuesDetailStdout ?? '',
          stderr: '',
          exitCode: 0,
        };
      }

      throw new Error(`Unhandled MEGA command in test: ${command}`);
    },
  };
}

describe('MegaTransportAdapter', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((tempDir) => fs.rm(tempDir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it('logs in, creates shares, invites peers, and tracks sync state through MEGA CLI', async () => {
    const megaState = {
      sessionToken: 'mega-session-token',
      syncs: [] as Array<{ id: string; localPath: string; remotePath: string; runState: string; status: string; error: string }>,
      invitedEmails: [] as string[],
      shareCommands: [] as string[][],
      shareListings: new Map<string, string[]>([
        ['/nearbytes/shared-alpha', ['Shared /nearbytes/shared-alpha : peer@example.com accessLevel=1']],
      ]),
      acceptedOwners: [] as string[],
      createdFolders: [] as string[],
      deletedSyncIds: [] as string[],
      findResults: new Map<string, string>([['shared-alpha', '/nearbytes/shared-alpha']]),
      observedPaths: [] as string[],
      signupCommands: [] as string[][],
      confirmCommands: [] as string[][],
    };

    const commandDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'nearbytes-megacmd-path-'));
    tempDirs.push(commandDirectory);
  await fs.writeFile(path.join(commandDirectory, 'MegaClient.exe'), '');

    const runtime = createIntegrationRuntime({
      secretStore: createMemorySecretStore(),
      commandExecutor: createFakeMegaExecutor(megaState),
      mega: {
        syncIntervalMs: 60_000,
        remoteBasePath: '/nearbytes',
        commandDirectory,
      },
      logger: {
        log() {},
        warn() {},
      },
    });
    const adapter = new MegaTransportAdapter(runtime);

    const connected = await adapter.connect({
      provider: 'mega',
      accountId: 'acct-mega-1',
      label: 'Main MEGA',
      credentials: {
        email: 'owner@mega.example',
        password: 'secret-password',
        mfaCode: '123456',
      },
    });
    expect(connected.status).toBe('connected');
    const account = connected.account!;
    expect(account.email).toBe('owner@mega.example');
    expect(megaState.observedPaths.some((value) => value.startsWith(commandDirectory))).toBe(true);

    const created = await adapter.createManagedShare(
      {
        provider: 'mega',
        accountId: account.id,
        label: 'Alpha Mirror',
        localPath: '/tmp/alpha-mirror',
      },
      account
    );
    expect(String(created.remoteDescriptor?.remotePath)).toMatch(/^\/nearbytes\/Alpha Mirror [a-f0-9]{6}$/);
    expect(megaState.createdFolders[0]).toMatch(/^\/nearbytes\/Alpha Mirror [a-f0-9]{6}$/);

    const share: ManagedShare = {
      id: 'share-mega-1',
      provider: 'mega',
      accountId: account.id,
      label: 'Alpha Mirror',
      role: 'owner',
      localPath: '/tmp/alpha-mirror',
      sourceId: 'src-mega-1',
      syncMode: 'mirror',
      remoteDescriptor: created.remoteDescriptor ?? {},
      capabilities: ['mirror', 'read', 'write', 'invite'],
      invitationEmails: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await adapter.invite(share, { emails: ['peer@example.com'] }, account);
    expect(megaState.invitedEmails).toEqual(['peer@example.com']);
    expect(megaState.shareCommands[0]).toContain('--level=rw');

    const collaborators = await adapter.getCollaborators(
      {
        ...share,
        remoteDescriptor: {
          ...share.remoteDescriptor,
          remotePath: '/nearbytes/shared-alpha',
        },
      },
      account
    );
    expect(collaborators).toEqual([
      {
        label: 'peer@example.com',
        email: 'peer@example.com',
        role: 'writer',
        status: 'active',
        source: 'provider',
      },
    ]);

    await adapter.ensureSync(share, account);
    const state = await adapter.getState(share, account);
    expect(state.status).toBe('ready');

    const accepted = await adapter.acceptInvite(
      {
        provider: 'mega',
        accountId: account.id,
        label: 'Joined MEGA mirror',
        localPath: '/tmp/joined-mega',
        remoteDescriptor: {
          shareName: 'shared-alpha',
          ownerEmail: 'owner@mega.example',
        },
      },
      account
    );
    expect(accepted.remoteDescriptor?.remotePath).toBe('/nearbytes/shared-alpha');
    expect(megaState.acceptedOwners).toContain('owner@mega.example');
    expect(megaState.syncs).toHaveLength(1);

    await adapter.detachManagedShare(share, account);
    expect(megaState.deletedSyncIds).toContain('1');

    await adapter.disconnect(account);
  });

  it('reuses an existing MEGA CLI session without failing when already logged in', async () => {
    const megaState = {
      sessionToken: 'mega-session-token',
      syncs: [
        {
          id: '1',
          localPath: '/tmp/alpha-mirror',
          remotePath: '/nearbytes/alpha',
          runState: 'Running',
          status: 'Synced',
          error: '',
        },
      ],
      invitedEmails: [] as string[],
      shareCommands: [] as string[][],
      acceptedOwners: [] as string[],
      createdFolders: [] as string[],
      deletedSyncIds: [] as string[],
      findResults: new Map<string, string>(),
      observedPaths: [] as string[],
      signupCommands: [] as string[][],
      confirmCommands: [] as string[][],
      loginMode: 'already-logged-in' as const,
    };

    const runtime = createIntegrationRuntime({
      secretStore: createMemorySecretStore(),
      commandExecutor: createFakeMegaExecutor(megaState),
      mega: {
        syncIntervalMs: 60_000,
        remoteBasePath: '/nearbytes',
      },
      logger: {
        log() {},
        warn() {},
      },
    });
    const adapter = new MegaTransportAdapter(runtime);
    await runtime.secretStore.set('provider-account:mega:acct-mega-1', {
      email: 'owner@mega.example',
      sessionToken: 'mega-session-token',
    });

    const share: ManagedShare = {
      id: 'share-mega-1',
      provider: 'mega',
      accountId: 'acct-mega-1',
      label: 'Alpha Mirror',
      role: 'owner',
      localPath: '/tmp/alpha-mirror',
      sourceId: 'src-mega-1',
      syncMode: 'mirror',
      remoteDescriptor: {
        remotePath: '/nearbytes/alpha',
        shareName: 'alpha',
      },
      capabilities: ['mirror', 'read', 'write', 'invite'],
      invitationEmails: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const account = {
      id: 'acct-mega-1',
      provider: 'mega',
      label: 'MEGA',
      email: 'owner@mega.example',
      state: 'connected',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as const;

    const state = await adapter.getState(share, account);
    expect(state.status).toBe('ready');
  });

  it('exposes structured diagnostics when MEGA reports a sync error', async () => {
    const megaState = {
      sessionToken: 'mega-session-token',
      syncs: [
        {
          id: '1',
          localPath: '/tmp/alpha-mirror',
          remotePath: '/nearbytes/alpha',
          runState: 'Running',
          status: 'Paused',
          error: 'Local path is not writable',
        },
      ],
      invitedEmails: [] as string[],
      shareCommands: [] as string[][],
      acceptedOwners: [] as string[],
      createdFolders: [] as string[],
      deletedSyncIds: [] as string[],
      findResults: new Map<string, string>(),
      observedPaths: [] as string[],
    };

    const runtime = createIntegrationRuntime({
      secretStore: createMemorySecretStore(),
      commandExecutor: createFakeMegaExecutor(megaState),
      mega: {
        syncIntervalMs: 60_000,
        remoteBasePath: '/nearbytes',
      },
      logger: {
        log() {},
        warn() {},
      },
    });
    const adapter = new MegaTransportAdapter(runtime);
    await runtime.secretStore.set('provider-account:mega:acct-mega-1', {
      email: 'owner@mega.example',
      sessionToken: 'mega-session-token',
    });

    const share: ManagedShare = {
      id: 'share-mega-1',
      provider: 'mega',
      accountId: 'acct-mega-1',
      label: 'Alpha Mirror',
      role: 'owner',
      localPath: '/tmp/alpha-mirror',
      sourceId: 'src-mega-1',
      syncMode: 'mirror',
      remoteDescriptor: {
        remotePath: '/nearbytes/alpha',
        shareName: 'alpha',
      },
      capabilities: ['mirror', 'read', 'write', 'invite'],
      invitationEmails: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const account = {
      id: 'acct-mega-1',
      provider: 'mega',
      label: 'MEGA',
      email: 'owner@mega.example',
      state: 'connected',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as const;

    const state = await adapter.getState(share, account);

    expect(state.status).toBe('attention');
    expect(state.diagnostic?.title).toBe('MEGA reported a sync error');
    expect(state.diagnostic?.summary).toContain('not writable');
    expect(state.diagnostic?.facts).toEqual(
      expect.arrayContaining([
        { label: 'Local path', value: '/tmp/alpha-mirror' },
        { label: 'Remote path', value: '/nearbytes/alpha' },
      ])
    );
  });

  it('ignores sync issue counts that belong to a different MEGA sync', async () => {
    const megaState = {
      sessionToken: 'mega-session-token',
      syncs: [
        {
          id: 'legacy-sync',
          localPath: '/Users/vincenzo/MEGA/nearbytes',
          remotePath: '/nearbytes',
          runState: 'Unknown',
          status: 'Processing',
          error: 'Active sync same path',
        },
        {
          id: 'managed-sync',
          localPath: '/tmp/alpha-mirror',
          remotePath: '/nearbytes/alpha',
          runState: 'Running',
          status: 'Pending',
          error: 'Sync Issues (2)',
        },
      ],
      invitedEmails: [] as string[],
      shareCommands: [] as string[][],
      acceptedOwners: [] as string[],
      createdFolders: [] as string[],
      deletedSyncIds: [] as string[],
      findResults: new Map<string, string>(),
      observedPaths: [] as string[],
      syncIssuesDetailStdout: `[Details on issue issue-1]
Unable to sync 'deadbeef.bin'. This file has conflicting copies.
Parent sync: legacy-sync (/Users/vincenzo/MEGA/nearbytes to <CLOUD>/nearbytes)

PATH                PATH_ISSUE LAST_MODIFIED       UPLOADED            SIZE
/Users/...dead.bin -          2026-03-17 22:17:49 -                   299.00  B
<CLOUD>/...dead.bin -          2026-03-17 15:09:30 2026-03-17 22:15:43 299.00  B
`,
    };

    const runtime = createIntegrationRuntime({
      secretStore: createMemorySecretStore(),
      commandExecutor: createFakeMegaExecutor(megaState),
      mega: {
        syncIntervalMs: 60_000,
        remoteBasePath: '/nearbytes',
      },
      logger: {
        log() {},
        warn() {},
      },
    });
    const adapter = new MegaTransportAdapter(runtime);
    await runtime.secretStore.set('provider-account:mega:acct-mega-1', {
      email: 'owner@mega.example',
      sessionToken: 'mega-session-token',
    });

    const share: ManagedShare = {
      id: 'share-mega-1',
      provider: 'mega',
      accountId: 'acct-mega-1',
      label: 'Alpha Mirror',
      role: 'owner',
      localPath: '/tmp/alpha-mirror',
      sourceId: 'src-mega-1',
      syncMode: 'mirror',
      remoteDescriptor: {
        remotePath: '/nearbytes/alpha',
        shareName: 'alpha',
      },
      capabilities: ['mirror', 'read', 'write', 'invite'],
      invitationEmails: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const account = {
      id: 'acct-mega-1',
      provider: 'mega',
      label: 'MEGA',
      email: 'owner@mega.example',
      state: 'connected',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as const;

    const state = await adapter.getState(share, account);

    expect(state.status).toBe('ready');
    expect(state.detail).toBe('MEGA sync is running for this share.');
    expect(state.diagnostic).toBeUndefined();
  });

  it('attributes sync issue counts to the matching MEGA sync id', async () => {
    const megaState = {
      sessionToken: 'mega-session-token',
      syncs: [
        {
          id: 'managed-sync',
          localPath: '/tmp/alpha-mirror',
          remotePath: '/nearbytes/alpha',
          runState: 'Running',
          status: 'Pending',
          error: 'Sync Issues (2)',
        },
      ],
      invitedEmails: [] as string[],
      shareCommands: [] as string[][],
      acceptedOwners: [] as string[],
      createdFolders: [] as string[],
      deletedSyncIds: [] as string[],
      findResults: new Map<string, string>(),
      observedPaths: [] as string[],
      syncIssuesDetailStdout: `[Details on issue issue-1]
Unable to sync 'deadbeef.bin'. This file has conflicting copies.
Parent sync: managed-sync (/tmp/alpha-mirror to <CLOUD>/nearbytes/alpha)

PATH                PATH_ISSUE LAST_MODIFIED       UPLOADED            SIZE
/Users/...dead.bin -          2026-03-17 22:17:49 -                   299.00  B
<CLOUD>/...dead.bin -          2026-03-17 15:09:30 2026-03-17 22:15:43 299.00  B

[Details on issue issue-2]
Unable to sync 'beaded.bin'. This file has conflicting copies.
Parent sync: managed-sync (/tmp/alpha-mirror to <CLOUD>/nearbytes/alpha)

PATH                PATH_ISSUE LAST_MODIFIED       UPLOADED            SIZE
/Users/...beaded.bin -          2026-03-17 22:17:49 -                   299.00  B
<CLOUD>/...beaded.bin -          2026-03-17 15:09:30 2026-03-17 22:15:43 299.00  B
`,
    };

    const runtime = createIntegrationRuntime({
      secretStore: createMemorySecretStore(),
      commandExecutor: createFakeMegaExecutor(megaState),
      mega: {
        syncIntervalMs: 60_000,
        remoteBasePath: '/nearbytes',
      },
      logger: {
        log() {},
        warn() {},
      },
    });
    const adapter = new MegaTransportAdapter(runtime);
    await runtime.secretStore.set('provider-account:mega:acct-mega-1', {
      email: 'owner@mega.example',
      sessionToken: 'mega-session-token',
    });

    const share: ManagedShare = {
      id: 'share-mega-1',
      provider: 'mega',
      accountId: 'acct-mega-1',
      label: 'Alpha Mirror',
      role: 'owner',
      localPath: '/tmp/alpha-mirror',
      sourceId: 'src-mega-1',
      syncMode: 'mirror',
      remoteDescriptor: {
        remotePath: '/nearbytes/alpha',
        shareName: 'alpha',
      },
      capabilities: ['mirror', 'read', 'write', 'invite'],
      invitationEmails: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const account = {
      id: 'acct-mega-1',
      provider: 'mega',
      label: 'MEGA',
      email: 'owner@mega.example',
      state: 'connected',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as const;

    const state = await adapter.getState(share, account);

    expect(state.status).toBe('attention');
    expect(state.detail).toBe('MEGA found conflicting copies for 2 files in this sync.');
    expect(state.diagnostic?.code).toBe('mega-sync-conflict');
    expect(state.diagnostic?.facts).toEqual(
      expect.arrayContaining([
        { label: 'Issue count', value: '2' },
        { label: 'First file', value: 'deadbeef.bin' },
      ])
    );
  });

  it('treats transient mount/login races as no incoming shares instead of failing', async () => {
    const megaState = {
      sessionToken: 'mega-session-token',
      syncs: [] as Array<{ id: string; localPath: string; remotePath: string; runState: string; status: string; error: string }>,
      invitedEmails: [] as string[],
      shareCommands: [] as string[][],
      acceptedOwners: [] as string[],
      createdFolders: [] as string[],
      deletedSyncIds: [] as string[],
      findResults: new Map<string, string>(),
      observedPaths: [] as string[],
      mountError: 'Command not valid while login in: mount',
    };

    const runtime = createIntegrationRuntime({
      secretStore: createMemorySecretStore(),
      commandExecutor: createFakeMegaExecutor(megaState),
      mega: {
        syncIntervalMs: 60_000,
        remoteBasePath: '/nearbytes',
      },
      logger: {
        log() {},
        warn() {},
      },
    });
    const adapter = new MegaTransportAdapter(runtime);
    await runtime.secretStore.set('provider-account:mega:acct-mega-1', {
      email: 'owner@mega.example',
      sessionToken: 'mega-session-token',
    });

    const account = {
      id: 'acct-mega-1',
      provider: 'mega',
      label: 'MEGA',
      email: 'owner@mega.example',
      state: 'connected',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as const;

    await expect(adapter.listIncomingShares(account)).resolves.toEqual([]);
  });

  it('downloads accepted incoming MEGA shares as local read-only copies', async () => {
    const megaState = {
      sessionToken: 'mega-session-token',
      syncs: [] as Array<{ id: string; localPath: string; remotePath: string; runState: string; status: string; error: string }>,
      downloads: [] as string[][],
      invitedEmails: [] as string[],
      shareCommands: [] as string[][],
      acceptedOwners: [] as string[],
      createdFolders: [] as string[],
      deletedSyncIds: [] as string[],
      findResults: new Map<string, string>(),
      observedPaths: [] as string[],
      mountStdout: 'INSHARE on //from/owner@mega.example:nearbytes (read access)\n',
    };

    const runtime = createIntegrationRuntime({
      secretStore: createMemorySecretStore(),
      commandExecutor: createFakeMegaExecutor(megaState),
      mega: {
        syncIntervalMs: 60_000,
        remoteBasePath: '/nearbytes',
      },
      logger: {
        log() {},
        warn() {},
      },
    });
    const adapter = new MegaTransportAdapter(runtime);
    await runtime.secretStore.set('provider-account:mega:acct-mega-1', {
      email: 'reader@mega.example',
      sessionToken: 'mega-session-token',
    });

    const account = {
      id: 'acct-mega-1',
      provider: 'mega',
      label: 'MEGA',
      email: 'reader@mega.example',
      state: 'connected',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as const;

    const [offer] = await adapter.listIncomingShares(account);
    expect(offer?.remoteDescriptor).toMatchObject({
      remotePath: 'owner@mega.example:nearbytes',
      accessLevel: 'read access',
    });

    const share: ManagedShare = {
      id: 'share-mega-recipient-1',
      provider: 'mega',
      accountId: account.id,
      label: 'nearbytes',
      role: 'recipient',
      localPath: path.join(os.tmpdir(), `nearbytes-incoming-${Date.now()}`),
      sourceId: 'src-mega-recipient-1',
      syncMode: 'mirror',
      remoteDescriptor: offer!.remoteDescriptor,
      capabilities: ['mirror', 'read', 'accept'],
      invitationEmails: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await adapter.ensureSync(share, account);

    expect(megaState.downloads).toContainEqual([
      '-m',
      'owner@mega.example:nearbytes',
      share.localPath,
    ]);
    expect(megaState.syncs).toHaveLength(0);

    const state = await adapter.getState(share, account);
    expect(state.status).toBe('ready');
    expect(state.detail).toContain('local read-only copy');

    await adapter.detachManagedShare(share, account);
    await fs.rm(share.localPath, { recursive: true, force: true });
  });

  it('treats transient df/login races as unavailable metrics instead of failing', async () => {
    const megaState = {
      sessionToken: 'mega-session-token',
      syncs: [] as Array<{ id: string; localPath: string; remotePath: string; runState: string; status: string; error: string }>,
      invitedEmails: [] as string[],
      shareCommands: [] as string[][],
      acceptedOwners: [] as string[],
      createdFolders: [] as string[],
      deletedSyncIds: [] as string[],
      findResults: new Map<string, string>(),
      observedPaths: [] as string[],
      dfError: 'Command not valid while login in: df',
    };

    const runtime = createIntegrationRuntime({
      secretStore: createMemorySecretStore(),
      commandExecutor: createFakeMegaExecutor(megaState),
      mega: {
        syncIntervalMs: 60_000,
        remoteBasePath: '/nearbytes',
      },
      logger: {
        log() {},
        warn() {},
      },
    });
    const adapter = new MegaTransportAdapter(runtime);
    await runtime.secretStore.set('provider-account:mega:acct-mega-1', {
      email: 'owner@mega.example',
      sessionToken: 'mega-session-token',
    });

    const account = {
      id: 'acct-mega-1',
      provider: 'mega',
      label: 'MEGA',
      email: 'owner@mega.example',
      state: 'connected',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as const;

    await expect(adapter.getShareStorageMetrics({} as ManagedShare, account)).resolves.toBeUndefined();
  });

  it('treats missing remote share paths as no collaborators instead of failing', async () => {
    const megaState = {
      sessionToken: 'mega-session-token',
      syncs: [] as Array<{ id: string; localPath: string; remotePath: string; runState: string; status: string; error: string }>,
      invitedEmails: [] as string[],
      shareCommands: [] as string[][],
      acceptedOwners: [] as string[],
      createdFolders: [] as string[],
      deletedSyncIds: [] as string[],
      findResults: new Map<string, string>(),
      observedPaths: [] as string[],
      missingSharePaths: new Set(['/nearbytes/missing-share']),
    };

    const runtime = createIntegrationRuntime({
      secretStore: createMemorySecretStore(),
      commandExecutor: createFakeMegaExecutor(megaState),
      mega: {
        syncIntervalMs: 60_000,
        remoteBasePath: '/nearbytes',
      },
      logger: {
        log() {},
        warn() {},
      },
    });
    const adapter = new MegaTransportAdapter(runtime);
    await runtime.secretStore.set('provider-account:mega:acct-mega-1', {
      email: 'owner@mega.example',
      sessionToken: 'mega-session-token',
    });

    const account = {
      id: 'acct-mega-1',
      provider: 'mega',
      label: 'MEGA',
      email: 'owner@mega.example',
      state: 'connected',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as const;
    const share: ManagedShare = {
      id: 'share-mega-missing',
      provider: 'mega',
      accountId: account.id,
      label: 'Missing share',
      role: 'owner',
      localPath: '/tmp/missing-share',
      sourceId: 'src-mega-1',
      syncMode: 'mirror',
      remoteDescriptor: {
        remotePath: '/nearbytes/missing-share',
      },
      capabilities: ['mirror', 'read', 'write', 'invite'],
      invitationEmails: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await expect(adapter.getCollaborators(share, account)).resolves.toEqual([]);
  });

  it('rebinds an existing remote sync to the requested local mirror when the same remote path is already mirrored', async () => {
    const megaState = {
      sessionToken: 'mega-session-token',
      syncs: [
        {
          id: '1',
          localPath: '/tmp/existing-nearbytes',
          remotePath: '/nearbytes',
          runState: 'Running',
          status: 'Synced',
          error: '',
        },
      ],
      invitedEmails: [] as string[],
      shareCommands: [] as string[][],
      acceptedOwners: [] as string[],
      createdFolders: [] as string[],
      deletedSyncIds: [] as string[],
      findResults: new Map<string, string>(),
      observedPaths: [] as string[],
      signupCommands: [] as string[][],
      confirmCommands: [] as string[][],
      mkdirAlreadyExistsPaths: new Set<string>(['/nearbytes']),
    };

    const commandDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'nearbytes-megacmd-path-'));
    tempDirs.push(commandDirectory);
    await fs.writeFile(path.join(commandDirectory, 'MegaClient.exe'), '');

    const runtime = createIntegrationRuntime({
      secretStore: createMemorySecretStore(),
      commandExecutor: createFakeMegaExecutor(megaState),
      mega: {
        syncIntervalMs: 60_000,
        remoteBasePath: '/nearbytes',
        commandDirectory,
      },
      logger: {
        log() {},
        warn() {},
      },
    });
    const adapter = new MegaTransportAdapter(runtime);
    await runtime.secretStore.set('provider-account:mega:acct-mega-1', {
      email: 'owner@mega.example',
      sessionToken: 'mega-session-token',
    });

    const account = {
      id: 'acct-mega-1',
      provider: 'mega',
      label: 'MEGA',
      email: 'owner@mega.example',
      state: 'connected',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as const;

    const created = await adapter.createManagedShare(
      {
        provider: 'mega',
        accountId: account.id,
        label: 'nearbytes',
        localPath: '/tmp/requested-nearbytes',
        remoteDescriptor: {
          remotePath: '/nearbytes',
          shareName: 'nearbytes',
        },
      },
      account
    );

    expect(created.localPath).toBe('/tmp/requested-nearbytes');
    expect(megaState.deletedSyncIds).toContain('1');
    expect(megaState.syncs).toHaveLength(1);
    expect(megaState.syncs[0]?.localPath).toBe('/tmp/requested-nearbytes');
  });

  it('rebinds an existing remote sync to the share local path when a stale share record is reused', async () => {
    const megaState = {
      sessionToken: 'mega-session-token',
      syncs: [
        {
          id: '1',
          localPath: '/tmp/old-nearbytes',
          remotePath: '/nearbytes',
          runState: 'Running',
          status: 'Synced',
          error: '',
        },
      ],
      invitedEmails: [] as string[],
      shareCommands: [] as string[][],
      acceptedOwners: [] as string[],
      createdFolders: [] as string[],
      deletedSyncIds: [] as string[],
      findResults: new Map<string, string>(),
      observedPaths: [] as string[],
      signupCommands: [] as string[][],
      confirmCommands: [] as string[][],
    };

    const commandDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'nearbytes-megacmd-path-'));
    tempDirs.push(commandDirectory);
    await fs.writeFile(path.join(commandDirectory, 'MegaClient.exe'), '');

    const runtime = createIntegrationRuntime({
      secretStore: createMemorySecretStore(),
      commandExecutor: createFakeMegaExecutor(megaState),
      mega: {
        syncIntervalMs: 60_000,
        remoteBasePath: '/nearbytes',
        commandDirectory,
      },
      logger: {
        log() {},
        warn() {},
      },
    });
    const adapter = new MegaTransportAdapter(runtime);
    await runtime.secretStore.set('provider-account:mega:acct-mega-1', {
      email: 'owner@mega.example',
      sessionToken: 'mega-session-token',
    });

    const share: ManagedShare = {
      id: 'share-mega-1',
      provider: 'mega',
      accountId: 'acct-mega-1',
      label: 'nearbytes',
      role: 'recipient',
      localPath: '/tmp/new-nearbytes',
      sourceId: 'src-mega-1',
      syncMode: 'mirror',
      remoteDescriptor: {
        remotePath: '/nearbytes',
        shareName: 'nearbytes',
      },
      capabilities: ['mirror', 'read', 'write', 'accept'],
      invitationEmails: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const account = {
      id: 'acct-mega-1',
      provider: 'mega',
      label: 'MEGA',
      email: 'owner@mega.example',
      state: 'connected',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as const;

    await adapter.ensureSync(share, account);

    expect(megaState.deletedSyncIds).toContain('1');
    expect(megaState.syncs).toHaveLength(1);
    expect(megaState.syncs[0]?.localPath).toBe('/tmp/new-nearbytes');
    expect(megaState.syncs[0]?.remotePath).toBe('/nearbytes');
  });

  it('prefers the exact MEGA sync when another sync reuses the same local path', async () => {
    const megaState = {
      sessionToken: 'mega-session-token',
      syncs: [
        {
          id: 'legacy-sync',
          localPath: '/tmp/nearbytes',
          remotePath: '/nearbytes/legacy',
          runState: 'Unknown',
          status: 'Processing',
          error: 'Active sync same path',
        },
        {
          id: 'managed-sync',
          localPath: '/tmp/nearbytes',
          remotePath: '/nearbytes',
          runState: 'Running',
          status: 'Synced',
          error: '',
        },
      ],
      invitedEmails: [] as string[],
      shareCommands: [] as string[][],
      acceptedOwners: [] as string[],
      createdFolders: [] as string[],
      deletedSyncIds: [] as string[],
      findResults: new Map<string, string>(),
      observedPaths: [] as string[],
    };

    const runtime = createIntegrationRuntime({
      secretStore: createMemorySecretStore(),
      commandExecutor: createFakeMegaExecutor(megaState),
      mega: {
        syncIntervalMs: 60_000,
        remoteBasePath: '/nearbytes',
      },
      logger: {
        log() {},
        warn() {},
      },
    });
    const adapter = new MegaTransportAdapter(runtime);
    await runtime.secretStore.set('provider-account:mega:acct-mega-1', {
      email: 'owner@mega.example',
      sessionToken: 'mega-session-token',
    });

    const share: ManagedShare = {
      id: 'share-mega-1',
      provider: 'mega',
      accountId: 'acct-mega-1',
      label: 'nearbytes',
      role: 'owner',
      localPath: '/tmp/nearbytes',
      sourceId: 'src-mega-1',
      syncMode: 'mirror',
      remoteDescriptor: {
        remotePath: '/nearbytes',
        shareName: 'nearbytes',
      },
      capabilities: ['mirror', 'read', 'write', 'invite'],
      invitationEmails: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const account = {
      id: 'acct-mega-1',
      provider: 'mega',
      label: 'MEGA',
      email: 'owner@mega.example',
      state: 'connected',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as const;

    const state = await adapter.getState(share, account);

    expect(state.status).toBe('ready');
    expect(state.detail).toBe('MEGA sync is running for this share.');
  });

  it('recreates a stale local-path sync when it points at the wrong remote path', async () => {
    const megaState = {
      sessionToken: 'mega-session-token',
      syncs: [
        {
          id: 'legacy-sync',
          localPath: '/tmp/nearbytes',
          remotePath: '/nearbytes/legacy',
          runState: 'Unknown',
          status: 'Processing',
          error: 'Active sync same path',
        },
      ],
      invitedEmails: [] as string[],
      shareCommands: [] as string[][],
      acceptedOwners: [] as string[],
      createdFolders: [] as string[],
      deletedSyncIds: [] as string[],
      findResults: new Map<string, string>(),
      observedPaths: [] as string[],
    };

    const runtime = createIntegrationRuntime({
      secretStore: createMemorySecretStore(),
      commandExecutor: createFakeMegaExecutor(megaState),
      mega: {
        syncIntervalMs: 60_000,
        remoteBasePath: '/nearbytes',
      },
      logger: {
        log() {},
        warn() {},
      },
    });
    const adapter = new MegaTransportAdapter(runtime);
    await runtime.secretStore.set('provider-account:mega:acct-mega-1', {
      email: 'owner@mega.example',
      sessionToken: 'mega-session-token',
    });

    const share: ManagedShare = {
      id: 'share-mega-1',
      provider: 'mega',
      accountId: 'acct-mega-1',
      label: 'nearbytes',
      role: 'owner',
      localPath: '/tmp/nearbytes',
      sourceId: 'src-mega-1',
      syncMode: 'mirror',
      remoteDescriptor: {
        remotePath: '/nearbytes',
        shareName: 'nearbytes',
      },
      capabilities: ['mirror', 'read', 'write', 'invite'],
      invitationEmails: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const account = {
      id: 'acct-mega-1',
      provider: 'mega',
      label: 'MEGA',
      email: 'owner@mega.example',
      state: 'connected',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as const;

    await adapter.ensureSync(share, account);

    expect(megaState.deletedSyncIds).toContain('legacy-sync');
    expect(megaState.syncs).toHaveLength(1);
    expect(megaState.syncs[0]).toMatchObject({
      localPath: '/tmp/nearbytes',
      remotePath: '/nearbytes',
      runState: 'Running',
      status: 'Synced',
      error: '',
    });
  });

  it('creates a MEGA account and confirms it through the pending session flow', async () => {
    const megaState = {
      sessionToken: 'mega-session-token',
      syncs: [] as Array<{ id: string; localPath: string; remotePath: string; runState: string; status: string; error: string }>,
      invitedEmails: [] as string[],
      shareCommands: [] as string[][],
      acceptedOwners: [] as string[],
      createdFolders: [] as string[],
      deletedSyncIds: [] as string[],
      findResults: new Map<string, string>(),
      observedPaths: [] as string[],
      signupCommands: [] as string[][],
      confirmCommands: [] as string[][],
    };

    const runtime = createIntegrationRuntime({
      secretStore: createMemorySecretStore(),
      commandExecutor: createFakeMegaExecutor(megaState),
      mega: {
        syncIntervalMs: 60_000,
        remoteBasePath: '/nearbytes',
      },
      logger: {
        log() {},
        warn() {},
      },
    });
    const adapter = new MegaTransportAdapter(runtime);

    const pending = await adapter.connect({
      provider: 'mega',
      mode: 'signup',
      accountId: 'acct-mega-2',
      credentials: {
        name: 'Vincenzo',
        email: 'new@mega.example',
        password: 'signup-secret',
      },
    });
    expect(pending.status).toBe('pending');
    expect(megaState.signupCommands).toEqual([['new@mega.example', 'signup-secret', '--name=Vincenzo']]);

    const connected = await adapter.connect({
      provider: 'mega',
      authSessionId: pending.authSession!.id,
      credentials: {
        confirmationLink: 'https://mega.nz/confirm#token',
      },
    });
    expect(connected.status).toBe('connected');
    expect(megaState.confirmCommands).toEqual([['https://mega.nz/confirm#token', 'new@mega.example', 'signup-secret']]);
    expect(connected.account?.email).toBe('new@mega.example');
  });

  it('creates the local folder before starting a MEGA sync', async () => {
    const megaState = {
      sessionToken: 'mega-session-token',
      syncs: [] as Array<{ id: string; localPath: string; remotePath: string; runState: string; status: string; error: string }>,
      invitedEmails: [] as string[],
      shareCommands: [] as string[][],
      acceptedOwners: [] as string[],
      createdFolders: [] as string[],
      deletedSyncIds: [] as string[],
      findResults: new Map<string, string>(),
      observedPaths: [] as string[],
      requireExistingLocalSyncDir: true,
    };

    const runtime = createIntegrationRuntime({
      secretStore: createMemorySecretStore(),
      commandExecutor: createFakeMegaExecutor(megaState),
      mega: {
        syncIntervalMs: 60_000,
        remoteBasePath: '/nearbytes',
      },
      logger: {
        log() {},
        warn() {},
      },
    });
    const adapter = new MegaTransportAdapter(runtime);

    const connected = await adapter.connect({
      provider: 'mega',
      accountId: 'acct-mega-3',
      label: 'Main MEGA',
      credentials: {
        email: 'owner@mega.example',
        password: 'secret-password',
      },
    });
    const account = connected.account!;
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nearbytes-mega-sync-'));
    const localPath = path.join(tempRoot, 'missing', 'nested', 'share');

    await expect(
      adapter.createManagedShare(
        {
          provider: 'mega',
          accountId: account.id,
          label: 'Nested Share',
          localPath,
        },
        account
      )
    ).resolves.toBeTruthy();

    await expect(fs.stat(localPath)).resolves.toMatchObject({ isDirectory: expect.any(Function) });
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('treats an existing MEGA remote folder as reusable during share creation', async () => {
    const megaState = {
      sessionToken: 'mega-session-token',
      syncs: [] as Array<{ id: string; localPath: string; remotePath: string; runState: string; status: string; error: string }>,
      invitedEmails: [] as string[],
      shareCommands: [] as string[][],
      acceptedOwners: [] as string[],
      createdFolders: [] as string[],
      deletedSyncIds: [] as string[],
      findResults: new Map<string, string>(),
      observedPaths: [] as string[],
      mkdirAlreadyExistsPaths: new Set(['/nearbytes']),
    };

    const commandDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'nearbytes-megacmd-path-'));
    tempDirs.push(commandDirectory);
    await fs.writeFile(path.join(commandDirectory, 'MegaClient.exe'), '');

    const runtime = createIntegrationRuntime({
      secretStore: createMemorySecretStore(),
      commandExecutor: createFakeMegaExecutor(megaState),
      mega: {
        syncIntervalMs: 60_000,
        remoteBasePath: '/nearbytes',
        commandDirectory,
      },
      logger: {
        log() {},
        warn() {},
      },
    });
    const adapter = new MegaTransportAdapter(runtime);

    const connected = await adapter.connect({
      provider: 'mega',
      accountId: 'acct-mega-root',
      label: 'Main MEGA',
      credentials: {
        email: 'owner@mega.example',
        password: 'secret-password',
      },
    });
    const account = connected.account!;

    const created = await adapter.createManagedShare(
      {
        provider: 'mega',
        accountId: account.id,
        label: 'Nearbytes root',
        localPath: '/tmp/nearbytes-root',
        remoteDescriptor: {
          remotePath: '/nearbytes',
          shareName: 'nearbytes',
        },
      },
      account
    );

    expect(created.remoteDescriptor?.remotePath).toBe('/nearbytes');
    expect(megaState.createdFolders).toContain('/nearbytes');
    expect(megaState.syncs[0]?.remotePath).toBe('/nearbytes');
  });

  it('auto-installs MEGAcmd and retries the command when the CLI is missing', async () => {
    let helperInstalled = false;
    const executor: CommandExecutor = {
      async run(invocation) {
        const rawCommand = basename(invocation.command);
        const args = [...(invocation.args ?? [])];
        const command = rawCommand === 'MegaClient.exe' ? `mega-${args.shift() ?? ''}` : rawCommand;
        if (!helperInstalled) {
          const error = new Error('missing');
          (error as NodeJS.ErrnoException).code = 'ENOENT';
          throw error;
        }
        if (command === 'mega-login') {
          return { stdout: 'OK\n', stderr: '', exitCode: 0 };
        }
        if (command === 'mega-session') {
          return { stdout: 'mega-session-token\n', stderr: '', exitCode: 0 };
        }
        throw new Error(`Unhandled MEGA command in test: ${command}`);
      },
    };

    const runtime = createIntegrationRuntime({
      secretStore: createMemorySecretStore(),
      commandExecutor: executor,
      mega: {
        syncIntervalMs: 60_000,
        remoteBasePath: '/nearbytes',
      },
      logger: {
        log() {},
        warn() {},
      },
    });

    const installer = {
      install: async () => {
        helperInstalled = true;
        return {
          status: 'ready',
          detail: 'MEGAcmd is installed and ready.',
          canInstall: true,
          config: {
            helperPath: 'C:/fake/megacmd',
          },
        };
      },
      getCommandDirectory: async () => undefined,
      getSetupState: async () => ({
        status: helperInstalled ? 'ready' : 'needs-install',
        detail: helperInstalled ? 'MEGA CLI is ready to use.' : 'Nearbytes can download and install MEGAcmd automatically the first time you connect MEGA.',
        canInstall: true,
      }),
    } as MegaHelperInstaller;

    const adapter = new MegaTransportAdapter(runtime, installer);

    const connected = await adapter.connect({
      provider: 'mega',
      accountId: 'acct-mega-auto-install',
      label: 'Main MEGA',
      credentials: {
        email: 'owner@mega.example',
        password: 'secret-password',
      },
    });

    expect(helperInstalled).toBe(true);
    expect(connected.status).toBe('connected');
    expect(connected.account?.email).toBe('owner@mega.example');
  });
});
