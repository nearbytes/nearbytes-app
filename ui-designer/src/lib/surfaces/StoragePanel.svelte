<script lang="ts">
  import UiButton from '../components/UiButton.svelte';
  import UiChip from '../components/UiChip.svelte';
  import UiDialog from '../components/UiDialog.svelte';
  import type { WorkspaceSurfaceProps } from '../state/types.js';

  interface $$Props extends WorkspaceSurfaceProps {}

  let { ui, data, capabilities, handlers }: $$Props = $props();
</script>

<UiDialog title="Storage" onClose={() => handlers?.onAction?.({ type: 'close-overlay' })}>
  {#snippet body()}
    <div class="storage-grid">
      {#each data.storageLocations as location}
        <div class="storage-row">
          <div>
            <strong>{location.label}</strong>
            <p>{location.reserveLabel}</p>
          </div>
          <UiChip label={location.status} tone={location.status === 'attention' ? 'warning' : 'success'} />
        </div>
      {/each}
      <div class="storage-actions">
        <UiButton label="Per-hub storage" tone="secondary" onClick={() => handlers?.onAction?.({ type: 'open-overlay', overlay: 'hub-storage' })} />
      </div>
    </div>
  {/snippet}
</UiDialog>

<style>
  .storage-grid {
    display: grid;
    gap: 0.8rem;
  }

  .storage-row {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    align-items: center;
    border-radius: 18px;
    border: 1px solid var(--nb-border);
    padding: 0.82rem 0.9rem;
  }

  .storage-row p {
    margin: 0.2rem 0 0;
    color: var(--nb-text-soft);
    font-size: 0.82rem;
  }

  .storage-actions {
    display: flex;
    justify-content: flex-end;
  }
</style>
