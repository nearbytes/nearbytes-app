import { describe, expect, it } from 'vitest';
import { planJoinLink, createPlannerContext } from '../planner.js';
import type { JoinLink } from '../types.js';

describe('transport planner', () => {
  const link: JoinLink = {
    p: 'nb.join.v1',
    space: {
      mode: 'seed',
      value: 'space-seed',
    },
    attachments: [
      {
        id: 'att-main',
        label: 'Primary mirror',
        recipe: {
          p: 'nb.transport.recipe.v1',
          id: 'recipe-main',
          label: 'Primary mirror',
          purpose: 'mirror',
          endpoints: [
            {
              p: 'nb.transport.endpoint.v1',
              transport: 'provider-share',
              provider: 'mega',
              priority: 100,
              capabilities: ['mirror', 'read', 'write'],
              descriptor: {
                remoteId: 'mega-share-1',
              },
            },
            {
              p: 'nb.transport.endpoint.v1',
              transport: 'provider-share',
              provider: 'gdrive',
              priority: 80,
              capabilities: ['mirror', 'read', 'write'],
              descriptor: {
                remoteId: 'drive-share-1',
              },
            },
            {
              p: 'nb.transport.endpoint.v1',
              transport: 'peer-http',
              priority: 90,
              capabilities: ['read'],
              descriptor: {
                host: '192.168.1.10',
                port: 9443,
              },
            },
          ],
        },
      },
    ],
  };

  it('prefers already attached routes above everything else', () => {
    const planned = planJoinLink(
      link,
      createPlannerContext({
        attachedShareKeys: ['gdrive:remote:drive-share-1'],
        connectedProviders: ['mega'],
        supportedProviders: ['gdrive', 'mega'],
      })
    );

    expect(planned.attachments[0]?.selectedEndpoint?.endpoint.provider).toBe('gdrive');
    expect(planned.attachments[0]?.selectedEndpoint?.badges).toContain('Already available');
  });

  it('prefers no-login peer routes before disconnected provider routes', () => {
    const planned = planJoinLink(
      link,
      createPlannerContext({
        supportedProviders: ['gdrive', 'mega'],
      })
    );

    expect(planned.attachments[0]?.selectedEndpoint?.endpoint.transport).toBe('peer-http');
    expect(planned.attachments[0]?.selectedEndpoint?.badges).toContain('LAN');
  });

  it('prefers connected providers over disconnected provider routes', () => {
    const planned = planJoinLink(
      {
        ...link,
        attachments: [
          {
            ...link.attachments[0]!,
            recipe: {
              ...link.attachments[0]!.recipe,
              endpoints: link.attachments[0]!.recipe.endpoints.filter((endpoint) => endpoint.transport === 'provider-share'),
            },
          },
        ],
      },
      createPlannerContext({
        connectedProviders: ['mega'],
        supportedProviders: ['gdrive', 'mega'],
      })
    );

    expect(planned.attachments[0]?.selectedEndpoint?.endpoint.provider).toBe('mega');
    expect(planned.attachments[0]?.selectedEndpoint?.badges).toContain('Connected');
  });

  it('honors preferred providers after connection state', () => {
    const planned = planJoinLink(
      {
        ...link,
        attachments: [
          {
            ...link.attachments[0]!,
            recipe: {
              ...link.attachments[0]!.recipe,
              endpoints: link.attachments[0]!.recipe.endpoints.filter((endpoint) => endpoint.transport === 'provider-share'),
            },
          },
        ],
      },
      createPlannerContext({
        connectedProviders: ['mega', 'gdrive'],
        preferredProviders: ['gdrive'],
        supportedProviders: ['gdrive', 'mega'],
      })
    );

    expect(planned.attachments[0]?.selectedEndpoint?.endpoint.provider).toBe('gdrive');
    expect(planned.attachments[0]?.selectedEndpoint?.badges).toContain('Recommended');
  });

  it('keeps unsupported endpoints in the plan but never auto-selects them', () => {
    const planned = planJoinLink(
      {
        ...link,
        attachments: [
          {
            ...link.attachments[0]!,
            recipe: {
              ...link.attachments[0]!.recipe,
              endpoints: [
                {
                  p: 'nb.transport.endpoint.v1',
                  transport: 'github-release',
                  provider: 'github',
                  priority: 10,
                  capabilities: ['read'],
                  descriptor: { repo: 'nearbytes/nearbytes-app' },
                },
              ],
            },
          },
        ],
      },
      createPlannerContext({
        supportedProviders: ['gdrive', 'mega'],
      })
    );

    expect(planned.attachments[0]?.selectedEndpoint).toBeNull();
    expect(planned.attachments[0]?.candidates[0]?.badges).toContain('Experimental');
  });

  it('surfaces bootstrap and storage hints in candidate badges', () => {
    const planned = planJoinLink(
      {
        ...link,
        attachments: [
          {
            ...link.attachments[0]!,
            recipe: {
              ...link.attachments[0]!.recipe,
              endpoints: [
                {
                  p: 'nb.transport.endpoint.v1',
                  transport: 'provider-share',
                  provider: 'mega',
                  priority: 100,
                  capabilities: ['mirror', 'read', 'write'],
                  descriptor: {
                    remotePath: '/nearbytes/shared-alpha',
                  },
                  bootstrap: {
                    account: {
                      mode: 'login',
                      credentials: {
                        email: 'invitee@example.com',
                        password: 'secret',
                      },
                    },
                    storage: {
                      localPathHint: 'D:/Nearbytes Shared/Alpha',
                    },
                  },
                },
              ],
            },
          },
        ],
      },
      createPlannerContext({
        supportedProviders: ['mega'],
      })
    );

    expect(planned.attachments[0]?.selectedEndpoint?.badges).toContain('Sign-in included');
    expect(planned.attachments[0]?.selectedEndpoint?.badges).toContain('Suggested folder');
  });
});
