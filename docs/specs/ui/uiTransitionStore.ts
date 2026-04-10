import { writable, type Readable } from 'svelte/store';
import type { FileManagerViewMode, WorkspaceSortBy } from './workspaceChrome.js';

export type UiThemeDialogSection = 'preset' | 'material' | 'accent' | 'logo';

export type UiTransitionState = {
  showThemeDialog: boolean;
  themeDialogSection: UiThemeDialogSection;
  showPreviewPane: boolean;
  showResetDialog: boolean;
  showTimeMachinePanel: boolean;
  showTimelineDetailDialog: boolean;
  showSourcesPanel: boolean;
  showVolumeStoragePanel: boolean;
  showMountStorageDialog: boolean;
  showEventFlowPanel: boolean;
  showPhoneOverflowMenu: boolean;
  showIdentityManager: boolean;
  showCreateChooser: boolean;
  fileManagerViewMode: FileManagerViewMode;
  searchQuery: string;
  sortBy: WorkspaceSortBy;
  showSpecDialog: boolean;
  showJoinVolumeDialog: boolean;
  showVolumeShareDialog: boolean;
};

export type UiTransitionGraphState = {
  id: string;
  title: string;
  note: string;
  assignment: UiTransitionState;
};

export type UiTransitionInvocation =
  | { name: 'openThemeDialog'; args: [UiThemeDialogSection] }
  | { name: 'closeThemeDialog'; args: [] }
  | { name: 'setThemeDialogSection'; args: [UiThemeDialogSection] }
  | { name: 'openPreviewPane'; args: [] }
  | { name: 'closePreviewPane'; args: [] }
  | { name: 'openResetDialog'; args: [] }
  | { name: 'closeResetDialog'; args: [] }
  | { name: 'toggleTimeMachinePanel'; args: [] }
  | { name: 'closeTimeMachinePanel'; args: [] }
  | { name: 'openTimelineDetailDialog'; args: [] }
  | { name: 'closeTimelineDetailDialog'; args: [] }
  | { name: 'toggleSourcesPanel'; args: [] }
  | { name: 'openSourcesPanel'; args: [] }
  | { name: 'closeSourcesPanel'; args: [] }
  | { name: 'toggleVolumeStoragePanel'; args: [] }
  | { name: 'openVolumeStoragePanel'; args: [] }
  | { name: 'closeVolumeStoragePanel'; args: [] }
  | { name: 'openMountStorageDialog'; args: [] }
  | { name: 'closeMountStorageDialog'; args: [] }
  | { name: 'toggleEventFlowPanel'; args: [] }
  | { name: 'closeEventFlowPanel'; args: [] }
  | { name: 'togglePhoneOverflowMenu'; args: [] }
  | { name: 'closePhoneOverflowMenu'; args: [] }
  | { name: 'openIdentityManager'; args: [] }
  | { name: 'closeIdentityManager'; args: [] }
  | { name: 'openCreateChooser'; args: [] }
  | { name: 'closeCreateChooser'; args: [] }
  | { name: 'setFileManagerViewMode'; args: [FileManagerViewMode] }
  | { name: 'setSearchQuery'; args: [string] }
  | { name: 'clearSearchQuery'; args: [] }
  | { name: 'setSortBy'; args: [WorkspaceSortBy] }
  | { name: 'openSpecDialog'; args: [] }
  | { name: 'closeSpecDialog'; args: [] }
  | { name: 'openJoinVolumeDialog'; args: [] }
  | { name: 'closeJoinVolumeDialog'; args: [] }
  | { name: 'openVolumeShareDialog'; args: [] }
  | { name: 'closeVolumeShareDialog'; args: [] };

export type UiTransitionGraphEdge = {
  id: string;
  from: string;
  to: string;
  invocation: UiTransitionInvocation;
  label: string;
};

export const UI_TRANSITION_DEFAULT_STATE: UiTransitionState = {
  showThemeDialog: false,
  themeDialogSection: 'preset',
  showPreviewPane: false,
  showResetDialog: false,
  showTimeMachinePanel: false,
  showTimelineDetailDialog: false,
  showSourcesPanel: false,
  showVolumeStoragePanel: false,
  showMountStorageDialog: false,
  showEventFlowPanel: false,
  showPhoneOverflowMenu: false,
  showIdentityManager: false,
  showCreateChooser: false,
  fileManagerViewMode: 'icons',
  searchQuery: '',
  sortBy: 'newest',
  showSpecDialog: false,
  showJoinVolumeDialog: false,
  showVolumeShareDialog: false,
};

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeEnum<T extends string>(value: unknown, fallback: T, allowed: readonly T[]): T {
  return typeof value === 'string' && allowed.includes(value as T) ? (value as T) : fallback;
}

