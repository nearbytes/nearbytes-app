import {
  canWipeStoredConfig,
  chooseDesktopDirectoryPath,
  connectDesktopDeepLinks,
  loadDesktopUiState,
  requestDesktopUpdateReleasePage,
  saveDesktopUiState,
  tryRevealPathInFileManager,
  wipeStoredConfig,
} from './desktopShell.js';

describe('desktopShell', () => {
  it('reports whether the desktop reset action is available', () => {
    expect(canWipeStoredConfig(null)).toBe(false);
    expect(
      canWipeStoredConfig({
        wipeStoredConfig: async () => ({ relaunching: true }),
      })
    ).toBe(true);
  });

  it('delegates optional chooser and deep-link operations when available', async () => {
    await expect(
      chooseDesktopDirectoryPath('/tmp', {
        chooseDirectory: async (path) => path,
      })
    ).resolves.toBe('/tmp');

    await expect(connectDesktopDeepLinks(null)).resolves.toEqual([]);
    await expect(
      connectDesktopDeepLinks({
        connectDeepLinks: async () => ['nearbytes://join/test'],
      })
    ).resolves.toEqual(['nearbytes://join/test']);
  });

  it('persists desktop ui state only when the bridge supports it', async () => {
    await expect(saveDesktopUiState({ savedAt: 1 }, null)).resolves.toBe(false);
    await expect(
      saveDesktopUiState(
        { savedAt: 1 },
        {
          saveUiState: async () => undefined,
        }
      )
    ).resolves.toBe(true);

    await expect(loadDesktopUiState(null)).resolves.toBeNull();
    await expect(
      loadDesktopUiState({
        loadUiState: async () => ({ savedAt: 2 }),
      })
    ).resolves.toEqual({ savedAt: 2 });
  });

  it('throws clear errors for unavailable destructive actions', async () => {
    await expect(wipeStoredConfig(undefined, null)).rejects.toThrow(
      'Desktop reset controls are unavailable in this build.'
    );
    await expect(requestDesktopUpdateReleasePage(null)).resolves.toBe(false);
  });

  it('reveals file manager paths only when supported', async () => {
    await expect(tryRevealPathInFileManager('/tmp/test', null)).resolves.toBe(false);
    await expect(
      tryRevealPathInFileManager('/tmp/test', {
        revealPathInFileManager: async () => undefined,
      })
    ).resolves.toBe(true);
  });
});