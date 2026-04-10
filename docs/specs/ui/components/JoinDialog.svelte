<script lang="ts">
  import AppDialog from './AppDialog.svelte';
  import JoinLinkSections from './JoinLinkSections.svelte';

  let {
    serialized = '',
    error = '',
    preview = null,
    opened = null,
    clipboardBusy = false,
    previewBusy = false,
    openBusy = false,
    onSerializedInput = undefined,
    onReadClipboard = undefined,
    onOpenLink = undefined,
    onClose = undefined,
  } = $props<{
    serialized?: string;
    error?: string;
    preview?: unknown;
    opened?: unknown;
    clipboardBusy?: boolean;
    previewBusy?: boolean;
    openBusy?: boolean;
    onSerializedInput?: ((value: string) => void) | undefined;
    onReadClipboard?: (() => void | Promise<void>) | undefined;
    onOpenLink?: (() => void | Promise<void>) | undefined;
    onClose?: (() => void) | undefined;
  }>();
</script>

<AppDialog
  ariaLabel="Join a shared hub"
  eyebrow="Join shared hub"
  title="Open from clipboard"
  subtitle="Paste a Nearbytes link or raw share data copied from Nearbytes."
  width="wide"
  closeLabel="Close join dialog"
  onClose={onClose}
>
  {#snippet body()}
    <JoinLinkSections
      {serialized}
      {error}
      {preview}
      {opened}
      {clipboardBusy}
      {previewBusy}
      {openBusy}
      description="Paste the link copied from Nearbytes, or read it from the clipboard."
      onSerializedInput={onSerializedInput}
      onReadClipboard={onReadClipboard}
      onOpenLink={onOpenLink}
    />
  {/snippet}
</AppDialog>