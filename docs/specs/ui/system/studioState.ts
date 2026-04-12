import { derived, get, writable, type Readable } from 'svelte/store';
import {
  createUiTransitionStore,
  normalizeUiTransitionState,
  type UiTransitionState,
  type UiTransitionStore,
} from './uiTransitionStore.js';
import type { FileManagerViewMode, WorkspaceMode, WorkspaceSortBy } from './workspaceChrome.js';
import { applyDesignMoodboardVariables, findDesignMoodboard } from './tokens.js';

export type StudioRadiusMode = 'crisp' | 'soft' | 'round';
export type StudioDensity = 'compact' | 'relaxed';
export type StudioViewport = 'desktop' | 'phone';
export type StudioStorageMode = 'global' | 'volume';
export type StudioSecondary = 'none' | 'locations' | 'flow' | 'identities';
export type StudioDialogSurface = 'none' | 'share' | 'join' | 'create' | 'identity' | 'reset';
export type StudioSortValue = 'newest' | 'name' | 'protected';

export type StudioDesignState = {
  moodboardId: string;
  accentStrength: number;
  radiusMode: StudioRadiusMode;
  density: StudioDensity;
  viewport: StudioViewport;
  hubId: string;
  workspace: WorkspaceMode;
  storageMode: StudioStorageMode;
  uiMachine: UiTransitionState;
};

export type StudioUiState = StudioDesignState & {
  secondary: StudioSecondary;
  dialogSurface: StudioDialogSurface;
  searchOpen: boolean;
  timelineOpen: boolean;
  phoneMenuOpen: boolean;
  viewMode: FileManagerViewMode;
  stylesSearchText: string;
  stylesSortValue: StudioSortValue;
  stylesSortOpen: boolean;
  sortBy: WorkspaceSortBy;
};

export type StudioPatch = Partial<Omit<StudioUiState, 'uiMachine'>> & {
  uiMachine?: unknown;
};

export type StudioStateController = Readable<StudioUiState> & {
  uiStore: UiTransitionStore;
  load: () => void;
  save: () => void;
  patch: (patch: StudioPatch) => void;
  replace: (value: unknown) => void;
  snapshot: () => StudioUiState;
};

export const STUDIO_STATE_STORAGE_KEY = 'nearbytes-ui-studio-v2';

function normalizeRadiusMode(value: unknown, fallback: StudioRadiusMode): StudioRadiusMode {
  return value === 'crisp' || value === 'soft' || value === 'round' ? value : fallback;
}

function normalizeDensity(value: unknown, fallback: StudioDensity): StudioDensity {
  return value === 'compact' || value === 'relaxed' ? value : fallback;
}

function normalizeViewport(value: unknown, fallback: StudioViewport): StudioViewport {
  return value === 'desktop' || value === 'phone' ? value : fallback;
}

function normalizeStorageMode(value: unknown, fallback: StudioStorageMode): StudioStorageMode {
  return value === 'global' || value === 'volume' ? value : fallback;
}

function normalizeWorkspaceMode(value: unknown, fallback: WorkspaceMode): WorkspaceMode {
  return value === 'files' || value === 'chat' || value === 'split' ? value : fallback;
}

function normalizeSortValue(value: unknown, fallback: StudioSortValue): StudioSortValue {
  return value === 'newest' || value === 'name' || value === 'protected' ? value : fallback;
}

function normalizeAccentStrength(value: unknown, fallback: number): number {
  const next = Number(value);
  if (!Number.isFinite(next)) {
    return fallback;
  }
  return Math.max(70, Math.min(130, Math.round(next)));
}

function activeModalFromMachine(state: UiTransitionState): StudioDialogSurface {
  if (state.showVolumeShareDialog) return 'share';
  if (state.showJoinVolumeDialog) return 'join';
  if (state.showCreateChooser) return 'create';
  if (state.showIdentityManager) return 'identity';
  if (state.showResetDialog) return 'reset';
  return 'none';
}

function secondaryFromMachine(state: UiTransitionState): StudioSecondary {
  if (state.showIdentityManager) return 'identities';
  if (state.showSourcesPanel || state.showVolumeStoragePanel) return 'locations';
  if (state.showEventFlowPanel) return 'flow';
  return 'none';
}

function styleSortValueFromMachine(sortBy: WorkspaceSortBy): StudioSortValue {
  if (sortBy === 'name' || sortBy === 'name-desc') return 'name';
  if (sortBy === 'size' || sortBy === 'size-asc') return 'protected';
  return 'newest';
}

