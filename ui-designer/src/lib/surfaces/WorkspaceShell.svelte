<script lang="ts">
  import { Bell, FolderKanban, Search, Share2, Shield, Settings2 } from 'lucide-svelte';
  import UiDialog from '../components/UiDialog.svelte';
  import HubChip from '../components/HubChip.svelte';
  import FilesPane from './FilesPane.svelte';
  import ChatPane from './ChatPane.svelte';
  import PreviewPane from './PreviewPane.svelte';
  import TimelinePanel from './TimelinePanel.svelte';
  import JoinDialog from './JoinDialog.svelte';
  import ShareDialog from './ShareDialog.svelte';
  import IdentityManager from './IdentityManager.svelte';
  import CreateChooser from './CreateChooser.svelte';
  import SourcesPanel from './SourcesPanel.svelte';
  import StoragePanel from './StoragePanel.svelte';
  import HubStorageDialog from './HubStorageDialog.svelte';
  import ResetDialog from './ResetDialog.svelte';
  import type { WorkspaceSurfaceProps } from '../state/types.js';

  interface $$Props extends WorkspaceSurfaceProps {
    mode?: 'desktop' | 'phone';
  }

  let {
    ui,
    data,
    capabilities,
    handlers,
    mode = 'desktop',
  }: $$Props = $props();

  const showFilesFirst = $derived(ui.primaryPane === 'files');
  const selectedEvent = $derived(
    data.events.find((event) => event.id === ui.selectedEventId) ?? data.events[0] ?? null
  );
</script>

<div class={`workspace-shell ${mode}`}>
  <header class="workspace-header nb-panel-surface">
    <div class="workspace-brand">
      <strong class="nb-type-heading">{ui.activeHubId === 'atlas' ? 'Atlas Relay' : ui.activeHubId === 'harbor' ? 'Harbor Storage' : 'Quiet Archive'}</strong>
    </div>
    <div class="workspace-tools">
      <button type="button" class="icon-pill" onclick={() => handlers?.onAction?.({ type: 'open-overlay', overlay: 'join' })}><Search size={16} /></button>
      <button type="button" class="icon-pill" onclick={() => handlers?.onAction?.({ type: 'open-overlay', overlay: 'share' })}><Share2 size={16} /></button>
      <button type="button" class="icon-pill" onclick={() => handlers?.onAction?.({ type: 'open-overlay', overlay: 'identity' })}><Shield size={16} /></button>
      <button type="button" class="icon-pill"><Bell size={16} /></button>
      <button type="button" class="icon-pill" onclick={() => handlers?.onAction?.({ type: 'open-overlay', overlay: 'sources' })}><Settings2 size={16} /></button>
    </div>
  </header>

  <section class="workspace-hubs">
    {#each data.hubs as hub}
      <HubChip hub={hub} active={ui.activeHubId === hub.id} onSelect={() => handlers?.onAction?.({ type: 'select-hub', hubId: hub.id })} />
    {/each}
  </section>

  <section class={`workspace-body pane-${ui.paneMode}`}>
    {#if showFilesFirst}
      <FilesPane {ui} {data} {capabilities} {handlers} />
      <ChatPane {ui} {data} {capabilities} {handlers} />
    {:else}
      <ChatPane {ui} {data} {capabilities} {handlers} />
      <FilesPane {ui} {data} {capabilities} {handlers} />
    {/if}
    {#if ui.showPreview}
      <PreviewPane {ui} {data} {capabilities} {handlers} />
    {/if}
    {#if ui.showTimeline}
      <TimelinePanel {ui} {data} {capabilities} {handlers} />
    {/if}
  </section>
  {#if ui.overlay === 'join'}
    <JoinDialog onClose={() => handlers?.onAction?.({ type: 'close-overlay' })} />
  {:else if ui.overlay === 'share'}
    <ShareDialog onClose={() => handlers?.onAction?.({ type: 'close-overlay' })} />
  {:else if ui.overlay === 'identity'}
    <IdentityManager {data} onClose={() => handlers?.onAction?.({ type: 'close-overlay' })} />
  {:else if ui.overlay === 'create'}
    <CreateChooser onClose={() => handlers?.onAction?.({ type: 'close-overlay' })} />
  {:else if ui.overlay === 'sources'}
    <SourcesPanel {ui} {data} {capabilities} {handlers} />
  {:else if ui.overlay === 'storage'}
    <StoragePanel {ui} {data} {capabilities} {handlers} />
  {:else if ui.overlay === 'hub-storage'}
    <HubStorageDialog onClose={() => handlers?.onAction?.({ type: 'close-overlay' })} />
  {:else if ui.overlay === 'event-flow'}
    <UiDialog title="Event flow" onClose={() => handlers?.onAction?.({ type: 'close-overlay' })}>
      {#snippet body()}
        <div class="event-flow-grid">
          {#if selectedEvent}
            <strong>{selectedEvent.title}</strong>
            <p>{selectedEvent.summary}</p>
            <ul>
              <li>Source object acknowledged</li>
              <li>Encrypted block linked</li>
              <li>Projection visible in current hub shell</li>
            </ul>
          {/if}
        </div>
      {/snippet}
    </UiDialog>
  {:else if ui.overlay === 'reset'}
    <ResetDialog canReset={capabilities?.destructiveReset} onClose={() => handlers?.onAction?.({ type: 'close-overlay' })} />
  {/if}
</div>

<style>
  .workspace-shell {
    position: relative;
    display: grid;
    gap: 0.8rem;
    padding: 1rem;
    border-radius: 34px;
    background: var(--nb-shell-top);
    border: 1px solid var(--nb-border);
    overflow: hidden;
    min-height: 0;
    height: 100%;
  }

  .workspace-header {
    border-radius: 24px;
    padding: 0.85rem;
    display: flex;
    justify-content: space-between;
    gap: 0.85rem;
    align-items: center;
  }

  .workspace-brand {
    display: grid;
    gap: 0;
  }

  .workspace-tools {
    display: flex;
    gap: 0.55rem;
  }

  .icon-pill {
    width: 2.4rem;
    height: 2.4rem;
    border-radius: 999px;
    border: 1px solid var(--nb-border);
    background: transparent;
    color: var(--nb-text-soft);
  }

  .workspace-hubs {
    display: flex;
    gap: 0.75rem;
    overflow-x: auto;
  }

  .workspace-body {
    display: grid;
    gap: 0.85rem;
    grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
    min-height: 0;
    overflow: hidden;
  }

  .workspace-body.pane-files-focus {
    grid-template-columns: minmax(0, 1.6fr) minmax(0, 0.8fr);
  }

  .workspace-body.pane-chat-focus {
    grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.6fr);
  }

  .workspace-shell.phone .workspace-body {
    grid-template-columns: 1fr;
  }

  .event-flow-grid {
    display: grid;
    gap: 0.6rem;
  }

  .event-flow-grid p,
  .event-flow-grid ul {
    margin: 0;
    color: var(--nb-text-soft);
    font-size: 0.86rem;
    line-height: 1.45;
  }

  .event-flow-grid ul {
    padding-left: 1.15rem;
  }
</style>
