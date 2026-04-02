<script lang="ts">
  import type { Snippet } from 'svelte';

  export type ShareCardBadgeTone = 'good' | 'warn' | 'muted' | 'durable' | 'replica' | 'off';

  const {
    title,
    copy = '',
    active = false,
    compact = false,
    statusBadges = [],
    meta = [],
    metaActions,
    body,
    controls,
    details,
    actions,
    footer,
  } = $props<{
    title: string;
    copy?: string;
    active?: boolean;
    compact?: boolean;
    statusBadges?: Array<{ label: string; tone?: ShareCardBadgeTone; description?: string }>;
    meta?: string[];
    metaActions?: Snippet;
    body?: Snippet;
    controls?: Snippet;
    details?: Snippet;
    actions?: Snippet;
    footer?: Snippet;
  }>();
</script>

<article class="share-card" class:active class:compact>
  <div class="card-head">
    <span class="card-title-text">{title}</span>
    {#if statusBadges.length > 0}
      <span class="card-head-badges">
        {#each statusBadges as badge}
          <span class={`status-pill tone-${badge.tone ?? 'muted'}`} title={badge.description ?? badge.label}>
            {badge.label}
          </span>
        {/each}
      </span>
    {/if}
    {#if actions}
      <span class="card-head-actions">
        {@render actions()}
      </span>
    {/if}
  </div>

  {#if meta.length > 0 || metaActions}
    <div class="card-sub">
      {#each meta as item}
        <span>{item}</span>
      {/each}
      {#if metaActions}
        {@render metaActions()}
      {/if}
    </div>
  {/if}

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

  {#if details}
    <div class="card-details">
      {@render details()}
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
    gap: 0.55rem;
    align-content: start;
    height: 100%;
    padding: 0.85rem 0.95rem;
    border-radius: 10px;
    border: 1px solid var(--nb-border, rgba(0, 0, 0, 0.08));
    background: var(--nb-panel-bg, #ffffff);
  }

  .share-card.active {
    border-color: color-mix(in srgb, var(--nb-accent, #7c6f64) 18%, var(--nb-border, rgba(0, 0, 0, 0.08)));
  }

  .share-card.compact {
    gap: 0.45rem;
    padding: 0.7rem 0.82rem;
  }

  .card-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
  }

  .card-title-text {
    margin: 0;
    color: var(--nb-text-main, rgba(0, 0, 0, 0.88));
    font: inherit;
    font-size: 0.88rem;
    font-weight: 600;
    line-height: 1.25;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
    flex: 1 1 0;
  }

  .share-card.compact .card-title-text {
    font-size: 0.84rem;
  }

  .card-head-actions {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    flex-shrink: 0;
  }

  .card-head-badges {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 0.28rem;
    align-items: center;
    min-width: 0;
  }

  .status-pill {
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
  }

  .tone-good,
  .tone-durable {
    border-color: color-mix(in srgb, var(--nb-success, #34C759) 22%, var(--nb-border, rgba(0, 0, 0, 0.08)));
    background: color-mix(in srgb, var(--nb-success, #34C759) 7%, var(--nb-panel-bg, #ffffff));
    color: color-mix(in srgb, var(--nb-success, #34C759) 72%, var(--nb-text-main, rgba(0, 0, 0, 0.88)));
  }

  .tone-warn {
    border-color: color-mix(in srgb, var(--nb-warning, #FF9500) 28%, var(--nb-border, rgba(0, 0, 0, 0.08)));
    background: color-mix(in srgb, var(--nb-warning, #FF9500) 8%, var(--nb-panel-bg, #ffffff));
    color: color-mix(in srgb, var(--nb-warning, #FF9500) 72%, var(--nb-text-main, rgba(0, 0, 0, 0.88)));
  }

  .tone-replica,
  .tone-off,
  .tone-muted {
    color: var(--nb-text-soft, rgba(60, 60, 67, 0.6));
  }

  .card-sub {
    display: flex;
    gap: 0.35rem;
    flex-wrap: wrap;
    align-items: center;
    color: var(--nb-text-faint, rgba(60, 60, 67, 0.36));
    font-size: 0.73rem;
    line-height: 1.3;
  }

  .share-card.compact .card-sub {
    font-size: 0.7rem;
  }

  .card-copy {
    margin: 0;
    color: var(--nb-text-soft, rgba(60, 60, 67, 0.6));
    font-size: 0.73rem;
    line-height: 1.38;
    overflow-wrap: anywhere;
  }

  .card-controls {
    display: flex;
    gap: 0.35rem;
    align-items: center;
    padding-top: 0.15rem;
  }

  .card-body,
  .card-details,
  .card-footer {
    min-width: 0;
  }

  @media (max-width: 480px) {
    .card-head {
      flex-wrap: wrap;
    }
  }
</style>
