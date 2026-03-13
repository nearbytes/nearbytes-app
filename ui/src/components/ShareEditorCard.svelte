<script lang="ts">
  import type { Snippet } from 'svelte';
  import { HardDrive } from 'lucide-svelte';

  export type ShareEditorBadgeTone = 'good' | 'warn' | 'muted' | 'durable' | 'replica' | 'off';

  const {
    eyebrow = 'Share',
    provider = '',
    title,
    copy = '',
    active = false,
    statusBadges = [],
    meta = [],
    children,
    actions,
  } = $props<{
    eyebrow?: string;
    provider?: string;
    title: string;
    copy?: string;
    active?: boolean;
    statusBadges?: Array<{ label: string; tone?: ShareEditorBadgeTone }>;
    meta?: string[];
    children?: Snippet;
    actions?: Snippet;
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

  {@render children?.()}

  {#if meta.length > 0}
    <div class="fact-row">
      {#each meta as item}
        <span>{item}</span>
      {/each}
    </div>
  {/if}

  {#if actions}
    <div class="button-row">
      {@render actions()}
    </div>
  {/if}
</article>

<style>
  .share-card {
    display: grid;
    gap: 0.68rem;
    padding: 0.82rem;
    border-radius: 16px;
    border: 1px solid rgba(96, 165, 250, 0.12);
    background: rgba(8, 18, 33, 0.52);
  }

  .share-card.active {
    border-color: rgba(45, 212, 191, 0.26);
    background:
      radial-gradient(circle at top left, rgba(45, 212, 191, 0.08), transparent 36%),
      rgba(8, 18, 33, 0.72);
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
  .card-copy {
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
  }

  .card-icon {
    width: 34px;
    height: 34px;
    border-radius: 12px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid rgba(96, 165, 250, 0.18);
    background: rgba(14, 27, 49, 0.88);
    color: rgba(191, 219, 254, 0.9);
    flex: 0 0 auto;
  }

  .provider-label {
    margin: 0 0 0.18rem;
    color: rgba(103, 232, 249, 0.94);
    font-size: 0.72rem;
    letter-spacing: 0.18em;
    text-transform: uppercase;
  }

  h4 {
    margin: 0;
    color: rgba(241, 245, 249, 0.96);
    font-size: 1rem;
    line-height: 1.18;
  }

  .card-copy,
  .fact-row {
    margin: 0;
    color: rgba(184, 205, 232, 0.9);
    font-size: 0.8rem;
    line-height: 1.38;
  }

  .fact-row span {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .status-pill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 26px;
    max-width: 100%;
    padding: 0 0.68rem;
    border-radius: 999px;
    border: 1px solid rgba(96, 165, 250, 0.18);
    background: rgba(12, 23, 41, 0.84);
    color: rgba(219, 234, 254, 0.92);
    font-size: 0.7rem;
    font-weight: 600;
    white-space: nowrap;
  }

  .tone-good,
  .tone-durable {
    border-color: rgba(45, 212, 191, 0.28);
    background: rgba(9, 58, 58, 0.42);
    color: #5eead4;
  }

  .tone-warn {
    border-color: rgba(251, 191, 36, 0.28);
    background: rgba(72, 53, 16, 0.46);
    color: #fbbf24;
  }

  .tone-muted,
  .tone-replica,
  .tone-off {
    color: rgba(191, 219, 254, 0.88);
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
    }
  }
</style>
