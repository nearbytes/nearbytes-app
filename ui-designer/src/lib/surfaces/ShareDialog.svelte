<script lang="ts">
  import UiButton from '../components/UiButton.svelte';
  import UiChip from '../components/UiChip.svelte';
  import UiDialog from '../components/UiDialog.svelte';

  let {
    onClose,
  } = $props<{
    onClose?: (() => void) | undefined;
  }>();
</script>

<UiDialog title="Share hub" eyebrow="Dialog" detail="Produce share links, secret payloads, and designer-only capability previews." {onClose}>
  {#snippet body()}
    <div class="share-dialog-grid">
      <div class="share-copy">
        <UiChip label="Link only" tone="accent" />
        <UiChip label="Secret bundle" tone="neutral" />
      </div>
      <div class="share-actions">
        <UiButton label="Copy link" />
        <UiButton label="Copy secret" tone="secondary" />
      </div>
    </div>
  {/snippet}
</UiDialog>

<style>
  .share-dialog-grid {
    display: grid;
    gap: 0.85rem;
  }

  .share-copy,
  .share-actions {
    display: flex;
    gap: 0.65rem;
    flex-wrap: wrap;
  }
</style>
