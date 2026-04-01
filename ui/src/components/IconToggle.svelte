<script lang="ts">
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
</script>

<button
  type="button"
  class="icon-toggle"
  class:active
  class:layout-stacked={layout === 'stacked'}
  disabled={disabled}
  aria-pressed={active}
  aria-label={ariaLabel || label}
  title={title || label}
  onclick={() => onclick?.()}
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
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 86%, rgba(210, 122, 84, 0.08));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 96%, rgba(252, 244, 238, 0.88));
    color: var(--nb-text-soft, rgba(70, 70, 73, 0.84));
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
      transform 120ms ease,
      background 120ms ease,
      border-color 120ms ease,
      color 120ms ease,
      box-shadow 120ms ease;
  }

  .icon-toggle.layout-stacked {
    min-width: 58px;
    min-height: 52px;
    padding: 0.42rem 0.52rem;
    border-radius: 14px;
    flex-direction: column;
    gap: 0.18rem;
  }

  .icon-toggle:hover:not(:disabled) {
    transform: translateY(-1px);
    border-color: color-mix(in srgb, var(--nb-accent, #d27a54) 14%, rgba(60, 60, 67, 0.14));
    color: var(--nb-text-main, rgba(28, 28, 30, 0.96));
  }

  .icon-toggle.active {
    border-color: color-mix(in srgb, var(--nb-accent, #d27a54) 18%, rgba(60, 60, 67, 0.14));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 93%, rgba(248, 243, 239, 0.94));
    color: var(--nb-text-main, rgba(28, 28, 30, 0.96));
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 70%, rgba(210, 122, 84, 0.08));
  }

  .icon-toggle:disabled {
    opacity: 0.5;
    cursor: default;
    transform: none;
  }

  .icon-toggle-glyph {
    flex: 0 0 auto;
  }

  .icon-toggle-label {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .icon-toggle.layout-stacked .icon-toggle-label {
    font-size: 0.64rem;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    line-height: 1.05;
  }
</style>