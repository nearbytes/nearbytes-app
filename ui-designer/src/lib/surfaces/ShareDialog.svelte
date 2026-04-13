<script lang="ts">
  import ProviderStatusCard from '../components/ProviderStatusCard.svelte';
  import ShareCard from '../components/ShareCard.svelte';
  import UiButton from '../components/UiButton.svelte';
  import UiChip from '../components/UiChip.svelte';
  import UiDialog from '../components/UiDialog.svelte';
  import type { WorkspaceSurfaceProps } from '../state/types.js';

  interface $$Props extends WorkspaceSurfaceProps {}

  let { ui, data, capabilities, handlers }: $$Props = $props();
</script>

<UiDialog
  title="Share hub"
  eyebrow="Distribution"
  onClose={() => handlers?.onAction?.({ type: 'close-overlay' })}
>
  {#snippet body()}
    <div class="share-dialog-grid">
      <div class="share-copy">
        <UiChip label="Link only" tone="accent" />
        <UiChip label="Secret bundle" tone="neutral" />
        <UiChip label={`${data.providerShares.length} provider lanes`} tone="success" />
      </div>
      <div class="share-actions">
        <UiButton label="Copy link" />
        <UiButton label="Copy secret" tone="secondary" />
      </div>

      <div class="share-provider-grid">
        {#each data.providerShares as share}
          <ProviderStatusCard
            title={`${share.provider} • ${share.shareCountLabel}`}
            detail={share.progressLabel}
            tone={share.status === 'attention' ? 'warn' : share.status === 'healthy' ? 'good' : 'muted'}
            progressPercent={share.progressPercent}
            progressLabel={share.progressLabel}
            showProgress={share.progressPercent !== null && share.progressPercent < 100}
          />
        {/each}
      </div>

      <div class="share-lane-grid">
        {#each data.providerShares as share}
          <ShareCard
            title={share.title}
            copy={share.detail}
            statusBadges={[
              { label: share.provider, tone: 'durable' },
              { label: share.access, tone: share.access === 'read-only' ? 'warn' : 'good' },
              { label: share.status, tone: share.status === 'attention' ? 'warn' : share.status === 'healthy' ? 'good' : 'muted' },
            ]}
            meta={[share.locationLabel, share.shareCountLabel]}
          >
            {#snippet body()}
              <div class="share-attachments">
                {#each share.attachments as attachment}
                  <span>{attachment}</span>
                {/each}
              </div>
            {/snippet}
          </ShareCard>
        {/each}
      </div>
    </div>
  {/snippet}
</UiDialog>

<style>
  .share-dialog-grid {
    display: grid;
    gap: 0.95rem;
  }

  .share-copy,
  .share-actions {
    display: flex;
    gap: 0.65rem;
    flex-wrap: wrap;
  }

  .share-provider-grid,
  .share-lane-grid {
    display: grid;
    gap: 0.75rem;
    grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
  }

  .share-attachments {
    display: flex;
    gap: 0.45rem;
    flex-wrap: wrap;
  }

  .share-attachments span {
    padding: 0.32rem 0.6rem;
    border-radius: 999px;
    border: 1px solid var(--nb-border);
    color: var(--nb-text-soft);
    font-size: 0.72rem;
  }
</style>
