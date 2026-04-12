<script lang="ts">
  import UiButton from '../components/UiButton.svelte';
  import UiCard from '../components/UiCard.svelte';
  import UiChip from '../components/UiChip.svelte';
  import type { WorkspaceSurfaceProps } from '../state/types.js';

  let { ui, data } = $props<WorkspaceSurfaceProps>();

  const selectedFile = $derived(
    data.files.find((file) => file.id === ui.selectedFileId) ?? data.files[0] ?? null
  );
</script>

<UiCard
  eyebrow="Preview"
  title={selectedFile ? selectedFile.name : 'No selected file'}
  detail="This surface stays reusable and only needs logic props later for real preview bytes."
>
  {#snippet actions()}
    <UiButton label="Close" tone="secondary" onClick={() => {}} />
  {/snippet}

  {#snippet body()}
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
      <p class="preview-empty">Select a file to preview its UI state.</p>
    {/if}
  {/snippet}
</UiCard>

<style>
  .preview-pane-body {
    display: grid;
    gap: 0.85rem;
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
