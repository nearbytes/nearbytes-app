import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
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
  LAN_QUIC_ALPN,
  LAN_TRANSPORT_CAPABILITIES,
  buildLanDiscoveryTxtRecord,
  parseLanDiscoveryTxtRecord,
} from './lanTransportProfile.js';
import type {
  LanPeerTransport,
  LanPeerTransportCallbacks,
  LanTransportDiscoveredPeer,
  LanTransportRpcRequest,
} from './lanPeerTransport.js';

const LAN_QUIC_CERT_FILE = 'quic-cert.pem';
const LAN_QUIC_KEY_FILE = 'quic-key.pem';
const LAN_QUIC_SIGNING_KEY_FILE = 'quic-signing-key.bin';
const LAN_QUIC_APPLICATION_PROTOCOLS = [LAN_QUIC_ALPN];
const LAN_QUIC_REQUEST_TIMEOUT_MS = 30_000;

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

export class QuicDnsSdLanTransport implements LanPeerTransport {
  private callbacks: LanPeerTransportCallbacks | null = null;
  private bonjour: Bonjour | null = null;
  private browser: Browser | null = null;
  private publishedService: Service | null = null;
  private socket: QUICSocket | null = null;
  private server: QUICServer | null = null;
  private clients = new Map<string, QUICClient>();
  private discoveryByFqdn = new Map<string, LanTransportDiscoveredPeer>();
  private advertisementTimer: ReturnType<typeof setInterval> | null = null;

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
        return;
      }
      this.discoveryByFqdn.delete(service.fqdn);
      this.callbacks?.onPeerExpired?.(peer.peerId);
    });
    this.browser.on('txt-update', (service) => {
      this.handleDiscoveryService(service);
    });

    await this.refreshAdvertisement();
    this.advertisementTimer = setInterval(() => {
      void this.refreshAdvertisement();
    }, 10_000);
  }

  async stop(): Promise<void> {
    if (this.advertisementTimer) {
      clearInterval(this.advertisementTimer);
      this.advertisementTimer = null;
    }
    this.browser?.stop();
    this.browser = null;
    if (this.publishedService && typeof this.publishedService.stop === 'function') {
      this.publishedService.stop();
    }
    this.publishedService = null;
    this.bonjour?.destroy();
    this.bonjour = null;
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
  }

  async refreshAdvertisement(): Promise<void> {
    if (!this.callbacks || !this.bonjour) {
      return;
    }
    const hello = await this.callbacks.getAdvertisement();
    const txt = buildLanDiscoveryTxtRecord({
      peerId: hello.peerId,
      headSequence: hello.observationHeadSequence,
      capabilities: hello.capabilities.length > 0 ? hello.capabilities : LAN_TRANSPORT_CAPABILITIES,
    });
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
    if (!parsed || !this.callbacks || parsed.peerId === undefined) {
      return;
    }
    const helloPeerId = parsed.peerId;
    this.callbacks.getAdvertisement().then((selfHello) => {
      if (helloPeerId === selfHello.peerId) {
        return;
      }
      const address = choosePeerAddress(service.addresses ?? []);
      if (!address) {
        return;
      }
      const peer: LanTransportDiscoveredPeer = {
        peerId: helloPeerId,
        label: service.name || `Peer ${helloPeerId.slice(0, 8)}`,
        address,
        port: service.port,
        capabilities: parsed.capabilities,
        headSequence: parsed.headSequence,
      };
      this.discoveryByFqdn.set(service.fqdn, peer);
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
    const client = await this.getOrCreateClient(peer);
    const stream = client.connection.newStream();
    await writeAllStream(stream.writable, encodeLanRpcFrame(jsonFrame(request)));
    return decodeLanRpcFrame(await readAllStreamWithTimeout(stream.readable, LAN_QUIC_REQUEST_TIMEOUT_MS));
  }

  private async getOrCreateClient(peer: LanTransportDiscoveredPeer): Promise<QUICClient> {
    const key = `${peer.peerId}@${peer.address}:${peer.port}`;
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

function choosePeerAddress(addresses: readonly string[]): string | null {
  const normalized = addresses
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '' && entry !== '127.0.0.1' && entry !== '::1');
  const preferred = normalized.find((entry) => !entry.includes(':')) ?? normalized[0];
  return preferred ?? null;
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
    await writer.write(bytes);
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
