<script lang="ts">
  import type { Snippet } from 'svelte';
  import { X } from 'lucide-svelte';

  let {
    title,
    eyebrow = '',
    detail = '',
    body,
    onClose,
  } = $props<{
    title: string;
    eyebrow?: string;
    detail?: string;
    body?: Snippet;
    onClose?: (() => void) | undefined;
  }>();

  function handleBackdropKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose?.();
    }
  }
</script>

<div
  class="ui-dialog-backdrop"
  role="dialog"
  aria-modal="true"
  tabindex="-1"
  onclick={(event) => event.target === event.currentTarget && onClose?.()}
  onkeydown={handleBackdropKeydown}
>
  <div class="ui-dialog nb-panel-surface">
    <header class="ui-dialog-header">
      <div>
        {#if eyebrow}
          <p class="ui-dialog-eyebrow">{eyebrow}</p>
        {/if}
        <h3 class="ui-dialog-title nb-type-heading">{title}</h3>
        {#if detail}
          <p class="ui-dialog-detail">{detail}</p>
        {/if}
      </div>
      <button class="ui-dialog-close" type="button" aria-label="Close" onclick={onClose}>
        <X size={18} />
      </button>
    </header>
    {#if body}
      <div class="ui-dialog-body">
        {@render body()}
      </div>
    {/if}
  </div>
</div>

<style>
  .ui-dialog-backdrop {
    position: absolute;
    inset: 0;
    background: rgba(6, 10, 14, 0.28);
    backdrop-filter: blur(10px);
    display: grid;
    place-items: center;
    padding: 1rem;
    border-radius: inherit;
  }

  .ui-dialog {
    width: min(34rem, 100%);
    border-radius: 28px;
    padding: 1rem;
    display: grid;
    gap: 1rem;
  }

  .ui-dialog-header {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
  }

  .ui-dialog-eyebrow,
  .ui-dialog-title,
  .ui-dialog-detail {
    margin: 0;
  }

  .ui-dialog-eyebrow {
    text-transform: uppercase;
    letter-spacing: 0.16em;
    font-size: 0.68rem;
    color: var(--nb-accent-strong);
  }

  .ui-dialog-title {
    font-size: 1.16rem;
  }

  .ui-dialog-detail {
    color: var(--nb-text-soft);
    font-size: 0.88rem;
    line-height: 1.45;
  }

  .ui-dialog-close {
    border: 0;
    background: transparent;
    color: var(--nb-text-soft);
    width: 2.25rem;
    height: 2.25rem;
    border-radius: 999px;
    cursor: pointer;
  }
</style>
