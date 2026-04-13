<script lang="ts">
  import { Activity, ArrowDownUp, Grid2x2, HardDrive, History, Plus, Rows3, Search, Share2 } from 'lucide-svelte';
  import FileRow from '../components/FileRow.svelte';
  import FileTile from '../components/FileTile.svelte';
  import type { WorkspaceSurfaceProps } from '../state/types.js';

  interface $$Props extends WorkspaceSurfaceProps {}

  let { ui, data, capabilities, handlers }: $$Props = $props();

  const selectedHub = $derived(
    data.hubs.find((hub) => hub.id === ui.activeHubId) ?? data.hubs[0] ?? null
  );

  const visibleFiles = $derived.by(() => {
    const normalizedQuery = ui.fileSearch.trim().toLowerCase();
    const filtered = normalizedQuery.length === 0
      ? [...data.files]
      : data.files.filter((file) => {
          const haystack = `${file.name} ${file.summary} ${file.mimeLabel} ${file.providers.join(' ')}`.toLowerCase();
          return haystack.includes(normalizedQuery);
        });

    filtered.sort((left, right) => {
      switch (ui.fileSort) {
        case 'oldest':
          return left.updatedAt.localeCompare(right.updatedAt);
        case 'name':
          return left.name.localeCompare(right.name);
        case 'size':
          return left.sizeLabel.localeCompare(right.sizeLabel, undefined, { numeric: true });
        case 'newest':
        default:
          return right.updatedAt.localeCompare(left.updatedAt);
      }
    });

    return filtered;
  });
</script>

