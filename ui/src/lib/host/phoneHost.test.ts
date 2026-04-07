import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./runtimeTransport.js', () => ({
  getRuntimeConfig: vi.fn(async () => ({
    apiBaseUrl: '',
    desktopToken: '',
    isDesktop: false,
    runtimeHostKind: 'phone',
    runtimeOwner: 'embedded',
    runtimeTokenHeader: 'x-nearbytes-runtime-token',
  })),
  requestHostJson: vi.fn(async () => ({ ok: true })),
  requestHostBlob: vi.fn(async () => new Blob()),
  openHostStream: vi.fn(async () => new Response(null)),
}));

import { openHostStream, requestHostJson, getRuntimeConfig } from './runtimeTransport.js';
import { getPhoneHost, resetPhoneHostForTests } from './phoneHost.js';

describe('phoneHost', () => {
  afterEach(() => {
    resetPhoneHostForTests();
    vi.clearAllMocks();
  });

  it('fails fast when the embedded phone runtime is missing', async () => {
    const host = await getPhoneHost();

    expect(host.capabilities.hostKind).toBe('phone');
    expect(host.capabilities.runtimeOwner).toBe('embedded');
    await expect(host.legacyDesktop.openVolume('secret')).rejects.toThrow(
      'Phone runtime is missing. Start the desktop-backed phone dev runtime or implement the native phone host runtime.'
    );
    await expect(host.lan.listPeers()).rejects.toThrow(
      'Phone runtime is missing. Start the desktop-backed phone dev runtime or implement the native phone host runtime.'
    );
    expect(requestHostJson).not.toHaveBeenCalled();
    expect(openHostStream).not.toHaveBeenCalled();
  });

  it('uses the shared transport for desktop-backed phone runtime compatibility', async () => {
    vi.mocked(getRuntimeConfig).mockResolvedValueOnce({
      apiBaseUrl: 'https://nearbytes.test',
      desktopToken: '',
      isDesktop: false,
      runtimeHostKind: 'phone',
      runtimeOwner: 'desktop-proxy',
      runtimeTokenHeader: 'x-nearbytes-runtime-token',
    });

    const host = await getPhoneHost();

    await host.legacyDesktop.openVolume('secret');
    await host.lan.listPeers();

    expect(host.capabilities.runtimeOwner).toBe('desktop-proxy');
    expect(requestHostJson).toHaveBeenCalledWith('/open', {
      method: 'POST',
      headers: new Headers(),
      body: JSON.stringify({ secret: 'secret' }),
    });
    expect(requestHostJson).toHaveBeenCalledWith('/integrations/local-network/peers', {
      method: 'GET',
      headers: new Headers(),
      signal: undefined,
    });
  });
});