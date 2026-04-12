<script lang="ts">
  import AppHeader from '../system/components/AppHeader.svelte';
  import CreateChooserDialog from '../system/components/CreateChooserDialog.svelte';
  import EmptyStatePanel from '../system/components/EmptyStatePanel.svelte';
  import IdentityManagerDialog from '../system/components/IdentityManagerDialog.svelte';
  import JoinDialog from '../system/components/JoinDialog.svelte';
  import ResetDialog from '../system/components/ResetDialog.svelte';
  import ShareDialog from '../system/components/ShareDialog.svelte';
  import StatusNotice from '../system/components/StatusNotice.svelte';
  import WorkspaceModeBar from '../system/components/WorkspaceModeBar.svelte';
  import WorkspaceSearchStrip from '../system/components/WorkspaceSearchStrip.svelte';
  import WorkspaceStage from '../system/components/WorkspaceStage.svelte';
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
  import { defaultThemeRegistry, defaultThemeSettings } from '../../../../ui/src/lib/branding.js';

  let {
    page = 'desktop',
    data,
    state,
    uiState,
    onPatchState,
  }: {
    page?: 'styles' | 'desktop' | 'phone';
    data: any;
    state: any;
    uiState: any;
    onPatchState: (patch: Record<string, unknown>) => Promise<void> | void;
  } = $props();

  const themeRegistry = defaultThemeRegistry();
  const themeSettings = defaultThemeSettings(themeRegistry);

  let phoneOverflowMenuButtonElement = $state<HTMLElement | null>(null);
  let phoneOverflowMenuElement = $state<HTMLElement | null>(null);
  let isHeaderHovering = $state(false);
  let resetDeleteLocalData = $state(false);
  let selectedIdentityId = $state('ada');
  let joinSerialized = $state('nearbytes://join?data=studio-preview-token');
  let shareLinkFeedback = $state<{ tone: 'success' | 'warning'; message: string } | null>(null);

  const isPhone = $derived(page === 'phone');
  const activeHub = $derived(data.hubs.find((hub: any) => hub.id === state.hubId) ?? data.hubs[0]);
  const mounts = $derived(
    data.hubs.map((hub: any) => ({
      id: hub.id,
      label: hub.name,
    }))
  );

  const configuredIdentities = $derived([
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
      publicKey: '',
      secretFileName: '',
      secretFileMimeType: '',
      avatarDataUrl: '',
    },
  ]);

  const selectedChatIdentity = $derived(
    configuredIdentities.find((identity) => identity.id === selectedIdentityId) ?? configuredIdentities[0] ?? null
  );

  const workspaceChromeState = $derived(
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
        fileCount: activeHub.files.length,
        selectedCount: 1,
        selectedLabel: activeHub.files[0]?.name ?? 'Draft notes.pdf',
      }),
      storageDisabled: false,
      searchQuery: state.stylesSearchText ?? '',
      sortBy: normalizeSort(uiState.sortBy ?? state.stylesSortValue),
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
      patch({ workspace: toggleWorkspace(uiState.workspace, pane) });
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

  function patch(next: Record<string, unknown>): void {
    void onPatchState(next);
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

  function runtimeTitle(): string {
    if (uiState.workspace === 'chat') {
      return `Chat preview for ${activeHub.name}`;
    }
    if (uiState.workspace === 'split') {
      return `Split workspace for ${activeHub.name}`;
    }
    return `Files preview for ${activeHub.name}`;
  }
</script>

<section class="studio-panel runtime-shell">
  <div class="ui-page-header">
    <div>
      <h2>{page === 'styles' ? 'Toolkit' : isPhone ? 'Phone UI' : 'Desktop UI'}</h2>
      <p>
        {page === 'styles'
          ? 'Real shared surfaces, dialogs, and shell controls rendered from the design system.'
          : 'This preview uses the real shared Nearbytes design-system surfaces instead of fake studio HTML.'}
      </p>
    </div>
  </div>

  <div class:device-frame={page !== 'styles'} class:desktop={page === 'desktop'} class:phone={isPhone}>
    <div class="ui-shell runtime-device" class:phone-shell={isPhone}>
      <AppHeader
        isDevThemeStudio={false}
        themeLogoOptions={themeSettings.logo}
        paletteLabel={state.moodboardId}
        activeMountId={state.hubId}
        mounts={mounts}
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
      >
        {#snippet mountRailChildren()}
          {#each mounts as mount (mount.id)}
            <button
              type="button"
              class="studio-mount-chip"
              class:active={mount.id === state.hubId}
              onclick={() => patch({ hubId: mount.id })}
            >
              {mount.label}
            </button>
          {/each}
        {/snippet}
        {#snippet mountRailActions()}
          <button type="button" class="studio-mount-add" onclick={() => patch({ dialogSurface: 'create' })}>+</button>
        {/snippet}
      </AppHeader>

      <div class="runtime-body">
        <WorkspaceModeBar state={workspaceChromeState} actions={workspaceActions} />

        {#if workspaceChromeState.showSearchWorkspace}
          <WorkspaceSearchStrip state={workspaceChromeState} actions={workspaceActions} />
        {/if}

        <WorkspaceStage
          mode="empty"
          isVolumeWorkspaceActive={true}
          showEventFlowPanel={false}
          onCloseFlow={() => {}}
        >
          {#snippet emptyState()}
            <EmptyStatePanel
              showBrand={true}
              themeLogoOptions={themeSettings.logo}
              eyebrow={activeHub.name}
              title={runtimeTitle()}
              subtitle="This preview is rendered from the shared Nearbytes design-system surfaces."
            />
          {/snippet}
        </WorkspaceStage>
      </div>
    </div>
  </div>

  {#if page === 'styles'}
    <div class="runtime-toolkit-grid">
      <div class="style-card">
        <h3 class="section-title">Status</h3>
        <div class="runtime-stack">
          <StatusNotice tone="info" title="Shared surface" message="This notice is rendered from the real design-system component." />
          <StatusNotice tone="warning" compact={true} message="The red badge/border means dev context is on." />
        </div>
      </div>
      <div class="style-card">
        <h3 class="section-title">Dialogs</h3>
        <p class="mood-note">Use the shell state controls to open real create, join, share, identity, and reset dialogs.</p>
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
        detail: 'This dialog now renders the real shared design-system surface.',
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
    font-family: var(--font-display, var(--nb-font-display, 'Iowan Old Style', serif));
    letter-spacing: -0.03em;
  }

  .ui-page-header p {
    margin: 0.25rem 0 0;
    color: var(--muted, var(--nb-text-soft, rgba(70, 70, 73, 0.84)));
    line-height: 1.55;
  }

  .runtime-device {
    min-height: 720px;
    overflow: hidden;
    border-radius: 28px;
    border: 1px solid var(--line, var(--nb-border, rgba(60, 60, 67, 0.12)));
    background: var(--paper, color-mix(in srgb, var(--nb-panel-bg, #ffffff) 92%, white));
    box-shadow: var(--shadow-lg, var(--nb-shadow-lg, 0 28px 70px rgba(34, 25, 18, 0.12)));
  }

  .runtime-device.phone-shell {
    min-height: 780px;
  }

  .runtime-body {
    display: grid;
    gap: 0.6rem;
    min-height: 0;
    height: 100%;
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

  .runtime-toolkit-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 1rem;
  }

  .runtime-stack {
    display: grid;
    gap: 0.75rem;
  }

  @media (max-width: 900px) {
    .runtime-device {
      min-height: 640px;
    }
  }
</style>
