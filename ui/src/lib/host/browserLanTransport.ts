import type {
  LanPeerTransportSignalRequest,
  LanPeerTransportSignalResponse,
  LanTransportDiscoveredPeer,
  LanTransportRpcRequest,
  LanTransportSignalCandidate,
  LanTransportSignalPeer,
} from '../../../../src/integrations/lanPeerTransport.js';
import { postNativeLanSignal } from './nativeLanPlugin.js';

const CONTROL_CHANNEL_LABEL = 'nearbytes-control';
const CONTROL_MESSAGE_CHUNK_BYTES = 48 * 1024;
const CONNECTION_TIMEOUT_MS = 20_000;
const RPC_TIMEOUT_MS = 30_000;

type ControlPacket =
  | {
      type: 'request';
      requestId: string;
      request: LanTransportRpcRequest;
    }
  | {
      type: 'response-json';
      requestId: string;
      value: unknown;
    }
  | {
      type: 'response-error';
      requestId: string;
      error: string;
    }
  | {
      type: 'response-bytes-start';
      requestId: string;
      size: number;
      mime?: string;
    }
  | {
      type: 'response-bytes-chunk';
      requestId: string;
      data: string;
    }
  | {
      type: 'response-bytes-end';
      requestId: string;
    };

interface ChannelFrame {
  header: {
    kind: 'json' | 'bytes';
    ok: boolean;
    size: number;
    mime?: string;
    error?: string;
  };
  payload: Uint8Array;
}

interface PendingResponse {
  resolve: (frame: ChannelFrame) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  kind: 'bytes' | null;
  size: number;
  mime?: string;
  chunks: Uint8Array[];
}

interface PeerConnectionContext {
  peer: LanTransportDiscoveredPeer;
  connection: RTCPeerConnection;
  controlChannel: RTCDataChannel | null;
  pending: Map<string, PendingResponse>;
  readyPromise: Promise<void>;
  resolveReady: () => void;
  rejectReady: (error: Error) => void;
  settled: boolean;
}

export interface BrowserLanTransportOptions {
  selfPeer: LanTransportSignalPeer;
  handleRequest: (request: LanTransportRpcRequest, peer: LanTransportDiscoveredPeer) => Promise<unknown>;
}

export class BrowserLanTransport {
  private readonly contexts = new Map<string, PeerConnectionContext>();
  private selfPeer: LanTransportSignalPeer;

  constructor(private readonly options: BrowserLanTransportOptions) {
    this.selfPeer = options.selfPeer;
  }

  updateSelfPeer(peer: LanTransportSignalPeer): void {
    this.selfPeer = peer;
  }

  async handleSignal(request: LanPeerTransportSignalRequest): Promise<LanPeerTransportSignalResponse> {
    const peer = toDiscoveredPeer(request.from);

    if (request.kind === 'connect') {
      this.closePeer(peer.peerId);
      void this.ensurePeer(peer).catch(() => undefined);
      return {
        kind: 'accepted',
        acceptedAt: Date.now(),
      };
    }

    this.closePeer(peer.peerId);
    const context = this.createContext(peer);
    await context.connection.setRemoteDescription({
      sdp: request.sdp,
      type: request.type,
    });
    await applyRemoteCandidates(context.connection, request.candidates);
    const answer = await gatherLocalDescription(
      context.connection,
      async () => {
        await context.connection.setLocalDescription(await context.connection.createAnswer());
      },
      CONNECTION_TIMEOUT_MS
    );
    return {
      kind: 'answer',
      sdp: answer.sdp,
      type: 'answer',
      candidates: answer.candidates,
      acceptedAt: Date.now(),
    };
  }

  async requestJson<T>(peer: LanTransportDiscoveredPeer, request: LanTransportRpcRequest): Promise<T> {
    const frame = await this.sendRequest(peer, request);
    if (!frame.header.ok) {
      throw new Error(frame.header.error ?? `LAN request failed for ${request.action}`);
    }
    if (frame.header.kind !== 'json') {
      throw new Error(`LAN request ${request.action} returned ${frame.header.kind} instead of json`);
    }
    return JSON.parse(new TextDecoder().decode(frame.payload)) as T;
  }

  async requestBytes(peer: LanTransportDiscoveredPeer, request: LanTransportRpcRequest): Promise<Uint8Array> {
    const frame = await this.sendRequest(peer, request);
    if (!frame.header.ok) {
      throw new Error(frame.header.error ?? `LAN request failed for ${request.action}`);
    }
    if (frame.header.kind !== 'bytes') {
      throw new Error(`LAN request ${request.action} returned ${frame.header.kind} instead of bytes`);
    }
    return frame.payload;
  }

