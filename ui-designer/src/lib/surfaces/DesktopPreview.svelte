<script lang="ts">
  import type { WorkspaceSurfaceProps } from '../state/types.js';
  import WorkspaceShell from './WorkspaceShell.svelte';

  let surfaceProps = $props() as WorkspaceSurfaceProps;
</script>

<div class="desktop-frame">
  <WorkspaceShell {...surfaceProps} mode="desktop" />
</div>

<style>
  .desktop-frame {
    width: 100%;
    min-height: 44rem;
  }
</style>
