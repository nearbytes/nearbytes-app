<script lang="ts">
  import { devSurface, getDevContext } from '../dev.js';
  import type { WorkspaceChromeActions, WorkspaceChromeState } from '../workspaceChrome.js';

  let {
    menuElement = $bindable<HTMLElement | null>(null),
    state,
    actions,
  }: {
    menuElement?: HTMLElement | null;
    state: WorkspaceChromeState;
    actions: WorkspaceChromeActions;
  } = $props();
  const dev = getDevContext();

  function handleAction(value: Parameters<WorkspaceChromeActions['overflowAction']>[0]): void {
    actions.overflowAction(value);
  }
</script>

<div class="phone-overflow-menu panel-surface" bind:this={menuElement} use:devSurface={{ enabled: $dev, name: 'PhoneOverflowMenu' }}>
  <div class="phone-overflow-grid">
    {#if state.showFilesWorkspace}
      <button type="button" class="phone-overflow-btn" onclick={() => handleAction('search')}>
        {state.showSearchWorkspace ? 'Hide search' : 'Search'}
      </button>
    {/if}
    <button type="button" class="phone-overflow-btn" onclick={() => handleAction('storage')} disabled={state.storageDisabled}>
      {state.showVolumeStoragePanel ? 'Hide storage' : 'Storage'}
    </button>
    <button type="button" class="phone-overflow-btn" onclick={() => handleAction('share')}>
      Share
    </button>
    <button type="button" class="phone-overflow-btn" onclick={() => handleAction('timeline')}>
      {state.showTimeMachinePanel ? 'Hide timeline' : 'Timeline'}
    </button>
    <button type="button" class="phone-overflow-btn" onclick={() => handleAction('flow')}>
      {state.showEventFlowPanel ? 'Hide flow' : 'Flow'}
    </button>
    <button type="button" class="phone-overflow-btn" onclick={() => handleAction('identities')}>
      Identities
    </button>
    <button type="button" class="phone-overflow-btn" onclick={() => handleAction('locations')}>
      Locations
    </button>
    {#if state.showResetAction}
      <button type="button" class="phone-overflow-btn danger" onclick={() => handleAction('reset')}>
        Reset
      </button>
    {/if}
  </div>
</div>

<style>
  .phone-overflow-menu {
    min-width: min(18rem, 82vw);
    padding: 0.45rem;
    border-radius: var(--nb-radius-lg, 18px);
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(148, 163, 184, 0.24)) 90%, transparent);
    background: color-mix(in srgb, var(--nb-panel-bg, rgba(255, 255, 255, 0.96)) 96%, transparent);
    box-shadow: var(--nb-shadow-lg, 0 18px 44px rgba(15, 23, 42, 0.18));
    backdrop-filter: blur(var(--nb-surface-blur, 16px));
  }

  .phone-overflow-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.45rem;
  }

  .phone-overflow-btn {
    appearance: none;
    min-height: 42px;
    border-radius: var(--nb-radius-md, 14px);
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(148, 163, 184, 0.24)) 88%, transparent);
    background: color-mix(in srgb, var(--nb-panel-bg, rgba(255, 255, 255, 0.92)) 98%, transparent);
    color: var(--nb-text-main, rgba(15, 23, 42, 0.92));
    font: inherit;
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
    transition: transform var(--nb-motion-fast, 160ms) ease, border-color var(--nb-motion-fast, 160ms) ease, background-color var(--nb-motion-fast, 160ms) ease;
  }

  .phone-overflow-btn:hover {
    transform: translateY(-1px);
    border-color: color-mix(in srgb, var(--nb-accent, #0ea5e9) 24%, transparent);
    background: color-mix(in srgb, var(--nb-accent, #0ea5e9) 10%, white);
  }

  .phone-overflow-btn.danger {
    color: #a33b2f;
    border-color: rgba(163, 59, 47, 0.18);
    background: rgba(163, 59, 47, 0.08);
  }

  .phone-overflow-btn:disabled {
    cursor: not-allowed;
    opacity: 0.55;
    transform: none;
  }
</style>
