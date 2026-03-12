import { basename } from 'path';
import { describe, expect, it } from 'vitest';
import { MegaTransportAdapter } from '../mega.js';
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
  acceptedOwners: string[];
  createdFolders: string[];
  deletedSyncIds: string[];
  findResults: Map<string, string>;
}): CommandExecutor {
  return {
    async run(invocation) {
      const command = basename(invocation.command);
      const args = [...(invocation.args ?? [])];

      if (command === 'mega-login') {
        return { stdout: 'OK\n', stderr: '', exitCode: 0 };
      }
      if (command === 'mega-session') {
        return { stdout: `${state.sessionToken}\n`, stderr: '', exitCode: 0 };
      }
      if (command === 'mega-mkdir') {
        state.createdFolders.push(args.at(-1) ?? '');
        return { stdout: '', stderr: '', exitCode: 0 };
      }
      if (command === 'mega-invite') {
        state.invitedEmails.push(args[0] ?? '');
        return { stdout: '', stderr: '', exitCode: 0 };
      }
      if (command === 'mega-share') {
        state.shareCommands.push(args);
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

      throw new Error(`Unhandled MEGA command in test: ${command}`);
    },
  };
}

describe('MegaTransportAdapter', () => {
  it('logs in, creates shares, invites peers, and tracks sync state through MEGA CLI', async () => {
    const megaState = {
      sessionToken: 'mega-session-token',
      syncs: [] as Array<{ id: string; localPath: string; remotePath: string; runState: string; status: string; error: string }>,
      invitedEmails: [] as string[],
      shareCommands: [] as string[][],
      acceptedOwners: [] as string[],
      createdFolders: [] as string[],
      deletedSyncIds: [] as string[],
      findResults: new Map<string, string>([['shared-alpha', '/Nearbytes/shared-alpha']]),
    };

    const runtime = createIntegrationRuntime({
      secretStore: createMemorySecretStore(),
      commandExecutor: createFakeMegaExecutor(megaState),
      mega: {
        syncIntervalMs: 60_000,
        remoteBasePath: '/Nearbytes',
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

    const created = await adapter.createManagedShare(
      {
        provider: 'mega',
        accountId: account.id,
        label: 'Alpha Mirror',
        localPath: '/tmp/alpha-mirror',
      },
      account
    );
    expect(String(created.remoteDescriptor?.remotePath)).toMatch(/^\/Nearbytes\/alpha-mirror-/);
    expect(megaState.createdFolders[0]).toMatch(/^\/Nearbytes\/alpha-mirror-/);

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
    expect(accepted.remoteDescriptor?.remotePath).toBe('/Nearbytes/shared-alpha');
    expect(megaState.acceptedOwners).toContain('owner@mega.example');

    await adapter.detachManagedShare(share, account);
    expect(megaState.deletedSyncIds).toContain('1');

    await adapter.disconnect(account);
  });
});
