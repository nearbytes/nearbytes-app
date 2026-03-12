<script lang="ts">
  const { dragging = false } = $props<{
    dragging?: boolean;
  }>();
</script>

<div class="mount-rail" class:dragging>
  <div class="mount-rail-track">
    <slot />
  </div>
  <div class="mount-rail-actions">
    <slot name="actions" />
  </div>
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
