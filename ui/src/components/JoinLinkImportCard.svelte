<script lang="ts">
  import {
    openJoinLink,
    parseJoinLink,
    type JoinLinkOpenResponse,
    type JoinLinkParseResponse,
  } from '../lib/api.js';

  type Props = {
    onOpened?: (response: JoinLinkOpenResponse) => Promise<void> | void;
    importedSerialized?: string;
    importedNonce?: number;
    title?: string;
    subtitle?: string;
    onClose?: () => void;
    compact?: boolean;
    variant?: 'light' | 'dock';
  };

  const {
    onOpened,
    importedSerialized = '',
    importedNonce = 0,
    title = 'Open a Join or Share Link',
    subtitle = 'Paste an nb.join.v1 payload to preview provider routes, then open the space or attach the suggested share paths.',
    onClose,
    compact = false,
    variant = 'light',
  }: Props = $props();

  let serialized = $state('');
  let allowCredentialBootstrap = $state(false);
  let preview = $state<JoinLinkParseResponse | null>(null);
  let opened = $state<JoinLinkOpenResponse | null>(null);
  let errorMessage = $state('');
  let previewBusy = $state(false);
  let openBusy = $state(false);
  let lastImportedNonce = $state(0);

  $effect(() => {
    if (!importedSerialized.trim() || importedNonce === 0 || importedNonce === lastImportedNonce) {
      return;
    }
    lastImportedNonce = importedNonce;
    serialized = importedSerialized;
    void handlePreview();
  });

  function endpointLabel(candidate: NonNullable<JoinLinkParseResponse['plan']['attachments'][number]['selectedEndpoint']>): string {
    const endpoint = candidate.endpoint;
    if (endpoint.label?.trim()) {
      return endpoint.label.trim();
    }
    if (endpoint.transport === 'provider-share') {
      return endpoint.provider?.trim() || 'Provider share';
    }
    return endpoint.transport;
  }

  function actionTone(status: JoinLinkOpenResponse['actions'][number]['status']): 'success' | 'warning' | 'neutral' {
    if (status === 'attached') {
      return 'success';
    }
    if (status === 'needs-account' || status === 'pending-auth' || status === 'unsupported') {
      return 'warning';
    }
    return 'neutral';
  }

  async function handlePreview(): Promise<void> {
    const text = serialized.trim();
    if (!text) {
      errorMessage = 'Paste a join/share link payload first.';
      return;
    }
    previewBusy = true;
    errorMessage = '';
    opened = null;
    try {
      preview = await parseJoinLink({
        serialized: text,
      });
    } catch (error) {
      preview = null;
      errorMessage = error instanceof Error ? error.message : 'Failed to preview this link';
    } finally {
      previewBusy = false;
    }
  }

  async function handleOpen(): Promise<void> {
    const text = serialized.trim();
    if (!text) {
      errorMessage = 'Paste a join/share link payload first.';
      return;
    }
    openBusy = true;
    errorMessage = '';
    try {
      const response = await openJoinLink({
        serialized: text,
        allowCredentialBootstrap,
      });
      preview = response;
      opened = response;
      if (onOpened) {
        await onOpened(response);
      }
    } catch (error) {
      opened = null;
      errorMessage = error instanceof Error ? error.message : 'Failed to open this link';
    } finally {
      openBusy = false;
    }
  }
</script>

