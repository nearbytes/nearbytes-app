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
    gap: 0.45rem;
    min-height: 30px;
    padding: 0 0.75rem;
    border-radius: 999px;
    border: 1px solid rgba(153, 27, 27, 0.28);
    background: rgba(255, 251, 251, 0.94);
    color: rgba(153, 27, 27, 0.92);
    font: inherit;
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    box-shadow: 0 10px 24px rgba(15, 23, 42, 0.12);
    cursor: pointer;
    backdrop-filter: blur(10px);
  }

  .dev-badge.inactive {
    border-color: rgba(15, 23, 42, 0.14);
    color: rgba(15, 23, 42, 0.72);
    background: rgba(255, 255, 255, 0.9);
  }

  .dev-badge-dot {
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: currentColor;
  }

  .dev-badge:hover {
    transform: translateY(-1px);
  }
</style>
