<script lang="ts">
  import AppDialog from './AppDialog.svelte';
  import ShareSpaceLinkSection from './ShareSpaceLinkSection.svelte';

  type ShareLinkFeedback = { tone: 'success' | 'warning'; message: string } | null;

  let {
    canCopySecretLink = false,
    shareLinkBusy = false,
    shareLinkFeedback = null,
    onCopyShareLink = undefined,
    onManageStorage = undefined,
    onClose,
  } = $props<{
    canCopySecretLink?: boolean;
    shareLinkBusy?: boolean;
    shareLinkFeedback?: ShareLinkFeedback;
    onCopyShareLink?: ((includeSecret: boolean) => Promise<void> | void) | undefined;
    onManageStorage?: (() => void) | undefined;
    onClose?: (() => void) | undefined;
  }>();
</script>

<AppDialog
  ariaLabel="Share this hub"
  eyebrow="Shared hub"
  title="Share this hub"
  subtitle="Copy a compact Nearbytes link or a secret payload, then manage provider routing separately."
  width="wide"
  closeLabel="Close share dialog"
  surfaceClass="volume-share-dialog"
  bodyClass="volume-share-dialog-body"
  onClose={onClose}
>
  {#snippet body()}
    <section class="volume-share-dialog-section">
      <ShareSpaceLinkSection
        canCopySecretLink={canCopySecretLink}
        shareLinkBusy={shareLinkBusy}
        shareLinkFeedback={shareLinkFeedback}
        onCopyShareLink={onCopyShareLink}
        onManageStorage={onManageStorage}
        showManageStorage={true}
      />
    </section>
  {/snippet}
</AppDialog>

<style>
  .volume-share-dialog-section {
    display: grid;
  }

  :global(.volume-share-dialog) {
    width: min(820px, calc(100vw - 2rem));
  }

  :global(.volume-share-dialog-body) {
    gap: 0.95rem;
  }

  @media (max-width: 640px) {
    :global(.volume-share-dialog) {
      width: min(calc(100vw - 0.75rem), 100%);
      max-height: calc(100dvh - 0.75rem);
      border-radius: 22px;
    }
  }

  @media (max-width: 420px) {
    :global(.volume-share-dialog) {
      width: min(calc(100vw - 0.35rem), 100%);
      max-height: calc(100dvh - 0.35rem);
      border-radius: 18px;
    }
  }
</style>