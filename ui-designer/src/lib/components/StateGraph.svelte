<script lang="ts">
  import type { GraphLayoutMode, LaidOutGraphEdge, LaidOutGraphNode } from '../state/graph.js';
  import type { GraphNodeId } from '../state/types.js';

  let {
    nodes,
    edges,
    width,
    height,
    layoutMode = 'planar',
    activeNodeId,
    selectedNodeId = null,
    selectedEdgeId = null,
    onSelectNode,
    onSelectEdge,
    onChangeLayout,
  } = $props<{
    nodes: LaidOutGraphNode[];
    edges: LaidOutGraphEdge[];
    width: number;
    height: number;
    layoutMode?: GraphLayoutMode;
    activeNodeId: GraphNodeId;
    selectedNodeId?: GraphNodeId | null;
    selectedEdgeId?: string | null;
    onSelectNode?: ((nodeId: GraphNodeId) => void) | undefined;
    onSelectEdge?: ((edgeId: string) => void) | undefined;
    onChangeLayout?: ((mode: GraphLayoutMode) => void) | undefined;
  }>();

  let scale = $state(1);
  let offsetX = $state(0);
  let offsetY = $state(0);
  let viewportWidth = $state(0);
  let viewportHeight = $state(0);
  let dragOrigin = $state<{ x: number; y: number; offsetX: number; offsetY: number; pointerId: number } | null>(null);
  let hasInteracted = $state(false);
  let hoveredEdgeId = $state<string | null>(null);

  function clampScale(value: number): number {
    return Math.min(2.6, Math.max(0.42, value));
  }

  function zoomAt(clientX: number, clientY: number, nextScale: number) {
    if (viewportWidth <= 0 || viewportHeight <= 0) {
      scale = clampScale(nextScale);
      return;
    }
    const clampedScale = clampScale(nextScale);
    const graphX = (clientX - offsetX) / scale;
    const graphY = (clientY - offsetY) / scale;
    scale = clampedScale;
    offsetX = clientX - graphX * scale;
    offsetY = clientY - graphY * scale;
  }

  function fitToView() {
    if (viewportWidth <= 0 || viewportHeight <= 0) {
      return;
    }
    const horizontalPadding = 64;
    const verticalPadding = 52;
    const nextScale = clampScale(
      Math.min(
        (viewportWidth - horizontalPadding * 2) / width,
        (viewportHeight - verticalPadding * 2) / height
      )
    );
    scale = nextScale;
    offsetX = (viewportWidth - width * nextScale) / 2;
    offsetY = (viewportHeight - height * nextScale) / 2;
  }

  $effect(() => {
    viewportWidth;
    viewportHeight;
    width;
    height;
    if (!hasInteracted) {
      fitToView();
    }
  });

  function handleWheel(event: WheelEvent) {
    event.preventDefault();
    hasInteracted = true;
    const pointerX = event.offsetX;
    const pointerY = event.offsetY;
    const isTrackpadPan =
      (!event.ctrlKey && Math.abs(event.deltaX) > 0) ||
      (!event.ctrlKey && Math.abs(event.deltaY) < 24);

    if (event.ctrlKey) {
      zoomAt(pointerX, pointerY, scale * Math.exp(-event.deltaY * 0.008));
      return;
    }

    if (isTrackpadPan) {
      offsetX -= event.deltaX;
      offsetY -= event.deltaY;
      return;
    }

    zoomAt(pointerX, pointerY, scale * Math.exp(-event.deltaY * 0.0018));
  }

  function handlePointerDown(event: PointerEvent) {
    if (event.button !== 0 || (event.target as Element | null)?.closest('.graph-node, .graph-edge-group, .graph-control')) {
      return;
    }
    hasInteracted = true;
    dragOrigin = {
      x: event.clientX,
      y: event.clientY,
      offsetX,
      offsetY,
      pointerId: event.pointerId,
    };
    (event.currentTarget as HTMLDivElement).setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: PointerEvent) {
    if (!dragOrigin || dragOrigin.pointerId !== event.pointerId) {
      return;
    }
    offsetX = dragOrigin.offsetX + (event.clientX - dragOrigin.x);
    offsetY = dragOrigin.offsetY + (event.clientY - dragOrigin.y);
  }

