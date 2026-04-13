<script lang="ts">
  import ProviderStatusCard from '../components/ProviderStatusCard.svelte';
  import UiButton from '../components/UiButton.svelte';
  import UiChip from '../components/UiChip.svelte';
  import UiDialog from '../components/UiDialog.svelte';
  import type { WorkspaceSurfaceProps } from '../state/types.js';

  interface $$Props extends WorkspaceSurfaceProps {}

  let { ui, data, capabilities, handlers }: $$Props = $props();
</script>

<UiDialog title="Storage" onClose={() => handlers?.onAction?.({ type: 'close-overlay' })}>
  {#snippet body()}
    <div class="storage-grid">
      <div class="provider-overview-grid">
        {#each data.providerShares as share}
          <ProviderStatusCard
            title={`${share.provider} • ${share.title}`}
            detail={share.detail}
            tone={share.status === 'attention' ? 'warn' : share.status === 'healthy' ? 'good' : 'muted'}
            progressPercent={share.progressPercent}
            progressLabel={share.progressLabel}
            showProgress={share.progressPercent !== 100}
          />
        {/each}
      </div>

      {#each data.storageLocations as location}
        <div class="storage-row">
          <div class="storage-copy">
            <strong>{location.label}</strong>
            <p>{location.provider} • {location.pathLabel}</p>
            <p>{location.usageLabel} • {location.reserveLabel}</p>
          </div>
          <div class="storage-meta">
            <UiChip label={location.mode} tone={location.mode === 'read-only' ? 'warning' : 'success'} />
            <UiChip label={location.status} tone={location.status === 'attention' ? 'warning' : location.status === 'watching' ? 'accent' : 'success'} />
          </div>
        </div>
      {/each}
      <div class="storage-actions">
        <UiButton label="Per-hub storage" tone="secondary" onClick={() => handlers?.onAction?.({ type: 'open-overlay', overlay: 'hub-storage' })} />
      </div>
    </div>
  {/snippet}
</UiDialog>

<style>
  .storage-grid {
    display: grid;
    gap: 0.8rem;
  }

  .provider-overview-grid {
    display: grid;
    gap: 0.75rem;
    grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
  }

  .storage-row {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    align-items: center;
    border-radius: 18px;
    border: 1px solid var(--nb-border);
    padding: 0.82rem 0.9rem;
  }

  .storage-copy,
  .storage-meta {
    display: grid;
    gap: 0.24rem;
  }

  .storage-row p {
    margin: 0.2rem 0 0;
    color: var(--nb-text-soft);
    font-size: 0.82rem;
  }

  .storage-meta {
    justify-items: end;
  }

  .storage-actions {
    display: flex;
    justify-content: flex-end;
  }
</style>
