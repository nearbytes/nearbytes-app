import { describe, expect, it } from 'vitest';

import { resolveActiveHubAuth } from './activeHub.js';

describe('resolveActiveHubAuth', () => {
  it('prefers runtime auth when available', () => {
    expect(
      resolveActiveHubAuth({
        runtimeAuth: { type: 'token', token: 'runtime-token' },
        currentAuth: { type: 'secret', secret: 'current-secret' },
        activeMountSecret: 'mount-secret',
        mountedSecretForVolumeId: 'fallback-secret',
      })
    ).toEqual({ type: 'token', token: 'runtime-token' });
  });

  it('falls back to current auth before mounted secrets', () => {
    expect(
      resolveActiveHubAuth({
        currentAuth: { type: 'secret', secret: 'current-secret' },
        activeMountSecret: 'mount-secret',
        mountedSecretForVolumeId: 'fallback-secret',
      })
    ).toEqual({ type: 'secret', secret: 'current-secret' });
  });

  it('uses the active mount secret when runtime auth is missing', () => {
    expect(
      resolveActiveHubAuth({
        activeMountSecret: '  mount-secret  ',
      })
    ).toEqual({ type: 'secret', secret: 'mount-secret' });
  });

  it('uses a known mounted secret for the active volume when needed', () => {
    expect(
      resolveActiveHubAuth({
        mountedSecretForVolumeId: 'volume-secret',
      })
    ).toEqual({ type: 'secret', secret: 'volume-secret' });
  });

  it('returns null when no usable auth is available', () => {
    expect(
      resolveActiveHubAuth({
        activeMountSecret: '   ',
        mountedSecretForVolumeId: '',
      })
    ).toBeNull();
  });
});