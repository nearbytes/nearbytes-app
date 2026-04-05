<script lang="ts">
  import { HardDrive } from 'lucide-svelte';

  let {
    active = false,
    disabled = false,
    badge = 'This hub',
    label = 'Hub storage',
    onclick,
  } = $props<{
    active?: boolean;
    disabled?: boolean;
    badge?: string;
    label?: string;
    onclick?: (() => void) | undefined;
  }>();
</script>

<button
  type="button"
  class="hub-storage-button"
  class:active
  disabled={disabled}
  onclick={() => onclick?.()}
>
  <HardDrive class="button-icon" size={15} strokeWidth={2} />
  <span class="hub-storage-button-label">{label}</span>
  <span class="hub-storage-button-badge">{badge}</span>
</button>

<style>
  .hub-storage-button {
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 88%, rgba(0, 0, 0, 0.03));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 95%, rgba(252, 244, 238, 0.9));
    color: var(--nb-text-main, rgba(28, 28, 30, 0.94));
    border-radius: 999px;
    padding: 0 0.82rem;
    min-height: 32px;
    min-width: 0;
    max-width: 100%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.46rem;
    font-family: var(--nb-font-body);
    font-size: 0.76rem;
    font-weight: 600;
    letter-spacing: 0.01em;
    line-height: 1;
    white-space: nowrap;
    cursor: pointer;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.02);
    transition: background-color 0.18s ease, border-color 0.18s ease, color 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease;
  }

  .hub-storage-button:hover:not(:disabled) {
    transform: translateY(-1px);
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 92%, white 8%);
    border-color: color-mix(in srgb, var(--nb-accent, #7c6f64) 12%, rgba(60, 60, 67, 0.14));
    color: var(--nb-text-main, rgba(28, 28, 30, 0.98));
  }

  .hub-storage-button:focus-visible {
    outline: none;
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--nb-panel-bg, #ffffff) 72%, rgba(240, 232, 226, 0.8));
  }

  .hub-storage-button:disabled {
    opacity: 0.62;
    cursor: default;
  }

  .hub-storage-button.active {
    border-color: color-mix(in srgb, var(--nb-accent, #7c6f64) 18%, rgba(60, 60, 67, 0.14));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 94%, rgba(248, 243, 239, 0.92));
    color: var(--nb-text-main, rgba(28, 28, 30, 0.98));
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 72%, rgba(0, 0, 0, 0.03));
  }

  .hub-storage-button-label,
  .hub-storage-button-badge {
    white-space: nowrap;
    flex-shrink: 0;
  }

  .hub-storage-button-badge {
    padding: 0.22rem 0.56rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 90%, rgba(248, 243, 239, 0.96));
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 88%, rgba(0, 0, 0, 0.03));
    color: var(--nb-text-soft, rgba(70, 70, 73, 0.8));
    font-size: 0.64rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  @media (max-width: 520px) {
    .hub-storage-button {
      width: 100%;
    }
  }
</style>