<script lang="ts">
  import type { LaidOutGraphEdge, LaidOutGraphNode } from '../state/graph.js';
  import type { GraphNodeId } from '../state/types.js';

  let {
    nodes,
    edges,
    width,
    height,
    activeNodeId,
    selectedNodeId = null,
    selectedEdgeId = null,
    onSelectNode,
    onSelectEdge,
  } = $props<{
    nodes: LaidOutGraphNode[];
    edges: LaidOutGraphEdge[];
    width: number;
    height: number;
    activeNodeId: GraphNodeId;
    selectedNodeId?: GraphNodeId | null;
    selectedEdgeId?: string | null;
    onSelectNode?: ((nodeId: GraphNodeId) => void) | undefined;
    onSelectEdge?: ((edgeId: string) => void) | undefined;
  }>();

  let scale = $state(1);
  let offsetX = $state(0);
  let offsetY = $state(0);
  let dragOrigin = $state<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);

  function handleWheel(event: WheelEvent) {
    event.preventDefault();
    const direction = event.deltaY > 0 ? -0.08 : 0.08;
    scale = Math.min(1.8, Math.max(0.55, scale + direction));
  }

  function handlePointerDown(event: PointerEvent) {
    dragOrigin = {
      x: event.clientX,
      y: event.clientY,
      offsetX,
      offsetY,
    };
  }

  function handlePointerMove(event: PointerEvent) {
    if (!dragOrigin) {
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
  onwheel={handleWheel}
  onpointerdown={handlePointerDown}
  onpointermove={handlePointerMove}
  onpointerup={handlePointerUp}
  onpointerleave={handlePointerUp}
>
  <svg viewBox={`0 0 ${width} ${height}`} aria-label="State graph">
    <defs>
      <marker id="graph-arrowhead" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor"></path>
      </marker>
    </defs>
    <g transform={`translate(${offsetX} ${offsetY}) scale(${scale})`}>
      {#each edges as edge}
        <path id={edge.id} class="graph-edge-path" d={edge.path} />
        <path class:selected={selectedEdgeId === edge.id} class="graph-edge" d={edge.path} marker-end="url(#graph-arrowhead)" />
        <g
          class:selected={selectedEdgeId === edge.id}
          class="graph-edge-label"
          transform={`translate(${edge.labelX} ${edge.labelY})`}
          role="button"
          tabindex="0"
          onclick={() => onSelectEdge?.(edge.id)}
          onkeydown={(event) => handleEdgeKeydown(event, edge.id)}
        >
          <rect x="-68" y="-14" width="136" height="28" rx="14" />
          <text text-anchor="middle" dominant-baseline="middle">{edge.label}</text>
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
    min-height: 38rem;
    overflow: hidden;
    border-radius: 28px;
    border: 1px solid var(--nb-border);
    background:
      radial-gradient(circle at top, color-mix(in srgb, var(--nb-accent) 16%, transparent), transparent 45%),
      linear-gradient(180deg, color-mix(in srgb, var(--nb-surface) 86%, rgba(255, 255, 255, 0.04)), var(--nb-surface));
    cursor: grab;
  }

  .state-graph:active {
    cursor: grabbing;
  }

  svg {
    width: 100%;
    height: 100%;
    min-height: 38rem;
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

  .graph-edge.selected {
    stroke: var(--nb-accent);
    color: var(--nb-accent);
    stroke-width: 2.8;
  }

  .graph-edge-label {
    cursor: pointer;
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

  .graph-edge-label.selected rect {
    fill: color-mix(in srgb, var(--nb-accent-soft) 70%, var(--nb-surface-strong));
    stroke: var(--nb-accent);
  }

  .graph-edge-label.selected text {
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
