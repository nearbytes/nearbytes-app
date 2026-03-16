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
  loginMode?: 'ok' | 'already-logged-in';
  requireExistingLocalSyncDir?: boolean;
  mkdirAlreadyExistsPaths?: Set<string>;
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
          return {
            stdout: `${(state.shareListings?.get(remotePath) ?? []).join('\n')}${state.shareListings?.get(remotePath)?.length ? '\n' : ''}`,
            stderr: '',
            exitCode: 0,
          };
        }
        return { stdout: '', stderr: '', exitCode: 0 };
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
      if (command === 'mega-logout') {
        return { stdout: '', stderr: '', exitCode: 0 };
      }
      if (command === 'mega-df') {
        return {
          stdout: state.dfStdout ?? 'USED STORAGE: 1048576 bytes of 1073741824 bytes\n',
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
