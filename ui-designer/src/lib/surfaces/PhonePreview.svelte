<script lang="ts">
  import type { WorkspaceSurfaceProps } from '../state/types.js';
  import WorkspaceShell from './WorkspaceShell.svelte';

  let { ui, data, capabilities, handlers }: WorkspaceSurfaceProps = $props();
</script>

<div class="phone-frame">
  <WorkspaceShell {ui} {data} {capabilities} {handlers} mode="phone" />
</div>

<style>
  .phone-frame {
    width: min(24rem, 100%);
    margin-inline: auto;
    min-height: 44rem;
    padding: 0.4rem;
    border-radius: var(--nb-radius-frame);
    border: 1px solid var(--nb-border-strong);
    background: color-mix(in srgb, var(--nb-surface-strong) 88%, black 6%);
    box-shadow: var(--nb-shadow-frame);
  }
</style>
