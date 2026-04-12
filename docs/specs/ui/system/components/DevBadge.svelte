<script lang="ts">
  import { getDevContext } from '../dev.js';

  const dev = getDevContext();
  const isRuntimeDev = import.meta.env.DEV;

  function toggle(): void {
    dev.update((value) => !value);
  }
</script>

{#if isRuntimeDev}
  <div class="dev-shell">
    <button
      type="button"
      class="dev-badge"
      class:inactive={!$dev}
      onclick={toggle}
      aria-pressed={$dev}
      title={$dev ? 'Disable design-system dev markers' : 'Enable design-system dev markers'}
    >
      <span class="dev-badge-dot"></span>
      <span>{$dev ? 'Design' : 'Design Off'}</span>
    </button>
  </div>
{/if}

<style>
  .dev-shell {
    position: fixed;
    right: 14px;
    bottom: 14px;
    z-index: 1000;
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }

  .dev-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.38rem;
    min-height: 24px;
    padding: 0 0.52rem;
    border-radius: 999px;
    border: 1px solid rgba(153, 27, 27, 0.18);
    background: rgba(255, 252, 252, 0.74);
    color: rgba(153, 27, 27, 0.78);
    font: inherit;
    font-size: 0.62rem;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    box-shadow: 0 6px 14px rgba(15, 23, 42, 0.06);
    cursor: pointer;
    backdrop-filter: blur(6px);
  }

  .dev-badge.inactive {
    border-color: rgba(15, 23, 42, 0.14);
    color: rgba(15, 23, 42, 0.62);
    background: rgba(255, 255, 255, 0.72);
  }

  .dev-badge-dot {
    width: 5px;
    height: 5px;
    border-radius: 999px;
    background: currentColor;
  }

  .dev-badge:hover {
    transform: translateY(-1px);
  }
</style>
