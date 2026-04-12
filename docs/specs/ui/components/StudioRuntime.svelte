<script lang="ts">
  import {
    FileArchive,
    FileAudio,
    FileCode2,
    FileText,
    FileVideo,
    Image as ImageIcon,
  } from 'lucide-svelte';
  import CreateChooserDialog from '../system/components/CreateChooserDialog.svelte';
  import EmptyStatePanel from '../system/components/EmptyStatePanel.svelte';
  import EventFlowPanel from '../system/components/EventFlowPanel.svelte';
  import FileManagerWorkspace from '../system/components/FileManagerWorkspace.svelte';
  import IdentityManagerDialog from '../system/components/IdentityManagerDialog.svelte';
  import JoinDialog from '../system/components/JoinDialog.svelte';
  import ResetDialog from '../system/components/ResetDialog.svelte';
  import ShareDialog from '../system/components/ShareDialog.svelte';
  import StoragePanel from '../system/components/StoragePanel.svelte';
  import StatusNotice from '../system/components/StatusNotice.svelte';
  import TimeMachinePanel from '../system/components/TimeMachinePanel.svelte';
  import VolumeChat from '../system/components/VolumeChat.svelte';
  import WorkspaceShell from '../system/components/WorkspaceShell.svelte';
  import {
    createWorkspaceChromeState,
    createWorkspaceSelectionSummary,
    type FileManagerViewMode,
    type PhoneOverflowAction,
    type WorkspaceChromeActions,
    type WorkspaceMode,
    type WorkspacePane,
    type WorkspaceSortBy,
  } from '../system/workspaceChrome.js';
  import {
    defaultThemeRegistry,
    defaultThemeSettings,
  } from '../system/branding.js';
  import type { Auth, FileMetadata, TimelineEvent } from '../system/contracts.js';

  let {
    page = 'desktop',
    data,
    studioState,
    uiState,
    onPatchState,
  }: {
    page?: 'styles' | 'desktop' | 'phone';
    data: typeof import('../studio-data.js').STUDIO_DATA;
    studioState: Record<string, unknown>;
    uiState: Record<string, unknown>;
    onPatchState: (patch: Record<string, unknown>) => Promise<void> | void;
  } = $props();

  const themeRegistry = defaultThemeRegistry();
  const themeSettings = defaultThemeSettings(themeRegistry);

  let phoneOverflowMenuButtonElement = $state<HTMLButtonElement | null>(null);
  let phoneOverflowMenuElement = $state<HTMLElement | null>(null);
  let isHeaderHovering = $state(false);
  let resetDeleteLocalData = $state(false);
  let selectedIdentityId = $state('ada');
  let joinSerialized = $state('nearbytes://join?data=studio-preview-token');
  let shareLinkFeedback = $state<{ tone: 'success' | 'warning'; message: string } | null>(null);
  let selectedPreviewFilename = $state<string | null>(null);
  let previewTimelinePosition = $state(0);
  let previewTimelineEventsElement = $state<HTMLElement | null>(null);

  const isPhone = $derived(page === 'phone');
  const activeHub = $derived.by(() =>
    data.hubs.find((hub) => hub.id === studioState.hubId) ?? data.hubs[0]
  );
  const mounts = $derived.by(() =>
    data.hubs.map((hub) => ({
      id: hub.id,
      label: hub.name,
    }))
  );
  const knownVolumes = $derived.by(() =>
    data.hubs.map((hub) => ({
      volumeId: hub.id,
      label: hub.name,
    }))
  );

  const configuredIdentities = $derived.by(() => [
    {
      id: 'ada',
      address: 'ada-nearbytes-secret',
      password: '',
      displayName: 'Ada',
      bio: 'Current speaking identity',
      publicKey: 'ada-public-key',
      secretFileName: '',
      secretFileMimeType: '',
      avatarDataUrl: '',
    },
    {
      id: 'reader',
      address: 'reader-nearbytes-secret',
      password: '',
      displayName: 'Reader',
      bio: 'Read-only publication identity',
      publicKey: 'reader-public-key',
      secretFileName: '',
      secretFileMimeType: '',
      avatarDataUrl: '',
    },
  ]);

  const selectedChatIdentity = $derived.by(
    () =>
      configuredIdentities.find((identity) => identity.id === selectedIdentityId) ??
      configuredIdentities[0] ??
      null
  );
  const studioAuth: Auth = { type: 'token', token: 'studio-preview' };
  const currentVolumePresentation = $derived.by(() => ({
    volumeId: activeHub.id,
    label: activeHub.name,
    filePayload: `studio://${activeHub.id}`,
    fileMimeType: 'application/x-nearbytes-share',
    fileName: `${activeHub.name}.nearbytes`,
  }));

  const previewFiles = $derived.by<FileMetadata[]>(() =>
    activeHub.files.map((file, index) => ({
      filename: file.name,
      blobHash: `${activeHub.id}:${index}:${file.name}`,
      size: parseSizeLabel(file.size),
      mimeType: inferMimeType(file.name),
      createdAt: Date.now() - index * 1_800_000,
    }))
  );

  const visiblePreviewFiles = $derived.by<FileMetadata[]>(() => {
    const query = String(studioState.stylesSearchText ?? '').trim().toLowerCase();
    const sortBy = normalizeSort(uiState.sortBy ?? studioState.stylesSortValue);
    let files = previewFiles.slice();

    if (query !== '') {
      files = files.filter((file) => file.filename.toLowerCase().includes(query));
    }

    files.sort((left, right) => {
      if (sortBy === 'name') return left.filename.localeCompare(right.filename);
      if (sortBy === 'name-desc') return right.filename.localeCompare(left.filename);
      if (sortBy === 'size') return right.size - left.size;
      if (sortBy === 'size-asc') return left.size - right.size;
      if (sortBy === 'oldest') return left.createdAt - right.createdAt;
      return right.createdAt - left.createdAt;
    });

    return files;
  });

  const selectedPreviewFile = $derived.by(
    () =>
      visiblePreviewFiles.find((file) => file.filename === selectedPreviewFilename) ??
      visiblePreviewFiles[0] ??
      null
  );

  const previewTimelineEvents = $derived.by<TimelineEvent[]>(() =>
    activeHub.timeline.map((event, index) => {
      const timestamp = Date.now() - (activeHub.timeline.length - index) * 300_000;
      return {
        eventHash: `${activeHub.id}:timeline:${index}`,
        type: previewTimelineType(event.note),
        filename: event.title,
        timestamp,
        body: event.note,
        displayName: event.title,
        summary: event.note,
      };
    })
  );

  $effect(() => {
    if (
      visiblePreviewFiles.length > 0 &&
      !visiblePreviewFiles.some((file) => file.filename === selectedPreviewFilename)
    ) {
      selectedPreviewFilename = visiblePreviewFiles[0].filename;
    }
    if (visiblePreviewFiles.length === 0) {
      selectedPreviewFilename = null;
    }
  });

  $effect(() => {
    if (previewTimelinePosition > previewTimelineEvents.length) {
      previewTimelinePosition = previewTimelineEvents.length;
    } else if (previewTimelinePosition === 0 && previewTimelineEvents.length > 0) {
      previewTimelinePosition = previewTimelineEvents.length;
    }
  });

  const workspaceChromeState = $derived.by(() =>
    createWorkspaceChromeState({
      workspaceMode: uiState.workspace as WorkspaceMode,
      showFilesWorkspace: uiState.workspace !== 'chat',
      showChatWorkspace: uiState.workspace !== 'files',
      showSearchWorkspace: uiState.searchOpen,
      showVolumeStoragePanel: uiState.secondary === 'locations' && uiState.storageMode === 'volume',
      showVolumeShareDialog: uiState.dialogSurface === 'share',
      showTimeMachinePanel: uiState.timelineOpen,
      showEventFlowPanel: uiState.secondary === 'flow',
      fileManagerViewMode: uiState.viewMode as FileManagerViewMode,
      showWorkspaceUtilities: true,
      selectionSummary: createWorkspaceSelectionSummary({
        fileCount: visiblePreviewFiles.length,
        selectedCount: selectedPreviewFile ? 1 : 0,
        selectedLabel: selectedPreviewFile?.filename ?? null,
      }),
      storageDisabled: false,
      searchQuery: String(studioState.stylesSearchText ?? ''),
      sortBy: normalizeSort(uiState.sortBy ?? studioState.stylesSortValue),
      pasteVisible: uiState.workspace !== 'chat',
      pasteCount: 1,
      pasteDisabled: false,
      pasteTitle: 'Paste studio reference',
      showResetAction: true,
    })
  );

  const workspaceActions: WorkspaceChromeActions = {
    applyWorkspaceMode(mode) {
      patch({ workspace: mode });
    },
    toggleWorkspacePane(pane) {
      patch({ workspace: toggleWorkspace(uiState.workspace as string, pane) });
    },
    toggleSearch() {
      patch({ searchOpen: !uiState.searchOpen });
    },
    toggleStorage() {
      patch({
        secondary: uiState.secondary === 'locations' ? 'none' : 'locations',
        storageMode: 'volume',
      });
    },
    openShare() {
      patch({ dialogSurface: 'share' });
    },
    toggleTimeline() {
      patch({ timelineOpen: !uiState.timelineOpen });
    },
    toggleFlow() {
      patch({ secondary: uiState.secondary === 'flow' ? 'none' : 'flow' });
    },
    setViewMode(mode) {
      patch({ viewMode: mode });
    },
    setSearchQuery(value) {
      patch({ stylesSearchText: value });
    },
    setSortBy(value) {
      patch({ stylesSortValue: value, sortBy: value });
    },
    paste() {
      shareLinkFeedback = { tone: 'success', message: 'Studio paste preview queued.' };
    },
    overflowAction(value) {
      handleOverflowAction(value);
    },
  };

  const previewStageMode = $derived.by(() => {
    if (uiState.secondary === 'locations') {
      return uiState.storageMode === 'global' ? 'global-panel' : 'volume-panel';
    }
    if (visiblePreviewFiles.length === 0 && uiState.workspace !== 'chat') {
      return 'empty';
    }
    return 'workspace';
  });

  const previewWorkspaceColumns = $derived.by(() => {
    if (isPhone || !workspaceChromeState.showFilesWorkspace || !workspaceChromeState.showChatWorkspace) {
      return 'minmax(0, 1fr)';
    }
    return 'minmax(0, 1.15fr) minmax(320px, 0.85fr)';
  });

  function patch(next: Record<string, unknown>): void {
    void onPatchState(next);
  }

  function normalizeSort(value: unknown): WorkspaceSortBy {
    if (
      value === 'newest' ||
      value === 'oldest' ||
      value === 'name' ||
      value === 'name-desc' ||
      value === 'size' ||
      value === 'size-asc'
    ) {
      return value;
    }
    return 'newest';
  }

  function toggleWorkspace(current: string, pane: WorkspacePane): WorkspaceMode {
    if (pane === 'files') {
      if (current === 'chat') return 'split';
      if (current === 'split') return 'chat';
      return 'files';
    }
    if (current === 'files') return 'split';
    if (current === 'split') return 'files';
    return 'chat';
  }

  function handleOverflowAction(value: PhoneOverflowAction): void {
    if (value === 'search') {
      workspaceActions.toggleSearch();
      return;
    }
    if (value === 'storage' || value === 'locations') {
      workspaceActions.toggleStorage();
      return;
    }
    if (value === 'share') {
      workspaceActions.openShare();
      return;
    }
    if (value === 'timeline') {
      workspaceActions.toggleTimeline();
      return;
    }
    if (value === 'flow') {
      workspaceActions.toggleFlow();
      return;
    }
    if (value === 'identities') {
      patch({ dialogSurface: 'identity' });
      return;
    }
    if (value === 'reset') {
      patch({ dialogSurface: 'reset' });
    }
  }

  function parseSizeLabel(value: string): number {
    const match = /([\d.]+)\s*(KB|MB|GB|B)/i.exec(value);
    if (!match) return 0;
    const amount = Number(match[1]);
    const unit = match[2].toUpperCase();
    if (unit === 'GB') return Math.round(amount * 1024 * 1024 * 1024);
    if (unit === 'MB') return Math.round(amount * 1024 * 1024);
    if (unit === 'KB') return Math.round(amount * 1024);
    return Math.round(amount);
  }

  function inferMimeType(filename: string): string {
    const lower = filename.toLowerCase();
    if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.gif')) return 'image/png';
    if (lower.endsWith('.mov') || lower.endsWith('.mp4')) return 'video/mp4';
    if (lower.endsWith('.m4a') || lower.endsWith('.mp3')) return 'audio/mpeg';
    if (lower.endsWith('.md') || lower.endsWith('.txt')) return 'text/plain';
    if (lower.endsWith('.json') || lower.endsWith('.js') || lower.endsWith('.ts')) return 'text/javascript';
    if (lower.endsWith('.pdf')) return 'application/pdf';
    return 'application/octet-stream';
  }

  function previewTimelineType(note: string): TimelineEvent['type'] {
    const lower = note.toLowerCase();
    if (lower.includes('identity')) return 'DECLARE_IDENTITY';
    if (lower.includes('chat')) return 'CHAT_MESSAGE';
    if (lower.includes('delete')) return 'DELETE_FILE';
    if (lower.includes('rename')) return 'RENAME_FILE';
    return 'CREATE_FILE';
  }

  function fileAccentTone(file: FileMetadata): string {
    const mime = file.mimeType ?? '';
    if (mime.startsWith('image/')) return 'accent-cyan';
    if (mime.startsWith('video/')) return 'accent-amber';
    if (mime.startsWith('audio/')) return 'accent-rose';
    if (mime.includes('javascript') || mime.includes('json') || file.filename.endsWith('.md')) return 'accent-violet';
    return 'accent-slate';
  }

  function fileIconComponent(file: FileMetadata) {
    const mime = file.mimeType ?? '';
    if (mime.startsWith('image/')) return ImageIcon;
    if (mime.startsWith('video/')) return FileVideo;
    if (mime.startsWith('audio/')) return FileAudio;
    if (mime.includes('javascript') || mime.includes('json') || file.filename.endsWith('.md')) return FileCode2;
    if (file.filename.endsWith('.zip')) return FileArchive;
    return FileText;
  }

  function isFileSelected(filename: string): boolean {
    return selectedPreviewFilename === filename;
  }

  function columnSortState(column: 'name' | 'size' | 'date'): string {
    const sort = normalizeSort(uiState.sortBy ?? studioState.stylesSortValue);
    if (column === 'name' && (sort === 'name' || sort === 'name-desc')) return sort === 'name' ? 'asc' : 'desc';
    if (column === 'size' && (sort === 'size' || sort === 'size-asc')) return sort === 'size' ? 'desc' : 'asc';
    if (column === 'date' && (sort === 'newest' || sort === 'oldest')) return sort === 'newest' ? 'desc' : 'asc';
    return 'none';
  }

  function formatSize(value: number): string {
    if (value >= 1024 * 1024 * 1024) return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
    if (value >= 1024) return `${Math.round(value / 1024)} KB`;
    return `${value} B`;
  }

  function formatDate(value: number): string {
    return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(value);
  }

  function formatRelativeDay(value: number): string {
    return formatDate(value);
  }

  function displayFileName(file: FileMetadata): string {
    return file.filename;
  }

  function timelineKindLabel(event: TimelineEvent): string {
    if (event.type === 'DECLARE_IDENTITY') return 'Identity';
    if (event.type === 'CHAT_MESSAGE') return 'Chat';
    if (event.type === 'DELETE_FILE') return 'Delete';
    if (event.type === 'RENAME_FILE') return 'Rename';
    return 'Create';
  }

  function timelineHeadline(event: TimelineEvent): string {
    return event.filename;
  }

  function timelineTitle(event: TimelineEvent): string {
    return `${timelineKindLabel(event)} · ${event.filename}`;
  }

  function formatShortDate(value: number): string {
    return new Intl.DateTimeFormat('en', {
      hour: '2-digit',
      minute: '2-digit',
      month: 'short',
      day: 'numeric',
    }).format(value);
  }

  function isTimelineIdentityEvent(event: TimelineEvent): boolean {
    return event.type === 'DECLARE_IDENTITY';
  }

  function isTimelineChatEvent(event: TimelineEvent): boolean {
    return event.type === 'CHAT_MESSAGE';
  }
