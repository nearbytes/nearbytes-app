<script lang="ts">
  import UiButton from '../components/UiButton.svelte';
  import UiDialog from '../components/UiDialog.svelte';

  let {
    onClose,
  } = $props<{
    onClose?: (() => void) | undefined;
  }>();
</script>

<UiDialog title="Join hub" eyebrow="Dialog" detail="Parse a join payload, confirm the hub identity, then enter the shared workspace." {onClose}>
  {#snippet body()}
    <div class="dialog-grid">
      <label>
        <span>Join payload</span>
        <textarea rows="5" placeholder="nearbytes://join#..."></textarea>
      </label>
      <div class="dialog-actions">
        <UiButton label="Preview link" tone="secondary" />
        <UiButton label="Join hub" />
      </div>
    </div>
  {/snippet}
</UiDialog>

<style>
  .dialog-grid {
    display: grid;
    gap: 0.85rem;
  }

  label {
    display: grid;
    gap: 0.4rem;
    color: var(--nb-text-soft);
    font-size: 0.82rem;
  }

  textarea {
    border-radius: 18px;
    border: 1px solid var(--nb-border);
    padding: 0.85rem;
    resize: vertical;
    background: color-mix(in srgb, var(--nb-surface-strong) 90%, var(--nb-accent-soft));
    color: var(--nb-text);
    font: inherit;
  }

  .dialog-actions {
    display: flex;
    gap: 0.7rem;
    justify-content: flex-end;
  }
</style>
