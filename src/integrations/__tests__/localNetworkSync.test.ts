import { mkdtemp, mkdir, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RootsConfig } from '../../config/roots.js';
import { createCryptoOperations } from '../../crypto/index.js';
import { createFileService } from '../../domain/fileService.js';
import { MultiRootStorageBackend } from '../../storage/multiRoot.js';
import { createSecret } from '../../types/keys.js';
import { LocalNetworkSyncService } from '../localNetworkSync.js';

const cleanupPaths: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
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

    await remote.fileService.addFile(secret, 'first.txt', Buffer.from('alpha'), 'text/plain');
    installLanFetchStub({
      [remote.baseUrl]: remote.lanService,
    });

    addPeer(local.lanService, await remote.lanService.buildHello(), remote.baseUrl);
    const firstPeer = await local.lanService.syncPeer((await remote.lanService.buildHello()).peerId);
    expect(firstPeer?.remoteCursorSequence).toBeGreaterThan(0);
    expect((await local.fileService.listFiles(secret)).map((entry) => entry.filename)).toContain('first.txt');

    const firstCursor = firstPeer?.remoteCursorSequence ?? 0;
    await remote.fileService.addFile(secret, 'second.txt', Buffer.from('beta'), 'text/plain');

    await shutdownLan(local.lanService);
    const restartedLocalLan = new LocalNetworkSyncService(local.storage, {
      storageDir: local.storageDir,
    });
    await primeLanService(restartedLocalLan, 3102, 'peer-a');
    addPeer(restartedLocalLan, await remote.lanService.buildHello(), remote.baseUrl);

    const secondPeer = await restartedLocalLan.syncPeer((await remote.lanService.buildHello()).peerId);
    expect(secondPeer?.remoteCursorSequence).toBeGreaterThan(firstCursor);
    expect((await local.fileService.listFiles(secret)).map((entry) => entry.filename).sort()).toEqual([
      'first.txt',
      'second.txt',
    ]);

    await shutdownLan(restartedLocalLan);
    await shutdownLan(remote.lanService);
  });

  it('does not fail the peer when inventory recovery references an event the remote can no longer serve', async () => {
    const secret = 'test:secret:lan-missing-event';
    const remote = await createLanHarness('nearbytes-lan-remote-missing-', secret, 'peer-b', 3201);
    const local = await createLanHarness('nearbytes-lan-local-missing-', secret, 'peer-a', 3202);

    await remote.fileService.addFile(secret, 'stable.txt', Buffer.from('alpha'), 'text/plain');
    installLanFetchStub(
      {
        [remote.baseUrl]: remote.lanService,
      },
      {
        missingEventFetches: new Set(['ghost']),
      }
    );

    const hello = await remote.lanService.buildHello();
    addPeer(local.lanService, hello, remote.baseUrl);
    const originalInventory = remote.lanService.getVolumeInventory.bind(remote.lanService);
    vi.spyOn(remote.lanService, 'getVolumeInventory').mockImplementation(async (volumeId) => {
      const inventory = await originalInventory(volumeId);
      return {
        ...inventory,
        eventHashes: [...inventory.eventHashes, 'ghost'],
      };
    });

    const peer = await local.lanService.syncPeer(hello.peerId);
    expect(peer?.lastSyncError).toBeNull();
    expect((await local.fileService.listFiles(secret)).map((entry) => entry.filename)).toContain('stable.txt');

    await shutdownLan(local.lanService);
    await shutdownLan(remote.lanService);
  });

  it('stores local-network runtime state outside a custom storage root', async () => {
    const secret = 'test:secret:lan-runtime-dir';
    const harness = await createLanHarness('nearbytes-lan-runtime-dir-', secret, 'peer-a', 3301);

    const internal = harness.lanService as unknown as {
      runtimeDir: string;
    };
    expect(path.resolve(internal.runtimeDir)).not.toBe(path.join(path.resolve(harness.storageDir), 'local-network'));

    await shutdownLan(harness.lanService);
  });
});

async function createLanHarness(prefix: string, secretValue: string, peerId: string, httpPort: number): Promise<{
  storage: MultiRootStorageBackend;
  storageDir: string;
  fileService: ReturnType<typeof createFileService>;
  lanService: LocalNetworkSyncService;
  baseUrl: string;
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
  const fileService = createFileService({ crypto, storage });
  const lanService = new LocalNetworkSyncService(storage, {
    storageDir,
  });
  await primeLanService(lanService, httpPort, peerId);

  return {
    storage,
    storageDir,
    fileService,
    lanService,
    baseUrl: `http://${peerId}:${httpPort}`,
  };
}

