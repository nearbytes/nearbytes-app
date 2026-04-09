<script lang="ts">
  import type { Snippet } from 'svelte';
  import { HardDrive, Plus, Rows3, Trash2, UserRound } from 'lucide-svelte';
  import MountRail from '../../../../ui/src/components/MountRail.svelte';
  import NearbytesLogo from '../../../../ui/src/components/NearbytesLogo.svelte';
  import type { NearbytesLogoOptions } from '../../../../ui/src/lib/branding.js';
  import PhoneOverflowMenu from './PhoneOverflowMenu.svelte';
  import type { WorkspaceChromeActions, WorkspaceChromeState } from '../workspaceChrome.js';

  type MountOption = {
    id: string;
    label: string;
  };

  let {
    isDevThemeStudio = false,
    themeLogoOptions,
    paletteLabel = '',
    activeMountId = '',
    mounts = [],
    draggingMounts = false,
    isHeaderHovering = false,
    setHeaderHovering,
    isSecretDropTarget = false,
    canHandleSecretDropPayload,
    setSecretDropTarget,
    onSecretFileDrop,
    onSelectMount,
    onOpenThemeStudio,
    onOpenCreateChooser,
    showPhoneOverflowMenu = false,
    phoneOverflowMenuButtonElement = $bindable<HTMLElement | null>(null),
    phoneOverflowMenuElement = $bindable<HTMLElement | null>(null),
    showIdentityManager = false,
    showResetAction = false,
    showResetDialog = false,
    showSourcesPanel = false,
    onTogglePhoneOverflowMenu,
    onOpenIdentityManager,
    onOpenResetDialog,
    onToggleSourcesPanel,
    workspaceState,
    workspaceActions,
    mountRailChildren,
    mountRailActions,
  }: {
    isDevThemeStudio?: boolean;
    themeLogoOptions?: NearbytesLogoOptions;
    paletteLabel?: string;
    activeMountId?: string;
    mounts?: MountOption[];
    draggingMounts?: boolean;
    isHeaderHovering?: boolean;
    setHeaderHovering?: (value: boolean) => void;
    isSecretDropTarget?: boolean;
    canHandleSecretDropPayload?: (dataTransfer: DataTransfer | null) => boolean;
    setSecretDropTarget?: (value: boolean) => void;
    onSecretFileDrop?: (event: DragEvent) => void;
    onSelectMount?: (mountId: string) => void;
    onOpenThemeStudio?: () => void;
    onOpenCreateChooser?: () => void;
    showPhoneOverflowMenu?: boolean;
    phoneOverflowMenuButtonElement?: HTMLElement | null;
    phoneOverflowMenuElement?: HTMLElement | null;
    showIdentityManager?: boolean;
    showResetAction?: boolean;
    showResetDialog?: boolean;
    showSourcesPanel?: boolean;
    onTogglePhoneOverflowMenu?: () => void;
    onOpenIdentityManager?: () => void;
    onOpenResetDialog?: () => void;
    onToggleSourcesPanel?: () => void;
    workspaceState: WorkspaceChromeState;
    workspaceActions: WorkspaceChromeActions;
    mountRailChildren?: Snippet;
    mountRailActions?: Snippet;
  } = $props();
</script>

