<script lang="ts">
  import { ClipboardPaste, Plus, Trash2, X } from 'lucide-svelte';
  import ArmedActionButton from './ArmedActionButton.svelte';
  import JoinLinkSections from './JoinLinkSections.svelte';
  import SharedSecretEditor from './SharedSecretEditor.svelte';
  import StatusNotice from './StatusNotice.svelte';

  type MountDialogMount = {
    id: string;
    address: string;
    password: string;
    secretFileName: string;
    secretFileMimeType: string;
  };

  type JoinDialogPreview = unknown;

  let {
    mount,
    isEmpty = false,
    mountLabel = '',
    mode = 'secret',
    resolvedVolumeId = '',
    resolvedLastRefresh = '',
    storageLabel = '',
    isHistoryMode = false,
    resolvedOffline = false,
    resolvedError = '',
    joinDialogSerialized = '',
    joinDialogError = '',
    joinDialogPreview = null,
    joinDialogClipboardBusy = false,
    joinDialogPreviewBusy = false,
    joinDialogOpenBusy = false,
    clipboardImageAvailable = false,
    clipboardImageLoading = false,
    filePreviewUrl = null,
    fileIsImage = false,
    fileInfo = '',
    fileHashLabel = '',
    fileHashValue = '',
    fileHashPending = false,
    loading = false,
    onClose = undefined,
    onCopyVolumeId = undefined,
    onOpenStorage = undefined,
    onSetMode = undefined,
    onJoinSerializedInput = undefined,
    onReadClipboard = undefined,
    onOpenLink = undefined,
    onSecretValueInput = undefined,
    onSecretPasswordInput = undefined,
    onSecretFileSelected = undefined,
    onPasteButton = undefined,
    onDownloadFile = undefined,
    onRemove = undefined,
  } = $props<{
    mount: MountDialogMount;
    isEmpty?: boolean;
    mountLabel?: string;
    mode?: 'secret' | 'join-link';
    resolvedVolumeId?: string;
    resolvedLastRefresh?: string;
    storageLabel?: string;
    isHistoryMode?: boolean;
    resolvedOffline?: boolean;
    resolvedError?: string;
    joinDialogSerialized?: string;
    joinDialogError?: string;
    joinDialogPreview?: JoinDialogPreview;
    joinDialogClipboardBusy?: boolean;
    joinDialogPreviewBusy?: boolean;
    joinDialogOpenBusy?: boolean;
    clipboardImageAvailable?: boolean;
    clipboardImageLoading?: boolean;
    filePreviewUrl?: string | null;
    fileIsImage?: boolean;
    fileInfo?: string;
    fileHashLabel?: string;
    fileHashValue?: string;
    fileHashPending?: boolean;
    loading?: boolean;
    onClose?: (() => void) | undefined;
    onCopyVolumeId?: (() => void | Promise<void>) | undefined;
    onOpenStorage?: (() => void) | undefined;
    onSetMode?: ((mode: 'secret' | 'join-link') => void) | undefined;
    onJoinSerializedInput?: ((value: string) => void) | undefined;
    onReadClipboard?: (() => void | Promise<void>) | undefined;
    onOpenLink?: (() => void | Promise<void>) | undefined;
    onSecretValueInput?: ((value: string) => void) | undefined;
    onSecretPasswordInput?: ((value: string) => void) | undefined;
    onSecretFileSelected?: ((file: globalThis.File) => void | Promise<void>) | undefined;
    onPasteButton?: (() => void | Promise<void>) | undefined;
    onDownloadFile?: (() => void | Promise<void>) | undefined;
    onRemove?: (() => void) | undefined;
  }>();

  function handleBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      onClose?.();
    }
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') {
      return;
    }
    event.preventDefault();
    onClose?.();
  }
</script>

<div
  class="mount-dialog-backdrop"
  role="dialog"
  aria-modal="true"
  aria-label={isEmpty ? 'Create hub' : 'Edit hub properties'}
  tabindex="-1"
  onclick={handleBackdropClick}
  onkeydown={handleKeydown}
