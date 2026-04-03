import dgram from 'dgram';
import os from 'os';
import { mkdtemp, rm } from 'fs/promises';
import path from 'path';
import { tmpdir } from 'os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LanPeerTransportCallbacks, LanTransportDiscoveredPeer, LanTransportHello, LanTransportRpcRequest } from '../lanPeerTransport.js';
import { QuicDnsSdLanTransport } from '../quicDnsSdLanTransport.js';

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

describe('QuicDnsSdLanTransport', () => {
  it('exchanges json, bytes, and sync-hint messages over QUIC streams', async () => {
    const leftRuntimeDir = await mkRuntimeDir('nearbytes-lan-quic-left-');
    const rightRuntimeDir = await mkRuntimeDir('nearbytes-lan-quic-right-');
    const leftPort = await reserveUdpPort();
    const rightPort = await reserveUdpPort();
    const leftTransport = new QuicDnsSdLanTransport(leftRuntimeDir);
    const rightTransport = new QuicDnsSdLanTransport(rightRuntimeDir);
    let syncHintReason: string | null = null;

    await leftTransport.start(createCallbacks({
      peerId: 'peer-left',
      label: 'peer-left',
      port: leftPort,
      headObservationId: 'aa'.repeat(32),
      handleRequest: async (request) => {
        if (request.action === 'hello') {
          return { protocol: 'nearbytes.lan-sync.v1', peerId: 'peer-left', label: 'peer-left', port: leftPort, capabilities: ['quic'], volumeIds: [], observationHeadId: 'aa'.repeat(32), generatedAt: Date.now() };
        }
        if (request.action === 'block') {
          return new Uint8Array([1, 2, 3]);
        }
        return { ok: true };
      },
    }));

    await rightTransport.start(createCallbacks({
      peerId: 'peer-right',
      label: 'peer-right',
      port: rightPort,
      headObservationId: 'bb'.repeat(32),
      handleRequest: async (request) => {
        if (request.action === 'hello') {
          return { protocol: 'nearbytes.lan-sync.v1', peerId: 'peer-right', label: 'peer-right', port: rightPort, capabilities: ['quic', 'inventory'], volumeIds: ['vol-1'], observationHeadId: 'bb'.repeat(32), generatedAt: Date.now() };
        }
        if (request.action === 'observations') {
          return {
            protocol: 'nearbytes.lan-sync.v1',
            peerId: 'peer-right',
            observations: [{
              observationId: 'cc'.repeat(32),
              prevObservationId: null,
              kind: 'block',
              hash: 'abc',
              relativePath: 'blocks/abc.bin',
              sourceId: 'src',
              observedAt: Date.now(),
            }],
            headObservationId: 'cc'.repeat(32),
            generatedAt: Date.now(),
          };
        }
        if (request.action === 'block') {
          return new Uint8Array([9, 8, 7]);
        }
        if (request.action === 'sync-hint') {
          syncHintReason = request.reason ?? null;
          return { ok: true, acceptedAt: Date.now() };
        }
        return { ok: true };
      },
    }));

    try {
      const remotePeer: LanTransportDiscoveredPeer = {
        peerId: 'peer-right',
        label: 'peer-right',
        address: '127.0.0.1',
        port: rightPort,
        capabilities: ['quic', 'inventory'],
        headObservationId: 'bb'.repeat(32),
      };

      const hello = await leftTransport.requestJson<LanTransportHello>(remotePeer, { action: 'hello' });
      expect(hello.peerId).toBe('peer-right');
      expect(hello.observationHeadId).toBe('bb'.repeat(32));

      const blockBytes = await leftTransport.requestBytes(remotePeer, { action: 'block', blockHash: 'abc' });
      expect(Array.from(blockBytes)).toEqual([9, 8, 7]);

      const observations = await leftTransport.requestJson<{
        observations: Array<{ observationId: string; kind: string; hash: string }>;
        headObservationId: string | null;
      }>(remotePeer, {
        action: 'observations',
        afterObservationId: null,
        limit: 16,
      });
      expect(observations.headObservationId).toBe('cc'.repeat(32));
      expect(observations.observations).toHaveLength(1);
      expect(observations.observations[0]?.hash).toBe('abc');

      await leftTransport.notify(remotePeer, {
        action: 'sync-hint',
        reason: 'test-sync',
      });
      expect(syncHintReason).toBe('test-sync');
    } finally {
      await leftTransport.stop();
      await rightTransport.stop();
    }
  });

  it('prefers private LAN addresses in discovery debug state and ignores incompatible records', async () => {
    const runtimeDir = await mkRuntimeDir('nearbytes-lan-quic-debug-');
    const transport = new QuicDnsSdLanTransport(runtimeDir);
    const internal = transport as unknown as {
      callbacks: LanPeerTransportCallbacks | null;
      handleDiscoveryService: (service: {
        fqdn: string;
        name: string;
        port: number;
        addresses: string[];
        txt: Record<string, string>;
      }) => void;
    };
    internal.callbacks = createCallbacks({
      peerId: 'peer-self',
      label: 'peer-self',
      port: 4101,
      headObservationId: null,
      handleRequest: async () => ({ ok: true }),
    });

    const networkInterfacesSpy = vi.spyOn(os, 'networkInterfaces').mockReturnValue({
      Ethernet: [
        {
          address: '192.168.1.8',
          netmask: '255.255.255.0',
          family: 'IPv4',
          mac: '00:00:00:00:00:01',
          internal: false,
          cidr: '192.168.1.8/24',
        },
      ],
      'vEthernet (WSL)': [
        {
          address: '172.18.192.1',
          netmask: '255.255.240.0',
          family: 'IPv4',
          mac: '00:00:00:00:00:02',
          internal: false,
          cidr: '172.18.192.1/20',
        },
      ],
    });

    try {
      internal.handleDiscoveryService({
        fqdn: 'peer-remote.local',
        name: 'peer-remote',
        port: 4200,
        addresses: ['146.48.84.58', '172.18.192.77', '192.168.1.25', '::1'],
        txt: {
          pv: '0.3',
          peer: 'peer-remote',
          alpn: 'nearbytes-lan/0.3',
          caps: 'quic,observation-log',
          head: 'aa'.repeat(32),
        },
      });

      internal.handleDiscoveryService({
        fqdn: 'peer-old.local',
        name: 'peer-old',
        port: 3000,
        addresses: ['192.168.1.44'],
        txt: {
          pv: '0.2',
          peer: 'peer-old',
          alpn: 'nearbytes-lan/0.2',
          caps: 'quic',
        },
      });
    } finally {
      networkInterfacesSpy.mockRestore();
    }

    const debug = transport.getDebugState();
    const compatible = debug.discoveredPeers.find((entry) => entry.fqdn === 'peer-remote.local');
    const incompatible = debug.discoveredPeers.find((entry) => entry.fqdn === 'peer-old.local');

    expect(compatible?.chosenAddress).toBe('192.168.1.25');
    expect(compatible?.chosenAddressReason).toContain('same subnet as local interface Ethernet');
    expect(compatible?.compatible).toBe(true);
    expect(incompatible?.compatible).toBe(false);
    expect(incompatible?.incompatibilityReason).toContain('Unsupported discovery protocol version');
  });
});