  async notify(
    peer: LanTransportDiscoveredPeer,
    request: Extract<LanTransportRpcRequest, { action: 'sync-hint' | 'storage-command' }>
  ): Promise<void> {
    const frame = await this.sendRequest(peer, request);
    if (!frame.header.ok) {
      throw new Error(frame.header.error ?? `LAN notify failed for ${request.action}`);
    }
  }

  closePeer(peerId: string): void {
    const context = this.contexts.get(peerId);
    if (!context) {
      return;
    }
    this.contexts.delete(peerId);
    for (const pending of context.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(`LAN peer ${peerId} closed`));
    }
    context.pending.clear();
    context.controlChannel?.close();
    context.connection.close();
  }

  reset(): void {
    for (const peerId of this.contexts.keys()) {
      this.closePeer(peerId);
    }
  }

  hasActiveConnection(peerId: string): boolean {
    const context = this.contexts.get(peerId);
    if (!context) {
      return false;
    }
    const connState = context.connection.connectionState;
    return connState === 'connected' || connState === 'connecting';
  }

  private async sendRequest(peer: LanTransportDiscoveredPeer, request: LanTransportRpcRequest): Promise<ChannelFrame> {
    const context = await this.ensurePeer(peer);
    const channel = await waitForControlChannel(context, CONNECTION_TIMEOUT_MS);
    if (channel.readyState !== 'open') {
      throw new Error(`Sync channel to ${peer.label} is no longer open. The connection may have been interrupted.`);
    }
    const requestId = createRandomId();
    return await new Promise<ChannelFrame>((resolve, reject) => {
      const timer = setTimeout(() => {
        context.pending.delete(requestId);
        reject(new Error(`Timed out waiting for LAN response for ${request.action}`));
      }, RPC_TIMEOUT_MS);
      context.pending.set(requestId, {
        resolve,
        reject,
        timer,
        kind: null,
        size: 0,
        chunks: [],
      });
      channel.send(JSON.stringify({
        type: 'request',
        requestId,
        request,
      } satisfies ControlPacket));
    });
  }

  private async ensurePeer(peer: LanTransportDiscoveredPeer): Promise<PeerConnectionContext> {
    const existing = this.contexts.get(peer.peerId);
    if (existing) {
      existing.peer = peer;
      const connState = existing.connection.connectionState;
      const isConnectionDead = connState === 'failed' || connState === 'closed' || connState === 'disconnected';
      const isChannelDead = connState === 'connected' &&
        (!existing.controlChannel || existing.controlChannel.readyState === 'closed' || existing.controlChannel.readyState === 'closing');
      if (!isConnectionDead && !isChannelDead) {
        return existing;
      }
      this.closePeer(peer.peerId);
    }
    if (typeof RTCPeerConnection !== 'function') {
      throw new Error('WebRTC is unavailable in this runtime.');
    }

    const context = this.createContext(peer);
    const channel = context.connection.createDataChannel(CONTROL_CHANNEL_LABEL, {
      ordered: true,
      protocol: 'nearbytes-control',
    });
    this.attachChannel(context, channel);

    const local = await gatherLocalDescription(context.connection, async () => {
      const offer = await context.connection.createOffer();
      await context.connection.setLocalDescription(offer);
    }, CONNECTION_TIMEOUT_MS);
    const response = await postNativeLanSignal(peer.address, peer.port, {
      kind: 'offer',
      from: this.selfPeer,
      sdp: local.sdp,
      type: 'offer',
      candidates: local.candidates,
    });
    await applyRemoteSignalResponse(context.connection, response);
    await withTimeout(context.readyPromise, CONNECTION_TIMEOUT_MS, `Timed out connecting to ${peer.label}`);
    return context;
  }

  private createContext(peer: LanTransportDiscoveredPeer): PeerConnectionContext {
    const connection = new RTCPeerConnection({
      iceServers: [],
    });
    const deferred = createDeferred<void>();
    const context: PeerConnectionContext = {
      peer,
      connection,
      controlChannel: null,
      pending: new Map(),
      readyPromise: deferred.promise,
      resolveReady: deferred.resolve,
      rejectReady: deferred.reject,
      settled: false,
    };
    this.contexts.set(peer.peerId, context);
    connection.addEventListener('connectionstatechange', () => {
      const state = connection.connectionState;
      if (state === 'connected') {
        context.resolveReady();
        return;
      }
      if (state === 'failed' || state === 'closed') {
        context.rejectReady(new Error(`WebRTC connection ${state} for ${peer.label}`));
        this.closePeer(peer.peerId);
      }
    });
    connection.addEventListener('datachannel', (event) => {
      if (event.channel.label === CONTROL_CHANNEL_LABEL) {
        this.attachChannel(context, event.channel);
        return;
      }
      event.channel.close();
    });
    return context;
  }

  private attachChannel(context: PeerConnectionContext, channel: RTCDataChannel): void {
    context.controlChannel = channel;
    channel.onopen = () => {
      context.resolveReady();
    };
    channel.onclose = () => {
      if (context.controlChannel === channel) {
        context.controlChannel = null;
      }
      for (const [requestId, pending] of context.pending.entries()) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`LAN channel closed while waiting for request ${requestId}`));
      }
      context.pending.clear();
    };
    channel.onerror = () => {
      context.rejectReady(new Error(`LAN data channel failed for ${context.peer.label}`));
    };
    channel.onmessage = (event) => {
      void this.handleMessage(context, event.data).catch((error) => {
        console.error('[Nearbytes LAN][Phone WebRTC] Failed to handle control packet.', {
          peerId: context.peer.peerId,
          detail: error instanceof Error ? error.message : String(error),
        });
      });
    };
    if (channel.readyState === 'open') {
      context.resolveReady();
    }
  }

  private async handleMessage(context: PeerConnectionContext, data: string | ArrayBuffer | Blob): Promise<void> {
    const rawText = await readMessageText(data);
    const packet = parseControlPacket(rawText);
    if (packet.type === 'request') {
      await this.handleInboundRequest(context, packet);
      return;
    }
    this.handleInboundResponse(context, packet);
  }

  private async handleInboundRequest(
    context: PeerConnectionContext,
    packet: Extract<ControlPacket, { type: 'request' }>
  ): Promise<void> {
    const channel = context.controlChannel;
    if (!channel || channel.readyState !== 'open') {
      return;
    }
    try {
      const result = await this.options.handleRequest(packet.request, context.peer);
      await sendResponsePackets(channel, packet.requestId, result);
    } catch (error) {
      channel.send(JSON.stringify({
        type: 'response-error',
        requestId: packet.requestId,
        error: error instanceof Error ? error.message : String(error),
      } satisfies ControlPacket));
    }
  }

  private handleInboundResponse(
    context: PeerConnectionContext,
    packet: Exclude<ControlPacket, { type: 'request' }>
  ): void {
    const pending = context.pending.get(packet.requestId);
    if (!pending) {
      return;
    }
    switch (packet.type) {
      case 'response-json': {
        clearTimeout(pending.timer);
        context.pending.delete(packet.requestId);
        const payload = new TextEncoder().encode(JSON.stringify(packet.value));
        pending.resolve({
          header: {
            kind: 'json',
            ok: true,
            size: payload.byteLength,
            mime: 'application/json',
          },
          payload,
        });
        return;
      }
      case 'response-error': {
        clearTimeout(pending.timer);
        context.pending.delete(packet.requestId);
        pending.resolve({
          header: {
            kind: 'json',
            ok: false,
            size: 0,
            error: packet.error,
          },
          payload: new Uint8Array(),
        });
        return;
      }
      case 'response-bytes-start': {
        pending.kind = 'bytes';
        pending.size = packet.size;
        pending.mime = packet.mime;
        pending.chunks.length = 0;
        if (packet.size === 0) {
          clearTimeout(pending.timer);
          context.pending.delete(packet.requestId);
          pending.resolve({
            header: {
              kind: 'bytes',
              ok: true,
              size: 0,
              ...(packet.mime ? { mime: packet.mime } : {}),
            },
            payload: new Uint8Array(),
          });
        }
        return;
      }
      case 'response-bytes-chunk': {
        pending.chunks.push(decodeBase64(packet.data));
        return;
      }
      case 'response-bytes-end': {
        clearTimeout(pending.timer);
        context.pending.delete(packet.requestId);
        pending.resolve({
          header: {
            kind: 'bytes',
            ok: true,
            size: pending.size,
            ...(pending.mime ? { mime: pending.mime } : {}),
          },
          payload: concatBytes(pending.chunks, pending.size),
        });
      }
    }
  }
}

