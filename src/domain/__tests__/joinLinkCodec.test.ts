import { describe, expect, it } from 'vitest';
import {
  joinLinkSpaceToOpenSecret,
  parseJoinLink,
  parseJoinLinkJson,
  serializeJoinLink,
} from '../joinLinkCodec.js';
import type { JoinLink } from '../../integrations/types.js';

describe('joinLinkCodec', () => {
  const sample: JoinLink = {
    p: 'nb.join.v1',
    space: {
      mode: 'seed',
      value: 'space-seed',
      password: 'space-pass',
    },
    attachments: [
      {
        id: 'att-gdrive',
        label: 'Primary cloud mirror',
        recipe: {
          p: 'nb.transport.recipe.v1',
          id: 'recipe-1',
          label: 'Recommended routes',
          purpose: 'mirror',
          endpoints: [
            {
              p: 'nb.transport.endpoint.v1',
              transport: 'provider-share',
              provider: 'gdrive',
              priority: 100,
              capabilities: ['mirror', 'read', 'write', 'invite'],
              descriptor: {
                remoteId: 'drive-folder-1',
                ownerHint: 'owner@example.com',
              },
              badges: ['Primary'],
            },
            {
              p: 'nb.transport.endpoint.v1',
              transport: 'http',
              priority: 150,
              capabilities: ['read'],
              descriptor: {
                url: 'https://example.test/nearbytes/share.json',
              },
            },
          ],
        },
      },
    ],
  };

  it('round-trips canonical join links', () => {
    const serialized = serializeJoinLink(sample);
    const parsed = parseJoinLinkJson(serialized);
    expect(parsed).toEqual(sample);
  });

  it('accepts unknown endpoint kinds without failing the recipe', () => {
    const parsed = parseJoinLink({
      p: 'nb.join.v1',
      space: {
        mode: 'seed',
        value: 'x',
      },
      attachments: [
        {
          id: 'att-1',
          label: 'Mixed routes',
          recipe: {
            p: 'nb.transport.recipe.v1',
            id: 'recipe-1',
            label: 'Future proof',
            endpoints: [
              {
                p: 'nb.transport.endpoint.v1',
                transport: 'github-release',
                priority: 120,
                capabilities: ['read'],
                descriptor: {
                  repo: 'nearbytes/nearbytes-app',
                },
              },
            ],
          },
        },
      ],
    });

    expect(parsed.attachments[0]?.recipe.endpoints[0]?.transport).toBe('github-release');
  });

  it('converts secret-file payloads into bytes for the opener', () => {
    const resolved = joinLinkSpaceToOpenSecret({
      mode: 'secret-file',
      name: 'space.secret',
      mime: 'application/octet-stream',
      payload: 'aGVsbG8',
    });

    expect(resolved.mode).toBe('secret-file');
    if (resolved.mode !== 'secret-file') {
      throw new Error('Expected secret-file mode');
    }
    expect(new TextDecoder().decode(resolved.payload)).toBe('hello');
  });

  it('rejects duplicate attachment ids', () => {
    expect(() =>
      parseJoinLink({
        p: 'nb.join.v1',
        space: {
          mode: 'seed',
          value: 'x',
        },
        attachments: [
          {
            id: 'dup',
            label: 'A',
            recipe: {
              p: 'nb.transport.recipe.v1',
              id: 'recipe-a',
              label: 'A',
              endpoints: [
                {
                  p: 'nb.transport.endpoint.v1',
                  transport: 'http',
                  priority: 100,
                  capabilities: ['read'],
                  descriptor: { url: 'https://example.test/a' },
                },
              ],
            },
          },
          {
            id: 'dup',
            label: 'B',
            recipe: {
              p: 'nb.transport.recipe.v1',
              id: 'recipe-b',
              label: 'B',
              endpoints: [
                {
                  p: 'nb.transport.endpoint.v1',
                  transport: 'http',
                  priority: 100,
                  capabilities: ['read'],
                  descriptor: { url: 'https://example.test/b' },
                },
              ],
            },
          },
        ],
      })
    ).toThrow(/Duplicate join attachment id/);
  });
});
