<script lang="ts">
  import UiButton from './lib/components/UiButton.svelte';
  import UiCard from './lib/components/UiCard.svelte';
  import UiChip from './lib/components/UiChip.svelte';
  import StateGraph from './lib/components/StateGraph.svelte';
  import HubChip from './lib/components/HubChip.svelte';
  import FileRow from './lib/components/FileRow.svelte';
  import PeerRow from './lib/components/PeerRow.svelte';
  import EventRow from './lib/components/EventRow.svelte';
  import DesktopPreview from './lib/surfaces/DesktopPreview.svelte';
  import PhonePreview from './lib/surfaces/PhonePreview.svelte';
  import { buildCapabilities, buildFixtures } from './lib/fixtures/mockData.js';
  import { MOODBOARDS, MOODBOARD_BY_ID, buildThemeStyle } from './lib/tokens/theme.js';
  import {
    selectComponentFamily,
    selectFixturePreset,
    selectMoodboard,
    selectTab,
  } from './lib/state/actions.js';
  import { createUiDesignerStore } from './lib/state/store.js';
  import type { ComponentFamily, DesignerTab } from './lib/state/types.js';

  const designerStore = createUiDesignerStore();
  const activeGraphNodeStore = designerStore.activeGraphNode;

  const tabs: Array<{ id: DesignerTab; label: string }> = [
    { id: 'moodboards', label: 'Moodboards' },
    { id: 'typography', label: 'Typography' },
    { id: 'palette', label: 'Palette' },
    { id: 'components', label: 'Components' },
    { id: 'graph', label: 'State Graph' },
    { id: 'desktop', label: 'Desktop UI' },
    { id: 'phone', label: 'Phone UI' },
  ];

  const families: ComponentFamily[] = ['primitives', 'inputs', 'display', 'shell', 'protocol'];

  const fixturePresets = [
    { id: 'populated', label: 'Populated' },
    { id: 'empty', label: 'Empty' },
    { id: 'warning', label: 'Warning' },
    { id: 'capability-limited', label: 'Limited' },
  ] as const;

  const state = $derived($designerStore);
  const activeGraphNode = $derived($activeGraphNodeStore);
  const moodboard = $derived(MOODBOARD_BY_ID[state.moodboardId]);
  const fixtures = $derived(buildFixtures(state.fixturePreset));
  const capabilities = $derived(buildCapabilities(state.fixturePreset));
  const themeStyle = $derived(buildThemeStyle(state.moodboardId));

  function setTab(tab: DesignerTab) {
    designerStore.update((value) => selectTab(value, tab));
  }

  function setMoodboard(id: typeof moodboard.id) {
    designerStore.update((value) => selectMoodboard(value, id));
  }

  function setPreset(id: typeof state.fixturePreset) {
    designerStore.update((value) => selectFixturePreset(value, id));
  }

  function setFamily(family: ComponentFamily) {
    designerStore.update((value) => selectComponentFamily(value, family));
  }
</script>

