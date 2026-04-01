<script module lang="ts">
  let dialogStackSeed = 0;

  function nextDialogStackLevel(): number {
    dialogStackSeed += 1;
    return dialogStackSeed;
  }
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import type { Snippet } from 'svelte';
  import { X } from 'lucide-svelte';

  type DialogWidth = 'narrow' | 'medium' | 'wide' | 'xwide' | 'full';

  let {
    ariaLabel,
    eyebrow = '',
    title = '',
    subtitle = '',
    width = 'medium',
    baseZIndex = 220,
    closeLabel = 'Close dialog',
    closeDisabled = false,
    dismissOnBackdrop = true,
    dismissOnEscape = true,
    surfaceClass = '',
    bodyClass = '',
    headerActions,
    body,
    footer,
    onClose,
  } = $props<{
    ariaLabel: string;
    eyebrow?: string;
    title?: string;
    subtitle?: string;
    width?: DialogWidth;
    baseZIndex?: number;
    closeLabel?: string;
    closeDisabled?: boolean;
    dismissOnBackdrop?: boolean;
    dismissOnEscape?: boolean;
    surfaceClass?: string;
    bodyClass?: string;
    headerActions?: Snippet;
    body?: Snippet;
    footer?: Snippet;
    onClose?: (() => void) | undefined;
  }>();

  let stackLevel = $state(0);

  const backdropZIndex = $derived(baseZIndex + stackLevel * 2);
  const surfaceZIndex = $derived(backdropZIndex + 1);
  const widthClass = $derived(`width-${width}`);

  onMount(() => {
    stackLevel = nextDialogStackLevel();
  });

  function requestClose(): void {
    if (closeDisabled) {
      return;
    }
    onClose?.();
  }

  function handleBackdropClick(event: MouseEvent): void {
    if (!dismissOnBackdrop || event.target !== event.currentTarget) {
      return;
    }
    requestClose();
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (!dismissOnEscape || event.key !== 'Escape') {
      return;
    }
    event.preventDefault();
    requestClose();
  }
</script>

<div
  class="app-dialog-backdrop"
  role="dialog"
  aria-modal="true"
  aria-label={ariaLabel}
  tabindex="-1"
  style={`--app-dialog-backdrop-z:${backdropZIndex}; --app-dialog-surface-z:${surfaceZIndex};`}
  onclick={handleBackdropClick}
  onkeydown={handleKeydown}
