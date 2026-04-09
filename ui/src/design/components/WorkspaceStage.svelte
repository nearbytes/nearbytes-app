<script lang="ts">
  import type { Snippet } from 'svelte';
  import { X } from 'lucide-svelte';

  let {
    mode = 'workspace',
    isDragging = false,
    isVolumeWorkspaceActive = false,
    onDragOver,
    onDragLeave,
    onDrop,
    showEventFlowPanel = false,
    onCloseFlow,
    globalPanel,
    volumePanel,
    emptyState,
    workspaceContent,
    flowPanel,
  }: {
    mode?: 'global-panel' | 'volume-panel' | 'empty' | 'workspace';
    isDragging?: boolean;
    isVolumeWorkspaceActive?: boolean;
    onDragOver?: (event: DragEvent) => void;
    onDragLeave?: (event: DragEvent) => void;
    onDrop?: (event: DragEvent) => void;
    showEventFlowPanel?: boolean;
    onCloseFlow?: () => void;
    globalPanel?: Snippet;
    volumePanel?: Snippet;
    emptyState?: Snippet;
    workspaceContent?: Snippet;
    flowPanel?: Snippet;
  } = $props();
</script>

<main
  class="file-area"
  class:volume-workspace-active={isVolumeWorkspaceActive}
  class:dragging={isDragging}
  ondragover={onDragOver}
  ondragleave={onDragLeave}
  ondrop={onDrop}
>
  {#if mode === 'global-panel'}
    <div class="workspace-panel-view">{@render globalPanel?.()}</div>
  {:else if mode === 'volume-panel'}
    <div class="workspace-panel-view">{@render volumePanel?.()}</div>
  {:else if mode === 'empty'}
    {@render emptyState?.()}
  {:else}
    <div class="volume-workspace">{@render workspaceContent?.()}</div>
  {/if}

  {#if showEventFlowPanel}
    <div
      class="flow-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Event flow"
      tabindex="-1"
      onclick={(event) => {
        if (event.target === event.currentTarget) {
          onCloseFlow?.();
        }
      }}
      onkeydown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onCloseFlow?.();
        }
      }}
    >
      <div class="flow-overlay-panel panel-surface">
        <button type="button" class="flow-overlay-close" onclick={() => onCloseFlow?.()} aria-label="Close event flow">
          <X size={18} strokeWidth={2} />
        </button>
        {@render flowPanel?.()}
      </div>
    </div>
  {/if}
</main>

<style>
  .file-area {
    flex: 1 1 auto;
    min-height: 0;
    height: 100%;
    padding: 1rem;
    overflow-x: hidden;
    overflow-y: auto;
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .file-area.volume-workspace-active {
    padding: 0;
  }

  .workspace-panel-view {
    flex: 1 1 auto;
    min-height: 0;
    width: 100%;
    overflow: auto;
    scrollbar-width: thin;
  }

  .volume-workspace {
    position: relative;
    max-width: none;
    margin: 0;
    width: 100%;
    padding: 0.5rem 0.65rem 0.65rem;
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    min-height: 0;
    flex: 1 1 auto;
    overflow-x: hidden;
    overflow-y: auto;
  }

  .flow-overlay {
    position: absolute;
    inset: 0;
    z-index: 200;
    display: flex;
    align-items: stretch;
    justify-content: stretch;
    background: rgba(0, 0, 0, 0.38);
    backdrop-filter: blur(var(--nb-overlay-blur, 4px));
    animation: panel-fade-in 200ms ease;
  }

  .flow-overlay-panel {
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
    border-radius: var(--nb-radius-lg, 18px);
    overflow: hidden;
    margin: 0.75rem;
  }

  .flow-overlay-close {
    position: absolute;
    top: 0.75rem;
    right: 0.75rem;
    z-index: 10;
    appearance: none;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(56, 189, 248, 0.22)) 88%, transparent);
    background: color-mix(in srgb, var(--nb-panel-bg, rgba(12, 24, 48, 0.95)) 90%, transparent);
    color: var(--nb-text-soft, rgba(191, 219, 254, 0.82));
    width: 32px;
    height: 32px;
    border-radius: var(--nb-radius-pill, 999px);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }

  .flow-overlay-close:hover {
    background: color-mix(in srgb, var(--nb-panel-bg, rgba(12, 24, 48, 0.98)) 95%, transparent);
    color: var(--nb-text-main, rgba(226, 232, 240, 0.96));
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

  @media (max-width: 900px) {
    .file-area.volume-workspace-active {
      padding: 0.35rem;
    }

    .volume-workspace,
    .workspace-panel-view {
      border-radius: var(--nb-radius-lg, 18px);
    }
  }

  @media (min-width: 901px) {
    .file-area {
      padding: 2rem;
    }

    .volume-workspace {
      padding: 0.75rem 1rem 1rem;
      gap: 0.75rem;
    }
  }
</style>