<section class="files-pane nb-panel-surface">
  <header class="files-pane-header">
    <div class="files-pane-title-block">
      <div>
        <h3>{selectedHub?.label ?? 'Workspace files'}</h3>
        <p>{selectedHub?.members ?? 0} members</p>
      </div>
    </div>
    <div class="files-pane-actions">
      <button type="button" class="icon-action" aria-label="Create hub item" title="Create" onclick={() => handlers?.onAction?.({ type: 'open-overlay', overlay: 'create' })}>
        <Plus size={16} />
      </button>
      <button type="button" class="icon-action" aria-label="Share hub" title="Share" onclick={() => handlers?.onAction?.({ type: 'open-overlay', overlay: 'share' })}>
        <Share2 size={16} />
      </button>
    </div>
  </header>

  <div class="files-toolbar utility-row">
    <div class="utility-pills">
      <button type="button" class:active={ui.primaryPane === 'files'} onclick={() => handlers?.onAction?.({ type: 'select-pane', pane: 'files' })}>All files</button>
      <button type="button" onclick={() => handlers?.onAction?.({ type: 'open-overlay', overlay: 'storage' })}><HardDrive size={14} /> Storage</button>
      <button type="button" onclick={() => handlers?.onAction?.({ type: 'toggle-timeline' })}><History size={14} /> Timeline</button>
      <button type="button" onclick={() => handlers?.onAction?.({ type: 'open-overlay', overlay: 'event-flow' })}><Activity size={14} /> Flow</button>
    </div>
    <div class="view-switch" role="tablist" aria-label="File browser view">
      <button
        type="button"
        class:active={ui.fileBrowserView === 'icons'}
        title="Icon view"
        aria-pressed={ui.fileBrowserView === 'icons'}
        onclick={() => handlers?.onAction?.({ type: 'set-file-browser-view', view: 'icons' })}
      >
        <Grid2x2 size={15} />
      </button>
      <button
        type="button"
        class:active={ui.fileBrowserView === 'details'}
        title="Details view"
        aria-pressed={ui.fileBrowserView === 'details'}
        onclick={() => handlers?.onAction?.({ type: 'set-file-browser-view', view: 'details' })}
      >
        <Rows3 size={15} />
      </button>
    </div>
  </div>

  <div class="files-toolbar search-row">
    <label class="search-field">
      <Search size={15} />
      <input
        type="text"
        value={ui.fileSearch}
        placeholder="Search files, providers, or summaries"
        oninput={(event) => handlers?.onAction?.({ type: 'set-file-search', value: (event.currentTarget as HTMLInputElement).value })}
      />
    </label>

    <label class="sort-field">
      <ArrowDownUp size={15} />
      <select onchange={(event) => handlers?.onAction?.({ type: 'set-file-sort', sort: (event.currentTarget as HTMLSelectElement).value as typeof ui.fileSort })} value={ui.fileSort}>
        <option value="newest">Newest</option>
        <option value="oldest">Oldest</option>
        <option value="name">Name</option>
        <option value="size">Size</option>
      </select>
    </label>
  </div>

  <div class="files-pane-body">
    {#if visibleFiles.length === 0}
      <div class="files-empty">
        <strong>No files yet</strong>
        <p>{ui.fileSearch ? 'No files match the current search.' : 'Drop files here or create a new handoff.'}</p>
      </div>
    {:else}
      {#if ui.fileBrowserView === 'icons'}
        <div class="files-grid">
          {#each visibleFiles as file}
            <FileTile
              {file}
              active={ui.selectedFileId === file.id}
              onSelect={() => handlers?.onAction?.({ type: 'select-file', fileId: file.id })}
            />
          {/each}
        </div>
      {:else}
        {#each visibleFiles as file}
          <FileRow
            {file}
            active={ui.selectedFileId === file.id}
            onSelect={() => handlers?.onAction?.({ type: 'select-file', fileId: file.id })}
          />
        {/each}
      {/if}
    {/if}
  </div>
</section>

<style>
  .files-pane {
    min-height: 0;
    border-radius: var(--nb-radius-panel);
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

  .files-pane-title-block p {
    margin: 0.25rem 0 0;
    color: var(--nb-text-soft);
    font-size: 0.8rem;
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

  .utility-row,
  .search-row {
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
  }

  .utility-pills {
    display: flex;
    gap: 0.45rem;
    flex-wrap: wrap;
  }

  .icon-action,
  .files-toolbar button {
    border-radius: var(--nb-radius-control);
    border: 1px solid var(--nb-border);
    background: var(--nb-surface-strong);
    color: var(--nb-text-soft);
    cursor: pointer;
  }

  .files-toolbar button {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
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
    background: color-mix(in srgb, var(--nb-accent) 8%, var(--nb-surface-strong));
    border-color: var(--nb-accent);
  }

  .view-switch {
    display: inline-flex;
    gap: 0.35rem;
    padding: 0.22rem;
    border-radius: 999px;
    border: 1px solid var(--nb-border);
    background: var(--nb-surface);
  }

  .view-switch button {
    width: 2.1rem;
    height: 2.1rem;
    padding: 0;
    border-radius: 999px;
    display: grid;
    place-items: center;
  }

  .search-field,
  .sort-field {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    min-height: 2.5rem;
    padding: 0 0.8rem;
    border-radius: 999px;
    border: 1px solid var(--nb-border);
    background: var(--nb-surface-strong);
    color: var(--nb-text-soft);
  }

  .search-field {
    min-width: min(24rem, 100%);
    flex: 1 1 18rem;
  }

  .search-field input,
  .sort-field select {
    border: 0;
    outline: 0;
    background: transparent;
    color: inherit;
    width: 100%;
  }

  .files-grid {
    display: grid;
    gap: 0.85rem;
    grid-template-columns: repeat(auto-fit, minmax(13.5rem, 1fr));
    align-content: start;
  }

  .files-pane-body {
    display: grid;
    gap: 0.65rem;
    align-content: start;
    overflow: auto;
    min-height: 0;
  }

  .files-empty {
    border-radius: var(--nb-radius-item);
    border: 1px solid var(--nb-border);
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

  @media (max-width: 720px) {
    .search-row {
      align-items: stretch;
    }

    .sort-field {
      width: 100%;
    }
  }
</style>
