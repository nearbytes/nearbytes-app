<script lang="ts">
  import SecretSeedFields from './SecretSeedFields.svelte';
  import { ClipboardPaste, Download, FileText, Image as ImageIcon } from 'lucide-svelte';

  type ValueHandler = ((value: string) => void) | undefined;
  type FileHandler = ((file: globalThis.File) => void | Promise<void>) | undefined;
  type ActionHandler = (() => void | Promise<void>) | undefined;

  let fileInput: HTMLInputElement | null = null;

  let {
    dense = false,
    value = '',
    password = '',
    valueLabel = 'Secret',
    valueAriaLabel = 'Secret',
    valuePlaceholder = '',
    passwordLabel = 'Password (optional)',
    passwordAriaLabel = 'Optional password',
    passwordPlaceholder = 'optional',
    hint = '',
    chooseFileLabel = 'Choose file',
    clearFileLabel = 'Use text instead',
    fileName = '',
    fileMimeType = '',
    filePreviewUrl = null,
    fileIsImage = false,
    fileInfo = '',
    fileHashLabel = '',
    fileHashValue = '',
    fileHashPending = false,
    showPasteButton = false,
    pasteButtonLabel = 'Paste image',
    pasteButtonBusy = false,
    showDownloadButton = false,
    downloadButtonLabel = 'Download',
    onValueInput = undefined,
    onPasswordInput = undefined,
    onFileSelected = undefined,
    onClearFile = undefined,
    onPasteButton = undefined,
    onDownloadFile = undefined,
  } = $props<{
    dense?: boolean;
    value: string;
    password: string;
    valueLabel?: string;
    valueAriaLabel?: string;
    valuePlaceholder?: string;
    passwordLabel?: string;
    passwordAriaLabel?: string;
    passwordPlaceholder?: string;
    hint?: string;
    chooseFileLabel?: string;
    clearFileLabel?: string;
    fileName?: string;
    fileMimeType?: string;
    filePreviewUrl?: string | null;
    fileIsImage?: boolean;
    fileInfo?: string;
    fileHashLabel?: string;
    fileHashValue?: string;
    fileHashPending?: boolean;
    showPasteButton?: boolean;
    pasteButtonLabel?: string;
    pasteButtonBusy?: boolean;
    showDownloadButton?: boolean;
    downloadButtonLabel?: string;
    onValueInput?: ValueHandler;
    onPasswordInput?: ValueHandler;
    onFileSelected?: FileHandler;
    onClearFile?: ActionHandler;
    onPasteButton?: ActionHandler;
    onDownloadFile?: ActionHandler;
  }>();

  const hasAttachedFile = $derived(fileName.trim() !== '');
  const fileTypeLabel = $derived(fileMimeType.trim() || 'application/octet-stream');

  function triggerFilePicker(): void {
    fileInput?.click();
  }

  function handleFileInputChange(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) {
      return;
    }
    void onFileSelected?.(file);
  }

  function handleDrop(event: DragEvent): void {
    if (!onFileSelected) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const file = event.dataTransfer?.files?.[0];
    if (!file) {
      return;
    }
    void onFileSelected(file);
  }
</script>

<div
  class="shared-secret-editor"
  role="group"
  aria-label={valueLabel}
  ondragover={(event) => {
    if (!onFileSelected) {
      return;
    }
    event.preventDefault();
  }}
  ondrop={handleDrop}
