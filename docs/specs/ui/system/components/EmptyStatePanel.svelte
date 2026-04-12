<script lang="ts">
  import type { Snippet } from 'svelte';
  import { devSurface, getDevContext } from '../dev.js';
  import NearbytesLogo from './NearbytesLogo.svelte';
  import type { NearbytesLogoOptions } from '../../../../../ui/src/lib/branding.js';

  let {
    eyebrow = '',
    title = '',
    subtitle = '',
    showBrand = false,
    themeLogoOptions,
    icon,
  }: {
    eyebrow?: string;
    title?: string;
    subtitle?: string;
    showBrand?: boolean;
    themeLogoOptions?: NearbytesLogoOptions;
    icon?: Snippet;
  } = $props();
  const dev = getDevContext();
</script>

<div class="empty-state" use:devSurface={{ enabled: $dev, name: 'EmptyStatePanel' }}>
  <div class="empty-content">
    {#if showBrand}
      <div class="empty-brand-shell">
        <NearbytesLogo size={112} options={themeLogoOptions!} ariaLabel="Nearbytes logo" />
      </div>
    {:else if icon}
      <div class="empty-icon-shell">{@render icon()}</div>
    {/if}
    {#if eyebrow}
      <p class="empty-eyebrow">{eyebrow}</p>
    {/if}
    <p class="empty-hint">{title}</p>
    <p class="empty-subhint">{subtitle}</p>
  </div>
</div>

<style>
  .empty-state {
    flex: 1 1 auto;
    min-height: min(24rem, 60vh);
    display: grid;
    place-items: center;
    padding: 1.5rem;
  }

  .empty-content {
    display: grid;
    justify-items: center;
    gap: 0.5rem;
    text-align: center;
    max-width: 34rem;
  }

  .empty-brand-shell,
  .empty-icon-shell {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 132px;
    height: 132px;
    border-radius: var(--nb-radius-xl, 28px);
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 92%, rgba(240, 249, 255, 0.72));
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.14)) 72%, transparent);
    box-shadow: var(--nb-shadow-md, 0 20px 42px rgba(15, 23, 42, 0.08));
  }

  .empty-eyebrow,
  .empty-hint,
  .empty-subhint {
    margin: 0;
  }

  .empty-eyebrow {
    font-size: 0.72rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--nb-text-faint, rgba(110, 110, 115, 0.72));
  }

  .empty-hint {
    font-family: var(--nb-font-display, 'Iowan Old Style', serif);
    font-size: 1.18rem;
    font-weight: 650;
    color: var(--nb-text-main, rgba(28, 28, 30, 0.96));
  }

  .empty-subhint {
    font-size: 0.88rem;
    line-height: 1.6;
    color: var(--nb-text-soft, rgba(70, 70, 73, 0.8));
  }
</style>
