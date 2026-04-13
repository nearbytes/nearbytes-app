<script lang="ts">
  import { onMount } from 'svelte';
  import { Focus, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-svelte';
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
  import type {
    ComponentFamily,
    DesignerTab,
    GraphNodeId,
    MoodboardId,
    OverlayKind,
    WorkspacePaneMode,
  } from './lib/state/types.js';
  import type { GraphLayoutMode } from './lib/state/graph.js';

  const MOODBOARD_STORAGE_KEY = 'nearbytes.uiDesigner.moodboardId';

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
  const paneModes: Array<{ id: WorkspacePaneMode; label: string }> = [
    { id: 'balanced', label: 'Balanced' },
    { id: 'files-focus', label: 'Files focus' },
    { id: 'chat-focus', label: 'Chat focus' },
  ];
  const overlays: Array<{ id: Exclude<OverlayKind, 'none'>; label: string }> = [
    { id: 'join', label: 'Join' },
    { id: 'share', label: 'Share' },
    { id: 'identity', label: 'Identity' },
    { id: 'create', label: 'Create' },
    { id: 'sources', label: 'Sources' },
    { id: 'storage', label: 'Storage' },
    { id: 'hub-storage', label: 'Hub storage' },
    { id: 'event-flow', label: 'Event flow' },
    { id: 'timeline-detail', label: 'Timeline detail' },
    { id: 'reset', label: 'Reset' },
  ];

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
  let sidebarVisible = $state(true);
  let inspectorVisible = $state(true);
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
  const selectedFileName = $derived(
    fixtures.files.find((file) => file.id === designerState.workspace.selectedFileId)?.name ?? 'No file selected'
  );
  const selectedEventTitle = $derived(
    fixtures.events.find((event) => event.id === designerState.workspace.selectedEventId)?.title ?? 'No event selected'
  );
  const uiFocusActive = $derived(!sidebarVisible && !inspectorVisible);
  const focusButtonTitle = $derived(uiFocusActive ? 'Exit focus mode (F)' : 'Focus preview (F)');

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

  function setPaneMode(paneMode: WorkspacePaneMode) {
    designerStore.dispatchSurfaceAction({ type: 'set-pane-mode', paneMode });
  }

  function togglePreview() {
    designerStore.dispatchSurfaceAction({ type: 'toggle-preview' });
  }

  function toggleTimeline() {
    designerStore.dispatchSurfaceAction({ type: 'toggle-timeline' });
  }

  function openOverlay(overlay: Exclude<OverlayKind, 'none'>) {
    designerStore.dispatchSurfaceAction({ type: 'open-overlay', overlay });
  }

  function closeOverlay() {
    designerStore.dispatchSurfaceAction({ type: 'close-overlay' });
  }

  function toggleSidebar() {
    sidebarVisible = !sidebarVisible;
  }

  function toggleInspector() {
    inspectorVisible = !inspectorVisible;
  }

  function toggleUiFocus() {
    if (uiFocusActive) {
      sidebarVisible = true;
      inspectorVisible = true;
      return;
    }

    sidebarVisible = false;
    inspectorVisible = false;
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    const target = event.target;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    ) {
      return;
    }

    if (event.key.toLowerCase() === 'f' && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      toggleUiFocus();
    }
  }

  onMount(() => {
    try {
      const storedId = localStorage.getItem(MOODBOARD_STORAGE_KEY);
      if (storedId && storedId in MOODBOARD_BY_ID) {
        designerStore.update((value) => selectMoodboard(value, storedId as MoodboardId));
      }
    } catch {
      // Ignore storage access errors in restricted browser contexts.
    }

    window.addEventListener('keydown', handleWindowKeydown);

    return () => {
      window.removeEventListener('keydown', handleWindowKeydown);
    };
  });

  $effect(() => {
    try {
      localStorage.setItem(MOODBOARD_STORAGE_KEY, designerState.moodboardId);
    } catch {
      // Ignore storage access errors in restricted browser contexts.
    }
  });
</script>

