<script lang="ts">
  import UiButton from '../components/UiButton.svelte';
  import UiDialog from '../components/UiDialog.svelte';
  import PeerRow from '../components/PeerRow.svelte';
  import type { WorkspaceSurfaceProps } from '../state/types.js';

  let { data, capabilities, handlers } = $props<WorkspaceSurfaceProps>();
</script>

<UiDialog title="Sources and integrations" eyebrow="Panel" detail="Provider, LAN, and discovery surfaces stay visible even when runtime support is gated." onClose={() => handlers?.onAction?.({ type: 'close-overlay' })}>
  {#snippet body()}
    <div class="sources-grid">
      <div class="sources-actions">
        <UiButton label="Discover sources" tone="secondary" />
        <UiButton label="Storage routing" tone="secondary" onClick={() => handlers?.onAction?.({ type: 'open-overlay', overlay: 'storage' })} />
      </div>
      <div class="capability-copy">
        Providers: {capabilities?.providers ? 'available' : 'gated'} · Desktop helpers: {capabilities?.desktopHelpers ? 'available' : 'gated'}
      </div>
      {#each data.peers as peer}
        <PeerRow peer={peer} onSelect={() => handlers?.onAction?.({ type: 'select-peer', peerId: peer.id })} />
      {/each}
    </div>
  {/snippet}
</UiDialog>

<style>
  .sources-grid {
    display: grid;
    gap: 0.8rem;
  }

  .sources-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
  }

  .capability-copy {
    color: var(--nb-text-soft);
    font-size: 0.82rem;
  }
</style>
