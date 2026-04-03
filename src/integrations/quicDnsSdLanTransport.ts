import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import dgram, { type RemoteInfo } from 'dgram';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import type { ReadableStream as NodeReadableStream, WritableStream as NodeWritableStream } from 'stream/web';
import { Bonjour, type Browser, type Service, type ServiceConfig } from 'bonjour-service';
import { QUICClient, QUICServer, QUICSocket, events, type QUICConnection, type QUICStream } from '@matrixai/quic';
import { generate as generateSelfSigned } from 'selfsigned';
import {
  LAN_DISCOVERY_SERVICE_PROTOCOL,
  LAN_DISCOVERY_SERVICE_TYPE,
  LAN_DISCOVERY_PROTOCOL_VERSION,
  LAN_QUIC_ALPN,
  LAN_TRANSPORT_CAPABILITIES,
  buildLanDiscoveryTxtRecord,
  parseLanDiscoveryTxtRecord,
} from './lanTransportProfile.js';
import type {
  LanPeerTransport,
  LanPeerTransportCallbacks,
  LanPeerTransportDebugState,
  LanTransportDiscoveredPeer,
  LanTransportRpcRequest,
} from './lanPeerTransport.js';

const LAN_QUIC_CERT_FILE = 'quic-cert.pem';
const LAN_QUIC_KEY_FILE = 'quic-key.pem';
const LAN_QUIC_SIGNING_KEY_FILE = 'quic-signing-key.bin';
const LAN_QUIC_APPLICATION_PROTOCOLS = [LAN_QUIC_ALPN];
const LAN_QUIC_REQUEST_TIMEOUT_MS = 30_000;
const LAN_QUIC_WRITE_CHUNK_BYTES = 64 * 1024;
const LAN_MULTICAST_GROUP = '239.255.40.41';
const LAN_MULTICAST_PORT = 40441;
const LAN_MULTICAST_ANNOUNCE_MS = 5_000;

interface LanRpcFrameHeader {
  readonly kind: 'json' | 'bytes';
  readonly ok: boolean;
  readonly mime?: string;
  readonly error?: string;
}

interface LanRpcFrame {
  readonly header: LanRpcFrameHeader;
  readonly payload: Uint8Array;
}

interface PersistedLanQuicIdentity {
  readonly certPem: string;
  readonly keyPem: string;
  readonly signingKeyHex: string;
}

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

export class QuicDnsSdLanTransport implements LanPeerTransport {
  private callbacks: LanPeerTransportCallbacks | null = null;
  private bonjour: Bonjour | null = null;
  private browser: Browser | null = null;
  private publishedService: Service | null = null;
  private socket: QUICSocket | null = null;
  private server: QUICServer | null = null;
  private multicastSocket: dgram.Socket | null = null;
  private clients = new Map<string, QUICClient>();
  private discoveryByFqdn = new Map<string, LanTransportDiscoveredPeer>();
  private discoveryDebugByFqdn = new Map<string, DiscoveryDebugRecord>();
  private advertisementTimer: ReturnType<typeof setInterval> | null = null;
  private multicastTimer: ReturnType<typeof setInterval> | null = null;
  private publishedAdvertisement: LanPeerTransportDebugState['publishedAdvertisement'] = null;

  constructor(private readonly runtimeDir: string) {}

