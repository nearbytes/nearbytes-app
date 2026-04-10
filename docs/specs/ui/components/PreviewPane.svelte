<script lang="ts">
  import ArmedActionButton from './ArmedActionButton.svelte';
  import AudioPreview from './AudioPreview.svelte';
  import StatusNotice from './StatusNotice.svelte';

  type PreviewFile = {
    filename: string;
    blobHash: string;
    contentType?: 'b' | 'm';
    size: number;
    createdAt: number;
    mimeType?: string;
  };

  type PreviewKind = 'none' | 'image' | 'text' | 'pdf' | 'video' | 'audio' | 'unsupported';

  let {
    currentFile = null,
    selectedFile = null,
    previewFileOverride = null,
    previewKind = 'none',
    previewUrl = '',
    previewText = '',
    previewLoading = false,
    previewError = '',
    isHistoryMode = false,
    formatSize,
    formatDate,
    displayFileName,
    onDelete = undefined,
    onDownload = undefined,
    onClose = undefined,
  } = $props<{
    currentFile?: PreviewFile | null;
    selectedFile?: PreviewFile | null;
    previewFileOverride?: PreviewFile | null;
    previewKind?: PreviewKind;
    previewUrl?: string;
    previewText?: string;
    previewLoading?: boolean;
    previewError?: string;
    isHistoryMode?: boolean;
    formatSize: (value: number) => string;
    formatDate: (value: number) => string;
    displayFileName: (file: PreviewFile) => string;
    onDelete?: (() => void) | undefined;
    onDownload?: (() => void) | undefined;
    onClose?: (() => void) | undefined;
  }>();
</script>

<section class="preview-pane">
  {#if currentFile}
    <div class="preview-header">
      <div>
        <h3 class="preview-title" title={currentFile.filename}>{currentFile.filename}</h3>
        <p class="preview-meta">
          {currentFile.mimeType || 'Unknown type'} • {formatSize(currentFile.size)} • {formatDate(currentFile.createdAt)}
        </p>
      </div>
      <div class="preview-actions">
        {#if !previewFileOverride && selectedFile && onDelete}
          <ArmedActionButton
            class="manager-btn danger"
            text="Delete"
            armed={true}
            armDelayMs={0}
            autoDisarmMs={3000}
            disabled={isHistoryMode}
            resetKey={`${selectedFile.blobHash ?? selectedFile.filename}:${isHistoryMode}`}
            title={isHistoryMode ? 'Jump to Latest before deleting' : ''}
            onPress={onDelete}
          />
        {/if}
        {#if onDownload}
          <button type="button" class="manager-btn" onclick={onDownload}>
            Download
          </button>
        {/if}
        {#if onClose}
          <button type="button" class="manager-btn preview-close-btn" onclick={onClose}>
            Close
          </button>
        {/if}
      </div>
    </div>
    <div class="preview-body">
      {#if previewLoading}
        <p class="preview-message">Loading preview…</p>
      {:else if previewError}
        <StatusNotice tone="error" role="alert" compact={true} message={previewError} />
      {:else if previewKind === 'image' && previewUrl}
        <img class="preview-image" src={previewUrl} alt={'Preview of ' + currentFile.filename} />
      {:else if previewKind === 'video' && previewUrl}
        <!-- svelte-ignore a11y_media_has_caption -->
        <video class="preview-media" autoplay muted loop playsinline src={previewUrl}></video>
      {:else if previewKind === 'audio' && previewUrl}
        <AudioPreview
          src={previewUrl}
          title={displayFileName(currentFile)}
          mimeType={currentFile.mimeType}
        />
      {:else if previewKind === 'pdf' && previewUrl}
        <iframe class="preview-pdf" src={previewUrl} title={'PDF preview: ' + currentFile.filename}></iframe>
      {:else if previewKind === 'text'}
        <pre class="preview-text">{previewText}</pre>
      {:else}
        <p class="preview-message">Preview unavailable. Double-click the file to open it.</p>
      {/if}
    </div>
  {:else}
    <div class="preview-empty">
      <p>Select a file to preview.</p>
    </div>
  {/if}
</section>

<style>
  .preview-pane {
    min-width: 0;
    min-height: 0;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    gap: 0.75rem;
    padding: 0.85rem;
    border-left: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 86%, transparent);
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 94%, transparent);
  }

  .preview-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 0.9rem;
  }

  .preview-title,
  .preview-meta,
  .preview-message,
  .preview-empty p,
  .preview-text {
    margin: 0;
  }

  .preview-title {
    font-size: 1rem;
    line-height: 1.2;
    color: var(--nb-text-main, rgba(28, 28, 30, 0.96));
  }

  .preview-meta {
    margin-top: 0.28rem;
    color: var(--nb-text-soft, rgba(70, 70, 73, 0.78));
    font-size: 0.78rem;
  }

  .preview-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0.5rem;
  }

  .manager-btn {
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 86%, rgba(210, 122, 84, 0.08));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 94%, rgba(255, 248, 243, 0.9));
    color: var(--nb-text-main, rgba(28, 28, 30, 0.94));
    border-radius: 999px;
    padding: 0.54rem 0.82rem;
    font: inherit;
    cursor: pointer;
  }

  .preview-close-btn {
    font-weight: 600;
  }

  .preview-body {
    min-height: 0;
    overflow: auto;
    display: grid;
    align-items: start;
  }

  .preview-image,
  .preview-media,
  .preview-pdf {
    width: 100%;
    max-width: 100%;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 86%, transparent);
    border-radius: 16px;
    background: color-mix(in srgb, var(--nb-app-bg, #f5f4f2) 90%, black 2%);
  }

  .preview-media,
  .preview-pdf {
    min-height: 320px;
  }

  .preview-text {
    padding: 0.9rem;
    border-radius: 16px;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 86%, transparent);
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 96%, rgba(247, 240, 234, 0.72));
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    color: var(--nb-text-main, rgba(28, 28, 30, 0.94));
  }

  .preview-message,
  .preview-empty {
    color: var(--nb-text-soft, rgba(70, 70, 73, 0.78));
  }

  .preview-empty {
    min-height: 100%;
    display: grid;
    place-items: center;
    text-align: center;
  }
</style>