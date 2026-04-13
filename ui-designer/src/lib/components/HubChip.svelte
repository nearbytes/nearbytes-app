<script lang="ts">
  import type { HubFixture } from '../state/types.js';
  import UiChip from './UiChip.svelte';

  let {
    hub,
    active = false,
    onSelect,
  } = $props<{
    hub: HubFixture;
    active?: boolean;
    onSelect?: (() => void) | undefined;
  }>();
</script>

<button class:active class="hub-chip" type="button" onclick={onSelect}>
  <span class="hub-chip-label">{hub.label}</span>
  <div class="hub-chip-meta">
    <UiChip label={`${hub.members} peers`} tone="neutral" />
    {#if hub.unreadCount > 0}
      <UiChip label={`${hub.unreadCount} unread`} tone="accent" />
    {/if}
  </div>
</button>

<style>
  .hub-chip {
    min-width: 11rem;
    border-radius: var(--nb-radius-item);
    border: 1px solid var(--nb-border);
    background: color-mix(in srgb, var(--nb-surface-strong) 90%, var(--nb-accent-soft));
    padding: 0.8rem 0.9rem;
    display: grid;
    gap: 0.55rem;
    cursor: pointer;
    text-align: left;
  }

  .hub-chip.active {
    border-color: var(--nb-accent);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--nb-accent-soft) var(--nb-chrome-contrast-strong), transparent);
  }

  .hub-chip-label {
    font-weight: 600;
  }

  .hub-chip-meta {
    display: flex;
    gap: 0.45rem;
    flex-wrap: wrap;
  }
</style>
