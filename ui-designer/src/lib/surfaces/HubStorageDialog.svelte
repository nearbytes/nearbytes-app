<script lang="ts">
  import UiButton from '../components/UiButton.svelte';
  import UiDialog from '../components/UiDialog.svelte';

  let {
    onClose,
  } = $props<{
    onClose?: (() => void) | undefined;
  }>();
</script>

<UiDialog title="Per-hub storage" eyebrow="Dialog" detail="A hub-specific routing surface that later receives real destination data as props." {onClose}>
  {#snippet body()}
    <div class="hub-storage-grid">
      <label><input type="checkbox" checked> Store encrypted events locally</label>
      <label><input type="checkbox" checked> Copy source blocks into archive lane</label>
      <label><input type="checkbox"> Mark this lane read-only</label>
      <div class="hub-storage-actions">
        <UiButton label="Save routing" />
      </div>
    </div>
  {/snippet}
</UiDialog>

<style>
  .hub-storage-grid {
    display: grid;
    gap: 0.75rem;
  }

  label {
    display: flex;
    gap: 0.55rem;
    align-items: center;
    color: var(--nb-text-soft);
    font-size: 0.86rem;
  }

  .hub-storage-actions {
    display: flex;
    justify-content: flex-end;
  }
</style>