function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: Error) => void } {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

async function gatherLocalDescription(
  connection: RTCPeerConnection,
  trigger: () => Promise<void>,
  timeoutMs: number
): Promise<{ sdp: string; candidates: LanTransportSignalCandidate[] }> {
  const candidates: LanTransportSignalCandidate[] = [];
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error('Timed out gathering local WebRTC description'));
      }
    }, timeoutMs);
    const finish = () => {
      if (settled || !connection.localDescription?.sdp) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    connection.addEventListener('icecandidate', (event) => {
      if (!event.candidate) {
        finish();
        return;
      }
      const candidate = event.candidate.candidate?.trim();
      const mid = event.candidate.sdpMid?.trim();
      if (!candidate || !mid) {
        return;
      }
      candidates.push({ candidate, mid });
    });
    connection.addEventListener('icegatheringstatechange', () => {
      if (connection.iceGatheringState === 'complete') {
        finish();
      }
    });
    void trigger().then(() => {
      if (connection.iceGatheringState === 'complete') {
        finish();
      }
    }).catch(reject);
  });
  return {
    sdp: connection.localDescription?.sdp ?? '',
    candidates,
  };
}

async function applyRemoteSignalResponse(
  connection: RTCPeerConnection,
  response: LanPeerTransportSignalResponse
): Promise<void> {
  if (response.kind !== 'answer') {
    throw new Error('Peer rejected the LAN WebRTC offer');
  }
  await connection.setRemoteDescription({
    type: response.type,
    sdp: response.sdp,
  });
  for (const candidate of response.candidates) {
    await connection.addIceCandidate({
      candidate: candidate.candidate,
      sdpMid: candidate.mid,
    });
  }
}

