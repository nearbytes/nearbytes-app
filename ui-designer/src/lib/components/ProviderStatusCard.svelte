<script lang="ts">
  import type { Snippet } from 'svelte';

  type ProviderStatusTone = 'good' | 'warn' | 'muted';

  const {
    title,
    detail = '',
    tone = 'muted',
    progressPercent = null,
    progressLabel = '',
    showProgress = false,
    actions,
  } = $props<{
    title: string;
    detail?: string;
    tone?: ProviderStatusTone;
    progressPercent?: number | null;
    progressLabel?: string;
    showProgress?: boolean;
    actions?: Snippet;
  }>();
</script>

<article class="provider-status-card" data-tone={tone}>
  <div class="provider-status-main">
    <div class="provider-status-copy">
      <p class="provider-status-title">{title}</p>
      {#if detail}
        <p class="provider-status-detail">{detail}</p>
      {/if}
    </div>

    {#if actions}
      <div class="provider-status-actions">
        {@render actions()}
      </div>
    {/if}
  </div>

  {#if showProgress && progressLabel}
    <div class="provider-status-progress-block">
      <div
        class="provider-status-progress"
        aria-label="Provider progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progressPercent ?? undefined}
      >
        <div
          class="provider-status-progress-bar"
          class:indeterminate={progressPercent === null}
          style={progressPercent === null ? undefined : `width: ${progressPercent}%`}
        ></div>
      </div>
      <p class="provider-status-progress-copy">{progressLabel}</p>
    </div>
  {/if}
</article>

<style>
  .provider-status-card {
    display: grid;
    gap: 0.7rem;
    padding: 0.92rem 0.96rem;
    border-radius: 18px;
    border: 1px solid color-mix(in srgb, var(--nb-border) 86%, transparent);
    background:
      linear-gradient(180deg, color-mix(in srgb, var(--nb-surface-strong) 95%, transparent), color-mix(in srgb, var(--nb-surface) 94%, transparent)),
      radial-gradient(circle at top right, color-mix(in srgb, var(--nb-accent) 9%, transparent), transparent 64%);
  }

  .provider-status-card[data-tone='warn'] {
    border-color: color-mix(in srgb, var(--nb-warning) 36%, var(--nb-border));
  }

  .provider-status-card[data-tone='good'] {
    border-color: color-mix(in srgb, var(--nb-success) 28%, var(--nb-border));
  }

  .provider-status-main {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 0.8rem;
    align-items: start;
  }

  .provider-status-copy {
    display: grid;
    gap: 0.22rem;
  }

  .provider-status-title,
  .provider-status-detail,
  .provider-status-progress-copy {
    margin: 0;
  }

  .provider-status-title {
    color: var(--nb-text);
    font-size: 0.92rem;
    line-height: 1.3;
    font-weight: 650;
  }

  .provider-status-detail,
  .provider-status-progress-copy {
    color: var(--nb-text-soft);
    font-size: 0.76rem;
    line-height: 1.42;
  }

  .provider-status-actions {
    display: flex;
    align-items: center;
    gap: 0.45rem;
  }

  .provider-status-progress-block {
    display: grid;
    gap: 0.38rem;
  }

  .provider-status-progress {
    position: relative;
    overflow: hidden;
    height: 7px;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--nb-border) 88%, transparent);
    background: color-mix(in srgb, var(--nb-surface-strong) 86%, transparent);
  }

  .provider-status-progress-bar {
    position: absolute;
    inset: 0 auto 0 0;
    width: 0%;
    border-radius: inherit;
    background: linear-gradient(90deg, var(--nb-accent), color-mix(in srgb, var(--nb-accent-strong) 76%, white 10%));
    transition: width 220ms ease;
  }

  .provider-status-progress-bar.indeterminate {
    width: 34%;
    animation: provider-status-indeterminate 1.1s ease-in-out infinite;
  }

  @keyframes provider-status-indeterminate {
    0% { transform: translateX(-120%); }
    100% { transform: translateX(320%); }
  }

  @media (max-width: 560px) {
    .provider-status-main {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>