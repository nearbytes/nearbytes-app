import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSecret } from '../../../../src/types/keys.js';
import { deriveKeys } from '../../../../src/crypto/asymmetric.js';
import {
  importCompatibilityEventDetail,
  importCompatibilityTimelineSnapshot,
  importCompatibilityVolumeSnapshot,
  importLocalNetworkPeersSnapshot,
  resetBrowserMirrorForTests,
} from '../mirror/browserMirror.js';
import { resetEmbeddedPhoneServicesForTests } from './embeddedPhoneServices.js';

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
    resetBrowserMirrorForTests();
    resetEmbeddedPhoneServicesForTests();
    vi.clearAllMocks();
  });

  it('uses the embedded phone runtime for local file and chat mutations', async () => {
    const secret = 'phone-local-runtime-secret';
    const host = await getPhoneHost();

    const initial = await host.legacyDesktop.openVolume(secret) as {
      volumeId: string;
      files: Array<{ filename: string }>;
      isOffline?: boolean;
    };
    const uploaded = await host.legacyDesktop.uploadFile(
      { type: 'secret', secret },
      new File(['hello phone'], 'alpha.txt', { type: 'text/plain' })
    ) as {
      created: { filename: string; blobHash: string };
    };
    const downloaded = await host.objects.requestBlob(`/file/${uploaded.created.blobHash}`, {
      method: 'GET',
      headers: new Headers({ 'x-nearbytes-secret': secret }),
    });
    const renamed = await host.legacyDesktop.renameFile({ type: 'secret', secret }, 'alpha.txt', 'beta.txt') as {
      renamed: { fromName: string; toName: string };
    };
    const published = await host.legacyDesktop.publishIdentity(
      { type: 'secret', secret },
      'identity:alpha',
      { displayName: 'Alice' }
    ) as {
      published: { record: { profile: { displayName: string } } };
    };
    const sent = await host.legacyDesktop.sendChatMessage(
      { type: 'secret', secret },
      'identity:alpha',
      { body: 'hello room' }
    ) as {
      sent: { message: { body?: string } };
    };
    const chat = await host.legacyDesktop.listChat({ type: 'secret', secret }) as {
      identities: Array<{ authorPublicKey: string }>;
      messages: Array<{ message: { body?: string } }>;
      isOffline?: boolean;
    };
    const timeline = await host.legacyDesktop.getTimeline({ type: 'secret', secret }) as {
      eventCount: number;
      isOffline?: boolean;
    };
    await host.legacyDesktop.deleteFile({ type: 'secret', secret }, 'beta.txt');
    const finalFiles = await host.legacyDesktop.listFiles({ type: 'secret', secret }) as {
      files: Array<{ filename: string }>;
      isOffline?: boolean;
    };

    expect(host.capabilities.hostKind).toBe('phone');
    expect(host.capabilities.runtimeOwner).toBe('embedded');
    expect(initial.isOffline).toBeUndefined();
    expect(initial.files).toEqual([]);
    expect(uploaded).toMatchObject({ created: { filename: 'alpha.txt' } });
    await expect(downloaded.text()).resolves.toBe('hello phone');
    expect(renamed).toMatchObject({ renamed: { fromName: 'alpha.txt', toName: 'beta.txt' } });
    expect(published).toMatchObject({ published: { record: { profile: { displayName: 'Alice' } } } });
    expect(sent).toMatchObject({ sent: { message: { body: 'hello room' } } });
    expect(chat.isOffline).toBeUndefined();
    expect(chat.identities.length).toBe(1);
    expect(chat.messages).toMatchObject([{ message: { body: 'hello room' } }]);
    expect(timeline.eventCount).toBeGreaterThanOrEqual(3);
    expect(timeline.isOffline).toBeUndefined();
    expect(finalFiles).toMatchObject({ files: [] });
    expect(finalFiles.isOffline).toBeUndefined();
    await expect(host.legacyDesktop.listFiles({ type: 'token', token: 'abc' })).rejects.toThrow(
      'Phone runtime is missing. Start the desktop-backed phone dev runtime or implement the native phone host runtime.'
    );
    expect(requestHostJson).not.toHaveBeenCalled();
    expect(openHostStream).not.toHaveBeenCalled();
  });

  it('uses mirrored read fallbacks when the embedded phone runtime has no local volume yet', async () => {
    const secret = 'phone-mirror-secret';
    const keyPair = await deriveKeys(createSecret(secret));
    const volumeId = Array.from(keyPair.publicKey)
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('');

    await importCompatibilityVolumeSnapshot({
      volumeId,
      files: [{ filename: 'alpha.txt', blobHash: 'h1', size: 3, createdAt: 1 }],
    });
    await importCompatibilityTimelineSnapshot({
      volumeId,
      eventCount: 2,
      events: [
        {
          eventHash: 'evt-identity',
          type: 'DECLARE_IDENTITY',
          filename: '',
          timestamp: 1,
          publishedAt: 1,
          authorPublicKey: 'pk-1',
          record: {
            p: 'nb.identity.record.v1',
            k: 'pk-1',
            ts: 1,
            profile: { displayName: 'Alice' },
            sig: 'sig-1',
          },
        },
        {
          eventHash: 'evt-chat',
          type: 'CHAT_MESSAGE',
          filename: '',
          timestamp: 2,
          publishedAt: 2,
          authorPublicKey: 'pk-1',
          message: {
            p: 'nb.chat.message.v1',
            k: 'pk-1',
            ts: 2,
            body: 'hello',
            sig: 'sig-2',
          },
        },
      ],
    });
    await importCompatibilityEventDetail({
      eventHash: 'evt-chat',
      event: {
        envelope: {
          version: 'v1',
          publicKey: 'pk-1',
          blockRefs: [],
          ciphertext: 'cipher',
        },
        signature: 'sig-evt',
      },
    });
    await importLocalNetworkPeersSnapshot({
      service: {
        protocol: 'nearbytes-lan-v1',
        peerId: 'self-1',
        label: 'This device',
        listening: true,
        port: 9444,
        discovery: 'dns-sd+multicast-fallback',
        transport: 'webrtc',
        serviceType: '_nearbytes._tcp',
        announceIntervalMs: 5000,
        peerCount: 1,
      },
      peers: [
        {
          peerId: 'peer-1',
          label: 'Alpha phone',
          address: '192.168.1.20',
          port: 9444,
          endpointUrl: 'http://192.168.1.20:9444',
          capabilities: ['sync'],
          volumeIds: [volumeId],
          firstSeenAt: 1,
          lastSeenAt: 2,
          lastHelloAt: 2,
          lastSyncAt: null,
          lastSyncStartedAt: null,
          lastSyncError: null,
          lastSyncNotice: null,
          lastImportedEvents: 0,
          lastImportedBlocks: 0,
          remoteCursorObservationId: null,
          lastRemoteHeadObservationId: null,
          status: 'ready',
          detail: 'Ready',
        },
      ],
    });

    const host = await getPhoneHost();
    const opened = await host.legacyDesktop.openVolume(secret) as {
      volumeId: string;
      files: Array<{ filename: string }>;
      isOffline?: boolean;
      storageHint?: string;
    };
    const files = await host.legacyDesktop.listFiles({ type: 'secret', secret }) as {
      volumeId: string;
      files: Array<{ filename: string }>;
      isOffline?: boolean;
    };
    const timeline = await host.legacyDesktop.getTimeline({ type: 'secret', secret }) as {
      eventCount: number;
      events: Array<{ eventHash: string }>;
      isOffline?: boolean;
    };
    const detail = await host.legacyDesktop.getEventDetail({ type: 'secret', secret }, 'evt-chat') as {
      eventHash: string;
    };
    const chat = await host.legacyDesktop.listChat({ type: 'secret', secret }) as {
      identities: Array<{ authorPublicKey: string }>;
      messages: Array<{ eventHash: string }>;
      isOffline?: boolean;
    };
    const peers = await host.lan.listPeers() as {
      peers: Array<{ peerId: string }>;
      isOffline?: boolean;
    };

    expect(opened).toMatchObject({
      volumeId,
      files: [{ filename: 'alpha.txt' }],
      isOffline: true,
      storageHint: 'Using persisted mirrored data. Runtime unavailable.',
    });
    expect(files).toMatchObject({
      volumeId,
      files: [{ filename: 'alpha.txt' }],
      isOffline: true,
    });
    expect(timeline).toMatchObject({
      eventCount: 2,
      events: [{ eventHash: 'evt-identity' }, { eventHash: 'evt-chat' }],
      isOffline: true,
    });
    expect(detail).toMatchObject({ eventHash: 'evt-chat' });
    expect(chat).toMatchObject({
      identities: [{ authorPublicKey: 'pk-1' }],
      messages: [{ eventHash: 'evt-chat' }],
      isOffline: true,
    });
    expect(peers).toMatchObject({
      peers: [{ peerId: 'peer-1' }],
      isOffline: true,
    });
    await expect(host.legacyDesktop.uploadFile({ type: 'token', token: 'abc' }, new File(['x'], 'x.txt'))).rejects.toThrow(
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