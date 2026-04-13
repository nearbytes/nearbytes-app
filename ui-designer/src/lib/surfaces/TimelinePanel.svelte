<script lang="ts">
  import { Eye, Workflow } from 'lucide-svelte';
  import EventRow from '../components/EventRow.svelte';
  import type { WorkspaceSurfaceProps } from '../state/types.js';

  interface $$Props extends WorkspaceSurfaceProps {}

  let { ui, data, capabilities, handlers }: $$Props = $props();

  const selectedEvent = $derived(
    data.events.find((event) => event.id === ui.selectedEventId) ?? data.events[0] ?? null
  );
</script>

<section class="timeline-pane nb-panel-surface">
  <header class="timeline-pane-header">
    <div>
      <h3>Recent event stream</h3>
      <p>Inspect timeline payloads, transport states, and protocol consequences.</p>
    </div>
    <div class="timeline-actions">
      <button type="button" class="timeline-icon" aria-label="Inspect selected event" onclick={() => handlers?.onAction?.({ type: 'open-overlay', overlay: 'timeline-detail' })}>
        <Eye size={16} />
      </button>
      <button type="button" class="timeline-icon" aria-label="Inspect event flow" onclick={() => handlers?.onAction?.({ type: 'open-overlay', overlay: 'event-flow' })}>
        <Workflow size={16} />
      </button>
    </div>
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

  {#if selectedEvent}
    <footer class="timeline-footer">
      <span class="timeline-footer-label">Selected</span>
      <strong>{selectedEvent.title}</strong>
      <p>{selectedEvent.transport}</p>
    </footer>
  {/if}
</section>

<style>
  .timeline-pane {
    min-height: 0;
    border-radius: var(--nb-radius-panel);
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

  .timeline-pane-header h3 {
    margin: 0;
  }

  .timeline-pane-header p {
    margin: 0.3rem 0 0;
    color: var(--nb-text-soft);
    font-size: 0.8rem;
  }

  .timeline-actions {
    display: flex;
    gap: 0.45rem;
  }

  .timeline-pane-header h3 {
    font-size: 1rem;
  }

  .timeline-icon {
    width: 2.2rem;
    height: 2.2rem;
    display: grid;
    place-items: center;
    border-radius: var(--nb-radius-control);
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

  .timeline-footer {
    padding-top: 0.2rem;
    border-top: 1px solid color-mix(in srgb, var(--nb-border) 70%, transparent);
    display: grid;
    gap: 0.2rem;
  }

  .timeline-footer strong,
  .timeline-footer p {
    margin: 0;
  }

  .timeline-footer-label {
    color: var(--nb-accent-strong);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 0.68rem;
  }

  .timeline-footer p {
    color: var(--nb-text-soft);
    font-size: 0.78rem;
  }
</style>
