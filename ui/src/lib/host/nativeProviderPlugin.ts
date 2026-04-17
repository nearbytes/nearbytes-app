import { Capacitor, registerPlugin } from '@capacitor/core';

import type { ConfigureProviderInput, ProviderSetupState } from '../../../../src/integrations/types.js';

interface NearbytesProviderPlugin {
  getSetupState(options: { provider: string }): Promise<{ setup: ProviderSetupState }>;
  configureProvider(options: {
    provider: string;
    clientId?: string;
    clientSecret?: string;
  }): Promise<{ setup: ProviderSetupState }>;
  installProvider(options: { provider: string }): Promise<{ setup: ProviderSetupState }>;
}

const nearbytesProviderPlugin = registerPlugin<NearbytesProviderPlugin>('NearbytesProvider');
const fallbackProviderConfig = new Map<string, { clientId?: string; clientSecret?: string }>();

export function hasNativeProviderPlugin(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('NearbytesProvider');
}

export async function getNativeProviderSetupState(provider: string): Promise<ProviderSetupState> {
  if (!hasNativeProviderPlugin()) {
    return fallbackProviderSetupState(provider);
  }
  const response = await nearbytesProviderPlugin.getSetupState({ provider });
  return response.setup;
}

export async function configureNativeProvider(input: ConfigureProviderInput): Promise<ProviderSetupState> {
  if (!hasNativeProviderPlugin()) {
    return fallbackConfiguredProviderSetupState(input);
  }
  const response = await nearbytesProviderPlugin.configureProvider({
    provider: input.provider,
    clientId: input.clientId,
    clientSecret: input.clientSecret,
  });
  return response.setup;
}

export async function installNativeProvider(provider: string): Promise<ProviderSetupState> {
  if (!hasNativeProviderPlugin()) {
    return fallbackProviderSetupState(provider);
  }
  const response = await nearbytesProviderPlugin.installProvider({ provider });
  return response.setup;
}

function fallbackConfiguredProviderSetupState(input: ConfigureProviderInput): ProviderSetupState {
  const provider = normalizeProvider(input.provider);
  fallbackProviderConfig.set(provider, {
    clientId: input.clientId?.trim() || undefined,
    clientSecret: input.clientSecret?.trim() || undefined,
  });
  if (provider === 'mega') {
    return fallbackProviderSetupState(provider);
  }
  if (provider === 'gdrive') {
    const clientId = input.clientId?.trim();
    return clientId
      ? {
          status: 'ready',
          detail: 'Google Drive is ready to connect.',
          docsUrl: 'https://console.cloud.google.com/apis/credentials',
          canConfigure: true,
          config: {
            clientId,
            hasClientSecret: Boolean(input.clientSecret?.trim()),
          },
        }
      : fallbackProviderSetupState(provider);
  }
  if (provider === 'github') {
    const clientId = input.clientId?.trim();
    return clientId
      ? {
          status: 'ready',
          detail: 'GitHub is ready to connect.',
          docsUrl: 'https://github.com/settings/applications/new',
          canConfigure: true,
          config: {
            clientId,
          },
        }
      : fallbackProviderSetupState(provider);
  }
  return fallbackProviderSetupState(provider);
}

function fallbackProviderSetupState(providerInput: string): ProviderSetupState {
  const provider = normalizeProvider(providerInput);
  const config = fallbackProviderConfig.get(provider);
  if (provider === 'mega') {
    return {
      status: 'ready',
      detail: 'MEGA native sync is built in. No separate local helper install is required.',
    };
  }
  if (provider === 'gdrive') {
    if (config?.clientId) {
      return {
        status: 'ready',
        detail: 'Google Drive is ready to connect.',
        docsUrl: 'https://console.cloud.google.com/apis/credentials',
        canConfigure: true,
        config: {
          clientId: config.clientId,
          hasClientSecret: Boolean(config.clientSecret),
        },
      };
    }
    return {
      status: 'needs-config',
      detail: 'Google Drive needs a Desktop app OAuth client ID. Nearbytes uses PKCE, so no client secret is required.',
      docsUrl: 'https://console.cloud.google.com/apis/credentials',
      canConfigure: true,
      config: {
        hasClientSecret: Boolean(config?.clientSecret),
      },
    };
  }
  if (provider === 'github') {
    if (config?.clientId) {
      return {
        status: 'ready',
        detail: 'GitHub is ready to connect.',
        docsUrl: 'https://github.com/settings/applications/new',
        canConfigure: true,
        config: {
          clientId: config.clientId,
        },
      };
    }
    return {
      status: 'needs-config',
      detail: 'GitHub needs an OAuth app client ID with device flow enabled.',
      docsUrl: 'https://github.com/settings/applications/new',
      canConfigure: true,
      config: {
        clientId: undefined,
      },
    };
  }
  return {
    status: 'unsupported',
    detail: `${providerInput.trim() || 'Provider'} setup is not available on this device yet.`,
  };
}

function normalizeProvider(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[_\s]+/gu, '-');
  switch (normalized) {
    case 'google-drive':
    case 'google-drive.':
    case 'googledrive':
      return 'gdrive';
    default:
      return normalized;
  }
}