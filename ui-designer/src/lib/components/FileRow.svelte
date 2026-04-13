<script lang="ts">
  import type { FileFixture } from '../state/types.js';
  import UiChip from './UiChip.svelte';

  let {
    file,
    active = false,
    onSelect,
  } = $props<{
    file: FileFixture;
    active?: boolean;
    onSelect?: (() => void) | undefined;
  }>();

  const tone = $derived(file.status === 'warning' ? 'warning' : file.status === 'syncing' ? 'accent' : 'success');
</script>

<button class:active class="file-row" type="button" onclick={onSelect}>
  <div class="file-row-copy">
    <strong>{file.name}</strong>
    <span>{file.summary}</span>
    <span>{file.mimeLabel} · {file.sizeLabel} · {file.providers.join(' • ')}</span>
  </div>
  <div class="file-row-meta">
    <UiChip label={file.status} tone={tone} />
    <span>{file.updatedAt}</span>
  </div>
</button>

<style>
  .file-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    width: 100%;
    border: 1px solid var(--nb-border);
    background: transparent;
    border-radius: var(--nb-radius-item);
    padding: 0.8rem 0.9rem;
    cursor: pointer;
    color: inherit;
    text-align: left;
  }

  .file-row.active {
    background: color-mix(in srgb, var(--nb-accent) 6%, var(--nb-surface-strong));
    border-color: var(--nb-accent);
  }

  .file-row-copy,
  .file-row-meta {
    display: grid;
    gap: 0.22rem;
  }

  .file-row-copy span,
  .file-row-meta span {
    color: var(--nb-text-soft);
    font-size: 0.8rem;
    line-height: 1.4;
  }

  .file-row-meta {
    justify-items: end;
  }
</style>
