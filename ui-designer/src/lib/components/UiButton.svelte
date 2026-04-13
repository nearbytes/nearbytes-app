<script lang="ts">
  let {
    label,
    tone = 'primary',
    quiet = false,
    disabled = false,
    onClick,
    type = 'button',
  } = $props<{
    label: string;
    tone?: 'primary' | 'secondary' | 'danger';
    quiet?: boolean;
    disabled?: boolean;
    type?: 'button' | 'submit';
    onClick?: (() => void) | undefined;
  }>();
</script>

<button class={`ui-button ${tone} ${quiet ? 'quiet' : ''}`.trim()} {disabled} {type} onclick={onClick}>
  {label}
</button>

<style>
  .ui-button {
    border: 1px solid var(--nb-border-strong);
    background: var(--nb-surface-strong);
    color: var(--nb-text);
    border-radius: var(--nb-radius-control);
    font: inherit;
    font-size: 0.86rem;
    font-weight: 520;
    padding: 0.66rem 0.92rem;
    transition:
      border-color 140ms ease,
      background 140ms ease,
      color 140ms ease;
    cursor: pointer;
  }

  .ui-button:hover:not(:disabled) {
    border-color: var(--nb-accent);
  }

  .ui-button.primary {
    background: color-mix(in srgb, var(--nb-accent) 14%, var(--nb-surface-strong));
    color: var(--nb-accent-strong);
    border-color: color-mix(in srgb, var(--nb-accent) 22%, var(--nb-border-strong));
  }

  .ui-button.secondary {
    background: var(--nb-surface-strong);
  }

  .ui-button.danger {
    background: color-mix(in srgb, var(--nb-danger) 8%, var(--nb-surface-strong));
    color: var(--nb-danger);
  }

  .ui-button.quiet {
    background: transparent;
  }

  .ui-button:disabled {
    opacity: 0.48;
    cursor: not-allowed;
  }
</style>
