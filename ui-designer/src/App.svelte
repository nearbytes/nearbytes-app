<script lang="ts">
  import UiButton from './lib/components/UiButton.svelte';
  import UiCard from './lib/components/UiCard.svelte';
  import UiChip from './lib/components/UiChip.svelte';
  import StateGraph from './lib/components/StateGraph.svelte';
  import HubChip from './lib/components/HubChip.svelte';
  import FileRow from './lib/components/FileRow.svelte';
  import PeerRow from './lib/components/PeerRow.svelte';
  import EventRow from './lib/components/EventRow.svelte';
  import WorkspaceShell from './lib/surfaces/WorkspaceShell.svelte';
  import { buildCapabilities, buildFixtures } from './lib/fixtures/mockData.js';
  import { MOODBOARDS, MOODBOARD_BY_ID, buildThemeStyle } from './lib/tokens/theme.js';
  import { GRAPH_EDGE_BY_ID, GRAPH_NODE_BY_ID, layoutGraph } from './lib/state/graph.js';
  import {
    selectComponentFamily,
    selectFixturePreset,
    selectMoodboard,
    selectTab,
  } from './lib/state/actions.js';
  import { createUiDesignerStore } from './lib/state/store.js';
  import type { ComponentFamily, DesignerTab, GraphNodeId } from './lib/state/types.js';
  import type { GraphLayoutMode } from './lib/state/graph.js';

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

  const designerState = $derived($designerStore);
  const activeGraphNode = $derived($activeGraphNodeStore);
  let graphLayoutMode: GraphLayoutMode = $state('planar');
  let selectedGraphNodeId: GraphNodeId | null = $state(null);
  let selectedGraphEdgeId: string | null = $state(null);
  const moodboard = $derived(MOODBOARD_BY_ID[designerState.moodboardId]);
  const fixtures = $derived(buildFixtures(designerState.fixturePreset));
  const capabilities = $derived(buildCapabilities(designerState.fixturePreset));
  const themeStyle = $derived(buildThemeStyle(designerState.moodboardId));
  const selectedGraphNode = $derived(
    GRAPH_NODE_BY_ID[selectedGraphNodeId ?? activeGraphNode]
  );
  const selectedGraphEdge = $derived(
    selectedGraphEdgeId ? GRAPH_EDGE_BY_ID[selectedGraphEdgeId] ?? null : null
  );
  const graphLayout = $derived(layoutGraph(graphLayoutMode));

  function setTab(tab: DesignerTab) {
    designerStore.update((value) => selectTab(value, tab));
  }

  function setMoodboard(id: typeof moodboard.id) {
    designerStore.update((value) => selectMoodboard(value, id));
  }

  function setPreset(id: typeof designerState.fixturePreset) {
    designerStore.update((value) => selectFixturePreset(value, id));
  }

  function setFamily(family: ComponentFamily) {
    designerStore.update((value) => selectComponentFamily(value, family));
  }
</script>

