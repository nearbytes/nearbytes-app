<script lang="ts">
  import type { Snippet } from 'svelte';
  import { devSurface, getDevContext } from '../dev.js';

  const {
    dragging = false,
    children,
    actions,
  } = $props<{
    dragging?: boolean;
    children?: Snippet;
    actions?: Snippet;
  }>();
  const dev = getDevContext();
</script>

<div class="mount-rail" class:dragging use:devSurface={{ enabled: $dev, name: 'MountRail' }}>
  <div class="mount-rail-track">
    {@render children?.()}
  </div>
  {#if actions}
    <div class="mount-rail-actions">
      {@render actions?.()}
    </div>
  {/if}
</div>

<style>
  .mount-rail {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    width: 100%;
    min-width: 0;
  }

  .mount-rail-track {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    flex: 1 1 auto;
    min-width: 0;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    scrollbar-width: thin;
    scrollbar-gutter: stable;
    padding-bottom: 0.12rem;
  }

  .mount-rail-actions {
    display: inline-flex;
    align-items: center;
    gap: 0.38rem;
    flex: 0 0 auto;
  }

  .mount-rail.dragging {
    cursor: grabbing;
  }

  .mount-rail.dragging :global(.volume-chip-select),
  .mount-rail.dragging :global(.volume-chip-config-btn) {
    pointer-events: none;
  }

  .mount-rail.dragging :global(.volume-chip.drag-armed .volume-chip-select),
  .mount-rail.dragging :global(.volume-chip.dragging .volume-chip-select) {
    pointer-events: auto;
  }
</style>
