import { afterEach, describe, expect, it } from 'vitest';

import { createCryptoOperations } from '../../../../src/crypto/index.js';
import { createFileService } from '../../../../src/domain/fileService.js';
import { deriveKeys } from '../../../../src/crypto/asymmetric.js';
import { createSecret } from '../../../../src/types/keys.js';
import type { StorageBackend } from '../../../../src/types/storage.js';
import { parseCanonicalBlockRelativePath, parseCanonicalEventRelativePath } from '../../../../src/storage/integrity.js';
import type { LanTransportRpcRequest } from '../../../../src/integrations/lanPeerTransport.js';
import type { ProviderQueueObservation } from '../../../../src/integrations/types.js';
import {
  embeddedPhoneGetLanRouteState,
  embeddedPhoneOpenVolume,
  readEmbeddedPhoneRuntimeMetricsForTests,
  resetEmbeddedPhoneRuntimeMetricsForTests,
  resetEmbeddedPhoneServicesForTests,
} from './embeddedPhoneServices.js';
import {
  importStorageCommandWithClientForTests,
  syncLanPeerInventoryWithClient,
} from './nativeLanSync.js';

class MemoryStorageBackend implements StorageBackend {
  private readonly files = new Map<string, Uint8Array>();
  private readonly directories = new Set<string>();

  async writeFile(path: string, data: Uint8Array): Promise<void> {
    const normalized = normalizePath(path);
    this.files.set(normalized, new Uint8Array(data));
    const lastSlash = normalized.lastIndexOf('/');
    if (lastSlash >= 0) {
      this.directories.add(normalized.slice(0, lastSlash));
    }
  }

  async readFile(path: string): Promise<Uint8Array> {
    const record = this.files.get(normalizePath(path));
    if (!record) {
      throw new Error(`File not found: ${path}`);
    }
    return new Uint8Array(record);
  }

  async listFiles(directory: string): Promise<string[]> {
    const normalized = normalizePath(directory);
    const prefix = normalized.length > 0 ? `${normalized}/` : '';
    const entries = new Set<string>();
    for (const filePath of this.files.keys()) {
      if (prefix && !filePath.startsWith(prefix)) {
        continue;
      }
      const remainder = prefix ? filePath.slice(prefix.length) : filePath;
      if (!remainder || remainder.includes('/')) {
        continue;
      }
      entries.add(remainder);
    }
    return Array.from(entries).sort((left, right) => left.localeCompare(right));
  }

  async createDirectory(path: string): Promise<void> {
    this.directories.add(normalizePath(path));
  }

  async exists(path: string): Promise<boolean> {
    const normalized = normalizePath(path);
    if (this.files.has(normalized) || this.directories.has(normalized)) {
      return true;
    }
    const prefix = `${normalized}/`;
    for (const filePath of this.files.keys()) {
      if (filePath.startsWith(prefix)) {
        return true;
      }
    }
    return false;
  }

  async deleteFile(path: string): Promise<void> {
    this.files.delete(normalizePath(path));
  }

  listAllPaths(): string[] {
    return Array.from(this.files.keys()).sort((left, right) => left.localeCompare(right));
  }
}

