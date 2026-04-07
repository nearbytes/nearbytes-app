import { beforeEach, describe, expect, it, vi } from 'vitest';

const { listProviderAccountsMock, listManagedSharesMock } = vi.hoisted(() => ({
  listProviderAccountsMock: vi.fn(),
  listManagedSharesMock: vi.fn(),
}));

vi.mock('./api.js', () => ({
  listProviderAccounts: listProviderAccountsMock,
  listManagedShares: listManagedSharesMock,
}));

import {
  buildAttachedShareKeysFromSummaries,
  parseJoinLinkInput,
  previewJoinLink,
} from './joinLinkPreview.js';

describe('joinLinkPreview', () => {
  beforeEach(() => {
    listProviderAccountsMock.mockReset();
    listManagedSharesMock.mockReset();
  });

  it('parses a canonical join link locally and plans it against local provider state', async () => {
    listProviderAccountsMock.mockResolvedValue({
      accounts: [
        {
          id: 'acct-mega',
          provider: 'mega',
          state: 'connected',
        },
      ],
      providers: [
        {
          provider: 'mega',
        },
      ],
      preferredProviders: ['mega'],
    });
    listManagedSharesMock.mockResolvedValue({
      shares: [
        {
          share: {
            id: 'share-1',
            provider: 'mega',
            remoteDescriptor: {
              remoteId: 'share-remote-1',
            },
          },
          attachments: [{ id: 'attachment-1' }],
        },
      ],
    });

    const preview = await previewJoinLink({
      serialized: JSON.stringify({
        p: 'nb.join.v1',
        space: {
          mode: 'seed',
          value: 'join-seed',
        },
        attachments: [
          {
            id: 'attachment-main',
            label: 'Main route',
            recipe: {
              p: 'nb.transport.recipe.v1',
              id: 'recipe-main',
              label: 'Main route',
              purpose: 'mirror',
              endpoints: [
                {
                  p: 'nb.transport.endpoint.v1',
                  transport: 'provider-share',
                  provider: 'mega',
                  priority: 100,
                  capabilities: ['mirror', 'read', 'write'],
                  descriptor: {
                    remoteId: 'share-remote-1',
                  },
                },
              ],
            },
          },
        ],
      }),
    });

    expect(preview.space).toEqual({
      mode: 'seed',
      value: 'join-seed',
    });
    expect(preview.plan.attachments[0]?.selectedEndpoint?.badges).toContain('Already available');
    expect(preview.plan.attachments[0]?.selectedEndpoint?.endpoint.provider).toBe('mega');
  });

  it('still previews links when provider state requests fail', async () => {
    listProviderAccountsMock.mockRejectedValue(new Error('offline'));
    listManagedSharesMock.mockRejectedValue(new Error('offline'));

    const preview = await previewJoinLink({
      serialized: JSON.stringify({
        p: 'nb.join.v1',
        space: {
          mode: 'volume-id',
          value: 'ab'.repeat(65),
        },
        attachments: [],
      }),
    });

    expect(preview.space.mode).toBe('volume-id');
    expect(preview.plan.link.attachments).toEqual([]);
  });

  it('derives attached share keys from local share summaries', () => {
    expect(
      buildAttachedShareKeysFromSummaries([
        {
          share: {
            id: 'share-1',
            provider: 'github',
            remoteDescriptor: {
              repoOwner: 'Nearbytes',
              repoName: 'Nearbytes-App',
              branch: 'main',
              basePath: 'sync',
            },
          },
          attachments: [{ id: 'attachment-1' }],
        },
      ] as never)
    ).toContain('github:repo:nearbytes/nearbytes-app:main:sync');
  });

  it('rejects invalid serialized payloads before any backend route call', () => {
    expect(() => parseJoinLinkInput('{not json')).toThrow('This Nearbytes join link is not valid JSON.');
    expect(listProviderAccountsMock).not.toHaveBeenCalled();
    expect(listManagedSharesMock).not.toHaveBeenCalled();
  });
});