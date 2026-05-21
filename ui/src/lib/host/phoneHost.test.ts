import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSecret } from 'nearbytes-crypto';
import { deriveKeys } from 'nearbytes-crypto';
import { createRuntimeCoreServices } from '../../../../src/runtime/coreServices.js';
import { createInMemoryLog, createMemoryStore } from 'nearbytes-log';
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
  seedEmbeddedPhoneIntegrationStateForTests,
  seedEmbeddedPhoneRuntimeHeadForTests,
  seedEmbeddedPhonePendingUploadCommitForTests,
  seedEmbeddedPhoneStoredRecordForTests,
  embeddedPhoneUpdateLanServiceState,
  resetEmbeddedPhoneServicesForTests,
} from './embeddedPhoneServices.js';
import * as embeddedPhoneServices from './embeddedPhoneServices.js';

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

// Anti-regression note: phone host tests must preserve the self-contained embedded runtime design.
// The phone shell may read bootstrap config from dev tooling, but it must not route runtime authority
// through the separate API server process.

function encodeJsonBase64(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
}

describe('phoneHost', () => {
  afterEach(() => {
    resetPhoneHostForTests();
    resetBrowserMirrorForTests();
    resetEmbeddedPhoneServicesForTests();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
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

  it('forwards provider contact invite acceptance through the embedded phone service', async () => {
    const acceptInvite = vi
      .spyOn(embeddedPhoneServices, 'embeddedPhoneAcceptIncomingProviderContactInvite')
      .mockResolvedValue(undefined);

    const host = await getPhoneHost();
    await host.integrations.acceptIncomingProviderContactInvite({
      provider: 'mega',
      accountId: 'acct-mega-phone',
      inviteId: 'invite-mega-phone',
    });

    expect(acceptInvite).toHaveBeenCalledWith('mega', 'acct-mega-phone', 'invite-mega-phone');
  });

  it('uses the shared MEGA adapter for phone account connect validation', async () => {
    const host = await getPhoneHost();

    await host.objects.requestJson('/config/app/providers/mega', {
      method: 'PUT',
      body: JSON.stringify({ enabled: true }),
      headers: new Headers({ 'content-type': 'application/json' }),
    });

    await expect(
      host.integrations.connectProviderAccount({
        provider: 'mega',
        label: 'MEGA',
        preferred: true,
        credentials: {
          email: '',
          password: '',
        },
      })
    ).rejects.toThrow('MEGA needs an email and password.');
  });

  it('serves embedded config requests locally without calling desktop request transport', async () => {
    const host = await getPhoneHost();

    const roots = await host.objects.requestJson('/config/roots?includeUsage=1', {
      method: 'GET',
    }) as {
      config: { sources: Array<{ id: string; path: string }> };
      runtime: { sources: Array<{ id: string; exists: boolean; canWrite: boolean }> };
    };
    const appConfig = await host.objects.requestJson('/config/app', {
      method: 'GET',
    }) as {
      config: { features: { providers: { localNetwork: boolean; mega: boolean } } };
    };

    await host.objects.requestJson('/config/app/providers/local-network', {
      method: 'PUT',
      body: JSON.stringify({ enabled: false }),
      headers: new Headers({ 'content-type': 'application/json' }),
    });

    const updatedAppConfig = await host.objects.requestJson('/config/app', {
      method: 'GET',
    }) as {
      config: { features: { providers: { localNetwork: boolean; mega: boolean } } };
    };

    expect(roots.config.sources).toMatchObject([{ id: 'src-embedded-phone', path: '' }]);
    expect(roots.runtime.sources).toMatchObject([{ id: 'src-embedded-phone', exists: true, canWrite: true }]);
    expect(appConfig.config.features.providers).toMatchObject({ localNetwork: true, mega: false });
    expect(updatedAppConfig.config.features.providers.localNetwork).toBe(false);
    expect(requestHostJson).not.toHaveBeenCalled();
  });

  it('reports local embedded event storage locations without requiring desktop auth', async () => {
    const secret = 'phone-event-storage-secret';
    const host = await getPhoneHost();

    await host.legacyDesktop.uploadFile(
      { type: 'secret', secret },
      new File(['hello phone'], 'alpha.txt', { type: 'text/plain' })
    );
    const timeline = await host.legacyDesktop.getTimeline({ type: 'secret', secret }) as {
      events: Array<{ eventHash: string }>;
    };
    const eventHash = timeline.events.at(-1)?.eventHash;

    expect(eventHash).toBeTruthy();

    const locations = await host.legacyDesktop.getEventStorageLocations(
      { type: 'secret', secret },
      eventHash as string
    ) as {
      eventHash: string;
      locations: Array<{ rootId: string | null; hasEventFile: boolean; hasDataBlock: boolean }>;
    };

    expect(locations.eventHash).toBe(eventHash);
    expect(locations.locations).toMatchObject([
      {
        rootId: 'src-embedded-phone',
        hasEventFile: true,
        hasDataBlock: true,
      },
    ]);
    expect(requestHostJson).not.toHaveBeenCalled();
  });

  it('prefers live embedded reads over mirrored snapshots when the live runtime can still open the volume', async () => {
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
      files: [],
    });
    expect(opened.isOffline).toBeUndefined();
    expect(opened.storageHint).toBeUndefined();
    expect(files).toMatchObject({
      volumeId,
      files: [],
    });
    expect(files.isOffline).toBeUndefined();
    expect(timeline).toMatchObject({
      eventCount: 0,
      events: [],
    });
    expect(timeline.isOffline).toBeUndefined();
    expect(detail).toMatchObject({ eventHash: 'evt-chat' });
    expect(chat).toMatchObject({
      identities: [],
      messages: [],
    });
    expect(chat.isOffline).toBeUndefined();
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

  it('signals the live embedded failure reason when mirrored fallback is used', async () => {
    const secret = 'phone-mirror-failure-secret';
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
      eventCount: 1,
      events: [
        {
          eventHash: 'evt-file',
          type: 'CREATE_FILE',
          filename: 'alpha.txt',
          timestamp: 1,
          publishedAt: 1,
        },
      ],
    });

    vi.spyOn(embeddedPhoneServices, 'embeddedPhoneOpenVolume').mockRejectedValue(new Error('live-open-failed'));
    vi.spyOn(embeddedPhoneServices, 'embeddedPhoneListFiles').mockRejectedValue(new Error('live-list-failed'));
    vi.spyOn(embeddedPhoneServices, 'embeddedPhoneGetTimeline').mockRejectedValue(new Error('live-timeline-failed'));

    const host = await getPhoneHost();
    const opened = await host.legacyDesktop.openVolume(secret) as {
      volumeId: string;
      files: Array<{ filename: string }>;
      isOffline?: boolean;
      runtimeFailureReason?: string;
      storageHint?: string;
    };
    const files = await host.legacyDesktop.listFiles({ type: 'secret', secret }) as {
      volumeId: string;
      files: Array<{ filename: string }>;
      isOffline?: boolean;
      runtimeFailureReason?: string;
    };
    const timeline = await host.legacyDesktop.getTimeline({ type: 'secret', secret }) as {
      eventCount: number;
      events: Array<{ eventHash: string }>;
      isOffline?: boolean;
      runtimeFailureReason?: string;
    };

    expect(opened).toMatchObject({
      volumeId,
      files: [{ filename: 'alpha.txt' }],
      isOffline: true,
      runtimeFailureReason: 'live-open-failed',
      storageHint: 'Using persisted mirrored data. Runtime unavailable.',
    });
    expect(files).toMatchObject({
      volumeId,
      files: [{ filename: 'alpha.txt' }],
      isOffline: true,
      runtimeFailureReason: 'live-list-failed',
    });
    expect(timeline).toMatchObject({
      eventCount: 1,
      events: [{ eventHash: 'evt-file' }],
      isOffline: true,
      runtimeFailureReason: 'live-timeline-failed',
    });
  });

  it('does not flag chat as offline when mirrored fallback contains no chat history', async () => {
    const secret = 'phone-mirror-empty-chat-secret';
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
      eventCount: 1,
      events: [
        {
          eventHash: 'evt-file',
          type: 'CREATE_FILE',
          filename: 'alpha.txt',
          timestamp: 1,
          publishedAt: 1,
        },
      ],
    });

    const host = await getPhoneHost();
    const chat = await host.legacyDesktop.listChat({ type: 'secret', secret }) as {
      identities: Array<{ authorPublicKey: string }>;
      messages: Array<{ eventHash: string }>;
      isOffline?: boolean;
    };

    expect(chat.identities).toEqual([]);
    expect(chat.messages).toEqual([]);
    expect(chat.isOffline).toBeUndefined();
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
    await seedEmbeddedPhoneIntegrationStateForTests({
      version: 1,
      preferredProviders: ['mega'],
      accounts: [
        {
          id: 'acct-mega-phone',
          provider: 'mega',
          label: 'MEGA',
          email: 'phone@example.com',
          state: 'connected',
          detail: 'Connected on phone.',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      managedShares: [
        {
          id: 'share-mega-phone',
          provider: 'mega',
          accountId: 'acct-mega-phone',
          label: 'Phone Share',
          role: 'owner',
          localPath: 'local/mega/phone-share',
          sourceId: 'src-embedded-phone',
          syncMode: 'mirror',
          remoteDescriptor: {
            remotePath: '/nearbytes',
            shareName: 'nearbytes',
          },
          capabilities: ['mirror', 'read', 'write'],
          invitationEmails: [],
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      maintenance: undefined,
    });

    const host = await getPhoneHost();

    await host.objects.requestJson('/config/app/providers/mega', {
      method: 'PUT',
      body: JSON.stringify({ enabled: true }),
      headers: new Headers({ 'content-type': 'application/json' }),
    });
    await host.objects.requestJson('/config/app/providers/github', {
      method: 'PUT',
      body: JSON.stringify({ enabled: true }),
      headers: new Headers({ 'content-type': 'application/json' }),
    });

    await expect(host.integrations.listProviderAccounts()).resolves.toMatchObject({
      accounts: [
        {
          id: 'acct-mega-phone',
          provider: 'mega',
        },
      ],
      preferredProviders: ['mega'],
    });
    await expect(host.integrations.listManagedShares()).resolves.toMatchObject({
      shares: [
        {
          share: {
            id: 'share-mega-phone',
            provider: 'mega',
          },
        },
      ],
    });
    await expect(host.integrations.listIncomingManagedShares()).resolves.toEqual({ shares: [] });
    await expect(host.integrations.listIncomingProviderContactInvites()).resolves.toEqual({ invites: [] });
    await expect(host.integrations.getManagedShareState('share-mega-phone')).resolves.toMatchObject({
      summary: {
        share: {
          id: 'share-mega-phone',
          provider: 'mega',
        },
      },
    });
    await expect(host.integrations.configureProviderSetup('mega', {})).resolves.toMatchObject({
      setup: {
        status: 'ready',
      },
    });
    await expect(host.integrations.installProviderHelper('mega')).resolves.toMatchObject({
      setup: {
        status: 'ready',
      },
    });
    await expect(host.integrations.configureProviderSetup('github', {
      clientId: 'github-phone-client-id',
    })).resolves.toMatchObject({
      setup: {
        status: 'ready',
        config: {
          clientId: 'github-phone-client-id',
        },
      },
    });
    await expect(host.integrations.attachManagedShare('share-mega-phone', 'vol-phone')).resolves.toMatchObject({
      summary: {
        share: {
          id: 'share-mega-phone',
        },
        attachments: [
          {
            volumeId: 'vol-phone',
          },
        ],
      },
    });

    await host.integrations.removeManagedShare('share-mega-phone');
    await expect(host.integrations.listManagedShares()).resolves.toMatchObject({
      shares: [
        {
          share: {
            provider: 'mega',
            role: 'owner',
          },
          storage: {
            enabled: true,
            writable: true,
          },
        },
      ],
    });

    const githubConnectResponse = await host.integrations.connectProviderAccount({
      provider: 'github',
      label: 'GitHub',
      preferred: true,
    }) as {
      status: 'connected' | 'pending' | 'failed';
      account?: { id: string; provider: string; state: string };
    };
    expect(githubConnectResponse).toMatchObject({
      status: 'connected',
      account: {
        provider: 'github',
        state: 'connected',
      },
    });
    expect(githubConnectResponse.account?.id).toBeTruthy();

    await expect(host.integrations.createManagedShare({
      provider: 'github',
      accountId: githubConnectResponse.account?.id ?? '',
      label: 'GitHub Phone Share',
      remoteDescriptor: {
        repoOwner: 'nearbytes',
        repoName: 'phone-share',
      },
    })).resolves.toMatchObject({
      summary: {
        share: {
          provider: 'github',
          accountId: githubConnectResponse.account?.id,
          label: 'GitHub Phone Share',
        },
      },
    });

    await host.integrations.disconnectProviderAccount(githubConnectResponse.account?.id ?? '');
    await expect(host.integrations.listProviderAccounts()).resolves.toMatchObject({
      accounts: [
        {
          id: 'acct-mega-phone',
          provider: 'mega',
        },
      ],
    });
    expect(requestHostJson).not.toHaveBeenCalled();
  });

  it('treats embedded MEGA managed-share local paths as attached phone storage', async () => {
    await seedEmbeddedPhoneIntegrationStateForTests({
      version: 1,
      preferredProviders: ['mega'],
      accounts: [
        {
          id: 'acct-mega-phone',
          provider: 'mega',
          label: 'MEGA',
          email: 'phone@example.com',
          state: 'connected',
          detail: 'Connected on phone.',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      managedShares: [
        {
          id: 'share-mega-phone-owner',
          provider: 'mega',
          accountId: 'acct-mega-phone',
          label: 'nearbytes',
          role: 'owner',
          localPath: 'local/mega/phone-owner/nearbytes',
          sourceId: 'src-mega-managed-3',
          syncMode: 'mirror',
          remoteDescriptor: {
            remotePath: '/nearbytes',
            shareName: 'nearbytes',
          },
          capabilities: ['mirror', 'read', 'write', 'invite'],
          invitationEmails: [],
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      maintenance: undefined,
    });

    const host = await getPhoneHost();

    await host.objects.requestJson('/config/app/providers/mega', {
      method: 'PUT',
      body: JSON.stringify({ enabled: true }),
      headers: new Headers({ 'content-type': 'application/json' }),
    });

    await host.objects.requestJson('/config/roots', {
      method: 'PUT',
      body: JSON.stringify({
        config: {
          version: 2,
          sources: [
            {
              id: 'src-embedded-phone',
              provider: 'local',
              path: '',
              enabled: true,
              writable: true,
              reservePercent: 5,
              opportunisticPolicy: 'block-writes',
            },
            {
              id: 'src-mega-managed-3',
              provider: 'mega',
              path: 'local/mega/phone-owner/nearbytes',
              enabled: true,
              writable: true,
              reservePercent: 5,
              opportunisticPolicy: 'drop-older-blocks',
              integration: {
                kind: 'provider-managed',
                provider: 'mega',
                managedShareId: 'share-mega-phone-owner',
              },
            },
          ],
          defaultVolume: {
            destinations: [
              {
                sourceId: 'src-embedded-phone',
                enabled: true,
                storeEvents: true,
                storeBlocks: true,
                copySourceBlocks: true,
                reservePercent: 5,
                fullPolicy: 'block-writes',
              },
              {
                sourceId: 'src-mega-managed-3',
                enabled: true,
                storeEvents: true,
                storeBlocks: true,
                copySourceBlocks: true,
                reservePercent: 5,
                fullPolicy: 'block-writes',
              },
            ],
          },
          volumes: [],
        },
      }),
      headers: new Headers({ 'content-type': 'application/json' }),
    });

    await expect(host.integrations.listManagedShares()).resolves.toMatchObject({
      shares: [
        {
          share: {
            provider: 'mega',
            role: 'owner',
          },
          storage: {
            sourcePath: expect.stringContaining('local/mega/'),
            enabled: true,
            writable: true,
          },
        },
      ],
    });
  });

  it('attaches opened hubs to the embedded MEGA owner share', async () => {
    await seedEmbeddedPhoneIntegrationStateForTests({
      version: 1,
      preferredProviders: ['mega'],
      accounts: [
        {
          id: 'acct-mega-phone',
          provider: 'mega',
          label: 'MEGA',
          email: 'phone@example.com',
          state: 'needs-auth',
          detail: 'MEGA sign-in required.',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      managedShares: [
        {
          id: 'share-mega-phone-owner',
          provider: 'mega',
          accountId: 'acct-mega-phone',
          label: 'nearbytes',
          role: 'owner',
          localPath: 'local/mega/phone-owner/nearbytes',
          sourceId: 'src-mega-managed-3',
          syncMode: 'mirror',
          remoteDescriptor: {
            remotePath: '/nearbytes',
            shareName: 'nearbytes',
          },
          capabilities: ['mirror', 'read', 'write', 'invite'],
          invitationEmails: [],
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      maintenance: undefined,
    });

    const host = await getPhoneHost();

    await host.objects.requestJson('/config/app/providers/mega', {
      method: 'PUT',
      body: JSON.stringify({ enabled: true }),
      headers: new Headers({ 'content-type': 'application/json' }),
    });

    await host.objects.requestJson('/config/roots', {
      method: 'PUT',
      body: JSON.stringify({
        config: {
          version: 2,
          sources: [
            {
              id: 'src-embedded-phone',
              provider: 'local',
              path: '',
              enabled: true,
              writable: true,
              reservePercent: 5,
              opportunisticPolicy: 'block-writes',
            },
            {
              id: 'src-mega-managed-3',
              provider: 'mega',
              path: 'local/mega/phone-owner/nearbytes',
              enabled: true,
              writable: true,
              reservePercent: 5,
              opportunisticPolicy: 'drop-older-blocks',
              integration: {
                kind: 'provider-managed',
                provider: 'mega',
                managedShareId: 'share-mega-phone-owner',
              },
            },
          ],
          defaultVolume: {
            destinations: [
              {
                sourceId: 'src-embedded-phone',
                enabled: true,
                storeEvents: true,
                storeBlocks: true,
                copySourceBlocks: true,
                reservePercent: 5,
                fullPolicy: 'block-writes',
              },
            ],
          },
          volumes: [],
        },
      }),
      headers: new Headers({ 'content-type': 'application/json' }),
    });

    const opened = await host.legacyDesktop.openVolume('phone-mega-owner-auto-attach-secret') as { volumeId: string };

    await expect(host.objects.requestJson('/config/roots', { method: 'GET' })).resolves.toMatchObject({
      config: {
        volumes: [
          {
            volumeId: opened.volumeId,
            destinations: [
              {
                sourceId: expect.stringMatching(/^src-mega-managed-/),
                enabled: true,
              },
            ],
          },
        ],
      },
    });
  });

  it('bootstraps embedded phone provider accounts from dev env state', async () => {
    resetPhoneHostForTests();
    resetEmbeddedPhoneServicesForTests();
    vi.stubEnv('VITE_NEARBYTES_EMBEDDED_PHONE_INTEGRATION_STATE_B64', encodeJsonBase64({
      version: 1,
      preferredProviders: ['mega'],
      accounts: [
        {
          id: 'acct-mega-dev-bootstrap',
          provider: 'mega',
          label: 'MEGA',
          email: 'phone+bootstrap@example.com',
          state: 'connected',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      managedShares: [
        {
          id: 'share-stale-bootstrap',
          provider: 'mega',
          accountId: 'acct-mega-dev-bootstrap',
          label: 'nearbytes',
          role: 'recipient',
          localPath: '/tmp/desktop-only-nearbytes',
          sourceId: 'src-desktop-stale',
          syncMode: 'mirror',
          remoteDescriptor: { rootHandle: 'abcdefgh' },
          capabilities: ['mirror', 'read'],
          invitationEmails: [],
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    }));
    vi.stubEnv('VITE_NEARBYTES_EMBEDDED_PHONE_PROVIDER_SECRETS_B64', encodeJsonBase64({
      version: 1,
      entries: {
        'provider-account:mega:acct-mega-dev-bootstrap': encodeJsonBase64({
          email: 'phone+bootstrap@example.com',
          password: 'secret',
        }),
      },
    }));

    const host = await getPhoneHost();

    await host.objects.requestJson('/config/app/providers/mega', {
      method: 'PUT',
      body: JSON.stringify({ enabled: true }),
      headers: new Headers({ 'content-type': 'application/json' }),
    });

    await expect(host.integrations.listProviderAccounts()).resolves.toMatchObject({
      accounts: [
        {
          id: 'acct-mega-dev-bootstrap',
          provider: 'mega',
          email: 'phone+bootstrap@example.com',
        },
      ],
      preferredProviders: ['mega'],
    });

    await expect(host.integrations.listManagedShares()).resolves.toMatchObject({
      shares: [
        {
          share: {
            id: 'share-stale-bootstrap',
            provider: 'mega',
            accountId: 'acct-mega-dev-bootstrap',
            role: 'recipient',
          },
        },
      ],
    });
  });

  it('bootstraps embedded phone roots config from dev env state', async () => {
    resetPhoneHostForTests();
    resetEmbeddedPhoneServicesForTests();
    vi.stubEnv('VITE_NEARBYTES_EMBEDDED_PHONE_ROOTS_CONFIG_B64', encodeJsonBase64({
      version: 2,
      sources: [
        {
          id: 'src-embedded-phone',
          provider: 'local',
          path: '',
          enabled: true,
          writable: true,
          reservePercent: 5,
          opportunisticPolicy: 'block-writes',
        },
        {
          id: 'src-mega-managed-bootstrap',
          provider: 'mega',
          path: '/tmp/nearbytes-dev-bootstrap/nearbytes',
          enabled: true,
          writable: true,
          reservePercent: 5,
          opportunisticPolicy: 'drop-older-blocks',
          integration: {
            kind: 'provider-managed',
            provider: 'mega',
            managedShareId: 'share-mega-bootstrap',
          },
        },
      ],
      defaultVolume: {
        destinations: [
          {
            sourceId: 'src-embedded-phone',
            enabled: true,
            storeEvents: true,
            storeBlocks: true,
            copySourceBlocks: true,
            reservePercent: 5,
            fullPolicy: 'block-writes',
          },
        ],
      },
      volumes: [
        {
          volumeId: 'vol-bootstrap',
          destinations: [
            {
              sourceId: 'src-mega-managed-bootstrap',
              enabled: true,
              storeEvents: true,
              storeBlocks: true,
              copySourceBlocks: true,
              reservePercent: 5,
              fullPolicy: 'block-writes',
            },
          ],
        },
      ],
    }));

    const host = await getPhoneHost();

    await expect(host.objects.requestJson('/config/roots', { method: 'GET' })).resolves.toMatchObject({
      config: {
        sources: [
          {
            id: 'src-embedded-phone',
          },
          {
            id: 'src-mega-managed-bootstrap',
            integration: {
              kind: 'provider-managed',
              managedShareId: 'share-mega-bootstrap',
            },
          },
        ],
        volumes: [
          {
            volumeId: 'vol-bootstrap',
            destinations: [
              {
                sourceId: 'src-mega-managed-bootstrap',
                enabled: true,
              },
            ],
          },
        ],
      },
    });
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

  it('bridges embedded phone runtime mutations into semantic volume events', async () => {
    const secret = 'phone-reactive-secret';
    const host = await getPhoneHost();
    const messages: string[] = [];
    const connection = host.invalidation.watchVolumeEvents(
      { type: 'secret', secret },
      {
        onMessage(event) {
          messages.push(String(event.data));
        },
      }
    );

    await Promise.resolve();
    await Promise.resolve();

    await host.legacyDesktop.openVolume(secret);
    await host.legacyDesktop.uploadFile(
      { type: 'secret', secret },
      new File(['reactive'], 'reactive.txt', { type: 'text/plain' })
    );

    await Promise.resolve();
    await Promise.resolve();

    connection.close();

    expect(messages[0]).toContain('event: volume-event-ready');
    expect(messages.some((message) => message.includes('event: volume-event'))).toBe(true);
    expect(messages.some((message) => message.includes('nb.volume.event.v0.1'))).toBe(true);
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
    resetEmbeddedPhoneServicesForTests();
    await seedEmbeddedPhoneRuntimeHeadForTests(secret);
    resetEmbeddedPhoneRuntimeMetricsForTests();

    const reopenedHost = await getPhoneHost();
    await reopenedHost.objects.requestJson('/config/roots', {
      method: 'PUT',
      body: JSON.stringify({
        config: {
          version: 2,
          sources: [
            {
              id: 'src-embedded-phone',
              provider: 'local',
              path: '',
              enabled: true,
              writable: true,
              reservePercent: 5,
              opportunisticPolicy: 'block-writes',
            },
          ],
          defaultVolume: {
            destinations: [
              {
                sourceId: 'src-embedded-phone',
                enabled: true,
                storeEvents: true,
                storeBlocks: true,
                copySourceBlocks: true,
                reservePercent: 5,
                fullPolicy: 'block-writes',
              },
            ],
          },
          volumes: [],
        },
      }),
      headers: new Headers({ 'content-type': 'application/json' }),
    });
    const reopened = await reopenedHost.legacyDesktop.openVolume(secret) as {
      files: Array<{ filename: string }>;
      isOffline?: boolean;
    };

    expect(reopened.files).toMatchObject([{ filename: 'bootstrap.txt' }]);
    expect(reopened.isOffline).toBeUndefined();
    expect(readEmbeddedPhoneRuntimeMetricsForTests()).toMatchObject({
      refreshReads: 0,
      bootstrappedReads: 1,
    });
  });

  it('bootstraps embedded phone chat reads from durable runtime heads without falling back offline', async () => {
    const secret = 'phone-chat-bootstrap-secret';
    const host = await getPhoneHost();

    await host.legacyDesktop.publishIdentity(
      { type: 'secret', secret },
      'identity:bootstrap',
      { displayName: 'Bootstrap Alice' }
    );
    await host.legacyDesktop.sendChatMessage(
      { type: 'secret', secret },
      'identity:bootstrap',
      { body: 'hello from bootstrap' }
    );

    resetPhoneHostForTests();
    resetEmbeddedPhoneServicesForTests();
    await seedEmbeddedPhoneRuntimeHeadForTests(secret);
    resetEmbeddedPhoneRuntimeMetricsForTests();

    const reopenedHost = await getPhoneHost();
    await reopenedHost.objects.requestJson('/config/roots', {
      method: 'PUT',
      body: JSON.stringify({
        config: {
          version: 2,
          sources: [
            {
              id: 'src-embedded-phone',
              provider: 'local',
              path: '',
              enabled: true,
              writable: true,
              reservePercent: 5,
              opportunisticPolicy: 'block-writes',
            },
          ],
          defaultVolume: {
            destinations: [
              {
                sourceId: 'src-embedded-phone',
                enabled: true,
                storeEvents: true,
                storeBlocks: true,
                copySourceBlocks: true,
                reservePercent: 5,
                fullPolicy: 'block-writes',
              },
            ],
          },
          volumes: [],
        },
      }),
      headers: new Headers({ 'content-type': 'application/json' }),
    });
    const chat = await reopenedHost.legacyDesktop.listChat({ type: 'secret', secret }) as {
      identities: Array<{ authorPublicKey: string }>;
      messages: Array<{ message: { body?: string } }>;
      isOffline?: boolean;
    };

    expect(chat.identities).toHaveLength(1);
    expect(chat.messages).toMatchObject([{ message: { body: 'hello from bootstrap' } }]);
    expect(chat.isOffline).toBeUndefined();
    expect(readEmbeddedPhoneRuntimeMetricsForTests()).toMatchObject({
      bootstrappedReads: 1,
    });
  });

  it('ignores stale bootstrapped snapshots for provider-managed attached volumes', async () => {
    const secret = 'phone-managed-bootstrap-stale-secret';
    const keyPair = await deriveKeys(createSecret(secret));
    const volumeId = Array.from(keyPair.publicKey)
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('');

    await importCompatibilityVolumeSnapshot({
      volumeId,
      files: [{ filename: 'stale.jpg', blobHash: 'stale-1', size: 264604, createdAt: 1 }],
    });
    await importCompatibilityTimelineSnapshot({
      volumeId,
      eventCount: 1,
      events: [
        {
          eventHash: 'evt-stale-file',
          type: 'CREATE_FILE',
          filename: 'stale.jpg',
          timestamp: 1,
          publishedAt: 1,
        },
      ],
    });

    resetPhoneHostForTests();
    resetEmbeddedPhoneServicesForTests();
    await seedEmbeddedPhoneRuntimeHeadForTests(secret);

    const host = await getPhoneHost();
    await host.objects.requestJson('/config/roots', {
      method: 'PUT',
      body: JSON.stringify({
        config: {
          version: 2,
          sources: [
            {
              id: 'src-embedded-phone',
              provider: 'local',
              path: '',
              enabled: true,
              writable: true,
              reservePercent: 5,
              opportunisticPolicy: 'block-writes',
            },
            {
              id: 'src-mega-managed-stale',
              provider: 'mega',
              path: 'local/mega/phone-owner/nearbytes',
              enabled: true,
              writable: true,
              reservePercent: 5,
              opportunisticPolicy: 'drop-older-blocks',
              integration: {
                kind: 'provider-managed',
                provider: 'mega',
                managedShareId: 'share-mega-phone-owner',
              },
            },
          ],
          defaultVolume: {
            destinations: [
              {
                sourceId: 'src-embedded-phone',
                enabled: true,
                storeEvents: true,
                storeBlocks: true,
                copySourceBlocks: true,
                reservePercent: 5,
                fullPolicy: 'block-writes',
              },
            ],
          },
          volumes: [
            {
              volumeId,
              destinations: [
                {
                  sourceId: 'src-mega-managed-stale',
                  enabled: true,
                  storeEvents: true,
                  storeBlocks: true,
                  copySourceBlocks: true,
                  reservePercent: 5,
                  fullPolicy: 'block-writes',
                },
              ],
            },
          ],
        },
      }),
      headers: new Headers({ 'content-type': 'application/json' }),
    });
    resetEmbeddedPhoneRuntimeMetricsForTests();

    const opened = await host.legacyDesktop.openVolume(secret) as {
      volumeId: string;
      fileCount: number;
      files: Array<{ filename: string }>;
      isOffline?: boolean;
    };

    expect(opened).toMatchObject({
      volumeId,
      fileCount: 0,
      files: [],
    });
    expect(opened.isOffline).toBeUndefined();
    expect(readEmbeddedPhoneRuntimeMetricsForTests()).toMatchObject({
      refreshReads: 0,
      bootstrappedReads: 0,
    });
  });

  it('reads attached provider-managed files through the embedded multi-root runtime', async () => {
    const secret = 'phone-managed-recipient-visible-secret';
    const keyPair = await deriveKeys(createSecret(secret));
    const volumeId = Array.from(keyPair.publicKey)
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('');
    const runtime = createRuntimeCoreServices({
      log: createInMemoryLog({ store: createMemoryStore() }),
    });
    await runtime.fileService.addFile(secret, 'recipient-visible.txt', Buffer.from('from provider root'), 'text/plain');

    resetPhoneHostForTests();
    resetEmbeddedPhoneServicesForTests();

    const host = await getPhoneHost();
    await host.objects.requestJson('/config/roots', {
      method: 'PUT',
      body: JSON.stringify({
        config: {
          version: 2,
          sources: [
            {
              id: 'src-embedded-phone',
              provider: 'local',
              path: '',
              enabled: true,
              writable: true,
              reservePercent: 5,
              opportunisticPolicy: 'block-writes',
            },
            {
              id: 'src-mega-managed-recipient',
              provider: 'mega',
              path: 'local/provider-managed/mega/share-mega-phone-recipient',
              enabled: true,
              writable: false,
              reservePercent: 5,
              opportunisticPolicy: 'drop-older-blocks',
              integration: {
                kind: 'provider-managed',
                provider: 'mega',
                managedShareId: 'share-mega-phone-recipient',
              },
            },
          ],
          defaultVolume: {
            destinations: [
              {
                sourceId: 'src-embedded-phone',
                enabled: true,
                storeEvents: true,
                storeBlocks: true,
                copySourceBlocks: true,
                reservePercent: 5,
                fullPolicy: 'block-writes',
              },
            ],
          },
          volumes: [
            {
              volumeId,
              destinations: [
                {
                  sourceId: 'src-mega-managed-recipient',
                  enabled: true,
                  storeEvents: true,
                  storeBlocks: true,
                  copySourceBlocks: true,
                  reservePercent: 5,
                  fullPolicy: 'block-writes',
                },
              ],
            },
          ],
        },
      }),
      headers: new Headers({ 'content-type': 'application/json' }),
    });

    for (const [path, record] of store.files.entries()) {
      await seedEmbeddedPhoneStoredRecordForTests(`local/provider-managed/mega/share-mega-phone-recipient/${path}`, record.data);
    }

    const files = await host.legacyDesktop.listFiles({ type: 'secret', secret }) as {
      volumeId: string;
      files: Array<{ filename: string }>;
    };
    const timeline = await host.legacyDesktop.getTimeline({ type: 'secret', secret }) as {
      volumeId: string;
      eventCount: number;
    };

    expect(files).toMatchObject({
      volumeId,
      files: [{ filename: 'recipient-visible.txt' }],
    });
    expect(timeline).toMatchObject({
      volumeId,
    });
    expect(timeline.eventCount).toBeGreaterThan(0);
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
