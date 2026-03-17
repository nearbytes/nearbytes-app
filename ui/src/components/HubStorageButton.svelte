<script lang="ts">
  import { HardDrive } from 'lucide-svelte';

  let {
    active = false,
    disabled = false,
    badge = 'Hub',
    label = 'Storage locations',
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
    border: 1px solid var(--nb-btn-border, rgba(56, 189, 248, 0.24));
    background: var(--nb-btn-bg, rgba(12, 24, 43, 0.82));
    color: var(--nb-btn-color, rgba(226, 232, 240, 0.92));
    border-radius: 999px;
    padding: 0 0.72rem;
    min-height: 28px;
    min-width: 0;
    max-width: 100%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.46rem;
    font-family: var(--nb-font-body, 'SF Pro Text', 'Avenir Next', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif);
    font-size: 0.74rem;
    font-weight: 600;
    letter-spacing: 0.01em;
    line-height: 1;
    white-space: nowrap;
    cursor: pointer;
    transition: background-color 0.18s ease, border-color 0.18s ease, color 0.18s ease, box-shadow 0.18s ease;
  }

  .hub-storage-button:hover:not(:disabled) {
    background: var(--nb-btn-hover-bg, rgba(18, 34, 60, 0.94));
    border-color: var(--nb-btn-hover-border, rgba(96, 165, 250, 0.34));
    color: var(--nb-btn-hover-color, rgba(224, 242, 254, 0.96));
  }

  .hub-storage-button:focus-visible {
    outline: none;
    box-shadow: var(--nb-btn-focus-ring, inset 0 0 0 1px rgba(125, 211, 252, 0.18));
  }

  .hub-storage-button:disabled {
    opacity: 0.62;
    cursor: default;
  }

  .hub-storage-button.active {
    border-color: var(--nb-btn-active-border, rgba(34, 211, 238, 0.48));
    background: var(--nb-btn-active-bg, linear-gradient(180deg, rgba(16, 66, 91, 0.96), rgba(10, 44, 66, 0.96)));
    color: var(--nb-btn-active-color, #ecfeff);
    box-shadow: var(--nb-btn-active-shadow, 0 10px 24px rgba(6, 182, 212, 0.16));
  }

  .hub-storage-button-label,
  .hub-storage-button-badge {
    white-space: nowrap;
    flex-shrink: 0;
  }

  .hub-storage-button-badge {
    padding: 0.24rem 0.5rem;
    border-radius: 999px;
    background: color-mix(in srgb, currentColor 18%, transparent);
    font-size: 0.66rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  @media (max-width: 520px) {
    .hub-storage-button {
      width: 100%;
    }
  }
</style>