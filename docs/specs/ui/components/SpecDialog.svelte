<script lang="ts">
  import AppDialog from './AppDialog.svelte';

  let {
    title = '',
    filename = '',
    content = '',
    onClose = undefined,
  } = $props<{
    title: string;
    filename: string;
    content: string;
    onClose?: (() => void) | undefined;
  }>();
</script>

<AppDialog
  ariaLabel="Spec details"
  eyebrow="Spec"
  {title}
  subtitle={filename}
  width="wide"
  closeLabel="Close spec"
  onClose={onClose}
>
  {#snippet body()}
    <pre class="spec-dialog-pre">{content}</pre>
  {/snippet}
</AppDialog>

<style>
  .spec-dialog-pre {
    margin: 0;
    padding: 1rem;
    border-radius: 18px;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 86%, transparent);
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 96%, rgba(247, 240, 234, 0.72));
    color: var(--nb-text-main, rgba(28, 28, 30, 0.94));
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    max-height: min(70vh, 820px);
    overflow: auto;
  }
</style>