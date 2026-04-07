import { beforeEach, describe, expect, it, vi } from 'vitest';

const { addListenerMock, getMock, setMock, isNativePlatformMock, removeMock } = vi.hoisted(() => ({
  addListenerMock: vi.fn(),
  getMock: vi.fn(),
  setMock: vi.fn(),
  isNativePlatformMock: vi.fn(),
  removeMock: vi.fn(),
}));

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: addListenerMock,
  },
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: isNativePlatformMock,
  },
}));

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: getMock,
    set: setMock,
  },
}));

import {
  getPhonePersistenceBridge,
  hasPhonePersistenceBridge,
  subscribePhoneAppState,
} from './phonePersistence.js';

describe('phonePersistence', () => {
  beforeEach(() => {
    addListenerMock.mockReset();
    getMock.mockReset();
    setMock.mockReset();
    isNativePlatformMock.mockReset();
    removeMock.mockReset();
    isNativePlatformMock.mockReturnValue(false);
    addListenerMock.mockResolvedValue({ remove: removeMock });
  });

  it('detects when the native phone persistence bridge is available', () => {
    expect(hasPhonePersistenceBridge()).toBe(false);
    isNativePlatformMock.mockReturnValue(true);
    expect(hasPhonePersistenceBridge()).toBe(true);
  });

  it('loads and saves ui state through Capacitor preferences on native platforms', async () => {
    isNativePlatformMock.mockReturnValue(true);
    getMock.mockResolvedValue({ value: JSON.stringify({ savedAt: 12, theme: { presetId: 'sunrise' } }) });

    const bridge = getPhonePersistenceBridge();
    expect(bridge).not.toBeNull();
    await expect(bridge?.loadUiState()).resolves.toEqual({ savedAt: 12, theme: { presetId: 'sunrise' } });

    await bridge?.saveUiState({ savedAt: 20, volumeMounts: [{ id: 'm1' }] });
    expect(setMock).toHaveBeenCalledWith({
      key: 'nearbytes.ui-state.v1',
      value: JSON.stringify({ savedAt: 20, volumeMounts: [{ id: 'm1' }] }),
    });
  });

  it('subscribes to native app state changes and releases the listener', async () => {
    isNativePlatformMock.mockReturnValue(true);
    let listener: ((state: { isActive: boolean }) => void) | null = null;
    addListenerMock.mockImplementation(async (_event: string, callback: (state: { isActive: boolean }) => void) => {
      listener = callback;
      return { remove: removeMock };
    });

    const calls: boolean[] = [];
    const unsubscribe = await subscribePhoneAppState((isActive) => {
      calls.push(isActive);
    });
    listener?.({ isActive: false });
    listener?.({ isActive: true });
    unsubscribe();

    expect(calls).toEqual([false, true]);
    expect(removeMock).toHaveBeenCalledTimes(1);
  });
});