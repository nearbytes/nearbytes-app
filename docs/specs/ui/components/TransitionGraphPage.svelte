<script lang="ts">
  import ELK from 'elkjs/lib/elk.bundled.js';
  import { get } from 'svelte/store';
  import { onMount } from 'svelte';
  import StudioRuntime from './StudioRuntime.svelte';
  import {
    createUiTransitionGraph,
    createUiTransitionSignature,
    formatUiTransitionInvocation,
    type UiTransitionGraphEdge,
    type UiTransitionGraphState,
    type UiTransitionState,
    type UiTransitionStore,
  } from '../uiTransitionStore.js';

  type GraphNodeLayout = UiTransitionGraphState & {
    x: number;
    y: number;
    width: number;
    height: number;
    chips: string[];
  };

  type GraphEdgeLayout = UiTransitionGraphEdge & {
    path: string;
    labelX: number;
    labelY: number;
  };

  type GraphLayout = {
    width: number;
    height: number;
    nodes: GraphNodeLayout[];
    edges: GraphEdgeLayout[];
  };

  type ElkLayoutSection = {
    startPoint?: { x: number; y: number };
    bendPoints?: Array<{ x: number; y: number }>;
    endPoint?: { x: number; y: number };
  };

  type ElkLayoutEdge = {
    id: string;
    sections?: ElkLayoutSection[];
  };

  type ElkLayoutResult = {
    width?: number;
    height?: number;
    children?: Array<{
      id: string;
      x?: number;
      y?: number;
      width?: number;
      height?: number;
    }>;
    edges?: ElkLayoutEdge[];
  };

  let {
    data,
    uiStore,
    studioState,
    onStudioStateChange = undefined,
  } = $props<{
    data: typeof import('../studio-data.js').STUDIO_DATA;
    uiStore: UiTransitionStore;
    studioState: Record<string, unknown>;
    onStudioStateChange?: ((patch: Record<string, unknown>) => Promise<void> | void) | undefined;
  }>();

  const graph = createUiTransitionGraph();
  const graphStateById = new Map(graph.states.map((state) => [state.id, state]));
  const graphStateBySignature = new Map(
    graph.states.map((state) => [createUiTransitionSignature(state.assignment), state])
  );
  const outgoingEdgesByState = new Map<string, UiTransitionGraphEdge[]>(
    graph.states.map((state) => [state.id, graph.edges.filter((edge) => edge.from === state.id)])
  );

  let machineState = $state<UiTransitionState>(graph.states[0]?.assignment ?? {
    showThemeDialog: false,
    themeDialogSection: 'preset',
    showPreviewPane: false,
    showResetDialog: false,
    showTimeMachinePanel: false,
    showTimelineDetailDialog: false,
    showSourcesPanel: false,
    showVolumeStoragePanel: false,
    showMountStorageDialog: false,
    showEventFlowPanel: false,
    showPhoneOverflowMenu: false,
    showIdentityManager: false,
    showCreateChooser: false,
    fileManagerViewMode: 'icons',
    searchQuery: '',
    sortBy: 'newest',
    showSpecDialog: false,
    showJoinVolumeDialog: false,
    showVolumeShareDialog: false,
  });
  let selectedNodeId = $state(graph.states[0]?.id ?? '');
  let selectedEdgeId = $state<string | null>(null);
  let previewPage = $state<'desktop' | 'phone'>('desktop');
  let layout = $state<GraphLayout>({
    width: 1600,
    height: 920,
    nodes: [],
    edges: [],
  });

  const activeHub = $derived.by(() => {
    const requestedHubId = typeof studioState.hubId === 'string' ? studioState.hubId : data.defaults.hubId;
    return data.hubs.find((hub) => hub.id === requestedHubId) ?? data.hubs[0];
  });

  const selectedNode = $derived.by(() => graphStateById.get(selectedNodeId) ?? null);
  const outgoingTransitions = $derived.by(() => outgoingEdgesByState.get(selectedNodeId) ?? []);

  const previewState = $derived.by(() => ({
    ...data.defaults,
    ...studioState,
    workspace: 'split',
    secondary: secondaryFromMachine(machineState),
    dialogSurface: activeModalFromMachine(machineState),
    storageMode: machineState.showSourcesPanel ? 'global' : 'volume',
    searchOpen: machineState.searchQuery.trim() !== '',
    timelineOpen: machineState.showTimeMachinePanel,
    phoneMenuOpen: machineState.showPhoneOverflowMenu,
    viewMode: machineState.fileManagerViewMode,
    stylesSearchText: machineState.searchQuery,
    stylesSortValue: styleSortValueFromMachine(machineState.sortBy),
    stylesSortOpen: false,
  }));

  const assignmentRows = $derived.by(() => [
    ['showThemeDialog', String(machineState.showThemeDialog)],
    ['themeDialogSection', machineState.themeDialogSection],
    ['showPreviewPane', String(machineState.showPreviewPane)],
    ['showResetDialog', String(machineState.showResetDialog)],
    ['showTimeMachinePanel', String(machineState.showTimeMachinePanel)],
    ['showTimelineDetailDialog', String(machineState.showTimelineDetailDialog)],
    ['showSourcesPanel', String(machineState.showSourcesPanel)],
    ['showVolumeStoragePanel', String(machineState.showVolumeStoragePanel)],
    ['showMountStorageDialog', String(machineState.showMountStorageDialog)],
    ['showEventFlowPanel', String(machineState.showEventFlowPanel)],
    ['showPhoneOverflowMenu', String(machineState.showPhoneOverflowMenu)],
    ['showIdentityManager', String(machineState.showIdentityManager)],
    ['showCreateChooser', String(machineState.showCreateChooser)],
    ['fileManagerViewMode', machineState.fileManagerViewMode],
    ['searchQuery', machineState.searchQuery || ''],
    ['sortBy', machineState.sortBy],
    ['showSpecDialog', String(machineState.showSpecDialog)],
    ['showJoinVolumeDialog', String(machineState.showJoinVolumeDialog)],
    ['showVolumeShareDialog', String(machineState.showVolumeShareDialog)],
  ]);

  function activeModalFromMachine(state: UiTransitionState): 'none' | 'share' | 'join' | 'create' | 'identity' | 'reset' {
    if (state.showVolumeShareDialog) return 'share';
    if (state.showJoinVolumeDialog) return 'join';
    if (state.showCreateChooser) return 'create';
    if (state.showIdentityManager) return 'identity';
    if (state.showResetDialog) return 'reset';
    return 'none';
  }

  function secondaryFromMachine(state: UiTransitionState): 'none' | 'locations' | 'flow' | 'identities' {
    if (state.showIdentityManager) return 'identities';
    if (state.showSourcesPanel || state.showVolumeStoragePanel) return 'locations';
    if (state.showEventFlowPanel) return 'flow';
    return 'none';
  }

  function styleSortValueFromMachine(sortBy: UiTransitionState['sortBy']): 'newest' | 'name' | 'protected' {
    if (sortBy === 'name' || sortBy === 'name-desc') return 'name';
    if (sortBy === 'size' || sortBy === 'size-asc') return 'protected';
    return 'newest';
  }

  function summarizeAssignment(state: UiTransitionState): string[] {
    const chips: string[] = [];
    if (state.showThemeDialog) chips.push(`theme:${state.themeDialogSection}`);
    if (state.showPreviewPane) chips.push('preview');
    if (state.showResetDialog) chips.push('reset');
    if (state.showTimeMachinePanel) chips.push('timeline');
    if (state.showTimelineDetailDialog) chips.push('timeline-detail');
    if (state.showSourcesPanel) chips.push('global-locations');
    if (state.showVolumeStoragePanel) chips.push('hub-storage');
    if (state.showMountStorageDialog) chips.push('hub-storage-dialog');
    if (state.showEventFlowPanel) chips.push('flow');
    if (state.showPhoneOverflowMenu) chips.push('phone-menu');
    if (state.showIdentityManager) chips.push('identity');
    if (state.showCreateChooser) chips.push('create');
    if (state.showJoinVolumeDialog) chips.push('join');
    if (state.showVolumeShareDialog) chips.push('share');
    if (state.showSpecDialog) chips.push('spec');
    if (state.fileManagerViewMode !== 'icons') chips.push(`view:${state.fileManagerViewMode}`);
    if (state.searchQuery.trim() !== '') chips.push(`search:${state.searchQuery}`);
    if (state.sortBy !== 'newest') chips.push(`sort:${state.sortBy}`);
    return chips.length > 0 ? chips : ['default'];
  }

  function toEdgePoints(section: {
    startPoint?: { x: number; y: number };
    bendPoints?: Array<{ x: number; y: number }>;
    endPoint?: { x: number; y: number };
  }): Array<{ x: number; y: number }> {
    const points: Array<{ x: number; y: number }> = [];
    if (section.startPoint) points.push(section.startPoint);
    if (Array.isArray(section.bendPoints)) points.push(...section.bendPoints);
    if (section.endPoint) points.push(section.endPoint);
    return points;
  }

  function edgePath(points: Array<{ x: number; y: number }>): string {
    return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
  }

  function edgeLabelPoint(points: Array<{ x: number; y: number }>): { x: number; y: number } {
    if (points.length === 0) return { x: 0, y: 0 };
    const middleIndex = Math.floor(points.length / 2);
    const point = points[middleIndex] ?? points[0];
    return { x: point.x, y: point.y - 12 };
  }

  function fallbackLayout(): GraphLayout {
    const nodes = graph.states.map((state, index) => {
      const column = index % 4;
      const row = Math.floor(index / 4);
      return {
        ...state,
        x: 80 + column * 320,
        y: 80 + row * 220,
        width: 240,
        height: 136,
        chips: summarizeAssignment(state.assignment),
      } satisfies GraphNodeLayout;
    });
    const nodesById = new Map(nodes.map((node) => [node.id, node]));
    const edges = graph.edges.map((edge) => {
      const from = nodesById.get(edge.from);
      const to = nodesById.get(edge.to);
      const points = from && to
        ? [
            { x: from.x + from.width, y: from.y + from.height / 2 },
            { x: to.x, y: to.y + to.height / 2 },
          ]
        : [];
      const labelPoint = edgeLabelPoint(points);
      return {
        ...edge,
        path: edgePath(points),
        labelX: labelPoint.x,
        labelY: labelPoint.y,
      } satisfies GraphEdgeLayout;
    });
    return { width: 1360, height: 1220, nodes, edges };
  }

  async function buildLayout(): Promise<void> {
    const elk = new ELK();
    try {
      const result = await elk.layout({
        id: 'nearbytes-ui-transition-graph',
        layoutOptions: {
          'elk.algorithm': 'layered',
          'elk.direction': 'RIGHT',
          'elk.edgeRouting': 'ORTHOGONAL',
          'elk.layered.spacing.nodeNodeBetweenLayers': '120',
          'elk.spacing.nodeNode': '72',
          'elk.padding': '[top=48,left=48,bottom=48,right=48]',
        },
        children: graph.states.map((state) => ({ id: state.id, width: 240, height: 136 })),
        edges: graph.edges.map((edge) => ({
          id: edge.id,
          sources: [edge.from],
          targets: [edge.to],
          labels: [{
            id: `${edge.id}:label`,
            text: edge.label,
            width: Math.min(240, Math.max(96, edge.label.length * 7)),
            height: 24,
          }],
        })),
      }) as ElkLayoutResult;

      const nodes = (result.children ?? []).map((node) => {
        const source = graphStateById.get(node.id);
        if (!source) throw new Error(`Missing graph state ${node.id}`);
        return {
          ...source,
          x: node.x ?? 0,
          y: node.y ?? 0,
          width: node.width ?? 240,
          height: node.height ?? 136,
          chips: summarizeAssignment(source.assignment),
        } satisfies GraphNodeLayout;
      });

      const edges = (result.edges ?? []).map((edge) => {
        const source = graph.edges.find((entry) => entry.id === edge.id);
        if (!source) throw new Error(`Missing graph edge ${edge.id}`);
        const section = edge.sections?.[0];
        const points = section ? toEdgePoints(section) : [];
        const labelPoint = edgeLabelPoint(points);
        return {
          ...source,
          path: edgePath(points),
          labelX: labelPoint.x,
          labelY: labelPoint.y,
        } satisfies GraphEdgeLayout;
      });

      layout = {
        width: Math.max(1320, (result.width ?? 1320) + 96),
        height: Math.max(900, (result.height ?? 900) + 96),
        nodes,
        edges,
      };
    } catch (error) {
      console.warn('Failed to auto-layout transition graph, using fallback positions.', error);
      layout = fallbackLayout();
    }
  }

  function selectNode(nodeId: string): void {
    const nextState = graphStateById.get(nodeId);
    if (!nextState) return;
    selectedNodeId = nodeId;
    selectedEdgeId = null;
    uiStore.replaceState(nextState.assignment);
  }

  function invokeEdge(edge: UiTransitionGraphEdge): void {
    selectedEdgeId = edge.id;
    uiStore.transitions.dispatch(edge.invocation);
    selectedNodeId = edge.to;
  }

  function handleNodeKeydown(event: KeyboardEvent, nodeId: string): void {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }
    event.preventDefault();
    selectNode(nodeId);
  }

  function handleEdgeKeydown(event: KeyboardEvent, edge: UiTransitionGraphEdge): void {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }
    event.preventDefault();
    invokeEdge(edge);
  }

  async function patchStudioState(patch: Record<string, unknown>): Promise<void> {
    await onStudioStateChange?.(patch);
  }

  $effect(() => {
    machineState = get(uiStore);
    const unsubscribe = uiStore.subscribe((value) => {
      machineState = value;
    });
    return () => {
      unsubscribe();
    };
  });

  $effect(() => {
    const matchedState = graphStateBySignature.get(createUiTransitionSignature(machineState));
    if (!matchedState) return;
    selectedNodeId = matchedState.id;
  });

  onMount(() => {
    void buildLayout();
  });
