<script lang="ts">
  import type { WorkspaceSurfaceProps } from '../state/types.js';
  import WorkspaceShell from './WorkspaceShell.svelte';

  let surfaceProps = $props() as WorkspaceSurfaceProps;
</script>

<div class="phone-frame">
  <WorkspaceShell {...surfaceProps} mode="phone" />
</div>

<style>
  .phone-frame {
    width: min(24rem, 100%);
    margin-inline: auto;
    min-height: 44rem;
    padding: 0.4rem;
    border-radius: 42px;
    border: 1px solid var(--nb-border-strong);
    background: color-mix(in srgb, var(--nb-surface-strong) 88%, black 6%);
    box-shadow: 0 24px 60px rgba(8, 14, 20, 0.22);
  }
</style>
