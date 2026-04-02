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
    gap: 0.65rem;
    padding: 0.86rem 0.92rem;
    border-radius: 14px;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 84%, rgba(0, 0, 0, 0.03));
    background:
      linear-gradient(180deg, color-mix(in srgb, var(--nb-panel-bg, #ffffff) 97%, rgba(250, 246, 243, 0.94)), color-mix(in srgb, var(--nb-panel-bg, #ffffff) 94%, rgba(248, 240, 234, 0.92))),
      radial-gradient(circle at top right, color-mix(in srgb, var(--nb-accent, #7c6f64) 9%, transparent), transparent 62%);
  }

  .provider-status-card[data-tone='warn'] {
    border-color: color-mix(in srgb, var(--nb-warning, #d4945f) 32%, var(--nb-border, rgba(60, 60, 67, 0.12)));
    background:
      linear-gradient(180deg, color-mix(in srgb, rgba(255, 250, 245, 0.98) 92%, rgba(253, 230, 138, 0.12)), color-mix(in srgb, rgba(255, 248, 242, 0.96) 90%, rgba(253, 230, 138, 0.16))),
      radial-gradient(circle at top right, color-mix(in srgb, var(--nb-warning, #d4945f) 10%, transparent), transparent 58%);
  }

  .provider-status-card[data-tone='good'] {
    border-color: color-mix(in srgb, var(--nb-success, #34c759) 24%, var(--nb-border, rgba(60, 60, 67, 0.12)));
  }

  .provider-status-main {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 0.75rem;
    align-items: start;
  }

  .provider-status-copy {
    display: grid;
    gap: 0.22rem;
    min-width: 0;
  }

  .provider-status-title,
  .provider-status-detail,
  .provider-status-progress-copy {
    margin: 0;
  }

  .provider-status-title {
    color: var(--text-main);
    font-size: 0.9rem;
    line-height: 1.28;
    font-weight: 650;
  }

  .provider-status-detail,
  .provider-status-progress-copy {
    color: var(--text-soft);
    font-size: 0.75rem;
    line-height: 1.4;
  }

  .provider-status-actions {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 0.4rem;
  }

  .provider-status-progress-block {
    display: grid;
    gap: 0.35rem;
  }

  .provider-status-progress {
    position: relative;
    overflow: hidden;
    height: 6px;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 86%, rgba(0, 0, 0, 0.03));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 94%, rgba(248, 240, 234, 0.9));
  }

  .provider-status-progress-bar {
    position: absolute;
    inset: 0 auto 0 0;
    width: 0%;
    border-radius: inherit;
    background: color-mix(in srgb, var(--nb-accent, #7c6f64) 50%, rgba(255, 249, 246, 0.98));
    transition: width 220ms ease;
  }

  .provider-status-progress-bar.indeterminate {
    width: 34%;
    animation: provider-status-indeterminate 1.1s ease-in-out infinite;
  }

  @keyframes provider-status-indeterminate {
    0% {
      transform: translateX(-120%);
    }
    100% {
      transform: translateX(320%);
    }
  }

  @media (max-width: 560px) {
    .provider-status-main {
      grid-template-columns: minmax(0, 1fr);
    }

    .provider-status-actions {
      justify-content: flex-start;
    }
  }
</style>