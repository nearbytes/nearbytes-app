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
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 86%, rgba(210, 122, 84, 0.08));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 95%, rgba(252, 244, 238, 0.88));
  }

  .share-card.active {
    border-color: color-mix(in srgb, var(--nb-accent, #d27a54) 14%, rgba(60, 60, 67, 0.14));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 97%, rgba(248, 243, 239, 0.92));
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 74%, rgba(210, 122, 84, 0.08));
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
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 88%, rgba(210, 122, 84, 0.08));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 94%, rgba(252, 244, 238, 0.9));
    color: var(--nb-text-soft, rgba(70, 70, 73, 0.86));
    flex: 0 0 auto;
  }

  .provider-label {
    margin: 0 0 0.18rem;
    color: color-mix(in srgb, var(--nb-accent-strong, #b85f39) 72%, rgba(110, 110, 115, 0.82));
    font-size: 0.72rem;
    letter-spacing: 0.18em;
    text-transform: uppercase;
  }

  h4 {
    margin: 0;
    color: var(--nb-text-main, rgba(28, 28, 30, 0.96));
    font-size: 1rem;
    line-height: 1.18;
  }

  .card-copy,
  .fact-row {
    margin: 0;
    color: var(--nb-text-soft, rgba(70, 70, 73, 0.82));
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
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 88%, rgba(210, 122, 84, 0.08));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 95%, rgba(252, 244, 238, 0.88));
    color: var(--nb-text-main, rgba(28, 28, 30, 0.92));
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
    border-color: color-mix(in srgb, var(--nb-success, #6aa975) 24%, transparent);
    background: color-mix(in srgb, var(--nb-success-surface, rgba(134, 239, 172, 0.12)) 82%, rgba(247, 252, 248, 0.96));
    color: color-mix(in srgb, var(--nb-success, #6aa975) 82%, var(--nb-text-main, rgba(28, 28, 30, 0.96)));
  }

  .tone-warn {
    border-color: color-mix(in srgb, var(--nb-warning, #d4945f) 24%, transparent);
    background: color-mix(in srgb, var(--nb-warning-surface, rgba(253, 230, 138, 0.12)) 82%, rgba(255, 250, 245, 0.96));
    color: color-mix(in srgb, var(--nb-warning, #d4945f) 82%, var(--nb-text-main, rgba(28, 28, 30, 0.96)));
  }

  .tone-muted,
  .tone-replica,
  .tone-off {
    color: var(--nb-text-soft, rgba(70, 70, 73, 0.82));
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
