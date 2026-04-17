import { describe, expect, it, vi } from 'vitest';

import { createIntegrationRuntime } from '../runtime.js';

describe('integration runtime', () => {
  it('creates a runtime without requiring process globals', () => {
    const runtimeGlobals = globalThis as typeof globalThis & { process?: unknown };
    const originalProcess = runtimeGlobals.process;
    vi.stubGlobal('process', undefined);

    try {
      const runtime = createIntegrationRuntime({
        secretStore: {
          async get() { return null; },
          async set() {},
          async delete() {},
        },
      });
      expect(runtime.mega.remoteBasePath).toBe('/nearbytes');
      expect(runtime.google.clientId).toBeDefined();
      expect(runtime.github.deviceCodeUrl).toBe('https://github.com/login/device/code');
    } finally {
      vi.stubGlobal('process', originalProcess);
    }
  });
});