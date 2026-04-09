<script lang="ts">
  import { Activity, FileText, HardDrive, History, LayoutGrid, Link2, MessageSquareText, Rows3, Search } from 'lucide-svelte';
  import type { WorkspaceChromeActions, WorkspaceChromeState } from '../workspaceChrome.js';

  let {
    state,
    actions,
  }: {
    state: WorkspaceChromeState;
    actions: WorkspaceChromeActions;
  } = $props();

  function handleWorkspaceModeChange(event: Event): void {
    actions.applyWorkspaceMode((event.currentTarget as HTMLSelectElement).value as WorkspaceChromeState['workspaceMode']);
  }
</script>

<div class="workspace-mode-bar panel-surface" role="group" aria-label="Hub workspace">
  <div class="workspace-mode-primary">
    <label class="workspace-pane-select-wrap" aria-label="Hub workspace mode selector">
      <span class="sr-only">Workspace mode</span>
      <select class="workspace-pane-select" value={state.workspaceMode} onchange={handleWorkspaceModeChange}>
        <option value="files">Files</option>
        <option value="chat">Chat</option>
        <option value="split">Files and chat</option>
      </select>
    </label>
    <button
      type="button"
      class="workspace-mode-btn"
      class:active={state.showFilesWorkspace}
      aria-pressed={state.showFilesWorkspace}
      onclick={() => actions.toggleWorkspacePane('files')}
    >
      <FileText size={15} strokeWidth={2} />
      <span>Files</span>
    </button>
    <button
      type="button"
      class="workspace-mode-btn"
      class:active={state.showChatWorkspace}
      aria-pressed={state.showChatWorkspace}
      onclick={() => actions.toggleWorkspacePane('chat')}
    >
      <MessageSquareText size={15} strokeWidth={2} />
      <span>Chat</span>
    </button>
  </div>
  {#if state.showWorkspaceUtilities}
    <div class="workspace-mode-secondary">
      {#if state.showFilesWorkspace}
        <span class="workspace-selection-summary">{state.selectionSummary}</span>
      {/if}
      <div class="workspace-utility-actions">
        {#if state.showFilesWorkspace}
          <button
            type="button"
            class="manager-btn workspace-toolbar-btn workspace-toolbar-utility"
            class:active={state.showSearchWorkspace}
            onclick={() => actions.toggleSearch()}
            title={state.showSearchWorkspace ? 'Hide file search' : 'Show file search'}
          >
            <Search class="button-icon" size={15} strokeWidth={2} />
            <span>Search</span>
          </button>
        {/if}
        <button
          type="button"
          class="manager-btn workspace-toolbar-btn workspace-toolbar-utility"
          class:active={state.showVolumeStoragePanel}
          onclick={() => actions.toggleStorage()}
          disabled={state.storageDisabled}
          title="Choose storage locations for this hub"
        >
          <HardDrive class="button-icon" size={15} strokeWidth={2} />
          <span>Storage</span>
        </button>
        <button
          type="button"
          class="manager-btn workspace-toolbar-btn workspace-toolbar-utility"
          class:active={state.showVolumeShareDialog}
          onclick={() => actions.openShare()}
          disabled={state.storageDisabled}
          title="Share this hub"
        >
          <Link2 class="button-icon" size={15} strokeWidth={2} />
          <span>Share</span>
        </button>
        <button
          type="button"
          class="manager-btn workspace-toolbar-btn workspace-toolbar-utility"
          class:active={state.showTimeMachinePanel}
          onclick={() => actions.toggleTimeline()}
          title="Show hub timeline"
        >
          <History class="button-icon" size={15} strokeWidth={2} />
          <span>Timeline</span>
        </button>
        <button
          type="button"
          class="manager-btn workspace-toolbar-btn workspace-toolbar-utility"
          class:active={state.showEventFlowPanel}
          onclick={() => actions.toggleFlow()}
          title="Event flow visualization"
        >
          <Activity class="button-icon" size={15} strokeWidth={2} />
          <span>Flow</span>
        </button>
      </div>
      {#if state.showFilesWorkspace}
        <div class="manager-view-switch" role="tablist" aria-label="File browser view">
          <button
            type="button"
            class="view-toggle"
            class:active={state.fileManagerViewMode === 'icons'}
            onclick={() => actions.setViewMode('icons')}
            aria-pressed={state.fileManagerViewMode === 'icons'}
            title="Icon view"
          >
            <LayoutGrid size={15} strokeWidth={2} />
          </button>
          <button
            type="button"
            class="view-toggle"
            class:active={state.fileManagerViewMode === 'details'}
            onclick={() => actions.setViewMode('details')}
            aria-pressed={state.fileManagerViewMode === 'details'}
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
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.24rem 0.32rem;
    border-radius: 14px;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(148, 163, 184, 0.24)) 88%, transparent);
    background: color-mix(in srgb, var(--nb-panel-bg, rgba(255, 255, 255, 0.94)) 98%, transparent);
    backdrop-filter: blur(14px);
    flex-wrap: wrap;
  }

  .workspace-mode-primary,
  .workspace-mode-secondary,
  .workspace-utility-actions {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    flex-wrap: wrap;
    min-width: 0;
  }

  .workspace-mode-secondary {
    margin-left: auto;
    flex: 1 1 320px;
    justify-content: flex-end;
  }

  .workspace-utility-actions {
    margin-left: auto;
    flex: 1 1 0;
  }

  .workspace-selection-summary {
    font-size: 0.74rem;
    color: var(--nb-text-soft, rgba(71, 85, 105, 0.78));
    white-space: nowrap;
    min-width: 0;
  }

  .workspace-pane-select-wrap {
    display: none;
  }

  .workspace-pane-select {
    appearance: none;
    width: 100%;
    min-height: 2.35rem;
    border-radius: 999px;
    border: 1px solid rgba(148, 163, 184, 0.22);
    background: rgba(255, 255, 255, 0.96);
    color: #1f2937;
    padding: 0.55rem 2.3rem 0.55rem 0.85rem;
    font: inherit;
    box-shadow: 0 10px 24px rgba(15, 23, 42, 0.08);
  }

  .workspace-mode-btn,
  .workspace-toolbar-btn,
  .view-toggle {
    appearance: none;
    min-height: 34px;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(148, 163, 184, 0.24)) 88%, transparent);
    background: color-mix(in srgb, var(--nb-panel-bg, rgba(255, 255, 255, 0.96)) 98%, transparent);
    color: var(--nb-text-main, rgba(15, 23, 42, 0.9));
    font: inherit;
    font-size: 0.78rem;
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    padding: 0 0.78rem;
    cursor: pointer;
    transition: transform 0.16s ease, border-color 0.16s ease, background-color 0.16s ease;
  }

  .view-toggle {
    width: 34px;
    padding: 0;
    border-radius: 10px;
  }

  .workspace-mode-btn:hover,
  .workspace-toolbar-btn:hover,
  .view-toggle:hover {
    transform: translateY(-1px);
    border-color: color-mix(in srgb, var(--nb-accent, #0ea5e9) 24%, transparent);
    background: color-mix(in srgb, var(--nb-accent, #0ea5e9) 10%, white);
  }

  .workspace-mode-btn.active,
  .workspace-toolbar-btn.active,
  .view-toggle.active {
    color: rgba(255, 255, 255, 0.96);
    background: color-mix(in srgb, var(--nb-accent, #0ea5e9) 72%, #0f172a);
    border-color: color-mix(in srgb, var(--nb-accent, #0ea5e9) 28%, transparent);
    box-shadow: 0 10px 20px rgba(14, 165, 233, 0.16);
  }

  .manager-view-switch {
    display: inline-flex;
    align-items: center;
    gap: 0.32rem;
    padding: 0.18rem;
    border-radius: 12px;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(148, 163, 184, 0.18)) 88%, transparent);
    background: color-mix(in srgb, var(--nb-panel-bg, rgba(255, 255, 255, 0.96)) 98%, transparent);
  }

  @media (max-width: 900px) {
    .workspace-mode-bar {
      align-items: stretch;
    }

    .workspace-mode-primary {
      width: 100%;
    }

    .workspace-pane-select-wrap {
      display: block;
      width: 100%;
    }

    .workspace-mode-btn {
      display: none;
    }

    .workspace-mode-secondary {
      width: 100%;
      margin-left: 0;
      justify-content: flex-start;
      gap: 0.55rem;
      overflow-x: auto;
      flex-wrap: nowrap;
      padding-bottom: 0.1rem;
    }

    .workspace-utility-actions {
      display: none;
    }

    .workspace-selection-summary {
      white-space: normal;
      overflow-wrap: anywhere;
      min-width: min(16rem, 100%);
    }
  }
</style>