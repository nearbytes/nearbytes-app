<script lang="ts">
  import type { Snippet } from 'svelte';
  import { GripVertical } from 'lucide-svelte';
  import { devSurface, getDevContext } from '../dev.js';
  import PreviewPane from './PreviewPane.svelte';

  type FileMetadata = {
    filename: string;
    blobHash: string;
    size: number;
    createdAt: number;
    mimeType?: string;
  };

  let {
    viewFiles,
    visibleFiles,
    isLoading = false,
    fileManagerViewMode = 'icons',
    showPreviewPane = false,
    fileManagerTemplate = '1fr',
    thumbnailUrls,
    currentPreviewFile = null,
    selectedFile = null,
    previewFileOverride = null,
    previewKind = 'none',
    previewUrl = '',
    previewText = '',
    previewLoading = false,
    previewError = '',
    renamingFileName = null,
    renameDraft = '',
    isHistoryMode = false,
    fileAccentTone,
    fileIconComponent,
    isFileSelected,
    columnSortState,
    formatSize,
    formatDate,
    formatRelativeDay,
    displayFileName,
    empty,
    onElementChange = undefined,
    onActivate = undefined,
    onToggleColumnSort = undefined,
    onFilePointerSelect = undefined,
    onOpenPreview = undefined,
    onDragStart = undefined,
    onFileRowKeydown = undefined,
    onStartRenaming = undefined,
    onRenameDraftChange = undefined,
    onCommitRename = undefined,
    onCancelRenaming = undefined,
    onClearSelection = undefined,
    onStartResize = undefined,
    onDelete = undefined,
    onDownload = undefined,
    onClosePreview = undefined,
  } = $props<{
    viewFiles: FileMetadata[];
    visibleFiles: FileMetadata[];
    isLoading?: boolean;
    fileManagerViewMode?: 'icons' | 'details';
    showPreviewPane?: boolean;
    fileManagerTemplate?: string;
    thumbnailUrls: Map<string, string>;
    currentPreviewFile?: FileMetadata | null;
    selectedFile?: FileMetadata | null;
    previewFileOverride?: FileMetadata | null;
    previewKind?: string;
    previewUrl?: string;
    previewText?: string;
    previewLoading?: boolean;
    previewError?: string;
    renamingFileName?: string | null;
    renameDraft?: string;
    isHistoryMode?: boolean;
    fileAccentTone: (file: FileMetadata) => string;
    fileIconComponent: (file: FileMetadata) => any;
    isFileSelected: (filename: string) => boolean;
    columnSortState: (column: 'name' | 'size' | 'date') => string;
    formatSize: (value: number) => string;
    formatDate: (value: number) => string;
    formatRelativeDay: (value: number) => string;
    displayFileName: (file: FileMetadata) => string;
    empty?: Snippet;
    onElementChange?: ((element: HTMLDivElement | null) => void) | undefined;
    onActivate?: (() => void) | undefined;
    onToggleColumnSort?: ((column: 'name' | 'size' | 'date') => void) | undefined;
    onFilePointerSelect?: ((event: MouseEvent, file: FileMetadata) => void) | undefined;
    onOpenPreview?: ((file: FileMetadata) => void) | undefined;
    onDragStart?: ((event: DragEvent, file: FileMetadata) => void) | undefined;
    onFileRowKeydown?: ((event: KeyboardEvent, file: FileMetadata) => void) | undefined;
    onStartRenaming?: ((file: FileMetadata) => void) | undefined;
    onRenameDraftChange?: ((value: string) => void) | undefined;
    onCommitRename?: ((file: FileMetadata) => void | Promise<void>) | undefined;
    onCancelRenaming?: (() => void) | undefined;
    onClearSelection?: (() => void) | undefined;
    onStartResize?: ((event: PointerEvent) => void) | undefined;
    onDelete?: (() => void) | undefined;
    onDownload?: (() => void) | undefined;
    onClosePreview?: (() => void) | undefined;
  }>();
  const dev = getDevContext();

  let fileManagerElement = $state<HTMLDivElement | null>(null);

  $effect(() => {
    onElementChange?.(fileManagerElement);
  });
