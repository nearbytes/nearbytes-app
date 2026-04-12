<script lang="ts">
  import AppDialog from './AppDialog.svelte';
  import type { ShareCardBadgeTone } from './ShareCard.svelte';

  const {
    label,
    description,
    title = label,
    tone = 'warn',
  } = $props<{
    label: string;
    description: string;
    title?: string;
    tone?: ShareCardBadgeTone;
  }>();

  let open = $state(false);

  function showDetail(event: MouseEvent | KeyboardEvent): void {
    event.stopPropagation();
    open = true;
  }

  function closeDetail(): void {
    open = false;
  }

  const contextLabel = $derived.by(() => {
    const normalizedTitle = title.trim();
    const normalizedLabel = label.trim();
    if (!normalizedTitle || normalizedTitle === normalizedLabel) {
      return '';
    }
    return normalizedTitle;
  });
</script>

<button
  type="button"
  class={`error-badge tone-${tone}`}
  title={`${label}. Click to view the full error.`}
  aria-haspopup="dialog"
  aria-expanded={open}
  onclick={showDetail}
  onkeydown={(event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      showDetail(event);
    }
  }}
>
  {label}
</button>

{#if open}
  <AppDialog
    ariaLabel={`${title} full error details`}
    eyebrow="Full error"
    title={contextLabel || 'Error details'}
    width="medium"
    bodyClass="error-badge-dialog-body"
    onClose={closeDetail}
  >
    {#snippet body()}
      <div class="error-badge-dialog-copy">
        <p class="error-badge-detail">{description}</p>
        {#if contextLabel}
          <p class="error-badge-summary">Status badge: {label}</p>
        {/if}
      </div>
    {/snippet}
  </AppDialog>
{/if}

<style>
  .error-badge {
    display: inline-flex;
    align-items: center;
    min-height: 20px;
    padding: 0 0.48rem;
    border-radius: 999px;
    border: 1px solid var(--nb-border, rgba(0, 0, 0, 0.08));
    background: var(--nb-panel-bg, #ffffff);
    color: var(--nb-text-soft, rgba(60, 60, 67, 0.6));
    font-size: 0.58rem;
    font-weight: 700;
    line-height: 1;
    white-space: nowrap;
    cursor: pointer;
    transition: transform 120ms ease, box-shadow 120ms ease;
  }

  .error-badge:hover,
  .error-badge:focus-visible {
    transform: translateY(-1px);
    box-shadow: 0 10px 18px rgba(0, 0, 0, 0.08);
    outline: none;
  }

  .error-badge.tone-good,
  .error-badge.tone-durable {
    border-color: color-mix(in srgb, var(--nb-success, #34C759) 22%, var(--nb-border, rgba(0, 0, 0, 0.08)));
    background: color-mix(in srgb, var(--nb-success, #34C759) 7%, var(--nb-panel-bg, #ffffff));
    color: color-mix(in srgb, var(--nb-success, #34C759) 72%, var(--nb-text-main, rgba(0, 0, 0, 0.88)));
  }

  .error-badge.tone-warn {
    border-color: color-mix(in srgb, var(--nb-warning, #FF9500) 28%, var(--nb-border, rgba(0, 0, 0, 0.08)));
    background: color-mix(in srgb, var(--nb-warning, #FF9500) 8%, var(--nb-panel-bg, #ffffff));
    color: color-mix(in srgb, var(--nb-warning, #FF9500) 72%, var(--nb-text-main, rgba(0, 0, 0, 0.88)));
  }

  .error-badge.tone-replica,
  .error-badge.tone-off,
  .error-badge.tone-muted {
    color: var(--nb-text-soft, rgba(60, 60, 67, 0.6));
  }

  :global(.error-badge-dialog-body) {
    padding-top: 0;
  }

  .error-badge-dialog-copy {
    display: grid;
    gap: 0.75rem;
  }

  .error-badge-detail,
  .error-badge-summary {
    margin: 0;
  }

  .error-badge-detail {
    color: var(--nb-text-main, rgba(0, 0, 0, 0.88));
    font-size: 1rem;
    line-height: 1.6;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }

  .error-badge-summary {
    color: var(--nb-text-soft, rgba(60, 60, 67, 0.7));
    font-size: 0.82rem;
    line-height: 1.4;
    overflow-wrap: anywhere;
  }
</style>