<script lang="ts">
  import UiButton from '../components/UiButton.svelte';
  import UiDialog from '../components/UiDialog.svelte';

  let {
    canReset = true,
    onClose,
  } = $props<{
    canReset?: boolean;
    onClose?: (() => void) | undefined;
  }>();
</script>

<UiDialog title="Reset application state" eyebrow="Dialog" detail="This destructive surface remains part of the shared UI even when a host cannot fulfill the action." {onClose}>
  {#snippet body()}
    <div class="reset-grid">
      <p>This host preview {canReset ? 'allows' : 'does not allow'} destructive reset wiring.</p>
      <div class="reset-actions">
        <UiButton label="Cancel" tone="secondary" onClick={onClose} />
        <UiButton label="Reset now" tone="danger" disabled={!canReset} />
      </div>
    </div>
  {/snippet}
</UiDialog>

<style>
  .reset-grid {
    display: grid;
    gap: 0.8rem;
  }

  .reset-grid p {
    margin: 0;
    color: var(--nb-text-soft);
    font-size: 0.86rem;
  }

  .reset-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.65rem;
  }
</style>
