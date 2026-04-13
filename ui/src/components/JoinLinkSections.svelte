<script lang="ts">
  import { ClipboardPaste } from 'lucide-svelte';
  import type { JoinLinkOpenResponse, JoinLinkParseResponse } from '../lib/api.js';
  import {
    joinDialogActionStatusLabel,
    joinDialogActionTitle,
    joinDialogActionTone,
    joinDialogAttachmentTitle,
    joinDialogEndpointLabel,
    joinDialogSpaceSummary,
  } from '../lib/joinLinkPresentation.js';
  import StatusNotice from '../../../ui-designer/src/lib/components/StatusNotice.svelte';

  let {
    serialized,
    error = '',
    preview = null,
    opened = null,
    clipboardBusy = false,
    previewBusy = false,
    openBusy = false,
    description = 'Copy the share link, then paste it here or press Paste from clipboard.',
    pasteLabel = 'Paste from clipboard',
    openLabel = 'Open shared hub',
    onSerializedInput,
    onReadClipboard,
    onOpenLink,
  } = $props<{
    serialized: string;
    error?: string;
    preview?: JoinLinkParseResponse | JoinLinkOpenResponse | null;
    opened?: JoinLinkOpenResponse | null;
    clipboardBusy?: boolean;
    previewBusy?: boolean;
    openBusy?: boolean;
    description?: string;
    pasteLabel?: string;
    openLabel?: string;
    onSerializedInput?: ((value: string) => void) | undefined;
    onReadClipboard?: (() => void | Promise<void>) | undefined;
    onOpenLink?: (() => void | Promise<void>) | undefined;
  }>();

  function handleSerializedInput(event: Event): void {
    onSerializedInput?.((event.currentTarget as HTMLTextAreaElement).value);
  }
</script>

