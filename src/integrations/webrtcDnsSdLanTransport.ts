import { randomBytes } from 'crypto';
import dgram, { type RemoteInfo } from 'dgram';
import os from 'os';
import { Bonjour, type Browser, type Service, type ServiceConfig } from 'bonjour-service';
import {
  RTCPeerConnection,
  type RTCDataChannel,
  type RTCIceCandidate,
  type RTCIceCandidateInit,
} from 'werift';
import {
  LAN_DISCOVERY_SERVICE_PROTOCOL,
  LAN_DISCOVERY_SERVICE_TYPE,
  LAN_DISCOVERY_PROTOCOL_VERSION,
  LAN_TRANSPORT_PROFILE_ID,
  buildLanDiscoveryTxtRecord,
  parseLanDiscoveryTxtRecord,
} from './lanTransportProfile.js';
import type {
  LanPeerTransport,
  LanPeerTransportCallbacks,
  LanPeerTransportDebugState,
  LanTransportDiscoveredPeer,
  LanPeerTransportSignalRequest,
  LanPeerTransportSignalResponse,
  LanTransportRpcRequest,
  LanTransportSignalCandidate,
  LanTransportSignalPeer,
} from './lanPeerTransport.js';

const LAN_DISCOVERY_CAPABILITIES = ['webrtc', 'observation-log', 'inventory-recovery', 'push-hint'];
const LAN_RPC_HEADER_MAGIC = 'nearbytes-lan-dc/1';
const LAN_CONTROL_CHANNEL_LABEL = 'nearbytes-control';
const LAN_RPC_CHANNEL_PREFIX = 'nearbytes-rpc-';
const LAN_SIGNAL_PATH = '/lan/transport/signal';
const LAN_SIGNAL_TIMEOUT_MS = 15_000;
const LAN_CONNECTION_TIMEOUT_MS = 20_000;
const LAN_RPC_TIMEOUT_MS = 30_000;
const LAN_MESSAGE_CHUNK_BYTES = 64 * 1024;
const LAN_MULTICAST_GROUP = '239.255.40.41';
const LAN_MULTICAST_PORT = 40441;
const LAN_MULTICAST_ANNOUNCE_MS = 5_000;
const LAN_UNREACHABLE_STATUS_CODES = new Set([404, 410, 502, 503, 504]);

interface DiscoveryDebugRecord {
  readonly source: string;
  readonly fqdn: string;
  readonly peerId: string | null;
  readonly label: string;
  readonly port: number;
  readonly addresses: string[];
  readonly chosenAddress: string | null;
  readonly chosenAddressReason: string | null;
  readonly compatible: boolean;
  readonly incompatibilityReason: string | null;
  readonly protocolVersion: string | null;
  readonly alpn: string | null;
  readonly capabilities: string[];
  readonly headObservationId: string | null;
  readonly seenAt: number;
}

interface LanMulticastAdvertisement {
  readonly pv: string;
  readonly peer: string;
  readonly label: string;
  readonly port: number;
  readonly caps: string[];
  readonly head?: string;
}

interface ChannelFrameHeader {
  readonly magic: typeof LAN_RPC_HEADER_MAGIC;
  readonly phase: 'request' | 'response';
  readonly kind: 'json' | 'bytes';
  readonly ok: boolean;
  readonly size: number;
  readonly mime?: string;
  readonly error?: string;
}

interface ChannelFrame {
  readonly header: Omit<ChannelFrameHeader, 'magic'>;
  readonly payload: Uint8Array;
}

interface SignalDescriptionBundle {
  readonly sdp: string;
  readonly type: 'offer' | 'answer';
  readonly candidates: LanTransportSignalCandidate[];
}

interface ConnectionContext {
  readonly peerId: string;
  peer: LanTransportDiscoveredPeer;
  readonly connection: RTCPeerConnection;
  controlChannel: RTCDataChannel | null;
  readonly initiator: boolean;
  readonly readyPromise: Promise<void>;
  readonly resolveReady: () => void;
  readonly rejectReady: (error: Error) => void;
  readyResolved: boolean;
  closed: boolean;
}

interface TransportOptions {
  readonly disableDiscovery?: boolean;
  readonly signalFetcher?: typeof fetch;
}

interface DiscoveryCompatibility {
  readonly compatible: boolean;
  readonly reason: string | null;
}

interface ChosenPeerAddress {
  readonly address: string | null;
  readonly reason: string | null;
}

interface LocalIpv4Interface {
  readonly name: string;
  readonly address: string;
  readonly netmask: string;
  readonly prefixLength: number;
  readonly virtual: boolean;
}

export class WebRtcDnsSdLanTransport implements LanPeerTransport {
  private callbacks: LanPeerTransportCallbacks | null = null;
  private bonjour: Bonjour | null = null;
  private browser: Browser | null = null;
  private publishedService: Service | null = null;
  private publishedServiceKey: string | null = null;
  private multicastSocket: dgram.Socket | null = null;
  private discoveryByFqdn = new Map<string, LanTransportDiscoveredPeer>();
  private discoveryDebugByFqdn = new Map<string, DiscoveryDebugRecord>();
  private multicastTimer: ReturnType<typeof setInterval> | null = null;
  private publishedAdvertisement: LanPeerTransportDebugState['publishedAdvertisement'] = null;
  private selfSignalPeer: LanTransportSignalPeer | null = null;
  private connections = new Map<string, ConnectionContext>();
  private pendingConnections = new Map<string, Promise<void>>();
  private readonly instanceToken = randomHex(3);

  constructor(
    _runtimeDir: string,
    private readonly options: TransportOptions = {}
  ) {}

