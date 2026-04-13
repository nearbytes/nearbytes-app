import type { GraphNodeId, SharedWorkspaceState } from './types.js';

export type GraphNodeDefinition = {
  id: GraphNodeId;
  label: string;
  detail: string;
  layer: number;
  row: number;
  notes: string[];
};

export type GraphEdgeDefinition = {
  id: string;
  from: GraphNodeId;
  to: GraphNodeId;
  label: string;
  detail: string;
};

export type LaidOutGraphNode = GraphNodeDefinition & {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type LaidOutGraphEdge = GraphEdgeDefinition & {
  path: string;
  labelX: number;
  labelY: number;
};

const NODE_WIDTH = 232;
const NODE_HEIGHT = 92;
const LAYER_GAP = 320;
const ROW_GAP = 140;
const STUB = 28;
const OUTER_PADDING = 64;
const LANE_STEP = 18;

export const GRAPH_NODES: GraphNodeDefinition[] = [
  {
    id: 'workspace-home',
    label: 'Workspace Home',
    detail: 'Balanced panes, no overlays.',
    layer: 0,
    row: 7,
    notes: ['Entry state for the shared shell.', 'Both desktop and phone previews reflect this same structure.'],
  },
  {
    id: 'files-focus',
    label: 'Files Focus',
    detail: 'File browser dominates the shell.',
    layer: 1,
    row: 3,
    notes: ['Structural pane mode.', 'Does not encode search text or selected filenames.'],
  },
  {
    id: 'chat-focus',
    label: 'Chat Focus',
    detail: 'Chat dominates the shell.',
    layer: 1,
    row: 5,
    notes: ['Structural pane mode.', 'Same surface components as balanced mode.'],
  },
  {
    id: 'preview-open',
    label: 'Preview Open',
    detail: 'Selected file preview is expanded.',
    layer: 1,
    row: 9,
    notes: ['File content itself is not part of graph identity.', 'Only the open/closed structural pane state is graphed.'],
  },
  {
    id: 'timeline-open',
    label: 'Timeline Open',
    detail: 'Timeline panel is visible.',
    layer: 1,
    row: 11,
    notes: ['Event payloads are fixture/runtime data, not graph state.', 'Structural visibility only.'],
  },
  {
    id: 'join-dialog',
    label: 'Join Dialog',
    detail: 'Join link parse and confirm flow.',
    layer: 2,
    row: 0,
    notes: ['Overlay state used by both previews.', 'Real join payload text remains outside graph identity.'],
  },
  {
    id: 'share-dialog',
    label: 'Share Dialog',
    detail: 'Share payload and invite actions.',
    layer: 2,
    row: 2,
    notes: ['Overlay state only.', 'Actual link contents belong to data, not structural state.'],
  },
  {
    id: 'identity-manager',
    label: 'Identity Manager',
    detail: 'Choose, draft, or publish an identity.',
    layer: 2,
    row: 4,
    notes: ['Shared identity surface.', 'Publication semantics will later be wired by runtime logic.'],
  },
  {
    id: 'create-chooser',
    label: 'Create Chooser',
    detail: 'Start a new hub or import flow.',
    layer: 2,
    row: 6,
    notes: ['Shared creation launcher.', 'Branching choice is structural; entered text is not.'],
  },
  {
    id: 'sources-panel',
    label: 'Sources Panel',
    detail: 'Peers, providers, and discovery states.',
    layer: 2,
    row: 8,
    notes: ['Capability-gated surface.', 'Presence remains shared even when runtime backing is unavailable.'],
  },
  {
    id: 'storage-panel',
    label: 'Storage Panel',
    detail: 'Global storage routing and health.',
    layer: 2,
    row: 10,
    notes: ['Shared storage configuration surface.', 'Contains the entry point to per-hub storage routing.'],
  },
  {
    id: 'event-flow-panel',
    label: 'Event Flow',
    detail: 'Inspect event lineage and references.',
    layer: 2,
    row: 12,
    notes: ['Protocol inspection surface.', 'Later specs can deepen this without changing the graph contract.'],
  },
  {
    id: 'reset-dialog',
    label: 'Reset Dialog',
    detail: 'Destructive reset confirmation.',
    layer: 2,
    row: 14,
    notes: ['Shared destructive surface.', 'Actual destructive ability is capability-gated by the host.'],
  },
  {
    id: 'hub-storage-dialog',
    label: 'Hub Storage',
    detail: 'Per-hub storage destinations.',
    layer: 3,
    row: 10,
    notes: ['Child structural state of Storage Panel.', 'One of the few second-hop transitions in the current graph.'],
  },
];

export const GRAPH_EDGES: GraphEdgeDefinition[] = [
  { id: 'edge-files-focus', from: 'workspace-home', to: 'files-focus', label: 'setWorkspacePaneMode', detail: 'Enter the file-dominant layout.' },
  { id: 'edge-chat-focus', from: 'workspace-home', to: 'chat-focus', label: 'setWorkspacePaneMode', detail: 'Enter the chat-dominant layout.' },
  { id: 'edge-preview', from: 'workspace-home', to: 'preview-open', label: 'togglePreviewPane', detail: 'Open the preview pane.' },
  { id: 'edge-timeline', from: 'workspace-home', to: 'timeline-open', label: 'toggleTimelinePanel', detail: 'Open the timeline panel.' },
  { id: 'edge-join', from: 'workspace-home', to: 'join-dialog', label: 'openJoinDialog', detail: 'Open the join flow overlay.' },
  { id: 'edge-share', from: 'workspace-home', to: 'share-dialog', label: 'openShareDialog', detail: 'Open the share overlay.' },
  { id: 'edge-identity', from: 'workspace-home', to: 'identity-manager', label: 'openIdentityManager', detail: 'Open identity selection and publication.' },
  { id: 'edge-create', from: 'workspace-home', to: 'create-chooser', label: 'openCreateChooser', detail: 'Open the create/import launcher.' },
  { id: 'edge-sources', from: 'workspace-home', to: 'sources-panel', label: 'openSourcesPanel', detail: 'Open sources and integrations.' },
  { id: 'edge-storage', from: 'workspace-home', to: 'storage-panel', label: 'openStoragePanel', detail: 'Open global storage routing.' },
  { id: 'edge-event-flow', from: 'workspace-home', to: 'event-flow-panel', label: 'openEventFlowPanel', detail: 'Open protocol event inspection.' },
  { id: 'edge-reset', from: 'workspace-home', to: 'reset-dialog', label: 'openResetDialog', detail: 'Open destructive reset confirmation.' },
  { id: 'edge-hub-storage', from: 'storage-panel', to: 'hub-storage-dialog', label: 'openHubStorageDialog', detail: 'Drill from global storage into per-hub routing.' },
  { id: 'edge-close-1', from: 'files-focus', to: 'workspace-home', label: 'resetPaneMode', detail: 'Return to balanced panes.' },
  { id: 'edge-close-2', from: 'chat-focus', to: 'workspace-home', label: 'resetPaneMode', detail: 'Return to balanced panes.' },
  { id: 'edge-close-3', from: 'preview-open', to: 'workspace-home', label: 'togglePreviewPane', detail: 'Close the preview pane.' },
  { id: 'edge-close-4', from: 'timeline-open', to: 'workspace-home', label: 'toggleTimelinePanel', detail: 'Close the timeline panel.' },
  { id: 'edge-close-5', from: 'join-dialog', to: 'workspace-home', label: 'closeOverlay', detail: 'Dismiss the join overlay.' },
  { id: 'edge-close-6', from: 'share-dialog', to: 'workspace-home', label: 'closeOverlay', detail: 'Dismiss the share overlay.' },
  { id: 'edge-close-7', from: 'identity-manager', to: 'workspace-home', label: 'closeOverlay', detail: 'Dismiss the identity manager.' },
  { id: 'edge-close-8', from: 'create-chooser', to: 'workspace-home', label: 'closeOverlay', detail: 'Dismiss the create chooser.' },
  { id: 'edge-close-9', from: 'sources-panel', to: 'workspace-home', label: 'closeOverlay', detail: 'Dismiss sources and integrations.' },
  { id: 'edge-close-10', from: 'storage-panel', to: 'workspace-home', label: 'closeOverlay', detail: 'Dismiss global storage routing.' },
  { id: 'edge-close-11', from: 'hub-storage-dialog', to: 'workspace-home', label: 'closeOverlay', detail: 'Return from per-hub storage to the workspace shell.' },
  { id: 'edge-close-12', from: 'event-flow-panel', to: 'workspace-home', label: 'closeOverlay', detail: 'Dismiss event flow inspection.' },
  { id: 'edge-close-13', from: 'reset-dialog', to: 'workspace-home', label: 'closeOverlay', detail: 'Dismiss reset confirmation.' },
];

export const GRAPH_NODE_BY_ID = Object.fromEntries(GRAPH_NODES.map((node) => [node.id, node])) as Record<
  GraphNodeId,
  GraphNodeDefinition
>;

export const GRAPH_EDGE_BY_ID = Object.fromEntries(GRAPH_EDGES.map((edge) => [edge.id, edge])) as Record<
  string,
  GraphEdgeDefinition
>;

export function structuralStateKey(workspace: SharedWorkspaceState): GraphNodeId {
  if (workspace.overlay === 'join') return 'join-dialog';
  if (workspace.overlay === 'share') return 'share-dialog';
  if (workspace.overlay === 'identity') return 'identity-manager';
  if (workspace.overlay === 'create') return 'create-chooser';
  if (workspace.overlay === 'sources') return 'sources-panel';
  if (workspace.overlay === 'storage') return 'storage-panel';
  if (workspace.overlay === 'hub-storage') return 'hub-storage-dialog';
  if (workspace.overlay === 'event-flow') return 'event-flow-panel';
  if (workspace.overlay === 'reset') return 'reset-dialog';
  if (workspace.showPreview) return 'preview-open';
  if (workspace.showTimeline) return 'timeline-open';
  if (workspace.paneMode === 'files-focus') return 'files-focus';
  if (workspace.paneMode === 'chat-focus') return 'chat-focus';
  return 'workspace-home';
}

function chooseLaneY(from: LaidOutGraphNode, to: LaidOutGraphNode, laneOffset: number): number {
  const fromTop = from.y;
  const fromBottom = from.y + from.height;
  const toTop = to.y;
  const toBottom = to.y + to.height;
  const routeAbove = to.y < from.y;

  return routeAbove
    ? Math.min(fromTop, toTop) - STUB - laneOffset
    : Math.max(fromBottom, toBottom) + STUB + laneOffset;
}

function orthPath(points: Array<[number, number]>): string {
  return points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${x} ${y}`).join(' ');
}

export function layoutGraph(): { nodes: LaidOutGraphNode[]; edges: LaidOutGraphEdge[]; width: number; height: number } {
  const maxLayer = Math.max(...GRAPH_NODES.map((node) => node.layer));
  const nodes = GRAPH_NODES.map((node) => {
    const x = (maxLayer - node.layer) * LAYER_GAP + OUTER_PADDING;
    const y = node.row * ROW_GAP + OUTER_PADDING;
    return { ...node, x, y, width: NODE_WIDTH, height: NODE_HEIGHT };
  });

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const edges = GRAPH_EDGES.map((edge, index) => {
    const from = nodeById.get(edge.from)!;
    const to = nodeById.get(edge.to)!;
    const laneOffset = (index % 3) * LANE_STEP;

    const leftToRight = from.x < to.x;
    const startX = leftToRight ? from.x + from.width : from.x;
    const endX = leftToRight ? to.x : to.x + to.width;
    const startY = from.y + from.height / 2;
    const endY = to.y + to.height / 2;
    const stub1X = leftToRight ? startX + STUB : startX - STUB;
    const stub2X = leftToRight ? endX - STUB : endX + STUB;
    const laneY = chooseLaneY(from, to, laneOffset);
    const path = orthPath([
      [startX, startY],
      [stub1X, startY],
      [stub1X, laneY],
      [stub2X, laneY],
      [stub2X, endY],
      [endX, endY],
    ]);

    return {
      ...edge,
      path,
      labelX: (stub1X + stub2X) / 2,
      labelY: laneY,
    };
  });

  const width = maxLayer * LAYER_GAP + NODE_WIDTH + OUTER_PADDING * 2;
  const height = Math.max(...nodes.map((node) => node.y)) + NODE_HEIGHT + OUTER_PADDING;
  return { nodes, edges, width, height };
}