<section class="join-dialog-section join-dialog-input-shell">
  <div class="join-dialog-input-head">
    <div>
      <p class="join-dialog-section-title">Join link</p>
      <p class="join-dialog-note">{description}</p>
    </div>
    <button
      type="button"
      class="join-link-btn secondary"
      onclick={() => void onReadClipboard?.()}
      disabled={clipboardBusy || previewBusy || openBusy}
    >
      <ClipboardPaste class="button-icon" size={15} strokeWidth={2} />
      <span>{clipboardBusy ? 'Reading…' : pasteLabel}</span>
    </button>
  </div>

  <textarea
    class="join-dialog-textarea"
    value={serialized}
    oninput={handleSerializedInput}
    spellcheck="false"
    placeholder="nearbytes://join?data=..."
  ></textarea>

  <div class="join-dialog-actions">
    <button
      type="button"
      class="join-link-btn"
      onclick={() => void onOpenLink?.()}
      disabled={openBusy || previewBusy || clipboardBusy}
    >
      <span>{openBusy ? 'Opening…' : openLabel}</span>
    </button>
  </div>

  {#if error}
    <StatusNotice tone="error" role="alert" compact={true} message={error} />
  {/if}
</section>

{#if preview}
  <section class="join-dialog-section">
    <div class="join-dialog-preview-head">
      <span class="join-dialog-chip strong">{joinDialogSpaceSummary(preview.space)}</span>
      <span class="join-dialog-chip">{preview.plan.attachments.length} storage route{preview.plan.attachments.length === 1 ? '' : 's'}</span>
    </div>

    {#if preview.plan.attachments.length === 0}
      <p class="join-dialog-note">This link tells Nearbytes which hub to join, but it does not include any extra shared storage routes.</p>
    {:else}
      <div class="join-dialog-route-list">
        {#each preview.plan.attachments as attachment}
          <article class="join-dialog-route-card">
            <div class="join-dialog-route-head">
              <div>
                <p class="join-dialog-route-title">{joinDialogAttachmentTitle(attachment)}</p>
                <p class="join-dialog-route-detail">
                  {attachment.selectedEndpoint?.reason ?? 'No supported route is available for this storage yet.'}
                </p>
              </div>
              {#if attachment.selectedEndpoint}
                <span class="join-dialog-chip strong">{joinDialogEndpointLabel(attachment.selectedEndpoint)}</span>
              {:else}
                <span class="join-dialog-chip warning">Unavailable</span>
              {/if}
            </div>
          </article>
        {/each}
      </div>
    {/if}
  </section>
{/if}

{#if opened}
  <section class="join-dialog-section">
    <div class="join-dialog-result-head">
      <p class="join-dialog-section-title">Join result</p>
      {#if opened.secret === null}
        <span class="join-dialog-chip warning">No secret included</span>
      {/if}
    </div>

    {#if opened.secret === null}
      <p class="join-dialog-note">Nearbytes staged the shared storage, but this link does not contain the hub secret. You still need the secret to open the hub contents.</p>
    {/if}

    <div class="join-dialog-result-list">
      {#each opened.actions as action}
        <div class={`join-dialog-result-row ${joinDialogActionTone(action.status)}`}>
          <div>
            <p class="join-dialog-route-title">{joinDialogActionTitle(action)}</p>
            <p class="join-dialog-route-detail">{action.detail}</p>
            {#if action.suggestedLocalPath}
              <p class="join-dialog-path">Nearbytes will mirror it in: {action.suggestedLocalPath}</p>
            {/if}
          </div>
          <span class="join-dialog-chip strong">{joinDialogActionStatusLabel(action)}</span>
        </div>
      {/each}
    </div>
  </section>
{/if}

<style>
  .join-dialog-section {
    display: grid;
    gap: 0.78rem;
    padding: 1rem;
    border-radius: 16px;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 88%, rgba(0, 0, 0, 0.04));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 98%, rgba(245, 243, 240, 0.88));
  }

  .join-dialog-section-title {
    margin: 0;
    font-family: var(--nb-font-display);
    font-size: 0.88rem;
    font-weight: 600;
    color: color-mix(in srgb, var(--nb-accent-strong, #5d524a) 28%, var(--nb-text-main, rgba(28, 28, 30, 0.96)));
  }

  .join-dialog-input-shell {
    gap: 0.9rem;
  }

  .join-dialog-input-head > :first-child,
  .join-dialog-preview-head > :first-child,
  .join-dialog-result-head > :first-child,
  .join-dialog-route-head > :first-child {
    min-width: 0;
    flex: 1 1 auto;
  }

  .join-dialog-input-head,
  .join-dialog-preview-head,
  .join-dialog-result-head,
  .join-dialog-route-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .join-dialog-textarea {
    width: 100%;
    min-height: 8.75rem;
    resize: vertical;
    border-radius: 16px;
    border: 1px solid var(--nb-border, rgba(60, 60, 67, 0.12));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 96%, var(--nb-shell-bottom, #f4f4f7));
    color: var(--nb-text-main, rgba(28, 28, 30, 0.96));
    padding: 0.95rem 1rem;
    font: 0.92rem/1.45 'Cascadia Code', 'Fira Code', Consolas, monospace;
  }

  .join-dialog-textarea:focus {
    outline: none;
    border-color: color-mix(in srgb, var(--nb-accent, #7c6f64) 44%, transparent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--nb-accent-soft, rgba(0, 0, 0, 0.03)) 90%, transparent);
  }

  .join-dialog-note,
  .join-dialog-route-detail,
  .join-dialog-path {
    margin: 0;
    font-size: 0.82rem;
    line-height: 1.5;
    color: var(--nb-text-soft, rgba(70, 70, 73, 0.76));
  }

  .join-dialog-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.65rem;
  }

  .join-link-btn {
    min-height: 40px;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--nb-accent, #7c6f64) 22%, rgba(60, 60, 67, 0.14));
    background: color-mix(in srgb, var(--nb-accent-soft, rgba(0, 0, 0, 0.03)) 80%, var(--nb-panel-bg, #ffffff));
    color: var(--nb-text-main, rgba(28, 28, 30, 0.96));
    padding: 0.65rem 0.95rem;
    font: inherit;
    font-size: 0.84rem;
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.45rem;
    cursor: pointer;
  }

  .join-link-btn.secondary {
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 94%, rgba(245, 243, 240, 0.92));
    border-color: color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 90%, rgba(0, 0, 0, 0.04));
    color: var(--nb-text-soft, rgba(70, 70, 73, 0.86));
  }

  .join-link-btn:disabled {
    cursor: default;
    opacity: 0.62;
  }

  .join-dialog-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.34rem 0.65rem;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 88%, rgba(0, 0, 0, 0.03));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 96%, rgba(245, 243, 240, 0.88));
    color: var(--nb-text-main, rgba(28, 28, 30, 0.9));
    font-size: 0.75rem;
    font-weight: 600;
    max-width: 100%;
    white-space: normal;
    word-break: break-word;
  }

  .join-dialog-chip.strong {
    border-color: color-mix(in srgb, var(--nb-accent, #7c6f64) 26%, rgba(60, 60, 67, 0.14));
    background: color-mix(in srgb, var(--nb-accent-soft, rgba(0, 0, 0, 0.03)) 82%, rgba(245, 243, 240, 0.98));
    color: color-mix(in srgb, var(--nb-accent-strong, #5d524a) 74%, rgba(28, 28, 30, 0.96));
  }

  .join-dialog-chip.warning {
    border-color: color-mix(in srgb, #d4945f 34%, rgba(60, 60, 67, 0.14));
    background: rgba(242, 223, 206, 0.86);
    color: rgba(126, 76, 34, 0.96);
  }

  .join-dialog-route-list,
  .join-dialog-result-list {
    display: grid;
    gap: 0.75rem;
  }

  .join-dialog-route-card,
  .join-dialog-result-row {
    display: grid;
    gap: 0.55rem;
    padding: 0.9rem 0.95rem;
    border-radius: 14px;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 88%, rgba(0, 0, 0, 0.03));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 97%, rgba(245, 243, 240, 0.88));
  }

  .join-dialog-result-row {
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: start;
  }

  .join-dialog-result-row.success {
    border-color: rgba(104, 170, 117, 0.24);
    background: rgba(232, 242, 233, 0.94);
  }

  .join-dialog-result-row.warning {
    border-color: rgba(212, 148, 95, 0.28);
    background: rgba(247, 236, 225, 0.94);
  }

  .join-dialog-route-title {
    margin: 0;
    font-size: 0.88rem;
    font-weight: 600;
    color: var(--nb-text-main, rgba(28, 28, 30, 0.96));
  }

  @media (max-width: 720px) {
    .join-dialog-input-head,
    .join-dialog-preview-head,
    .join-dialog-result-head,
    .join-dialog-route-head,
    .join-dialog-actions {
      flex-direction: column;
      align-items: stretch;
    }

    .join-dialog-result-row {
      grid-template-columns: 1fr;
    }

    .join-dialog-input-head > :first-child,
    .join-dialog-route-head > :first-child,
    .join-link-btn {
      width: 100%;
    }

    .join-dialog-section {
      padding: 0.88rem;
      border-radius: 14px;
    }

    .join-dialog-textarea {
      min-height: 6.75rem;
      padding: 0.82rem 0.88rem;
      font-size: 16px;
      line-height: 1.45;
    }

    .join-dialog-chip {
      width: 100%;
      justify-content: center;
      text-align: center;
    }

    .join-dialog-route-card,
    .join-dialog-result-row {
      padding: 0.82rem 0.84rem;
    }
  }

  @media (max-width: 420px) {
    .join-dialog-section {
      gap: 0.68rem;
      padding: 0.74rem;
    }

    .join-dialog-note,
    .join-dialog-route-detail,
    .join-dialog-path {
      font-size: 0.78rem;
    }
  }
</style>