<script lang="ts">
  import { Activity, FileText, HardDrive, History, LayoutGrid, Link2, MessageSquareText, Rows3, Search } from 'lucide-svelte';

  type WorkspaceModeValue = 'files' | 'chat' | 'split';
  type FileManagerViewMode = 'icons' | 'details';
  type CompactAction = 'search' | 'storage' | 'share' | 'timeline' | 'flow' | 'identities' | 'locations';

  let {
    paneModeValue,
    showFilesWorkspace,
    showChatWorkspace,
    selectionSummary = '',
    showSearchWorkspace,
    showVolumeStoragePanel,
    showVolumeShareDialog,
    showTimeMachinePanel,
    showEventFlowPanel,
    storageDisabled = false,
    shareDisabled = false,
    showSecondary = true,
    fileManagerViewMode = 'icons',
    onChangePaneMode,
    onToggleWorkspacePane,
    onCompactAction,
    onToggleWorkspaceSearch,
    onToggleVolumeStoragePanel,
    onOpenVolumeShareDialog,
    onToggleTimeMachinePanel,
    onToggleEventFlowPanel,
    onSetFileManagerViewMode,
  } = $props<{
    paneModeValue: WorkspaceModeValue;
    showFilesWorkspace: boolean;
    showChatWorkspace: boolean;
    selectionSummary?: string;
    showSearchWorkspace: boolean;
    showVolumeStoragePanel: boolean;
    showVolumeShareDialog: boolean;
    showTimeMachinePanel: boolean;
    showEventFlowPanel: boolean;
    storageDisabled?: boolean;
    shareDisabled?: boolean;
    showSecondary?: boolean;
    fileManagerViewMode?: FileManagerViewMode;
    onChangePaneMode?: ((value: WorkspaceModeValue) => void) | undefined;
    onToggleWorkspacePane?: ((pane: 'files' | 'chat') => void) | undefined;
    onCompactAction?: ((action: CompactAction) => void) | undefined;
    onToggleWorkspaceSearch?: (() => void) | undefined;
    onToggleVolumeStoragePanel?: (() => void) | undefined;
    onOpenVolumeShareDialog?: (() => void) | undefined;
    onToggleTimeMachinePanel?: (() => void) | undefined;
    onToggleEventFlowPanel?: (() => void) | undefined;
    onSetFileManagerViewMode?: ((mode: FileManagerViewMode) => void) | undefined;
  }>();
</script>