function cloneState(state: UiTransitionState): UiTransitionState {
  return {
    ...state,
    searchQuery: state.searchQuery,
  };
}

export function normalizeUiTransitionState(input: unknown): UiTransitionState {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return cloneState(UI_TRANSITION_DEFAULT_STATE);
  }
  const candidate = input as Partial<UiTransitionState>;
  return {
    showThemeDialog: normalizeBoolean(candidate.showThemeDialog, UI_TRANSITION_DEFAULT_STATE.showThemeDialog),
    themeDialogSection: normalizeEnum(
      candidate.themeDialogSection,
      UI_TRANSITION_DEFAULT_STATE.themeDialogSection,
      ['preset', 'material', 'accent', 'logo'] as const
    ),
    showPreviewPane: normalizeBoolean(candidate.showPreviewPane, UI_TRANSITION_DEFAULT_STATE.showPreviewPane),
    showResetDialog: normalizeBoolean(candidate.showResetDialog, UI_TRANSITION_DEFAULT_STATE.showResetDialog),
    showTimeMachinePanel: normalizeBoolean(
      candidate.showTimeMachinePanel,
      UI_TRANSITION_DEFAULT_STATE.showTimeMachinePanel
    ),
    showTimelineDetailDialog: normalizeBoolean(
      candidate.showTimelineDetailDialog,
      UI_TRANSITION_DEFAULT_STATE.showTimelineDetailDialog
    ),
    showSourcesPanel: normalizeBoolean(candidate.showSourcesPanel, UI_TRANSITION_DEFAULT_STATE.showSourcesPanel),
    showVolumeStoragePanel: normalizeBoolean(
      candidate.showVolumeStoragePanel,
      UI_TRANSITION_DEFAULT_STATE.showVolumeStoragePanel
    ),
    showMountStorageDialog: normalizeBoolean(
      candidate.showMountStorageDialog,
      UI_TRANSITION_DEFAULT_STATE.showMountStorageDialog
    ),
    showEventFlowPanel: normalizeBoolean(
      candidate.showEventFlowPanel,
      UI_TRANSITION_DEFAULT_STATE.showEventFlowPanel
    ),
    showPhoneOverflowMenu: normalizeBoolean(
      candidate.showPhoneOverflowMenu,
      UI_TRANSITION_DEFAULT_STATE.showPhoneOverflowMenu
    ),
    showIdentityManager: normalizeBoolean(
      candidate.showIdentityManager,
      UI_TRANSITION_DEFAULT_STATE.showIdentityManager
    ),
    showCreateChooser: normalizeBoolean(candidate.showCreateChooser, UI_TRANSITION_DEFAULT_STATE.showCreateChooser),
    fileManagerViewMode: normalizeEnum(
      candidate.fileManagerViewMode,
      UI_TRANSITION_DEFAULT_STATE.fileManagerViewMode,
      ['icons', 'details'] as const
    ),
    searchQuery: typeof candidate.searchQuery === 'string' ? candidate.searchQuery : UI_TRANSITION_DEFAULT_STATE.searchQuery,
    sortBy: normalizeEnum(
      candidate.sortBy,
      UI_TRANSITION_DEFAULT_STATE.sortBy,
      ['newest', 'oldest', 'name', 'name-desc', 'size', 'size-asc'] as const
    ),
    showSpecDialog: normalizeBoolean(candidate.showSpecDialog, UI_TRANSITION_DEFAULT_STATE.showSpecDialog),
    showJoinVolumeDialog: normalizeBoolean(
      candidate.showJoinVolumeDialog,
      UI_TRANSITION_DEFAULT_STATE.showJoinVolumeDialog
    ),
    showVolumeShareDialog: normalizeBoolean(
      candidate.showVolumeShareDialog,
      UI_TRANSITION_DEFAULT_STATE.showVolumeShareDialog
    ),
  };
}

function withPatch(state: UiTransitionState, patch: Partial<UiTransitionState>): UiTransitionState {
  return normalizeUiTransitionState({
    ...state,
    ...patch,
  });
}

