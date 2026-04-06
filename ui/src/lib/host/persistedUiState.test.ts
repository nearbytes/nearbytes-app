import { describe, expect, it } from 'vitest';

import {
  loadHostPersistedUiState,
  normalizePersistedUiState,
  saveHostPersistedUiState,
} from './persistedUiState.js';

describe('persistedUiState', () => {
  it('normalizes persisted ui state payloads', () => {
    expect(normalizePersistedUiState(null)).toEqual({});
    expect(normalizePersistedUiState({ savedAt: 'invalid', volumeMounts: [1] })).toEqual({
      volumeMounts: [1],
      sourceDiscovery: undefined,
      theme: undefined,
      savedAt: 0,
    });
  });

  it('prefers the newer shadow state when loading', async () => {
    await expect(
      loadHostPersistedUiState(
        { savedAt: 20, volumeMounts: ['shadow'] },
        {
          loadUiState: async () => ({ savedAt: 10, volumeMounts: ['host'] }),
        }
      )
    ).resolves.toEqual({
      volumeMounts: ['shadow'],
      sourceDiscovery: undefined,
      theme: undefined,
      savedAt: 20,
    });
  });

  it('returns shadow state when no host persistence bridge exists', async () => {
    await expect(loadHostPersistedUiState({ savedAt: 5, theme: { presetId: 'a' } }, null)).resolves.toEqual({
      volumeMounts: undefined,
      sourceDiscovery: undefined,
      theme: { presetId: 'a' },
      savedAt: 5,
    });
  });

  it('saves cloned state only when the host bridge supports it', async () => {
    const calls: Array<unknown> = [];
    const state = { savedAt: 9, volumeMounts: [{ id: 'one' }] };

    await expect(saveHostPersistedUiState(state, null)).resolves.toBe(false);
    await expect(
      saveHostPersistedUiState(state, {
        saveUiState: async (nextState) => {
          calls.push(JSON.parse(JSON.stringify(nextState)));
          if (Array.isArray(nextState.volumeMounts)) {
            (nextState.volumeMounts as Array<{ id: string }>)[0].id = 'mutated';
          }
        },
      })
    ).resolves.toBe(true);

    expect(calls).toEqual([
      {
        volumeMounts: [{ id: 'one' }],
        sourceDiscovery: undefined,
        theme: undefined,
        savedAt: 9,
      },
    ]);
    expect(state).toEqual({ savedAt: 9, volumeMounts: [{ id: 'one' }] });
  });
});