<script lang="ts">
  import UiButton from '../components/UiButton.svelte';
  import UiChip from '../components/UiChip.svelte';
  import UiDialog from '../components/UiDialog.svelte';
  import type { DesignerFixtures } from '../state/types.js';

  let {
    data,
    onClose,
  } = $props<{
    data: DesignerFixtures;
    onClose?: (() => void) | undefined;
  }>();
</script>

<UiDialog title="Identity manager" {onClose}>
  {#snippet body()}
    <div class="identity-list">
      {#each data.identities as identity}
        <div class="identity-row">
          <div>
            <strong>{identity.displayName}</strong>
            <p>{identity.summary}</p>
          </div>
          <UiChip label={identity.status} tone={identity.status === 'draft' ? 'warning' : 'accent'} />
        </div>
      {/each}
      <div class="identity-actions">
        <UiButton label="Draft new identity" tone="secondary" />
        <UiButton label="Publish selected" />
      </div>
    </div>
  {/snippet}
</UiDialog>

<style>
  .identity-list {
    display: grid;
    gap: 0.8rem;
  }

  .identity-row {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    align-items: center;
    padding: 0.8rem 0.9rem;
    border-radius: 18px;
    border: 1px solid var(--nb-border);
  }

  .identity-row p {
    margin: 0.22rem 0 0;
    color: var(--nb-text-soft);
    font-size: 0.82rem;
  }

  .identity-actions {
    display: flex;
    gap: 0.7rem;
    justify-content: flex-end;
  }
</style>
