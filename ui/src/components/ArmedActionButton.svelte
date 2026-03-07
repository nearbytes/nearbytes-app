<script lang="ts">
  let {
    text,
    armed = false,
    armDelayMs = 1000,
    autoDisarmMs = 3000,
    disabled = false,
    title = '',
    ariaLabel = '',
    ariaHasPopup,
    ariaExpanded,
    resetKey = null,
    keepTextWhenArmed = false,
    class: className = '',
    onPress,
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
    class?: string;
    onPress?: () => void;
  } = $props();

  let isArmedState = $state(false);
  let confirmReady = $state(false);
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
    isArmedState = false;
    confirmReady = false;
    clearTimers();
  }

  function arm() {
    isArmedState = true;
    confirmReady = false;
    clearTimers();
    readyTimer = setTimeout(() => {
      if (isArmedState) {
        confirmReady = true;
      }
    }, armDelayMs);
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

  const computedDisabled = $derived.by(() => disabled || (armed && isArmedState && !confirmReady));

  $effect(() => {
    resetKey;
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
  {buttonLabel}
</button>