</script>

{#if viewFiles.length === 0 && !isLoading}
  {@render empty?.()}
{:else}
  <div
    class="file-manager"
    role="presentation"
    bind:this={fileManagerElement}
    use:devSurface={{ enabled: $dev, name: 'FileManagerWorkspace' }}
    style:grid-template-columns={fileManagerTemplate}
    onpointerdown={() => onActivate?.()}
    onfocusin={() => onActivate?.()}
  >
    <section class="file-list-pane" class:with-preview={showPreviewPane}>
      {#if visibleFiles.length === 0}
        <div class="list-empty">No files match your search.</div>
      {:else}
        <div class="file-list-scroll" class:icons={fileManagerViewMode === 'icons'}>
          {#if fileManagerViewMode === 'details'}
            <div class="file-list-head">
              <span class="file-list-sort-wrap" data-sort={columnSortState('name')}>
                <button type="button" class="file-list-sort" onclick={() => onToggleColumnSort?.('name')}>Name</button>
              </span>
              <span class="file-list-sort-wrap" data-sort={columnSortState('size')}>
                <button type="button" class="file-list-sort" onclick={() => onToggleColumnSort?.('size')}>Size</button>
              </span>
              <span class="file-list-sort-wrap" data-sort={columnSortState('date')}>
                <button type="button" class="file-list-sort" onclick={() => onToggleColumnSort?.('date')}>Updated</button>
              </span>
            </div>
          {/if}

          {#each visibleFiles as file (file.filename)}
            {@const FileIcon = fileIconComponent(file)}
            <div
              class:file-card={fileManagerViewMode === 'icons'}
              class:file-row={fileManagerViewMode === 'details'}
              class:selected={isFileSelected(file.filename)}
              data-filename={file.filename}
              draggable="true"
              tabindex="0"
              role="button"
              onclick={(event) => onFilePointerSelect?.(event, file)}
              ondblclick={() => onOpenPreview?.(file)}
              ondragstart={(event) => onDragStart?.(event, file)}
              onkeydown={(event) => onFileRowKeydown?.(event, file)}
            >
              {#if fileManagerViewMode === 'icons'}
                {@const thumbUrl = thumbnailUrls.get(file.blobHash)}
                <div class={`file-card-art ${fileAccentTone(file)}`}>
                  {#if thumbUrl}
                    <img class="file-card-thumb" src={thumbUrl} alt="" aria-hidden="true" />
                  {:else}
                    <FileIcon size={28} strokeWidth={1.8} />
                  {/if}
                </div>
                <div class="file-card-copy">
                  {#if renamingFileName === file.filename}
                    <input
                      type="text"
                      class="file-rename-input"
                      value={renameDraft}
                      onclick={(event) => event.stopPropagation()}
                      ondblclick={(event) => event.stopPropagation()}
                      oninput={(event) => onRenameDraftChange?.((event.currentTarget as HTMLInputElement).value)}
                      onblur={() => void onCommitRename?.(file)}
                      onkeydown={(event) => {
                        event.stopPropagation();
                        if (event.key === 'Enter') {
                          void onCommitRename?.(file);
                        } else if (event.key === 'Escape') {
                          onCancelRenaming?.();
                        }
                      }}
                    />
                  {:else}
                    <button
                      type="button"
                      class="file-name-trigger file-card-name"
                      title={file.filename}
                      ondblclick={(event) => {
                        event.stopPropagation();
                        onStartRenaming?.(file);
                      }}
                      onclick={(event) => onFilePointerSelect?.(event, file)}
                    >
                      {displayFileName(file)}
                    </button>
                  {/if}
                </div>
              {:else}
                <div class="file-row-main">
                  <span class={`file-row-icon ${fileAccentTone(file)}`}>
                    <FileIcon size={15} strokeWidth={2} />
                  </span>
                  <div class="file-row-copy">
                    {#if renamingFileName === file.filename}
                      <input
                        type="text"
                        class="file-rename-input"
                        value={renameDraft}
                        onclick={(event) => event.stopPropagation()}
                        ondblclick={(event) => event.stopPropagation()}
                        oninput={(event) => onRenameDraftChange?.((event.currentTarget as HTMLInputElement).value)}
                        onblur={() => void onCommitRename?.(file)}
                        onkeydown={(event) => {
                          event.stopPropagation();
                          if (event.key === 'Enter') {
                            void onCommitRename?.(file);
                          } else if (event.key === 'Escape') {
                            onCancelRenaming?.();
                          }
                        }}
                      />
                    {:else}
                      <button
                        type="button"
                        class="file-name-trigger file-row-name"
                        title={file.filename}
                        ondblclick={(event) => {
                          event.stopPropagation();
                          onStartRenaming?.(file);
                        }}
                        onclick={(event) => onFilePointerSelect?.(event, file)}
                      >
                        {displayFileName(file)}
                      </button>
                    {/if}
                    <span class="file-row-path" title={file.filename}>{file.filename}</span>
                  </div>
                </div>
                <span class="file-row-size">{formatSize(file.size)}</span>
                <span class="file-row-date">{formatRelativeDay(file.createdAt)}</span>
              {/if}
            </div>
          {/each}

          <button
            type="button"
            class="file-list-clear-hitbox"
            aria-label="Clear file selection"
            tabindex="-1"
            onclick={() => onClearSelection?.()}
          ></button>
        </div>
      {/if}
    </section>

    {#if showPreviewPane}
      <button
        type="button"
        class="file-manager-divider"
        aria-label="Resize file manager panes"
        onpointerdown={(event) => onStartResize?.(event)}
      >
        <span class="file-manager-divider-grip">
          <GripVertical size={16} strokeWidth={1.8} />
        </span>
      </button>
      <PreviewPane
        currentFile={currentPreviewFile}
        {selectedFile}
        {previewFileOverride}
        {previewKind}
        {previewUrl}
        {previewText}
        {previewLoading}
        previewError={previewError}
        {isHistoryMode}
        {formatSize}
        {formatDate}
        {displayFileName}
        onDelete={onDelete}
        onDownload={onDownload}
        onClose={onClosePreview}
      />
    {/if}
  </div>
{/if}

<style>
  .file-manager {
    flex: 1 1 auto;
    min-height: 0;
    width: 100%;
    display: grid;
    gap: 0;
    align-items: stretch;
    font-family: var(--nb-font-body);
  }

  .file-list-pane {
    min-height: 0;
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 97%, var(--nb-shell-bottom, #f4f4f7));
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(56, 189, 248, 0.16)) 88%, transparent);
    border-radius: 18px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    height: 100%;
  }

  .file-list-pane.with-preview {
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
  }

  .file-list-head {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    gap: 0.75rem;
    padding: 0 0.9rem 0.55rem;
    font-size: 0.75rem;
    font-weight: 520;
    letter-spacing: 0.02em;
    color: color-mix(in srgb, var(--nb-text-soft, rgba(224, 224, 224, 0.56)) 70%, transparent);
    border-bottom: 1px solid color-mix(in srgb, var(--nb-border, rgba(102, 126, 234, 0.12)) 68%, transparent);
    position: sticky;
    top: 0;
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 98%, var(--nb-shell-bottom, #f4f4f7));
    z-index: 1;
  }

  .file-list-sort {
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    letter-spacing: inherit;
    text-align: left;
    padding: 0;
    cursor: pointer;
  }

  .file-list-sort-wrap[data-sort='ascending'] .file-list-sort::after { content: ' ↑'; }
  .file-list-sort-wrap[data-sort='descending'] .file-list-sort::after { content: ' ↓'; }

  .file-list-scroll {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    scrollbar-width: thin;
    padding: 0.2rem;
  }

  .file-list-scroll.icons {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    align-content: start;
    gap: 0.6rem;
    padding: 0.8rem;
  }

  .file-list-clear-hitbox {
    appearance: none;
    border: 0;
    background: transparent;
    display: block;
    width: 100%;
    min-height: 3rem;
    padding: 0;
    margin: 0;
    cursor: default;
  }

  .file-list-scroll.icons .file-list-clear-hitbox {
    grid-column: 1 / -1;
  }

  .file-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    gap: 0.75rem;
    align-items: center;
    padding: 0.52rem 0.75rem;
    cursor: grab;
    border-bottom: 1px solid color-mix(in srgb, var(--nb-border, rgba(56, 189, 248, 0.12)) 50%, transparent);
  }

  .file-row:hover {
    background: color-mix(in srgb, var(--nb-accent, rgba(102, 126, 234, 0.08)) 14%, transparent);
  }

  .file-row.selected {
    background: color-mix(in srgb, var(--nb-accent, rgba(102, 126, 234, 0.16)) 22%, transparent);
  }

  .file-row-main {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.7rem;
  }

  .file-row-icon {
    flex: 0 0 auto;
    width: 28px;
    height: 28px;
    border-radius: 9px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid rgba(255, 255, 255, 0.07);
    background: rgba(10, 18, 33, 0.84);
  }

  .file-row-copy {
    min-width: 0;
    display: grid;
    gap: 0.08rem;
  }

  .file-row-name,
  .file-card-name {
    color: var(--nb-text-main, rgba(28, 28, 30, 0.98));
  }

  .file-row-path,
  .file-row-size,
  .file-row-date,
  .list-empty {
    color: var(--nb-text-soft, rgba(58, 58, 60, 0.65));
  }

  .file-rename-input {
    width: 100%;
    min-height: 32px;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(56, 189, 248, 0.26)) 92%, transparent);
    border-radius: 10px;
    background: color-mix(in srgb, var(--nb-shell-bottom, rgba(10, 18, 33, 0.9)) 94%, transparent);
    color: var(--nb-text-main, #f8fafc);
    padding: 0 0.68rem;
    font: inherit;
    outline: none;
  }

  .file-name-trigger {
    border: 0;
    background: transparent;
    padding: 0;
    text-align: left;
    font: inherit;
    cursor: text;
  }

  .file-card {
    border-radius: 12px;
    border: none;
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 99%, var(--nb-shell-bottom, #f4f4f7));
    padding: 0;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    cursor: grab;
    overflow: hidden;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.07), 0 1px 2px rgba(0, 0, 0, 0.04);
  }

  .file-card.selected {
    box-shadow: 0 0 0 2px var(--nb-accent, rgba(255, 59, 48, 0.85)), 0 4px 14px rgba(0, 0, 0, 0.11);
  }

  .file-card-art {
    width: 100%;
    aspect-ratio: 4 / 3;
    display: grid;
    place-items: center;
    position: relative;
    overflow: hidden;
    flex-shrink: 0;
  }

  .file-card-thumb {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .file-card-copy {
    padding: 0.48rem 0.58rem 0.52rem;
    display: flex;
    flex-direction: column;
    min-width: 0;
    width: 100%;
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 100%, transparent);
  }

  .file-manager-divider {
    position: relative;
    min-height: 0;
    cursor: col-resize;
    touch-action: none;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 0;
    background: transparent;
  }

  .file-manager-divider::before {
    content: '';
    width: 1px;
    height: 100%;
    background: color-mix(in srgb, var(--nb-border, rgba(56, 189, 248, 0.16)) 88%, transparent);
  }

  .file-manager-divider-grip {
    position: absolute;
    width: 6px;
    height: 52px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--nb-text-faint, rgba(186, 230, 253, 0.06)) 18%, transparent);
    color: transparent;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .file-manager-divider:hover::before {
    background: color-mix(in srgb, var(--nb-accent, rgba(255, 59, 48, 1)) 18%, white);
  }

  .file-manager-divider:hover .file-manager-divider-grip {
    background: color-mix(in srgb, var(--nb-text-soft, rgba(186, 230, 253, 0.14)) 28%, transparent);
  }

  @media (max-width: 900px) {
    .file-manager {
      grid-template-columns: 1fr !important;
      gap: 0.75rem;
    }

    .file-manager-divider {
      display: none;
    }

    .file-list-pane {
      border-radius: 18px;
      min-height: 280px;
    }
  }
</style>
