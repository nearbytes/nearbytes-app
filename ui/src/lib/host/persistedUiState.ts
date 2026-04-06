import {
  getDesktopBridge,
  type NearbytesDesktopBridge,
  type PersistedUiState,
} from './desktopBridge.js';

function resolveBridge(bridge?: NearbytesDesktopBridge | null): NearbytesDesktopBridge | null {
  return bridge ?? getDesktopBridge();
}

export function normalizePersistedUiState(input: unknown): PersistedUiState {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {};
  }
  const candidate = input as PersistedUiState;
  return {
    volumeMounts: candidate.volumeMounts,
    sourceDiscovery: candidate.sourceDiscovery,
    theme: candidate.theme,
    savedAt: typeof candidate.savedAt === 'number' && Number.isFinite(candidate.savedAt) ? candidate.savedAt : 0,
  };
}

function persistedUiStateTimestamp(input: PersistedUiState | null | undefined): number {
  return typeof input?.savedAt === 'number' && Number.isFinite(input.savedAt) ? input.savedAt : 0;
}

function choosePreferredPersistedUiState(
  hostState: PersistedUiState | null | undefined,
  shadowState: PersistedUiState | null | undefined
): PersistedUiState {
  const normalizedHost = normalizePersistedUiState(hostState);
  const normalizedShadow = normalizePersistedUiState(shadowState);
  if (persistedUiStateTimestamp(normalizedShadow) > persistedUiStateTimestamp(normalizedHost)) {
    return normalizedShadow;
  }
  return normalizedHost;
}

function clonePersistedUiState(state: PersistedUiState): PersistedUiState {
  return JSON.parse(JSON.stringify(state)) as PersistedUiState;
}

export async function loadHostPersistedUiState(
  shadowState: PersistedUiState | null | undefined,
  bridge?: NearbytesDesktopBridge | null
): Promise<PersistedUiState> {
  const resolved = resolveBridge(bridge);
  if (!resolved || typeof resolved.loadUiState !== 'function') {
    return normalizePersistedUiState(shadowState);
  }
  const hostState = await resolved.loadUiState();
  return choosePreferredPersistedUiState(hostState, shadowState);
}

export async function saveHostPersistedUiState(
  state: PersistedUiState,
  bridge?: NearbytesDesktopBridge | null
): Promise<boolean> {
  const resolved = resolveBridge(bridge);
  if (!resolved || typeof resolved.saveUiState !== 'function') {
    return false;
  }
  await resolved.saveUiState(clonePersistedUiState(normalizePersistedUiState(state)));
  return true;
}