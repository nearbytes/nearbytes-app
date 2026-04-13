<script lang="ts">
  import { Download, Eye, X } from 'lucide-svelte';
  import UiChip from '../components/UiChip.svelte';
  import type { WorkspaceSurfaceProps } from '../state/types.js';

  let { ui, data } = $props<WorkspaceSurfaceProps>();

  const selectedFile = $derived(
    data.files.find((file) => file.id === ui.selectedFileId) ?? data.files[0] ?? null
  );
</script>

<section class="preview-pane nb-panel-surface">
  <header class="preview-header">
    <div>
      <p class="preview-kicker">Preview</p>
      <h3>{selectedFile ? selectedFile.name : 'No selection'}</h3>
    </div>
    <div class="preview-actions">
      <button type="button" class="preview-icon" aria-label="Reveal preview"><Eye size={16} /></button>
      <button type="button" class="preview-icon" aria-label="Download preview"><Download size={16} /></button>
    </div>
  </header>

  {#if selectedFile}
    <div class="preview-pane-body">
      <div class="preview-slate">
        <span class="preview-slate-kind">{selectedFile.kind}</span>
        <strong>{selectedFile.sizeLabel}</strong>
      </div>
      <div class="preview-meta">
        <UiChip label={selectedFile.status} tone={selectedFile.status === 'warning' ? 'warning' : 'accent'} />
        <span>Updated {selectedFile.updatedAt}</span>
      </div>
    </div>
  {:else}
    <p class="preview-empty">Select a file to preview.</p>
  {/if}
</section>

<style>
  .preview-pane {
    min-height: 0;
    border-radius: 24px;
    padding: 0.9rem;
    display: grid;
    gap: 0.85rem;
    overflow: hidden;
  }

  .preview-header {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    align-items: start;
  }

  .preview-kicker,
  .preview-header h3 {
    margin: 0;
  }

  .preview-kicker {
    text-transform: uppercase;
    letter-spacing: 0.16em;
    font-size: 0.68rem;
    color: var(--nb-accent-strong);
  }

  .preview-header h3 {
    font-size: 1rem;
  }

  .preview-actions {
    display: flex;
    gap: 0.45rem;
  }

  .preview-icon {
    width: 2.2rem;
    height: 2.2rem;
    display: grid;
    place-items: center;
    border-radius: 999px;
    border: 1px solid var(--nb-border);
    background: transparent;
    color: var(--nb-text-soft);
  }

  .preview-pane-body {
    display: grid;
    gap: 0.85rem;
    min-height: 0;
  }

  .preview-slate {
    min-height: 10rem;
    border-radius: 22px;
    border: 1px dashed var(--nb-border-strong);
    display: grid;
    place-items: center;
    gap: 0.25rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    background: color-mix(in srgb, var(--nb-surface-strong) 88%, var(--nb-accent-soft));
  }

  .preview-slate-kind,
  .preview-meta span,
  .preview-empty {
    color: var(--nb-text-soft);
    font-size: 0.82rem;
  }

  .preview-meta {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.8rem;
  }

  .preview-empty {
    margin: 0;
  }
</style>
