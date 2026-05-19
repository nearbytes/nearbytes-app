import { mkdtemp, mkdir, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import type { RootsConfig } from '../../config/roots.js';
import { createCryptoOperations } from 'nearbytes-crypto';
import { createFileService } from 'nearbytes-files';
import { createLog } from 'nearbytes-log';
import { defaultPathMapper } from 'nearbytes-storage';
import { MultiRootStorageBackend } from '../../storage/multiRoot.js';
import type { VolumeSyncInventory } from '../../storage/multiRoot.js';
import { createSecret } from 'nearbytes-crypto';
import { type LanPeerTransport, type LanPeerTransportCallbacks, type LanPeerTransportResponse, type LanTransportDiscoveredPeer, type LanTransportRpcRequest } from '../lanPeerTransport.js';
import { LocalNetworkSyncService } from '../localNetworkSync.js';

const cleanupPaths: string[] = [];

afterEach(async () => {
  while (cleanupPaths.length > 0) {
    const target = cleanupPaths.pop();
    if (!target) {
      continue;
    }
    await rm(target, { recursive: true, force: true });
  }
});

describe('LocalNetworkSyncService', () => {
  it('pulls observation pages and resumes from the persisted cursor after restart', async () => {
    const secret = 'test:secret:lan-sync';
    const remote = await createLanHarness('nearbytes-lan-remote-', secret, 'peer-b', 3101);
    const local = await createLanHarness('nearbytes-lan-local-', secret, 'peer-a', 3102);
    connectLanPeers(local.transport, remote.lanService, remote.port);

    const firstRemoteFile = await remote.fileService.addFile(secret, 'first.txt', Buffer.from('alpha'), 'text/plain');
    expect(await remote.lanService.readBlockBytes(firstRemoteFile.blobHash)).toBeInstanceOf(Uint8Array);

    const remoteHello = await remote.lanService.buildHello();
    seedKnownPeer(local.lanService, remoteHello, remote.port);
    const firstPeer = await local.lanService.syncPeer(remoteHello.peerId);
    expect(firstPeer?.remoteCursorObservationId).toMatch(/^[0-9a-f]{64}$/);
    expect((await local.fileService.listFiles(secret)).map((entry) => entry.filename)).toContain('first.txt');

    const firstCursor = firstPeer?.remoteCursorObservationId ?? null;
    await remote.fileService.addFile(secret, 'second.txt', Buffer.from('beta'), 'text/plain');

    await local.lanService.stop();
    const restartedTransport = new FakeLanPeerTransport();
    const restartedLocalLan = new LocalNetworkSyncService(local.storage, {
      storageDir: local.storageDir,
      peerTransport: restartedTransport,
    });
    await restartedLocalLan.start(local.port);
    connectLanPeers(restartedTransport, remote.lanService, remote.port);
    seedKnownPeer(restartedLocalLan, await remote.lanService.buildHello(), remote.port);
    const secondPeer = await restartedLocalLan.syncPeer((await remote.lanService.buildHello()).peerId);
    expect(secondPeer?.remoteCursorObservationId).not.toBeNull();
    expect(secondPeer?.remoteCursorObservationId).not.toBe(firstCursor);
    expect((await local.fileService.listFiles(secret)).map((entry) => entry.filename).sort()).toEqual([
      'first.txt',
      'second.txt',
    ]);

    await restartedLocalLan.stop();
    await remote.lanService.stop();
  });

  it('does not fail the peer when inventory recovery references an event the remote can no longer serve', async () => {
    const secret = 'test:secret:lan-missing-event';
    const remote = await createLanHarness('nearbytes-lan-remote-missing-', secret, 'peer-b', 3201);
    const local = await createLanHarness('nearbytes-lan-local-missing-', secret, 'peer-a', 3202);
    connectLanPeers(local.transport, remote.lanService, remote.port, {
      missingEventFetches: new Set(['ghost']),
      inventoryOverride: async (volumeId, inventory) => ({
        ...inventory,
        eventHashes: volumeId === inventory.volumeId ? [...inventory.eventHashes, 'ghost'] : inventory.eventHashes,
      }),
    });

    const stableRemoteFile = await remote.fileService.addFile(secret, 'stable.txt', Buffer.from('alpha'), 'text/plain');
    expect(await remote.lanService.readBlockBytes(stableRemoteFile.blobHash)).toBeInstanceOf(Uint8Array);
    const hello = await remote.lanService.buildHello();
    seedKnownPeer(local.lanService, hello, remote.port);
    const peer = await local.lanService.syncPeer(hello.peerId);
    expect(peer?.lastSyncError).toBeNull();
    expect((await local.fileService.listFiles(secret)).map((entry) => entry.filename)).toContain('stable.txt');

    await local.lanService.stop();
    await remote.lanService.stop();
  });

  it('does not fail the peer when an observation references an event the remote can no longer serve', async () => {
    const secret = 'test:secret:lan-missing-observation-event';
    const remote = await createLanHarness('nearbytes-lan-remote-missing-observation-', secret, 'peer-b', 3251);
    const local = await createLanHarness('nearbytes-lan-local-missing-observation-', secret, 'peer-a', 3252);

    await remote.fileService.addFile(secret, 'stable.txt', Buffer.from('alpha'), 'text/plain');
    const hello = await remote.lanService.buildHello();
    const volumeId = hello.volumeIds[0];
    expect(volumeId).toBeTruthy();
    let injectedGhost = false;
    connectLanPeers(local.transport, remote.lanService, remote.port, {
      observationsOverride: async (page) => {
        if (injectedGhost) {
          return page;
        }
        injectedGhost = true;
        return {
          ...page,
          observations: [
            ...page.observations,
            {
              observationId: 'dd'.repeat(32),
              prevObservationId: page.observations.at(-1)?.observationId ?? null,
              kind: 'event',
              hash: 'ghost',
              relativePath: `channels/${volumeId}/ghost.bin`,
              sourceId: 'src-main',
              volumeId,
              observedAt: Date.now(),
            },
          ],
          headObservationId: 'dd'.repeat(32),
        };
      },
      missingEventFetches: new Set(['ghost']),
    });

    seedKnownPeer(local.lanService, hello, remote.port);
    const peer = await local.lanService.syncPeer(hello.peerId);
    expect(peer?.lastSyncError).toBeNull();
    expect((await local.fileService.listFiles(secret)).map((entry) => entry.filename)).toContain('stable.txt');

    await local.lanService.stop();
    await remote.lanService.stop();
  });

  it('stores local-network runtime state outside a custom storage root', async () => {
    const secret = 'test:secret:lan-runtime-dir';
    const harness = await createLanHarness('nearbytes-lan-runtime-dir-', secret, 'peer-a', 3301);

    const internal = harness.lanService as unknown as {
      runtimeDir: string;
    };
    expect(path.resolve(internal.runtimeDir)).not.toBe(path.join(path.resolve(harness.storageDir), 'local-network'));

    await harness.lanService.stop();
  });

  it('treats LAN abort timeouts as transient retry states instead of hard peer errors', async () => {
    const secret = 'test:secret:lan-timeout';
    const remote = await createLanHarness('nearbytes-lan-timeout-remote-', secret, 'peer-b', 3401);
    const local = await createLanHarness('nearbytes-lan-timeout-local-', secret, 'peer-a', 3402);
    connectLanPeers(local.transport, remote.lanService, remote.port, {
      helloError: abortError('This operation was aborted.'),
    });

    const hello = await remote.lanService.buildHello();
    seedKnownPeer(local.lanService, hello, remote.port);
    const peer = await local.lanService.syncPeer(hello.peerId);
    expect(peer?.status).toBe('ready');
    expect(peer?.lastSyncError).toBeNull();
    expect(peer?.lastSyncNotice).toBe('Peer timed out; Nearbytes will retry automatically.');

    await local.lanService.stop();
    await remote.lanService.stop();
  });

  it('advertises observed volume ids from the provider queue even when the config has no tracked volumes', async () => {
    const secret = 'test:secret:lan-observed-volume-advertise';
    const remote = await createLanHarness('nearbytes-lan-observed-volume-', secret, 'peer-b', 3501);
    await remote.fileService.addFile(secret, 'observed.txt', Buffer.from('gamma'), 'text/plain');

    const internalStorage = remote.storage as unknown as { config: RootsConfig };
    internalStorage.config = {
      ...internalStorage.config,
      volumes: [],
    };

    const hello = await waitForHelloVolumes(remote.lanService);
    expect(hello.volumeIds.length).toBeGreaterThan(0);

    await remote.lanService.stop();
  });

  it('describes common mounted storage peers without implying a broken lan sync state', async () => {
    const secret = 'test:secret:lan-common-mounted-volume';
    const remote = await createLanHarness('nearbytes-lan-common-mounted-', secret, 'peer-b', 3601);
    const local = await createLanHarness('nearbytes-lan-common-mounted-local-', secret, 'peer-a', 3602);
    connectLanPeers(local.transport, remote.lanService, remote.port, {
      helloOverride: async (hello) => ({
        ...hello,
        volumeIds: [],
        observationHeadId: null,
      }),
      observationsOverride: async (page) => ({
        ...page,
        observations: [],
        headObservationId: null,
      }),
    });

    const hello = await remote.lanService.buildHello();
    seedKnownPeer(local.lanService, hello, remote.port);
    const peer = await local.lanService.syncPeer(hello.peerId);
    expect(peer?.status).toBe('ready');
    expect(peer?.detail).toContain('same mounted storage');

    await local.lanService.stop();
    await remote.lanService.stop();
  });

  it('shows disappeared peers as stale instead of preserving an old hard transport error', async () => {
    const secret = 'test:secret:lan-stale-peer';
    const remote = await createLanHarness('nearbytes-lan-stale-remote-', secret, 'peer-b', 3701);
    const local = await createLanHarness('nearbytes-lan-stale-local-', secret, 'peer-a', 3702);

    const hello = await remote.lanService.buildHello();
    seedKnownPeer(local.lanService, hello, remote.port);

    const internal = local.lanService as unknown as {
      peers: Map<string, {
        lastSeenAt: number;
        lastSyncError: string | null;
        lastSyncTransient: boolean;
        lastSyncNotice: string | null;
      }>;
      getPeersResponse: () => import('../localNetworkSync.js').LocalNetworkPeersResponse;
    };
    const peer = internal.peers.get(hello.peerId);
    expect(peer).toBeTruthy();
    if (!peer) {
      throw new Error('Expected seeded peer');
    }

    peer.lastSeenAt = Date.now() - 30_000;
    peer.lastSyncError = 'LAN WebRTC hello failed for peer-b: timeout';
    peer.lastSyncTransient = false;
    peer.lastSyncNotice = null;

    const snapshot = local.lanService.getPeersResponse().peers.find((entry) => entry.peerId === hello.peerId);
    expect(snapshot?.status).toBe('stale');
    expect(snapshot?.lastSyncError).toBeNull();
    expect(snapshot?.lastSyncNotice).toBe('Peer is offline or quiet; Nearbytes will reconnect automatically.');
    expect(snapshot?.detail).toBe('Peer is offline or quiet; Nearbytes will reconnect automatically.');
    expect(local.lanService.getPeersResponse().service.peerCount).toBe(0);

    await local.lanService.stop();
    await remote.lanService.stop();
  });

  it('only requests events and blocks that the receiver is actually missing', async () => {
    const secret = 'test:secret:lan-want-first';
    const remote = await createLanHarness('nearbytes-lan-want-first-remote-', secret, 'peer-b', 3801);
    const local = await createLanHarness('nearbytes-lan-want-first-local-', secret, 'peer-a', 3802);
    const requestCounts = {
      event: 0,
      block: 0,
    };
    connectLanPeers(local.transport, remote.lanService, remote.port, {
      onEventRequest: () => {
        requestCounts.event += 1;
      },
      onBlockRequest: () => {
        requestCounts.block += 1;
      },
    });

    await remote.fileService.addFile(secret, 'wanted.txt', Buffer.from('payload'), 'text/plain');
    const hello = await remote.lanService.buildHello();
    seedKnownPeer(local.lanService, hello, remote.port);

    await local.lanService.syncPeer(hello.peerId);
    expect(requestCounts.event).toBeGreaterThan(0);
    expect(requestCounts.block).toBeGreaterThan(0);

    requestCounts.event = 0;
    requestCounts.block = 0;

    await local.lanService.syncPeer(hello.peerId);
    expect(requestCounts.event).toBe(0);
    expect(requestCounts.block).toBe(0);

    await local.lanService.stop();
    await remote.lanService.stop();
  });

  it('pushes an immediate storage command after a new local observation and the receiver imports it without a full sync loop', async () => {
    const secret = 'test:secret:lan-immediate-storage-command';
    const local = await createLanHarness('nearbytes-lan-immediate-storage-command-local-', secret, 'peer-a', 3901);
    const remote = await createLanHarness('nearbytes-lan-immediate-storage-command-remote-', secret, 'peer-b', 3902);
    connectLanPeers(local.transport, remote.lanService, remote.port);

    const remoteHello = await remote.lanService.buildHello();
    const localHello = await local.lanService.buildHello();
    seedKnownPeer(local.lanService, remoteHello, remote.port);
    seedKnownPeer(remote.lanService, localHello, local.port);
    connectLanPeers(remote.transport, local.lanService, local.port);
    await local.lanService.syncPeer(remoteHello.peerId);

    const dispatchStart = Date.now();
    await local.fileService.addFile(secret, 'fast.txt', Buffer.from('delta'), 'text/plain');
    const notified = await local.transport.waitForNotifyCount(remoteHello.peerId, 1, 2_000);
    expect(notified).toBe(true);
    expect(Date.now() - dispatchStart).toBeLessThan(2_000);
    const request = local.transport.getLastNotifyRequest(remoteHello.peerId);
    const hintedHello = await local.lanService.buildHello();
    expect(request?.action).toBe('storage-command');
    if (!request || request.action !== 'storage-command') {
      throw new Error('Expected a storage-command request');
    }
    expect(request.command.fromPeerId).toBe('peer-a');

    const imported = await waitForFile(remote.fileService, secret, 'fast.txt');
    expect(imported).toBe(true);
    expect(hintedHello.volumeIds).toContain(
      request.command.type === 'want-event' ? request.command.volumeId : hintedHello.volumeIds[0]
    );

    await local.lanService.stop();
    await remote.lanService.stop();
  });
});

async function createLanHarness(prefix: string, secretValue: string, peerId: string, port: number): Promise<{
  storage: MultiRootStorageBackend;
  storageDir: string;
  fileService: ReturnType<typeof createFileService>;
  lanService: LocalNetworkSyncService;
  transport: FakeLanPeerTransport;
  port: number;
}> {
  const baseDir = await mkdtemp(path.join(tmpdir(), prefix));
  cleanupPaths.push(baseDir);
  const storageDir = path.join(baseDir, 'main');
  await mkdir(storageDir, { recursive: true });

  const crypto = createCryptoOperations();
  const secret = createSecret(secretValue);
  const keys = await crypto.deriveKeys(secret);
  const volumeId = Buffer.from(keys.publicKey).toString('hex');
  const storage = new MultiRootStorageBackend(createConfig(storageDir, volumeId));
  const fileService = createFileService({ log: createLog(storage, defaultPathMapper), crypto, storage });
  const transport = new FakeLanPeerTransport();
  const lanService = new LocalNetworkSyncService(storage, {
    storageDir,
    peerTransport: transport,
  });
  await lanService.start(port);
  await forcePeerIdentity(lanService, peerId);
  await transport.refreshAdvertisement?.();

  return {
    storage,
    storageDir,
    fileService,
    lanService,
    transport,
    port,
  };
}

async function forcePeerIdentity(service: LocalNetworkSyncService, peerId: string): Promise<void> {
  const internal = service as unknown as {
    peerId: string;
    label: string;
  };
  internal.peerId = peerId;
  internal.label = peerId;
}

function seedKnownPeer(
  service: LocalNetworkSyncService,
  hello: Awaited<ReturnType<LocalNetworkSyncService['buildHello']>>,
  port: number
): void {
  const internal = service as unknown as {
    peers: Map<string, unknown>;
  };
  internal.peers.set(hello.peerId, {
    peerId: hello.peerId,
    label: hello.label,
    address: hello.label.toLowerCase(),
    port,
    endpointUrl: `webrtc://${hello.peerId}`,
    capabilities: [...hello.capabilities],
    volumeIds: [],
    announcementCounter: 1,
    firstSeenAt: Date.now(),
    lastSeenAt: Date.now(),
    lastHelloAt: null,
    lastSyncAt: null,
    lastSyncStartedAt: null,
    lastSyncError: null,
    lastSyncTransient: false,
    lastSyncNotice: null,
    lastImportedEvents: 0,
    lastImportedBlocks: 0,
    remoteCursorObservationId: null,
    lastRemoteHeadObservationId: null,
    syncing: false,
    queued: false,
  });
}

interface RemoteBehavior {
  readonly missingEventFetches?: ReadonlySet<string>;
  readonly helloError?: Error;
  readonly onEventRequest?: (volumeId: string, eventHash: string) => void;
  readonly onBlockRequest?: (blockHash: string) => void;
  readonly helloOverride?: (hello: Awaited<ReturnType<LocalNetworkSyncService['buildHello']>>) => Promise<Awaited<ReturnType<LocalNetworkSyncService['buildHello']>>> | Awaited<ReturnType<LocalNetworkSyncService['buildHello']>>;
  readonly observationsOverride?: (page: Awaited<ReturnType<LocalNetworkSyncService['listObservations']>>) => Promise<Awaited<ReturnType<LocalNetworkSyncService['listObservations']>>> | Awaited<ReturnType<LocalNetworkSyncService['listObservations']>>;
  readonly inventoryOverride?: (volumeId: string, inventory: VolumeSyncInventory) => Promise<VolumeSyncInventory> | VolumeSyncInventory;
}

function connectLanPeers(
  transport: FakeLanPeerTransport,
  remoteService: LocalNetworkSyncService,
  remotePort: number,
  behavior: RemoteBehavior = {}
): void {
  transport.registerRemote(remoteService, remotePort, behavior);
}

class FakeLanPeerTransport implements LanPeerTransport {
  private callbacks: LanPeerTransportCallbacks | null = null;
  private remotes = new Map<string, { service: LocalNetworkSyncService; port: number; behavior: RemoteBehavior }>();
  private notifyCounts = new Map<string, number>();
  private lastNotifyRequests = new Map<string, Extract<LanTransportRpcRequest, { action: 'sync-hint' | 'storage-command' }>>();

  async start(callbacks: LanPeerTransportCallbacks): Promise<void> {
    this.callbacks = callbacks;
  }

  async stop(): Promise<void> {
    this.callbacks = null;
    this.remotes.clear();
    this.notifyCounts.clear();
    this.lastNotifyRequests.clear();
  }

  async refreshAdvertisement(): Promise<void> {
    return;
  }

  registerRemote(service: LocalNetworkSyncService, port: number, behavior: RemoteBehavior = {}): void {
    const internal = service as unknown as { peerId: string };
    this.remotes.set(internal.peerId, { service, port, behavior });
  }

  async discover(service: LocalNetworkSyncService, port: number): Promise<void> {
    if (!this.callbacks) {
      throw new Error('Fake LAN transport is not started');
    }
    const hello = await service.buildHello();
    this.callbacks.onPeerDiscovered({
      peerId: hello.peerId,
      label: hello.label,
      address: hello.label.toLowerCase(),
      port,
      capabilities: [...hello.capabilities],
      headObservationId: hello.observationHeadId,
    });
  }

  async requestJson<TResponse>(peer: LanTransportDiscoveredPeer, request: LanTransportRpcRequest): Promise<TResponse> {
    const response = await this.dispatch(peer, request);
    if (response.kind !== 'json') {
      throw new Error(`Expected JSON response for ${request.action}`);
    }
    return response.value as TResponse;
  }

  async requestBytes(peer: LanTransportDiscoveredPeer, request: LanTransportRpcRequest): Promise<Uint8Array> {
    const response = await this.dispatch(peer, request);
    if (response.kind !== 'bytes') {
      throw new Error(`Expected byte response for ${request.action}`);
    }
    return response.value;
  }

  async notify(
    peer: LanTransportDiscoveredPeer,
    request: Extract<LanTransportRpcRequest, { action: 'sync-hint' | 'storage-command' }>
  ): Promise<void> {
    this.notifyCounts.set(peer.peerId, (this.notifyCounts.get(peer.peerId) ?? 0) + 1);
    this.lastNotifyRequests.set(peer.peerId, request);
    await this.dispatch(peer, request);
  }

  async waitForNotifyCount(peerId: string, minimum: number, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if ((this.notifyCounts.get(peerId) ?? 0) >= minimum) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return (this.notifyCounts.get(peerId) ?? 0) >= minimum;
  }

  getLastNotifyRequest(peerId: string): Extract<LanTransportRpcRequest, { action: 'sync-hint' | 'storage-command' }> | null {
    return this.lastNotifyRequests.get(peerId) ?? null;
  }

  private async dispatch(peer: LanTransportDiscoveredPeer, request: LanTransportRpcRequest): Promise<LanPeerTransportResponse> {
    const remote = this.remotes.get(peer.peerId);
    if (!remote) {
      throw new Error(`Unknown fake LAN peer ${peer.peerId}`);
    }

    if (request.action === 'hello' && remote.behavior.helloError) {
      throw remote.behavior.helloError;
    }

    switch (request.action) {
      case 'hello': {
        const hello = await remote.service.buildHello();
        return {
          kind: 'json',
          value: remote.behavior.helloOverride ? await remote.behavior.helloOverride(hello) : hello,
        };
      }
      case 'volumes':
        return {
          kind: 'json',
          value: await remote.service.listVolumes(),
        };
      case 'observations': {
        const page = remote.service.listObservations({
          afterObservationId: request.afterObservationId,
          volumeIds: request.volumeIds,
          limit: request.limit,
        });
        return {
          kind: 'json',
          value: remote.behavior.observationsOverride ? await remote.behavior.observationsOverride(page) : page,
        };
      }
      case 'inventory': {
        const inventory = await remote.service.getVolumeInventory(request.volumeId);
        return {
          kind: 'json',
          value: remote.behavior.inventoryOverride
            ? await remote.behavior.inventoryOverride(request.volumeId, inventory)
            : inventory,
        };
      }
      case 'event':
        remote.behavior.onEventRequest?.(request.volumeId, request.eventHash);
        if (remote.behavior.missingEventFetches?.has(request.eventHash)) {
          throw new Error(`404 missing event ${request.eventHash}`);
        }
        return {
          kind: 'bytes',
          value: await remote.service.readEventBytes(request.volumeId, request.eventHash),
        };
      case 'block':
        remote.behavior.onBlockRequest?.(request.blockHash);
        return {
          kind: 'bytes',
          value: await remote.service.readBlockBytes(request.blockHash),
        };
      case 'sync-hint':
        remote.service.notifySyncHint({ reason: request.reason, volumeIds: request.volumeIds });
        return {
          kind: 'json',
          value: { ok: true, acceptedAt: Date.now() },
        };
      case 'storage-command':
        return await (remote.service as unknown as {
          handleTransportRequest: (request: LanTransportRpcRequest) => Promise<LanPeerTransportResponse>;
        }).handleTransportRequest(request);
      default:
        throw new Error(`Unsupported fake LAN request`);
    }
  }
}

function abortError(message: string): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

async function waitForHelloVolumes(service: LocalNetworkSyncService): Promise<Awaited<ReturnType<LocalNetworkSyncService['buildHello']>>> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const hello = await service.buildHello();
    if (hello.volumeIds.length > 0) {
      return hello;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return await service.buildHello();
}

async function waitForFile(
  fileService: ReturnType<typeof createFileService>,
  secret: string,
  filename: string
): Promise<boolean> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const files = await fileService.listFiles(secret);
    if (files.some((entry) => entry.filename === filename)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return (await fileService.listFiles(secret)).some((entry) => entry.filename === filename);
}

function createConfig(mainRoot: string, volumeId: string): RootsConfig {
  return {
    version: 2,
    sources: [
      {
        id: 'src-main',
        provider: 'local',
        path: mainRoot,
        enabled: true,
        writable: true,
        reservePercent: 5,
        opportunisticPolicy: 'drop-older-blocks',
      },
    ],
    defaultVolume: {
      destinations: [
        {
          sourceId: 'src-main',
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
            sourceId: 'src-main',
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
  };
}
