<script lang="ts">
  import { getDevContext } from '../dev.js';

  const dev = getDevContext();
  const isRuntimeDev = import.meta.env.DEV;

  function toggle(): void {
    dev.update((value) => !value);
  }
</script>

{#if isRuntimeDev}
  <button
    type="button"
    class="dev-badge"
    class:inactive={!$dev}
    onclick={toggle}
    aria-pressed={$dev}
    title={$dev ? 'Disable design-system dev markers' : 'Enable design-system dev markers'}
  >
    <span class="dev-badge-dot"></span>
    <span>{$dev ? 'DEV On' : 'DEV Off'}</span>
  </button>
{/if}

<style>
  .dev-badge {
    position: fixed;
    right: 14px;
    bottom: 14px;
    z-index: 1000;
    display: inline-flex;
    align-items: center;
    gap: 0.38rem;
    min-height: 26px;
    padding: 0 0.58rem;
    border-radius: 999px;
    border: 1px solid rgba(153, 27, 27, 0.18);
    background: rgba(255, 252, 252, 0.84);
    color: rgba(153, 27, 27, 0.78);
    font: inherit;
    font-size: 0.66rem;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    box-shadow: 0 8px 18px rgba(15, 23, 42, 0.08);
    cursor: pointer;
    backdrop-filter: blur(8px);
  }

  .dev-badge.inactive {
    border-color: rgba(15, 23, 42, 0.14);
    color: rgba(15, 23, 42, 0.62);
    background: rgba(255, 255, 255, 0.78);
  }

  .dev-badge-dot {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: currentColor;
  }

  .dev-badge:hover {
    transform: translateY(-1px);
  }
</style>
