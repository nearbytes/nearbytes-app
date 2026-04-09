<script lang="ts">
  let {
    menuElement = $bindable<HTMLElement | null>(null),
    showFilesWorkspace = false,
    showSearchWorkspace = false,
    showVolumeStoragePanel = false,
    showTimeMachinePanel = false,
    showEventFlowPanel = false,
    storageDisabled = false,
    showResetAction = false,
    onAction,
  }: {
    menuElement?: HTMLElement | null;
    showFilesWorkspace?: boolean;
    showSearchWorkspace?: boolean;
    showVolumeStoragePanel?: boolean;
    showTimeMachinePanel?: boolean;
    showEventFlowPanel?: boolean;
    storageDisabled?: boolean;
    showResetAction?: boolean;
    onAction?: (value: string) => void;
  } = $props();

  function handleAction(value: string): void {
    onAction?.(value);
  }
</script>

<div class="phone-overflow-menu panel-surface" bind:this={menuElement}>
  <div class="phone-overflow-grid">
    {#if showFilesWorkspace}
      <button type="button" class="phone-overflow-btn" onclick={() => handleAction('search')}>
        {showSearchWorkspace ? 'Hide search' : 'Search'}
      </button>
    {/if}
    <button type="button" class="phone-overflow-btn" onclick={() => handleAction('storage')} disabled={storageDisabled}>
      {showVolumeStoragePanel ? 'Hide storage' : 'Storage'}
    </button>
    <button type="button" class="phone-overflow-btn" onclick={() => handleAction('share')}>
      Share
    </button>
    <button type="button" class="phone-overflow-btn" onclick={() => handleAction('timeline')}>
      {showTimeMachinePanel ? 'Hide timeline' : 'Timeline'}
    </button>
    <button type="button" class="phone-overflow-btn" onclick={() => handleAction('flow')}>
      {showEventFlowPanel ? 'Hide flow' : 'Flow'}
    </button>
    <button type="button" class="phone-overflow-btn" onclick={() => handleAction('identities')}>
      Identities
    </button>
    <button type="button" class="phone-overflow-btn" onclick={() => handleAction('locations')}>
      Locations
    </button>
    {#if showResetAction}
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
    border-radius: 18px;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(148, 163, 184, 0.24)) 90%, transparent);
    background: color-mix(in srgb, var(--nb-panel-bg, rgba(255, 255, 255, 0.96)) 96%, transparent);
    box-shadow: 0 18px 44px rgba(15, 23, 42, 0.18);
    backdrop-filter: blur(16px);
  }

  .phone-overflow-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.45rem;
  }

  .phone-overflow-btn {
    appearance: none;
    min-height: 42px;
    border-radius: 14px;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(148, 163, 184, 0.24)) 88%, transparent);
    background: color-mix(in srgb, var(--nb-panel-bg, rgba(255, 255, 255, 0.92)) 98%, transparent);
    color: var(--nb-text-main, rgba(15, 23, 42, 0.92));
    font: inherit;
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
    transition: transform 0.16s ease, border-color 0.16s ease, background-color 0.16s ease;
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