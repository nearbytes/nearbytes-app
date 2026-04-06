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
    await host.legacyDesktop.getEventStorageLocations({ type: 'token', token: 'abc' }, 'evt1');
    await host.legacyDesktop.renameFile({ type: 'token', token: 'abc' }, 'a', 'b');
    await host.legacyDesktop.renameFolder({ type: 'secret', secret: 'xyz' }, 'from', 'to', true);
    await host.legacyDesktop.exportSourceReferences({ type: 'token', token: 'abc' }, ['a']);
    await host.legacyDesktop.importRecipientReferences({ type: 'token', token: 'abc' }, { bundle: true });
    await host.legacyDesktop.listChat({ type: 'token', token: 'abc' });
    await host.legacyDesktop.publishIdentity({ type: 'token', token: 'abc' }, 'ident', { displayName: 'Name' });
    await host.legacyDesktop.sendChatMessage({ type: 'token', token: 'abc' }, 'ident', { body: 'hi' });

    expect(requestHostJson).toHaveBeenCalledWith('/open', {
      method: 'POST',
      headers: new Headers(),
      body: JSON.stringify({ secret: 'secret' }),
    });
    expect(requestHostJson).toHaveBeenCalledWith('/files', {
      method: 'GET',
      headers: expect.any(Headers),
    });
    expect(requestHostJson).toHaveBeenCalledWith('/timeline', {
      method: 'GET',
      headers: expect.any(Headers),
    });
    expect(requestHostJson).toHaveBeenCalledWith('/events/evt1', {
      method: 'GET',
      headers: expect.any(Headers),
    });
    expect(requestHostJson).toHaveBeenCalledWith('/events/evt1/storage-locations', {
      method: 'GET',
      headers: expect.any(Headers),
    });
    expect(requestHostJson).toHaveBeenCalledWith('/files/rename', {
      method: 'POST',
      headers: expect.any(Headers),
      body: JSON.stringify({ from: 'a', to: 'b' }),
    });
    expect(requestHostJson).toHaveBeenCalledWith('/folders/rename', {
      method: 'POST',
      headers: expect.any(Headers),
      body: JSON.stringify({ from: 'from', to: 'to', merge: true }),
    });
    expect(requestHostJson).toHaveBeenCalledWith('/references/source/export', {
      method: 'POST',
      headers: expect.any(Headers),
      body: JSON.stringify({ filenames: ['a'] }),
    });
    expect(requestHostJson).toHaveBeenCalledWith('/references/recipient/import', {
      method: 'POST',
      headers: expect.any(Headers),
      body: JSON.stringify({ bundle: { bundle: true } }),
    });
    expect(requestHostJson).toHaveBeenCalledWith('/chat', {
      method: 'GET',
      headers: expect.any(Headers),
    });
    expect(requestHostJson).toHaveBeenCalledWith('/chat/identities', {
      method: 'POST',
      headers: expect.any(Headers),
      body: JSON.stringify({ identitySecret: 'ident', profile: { displayName: 'Name' } }),
    });
    expect(requestHostJson).toHaveBeenCalledWith('/chat/messages', {
      method: 'POST',
      headers: expect.any(Headers),
      body: JSON.stringify({ identitySecret: 'ident', body: 'hi', attachment: undefined }),
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