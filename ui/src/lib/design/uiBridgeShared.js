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
      component: 'WorkspaceModeBar',
      host: 'Hub workspace'
    },
    'workspace-search-strip': {
      id: 'workspace-search-strip',
      title: 'Workspace search strip',
      component: 'WorkspaceSearchStrip',
      host: 'File search and sorting'
    },
    'file-details-view': {
      id: 'file-details-view',
      title: 'File details view',
      component: 'FileManagerWorkspace',
      host: 'File manager'
    },
    'file-icon-view': {
      id: 'file-icon-view',
      title: 'File icon view',
      component: 'FileManagerWorkspace',
      host: 'File manager'
    },
    'preview-pane': {
      id: 'preview-pane',
      title: 'Preview pane',
      component: 'PreviewPane',
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
      component: 'TimeMachinePanel',
      host: 'Time machine'
    },
    'timeline-detail': {
      id: 'timeline-detail',
      title: 'Timeline detail dialog',
      component: 'TimelineDetailDialog',
      host: 'Event detail'
    },
    'spec-dialog': {
      id: 'spec-dialog',
      title: 'Spec dialog',
      component: 'SpecDialog',
      host: 'Protocol reference overlay'
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
    'hub-storage-dialog': {
      id: 'hub-storage-dialog',
      title: 'Hub storage dialog',
      component: 'VolumeStorageDialog',
      host: 'Storage routing dialog'
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
      component: 'ShareDialog',
      host: 'Hub sharing dialog'
    },
    'join-dialog': {
      id: 'join-dialog',
      title: 'Join dialog',
      component: 'JoinDialog',
      host: 'Open shared hub flow'
    },
    'mount-dialog': {
      id: 'mount-dialog',
      title: 'Hub properties dialog',
      component: 'MountDialog',
      host: 'Mount configuration'
    },
    'create-chooser': {
      id: 'create-chooser',
      title: 'Create chooser',
      component: 'CreateChooserDialog',
      host: 'Create flow'
    },
    'identity-manager': {
      id: 'identity-manager',
      title: 'Identity manager',
      component: 'IdentityManagerDialog',
      host: 'Identity sheet'
    },
    'phone-overflow-menu': {
      id: 'phone-overflow-menu',
      title: 'Phone overflow menu',
      component: 'PhoneOverflowMenu',
      host: 'Compact actions'
    },
    'reset-dialog': {
      id: 'reset-dialog',
      title: 'Reset dialog',
      component: 'ResetDialog',
      host: 'Reset confirmation'
    },
    'theme-dialog': {
      id: 'theme-dialog',
      title: 'Theme dialog',
      component: 'ThemeStudioDialog',
      host: 'Appearance studio dialog'
    },
    'system-toast-stack': {
      id: 'system-toast-stack',
      title: 'System toast stack',
      component: 'SystemToastStack',
      host: 'Updater and discovery notices'
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
      component: 'EmptyStatePanel',
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
      surfaces: ['timeline-panel', 'timeline-detail', 'spec-dialog', 'event-flow-panel']
    },
    {
      id: 'storage',
      title: 'Storage and links',
      surfaces: ['sources-panel', 'volume-storage-panel', 'hub-storage-dialog', 'share-dialog', 'join-dialog']
    },
    {
      id: 'dialogs',
      title: 'Dialogs and primitives',
      surfaces: ['mount-dialog', 'create-chooser', 'identity-manager', 'reset-dialog', 'theme-dialog', 'system-toast-stack', 'status-primitives']
    }
  ];

  function normalizeEnum(value, fallback, allowed) {
    return allowed.indexOf(value) === -1 ? fallback : value;
  }

  function unique(values) {
    return Array.from(new Set(values.filter(Boolean)));
  }

  var UI_MACHINE_DEFAULT = {
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
    showVolumeShareDialog: false
  };

  function cloneUiMachine(machine) {
    return {
      showThemeDialog: Boolean(machine.showThemeDialog),
      themeDialogSection: normalizeEnum(machine.themeDialogSection, 'preset', ['preset', 'material', 'accent', 'logo']),
      showPreviewPane: Boolean(machine.showPreviewPane),
      showResetDialog: Boolean(machine.showResetDialog),
      showTimeMachinePanel: Boolean(machine.showTimeMachinePanel),
      showTimelineDetailDialog: Boolean(machine.showTimelineDetailDialog),
      showSourcesPanel: Boolean(machine.showSourcesPanel),
      showVolumeStoragePanel: Boolean(machine.showVolumeStoragePanel),
      showMountStorageDialog: Boolean(machine.showMountStorageDialog),
      showEventFlowPanel: Boolean(machine.showEventFlowPanel),
      showPhoneOverflowMenu: Boolean(machine.showPhoneOverflowMenu),
      showIdentityManager: Boolean(machine.showIdentityManager),
      showCreateChooser: Boolean(machine.showCreateChooser),
      fileManagerViewMode: normalizeEnum(machine.fileManagerViewMode, 'icons', ['icons', 'details']),
      searchQuery: typeof machine.searchQuery === 'string' ? machine.searchQuery : '',
      sortBy: normalizeEnum(machine.sortBy, 'newest', ['newest', 'oldest', 'name', 'name-desc', 'size', 'size-asc']),
      showSpecDialog: Boolean(machine.showSpecDialog),
      showJoinVolumeDialog: Boolean(machine.showJoinVolumeDialog),
      showVolumeShareDialog: Boolean(machine.showVolumeShareDialog)
    };
  }

  function normalizeUiMachine(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return cloneUiMachine(UI_MACHINE_DEFAULT);
    }
    return cloneUiMachine(Object.assign({}, UI_MACHINE_DEFAULT, input));
  }

  function activeModalFromMachine(machine) {
    if (machine.showVolumeShareDialog) return 'share';
    if (machine.showJoinVolumeDialog) return 'join';
    if (machine.showCreateChooser) return 'create';
    if (machine.showIdentityManager) return 'identity';
    if (machine.showResetDialog) return 'reset';
    return 'none';
  }

  function secondaryFromMachine(machine) {
    if (machine.showIdentityManager) return 'identities';
    if (machine.showSourcesPanel || machine.showVolumeStoragePanel) return 'locations';
    if (machine.showEventFlowPanel) return 'flow';
    return 'none';
  }

  function storageModeFromMachine(machine) {
    return machine.showSourcesPanel ? 'global' : 'volume';
  }

  function styleSortValueFromMachine(sortBy) {
    if (sortBy === 'name' || sortBy === 'name-desc') return 'name';
    if (sortBy === 'size' || sortBy === 'size-asc') return 'protected';
    return 'newest';
  }

  function sortByFromStyleValue(value, fallback) {
    if (value === 'name') return 'name';
    if (value === 'protected') return 'size';
    if (value === 'newest') return 'newest';
    return fallback;
  }

  function projectStudioChrome(machine, source) {
    var resolvedSearchText = typeof source.stylesSearchText === 'string' ? source.stylesSearchText : machine.searchQuery;
    return {
      secondary: secondaryFromMachine(machine),
      dialogSurface: activeModalFromMachine(machine),
      storageMode: storageModeFromMachine(machine),
      searchOpen: machine.searchQuery.trim() !== '',
      timelineOpen: machine.showTimeMachinePanel,
      phoneMenuOpen: machine.showPhoneOverflowMenu,
      viewMode: machine.fileManagerViewMode,
      stylesSearchText: resolvedSearchText,
      stylesSortValue: styleSortValueFromMachine(machine.sortBy)
    };
  }

  function applySecondaryToMachine(machine, secondary, storageMode, dialogSurface) {
    machine.showSourcesPanel = secondary === 'locations' && storageMode === 'global';
    machine.showVolumeStoragePanel = secondary === 'locations' && storageMode === 'volume';
    machine.showEventFlowPanel = secondary === 'flow';
    machine.showIdentityManager = secondary === 'identities' || dialogSurface === 'identity';
  }

  function applyDialogToMachine(machine, dialogSurface) {
    machine.showVolumeShareDialog = dialogSurface === 'share';
    machine.showJoinVolumeDialog = dialogSurface === 'join';
    machine.showCreateChooser = dialogSurface === 'create';
    machine.showResetDialog = dialogSurface === 'reset';
  }

  function createUiMachineFromStudioFields(source) {
    var machine = cloneUiMachine(UI_MACHINE_DEFAULT);
    var secondary = normalizeEnum(source.secondary, 'none', ['none', 'locations', 'flow', 'identities']);
    var dialogSurface = normalizeEnum(source.dialogSurface, 'none', ['none', 'share', 'join', 'create', 'identity', 'reset']);
    var storageMode = normalizeEnum(source.storageMode, 'volume', ['global', 'volume']);
    var searchText = typeof source.stylesSearchText === 'string' ? source.stylesSearchText : '';

    machine.fileManagerViewMode = normalizeEnum(source.viewMode, 'icons', ['icons', 'details']);
    machine.sortBy = sortByFromStyleValue(source.stylesSortValue, machine.sortBy);
    machine.searchQuery = source.searchOpen ? (searchText.trim() !== '' ? searchText : 'story') : '';
    machine.showTimeMachinePanel = Boolean(source.timelineOpen);
    machine.showPhoneOverflowMenu = Boolean(source.phoneMenuOpen);

    applyDialogToMachine(machine, dialogSurface);
    applySecondaryToMachine(machine, secondary, storageMode, dialogSurface);

    return machine;
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
    if (source.showSpecDialog) {
      surfaces.push('spec-dialog');
    }
    if (source.showSourcesPanel) {
      surfaces.push('sources-panel');
    }
    if (source.showVolumeStoragePanel) {
      surfaces.push('volume-storage-panel');
    }
    if (source.showMountStorageDialog) {
      surfaces.push('hub-storage-dialog');
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
    if (source.showMountDialog) {
      surfaces.push('mount-dialog');
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
    if (source.showThemeDialog) {
      surfaces.push('theme-dialog');
    }
    surfaces.push('status-primitives');

    return {
      workspaceMode: workspaceMode,
      fileManagerViewMode: fileManagerViewMode,
      activeModal: normalizeEnum(source.activeModal, 'none', ['none', 'share', 'join', 'mount', 'create', 'identity', 'reset']),
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
    var machine = source.uiMachine ? normalizeUiMachine(source.uiMachine) : createUiMachineFromStudioFields(source);
    var projected = projectStudioChrome(machine, source);
    var workspace = normalizeEnum(source.workspace, 'files', ['files', 'chat', 'split']);
    var secondary = normalizeEnum(source.secondary, projected.secondary, ['none', 'locations', 'flow', 'identities']);
    var dialogSurface = normalizeEnum(source.dialogSurface, projected.dialogSurface, ['none', 'share', 'join', 'create', 'identity', 'reset']);
    var storageMode = normalizeEnum(source.storageMode, projected.storageMode, ['global', 'volume']);
    var viewMode = normalizeEnum(source.viewMode, projected.viewMode, ['icons', 'details']);
    var stylesSortValue = normalizeEnum(source.stylesSortValue, projected.stylesSortValue, ['newest', 'name', 'protected']);
    var stylesSearchText = typeof source.stylesSearchText === 'string' ? source.stylesSearchText : projected.stylesSearchText;
    var searchOpen = typeof source.searchOpen === 'boolean' ? source.searchOpen : projected.searchOpen;
    var timelineOpen = typeof source.timelineOpen === 'boolean' ? source.timelineOpen : projected.timelineOpen;
    var phoneMenuOpen = typeof source.phoneMenuOpen === 'boolean' ? source.phoneMenuOpen : projected.phoneMenuOpen;

    if (viewMode !== projected.viewMode) {
      machine.fileManagerViewMode = viewMode;
    }

    if (stylesSortValue !== projected.stylesSortValue) {
      machine.sortBy = sortByFromStyleValue(stylesSortValue, machine.sortBy);
    }

    if (searchOpen) {
      var nextSearchText = stylesSearchText.trim() !== '' ? stylesSearchText : machine.searchQuery.trim() !== '' ? machine.searchQuery : 'story';
      if (machine.searchQuery !== nextSearchText) {
        machine.searchQuery = nextSearchText;
      }
    } else {
      machine.searchQuery = '';
    }

    machine.showTimeMachinePanel = timelineOpen;
    machine.showPhoneOverflowMenu = phoneMenuOpen;
    applyDialogToMachine(machine, dialogSurface);
    applySecondaryToMachine(machine, secondary, storageMode, dialogSurface);

    var normalizedMachine = normalizeUiMachine(machine);
    var normalizedProjection = projectStudioChrome(normalizedMachine, { stylesSearchText: stylesSearchText });

    return {
      moodboardId: source.moodboardId,
      accentStrength: source.accentStrength,
      radiusMode: source.radiusMode,
      density: source.density,
      viewport: source.viewport,
      hubId: source.hubId,
      workspace: workspace,
      secondary: normalizedProjection.secondary,
      dialogSurface: normalizedProjection.dialogSurface,
      storageMode: normalizedProjection.storageMode,
      searchOpen: normalizedProjection.searchOpen,
      timelineOpen: normalizedProjection.timelineOpen,
      phoneMenuOpen: normalizedProjection.phoneMenuOpen,
      viewMode: normalizedProjection.viewMode,
      stylesSearchText: stylesSearchText,
      stylesSortValue: normalizedProjection.stylesSortValue,
      stylesSortOpen: Boolean(source.stylesSortOpen),
      uiMachine: normalizedMachine
    };
  }

  existing.version = '20260410a';
  existing.surfaceRegistry = surfaceRegistry;
  existing.toolkitSections = toolkitSections;
  existing.normalizeStudioState = normalizeStudioState;
  existing.createAppSnapshot = createAppSnapshot;
  existing.publishAppSnapshot = publishAppSnapshot;
  existing.clearAppSnapshot = clearAppSnapshot;

  globalThis.NearbytesUiBridgeShared = existing;
})();