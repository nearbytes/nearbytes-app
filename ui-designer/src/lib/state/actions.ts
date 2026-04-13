import type {
  ComponentFamily,
  DesignerTab,
  FixturePreset,
  GraphNodeId,
  MoodboardId,
  OverlayKind,
  PrimaryPane,
  SharedWorkspaceState,
  SurfaceAction,
  UiDesignerState,
  WorkspacePaneMode,
} from './types.js';

const DEFAULT_WORKSPACE: SharedWorkspaceState = {
  activeHubId: 'atlas',
  primaryPane: 'files',
  paneMode: 'balanced',
  overlay: 'none',
  showPreview: false,
  showTimeline: false,
  selectedFileId: 'f1',
  selectedEventId: 'e1',
  selectedPeerId: 'p1',
};

export function createInitialState(): UiDesignerState {
  return {
    tab: 'moodboards',
    moodboardId: 'graphite-night',
    fixturePreset: 'populated',
    componentFamily: 'primitives',
    workspace: { ...DEFAULT_WORKSPACE },
  };
}

export function selectTab(state: UiDesignerState, tab: DesignerTab): UiDesignerState {
  return { ...state, tab };
}

export function selectMoodboard(state: UiDesignerState, moodboardId: MoodboardId): UiDesignerState {
  return { ...state, moodboardId };
}

export function selectFixturePreset(state: UiDesignerState, fixturePreset: FixturePreset): UiDesignerState {
  return { ...state, fixturePreset };
}

export function selectComponentFamily(state: UiDesignerState, componentFamily: ComponentFamily): UiDesignerState {
  return { ...state, componentFamily };
}

export function selectHub(state: UiDesignerState, hubId: string): UiDesignerState {
  return {
    ...state,
    workspace: {
      ...state.workspace,
      activeHubId: hubId,
      overlay: 'none',
    },
  };
}

export function selectPrimaryPane(state: UiDesignerState, primaryPane: PrimaryPane): UiDesignerState {
  return {
    ...state,
    workspace: {
      ...state.workspace,
      primaryPane,
    },
  };
}

export function setWorkspacePaneMode(state: UiDesignerState, paneMode: WorkspacePaneMode): UiDesignerState {
  return {
    ...state,
    workspace: {
      ...state.workspace,
      paneMode,
    },
  };
}

export function togglePreviewPane(state: UiDesignerState): UiDesignerState {
  return {
    ...state,
    workspace: {
      ...state.workspace,
      showPreview: !state.workspace.showPreview,
      overlay: 'none',
    },
  };
}

export function toggleTimelinePanel(state: UiDesignerState): UiDesignerState {
  return {
    ...state,
    workspace: {
      ...state.workspace,
      showTimeline: !state.workspace.showTimeline,
      overlay: 'none',
    },
  };
}

export function openOverlay(
  state: UiDesignerState,
  overlay: Exclude<OverlayKind, 'none'>
): UiDesignerState {
  return {
    ...state,
    workspace: {
      ...state.workspace,
      overlay,
    },
  };
}

export function closeOverlay(state: UiDesignerState): UiDesignerState {
  return {
    ...state,
    workspace: {
      ...state.workspace,
      overlay: 'none',
    },
  };
}

export function selectFile(state: UiDesignerState, fileId: string): UiDesignerState {
  return {
    ...state,
    workspace: {
      ...state.workspace,
      selectedFileId: fileId,
      showPreview: true,
    },
  };
}

export function selectEvent(state: UiDesignerState, eventId: string): UiDesignerState {
  return {
    ...state,
    workspace: {
      ...state.workspace,
      selectedEventId: eventId,
      showTimeline: true,
    },
  };
}

export function selectPeer(state: UiDesignerState, peerId: string): UiDesignerState {
  return {
    ...state,
    workspace: {
      ...state.workspace,
      selectedPeerId: peerId,
      overlay: 'sources',
    },
  };
}

export function applySurfaceAction(state: UiDesignerState, action: SurfaceAction): UiDesignerState {
  switch (action.type) {
    case 'select-hub':
      return selectHub(state, action.hubId);
    case 'select-pane':
      return selectPrimaryPane(state, action.pane);
    case 'set-pane-mode':
      return setWorkspacePaneMode(state, action.paneMode);
    case 'toggle-preview':
      return togglePreviewPane(state);
    case 'toggle-timeline':
      return toggleTimelinePanel(state);
    case 'open-overlay':
      return openOverlay(state, action.overlay);
    case 'close-overlay':
      return closeOverlay(state);
    case 'select-file':
      return selectFile(state, action.fileId);
    case 'select-event':
      return selectEvent(state, action.eventId);
    case 'select-peer':
      return selectPeer(state, action.peerId);
  }
}

export function setStructuralState(state: UiDesignerState, nodeId: GraphNodeId): UiDesignerState {
  const base = {
    ...state,
    workspace: {
      ...state.workspace,
      paneMode: 'balanced' as WorkspacePaneMode,
      overlay: 'none' as OverlayKind,
      showPreview: false,
      showTimeline: false,
      primaryPane: nodeId === 'chat-focus' ? 'chat' : 'files',
    },
  };

  switch (nodeId) {
    case 'workspace-home':
      return base;
    case 'files-focus':
      return setWorkspacePaneMode(base, 'files-focus');
    case 'chat-focus':
      return setWorkspacePaneMode(base, 'chat-focus');
    case 'preview-open':
      return { ...base, workspace: { ...base.workspace, showPreview: true } };
    case 'timeline-open':
      return { ...base, workspace: { ...base.workspace, showTimeline: true } };
    case 'join-dialog':
      return openOverlay(base, 'join');
    case 'share-dialog':
      return openOverlay(base, 'share');
    case 'identity-manager':
      return openOverlay(base, 'identity');
    case 'create-chooser':
      return openOverlay(base, 'create');
    case 'sources-panel':
      return openOverlay(base, 'sources');
    case 'storage-panel':
      return openOverlay(base, 'storage');
    case 'hub-storage-dialog':
      return openOverlay(base, 'hub-storage');
    case 'event-flow-panel':
      return openOverlay(base, 'event-flow');
    case 'reset-dialog':
      return openOverlay(base, 'reset');
  }
}
