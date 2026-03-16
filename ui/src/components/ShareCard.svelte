<script lang="ts">
  import type { Snippet } from 'svelte';
  import { HardDrive } from 'lucide-svelte';

  export type ShareCardBadgeTone = 'good' | 'warn' | 'muted' | 'durable' | 'replica' | 'off';

  const {
    eyebrow = 'Share',
    provider = '',
    title,
    copy = '',
    active = false,
    statusBadges = [],
    meta = [],
    body,
    controls,
    details,
    actions,
    footer,
  } = $props<{
    eyebrow?: string;
    provider?: string;
    title: string;
    copy?: string;
    active?: boolean;
    statusBadges?: Array<{ label: string; tone?: ShareCardBadgeTone }>;
    meta?: string[];
    body?: Snippet;
    controls?: Snippet;
    details?: Snippet;
    actions?: Snippet;
    footer?: Snippet;
  }>();
</script>

<article class="share-card" class:active>
  <div class="card-head">
    <div class="card-title">
      <div class="card-icon">
        <HardDrive size={16} strokeWidth={2.1} />
      </div>
      <div>
        <p class="provider-label">{provider || eyebrow}</p>
        <h4>{title}</h4>
      </div>
    </div>
    {#if statusBadges.length > 0}
      <div class="card-status">
        {#each statusBadges as badge}
          <span class={`status-pill tone-${badge.tone ?? 'muted'}`}>{badge.label}</span>
        {/each}
      </div>
    {/if}
  </div>

  {#if copy}
    <p class="card-copy">{copy}</p>
  {/if}

  {#if body}
    <div class="card-body">
      {@render body()}
    </div>
  {/if}

  {#if controls}
    <div class="card-controls">
      {@render controls()}
    </div>
  {/if}

  {#if meta.length > 0}
    <div class="fact-row">
      {#each meta as item}
        <span>{item}</span>
      {/each}
    </div>
  {/if}

  {#if details}
    <div class="card-details">
      {@render details()}
    </div>
  {/if}

  {#if actions}
    <div class="button-row">
      {@render actions()}
    </div>
  {/if}

  {#if footer}
    <div class="card-footer">
      {@render footer()}
    </div>
  {/if}
</article>

<style>
  .share-card {
    display: grid;
    gap: 0.72rem;
    padding: 0.82rem;
    border-radius: 16px;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(96, 165, 250, 0.12)) 78%, transparent);
    background: color-mix(in srgb, var(--nb-panel-bg, rgba(8, 18, 33, 0.52)) 72%, transparent);
  }

  .share-card.active {
    border-color: color-mix(in srgb, var(--nb-accent, rgba(45, 212, 191, 0.26)) 62%, transparent);
    background:
      radial-gradient(circle at top left, color-mix(in srgb, var(--nb-accent, rgba(45, 212, 191, 0.26)) 28%, transparent), transparent 36%),
      color-mix(in srgb, var(--nb-panel-bg, rgba(8, 18, 33, 0.72)) 86%, transparent);
  }

  .card-head,
  .card-title,
  .card-status,
  .button-row,
  .fact-row {
    display: flex;
    gap: 0.58rem;
    min-width: 0;
  }

  .card-head {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 0.68rem;
    align-items: start;
  }

  .card-title {
    flex: 1 1 0;
    align-items: flex-start;
    min-width: 0;
  }

  .card-title > div,
  .fact-row,
  .card-copy,
  .card-body,
  .card-controls,
  .card-details,
  .card-footer {
    min-width: 0;
  }

  .card-title > div {
    display: grid;
    gap: 0.08rem;
  }

  .card-status,
  .button-row,
  .fact-row {
    flex-wrap: wrap;
  }

  .card-status {
    justify-content: flex-end;
    align-self: start;
    min-width: 0;
    max-width: min(48%, 100%);
  }

  .card-icon {
    width: 34px;
    height: 34px;
    border-radius: 12px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(96, 165, 250, 0.18)) 90%, transparent);
    background: color-mix(in srgb, var(--nb-shell-top, rgba(14, 27, 49, 0.88)) 92%, transparent);
    color: var(--nb-text-soft, rgba(191, 219, 254, 0.9));
    flex: 0 0 auto;
  }

  .provider-label {
    margin: 0 0 0.18rem;
    color: var(--nb-accent-strong, rgba(103, 232, 249, 0.94));
    font-size: 0.72rem;
    letter-spacing: 0.18em;
    text-transform: uppercase;
  }

  h4 {
    margin: 0;
    color: var(--nb-text-main, rgba(241, 245, 249, 0.96));
    font-size: 1rem;
    line-height: 1.18;
  }

  .card-copy,
  .fact-row {
    margin: 0;
    color: var(--nb-text-soft, rgba(184, 205, 232, 0.9));
    font-size: 0.8rem;
    line-height: 1.38;
  }

  .card-copy {
    overflow-wrap: anywhere;
  }

  .fact-row span {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .status-pill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 28px;
    max-width: 100%;
    padding: 0.22rem 1rem;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(96, 165, 250, 0.18)) 90%, transparent);
    background: color-mix(in srgb, var(--nb-shell-top, rgba(12, 23, 41, 0.84)) 88%, transparent);
    color: var(--nb-text-main, rgba(219, 234, 254, 0.92));
    font-size: 0.7rem;
    font-weight: 600;
    line-height: 1.2;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    box-sizing: border-box;
  }

  .tone-good,
  .tone-durable {
    border-color: color-mix(in srgb, var(--nb-success, rgba(45, 212, 191, 0.28)) 62%, transparent);
    background: color-mix(in srgb, var(--nb-success-surface, rgba(9, 58, 58, 0.42)) 90%, transparent);
    color: var(--nb-success, #5eead4);
  }

  .tone-warn {
    border-color: color-mix(in srgb, var(--nb-warning, rgba(251, 191, 36, 0.28)) 62%, transparent);
    background: color-mix(in srgb, var(--nb-warning-surface, rgba(72, 53, 16, 0.46)) 92%, transparent);
    color: var(--nb-warning, #fbbf24);
  }

  .tone-muted,
  .tone-replica,
  .tone-off {
    color: var(--nb-text-soft, rgba(191, 219, 254, 0.88));
  }

  .button-row {
    align-items: center;
  }

  @media (max-width: 760px) {
    .card-head {
      grid-template-columns: 1fr;
    }

    .card-status {
      justify-content: flex-start;
      max-width: 100%;
    }
  }
</style>
