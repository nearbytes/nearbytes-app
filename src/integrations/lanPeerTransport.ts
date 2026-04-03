export interface LanTransportDiscoveredPeer {
  readonly peerId: string;
  readonly label: string;
  readonly address: string;
  readonly port: number;
  readonly capabilities: string[];
  readonly headObservationId: string | null;
}

export interface LanTransportHello {
  readonly protocol: string;
  readonly peerId: string;
  readonly label: string;
  readonly port: number;
  readonly capabilities: string[];
  readonly volumeIds: string[];
  readonly observationHeadId: string | null;
  readonly generatedAt: number;
}

export interface LanTransportVolumeList {
  readonly protocol: string;
  readonly peerId: string;
  readonly volumeIds: string[];
  readonly generatedAt: number;
}

export interface LanTransportObservationPage<TObservation> {
  readonly protocol: string;
  readonly peerId: string;
  readonly observations: TObservation[];
  readonly headObservationId: string | null;
  readonly generatedAt: number;
}

export interface LanTransportVolumeInventory {
  readonly volumeId: string;
  readonly generatedAt: number;
  readonly eventHashes: string[];
  readonly blockHashes: string[];
}

export type LanTransportRpcRequest =
  | {
      readonly action: 'hello';
    }
  | {
      readonly action: 'volumes';
    }
  | {
      readonly action: 'observations';
      readonly afterObservationId?: string | null;
      readonly volumeIds?: readonly string[];
      readonly limit?: number;
    }
  | {
      readonly action: 'inventory';
      readonly volumeId: string;
    }
  | {
      readonly action: 'event';
      readonly volumeId: string;
      readonly eventHash: string;
    }
  | {
      readonly action: 'block';
      readonly blockHash: string;
    }
  | {
      readonly action: 'sync-hint';
      readonly reason?: string;
    };

export interface LanPeerTransportCallbacks {
  readonly getAdvertisement: () => Promise<LanTransportHello>;
  readonly onPeerDiscovered: (peer: LanTransportDiscoveredPeer) => void;
  readonly onPeerExpired?: (peerId: string) => void;
  readonly handleRequest: (request: LanTransportRpcRequest) => Promise<LanPeerTransportResponse>;
}

export interface LanPeerTransportDebugState {
  readonly transport: string;
  readonly listening: boolean;
  readonly publishedAdvertisement?: {
    readonly peerId: string;
    readonly label: string;
    readonly port: number;
    readonly observationHeadId: string | null;
    readonly capabilities: string[];
  } | null;
  readonly discoveredPeers: Array<{
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
  }>;
}

export type LanPeerTransportResponse =
  | {
      readonly kind: 'json';
      readonly value: unknown;
    }
  | {
      readonly kind: 'bytes';
      readonly value: Uint8Array;
    };

export interface LanPeerTransport {
  start(callbacks: LanPeerTransportCallbacks): Promise<void>;
  stop(): Promise<void>;
  refreshAdvertisement?(): Promise<void>;
  getDebugState?(): LanPeerTransportDebugState;
  requestJson<TResponse>(peer: LanTransportDiscoveredPeer, request: LanTransportRpcRequest): Promise<TResponse>;
  requestBytes(peer: LanTransportDiscoveredPeer, request: LanTransportRpcRequest): Promise<Uint8Array>;
  notify(peer: LanTransportDiscoveredPeer, request: Extract<LanTransportRpcRequest, { action: 'sync-hint' }>): Promise<void>;
}