export function applyUiTransitionInvocation(
  input: UiTransitionState,
  invocation: UiTransitionInvocation
): UiTransitionState {
  const state = normalizeUiTransitionState(input);
  switch (invocation.name) {
    case 'openThemeDialog':
      return withPatch(state, {
        showThemeDialog: true,
        themeDialogSection: invocation.args[0],
      });
    case 'closeThemeDialog':
      return withPatch(state, { showThemeDialog: false });
    case 'setThemeDialogSection':
      return withPatch(state, { themeDialogSection: invocation.args[0], showThemeDialog: true });
    case 'openPreviewPane':
      return withPatch(state, { showPreviewPane: true });
    case 'closePreviewPane':
      return withPatch(state, { showPreviewPane: false });
    case 'openResetDialog':
      return withPatch(state, { showResetDialog: true });
    case 'closeResetDialog':
      return withPatch(state, { showResetDialog: false });
    case 'toggleTimeMachinePanel':
      return withPatch(state, { showTimeMachinePanel: !state.showTimeMachinePanel });
    case 'closeTimeMachinePanel':
      return withPatch(state, { showTimeMachinePanel: false });
    case 'openTimelineDetailDialog':
      return withPatch(state, { showTimelineDetailDialog: true });
    case 'closeTimelineDetailDialog':
      return withPatch(state, { showTimelineDetailDialog: false });
    case 'toggleSourcesPanel': {
      const nextValue = !state.showSourcesPanel;
      return withPatch(state, {
        showSourcesPanel: nextValue,
        showVolumeStoragePanel: nextValue ? false : state.showVolumeStoragePanel,
        showEventFlowPanel: nextValue ? false : state.showEventFlowPanel,
      });
    }
    case 'openSourcesPanel':
      return withPatch(state, {
        showSourcesPanel: true,
        showVolumeStoragePanel: false,
      });
    case 'closeSourcesPanel':
      return withPatch(state, { showSourcesPanel: false });
    case 'toggleVolumeStoragePanel': {
      const nextValue = !state.showVolumeStoragePanel;
      return withPatch(state, {
        showVolumeStoragePanel: nextValue,
        showSourcesPanel: nextValue ? false : state.showSourcesPanel,
        showEventFlowPanel: nextValue ? false : state.showEventFlowPanel,
      });
    }
    case 'openVolumeStoragePanel':
      return withPatch(state, {
        showVolumeStoragePanel: true,
        showSourcesPanel: false,
      });
    case 'closeVolumeStoragePanel':
      return withPatch(state, { showVolumeStoragePanel: false });
    case 'openMountStorageDialog':
      return withPatch(state, { showMountStorageDialog: true });
    case 'closeMountStorageDialog':
      return withPatch(state, { showMountStorageDialog: false });
    case 'toggleEventFlowPanel':
      return withPatch(state, { showEventFlowPanel: !state.showEventFlowPanel });
    case 'closeEventFlowPanel':
      return withPatch(state, { showEventFlowPanel: false });
    case 'togglePhoneOverflowMenu':
      return withPatch(state, { showPhoneOverflowMenu: !state.showPhoneOverflowMenu });
    case 'closePhoneOverflowMenu':
      return withPatch(state, { showPhoneOverflowMenu: false });
    case 'openIdentityManager':
      return withPatch(state, { showIdentityManager: true, showCreateChooser: false });
    case 'closeIdentityManager':
      return withPatch(state, { showIdentityManager: false });
    case 'openCreateChooser':
      return withPatch(state, { showCreateChooser: true, showIdentityManager: false });
    case 'closeCreateChooser':
      return withPatch(state, { showCreateChooser: false });
    case 'setFileManagerViewMode':
      return withPatch(state, { fileManagerViewMode: invocation.args[0] });
    case 'setSearchQuery':
      return withPatch(state, { searchQuery: invocation.args[0] });
    case 'clearSearchQuery':
      return withPatch(state, { searchQuery: '' });
    case 'setSortBy':
      return withPatch(state, { sortBy: invocation.args[0] });
    case 'openSpecDialog':
      return withPatch(state, { showSpecDialog: true });
    case 'closeSpecDialog':
      return withPatch(state, { showSpecDialog: false });
    case 'openJoinVolumeDialog':
      return withPatch(state, {
        showVolumeShareDialog: false,
        showCreateChooser: false,
        showJoinVolumeDialog: true,
      });
    case 'closeJoinVolumeDialog':
      return withPatch(state, { showJoinVolumeDialog: false });
    case 'openVolumeShareDialog':
      return withPatch(state, {
        showJoinVolumeDialog: false,
        showCreateChooser: false,
        showVolumeShareDialog: true,
      });
    case 'closeVolumeShareDialog':
      return withPatch(state, { showVolumeShareDialog: false });
  }
}

