<script lang="ts">
  import { onMount } from 'svelte';
  import {
    createAppState, provideAppState, provideAdapter,
    FinderShell, ChatPane, SettingsPanel, ProfileSelector, StatusBar
  } from 'nearbytes-components';
  import { Resizable, Button, Icon } from 'nearbytes-widgets';
  import { Settings, Files } from '@lucide/svelte';
  import { createIpcAdapter } from './lib/ipcAdapter.js';
  import { hydrate } from './lib/hydrate.js';

  const app = createAppState();
  const adapter = createIpcAdapter();
  provideAppState(app);
  provideAdapter(adapter);

  onMount(() => { void hydrate(app, adapter); });
</script>

<div class="flex h-screen w-screen flex-col overflow-hidden bg-nb-bg text-nb-text">
  <!-- top bar: profile selector + friends/settings (top-right) -->
  <header class="flex h-10 shrink-0 items-center justify-between border-b border-nb-hairline bg-nb-sidebar pl-20 pr-3">
    <div class="flex items-center gap-2">
      <Button variant={app.panel === 'files' ? 'subtle' : 'ghost'} size="sm" onclick={() => (app.panel = 'files')}>
        <Icon glyph={Files} size={14} /> Files
      </Button>
      <Button variant={app.panel === 'settings' ? 'subtle' : 'ghost'} size="sm" onclick={() => (app.panel = 'settings')}>
        <Icon glyph={Settings} size={14} /> Configure
      </Button>
    </div>
    <ProfileSelector />
  </header>

  <main class="min-h-0 flex-1">
    {#if app.panel === 'settings'}
      <SettingsPanel />
    {:else}
      <Resizable.PaneGroup direction="horizontal" class="h-full">
        <Resizable.Pane defaultSize={72} minSize={45}>
          <FinderShell />
        </Resizable.Pane>
        <!-- minimal separator between files and chat -->
        <Resizable.Handle />
        <Resizable.Pane defaultSize={28} minSize={18} maxSize={42}>
          <ChatPane chat={app.chat} hubLabel={app.activeHub} />
        </Resizable.Pane>
      </Resizable.PaneGroup>
    {/if}
  </main>

  <StatusBar status={app.status} />
</div>
