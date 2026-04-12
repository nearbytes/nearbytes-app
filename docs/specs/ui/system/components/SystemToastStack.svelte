<script lang="ts">
  import { Download, RefreshCw, Search, Settings2, X } from 'lucide-svelte';
  import { devSurface, getDevContext } from '../dev.js';
  import type { DesktopUpdaterState } from '../../../../../ui/src/lib/host/desktopBridge.js';

  type DiscoveryToastState = {
    runKey: string;
    message: string;
  };

  let {
    updaterState = null,
    discoveryToast = null,
    shouldShowUpdater = false,
    updaterProgressSummary,
    updaterPrimaryActionLabel,
    onPrimaryAction = undefined,
    onOpenRelease = undefined,
    onDismissUpdater = undefined,
    onOpenDiscoveryDetails = undefined,
    onOpenDiscoveryDefaults = undefined,
    onDismissDiscovery = undefined,
  } = $props<{
    updaterState?: DesktopUpdaterState | null;
    discoveryToast?: DiscoveryToastState | null;
    shouldShowUpdater?: boolean;
    updaterProgressSummary: (state: DesktopUpdaterState) => string;
    updaterPrimaryActionLabel: (state: DesktopUpdaterState) => string;
    onPrimaryAction?: (() => void | Promise<void>) | undefined;
    onOpenRelease?: (() => void | Promise<void>) | undefined;
    onDismissUpdater?: (() => void) | undefined;
    onOpenDiscoveryDetails?: (() => void) | undefined;
    onOpenDiscoveryDefaults?: (() => void) | undefined;
    onDismissDiscovery?: ((runKey: string) => void) | undefined;
  }>();
  const dev = getDevContext();
</script>

