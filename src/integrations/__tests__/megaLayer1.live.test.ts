import { describe, expect, it } from 'vitest';
import { MegaApiClient } from '../mega/protocol.js';
import { createMegaPasswordSession } from '../mega/auth.js';
import { loadMegaLiveEnv } from '../mega/liveTestEnv.js';

describe('MEGA layer 1 live', () => {
  it(
    'authenticates a real account and completes a lightweight authenticated request',
    async () => {
      loadMegaLiveEnv(['NEARBYTES_E2E_MEGA_OWNER_EMAIL', 'NEARBYTES_E2E_MEGA_PASSWORD']);
      const email = process.env.NEARBYTES_E2E_MEGA_OWNER_EMAIL!;
      const password = process.env.NEARBYTES_E2E_MEGA_PASSWORD!;
      const apiClient = new MegaApiClient();

      const loginStartedAt = performance.now();
      const session = await createMegaPasswordSession(apiClient, undefined, email, password);
      const loginDurationMs = Math.round(performance.now() - loginStartedAt);

      const userStartedAt = performance.now();
      const response = await apiClient.requestSingle<Record<string, unknown>>({ a: 'ug' }, { sessionId: session.sid });
      const userDurationMs = Math.round(performance.now() - userStartedAt);

      console.log('[mega-layer1-live]', {
        loginDurationMs,
        userDurationMs,
        totalDurationMs: loginDurationMs + userDurationMs,
        userHandle: session.userHandle,
      });

      expect(session.sid.length).toBeGreaterThan(10);
      expect(session.userHandle.trim().length).toBeGreaterThan(0);
      expect(response).toBeTruthy();
      expect(loginDurationMs).toBeLessThan(60_000);
      expect(userDurationMs).toBeLessThan(15_000);
    },
    75_000
  );
});