describe('nativeLanSync', () => {
  afterEach(() => {
    resetEmbeddedPhoneServicesForTests();
  });

  it('imports missing LAN event and block bytes into the embedded phone runtime', async () => {
    const secret = 'native-lan-sync-secret';
    const remote = await createRemoteHarness(secret, 'peer-remote');

    const result = await syncLanPeerInventoryWithClient(
      {
        peerId: 'peer-remote',
        label: 'Remote desktop',
        address: '192.168.1.30',
        port: 9444,
        capabilities: ['webrtc', 'inventory', 'pull-sync'],
        headObservationId: null,
      },
      remote.client
    );

    const opened = await embeddedPhoneOpenVolume(secret);

    expect(result).toMatchObject({
      importedEvents: 1,
      importedBlocks: 1,
      volumeIds: [remote.volumeId],
    });
    expect(opened.files.map((entry) => entry.filename)).toEqual(['hello.txt']);
  });

  it('reports up-to-date peers without importing duplicate bytes', async () => {
    const secret = 'native-lan-sync-secret-repeat';
    const remote = await createRemoteHarness(secret, 'peer-repeat');

    await syncLanPeerInventoryWithClient(
      {
        peerId: 'peer-repeat',
        label: 'Remote desktop',
        address: '192.168.1.31',
        port: 9444,
        capabilities: ['webrtc', 'inventory', 'pull-sync'],
        headObservationId: null,
      },
      remote.client
    );

    const second = await syncLanPeerInventoryWithClient(
      {
        peerId: 'peer-repeat',
        label: 'Remote desktop',
        address: '192.168.1.31',
        port: 9444,
        capabilities: ['webrtc', 'inventory', 'pull-sync'],
        headObservationId: null,
      },
      remote.client
    );

    expect(second).toMatchObject({
      importedEvents: 0,
      importedBlocks: 0,
      notice: 'This phone is already up to date for the advertised LAN volumes.',
    });
  });

  it('refreshes a bootstrapped empty phone mirror after LAN imports', async () => {
    const secret = 'native-lan-sync-secret-bootstrapped-empty';
    const remote = await createRemoteHarness(secret, 'peer-bootstrapped-empty');

    const initial = await embeddedPhoneOpenVolume(secret);
    expect(initial.files).toEqual([]);

    const result = await syncLanPeerInventoryWithClient(
      {
        peerId: 'peer-bootstrapped-empty',
        label: 'Remote desktop',
        address: '192.168.1.33',
        port: 9444,
        capabilities: ['webrtc', 'inventory', 'pull-sync'],
        headObservationId: null,
      },
      remote.client
    );

    const reopened = await embeddedPhoneOpenVolume(secret);

    expect(result).toMatchObject({
      importedEvents: 1,
      importedBlocks: 1,
      volumeIds: [remote.volumeId],
    });
    expect(reopened.files.map((entry) => entry.filename)).toEqual(['hello.txt']);
  });

  it('refreshes the bootstrapped phone mirror after a storage-command event import', async () => {
    const secret = 'native-lan-sync-secret-storage-command';
    const remote = await createRemoteHarness(secret, 'peer-storage-command');

    const initial = await embeddedPhoneOpenVolume(secret);
    expect(initial.files).toEqual([]);

    const observations = await remote.client.requestJson<{
      observations: ProviderQueueObservation[];
    }>({
      action: 'observations',
      afterObservationId: null,
      limit: 10,
    } as LanTransportRpcRequest);
    const eventObservation = observations.observations.find((entry) => entry.kind === 'event');
    if (!eventObservation || !eventObservation.volumeId) {
      throw new Error('Expected remote event observation');
    }

    await importStorageCommandWithClientForTests(
      {
        type: 'want-event',
        fromPeerId: 'peer-storage-command',
        volumeId: eventObservation.volumeId,
        eventHash: eventObservation.hash,
        observationId: eventObservation.observationId,
        prevObservationId: eventObservation.prevObservationId,
      },
      remote.client
    );

    const reopened = await embeddedPhoneOpenVolume(secret);
    expect(reopened.files.map((entry) => entry.filename)).toEqual(['hello.txt']);
  });

  it('persists the remote observation cursor and imports later LAN deltas on the next sync', async () => {
    const secret = 'native-lan-sync-secret-cursor';
    const remote = await createRemoteHarness(secret, 'peer-cursor');

    await syncLanPeerInventoryWithClient(
      {
        peerId: 'peer-cursor',
        label: 'Remote desktop',
        address: '192.168.1.32',
        port: 9444,
        capabilities: ['webrtc', 'inventory', 'pull-sync', 'observation-log'],
        headObservationId: null,
      },
      remote.client
    );

    await embeddedPhoneOpenVolume(secret);
    resetEmbeddedPhoneRuntimeMetricsForTests();

    const firstRoute = await embeddedPhoneGetLanRouteState('peer-cursor');
    await remote.addFile('later.txt', 'later payload');

    const second = await syncLanPeerInventoryWithClient(
      {
        peerId: 'peer-cursor',
        label: 'Remote desktop',
        address: '192.168.1.32',
        port: 9444,
        capabilities: ['webrtc', 'inventory', 'pull-sync', 'observation-log'],
        headObservationId: null,
      },
      remote.client
    );
    const secondRoute = await embeddedPhoneGetLanRouteState('peer-cursor');
    const opened = await embeddedPhoneOpenVolume(secret);

    expect(firstRoute.lastAckedObservationId).toMatch(/^[0-9a-f]{64}$/);
    expect(secondRoute.lastAckedObservationId).toMatch(/^[0-9a-f]{64}$/);
    expect(secondRoute.lastAckedObservationId).not.toBe(firstRoute.lastAckedObservationId);
    expect(second.importedEvents).toBeGreaterThan(0);
    expect(opened.files.map((entry) => entry.filename).sort()).toEqual(['hello.txt', 'later.txt']);
    expect(readEmbeddedPhoneRuntimeMetricsForTests()).toMatchObject({
      incrementalRefreshReads: 1,
      fullRefreshReads: 0,
    });
  });
});

