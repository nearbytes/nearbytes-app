import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RootsConfig } from '../../config/roots.js';
import { MultiRootStorageBackend } from '../../storage/multiRoot.js';
import type { ManagedShareMirrorEntry, TransportAdapter } from '../adapters.js';
import { ManagedShareService } from '../managedShares.js';
import { saveIntegrationState } from '../store.js';
import type {
  ConnectProviderAccountInput,
  ConnectProviderAccountResult,
  ManagedShare,
  ManagedShareCollaborator,
  ProviderAccount,
  TransportEndpoint,
  TransportState,
} from '../types.js';

class FakeTransportAdapter implements TransportAdapter {
  readonly supportsAccountConnection = true;

  constructor(
    readonly provider: string,
    readonly label: string,
    readonly description: string
  ) {}

  async probe(_endpoint: TransportEndpoint): Promise<TransportState> {
    return {
      status: 'ready',
      detail: `${this.label} is available.`,
      badges: ['Fake'],
    };
  }

  async getState(_share: ManagedShare): Promise<TransportState> {
    return {
      status: 'ready',
      detail: `${this.label} is ready.`,
      badges: ['Fake'],
    };
  }

  async ensureSync(): Promise<void> {}

  async getCollaborators(share: ManagedShare): Promise<ManagedShareCollaborator[]> {
    return share.invitationEmails.includes('active@example.com')
      ? [
          {
            label: 'active@example.com',
            email: 'active@example.com',
            role: 'writer',
            status: 'active',
            source: 'provider',
          },
        ]
      : [];
  }

  async connect(input: ConnectProviderAccountInput): Promise<ConnectProviderAccountResult> {
    return {
      status: 'connected',
      account: {
        id: input.accountId ?? `acct-${this.provider}-1`,
        provider: this.provider,
        label: input.label?.trim() || this.label,
        email: input.email,
        state: 'connected',
        detail: `${this.label} is connected.`,
        createdAt: 0,
        updatedAt: 0,
      },
    };
  }

  async createManagedShare(input: { remoteDescriptor?: Record<string, unknown> }) {
    return {
      label: 'nearbytes',
      remoteDescriptor: {
        ...(input.remoteDescriptor ?? {}),
      },
      capabilities: ['mirror', 'read', 'write', 'invite'],
    };
  }

  async listManagedShareMirrors(): Promise<ManagedShareMirrorEntry[]> {
    return [];
  }
}

class LocalPathOverrideAdapter extends FakeTransportAdapter {
  constructor(private readonly resolvedLocalPath: string) {
    super('mega', 'MEGA', 'Managed folders backed by MEGA.');
  }

  override async createManagedShare(input: { remoteDescriptor?: Record<string, unknown> }) {
    const base = await super.createManagedShare(input);
    return {
      ...base,
      localPath: this.resolvedLocalPath,
    };
  }
}

class ConflictRepairAdapter extends FakeTransportAdapter {
  ensureSyncCalls = 0;

  constructor() {
    super('mega', 'MEGA', 'Managed folders backed by MEGA.');
  }

  override async getState(share: ManagedShare): Promise<TransportState> {
    try {
      await fs.stat(path.join(share.localPath, 'Nearbytes.json'));
      return {
        status: 'attention',
        detail: 'Conflicting copies detected for this source.',
        badges: ['Repair'],
        diagnostic: {
          code: 'provider-sync-conflict',
          title: 'Source conflict',
          summary: 'Conflicting copies detected for this source.',
        },
      };
    } catch {
      return {
        status: 'ready',
        detail: 'MEGA is ready.',
        badges: ['Connected'],
      };
    }
  }

  override async ensureSync(): Promise<void> {
    this.ensureSyncCalls += 1;
  }
}

class MirrorInventoryAdapter extends FakeTransportAdapter {
  constructor(private readonly mirrors: ManagedShareMirrorEntry[]) {
    super('mega', 'MEGA', 'Managed folders backed by MEGA.');
  }

  override async listManagedShareMirrors(): Promise<ManagedShareMirrorEntry[]> {
    return this.mirrors;
  }
}

const tempDirs = new Set<string>();

async function createHarness(): Promise<{
  integrationStatePath: string;
  localRoot: string;
  rootsConfigPath: string;
  service: ManagedShareService;
}> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nearbytes-managed-shares-'));
  tempDirs.add(tempDir);
  const localRoot = path.join(tempDir, 'local-root');
  await fs.mkdir(localRoot, { recursive: true });

  const rootsConfig: RootsConfig = {
    version: 2,
    sources: [
      {
        id: 'src-local',
        provider: 'local',
        path: localRoot,
        enabled: true,
        writable: true,
        reservePercent: 5,
        opportunisticPolicy: 'drop-older-blocks',
      },
    ],
    defaultVolume: {
      destinations: [
        {
          sourceId: 'src-local',
          enabled: true,
          storeEvents: true,
          storeBlocks: true,
          copySourceBlocks: true,
          reservePercent: 5,
          fullPolicy: 'block-writes',
        },
      ],
    },
    volumes: [],
  };

  const rootsConfigPath = path.join(tempDir, 'roots.json');
  await fs.writeFile(rootsConfigPath, `${JSON.stringify(rootsConfig, null, 2)}\n`, 'utf8');

  const integrationStatePath = path.join(tempDir, 'integrations.json');
  const storage = new MultiRootStorageBackend(rootsConfig);
  const service = new ManagedShareService({
    storage,
    rootsConfigPath,
    integrationStatePath,
    adapters: [new FakeTransportAdapter('mega', 'MEGA', 'Managed folders backed by MEGA.')],
  });

  return {
    integrationStatePath,
    localRoot,
    rootsConfigPath,
    service,
  };
}