>
  <div class="mount-dialog panel-surface" role="document" tabindex="-1" data-mount-id={mount.id}>
    <div class="mount-dialog-header">
      <div class="mount-dialog-head-meta">
        <p class="mount-dialog-eyebrow">Hub properties</p>
        {#if !isEmpty}
          <p class="mount-dialog-title">{mountLabel || 'Unnamed hub'}</p>
          {#if resolvedVolumeId || resolvedLastRefresh || storageLabel || isHistoryMode || resolvedOffline}
            <div class="mount-dialog-info-row" aria-label="Hub details">
              {#if resolvedVolumeId}
                <div class="mount-dialog-info-item">
                  <span class="mount-dialog-info-label">Hub ID</span>
                  <button class="volume-id-btn" onclick={() => void onCopyVolumeId?.()} title="Copy hub ID">
                    {resolvedVolumeId.slice(0, 16)}...
                  </button>
                </div>
              {/if}
              <div class="mount-dialog-info-item mount-dialog-info-item-storage">
                <span class="mount-dialog-info-label">Storage</span>
                <span class="mount-dialog-info-value mount-dialog-info-value-storage">{storageLabel}</span>
                <button
                  type="button"
                  class="mount-dialog-inline-action"
                  onclick={() => onOpenStorage?.()}
                  disabled={!resolvedVolumeId}
                >
                  <span>Change</span>
                </button>
              </div>
              {#if resolvedLastRefresh}
                <div class="mount-dialog-info-item mount-dialog-info-item-refresh">
                  <span class="mount-dialog-info-label">Updated</span>
                  <span class="mount-dialog-info-value mount-dialog-info-value-refresh">{resolvedLastRefresh}</span>
                </div>
              {/if}
              {#if isHistoryMode}
                <span class="mount-dialog-info-pill">History mode</span>
              {/if}
              {#if resolvedOffline}
                <span class="mount-dialog-info-pill">Offline</span>
              {/if}
            </div>
          {/if}
          {#if resolvedError}
            <StatusNotice tone="error" role="alert" compact={true} message={resolvedError} />
          {/if}
        {/if}
        {#if isEmpty}
          <div class="mount-dialog-mode-switch" role="tablist" aria-label="Create hub mode">
            <button
              type="button"
              class="mount-dialog-mode-btn"
              class:active={mode === 'secret'}
              aria-pressed={mode === 'secret'}
              onclick={() => onSetMode?.('secret')}
            >
              <Plus size={14} strokeWidth={2.2} />
              <span>Secret</span>
            </button>
            <button
              type="button"
              class="mount-dialog-mode-btn"
              class:active={mode === 'join-link'}
              aria-pressed={mode === 'join-link'}
              onclick={() => onSetMode?.('join-link')}
            >
              <ClipboardPaste size={14} strokeWidth={2} />
              <span>Paste link</span>
            </button>
          </div>
        {/if}
      </div>
      <button type="button" class="dialog-close-btn" aria-label="Close hub properties" onclick={() => onClose?.()}>
        <X size={18} strokeWidth={2} />
      </button>
    </div>

    <div class="mount-dialog-body">
      {#if mode === 'join-link' && isEmpty}
        <JoinLinkSections
          serialized={joinDialogSerialized}
          error={joinDialogError}
          preview={joinDialogPreview}
          clipboardBusy={joinDialogClipboardBusy}
          previewBusy={joinDialogPreviewBusy}
          openBusy={joinDialogOpenBusy}
          onSerializedInput={(value) => onJoinSerializedInput?.(value)}
          onReadClipboard={() => void onReadClipboard?.()}
          onOpenLink={() => void onOpenLink?.()}
        />

        <section class="mount-dialog-section">
          <div class="mount-dialog-actions">
            <button type="button" class="workspace-toggle" onclick={() => onSetMode?.('secret')}>
              <span>Use secret instead</span>
            </button>
            <button type="button" class="workspace-toggle" onclick={() => onClose?.()}>
              <span>Cancel</span>
            </button>
          </div>
        </section>
      {:else}
        <section class="mount-dialog-section">
          <div class="secret-input-wrapper mount-dialog-inputs">
            <SharedSecretEditor
              dense={true}
              value={mount.address}
              password={mount.password}
              valueLabel="Hub secret"
              valueAriaLabel="Hub address"
              valuePlaceholder="address or secret seed"
              passwordLabel="Password (optional)"
              passwordAriaLabel="Optional hub password"
              passwordPlaceholder="optional"
              hint="Drop an image/file here, or press Cmd/Ctrl + V."
              showPasteButton={clipboardImageAvailable || clipboardImageLoading}
              pasteButtonLabel="Paste image"
              pasteButtonBusy={clipboardImageLoading}
              fileName={mount.secretFileName}
              fileMimeType={mount.secretFileMimeType}
              {filePreviewUrl}
              {fileIsImage}
              {fileInfo}
              {fileHashLabel}
              {fileHashValue}
              {fileHashPending}
              showDownloadButton={fileHashLabel !== ''}
              onValueInput={onSecretValueInput}
              onPasswordInput={onSecretPasswordInput}
              onFileSelected={onSecretFileSelected}
              onPasteButton={() => void onPasteButton?.()}
              onDownloadFile={() => void onDownloadFile?.()}
            />
            {#if loading}
              <span class="loading-spinner"></span>
            {/if}
          </div>
        </section>

        <div class="mount-dialog-footer">
          <ArmedActionButton
            class="panel-action-btn danger"
            text="Detach"
            icon={Trash2}
            armed={true}
            armDelayMs={0}
            autoDisarmMs={3000}
            resetKey={mount.id}
            onPress={() => onRemove?.()}
            title="Detach hub"
            ariaLabel="Detach hub"
          />
          <div class="mount-dialog-footer-actions">
            <button type="button" class="workspace-toggle" onclick={() => onClose?.()}>
              <span>Done</span>
            </button>
          </div>
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .panel-surface {
    animation: panel-fade-in 240ms ease;
  }

  @keyframes panel-fade-in {
    from {
      opacity: 0;
      transform: translateY(-6px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .mount-dialog-backdrop {
    position: fixed;
    inset: 0;
    z-index: 235;
    display: grid;
    place-items: center;
    padding: 1rem;
    background:
      radial-gradient(circle at top, color-mix(in srgb, var(--nb-accent, #d27a54) 12%, transparent), transparent 55%),
      rgba(19, 18, 18, 0.26);
    backdrop-filter: blur(8px);
  }

  .mount-dialog {
    width: min(780px, calc(100vw - 2rem));
    max-height: min(88vh, 900px);
    overflow: auto;
    display: grid;
    gap: 0.9rem;
    padding: 0.96rem;
    border-radius: 22px;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 84%, rgba(210, 122, 84, 0.1));
    background:
      linear-gradient(180deg, color-mix(in srgb, var(--nb-panel-bg, #ffffff) 98%, rgba(255, 248, 243, 0.94)), color-mix(in srgb, var(--nb-panel-bg, #ffffff) 95%, rgba(247, 239, 233, 0.92))),
      radial-gradient(circle at top right, color-mix(in srgb, var(--nb-accent, #d27a54) 10%, transparent), transparent 60%);
    box-shadow:
      0 30px 90px rgba(39, 24, 15, 0.22),
      0 10px 24px rgba(39, 24, 15, 0.12);
  }

  .mount-dialog-header {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 0.9rem;
    align-items: start;
  }

  .mount-dialog-head-meta {
    display: grid;
    gap: 0.35rem;
    min-width: 0;
  }

  .mount-dialog-eyebrow,
  .mount-dialog-title {
    margin: 0;
  }

  .mount-dialog-eyebrow {
    color: color-mix(in srgb, var(--nb-accent-strong, #b85f39) 72%, rgba(110, 110, 115, 0.82));
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.16em;
    text-transform: uppercase;
  }

  .mount-dialog-title {
    color: var(--nb-text-main, rgba(28, 28, 30, 0.96));
    font-size: 1.18rem;
    line-height: 1.2;
    font-weight: 700;
  }

  .dialog-close-btn {
    width: 34px;
    height: 34px;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 86%, rgba(210, 122, 84, 0.08));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 94%, rgba(252, 244, 238, 0.9));
    color: var(--nb-text-main, rgba(28, 28, 30, 0.94));
    border-radius: 999px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }

  .mount-dialog-info-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.45rem 0.82rem;
  }

  .mount-dialog-info-item {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    min-width: 0;
  }

  .mount-dialog-info-item-refresh {
    gap: 0.26rem;
    opacity: 0.82;
  }

  .mount-dialog-info-item-storage {
    gap: 0.38rem;
  }

  .mount-dialog-info-label {
    font-size: 0.67rem;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--nb-text-faint, rgba(110, 110, 115, 0.68));
  }

  .mount-dialog-info-value {
    font-size: 0.78rem;
    color: var(--nb-text-soft, rgba(70, 70, 73, 0.8));
  }

  .mount-dialog-info-value-storage {
    font-size: 0.74rem;
    font-weight: 600;
    text-transform: lowercase;
  }

  .mount-dialog-info-value-refresh {
    font-size: 0.6rem;
    line-height: 1.2;
    color: var(--nb-text-faint, rgba(110, 110, 115, 0.72));
  }

  .mount-dialog-inline-action,
  .volume-id-btn {
    appearance: none;
    font: inherit;
    cursor: pointer;
  }

  .mount-dialog-inline-action {
    border: 0;
    background: transparent;
    padding: 0;
    color: color-mix(in srgb, var(--nb-accent-strong, #5d524a) 68%, var(--nb-text-soft, rgba(70, 70, 73, 0.8)) 32%);
    font-size: 0.72rem;
    font-weight: 600;
    text-decoration: underline;
    text-decoration-thickness: 1px;
    text-underline-offset: 0.14em;
  }

  .volume-id-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.32rem;
    background: transparent;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 90%, rgba(0, 0, 0, 0.05));
    border-radius: 999px;
    padding: 0.22rem 0.62rem;
    font-family: var(--nb-font-mono);
    font-size: 0.75rem;
    color: var(--nb-text-soft, rgba(70, 70, 73, 0.8));
  }

  .mount-dialog-info-pill {
    display: inline-flex;
    align-items: center;
    min-height: 26px;
    padding: 0 0.62rem;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 90%, rgba(0, 0, 0, 0.03));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 97%, rgba(245, 243, 240, 0.88));
    color: var(--nb-text-soft, rgba(70, 70, 73, 0.78));
    font-size: 0.72rem;
    font-weight: 600;
  }

  .mount-dialog-mode-switch {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 0.45rem;
  }

  .mount-dialog-mode-btn,
  .workspace-toggle,
  :global(.panel-action-btn) {
    border: 1px solid var(--nb-btn-border, rgba(56, 189, 248, 0.24));
    background: var(--nb-btn-bg, rgba(12, 24, 43, 0.82));
    color: var(--nb-btn-color, rgba(226, 232, 240, 0.92));
    border-radius: 999px;
    padding: 0 0.72rem;
    min-height: 30px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.46rem;
    font: inherit;
    font-size: 0.74rem;
    font-weight: 600;
    cursor: pointer;
  }

  .mount-dialog-mode-btn.active {
    border-color: var(--nb-btn-active-border, rgba(34, 211, 238, 0.48));
    background: var(--nb-btn-active-bg, linear-gradient(180deg, rgba(16, 66, 91, 0.96), rgba(10, 44, 66, 0.96)));
    color: var(--nb-btn-active-color, #ecfeff);
  }

  .mount-dialog-body {
    display: grid;
    gap: 1rem;
  }

  .mount-dialog-section {
    display: grid;
    gap: 0.8rem;
  }

  .secret-input-wrapper {
    display: grid;
    gap: 0.5rem;
    align-items: center;
  }

  .loading-spinner {
    justify-self: center;
    width: 16px;
    height: 16px;
    border: 2px solid color-mix(in srgb, var(--nb-accent, rgba(102, 126, 234, 0.3)) 36%, transparent);
    border-top-color: var(--nb-accent, #667eea);
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .mount-dialog-actions,
  .mount-dialog-footer,
  .mount-dialog-footer-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    align-items: center;
  }

  .mount-dialog-footer {
    justify-content: space-between;
  }

  .mount-dialog-footer-actions {
    justify-content: flex-end;
  }

  @media (max-width: 720px) {
    .mount-dialog-footer {
      justify-content: stretch;
    }

    .mount-dialog-footer-actions,
    .mount-dialog-actions {
      width: 100%;
    }

    .mount-dialog-footer-actions > .workspace-toggle,
    .mount-dialog-actions > .workspace-toggle,
    :global(.panel-action-btn) {
      width: 100%;
    }
  }
</style>