async function createRemoteHarness(secret: string, peerId: string): Promise<{
  volumeId: string;
  addFile(filename: string, contents: string): Promise<void>;
  client: {
    requestJson<T>(request: LanTransportRpcRequest): Promise<T>;
    requestBytes(request: LanTransportRpcRequest): Promise<Uint8Array>;
  };
}> {
  const storage = new MemoryStorageBackend();
  const crypto = createCryptoOperations();
  const fileService = createFileService({ crypto, storage });
  const volumeId = await deriveVolumeId(secret);
  const observations: ProviderQueueObservation[] = [];
  let previousPaths = new Set<string>();
  let observationSequence = 0;

  const appendObservationsForNewPaths = () => {
    const currentPaths = new Set(storage.listAllPaths());
    const createdPaths = Array.from(currentPaths)
      .filter((path) => !previousPaths.has(path))
      .sort((left, right) => left.localeCompare(right));
    for (const path of createdPaths) {
      const observationId = createObservationId(peerId, observationSequence);
      observationSequence += 1;
      const event = parseCanonicalEventRelativePath(path);
      if (event) {
        observations.push({
          observationId,
          prevObservationId: observations.at(-1)?.observationId ?? null,
          kind: 'event',
          hash: event.eventHash,
          sourceId: 'src-default',
          relativePath: path,
          observedAt: Date.now(),
          volumeId: event.volumeId,
        });
        continue;
      }
      const block = parseCanonicalBlockRelativePath(path);
      if (block) {
        observations.push({
          observationId,
          prevObservationId: observations.at(-1)?.observationId ?? null,
          kind: 'block',
          hash: block.hash,
          sourceId: 'src-default',
          relativePath: path,
          observedAt: Date.now(),
        });
      }
    }
    previousPaths = currentPaths;
  };

  const addFile = async (filename: string, contents: string) => {
    await fileService.addFile(secret, filename, Buffer.from(contents), 'text/plain');
    appendObservationsForNewPaths();
  };

  await addFile('hello.txt', 'hello over lan');

  return {
    volumeId,
    addFile,
    client: {
      async requestJson<T>(request: LanTransportRpcRequest): Promise<T> {
        switch (request.action) {
          case 'hello':
            return {
              protocol: 'nearbytes.lan-sync.v1',
              peerId,
              label: 'Remote desktop',
              port: 9444,
              capabilities: ['webrtc', 'inventory', 'pull-sync', 'observation-log'],
              volumeIds: [volumeId],
              observationHeadId: observations.at(-1)?.observationId ?? null,
              generatedAt: Date.now(),
            } as T;
          case 'observations': {
            const after = request.afterObservationId ?? null;
            const startIndex = after
              ? observations.findIndex((entry) => entry.observationId === after) + 1
              : 0;
            const limit = request.limit ?? observations.length;
            return {
              protocol: 'nearbytes.lan-sync.v1',
              peerId,
              observations: observations.slice(Math.max(0, startIndex), Math.max(0, startIndex) + limit),
              headObservationId: observations.at(-1)?.observationId ?? null,
              generatedAt: Date.now(),
            } as T;
          }
          case 'inventory':
            return readInventory(storage, request.volumeId) as T;
          default:
            throw new Error(`Unsupported JSON request in test: ${request.action}`);
        }
      },
      async requestBytes(request: LanTransportRpcRequest): Promise<Uint8Array> {
        switch (request.action) {
          case 'event':
            return await storage.readFile(`channels/${request.volumeId}/${request.eventHash}.bin`);
          case 'block':
            return await storage.readFile(`blocks/${request.blockHash}.bin`);
          default:
            throw new Error(`Unsupported byte request in test: ${request.action}`);
        }
      },
    },
  };
}

function readInventory(storage: MemoryStorageBackend, volumeId: string): {
  volumeId: string;
  generatedAt: number;
  eventHashes: string[];
  blockHashes: string[];
} {
  const eventHashes = new Set<string>();
  const blockHashes = new Set<string>();
  for (const path of storage.listAllPaths()) {
    const event = parseCanonicalEventRelativePath(path);
    if (event && event.volumeId === volumeId) {
      eventHashes.add(event.eventHash);
      continue;
    }
    const block = parseCanonicalBlockRelativePath(path);
    if (block) {
      blockHashes.add(block.hash);
    }
  }
  return {
    volumeId,
    generatedAt: Date.now(),
    eventHashes: Array.from(eventHashes).sort((left, right) => left.localeCompare(right)),
    blockHashes: Array.from(blockHashes).sort((left, right) => left.localeCompare(right)),
  };
}

async function deriveVolumeId(secret: string): Promise<string> {
  const keys = await deriveKeys(createSecret(secret));
  return Array.from(keys.publicKey)
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

function normalizePath(value: string): string {
  return value.replace(/^\/+/, '').replace(/\/+/g, '/').replace(/\/$/, '');
}

function createObservationId(peerId: string, sequence: number): string {
  const seed = `${peerId}:${sequence.toString(16).padStart(8, '0')}`;
  const bytes = new TextEncoder().encode(seed);
  return Array.from(bytes)
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
    .padEnd(64, '0')
    .slice(0, 64);
}