export function formatUiTransitionInvocation(invocation: UiTransitionInvocation): string {
  if (invocation.args.length === 0) {
    return `${invocation.name}()`;
  }
  return `${invocation.name}(${invocation.args.map((value) => JSON.stringify(value)).join(', ')})`;
}

function createTransitionMethods(store: ReturnType<typeof writable<UiTransitionState>>) {
  const dispatch = (invocation: UiTransitionInvocation) => {
    store.update((state) => applyUiTransitionInvocation(state, invocation));
  };
  return {
    dispatch,
    openThemeDialog(section: UiThemeDialogSection): void {
      dispatch({ name: 'openThemeDialog', args: [section] });
    },
    closeThemeDialog(): void {
      dispatch({ name: 'closeThemeDialog', args: [] });
    },
    setThemeDialogSection(section: UiThemeDialogSection): void {
      dispatch({ name: 'setThemeDialogSection', args: [section] });
    },
    openPreviewPane(): void {
      dispatch({ name: 'openPreviewPane', args: [] });
    },
    closePreviewPane(): void {
      dispatch({ name: 'closePreviewPane', args: [] });
    },
    openResetDialog(): void {
      dispatch({ name: 'openResetDialog', args: [] });
    },
    closeResetDialog(): void {
      dispatch({ name: 'closeResetDialog', args: [] });
    },
    toggleTimeMachinePanel(): void {
      dispatch({ name: 'toggleTimeMachinePanel', args: [] });
    },
    closeTimeMachinePanel(): void {
      dispatch({ name: 'closeTimeMachinePanel', args: [] });
    },
    openTimelineDetailDialog(): void {
      dispatch({ name: 'openTimelineDetailDialog', args: [] });
    },
    closeTimelineDetailDialog(): void {
      dispatch({ name: 'closeTimelineDetailDialog', args: [] });
    },
    toggleSourcesPanel(): void {
      dispatch({ name: 'toggleSourcesPanel', args: [] });
    },
    openSourcesPanel(): void {
      dispatch({ name: 'openSourcesPanel', args: [] });
    },
    closeSourcesPanel(): void {
      dispatch({ name: 'closeSourcesPanel', args: [] });
    },
    toggleVolumeStoragePanel(): void {
      dispatch({ name: 'toggleVolumeStoragePanel', args: [] });
    },
    openVolumeStoragePanel(): void {
      dispatch({ name: 'openVolumeStoragePanel', args: [] });
    },
    closeVolumeStoragePanel(): void {
      dispatch({ name: 'closeVolumeStoragePanel', args: [] });
    },
    openMountStorageDialog(): void {
      dispatch({ name: 'openMountStorageDialog', args: [] });
    },
    closeMountStorageDialog(): void {
      dispatch({ name: 'closeMountStorageDialog', args: [] });
    },
    toggleEventFlowPanel(): void {
      dispatch({ name: 'toggleEventFlowPanel', args: [] });
    },
    closeEventFlowPanel(): void {
      dispatch({ name: 'closeEventFlowPanel', args: [] });
    },
    togglePhoneOverflowMenu(): void {
      dispatch({ name: 'togglePhoneOverflowMenu', args: [] });
    },
    closePhoneOverflowMenu(): void {
      dispatch({ name: 'closePhoneOverflowMenu', args: [] });
    },
    openIdentityManager(): void {
      dispatch({ name: 'openIdentityManager', args: [] });
    },
    closeIdentityManager(): void {
      dispatch({ name: 'closeIdentityManager', args: [] });
    },
    openCreateChooser(): void {
      dispatch({ name: 'openCreateChooser', args: [] });
    },
    closeCreateChooser(): void {
      dispatch({ name: 'closeCreateChooser', args: [] });
    },
    setFileManagerViewMode(mode: FileManagerViewMode): void {
      dispatch({ name: 'setFileManagerViewMode', args: [mode] });
    },
    setSearchQuery(value: string): void {
      dispatch({ name: 'setSearchQuery', args: [value] });
    },
    clearSearchQuery(): void {
      dispatch({ name: 'clearSearchQuery', args: [] });
    },
    setSortBy(value: WorkspaceSortBy): void {
      dispatch({ name: 'setSortBy', args: [value] });
    },
    openSpecDialog(): void {
      dispatch({ name: 'openSpecDialog', args: [] });
    },
    closeSpecDialog(): void {
      dispatch({ name: 'closeSpecDialog', args: [] });
    },
    openJoinVolumeDialog(): void {
      dispatch({ name: 'openJoinVolumeDialog', args: [] });
    },
    closeJoinVolumeDialog(): void {
      dispatch({ name: 'closeJoinVolumeDialog', args: [] });
    },
    openVolumeShareDialog(): void {
      dispatch({ name: 'openVolumeShareDialog', args: [] });
    },
    closeVolumeShareDialog(): void {
      dispatch({ name: 'closeVolumeShareDialog', args: [] });
    },
  };
}