</script>

<section class="studio-panel runtime-shell">
  <div class="ui-page-header">
    <div>
      <h2>{page === 'styles' ? 'Toolkit' : isPhone ? 'Phone UI' : 'Desktop UI'}</h2>
      <p>
        {page === 'styles'
          ? 'The shared shell contract, workspace surfaces, and dialogs rendered from the design system.'
          : 'This preview uses the same shared shell contract that the app now uses, with studio data driving real surfaces.'}
      </p>
    </div>
  </div>

  <div class:device-frame={page !== 'styles'} class:desktop={page === 'desktop'} class:phone={isPhone}>
    <div class="ui-shell runtime-device" class:phone-shell={isPhone}>
      <WorkspaceShell
        isDevThemeStudio={false}
        themeLogoOptions={themeSettings.logo}
        paletteLabel={String(studioState.moodboardId ?? '')}
        activeMountId={String(studioState.hubId ?? '')}
        {mounts}
        draggingMounts={false}
        isHeaderHovering={isHeaderHovering}
        setHeaderHovering={(value) => {
          isHeaderHovering = value;
        }}
        isSecretDropTarget={false}
        canHandleSecretDropPayload={() => false}
        setSecretDropTarget={() => {}}
        onSecretFileDrop={() => {}}
        onSelectMount={(mountId) => patch({ hubId: mountId })}
        onOpenCreateChooser={() => patch({ dialogSurface: 'create' })}
        showPhoneOverflowMenu={uiState.phoneMenuOpen}
        bind:phoneOverflowMenuButtonElement
        bind:phoneOverflowMenuElement
        showIdentityManager={uiState.dialogSurface === 'identity'}
        showResetAction={true}
        showResetDialog={uiState.dialogSurface === 'reset'}
        showSourcesPanel={uiState.secondary === 'locations'}
        onTogglePhoneOverflowMenu={() => patch({ phoneMenuOpen: !uiState.phoneMenuOpen })}
        onOpenIdentityManager={() => patch({ dialogSurface: 'identity' })}
        onOpenResetDialog={() => patch({ dialogSurface: 'reset' })}
        onToggleSourcesPanel={() =>
          patch({
            secondary: uiState.secondary === 'locations' ? 'none' : 'locations',
            storageMode: 'global',
          })}
        workspaceState={workspaceChromeState}
        workspaceActions={workspaceActions}
        mode={previewStageMode}
        isVolumeWorkspaceActive={previewStageMode === 'workspace'}
        showEventFlowPanel={uiState.secondary === 'flow'}
        onCloseFlow={() => patch({ secondary: 'none' })}
      >
        {#snippet mountRailChildren()}
          {#each mounts as mount (mount.id)}
            <button
              type="button"
              class="studio-mount-chip"
              class:active={mount.id === studioState.hubId}
              onclick={() => patch({ hubId: mount.id })}
            >
              {mount.label}
            </button>
          {/each}
        {/snippet}

        {#snippet mountRailActions()}
          <button type="button" class="studio-mount-add" onclick={() => patch({ dialogSurface: 'create' })}>+</button>
        {/snippet}

        {#snippet globalPanel()}
          {@key `storage-global:${activeHub.id}`}
            <StoragePanel
              mode="global"
              volumeId={null}
              {knownVolumes}
              onOpenVolumeRouting={(volumeId) => {
                patch({ hubId: volumeId, secondary: 'locations', storageMode: 'volume' });
              }}
              onOpenStorageSetup={() => {
                patch({ secondary: 'locations', storageMode: 'global' });
              }}
            />
          {/key}
        {/snippet}

        {#snippet volumePanel()}
          {@key `storage-volume:${activeHub.id}`}
            <StoragePanel
              mode="volume"
              volumeId={activeHub.id}
              currentVolumePresentation={currentVolumePresentation}
              {knownVolumes}
              onOpenVolumeRouting={(volumeId) => {
                patch({ hubId: volumeId, secondary: 'locations', storageMode: 'volume' });
              }}
              onOpenStorageSetup={() => {
                patch({ secondary: 'locations', storageMode: 'global' });
              }}
            />
          {/key}
        {/snippet}

        {#snippet emptyState()}
          <EmptyStatePanel
            showBrand={true}
            themeLogoOptions={themeSettings.logo}
            eyebrow={activeHub.name}
            title="No files yet"
            subtitle="Drop files here to add them"
          />
        {/snippet}

        {#snippet workspaceLead()}
          {#if uiState.timelineOpen}
            <TimeMachinePanel
              timelineMarker={`${previewTimelinePosition}/${previewTimelineEvents.length} applied`}
              isTimelinePlaying={false}
              isTimelineLoading={false}
              timelineEvents={previewTimelineEvents}
              timelinePosition={previewTimelinePosition}
              bind:timelineEventsElement={previewTimelineEventsElement}
              {timelineKindLabel}
              {timelineHeadline}
              {timelineTitle}
              {formatShortDate}
              {isTimelineIdentityEvent}
              {isTimelineChatEvent}
              onTogglePlayback={() => {}}
              onJumpToLatest={() => {
                previewTimelinePosition = previewTimelineEvents.length;
              }}
              onSetTimelinePosition={(value) => {
                previewTimelinePosition = value;
              }}
              onJumpToEvent={(index) => {
                previewTimelinePosition = index + 1;
              }}
              onOpenDetails={() => {}}
              onScroll={() => {}}
            />
          {/if}
        {/snippet}

        {#snippet workspaceMain()}
          <div class="preview-workspace-panels" style:grid-template-columns={previewWorkspaceColumns}>
            {#if workspaceChromeState.showFilesWorkspace}
              <div class="preview-workspace-pane">
                <FileManagerWorkspace
                  viewFiles={previewFiles}
                  visibleFiles={visiblePreviewFiles}
                  isLoading={false}
                  fileManagerViewMode={workspaceChromeState.fileManagerViewMode}
                  showPreviewPane={false}
                  fileManagerTemplate="1fr"
                  thumbnailUrls={new Map()}
                  currentPreviewFile={selectedPreviewFile}
                  selectedFile={selectedPreviewFile}
                  previewFileOverride={null}
                  previewKind="none"
                  previewUrl=""
                  previewText=""
                  previewLoading={false}
                  previewError=""
                  renamingFileName={null}
                  renameDraft=""
                  isHistoryMode={false}
                  {fileAccentTone}
                  {fileIconComponent}
                  {isFileSelected}
                  {columnSortState}
                  {formatSize}
                  {formatDate}
                  {formatRelativeDay}
                  {displayFileName}
                  onActivate={() => {}}
                  onToggleColumnSort={(column) => {
                    patch({
                      stylesSortValue: column === 'name' ? 'name' : column === 'size' ? 'size' : 'newest',
                    });
                  }}
                  onFilePointerSelect={(_event, file) => {
                    selectedPreviewFilename = file.filename;
                  }}
                  onOpenPreview={(file) => {
                    selectedPreviewFilename = file.filename;
                  }}
                  onDragStart={() => {}}
                  onFileRowKeydown={() => {}}
                  onStartRenaming={() => {}}
                  onRenameDraftChange={() => {}}
                  onCommitRename={() => {}}
                  onCancelRenaming={() => {}}
                  onClearSelection={() => {
                    selectedPreviewFilename = null;
                  }}
                  onStartResize={() => {}}
                  onDelete={() => {}}
                  onDownload={() => {}}
                  onClosePreview={() => {}}
                >
                  {#snippet empty()}
                    <EmptyStatePanel
                      title="No files yet"
                      subtitle="Drop files here to add them"
                    />
                  {/snippet}
                </FileManagerWorkspace>
              </div>
            {/if}

            {#if workspaceChromeState.showChatWorkspace}
              <div class="preview-workspace-pane">
                <VolumeChat
                  auth={studioAuth}
                  volumeId={activeHub.id}
                  readonlyMode={false}
                  historyState={null}
                  activeIdentity={selectedChatIdentity}
                  identityNeedsPublish={false}
                  onOpenIdentityManager={() => patch({ dialogSurface: 'identity' })}
                  onEnsureIdentityPublished={async () => true}
                  onPreviewAttachment={() => {}}
                  onChatMutated={() => {}}
                  externalRefreshVersion={0}
                />
              </div>
            {/if}
          </div>
        {/snippet}

        {#snippet flowPanel()}
          {@key `flow:${activeHub.id}`}
            <EventFlowPanel auth={studioAuth} volumeId={activeHub.id} />
          {/key}
        {/snippet}
      </WorkspaceShell>
    </div>
  </div>

  {#if page === 'styles'}
    <div class="runtime-toolkit-grid">
      <div class="style-card">
        <h3 class="section-title">Status</h3>
        <div class="runtime-stack">
          <StatusNotice
            tone="info"
            title="Shared shell contract"
            message="Desktop, phone, and the app all render the same shared shell and the same shared surfaces."
          />
          <StatusNotice
            tone="info"
            compact={true}
            message="Storage and flow now come from the shared Svelte surfaces running on the mocked design runtime."
          />
        </div>
      </div>
      <div class="style-card">
        <h3 class="section-title">Dialogs</h3>
        <p class="mood-note">
          Use the shell state controls to open the real create, join, share, identity, and reset dialogs.
        </p>
      </div>
    </div>
  {/if}

  {#if uiState.dialogSurface === 'create'}
    <CreateChooserDialog
      onClose={() => patch({ dialogSurface: 'none' })}
      onCreateHub={() => patch({ dialogSurface: 'none' })}
      onCreateIdentity={() => patch({ dialogSurface: 'identity' })}
      onPasteLink={() => patch({ dialogSurface: 'join' })}
    />
  {/if}

  {#if uiState.dialogSurface === 'join'}
    <JoinDialog
      serialized={joinSerialized}
      onSerializedInput={(value) => {
        joinSerialized = value;
      }}
      onReadClipboard={() => {
        joinSerialized = 'nearbytes://join?data=clipboard-preview-token';
      }}
      onOpenLink={() => {}}
      onClose={() => patch({ dialogSurface: 'none' })}
    />
  {/if}

  {#if uiState.dialogSurface === 'share'}
    <ShareDialog
      canCopySecretLink={true}
      shareLinkBusy={false}
      {shareLinkFeedback}
      onCopyShareLink={async () => {
        shareLinkFeedback = { tone: 'success', message: 'Share link copied in studio preview.' };
      }}
      onManageStorage={() => patch({ secondary: 'locations', storageMode: 'volume' })}
      onClose={() => patch({ dialogSurface: 'none' })}
    />
  {/if}

  {#if uiState.dialogSurface === 'identity'}
    <IdentityManagerDialog
      {configuredIdentities}
      activeChatIdentityId={selectedIdentityId}
      currentVolumeChatIdentityId="ada"
      joinedChatIdentityNeedsPublish={false}
      selectedChatIdentityNeedsPublish={selectedIdentityId === 'reader'}
      {selectedChatIdentity}
      selectedChatIdentityStatus={{
        tone: 'info',
        title: 'Studio identity preview',
        detail: 'This dialog renders the real shared identity surface with preview data.',
      }}
      selectedSecretPreviewUrl={null}
      selectedSecretIsImage={false}
      selectedAvatarLabel="AB"
      errorMessage=""
      successMessage=""
      identityManagerLoading={false}
      identityManagerAction="idle"
      activeHubAuth={true}
      isHistoryMode={false}
      onClose={() => patch({ dialogSurface: 'none' })}
      onAddIdentity={() => {}}
      onSelectIdentity={(identityId) => {
        selectedIdentityId = identityId;
      }}
      onSecretValueInput={() => {}}
      onSecretPasswordInput={() => {}}
      onSecretFileSelected={() => {}}
      onClearSecretFile={() => {}}
      onAvatarFileSelected={() => {}}
      onClearAvatar={() => {}}
      onDisplayNameInput={() => {}}
      onBioInput={() => {}}
      onRemoveIdentity={() => {}}
      onPublish={() => {}}
      onJoin={() => {}}
    />
  {/if}

  {#if uiState.dialogSurface === 'reset'}
    <ResetDialog
      deleteLocalData={resetDeleteLocalData}
      busy={false}
      errorMessage=""
      onDeleteLocalDataChange={(value) => {
        resetDeleteLocalData = value;
      }}
      onCancel={() => patch({ dialogSurface: 'none' })}
      onConfirm={() => patch({ dialogSurface: 'none' })}
    />
  {/if}
</section>

<style>
  .runtime-shell {
    display: grid;
    gap: 1rem;
  }

  .ui-page-header h2 {
    margin: 0;
    font-family: var(--nb-font-display, 'Iowan Old Style', serif);
    letter-spacing: -0.03em;
  }

  .ui-page-header p,
  .mood-note {
    margin: 0.25rem 0 0;
    color: var(--nb-text-soft, rgba(70, 70, 73, 0.84));
    line-height: 1.55;
  }

  .runtime-device {
    min-height: 720px;
    overflow: hidden;
    border-radius: 28px;
    border: 1px solid var(--nb-border, rgba(60, 60, 67, 0.12));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 96%, white);
    box-shadow: var(--nb-shadow-lg, 0 28px 70px rgba(34, 25, 18, 0.12));
    display: flex;
    flex-direction: column;
  }

  .runtime-device.phone-shell {
    min-height: 780px;
  }

  .studio-mount-chip,
  .studio-mount-add {
    appearance: none;
    min-height: 34px;
    padding: 0 0.8rem;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 88%, transparent);
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 96%, rgba(255, 255, 255, 0.9));
    color: var(--nb-text-main, rgba(28, 28, 30, 0.94));
    font: inherit;
    font-size: 0.78rem;
    font-weight: 600;
    cursor: pointer;
  }

  .studio-mount-chip.active {
    background: color-mix(in srgb, var(--nb-accent-soft, rgba(36, 94, 145, 0.12)) 88%, white);
    color: var(--nb-accent-strong, #164162);
    border-color: color-mix(in srgb, var(--nb-accent, #245e91) 28%, transparent);
  }

  .studio-mount-add {
    width: 34px;
    padding: 0;
  }

  .preview-workspace-panels {
    flex: 1 1 auto;
    min-height: 0;
    width: 100%;
    display: grid;
    gap: 0.75rem;
    align-items: stretch;
  }

  .preview-workspace-pane {
    min-width: 0;
    min-height: 0;
    display: flex;
    overflow: hidden;
    width: 100%;
  }

  .runtime-toolkit-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 1rem;
  }

  .runtime-stack {
    display: grid;
    gap: 0.75rem;
  }

  .style-card {
    padding: 1rem;
    border-radius: var(--nb-radius-lg, 18px);
    border: 1px solid var(--nb-border, rgba(60, 60, 67, 0.12));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 96%, white);
    box-shadow: var(--nb-shadow-sm, 0 10px 24px rgba(34, 25, 18, 0.06));
  }

  .section-title {
    margin: 0 0 0.65rem;
    font-family: var(--nb-font-display, 'Iowan Old Style', serif);
  }

  @media (max-width: 900px) {
    .runtime-device {
      min-height: 640px;
    }
  }
</style>