function machineStateFromSnapshot(snapshot: StudioUiState): UiTransitionState {
  return normalizeUiTransitionState({
    showThemeDialog: snapshot.uiMachine.showThemeDialog,
    themeDialogSection: snapshot.uiMachine.themeDialogSection,
    showPreviewPane: snapshot.uiMachine.showPreviewPane,
    showResetDialog: snapshot.dialogSurface === 'reset',
    showTimeMachinePanel: snapshot.timelineOpen === true,
    showTimelineDetailDialog: snapshot.uiMachine.showTimelineDetailDialog,
    showSourcesPanel: snapshot.secondary === 'locations' && snapshot.storageMode === 'global',
    showVolumeStoragePanel: snapshot.secondary === 'locations' && snapshot.storageMode === 'volume',
    showMountStorageDialog: snapshot.uiMachine.showMountStorageDialog,
    showEventFlowPanel: snapshot.secondary === 'flow',
    showPhoneOverflowMenu: snapshot.phoneMenuOpen === true,
    showIdentityManager: snapshot.secondary === 'identities' || snapshot.dialogSurface === 'identity',
    showCreateChooser: snapshot.dialogSurface === 'create',
    fileManagerViewMode: snapshot.viewMode,
    searchQuery: snapshot.searchOpen ? snapshot.stylesSearchText : '',
    sortBy:
      snapshot.sortBy ??
      (snapshot.stylesSortValue === 'name'
        ? 'name'
        : snapshot.stylesSortValue === 'protected'
          ? 'size'
          : 'newest'),
    showSpecDialog: snapshot.uiMachine.showSpecDialog,
    showJoinVolumeDialog: snapshot.dialogSurface === 'join',
    showVolumeShareDialog: snapshot.dialogSurface === 'share',
  });
}

export function normalizeStudioDesignState(input: unknown, fallback: StudioDesignState): StudioDesignState {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {
      ...fallback,
      uiMachine: normalizeUiTransitionState(fallback.uiMachine),
    };
  }

  const candidate = input as Partial<StudioDesignState>;
  return {
    moodboardId: typeof candidate.moodboardId === 'string' ? candidate.moodboardId : fallback.moodboardId,
    accentStrength: normalizeAccentStrength(candidate.accentStrength, fallback.accentStrength),
    radiusMode: normalizeRadiusMode(candidate.radiusMode, fallback.radiusMode),
    density: normalizeDensity(candidate.density, fallback.density),
    viewport: normalizeViewport(candidate.viewport, fallback.viewport),
    hubId: typeof candidate.hubId === 'string' ? candidate.hubId : fallback.hubId,
    workspace: normalizeWorkspaceMode(candidate.workspace, fallback.workspace),
    storageMode: normalizeStorageMode(candidate.storageMode, fallback.storageMode),
    uiMachine: normalizeUiTransitionState(candidate.uiMachine ?? fallback.uiMachine),
  };
}

export function createStudioUiState(state: StudioDesignState): StudioUiState {
  const uiMachine = normalizeUiTransitionState(state.uiMachine);
  return {
    ...state,
    uiMachine,
    secondary: secondaryFromMachine(uiMachine),
    dialogSurface: activeModalFromMachine(uiMachine),
    searchOpen: uiMachine.searchQuery.trim() !== '',
    timelineOpen: uiMachine.showTimeMachinePanel,
    phoneMenuOpen: uiMachine.showPhoneOverflowMenu,
    viewMode: uiMachine.fileManagerViewMode,
    stylesSearchText: uiMachine.searchQuery,
    stylesSortValue: styleSortValueFromMachine(uiMachine.sortBy),
    stylesSortOpen: false,
    sortBy: uiMachine.sortBy,
  };
}

function stateFromPatch(baseState: StudioDesignState, patch: StudioPatch): StudioDesignState {
  const baseUi = createStudioUiState(baseState);
  const baseMachine = patch.uiMachine
    ? normalizeUiTransitionState(patch.uiMachine)
    : baseUi.uiMachine;

  const mergedUi: StudioUiState = {
    ...baseUi,
    ...createStudioUiState({ ...baseState, uiMachine: baseMachine }),
    ...patch,
    uiMachine: baseMachine,
  };

  return normalizeStudioDesignState(
    {
      moodboardId: mergedUi.moodboardId,
      accentStrength: mergedUi.accentStrength,
      radiusMode: mergedUi.radiusMode,
      density: mergedUi.density,
      viewport: mergedUi.viewport,
      hubId: mergedUi.hubId,
      workspace: mergedUi.workspace,
      storageMode: mergedUi.storageMode,
      uiMachine: machineStateFromSnapshot({
        ...mergedUi,
        stylesSortValue: normalizeSortValue(mergedUi.stylesSortValue, baseUi.stylesSortValue),
      }),
    },
    baseState
  );
}

