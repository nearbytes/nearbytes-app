<script lang="ts">
  import '../lib/design/uiBridgeShared.js';
  import PhoneOverflowMenu from './components/PhoneOverflowMenu.svelte';
  import WorkspaceModeBar from './components/WorkspaceModeBar.svelte';
  import WorkspaceSearchStrip from './components/WorkspaceSearchStrip.svelte';
  import {
    createWorkspaceChromeState,
    type FileManagerViewMode,
    type WorkspaceChromeActions,
    type WorkspaceMode,
    type WorkspaceSortBy,
  } from './workspaceChrome.js';

  const bridge = (globalThis as typeof globalThis & {
    NearbytesUiBridgeShared?: {
      createAppSnapshot?: (input: Record<string, unknown>) => { surfaces: string[] };
      surfaceRegistry?: Record<string, { title: string; component: string }>;
      toolkitSections?: Array<{ id: string; title: string; surfaces: string[] }>;
    };
  }).NearbytesUiBridgeShared;

  let workspaceMode = $state<WorkspaceMode>('files');
  let viewMode = $state<FileManagerViewMode>('details');
  let searchOpen = $state(true);
  let storageOpen = $state(false);
  let shareOpen = $state(false);
  let timelineOpen = $state(false);
  let flowOpen = $state(false);
  let phoneMenuOpen = $state(true);
  let searchQuery = $state('story');
  let sortBy = $state<WorkspaceSortBy>('newest');

  const showFilesWorkspace = $derived.by(() => workspaceMode !== 'chat');
  const showChatWorkspace = $derived.by(() => workspaceMode !== 'files');
  const workspaceChromeState = $derived.by(() =>
    createWorkspaceChromeState({
      workspaceMode,
      showFilesWorkspace,
      showChatWorkspace,
      showSearchWorkspace: searchOpen,
      showVolumeStoragePanel: storageOpen,
      showVolumeShareDialog: shareOpen,
      showTimeMachinePanel: timelineOpen,
      showEventFlowPanel: flowOpen,
      fileManagerViewMode: viewMode,
      showWorkspaceUtilities: true,
      selectionSummary: '14 files · 2 selected',
      storageDisabled: false,
      searchQuery,
      sortBy,
      pasteVisible: true,
      pasteCount: 2,
      showResetAction: true,
    })
  );
  const workspaceChromeActions: WorkspaceChromeActions = {
    applyWorkspaceMode: (mode) => {
      workspaceMode = mode;
    },
    toggleWorkspacePane: (pane) => {
      workspaceMode = pane;
    },
    toggleSearch: () => {
      searchOpen = !searchOpen;
    },
    toggleStorage: () => {
      storageOpen = !storageOpen;
    },
    openShare: () => {
      shareOpen = !shareOpen;
    },
    toggleTimeline: () => {
      timelineOpen = !timelineOpen;
    },
    toggleFlow: () => {
      flowOpen = !flowOpen;
    },
    setViewMode: (mode) => {
      viewMode = mode;
    },
    setSearchQuery: (value) => {
      searchQuery = value;
    },
    setSortBy: (value) => {
      sortBy = value;
    },
    paste: () => undefined,
    overflowAction: (value) => {
      if (value === 'search') searchOpen = !searchOpen;
      if (value === 'storage') storageOpen = !storageOpen;
      if (value === 'share') shareOpen = !shareOpen;
      if (value === 'timeline') timelineOpen = !timelineOpen;
      if (value === 'flow') flowOpen = !flowOpen;
    },
  };
  const snapshot = $derived.by(() =>
    bridge?.createAppSnapshot?.({
      mountCount: 3,
      workspaceMode: workspaceChromeState.workspaceMode,
      showFilesWorkspace: workspaceChromeState.showFilesWorkspace,
      showChatWorkspace: workspaceChromeState.showChatWorkspace,
      showSearchWorkspace: workspaceChromeState.showSearchWorkspace,
      fileManagerViewMode: workspaceChromeState.fileManagerViewMode,
      fileCount: 14,
      selectedCount: 2,
      searchQuery: workspaceChromeState.searchQuery,
      showPreviewPane: workspaceChromeState.showFilesWorkspace,
      showTimeMachinePanel: workspaceChromeState.showTimeMachinePanel,
      timelineCount: 18,
      timelinePosition: 18,
      timelineDetailOpen: workspaceChromeState.showTimeMachinePanel,
      showSourcesPanel: false,
      showVolumeStoragePanel: workspaceChromeState.showVolumeStoragePanel,
      showEventFlowPanel: workspaceChromeState.showEventFlowPanel,
      showPhoneOverflowMenu: phoneMenuOpen,
      showIdentityManager: false,
      showCreateChooser: false,
      showJoinVolumeDialog: false,
      showVolumeShareDialog: workspaceChromeState.showVolumeShareDialog,
      showResetDialog: false,
      activeModal: workspaceChromeState.showVolumeShareDialog ? 'share' : 'none',
    }) ?? { surfaces: [] }
  );
