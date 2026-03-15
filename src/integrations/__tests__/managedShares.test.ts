import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import type { RootsConfig } from '../../config/roots.js';
import { MultiRootStorageBackend } from '../../storage/multiRoot.js';
import type { TransportAdapter } from '../adapters.js';
import { ManagedShareService } from '../managedShares.js';
import { saveIntegrationState } from '../store.js';
import type { ConnectProviderAccountInput, ConnectProviderAccountResult, ProviderAccount, TransportEndpoint, TransportState } from '../types.js';

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

  async getState(): Promise<TransportState> {
    return {
      status: 'ready',
      detail: `${this.label} is ready.`,
      badges: ['Fake'],
    };
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
}

const tempDirs = new Set<string>();

async function createHarness(): Promise<{
  integrationStatePath: string;
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

  it('creates the default MEGA managed share on connect and reuses an existing nearbytes folder', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nearbytes-managed-shares-mega-'));
    tempDirs.add(tempDir);
    const megaRoot = path.join(tempDir, 'MEGA', 'nearbytes');
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
    expect(shares.shares[0]?.share.localPath).toBe(path.resolve(megaRoot));
    expect(shares.shares[0]?.share.remoteDescriptor.remotePath).toBe('/nearbytes');

    const config = storage.getRootsConfig();
    expect(config.sources[0]?.integration?.managedShareId).toBe(shares.shares[0]?.share.id);
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
