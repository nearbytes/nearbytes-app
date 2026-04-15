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
    invalidation: {
      watchSources: vi.fn(),
      watchVolume: vi.fn(),
      watchVolumeEvents: vi.fn(),
    },
    integrations: {
      listProviderAccounts: vi.fn(),
      connectProviderAccount: vi.fn(),
      disconnectProviderAccount: vi.fn(),
      configureProviderSetup: vi.fn(),
      installProviderHelper: vi.fn(),
      reconcileProviderManagedShares: vi.fn(),
      listManagedShares: vi.fn(),
      listIncomingManagedShares: vi.fn(),
      listIncomingProviderContactInvites: vi.fn(),
      createManagedShare: vi.fn(),
      inviteManagedShare: vi.fn(),
      attachManagedShare: vi.fn(),
      removeManagedShare: vi.fn(),
      acceptManagedShare: vi.fn(),
      acceptIncomingProviderContactInvite: vi.fn(),
      getManagedShareState: vi.fn(),
    },
    lan: {
      listPeers: vi.fn(),
      syncPeer: vi.fn(),
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
    },
  })),
  resetCompatibilityHostForTestsMock: vi.fn(),
}));

const mockedPhoneHost = vi.hoisted(() => ({
  getPhoneHostMock: vi.fn(async () => ({
    capabilities: {
      hostKind: 'phone' as const,
      runtimeOwner: 'embedded' as const,
      supportsDirectoryPicker: false,
      supportsRuntimeLogs: false,
    },
    objects: {
      requestJson: vi.fn(),
      requestBlob: vi.fn(),
      openStream: vi.fn(),
    },
    invalidation: {
      watchSources: vi.fn(),
      watchVolume: vi.fn(),
      watchVolumeEvents: vi.fn(),
    },
    integrations: {
      listProviderAccounts: vi.fn(),
      connectProviderAccount: vi.fn(),
      disconnectProviderAccount: vi.fn(),
      configureProviderSetup: vi.fn(),
      installProviderHelper: vi.fn(),
      reconcileProviderManagedShares: vi.fn(),
      listManagedShares: vi.fn(),
      listIncomingManagedShares: vi.fn(),
      listIncomingProviderContactInvites: vi.fn(),
      createManagedShare: vi.fn(),
      inviteManagedShare: vi.fn(),
      attachManagedShare: vi.fn(),
      removeManagedShare: vi.fn(),
      acceptManagedShare: vi.fn(),
      acceptIncomingProviderContactInvite: vi.fn(),
      getManagedShareState: vi.fn(),
    },
    lan: {
      listPeers: vi.fn(),
      syncPeer: vi.fn(),
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
    },
  })),
  resetPhoneHostForTestsMock: vi.fn(),
}));

const mockedRuntimeTransport = vi.hoisted(() => ({
  getRuntimeConfigMock: vi.fn(async () => ({
    apiBaseUrl: '',
    desktopToken: '',
    isDesktop: false,
    runtimeHostKind: 'web' as const,
    runtimeOwner: 'remote-runtime' as const,
    runtimeTokenHeader: 'x-nearbytes-runtime-token',
  })),
}));

vi.mock('./compatibilityHost.js', () => ({
  getCompatibilityHost: mockedCompatibilityHost.getCompatibilityHostMock,
  resetCompatibilityHostForTests: mockedCompatibilityHost.resetCompatibilityHostForTestsMock,
}));

vi.mock('./phoneHost.js', () => ({
  getPhoneHost: mockedPhoneHost.getPhoneHostMock,
  resetPhoneHostForTests: mockedPhoneHost.resetPhoneHostForTestsMock,
}));

vi.mock('./runtimeTransport.js', () => ({
  getRuntimeConfig: mockedRuntimeTransport.getRuntimeConfigMock,
}));

import { getActiveHost, resetActiveHostForTests } from './resolveHost.js';

describe('resolveHost', () => {
  afterEach(() => {
    resetActiveHostForTests();
    mockedCompatibilityHost.getCompatibilityHostMock.mockClear();
    mockedCompatibilityHost.resetCompatibilityHostForTestsMock.mockClear();
    mockedPhoneHost.getPhoneHostMock.mockClear();
    mockedPhoneHost.resetPhoneHostForTestsMock.mockClear();
    mockedRuntimeTransport.getRuntimeConfigMock.mockClear();
  });

  it('resolves the active host through the shared host entry point', async () => {
    const first = await getActiveHost();
    const second = await getActiveHost();

    expect(first).toBe(second);
    expect(mockedCompatibilityHost.getCompatibilityHostMock).toHaveBeenCalledTimes(1);
    expect(mockedPhoneHost.getPhoneHostMock).not.toHaveBeenCalled();
  });

  it('selects the dedicated phone host for phone runtimes', async () => {
    mockedRuntimeTransport.getRuntimeConfigMock.mockResolvedValueOnce({
      apiBaseUrl: '',
      desktopToken: '',
      isDesktop: false,
      runtimeHostKind: 'phone',
      runtimeOwner: 'embedded',
      runtimeTokenHeader: 'x-nearbytes-runtime-token',
    });

    const activeHost = await getActiveHost();

    expect(activeHost.capabilities.hostKind).toBe('phone');
    expect(mockedPhoneHost.getPhoneHostMock).toHaveBeenCalledTimes(1);
    expect(mockedCompatibilityHost.getCompatibilityHostMock).not.toHaveBeenCalled();
  });

  it('resets cached host resolution for tests', () => {
    resetActiveHostForTests();
    expect(mockedCompatibilityHost.resetCompatibilityHostForTestsMock).toHaveBeenCalledTimes(1);
    expect(mockedPhoneHost.resetPhoneHostForTestsMock).toHaveBeenCalledTimes(1);
  });
});