function createCallbacks(options: {
  peerId: string;
  label: string;
  port: number;
  headObservationId: string | null;
  handleRequest: (request: LanTransportRpcRequest) => Promise<unknown> | unknown;
}): LanPeerTransportCallbacks {
  return {
    getAdvertisement: async (): Promise<LanTransportHello> => ({
      protocol: 'nearbytes.lan-sync.v1',
      peerId: options.peerId,
      label: options.label,
      port: options.port,
      capabilities: ['quic'],
      volumeIds: [],
      observationHeadId: options.headObservationId,
      generatedAt: Date.now(),
    }),
    onPeerDiscovered: () => undefined,
    handleRequest: async (request) => {
      const value = await options.handleRequest(request);
      return value instanceof Uint8Array
        ? { kind: 'bytes', value }
        : { kind: 'json', value };
    },
  };
}

async function mkRuntimeDir(prefix: string): Promise<string> {
  const runtimeDir = await mkdtemp(path.join(tmpdir(), prefix));
  cleanupPaths.push(runtimeDir);
  return runtimeDir;
}

async function reserveUdpPort(): Promise<number> {
  const socket = dgram.createSocket('udp4');
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once('error', reject);
      socket.bind(0, '127.0.0.1', () => resolve());
    });
    const address = socket.address();
    return typeof address === 'string' ? 0 : address.port;
  } finally {
    socket.close();
  }
}
