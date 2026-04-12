<script lang="ts">
  import UiDialog from '../components/UiDialog.svelte';
  import type { WorkspaceSurfaceProps } from '../state/types.js';

  let { ui, data, handlers } = $props<WorkspaceSurfaceProps>();

  const selectedEvent = $derived(
    data.events.find((event) => event.id === ui.selectedEventId) ?? data.events[0] ?? null
  );
</script>

<UiDialog title="Event flow" eyebrow="Panel" detail="Protocol-level state, references, and lineage all render without backend-coupled semantics." onClose={() => handlers?.onAction?.({ type: 'close-overlay' })}>
  {#snippet body()}
    <div class="event-flow-grid">
      {#if selectedEvent}
        <strong>{selectedEvent.title}</strong>
        <p>{selectedEvent.summary}</p>
        <ul>
          <li>Source object acknowledged</li>
          <li>Encrypted block linked</li>
          <li>Projection visible in current hub shell</li>
        </ul>
      {/if}
    </div>
  {/snippet}
</UiDialog>

<style>
  .event-flow-grid {
    display: grid;
    gap: 0.6rem;
  }

  p,
  ul {
    margin: 0;
    color: var(--nb-text-soft);
    font-size: 0.86rem;
    line-height: 1.45;
  }

  ul {
    padding-left: 1.15rem;
  }
</style>
