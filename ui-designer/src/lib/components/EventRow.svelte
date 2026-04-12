<script lang="ts">
  import type { EventFixture } from '../state/types.js';
  import UiChip from './UiChip.svelte';

  let {
    event,
    active = false,
    onSelect,
  } = $props<{
    event: EventFixture;
    active?: boolean;
    onSelect?: (() => void) | undefined;
  }>();
</script>

<button class:active class="event-row" type="button" onclick={onSelect}>
  <div class="event-row-copy">
    <strong>{event.title}</strong>
    <span>{event.summary}</span>
  </div>
  <div class="event-row-meta">
    <UiChip label={event.eventType} tone="accent" />
    <span>{event.at}</span>
  </div>
</button>

<style>
  .event-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    width: 100%;
    border-radius: 18px;
    border: 1px solid var(--nb-border);
    background: transparent;
    color: inherit;
    padding: 0.8rem 0.9rem;
    cursor: pointer;
    text-align: left;
  }

  .event-row.active {
    background: var(--nb-accent-soft);
    border-color: var(--nb-accent);
  }

  .event-row-copy,
  .event-row-meta {
    display: grid;
    gap: 0.24rem;
  }

  .event-row-copy span,
  .event-row-meta span {
    color: var(--nb-text-soft);
    font-size: 0.8rem;
  }

  .event-row-meta {
    justify-items: end;
  }
</style>
