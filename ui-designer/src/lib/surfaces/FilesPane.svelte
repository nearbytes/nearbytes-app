<script lang="ts">
  import UiButton from '../components/UiButton.svelte';
  import UiCard from '../components/UiCard.svelte';
  import FileRow from '../components/FileRow.svelte';
  import type { WorkspaceSurfaceProps } from '../state/types.js';

  let { ui, data, handlers } = $props<WorkspaceSurfaceProps>();
</script>

<UiCard
  eyebrow="Files"
  title="Shared file materialization"
  detail="Pure UI surface with selectable rows, preview affordances, and share/create entry points."
>
  {#snippet actions()}
    <UiButton label="Create" tone="secondary" onClick={() => handlers?.onAction?.({ type: 'open-overlay', overlay: 'create' })} />
    <UiButton label="Share" tone="secondary" onClick={() => handlers?.onAction?.({ type: 'open-overlay', overlay: 'share' })} />
  {/snippet}

  {#snippet body()}
    <div class="files-pane-body">
      {#if data.files.length === 0}
        <p class="files-empty">No files in this fixture preset.</p>
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
  {/snippet}
</UiCard>

<style>
  .files-pane-body {
    display: grid;
    gap: 0.65rem;
  }

  .files-empty {
    margin: 0;
    color: var(--nb-text-soft);
    font-size: 0.88rem;
  }
</style>