  async start(callbacks: LanPeerTransportCallbacks): Promise<void> {
    this.callbacks = callbacks;
    await this.refreshAdvertisement();

    if (this.options.disableDiscovery) {
      return;
    }

    this.multicastSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    this.multicastSocket.on('message', (message, remoteInfo) => {
      this.handleMulticastMessage(message, remoteInfo);
    });
    await bindDgramSocket(this.multicastSocket, LAN_MULTICAST_PORT, '0.0.0.0');
    this.multicastSocket.setMulticastTTL(1);
    this.multicastSocket.setMulticastLoopback(true);
    for (const localInterface of listLocalIpv4Interfaces()) {
      try {
        this.multicastSocket.addMembership(LAN_MULTICAST_GROUP, localInterface.address);
      } catch {
        // Best effort per interface.
      }
    }

    this.bonjour = new Bonjour();
    this.browser = this.bonjour.find(
      {
        type: LAN_DISCOVERY_SERVICE_TYPE,
        protocol: LAN_DISCOVERY_SERVICE_PROTOCOL,
      },
      (service) => {
        this.handleDiscoveryService(service);
      }
    );
    this.browser.on('down', (service) => {
      const peer = this.discoveryByFqdn.get(service.fqdn);
      if (!peer) {
        this.discoveryDebugByFqdn.delete(service.fqdn);
        return;
      }
      this.discoveryByFqdn.delete(service.fqdn);
      this.discoveryDebugByFqdn.delete(service.fqdn);
      this.callbacks?.onPeerExpired?.(peer.peerId);
    });
    this.browser.on('txt-update', (service) => {
      this.handleDiscoveryService(service);
    });

    this.multicastTimer = setInterval(() => {
      void this.sendMulticastAdvertisement();
    }, LAN_MULTICAST_ANNOUNCE_MS);
    await this.sendMulticastAdvertisement();
  }

  async stop(): Promise<void> {
    if (this.multicastTimer) {
      clearInterval(this.multicastTimer);
      this.multicastTimer = null;
    }
    this.browser?.stop();
    this.browser = null;
    if (this.publishedService && typeof this.publishedService.stop === 'function') {
      this.publishedService.stop();
    }
    this.publishedService = null;
    this.publishedServiceKey = null;
    this.bonjour?.destroy();
    this.bonjour = null;
    await closeDgramSocket(this.multicastSocket);
    this.multicastSocket = null;
    for (const context of this.connections.values()) {
      destroyConnectionContext(context);
    }
    this.connections.clear();
    this.pendingConnections.clear();
    this.discoveryByFqdn.clear();
    this.discoveryDebugByFqdn.clear();
    this.publishedAdvertisement = null;
    this.selfSignalPeer = null;
    this.callbacks = null;
  }

  async refreshAdvertisement(): Promise<void> {
    if (!this.callbacks) {
      return;
    }
    const hello = await this.callbacks.getAdvertisement();
    const capabilities = hello.capabilities.length > 0 ? hello.capabilities : LAN_DISCOVERY_CAPABILITIES;
    const txt = buildLanDiscoveryTxtRecord({
      peerId: hello.peerId,
      headObservationId: hello.observationHeadId,
      capabilities,
    });
    const instanceLabel = `${hello.label}-${hello.peerId.slice(0, 6)}-${this.instanceToken}`;
    const nextConfig: ServiceConfig = {
      name: instanceLabel,
      type: LAN_DISCOVERY_SERVICE_TYPE,
      protocol: LAN_DISCOVERY_SERVICE_PROTOCOL,
      port: hello.port,
      host: `${sanitizeBonjourHostName(instanceLabel)}.local`,
      txt: { ...txt },
      disableIPv6: false,
    };
    const serviceKey = JSON.stringify({
      name: nextConfig.name,
      port: nextConfig.port,
      host: nextConfig.host,
      txt: nextConfig.txt,
    });
    this.publishedAdvertisement = {
      peerId: hello.peerId,
      label: hello.label,
      port: hello.port,
      observationHeadId: hello.observationHeadId,
      capabilities: [...capabilities],
    };
    this.selfSignalPeer = {
      peerId: hello.peerId,
      label: hello.label,
      address: pickPreferredLocalAddress(),
      port: hello.port,
      capabilities: [...capabilities],
      headObservationId: hello.observationHeadId,
    };

    if (this.bonjour && serviceKey !== this.publishedServiceKey) {
      if (this.publishedService && typeof this.publishedService.stop === 'function') {
        this.publishedService.stop();
      }
      this.publishedService = this.bonjour.publish(nextConfig);
      this.publishedServiceKey = serviceKey;
    }
    if (!this.options.disableDiscovery) {
      await this.sendMulticastAdvertisement();
    }
  }

  getDebugState(): LanPeerTransportDebugState {
    return {
      transport: 'webrtc-dns-sd',
      listening: this.callbacks !== null,
      publishedAdvertisement: this.publishedAdvertisement,
      discoveredPeers: Array.from(this.discoveryDebugByFqdn.values()).sort(
        (left, right) => right.seenAt - left.seenAt || left.label.localeCompare(right.label)
      ),
    };
  }

  async ensurePeerReady(peer: LanTransportDiscoveredPeer): Promise<void> {
    const existing = this.connections.get(peer.peerId);
    if (existing && existing.readyResolved && !existing.closed) {
      existing.peer = peer;
      return;
    }
    const pending = this.pendingConnections.get(peer.peerId);
    if (pending) {
      await pending;
      return;
    }

    const connectPromise = this.shouldInitiate(peer.peerId)
      ? this.initiateConnection(peer)
      : this.requestRemoteInitiation(peer);
    this.pendingConnections.set(peer.peerId, connectPromise);
    try {
      await connectPromise;
    } finally {
      this.pendingConnections.delete(peer.peerId);
    }
  }

