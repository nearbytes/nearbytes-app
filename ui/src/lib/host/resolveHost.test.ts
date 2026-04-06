import { afterEach, describe, expect, it, vi } from 'vitest';

const mockedCompatibilityHost = vi.hoisted(() => ({
  getCompatibilityHostMock: vi.fn(async () => ({
    capabilities: {
      hostKind: 'web' as const,
      runtimeOwner: 'remote-runtime' as const,
      supportsDirectoryPicker: false,
      supportsRuntimeLogs: false,
    },
    objects: {
      requestJson: vi.fn(),
      requestBlob: vi.fn(),
      openStream: vi.fn(),
    },
    shell: {
      chooseDirectory: vi.fn(async () => null),
    },
    legacyDesktop: {
      openVolume: vi.fn(),
      listFiles: vi.fn(),
      getTimeline: vi.fn(),
      getEventDetail: vi.fn(),
      getEventStorageLocations: vi.fn(),
      uploadFile: vi.fn(),
      deleteFile: vi.fn(),
      renameFile: vi.fn(),
      renameFolder: vi.fn(),
      exportSourceReferences: vi.fn(),
      importSourceReferences: vi.fn(),
      exportRecipientReferences: vi.fn(),
      importRecipientReferences: vi.fn(),
      listChat: vi.fn(),
      publishIdentity: vi.fn(),
      sendChatMessage: vi.fn(),
      watchSources: vi.fn(),
      watchVolume: vi.fn(),
    },
  })),
  resetCompatibilityHostForTestsMock: vi.fn(),
}));

vi.mock('./compatibilityHost.js', () => ({
  getCompatibilityHost: mockedCompatibilityHost.getCompatibilityHostMock,
  resetCompatibilityHostForTests: mockedCompatibilityHost.resetCompatibilityHostForTestsMock,
}));

import { getActiveHost, resetActiveHostForTests } from './resolveHost.js';

describe('resolveHost', () => {
  afterEach(() => {
    resetActiveHostForTests();
    mockedCompatibilityHost.getCompatibilityHostMock.mockClear();
    mockedCompatibilityHost.resetCompatibilityHostForTestsMock.mockClear();
  });

  it('resolves the active host through the shared host entry point', async () => {
    const first = await getActiveHost();
    const second = await getActiveHost();

    expect(first).toBe(second);
    expect(mockedCompatibilityHost.getCompatibilityHostMock).toHaveBeenCalledTimes(1);
  });

  it('resets cached host resolution for tests', () => {
    resetActiveHostForTests();
    expect(mockedCompatibilityHost.resetCompatibilityHostForTestsMock).toHaveBeenCalledTimes(1);
  });
});