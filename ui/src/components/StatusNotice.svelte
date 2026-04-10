<script lang="ts">
  //FIXME: MIGRATION: port this surface to the UI design system
  import type { Snippet } from 'svelte';

  export type StatusNoticeTone = 'error' | 'warning' | 'success' | 'info';

  const {
    title = '',
    message,
    tone = 'info',
    compact = false,
    role = 'status',
    actions,
  } = $props<{
    title?: string;
    message: string;
    tone?: StatusNoticeTone;
    compact?: boolean;
    role?: 'status' | 'alert';
    actions?: Snippet;
  }>();
</script>

<div class="status-notice" data-tone={tone} data-compact={compact ? 'true' : undefined} {role} aria-live={role === 'alert' ? 'assertive' : 'polite'}>
  <div class="status-notice-copy">
    {#if title}
      <p class="status-notice-title">{title}</p>
    {/if}
    <p class="status-notice-message">{message}</p>
  </div>

  {#if actions}
    <div class="status-notice-actions">
      {@render actions()}
    </div>
  {/if}
</div>

<style>
  .status-notice {
    display: grid;
    gap: 0.55rem;
    padding: 0.78rem 0.88rem;
    border-radius: 14px;
    border: 1px solid color-mix(in srgb, var(--status-notice-border, rgba(60, 60, 67, 0.14)) 88%, transparent);
    background: color-mix(in srgb, var(--status-notice-bg, rgba(255, 255, 255, 0.96)) 94%, transparent);
  }

  .status-notice[data-compact='true'] {
    gap: 0.45rem;
    padding: 0.62rem 0.72rem;
    border-radius: 12px;
  }

  .status-notice[data-tone='error'] {
    --status-notice-border: color-mix(in srgb, var(--nb-danger, #d04f4f) 30%, var(--nb-border, rgba(60, 60, 67, 0.12)));
    --status-notice-bg: color-mix(in srgb, var(--nb-danger-surface, rgba(208, 79, 79, 0.14)) 86%, rgba(255, 248, 247, 0.98));
  }

  .status-notice[data-tone='warning'] {
    --status-notice-border: color-mix(in srgb, var(--nb-warning, #d4945f) 32%, var(--nb-border, rgba(60, 60, 67, 0.12)));
    --status-notice-bg: color-mix(in srgb, rgba(255, 248, 240, 0.98) 92%, rgba(253, 230, 138, 0.22));
  }

  .status-notice[data-tone='success'] {
    --status-notice-border: color-mix(in srgb, var(--nb-success, #34c759) 28%, var(--nb-border, rgba(60, 60, 67, 0.12)));
    --status-notice-bg: color-mix(in srgb, rgba(244, 255, 248, 0.98) 92%, rgba(52, 199, 89, 0.14));
  }

  .status-notice[data-tone='info'] {
    --status-notice-border: color-mix(in srgb, var(--nb-accent, #7c6f64) 20%, var(--nb-border, rgba(60, 60, 67, 0.12)));
    --status-notice-bg: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 96%, rgba(245, 243, 240, 0.92));
  }

  .status-notice-copy {
    display: grid;
    gap: 0.18rem;
    min-width: 0;
  }

  .status-notice-title,
  .status-notice-message {
    margin: 0;
  }

  .status-notice-title {
    font-size: 0.78rem;
    line-height: 1.35;
    font-weight: 700;
    color: var(--nb-text-main, rgba(28, 28, 30, 0.94));
  }

  .status-notice-message {
    font-size: 0.82rem;
    line-height: 1.5;
    color: var(--nb-text-soft, rgba(70, 70, 73, 0.84));
    white-space: pre-wrap;
    word-break: break-word;
  }

  .status-notice[data-compact='true'] .status-notice-title {
    font-size: 0.74rem;
  }

  .status-notice[data-compact='true'] .status-notice-message {
    font-size: 0.78rem;
  }

  .status-notice-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
    align-items: center;
  }
</style>