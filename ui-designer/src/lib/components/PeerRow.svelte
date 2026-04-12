<script lang="ts">
  import type { PeerFixture } from '../state/types.js';
  import UiChip from './UiChip.svelte';

  let {
    peer,
    onSelect,
  } = $props<{
    peer: PeerFixture;
    onSelect?: (() => void) | undefined;
  }>();

  const tone = $derived(peer.status === 'limited' ? 'warning' : peer.status === 'syncing' ? 'accent' : 'success');
</script>

<button class="peer-row" type="button" onclick={onSelect}>
  <div>
    <strong>{peer.label}</strong>
    <p>{peer.medium} transport lane</p>
  </div>
  <UiChip label={peer.status} tone={tone} />
</button>

<style>
  .peer-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
    border-radius: 16px;
    border: 1px solid var(--nb-border);
    background: transparent;
    color: inherit;
    padding: 0.72rem 0.88rem;
    cursor: pointer;
    text-align: left;
  }

  .peer-row p {
    margin: 0.22rem 0 0;
    color: var(--nb-text-soft);
    font-size: 0.78rem;
  }
</style>