<section class="join-link-card" class:compact class:variant-dock={variant === 'dock'}>
  <div class="join-link-card-head">
    <div>
      <h2>{title}</h2>
      <p>{subtitle}</p>
    </div>
    {#if onClose}
      <button type="button" class="join-link-close" aria-label="Close join link panel" onclick={() => onClose()}>
        Close
      </button>
    {/if}
  </div>

  <label class="join-link-input-label" for="join-link-import-textarea">Join/share link</label>
  <textarea
    id="join-link-import-textarea"
    class="join-link-input"
    bind:value={serialized}
    spellcheck="false"
    placeholder="Paste canonical join/share link JSON here"
  ></textarea>

  <label class="join-link-toggle">
    <input type="checkbox" bind:checked={allowCredentialBootstrap} />
    <span>Use embedded provider sign-in details when present</span>
  </label>
  <p class="join-link-toggle-note">Off by default. Enable this only when you trust the sender and want Nearbytes to use link-carried provider credentials during setup. Links copied by this app do not embed provider passwords.</p>

  <div class="join-link-actions">
    <button type="button" class="join-link-button secondary" onclick={() => void handlePreview()} disabled={previewBusy || openBusy}>
      {previewBusy ? 'Previewing...' : 'Preview routes'}
    </button>
    <button type="button" class="join-link-button primary" onclick={() => void handleOpen()} disabled={openBusy || previewBusy}>
      {openBusy ? 'Opening...' : 'Open link'}
    </button>
  </div>

  {#if errorMessage}
    <p class="join-link-message error">{errorMessage}</p>
  {/if}

  {#if preview}
    <div class="join-link-preview">
      <div class="join-link-preview-head">
        <span class="join-link-chip">Space: {preview.space.mode === 'volume-id' ? 'volume id only' : preview.space.mode}</span>
        <span class="join-link-chip">Attachments: {preview.plan.attachments.length}</span>
      </div>

      {#if preview.plan.attachments.length === 0}
        <p class="join-link-message neutral">This link only identifies a space. No provider routes were included.</p>
      {:else}
        <div class="join-link-attachment-list">
          {#each preview.plan.attachments as attachment (attachment.attachment.id)}
            <article class="join-link-attachment-card">
              <div class="join-link-attachment-head">
                <h3>{attachment.attachment.label}</h3>
                {#if attachment.selectedEndpoint}
                  <span class="join-link-chip strong">{endpointLabel(attachment.selectedEndpoint)}</span>
                {:else}
                  <span class="join-link-chip warning">No supported route</span>
                {/if}
              </div>
              <p class="join-link-attachment-detail">
                {attachment.selectedEndpoint?.reason || 'This build cannot use any of the suggested routes yet.'}
              </p>
              {#if attachment.selectedEndpoint?.badges?.length}
                <div class="join-link-badge-row">
                  {#each attachment.selectedEndpoint.badges as badge (badge)}
                    <span class="join-link-badge">{badge}</span>
                  {/each}
                </div>
              {/if}
            </article>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  {#if opened}
    <div class="join-link-open-result">
      <h3>Open result</h3>
      {#if opened.secret === null}
        <p class="join-link-message neutral">This link did not include the space secret. Nearbytes can stage share routes, but you still need the secret separately to open the contents.</p>
      {/if}
      <div class="join-link-result-list">
        {#each opened.actions as action (`${action.attachmentId}-${action.provider || action.endpointTransport || 'route'}`)}
          <div class={`join-link-result-row ${actionTone(action.status)}`}>
            <div>
              <strong>{action.attachmentId}</strong>
              <p>{action.detail}</p>
              {#if action.suggestedLocalPath}
                <p class="join-link-path">Suggested folder: {action.suggestedLocalPath}</p>
              {/if}
            </div>
            <span class="join-link-chip strong">{action.status}</span>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</section>

<style>
  .join-link-card {
    width: min(760px, 100%);
    padding: 1.25rem;
    border-radius: 22px;
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.95), rgba(246, 240, 231, 0.98)),
      linear-gradient(135deg, rgba(171, 138, 92, 0.08), rgba(71, 117, 108, 0.08));
    border: 1px solid rgba(107, 88, 57, 0.18);
    box-shadow: 0 24px 60px rgba(47, 36, 18, 0.08);
    display: grid;
    gap: 0.9rem;
  }

  .join-link-card.compact {
    width: 100%;
    padding: 0.9rem;
    border-radius: 16px;
    gap: 0.7rem;
  }

  .join-link-card.variant-dock {
    background:
      linear-gradient(180deg, rgba(12, 24, 43, 0.92), rgba(9, 18, 34, 0.9)),
      rgba(9, 18, 34, 0.9);
    border: 1px solid rgba(56, 189, 248, 0.16);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
  }

  .join-link-card-head h2,
  .join-link-open-result h3,
  .join-link-attachment-head h3 {
    margin: 0;
    color: #2f2412;
  }

  .join-link-card.compact .join-link-card-head h2 {
    font-size: 0.98rem;
  }

  .join-link-card.variant-dock .join-link-card-head h2,
  .join-link-card.variant-dock .join-link-open-result h3,
  .join-link-card.variant-dock .join-link-attachment-head h3 {
    color: rgba(226, 232, 240, 0.96);
  }

  .join-link-card-head p,
  .join-link-toggle-note,
  .join-link-attachment-detail,
  .join-link-result-row p,
  .join-link-message,
  .join-link-path {
    margin: 0;
    color: #66563d;
  }

  .join-link-card.compact .join-link-card-head p,
  .join-link-card.compact .join-link-toggle-note,
  .join-link-card.compact .join-link-attachment-detail,
  .join-link-card.compact .join-link-result-row p,
  .join-link-card.compact .join-link-message,
  .join-link-card.compact .join-link-path {
    font-size: 0.8rem;
  }

  .join-link-card.variant-dock .join-link-card-head p,
  .join-link-card.variant-dock .join-link-toggle-note,
  .join-link-card.variant-dock .join-link-attachment-detail,
  .join-link-card.variant-dock .join-link-result-row p,
  .join-link-card.variant-dock .join-link-message,
  .join-link-card.variant-dock .join-link-path {
    color: rgba(191, 219, 254, 0.78);
  }

  .join-link-input-label {
    font-size: 0.9rem;
    font-weight: 600;
    color: #4f4128;
  }

  .join-link-card.variant-dock .join-link-input-label,
  .join-link-card.variant-dock .join-link-toggle {
    color: rgba(226, 232, 240, 0.9);
  }

  .join-link-input {
    min-height: 10rem;
    padding: 0.95rem 1rem;
    border-radius: 16px;
    border: 1px solid rgba(107, 88, 57, 0.22);
    background: rgba(255, 252, 247, 0.94);
    color: #2b2110;
    font: 0.94rem/1.45 "Cascadia Code", "Fira Code", Consolas, monospace;
    resize: vertical;
  }

  .join-link-card.compact .join-link-input {
    min-height: 5.25rem;
    padding: 0.78rem 0.85rem;
    border-radius: 12px;
    font-size: 0.82rem;
  }

  .join-link-card.variant-dock .join-link-input {
    border-color: rgba(56, 189, 248, 0.18);
    background: rgba(8, 14, 28, 0.72);
    color: rgba(226, 232, 240, 0.95);
  }

  .join-link-toggle {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    color: #3e321d;
    font-weight: 600;
  }

  .join-link-card.compact .join-link-toggle {
    gap: 0.55rem;
    font-size: 0.82rem;
  }

  .join-link-actions,
  .join-link-card-head,
  .join-link-preview-head,
  .join-link-badge-row,
  .join-link-attachment-head {
    display: flex;
    flex-wrap: wrap;
    gap: 0.65rem;
    align-items: center;
  }

  .join-link-card-head {
    justify-content: space-between;
    align-items: flex-start;
  }

  .join-link-close {
    border: 0;
    background: rgba(107, 88, 57, 0.1);
    color: #5b4927;
    border-radius: 999px;
    padding: 0.45rem 0.8rem;
    font: inherit;
    font-weight: 700;
    cursor: pointer;
  }

  .join-link-card.variant-dock .join-link-close {
    background: rgba(56, 189, 248, 0.12);
    color: rgba(226, 232, 240, 0.9);
  }

  .join-link-button {
    border: 0;
    border-radius: 999px;
    padding: 0.72rem 1.1rem;
    font: inherit;
    font-weight: 700;
    cursor: pointer;
  }

  .join-link-card.compact .join-link-button {
    padding: 0.58rem 0.92rem;
    font-size: 0.82rem;
  }

  .join-link-button.primary {
    background: #2f6b61;
    color: #f8fbfa;
  }

  .join-link-button.secondary {
    background: #efe4d0;
    color: #4a3920;
  }

  .join-link-button:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .join-link-chip,
  .join-link-badge {
    display: inline-flex;
    align-items: center;
    padding: 0.28rem 0.62rem;
    border-radius: 999px;
    background: rgba(107, 88, 57, 0.1);
    color: #5d4827;
    font-size: 0.78rem;
    font-weight: 700;
  }

  .join-link-card.compact .join-link-chip,
  .join-link-card.compact .join-link-badge {
    font-size: 0.72rem;
  }

  .join-link-card.variant-dock .join-link-chip,
  .join-link-card.variant-dock .join-link-badge {
    background: rgba(56, 189, 248, 0.12);
    color: rgba(191, 219, 254, 0.92);
  }

  .join-link-chip.strong {
    background: rgba(47, 107, 97, 0.12);
    color: #24554d;
  }

  .join-link-card.variant-dock .join-link-chip.strong {
    background: rgba(34, 197, 94, 0.16);
    color: rgba(187, 247, 208, 0.96);
  }

  .join-link-chip.warning {
    background: rgba(164, 91, 56, 0.14);
    color: #8a4722;
  }

  .join-link-card.variant-dock .join-link-chip.warning {
    background: rgba(251, 191, 36, 0.14);
    color: rgba(253, 224, 71, 0.96);
  }

  .join-link-attachment-list,
  .join-link-result-list {
    display: grid;
    gap: 0.7rem;
  }

  .join-link-attachment-card,
  .join-link-result-row {
    padding: 0.9rem 1rem;
    border-radius: 16px;
    background: rgba(255, 255, 255, 0.8);
    border: 1px solid rgba(107, 88, 57, 0.14);
  }

  .join-link-card.compact .join-link-attachment-card,
  .join-link-card.compact .join-link-result-row {
    padding: 0.72rem 0.8rem;
    border-radius: 12px;
  }

  .join-link-card.variant-dock .join-link-attachment-card,
  .join-link-card.variant-dock .join-link-result-row {
    background: rgba(8, 14, 28, 0.62);
    border-color: rgba(56, 189, 248, 0.14);
  }

  .join-link-result-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.8rem;
  }

  .join-link-result-row.success {
    border-color: rgba(47, 107, 97, 0.24);
  }

  .join-link-result-row.warning {
    border-color: rgba(164, 91, 56, 0.24);
  }

  .join-link-message.error {
    color: #9a3f34;
  }

  .join-link-card.variant-dock .join-link-message.error {
    color: rgba(252, 165, 165, 0.98);
  }

  @media (max-width: 720px) {
    .join-link-card {
      padding: 1rem;
      border-radius: 18px;
    }

    .join-link-result-row {
      flex-direction: column;
    }
  }
</style>