>
  <div class={`app-dialog-surface ${widthClass} ${surfaceClass}`.trim()} role="document" tabindex="-1">
    <div class="app-dialog-header">
      <div class="app-dialog-head-meta">
        {#if eyebrow}
          <p class="app-dialog-eyebrow">{eyebrow}</p>
        {/if}
        {#if title}
          <p class="app-dialog-title">{title}</p>
        {/if}
        {#if subtitle}
          <p class="app-dialog-subtitle">{subtitle}</p>
        {/if}
      </div>

      <div class="app-dialog-head-actions">
        {#if headerActions}
          {@render headerActions()}
        {/if}
        <button
          type="button"
          class="app-dialog-close"
          aria-label={closeLabel}
          onclick={requestClose}
          disabled={closeDisabled}
        >
          <X size={18} strokeWidth={2} />
        </button>
      </div>
    </div>

    {#if body}
      <div class={`app-dialog-body ${bodyClass}`.trim()}>
        {@render body()}
      </div>
    {/if}

    {#if footer}
      <div class="app-dialog-footer">
        {@render footer()}
      </div>
    {/if}
  </div>
</div>

<style>
  .app-dialog-backdrop {
    --dialog-border: color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 84%, rgba(210, 122, 84, 0.1));
    --dialog-bg-top: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 98%, rgba(255, 248, 243, 0.94));
    --dialog-bg-bottom: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 95%, rgba(247, 239, 233, 0.92));
    position: fixed;
    inset: 0;
    z-index: var(--app-dialog-backdrop-z);
    display: grid;
    place-items: center;
    padding: 1rem;
    background:
      radial-gradient(circle at top, color-mix(in srgb, var(--nb-accent, #d27a54) 12%, transparent), transparent 55%),
      rgba(19, 18, 18, 0.26);
    backdrop-filter: blur(8px);
  }

  .app-dialog-surface {
    position: relative;
    z-index: var(--app-dialog-surface-z);
    width: min(680px, calc(100vw - 2rem));
    max-height: min(88vh, 900px);
    overflow: auto;
    display: grid;
    gap: 0.9rem;
    padding: 0.96rem;
    border-radius: 22px;
    border: 1px solid var(--dialog-border);
    background:
      linear-gradient(180deg, var(--dialog-bg-top), var(--dialog-bg-bottom)),
      radial-gradient(circle at top right, color-mix(in srgb, var(--nb-accent, #d27a54) 10%, transparent), transparent 60%);
    box-shadow:
      0 30px 90px rgba(39, 24, 15, 0.22),
      0 10px 24px rgba(39, 24, 15, 0.12);
  }

  .app-dialog-surface.width-narrow {
    width: min(520px, calc(100vw - 2rem));
  }

  .app-dialog-surface.width-medium {
    width: min(680px, calc(100vw - 2rem));
  }

  .app-dialog-surface.width-wide {
    width: min(820px, calc(100vw - 2rem));
  }

  .app-dialog-surface.width-xwide {
    width: min(980px, calc(100vw - 2rem));
  }

  .app-dialog-surface.width-full {
    width: min(1180px, calc(100vw - 2rem));
  }

  .app-dialog-header {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 0.9rem;
    align-items: start;
  }

  .app-dialog-head-meta {
    display: grid;
    gap: 0.18rem;
    min-width: 0;
  }

  .app-dialog-eyebrow,
  .app-dialog-title,
  .app-dialog-subtitle {
    margin: 0;
  }

  .app-dialog-eyebrow {
    color: color-mix(in srgb, var(--nb-accent-strong, #b85f39) 72%, rgba(110, 110, 115, 0.82));
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.16em;
    text-transform: uppercase;
  }

  .app-dialog-title {
    color: var(--nb-text-main, rgba(28, 28, 30, 0.96));
    font-size: 1.18rem;
    line-height: 1.2;
    font-weight: 700;
    overflow-wrap: anywhere;
  }

  .app-dialog-subtitle {
    color: var(--nb-text-soft, rgba(70, 70, 73, 0.8));
    font-size: 0.82rem;
    line-height: 1.45;
    overflow-wrap: anywhere;
  }

  .app-dialog-head-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
    justify-content: flex-end;
  }

  .app-dialog-close {
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
    transition: transform 120ms ease, background 120ms ease, border-color 120ms ease;
  }

  .app-dialog-close:hover:not(:disabled) {
    transform: translateY(-1px);
    border-color: color-mix(in srgb, var(--nb-accent, #d27a54) 16%, rgba(60, 60, 67, 0.14));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 92%, rgba(255, 255, 255, 0.98));
  }

  .app-dialog-close:disabled {
    opacity: 0.54;
    cursor: default;
  }

  .app-dialog-body,
  .app-dialog-footer {
    min-width: 0;
  }

  .app-dialog-body {
    display: grid;
    gap: 0.9rem;
  }

  .app-dialog-footer {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0.6rem;
  }

  @media (max-width: 720px) {
    .app-dialog-backdrop {
      padding: 0.5rem;
    }

    .app-dialog-surface {
      width: calc(100vw - 1rem);
      max-height: calc(100vh - 1rem);
      padding: 0.84rem;
      border-radius: 18px;
    }

    .app-dialog-header {
      grid-template-columns: 1fr;
    }

    .app-dialog-head-actions {
      justify-content: space-between;
    }
  }
</style>