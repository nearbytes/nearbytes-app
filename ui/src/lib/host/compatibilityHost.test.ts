import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./runtimeTransport.js', () => ({
  getRuntimeConfig: vi.fn(async () => ({
    apiBaseUrl: '',
    desktopToken: '',
    isDesktop: false,
    runtimeHostKind: 'web',
    runtimeOwner: 'remote-runtime',
  })),
  requestHostJson: vi.fn(async () => ({ ok: true })),
  requestHostBlob: vi.fn(async () => new Blob()),
  openHostStream: vi.fn(async () => new Response(null)),
}));

vi.mock('./desktopShell.js', () => ({
  chooseDesktopDirectoryPath: vi.fn(async () => null),
  hasDesktopDirectoryPicker: vi.fn(() => false),
  hasDesktopRuntimeLogsBridge: vi.fn(() => false),
}));

import { getCompatibilityHost, resetCompatibilityHostForTests } from './compatibilityHost.js';
import { openHostStream, requestHostJson } from './runtimeTransport.js';

describe('compatibilityHost', () => {
  afterEach(() => {
    resetCompatibilityHostForTests();
    vi.clearAllMocks();
  });

  it('exposes runtime capabilities from the active runtime config', async () => {
    const host = await getCompatibilityHost();

    expect(host.capabilities.hostKind).toBe('web');
    expect(host.capabilities.runtimeOwner).toBe('remote-runtime');
    expect(host.capabilities.supportsDirectoryPicker).toBe(false);
    expect(host.capabilities.supportsRuntimeLogs).toBe(false);
  });

  it('routes legacy desktop requests through the shared transport', async () => {
    const host = await getCompatibilityHost();

    await host.legacyDesktop.openVolume('secret');
    await host.legacyDesktop.listFiles({ type: 'token', token: 'abc' });
    await host.legacyDesktop.getTimeline({ type: 'secret', secret: 'xyz' });
    await host.legacyDesktop.getEventDetail({ type: 'token', token: 'abc' }, 'evt1');

    expect(requestHostJson).toHaveBeenCalledWith('/open', {
      method: 'POST',
      body: JSON.stringify({ secret: 'secret' }),
    });
    expect(requestHostJson).toHaveBeenCalledWith('/files', {
      method: 'GET',
      headers: { Authorization: 'Bearer abc' },
    });
    expect(requestHostJson).toHaveBeenCalledWith('/timeline', {
      method: 'GET',
      headers: { 'x-nearbytes-secret': 'xyz' },
    });
    expect(requestHostJson).toHaveBeenCalledWith('/events/evt1', {
      method: 'GET',
      headers: { Authorization: 'Bearer abc' },
    });
  });

  it('opens watch streams through the shared transport', async () => {
    const host = await getCompatibilityHost();

    const sourceConnection = host.legacyDesktop.watchSources({});
    const volumeConnection = host.legacyDesktop.watchVolume({ type: 'token', token: 'abc' }, {});

    expect(openHostStream).toHaveBeenCalledWith('/watch/sources', {
      method: 'GET',
      headers: expect.any(Headers),
      signal: expect.any(AbortSignal),
    });
    expect(openHostStream).toHaveBeenCalledWith('/watch/volume', {
      method: 'GET',
      headers: expect.any(Headers),
      signal: expect.any(AbortSignal),
    });

    sourceConnection.close();
    volumeConnection.close();
  });
});