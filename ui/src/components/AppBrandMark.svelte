<script lang="ts">
  import NearbytesLogo from './NearbytesLogo.svelte';
  import type { NearbytesLogoOptions } from '../lib/branding.js';

  let {
    size = 88,
    options,
    ariaLabel = 'Nearbytes logo',
    bootAnimate = true,
    assetVersion = 0,
  } = $props<{
    size?: number;
    options: NearbytesLogoOptions;
    ariaLabel?: string;
    bootAnimate?: boolean;
    assetVersion?: number;
  }>();

  let imageFailed = $state(false);
  const assetSrc = $derived(`/branding/app-icon.png?v=${assetVersion}`);

  $effect(() => {
    assetVersion;
    imageFailed = false;
  });
</script>

{#if imageFailed}
  <NearbytesLogo {size} {options} {ariaLabel} {bootAnimate} />
{:else}
  <img
    class="app-brand-mark"
    src={assetSrc}
    alt={ariaLabel}
    width={size}
    height={size}
    onerror={() => {
      imageFailed = true;
    }}
  />
{/if}

<style>
  .app-brand-mark {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
</style>