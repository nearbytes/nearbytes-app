export const LAN_DISCOVERY_SERVICE_TYPE = 'nearbytes';
export const LAN_DISCOVERY_SERVICE_PROTOCOL = 'udp' as const;
export const LAN_DISCOVERY_PROTOCOL_VERSION = '0.3';
export const LAN_QUIC_ALPN = 'nearbytes-lan/0.3';
export const LAN_TXT_MAX_RECOMMENDED_BYTES = 200;
export const LAN_TRANSPORT_CAPABILITIES = ['quic', 'observation-log', 'inventory-recovery', 'push-hint'] as const;

export interface LanDiscoveryTxtRecord {
  readonly pv: typeof LAN_DISCOVERY_PROTOCOL_VERSION;
  readonly peer: string;
  readonly alpn: typeof LAN_QUIC_ALPN;
  readonly caps: string;
  readonly head?: string;
}

export interface LanDiscoveryRecordInput {
  readonly peerId: string;
  readonly headSequence?: number;
  readonly capabilities?: readonly string[];
}

export interface ParsedLanDiscoveryTxtRecord {
  readonly protocolVersion: string;
  readonly peerId: string;
  readonly alpn: string;
  readonly capabilities: string[];
  readonly headSequence: number;
}

export function buildLanDiscoveryTxtRecord(input: LanDiscoveryRecordInput): LanDiscoveryTxtRecord {
  const capabilities = canonicalizeCapabilities(input.capabilities);
  return {
    pv: LAN_DISCOVERY_PROTOCOL_VERSION,
    peer: input.peerId.trim(),
    alpn: LAN_QUIC_ALPN,
    caps: capabilities.join(','),
    ...(typeof input.headSequence === 'number' && Number.isFinite(input.headSequence) && input.headSequence >= 0
      ? { head: String(Math.trunc(input.headSequence)) }
      : {}),
  };
}

export function parseLanDiscoveryTxtRecord(value: Record<string, unknown>): ParsedLanDiscoveryTxtRecord | null {
  const protocolVersion = typeof value.pv === 'string' ? value.pv.trim() : '';
  const peerId = typeof value.peer === 'string' ? value.peer.trim() : '';
  const alpn = typeof value.alpn === 'string' ? value.alpn.trim() : '';
  const rawCapabilities = typeof value.caps === 'string' ? value.caps.trim() : '';
  const headSequence = parseHeadSequence(value.head);

  if (protocolVersion === '' || peerId === '' || alpn === '') {
    return null;
  }

  return {
    protocolVersion,
    peerId,
    alpn,
    capabilities: canonicalizeCapabilities(rawCapabilities.split(',')),
    headSequence,
  };
}

export function estimateLanTxtRecordBytes(record: Record<string, string | undefined>): number {
  return Object.entries(record).reduce((total, [key, rawValue]) => {
    const value = rawValue?.trim();
    if (!value) {
      return total;
    }
    return total + key.length + 1 + value.length + 1;
  }, 0);
}

function canonicalizeCapabilities(values: readonly string[] | undefined): string[] {
  const normalized = values
    ? values.map((value) => value.trim()).filter((value) => value !== '')
    : [...LAN_TRANSPORT_CAPABILITIES];
  return Array.from(new Set(normalized)).sort((left, right) => left.localeCompare(right));
}

function parseHeadSequence(value: unknown): number {
  if (typeof value !== 'string') {
    return 0;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
}
