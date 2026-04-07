import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSecret } from '../../../../src/types/keys.js';
import { deriveKeys } from '../../../../src/crypto/asymmetric.js';
import {
  importCompatibilityEventDetail,
  importCompatibilityTimelineSnapshot,
  importCompatibilityVolumeSnapshot,
  importLocalNetworkPeersSnapshot,
  readMirrorCheckpoint,
  resetBrowserMirrorForTests,
} from '../mirror/browserMirror.js';
import {
  readEmbeddedPhoneRuntimeMetricsForTests,
  resetEmbeddedPhoneRuntimeMetricsForTests,
  seedEmbeddedPhonePendingUploadCommitForTests,
  embeddedPhoneUpdateLanServiceState,
  resetEmbeddedPhoneServicesForTests,
} from './embeddedPhoneServices.js';

vi.mock('./runtimeTransport.js', () => ({
  HostRequestError: class HostRequestError extends Error {
    status: number;

    constructor(status: number, message: string) {
      super(message);
      this.name = 'HostRequestError';
      this.status = status;
    }
  },
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
    expect(uploaded).toMatchObject({
      created: { filename: 'alpha.txt' },
      commit: { status: 'acknowledged', resumed: false },
    });
    await expect(downloaded.text()).resolves.toBe('hello phone');
    expect(renamed).toMatchObject({
      renamed: { fromName: 'alpha.txt', toName: 'beta.txt' },
      commit: { status: 'acknowledged', resumed: false },
    });
    expect(published).toMatchObject({
      published: { record: { profile: { displayName: 'Alice' } } },
      commit: { status: 'acknowledged', resumed: false },
    });
    expect(sent).toMatchObject({
      sent: { message: { body: 'hello room' } },
      commit: { status: 'acknowledged', resumed: false },
    });
    expect(chat.isOffline).toBeUndefined();
    expect(chat.identities.length).toBe(1);
    expect(chat.messages).toMatchObject([{ message: { body: 'hello room' } }]);
    expect(timeline.eventCount).toBeGreaterThanOrEqual(3);
    expect(timeline.isOffline).toBeUndefined();
    expect(finalFiles).toMatchObject({ files: [] });
    expect(finalFiles.isOffline).toBeUndefined();
    await expect(host.legacyDesktop.listFiles({ type: 'token', token: 'abc' })).rejects.toThrow(
      'Phone runtime capability is not implemented in the embedded phone host yet.'
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
      'Phone runtime capability is not implemented in the embedded phone host yet.'
    );
    expect(requestHostJson).not.toHaveBeenCalled();
    expect(openHostStream).not.toHaveBeenCalled();
  });

  it('persists and surfaces a distinct embedded phone LAN peer identity', async () => {
    const firstHost = await getPhoneHost();
    const firstResponse = await firstHost.lan.listPeers() as {
      service: { peerId: string; label: string; listening: boolean; peerCount: number };
      peers: Array<unknown>;
      isOffline?: boolean;
    };

    resetPhoneHostForTests();

    const secondHost = await getPhoneHost();
    const secondResponse = await secondHost.lan.listPeers() as {
      service: { peerId: string; label: string; listening: boolean; peerCount: number };
      peers: Array<unknown>;
      isOffline?: boolean;
    };

    expect(firstResponse).toMatchObject({
      service: {
        label: 'This phone',
        listening: false,
        peerCount: 0,
      },
      peers: [],
      isOffline: true,
    });
    expect(firstResponse.service.peerId).toMatch(/^phone-/);
    expect(secondResponse.service.peerId).toBe(firstResponse.service.peerId);
  });

  it('uses a locally owned embedded phone LAN service snapshot instead of mirrored desktop service state', async () => {
    await importLocalNetworkPeersSnapshot({
      service: {
        protocol: 'nearbytes-lan-v1',
        peerId: 'desktop-self',
        label: 'Desktop mirror',
        listening: true,
        port: 9444,
        discovery: 'dns-sd+multicast-fallback',
        transport: 'webrtc',
        serviceType: '_nearbytes._tcp',
        announceIntervalMs: 9999,
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
          volumeIds: [],
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
    const firstHost = await getPhoneHost();
    const firstResponse = await firstHost.lan.listPeers() as {
      service: { peerId: string; label: string; listening: boolean; port: number | null; announceIntervalMs: number; peerCount: number };
      peers: Array<{ peerId: string }>;
      isOffline?: boolean;
    };

    await embeddedPhoneUpdateLanServiceState({ listening: true, port: 9555, announceIntervalMs: 7000 });
    resetPhoneHostForTests();

    const secondHost = await getPhoneHost();
    const secondResponse = await secondHost.lan.listPeers() as {
      service: { peerId: string; label: string; listening: boolean; port: number | null; announceIntervalMs: number; peerCount: number };
      peers: Array<{ peerId: string }>;
      isOffline?: boolean;
    };

    expect(firstResponse).toMatchObject({
      service: {
        label: 'This phone',
        listening: false,
        port: null,
        announceIntervalMs: 5000,
        peerCount: 1,
      },
      peers: [{ peerId: 'peer-1' }],
      isOffline: true,
    });
    expect(firstResponse.service.peerId).toMatch(/^phone-/);
    expect(firstResponse.service.peerId).not.toBe('desktop-self');
    expect(secondResponse).toMatchObject({
      service: {
        peerId: firstResponse.service.peerId,
        label: 'This phone',
        listening: true,
        port: 9555,
        announceIntervalMs: 7000,
        peerCount: 1,
      },
      peers: [{ peerId: 'peer-1' }],
      isOffline: true,
    });
  });

  it('routes provider and managed-share surfaces through the embedded phone host without falling back to desktop requests', async () => {
    const host = await getPhoneHost();

    await expect(host.integrations.listProviderAccounts()).resolves.toEqual({
      accounts: [],
      providers: [],
      preferredProviders: [],
    });
    await expect(host.integrations.listManagedShares()).resolves.toEqual({ shares: [] });
    await expect(host.integrations.listIncomingManagedShares()).resolves.toEqual({ shares: [] });
    await expect(host.integrations.listIncomingProviderContactInvites()).resolves.toEqual({ invites: [] });
    await expect(host.integrations.connectProviderAccount({ provider: 'mega' })).rejects.toMatchObject({
      status: 501,
      message: expect.stringContaining('Phone runtime capability is not implemented in the embedded phone host yet.'),
    });
    await expect(host.integrations.acceptManagedShare({ provider: 'mega' })).rejects.toMatchObject({
      status: 501,
      message: expect.stringContaining('Phone runtime capability is not implemented in the embedded phone host yet.'),
    });
    expect(requestHostJson).not.toHaveBeenCalled();
  });

  it('initiates LAN sync through the embedded phone host and persists the peer sync state', async () => {
    await importLocalNetworkPeersSnapshot({
      service: {
        protocol: 'nearbytes-lan-v1',
        peerId: 'desktop-self',
        label: 'Desktop mirror',
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
          volumeIds: ['vol-1'],
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
    const mutation = await host.lan.syncPeer('peer-1') as {
      peer: {
        peerId: string;
        status: string;
        detail: string;
        lastSyncStartedAt: number | null;
        lastSyncNotice: string | null;
      };
    };

    resetPhoneHostForTests();

    const refreshedHost = await getPhoneHost();
    const refreshed = await refreshedHost.lan.listPeers() as {
      peers: Array<{
        peerId: string;
        status: string;
        detail: string;
        lastSyncStartedAt: number | null;
        lastSyncNotice: string | null;
      }>;
      isOffline?: boolean;
    };

    expect(mutation.peer).toMatchObject({
      peerId: 'peer-1',
      status: 'syncing',
      detail: 'Sync requested on this phone.',
      lastSyncNotice: 'Sync requested on this phone. Waiting for LAN runtime delivery.',
    });
    expect(typeof mutation.peer.lastSyncStartedAt).toBe('number');
    expect(refreshed).toMatchObject({
      peers: [
        {
          peerId: 'peer-1',
          status: 'syncing',
          detail: 'Sync requested on this phone.',
          lastSyncNotice: 'Sync requested on this phone. Waiting for LAN runtime delivery.',
        },
      ],
      isOffline: true,
    });
    expect(typeof refreshed.peers[0]?.lastSyncStartedAt).toBe('number');
  });

  it('bridges embedded phone runtime mutations into volume watch updates and mirror checkpoints', async () => {
    const secret = 'phone-watch-secret';
    const host = await getPhoneHost();
    const messages: string[] = [];
    const connection = host.invalidation.watchVolume(
      { type: 'secret', secret },
      {
        onMessage(event) {
          messages.push(String(event.data));
        },
      }
    );

    await Promise.resolve();
    await Promise.resolve();

    const opened = await host.legacyDesktop.openVolume(secret) as { volumeId: string };

    await host.legacyDesktop.uploadFile(
      { type: 'secret', secret },
      new File(['watch me'], 'watch.txt', { type: 'text/plain' })
    );

    await Promise.resolve();
    await Promise.resolve();

    connection.close();

    expect(messages[0]).toContain('event: watch-ready');
    expect(messages[0]).toContain(`"volumeId":"${opened.volumeId}"`);
    expect(messages.some((message) => message.includes('event: volume-update'))).toBe(true);
    expect(messages.some((message) => message.includes('blocks/'))).toBe(true);

    await expect(readMirrorCheckpoint(`watch:volume:${opened.volumeId}`)).resolves.toMatchObject({
      value: {
        kind: 'update',
        source: 'embedded-phone-runtime',
      },
    });
  });

  it('replays pending embedded phone authored uploads across reset and resumes with an acknowledged receipt', async () => {
    const secret = 'phone-resume-secret';
    const commitId = await seedEmbeddedPhonePendingUploadCommitForTests(
      secret,
      new File(['resume me'], 'resume.txt', { type: 'text/plain' })
    );

    resetPhoneHostForTests();

    const host = await getPhoneHost();
    const opened = await host.legacyDesktop.openVolume(secret) as {
      volumeId: string;
      files: Array<{ filename: string }>;
    };
    const files = await host.legacyDesktop.listFiles({ type: 'secret', secret }) as {
      files: Array<{ filename: string }>;
    };

    expect(opened.files).toMatchObject([{ filename: 'resume.txt' }]);
    expect(files.files).toMatchObject([{ filename: 'resume.txt' }]);
    await expect(readMirrorCheckpoint(`commit:${commitId}`)).resolves.toMatchObject({
      value: {
        status: 'acknowledged',
        resumed: true,
        source: 'embedded-phone-runtime',
      },
    });
  });

  it('bootstraps embedded phone reopen from durable runtime heads instead of forcing a scan-first refresh', async () => {
    const secret = 'phone-head-bootstrap-secret';
    const host = await getPhoneHost();

    await host.legacyDesktop.uploadFile(
      { type: 'secret', secret },
      new File(['head bootstrap'], 'bootstrap.txt', { type: 'text/plain' })
    );
    await host.legacyDesktop.getTimeline({ type: 'secret', secret });

    resetPhoneHostForTests();
    resetEmbeddedPhoneRuntimeMetricsForTests();

    const reopenedHost = await getPhoneHost();
    const reopened = await reopenedHost.legacyDesktop.openVolume(secret) as {
      files: Array<{ filename: string }>;
    };

    expect(reopened.files).toMatchObject([{ filename: 'bootstrap.txt' }]);
    expect(readEmbeddedPhoneRuntimeMetricsForTests()).toMatchObject({
      refreshReads: 0,
      bootstrappedReads: 1,
    });
  });

  it('forces embedded ownership even when legacy proxy runtime metadata is injected', async () => {
    vi.mocked(getRuntimeConfig).mockResolvedValueOnce({
      apiBaseUrl: 'https://nearbytes.test',
      desktopToken: '',
      isDesktop: false,
      runtimeHostKind: 'phone',
      runtimeOwner: 'desktop-proxy',
      runtimeTokenHeader: 'x-nearbytes-runtime-token',
    });

    const host = await getPhoneHost();

    const peers = await host.lan.listPeers() as {
      peers: Array<unknown>;
      isOffline?: boolean;
    };

    expect(host.capabilities.runtimeOwner).toBe('embedded');
    expect(peers).toMatchObject({ peers: [], isOffline: true });
    expect(requestHostJson).not.toHaveBeenCalled();
    expect(openHostStream).not.toHaveBeenCalled();
  });
});