afterEach(async () => {
  await Promise.all(
    Array.from(tempDirs, async (tempDir) => {
      await fs.rm(tempDir, { recursive: true, force: true });
      tempDirs.delete(tempDir);
    })
  );
});

describe('ManagedShareService', () => {
  it('filters disabled Google Drive accounts and shares from listings', async () => {
    const { integrationStatePath, service } = await createHarness();
    const connected = (provider: string, id: string): ProviderAccount => ({
      id,
      provider,
      label: provider,
      state: 'connected',
      createdAt: 1,
      updatedAt: 1,
    });

    await saveIntegrationState(
      {
        version: 1,
        preferredProviders: ['gdrive', 'mega'],
        accounts: [connected('gdrive', 'acct-gdrive-1'), connected('mega', 'acct-mega-1')],
        managedShares: [
          {
            id: 'share-gdrive-1',
            provider: 'gdrive',
            accountId: 'acct-gdrive-1',
            label: 'Google share',
            role: 'owner',
            localPath: path.join(path.dirname(integrationStatePath), 'gdrive-share'),
            syncMode: 'mirror',
            remoteDescriptor: { folderId: 'drive-folder-1' },
            capabilities: ['mirror'],
            invitationEmails: [],
            createdAt: 1,
            updatedAt: 1,
          },
          {
            id: 'share-mega-1',
            provider: 'mega',
            accountId: 'acct-mega-1',
            label: 'MEGA share',
            role: 'owner',
            localPath: path.join(path.dirname(integrationStatePath), 'mega-share'),
            syncMode: 'mirror',
            remoteDescriptor: { remotePath: '/nearbytes/MEGA share' },
            capabilities: ['mirror'],
            invitationEmails: [],
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      },
      integrationStatePath
    );

    const accounts = await service.listAccounts();
    expect(accounts.accounts.map((account) => account.provider)).toEqual(['mega']);
    expect(accounts.providers.map((provider) => provider.provider)).toEqual(['mega']);
    expect(accounts.preferredProviders).toEqual(['mega']);

    const shares = await service.listManagedShares();
    expect(shares.shares.map((summary) => summary.share.provider)).toEqual(['mega']);
  });

  it('merges provider collaborators with pending Nearbytes invites', async () => {
    const { integrationStatePath, service } = await createHarness();

    await saveIntegrationState(
      {
        version: 1,
        preferredProviders: ['mega'],
        accounts: [
          {
            id: 'acct-mega-1',
            provider: 'mega',
            label: 'MEGA',
            state: 'connected',
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        managedShares: [
          {
            id: 'share-mega-1',
            provider: 'mega',
            accountId: 'acct-mega-1',
            label: 'MEGA share',
            role: 'owner',
            localPath: path.join(path.dirname(integrationStatePath), 'mega-share'),
            syncMode: 'mirror',
            remoteDescriptor: { remotePath: '/nearbytes/MEGA share' },
            capabilities: ['mirror'],
            invitationEmails: ['active@example.com', 'pending@example.com'],
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      },
      integrationStatePath
    );

    const shares = await service.listManagedShares();
    expect(shares.shares[0]?.collaborators).toEqual([
      {
        label: 'active@example.com',
        email: 'active@example.com',
        role: 'writer',
        status: 'active',
        source: 'provider',
      },
      {
        label: 'pending@example.com',
        email: 'pending@example.com',
        status: 'invited',
        source: 'nearbytes',
      },
    ]);
  });

  it('auto-repairs provider source conflicts by merging roots and removing stale metadata', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nearbytes-managed-shares-conflict-'));
    tempDirs.add(tempDir);
    const localRoot = path.join(tempDir, 'local-root');
    const managedRoot = path.join(tempDir, 'managed-root');
    await fs.mkdir(localRoot, { recursive: true });
    await fs.mkdir(managedRoot, { recursive: true });

    const volumeId = 'a'.repeat(130);
    const blockHash = 'b'.repeat(64);
    await fs.mkdir(path.join(localRoot, 'blocks'), { recursive: true });
    await fs.mkdir(path.join(localRoot, 'channels', volumeId), { recursive: true });
    await fs.writeFile(path.join(localRoot, 'blocks', `${blockHash}.bin`), 'block-data', 'utf8');
    await fs.writeFile(
      path.join(localRoot, 'channels', volumeId, 'event.bin'),
      JSON.stringify({
        payload: {
          type: 'CREATE_FILE',
          hash: blockHash,
        },
      }),
      'utf8'
    );
    await fs.writeFile(path.join(managedRoot, 'Nearbytes.html'), 'stale marker\n', 'utf8');
    await fs.writeFile(path.join(managedRoot, 'Nearbytes.json'), '{"legacy":true}\n', 'utf8');

    const rootsConfig: RootsConfig = {
      version: 2,
      sources: [
        {
          id: 'src-local',
          provider: 'local',
          path: localRoot,
          enabled: true,
          writable: true,
          reservePercent: 5,
          opportunisticPolicy: 'drop-older-blocks',
        },
        {
          id: 'src-mega-root',
          provider: 'mega',
          path: managedRoot,
          enabled: true,
          writable: true,
          reservePercent: 5,
          opportunisticPolicy: 'drop-older-blocks',
          integration: {
            kind: 'provider-managed',
            provider: 'mega',
            managedShareId: 'share-mega-1',
          },
        },
      ],
      defaultVolume: {
        destinations: [
          {
            sourceId: 'src-local',
            enabled: true,
            storeEvents: true,
            storeBlocks: true,
            copySourceBlocks: true,
            reservePercent: 5,
            fullPolicy: 'block-writes',
          },
          {
            sourceId: 'src-mega-root',
            enabled: true,
            storeEvents: true,
            storeBlocks: true,
            copySourceBlocks: true,
            reservePercent: 5,
            fullPolicy: 'block-writes',
          },
        ],
      },
      volumes: [],
    };
    const rootsConfigPath = path.join(tempDir, 'roots.json');
    const integrationStatePath = path.join(tempDir, 'integrations.json');
    await fs.writeFile(rootsConfigPath, `${JSON.stringify(rootsConfig, null, 2)}\n`, 'utf8');
    await saveIntegrationState(
      {
        version: 1,
        preferredProviders: ['mega'],
        accounts: [
          {
            id: 'acct-mega-1',
            provider: 'mega',
            label: 'MEGA',
            email: 'owner@example.com',
            state: 'connected',
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        managedShares: [
          {
            id: 'share-mega-1',
            provider: 'mega',
            accountId: 'acct-mega-1',
            label: 'MEGA share',
            role: 'owner',
            localPath: managedRoot,
            sourceId: 'src-mega-root',
            syncMode: 'mirror',
            remoteDescriptor: { remotePath: '/nearbytes/MEGA share' },
            capabilities: ['mirror'],
            invitationEmails: [],
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      },
      integrationStatePath
    );

    const adapter = new ConflictRepairAdapter();
    const storage = new MultiRootStorageBackend(rootsConfig);
    const service = new ManagedShareService({
      storage,
      rootsConfigPath,
      integrationStatePath,
      adapters: [adapter],
    });

    const shares = await service.listManagedShares();

    expect(adapter.ensureSyncCalls).toBeGreaterThanOrEqual(2);
    expect(shares.shares[0]?.state.status).toBe('ready');
    expect(await fs.readFile(path.join(localRoot, 'blocks', `${blockHash}.bin`), 'utf8')).toBe('block-data');
    expect(await fs.readFile(path.join(localRoot, 'channels', volumeId, 'event.bin'), 'utf8')).toContain(blockHash);
    await expect(fs.readFile(path.join(managedRoot, 'blocks', `${blockHash}.bin`), 'utf8')).rejects.toThrow();
    await expect(fs.readFile(path.join(managedRoot, 'channels', volumeId, 'event.bin'), 'utf8')).rejects.toThrow();
    expect(await fs.readFile(path.join(managedRoot, 'Nearbytes.html'), 'utf8')).toContain('Nearbytes storage location');
    await expect(fs.readFile(path.join(managedRoot, 'Nearbytes.json'), 'utf8')).rejects.toThrow();
  });

  it('creates the default MEGA managed share on connect and reuses an existing account-scoped folder', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nearbytes-managed-shares-mega-'));
    tempDirs.add(tempDir);
    const megaRoot = path.join(tempDir, 'MEGA', 'owner-example-com');
    await fs.mkdir(megaRoot, { recursive: true });

    const rootsConfig: RootsConfig = {
      version: 2,
      sources: [
        {
          id: 'src-mega-root',
          provider: 'mega',
          path: megaRoot,
          enabled: true,
          writable: true,
          reservePercent: 5,
          opportunisticPolicy: 'drop-older-blocks',
        },
      ],
      defaultVolume: {
        destinations: [
          {
            sourceId: 'src-mega-root',
            enabled: true,
            storeEvents: true,
            storeBlocks: true,
            copySourceBlocks: true,
            reservePercent: 5,
            fullPolicy: 'block-writes',
          },
        ],
      },
      volumes: [],
    };
    const rootsConfigPath = path.join(tempDir, 'roots.json');
    const integrationStatePath = path.join(tempDir, 'integrations.json');
    await fs.writeFile(rootsConfigPath, `${JSON.stringify(rootsConfig, null, 2)}\n`, 'utf8');
    const managedRoot = path.join(tempDir, 'managed-root');
    await fs.mkdir(managedRoot, { recursive: true });
    const storage = new MultiRootStorageBackend(rootsConfig);
    const service = new ManagedShareService({
      storage,
      rootsConfigPath,
      integrationStatePath,
      mirrorRoot: managedRoot,
      adapters: [new FakeTransportAdapter('mega', 'MEGA', 'Managed folders backed by MEGA.')],
      runtime: {
        mega: {
          remoteBasePath: '/nearbytes',
        },
      },
    });

    await service.connectAccount({
      provider: 'mega',
      accountId: 'acct-mega-1',
      label: 'MEGA',
      email: 'owner@example.com',
      credentials: {
        email: 'owner@example.com',
        password: 'secret',
      },
    });

    const shares = await service.listManagedShares();
    expect(shares.shares).toHaveLength(1);
    expect(shares.shares[0]?.share.label).toBe('nearbytes');
    expect(shares.shares[0]?.share.localPath).toBe(path.resolve(path.join(managedRoot, 'mega', 'owner-example-com')));
    expect(shares.shares[0]?.share.remoteDescriptor.remotePath).toBe('/nearbytes');

    const config = storage.getRootsConfig();
    expect(
      config.sources.some(
        (source) =>
          source.integration?.managedShareId === shares.shares[0]?.share.id &&
          path.resolve(source.path) === path.resolve(path.join(managedRoot, 'mega', 'owner-example-com'))
      )
    ).toBe(true);
  });

  it('adopts active MEGA sync mirrors on connect without duplicating the default base share', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nearbytes-managed-shares-inventory-'));
    tempDirs.add(tempDir);
    const localRoot = path.join(tempDir, 'local-root');
    const rootsConfigPath = path.join(tempDir, 'roots.json');
    const integrationStatePath = path.join(tempDir, 'integrations.json');
    await fs.mkdir(localRoot, { recursive: true });
    await fs.writeFile(
      rootsConfigPath,
      `${JSON.stringify({
        version: 2,
        sources: [
          {
            id: 'src-local',
            provider: 'local',
            path: localRoot,
            enabled: true,
            writable: true,
            reservePercent: 5,
            opportunisticPolicy: 'drop-older-blocks',
          },
        ],
        defaultVolume: { destinations: [] },
        volumes: [],
      }, null, 2)}\n`,
      'utf8'
    );

    const storage = new MultiRootStorageBackend({
      version: 2,
      sources: [
        {
          id: 'src-local',
          provider: 'local',
          path: localRoot,
          enabled: true,
          writable: true,
          reservePercent: 5,
          opportunisticPolicy: 'drop-older-blocks',
        },
      ],
      defaultVolume: { destinations: [] },
      volumes: [],
    });
    const service = new ManagedShareService({
      storage,
      rootsConfigPath,
      integrationStatePath,
      adapters: [
        new MirrorInventoryAdapter([
          {
            label: 'nearbytes',
            localPath: path.join(tempDir, 'MEGA', 'nearbytes'),
            remotePath: '/nearbytes',
          },
          {
            label: 'shared-demo',
            localPath: path.join(tempDir, 'MEGA', 'shared-demo'),
            remotePath: '/nearbytes/shared-demo',
          },
        ]),
      ],
      runtime: {
        mega: {
          remoteBasePath: '/nearbytes',
        },
      },
    });

    await service.connectAccount({
      provider: 'mega',
      accountId: 'acct-mega-1',
      label: 'MEGA',
      email: 'owner@example.com',
      credentials: {
        email: 'owner@example.com',
        password: 'secret',
      },
    });

    const shares = await service.listManagedShares();
    expect(shares.shares.map((entry) => entry.share.remoteDescriptor.remotePath)).toEqual([
      '/nearbytes',
      '/nearbytes/shared-demo',
    ]);
    expect(shares.shares.filter((entry) => entry.share.remoteDescriptor.remotePath === '/nearbytes')).toHaveLength(1);
  });

  it('persists the adapter-resolved local path when creating a managed share', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nearbytes-managed-shares-localpath-'));
    tempDirs.add(tempDir);
    const rootsConfigPath = path.join(tempDir, 'roots.json');
    const integrationStatePath = path.join(tempDir, 'integrations.json');
    const resolvedLocalPath = path.join(tempDir, 'existing-nearbytes');

    await fs.writeFile(
      rootsConfigPath,
      `${JSON.stringify({ version: 2, sources: [], defaultVolume: { destinations: [] }, volumes: [] }, null, 2)}\n`,
      'utf8'
    );

    const storage = new MultiRootStorageBackend({
      version: 2,
      sources: [],
      defaultVolume: { destinations: [] },
      volumes: [],
    });
    const service = new ManagedShareService({
      storage,
      rootsConfigPath,
      integrationStatePath,
      adapters: [new LocalPathOverrideAdapter(resolvedLocalPath)],
    });

    await saveIntegrationState(
      {
        version: 1,
        preferredProviders: [],
        accounts: [
          {
            id: 'acct-mega-1',
            provider: 'mega',
            label: 'MEGA',
            state: 'connected',
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        managedShares: [],
      },
      integrationStatePath
    );

    const summary = await service.createManagedShare({
      provider: 'mega',
      accountId: 'acct-mega-1',
      label: 'nearbytes',
      localPath: path.join(tempDir, 'requested-nearbytes'),
      remoteDescriptor: {
        remotePath: '/nearbytes',
        shareName: 'nearbytes',
      },
    });

    expect(summary.share.localPath).toBe(path.resolve(resolvedLocalPath));
    expect(summary.storage?.sourcePath).toBe(path.resolve(resolvedLocalPath));
    expect(storage.getRootsConfig().sources[0]?.path).toBe(path.resolve(resolvedLocalPath));
  });

  it('defaults generated managed-share mirrors under the local storage root', async () => {
    const { integrationStatePath, localRoot, service } = await createHarness();

    await saveIntegrationState(
      {
        version: 1,
        preferredProviders: [],
        accounts: [
          {
            id: 'acct-mega-1',
            provider: 'mega',
            label: 'MEGA',
            state: 'connected',
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        managedShares: [],
      },
      integrationStatePath
    );

    const summary = await service.createManagedShare({
      provider: 'mega',
      accountId: 'acct-mega-1',
      label: 'nearbytes',
      remoteDescriptor: {
        remotePath: '/nearbytes',
        shareName: 'nearbytes',
      },
    });

    expect(summary.share.localPath).toBe(path.resolve(path.join(localRoot, 'mega', 'acct-mega-1')));
  });

  it('ignores repo-contained provider folders when choosing the default managed share path', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nearbytes-managed-shares-repo-'));
    tempDirs.add(tempDir);
    const localRoot = path.join(tempDir, 'local-root');
    const accidentalRepoRoot = path.join(tempDir, 'repo', 'nearbytes');
    await fs.mkdir(localRoot, { recursive: true });
    await fs.mkdir(accidentalRepoRoot, { recursive: true });

    const rootsConfig: RootsConfig = {
      version: 2,
      sources: [
        {
          id: 'src-local',
          provider: 'local',
          path: localRoot,
          enabled: true,
          writable: true,
          reservePercent: 5,
          opportunisticPolicy: 'drop-older-blocks',
        },
        {
          id: 'src-mega-accidental',
          provider: 'mega',
          path: accidentalRepoRoot,
          enabled: true,
          writable: true,
          reservePercent: 5,
          opportunisticPolicy: 'drop-older-blocks',
        },
      ],
      defaultVolume: {
        destinations: [
          {
            sourceId: 'src-local',
            enabled: true,
            storeEvents: true,
            storeBlocks: true,
            copySourceBlocks: true,
            reservePercent: 5,
            fullPolicy: 'block-writes',
          },
        ],
      },
      volumes: [],
    };

    const rootsConfigPath = path.join(tempDir, 'roots.json');
    const integrationStatePath = path.join(tempDir, 'integrations.json');
    await fs.writeFile(rootsConfigPath, `${JSON.stringify(rootsConfig, null, 2)}\n`, 'utf8');
    const storage = new MultiRootStorageBackend(rootsConfig);
    const service = new ManagedShareService({
      storage,
      rootsConfigPath,
      integrationStatePath,
      adapters: [new FakeTransportAdapter('mega', 'MEGA', 'Managed folders backed by MEGA.')],
      runtime: {
        mega: {
          remoteBasePath: '/nearbytes',
        },
      },
    });

    const fakeRepoRoot = path.join(tempDir, 'repo');
    await fs.mkdir(fakeRepoRoot, { recursive: true });
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(fakeRepoRoot);

    try {
      await service.connectAccount({
        provider: 'mega',
        accountId: 'acct-mega-1',
        label: 'MEGA',
        email: 'owner@example.com',
        credentials: {
          email: 'owner@example.com',
          password: 'secret',
        },
      });
    } finally {
      cwdSpy.mockRestore();
    }

    const shares = await service.listManagedShares();
    expect(shares.shares).toHaveLength(1);
    expect(path.resolve(shares.shares[0]!.share.localPath)).toBe(path.resolve(path.join(localRoot, 'mega', 'owner-example-com')));
    expect(path.resolve(shares.shares[0]!.share.localPath)).not.toBe(path.resolve(accidentalRepoRoot));
  });

  it('separates default MEGA roots by account identity', async () => {
    const { service } = await createHarness();

    const connect = async (accountId: string, email: string) => {
      await service.connectAccount({
        provider: 'mega',
        accountId,
        label: 'MEGA',
        email,
        credentials: {
          email,
          password: 'secret',
        },
      });
      const shares = await service.listManagedShares();
      const share = shares.shares.find((entry) => entry.share.accountId === accountId);
      expect(share).toBeTruthy();
      await service.disconnectAccount(accountId);
      return share!.share.localPath;
    };

    const firstPath = await connect('acct-mega-1', 'owner@example.com');
    const secondPath = await connect('acct-mega-2', 'other@example.com');

    expect(firstPath).not.toBe(secondPath);
    expect(firstPath.endsWith(path.join('mega', 'owner-example-com'))).toBe(true);
    expect(secondPath.endsWith(path.join('mega', 'other-example-com'))).toBe(true);
  });

  it('disconnecting a managed provider removes its shares without silently rerouting other spaces', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nearbytes-managed-shares-disconnect-'));
    tempDirs.add(tempDir);
    const megaRoot = path.join(tempDir, 'MEGA', 'nearbytes');
    const localRoot = path.join(tempDir, 'nearbytes-local');
    await fs.mkdir(megaRoot, { recursive: true });
    await fs.mkdir(localRoot, { recursive: true });

    const rootsConfig: RootsConfig = {
      version: 2,
      sources: [
        {
          id: 'src-mega-root',
          provider: 'mega',
          path: megaRoot,
          enabled: true,
          writable: true,
          reservePercent: 5,
          opportunisticPolicy: 'drop-older-blocks',
          integration: {
            kind: 'provider-managed',
            provider: 'mega',
            managedShareId: 'share-mega-1',
          },
        },
        {
          id: 'src-local-root',
          provider: 'local',
          path: localRoot,
          enabled: true,
          writable: true,
          reservePercent: 5,
          opportunisticPolicy: 'drop-older-blocks',
        },
      ],
      defaultVolume: {
        destinations: [
          {
            sourceId: 'src-mega-root',
            enabled: true,
            storeEvents: true,
            storeBlocks: true,
            copySourceBlocks: true,
            reservePercent: 5,
            fullPolicy: 'block-writes',
          },
        ],
      },
      volumes: [
        {
          volumeId: 'a'.repeat(130),
          destinations: [
            {
              sourceId: 'src-mega-root',
              enabled: true,
              storeEvents: true,
              storeBlocks: true,
              copySourceBlocks: true,
              reservePercent: 5,
              fullPolicy: 'block-writes',
            },
          ],
        },
      ],
    };
    const rootsConfigPath = path.join(tempDir, 'roots.json');
    const integrationStatePath = path.join(tempDir, 'integrations.json');
    await fs.writeFile(rootsConfigPath, `${JSON.stringify(rootsConfig, null, 2)}\n`, 'utf8');
    await saveIntegrationState(
      {
        version: 1,
        preferredProviders: [],
        accounts: [
          {
            id: 'acct-mega-1',
            provider: 'mega',
            label: 'MEGA',
            email: 'owner@example.com',
            state: 'connected',
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        managedShares: [
          {
            id: 'share-mega-1',
            provider: 'mega',
            accountId: 'acct-mega-1',
            label: 'nearbytes',
            role: 'owner',
            localPath: megaRoot,
            sourceId: 'src-mega-root',
            syncMode: 'mirror',
            remoteDescriptor: { remotePath: '/nearbytes', shareName: 'nearbytes' },
            capabilities: ['mirror', 'read', 'write', 'invite'],
            invitationEmails: [],
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      },
      integrationStatePath
    );

    const storage = new MultiRootStorageBackend(rootsConfig);
    const service = new ManagedShareService({
      storage,
      rootsConfigPath,
      integrationStatePath,
      adapters: [new FakeTransportAdapter('mega', 'MEGA', 'Managed folders backed by MEGA.')],
    });

    await service.disconnectAccount('acct-mega-1');

    const nextConfig = storage.getRootsConfig();
    expect(nextConfig.sources.map((source) => source.id)).toEqual(['src-local-root']);
    expect(nextConfig.defaultVolume.destinations).toEqual([]);
    expect(nextConfig.volumes).toEqual([]);
  });

  it('retires stale MEGA inventory entries by migrating their data into the primary local root', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nearbytes-managed-shares-stale-'));
    tempDirs.add(tempDir);
    const localRoot = path.join(tempDir, 'local-root');
    const megaRoot = path.join(tempDir, 'mega-root');
    await fs.mkdir(path.join(localRoot, 'blocks'), { recursive: true });
    await fs.mkdir(path.join(megaRoot, 'blocks'), { recursive: true });
    await fs.mkdir(path.join(megaRoot, 'channels', 'a'.repeat(130)), { recursive: true });
    await fs.writeFile(path.join(megaRoot, 'blocks', '1'.repeat(64) + '.bin'), 'stale-block', 'utf8');
    await fs.writeFile(path.join(megaRoot, 'channels', 'a'.repeat(130), 'event.bin'), 'stale-event', 'utf8');

    const rootsConfig: RootsConfig = {
      version: 2,
      sources: [
        {
          id: 'src-local',
          provider: 'local',
          path: localRoot,
          enabled: true,
          writable: true,
          reservePercent: 5,
          opportunisticPolicy: 'drop-older-blocks',
        },
        {
          id: 'src-mega-root',
          provider: 'mega',
          path: megaRoot,
          enabled: true,
          writable: true,
          reservePercent: 5,
          opportunisticPolicy: 'drop-older-blocks',
          integration: {
            kind: 'provider-managed',
            provider: 'mega',
            managedShareId: 'share-mega-stale',
          },
        },
      ],
      defaultVolume: { destinations: [] },
      volumes: [],
    };
    const rootsConfigPath = path.join(tempDir, 'roots.json');
    const integrationStatePath = path.join(tempDir, 'integrations.json');
    await fs.writeFile(rootsConfigPath, `${JSON.stringify(rootsConfig, null, 2)}\n`, 'utf8');
    await saveIntegrationState(
      {
        version: 1,
        preferredProviders: [],
        accounts: [
          {
            id: 'acct-mega-1',
            provider: 'mega',
            label: 'MEGA',
            email: 'owner@example.com',
            state: 'connected',
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        managedShares: [
          {
            id: 'share-mega-stale',
            provider: 'mega',
            accountId: 'acct-mega-1',
            label: 'stale-share',
            role: 'owner',
            localPath: megaRoot,
            sourceId: 'src-mega-root',
            syncMode: 'mirror',
            remoteDescriptor: { remotePath: '/nearbytes/stale-share', shareName: 'stale-share' },
            capabilities: ['mirror', 'read', 'write', 'invite'],
            invitationEmails: [],
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      },
      integrationStatePath
    );

    const storage = new MultiRootStorageBackend(rootsConfig);
    const service = new ManagedShareService({
      storage,
      rootsConfigPath,
      integrationStatePath,
      adapters: [new MirrorInventoryAdapter([])],
      runtime: {
        mega: {
          remoteBasePath: '/nearbytes',
        },
      },
    });

    const shares = await service.listManagedShares();

    expect(shares.shares.some((entry) => entry.share.remoteDescriptor.remotePath === '/nearbytes/stale-share')).toBe(false);
    expect(await fs.readFile(path.join(localRoot, 'blocks', '1'.repeat(64) + '.bin'), 'utf8')).toBe('stale-block');
    expect(await fs.readFile(path.join(localRoot, 'channels', 'a'.repeat(130), 'event.bin'), 'utf8')).toBe('stale-event');
    await expect(fs.readFile(path.join(megaRoot, 'blocks', '1'.repeat(64) + '.bin'), 'utf8')).rejects.toThrow();
  });

  it('migrates MEGA share data into the primary local root before disconnecting the account', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nearbytes-managed-shares-disconnect-migrate-'));
    tempDirs.add(tempDir);
    const localRoot = path.join(tempDir, 'local-root');
    const megaRoot = path.join(tempDir, 'mega-root');
    await fs.mkdir(path.join(localRoot, 'blocks'), { recursive: true });
    await fs.mkdir(path.join(megaRoot, 'blocks'), { recursive: true });
    await fs.mkdir(path.join(megaRoot, 'channels', 'b'.repeat(130)), { recursive: true });
    await fs.writeFile(path.join(megaRoot, 'blocks', '2'.repeat(64) + '.bin'), 'disconnect-block', 'utf8');
    await fs.writeFile(path.join(megaRoot, 'channels', 'b'.repeat(130), 'event.bin'), 'disconnect-event', 'utf8');

    const rootsConfig: RootsConfig = {
      version: 2,
      sources: [
        {
          id: 'src-local',
          provider: 'local',
          path: localRoot,
          enabled: true,
          writable: true,
          reservePercent: 5,
          opportunisticPolicy: 'drop-older-blocks',
        },
        {
          id: 'src-mega-root',
          provider: 'mega',
          path: megaRoot,
          enabled: true,
          writable: true,
          reservePercent: 5,
          opportunisticPolicy: 'drop-older-blocks',
          integration: {
            kind: 'provider-managed',
            provider: 'mega',
            managedShareId: 'share-mega-1',
          },
        },
      ],
      defaultVolume: { destinations: [] },
      volumes: [],
    };
    const rootsConfigPath = path.join(tempDir, 'roots.json');
    const integrationStatePath = path.join(tempDir, 'integrations.json');
    await fs.writeFile(rootsConfigPath, `${JSON.stringify(rootsConfig, null, 2)}\n`, 'utf8');
    await saveIntegrationState(
      {
        version: 1,
        preferredProviders: [],
        accounts: [
          {
            id: 'acct-mega-1',
            provider: 'mega',
            label: 'MEGA',
            email: 'owner@example.com',
            state: 'connected',
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        managedShares: [
          {
            id: 'share-mega-1',
            provider: 'mega',
            accountId: 'acct-mega-1',
            label: 'nearbytes',
            role: 'owner',
            localPath: megaRoot,
            sourceId: 'src-mega-root',
            syncMode: 'mirror',
            remoteDescriptor: { remotePath: '/nearbytes', shareName: 'nearbytes' },
            capabilities: ['mirror', 'read', 'write', 'invite'],
            invitationEmails: [],
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      },
      integrationStatePath
    );

    const storage = new MultiRootStorageBackend(rootsConfig);
    const service = new ManagedShareService({
      storage,
      rootsConfigPath,
      integrationStatePath,
      adapters: [new MirrorInventoryAdapter([])],
      runtime: {
        mega: {
          remoteBasePath: '/nearbytes',
        },
      },
    });

    await service.disconnectAccount('acct-mega-1');

    expect(await fs.readFile(path.join(localRoot, 'blocks', '2'.repeat(64) + '.bin'), 'utf8')).toBe('disconnect-block');
    expect(await fs.readFile(path.join(localRoot, 'channels', 'b'.repeat(130), 'event.bin'), 'utf8')).toBe('disconnect-event');
    await expect(fs.readFile(path.join(megaRoot, 'blocks', '2'.repeat(64) + '.bin'), 'utf8')).rejects.toThrow();
    expect(storage.getRootsConfig().sources.map((source) => source.id)).toEqual(['src-local']);
  });

  it('relocates an existing MEGA base share and merges its files into the primary local root', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nearbytes-managed-shares-relocate-'));
    tempDirs.add(tempDir);
    const megaRoot = path.join(tempDir, 'MEGA', 'nearbytes');
    const localRoot = path.join(tempDir, 'local-root');
    const managedRoot = path.join(tempDir, 'managed-root');
    await fs.mkdir(megaRoot, { recursive: true });
    await fs.mkdir(localRoot, { recursive: true });
    await fs.mkdir(managedRoot, { recursive: true });
    await fs.mkdir(path.join(megaRoot, 'blocks'), { recursive: true });
    await fs.mkdir(path.join(megaRoot, 'channels', 'demo-volume'), { recursive: true });
    await fs.writeFile(path.join(megaRoot, 'blocks', 'legacy.bin'), 'legacy-block', 'utf8');
    await fs.writeFile(path.join(megaRoot, 'channels', 'demo-volume', 'event.bin'), 'legacy-event', 'utf8');

    const rootsConfig: RootsConfig = {
      version: 2,
      sources: [
        {
          id: 'src-local',
          provider: 'local',
          path: localRoot,
          enabled: true,
          writable: true,
          reservePercent: 5,
          opportunisticPolicy: 'drop-older-blocks',
        },
        {
          id: 'src-mega-root',
          provider: 'mega',
          path: megaRoot,
          enabled: true,
          writable: true,
          reservePercent: 5,
          opportunisticPolicy: 'drop-older-blocks',
          integration: {
            kind: 'provider-managed',
            provider: 'mega',
            managedShareId: 'share-mega-1',
          },
        },
      ],
      defaultVolume: {
        destinations: [],
      },
      volumes: [],
    };
    const rootsConfigPath = path.join(tempDir, 'roots.json');
    const integrationStatePath = path.join(tempDir, 'integrations.json');
    await fs.writeFile(rootsConfigPath, `${JSON.stringify(rootsConfig, null, 2)}\n`, 'utf8');
    await saveIntegrationState(
      {
        version: 1,
        preferredProviders: [],
        accounts: [
          {
            id: 'acct-mega-1',
            provider: 'mega',
            label: 'MEGA',
            email: 'owner@example.com',
            state: 'connected',
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        managedShares: [
          {
            id: 'share-mega-1',
            provider: 'mega',
            accountId: 'acct-mega-1',
            label: 'nearbytes',
            role: 'owner',
            localPath: megaRoot,
            sourceId: 'src-mega-root',
            syncMode: 'mirror',
            remoteDescriptor: { remotePath: '/nearbytes', shareName: 'nearbytes' },
            capabilities: ['mirror', 'read', 'write', 'invite'],
            invitationEmails: [],
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      },
      integrationStatePath
    );

    const storage = new MultiRootStorageBackend(rootsConfig);
    const service = new ManagedShareService({
      storage,
      rootsConfigPath,
      integrationStatePath,
      mirrorRoot: managedRoot,
      adapters: [new FakeTransportAdapter('mega', 'MEGA', 'Managed folders backed by MEGA.')],
      runtime: {
        mega: {
          remoteBasePath: '/nearbytes',
        },
      },
    });

    const shares = await service.listManagedShares();
    expect(shares.shares).toHaveLength(1);
    expect(shares.shares[0]?.share.localPath).toBe(path.resolve(path.join(managedRoot, 'mega', 'owner-example-com')));

    const nextConfig = storage.getRootsConfig();
    expect(nextConfig.sources.some((source) => source.id === 'src-mega-root')).toBe(false);
    expect(nextConfig.sources.find((source) => source.id === 'src-local')?.path).toBe(path.resolve(localRoot));
    expect(
      nextConfig.sources.some(
        (source) =>
          source.integration?.managedShareId === shares.shares[0]?.share.id &&
          path.resolve(source.path) === path.resolve(path.join(managedRoot, 'mega', 'owner-example-com'))
      )
    ).toBe(true);

    expect(await fs.readFile(path.join(localRoot, 'blocks', 'legacy.bin'), 'utf8')).toBe('legacy-block');
    expect(await fs.readFile(path.join(localRoot, 'channels', 'demo-volume', 'event.bin'), 'utf8')).toBe('legacy-event');
    await expect(fs.readFile(path.join(megaRoot, 'blocks', 'legacy.bin'), 'utf8')).rejects.toThrow();
  });

  it('bootstraps a provider account from a join link when explicitly allowed', async () => {
    const { service } = await createHarness();

    const opened = await service.openJoinLink(
      {
        allowCredentialBootstrap: true,
        volumeId: 'b'.repeat(130),
        link: {
          p: 'nb.join.v1',
          space: {
            mode: 'seed',
            value: 'demo-space',
          },
          attachments: [
            {
              id: 'att-mega',
              label: 'Shared MEGA mirror',
              recipe: {
                p: 'nb.transport.recipe.v1',
                id: 'recipe-mega',
                label: 'Shared MEGA mirror',
                purpose: 'mirror',
                endpoints: [
                  {
                    p: 'nb.transport.endpoint.v1',
                    transport: 'provider-share',
                    provider: 'mega',
                    priority: 100,
                    capabilities: ['mirror', 'read', 'write'],
                    descriptor: {
                      remotePath: '/nearbytes/shared-demo',
                    },
                    bootstrap: {
                      account: {
                        mode: 'login',
                        email: 'invitee@example.com',
                        credentials: {
                          email: 'invitee@example.com',
                          password: 'secret',
                        },
                      },
                      storage: {
                        localPathHint: path.join(os.tmpdir(), 'nearbytes-shared-demo'),
                      },
                    },
                  },
                ],
              },
            },
          ],
        },
      },
      {
        callbackBaseUrl: 'http://localhost:5173',
      }
    );

    expect(opened.secret).toBe('demo-space');
    expect(opened.actions[0]?.status).toBe('attached');
    expect(opened.actions[0]?.usedCredentialBootstrap).toBe(true);
    expect(opened.actions[0]?.accountId).toBeTruthy();

    const accounts = await service.listAccounts();
    expect(accounts.accounts[0]?.provider).toBe('mega');
    const shares = await service.listManagedShares();
    expect(shares.shares.some((summary) => summary.share.remoteDescriptor.remotePath === '/nearbytes/shared-demo')).toBe(true);
  });

  it('matches an existing share by concrete remote path without creating a duplicate', async () => {
    const { integrationStatePath, service } = await createHarness();

    await saveIntegrationState(
      {
        version: 1,
        preferredProviders: [],
        accounts: [
          {
            id: 'acct-mega-1',
            provider: 'mega',
            label: 'MEGA',
            email: 'owner@example.com',
            state: 'connected',
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        managedShares: [
          {
            id: 'share-mega-1',
            provider: 'mega',
            accountId: 'acct-mega-1',
            label: 'Shared demo',
            role: 'recipient',
            localPath: path.join(path.dirname(integrationStatePath), 'shared-demo'),
            sourceId: 'src-local',
            syncMode: 'mirror',
            remoteDescriptor: {
              remotePath: '/nearbytes/shared-demo',
            },
            capabilities: ['mirror', 'read', 'write'],
            invitationEmails: [],
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      },
      integrationStatePath
    );

    const opened = await service.openJoinLink({
      volumeId: 'c'.repeat(130),
      link: {
        p: 'nb.join.v1',
        space: {
          mode: 'seed',
          value: 'demo-space',
        },
        attachments: [
          {
            id: 'att-mega',
            label: 'Shared MEGA mirror',
            recipe: {
              p: 'nb.transport.recipe.v1',
              id: 'recipe-mega',
              label: 'Shared MEGA mirror',
              purpose: 'mirror',
              endpoints: [
                {
                  p: 'nb.transport.endpoint.v1',
                  transport: 'provider-share',
                  provider: 'mega',
                  priority: 100,
                  capabilities: ['mirror', 'read', 'write'],
                  descriptor: {
                    remotePath: '/nearbytes/shared-demo',
                  },
                },
              ],
            },
          },
        ],
      },
    });

    expect(opened.actions[0]?.status).toBe('attached');
    expect(opened.actions[0]?.shareId).toBe('share-mega-1');

    const shares = await service.listManagedShares();
    expect(shares.shares).toHaveLength(1);
  });
});