export type UiTransitionStore = Readable<UiTransitionState> & {
  replaceState: (value: unknown) => void;
  transitions: ReturnType<typeof createTransitionMethods>;
};

export function createUiTransitionStore(initialState?: unknown): UiTransitionStore {
  const store = writable<UiTransitionState>(normalizeUiTransitionState(initialState));
  return {
    subscribe: store.subscribe,
    replaceState(value: unknown): void {
      store.set(normalizeUiTransitionState(value));
    },
    transitions: createTransitionMethods(store),
  };
}

export function createUiTransitionSignature(state: UiTransitionState): string {
  return JSON.stringify(normalizeUiTransitionState(state));
}

const graphStateSpecs: Array<Omit<UiTransitionGraphState, 'assignment'> & { assignment: Partial<UiTransitionState> }> = [
  {
    id: 'workspace-idle',
    title: 'Workspace idle',
    note: 'No transient surface is open.',
    assignment: {},
  },
  {
    id: 'theme-preset',
    title: 'Theme dialog',
    note: 'Appearance dialog on the preset section.',
    assignment: { showThemeDialog: true, themeDialogSection: 'preset' },
  },
  {
    id: 'preview-open',
    title: 'Preview open',
    note: 'File preview surface is visible.',
    assignment: { showPreviewPane: true },
  },
  {
    id: 'theme-material',
    title: 'Theme material',
    note: 'Appearance dialog focused on material tuning.',
    assignment: { showThemeDialog: true, themeDialogSection: 'material' },
  },
  {
    id: 'theme-accent',
    title: 'Theme accent',
    note: 'Appearance dialog focused on accent tuning.',
    assignment: { showThemeDialog: true, themeDialogSection: 'accent' },
  },
  {
    id: 'theme-logo',
    title: 'Theme logo',
    note: 'Appearance dialog focused on logo tuning.',
    assignment: { showThemeDialog: true, themeDialogSection: 'logo' },
  },
  {
    id: 'create-open',
    title: 'Create chooser',
    note: 'Create flow chooser is visible.',
    assignment: { showCreateChooser: true },
  },
  {
    id: 'identity-open',
    title: 'Identity manager',
    note: 'Identity editor sheet is visible.',
    assignment: { showIdentityManager: true },
  },
  {
    id: 'join-open',
    title: 'Join dialog',
    note: 'Join flow is visible.',
    assignment: { showJoinVolumeDialog: true },
  },
  {
    id: 'share-open',
    title: 'Share dialog',
    note: 'Hub sharing dialog is visible.',
    assignment: { showVolumeShareDialog: true },
  },
  {
    id: 'reset-open',
    title: 'Reset dialog',
    note: 'Reset confirmation is visible.',
    assignment: { showResetDialog: true },
  },
  {
    id: 'sources-open',
    title: 'Global locations',
    note: 'Global storage locations panel is visible.',
    assignment: { showSourcesPanel: true },
  },
  {
    id: 'volume-storage-open',
    title: 'Hub storage',
    note: 'Per-hub storage panel is visible.',
    assignment: { showVolumeStoragePanel: true },
  },
  {
    id: 'mount-storage-open',
    title: 'Hub storage dialog',
    note: 'Per-hub storage routing dialog is visible.',
    assignment: { showMountStorageDialog: true },
  },
  {
    id: 'timeline-open',
    title: 'Timeline open',
    note: 'Time machine panel is visible.',
    assignment: { showTimeMachinePanel: true },
  },
  {
    id: 'timeline-detail-open',
    title: 'Timeline detail',
    note: 'Timeline detail dialog is visible.',
    assignment: { showTimelineDetailDialog: true },
  },
  {
    id: 'flow-open',
    title: 'Flow open',
    note: 'Event flow panel is visible.',
    assignment: { showEventFlowPanel: true },
  },
  {
    id: 'timeline-flow-open',
    title: 'Timeline and flow',
    note: 'Timeline and flow are open together.',
    assignment: { showTimeMachinePanel: true, showEventFlowPanel: true },
  },
  {
    id: 'phone-menu-open',
    title: 'Phone menu',
    note: 'Compact overflow menu is visible.',
    assignment: { showPhoneOverflowMenu: true },
  },
  {
    id: 'icon-view',
    title: 'Icon view',
    note: 'File manager is in tile mode.',
    assignment: { fileManagerViewMode: 'icons' },
  },
  {
    id: 'detail-view',
    title: 'Detail view',
    note: 'File manager is in list mode.',
    assignment: { fileManagerViewMode: 'details' },
  },
  {
    id: 'search-story',
    title: 'Search active',
    note: 'Search query is populated.',
    assignment: { searchQuery: 'story' },
  },
  {
    id: 'sort-name',
    title: 'Sort by name',
    note: 'File manager is sorted by name.',
    assignment: { sortBy: 'name' },
  },
  {
    id: 'spec-open',
    title: 'Spec dialog',
    note: 'Protocol spec dialog is visible.',
    assignment: { showSpecDialog: true },
  },
];

