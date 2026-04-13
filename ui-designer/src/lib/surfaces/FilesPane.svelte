<script lang="ts">
  import { Plus, Share2 } from 'lucide-svelte';
  import UiButton from '../components/UiButton.svelte';
  import FileRow from '../components/FileRow.svelte';
  import type { WorkspaceSurfaceProps } from '../state/types.js';

  let { ui, data, handlers } = $props() as WorkspaceSurfaceProps;
</script>

<section class="files-pane nb-panel-surface">
  <header class="files-pane-header">
    <div>
      <h3>Atlas Relay</h3>
    </div>
    <div class="files-pane-actions">
      <button type="button" class="icon-action" aria-label="Create hub item" onclick={() => handlers?.onAction?.({ type: 'open-overlay', overlay: 'create' })}>
        <Plus size={16} />
      </button>
      <button type="button" class="icon-action" aria-label="Share hub" onclick={() => handlers?.onAction?.({ type: 'open-overlay', overlay: 'share' })}>
        <Share2 size={16} />
      </button>
    </div>
  </header>

  <div class="files-toolbar">
    <button type="button" class:active={ui.primaryPane === 'files'} onclick={() => handlers?.onAction?.({ type: 'select-pane', pane: 'files' })}>All</button>
    <button type="button">Recent</button>
    <button type="button">Shared</button>
  </div>

  <div class="files-pane-body">
    {#if data.files.length === 0}
      <div class="files-empty">
        <strong>No files yet</strong>
        <p>Drop files here or create a new handoff.</p>
      </div>
    {:else}
      {#each data.files as file}
        <FileRow
          file={file}
          active={ui.selectedFileId === file.id}
          onSelect={() => handlers?.onAction?.({ type: 'select-file', fileId: file.id })}
        />
      {/each}
    {/if}
  </div>
</section>

<style>
  .files-pane {
    min-height: 0;
    border-radius: 24px;
    padding: 0.9rem;
    display: grid;
    gap: 0.9rem;
    overflow: hidden;
  }

  .files-pane-header {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    align-items: start;
  }

  .files-pane-header h3 {
    margin: 0;
  }

  .files-pane-header h3 {
    font-size: 1rem;
  }

  .files-pane-actions,
  .files-toolbar {
    display: flex;
    gap: 0.45rem;
  }

  .icon-action,
  .files-toolbar button {
    border-radius: 999px;
    border: 1px solid var(--nb-border);
    background: transparent;
    color: var(--nb-text-soft);
    cursor: pointer;
  }

  .icon-action {
    width: 2.2rem;
    height: 2.2rem;
    display: grid;
    place-items: center;
  }

  .files-toolbar button {
    padding: 0.45rem 0.75rem;
  }

  .files-toolbar button.active {
    color: var(--nb-text);
    background: var(--nb-accent-soft);
    border-color: var(--nb-accent);
  }

  .files-pane-body {
    display: grid;
    gap: 0.65rem;
    align-content: start;
    overflow: auto;
    min-height: 0;
  }

  .files-empty {
    border-radius: 18px;
    border: 1px dashed var(--nb-border-strong);
    padding: 1rem;
    display: grid;
    gap: 0.3rem;
    color: var(--nb-text-soft);
  }

  .files-empty strong,
  .files-empty p {
    margin: 0;
  }

  .files-empty p {
    font-size: 0.84rem;
  }
</style>
