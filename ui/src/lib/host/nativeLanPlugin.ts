import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

import type {
  LanPeerTransportSignalRequest,
  LanPeerTransportSignalResponse,
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
  getAutomationCommand(): Promise<{ value?: string | null }>;
  clearAutomationCommand(): Promise<void>;
  setAutomationResult(options: { value: string }): Promise<void>;
  postSignal(options: {
    address: string;
    port: number;
    request: LanPeerTransportSignalRequest;
  }): Promise<LanPeerTransportSignalResponse>;
  startRuntime(options: {
    peerId: string;
    label: string;
    txtRecord: Record<string, string>;
    announceIntervalMs: number;
  }): Promise<{
    listening: boolean;
    port: number | null;
    address?: string | null;
    announceIntervalMs: number;
    serviceType: string;
  }>;
  stopRuntime(): Promise<void>;
  completeSignalRequest(options: {
    requestId: string;
    response?: LanPeerTransportSignalResponse;
    error?: string;
  }): Promise<void>;
  addListener(
    eventName: 'incomingSignal',
    listenerFunc: (event: { requestId: string; request: LanPeerTransportSignalRequest }) => void
  ): Promise<PluginListenerHandle>;
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

export async function getNativeAutomationCommand(): Promise<string | null> {
  if (!hasNativeLanPlugin()) {
    return null;
  }
  const response = await nearbytesLanPlugin.getAutomationCommand();
  return typeof response.value === 'string' && response.value.trim().length > 0 ? response.value : null;
}

export async function clearNativeAutomationCommand(): Promise<void> {
  if (!hasNativeLanPlugin()) {
    return;
  }
  await nearbytesLanPlugin.clearAutomationCommand();
}

export async function setNativeAutomationResult(value: string): Promise<void> {
  if (!hasNativeLanPlugin()) {
    throw new Error('Native LAN runtime is unavailable on this runtime.');
  }
  await nearbytesLanPlugin.setAutomationResult({ value });
}

export async function postNativeLanSignal(
  address: string,
  port: number,
  request: LanPeerTransportSignalRequest
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

export async function startNativeLanRuntime(options: {
  peerId: string;
  label: string;
  txtRecord: Record<string, string>;
  announceIntervalMs: number;
}): Promise<{
  listening: boolean;
  port: number | null;
  address?: string | null;
  announceIntervalMs: number;
  serviceType: string;
}> {
  if (!hasNativeLanPlugin()) {
    throw new Error('Native LAN runtime is unavailable on this runtime.');
  }
  return await nearbytesLanPlugin.startRuntime(options);
}

export async function stopNativeLanRuntime(): Promise<void> {
  if (!hasNativeLanPlugin()) {
    return;
  }
  await nearbytesLanPlugin.stopRuntime();
}

export async function completeNativeLanSignalRequest(options: {
  requestId: string;
  response?: LanPeerTransportSignalResponse;
  error?: string;
}): Promise<void> {
  if (!hasNativeLanPlugin()) {
    throw new Error('Native LAN runtime is unavailable on this runtime.');
  }
  await nearbytesLanPlugin.completeSignalRequest(options);
}

export async function addNativeLanIncomingSignalListener(
  listener: (event: { requestId: string; request: LanPeerTransportSignalRequest }) => void
): Promise<PluginListenerHandle> {
  if (!hasNativeLanPlugin()) {
    throw new Error('Native LAN runtime is unavailable on this runtime.');
  }
  return await nearbytesLanPlugin.addListener('incomingSignal', listener);
}