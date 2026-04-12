<script lang="ts">
  import AppDialog from './AppDialog.svelte';
  import StatusNotice from './StatusNotice.svelte';

  let {
    deleteLocalData = false,
    busy = false,
    errorMessage = '',
    onDeleteLocalDataChange = undefined,
    onCancel = undefined,
    onConfirm = undefined,
  } = $props<{
    deleteLocalData?: boolean;
    busy?: boolean;
    errorMessage?: string;
    onDeleteLocalDataChange?: ((value: boolean) => void) | undefined;
    onCancel?: (() => void) | undefined;
    onConfirm?: (() => void | Promise<void>) | undefined;
  }>();
</script>

<AppDialog
  ariaLabel="Reset Nearbytes data"
  eyebrow="Reset"
  title="Clear stored configuration"
  width="medium"
  closeLabel="Close reset dialog"
  closeDisabled={busy}
  onClose={onCancel}
>
  {#snippet body()}
    <section class="reset-dialog-section">
      <div class="reset-warning-card">
        <p class="reset-warning-title">Safe start-from-scratch helper</p>
      </div>

      <label class="reset-checkbox-row">
        <input
          type="checkbox"
          checked={deleteLocalData}
          disabled={busy}
          onchange={(event) => onDeleteLocalDataChange?.((event.currentTarget as HTMLInputElement).checked)}
        />
        <span>
          <strong>Also delete local blocks and channels</strong>
        </span>
      </label>

      {#if errorMessage}
        <StatusNotice tone="error" role="alert" compact={true} message={errorMessage} />
      {/if}

      <div class="theme-dialog-actions">
        <button type="button" class="status-link-btn secondary" onclick={() => onCancel?.()} disabled={busy}>Cancel</button>
        <button type="button" class="status-link-btn danger" onclick={() => void onConfirm?.()} disabled={busy}>
          {busy ? 'Resetting...' : 'Reset and restart'}
        </button>
      </div>
    </section>
  {/snippet}
</AppDialog>

<style>
  .reset-dialog-section {
    display: grid;
    gap: 0.9rem;
  }

  .reset-warning-card {
    padding: 0.9rem 1rem;
    border-radius: 16px;
    border: 1px solid color-mix(in srgb, var(--nb-danger, #dc2626) 16%, var(--nb-border, rgba(60, 60, 67, 0.12)) 84%);
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 96%, rgba(255, 246, 244, 0.94));
  }

  .reset-warning-title {
    margin: 0;
    color: var(--nb-text-main, rgba(28, 28, 30, 0.94));
    font-weight: 700;
  }

  .reset-checkbox-row {
    display: flex;
    gap: 0.7rem;
    align-items: flex-start;
    color: var(--nb-text-soft, rgba(70, 70, 73, 0.84));
  }

  .theme-dialog-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    justify-content: flex-end;
  }

  .status-link-btn {
    appearance: none;
    border: 1px solid var(--nb-btn-border, rgba(56, 189, 248, 0.24));
    border-radius: 999px;
    background: var(--nb-btn-bg, rgba(12, 24, 43, 0.82));
    color: var(--nb-btn-color, rgba(226, 232, 240, 0.92));
    min-height: 34px;
    padding: 0 0.8rem;
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    cursor: pointer;
    font: inherit;
    font-size: 0.78rem;
    font-weight: 600;
  }

  .status-link-btn.secondary {
    background: var(--nb-btn-bg, rgba(8, 17, 31, 0.8));
  }

  .status-link-btn.danger {
    border-color: color-mix(in srgb, var(--nb-danger, #dc2626) 36%, transparent);
    background: color-mix(in srgb, var(--nb-danger, #dc2626) 76%, rgba(127, 29, 29, 0.92) 24%);
    color: #fff7f7;
  }
</style>