<div class:ui-focus={uiFocusActive} class:sidebar-collapsed={!sidebarVisible} class="designer-app nb-theme-scope nb-type-body" style={themeStyle}>
  <button
    type="button"
    class:active={uiFocusActive}
    class="floating-focus-button"
    title={focusButtonTitle}
    aria-label={focusButtonTitle}
    aria-keyshortcuts="F"
    onclick={toggleUiFocus}
  >
    <Focus size={16} />
  </button>

  {#if !sidebarVisible && !uiFocusActive}
    <button
      type="button"
      class="edge-toggle edge-toggle-left"
      title="Show left panel"
      aria-label="Show left panel"
      onclick={toggleSidebar}
    >
      <PanelLeftOpen size={16} />
    </button>
  {/if}

  <aside class:hidden={!sidebarVisible} class="app-sidebar nb-panel-surface">
    <div class="sidebar-brand">
      <div class="sidebar-brand-row">
        <h1 class="sidebar-title nb-type-heading">Nearbytes</h1>
        <div class="sidebar-brand-actions">
          <UiChip label={moodboard.label} tone="neutral" />
          <button
            type="button"
            class="panel-collapse-button"
            title="Hide left panel"
            aria-label="Hide left panel"
            onclick={toggleSidebar}
          >
            <PanelLeftClose size={16} />
          </button>
        </div>
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
      <section class="content-grid moodboards-grid">
        {#each MOODBOARDS as board}
          <UiCard title={board.label}>
            {#snippet actions()}
              <UiButton label={designerState.moodboardId === board.id ? 'Selected' : 'Apply theme'} tone={designerState.moodboardId === board.id ? 'secondary' : 'primary'} onClick={() => setMoodboard(board.id)} />
            {/snippet}

            {#snippet body()}
              <div class="moodboard-card">
                <div
                  class="moodboard-scene"
                  style={`--scene-canvas:${board.palette.canvas}; --scene-surface:${board.palette.surfaceStrong}; --scene-accent-soft:${board.palette.accentSoft}; --scene-accent:${board.palette.accent}; --scene-border:${board.palette.border}; --scene-text:${board.palette.text};`}
                >
                  <div class="moodboard-scene-topbar">
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                  <div class="moodboard-scene-body">
                    <div class="moodboard-scene-sidebar"></div>
                    <div class="moodboard-scene-main">
                      <div class="moodboard-scene-card moodboard-scene-card-hero"></div>
                      <div class="moodboard-scene-row">
                        <div class="moodboard-scene-card moodboard-scene-card-accent"></div>
                        <div class="moodboard-scene-card"></div>
                      </div>
                    </div>
                  </div>
                </div>
                <div class="moodboard-copy-block">
                  <p class="moodboard-tagline">{board.tagline}</p>
                  <p class="moodboard-summary">{board.summary}</p>
                </div>
                <div class="moodboard-footer">
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
      <section class="content-solo palette-tab">
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
                  <h3>{selectedGraphEdge.label}</h3>
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
                  <h3>{selectedGraphNode.label}</h3>
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
                {/if}
              </aside>
            </div>
          {/snippet}
        </UiCard>
      </section>
    {:else if designerState.tab === 'desktop'}
      <section class="content-solo viewport-surface-tab">
        <div class="viewport-layout">
          <div class="preview-desktop-frame">
            <WorkspaceShell ui={designerState.workspace} data={fixtures} {capabilities} handlers={{ onAction: designerStore.dispatchSurfaceAction }} mode="desktop" />
          </div>

          {#if !inspectorVisible && !uiFocusActive}
            <button
              type="button"
              class="edge-toggle edge-toggle-right"
              title="Show preview controls"
              aria-label="Show preview controls"
              onclick={toggleInspector}
            >
              <PanelRightOpen size={16} />
            </button>
          {/if}

          <aside class:hidden={!inspectorVisible} class="viewport-detail nb-panel-surface">
            <div class="viewport-detail-header">
              <div>
                <h3>Desktop controls</h3>
              </div>
              <button
                type="button"
                class="panel-collapse-button"
                title="Hide preview controls"
                aria-label="Hide preview controls"
                onclick={toggleInspector}
              >
                <PanelRightClose size={16} />
              </button>
            </div>

            <div class="viewport-detail-section">
              <p class="viewport-detail-label">Current state</p>
              <div class="viewport-detail-chips">
                <UiChip label={activeGraphNode} tone="accent" />
                <UiChip label={designerState.workspace.overlay === 'none' ? 'no overlay' : designerState.workspace.overlay} tone="neutral" />
                <UiChip label={designerState.workspace.showPreview ? 'preview open' : 'preview closed'} tone="neutral" />
                <UiChip label={designerState.workspace.showTimeline ? 'timeline open' : 'timeline closed'} tone="neutral" />
              </div>
              <div class="viewport-detail-copy">
                <p>Selected file: {selectedFileName}</p>
                <p>Selected event: {selectedEventTitle}</p>
              </div>
            </div>

            <div class="viewport-detail-section">
              <p class="viewport-detail-label">Pane layout</p>
              <div class="viewport-detail-actions">
                {#each paneModes as paneMode}
                  <UiButton
                    label={paneMode.label}
                    tone={designerState.workspace.paneMode === paneMode.id ? 'primary' : 'secondary'}
                    onClick={() => setPaneMode(paneMode.id)}
                  />
                {/each}
              </div>
            </div>

            <div class="viewport-detail-section">
              <p class="viewport-detail-label">Panels</p>
              <div class="viewport-detail-actions">
                <UiButton
                  label={designerState.workspace.showPreview ? 'Hide preview panel' : 'Show preview panel'}
                  tone={designerState.workspace.showPreview ? 'primary' : 'secondary'}
                  onClick={togglePreview}
                />
                <UiButton
                  label={designerState.workspace.showTimeline ? 'Hide timeline panel' : 'Show timeline panel'}
                  tone={designerState.workspace.showTimeline ? 'primary' : 'secondary'}
                  onClick={toggleTimeline}
                />
              </div>
            </div>

            <div class="viewport-detail-section">
              <p class="viewport-detail-label">Overlays</p>
              <div class="viewport-detail-actions">
                {#each overlays as overlay}
                  <UiButton
                    label={overlay.label}
                    tone={designerState.workspace.overlay === overlay.id ? 'primary' : 'secondary'}
                    onClick={() => openOverlay(overlay.id)}
                  />
                {/each}
                <UiButton
                  label="Close overlay"
                  tone="secondary"
                  disabled={designerState.workspace.overlay === 'none'}
                  onClick={closeOverlay}
                />
              </div>
            </div>
          </aside>
        </div>
      </section>
    {:else if designerState.tab === 'phone'}
      <section class="content-solo viewport-surface-tab">
        <div class="viewport-layout viewport-layout-phone">
          <div class="preview-phone-frame">
            <WorkspaceShell ui={designerState.workspace} data={fixtures} {capabilities} handlers={{ onAction: designerStore.dispatchSurfaceAction }} mode="phone" />
          </div>

          {#if !inspectorVisible && !uiFocusActive}
            <button
              type="button"
              class="edge-toggle edge-toggle-right"
              title="Show preview controls"
              aria-label="Show preview controls"
              onclick={toggleInspector}
            >
              <PanelRightOpen size={16} />
            </button>
          {/if}

          <aside class:hidden={!inspectorVisible} class="viewport-detail nb-panel-surface">
            <div class="viewport-detail-header">
              <div>
                <h3>Phone controls</h3>
              </div>
              <button
                type="button"
                class="panel-collapse-button"
                title="Hide preview controls"
                aria-label="Hide preview controls"
                onclick={toggleInspector}
              >
                <PanelRightClose size={16} />
              </button>
            </div>

            <div class="viewport-detail-section">
              <p class="viewport-detail-label">Current state</p>
              <div class="viewport-detail-chips">
                <UiChip label={activeGraphNode} tone="accent" />
                <UiChip label={designerState.workspace.overlay === 'none' ? 'no overlay' : designerState.workspace.overlay} tone="neutral" />
                <UiChip label={designerState.workspace.showPreview ? 'preview open' : 'preview closed'} tone="neutral" />
                <UiChip label={designerState.workspace.showTimeline ? 'timeline open' : 'timeline closed'} tone="neutral" />
              </div>
              <div class="viewport-detail-copy">
                <p>Selected file: {selectedFileName}</p>
                <p>Selected event: {selectedEventTitle}</p>
              </div>
            </div>

            <div class="viewport-detail-section">
              <p class="viewport-detail-label">Pane layout</p>
              <div class="viewport-detail-actions">
                {#each paneModes as paneMode}
                  <UiButton
                    label={paneMode.label}
                    tone={designerState.workspace.paneMode === paneMode.id ? 'primary' : 'secondary'}
                    onClick={() => setPaneMode(paneMode.id)}
                  />
                {/each}
              </div>
            </div>

            <div class="viewport-detail-section">
              <p class="viewport-detail-label">Panels</p>
              <div class="viewport-detail-actions">
                <UiButton
                  label={designerState.workspace.showPreview ? 'Hide preview panel' : 'Show preview panel'}
                  tone={designerState.workspace.showPreview ? 'primary' : 'secondary'}
                  onClick={togglePreview}
                />
                <UiButton
                  label={designerState.workspace.showTimeline ? 'Hide timeline panel' : 'Show timeline panel'}
                  tone={designerState.workspace.showTimeline ? 'primary' : 'secondary'}
                  onClick={toggleTimeline}
                />
              </div>
            </div>

            <div class="viewport-detail-section">
              <p class="viewport-detail-label">Overlays</p>
              <div class="viewport-detail-actions">
                {#each overlays as overlay}
                  <UiButton
                    label={overlay.label}
                    tone={designerState.workspace.overlay === overlay.id ? 'primary' : 'secondary'}
                    onClick={() => openOverlay(overlay.id)}
                  />
                {/each}
                <UiButton
                  label="Close overlay"
                  tone="secondary"
                  disabled={designerState.workspace.overlay === 'none'}
                  onClick={closeOverlay}
                />
              </div>
            </div>
          </aside>
        </div>
      </section>
    {/if}
  </main>
</div>
