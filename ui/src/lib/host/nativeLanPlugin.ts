import { Capacitor, registerPlugin } from '@capacitor/core';

import type {
  LanPeerTransportSignalResponse,
  LanTransportSignalRequest,
} from '../../../../src/integrations/lanPeerTransport.js';

export interface NativeLanDiscoveredPeer {
  peerId: string;
  label: string;
  address: string;
  port: number;
  capabilities: string[];
  headObservationId: string | null;
  firstSeenAt: number;
  lastSeenAt: number;
}

interface NearbytesLanPlugin {
  listPeers(): Promise<{ peers: NativeLanDiscoveredPeer[] }>;
  postSignal(options: {
    address: string;
    port: number;
    request: LanTransportSignalRequest;
  }): Promise<LanPeerTransportSignalResponse>;
}

const nearbytesLanPlugin = registerPlugin<NearbytesLanPlugin>('NearbytesLan');

export function hasNativeLanPlugin(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('NearbytesLan');
}

export async function listNativeLanDiscoveredPeers(): Promise<NativeLanDiscoveredPeer[]> {
  if (!hasNativeLanPlugin()) {
    return [];
  }
  const response = await nearbytesLanPlugin.listPeers();
  return (response.peers ?? []).map((peer) => ({
    peerId: String(peer.peerId ?? '').trim(),
    label: String(peer.label ?? '').trim() || 'Nearbytes peer',
    address: String(peer.address ?? '').trim(),
    port: Number(peer.port ?? 0),
    capabilities: Array.isArray(peer.capabilities)
      ? peer.capabilities.map((capability) => String(capability).trim()).filter((capability) => capability.length > 0)
      : [],
    headObservationId: typeof peer.headObservationId === 'string' && peer.headObservationId.trim().length > 0
      ? peer.headObservationId.trim().toLowerCase()
      : null,
    firstSeenAt: Number(peer.firstSeenAt ?? Date.now()),
    lastSeenAt: Number(peer.lastSeenAt ?? Date.now()),
  })).filter((peer) => peer.peerId.length > 0 && peer.address.length > 0 && Number.isFinite(peer.port) && peer.port > 0);
}

export async function postNativeLanSignal(
  address: string,
  port: number,
  request: LanTransportSignalRequest
): Promise<LanPeerTransportSignalResponse> {
  if (!hasNativeLanPlugin()) {
    throw new Error('Native LAN signaling is unavailable on this runtime.');
  }
  return await nearbytesLanPlugin.postSignal({
    address,
    port,
    request,
  });
}