import { describe, expect, it, vi } from 'vitest';

import { openJoinLinkWithRuntime } from './joinLinkOpen.js';

describe('joinLinkOpen', () => {
  it('opens links locally when they only need planning and mount state', async () => {
    const connectProviderAccount = vi.fn();
    const acceptManagedShare = vi.fn();
    const attachManagedShare = vi.fn();

    const response = await openJoinLinkWithRuntime(
      {
        serialized: '{"p":"nb.join.v1","space":{"mode":"seed","value":"alpha"},"attachments":[]}',
      },
      {
        listProviderAccounts: async () => ({ accounts: [], preferredProviders: [] }),
        listManagedShares: async () => ({ shares: [] }),
        connectProviderAccount,
        acceptManagedShare,
        attachManagedShare,
        previewJoinLink: async () => ({
          plan: {
            link: {
              p: 'nb.join.v1',
              space: { mode: 'seed', value: 'alpha' },
              attachments: [],
            },
            attachments: [],
          },
          space: { mode: 'seed', value: 'alpha' },
        }),
      }
    );

    expect(response.secret).toBe('alpha');
    expect(response.volumeId).toBeNull();
    expect(response.actions).toEqual([]);
    expect(connectProviderAccount).not.toHaveBeenCalled();
    expect(acceptManagedShare).not.toHaveBeenCalled();
    expect(attachManagedShare).not.toHaveBeenCalled();
  });

  it('attaches an already matched managed share through the runtime primitive', async () => {
    const attachManagedShare = vi.fn(async () => ({ summary: {} }));

    const response = await openJoinLinkWithRuntime(
      {
        serialized: '{}',
        volumeId: 'ab'.repeat(65),
      },
      {
        listProviderAccounts: async () => ({
          accounts: [
            { id: 'acct-1', provider: 'mega', state: 'connected' },
          ] as never,
          preferredProviders: [],
        }),
        listManagedShares: async () => ({
          shares: [
            {
              share: {
                id: 'share-1',
                provider: 'mega',
                remoteDescriptor: { remoteId: 'remote-1' },
              },
              attachments: [{ id: 'attachment-1' }],
            },
          ] as never,
        }),
        connectProviderAccount: vi.fn(),
        acceptManagedShare: vi.fn(),
        attachManagedShare,
        previewJoinLink: async () => ({
          plan: {
            link: {
              p: 'nb.join.v1',
              space: { mode: 'seed', value: 'alpha' },
              attachments: [],
            },
            attachments: [
              {
                attachment: { id: 'attachment-1', label: 'MEGA route' },
                selectedEndpoint: {
                  endpoint: {
                    transport: 'provider-share',
                    provider: 'mega',
                    descriptor: { remoteId: 'remote-1' },
                  },
                  matchKey: 'mega:remote:remote-1',
                  reason: 'This route is already attached on this device.',
                },
                candidates: [],
              },
            ],
          },
          space: { mode: 'seed', value: 'alpha' },
        } as never),
      }
    );

    expect(attachManagedShare).toHaveBeenCalledWith('share-1', 'ab'.repeat(65));
    expect(response.actions[0]?.status).toBe('attached');
    expect(response.actions[0]?.shareId).toBe('share-1');
  });

  it('creates a managed share when a connected provider route has no existing match', async () => {
    const acceptManagedShare = vi.fn(async () => ({
      summary: {
        share: { id: 'share-new' },
      },
    }));

    const response = await openJoinLinkWithRuntime(
      {
        serialized: '{}',
        volumeId: 'cd'.repeat(65),
      },
      {
        listProviderAccounts: async () => ({
          accounts: [
            { id: 'acct-1', provider: 'gdrive', state: 'connected' },
          ] as never,
          preferredProviders: [],
        }),
        listManagedShares: async () => ({ shares: [] }),
        connectProviderAccount: vi.fn(),
        acceptManagedShare,
        attachManagedShare: vi.fn(),
        previewJoinLink: async () => ({
          plan: {
            link: {
              p: 'nb.join.v1',
              space: { mode: 'volume-id', value: 'cd'.repeat(65) },
              attachments: [],
            },
            attachments: [
              {
                attachment: { id: 'attachment-1', label: 'Drive route' },
                selectedEndpoint: {
                  endpoint: {
                    transport: 'provider-share',
                    provider: 'gdrive',
                    descriptor: { remoteId: 'drive-9', localPathHint: '/nearbytes/Drive 9' },
                  },
                  matchKey: 'gdrive:remote:drive-9',
                  reason: 'A connected provider account is already available for this route.',
                },
                candidates: [],
              },
            ],
          },
          space: { mode: 'volume-id', value: 'cd'.repeat(65) },
        } as never),
      }
    );

    expect(acceptManagedShare).toHaveBeenCalledWith({
      provider: 'gdrive',
      accountId: 'acct-1',
      label: 'Drive route',
      volumeId: 'cd'.repeat(65),
      localPath: '/nearbytes/Drive 9',
      remoteDescriptor: { remoteId: 'drive-9', localPathHint: '/nearbytes/Drive 9' },
    });
    expect(response.actions[0]?.status).toBe('attached');
    expect(response.actions[0]?.shareId).toBe('share-new');
  });

  it('downgrades provider attachment to a planned action when the phone runtime is missing', async () => {
    const response = await openJoinLinkWithRuntime(
      {
        serialized: '{}',
        volumeId: 'ef'.repeat(65),
      },
      {
        listProviderAccounts: async () => ({
          accounts: [
            { id: 'acct-1', provider: 'mega', state: 'connected' },
          ] as never,
          preferredProviders: [],
        }),
        listManagedShares: async () => ({ shares: [] }),
        connectProviderAccount: vi.fn(),
        acceptManagedShare: vi.fn(async () => {
          throw new Error('Phone runtime capability is not implemented in the embedded phone host yet.');
        }),
        attachManagedShare: vi.fn(),
        previewJoinLink: async () => ({
          plan: {
            link: {
              p: 'nb.join.v1',
              space: { mode: 'volume-id', value: 'ef'.repeat(65) },
              attachments: [],
            },
            attachments: [
              {
                attachment: { id: 'attachment-1', label: 'MEGA route' },
                selectedEndpoint: {
                  endpoint: {
                    transport: 'provider-share',
                    provider: 'mega',
                    descriptor: { remoteId: 'remote-1' },
                  },
                  matchKey: 'mega:remote:remote-1',
                  reason: 'A connected provider account is already available for this route.',
                },
                candidates: [],
              },
            ],
          },
          space: { mode: 'volume-id', value: 'ef'.repeat(65) },
        } as never),
      }
    );

    expect(response.actions[0]).toMatchObject({
      status: 'planned',
      provider: 'mega',
    });
  });
});