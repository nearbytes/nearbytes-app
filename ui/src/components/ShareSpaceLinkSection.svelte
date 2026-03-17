<script lang="ts">
  import { HardDrive, KeyRound, Link2 } from 'lucide-svelte';

  type ShareLinkFeedback = { tone: 'success' | 'warning'; message: string } | null;

  let {
    canCopySecretLink = false,
    shareLinkBusy = false,
    shareLinkFeedback = null,
    onCopyShareLink = undefined,
    onManageStorage = undefined,
    showManageStorage = false,
  } = $props<{
    canCopySecretLink?: boolean;
    shareLinkBusy?: boolean;
    shareLinkFeedback?: ShareLinkFeedback;
    onCopyShareLink?: ((includeSecret: boolean) => Promise<void> | void) | undefined;
    onManageStorage?: (() => void) | undefined;
    showManageStorage?: boolean;
  }>();
</script>

<section class="share-link-section">
  <div class="share-link-head">
    <div class="share-link-heading">
      <p class="share-link-kicker">Hub link</p>
      <h4>Choose what to copy</h4>
      <p class="share-link-copy">Copy a compact link to this hub, or copy the secret payload so someone can open it immediately.</p>
    </div>
    {#if showManageStorage && onManageStorage}
      <button type="button" class="share-link-btn secondary" onclick={onManageStorage}>
        <HardDrive size={15} strokeWidth={2} />
        <span>Open storage sharing</span>
      </button>
    {/if}
  </div>

  <div class="share-link-actions">
    <button
      type="button"
      class="share-link-btn"
      onclick={() => void onCopyShareLink?.(false)}
      disabled={shareLinkBusy || !onCopyShareLink}
      title="Copy a Nearbytes link that points to this hub"
    >
      <Link2 size={15} strokeWidth={2} />
      <span>{shareLinkBusy ? 'Preparing...' : 'Copy link'}</span>
    </button>

    {#if canCopySecretLink}
      <button
        type="button"
        class="share-link-btn secondary"
        onclick={() => void onCopyShareLink?.(true)}
        disabled={shareLinkBusy || !onCopyShareLink}
        title="Copy the hub secret payload so someone can open this hub directly"
      >
        <KeyRound size={15} strokeWidth={2} />
        <span>{shareLinkBusy ? 'Preparing...' : 'Copy secret payload'}</span>
      </button>
    {/if}
  </div>

  <div class="share-link-explainer">
    <p class="share-link-summary-label">What gets embedded</p>
    <p class="share-link-summary">Storage routes are not embedded in shared links anymore. Configure storage sharing separately in storage settings.</p>
    <p class="share-link-note">
      Copy link does not include the secret. Copy secret payload includes the secret so the recipient can open the hub contents immediately.
    </p>
    <p class="share-link-note">
      If the secret payload is too large for nearbytes://, Nearbytes copies raw share data JSON instead. The recipient can still use it by pasting that text into Open from clipboard.
    </p>
    {#if !canCopySecretLink}
      <p class="share-link-note warning">Open this hub from its secret on this device before copying the secret payload variant.</p>
    {/if}
  </div>

  {#if shareLinkFeedback}
    <p class:warning={shareLinkFeedback.tone === 'warning'} class="share-link-feedback">{shareLinkFeedback.message}</p>
  {/if}
</section>

<style>
  .share-link-section {
    display: grid;
    gap: 0.9rem;
    padding: 0.95rem 1rem;
    border-radius: 18px;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 88%, rgba(210, 122, 84, 0.1));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 97%, rgba(252, 244, 238, 0.92));
  }

  .share-link-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .share-link-heading {
    display: grid;
    gap: 0.28rem;
    min-width: 0;
  }

  .share-link-kicker,
  .share-link-heading h4,
  .share-link-copy,
  .share-link-summary-label,
  .share-link-summary,
  .share-link-note,
  .share-link-feedback {
    margin: 0;
  }

  .share-link-kicker {
    font-size: 0.78rem;
    font-weight: 600;
    color: color-mix(in srgb, var(--nb-accent-strong, #b85f39) 28%, var(--nb-text-main, rgba(28, 28, 30, 0.96)));
  }

  .share-link-heading h4 {
    font-family: var(--nb-font-display, 'Avenir Next', 'SF Pro Display', 'Helvetica Neue', Arial, sans-serif);
    font-size: 1rem;
    font-weight: 600;
    color: var(--nb-text-main, rgba(28, 28, 30, 0.96));
  }

  .share-link-copy,
  .share-link-summary,
  .share-link-note,
  .share-link-feedback {
    font-size: 0.83rem;
    line-height: 1.5;
    color: var(--nb-text-soft, rgba(70, 70, 73, 0.76));
  }

  .share-link-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.65rem;
  }

  .share-link-btn {
    appearance: none;
    border: 1px solid color-mix(in srgb, var(--nb-accent, #d27a54) 22%, rgba(60, 60, 67, 0.14));
    background: color-mix(in srgb, var(--nb-accent-soft, rgba(210, 122, 84, 0.08)) 82%, rgba(255, 247, 241, 0.98));
    color: color-mix(in srgb, var(--nb-accent-strong, #b85f39) 74%, rgba(28, 28, 30, 0.96));
    border-radius: 999px;
    padding: 0.68rem 0.95rem;
    display: inline-flex;
    align-items: center;
    gap: 0.48rem;
    font: inherit;
    font-size: 0.88rem;
    font-weight: 600;
    cursor: pointer;
    transition:
      transform 0.18s ease,
      border-color 0.18s ease,
      background-color 0.18s ease,
      color 0.18s ease;
  }

  .share-link-btn.secondary {
    border-color: color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 88%, transparent);
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 96%, var(--nb-shell-bottom, #f4f4f7));
    color: var(--nb-text-main, rgba(28, 28, 30, 0.88));
  }

  .share-link-btn:hover:not(:disabled) {
    transform: translateY(-1px);
  }

  .share-link-btn:disabled {
    opacity: 0.58;
    cursor: default;
    transform: none;
  }

  .share-link-explainer {
    display: grid;
    gap: 0.45rem;
    padding: 0.82rem 0.88rem;
    border-radius: 14px;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 88%, rgba(210, 122, 84, 0.08));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 98%, rgba(252, 244, 238, 0.76));
  }

  .share-link-summary-label {
    font-size: 0.76rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--nb-text-faint, rgba(110, 110, 115, 0.76));
  }

  .share-link-note.warning,
  .share-link-feedback.warning {
    color: rgba(126, 76, 34, 0.96);
  }

  @media (max-width: 720px) {
    .share-link-head {
      flex-direction: column;
      align-items: stretch;
    }

    .share-link-actions {
      flex-direction: column;
    }

    .share-link-btn {
      width: 100%;
      justify-content: center;
    }
  }
</style>