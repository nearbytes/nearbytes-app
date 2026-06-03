<script lang="ts">
  import { onMount } from 'svelte';
  import { createAppState, provideAppState, provideAdapter, AppShell } from 'nearbytes-components';
  import { createIpcAdapter } from './lib/ipcAdapter.js';
  import { hydrate } from './lib/hydrate.js';

  const app = createAppState();
  const adapter = createIpcAdapter();
  provideAppState(app);
  provideAdapter(adapter);

  onMount(() => {
    void hydrate(app, adapter);
  });
</script>

<div class="h-full min-h-0 w-full">
  <AppShell />
</div>