  async start(callbacks: LanPeerTransportCallbacks): Promise<void> {
    if (this.callbacks) {
      this.callbacks = callbacks;
      await this.refreshAdvertisement();
      return;
    }
    this.callbacks = callbacks;
    const hello = await callbacks.getAdvertisement();
    const identity = await loadOrCreateLanQuicIdentity(this.runtimeDir, hello.label);

    this.socket = new QUICSocket({});
    await this.socket.start({
      host: '::',
      port: hello.port,
      reuseAddr: true,
    });

    this.server = new QUICServer({
      socket: this.socket,
      crypto: createQuicServerCrypto(identity.signingKeyHex),
      config: {
        key: identity.keyPem,
        cert: identity.certPem,
        verifyPeer: false,
        applicationProtos: LAN_QUIC_APPLICATION_PROTOCOLS,
        keepAliveIntervalTime: 15_000,
        maxIdleTimeout: 30_000,
      },
    });
    asTypedEventTarget(this.server).addEventListener(events.EventQUICServerConnection.name, this.handleServerConnection as EventListener);
    await this.server.start();

    this.multicastSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    this.multicastSocket.on('message', (message, remoteInfo) => {
      this.handleMulticastMessage(message, remoteInfo);
    });
    await new Promise<void>((resolve, reject) => {
      this.multicastSocket?.once('error', reject);
      this.multicastSocket?.bind(LAN_MULTICAST_PORT, '0.0.0.0', () => resolve());
    });
    this.multicastSocket.setMulticastTTL(1);
    this.multicastSocket.setMulticastLoopback(true);
    for (const localInterface of listLocalIpv4Interfaces()) {
      try {
        this.multicastSocket.addMembership(LAN_MULTICAST_GROUP, localInterface.address);
      } catch {
        // Best-effort membership per interface.
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

    await this.refreshAdvertisement();
    this.advertisementTimer = setInterval(() => {
      void this.refreshAdvertisement();
    }, 10_000);
    this.multicastTimer = setInterval(() => {
      void this.sendMulticastAdvertisement();
    }, LAN_MULTICAST_ANNOUNCE_MS);
  }

  async stop(): Promise<void> {
    if (this.advertisementTimer) {
      clearInterval(this.advertisementTimer);
      this.advertisementTimer = null;
    }
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
    this.bonjour?.destroy();
    this.bonjour = null;
    await closeDgramSocket(this.multicastSocket);
    this.multicastSocket = null;
    for (const client of this.clients.values()) {
      await client.destroy({ force: true }).catch(() => undefined);
    }
    this.clients.clear();
    if (this.server) {
      asTypedEventTarget(this.server).removeEventListener(events.EventQUICServerConnection.name, this.handleServerConnection as EventListener);
    }
    await this.server?.stop({ force: true }).catch(() => undefined);
    this.server = null;
    await this.socket?.stop({ force: true }).catch(() => undefined);
    this.socket = null;
    this.callbacks = null;
    this.discoveryByFqdn.clear();
    this.discoveryDebugByFqdn.clear();
    this.publishedAdvertisement = null;
  }

  async refreshAdvertisement(): Promise<void> {
    if (!this.callbacks || !this.bonjour) {
      return;
    }
    const hello = await this.callbacks.getAdvertisement();
    const txt = buildLanDiscoveryTxtRecord({
      peerId: hello.peerId,
      headObservationId: hello.observationHeadId,
      capabilities: hello.capabilities.length > 0 ? hello.capabilities : LAN_TRANSPORT_CAPABILITIES,
    });
    this.publishedAdvertisement = {
      peerId: hello.peerId,
      label: hello.label,
      port: hello.port,
      observationHeadId: hello.observationHeadId,
      capabilities: [...(hello.capabilities.length > 0 ? hello.capabilities : LAN_TRANSPORT_CAPABILITIES)],
    };
    const nextConfig: ServiceConfig = {
      name: hello.label,
      type: LAN_DISCOVERY_SERVICE_TYPE,
      protocol: LAN_DISCOVERY_SERVICE_PROTOCOL,
      port: hello.port,
      host: `${sanitizeBonjourHostName(hello.label)}.local`,
      txt: { ...txt },
      disableIPv6: false,
    };

    if (this.publishedService && typeof this.publishedService.stop === 'function') {
      this.publishedService.stop();
    }
    this.publishedService = this.bonjour.publish(nextConfig);
    await this.sendMulticastAdvertisement();
  }

  getDebugState(): LanPeerTransportDebugState {
    return {
      transport: 'quic-dns-sd',
      listening: this.server !== null && this.socket !== null,
      publishedAdvertisement: this.publishedAdvertisement,
      discoveredPeers: Array.from(this.discoveryDebugByFqdn.values()).sort(
        (left, right) => right.seenAt - left.seenAt || left.label.localeCompare(right.label)
      ),
    };
  }

  async requestJson<TResponse>(peer: LanTransportDiscoveredPeer, request: LanTransportRpcRequest): Promise<TResponse> {
    const frame = await this.sendRequest(peer, request);
    if (!frame.header.ok) {
      throw new Error(frame.header.error ?? `LAN QUIC request failed for ${request.action}`);
    }
    if (frame.header.kind !== 'json') {
      throw new Error(`LAN QUIC request ${request.action} returned ${frame.header.kind} instead of json`);
    }
    return JSON.parse(new TextDecoder().decode(frame.payload)) as TResponse;
  }

  async requestBytes(peer: LanTransportDiscoveredPeer, request: LanTransportRpcRequest): Promise<Uint8Array> {
    const frame = await this.sendRequest(peer, request);
    if (!frame.header.ok) {
      throw new Error(frame.header.error ?? `LAN QUIC request failed for ${request.action}`);
    }
    if (frame.header.kind !== 'bytes') {
      throw new Error(`LAN QUIC request ${request.action} returned ${frame.header.kind} instead of bytes`);
    }
    return frame.payload;
  }

  async notify(peer: LanTransportDiscoveredPeer, request: Extract<LanTransportRpcRequest, { action: 'sync-hint' }>): Promise<void> {
    const frame = await this.sendRequest(peer, request);
    if (!frame.header.ok) {
      throw new Error(frame.header.error ?? 'LAN QUIC sync hint failed');
    }
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
    if (!parsed || !compatibility.compatible || parsed.peerId === undefined) {
      const existing = this.discoveryByFqdn.get(service.fqdn);
      if (existing) {
        this.discoveryByFqdn.delete(service.fqdn);
        this.callbacks?.onPeerExpired?.(existing.peerId);
      }
      return;
    }
    const helloPeerId = parsed.peerId;
    this.callbacks.getAdvertisement().then((selfHello) => {
      if (helloPeerId === selfHello.peerId) {
        return;
      }
      const address = selectedAddress.address;
      if (!address) {
        return;
      }
      const peer: LanTransportDiscoveredPeer = {
        peerId: helloPeerId,
        label: service.name || `Peer ${helloPeerId.slice(0, 8)}`,
        address,
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
    const payload: LanMulticastAdvertisement = {
      pv: LAN_DISCOVERY_PROTOCOL_VERSION,
      peer: hello.peerId,
      label: hello.label,
      port: hello.port,
      caps: [...(hello.capabilities.length > 0 ? hello.capabilities : LAN_TRANSPORT_CAPABILITIES)],
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
      alpn: LAN_QUIC_ALPN,
      capabilities: advertisement?.caps ?? [],
      headObservationId: advertisement?.head ?? null,
      seenAt: Date.now(),
    });
    if (!advertisement || !compatibility.compatible) {
      return;
    }
    this.callbacks.getAdvertisement().then((selfHello) => {
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

  private handleServerConnection = (event: Event): void => {
    const connection = (event as CustomEvent<QUICConnection>).detail;
    asTypedEventTarget(connection).addEventListener(events.EventQUICConnectionStream.name, ((streamEvent: Event) => {
      const stream = (streamEvent as CustomEvent<QUICStream>).detail;
      void this.handleIncomingStream(stream);
    }) as EventListener);
  };

  private async handleIncomingStream(stream: QUICStream): Promise<void> {
    try {
      const requestFrame = decodeLanRpcFrame(await readAllStream(stream.readable));
      if (!requestFrame.header.ok || requestFrame.header.kind !== 'json') {
        await writeAllStream(
          stream.writable,
          encodeLanRpcFrame({
            header: {
              ok: false,
              kind: 'json',
              error: 'Invalid LAN QUIC request frame',
            },
            payload: new Uint8Array(),
          })
        );
        return;
      }
      const request = JSON.parse(new TextDecoder().decode(requestFrame.payload)) as LanTransportRpcRequest;
      const response = await this.dispatchRequest(request);
      await writeAllStream(stream.writable, encodeLanRpcFrame(response));
    } catch (error) {
      console.error('[Nearbytes LAN][QUIC] Incoming stream failed.', describeQuicErrorContext(error));
      await writeAllStream(
        stream.writable,
        encodeLanRpcFrame({
          header: {
            ok: false,
            kind: 'json',
            error: error instanceof Error ? error.message : String(error),
          },
          payload: new Uint8Array(),
        })
      ).catch(() => undefined);
    }
  }

  private async dispatchRequest(request: LanTransportRpcRequest): Promise<LanRpcFrame> {
    if (!this.callbacks) {
      throw new Error('LAN QUIC transport is not running');
    }
    const response = await this.callbacks.handleRequest(request);
    return response.kind === 'json'
      ? jsonFrame(response.value)
      : {
          header: {
            ok: true,
            kind: 'bytes',
            mime: 'application/octet-stream',
          },
          payload: response.value,
        };
  }

  private async sendRequest(peer: LanTransportDiscoveredPeer, request: LanTransportRpcRequest): Promise<LanRpcFrame> {
    const cacheKey = peerCacheKey(peer);
    try {
      const client = await this.getOrCreateClient(peer, cacheKey);
      const stream = client.connection.newStream();
      await writeAllStream(stream.writable, encodeLanRpcFrame(jsonFrame(request)));
      return decodeLanRpcFrame(await readAllStreamWithTimeout(stream.readable, LAN_QUIC_REQUEST_TIMEOUT_MS));
    } catch (error) {
      if (shouldRetryWithFreshClient(error)) {
        await this.destroyCachedClient(cacheKey);
        try {
          const freshClient = await this.getOrCreateClient(peer, cacheKey);
          const stream = freshClient.connection.newStream();
          await writeAllStream(stream.writable, encodeLanRpcFrame(jsonFrame(request)));
          return decodeLanRpcFrame(await readAllStreamWithTimeout(stream.readable, LAN_QUIC_REQUEST_TIMEOUT_MS));
        } catch (retryError) {
          console.error('[Nearbytes LAN][QUIC] Retry with fresh client failed.', {
            peerId: peer.peerId,
            address: peer.address,
            port: peer.port,
            action: request.action,
            detail: describeQuicErrorContext(retryError),
          });
          throw wrapLanQuicError(peer, request, retryError);
        }
      }
      console.error('[Nearbytes LAN][QUIC] Request failed.', {
        peerId: peer.peerId,
        address: peer.address,
        port: peer.port,
        action: request.action,
        detail: describeQuicErrorContext(error),
      });
      throw wrapLanQuicError(peer, request, error);
    }
  }

  private async getOrCreateClient(peer: LanTransportDiscoveredPeer, key = peerCacheKey(peer)): Promise<QUICClient> {
    const existing = this.clients.get(key);
    if (existing && !existing.closed) {
      return existing;
    }
    if (!this.socket) {
      throw new Error('LAN QUIC socket is not running');
    }
    const client = await QUICClient.createQUICClient({
      host: peer.address,
      port: peer.port,
      serverName: sanitizeBonjourHostName(peer.label),
      socket: this.socket,
      crypto: {
        ops: {
          async randomBytes(data: ArrayBuffer): Promise<void> {
            randomBytes(data.byteLength).copy(Buffer.from(data));
          },
        },
      },
      config: {
        verifyPeer: false,
        applicationProtos: LAN_QUIC_APPLICATION_PROTOCOLS,
        keepAliveIntervalTime: 15_000,
        maxIdleTimeout: 30_000,
      },
    });
    client.closedP.finally(() => {
      if (this.clients.get(key) === client) {
        this.clients.delete(key);
      }
    });
    this.clients.set(key, client);
    return client;
  }

  private async destroyCachedClient(key: string): Promise<void> {
    const client = this.clients.get(key);
    if (!client) {
      return;
    }
    this.clients.delete(key);
    await client.destroy({ force: true }).catch(() => undefined);
  }
}

function createQuicServerCrypto(signingKeyHex: string) {
    const keyBytes = Buffer.from(signingKeyHex, 'hex');
    return {
    key: toArrayBuffer(keyBytes),
      ops: {
      async sign(rawKey: ArrayBuffer, data: ArrayBuffer): Promise<ArrayBuffer> {
        const digest = createHmac('sha256', Buffer.from(rawKey)).update(Buffer.from(data)).digest();
        return digest.buffer.slice(digest.byteOffset, digest.byteOffset + digest.byteLength);
      },
      async verify(rawKey: ArrayBuffer, data: ArrayBuffer, signature: ArrayBuffer): Promise<boolean> {
        const expected = createHmac('sha256', Buffer.from(rawKey)).update(Buffer.from(data)).digest();
        const actual = Buffer.from(signature);
        return expected.length === actual.length && timingSafeEqual(expected, actual);
      },
    },
  };
}

async function loadOrCreateLanQuicIdentity(runtimeDir: string, label: string): Promise<PersistedLanQuicIdentity> {
  await fs.mkdir(runtimeDir, { recursive: true });
  const certPath = path.join(runtimeDir, LAN_QUIC_CERT_FILE);
  const keyPath = path.join(runtimeDir, LAN_QUIC_KEY_FILE);
  const signingKeyPath = path.join(runtimeDir, LAN_QUIC_SIGNING_KEY_FILE);
  try {
    const [certPem, keyPem, signingKey] = await Promise.all([
      fs.readFile(certPath, 'utf8'),
      fs.readFile(keyPath, 'utf8'),
      fs.readFile(signingKeyPath),
    ]);
    return {
      certPem,
      keyPem,
      signingKeyHex: signingKey.toString('hex'),
    };
  } catch {
    const generated = await generateSelfSigned(
      [{ name: 'commonName', value: sanitizeBonjourHostName(label) || os.hostname() || 'nearbytes' }],
      {
        notAfterDate: new Date(Date.now() + 3650 * 24 * 60 * 60 * 1000),
        keySize: 2048,
        algorithm: 'sha256',
      }
    );
    const signingKey = randomBytes(32);
    await Promise.all([
      fs.writeFile(certPath, generated.cert, 'utf8'),
      fs.writeFile(keyPath, generated.private, 'utf8'),
      fs.writeFile(signingKeyPath, signingKey),
    ]);
    return {
      certPem: generated.cert,
      keyPem: generated.private,
      signingKeyHex: signingKey.toString('hex'),
    };
  }
}

function sanitizeBonjourHostName(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized === '' ? 'nearbytes-peer' : normalized;
}

function peerCacheKey(peer: LanTransportDiscoveredPeer): string {
  return `${peer.peerId}@${peer.address}:${peer.port}`;
}

function shouldRetryWithFreshClient(error: unknown): boolean {
  const detail = describeQuicErrorContext(error).toLowerCase();
  return (
    detail.includes('create external arraybuffer failed') ||
    detail.includes('invalid state') ||
    detail.includes('stream') && detail.includes('closed') ||
    detail.includes('connection') && detail.includes('closed')
  );
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
  if (parsed.alpn !== LAN_QUIC_ALPN) {
    return {
      compatible: false,
      reason: `Unsupported QUIC ALPN ${parsed.alpn}. Expected ${LAN_QUIC_ALPN}.`,
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
  return isIpv4Address(value) && value.startsWith('169.254.');
}

function isUniqueLocalIpv6Address(value: string): boolean {
  return /^[a-f0-9:]+$/i.test(value) && /^(fc|fd)/i.test(value);
}

function parseMulticastAdvertisement(message: Buffer): LanMulticastAdvertisement | null {
  try {
    const raw = JSON.parse(message.toString('utf8')) as Partial<LanMulticastAdvertisement>;
    return {
      pv: typeof raw.pv === 'string' ? raw.pv.trim() : '',
      peer: typeof raw.peer === 'string' ? raw.peer.trim() : '',
      label: typeof raw.label === 'string' ? raw.label.trim() : '',
      port: typeof raw.port === 'number' ? raw.port : Number.parseInt(String(raw.port ?? ''), 10),
      caps: Array.isArray(raw.caps)
        ? raw.caps.map((entry) => String(entry).trim()).filter((entry) => entry !== '')
        : [],
      ...(typeof raw.head === 'string' && /^[0-9a-f]{64}$/i.test(raw.head.trim())
        ? { head: raw.head.trim().toLowerCase() }
        : {}),
    };
  } catch {
    return null;
  }
}

function listLocalIpv4Interfaces(): LocalIpv4Interface[] {
  const interfaces = os.networkInterfaces();
  const results: LocalIpv4Interface[] = [];
  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.internal || entry.family !== 'IPv4') {
        continue;
      }
      const prefixLength = netmaskToPrefixLength(entry.netmask);
      if (prefixLength === null) {
        continue;
      }
      results.push({
        name,
        address: entry.address,
        netmask: entry.netmask,
        prefixLength,
        virtual: isVirtualInterfaceName(name),
      });
    }
  }
  return results;
}

function isVirtualInterfaceName(name: string): boolean {
  return /wsl|hyper-v|docker|vethernet|vmware|virtualbox|vbox|virbr|bridge|tailscale|utun/i.test(name);
}

function netmaskToPrefixLength(netmask: string): number | null {
  if (!isIpv4Address(netmask)) {
    return null;
  }
  const parts = netmask.split('.').map((entry) => Number.parseInt(entry, 10));
  if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }
  let prefix = 0;
  let sawZero = false;
  for (const part of parts) {
    for (let bit = 7; bit >= 0; bit -= 1) {
      const enabled = (part & (1 << bit)) !== 0;
      if (enabled && sawZero) {
        return null;
      }
      if (enabled) {
        prefix += 1;
      } else {
        sawZero = true;
      }
    }
  }
  return prefix;
}

function isSameIpv4Subnet(candidate: string, localAddress: string, prefixLength: number): boolean {
  if (!isIpv4Address(candidate) || !isIpv4Address(localAddress) || prefixLength < 0 || prefixLength > 32) {
    return false;
  }
  const candidateValue = ipv4ToUint32(candidate);
  const localValue = ipv4ToUint32(localAddress);
  if (candidateValue === null || localValue === null) {
    return false;
  }
  const mask = prefixLength === 0 ? 0 : (0xffffffff << (32 - prefixLength)) >>> 0;
  return (candidateValue & mask) === (localValue & mask);
}

function ipv4ToUint32(value: string): number | null {
  if (!isIpv4Address(value)) {
    return null;
  }
  const parts = value.split('.').map((entry) => Number.parseInt(entry, 10));
  if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }
  return ((((parts[0] << 24) >>> 0) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0);
}

async function closeDgramSocket(socket: dgram.Socket | null): Promise<void> {
  if (!socket) {
    return;
  }
  await new Promise<void>((resolve) => {
    socket.close(() => resolve());
  }).catch(() => undefined);
}

function jsonFrame(value: unknown): LanRpcFrame {
  return {
    header: {
      ok: true,
      kind: 'json',
      mime: 'application/json',
    },
    payload: new TextEncoder().encode(JSON.stringify(value)),
  };
}

function encodeLanRpcFrame(frame: LanRpcFrame): Uint8Array {
  const headerBytes = new TextEncoder().encode(JSON.stringify(frame.header));
  const buffer = new Uint8Array(4 + headerBytes.byteLength + frame.payload.byteLength);
  const view = new DataView(buffer.buffer);
  view.setUint32(0, headerBytes.byteLength);
  buffer.set(headerBytes, 4);
  buffer.set(frame.payload, 4 + headerBytes.byteLength);
  return buffer;
}

function decodeLanRpcFrame(bytes: Uint8Array): LanRpcFrame {
  if (bytes.byteLength < 4) {
    throw new Error('Invalid LAN QUIC frame');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerLength = view.getUint32(0);
  if (headerLength < 2 || 4 + headerLength > bytes.byteLength) {
    throw new Error('Invalid LAN QUIC frame header');
  }
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + headerLength))) as LanRpcFrameHeader;
  return {
    header,
    payload: bytes.subarray(4 + headerLength),
  };
}

async function readAllStream(stream: NodeReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value && value.byteLength > 0) {
        chunks.push(value);
        total += value.byteLength;
      }
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

async function readAllStreamWithTimeout(stream: NodeReadableStream<Uint8Array>, timeoutMs: number): Promise<Uint8Array> {
  return await Promise.race([
    readAllStream(stream),
    new Promise<Uint8Array>((_, reject) => {
      const timer = setTimeout(() => reject(abortError('LAN QUIC request timed out')), timeoutMs);
      if (typeof timer === 'object' && 'unref' in timer) {
        timer.unref();
      }
    }),
  ]);
}

async function writeAllStream(stream: NodeWritableStream<Uint8Array>, bytes: Uint8Array): Promise<void> {
  const writer = stream.getWriter();
  try {
    for (let offset = 0; offset < bytes.byteLength; offset += LAN_QUIC_WRITE_CHUNK_BYTES) {
      await writer.write(bytes.subarray(offset, Math.min(bytes.byteLength, offset + LAN_QUIC_WRITE_CHUNK_BYTES)));
    }
    await writer.close();
  } finally {
    writer.releaseLock();
  }
}

function abortError(message: string): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function asTypedEventTarget(value: unknown): EventTarget {
  return value as EventTarget;
}

function wrapLanQuicError(
  peer: LanTransportDiscoveredPeer,
  request: LanTransportRpcRequest,
  error: unknown
): Error {
  const detail = error instanceof Error ? error.message : String(error);
  const wrapped = new Error(
    `LAN QUIC ${request.action} failed for ${peer.label} (${peer.address}:${peer.port}): ${detail}`
  );
  wrapped.name = error instanceof Error ? error.name : 'Error';
  return wrapped;
}

function describeQuicErrorContext(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}