>
  <div class="shared-secret-editor-fields">
    <SecretSeedFields
      {dense}
      {value}
      {password}
      {valueLabel}
      {valueAriaLabel}
      {valuePlaceholder}
      {passwordLabel}
      {passwordAriaLabel}
      {passwordPlaceholder}
      {onValueInput}
      {onPasswordInput}
    />
  </div>

  <div class="shared-secret-editor-hint-row">
    <p class="shared-secret-editor-hint">{hint}</p>
    <div class="shared-secret-editor-actions">
      <input
        bind:this={fileInput}
        hidden
        type="file"
        aria-label={`Choose ${valueLabel.toLowerCase()} file`}
        onchange={handleFileInputChange}
      />
      <button type="button" class="workspace-toggle" onclick={triggerFilePicker}>
        <ImageIcon class="button-icon" size={15} strokeWidth={2} />
        <span>{chooseFileLabel}</span>
      </button>
      {#if showPasteButton}
        <button type="button" class="workspace-toggle" onclick={() => void onPasteButton?.()} disabled={pasteButtonBusy}>
          <ClipboardPaste class="button-icon" size={15} strokeWidth={2} />
          <span>{pasteButtonBusy ? 'Reading…' : pasteButtonLabel}</span>
        </button>
      {/if}
      {#if hasAttachedFile && onClearFile}
        <button type="button" class="workspace-toggle" onclick={() => void onClearFile()}>
          <span>{clearFileLabel}</span>
        </button>
      {/if}
    </div>
  </div>

  {#if hasAttachedFile}
    <div class="shared-secret-editor-file-card" role="group" aria-label={`Attached ${valueLabel.toLowerCase()} file`}>
      <div class="shared-secret-editor-file-preview" class:image={fileIsImage}>
        {#if fileIsImage && filePreviewUrl}
          <img class="shared-secret-editor-file-image" src={filePreviewUrl} alt={fileName || 'secret file'} />
        {:else}
          <span class="shared-secret-editor-file-icon" aria-hidden="true">
            {#if fileTypeLabel.startsWith('image/')}
              <ImageIcon size={18} strokeWidth={2} />
            {:else}
              <FileText size={18} strokeWidth={2} />
            {/if}
          </span>
        {/if}
      </div>
      <div class="shared-secret-editor-file-meta">
        <p class="shared-secret-editor-file-name" title={fileName || 'secret-file'}>{fileName || 'secret-file'}</p>
        <p class="shared-secret-editor-file-info">
          {fileTypeLabel}
          {#if fileInfo}
            {' • '}{fileInfo}
          {/if}
        </p>
        {#if fileHashLabel}
          <p class="shared-secret-editor-file-hash-label">{fileHashLabel}</p>
          <p class="shared-secret-editor-file-hash" title={fileHashPending ? 'Computing…' : fileHashValue || 'Unavailable'}>
            {#if fileHashPending}
              Computing…
            {:else if fileHashValue}
              {fileHashValue}
            {:else}
              Unavailable
            {/if}
          </p>
        {/if}
      </div>
      {#if showDownloadButton}
        <button type="button" class="workspace-toggle shared-secret-editor-download" onclick={() => void onDownloadFile?.()}>
          <Download class="button-icon" size={15} strokeWidth={2} />
          <span>{downloadButtonLabel}</span>
        </button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .shared-secret-editor {
    display: grid;
    gap: 0.72rem;
  }

  .shared-secret-editor-fields {
    min-width: 0;
  }

  .shared-secret-editor-hint-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.7rem;
  }

  .shared-secret-editor-hint {
    margin: 0;
    font-size: 0.78rem;
    color: var(--nb-text-soft, rgba(70, 70, 73, 0.76));
  }

  .shared-secret-editor-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.55rem;
  }

  .shared-secret-editor-file-card {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 0.8rem;
    align-items: center;
    padding: 0.78rem 0.82rem;
    border-radius: 14px;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(56, 189, 248, 0.16)) 88%, transparent);
    background: var(--nb-identity-surface-bg, linear-gradient(180deg, rgba(8, 17, 31, 0.88), rgba(7, 14, 27, 0.82)));
  }

  .shared-secret-editor-file-preview {
    width: 56px;
    height: 56px;
    border-radius: 14px;
    overflow: hidden;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: var(--nb-btn-bg, rgba(10, 19, 35, 0.92));
    border: 1px solid var(--nb-border, rgba(96, 165, 250, 0.18));
    color: var(--nb-text-soft, rgba(191, 219, 254, 0.86));
    flex: 0 0 auto;
  }

  .shared-secret-editor-file-preview.image {
    background: color-mix(in srgb, var(--nb-shell-bottom, rgba(7, 14, 28, 0.98)) 96%, transparent);
  }

  .shared-secret-editor-file-image {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .shared-secret-editor-file-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .shared-secret-editor-file-meta {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.14rem;
  }

  .shared-secret-editor-file-name,
  .shared-secret-editor-file-info,
  .shared-secret-editor-file-hash-label,
  .shared-secret-editor-file-hash {
    margin: 0;
  }

  .shared-secret-editor-file-name {
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--nb-text-main, rgba(240, 249, 255, 0.97));
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .shared-secret-editor-file-info {
    font-size: 0.74rem;
    color: var(--nb-text-soft, rgba(191, 219, 254, 0.74));
  }

  .shared-secret-editor-file-hash-label {
    margin-top: 0.18rem;
    font-size: 0.68rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--nb-accent, rgba(94, 234, 212, 0.7));
  }

  .shared-secret-editor-file-hash {
    font-family: 'Monaco', 'Menlo', monospace;
    font-size: 0.72rem;
    line-height: 1.35;
    color: var(--nb-text-main, rgba(226, 232, 240, 0.9));
    word-break: break-all;
  }

  .shared-secret-editor-download {
    min-width: 108px;
  }

  @media (max-width: 760px) {
    .shared-secret-editor-hint-row,
    .shared-secret-editor-actions {
      align-items: stretch;
    }

    .shared-secret-editor-file-card {
      grid-template-columns: 1fr;
    }

    .shared-secret-editor-download {
      width: 100%;
    }
  }
</style>