export type WorkspaceMode = 'files' | 'chat' | 'split';
export type WorkspacePane = 'files' | 'chat';
export type FileManagerViewMode = 'icons' | 'details';
export type WorkspaceSortBy = 'newest' | 'oldest' | 'name' | 'name-desc' | 'size' | 'size-asc';
export type PhoneOverflowAction = 'search' | 'storage' | 'share' | 'timeline' | 'flow' | 'identities' | 'locations' | 'reset';

export type WorkspaceChromeState = {
  workspaceMode: WorkspaceMode;
  showFilesWorkspace: boolean;
  showChatWorkspace: boolean;
  showSearchWorkspace: boolean;
  showVolumeStoragePanel: boolean;
  showVolumeShareDialog: boolean;
  showTimeMachinePanel: boolean;
  showEventFlowPanel: boolean;
  fileManagerViewMode: FileManagerViewMode;
  showWorkspaceUtilities: boolean;
  selectionSummary: string;
  storageDisabled: boolean;
  searchQuery: string;
  sortBy: WorkspaceSortBy;
  pasteVisible: boolean;
  pasteCount: number;
  pasteDisabled: boolean;
  pasteTitle: string;
  showResetAction: boolean;
};

export type WorkspaceChromeActions = {
  applyWorkspaceMode: (mode: WorkspaceMode) => void;
  toggleWorkspacePane: (pane: WorkspacePane) => void;
  toggleSearch: () => void;
  toggleStorage: () => void;
  openShare: () => void;
  toggleTimeline: () => void;
  toggleFlow: () => void;
  setViewMode: (mode: FileManagerViewMode) => void;
  setSearchQuery: (value: string) => void;
  setSortBy: (value: WorkspaceSortBy) => void;
  paste: () => void;
  overflowAction: (value: PhoneOverflowAction) => void;
};

type WorkspaceChromeInput = Partial<WorkspaceChromeState> & Pick<WorkspaceChromeState, 'workspaceMode'>;

export function createWorkspaceChromeState(input: WorkspaceChromeInput): WorkspaceChromeState {
  return {
    workspaceMode: input.workspaceMode,
    showFilesWorkspace: input.showFilesWorkspace ?? input.workspaceMode !== 'chat',
    showChatWorkspace: input.showChatWorkspace ?? input.workspaceMode !== 'files',
    showSearchWorkspace: input.showSearchWorkspace ?? false,
    showVolumeStoragePanel: input.showVolumeStoragePanel ?? false,
    showVolumeShareDialog: input.showVolumeShareDialog ?? false,
    showTimeMachinePanel: input.showTimeMachinePanel ?? false,
    showEventFlowPanel: input.showEventFlowPanel ?? false,
    fileManagerViewMode: input.fileManagerViewMode ?? 'details',
    showWorkspaceUtilities: input.showWorkspaceUtilities ?? false,
    selectionSummary: input.selectionSummary ?? '',
    storageDisabled: input.storageDisabled ?? false,
    searchQuery: input.searchQuery ?? '',
    sortBy: input.sortBy ?? 'newest',
    pasteVisible: input.pasteVisible ?? false,
    pasteCount: input.pasteCount ?? 0,
    pasteDisabled: input.pasteDisabled ?? false,
    pasteTitle: input.pasteTitle ?? '',
    showResetAction: input.showResetAction ?? false,
  };
}

export function createWorkspaceSelectionSummary(input: {
  fileCount: number;
  selectedCount: number;
  selectedLabel?: string | null;
}): string {
  const fileLabel = `${input.fileCount} file${input.fileCount === 1 ? '' : 's'}`;
  if (input.selectedCount === 0) {
    return `${fileLabel} · no selection`;
  }
  if (input.selectedCount === 1 && input.selectedLabel) {
    return `${fileLabel} · ${input.selectedLabel}`;
  }
  return `${fileLabel} · ${input.selectedCount} selected`;
}