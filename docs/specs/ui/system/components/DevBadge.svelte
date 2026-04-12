<script lang="ts">
  import { getDevContext } from '../dev.js';

  const dev = getDevContext();
  const isRuntimeDev = import.meta.env.DEV;
  let menuOpen = $state(false);

  function toggle(): void {
    dev.update((value) => !value);
  }

  function buildUrl(target: 'app' | 'desktop' | 'phone' | 'graph'): string {
    const url = new URL(window.location.href);
    if (target === 'app') {
      url.searchParams.delete('design');
      url.hash = '';
      return url.toString();
    }
    url.searchParams.set('design', target);
    return url.toString();
  }

  function openTarget(target: 'app' | 'desktop' | 'phone' | 'graph'): void {
    window.open(buildUrl(target), '_blank', 'noopener,noreferrer');
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
      <span>{$dev ? 'DEV' : 'DEV Off'}</span>
    </button>

    <button
      type="button"
      class="dev-badge-menu-toggle"
      class:active={menuOpen}
      aria-expanded={menuOpen}
      title="Open dev tools"
      onclick={() => {
        menuOpen = !menuOpen;
      }}
    >
      Studio
    </button>

    {#if menuOpen}
      <div class="dev-menu">
        <button type="button" class="dev-menu-btn" onclick={() => openTarget('app')}>App</button>
        <button type="button" class="dev-menu-btn" onclick={() => openTarget('desktop')}>Desktop</button>
        <button type="button" class="dev-menu-btn" onclick={() => openTarget('phone')}>Phone</button>
        <button type="button" class="dev-menu-btn" onclick={() => openTarget('graph')}>Graph</button>
      </div>
    {/if}
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

  .dev-badge,
  .dev-badge-menu-toggle {
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

  .dev-badge.inactive,
  .dev-badge-menu-toggle {
    border-color: rgba(15, 23, 42, 0.14);
    color: rgba(15, 23, 42, 0.62);
    background: rgba(255, 255, 255, 0.78);
  }

  .dev-badge-menu-toggle.active {
    border-color: rgba(153, 27, 27, 0.18);
    color: rgba(153, 27, 27, 0.78);
    background: rgba(255, 252, 252, 0.84);
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

  .dev-menu {
    position: absolute;
    right: 0;
    bottom: 34px;
    display: grid;
    gap: 0.3rem;
    min-width: 108px;
    padding: 0.35rem;
    border-radius: 14px;
    border: 1px solid rgba(15, 23, 42, 0.12);
    background: rgba(255, 255, 255, 0.9);
    box-shadow: 0 14px 28px rgba(15, 23, 42, 0.12);
    backdrop-filter: blur(10px);
  }

  .dev-menu-btn {
    min-height: 28px;
    padding: 0 0.55rem;
    border-radius: 999px;
    border: 1px solid rgba(15, 23, 42, 0.08);
    background: rgba(255, 255, 255, 0.82);
    color: rgba(15, 23, 42, 0.76);
    font: inherit;
    font-size: 0.66rem;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    cursor: pointer;
  }

  .dev-menu-btn:hover {
    border-color: rgba(153, 27, 27, 0.18);
    color: rgba(153, 27, 27, 0.78);
  }
</style>