  async handleSignal(request: LanPeerTransportSignalRequest): Promise<LanPeerTransportSignalResponse> {
    const peer = this.toDiscoveredPeer(request.from);
    this.rememberSignaledPeer(peer, 'signal');

    if (request.kind === 'connect') {
      if (this.shouldInitiate(peer.peerId)) {
        void this.ensurePeerReady(peer).catch(() => undefined);
      }
      return {
        kind: 'accepted',
        acceptedAt: Date.now(),
      };
    }

    const context = this.createConnectionContext(peer, false);
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
      LAN_SIGNAL_TIMEOUT_MS
    );
    return {
      kind: 'answer',
      sdp: answer.sdp,
      type: 'answer',
      candidates: answer.candidates,
      acceptedAt: Date.now(),
    };
  }

  async requestJson<TResponse>(peer: LanTransportDiscoveredPeer, request: LanTransportRpcRequest): Promise<TResponse> {
    const frame = await this.sendRequest(peer, request);
    if (!frame.header.ok) {
      throw new Error(frame.header.error ?? `LAN WebRTC request failed for ${request.action}`);
    }
    if (frame.header.kind !== 'json') {
      throw new Error(`LAN WebRTC request ${request.action} returned ${frame.header.kind} instead of json`);
    }
    return JSON.parse(new TextDecoder().decode(frame.payload)) as TResponse;
  }

  async requestBytes(peer: LanTransportDiscoveredPeer, request: LanTransportRpcRequest): Promise<Uint8Array> {
    const frame = await this.sendRequest(peer, request);
    if (!frame.header.ok) {
      throw new Error(frame.header.error ?? `LAN WebRTC request failed for ${request.action}`);
    }
    if (frame.header.kind !== 'bytes') {
      throw new Error(`LAN WebRTC request ${request.action} returned ${frame.header.kind} instead of bytes`);
    }
    return frame.payload;
  }

  async notify(peer: LanTransportDiscoveredPeer, request: Extract<LanTransportRpcRequest, { action: 'sync-hint' }>): Promise<void> {
    const frame = await this.sendRequest(peer, request);
    if (!frame.header.ok) {
      throw new Error(frame.header.error ?? 'LAN WebRTC sync hint failed');
    }
  }

  private async initiateConnection(peer: LanTransportDiscoveredPeer): Promise<void> {
    const context = this.createConnectionContext(peer, true);
    const controlChannel = context.connection.createDataChannel(LAN_CONTROL_CHANNEL_LABEL, {
      protocol: 'nearbytes-control',
    });
    this.attachControlChannel(context, controlChannel);
    const offer = await gatherLocalDescription(
      context.connection,
      async () => {
        await context.connection.setLocalDescription(await context.connection.createOffer());
      },
      LAN_SIGNAL_TIMEOUT_MS
    );
    const response = await this.postSignal(peer, {
      kind: 'offer',
      from: await this.getSelfSignalPeer(),
      sdp: offer.sdp,
      type: 'offer',
      candidates: offer.candidates,
    });
    if (response.kind !== 'answer') {
      throw new Error(`Peer ${peer.label} rejected the WebRTC offer`);
    }
    await context.connection.setRemoteDescription({
      sdp: response.sdp,
      type: response.type,
    });
    await applyRemoteCandidates(context.connection, response.candidates);
    await waitForContextReady(context, LAN_CONNECTION_TIMEOUT_MS);
  }

  private async requestRemoteInitiation(peer: LanTransportDiscoveredPeer): Promise<void> {
    await this.postSignal(peer, {
      kind: 'connect',
      from: await this.getSelfSignalPeer(),
    });
    await waitForPeerConnection(this.connections, peer.peerId, LAN_CONNECTION_TIMEOUT_MS);
  }

  private async sendRequest(peer: LanTransportDiscoveredPeer, request: LanTransportRpcRequest): Promise<ChannelFrame> {
    await this.ensurePeerReady(peer);
    const context = this.connections.get(peer.peerId);
    if (!context || context.closed) {
      throw new Error(`LAN WebRTC connection is not ready for ${peer.label}`);
    }
    const channel = context.connection.createDataChannel(`${LAN_RPC_CHANNEL_PREFIX}${randomHex(8)}`, {
      protocol: 'nearbytes-rpc',
    });
    try {
      await waitForChannelOpen(channel, LAN_CONNECTION_TIMEOUT_MS);
      const payload = new TextEncoder().encode(JSON.stringify(request));
      await sendChannelFrame(channel, {
        header: {
          phase: 'request',
          kind: 'json',
          ok: true,
          size: payload.byteLength,
          mime: 'application/json',
        },
        payload,
      });
      return await receiveChannelFrame(channel, 'response', LAN_RPC_TIMEOUT_MS);
    } catch (error) {
      throw wrapLanWebRtcError(peer, request, error);
    } finally {
      safeCloseChannel(channel);
    }
  }

  private createConnectionContext(peer: LanTransportDiscoveredPeer, initiator: boolean): ConnectionContext {
    const existing = this.connections.get(peer.peerId);
    if (existing && !existing.closed) {
      existing.peer = peer;
      return existing;
    }
    if (existing) {
      destroyConnectionContext(existing);
      this.connections.delete(peer.peerId);
    }

    const { promise, resolve, reject } = createDeferred<void>();
    const connection = new RTCPeerConnection({
      iceServers: [],
      iceUseIpv4: true,
      iceUseIpv6: false,
      forceTurnTCP: false,
    });
    const context: ConnectionContext = {
      peerId: peer.peerId,
      peer,
      connection,
      controlChannel: null,
      initiator,
      readyPromise: promise,
      resolveReady: () => {
        if (!context.readyResolved) {
          context.readyResolved = true;
          resolve();
        }
      },
      rejectReady: (error) => {
        if (!context.readyResolved) {
          reject(error);
        }
      },
      readyResolved: false,
      closed: false,
    };

    connection.onconnectionstatechange = () => {
      const state = connection.connectionState;
      if (state === 'connected') {
        context.resolveReady();
        return;
      }
      if (state === 'closed' || state === 'failed' || state === 'disconnected') {
        context.closed = true;
        if (!context.readyResolved) {
          context.rejectReady(new Error(`WebRTC connection ${state} for ${peer.label}`));
        }
        if (this.connections.get(peer.peerId) === context) {
          this.connections.delete(peer.peerId);
        }
      }
    };
    connection.onDataChannel.subscribe((channel) => {
      this.handleIncomingDataChannel(context, channel);
    });

    this.connections.set(peer.peerId, context);
    return context;
  }

  private handleIncomingDataChannel(context: ConnectionContext, channel: RTCDataChannel): void {
    const label = channel.label;
    if (label === LAN_CONTROL_CHANNEL_LABEL) {
      this.attachControlChannel(context, channel);
      return;
    }
    if (!label.startsWith(LAN_RPC_CHANNEL_PREFIX)) {
      safeCloseChannel(channel);
      return;
    }
    void this.handleIncomingRpcChannel(channel);
  }

  private attachControlChannel(context: ConnectionContext, channel: RTCDataChannel): void {
    context.controlChannel = channel;
    channel.onopen = () => {
      context.resolveReady();
    };
    channel.onclose = () => {
      if (context.controlChannel === channel) {
        context.controlChannel = null;
      }
    };
    channel.onerror = (event) => {
      if (!context.readyResolved) {
        context.rejectReady(new Error(String(event.error ?? 'WebRTC data channel error')));
      }
    };
    if (channel.readyState === 'open') {
      context.resolveReady();
    }
  }

  private async handleIncomingRpcChannel(channel: RTCDataChannel): Promise<void> {
    try {
      const requestFrame = await receiveChannelFrame(channel, 'request', LAN_RPC_TIMEOUT_MS);
      if (requestFrame.header.kind !== 'json') {
        throw new Error('Invalid LAN WebRTC request frame');
      }
      const request = JSON.parse(new TextDecoder().decode(requestFrame.payload)) as LanTransportRpcRequest;
      const response = await this.dispatchRequest(request);
      await sendChannelFrame(channel, response);
      scheduleCloseChannel(channel, 250);
    } catch (error) {
      await sendChannelFrame(channel, {
        header: {
          phase: 'response',
          kind: 'json',
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          size: 0,
        },
        payload: new Uint8Array(),
      }).catch(() => undefined);
      scheduleCloseChannel(channel, 250);
    }
  }

  private async dispatchRequest(request: LanTransportRpcRequest): Promise<ChannelFrame> {
    if (!this.callbacks) {
      throw new Error('LAN WebRTC transport is not running');
    }
    const response = await this.callbacks.handleRequest(request);
    if (response.kind === 'json') {
      const payload = new TextEncoder().encode(JSON.stringify(response.value));
      return {
        header: {
          phase: 'response',
          kind: 'json',
          ok: true,
          mime: 'application/json',
          size: payload.byteLength,
        },
        payload,
      };
    }
    return {
      header: {
        phase: 'response',
        kind: 'bytes',
        ok: true,
        mime: 'application/octet-stream',
        size: response.value.byteLength,
      },
      payload: response.value,
    };
  }

  private async postSignal(
    peer: LanTransportDiscoveredPeer,
    request: LanPeerTransportSignalRequest
  ): Promise<LanPeerTransportSignalResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LAN_SIGNAL_TIMEOUT_MS);
    try {
      const response = await (this.options.signalFetcher ?? fetch)(`http://${peer.address}:${peer.port}${LAN_SIGNAL_PATH}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
      if (!response.ok) {
        if (LAN_UNREACHABLE_STATUS_CODES.has(response.status)) {
          this.expirePeer(peer.peerId);
        }
        throw new Error(`Signal POST failed with status ${response.status}`);
      }
      return await response.json() as LanPeerTransportSignalResponse;
    } catch (error) {
      if (isSignalPathUnavailableError(error)) {
        this.expirePeer(peer.peerId);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private expirePeer(peerId: string): void {
    let expired = false;
    for (const [fqdn, peer] of this.discoveryByFqdn.entries()) {
      if (peer.peerId !== peerId) {
        continue;
      }
      this.discoveryByFqdn.delete(fqdn);
      this.discoveryDebugByFqdn.delete(fqdn);
      expired = true;
    }
    const context = this.connections.get(peerId);
    if (context) {
      destroyConnectionContext(context);
      this.connections.delete(peerId);
      expired = true;
    }
    this.pendingConnections.delete(peerId);
    if (expired) {
      this.callbacks?.onPeerExpired?.(peerId);
    }
  }

  private rememberSignaledPeer(peer: LanTransportDiscoveredPeer, source: string): void {
    const fqdn = `${source}:${peer.peerId}`;
    this.discoveryByFqdn.set(fqdn, peer);
    this.discoveryDebugByFqdn.set(fqdn, {
      source,
      fqdn,
      peerId: peer.peerId,
      label: peer.label,
      port: peer.port,
      addresses: [peer.address],
      chosenAddress: peer.address,
      chosenAddressReason: 'Selected the address supplied by the peer transport signal.',
      compatible: true,
      incompatibilityReason: null,
      protocolVersion: LAN_DISCOVERY_PROTOCOL_VERSION,
      alpn: LAN_TRANSPORT_PROFILE_ID,
      capabilities: [...peer.capabilities],
      headObservationId: peer.headObservationId,
      seenAt: Date.now(),
    });
    this.callbacks?.onPeerDiscovered(peer);
  }

  private handleDiscoveryService(service: Service): void {
    const parsed = parseLanDiscoveryTxtRecord(service.txt ?? {});
    if (!this.callbacks) {
      return;
    }
    const compatibility = describeDiscoveryCompatibility(parsed);
    const selectedAddress = choosePeerAddress(service.addresses ?? []);
    this.discoveryDebugByFqdn.set(service.fqdn, {
      source: 'dns-sd',
      fqdn: service.fqdn,
      peerId: parsed?.peerId ?? null,
      label: service.name || (parsed?.peerId ? `Peer ${parsed.peerId.slice(0, 8)}` : 'Unknown peer'),
      port: service.port,
      addresses: normalizeDiscoveryAddresses(service.addresses ?? []),
      chosenAddress: selectedAddress.address,
      chosenAddressReason: selectedAddress.reason,
      compatible: compatibility.compatible,
      incompatibilityReason: compatibility.reason,
      protocolVersion: parsed?.protocolVersion ?? null,
      alpn: parsed?.alpn ?? null,
      capabilities: parsed?.capabilities ?? [],
      headObservationId: parsed?.headObservationId ?? null,
      seenAt: Date.now(),
    });
    if (!parsed || !compatibility.compatible) {
      return;
    }
    void this.callbacks.getAdvertisement().then((selfHello) => {
      if (parsed.peerId === selfHello.peerId || !selectedAddress.address) {
        return;
      }
      const peer: LanTransportDiscoveredPeer = {
        peerId: parsed.peerId,
        label: service.name || `Peer ${parsed.peerId.slice(0, 8)}`,
        address: selectedAddress.address,
        port: service.port,
        capabilities: parsed.capabilities,
        headObservationId: parsed.headObservationId,
      };
      this.discoveryByFqdn.set(service.fqdn, peer);
      this.callbacks?.onPeerDiscovered(peer);
    }).catch(() => undefined);
  }

  private async sendMulticastAdvertisement(): Promise<void> {
    if (!this.callbacks || !this.multicastSocket) {
      return;
    }
    const hello = await this.callbacks.getAdvertisement();
    const capabilities = hello.capabilities.length > 0 ? hello.capabilities : LAN_DISCOVERY_CAPABILITIES;
    const payload: LanMulticastAdvertisement = {
      pv: LAN_DISCOVERY_PROTOCOL_VERSION,
      peer: hello.peerId,
      label: hello.label,
      port: hello.port,
      caps: [...capabilities],
      ...(hello.observationHeadId ? { head: hello.observationHeadId } : {}),
    };
    const bytes = Buffer.from(JSON.stringify(payload), 'utf8');
    await new Promise<void>((resolve, reject) => {
      this.multicastSocket?.send(bytes, LAN_MULTICAST_PORT, LAN_MULTICAST_GROUP, (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    }).catch(() => undefined);
  }

  private handleMulticastMessage(message: Buffer, remoteInfo: RemoteInfo): void {
    if (!this.callbacks) {
      return;
    }
    const advertisement = parseMulticastAdvertisement(message);
    const compatibility = describeMulticastCompatibility(advertisement);
    const fqdn = `udp:${advertisement?.peer ?? remoteInfo.address}:${remoteInfo.port}`;
    this.discoveryDebugByFqdn.set(fqdn, {
      source: 'udp-multicast',
      fqdn,
      peerId: advertisement?.peer ?? null,
      label: advertisement?.label ?? `Peer ${remoteInfo.address}`,
      port: advertisement?.port ?? 0,
      addresses: [remoteInfo.address],
      chosenAddress: remoteInfo.address,
      chosenAddressReason: 'Selected the source address of the multicast announcement.',
      compatible: compatibility.compatible,
      incompatibilityReason: compatibility.reason,
      protocolVersion: advertisement?.pv ?? null,
      alpn: LAN_TRANSPORT_PROFILE_ID,
      capabilities: advertisement?.caps ?? [],
      headObservationId: advertisement?.head ?? null,
      seenAt: Date.now(),
    });
    if (!advertisement || !compatibility.compatible) {
      return;
    }
    void this.callbacks.getAdvertisement().then((selfHello) => {
      if (advertisement.peer === selfHello.peerId) {
        return;
      }
      const peer: LanTransportDiscoveredPeer = {
        peerId: advertisement.peer,
        label: advertisement.label || `Peer ${advertisement.peer.slice(0, 8)}`,
        address: remoteInfo.address,
        port: advertisement.port,
        capabilities: [...advertisement.caps],
        headObservationId: advertisement.head ?? null,
      };
      this.discoveryByFqdn.set(fqdn, peer);
      this.callbacks?.onPeerDiscovered(peer);
    }).catch(() => undefined);
  }

  private shouldInitiate(remotePeerId: string): boolean {
    const selfPeerId = this.selfSignalPeer?.peerId ?? '';
    return selfPeerId !== '' && selfPeerId.localeCompare(remotePeerId) < 0;
  }

  private async getSelfSignalPeer(): Promise<LanTransportSignalPeer> {
    if (this.selfSignalPeer) {
      return this.selfSignalPeer;
    }
    if (!this.callbacks) {
      throw new Error('LAN WebRTC transport is not running');
    }
    await this.refreshAdvertisement();
    if (!this.selfSignalPeer) {
      throw new Error('LAN WebRTC self advertisement is unavailable');
    }
    return this.selfSignalPeer;
  }

  private toDiscoveredPeer(signalPeer: LanTransportSignalPeer): LanTransportDiscoveredPeer {
    return {
      peerId: signalPeer.peerId,
      label: signalPeer.label,
      address: signalPeer.address,
      port: signalPeer.port,
      capabilities: [...signalPeer.capabilities],
      headObservationId: signalPeer.headObservationId,
    };
  }
}

async function gatherLocalDescription(
  connection: RTCPeerConnection,
  trigger: () => Promise<void>,
  timeoutMs: number
): Promise<SignalDescriptionBundle> {
  const candidates: LanTransportSignalCandidate[] = [];
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error('Timed out while gathering WebRTC local description'));
      }
    }, timeoutMs);
    const maybeResolve = () => {
      if (settled || !connection.localDescription) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve();
    };
    connection.onIceCandidate.subscribe((candidate) => {
      if (settled) {
        return;
      }
      if (!candidate) {
        maybeResolve();
        return;
      }
      const normalized = normalizeIceCandidate(candidate);
      if (normalized) {
        candidates.push(normalized);
      }
    });
    connection.iceGatheringStateChange.subscribe((state) => {
      if (state === 'complete') {
        maybeResolve();
      }
    });
    Promise.resolve(trigger()).then(() => {
      if (connection.iceGatheringState === 'complete') {
        maybeResolve();
      }
      setTimeout(() => {
        if (!settled && connection.localDescription) {
          maybeResolve();
        }
      }, 150);
    }).catch((error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(error);
      }
    });
  });
  const description = connection.localDescription;
  if (!description) {
    throw new Error('WebRTC local description is unavailable');
  }
  return {
    sdp: description.sdp,
    type: description.type,
    candidates,
  };
}

async function applyRemoteCandidates(
  connection: RTCPeerConnection,
  candidates: readonly LanTransportSignalCandidate[]
): Promise<void> {
  for (const candidate of candidates) {
    if (candidate.candidate.trim() === '') {
      continue;
    }
    const init: RTCIceCandidateInit = {
      candidate: candidate.candidate,
      sdpMid: candidate.mid,
    };
    await connection.addIceCandidate(init);
  }
}

async function waitForPeerConnection(
  connections: Map<string, ConnectionContext>,
  peerId: string,
  timeoutMs: number
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const context = connections.get(peerId);
    if (context) {
      await waitForContextReady(context, Math.max(1, deadline - Date.now()));
      return;
    }
    await sleep(50);
  }
  throw new Error(`Timed out waiting for inbound WebRTC connection from ${peerId}`);
}

async function waitForContextReady(context: ConnectionContext, timeoutMs: number): Promise<void> {
  await Promise.race([
    context.readyPromise,
    new Promise<void>((_, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out waiting for WebRTC readiness of ${context.peer.label}`)), timeoutMs);
      if (typeof timer === 'object' && 'unref' in timer) {
        timer.unref();
      }
    }),
  ]);
}

