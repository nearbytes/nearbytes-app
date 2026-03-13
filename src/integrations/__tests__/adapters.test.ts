import { describe, expect, it } from 'vitest';
import { createDefaultTransportAdapters } from '../adapters.js';
import { createIntegrationRuntime, type ProviderSecretStore } from '../runtime.js';

function createMemorySecretStore(): ProviderSecretStore {
  const values = new Map<string, unknown>();
  return {
    async get<T>(key: string): Promise<T | null> {
      return (values.get(key) as T | undefined) ?? null;
    },
    async set<T>(key: string, value: T): Promise<void> {
      values.set(key, value);
    },
    async delete(key: string): Promise<void> {
      values.delete(key);
    },
  };
}

describe('createDefaultTransportAdapters', () => {
  it('omits Google Drive when the compiled feature flag is off', () => {
    const runtime = createIntegrationRuntime({
      secretStore: createMemorySecretStore(),
    });

    const providers = createDefaultTransportAdapters(runtime).map((adapter) => adapter.provider);

    expect(providers).not.toContain('gdrive');
    expect(providers).toContain('mega');
    expect(providers).toContain('github');
  });
});
