import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

import type { PersistedUiState } from './desktopBridge.js';

const UI_STATE_KEY = 'nearbytes.ui-state.v1';

export interface NearbytesPhonePersistenceBridge {
  loadUiState(): Promise<PersistedUiState | null>;
  saveUiState(state: PersistedUiState): Promise<void>;
}

function clonePersistedUiState(state: PersistedUiState): PersistedUiState {
  return JSON.parse(JSON.stringify(state)) as PersistedUiState;
}

export function hasPhonePersistenceBridge(): boolean {
  return Capacitor.isNativePlatform();
}

export function getPhonePersistenceBridge(): NearbytesPhonePersistenceBridge | null {
  if (!hasPhonePersistenceBridge()) {
    return null;
  }

  return {
    async loadUiState(): Promise<PersistedUiState | null> {
      const result = await Preferences.get({ key: UI_STATE_KEY });
      if (!result.value) {
        return null;
      }
      try {
        return JSON.parse(result.value) as PersistedUiState;
      } catch {
        return null;
      }
    },
    async saveUiState(state: PersistedUiState): Promise<void> {
      await Preferences.set({
        key: UI_STATE_KEY,
        value: JSON.stringify(clonePersistedUiState(state)),
      });
    },
  };
}

export async function subscribePhoneAppState(listener: (isActive: boolean) => void): Promise<() => void> {
  if (!hasPhonePersistenceBridge()) {
    return () => {};
  }

  const handle = await CapacitorApp.addListener('appStateChange', (state) => {
    listener(state.isActive);
  });

  return () => {
    void handle.remove();
  };
}