async function waitForChannelOpen(channel: RTCDataChannel, timeoutMs: number): Promise<void> {
  if (channel.readyState === 'open') {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error(`Timed out waiting for WebRTC data channel ${channel.label} to open`));
      }
    }, timeoutMs);
    channel.onopen = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve();
      }
    };
    channel.onerror = (event) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error(String(event.error ?? `WebRTC data channel ${channel.label} failed`)));
      }
    };
    channel.onclose = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error(`WebRTC data channel ${channel.label} closed before opening`));
      }
    };
  });
}

async function sendChannelFrame(channel: RTCDataChannel, frame: ChannelFrame): Promise<void> {
  const header: ChannelFrameHeader = {
    magic: LAN_RPC_HEADER_MAGIC,
    phase: frame.header.phase,
    kind: frame.header.kind,
    ok: frame.header.ok,
    size: frame.payload.byteLength,
    ...(frame.header.mime ? { mime: frame.header.mime } : {}),
    ...(frame.header.error ? { error: frame.header.error } : {}),
  };
  channel.send(JSON.stringify(header));
  for (let offset = 0; offset < frame.payload.byteLength; offset += LAN_MESSAGE_CHUNK_BYTES) {
    const next = frame.payload.subarray(offset, Math.min(frame.payload.byteLength, offset + LAN_MESSAGE_CHUNK_BYTES));
    channel.send(Buffer.from(next));
  }
}

