import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  importCompatibilityEventDetail,
  importCompatibilityTimelineSnapshot,
  importCompatibilityVolumeSnapshot,
  importLocalNetworkPeersSnapshot,
  readMirrorEventDetail,
  readMirrorLocalNetworkPeers,
  readMirrorTimelineSnapshot,
  readMirrorVolumeSnapshot,
  resetBrowserMirrorForTests,
  subscribeBrowserMirror,
  writeLanPeerSnapshot,
  writeMirrorCheckpoint,
} from './browserMirror.js';

describe('browserMirror', () => {
  afterEach(() => {
    resetBrowserMirrorForTests();
  });

  it('stores compatibility snapshots in the browser mirror fallback store', async () => {
    await importCompatibilityVolumeSnapshot({
      volumeId: 'vol-1',
      files: [{ filename: 'alpha.txt', blobHash: 'h1', size: 3, createdAt: 1 }],
    });
    await importCompatibilityTimelineSnapshot({
      volumeId: 'vol-1',
      eventCount: 1,
      events: [{ eventHash: 'evt-1', type: 'CREATE_FILE', filename: 'alpha.txt', timestamp: 1 }],
    });
    await importCompatibilityEventDetail({
      eventHash: 'evt-1',
      event: {
        envelope: {
          version: 'v1',
          publicKey: 'pk',
          blockRefs: [],
          ciphertext: 'cipher',
        },
        signature: 'sig',
      },
    });

    await expect(readMirrorVolumeSnapshot('vol-1')).resolves.toMatchObject({ volumeId: 'vol-1' });
    await expect(readMirrorTimelineSnapshot('vol-1')).resolves.toMatchObject({ eventCount: 1 });
    await expect(readMirrorEventDetail('evt-1')).resolves.toMatchObject({ eventHash: 'evt-1' });
  });

  it('publishes mirror updates for compatibility imports and lightweight runtime records', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeBrowserMirror(listener);

    await importCompatibilityVolumeSnapshot({ volumeId: 'vol-2', files: [] });
    await writeLanPeerSnapshot('peer-1', { status: 'ready' });
    await writeMirrorCheckpoint('vol-2:timeline', { cursor: 'evt-1' });
    unsubscribe();

    expect(listener).toHaveBeenCalledWith('volumes', 'vol-2');
    expect(listener).toHaveBeenCalledWith('lanPeers', 'peer-1');
    expect(listener).toHaveBeenCalledWith('checkpoints', 'vol-2:timeline');
  });

  it('stores and reloads local network peer snapshots', async () => {
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

    await expect(readMirrorLocalNetworkPeers()).resolves.toMatchObject({
      service: { peerId: 'self-1', listening: true },
      peers: [{ peerId: 'peer-1', label: 'Alpha phone' }],
    });
  });
});