async function primeLanService(service: LocalNetworkSyncService, httpPort: number, peerId: string): Promise<void> {
  const internal = service as unknown as {
    started: boolean;
    httpPort: number;
    peerId: string;
    label: string;
    loadIdentity: () => Promise<void>;
    providerQueue: { start: () => Promise<void> };
  };
  internal.started = true;
  internal.httpPort = httpPort;
  await internal.loadIdentity();
  internal.peerId = peerId;
  internal.label = peerId;
  await internal.providerQueue.start();
}

async function shutdownLan(service: LocalNetworkSyncService): Promise<void> {
  const internal = service as unknown as {
    providerQueue: { stop: () => Promise<void> };
    started: boolean;
  };
  internal.started = false;
  await internal.providerQueue.stop();
}

function addPeer(service: LocalNetworkSyncService, hello: Awaited<ReturnType<LocalNetworkSyncService['buildHello']>>, baseUrl: string): void {
  const internal = service as unknown as {
    peers: Map<string, unknown>;
  };
  internal.peers.set(hello.peerId, {
    peerId: hello.peerId,
    label: hello.label,
    address: new URL(baseUrl).hostname,
    port: new URL(baseUrl).port ? Number(new URL(baseUrl).port) : 80,
    endpointUrl: baseUrl,
    capabilities: [...hello.capabilities],
    volumeIds: [],
    announcementCounter: 1,
    firstSeenAt: Date.now(),
    lastSeenAt: Date.now(),
    lastHelloAt: null,
    lastSyncAt: null,
    lastSyncStartedAt: null,
    lastSyncError: null,
    lastImportedEvents: 0,
    lastImportedBlocks: 0,
    remoteCursorSequence: 0,
    lastRemoteHeadSequence: 0,
    syncing: false,
    queued: false,
  });
}

function installLanFetchStub(
  services: Record<string, LocalNetworkSyncService>,
  options: {
    readonly missingEventFetches?: ReadonlySet<string>;
  } = {}
): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
      const baseUrl = `${url.protocol}//${url.host}`;
      const service = services[baseUrl];
      if (!service) {
        return new Response('missing service', { status: 404 });
      }

      if (url.pathname === '/lan/hello') {
        return jsonResponse(await service.buildHello());
      }
      if (url.pathname === '/lan/observations') {
        const after = Number.parseInt(url.searchParams.get('after') ?? '0', 10);
        const limit = Number.parseInt(url.searchParams.get('limit') ?? '512', 10);
        return jsonResponse(
          service.listObservations({
            afterSequence: Number.isFinite(after) ? after : 0,
            limit: Number.isFinite(limit) ? limit : 512,
          })
        );
      }
      if (url.pathname === '/lan/volumes') {
        return jsonResponse(await service.listVolumes());
      }

      const eventMatch = /^\/lan\/volumes\/([^/]+)\/events\/([^/]+)$/u.exec(url.pathname);
      if (eventMatch?.[1] && eventMatch[2]) {
        const eventHash = decodeURIComponent(eventMatch[2]);
        if (options.missingEventFetches?.has(eventHash)) {
          return new Response('missing event', { status: 404 });
        }
        const bytes = await service.readEventBytes(decodeURIComponent(eventMatch[1]), eventHash);
        return bytesResponse(bytes);
      }

      const inventoryMatch = /^\/lan\/volumes\/([^/]+)\/inventory$/u.exec(url.pathname);
      if (inventoryMatch?.[1]) {
        return jsonResponse(await service.getVolumeInventory(decodeURIComponent(inventoryMatch[1])));
      }

      const blockMatch = /^\/lan\/blocks\/([^/]+)$/u.exec(url.pathname);
      if (blockMatch?.[1]) {
        const bytes = await service.readBlockBytes(decodeURIComponent(blockMatch[1]));
        return bytesResponse(bytes);
      }

      return new Response('not found', { status: 404 });
    })
  );
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

function bytesResponse(value: Uint8Array): Response {
  return new Response(Buffer.from(value), {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
    },
  });
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
