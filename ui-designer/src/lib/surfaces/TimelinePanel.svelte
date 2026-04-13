<script lang="ts">
  import { Workflow } from 'lucide-svelte';
  import EventRow from '../components/EventRow.svelte';
  import type { WorkspaceSurfaceProps } from '../state/types.js';

  let { ui, data, handlers } = $props<WorkspaceSurfaceProps>();
</script>

<section class="timeline-pane nb-panel-surface">
  <header class="timeline-pane-header">
    <div>
      <p class="timeline-kicker">Timeline</p>
      <h3>Recent event stream</h3>
    </div>
    <button type="button" class="timeline-icon" aria-label="Inspect event flow" onclick={() => handlers?.onAction?.({ type: 'open-overlay', overlay: 'event-flow' })}>
      <Workflow size={16} />
    </button>
  </header>

  <div class="timeline-pane-body">
    {#each data.events as event}
      <EventRow
        event={event}
        active={ui.selectedEventId === event.id}
        onSelect={() => handlers?.onAction?.({ type: 'select-event', eventId: event.id })}
      />
    {/each}
  </div>
</section>

<style>
  .timeline-pane {
    min-height: 0;
    border-radius: 24px;
    padding: 0.9rem;
    display: grid;
    gap: 0.85rem;
    overflow: hidden;
  }

  .timeline-pane-header {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    align-items: start;
  }

  .timeline-kicker,
  .timeline-pane-header h3 {
    margin: 0;
  }

  .timeline-kicker {
    text-transform: uppercase;
    letter-spacing: 0.16em;
    font-size: 0.68rem;
    color: var(--nb-accent-strong);
  }

  .timeline-pane-header h3 {
    font-size: 1rem;
  }

  .timeline-icon {
    width: 2.2rem;
    height: 2.2rem;
    display: grid;
    place-items: center;
    border-radius: 999px;
    border: 1px solid var(--nb-border);
    background: transparent;
    color: var(--nb-text-soft);
  }

  .timeline-pane-body {
    display: grid;
    gap: 0.7rem;
    align-content: start;
    overflow: auto;
    min-height: 0;
  }
</style>