function handlePointerUp() {
  dragOrigin = null;
}

  function handleNodeKeydown(event: KeyboardEvent, nodeId: GraphNodeId) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelectNode?.(nodeId);
    }
  }

  function handleEdgeKeydown(event: KeyboardEvent, edgeId: string) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelectEdge?.(edgeId);
    }
  }
</script>

<div
  class="state-graph"
  role="application"
  aria-label="Interactive state graph"
  bind:clientWidth={viewportWidth}
  bind:clientHeight={viewportHeight}
  onwheel={handleWheel}
  onpointerdown={handlePointerDown}
  onpointermove={handlePointerMove}
  onpointerup={handlePointerUp}
  onpointerleave={handlePointerUp}
>
  <div class="graph-controls">
    <div class="graph-layout-controls" role="group" aria-label="Graph layout mode">
      <button
        class:active={layoutMode === 'planar'}
        class="graph-control graph-layout-control"
        type="button"
        onclick={() => onChangeLayout?.('planar')}
        aria-label="Use planar layout"
      >
        Planar
      </button>
      <button
        class:active={layoutMode === 'layered'}
        class="graph-control graph-layout-control"
        type="button"
        onclick={() => onChangeLayout?.('layered')}
        aria-label="Use layered layout"
      >
        Layered
      </button>
    </div>
    <button class="graph-control" type="button" onclick={() => { hasInteracted = true; scale = clampScale(scale * 1.15); }} aria-label="Zoom in">+</button>
    <button class="graph-control" type="button" onclick={() => { hasInteracted = true; scale = clampScale(scale / 1.15); }} aria-label="Zoom out">-</button>
    <button class="graph-control graph-control-fit" type="button" onclick={() => { hasInteracted = false; fitToView(); }} aria-label="Fit graph to view">Fit</button>
  </div>
  <svg width={Math.max(viewportWidth, 1)} height={Math.max(viewportHeight, 1)} aria-label="State graph">
    <defs>
      <marker id="graph-arrowhead" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor"></path>
      </marker>
    </defs>
    <g transform={`translate(${offsetX} ${offsetY}) scale(${scale})`}>
      {#each edges as edge}
        <g
          class:hovered={hoveredEdgeId === edge.id}
          class:selected={selectedEdgeId === edge.id}
          class="graph-edge-group"
          role="button"
          tabindex="0"
          onclick={() => onSelectEdge?.(edge.id)}
          onkeydown={(event) => handleEdgeKeydown(event, edge.id)}
          onpointerenter={() => (hoveredEdgeId = edge.id)}
          onpointerleave={() => (hoveredEdgeId = hoveredEdgeId === edge.id ? null : hoveredEdgeId)}
        >
          <path id={edge.id} class="graph-edge-path" d={edge.path} />
          <path class="graph-edge-hit" d={edge.path} />
          <path class="graph-edge" d={edge.path} marker-end="url(#graph-arrowhead)" />
          <g class="graph-edge-label" transform={`translate(${edge.labelX} ${edge.labelY})`}>
            <rect x="-68" y="-14" width="136" height="28" rx="14" />
            <text text-anchor="middle" dominant-baseline="middle">{edge.label}</text>
          </g>
        </g>
      {/each}

      {#each nodes as node}
        <g
          class:active={node.id === activeNodeId}
          class:selected={selectedNodeId === node.id}
          class="graph-node"
          transform={`translate(${node.x} ${node.y})`}
          role="button"
          tabindex="0"
          onclick={() => onSelectNode?.(node.id)}
          onkeydown={(event) => handleNodeKeydown(event, node.id)}
        >
          <rect width={node.width} height={node.height} rx="20" />
          <text class="graph-node-title" x="18" y="28">{node.label}</text>
          <text class="graph-node-detail" x="18" y="52">{node.detail}</text>
        </g>
      {/each}
    </g>
  </svg>
</div>

<style>
  .state-graph {
    position: relative;
    height: 100%;
    min-height: 0;
    overflow: hidden;
    border-radius: 28px;
    border: 1px solid var(--nb-border);
    background: var(--nb-surface);
    cursor: grab;
    touch-action: none;
  }

  .state-graph:active {
    cursor: grabbing;
  }

  svg {
    width: 100%;
    height: 100%;
    display: block;
  }

  .graph-controls {
    position: absolute;
    top: 0.9rem;
    right: 0.9rem;
    z-index: 2;
    display: flex;
    gap: 0.45rem;
    align-items: center;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .graph-layout-controls {
    display: flex;
    gap: 0.32rem;
    padding: 0.22rem;
    border-radius: 999px;
    border: 1px solid var(--nb-border);
    background: color-mix(in srgb, var(--nb-surface) 84%, var(--nb-accent-soft));
  }

  .graph-control {
    min-width: 2.3rem;
    height: 2.3rem;
    padding: 0 0.75rem;
    display: grid;
    place-items: center;
    border-radius: 999px;
    border: 1px solid var(--nb-border);
    background: color-mix(in srgb, var(--nb-surface-strong) 90%, var(--nb-accent-soft));
    color: var(--nb-text);
    cursor: pointer;
    backdrop-filter: blur(12px);
  }

  .graph-layout-control {
    min-width: 4.9rem;
    height: 2rem;
    padding: 0 0.72rem;
    font-size: 0.72rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    border-color: transparent;
    background: transparent;
  }

  .graph-layout-control.active {
    border-color: color-mix(in srgb, var(--nb-accent) 50%, var(--nb-border));
    background: color-mix(in srgb, var(--nb-accent-soft) 66%, var(--nb-surface-strong));
    color: var(--nb-accent-strong);
  }

  .graph-control-fit {
    min-width: 3.8rem;
  }

  .graph-edge-group {
    cursor: pointer;
    outline: none;
  }

  .graph-edge {
    fill: none;
    stroke: color-mix(in srgb, var(--nb-accent) 28%, var(--nb-border-strong));
    stroke-width: 2.25;
    color: color-mix(in srgb, var(--nb-accent) 42%, var(--nb-border-strong));
    transition:
      stroke 140ms ease,
      color 140ms ease,
      stroke-width 140ms ease;
  }

  .graph-edge-path {
    fill: none;
    stroke: transparent;
  }

  .graph-edge-hit {
    fill: none;
    stroke: transparent;
    stroke-width: 22;
  }

  .graph-edge-group.selected .graph-edge,
  .graph-edge-group.hovered .graph-edge {
    stroke: var(--nb-accent);
    color: var(--nb-accent);
    stroke-width: 2.8;
  }

  .graph-edge-label {
    cursor: pointer;
    opacity: 0;
    transition: opacity 120ms ease;
  }

  .graph-edge-label rect {
    fill: color-mix(in srgb, var(--nb-surface-strong) 92%, var(--nb-accent-soft));
    stroke: var(--nb-border);
    stroke-width: 1;
  }

  .graph-edge-label text {
    fill: var(--nb-text-soft);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .graph-edge-group.selected .graph-edge-label,
  .graph-edge-group.hovered .graph-edge-label {
    opacity: 1;
  }

  .graph-edge-group.selected .graph-edge-label rect {
    fill: color-mix(in srgb, var(--nb-accent-soft) 70%, var(--nb-surface-strong));
    stroke: var(--nb-accent);
  }

  .graph-edge-group.selected .graph-edge-label text {
    fill: var(--nb-text);
  }

  .graph-node {
    cursor: pointer;
  }

  .graph-node rect {
    fill: color-mix(in srgb, var(--nb-surface-strong) 88%, var(--nb-accent-soft));
    stroke: var(--nb-border-strong);
    stroke-width: 1;
  }

  .graph-node.active rect {
    fill: color-mix(in srgb, var(--nb-accent-soft) 68%, var(--nb-surface-strong));
    stroke: var(--nb-accent);
    stroke-width: 1.5;
  }

  .graph-node.selected rect {
    stroke: var(--nb-accent-strong);
    stroke-width: 2;
    box-shadow: 0 0 0 1px var(--nb-accent-soft);
  }

  .graph-node-title {
    fill: var(--nb-text);
    font-size: 15px;
    font-weight: 650;
  }

  .graph-node-detail {
    fill: var(--nb-text-soft);
    font-size: 11px;
  }
</style>
