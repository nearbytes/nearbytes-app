<script lang="ts">
  import UiButton from '../components/UiButton.svelte';
  import UiDialog from '../components/UiDialog.svelte';

  let {
    onClose,
  } = $props<{
    onClose?: (() => void) | undefined;
  }>();

  const options = [
    ['Create hub', 'Start a brand-new shared space.'],
    ['Import handoff', 'Bring in a shared reference bundle.'],
    ['Join link', 'Paste or scan a join payload.'],
    ['Mirror workspace', 'Load a copied workspace snapshot.'],
  ];
</script>

<UiDialog title="Create" {onClose}>
  {#snippet body()}
    <div class="chooser-grid">
      {#each options as [title, detail]}
        <button class="chooser-card" type="button">
          <strong>{title}</strong>
          <span>{detail}</span>
        </button>
      {/each}
      <div class="chooser-actions">
        <UiButton label="Continue" />
      </div>
    </div>
  {/snippet}
</UiDialog>

<style>
  .chooser-grid {
    display: grid;
    gap: 0.8rem;
  }

  .chooser-card {
    display: grid;
    gap: 0.3rem;
    text-align: left;
    padding: 0.95rem;
    border-radius: 18px;
    border: 1px solid var(--nb-border);
    background: transparent;
    color: inherit;
  }

  .chooser-card span {
    color: var(--nb-text-soft);
    font-size: 0.84rem;
  }

  .chooser-actions {
    display: flex;
    justify-content: flex-end;
  }
</style>