<div class="workspace-mode-bar panel-surface" role="group" aria-label="Hub workspace">
  <div class="workspace-mode-primary">
    <label class="workspace-pane-select-wrap" aria-label="Hub workspace mode selector">
      <span class="sr-only">Workspace mode</span>
      <select
        class="workspace-pane-select"
        value={paneModeValue}
        onchange={(event) => onChangePaneMode?.((event.currentTarget as HTMLSelectElement).value as WorkspaceModeValue)}
      >
        <option value="files">Files</option>
        <option value="chat">Chat</option>
        <option value="split">Files and chat</option>
      </select>
    </label>
    <button
      type="button"
      class="workspace-mode-btn"
      class:active={showFilesWorkspace}
      aria-pressed={showFilesWorkspace}
      onclick={() => onToggleWorkspacePane?.('files')}
    >
      <FileText size={15} strokeWidth={2} />
      <span>Files</span>
    </button>
    <button
      type="button"
      class="workspace-mode-btn"
      class:active={showChatWorkspace}
      aria-pressed={showChatWorkspace}
      onclick={() => onToggleWorkspacePane?.('chat')}
    >
      <MessageSquareText size={15} strokeWidth={2} />
      <span>Chat</span>
    </button>
  </div>

  {#if showSecondary}
    <div class="workspace-mode-secondary">
      {#if showFilesWorkspace}
        <span class="workspace-selection-summary">{selectionSummary}</span>
      {/if}

      <label class="workspace-mobile-action-wrap" aria-label="Workspace actions selector">
        <span class="sr-only">Workspace actions</span>
        <select
          class="workspace-mobile-action-select"
          onchange={(event) => {
            const target = event.currentTarget as HTMLSelectElement;
            const value = target.value as CompactAction | '';
            target.value = '';
            if (value) {
              onCompactAction?.(value);
            }
          }}
        >
          <option value="">Actions</option>
          {#if showFilesWorkspace}
            <option value="search">{showSearchWorkspace ? 'Hide search' : 'Show search'}</option>
          {/if}
          <option value="storage">{showVolumeStoragePanel ? 'Hide storage' : 'Storage'}</option>
          <option value="share">Share</option>
          <option value="timeline">{showTimeMachinePanel ? 'Hide timeline' : 'Timeline'}</option>
          <option value="flow">{showEventFlowPanel ? 'Hide flow' : 'Flow'}</option>
          <option value="identities">Identities</option>
          <option value="locations">Locations</option>
        </select>
      </label>

      <div class="workspace-utility-actions">
        {#if showFilesWorkspace}
          <button
            type="button"
            class="workspace-toolbar-btn workspace-toolbar-utility"
            class:active={showSearchWorkspace}
            onclick={onToggleWorkspaceSearch}
            title={showSearchWorkspace ? 'Hide file search' : 'Show file search'}
          >
            <Search class="button-icon" size={15} strokeWidth={2} />
            <span>Search</span>
          </button>
        {/if}
        <button
          type="button"
          class="workspace-toolbar-btn workspace-toolbar-utility"
          class:active={showVolumeStoragePanel}
          onclick={onToggleVolumeStoragePanel}
          disabled={storageDisabled}
          title="Choose storage locations for this hub"
        >
          <HardDrive class="button-icon" size={15} strokeWidth={2} />
          <span>Storage</span>
        </button>
        <button
          type="button"
          class="workspace-toolbar-btn workspace-toolbar-utility"
          class:active={showVolumeShareDialog}
          onclick={onOpenVolumeShareDialog}
          disabled={shareDisabled}
          title="Share this hub"
        >
          <Link2 class="button-icon" size={15} strokeWidth={2} />
          <span>Share</span>
        </button>
        <button
          type="button"
          class="workspace-toolbar-btn workspace-toolbar-utility"
          class:active={showTimeMachinePanel}
          onclick={onToggleTimeMachinePanel}
          title="Show hub timeline"
        >
          <History class="button-icon" size={15} strokeWidth={2} />
          <span>Timeline</span>
        </button>
        <button
          type="button"
          class="workspace-toolbar-btn workspace-toolbar-utility"
          class:active={showEventFlowPanel}
          onclick={onToggleEventFlowPanel}
          title="Event flow visualization"
        >
          <Activity class="button-icon" size={15} strokeWidth={2} />
          <span>Flow</span>
        </button>
      </div>

      {#if showFilesWorkspace}
        <div class="manager-view-switch" role="tablist" aria-label="File browser view">
          <button
            type="button"
            class="view-toggle"
            class:active={fileManagerViewMode === 'icons'}
            onclick={() => onSetFileManagerViewMode?.('icons')}
            aria-pressed={fileManagerViewMode === 'icons'}
            title="Icon view"
          >
            <LayoutGrid size={15} strokeWidth={2} />
          </button>
          <button
            type="button"
            class="view-toggle"
            class:active={fileManagerViewMode === 'details'}
            onclick={() => onSetFileManagerViewMode?.('details')}
            aria-pressed={fileManagerViewMode === 'details'}
            title="Details view"
          >
            <Rows3 size={15} strokeWidth={2} />
          </button>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .workspace-mode-bar {
    display: grid;
    grid-template-columns: minmax(0, auto) minmax(0, 1fr);
    gap: 0.9rem;
    align-items: center;
    padding: 0.7rem 0.85rem;
    border-radius: 18px;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(148, 163, 184, 0.18)) 88%, rgba(255, 255, 255, 0.06));
    background:
      linear-gradient(180deg, color-mix(in srgb, var(--nb-panel-bg, rgba(8, 14, 28, 0.7)) 96%, rgba(255, 255, 255, 0.02)), color-mix(in srgb, var(--nb-panel-bg, rgba(8, 14, 28, 0.7)) 92%, rgba(37, 99, 235, 0.04))),
      radial-gradient(circle at top right, color-mix(in srgb, var(--nb-accent, rgba(125, 211, 252, 0.7)) 10%, transparent), transparent 58%);
    box-shadow: 0 14px 34px rgba(2, 6, 23, 0.12);
  }

  .workspace-mode-primary,
  .workspace-mode-secondary,
  .workspace-utility-actions {
    display: flex;
    gap: 0.55rem;
    align-items: center;
    min-width: 0;
  }

  .workspace-mode-secondary {
    justify-content: flex-end;
    flex-wrap: wrap;
  }

  .workspace-pane-select-wrap,
  .workspace-mobile-action-wrap {
    position: relative;
    display: inline-flex;
    min-width: 0;
  }

  .workspace-pane-select,
  .workspace-mobile-action-select {
    appearance: none;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(148, 163, 184, 0.18)) 88%, rgba(255, 255, 255, 0.06));
    background: color-mix(in srgb, var(--nb-btn-bg, rgba(12, 22, 41, 0.6)) 92%, rgba(255, 255, 255, 0.02));
    color: var(--nb-text-main, rgba(226, 232, 240, 0.9));
    min-height: 34px;
    padding: 0 2rem 0 0.9rem;
    font: inherit;
    font-size: 0.74rem;
    font-weight: 600;
    cursor: pointer;
  }

  .workspace-mode-btn,
  .workspace-toolbar-btn,
  .view-toggle {
    appearance: none;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(148, 163, 184, 0.18)) 88%, rgba(255, 255, 255, 0.06));
    background: color-mix(in srgb, var(--nb-btn-bg, rgba(12, 22, 41, 0.6)) 92%, rgba(255, 255, 255, 0.02));
    color: var(--nb-text-main, rgba(226, 232, 240, 0.9));
    min-height: 34px;
    padding: 0 0.82rem;
    border-radius: 999px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.44rem;
    font: inherit;
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
    transition: transform 0.18s ease, border-color 0.18s ease, background-color 0.18s ease;
  }

  .workspace-mode-btn.active,
  .workspace-toolbar-btn.active,
  .view-toggle.active {
    border-color: color-mix(in srgb, var(--nb-accent, rgba(125, 211, 252, 0.7)) 34%, rgba(148, 163, 184, 0.18));
    background: color-mix(in srgb, var(--nb-accent, rgba(125, 211, 252, 0.7)) 10%, rgba(12, 22, 41, 0.72));
  }

  .workspace-mode-btn:hover:not(:disabled),
  .workspace-toolbar-btn:hover:not(:disabled),
  .view-toggle:hover:not(:disabled) {
    transform: translateY(-1px);
  }

  .workspace-selection-summary {
    min-width: 0;
    color: var(--nb-text-soft, rgba(191, 219, 254, 0.82));
    font-size: 0.74rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .manager-view-switch {
    display: inline-flex;
    gap: 0.38rem;
  }

  .view-toggle {
    width: 34px;
    padding: 0;
  }

  @media (max-width: 900px) {
    .workspace-mode-bar {
      grid-template-columns: 1fr;
    }

    .workspace-mode-secondary {
      justify-content: flex-start;
    }
  }

  @media (max-width: 680px) {
    .workspace-selection-summary,
    .workspace-utility-actions {
      display: none;
    }
  }
</style>