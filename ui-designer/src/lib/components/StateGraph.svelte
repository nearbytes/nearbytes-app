<script lang="ts">
  import type { LaidOutGraphEdge, LaidOutGraphNode } from '../state/graph.js';
  import type { GraphNodeId } from '../state/types.js';

  let {
    nodes,
    edges,
    width,
    height,
    activeNodeId,
    onSelectNode,
  } = $props<{
    nodes: LaidOutGraphNode[];
    edges: LaidOutGraphEdge[];
    width: number;
    height: number;
    activeNodeId: GraphNodeId;
    onSelectNode?: ((nodeId: GraphNodeId) => void) | undefined;
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
    <g transform={`translate(${offsetX} ${offsetY}) scale(${scale})`}>
      {#each edges as edge}
        <path id={edge.id} class="graph-edge-path" d={edge.path} />
        <path class="graph-edge" d={edge.path} />
        <text class="graph-edge-copy">
          <textPath href={`#${edge.id}`} startOffset="50%">{edge.label}</textPath>
        </text>
      {/each}

      {#each nodes as node}
        <g
          class:active={node.id === activeNodeId}
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
    stroke: color-mix(in srgb, var(--nb-accent) 34%, var(--nb-border-strong));
    stroke-width: 2.5;
  }

  .graph-edge-path {
    fill: none;
    stroke: transparent;
  }

  .graph-edge-copy {
    font-size: 11px;
    fill: var(--nb-text-faint);
    letter-spacing: 0.04em;
    text-transform: uppercase;
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