<header class="header">
  <div
    class="header-shell"
    class:secret-drop-target={isSecretDropTarget}
    role="group"
    aria-label="Hub controls"
    onmouseenter={() => setHeaderHovering?.(true)}
    onmouseleave={() => setHeaderHovering?.(false)}
    onfocusin={() => setHeaderHovering?.(true)}
    onfocusout={(event) => {
      const relatedTarget = event.relatedTarget;
      if (relatedTarget instanceof Node && (event.currentTarget as HTMLElement).contains(relatedTarget)) {
        return;
      }
      setHeaderHovering?.(false);
    }}
    ondragenter={(event) => {
      if (canHandleSecretDropPayload?.(event.dataTransfer)) {
        setSecretDropTarget?.(true);
      }
    }}
    ondragover={(event) => {
      if (!canHandleSecretDropPayload?.(event.dataTransfer)) return;
      event.preventDefault();
      setSecretDropTarget?.(true);
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'copy';
      }
    }}
    ondragleave={(event) => {
      const relatedTarget = event.relatedTarget;
      if (relatedTarget instanceof Node && (event.currentTarget as HTMLElement).contains(relatedTarget)) {
        return;
      }
      setSecretDropTarget?.(false);
    }}
    ondrop={(event) => onSecretFileDrop?.(event)}
  >
    <div class="brand-rail panel-surface">
      <div class="brand-badge static" aria-label="Nearbytes branding">
        {#if isDevThemeStudio}
          <button
            type="button"
            class="brand-logo-trigger"
            onclick={() => onOpenThemeStudio?.()}
            aria-label="Open theme studio"
            title="Open theme studio"
          >
            <span class="brand-logo-frame interactive">
              <NearbytesLogo size={24} options={themeLogoOptions!} ariaLabel="Nearbytes brand mark" />
            </span>
          </button>
        {:else}
          <span class="brand-logo-frame">
            <NearbytesLogo size={24} options={themeLogoOptions!} ariaLabel="Nearbytes brand mark" />
          </span>
        {/if}
        <div class="brand-stack">
          <div class="brand-meta-row">
            <span class="brand-copy">
              <span class="brand-title">Nearbytes</span>
              <span class="brand-note">{paletteLabel}</span>
            </span>

            <label class="phone-mount-selector" aria-label="Active hub selector">
              <span class="sr-only">Active hub</span>
              <span class="phone-mount-selector-inner">
                <select
                  class="phone-mount-select"
                  value={activeMountId}
                  onchange={(event) => onSelectMount?.((event.currentTarget as HTMLSelectElement).value)}
                >
                  {#each mounts as mount (mount.id)}
                    <option value={mount.id}>{mount.label || 'Unnamed hub'}</option>
                  {/each}
                </select>
                <button
                  type="button"
                  class="header-tool-btn phone-mount-create-btn"
                  aria-label="Create hub"
                  title="Create hub"
                  onclick={(event) => {
                    event.stopPropagation();
                    onOpenCreateChooser?.();
                  }}
                >
                  <Plus class="button-icon" size={14} strokeWidth={2.2} />
                </button>
              </span>
            </label>

            <MountRail dragging={draggingMounts}>
              {#snippet children()}
                {@render mountRailChildren?.()}
              {/snippet}
              {#snippet actions()}
                {@render mountRailActions?.()}
              {/snippet}
            </MountRail>

            <div class="mounts-actions brand-actions">
              <button
                type="button"
                class="header-tool-btn phone-overflow-toggle"
                bind:this={phoneOverflowMenuButtonElement}
                class:active={showPhoneOverflowMenu}
                aria-label="More actions"
                aria-expanded={showPhoneOverflowMenu}
                title="More actions"
                onclick={(event) => {
                  event.stopPropagation();
                  onTogglePhoneOverflowMenu?.();
                }}
              >
                <Rows3 class="button-icon" size={14} strokeWidth={2.2} />
              </button>
              {#if showPhoneOverflowMenu}
                <PhoneOverflowMenu bind:menuElement={phoneOverflowMenuElement} state={workspaceState} actions={workspaceActions} />
              {/if}
              <button
                type="button"
                class="header-tool-btn desktop-header-action"
                class:active={showIdentityManager}
                aria-label="Identities"
                title="Identities"
                onclick={(event) => {
                  event.stopPropagation();
                  onOpenIdentityManager?.();
                }}
              >
                <UserRound class="button-icon" size={14} strokeWidth={2} />
              </button>
              {#if showResetAction}
                <button
                  type="button"
                  class="header-tool-btn desktop-header-action"
                  class:danger={showResetDialog}
                  aria-label="Reset app state"
                  title="Reset app state"
                  onclick={(event) => {
                    event.stopPropagation();
                    onOpenResetDialog?.();
                  }}
                >
                  <Trash2 class="button-icon" size={14} strokeWidth={2} />
                </button>
              {/if}
              <button
                type="button"
                class="header-tool-btn desktop-header-action"
                class:active={showSourcesPanel}
                aria-label="Locations"
                title="Locations"
                onclick={(event) => {
                  event.stopPropagation();
                  onToggleSourcesPanel?.();
                }}
              >
                <HardDrive class="button-icon" size={14} strokeWidth={2} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</header>

<style>
  .header {
    flex: 0 0 auto;
    padding: 0.3rem 0.9rem;
  }

  .header-shell {
    position: relative;
    display: grid;
    gap: 0.55rem;
  }

  .header-shell.secret-drop-target {
    filter: saturate(1.08);
  }

  .brand-rail {
    display: flex;
    align-items: center;
    min-width: 0;
    padding: 0.4rem 0.5rem;
    border-radius: var(--nb-radius-lg, 20px);
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.14)) 72%, transparent);
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 97%, var(--nb-shell-bottom, #f4f4f7));
    backdrop-filter: blur(var(--nb-surface-blur, 18px));
    box-shadow: var(--nb-shadow-md, 0 20px 40px rgba(15, 23, 42, 0.08));
  }

  .brand-badge {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    min-width: 0;
    width: 100%;
  }

  .brand-logo-trigger {
    appearance: none;
    border: 0;
    background: transparent;
    padding: 0;
    cursor: pointer;
  }

  .brand-logo-frame {
    width: 42px;
    height: 42px;
    border-radius: var(--nb-radius-md, 14px);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 92%, rgba(240, 249, 255, 0.72));
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.14)) 76%, transparent);
  }

  .brand-logo-frame.interactive {
    transition: transform var(--nb-motion-medium, 180ms) ease, border-color var(--nb-motion-medium, 180ms) ease, background-color var(--nb-motion-medium, 180ms) ease;
  }

  .brand-logo-trigger:hover .brand-logo-frame.interactive,
  .brand-logo-trigger:focus-visible .brand-logo-frame.interactive {
    transform: translateY(-1px);
    border-color: color-mix(in srgb, var(--nb-accent, #0ea5e9) 22%, transparent);
    background: color-mix(in srgb, var(--nb-accent, #0ea5e9) 8%, white);
  }

  .brand-stack {
    min-width: 0;
    flex: 1 1 auto;
    display: grid;
    gap: 0.35rem;
  }

  .brand-meta-row {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    min-width: 0;
  }

  .brand-meta-row :global(.mount-rail) {
    flex: 1 1 auto;
    min-width: 0;
  }

  .brand-copy {
    display: grid;
    gap: 0.05rem;
    min-width: max-content;
  }

  .brand-title {
    font-family: var(--nb-font-display, 'Iowan Old Style', serif);
    font-size: 0.94rem;
    font-weight: 640;
    color: var(--nb-text-main, rgba(28, 28, 30, 0.96));
  }

  .brand-note {
    font-size: 0.72rem;
    color: var(--nb-text-soft, rgba(70, 70, 73, 0.72));
  }

  .phone-mount-selector {
    display: none;
  }

  .phone-mount-selector-inner {
    display: flex;
    align-items: center;
    gap: 0.45rem;
  }

  .phone-mount-select {
    appearance: none;
    min-height: 36px;
    border-radius: var(--nb-radius-pill, 999px);
    border: 1px solid rgba(148, 163, 184, 0.22);
    background: rgba(255, 255, 255, 0.96);
    color: #1f2937;
    padding: 0 0.95rem;
    font: inherit;
  }

  .mounts-actions {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    position: relative;
  }

  .header-tool-btn {
    appearance: none;
    border: 1px solid var(--nb-btn-border, rgba(56, 189, 248, 0.14));
    background: var(--nb-btn-bg, rgba(10, 19, 34, 0.52));
    color: var(--nb-btn-color, rgba(191, 219, 254, 0.78));
    border-radius: var(--nb-radius-pill, 999px);
    width: 30px;
    height: 30px;
    line-height: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    padding: 0;
    transition: opacity var(--nb-motion-medium, 180ms) ease, transform var(--nb-motion-medium, 180ms) ease, background-color var(--nb-motion-medium, 180ms) ease, border-color var(--nb-motion-medium, 180ms) ease, color var(--nb-motion-medium, 180ms) ease, box-shadow var(--nb-motion-medium, 180ms) ease;
  }

  .header-tool-btn:hover {
    background: var(--nb-btn-hover-bg, rgba(16, 32, 56, 0.88));
    border-color: var(--nb-btn-hover-border, rgba(96, 165, 250, 0.28));
    color: var(--nb-btn-hover-color, rgba(224, 242, 254, 0.96));
  }

  .header-tool-btn:focus-visible {
    outline: none;
    box-shadow: var(--nb-btn-focus-ring, inset 0 0 0 1px rgba(125, 211, 252, 0.18));
  }

  .header-tool-btn.active {
    border-color: var(--nb-btn-active-border, rgba(34, 211, 238, 0.42));
    background: var(--nb-btn-active-bg, linear-gradient(180deg, rgba(16, 66, 91, 0.92), rgba(10, 44, 66, 0.94)));
    color: var(--nb-btn-active-color, rgba(236, 254, 255, 0.98));
    box-shadow: var(--nb-btn-active-shadow, 0 10px 24px rgba(6, 182, 212, 0.16));
  }

  .header-tool-btn.danger {
    border-color: color-mix(in srgb, var(--nb-danger, #dc2626) 28%, var(--nb-btn-border, rgba(56, 189, 248, 0.14)) 72%);
    color: color-mix(in srgb, var(--nb-danger, #dc2626) 72%, var(--nb-btn-color, rgba(191, 219, 254, 0.78)) 28%);
  }

  .header-tool-btn.danger:hover {
    background: color-mix(in srgb, var(--nb-danger, #dc2626) 16%, var(--nb-btn-hover-bg, rgba(16, 32, 56, 0.88)) 84%);
    border-color: color-mix(in srgb, var(--nb-danger, #dc2626) 44%, var(--nb-btn-hover-border, rgba(96, 165, 250, 0.28)) 56%);
  }

  @media (max-width: 900px) {
    .header {
      padding: 0.25rem 0.45rem;
    }

    .brand-meta-row {
      flex-wrap: wrap;
    }

    .phone-mount-selector {
      display: block;
      width: 100%;
    }

    .brand-copy {
      min-width: 0;
      flex: 1 1 auto;
    }

    .brand-meta-row :global(.mount-rail) {
      order: 3;
      width: 100%;
    }
  }

  @media (min-width: 901px) {
    .header {
      padding: 0.55rem 1.25rem;
    }
  }
</style>