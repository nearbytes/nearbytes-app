<script lang="ts">
  import type { Snippet } from 'svelte';
  import { HardDrive } from 'lucide-svelte';

  export type ShareCardBadgeTone = 'good' | 'warn' | 'muted' | 'durable' | 'replica' | 'off';

  const {
    eyebrow = 'Location',
    provider = '',
    title,
    pathLabel = '',
    copy = '',
    active = false,
    compact = false,
    statusBadges = [],
    meta = [],
    reservePercent,
    onPathClick,
    onChangeLocation,
    changeDisabled = false,
    changeLabel = 'Change',
    onReserveClick,
    metaActions,
    body,
    controls,
    details,
    actions,
    footer,
  } = $props<{
    eyebrow?: string;
    provider?: string;
    title: string;
    pathLabel?: string;
    copy?: string;
    active?: boolean;
    compact?: boolean;
    statusBadges?: Array<{ label: string; tone?: ShareCardBadgeTone; description?: string }>;
    meta?: string[];
    reservePercent?: number;
    onPathClick?: () => void;
    onChangeLocation?: () => void;
    changeDisabled?: boolean;
    changeLabel?: string;
    onReserveClick?: () => void;
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
    <div class="card-title">
      <div class="card-icon">
        <HardDrive size={16} strokeWidth={2.1} />
      </div>
      <div>
        <p class="provider-label">{provider || eyebrow}</p>
        <h4>{title}</h4>
        {#if pathLabel}
          <span class="card-path-row">
            {#if onPathClick}
              <button type="button" class="card-path-link" title={pathLabel} onclick={onPathClick}>{pathLabel}</button>
            {:else}
              <span class="card-path" title={pathLabel}>{pathLabel}</span>
            {/if}
            {#if onChangeLocation}
              <button type="button" class="card-change-btn" onclick={onChangeLocation} disabled={changeDisabled}>{changeLabel}</button>
            {/if}
          </span>
        {/if}
      </div>
    </div>
    <div class="card-head-end">
      {#if typeof reservePercent === 'number' && onReserveClick}
        <button type="button" class="reserve-badge" title="Free-space buffer: {reservePercent}%. Click to change." onclick={onReserveClick}>
          {reservePercent}%
        </button>
      {/if}
      {#if statusBadges.length > 0}
        <div class="card-status">
          {#each statusBadges as badge}
            <span
              class={`status-pill tone-${badge.tone ?? 'muted'} ${badge.label === 'Ready' ? 'ready-badge' : ''}`}
              title={badge.description}
            >{badge.label}</span>
          {/each}
        </div>
      {/if}
    </div>
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

  {#if meta.length > 0 || metaActions}
    <div class="fact-row">
      {#each meta as item}
        <span>{item}</span>
      {/each}
      {#if metaActions}
        {@render metaActions()}
      {/if}
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
    gap: 0.75rem;
    align-content: start;
    height: 100%;
    padding: 1rem;
    border-radius: 14px;
    border: 1px solid var(--nb-border, rgba(0, 0, 0, 0.08));
    background: var(--nb-panel-bg, #ffffff);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
  }

  .share-card.active {
    border-color: color-mix(in srgb, var(--nb-accent, #7c6f64) 16%, var(--nb-border, rgba(0, 0, 0, 0.08)));
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
  }

  .share-card.compact {
    gap: 0.6rem;
    padding: 0.85rem;
    border-radius: 12px;
  }

  .card-head,
  .card-title,
  .card-status,
  .button-row,
  .fact-row {
    display: flex;
    gap: 0.5rem;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .card-head {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 0.6rem;
    align-items: start;
    overflow-wrap: anywhere;
  }

  .card-head-end {
    display: flex;
    gap: 0.4rem;
    align-items: flex-start;
    flex-shrink: 0;
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
    gap: 0.12rem;
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
  }

  .card-icon {
    width: 32px;
    height: 32px;
    border-radius: 8px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--nb-border, rgba(0, 0, 0, 0.08));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 95%, rgba(245, 243, 240, 0.9));
    color: var(--nb-text-soft, rgba(60, 60, 67, 0.6));
    flex: 0 0 auto;
  }

  .share-card.compact .card-icon {
    width: 28px;
    height: 28px;
    border-radius: 7px;
  }

  .provider-label {
    margin: 0 0 0.1rem;
    color: var(--nb-text-soft, rgba(60, 60, 67, 0.6));
    font-size: 0.65rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    overflow-wrap: anywhere;
  }

  h4 {
    margin: 0;
    color: var(--nb-text-main, rgba(0, 0, 0, 0.88));
    font-size: 0.95rem;
    font-weight: 600;
    line-height: 1.2;
    overflow-wrap: anywhere;
  }

  .share-card.compact h4 {
    font-size: 0.88rem;
    line-height: 1.24;
  }

  .card-copy,
  .card-path,
  .card-path-link,
  .fact-row {
    margin: 0;
    color: var(--nb-text-soft, rgba(60, 60, 67, 0.6));
    font-size: 0.78rem;
    line-height: 1.38;
  }

  .share-card.compact .card-copy,
  .share-card.compact .card-path,
  .share-card.compact .card-path-link,
  .share-card.compact .fact-row {
    font-size: 0.73rem;
    line-height: 1.34;
  }

  .card-path-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-top: 0.15rem;
    min-width: 0;
  }

  .card-path {
    color: var(--nb-text-faint, rgba(60, 60, 67, 0.36));
    line-height: 1.32;
    word-break: break-word;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 22ch;
  }

  .card-path-link {
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--nb-text-faint, rgba(60, 60, 67, 0.36));
    font: inherit;
    font-size: inherit;
    line-height: 1.32;
    cursor: pointer;
    text-decoration: none;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 22ch;
    transition: color 100ms ease;
  }

  .card-path-link:hover {
    color: var(--nb-text-soft, rgba(60, 60, 67, 0.6));
    text-decoration: underline;
    text-decoration-color: var(--nb-text-faint, rgba(60, 60, 67, 0.36));
    text-underline-offset: 2px;
  }

  .card-change-btn {
    padding: 0.1rem 0.45rem;
    border: 1px solid var(--nb-border, rgba(0, 0, 0, 0.08));
    border-radius: 5px;
    background: transparent;
    color: var(--nb-text-faint, rgba(60, 60, 67, 0.36));
    font: inherit;
    font-size: 0.62rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    cursor: pointer;
    transition: color 100ms ease, border-color 100ms ease;
    flex-shrink: 0;
  }

  .card-change-btn:hover:not(:disabled) {
    color: var(--nb-text-soft, rgba(60, 60, 67, 0.6));
    border-color: color-mix(in srgb, var(--nb-accent, #7c6f64) 20%, var(--nb-border, rgba(0, 0, 0, 0.08)));
  }

  .card-change-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .reserve-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 28px;
    height: 22px;
    padding: 0 0.35rem;
    border-radius: 6px;
    border: 1px solid var(--nb-border, rgba(0, 0, 0, 0.08));
    background: transparent;
    color: var(--nb-text-faint, rgba(60, 60, 67, 0.36));
    font: inherit;
    font-size: 0.6rem;
    font-weight: 600;
    cursor: pointer;
    transition: color 100ms ease, border-color 100ms ease, background 100ms ease;
  }

  .reserve-badge:hover {
    color: var(--nb-text-soft, rgba(60, 60, 67, 0.6));
    border-color: color-mix(in srgb, var(--nb-accent, #7c6f64) 20%, var(--nb-border, rgba(0, 0, 0, 0.08)));
    background: color-mix(in srgb, var(--nb-accent, #7c6f64) 4%, transparent);
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
    align-self: flex-start;
    flex: 0 1 auto;
    min-height: 22px;
    padding: 0.15rem 0.65rem;
    border-radius: 999px;
    border: 1px solid var(--nb-border, rgba(0, 0, 0, 0.08));
    background: var(--nb-panel-bg, #ffffff);
    color: var(--nb-text-soft, rgba(60, 60, 67, 0.6));
    font-size: 0.62rem;
    font-weight: 600;
    line-height: 1.2;
    white-space: normal;
    overflow-wrap: anywhere;
    box-sizing: border-box;
  }

  .status-pill.ready-badge {
    padding-inline: 0.8rem;
  }

  .share-card.compact .status-pill {
    min-height: 20px;
    padding: 0.12rem 0.55rem;
    font-size: 0.58rem;
  }

  .tone-good,
  .tone-durable {
    border-color: color-mix(in srgb, var(--nb-success, #34C759) 24%, transparent);
    background: color-mix(in srgb, var(--nb-success, #34C759) 6%, var(--nb-panel-bg, #ffffff));
    color: color-mix(in srgb, var(--nb-success, #34C759) 72%, var(--nb-text-main, rgba(0, 0, 0, 0.88)));
  }

  .tone-warn {
    border-color: color-mix(in srgb, var(--nb-warning, #FF9500) 24%, transparent);
    background: color-mix(in srgb, var(--nb-warning, #FF9500) 6%, var(--nb-panel-bg, #ffffff));
    color: color-mix(in srgb, var(--nb-warning, #FF9500) 72%, var(--nb-text-main, rgba(0, 0, 0, 0.88)));
  }

  .tone-muted,
  .tone-replica,
  .tone-off {
    color: var(--nb-text-soft, rgba(60, 60, 67, 0.6));
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