export function applyStudioStateTokens(
  root: CSSStyleDeclaration,
  state: Pick<StudioUiState, 'moodboardId' | 'accentStrength' | 'radiusMode'>
): void {
  const moodboard = findDesignMoodboard(state.moodboardId);
  const strength = Math.max(70, Math.min(130, Number(state.accentStrength) || 100));
  const radiusFactor = state.radiusMode === 'crisp' ? 0.84 : state.radiusMode === 'round' ? 1.14 : 1;

  applyDesignMoodboardVariables(root, moodboard);

  root.setProperty('--bg', moodboard.palette.bg);
  root.setProperty('--paper', moodboard.palette.paper);
  root.setProperty('--panel', moodboard.palette.panel);
  root.setProperty('--ink', moodboard.palette.ink);
  root.setProperty('--muted', moodboard.palette.muted);
  root.setProperty('--line', moodboard.palette.line);
  root.setProperty('--accent', moodboard.palette.accent);
  root.setProperty('--accent-strong', moodboard.palette.accentStrong);
  root.setProperty('--accent-soft', moodboard.palette.accentSoft);
  root.setProperty('--glow', moodboard.palette.glow);
  root.setProperty('--font-display', moodboard.typography.display);
  root.setProperty('--font-body', moodboard.typography.body);
  root.setProperty('--font-mono', moodboard.typography.mono);
  root.setProperty('--radius-xl', scalePx(moodboard.chrome.radiusXl, radiusFactor));
  root.setProperty('--radius-lg', scalePx(moodboard.chrome.radiusLg, radiusFactor));
  root.setProperty('--radius-md', scalePx(moodboard.chrome.radiusMd, radiusFactor));
  root.setProperty(
    '--shadow-lg',
    moodboard.chrome.shadowLg.replace(/0\.12|0\.10|0\.08/g, (alpha) =>
      (Math.max(0.06, Number(alpha) * (strength / 100))).toFixed(3)
    )
  );
  root.setProperty('--shadow-md', moodboard.chrome.shadowMd);
  root.setProperty('--panel-blur', moodboard.chrome.blur);
}

function scalePx(value: string, factor: number): string {
  const match = /(-?\d+(?:\.\d+)?)px/.exec(String(value || ''));
  if (!match) return value;
  return `${(Number(match[1]) * factor).toFixed(2).replace(/\.00$/, '')}px`;
}

export function createStudioStateController(initialState: StudioDesignState): StudioStateController {
  const normalizedInitial = normalizeStudioDesignState(initialState, initialState);
  const foundations = writable<Omit<StudioDesignState, 'uiMachine'>>({
    moodboardId: normalizedInitial.moodboardId,
    accentStrength: normalizedInitial.accentStrength,
    radiusMode: normalizedInitial.radiusMode,
    density: normalizedInitial.density,
    viewport: normalizedInitial.viewport,
    hubId: normalizedInitial.hubId,
    workspace: normalizedInitial.workspace,
    storageMode: normalizedInitial.storageMode,
  });
  const uiStore = createUiTransitionStore(normalizedInitial.uiMachine);
  const combined = derived([foundations, { subscribe: uiStore.subscribe }], ([base, uiMachine]) =>
    createStudioUiState({ ...base, uiMachine })
  );

  function replace(value: unknown): void {
    const next = normalizeStudioDesignState(value, normalizedInitial);
    foundations.set({
      moodboardId: next.moodboardId,
      accentStrength: next.accentStrength,
      radiusMode: next.radiusMode,
      density: next.density,
      viewport: next.viewport,
      hubId: next.hubId,
      workspace: next.workspace,
      storageMode: next.storageMode,
    });
    uiStore.replaceState(next.uiMachine);
  }

  function patch(patchValue: StudioPatch): void {
    const current = {
      ...get(foundations),
      uiMachine: get(uiStore),
    };
    replace(stateFromPatch(current, patchValue));
  }

  function snapshot(): StudioUiState {
    return createStudioUiState({
      ...get(foundations),
      uiMachine: get(uiStore),
    });
  }

  function load(): void {
    if (typeof localStorage === 'undefined') {
      return;
    }
    try {
      const raw = localStorage.getItem(STUDIO_STATE_STORAGE_KEY);
      if (!raw) {
        replace(normalizedInitial);
        return;
      }
      replace(JSON.parse(raw));
    } catch {
      replace(normalizedInitial);
    }
  }

  function save(): void {
    if (typeof localStorage === 'undefined') {
      return;
    }
    const current = snapshot();
    localStorage.setItem(
      STUDIO_STATE_STORAGE_KEY,
      JSON.stringify({
        moodboardId: current.moodboardId,
        accentStrength: current.accentStrength,
        radiusMode: current.radiusMode,
        density: current.density,
        viewport: current.viewport,
        hubId: current.hubId,
        workspace: current.workspace,
        storageMode: current.storageMode,
        uiMachine: current.uiMachine,
      } satisfies StudioDesignState)
    );
  }

  return {
    subscribe: combined.subscribe,
    uiStore,
    load,
    save,
    patch,
    replace,
    snapshot,
  };
}
