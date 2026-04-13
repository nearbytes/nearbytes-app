<script lang="ts">
  import ErrorBadge from './ErrorBadge.svelte';
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
          {#if badge.tone === 'warn' && badge.description?.trim()}
            <ErrorBadge
              label={badge.label}
              description={badge.description}
              title={title}
              tone={badge.tone}
            />
          {:else}
            <span class={`status-pill tone-${badge.tone ?? 'muted'}`} title={badge.description ?? badge.label}>
              {badge.label}
            </span>
          {/if}
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
    gap: 0.58rem;
    align-content: start;
    padding: 0.9rem 0.96rem;
    border-radius: var(--nb-radius-item);
    border: 1px solid var(--nb-border);
    background: var(--nb-surface-strong);
  }

  .share-card.active {
    border-color: color-mix(in srgb, var(--nb-accent) 24%, var(--nb-border));
    background: color-mix(in srgb, var(--nb-accent) 5%, var(--nb-surface-strong));
  }

  .share-card.compact {
    gap: 0.46rem;
    padding: 0.76rem 0.84rem;
  }

  .card-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
  }

  .card-title-text {
    color: var(--nb-text);
    font-size: 0.9rem;
    font-weight: 650;
    line-height: 1.25;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
    flex: 1 1 0;
  }

  .card-head-badges {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 0.28rem;
    align-items: center;
    min-width: 0;
  }

  .card-head-actions {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    flex-shrink: 0;
  }

  .status-pill {
    display: inline-flex;
    align-items: center;
    min-height: 20px;
    padding: 0 0.48rem;
    border-radius: 999px;
    border: 1px solid var(--nb-border);
    color: var(--nb-text-soft);
    font-size: 0.58rem;
    font-weight: 700;
    line-height: 1;
    white-space: nowrap;
  }

  .tone-good,
  .tone-durable {
    border-color: color-mix(in srgb, var(--nb-success) 26%, var(--nb-border));
    background: var(--nb-surface);
    color: color-mix(in srgb, var(--nb-success) 74%, var(--nb-text));
  }

  .tone-warn {
    border-color: color-mix(in srgb, var(--nb-warning) 32%, var(--nb-border));
    background: var(--nb-surface);
    color: color-mix(in srgb, var(--nb-warning) 78%, var(--nb-text));
  }

  .card-sub {
    display: flex;
    gap: 0.36rem;
    flex-wrap: wrap;
    align-items: center;
    color: var(--nb-text-faint);
    font-size: 0.73rem;
    line-height: 1.35;
  }

  .card-copy {
    margin: 0;
    color: var(--nb-text-soft);
    font-size: 0.76rem;
    line-height: 1.42;
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