<script lang="ts">
  let {
    label,
    tone = 'neutral',
  } = $props<{
    label: string;
    tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
  }>();
</script>

<span class={`ui-chip ${tone}`}>{label}</span>

<style>
  .ui-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.32rem 0.6rem;
    border-radius: 999px;
    font-size: 0.74rem;
    border: 1px solid var(--nb-border);
    background: color-mix(in srgb, var(--nb-surface-strong) 88%, var(--nb-accent-soft));
    color: var(--nb-text-soft);
  }

  .ui-chip.accent {
    color: var(--nb-accent-strong);
    background: var(--nb-accent-soft);
  }

  .ui-chip.success {
    color: var(--nb-success);
  }

  .ui-chip.warning {
    color: var(--nb-warning);
  }

  .ui-chip.danger {
    color: var(--nb-danger);
  }
</style>
