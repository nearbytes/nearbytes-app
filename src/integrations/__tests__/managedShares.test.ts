import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import type { RootsConfig } from '../../config/roots.js';
import { MultiRootStorageBackend } from '../../storage/multiRoot.js';
import type { TransportAdapter } from '../adapters.js';
import { ManagedShareService } from '../managedShares.js';
import { saveIntegrationState } from '../store.js';
import type { ProviderAccount, TransportEndpoint, TransportState } from '../types.js';

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
            remoteDescriptor: { remotePath: '/Nearbytes/MEGA share' },
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
});
