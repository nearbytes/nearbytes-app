import os from 'os';
import { mkdtemp, rm } from 'fs/promises';
import path from 'path';
import { tmpdir } from 'os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  LanPeerTransportCallbacks,
  LanPeerTransportSignalRequest,
  LanTransportDiscoveredPeer,
  LanTransportHello,
  LanTransportRpcRequest,
} from '../lanPeerTransport.js';
import {
  WebRtcDnsSdLanTransport,
  decodeLanWebRtcControlPacketForTest,
  sanitizeRemoteSessionDescriptionForTest,
} from '../webrtcDnsSdLanTransport.js';

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

describe('WebRtcDnsSdLanTransport', () => {
  it('exchanges json, bytes, and storage-command messages over WebRTC data channels', async () => {
    const leftRuntimeDir = await mkRuntimeDir('nearbytes-lan-webrtc-left-');
    const rightRuntimeDir = await mkRuntimeDir('nearbytes-lan-webrtc-right-');
    let lastStorageCommand:
      | Extract<LanTransportRpcRequest, { action: 'storage-command' }>['command']
      | null = null;
    const responders = new Map<string, WebRtcDnsSdLanTransport>();
    const makeSignalFetcher = (owner: string): typeof fetch => {
      return async (input, init) => {
        const url = typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
        const hostname = new URL(url).hostname.toLowerCase();
        const target = responders.get(hostname);
        if (!target) {
          throw new Error(`Unknown signal target ${hostname} for ${owner}`);
        }
        const body = JSON.parse(String(init?.body ?? '{}')) as LanPeerTransportSignalRequest;
        const response = await target.handleSignal!(body);
        return {
          ok: true,
          status: 200,
          async json() {
            return response;
          },
        } as Response;
      };
    };

    const leftTransport = new WebRtcDnsSdLanTransport(leftRuntimeDir, {
      disableDiscovery: true,
      signalFetcher: makeSignalFetcher('left'),
    });
    const rightTransport = new WebRtcDnsSdLanTransport(rightRuntimeDir, {
      disableDiscovery: true,
      signalFetcher: makeSignalFetcher('right'),
    });
    responders.set('left.local', leftTransport);
    responders.set('right.local', rightTransport);

    await leftTransport.start(createCallbacks({
      peerId: 'peer-left',
      label: 'peer-left',
      port: 3101,
      headObservationId: 'aa'.repeat(32),
      capabilities: ['webrtc', 'observation-log'],
      handleRequest: async (request) => {
        if (request.action === 'hello') {
          return { protocol: 'nearbytes.lan-sync.v1', peerId: 'peer-left', label: 'peer-left', port: 3101, capabilities: ['webrtc'], volumeIds: [], observationHeadId: 'aa'.repeat(32), generatedAt: Date.now() };
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
      port: 3102,
      headObservationId: 'bb'.repeat(32),
      capabilities: ['webrtc', 'inventory'],
      handleRequest: async (request) => {
        if (request.action === 'hello') {
          return { protocol: 'nearbytes.lan-sync.v1', peerId: 'peer-right', label: 'peer-right', port: 3102, capabilities: ['webrtc', 'inventory'], volumeIds: ['vol-1'], observationHeadId: 'bb'.repeat(32), generatedAt: Date.now() };
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
        if (request.action === 'storage-command') {
          lastStorageCommand = request.command;
          return { ok: true, acceptedAt: Date.now() };
        }
        return { ok: true };
      },
    }));

    try {
      const remotePeer: LanTransportDiscoveredPeer = {
        peerId: 'peer-right',
        label: 'peer-right',
        address: 'right.local',
        port: 3102,
        capabilities: ['webrtc', 'inventory'],
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
        action: 'storage-command',
        command: {
          type: 'want-block',
          fromPeerId: 'peer-left',
          blockHash: 'abc',
        },
      });
      expect(lastStorageCommand).toEqual({
        type: 'want-block',
        fromPeerId: 'peer-left',
        blockHash: 'abc',
      });
    } finally {
      await leftTransport.stop();
      await rightTransport.stop();
    }
  }, 15_000);

  it('does not treat a connected peer without a control channel as usable', async () => {
    const runtimeDir = await mkRuntimeDir('nearbytes-lan-webrtc-usable-');
    const transport = new WebRtcDnsSdLanTransport(runtimeDir, { disableDiscovery: true });
    const internal = transport as unknown as {
      connections: Map<string, unknown>;
      hasUsablePeerConnection: (peerId: string) => boolean;
    };

    internal.connections.set('peer-remote', {
      peerId: 'peer-remote',
      peer: {
        peerId: 'peer-remote',
        label: 'peer-remote',
        address: 'peer-remote.local',
        port: 4200,
        capabilities: ['webrtc'],
        headObservationId: null,
      },
      connection: {
        connectionState: 'connected',
      },
      controlChannel: null,
      closed: false,
    });

    expect(internal.hasUsablePeerConnection('peer-remote')).toBe(false);
  });

  it('resets the desktop peer context when the control channel closes while connected', async () => {
    const runtimeDir = await mkRuntimeDir('nearbytes-lan-webrtc-channel-close-');
    const transport = new WebRtcDnsSdLanTransport(runtimeDir, { disableDiscovery: true });
    const internal = transport as unknown as {
      connections: Map<string, unknown>;
      attachControlChannel: (context: any, channel: any) => void;
      hasUsablePeerConnection: (peerId: string) => boolean;
    };
    const peer: LanTransportDiscoveredPeer = {
      peerId: 'peer-remote',
      label: 'peer-remote',
      address: 'peer-remote.local',
      port: 4200,
      capabilities: ['webrtc'],
      headObservationId: null,
    };
    const channel = {
      label: 'nearbytes-control',
      readyState: 'open',
      close: vi.fn(),
      onopen: undefined,
      onmessage: undefined,
      onclose: undefined,
      onerror: undefined,
    };
    const context = {
      peerId: peer.peerId,
      peer,
      connection: {
        connectionState: 'connected',
        close: vi.fn().mockResolvedValue(undefined),
      },
      controlChannel: null,
      pendingControlResponses: new Map(),
      initiator: true,
      readyPromise: Promise.resolve(),
      resolveReady: vi.fn(),
      rejectReady: vi.fn(),
      readyResolved: true,
      closed: false,
      disconnectTimer: null,
    };
    internal.connections.set(peer.peerId, context);

    internal.attachControlChannel(context, channel);
    expect(internal.hasUsablePeerConnection(peer.peerId)).toBe(true);

    expect(channel.onclose).toBeTypeOf('function');
    const handleClose = channel.onclose as (() => void) | undefined;
    handleClose?.();

    expect(internal.connections.has(peer.peerId)).toBe(false);
    expect(context.closed).toBe(true);
    expect(context.connection.close).toHaveBeenCalled();
  });

  it('prefers private LAN addresses in discovery debug state and ignores incompatible records', async () => {
    const runtimeDir = await mkRuntimeDir('nearbytes-lan-webrtc-debug-');
    const transport = new WebRtcDnsSdLanTransport(runtimeDir, { disableDiscovery: true });
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
      capabilities: ['webrtc', 'observation-log'],
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
          caps: 'webrtc,observation-log',
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
          caps: 'webrtc',
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

  it('prefers an explicit signal address from TXT when dns-sd only resolves a link-local address', async () => {
    const runtimeDir = await mkRuntimeDir('nearbytes-lan-webrtc-txt-address-');
    const transport = new WebRtcDnsSdLanTransport(runtimeDir, { disableDiscovery: true });
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
      capabilities: ['webrtc', 'observation-log'],
      handleRequest: async () => ({ ok: true }),
    });

    internal.handleDiscoveryService({
      fqdn: 'peer-phone.local',
      name: 'This phone',
      port: 51991,
      addresses: ['fe80::1'],
      txt: {
        pv: '0.3',
        peer: 'peer-phone',
        alpn: 'nearbytes-lan/0.3',
        caps: 'webrtc,inventory-recovery',
        addr: '192.168.8.165',
      },
    });

    expect(transport.getDebugState().discoveredPeers.find((entry) => entry.fqdn === 'peer-phone.local')?.chosenAddress).toBe('192.168.8.165');
    expect(transport.getDebugState().discoveredPeers.find((entry) => entry.fqdn === 'peer-phone.local')?.chosenAddressReason)
      .toBe('Selected the explicit signal address advertised in the discovery TXT record.');
  });

  it('expires a discovered peer immediately when the signaling path returns 404', async () => {
    const runtimeDir = await mkRuntimeDir('nearbytes-lan-webrtc-expire-');
    const expiredPeerIds: string[] = [];
    const transport = new WebRtcDnsSdLanTransport(runtimeDir, {
      disableDiscovery: true,
      signalFetcher: async () =>
        ({
          ok: false,
          status: 404,
          async text() {
            return '';
          },
          async json() {
            return {};
          },
        }) as Response,
    });
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
      peerId: 'peer-a',
      label: 'peer-a',
      port: 4301,
      headObservationId: null,
      capabilities: ['webrtc', 'observation-log'],
      handleRequest: async () => ({ ok: true }),
      onPeerExpired: (peerId) => {
        expiredPeerIds.push(peerId);
      },
    });

    internal.handleDiscoveryService({
      fqdn: 'peer-b.local',
      name: 'peer-b',
      port: 4302,
      addresses: ['192.168.1.25'],
      txt: {
        pv: '0.3',
        peer: 'peer-b',
        alpn: 'nearbytes-lan/0.3',
        caps: 'webrtc,observation-log',
      },
    });

    await expect(transport.requestJson<{ ok: boolean }>(
      {
        peerId: 'peer-b',
        label: 'peer-b',
        address: '192.168.1.25',
        port: 4302,
        capabilities: ['webrtc', 'observation-log'],
        headObservationId: null,
      },
      { action: 'hello' }
    )).rejects.toThrow('Signal POST failed with status 404');

    expect(expiredPeerIds).toEqual(['peer-b']);
    expect(transport.getDebugState().discoveredPeers.find((entry) => entry.peerId === 'peer-b')).toBeUndefined();
  });

  it('decodes control packets from Uint8Array payloads', () => {
    const payload = new TextEncoder().encode(JSON.stringify({
      type: 'response-json',
      requestId: 'abc123',
      value: { ok: true },
    }));
    expect(decodeLanWebRtcControlPacketForTest(payload)).toEqual({
      type: 'response-json',
      requestId: 'abc123',
      value: { ok: true },
    });
  });

  it('rewrites WKWebView mDNS ICE candidate hostnames in remote SDP', () => {
    const sdp = [
      'v=0',
      'o=- 5964667894981931874 2 IN IP4 127.0.0.1',
      's=-',
      't=0 0',
      'a=group:BUNDLE 0',
      'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
      'c=IN IP4 0.0.0.0',
      'a=mid:0',
      'a=candidate:887687980 1 udp 2113937151 58e0ba11-dab1-4aa1-8125-5bb9a03af32b.local 49910 typ host generation 0 ufrag Fz1N network-id 1',
      'a=end-of-candidates',
      '',
    ].join('\r\n');

    expect(sanitizeRemoteSessionDescriptionForTest(sdp, '192.168.8.165')).toContain(
      'a=candidate:887687980 1 udp 2113937151 192.168.8.165 49910 typ host generation 0 ufrag Fz1N network-id 1'
    );
    expect(sanitizeRemoteSessionDescriptionForTest(sdp, '192.168.8.165')).not.toContain('.local');
  });

  it('retries once with a fresh connection after a stale control-channel timeout', async () => {
    const runtimeDir = await mkRuntimeDir('nearbytes-lan-webrtc-retry-');
    const transport = new WebRtcDnsSdLanTransport(runtimeDir, { disableDiscovery: true });
    const peer: LanTransportDiscoveredPeer = {
      peerId: 'peer-stale',
      label: 'peer-stale',
      address: '127.0.0.1',
      port: 4302,
      capabilities: ['webrtc', 'observation-log'],
      headObservationId: null,
    };
    const internal = transport as unknown as {
      sendRequestWithRetry: (
        peer: LanTransportDiscoveredPeer,
        request: LanTransportRpcRequest,
        retried: boolean
      ) => Promise<unknown>;
      ensurePeerReady: (peer: LanTransportDiscoveredPeer) => Promise<void>;
      connections: Map<string, unknown>;
      sendControlRequest: () => Promise<unknown>;
      resetPeerConnection: (peerId: string) => boolean;
    };

    let ensureCalls = 0;
    let sendCalls = 0;
    let resetCalls = 0;
    internal.ensurePeerReady = async () => {
      ensureCalls += 1;
    };
    internal.connections.set(peer.peerId, { closed: false });
    internal.sendControlRequest = async () => {
      sendCalls += 1;
      if (sendCalls === 1) {
        throw new Error('Timed out waiting for WebRTC control response for hello');
      }
      return {
        header: { kind: 'json', ok: true, size: 2, mime: 'application/json' },
        payload: new TextEncoder().encode('{}'),
      };
    };
    internal.resetPeerConnection = (_peerId: string) => {
      resetCalls += 1;
      internal.connections.set(peer.peerId, { closed: false });
      return true;
    };

    const frame = await internal.sendRequestWithRetry(peer, { action: 'hello' }, false) as {
      header: { ok: boolean };
    };
    expect(frame.header.ok).toBe(true);
    expect(ensureCalls).toBe(2);
    expect(sendCalls).toBe(2);
    expect(resetCalls).toBe(1);
  });

  it('treats connect signals as idempotent initiator hints', async () => {
    const runtimeDir = await mkRuntimeDir('nearbytes-lan-webrtc-connect-reset-');
    const transport = new WebRtcDnsSdLanTransport(runtimeDir, { disableDiscovery: true });
    const internal = transport as unknown as {
      callbacks: LanPeerTransportCallbacks | null;
      selfSignalPeer: { peerId: string } | null;
      handleSignal: (request: LanPeerTransportSignalRequest) => Promise<unknown>;
      ensurePeerReady: (peer: LanTransportDiscoveredPeer) => Promise<void>;
      resetPeerConnection: (peerId: string) => boolean;
    };
    internal.callbacks = createCallbacks({
      peerId: 'desktop-peer',
      label: 'desktop-peer',
      port: 4301,
      headObservationId: null,
      capabilities: ['webrtc', 'observation-log'],
      handleRequest: async () => ({ ok: true }),
    });
    internal.selfSignalPeer = { peerId: 'desktop-peer' };

    let ensureCalls = 0;
    let resetCalls = 0;
    internal.ensurePeerReady = async () => {
      ensureCalls += 1;
    };
    internal.resetPeerConnection = (_peerId: string) => {
      resetCalls += 1;
      return true;
    };

    await internal.handleSignal({
      kind: 'connect',
      from: {
        peerId: 'pc-peer',
        label: 'pc-peer',
        address: '192.168.1.25',
        port: 4302,
        capabilities: ['webrtc'],
        headObservationId: null,
      },
    });

    expect(ensureCalls).toBe(1);
    expect(resetCalls).toBe(0);
  });
});

function createCallbacks(options: {
  peerId: string;
  label: string;
  port: number;
  headObservationId: string | null;
  capabilities: string[];
  handleRequest: (request: LanTransportRpcRequest) => Promise<unknown> | unknown;
  onPeerExpired?: (peerId: string) => void;
}): LanPeerTransportCallbacks {
  return {
    getAdvertisement: async (): Promise<LanTransportHello> => ({
      protocol: 'nearbytes.lan-sync.v1',
      peerId: options.peerId,
      label: options.label,
      port: options.port,
      capabilities: [...options.capabilities],
      volumeIds: [],
      observationHeadId: options.headObservationId,
      generatedAt: Date.now(),
    }),
    onPeerDiscovered: () => undefined,
    onPeerExpired: options.onPeerExpired,
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
