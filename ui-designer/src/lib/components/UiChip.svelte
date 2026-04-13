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
    padding: 0.28rem 0.56rem;
    border-radius: var(--nb-radius-control);
    font-size: 0.74rem;
    border: 1px solid var(--nb-border);
    background: var(--nb-surface-strong);
    color: var(--nb-text-soft);
  }

  .ui-chip.accent {
    color: var(--nb-accent-strong);
    background: color-mix(in srgb, var(--nb-accent) 10%, var(--nb-surface-strong));
    border-color: color-mix(in srgb, var(--nb-accent) 18%, var(--nb-border));
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