async function receiveChannelFrame(
  channel: RTCDataChannel,
  expectedPhase: ChannelFrameHeader['phase'],
  timeoutMs: number
): Promise<ChannelFrame> {
  return await new Promise<ChannelFrame>((resolve, reject) => {
    let header: ChannelFrameHeader | null = null;
    const chunks: Uint8Array[] = [];
    let total = 0;
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error(`Timed out waiting for WebRTC ${expectedPhase} frame on ${channel.label}`));
      }
    }, timeoutMs);

    const maybeResolve = () => {
      if (!header || settled || total < header.size) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({
        header: {
          phase: header.phase,
          kind: header.kind,
          ok: header.ok,
          size: header.size,
          ...(header.mime ? { mime: header.mime } : {}),
          ...(header.error ? { error: header.error } : {}),
        },
        payload: concatBytes(chunks, header.size),
      });
    };

    channel.onmessage = (event) => {
      if (settled) {
        return;
      }
      try {
        const bytes = toMessageBytes(event.data);
        if (!header) {
          const parsed = JSON.parse(Buffer.from(bytes).toString('utf8')) as Partial<ChannelFrameHeader>;
          if (
            parsed.magic !== LAN_RPC_HEADER_MAGIC ||
            (parsed.phase !== 'request' && parsed.phase !== 'response') ||
            parsed.phase !== expectedPhase ||
            (parsed.kind !== 'json' && parsed.kind !== 'bytes') ||
            typeof parsed.ok !== 'boolean' ||
            typeof parsed.size !== 'number' ||
            parsed.size < 0
          ) {
            throw new Error('Invalid WebRTC LAN frame header');
          }
          header = {
            magic: LAN_RPC_HEADER_MAGIC,
            phase: parsed.phase,
            kind: parsed.kind,
            ok: parsed.ok,
            size: parsed.size,
            ...(typeof parsed.mime === 'string' ? { mime: parsed.mime } : {}),
            ...(typeof parsed.error === 'string' ? { error: parsed.error } : {}),
          };
          if (header.size === 0) {
            maybeResolve();
          }
          return;
        }
        if (bytes.byteLength === 0) {
          return;
        }
        chunks.push(bytes);
        total += bytes.byteLength;
        maybeResolve();
      } catch (error) {
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    };
    channel.onerror = (event) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error(String(event.error ?? `WebRTC data channel ${channel.label} failed`)));
      }
    };
    channel.onclose = () => {
      if (!settled && (!header || total < header.size)) {
        settled = true;
        clearTimeout(timer);
        reject(new Error(`WebRTC data channel ${channel.label} closed before ${expectedPhase} completed`));
      }
    };
  });
}

