<script lang="ts">
  import { ClipboardPaste } from 'lucide-svelte';
  import type { WorkspaceChromeActions, WorkspaceChromeState } from '../workspaceChrome.js';

  let {
    state,
    actions,
  }: {
    state: WorkspaceChromeState;
    actions: WorkspaceChromeActions;
  } = $props();
</script>

<div class="workspace-search-strip panel-surface" role="group" aria-label="File search and sorting">
  <input
    type="text"
    class="manager-search workspace-search-input"
    placeholder="Search files"
    value={state.searchQuery}
    oninput={(event) => actions.setSearchQuery((event.currentTarget as HTMLInputElement).value)}
    aria-label="Search files"
  />
  <select
    class="manager-sort workspace-search-sort"
    value={state.sortBy}
    onchange={(event) => actions.setSortBy((event.currentTarget as HTMLSelectElement).value as WorkspaceChromeState['sortBy'])}
    aria-label="Sort files"
  >
    <option value="newest">Newest</option>
    <option value="oldest">Oldest</option>
    <option value="name">Name</option>
    <option value="name-desc">Name (Z-A)</option>
    <option value="size">Size</option>
    <option value="size-asc">Size (Smallest)</option>
  </select>
  {#if state.pasteVisible}
    <button
      type="button"
      class="manager-btn workspace-toolbar-btn workspace-search-paste"
      onclick={() => actions.paste()}
      disabled={state.pasteDisabled}
      title={state.pasteTitle}
    >
      <ClipboardPaste class="button-icon" size={15} strokeWidth={2} />
      Paste {state.pasteCount} item{state.pasteCount === 1 ? '' : 's'}
    </button>
  {/if}
</div>

<style>
  .workspace-search-strip {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 0.55rem;
    padding: 0.42rem 0.5rem;
    border-radius: var(--nb-radius-md, 14px);
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(148, 163, 184, 0.24)) 88%, transparent);
    background: color-mix(in srgb, var(--nb-panel-bg, rgba(255, 255, 255, 0.96)) 98%, transparent);
    flex-wrap: wrap;
  }

  .workspace-search-input,
  .workspace-search-sort {
    appearance: none;
    min-height: 40px;
    border-radius: var(--nb-radius-sm, 12px);
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(148, 163, 184, 0.24)) 88%, transparent);
    background: rgba(255, 255, 255, 0.96);
    color: var(--nb-text-main, rgba(15, 23, 42, 0.92));
    font: inherit;
    padding: 0 0.85rem;
    outline: none;
  }

  .workspace-search-input {
    flex: 1 1 240px;
    min-width: min(100%, 240px);
  }

  .workspace-search-sort {
    flex: 0 0 180px;
    width: 180px;
  }

  .workspace-search-input:focus,
  .workspace-search-sort:focus {
    border-color: color-mix(in srgb, var(--nb-accent, #0ea5e9) 28%, transparent);
    box-shadow: 0 0 0 4px color-mix(in srgb, var(--nb-accent, #0ea5e9) 12%, transparent);
  }

  .workspace-search-paste {
    appearance: none;
    min-height: 40px;
    border-radius: var(--nb-radius-pill, 999px);
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(148, 163, 184, 0.24)) 88%, transparent);
    background: color-mix(in srgb, var(--nb-panel-bg, rgba(255, 255, 255, 0.96)) 98%, transparent);
    color: var(--nb-text-main, rgba(15, 23, 42, 0.92));
    font: inherit;
    font-size: 0.78rem;
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    gap: 0.42rem;
    padding: 0 0.85rem;
    cursor: pointer;
    transition: transform var(--nb-motion-fast, 160ms) ease, border-color var(--nb-motion-fast, 160ms) ease, background-color var(--nb-motion-fast, 160ms) ease;
  }

  .workspace-search-paste:hover {
    transform: translateY(-1px);
    border-color: color-mix(in srgb, var(--nb-accent, #0ea5e9) 24%, transparent);
    background: color-mix(in srgb, var(--nb-accent, #0ea5e9) 10%, white);
  }

  .workspace-search-paste:disabled {
    cursor: not-allowed;
    opacity: 0.55;
    transform: none;
  }

  @media (max-width: 900px) {
    .workspace-search-strip {
      align-items: stretch;
    }

    .workspace-search-input,
    .workspace-search-sort,
    .workspace-search-paste {
      width: 100%;
      flex-basis: 100%;
    }
  }
</style>