</script>

<svelte:head>
  <title>Nearbytes Design Studio</title>
</svelte:head>

<div class="design-studio">
  <header class="studio-header">
    <div>
      <p class="studio-eyebrow">Nearbytes design host</p>
      <h1>Runtime surfaces from shared design components</h1>
      <p class="studio-copy">These controls are the same Svelte files the app imports.</p>
    </div>
    <div class="studio-active-surfaces">
      {#each snapshot.surfaces as surfaceId}
        <span class="surface-chip">{bridge?.surfaceRegistry?.[surfaceId]?.title ?? surfaceId}</span>
      {/each}
    </div>
  </header>

  <section class="studio-controls">
    <button class:active={workspaceMode === 'files'} onclick={() => (workspaceMode = 'files')}>Files</button>
    <button class:active={workspaceMode === 'chat'} onclick={() => (workspaceMode = 'chat')}>Chat</button>
    <button class:active={workspaceMode === 'split'} onclick={() => (workspaceMode = 'split')}>Split</button>
    <button class:active={searchOpen} onclick={() => (searchOpen = !searchOpen)}>Search</button>
    <button class:active={storageOpen} onclick={() => (storageOpen = !storageOpen)}>Storage</button>
    <button class:active={shareOpen} onclick={() => (shareOpen = !shareOpen)}>Share</button>
    <button class:active={timelineOpen} onclick={() => (timelineOpen = !timelineOpen)}>Timeline</button>
    <button class:active={flowOpen} onclick={() => (flowOpen = !flowOpen)}>Flow</button>
    <button class:active={phoneMenuOpen} onclick={() => (phoneMenuOpen = !phoneMenuOpen)}>Phone menu</button>
  </section>

  <div class="studio-grid">
    <section class="studio-surface desktop">
      <div class="surface-head">
        <strong>Desktop shell preview</strong>
        <span>Uses shared workspace chrome components</span>
      </div>
      <WorkspaceModeBar
        state={workspaceChromeState}
        actions={workspaceChromeActions}
      />
      {#if workspaceChromeState.showFilesWorkspace && workspaceChromeState.showSearchWorkspace}
        <WorkspaceSearchStrip state={workspaceChromeState} actions={workspaceChromeActions} />
      {/if}
      <div class="surface-body">
        <div class="mock-panel">
          <strong>Files</strong>
          <span>{workspaceChromeState.fileManagerViewMode === 'icons' ? 'Icon view' : 'Details view'} · {workspaceChromeState.searchQuery || 'no query'}</span>
        </div>
        <div class="mock-panel secondary">
          <strong>{workspaceChromeState.showEventFlowPanel ? 'Event flow' : workspaceChromeState.showVolumeStoragePanel ? 'Hub storage' : workspaceChromeState.showVolumeShareDialog ? 'Share dialog' : workspaceChromeState.showChatWorkspace ? 'Chat companion' : 'Preview pane'}</strong>
          <span>{workspaceChromeState.showTimeMachinePanel ? 'Timeline active' : 'Runtime shell preview'}</span>
        </div>
      </div>
    </section>

    <section class="studio-surface phone">
      <div class="surface-head">
        <strong>Phone actions preview</strong>
        <span>Same overflow component used by the runtime header</span>
      </div>
      {#if phoneMenuOpen}
        <PhoneOverflowMenu state={workspaceChromeState} actions={workspaceChromeActions} />
      {/if}
    </section>
  </div>

  <section class="registry-panel">
    <div class="surface-head">
      <strong>Imported registry</strong>
      <span>{bridge?.toolkitSections?.length ?? 0} sections</span>
    </div>
    <div class="registry-grid">
      {#each bridge?.toolkitSections ?? [] as section}
        <article class="registry-card">
          <h2>{section.title}</h2>
          <div class="registry-list">
            {#each section.surfaces as surfaceId}
              <div class="registry-row">
                <strong>{bridge?.surfaceRegistry?.[surfaceId]?.title ?? surfaceId}</strong>
                <span>{bridge?.surfaceRegistry?.[surfaceId]?.component ?? 'Component'}</span>
              </div>
            {/each}
          </div>
        </article>
      {/each}
    </div>
  </section>
</div>

<style>
  .design-studio {
    min-height: 100vh;
    padding: var(--nb-space-page, 24px);
    display: grid;
    gap: var(--nb-space-panel-gap, 18px);
  }

  .studio-header,
  .studio-controls,
  .studio-surface,
  .registry-panel,
  .registry-card,
  .mock-panel {
    border: 1px solid color-mix(in srgb, var(--ds-line, rgba(148, 163, 184, 0.18)) 100%, transparent);
    background: var(--ds-card-bg, rgba(255, 255, 255, 0.84));
    border-radius: var(--nb-radius-xl, 22px);
    box-shadow: var(--nb-shadow-lg, 0 24px 60px rgba(15, 23, 42, 0.08));
    backdrop-filter: blur(var(--nb-surface-blur, 18px));
  }

  .studio-header,
  .studio-controls,
  .studio-surface,
  .registry-panel {
    padding: var(--nb-space-panel-padding, 20px);
  }

  .studio-header {
    display: grid;
    gap: 12px;
  }

  .studio-eyebrow {
    margin: 0;
    font-size: 12px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--ds-muted, #64748b);
  }

  .studio-header h1,
  .registry-card h2 {
    margin: 0;
    font-family: var(--nb-font-display, 'Iowan Old Style', 'Palatino Linotype', serif);
    letter-spacing: -0.03em;
  }

  .studio-copy,
  .surface-head span,
  .registry-row span,
  .mock-panel span {
    margin: 0;
    color: var(--ds-muted, #5b6878);
  }

  .studio-active-surfaces,
  .studio-controls,
  .surface-body,
  .registry-grid,
  .registry-list {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }

  .surface-chip,
  .studio-controls button {
    min-height: 34px;
    padding: 0 14px;
    border-radius: var(--nb-radius-pill, 999px);
    border: 1px solid color-mix(in srgb, var(--ds-line, rgba(148, 163, 184, 0.18)) 100%, transparent);
    background: color-mix(in srgb, var(--ds-panel-bg, rgba(255, 255, 255, 0.9)) 96%, white);
    font: inherit;
  }

  .studio-controls button.active {
    background: var(--ds-accent, #0f6fb7);
    color: white;
    border-color: color-mix(in srgb, var(--ds-accent, #0f6fb7) 32%, transparent);
  }

  .studio-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.5fr) minmax(320px, 0.7fr);
    gap: 18px;
    align-items: start;
  }

  .studio-surface {
    display: grid;
    gap: 14px;
  }

  .surface-head {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    align-items: center;
  }

  .surface-body {
    display: grid;
    grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr);
  }

  .mock-panel {
    padding: 16px;
    display: grid;
    gap: 8px;
  }

  .mock-panel.secondary {
    background: linear-gradient(135deg, color-mix(in srgb, var(--ds-accent-soft, rgba(14, 165, 233, 0.12)) 92%, transparent), color-mix(in srgb, var(--ds-paper, rgba(255, 255, 255, 0.88)) 92%, white));
  }

  .registry-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .registry-card {
    padding: 16px;
    display: grid;
    gap: 12px;
  }

  .registry-row {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 12px;
    border-radius: var(--nb-radius-md, 14px);
    background: color-mix(in srgb, var(--ds-panel, rgba(255, 255, 255, 0.72)) 96%, white);
  }

  @media (max-width: 980px) {
    .studio-grid,
    .surface-body,
    .registry-grid {
      grid-template-columns: 1fr;
    }
  }
</style>