function toMessageBytes(message: string | Buffer): Uint8Array {
  if (typeof message === 'string') {
    return new TextEncoder().encode(message);
  }
  return new Uint8Array(message);
}

function concatBytes(chunks: readonly Uint8Array[], size: number): Uint8Array {
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    const nextLength = Math.min(chunk.byteLength, size - offset);
    result.set(chunk.subarray(0, nextLength), offset);
    offset += nextLength;
    if (offset >= size) {
      break;
    }
  }
  return result;
}

function safeCloseChannel(channel: RTCDataChannel): void {
  try {
    channel.close();
  } catch {
    // ignore
  }
}

function scheduleCloseChannel(channel: RTCDataChannel, delayMs: number): void {
  const timer = setTimeout(() => {
    safeCloseChannel(channel);
  }, delayMs);
  if (typeof timer === 'object' && 'unref' in timer) {
    timer.unref();
  }
}

function destroyConnectionContext(context: ConnectionContext): void {
  context.closed = true;
  if (!context.readyResolved) {
    context.resolveReady();
  }
  try {
    context.controlChannel?.close();
  } catch {
    // ignore
  }
  void context.connection.close().catch(() => undefined);
}

function createDeferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
  readonly reject: (reason?: unknown) => void;
} {
  let resolveFn!: (value: T | PromiseLike<T>) => void;
  let rejectFn!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });
  return {
    promise,
    resolve: resolveFn,
    reject: rejectFn,
  };
}

