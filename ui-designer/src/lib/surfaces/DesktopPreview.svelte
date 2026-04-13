<script lang="ts">
  import type { WorkspaceSurfaceProps } from '../state/types.js';
  import WorkspaceShell from './WorkspaceShell.svelte';

  let { ui, data, capabilities, handlers }: WorkspaceSurfaceProps = $props();
</script>

<div class="desktop-frame">
  <WorkspaceShell {ui} {data} {capabilities} {handlers} mode="desktop" />
</div>

<style>
  .desktop-frame {
    width: 100%;
    min-height: 44rem;
  }
</style>
