import {
  getDesktopBridge,
  type NearbytesDesktopBridge,
  type PersistedUiState,
} from './desktopBridge.js';
import { getPhonePersistenceBridge } from './phonePersistence.js';

type HostUiStateBridge = Pick<NearbytesDesktopBridge, 'loadUiState' | 'saveUiState'>;

function resolveBridge(bridge?: HostUiStateBridge | null): HostUiStateBridge | null {
  return bridge ?? getDesktopBridge() ?? getPhonePersistenceBridge();
}

export function normalizePersistedUiState(input: unknown): PersistedUiState {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {};
  }
  const candidate = input as PersistedUiState;
  return {
    volumeMounts: candidate.volumeMounts,
    activeMountId: candidate.activeMountId,
    configuredIdentities: candidate.configuredIdentities,
    activeChatIdentityId: candidate.activeChatIdentityId,
    volumeChatIdentityAssignments: candidate.volumeChatIdentityAssignments,
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
  bridge?: HostUiStateBridge | null
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
  bridge?: HostUiStateBridge | null
): Promise<boolean> {
  const resolved = resolveBridge(bridge);
  if (!resolved || typeof resolved.saveUiState !== 'function') {
    return false;
  }
  const normalizedState = normalizePersistedUiState(state);
  let mergedState = normalizedState;
  if (typeof resolved.loadUiState === 'function') {
    try {
      const explicitUpdates = Object.fromEntries(
        Object.entries(normalizedState).filter(([, value]) => value !== undefined)
      ) as PersistedUiState;
      mergedState = {
        ...normalizePersistedUiState(await resolved.loadUiState()),
        ...explicitUpdates,
      };
    } catch {
      mergedState = normalizedState;
    }
  }
  await resolved.saveUiState(clonePersistedUiState(mergedState));
  return true;
}
