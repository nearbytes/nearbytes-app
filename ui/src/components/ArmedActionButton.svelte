<script lang="ts">
  let {
    text,
    armed = false,
    armDelayMs = 0,
    autoDisarmMs = 3000,
    disabled = false,
    title = '',
    ariaLabel = '',
    ariaHasPopup,
    ariaExpanded,
    resetKey = null,
    keepTextWhenArmed = false,
    icon = null,
    iconSize = 15,
    iconStrokeWidth = 2,
    class: className = '',
    onPress,
    onArmStateChange,
  }: {
    text: string;
    armed?: boolean;
    armDelayMs?: number;
    autoDisarmMs?: number;
    disabled?: boolean;
    title?: string;
    ariaLabel?: string;
    ariaHasPopup?: string;
    ariaExpanded?: boolean;
    resetKey?: string | number | null;
    keepTextWhenArmed?: boolean;
    icon?: any;
    iconSize?: number;
    iconStrokeWidth?: number;
    class?: string;
    onPress?: () => void;
    onArmStateChange?: (armed: boolean) => void;
  } = $props();

  let isArmedState = $state(false);
  let confirmReady = $state(false);
  let lastResetKey = $state<string | number | null | undefined>(undefined);
  let readyTimer: ReturnType<typeof setTimeout> | null = null;
  let disarmTimer: ReturnType<typeof setTimeout> | null = null;

  function clearTimers() {
    if (readyTimer) {
      clearTimeout(readyTimer);
      readyTimer = null;
    }
    if (disarmTimer) {
      clearTimeout(disarmTimer);
      disarmTimer = null;
    }
  }

  function disarm() {
    const changed = isArmedState || confirmReady;
    isArmedState = false;
    confirmReady = false;
    clearTimers();
    if (changed) {
      onArmStateChange?.(false);
    }
  }

  function arm() {
    const changed = !isArmedState;
    isArmedState = true;
    confirmReady = armDelayMs <= 0;
    clearTimers();
    if (changed) {
      onArmStateChange?.(true);
    }
    if (armDelayMs > 0) {
      readyTimer = setTimeout(() => {
        if (isArmedState) {
          confirmReady = true;
        }
      }, armDelayMs);
    }
    disarmTimer = setTimeout(() => {
      if (isArmedState) {
        disarm();
      }
    }, autoDisarmMs);
  }

  function handleClick() {
    if (disabled) return;
    if (!armed) {
      onPress?.();
      return;
    }
    if (!isArmedState) {
      arm();
      return;
    }
    if (!confirmReady) {
      return;
    }
    onPress?.();
    disarm();
  }

  const buttonLabel = $derived.by(() => {
    if (!armed) return text;
    if (keepTextWhenArmed) return text;
    if (!isArmedState) return text;
    return confirmReady ? 'Confirm' : 'Confirm...';
  });

  const computedTitle = $derived.by(() => {
    if (!armed || !isArmedState) return title;
    return 'Click again to confirm';
  });

  const computedDisabled = $derived.by(() => disabled);

  $effect(() => {
    if (lastResetKey === undefined) {
      lastResetKey = resetKey;
      return;
    }
    if (lastResetKey === resetKey) {
      return;
    }
    lastResetKey = resetKey;
    disarm();
  });

  $effect(() => {
    if (!armed) {
      disarm();
    }
  });

  $effect(() => {
    return () => clearTimers();
  });
</script>

<button
  type="button"
  class={className}
  class:armed={armed && isArmedState}
  disabled={computedDisabled}
  title={computedTitle}
  aria-label={ariaLabel || text}
  aria-haspopup={ariaHasPopup}
  aria-expanded={ariaExpanded}
  onclick={handleClick}
>
  <span class="armed-button-content">
    {#if icon}
      <icon class="armed-button-icon" size={iconSize} strokeWidth={iconStrokeWidth}></icon>
    {/if}
    <span>{buttonLabel}</span>
  </span>
</button>

<style>
  .armed-button-content {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.45rem;
  }

  .armed-button-icon {
    flex: 0 0 auto;
  }
</style>
