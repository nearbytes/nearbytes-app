(function () {
  var existing = globalThis.NearbytesUiBridgeShared || {};

  var surfaceRegistry = {
    'mount-rail': {
      id: 'mount-rail',
      title: 'Mount rail',
      component: 'MountRail',
      host: 'App.svelte'
    },
    'workspace-mode-bar': {
      id: 'workspace-mode-bar',
      title: 'Workspace mode bar',
      component: 'App.svelte',
      host: 'Hub workspace'
    },
    'workspace-search-strip': {
      id: 'workspace-search-strip',
      title: 'Workspace search strip',
      component: 'App.svelte',
      host: 'File search and sorting'
    },
    'file-details-view': {
      id: 'file-details-view',
      title: 'File details view',
      component: 'App.svelte',
      host: 'File manager'
    },
    'file-icon-view': {
      id: 'file-icon-view',
      title: 'File icon view',
      component: 'App.svelte',
      host: 'File manager'
    },
    'preview-pane': {
      id: 'preview-pane',
      title: 'Preview pane',
      component: 'AudioPreview',
      host: 'Preview panel'
    },
    'chat-thread': {
      id: 'chat-thread',
      title: 'Chat thread',
      component: 'VolumeChat',
      host: 'Chat workspace'
    },
    'timeline-panel': {
      id: 'timeline-panel',
      title: 'Timeline panel',
      component: 'App.svelte',
      host: 'Time machine'
    },
    'timeline-detail': {
      id: 'timeline-detail',
      title: 'Timeline detail dialog',
      component: 'AppDialog',
      host: 'Event detail'
    },
    'sources-panel': {
      id: 'sources-panel',
      title: 'Global storage panel',
      component: 'StoragePanel',
      host: 'mode=global'
    },
    'volume-storage-panel': {
      id: 'volume-storage-panel',
      title: 'Hub storage panel',
      component: 'StoragePanel',
      host: 'mode=volume'
    },
    'event-flow-panel': {
      id: 'event-flow-panel',
      title: 'Event flow overlay',
      component: 'EventFlowPanel',
      host: 'Flow overlay'
    },
    'share-dialog': {
      id: 'share-dialog',
      title: 'Share dialog',
      component: 'ShareSpaceLinkSection',
      host: 'AppDialog'
    },
    'join-dialog': {
      id: 'join-dialog',
      title: 'Join dialog',
      component: 'JoinLinkSections',
      host: 'AppDialog'
    },
    'create-chooser': {
      id: 'create-chooser',
      title: 'Create chooser',
      component: 'App.svelte',
      host: 'Create flow'
    },
    'identity-manager': {
      id: 'identity-manager',
      title: 'Identity manager',
      component: 'VolumeIdentity',
      host: 'Identity sheet'
    },
    'phone-overflow-menu': {
      id: 'phone-overflow-menu',
      title: 'Phone overflow menu',
      component: 'App.svelte',
      host: 'Compact actions'
    },
    'reset-dialog': {
      id: 'reset-dialog',
      title: 'Reset dialog',
      component: 'AppDialog',
      host: 'Reset confirmation'
    },
    'status-primitives': {
      id: 'status-primitives',
      title: 'Status and guarded actions',
      component: 'StatusNotice + ArmedActionButton',
      host: 'Reusable primitives'
    },
    'empty-state': {
      id: 'empty-state',
      title: 'Empty hub state',
      component: 'App.svelte',
      host: 'Initial shell'
    }
  };

  var toolkitSections = [
    {
      id: 'shell',
      title: 'Shell',
      surfaces: ['mount-rail', 'workspace-mode-bar', 'workspace-search-strip', 'phone-overflow-menu']
    },
    {
      id: 'workspace',
      title: 'Workspace',
      surfaces: ['file-details-view', 'file-icon-view', 'preview-pane', 'chat-thread', 'empty-state']
    },
    {
      id: 'history',
      title: 'History',
      surfaces: ['timeline-panel', 'timeline-detail', 'event-flow-panel']
    },
    {
      id: 'storage',
      title: 'Storage and links',
      surfaces: ['sources-panel', 'volume-storage-panel', 'share-dialog', 'join-dialog']
    },
    {
      id: 'dialogs',
      title: 'Dialogs and primitives',
      surfaces: ['create-chooser', 'identity-manager', 'reset-dialog', 'status-primitives']
    }
  ];

  function normalizeEnum(value, fallback, allowed) {
    return allowed.indexOf(value) === -1 ? fallback : value;
  }

  function unique(values) {
    return Array.from(new Set(values.filter(Boolean)));
  }

  function createAppSnapshot(input) {
    var source = input || {};
    var workspaceMode = normalizeEnum(
      source.workspaceMode,
      source.showFilesWorkspace && source.showChatWorkspace ? 'split' : source.showChatWorkspace ? 'chat' : 'files',
      ['files', 'chat', 'split']
    );
    var fileManagerViewMode = normalizeEnum(source.fileManagerViewMode, 'details', ['icons', 'details']);
    var surfaces = [];

    if ((source.mountCount || 0) > 0) {
      surfaces.push('mount-rail');
    }
    if (source.emptyState) {
      surfaces.push('empty-state');
    } else {
      surfaces.push('workspace-mode-bar');
      if (source.showFilesWorkspace !== false) {
        surfaces.push(fileManagerViewMode === 'icons' ? 'file-icon-view' : 'file-details-view');
      }
      if (source.showChatWorkspace) {
        surfaces.push('chat-thread');
      }
    }
    if (source.showSearchWorkspace) {
      surfaces.push('workspace-search-strip');
    }
    if (source.showPreviewPane) {
      surfaces.push('preview-pane');
    }
    if (source.showTimeMachinePanel) {
      surfaces.push('timeline-panel');
    }
    if (source.timelineDetailOpen) {
      surfaces.push('timeline-detail');
    }
    if (source.showSourcesPanel) {
      surfaces.push('sources-panel');
    }
    if (source.showVolumeStoragePanel) {
      surfaces.push('volume-storage-panel');
    }
    if (source.showEventFlowPanel) {
      surfaces.push('event-flow-panel');
    }
    if (source.showVolumeShareDialog) {
      surfaces.push('share-dialog');
    }
    if (source.showJoinVolumeDialog) {
      surfaces.push('join-dialog');
    }
    if (source.showCreateChooser) {
      surfaces.push('create-chooser');
    }
    if (source.showIdentityManager) {
      surfaces.push('identity-manager');
    }
    if (source.showPhoneOverflowMenu) {
      surfaces.push('phone-overflow-menu');
    }
    if (source.showResetDialog) {
      surfaces.push('reset-dialog');
    }
    surfaces.push('status-primitives');

    return {
      workspaceMode: workspaceMode,
      fileManagerViewMode: fileManagerViewMode,
      activeModal: normalizeEnum(source.activeModal, 'none', ['none', 'share', 'join', 'create', 'identity', 'reset']),
      mountLabel: source.mountLabel || '',
      fileCount: Number(source.fileCount) || 0,
      selectedCount: Number(source.selectedCount) || 0,
      timelineCount: Number(source.timelineCount) || 0,
      timelinePosition: Number(source.timelinePosition) || 0,
      searchQuery: source.searchQuery || '',
      surfaces: unique(surfaces)
    };
  }

  function publishAppSnapshot(snapshot) {
    existing.appSnapshot = snapshot;
    existing.appSnapshotUpdatedAt = Date.now();
    if (typeof globalThis.dispatchEvent === 'function' && typeof globalThis.CustomEvent === 'function') {
      globalThis.dispatchEvent(new CustomEvent('nearbytes-ui-bridge-snapshot', { detail: snapshot }));
    }
    return snapshot;
  }

  function clearAppSnapshot() {
    existing.appSnapshot = null;
    existing.appSnapshotUpdatedAt = Date.now();
  }

  function normalizeStudioState(input) {
    var source = input || {};
    return {
      workspace: normalizeEnum(source.workspace, 'files', ['files', 'chat', 'split']),
      secondary: normalizeEnum(source.secondary, 'none', ['none', 'locations', 'flow', 'identities']),
      dialogSurface: normalizeEnum(source.dialogSurface, 'none', ['none', 'share', 'join', 'create', 'identity', 'reset']),
      storageMode: normalizeEnum(source.storageMode, 'volume', ['global', 'volume']),
      searchOpen: Boolean(source.searchOpen),
      timelineOpen: Boolean(source.timelineOpen),
      phoneMenuOpen: Boolean(source.phoneMenuOpen),
      viewMode: normalizeEnum(source.viewMode, 'details', ['icons', 'details'])
    };
  }

  existing.version = '20260409g';
  existing.surfaceRegistry = surfaceRegistry;
  existing.toolkitSections = toolkitSections;
  existing.normalizeStudioState = normalizeStudioState;
  existing.createAppSnapshot = createAppSnapshot;
  existing.publishAppSnapshot = publishAppSnapshot;
  existing.clearAppSnapshot = clearAppSnapshot;

  globalThis.NearbytesUiBridgeShared = existing;
})();