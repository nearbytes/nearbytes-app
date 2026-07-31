<script lang="ts">
  import { onMount } from 'svelte';
  import { createAppState, provideAppState, provideAdapter, AppShell } from 'nearbytes-components';
  import { createIpcAdapter } from './lib/ipcAdapter.js';
  import { hydrate } from './lib/hydrate.js';
  import SyncDebugModal from './SyncDebugModal.svelte';

  const app = createAppState();
  const adapter = createIpcAdapter();
  provideAppState(app);
  provideAdapter(adapter);

  onMount(() => {
    void hydrate(app, adapter);
  });

  // Sync protocol debug modal (Cmd/Ctrl+Shift+D) — app-local for now; port to
  // nearbytes-components once the design has settled.
  let debugModalOpen = $state(false);
  function handleKeydown(e: KeyboardEvent): void {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      debugModalOpen = !debugModalOpen;
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="h-full min-h-0 w-full">
  <AppShell />
</div>

{#if debugModalOpen}
  <SyncDebugModal onClose={() => (debugModalOpen = false)} />
{/if}