</script>

<section class="graph-shell">
  <div class="graph-hero">
    <div>
      <p class="eyebrow">UI transition graph</p>
      <h1>Forced writes through labelled transitions</h1>
      <p class="graph-copy">Each node is one concrete assignment of the shared UI machine. Each edge is one invocation the app is allowed to call.</p>
    </div>
    <div class="graph-hero-actions">
      <button type="button" class="graph-action-btn" onclick={() => selectNode('workspace-idle')}>Reset to workspace idle</button>
      <button type="button" class="graph-action-btn subtle" onclick={() => void buildLayout()}>Re-run auto-layout</button>
    </div>
  </div>

  <div class="graph-grid">
    <section class="graph-stage panel-surface">
      <div class="graph-stage-head">
        <div>
          <p class="eyebrow">Labelled transition system</p>
          <strong>{layout.nodes.length} states · {layout.edges.length} invocations</strong>
        </div>
        <p class="graph-stage-note">Click a state to assign the store. Click an edge to invoke the transition.</p>
      </div>
      <div class="graph-canvas-scroll">
        <svg class="graph-canvas" viewBox={`0 0 ${layout.width} ${layout.height}`} role="img" aria-label="Nearbytes UI transition graph">
          <defs>
            <marker id="graph-arrow" markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto">
              <path d="M 0 0 L 12 6 L 0 12 z" fill="rgba(25, 64, 92, 0.5)"></path>
            </marker>
          </defs>

          {#each layout.edges as edge}
            <path d={edge.path} class="graph-edge-hit"></path>
            <path d={edge.path} class="graph-edge" class:selected={selectedEdgeId === edge.id} marker-end="url(#graph-arrow)"></path>
            <g
              class="graph-edge-label"
              transform={`translate(${edge.labelX}, ${edge.labelY})`}
              role="button"
              tabindex="0"
              aria-label={`Invoke ${edge.label}`}
              onclick={() => invokeEdge(edge)}
              onkeydown={(event) => handleEdgeKeydown(event, edge)}
            >
              <rect x="-80" y="-12" width="160" height="24" rx="12"></rect>
              <text text-anchor="middle" dominant-baseline="central">{edge.label}</text>
            </g>
          {/each}

          {#each layout.nodes as node}
            <g
              class="graph-node"
              class:selected={selectedNodeId === node.id}
              transform={`translate(${node.x}, ${node.y})`}
              role="button"
              tabindex="0"
              aria-label={`Assign state ${node.title}`}
              onclick={() => selectNode(node.id)}
              onkeydown={(event) => handleNodeKeydown(event, node.id)}
            >
              <rect width={node.width} height={node.height} rx="24"></rect>
              <text x="20" y="28" class="graph-node-title">{node.title}</text>
              <text x="20" y="50" class="graph-node-note">{node.note}</text>
              {#each node.chips.slice(0, 4) as chip, index}
                <g transform={`translate(${20 + (index % 2) * 100}, ${78 + Math.floor(index / 2) * 26})`}>
                  <rect width="88" height="18" rx="9" class="graph-node-chip"></rect>
                  <text x="44" y="9" text-anchor="middle" dominant-baseline="central" class="graph-node-chip-text">{chip}</text>
                </g>
              {/each}
            </g>
          {/each}
        </svg>
      </div>
    </section>

    <aside class="graph-sidebar">
      <section class="graph-panel panel-surface">
        <div class="graph-panel-head">
          <div>
            <p class="eyebrow">Selection</p>
            <strong>{selectedNode?.title ?? 'No state selected'}</strong>
          </div>
          {#if selectedNode}
            <span class="graph-state-id">{selectedNode.id}</span>
          {/if}
        </div>
        {#if selectedNode}
          <p class="graph-note">{selectedNode.note}</p>
          <div class="graph-chip-row">
            {#each summarizeAssignment(selectedNode.assignment) as chip}
              <span class="graph-chip">{chip}</span>
            {/each}
          </div>
        {/if}
        <div class="graph-transition-list">
          {#each outgoingTransitions as edge}
            <button type="button" class="graph-transition-btn" class:selected={selectedEdgeId === edge.id} onclick={() => invokeEdge(edge)}>
              <strong>{formatUiTransitionInvocation(edge.invocation)}</strong>
              <span>to {graphStateById.get(edge.to)?.title ?? edge.to}</span>
            </button>
          {/each}
        </div>
      </section>

      <section class="graph-panel panel-surface">
        <div class="graph-panel-head">
          <div>
            <p class="eyebrow">Assignment</p>
            <strong>Current machine state</strong>
          </div>
        </div>
        <div class="graph-assignment-table">
          {#each assignmentRows as [key, value]}
            <div class="graph-assignment-row">
              <span>{key}</span>
              <code>{value === '' ? '""' : value}</code>
            </div>
          {/each}
        </div>
      </section>

      <section class="graph-panel panel-surface">
        <div class="graph-panel-head">
          <div>
            <p class="eyebrow">Preview controls</p>
            <strong>Interactive shell preview</strong>
          </div>
        </div>
        <div class="graph-control-block">
          <label>
            <span>Preview shell</span>
            <div class="graph-segment-row">
              <button type="button" class="graph-segment-btn" class:active={previewPage === 'desktop'} onclick={() => (previewPage = 'desktop')}>Desktop</button>
              <button type="button" class="graph-segment-btn" class:active={previewPage === 'phone'} onclick={() => (previewPage = 'phone')}>Phone</button>
            </div>
          </label>

          <label>
            <span>Moodboard</span>
            <select value={String(studioState.moodboardId ?? data.defaults.moodboardId)} onchange={(event) => void patchStudioState({ moodboardId: (event.currentTarget as HTMLSelectElement).value })}>
              {#each data.moodboards as moodboard}
                <option value={moodboard.id}>{moodboard.name}</option>
              {/each}
            </select>
          </label>

          <label>
            <span>Hub story</span>
            <select value={String(studioState.hubId ?? data.defaults.hubId)} onchange={(event) => void patchStudioState({ hubId: (event.currentTarget as HTMLSelectElement).value })}>
              {#each data.hubs as hub}
                <option value={hub.id}>{hub.name}</option>
              {/each}
            </select>
          </label>
        </div>
      </section>

      <section class="graph-panel panel-surface graph-preview-panel">
        <div class="graph-panel-head">
          <div>
            <p class="eyebrow">Preview</p>
            <strong>{previewPage === 'desktop' ? 'Desktop shell' : 'Phone shell'}</strong>
          </div>
          <span class="graph-state-id">{summarizeAssignment(machineState).length} active markers</span>
        </div>

        <div class="graph-chip-row compact">
          {#each summarizeAssignment(machineState) as chip}
            <span class="graph-chip surface">{chip}</span>
          {/each}
          {#if machineState.showThemeDialog}
            <span class="graph-chip accent">appearance:{machineState.themeDialogSection}</span>
          {/if}
        </div>

        <div class="graph-preview-shell">
          <StudioRuntime
            page={previewPage}
            {data}
            studioState={previewState}
            uiState={previewState}
            onPatchState={patchStudioState}
          />
          {#if machineState.showThemeDialog}
            <div class="graph-preview-overlay">
              <p class="eyebrow">Appearance</p>
              <strong>{machineState.themeDialogSection} section</strong>
              <span>Theme dialog state is active in the machine, but the shared runtime does not expose that modal yet.</span>
            </div>
          {/if}
        </div>
      </section>
    </aside>
  </div>
</section>

<style>
  .graph-shell {
    display: grid;
    gap: 1rem;
  }

  .graph-hero,
  .graph-stage-head,
  .graph-panel-head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 1rem;
  }

  .graph-hero {
    padding: 1.2rem 1.25rem;
    border-radius: var(--radius-xl);
    background:
      linear-gradient(135deg, color-mix(in srgb, var(--paper) 92%, white 8%), color-mix(in srgb, var(--panel) 96%, var(--accent-soft) 4%)),
      radial-gradient(circle at top right, var(--accent-soft), transparent 58%);
    border: 1px solid var(--line);
    box-shadow: var(--shadow-md);
  }

  .graph-hero h1,
  .graph-copy,
  .graph-note {
    margin: 0;
  }

  .graph-hero h1 {
    font-family: var(--font-display);
    font-size: clamp(1.6rem, 2vw, 2.25rem);
    line-height: 1.05;
    color: var(--ink);
  }

  .graph-copy {
    margin-top: 0.35rem;
    max-width: 52rem;
    color: var(--muted);
    line-height: 1.5;
  }

  .graph-hero-actions {
    display: flex;
    gap: 0.6rem;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .graph-action-btn,
  .graph-transition-btn,
  .graph-segment-btn {
    appearance: none;
    font: inherit;
    cursor: pointer;
    transition: transform 0.18s ease, border-color 0.18s ease, background 0.18s ease;
  }

  .graph-action-btn {
    min-height: 36px;
    padding: 0 0.9rem;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--accent) 18%, var(--line) 82%);
    background: color-mix(in srgb, var(--paper) 94%, white 6%);
    color: var(--ink);
  }

  .graph-action-btn.subtle {
    background: transparent;
  }

  .graph-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.8fr) minmax(360px, 0.95fr);
    gap: 1rem;
    align-items: start;
  }

  .graph-stage,
  .graph-panel {
    padding: 1rem;
    border-radius: var(--radius-xl);
    border: 1px solid var(--line);
    background: color-mix(in srgb, var(--paper) 96%, white 4%);
    box-shadow: var(--shadow-md);
  }

  .graph-stage-note,
  .graph-state-id,
  .graph-assignment-row span,
  .graph-control-block span,
  .graph-preview-overlay span {
    color: var(--muted);
  }

  .graph-state-id {
    font-family: var(--font-mono);
    font-size: 0.72rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .graph-canvas-scroll {
    overflow: auto;
    border-radius: var(--radius-lg);
    border: 1px solid var(--line);
    background: linear-gradient(180deg, color-mix(in srgb, var(--paper) 98%, white 2%), color-mix(in srgb, var(--panel) 94%, white 6%));
  }

  .graph-canvas {
    display: block;
    min-width: 100%;
  }

  .graph-edge {
    fill: none;
    stroke: rgba(25, 64, 92, 0.38);
    stroke-width: 3;
  }

  .graph-edge.selected {
    stroke: var(--accent-strong);
    stroke-width: 4;
  }

  .graph-edge-hit {
    fill: none;
    stroke: transparent;
    stroke-width: 18;
    cursor: pointer;
  }

  .graph-edge-label rect {
    fill: color-mix(in srgb, var(--paper) 92%, white 8%);
    stroke: color-mix(in srgb, var(--accent) 14%, var(--line) 86%);
  }

  .graph-edge-label text {
    fill: var(--ink);
    font-size: 11px;
    font-family: var(--font-mono);
    cursor: pointer;
  }

  .graph-node {
    cursor: pointer;
  }

  .graph-node rect {
    fill: color-mix(in srgb, var(--paper) 92%, white 8%);
    stroke: color-mix(in srgb, var(--line) 88%, var(--accent-soft) 12%);
    stroke-width: 1.5;
    transition: fill 0.18s ease, stroke 0.18s ease, transform 0.18s ease;
  }

  .graph-node.selected rect {
    fill: color-mix(in srgb, var(--accent-soft) 42%, var(--paper) 58%);
    stroke: var(--accent-strong);
    stroke-width: 2;
  }

  .graph-node-title {
    fill: var(--ink);
    font-weight: 700;
    font-size: 15px;
  }

  .graph-node-note {
    fill: var(--muted);
    font-size: 11px;
  }

  .graph-node-chip {
    fill: color-mix(in srgb, var(--paper) 94%, white 6%);
    stroke: color-mix(in srgb, var(--accent) 14%, var(--line) 86%);
  }

  .graph-node-chip-text {
    fill: var(--ink);
    font-size: 10px;
    font-family: var(--font-mono);
  }

  .graph-sidebar {
    display: grid;
    gap: 1rem;
  }

  .graph-transition-list,
  .graph-assignment-table,
  .graph-control-block {
    display: grid;
    gap: 0.65rem;
  }

  .graph-transition-btn {
    display: grid;
    gap: 0.18rem;
    padding: 0.8rem 0.9rem;
    border-radius: var(--radius-md);
    border: 1px solid var(--line);
    background: color-mix(in srgb, var(--paper) 96%, white 4%);
    text-align: left;
  }

  .graph-transition-btn strong {
    color: var(--ink);
    font-size: 0.86rem;
  }

  .graph-transition-btn span {
    color: var(--muted);
    font-size: 0.75rem;
  }

  .graph-transition-btn.selected,
  .graph-transition-btn:hover {
    transform: translateY(-1px);
    border-color: color-mix(in srgb, var(--accent) 26%, var(--line) 74%);
    background: color-mix(in srgb, var(--accent-soft) 30%, var(--paper) 70%);
  }

  .graph-chip-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
    margin-top: 0.75rem;
  }

  .graph-chip {
    display: inline-flex;
    align-items: center;
    min-height: 26px;
    padding: 0 0.7rem;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--accent) 16%, var(--line) 84%);
    background: color-mix(in srgb, var(--paper) 92%, white 8%);
    color: var(--ink);
    font-size: 0.72rem;
    font-family: var(--font-mono);
  }

  .graph-chip.surface {
    font-family: var(--font-body);
  }

  .graph-chip.accent {
    background: color-mix(in srgb, var(--accent-soft) 42%, var(--paper) 58%);
  }

  .graph-assignment-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 0.6rem;
    align-items: center;
    padding: 0.55rem 0.7rem;
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--paper) 94%, white 6%);
    border: 1px solid color-mix(in srgb, var(--line) 90%, white 10%);
  }

  .graph-assignment-row code {
    color: var(--ink);
    font-size: 0.74rem;
    font-family: var(--font-mono);
  }

  .graph-control-block label {
    display: grid;
    gap: 0.35rem;
  }

  .graph-control-block select {
    min-height: 38px;
    border-radius: 14px;
    border: 1px solid var(--line);
    background: color-mix(in srgb, var(--paper) 96%, white 4%);
    color: var(--ink);
    font: inherit;
    padding: 0 0.8rem;
  }

  .graph-segment-row {
    display: flex;
    gap: 0.5rem;
  }

  .graph-segment-btn {
    flex: 1 1 0;
    min-height: 36px;
    border-radius: 999px;
    border: 1px solid var(--line);
    background: color-mix(in srgb, var(--paper) 96%, white 4%);
    color: var(--muted);
  }

  .graph-segment-btn.active {
    border-color: color-mix(in srgb, var(--accent) 26%, var(--line) 74%);
    background: color-mix(in srgb, var(--accent-soft) 32%, var(--paper) 68%);
    color: var(--ink);
  }

  .graph-preview-shell {
    position: relative;
    overflow: hidden;
    border-radius: var(--radius-lg);
    border: 1px solid var(--line);
    background: var(--bg);
    min-height: 480px;
  }

  .graph-preview-shell :global(.studio-shell),
  .graph-preview-shell :global(.phone-shell) {
    margin: 0;
    box-shadow: none;
    max-width: none;
  }

  .graph-preview-overlay {
    position: absolute;
    right: 1rem;
    top: 1rem;
    max-width: 240px;
    display: grid;
    gap: 0.2rem;
    padding: 0.8rem 0.9rem;
    border-radius: 18px;
    border: 1px solid color-mix(in srgb, var(--accent) 18%, var(--line) 82%);
    background: color-mix(in srgb, var(--paper) 90%, white 10%);
    box-shadow: var(--shadow-md);
  }

  @media (max-width: 1280px) {
    .graph-grid {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 720px) {
    .graph-hero,
    .graph-stage-head,
    .graph-panel-head {
      flex-direction: column;
    }

    .graph-hero-actions,
    .graph-segment-row {
      width: 100%;
    }

    .graph-action-btn,
    .graph-segment-btn {
      flex: 1 1 0;
      justify-content: center;
    }
  }
</style>