<div class="designer-app nb-theme-scope nb-type-body" style={themeStyle}>
  <aside class="app-sidebar nb-panel-surface">
    <div class="sidebar-brand">
      <div class="sidebar-brand-row">
        <h1 class="sidebar-title nb-type-heading">Nearbytes</h1>
        <UiChip label={moodboard.label} tone="neutral" />
      </div>
    </div>

    <nav class="sidebar-nav">
      {#each tabs as tab}
        <button class:active={designerState.tab === tab.id} type="button" onclick={() => setTab(tab.id)}>
          {tab.label}
        </button>
      {/each}
    </nav>

    <div class="sidebar-footer">
      <p class="sidebar-label">Preset</p>
      <div class="preset-pills">
        {#each fixturePresets as preset}
          <button class:active={designerState.fixturePreset === preset.id} type="button" onclick={() => setPreset(preset.id)}>
            {preset.label}
          </button>
        {/each}
      </div>

      <div class="live-summary">
        <p class="sidebar-label">State</p>
        <UiChip label={activeGraphNode} tone="accent" />
      </div>
    </div>
  </aside>

  <main class="app-main">
    {#if designerState.tab === 'moodboards'}
      <section class="content-grid">
        {#each MOODBOARDS as board}
          <UiCard title={board.label}>
            {#snippet actions()}
              <UiButton label={designerState.moodboardId === board.id ? 'Selected' : 'Apply theme'} tone={designerState.moodboardId === board.id ? 'secondary' : 'primary'} onClick={() => setMoodboard(board.id)} />
            {/snippet}

            {#snippet body()}
              <div class="moodboard-card">
                <div
                  class="moodboard-scene"
                  style={`background:${board.palette.surfaceStrong}; box-shadow: inset 0 0 0 1px ${board.palette.border}, inset 0 -2.5rem 0 0 ${board.palette.canvas}, inset 4.25rem 0 0 0 ${board.palette.accentSoft};`}
                ></div>
                <p class="moodboard-tagline">{board.tagline}</p>
                <p class="moodboard-summary">{board.summary}</p>
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
    {:else if designerState.tab === 'typography'}
      <section class="content-solo">
        <UiCard title={moodboard.label}>
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
                    Hold what matters. Share it beautifully.
                  </div>
                </div>
              {/each}
            </div>
          {/snippet}
        </UiCard>
      </section>
    {:else if designerState.tab === 'palette'}
      <section class="content-solo">
        <UiCard title={moodboard.label}>
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
    {:else if designerState.tab === 'components'}
      <section class="content-solo">
        <UiCard title="Components">
          {#snippet body()}
            <div class="family-pills">
              {#each families as family}
                <button class:active={designerState.componentFamily === family} type="button" onclick={() => setFamily(family)}>{family}</button>
              {/each}
            </div>

            {#if designerState.componentFamily === 'primitives' || designerState.componentFamily === 'inputs'}
              <div class="component-grid">
                <UiButton label="Primary action" />
                <UiButton label="Secondary action" tone="secondary" />
                <UiButton label="Danger action" tone="danger" />
                <UiChip label="Accent chip" tone="accent" />
                <UiChip label="Warning chip" tone="warning" />
                <UiChip label="Success chip" tone="success" />
              </div>
            {/if}

            {#if designerState.componentFamily === 'display' || designerState.componentFamily === 'protocol'}
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

            {#if designerState.componentFamily === 'shell'}
              <div class="component-grid component-grid-wide">
                <div class="preview-desktop-frame">
                  <WorkspaceShell ui={designerState.workspace} data={fixtures} {capabilities} handlers={{ onAction: designerStore.dispatchSurfaceAction }} mode="desktop" />
                </div>
              </div>
            {/if}
          {/snippet}
        </UiCard>
      </section>
    {:else if designerState.tab === 'graph'}
      <section class="content-solo graph-tab">
        <UiCard title="State graph">
          {#snippet body()}
            <div class="graph-layout">
              <StateGraph
                nodes={graphLayout.nodes}
                edges={graphLayout.edges}
                width={graphLayout.width}
                height={graphLayout.height}
                layoutMode={graphLayoutMode}
                activeNodeId={activeGraphNode}
                selectedNodeId={selectedGraphNodeId}
                selectedEdgeId={selectedGraphEdgeId}
                onChangeLayout={(mode) => {
                  graphLayoutMode = mode;
                }}
                onSelectNode={(nodeId) => {
                  selectedGraphNodeId = nodeId;
                  selectedGraphEdgeId = null;
                  designerStore.setStructuralState(nodeId);
                }}
                onSelectEdge={(edgeId) => {
                  selectedGraphEdgeId = edgeId;
                  selectedGraphNodeId = null;
                }}
              />

              <aside class="graph-detail nb-panel-surface">
                {#if selectedGraphEdge}
                  <p class="graph-detail-kicker">Transition</p>
                  <h3>{selectedGraphEdge.label}</h3>
                  <p class="graph-detail-copy">{selectedGraphEdge.detail}</p>
                  <div class="graph-detail-grid">
                    <div>
                      <span>From</span>
                      <strong>{GRAPH_NODE_BY_ID[selectedGraphEdge.from].label}</strong>
                    </div>
                    <div>
                      <span>To</span>
                      <strong>{GRAPH_NODE_BY_ID[selectedGraphEdge.to].label}</strong>
                    </div>
                  </div>
                {:else}
                  <p class="graph-detail-kicker">State</p>
                  <h3>{selectedGraphNode.label}</h3>
                  <p class="graph-detail-copy">{selectedGraphNode.detail}</p>
                  <div class="graph-detail-grid">
                    <div>
                      <span>Layer</span>
                      <strong>{selectedGraphNode.layer}</strong>
                    </div>
                    <div>
                      <span>Row</span>
                      <strong>{selectedGraphNode.row}</strong>
                    </div>
                  </div>
                  <div class="graph-detail-notes">
                    {#each selectedGraphNode.notes as note}
                      <p>{note}</p>
                    {/each}
                  </div>
                {/if}
              </aside>
            </div>
          {/snippet}
        </UiCard>
      </section>
    {:else if designerState.tab === 'desktop'}
      <section class="content-solo">
        <div class="preview-desktop-frame">
          <WorkspaceShell ui={designerState.workspace} data={fixtures} {capabilities} handlers={{ onAction: designerStore.dispatchSurfaceAction }} mode="desktop" />
        </div>
      </section>
    {:else if designerState.tab === 'phone'}
      <section class="content-solo">
        <div class="preview-phone-frame">
          <WorkspaceShell ui={designerState.workspace} data={fixtures} {capabilities} handlers={{ onAction: designerStore.dispatchSurfaceAction }} mode="phone" />
        </div>
      </section>
    {/if}
  </main>
</div>
