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
    border-radius: 999px;
    font: inherit;
    font-size: 0.86rem;
    padding: 0.72rem 1rem;
    transition:
      transform 140ms ease,
      border-color 140ms ease,
      background 140ms ease;
    cursor: pointer;
  }

  .ui-button:hover:not(:disabled) {
    transform: translateY(-1px);
    border-color: var(--nb-accent);
  }

  .ui-button.primary {
    background: var(--nb-accent);
    color: #fff;
    border-color: transparent;
  }

  .ui-button.secondary {
    background: color-mix(in srgb, var(--nb-surface-strong) 88%, var(--nb-accent-soft));
  }

  .ui-button.danger {
    background: color-mix(in srgb, var(--nb-danger) 14%, var(--nb-surface-strong));
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