async function applyRemoteCandidates(
  connection: RTCPeerConnection,
  candidates: readonly LanTransportSignalCandidate[]
): Promise<void> {
  for (const candidate of candidates) {
    await connection.addIceCandidate({
      candidate: candidate.candidate,
      sdpMid: candidate.mid,
    });
  }
}

async function waitForControlChannel(context: PeerConnectionContext, timeoutMs: number): Promise<RTCDataChannel> {
  const deadline = Date.now() + timeoutMs;
  await withTimeout(context.readyPromise, timeoutMs, `Timed out waiting for LAN control channel for ${context.peer.label}`);
  while (Date.now() < deadline) {
    const channel = context.controlChannel;
    if (channel && channel.readyState === 'open') {
      return channel;
    }
    await sleep(25);
  }
  const channel = context.controlChannel;
  if (!channel) {
    throw new Error(`Could not open a sync channel to ${context.peer.label}. The LAN connection was established but the data channel was not available. Try syncing again.`);
  }
  return channel;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    void promise.then((value) => {
      clearTimeout(timer);
      resolve(value);
    }).catch((error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function sleep(timeoutMs: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, timeoutMs);
  });
}

async function readMessageText(data: string | ArrayBuffer | Blob): Promise<string> {
  if (typeof data === 'string') {
    return data;
  }
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    return await data.text();
  }
  return new TextDecoder().decode(data instanceof ArrayBuffer ? new Uint8Array(data) : data);
}

async function sendResponsePackets(channel: RTCDataChannel, requestId: string, result: unknown): Promise<void> {
  if (result instanceof Uint8Array) {
    channel.send(JSON.stringify({
      type: 'response-bytes-start',
      requestId,
      size: result.byteLength,
      mime: 'application/octet-stream',
    } satisfies ControlPacket));
    for (let offset = 0; offset < result.byteLength; offset += CONTROL_MESSAGE_CHUNK_BYTES) {
      channel.send(JSON.stringify({
        type: 'response-bytes-chunk',
        requestId,
        data: encodeBase64(result.subarray(offset, Math.min(result.byteLength, offset + CONTROL_MESSAGE_CHUNK_BYTES))),
      } satisfies ControlPacket));
    }
    channel.send(JSON.stringify({
      type: 'response-bytes-end',
      requestId,
    } satisfies ControlPacket));
    return;
  }

  channel.send(JSON.stringify({
    type: 'response-json',
    requestId,
    value: result ?? null,
  } satisfies ControlPacket));
}

function parseControlPacket(rawText: string): ControlPacket {
  const parsed = JSON.parse(rawText) as Partial<ControlPacket> & { requestId?: unknown; type?: unknown };
  if (typeof parsed.type !== 'string' || typeof parsed.requestId !== 'string') {
    throw new Error('Invalid LAN control packet');
  }
  return parsed as ControlPacket;
}

function concatBytes(chunks: Uint8Array[], expectedSize: number): Uint8Array {
  const size = expectedSize > 0 ? expectedSize : chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const combined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}

function createRandomId(): string {
  if (typeof crypto?.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '').toLowerCase();
  }
  const bytes = new Uint8Array(12);
  crypto?.getRandomValues?.(bytes);
  return Array.from(bytes)
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

function encodeBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function decodeBase64(value: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(value, 'base64'));
  }
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function toDiscoveredPeer(signalPeer: LanTransportSignalPeer): LanTransportDiscoveredPeer {
  return {
    peerId: signalPeer.peerId,
    label: signalPeer.label,
    address: signalPeer.address,
    port: signalPeer.port,
    capabilities: [...signalPeer.capabilities],
    headObservationId: signalPeer.headObservationId,
  };
}