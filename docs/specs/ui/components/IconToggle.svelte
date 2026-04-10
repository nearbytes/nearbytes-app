<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { ComponentType } from 'svelte';

  let {
    icon,
    label,
    active = false,
    disabled = false,
    layout = 'pill',
    title = '',
    ariaLabel = '',
    onclick,
  } = $props<{
    icon: ComponentType;
    label: string;
    active?: boolean;
    disabled?: boolean;
    layout?: 'pill' | 'stacked';
    title?: string;
    ariaLabel?: string;
    onclick?: (() => void) | undefined;
  }>();

  let optimisticActive = $state<boolean | null>(null);
  let optimisticResetTimer: ReturnType<typeof setTimeout> | null = null;

  const visualActive = $derived(optimisticActive ?? active);

  $effect(() => {
    if (optimisticActive !== null && active === optimisticActive) {
      optimisticActive = null;
      if (optimisticResetTimer) {
        clearTimeout(optimisticResetTimer);
        optimisticResetTimer = null;
      }
    }
  });

  onDestroy(() => {
    if (optimisticResetTimer) {
      clearTimeout(optimisticResetTimer);
      optimisticResetTimer = null;
    }
  });

  function handlePress(): void {
    if (disabled) {
      return;
    }

    const nextActive = !(optimisticActive ?? active);
    optimisticActive = nextActive;

    if (optimisticResetTimer) {
      clearTimeout(optimisticResetTimer);
    }
    optimisticResetTimer = setTimeout(() => {
      if (optimisticActive === nextActive && active !== nextActive) {
        optimisticActive = null;
      }
      optimisticResetTimer = null;
    }, 1600);

    requestAnimationFrame(() => {
      onclick?.();
    });
  }
</script>

<button
  type="button"
  class="icon-toggle"
  class:active={visualActive}
  class:layout-stacked={layout === 'stacked'}
  disabled={disabled}
  aria-pressed={visualActive}
  aria-label={ariaLabel || label}
  title={title || label}
  onclick={handlePress}
>
  {#if icon}
    {@const Icon = icon}
    <span class="icon-toggle-glyph">
      <Icon size={14} strokeWidth={2} />
    </span>
  {/if}
  <span class="icon-toggle-label">{label}</span>
</button>

<style>
  .icon-toggle {
    min-height: 30px;
    padding: 0 0.7rem;
    border-radius: 999px;
    border: 1px solid var(--nb-border, rgba(60, 60, 67, 0.12));
    background: var(--nb-panel-bg, #ffffff);
    color: var(--nb-text-soft, rgba(60, 60, 67, 0.6));
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.38rem;
    font: inherit;
    font-size: 0.74rem;
    font-weight: 700;
    letter-spacing: 0.01em;
    cursor: pointer;
    transition:
      transform 140ms cubic-bezier(0.2, 0, 0, 1),
      background 140ms ease,
      border-color 140ms ease,
      color 140ms ease,
      box-shadow 140ms ease;
  }

  .icon-toggle.layout-stacked {
    min-width: 52px;
    min-height: 44px;
    padding: 0.35rem 0.6rem;
    border-radius: 10px;
    flex-direction: column;
    gap: 0.15rem;
  }

  .icon-toggle:hover:not(:disabled) {
    transform: translateY(-1px);
    border-color: color-mix(in srgb, var(--nb-accent, #7c6f64) 24%, var(--nb-border, rgba(60, 60, 67, 0.12)));
    color: var(--nb-text-main, rgba(0, 0, 0, 0.88));
  }

  .icon-toggle.active {
    border-color: color-mix(in srgb, var(--nb-accent, #7c6f64) 36%, var(--nb-border, rgba(60, 60, 67, 0.12)));
    background: color-mix(in srgb, var(--nb-accent, #7c6f64) 6%, var(--nb-panel-bg, #ffffff));
    color: var(--nb-accent-strong, #5d524a);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
  }

  .icon-toggle.layout-stacked.active {
    border-color: var(--nb-accent, #7c6f64);
    background: color-mix(in srgb, var(--nb-accent, #7c6f64) 8%, var(--nb-panel-bg, #ffffff));
    color: var(--nb-accent-strong, #5d524a);
  }

  .icon-toggle.layout-stacked:hover:not(:disabled) {
    transform: translateY(-1px);
  }

  .icon-toggle.layout-stacked.active:hover:not(:disabled) {
    transform: translateY(-1px);
  }

  .icon-toggle.active .icon-toggle-label {
    font-weight: 700;
  }

  .icon-toggle:disabled {
    opacity: 0.5;
    cursor: default;
    transform: none;
  }

  .icon-toggle-glyph {
    flex: 0 0 auto;
  }

  .icon-toggle.layout-stacked .icon-toggle-glyph {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .icon-toggle-label {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .icon-toggle.layout-stacked .icon-toggle-label {
    font-size: 0.58rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    line-height: 1;
  }
</style>