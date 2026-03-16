<script lang="ts">
  let {
    value = '',
    password = '',
    valueLabel = 'Secret',
    valueAriaLabel = 'Secret',
    valuePlaceholder = '',
    passwordLabel = 'Password (optional)',
    passwordAriaLabel = 'Optional password',
    passwordPlaceholder = 'optional',
    dense = false,
    onValueInput = undefined,
    onPasswordInput = undefined,
  } = $props<{
    value: string;
    password: string;
    valueLabel?: string;
    valueAriaLabel?: string;
    valuePlaceholder?: string;
    passwordLabel?: string;
    passwordAriaLabel?: string;
    passwordPlaceholder?: string;
    dense?: boolean;
    onValueInput?: ((value: string) => void) | undefined;
    onPasswordInput?: ((value: string) => void) | undefined;
  }>();
</script>

<div class="secret-seed-fields" class:dense>
  <label>
    <span>{valueLabel}</span>
    <input
      type="text"
      value={value}
      aria-label={valueAriaLabel}
      placeholder={valuePlaceholder}
      oninput={(event) => onValueInput?.((event.currentTarget as HTMLInputElement).value)}
    />
  </label>
  <label>
    <span>{passwordLabel}</span>
    <input
      type="password"
      value={password}
      aria-label={passwordAriaLabel}
      placeholder={passwordPlaceholder}
      autocomplete="current-password"
      oninput={(event) => onPasswordInput?.((event.currentTarget as HTMLInputElement).value)}
    />
  </label>
</div>

<style>
  .secret-seed-fields {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(168px, 0.48fr);
    gap: 0.72rem;
  }

  .secret-seed-fields label {
    min-width: 0;
    display: grid;
    gap: 0.38rem;
  }

  .secret-seed-fields span {
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--nb-text-faint, rgba(186, 230, 253, 0.68));
  }

  .secret-seed-fields input {
    min-width: 0;
  }

  .secret-seed-fields.dense {
    grid-template-columns: minmax(0, 1.35fr) minmax(140px, 0.72fr);
    gap: 0.5rem;
  }

  .secret-seed-fields.dense span {
    font-size: 0.64rem;
    letter-spacing: 0.06em;
  }

  .secret-seed-fields.dense label {
    gap: 0.24rem;
  }

  @media (max-width: 760px) {
    .secret-seed-fields {
      grid-template-columns: 1fr;
    }
  }
</style>
