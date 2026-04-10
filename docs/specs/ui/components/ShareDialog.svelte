<script lang="ts">
  import AppDialog from './AppDialog.svelte';
  import ShareSpaceLinkSection from './ShareSpaceLinkSection.svelte';

  let {
    canCopySecretLink = false,
    shareLinkBusy = false,
    shareLinkFeedback = null,
    onCopyShareLink = undefined,
    onManageStorage = undefined,
    onClose = undefined,
  } = $props<{
    canCopySecretLink?: boolean;
    shareLinkBusy?: boolean;
    shareLinkFeedback?: { tone: 'success' | 'warning'; message: string } | null;
    onCopyShareLink?: ((includeSecret: boolean) => Promise<void>) | undefined;
    onManageStorage?: (() => void) | undefined;
    onClose?: (() => void) | undefined;
  }>();
</script>

<AppDialog
  ariaLabel="Share this hub"
  eyebrow="Shared hub"
  title="Share this hub"
  width="wide"
  closeLabel="Close share dialog"
  onClose={onClose}
>
  {#snippet body()}
    <section class="share-dialog-section">
      <ShareSpaceLinkSection
        {canCopySecretLink}
        {shareLinkBusy}
        shareLinkFeedback={shareLinkFeedback}
        onCopyShareLink={onCopyShareLink}
        onManageStorage={onManageStorage}
        showManageStorage={true}
      />
    </section>
  {/snippet}
</AppDialog>

<style>
  .share-dialog-section {
    display: grid;
    gap: 0.8rem;
  }
</style>