<script lang="ts">
  import '../lib/design/uiBridgeShared.js';
  import PhoneOverflowMenu from './components/PhoneOverflowMenu.svelte';
  import WorkspaceModeBar from './components/WorkspaceModeBar.svelte';
  import WorkspaceSearchStrip from './components/WorkspaceSearchStrip.svelte';

  type WorkspaceMode = 'files' | 'chat' | 'split';
  type ViewMode = 'icons' | 'details';

  const bridge = (globalThis as typeof globalThis & {
    NearbytesUiBridgeShared?: {
      createAppSnapshot?: (input: Record<string, unknown>) => { surfaces: string[] };
      surfaceRegistry?: Record<string, { title: string; component: string }>;
      toolkitSections?: Array<{ id: string; title: string; surfaces: string[] }>;
    };
  }).NearbytesUiBridgeShared;

  let workspaceMode = $state<WorkspaceMode>('files');
  let viewMode = $state<ViewMode>('details');
  let searchOpen = $state(true);
  let storageOpen = $state(false);
  let shareOpen = $state(false);
  let timelineOpen = $state(false);
  let flowOpen = $state(false);
  let phoneMenuOpen = $state(true);
  let searchQuery = $state('story');
  let sortBy = $state<'newest' | 'oldest' | 'name' | 'name-desc' | 'size' | 'size-asc'>('newest');

  const showFilesWorkspace = $derived.by(() => workspaceMode !== 'chat');
  const showChatWorkspace = $derived.by(() => workspaceMode !== 'files');
  const snapshot = $derived.by(() =>
    bridge?.createAppSnapshot?.({
      mountCount: 3,
      workspaceMode,
      showFilesWorkspace,
      showChatWorkspace,
      showSearchWorkspace: searchOpen,
      fileManagerViewMode: viewMode,
      fileCount: 14,
      selectedCount: 2,
      searchQuery,
      showPreviewPane: showFilesWorkspace,
      showTimeMachinePanel: timelineOpen,
      timelineCount: 18,
      timelinePosition: 18,
      timelineDetailOpen: timelineOpen,
      showSourcesPanel: false,
      showVolumeStoragePanel: storageOpen,
      showEventFlowPanel: flowOpen,
      showPhoneOverflowMenu: phoneMenuOpen,
      showIdentityManager: false,
      showCreateChooser: false,
      showJoinVolumeDialog: false,
      showVolumeShareDialog: shareOpen,
      showResetDialog: false,
      activeModal: shareOpen ? 'share' : 'none',
    }) ?? { surfaces: [] }
  );

  function selectionSummary(): string {
    return '14 files · 2 selected';
  }
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
        {showFilesWorkspace}
        {showChatWorkspace}
        showSearchWorkspace={searchOpen}
        showVolumeStoragePanel={storageOpen}
        showVolumeShareDialog={shareOpen}
        showTimeMachinePanel={timelineOpen}
        showEventFlowPanel={flowOpen}
        fileManagerViewMode={viewMode}
        showWorkspaceUtilities={true}
        selectionSummary={selectionSummary()}
        storageDisabled={false}
        onApplyWorkspaceMode={(mode) => (workspaceMode = mode)}
        onToggleWorkspacePane={(pane) => (workspaceMode = pane)}
        onToggleSearch={() => (searchOpen = !searchOpen)}
        onToggleStorage={() => (storageOpen = !storageOpen)}
        onOpenShare={() => (shareOpen = !shareOpen)}
        onToggleTimeline={() => (timelineOpen = !timelineOpen)}
        onToggleFlow={() => (flowOpen = !flowOpen)}
        onSetViewMode={(mode) => (viewMode = mode)}
      />
      {#if searchOpen && showFilesWorkspace}
        <WorkspaceSearchStrip bind:searchQuery bind:sortBy pasteVisible={true} pasteCount={2} onPaste={() => undefined} />
      {/if}
      <div class="surface-body">
        <div class="mock-panel">
          <strong>Files</strong>
          <span>{viewMode === 'icons' ? 'Icon view' : 'Details view'} · {searchQuery || 'no query'}</span>
        </div>
        <div class="mock-panel secondary">
          <strong>{flowOpen ? 'Event flow' : storageOpen ? 'Hub storage' : shareOpen ? 'Share dialog' : showChatWorkspace ? 'Chat companion' : 'Preview pane'}</strong>
          <span>{timelineOpen ? 'Timeline active' : 'Runtime shell preview'}</span>
        </div>
      </div>
    </section>

    <section class="studio-surface phone">
      <div class="surface-head">
        <strong>Phone actions preview</strong>
        <span>Same overflow component used by the runtime header</span>
      </div>
      {#if phoneMenuOpen}
        <PhoneOverflowMenu
          showFilesWorkspace={showFilesWorkspace}
          showSearchWorkspace={searchOpen}
          showVolumeStoragePanel={storageOpen}
          showTimeMachinePanel={timelineOpen}
          showEventFlowPanel={flowOpen}
          showResetAction={true}
          onAction={(value) => {
            if (value === 'search') searchOpen = !searchOpen;
            if (value === 'storage') storageOpen = !storageOpen;
            if (value === 'share') shareOpen = !shareOpen;
            if (value === 'timeline') timelineOpen = !timelineOpen;
            if (value === 'flow') flowOpen = !flowOpen;
          }}
        />
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
  :global(body) {
    margin: 0;
    background: linear-gradient(180deg, #eef3f8, #e7edf3);
    color: #122033;
    font-family: 'IBM Plex Sans', 'Avenir Next', sans-serif;
  }

  .design-studio {
    min-height: 100vh;
    padding: 24px;
    display: grid;
    gap: 18px;
  }

  .studio-header,
  .studio-controls,
  .studio-surface,
  .registry-panel,
  .registry-card,
  .mock-panel {
    border: 1px solid rgba(148, 163, 184, 0.18);
    background: rgba(255, 255, 255, 0.84);
    border-radius: 22px;
    box-shadow: 0 24px 60px rgba(15, 23, 42, 0.08);
    backdrop-filter: blur(18px);
  }

  .studio-header,
  .studio-controls,
  .studio-surface,
  .registry-panel {
    padding: 20px;
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
    color: #64748b;
  }

  .studio-header h1,
  .registry-card h2 {
    margin: 0;
    font-family: 'Iowan Old Style', 'Palatino Linotype', serif;
    letter-spacing: -0.03em;
  }

  .studio-copy,
  .surface-head span,
  .registry-row span,
  .mock-panel span {
    margin: 0;
    color: #5b6878;
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
    border-radius: 999px;
    border: 1px solid rgba(148, 163, 184, 0.18);
    background: rgba(255, 255, 255, 0.9);
    font: inherit;
  }

  .studio-controls button.active {
    background: #0f6fb7;
    color: white;
    border-color: rgba(15, 111, 183, 0.32);
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
    background: linear-gradient(135deg, rgba(14, 165, 233, 0.12), rgba(255, 255, 255, 0.88));
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
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.72);
  }

  @media (max-width: 980px) {
    .studio-grid,
    .surface-body,
    .registry-grid {
      grid-template-columns: 1fr;
    }
  }
</style>