<div class="designer-app nb-theme-scope nb-type-body" style={themeStyle}>
  <aside class="app-sidebar nb-panel-surface">
    <div class="sidebar-brand">
      <p class="sidebar-kicker">Nearbytes</p>
      <h1 class="sidebar-title nb-type-display">UI designer system</h1>
      <p class="sidebar-summary">
        Executable design system, centralized UI state, and future export surface for the real app.
      </p>
    </div>

    <nav class="sidebar-nav">
      {#each tabs as tab}
        <button class:active={state.tab === tab.id} type="button" onclick={() => setTab(tab.id)}>
          {tab.label}
        </button>
      {/each}
    </nav>

    <div class="sidebar-footer">
      <p class="sidebar-label">Fixture preset</p>
      <div class="preset-pills">
        {#each fixturePresets as preset}
          <button class:active={state.fixturePreset === preset.id} type="button" onclick={() => setPreset(preset.id)}>
            {preset.label}
          </button>
        {/each}
      </div>

      <div class="live-summary">
        <p class="sidebar-label">Live structural state</p>
        <UiChip label={activeGraphNode} tone="accent" />
      </div>
    </div>
  </aside>

  <main class="app-main">
    <header class="app-main-header nb-panel-surface">
      <div class="app-main-copy">
        <p class="app-main-kicker">{tabs.find((tab) => tab.id === state.tab)?.label}</p>
        <h2>{moodboard.label}</h2>
      </div>
      <div class="app-main-tools">
        <UiChip label={state.fixturePreset} tone="accent" />
        <UiChip label={activeGraphNode} tone="neutral" />
      </div>
    </header>

    {#if state.tab === 'moodboards'}
      <section class="content-grid">
        {#each MOODBOARDS as board}
          <UiCard eyebrow="Moodboard" title={board.label} detail={board.summary}>
            {#snippet actions()}
              <UiButton label={state.moodboardId === board.id ? 'Selected' : 'Use moodboard'} tone={state.moodboardId === board.id ? 'secondary' : 'primary'} onClick={() => setMoodboard(board.id)} />
            {/snippet}

            {#snippet body()}
              <div class="moodboard-card">
                <p class="moodboard-tagline">{board.tagline}</p>
                <div class="moodboard-swatches">
                  <span style={`background:${board.palette.canvas}`}></span>
                  <span style={`background:${board.palette.surfaceStrong}`}></span>
                  <span style={`background:${board.palette.accent}`}></span>
                  <span style={`background:${board.palette.text}`}></span>
                </div>
                <div class="moodboard-atmosphere">
                  {#each board.atmosphere as tag}
                    <UiChip label={tag} tone="neutral" />
                  {/each}
                </div>
              </div>
            {/snippet}
          </UiCard>
        {/each}
      </section>
    {:else if state.tab === 'typography'}
      <section class="content-solo">
        <UiCard eyebrow="Typography" title={moodboard.label} detail="Read-only token sheet derived from the selected moodboard.">
          {#snippet body()}
            <div class="type-grid">
              <div class="type-fonts">
                <div><span>Display</span><strong>{moodboard.typography.displayFont}</strong></div>
                <div><span>Body</span><strong>{moodboard.typography.bodyFont}</strong></div>
                <div><span>Mono</span><strong>{moodboard.typography.monoFont}</strong></div>
              </div>
              {#each moodboard.typography.scale as item}
                <div class="type-row">
                  <div>
                    <p>{item.label}</p>
                    <small>{item.use}</small>
                  </div>
                  <div class="type-sample" style={`font-size:${item.size}; line-height:${item.lineHeight};`}>
                    Nearbytes keeps structure visible.
                  </div>
                </div>
              {/each}
            </div>
          {/snippet}
        </UiCard>
      </section>
    {:else if state.tab === 'palette'}
      <section class="content-solo">
        <UiCard eyebrow="Palette" title={moodboard.label} detail="Read-only semantic palette derived from the selected moodboard.">
          {#snippet body()}
            <div class="palette-grid">
              {#each Object.entries(moodboard.palette) as [key, value]}
                <div class="palette-row">
                  <span class="palette-swatch" style={`background:${value}`}></span>
                  <div>
                    <strong>{key}</strong>
                    <small>{value}</small>
                  </div>
                </div>
              {/each}
            </div>
          {/snippet}
        </UiCard>
      </section>
    {:else if state.tab === 'components'}
      <section class="content-solo">
        <UiCard eyebrow="Components" title="Shared component library" detail="All reusable components live here independently from runtime wiring.">
          {#snippet body()}
            <div class="family-pills">
              {#each families as family}
                <button class:active={state.componentFamily === family} type="button" onclick={() => setFamily(family)}>{family}</button>
              {/each}
            </div>

            {#if state.componentFamily === 'primitives' || state.componentFamily === 'inputs'}
              <div class="component-grid">
                <UiButton label="Primary action" />
                <UiButton label="Secondary action" tone="secondary" />
                <UiButton label="Danger action" tone="danger" />
                <UiChip label="Accent chip" tone="accent" />
                <UiChip label="Warning chip" tone="warning" />
                <UiChip label="Success chip" tone="success" />
              </div>
            {/if}

            {#if state.componentFamily === 'display' || state.componentFamily === 'protocol'}
              <div class="component-list">
                <HubChip hub={fixtures.hubs[0]} active />
                {#if fixtures.files[0]}
                  <FileRow file={fixtures.files[0]} active />
                {/if}
                {#if fixtures.peers[0]}
                  <PeerRow peer={fixtures.peers[0]} />
                {/if}
                {#if fixtures.events[0]}
                  <EventRow event={fixtures.events[0]} active />
                {/if}
              </div>
            {/if}

            {#if state.componentFamily === 'shell'}
              <div class="component-grid component-grid-wide">
                <DesktopPreview ui={state.workspace} data={fixtures} {capabilities} handlers={{ onAction: designerStore.dispatchSurfaceAction }} />
              </div>
            {/if}
          {/snippet}
        </UiCard>
      </section>
    {:else if state.tab === 'graph'}
      <section class="content-solo">
        <UiCard eyebrow="State graph" title="Structural UI transition graph" detail="The graph, previews, and store all share the same structural UI state.">
          {#snippet body()}
            <StateGraph
              nodes={designerStore.graph.nodes}
              edges={designerStore.graph.edges}
              width={designerStore.graph.width}
              height={designerStore.graph.height}
              activeNodeId={activeGraphNode}
              onSelectNode={(nodeId) => designerStore.setStructuralState(nodeId)}
            />
          {/snippet}
        </UiCard>
      </section>
    {:else if state.tab === 'desktop'}
      <section class="content-solo">
        <DesktopPreview ui={state.workspace} data={fixtures} {capabilities} handlers={{ onAction: designerStore.dispatchSurfaceAction }} />
      </section>
    {:else if state.tab === 'phone'}
      <section class="content-solo">
        <PhonePreview ui={state.workspace} data={fixtures} {capabilities} handlers={{ onAction: designerStore.dispatchSurfaceAction }} />
      </section>
    {/if}
  </main>
</div>
