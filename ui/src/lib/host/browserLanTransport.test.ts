import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  LanPeerTransportSignalRequest,
  LanTransportSignalPeer,
} from '../../../../src/integrations/lanPeerTransport.js';
import { postNativeLanSignal } from './nativeLanPlugin.js';

vi.mock('./nativeLanPlugin.js', () => ({
  postNativeLanSignal: vi.fn(),
}));

import { BrowserLanTransport } from './browserLanTransport.js';

type Listener = (event?: unknown) => void;

class FakeRtcDataChannel {
  readonly label: string;
  readyState: RTCDataChannelState = 'connecting';
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;

  constructor(label: string) {
    this.label = label;
  }

  send(data: string): void {
    const packet = JSON.parse(data) as { type?: string; requestId?: string };
    if (packet.type !== 'request' || typeof packet.requestId !== 'string') {
      return;
    }
    setTimeout(() => {
      this.onmessage?.({
        data: JSON.stringify({
          type: 'response-json',
          requestId: packet.requestId,
          value: { ok: true },
        }),
      });
    }, 0);
  }

  close(): void {
    this.readyState = 'closed';
    this.onclose?.();
  }
}

class FakeRtcPeerConnection {
  connectionState: RTCPeerConnectionState = 'new';
  iceGatheringState: RTCIceGatheringState = 'new';
  localDescription: RTCSessionDescriptionInit | null = null;

  private readonly listeners = new Map<string, Listener[]>();
  private outboundChannel: FakeRtcDataChannel | null = null;

  addEventListener(type: string, listener: Listener): void {
    const existing = this.listeners.get(type) ?? [];
    existing.push(listener);
    this.listeners.set(type, existing);
  }

  createDataChannel(label: string): RTCDataChannel {
    this.outboundChannel = new FakeRtcDataChannel(label);
    return this.outboundChannel as unknown as RTCDataChannel;
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    return { type: 'offer', sdp: 'offer-sdp' };
  }

  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    return { type: 'answer', sdp: 'answer-sdp' };
  }

  async setLocalDescription(description: RTCSessionDescriptionInit): Promise<void> {
    this.localDescription = description;
    this.iceGatheringState = 'complete';
    setTimeout(() => {
      this.emit('icegatheringstatechange');
      this.emit('icecandidate', { candidate: null });
    }, 0);
  }

  async setRemoteDescription(_: RTCSessionDescriptionInit): Promise<void> {
    setTimeout(() => {
      this.connectionState = 'connected';
      this.emit('connectionstatechange');
    }, 0);
    if (this.outboundChannel) {
      setTimeout(() => {
        this.outboundChannel!.readyState = 'open';
        this.outboundChannel!.onopen?.();
      }, 30);
      return;
    }
    setTimeout(() => {
      const inbound = new FakeRtcDataChannel('nearbytes-control');
      this.emit('datachannel', { channel: inbound as unknown as RTCDataChannel });
      setTimeout(() => {
        inbound.readyState = 'open';
        inbound.onopen?.();
      }, 10);
    }, 20);
  }

  async addIceCandidate(): Promise<void> {
    return;
  }

  close(): void {
    this.connectionState = 'closed';
    this.emit('connectionstatechange');
  }

  private emit(type: string, event?: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

describe('BrowserLanTransport', () => {
  const originalPeerConnection = globalThis.RTCPeerConnection;

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalPeerConnection) {
      globalThis.RTCPeerConnection = originalPeerConnection;
      return;
    }
    delete (globalThis as { RTCPeerConnection?: typeof RTCPeerConnection }).RTCPeerConnection;
  });

  it('waits for an inbound control channel after the peer connection reports connected', async () => {
    globalThis.RTCPeerConnection = FakeRtcPeerConnection as unknown as typeof RTCPeerConnection;

    const selfPeer: LanTransportSignalPeer = {
      peerId: 'phone-peer',
      label: 'Phone',
      address: '192.168.0.2',
      port: 4444,
      capabilities: ['webrtc'],
      headObservationId: null,
    };
    const remotePeer: LanTransportSignalPeer = {
      peerId: 'desktop-peer',
      label: 'Desktop',
      address: '192.168.0.3',
      port: 5555,
      capabilities: ['webrtc'],
      headObservationId: null,
    };
    const transport = new BrowserLanTransport({
      selfPeer,
      handleRequest: vi.fn(async () => ({ ok: true })),
    });

    const offer: LanPeerTransportSignalRequest = {
      kind: 'offer',
      from: remotePeer,
      sdp: 'offer-sdp',
      type: 'offer',
      candidates: [],
    };

    await transport.handleSignal(offer);

    await expect(transport.requestJson<{ ok: boolean }>(
      {
        peerId: remotePeer.peerId,
        label: remotePeer.label,
        address: remotePeer.address,
        port: remotePeer.port,
        capabilities: [...remotePeer.capabilities],
        headObservationId: remotePeer.headObservationId,
      },
      { action: 'hello' }
    )).resolves.toEqual({ ok: true });
  });

  it('does not renegotiate a healthy connection when a connect hint arrives', async () => {
    globalThis.RTCPeerConnection = FakeRtcPeerConnection as unknown as typeof RTCPeerConnection;

    const selfPeer: LanTransportSignalPeer = {
      peerId: 'phone-peer',
      label: 'Phone',
      address: '192.168.0.2',
      port: 4444,
      capabilities: ['webrtc'],
      headObservationId: null,
    };
    const remotePeer: LanTransportSignalPeer = {
      peerId: 'desktop-peer',
      label: 'Desktop',
      address: '192.168.0.3',
      port: 5555,
      capabilities: ['webrtc'],
      headObservationId: null,
    };
    const transport = new BrowserLanTransport({
      selfPeer,
      handleRequest: vi.fn(async () => ({ ok: true })),
    });

    await transport.handleSignal({
      kind: 'offer',
      from: remotePeer,
      sdp: 'offer-sdp',
      type: 'offer',
      candidates: [],
    });

    await transport.handleSignal({
      kind: 'connect',
      from: remotePeer,
    });

    expect(vi.mocked(postNativeLanSignal)).not.toHaveBeenCalled();
    await expect(transport.requestJson<{ ok: boolean }>(
      {
        peerId: remotePeer.peerId,
        label: remotePeer.label,
        address: remotePeer.address,
        port: remotePeer.port,
        capabilities: [...remotePeer.capabilities],
        headObservationId: remotePeer.headObservationId,
      },
      { action: 'hello' }
    )).resolves.toEqual({ ok: true });
  });
});