function randomHex(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeIceCandidate(candidate: RTCIceCandidate): LanTransportSignalCandidate | null {
  if (!candidate.candidate.trim() || !candidate.sdpMid) {
    return null;
  }
  return {
    candidate: candidate.candidate,
    mid: candidate.sdpMid,
  };
}

function pickPreferredLocalAddress(): string {
  const localInterfaces = listLocalIpv4Interfaces();
  return localInterfaces.find((entry) => !entry.virtual)?.address
    ?? localInterfaces[0]?.address
    ?? '127.0.0.1';
}

function sanitizeBonjourHostName(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized === '' ? 'nearbytes-peer' : normalized;
}

function wrapLanWebRtcError(
  peer: LanTransportDiscoveredPeer,
  request: LanTransportRpcRequest,
  error: unknown
): Error {
  const detail = error instanceof Error ? error.message : String(error);
  const wrapped = new Error(
    `LAN WebRTC ${request.action} failed for ${peer.label} (${peer.address}:${peer.port}): ${detail}`
  );
  wrapped.name = error instanceof Error ? error.name : 'Error';
  return wrapped;
}

function isSignalPathUnavailableError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return /fetch failed|networkerror|econnrefused|enotfound|ehostunreach|enetunreach|timed out|abort/i.test(error.message);
}

function describeDiscoveryCompatibility(
  parsed: ReturnType<typeof parseLanDiscoveryTxtRecord>
): DiscoveryCompatibility {
  if (!parsed) {
    return {
      compatible: false,
      reason: 'TXT record is missing required Nearbytes discovery fields.',
    };
  }
  if (parsed.protocolVersion !== LAN_DISCOVERY_PROTOCOL_VERSION) {
    return {
      compatible: false,
      reason: `Unsupported discovery protocol version ${parsed.protocolVersion}. Expected ${LAN_DISCOVERY_PROTOCOL_VERSION}.`,
    };
  }
  if (parsed.alpn !== LAN_TRANSPORT_PROFILE_ID) {
    return {
      compatible: false,
      reason: `Unsupported LAN profile ${parsed.alpn}. Expected ${LAN_TRANSPORT_PROFILE_ID}.`,
    };
  }
  return {
    compatible: true,
    reason: null,
  };
}

function describeMulticastCompatibility(advertisement: LanMulticastAdvertisement | null): DiscoveryCompatibility {
  if (!advertisement) {
    return {
      compatible: false,
      reason: 'Multicast packet is not a valid Nearbytes LAN advertisement.',
    };
  }
  if (advertisement.pv !== LAN_DISCOVERY_PROTOCOL_VERSION) {
    return {
      compatible: false,
      reason: `Unsupported multicast discovery protocol version ${advertisement.pv}. Expected ${LAN_DISCOVERY_PROTOCOL_VERSION}.`,
    };
  }
  if (advertisement.peer.trim() === '' || !Number.isInteger(advertisement.port) || advertisement.port <= 0) {
    return {
      compatible: false,
      reason: 'Multicast advertisement is missing peer id or port.',
    };
  }
  return {
    compatible: true,
    reason: null,
  };
}