{#if shouldShowUpdater || discoveryToast}
  <div class="toast-stack" use:devSurface={{ enabled: $dev, name: 'SystemToastStack' }}>
    {#if shouldShowUpdater && updaterState}
      <aside class="update-toast panel-surface" role="status" aria-live="polite">
        <div class="update-toast-copy">
          <p class="update-toast-title">{updaterState.message}</p>
          <p>{updaterState.detail}</p>
        </div>
        {#if updaterState.phase === 'downloading'}
          <div class="update-toast-progress" aria-hidden="true">
            <span
              class="update-toast-progress-bar"
              style={`width: ${Math.max(0, Math.min(100, updaterState.progressPercent ?? 0))}%`}
            ></span>
          </div>
          <p class="update-toast-meta">{updaterProgressSummary(updaterState)}</p>
        {/if}
        {#if updaterState.phase === 'ready' || updaterState.phase === 'error'}
          <div class="update-toast-actions">
            {#if updaterState.phase === 'ready'}
              <button type="button" class="update-toast-btn" onclick={() => void onPrimaryAction?.()}>
                {#if updaterState.canInstall}
                  <RefreshCw class="button-icon" size={15} strokeWidth={2} />
                {:else}
                  <Download class="button-icon" size={15} strokeWidth={2} />
                {/if}
                <span>{updaterPrimaryActionLabel(updaterState)}</span>
              </button>
            {:else}
              <button type="button" class="update-toast-btn" onclick={() => void onOpenRelease?.()}>
                <Download class="button-icon" size={15} strokeWidth={2} />
                <span>Open release</span>
              </button>
            {/if}
          </div>
          <button
            type="button"
            class="discovery-toast-close"
            aria-label="Dismiss update notice"
            onclick={() => onDismissUpdater?.()}
          >
            <X size={15} strokeWidth={2} />
          </button>
        {/if}
      </aside>
    {/if}

    {#if discoveryToast}
      <aside class="discovery-toast panel-surface" role="status" aria-live="polite">
        <div class="discovery-toast-copy">
          <p class="discovery-toast-title">Storage locations updated</p>
          <p>{discoveryToast.message}</p>
        </div>
        <div class="discovery-toast-actions">
          <button type="button" class="discovery-toast-btn" onclick={() => onOpenDiscoveryDetails?.()}>
            <Search class="button-icon" size={15} strokeWidth={2} />
            <span>Details</span>
          </button>
          <button type="button" class="discovery-toast-btn" onclick={() => onOpenDiscoveryDefaults?.()}>
            <Settings2 class="button-icon" size={15} strokeWidth={2} />
            <span>Edit rules</span>
          </button>
        </div>
        <button
          type="button"
          class="discovery-toast-close"
          aria-label="Dismiss discovery notice"
          onclick={() => onDismissDiscovery?.(discoveryToast.runKey)}
        >
          <X size={15} strokeWidth={2} />
        </button>
      </aside>
    {/if}
  </div>
{/if}

<style>
  .toast-stack {
    position: fixed;
    right: 1.25rem;
    bottom: 1.25rem;
    z-index: 40;
    display: grid;
    gap: 0.85rem;
    width: min(420px, calc(100vw - 2rem));
  }

  .update-toast,
  .discovery-toast {
    width: min(420px, calc(100vw - 2rem));
    display: grid;
    gap: 0.9rem;
    padding: 0.95rem 1rem 1rem;
    border: 1px solid color-mix(in srgb, rgba(56, 189, 248, 0.22) 70%, transparent);
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 98%, var(--nb-shell-bottom, #f4f4f7));
    box-shadow:
      0 16px 40px rgba(2, 6, 23, 0.36),
      inset 0 1px 0 rgba(255, 255, 255, 0.03);
  }

  .update-toast {
    position: relative;
    border-color: rgba(96, 165, 250, 0.28);
  }

  .update-toast-copy,
  .discovery-toast-copy {
    display: grid;
    gap: 0.32rem;
    padding-right: 2rem;
  }

  .update-toast-copy p,
  .discovery-toast-copy p {
    margin: 0;
  }

  .update-toast-title,
  .discovery-toast-title {
    font-size: 0.84rem;
    font-weight: 700;
    color: var(--nb-text-main, rgba(236, 254, 255, 0.98));
  }

  .update-toast-copy :not(.update-toast-title),
  .discovery-toast-copy :not(.discovery-toast-title) {
    font-size: 0.79rem;
    line-height: 1.45;
    color: var(--nb-text-soft, rgba(191, 219, 254, 0.82));
  }

  .update-toast-progress {
    position: relative;
    width: 100%;
    height: 0.44rem;
    border-radius: 999px;
    overflow: hidden;
    background: var(--nb-panel-bg, rgba(30, 41, 59, 0.88));
  }

  .update-toast-progress-bar {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: color-mix(in srgb, var(--nb-accent, rgba(255, 59, 48, 1)) 28%, white);
    box-shadow: none;
  }

  .update-toast-meta {
    margin: -0.2rem 0 0;
    font-size: 0.74rem;
    color: var(--nb-text-soft, rgba(191, 219, 254, 0.72));
  }

  .update-toast-actions,
  .discovery-toast-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
  }

  .update-toast-btn,
  .discovery-toast-btn {
    appearance: none;
    border: 1px solid var(--nb-btn-border, rgba(56, 189, 248, 0.24));
    border-radius: 999px;
    background: var(--nb-btn-bg, rgba(12, 24, 43, 0.82));
    color: var(--nb-btn-color, rgba(226, 232, 240, 0.92));
    min-height: 34px;
    padding: 0 0.82rem;
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    cursor: pointer;
    font: inherit;
    font-size: 0.78rem;
    font-weight: 600;
    transition:
      background-color 0.18s ease,
      border-color 0.18s ease,
      color 0.18s ease;
  }

  .update-toast-btn:hover,
  .discovery-toast-btn:hover {
    background: var(--nb-btn-hover-bg, rgba(16, 32, 56, 0.96));
    border-color: var(--nb-btn-hover-border, rgba(96, 165, 250, 0.34));
  }

  .discovery-toast-close {
    position: absolute;
    top: 0.7rem;
    right: 0.72rem;
    appearance: none;
    border: 0;
    background: transparent;
    color: var(--nb-text-soft, rgba(191, 219, 254, 0.7));
    cursor: pointer;
    padding: 0.12rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: color 0.18s ease;
  }

  .discovery-toast-close:hover {
    color: var(--nb-text-main, rgba(236, 254, 255, 0.95));
  }

  @media (max-width: 900px) {
    .toast-stack {
      right: 1rem;
      bottom: 1rem;
      width: min(100%, calc(100vw - 1.5rem));
    }
  }
</style>