export const UI_TRANSITION_GRAPH_STATES: UiTransitionGraphState[] = graphStateSpecs.map((state) => ({
  id: state.id,
  title: state.title,
  note: state.note,
  assignment: normalizeUiTransitionState({
    ...UI_TRANSITION_DEFAULT_STATE,
    ...state.assignment,
  }),
}));

export const UI_TRANSITION_GRAPH_INVOCATIONS: UiTransitionInvocation[] = [
  { name: 'openThemeDialog', args: ['preset'] },
  { name: 'setThemeDialogSection', args: ['material'] },
  { name: 'setThemeDialogSection', args: ['accent'] },
  { name: 'setThemeDialogSection', args: ['logo'] },
  { name: 'closeThemeDialog', args: [] },
  { name: 'openPreviewPane', args: [] },
  { name: 'closePreviewPane', args: [] },
  { name: 'openCreateChooser', args: [] },
  { name: 'closeCreateChooser', args: [] },
  { name: 'openIdentityManager', args: [] },
  { name: 'closeIdentityManager', args: [] },
  { name: 'openJoinVolumeDialog', args: [] },
  { name: 'closeJoinVolumeDialog', args: [] },
  { name: 'openVolumeShareDialog', args: [] },
  { name: 'closeVolumeShareDialog', args: [] },
  { name: 'openResetDialog', args: [] },
  { name: 'closeResetDialog', args: [] },
  { name: 'toggleSourcesPanel', args: [] },
  { name: 'toggleVolumeStoragePanel', args: [] },
  { name: 'openMountStorageDialog', args: [] },
  { name: 'closeMountStorageDialog', args: [] },
  { name: 'toggleTimeMachinePanel', args: [] },
  { name: 'openTimelineDetailDialog', args: [] },
  { name: 'closeTimelineDetailDialog', args: [] },
  { name: 'toggleEventFlowPanel', args: [] },
  { name: 'togglePhoneOverflowMenu', args: [] },
  { name: 'setFileManagerViewMode', args: ['details'] },
  { name: 'setFileManagerViewMode', args: ['icons'] },
  { name: 'setSearchQuery', args: ['story'] },
  { name: 'clearSearchQuery', args: [] },
  { name: 'setSortBy', args: ['name'] },
  { name: 'setSortBy', args: ['newest'] },
  { name: 'openSpecDialog', args: [] },
  { name: 'closeSpecDialog', args: [] },
];

export function createUiTransitionGraph(): {
  states: UiTransitionGraphState[];
  edges: UiTransitionGraphEdge[];
} {
  const states = UI_TRANSITION_GRAPH_STATES;
  const signatureToStateId = new Map(states.map((state) => [createUiTransitionSignature(state.assignment), state.id]));
  const edges: UiTransitionGraphEdge[] = [];

  for (const state of states) {
    for (const invocation of UI_TRANSITION_GRAPH_INVOCATIONS) {
      const nextAssignment = applyUiTransitionInvocation(state.assignment, invocation);
      const nextId = signatureToStateId.get(createUiTransitionSignature(nextAssignment));
      if (!nextId || nextId === state.id) {
        continue;
      }
      edges.push({
        id: `${state.id}:${formatUiTransitionInvocation(invocation)}`,
        from: state.id,
        to: nextId,
        invocation,
        label: formatUiTransitionInvocation(invocation),
      });
    }
  }

  return { states, edges };
}