function choosePeerAddress(addresses: readonly string[]): ChosenPeerAddress {
  const normalized = normalizeDiscoveryAddresses(addresses);
  if (normalized.length === 0) {
    return {
      address: null,
      reason: 'No non-loopback discovery addresses were advertised.',
    };
  }

  const localInterfaces = listLocalIpv4Interfaces();
  const samePhysicalSubnet = normalized.find((candidate) =>
    localInterfaces.some((local) => !local.virtual && isSameIpv4Subnet(candidate, local.address, local.prefixLength))
  );
  if (samePhysicalSubnet) {
    const matching = localInterfaces.find(
      (local) => !local.virtual && isSameIpv4Subnet(samePhysicalSubnet, local.address, local.prefixLength)
    );
    return {
      address: samePhysicalSubnet,
      reason: `Selected IPv4 address on the same subnet as local interface ${matching?.name ?? 'unknown'}.`,
    };
  }

  const sameVirtualSubnet = normalized.find((candidate) =>
    localInterfaces.some((local) => local.virtual && isSameIpv4Subnet(candidate, local.address, local.prefixLength))
  );
  if (sameVirtualSubnet) {
    const matching = localInterfaces.find(
      (local) => local.virtual && isSameIpv4Subnet(sameVirtualSubnet, local.address, local.prefixLength)
    );
    return {
      address: sameVirtualSubnet,
      reason: `Selected IPv4 address on the same virtual subnet as local interface ${matching?.name ?? 'unknown'}.`,
    };
  }

  const privateIpv4 = normalized.find(isPrivateIpv4Address);
  if (privateIpv4) {
    return {
      address: privateIpv4,
      reason: 'Selected RFC1918 private IPv4 address.',
    };
  }

  const linkLocalIpv4 = normalized.find(isLinkLocalIpv4Address);
  if (linkLocalIpv4) {
    return {
      address: linkLocalIpv4,
      reason: 'Selected link-local IPv4 address.',
    };
  }

  const uniqueLocalIpv6 = normalized.find(isUniqueLocalIpv6Address);
  if (uniqueLocalIpv6) {
    return {
      address: uniqueLocalIpv6,
      reason: 'Selected unique-local IPv6 address.',
    };
  }

  const globalIpv4 = normalized.find(isIpv4Address);
  if (globalIpv4) {
    return {
      address: globalIpv4,
      reason: 'Fell back to advertised global IPv4 address because no LAN-scoped address was present.',
    };
  }

  return {
    address: normalized[0] ?? null,
    reason: 'Fell back to the first advertised non-loopback address.',
  };
}

function normalizeDiscoveryAddresses(addresses: readonly string[]): string[] {
  return addresses
    .map((entry) => entry.trim())
    .map((entry) => (entry.toLowerCase().startsWith('::ffff:') ? entry.slice('::ffff:'.length) : entry))
    .filter((entry) => entry !== '' && !isLoopbackAddress(entry));
}

function isLoopbackAddress(value: string): boolean {
  return value === '127.0.0.1' || value === '::1' || value.toLowerCase() === 'localhost';
}

function isIpv4Address(value: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value);
}

function isPrivateIpv4Address(value: string): boolean {
  if (!isIpv4Address(value)) {
    return false;
  }
  const parts = value.split('.').map((entry) => Number.parseInt(entry, 10));
  if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  return (
    parts[0] === 10 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
  );
}

function isLinkLocalIpv4Address(value: string): boolean {
  return /^169\.254\.\d{1,3}\.\d{1,3}$/.test(value);
}

function isUniqueLocalIpv6Address(value: string): boolean {
  return value.includes(':') && /^(fc|fd)/i.test(value);
}

function listLocalIpv4Interfaces(): LocalIpv4Interface[] {
  return Object.entries(os.networkInterfaces())
    .flatMap(([name, entries]) => (entries ?? []).map((entry) => ({ name, entry })))
    .filter(({ entry }) => entry.family === 'IPv4' && !entry.internal && entry.cidr && entry.netmask)
    .map(({ name, entry }) => ({
      name,
      address: entry.address,
      netmask: entry.netmask,
      prefixLength: Number.parseInt((entry.cidr ?? '').split('/')[1] ?? '32', 10),
      virtual: /wsl|hyper-v|virtual|vmware|vbox|loopback|tailscale|zerotier|vpn/i.test(name),
    }))
    .filter((entry) => Number.isInteger(entry.prefixLength) && entry.prefixLength >= 0 && entry.prefixLength <= 32);
}

function isSameIpv4Subnet(left: string, right: string, prefixLength: number): boolean {
  if (!isIpv4Address(left) || !isIpv4Address(right) || prefixLength <= 0 || prefixLength > 32) {
    return false;
  }
  const leftValue = ipv4ToInt(left);
  const rightValue = ipv4ToInt(right);
  const mask = prefixLength === 32 ? 0xffffffff : (0xffffffff << (32 - prefixLength)) >>> 0;
  return (leftValue & mask) === (rightValue & mask);
}

function ipv4ToInt(value: string): number {
  return value
    .split('.')
    .map((entry) => Number.parseInt(entry, 10))
    .reduce((total, part) => ((total << 8) | (part & 0xff)) >>> 0, 0);
}

function parseMulticastAdvertisement(message: Buffer): LanMulticastAdvertisement | null {
  try {
    const parsed = JSON.parse(message.toString('utf8')) as Partial<LanMulticastAdvertisement>;
    if (
      typeof parsed.pv !== 'string' ||
      typeof parsed.peer !== 'string' ||
      typeof parsed.label !== 'string' ||
      !Number.isInteger(parsed.port) ||
      !Array.isArray(parsed.caps)
    ) {
      return null;
    }
    return {
      pv: parsed.pv,
      peer: parsed.peer,
      label: parsed.label,
      port: parsed.port as number,
      caps: parsed.caps.filter((entry): entry is string => typeof entry === 'string'),
      ...(typeof parsed.head === 'string' ? { head: parsed.head } : {}),
    };
  } catch {
    return null;
  }
}

async function bindDgramSocket(socket: dgram.Socket, port: number, address: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const handleError = (error: Error) => {
      socket.off('listening', handleListening);
      reject(error);
    };
    const handleListening = () => {
      socket.off('error', handleError);
      resolve();
    };
    socket.once('error', handleError);
    socket.once('listening', handleListening);
    socket.bind(port, address);
  });
}

async function closeDgramSocket(socket: dgram.Socket | null): Promise<void> {
  if (!socket) {
    return;
  }
  await new Promise<void>((resolve) => {
    try {
      socket.close(() => resolve());
    } catch {
      resolve();
    }
  });
}
