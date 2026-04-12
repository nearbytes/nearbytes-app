<script lang="ts">
  import UiButton from '../components/UiButton.svelte';
  import UiCard from '../components/UiCard.svelte';
  import EventRow from '../components/EventRow.svelte';
  import type { WorkspaceSurfaceProps } from '../state/types.js';

  let { ui, data, handlers } = $props<WorkspaceSurfaceProps>();
</script>

<UiCard
  eyebrow="Timeline"
  title="Event detail and protocol trace"
  detail="A structural panel for browsing event sequences and jumping into event-flow inspection."
>
  {#snippet actions()}
    <UiButton label="Inspect flow" tone="secondary" onClick={() => handlers?.onAction?.({ type: 'open-overlay', overlay: 'event-flow' })} />
  {/snippet}

  {#snippet body()}
    <div class="timeline-pane-body">
      {#each data.events as event}
        <EventRow
          event={event}
          active={ui.selectedEventId === event.id}
          onSelect={() => handlers?.onAction?.({ type: 'select-event', eventId: event.id })}
        />
      {/each}
    </div>
  {/snippet}
</UiCard>

<style>
  .timeline-pane-body {
    display: grid;
    gap: 0.7rem;
  }
</style>
