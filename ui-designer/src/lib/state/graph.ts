import type { GraphNodeId, SharedWorkspaceState } from './types.js';

export type GraphNodeDefinition = {
  id: GraphNodeId;
  label: string;
  detail: string;
  layer: number;
};

export type GraphEdgeDefinition = {
  id: string;
  from: GraphNodeId;
  to: GraphNodeId;
  label: string;
};

export type LaidOutGraphNode = GraphNodeDefinition & {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type LaidOutGraphEdge = GraphEdgeDefinition & {
  path: string;
};

const NODE_WIDTH = 220;
const NODE_HEIGHT = 92;
const LAYER_GAP = 280;
const ROW_GAP = 126;

export const GRAPH_NODES: GraphNodeDefinition[] = [
  { id: 'workspace-home', label: 'Workspace Home', detail: 'Balanced panes, no overlays.', layer: 0 },
  { id: 'files-focus', label: 'Files Focus', detail: 'File browser dominates the shell.', layer: 1 },
  { id: 'chat-focus', label: 'Chat Focus', detail: 'Chat dominates the shell.', layer: 1 },
  { id: 'preview-open', label: 'Preview Open', detail: 'Selected file preview is expanded.', layer: 1 },
  { id: 'timeline-open', label: 'Timeline Open', detail: 'Timeline panel is visible.', layer: 1 },
  { id: 'join-dialog', label: 'Join Dialog', detail: 'Join link parse and confirm flow.', layer: 2 },
  { id: 'share-dialog', label: 'Share Dialog', detail: 'Share payload and invite actions.', layer: 2 },
  { id: 'identity-manager', label: 'Identity Manager', detail: 'Choose, draft, or publish an identity.', layer: 2 },
  { id: 'create-chooser', label: 'Create Chooser', detail: 'Start a new hub or import flow.', layer: 2 },
  { id: 'sources-panel', label: 'Sources Panel', detail: 'Peers, providers, and discovery states.', layer: 2 },
  { id: 'storage-panel', label: 'Storage Panel', detail: 'Global storage routing and health.', layer: 2 },
  { id: 'hub-storage-dialog', label: 'Hub Storage', detail: 'Per-hub storage destinations.', layer: 3 },
  { id: 'event-flow-panel', label: 'Event Flow', detail: 'Inspect event lineage and references.', layer: 2 },
  { id: 'reset-dialog', label: 'Reset Dialog', detail: 'Destructive reset confirmation.', layer: 2 },
];

export const GRAPH_EDGES: GraphEdgeDefinition[] = [
  { id: 'edge-files-focus', from: 'workspace-home', to: 'files-focus', label: 'setWorkspacePaneMode' },
  { id: 'edge-chat-focus', from: 'workspace-home', to: 'chat-focus', label: 'setWorkspacePaneMode' },
  { id: 'edge-preview', from: 'workspace-home', to: 'preview-open', label: 'togglePreviewPane' },
  { id: 'edge-timeline', from: 'workspace-home', to: 'timeline-open', label: 'toggleTimelinePanel' },
  { id: 'edge-join', from: 'workspace-home', to: 'join-dialog', label: 'openJoinDialog' },
  { id: 'edge-share', from: 'workspace-home', to: 'share-dialog', label: 'openShareDialog' },
  { id: 'edge-identity', from: 'workspace-home', to: 'identity-manager', label: 'openIdentityManager' },
  { id: 'edge-create', from: 'workspace-home', to: 'create-chooser', label: 'openCreateChooser' },
  { id: 'edge-sources', from: 'workspace-home', to: 'sources-panel', label: 'openSourcesPanel' },
  { id: 'edge-storage', from: 'workspace-home', to: 'storage-panel', label: 'openStoragePanel' },
  { id: 'edge-event-flow', from: 'workspace-home', to: 'event-flow-panel', label: 'openEventFlowPanel' },
  { id: 'edge-reset', from: 'workspace-home', to: 'reset-dialog', label: 'openResetDialog' },
  { id: 'edge-hub-storage', from: 'storage-panel', to: 'hub-storage-dialog', label: 'openHubStorageDialog' },
  { id: 'edge-close-1', from: 'files-focus', to: 'workspace-home', label: 'resetPaneMode' },
  { id: 'edge-close-2', from: 'chat-focus', to: 'workspace-home', label: 'resetPaneMode' },
  { id: 'edge-close-3', from: 'preview-open', to: 'workspace-home', label: 'togglePreviewPane' },
  { id: 'edge-close-4', from: 'timeline-open', to: 'workspace-home', label: 'toggleTimelinePanel' },
  { id: 'edge-close-5', from: 'join-dialog', to: 'workspace-home', label: 'closeOverlay' },
  { id: 'edge-close-6', from: 'share-dialog', to: 'workspace-home', label: 'closeOverlay' },
  { id: 'edge-close-7', from: 'identity-manager', to: 'workspace-home', label: 'closeOverlay' },
  { id: 'edge-close-8', from: 'create-chooser', to: 'workspace-home', label: 'closeOverlay' },
  { id: 'edge-close-9', from: 'sources-panel', to: 'workspace-home', label: 'closeOverlay' },
  { id: 'edge-close-10', from: 'storage-panel', to: 'workspace-home', label: 'closeOverlay' },
  { id: 'edge-close-11', from: 'hub-storage-dialog', to: 'workspace-home', label: 'closeOverlay' },
  { id: 'edge-close-12', from: 'event-flow-panel', to: 'workspace-home', label: 'closeOverlay' },
  { id: 'edge-close-13', from: 'reset-dialog', to: 'workspace-home', label: 'closeOverlay' },
];

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

export function layoutGraph(): { nodes: LaidOutGraphNode[]; edges: LaidOutGraphEdge[]; width: number; height: number } {
  const rowsByLayer = new Map<number, GraphNodeDefinition[]>();
  for (const node of GRAPH_NODES) {
    const row = rowsByLayer.get(node.layer) ?? [];
    row.push(node);
    rowsByLayer.set(node.layer, row);
  }

  const maxLayer = Math.max(...GRAPH_NODES.map((node) => node.layer));
  const nodes = GRAPH_NODES.map((node) => {
    const layerNodes = rowsByLayer.get(node.layer) ?? [];
    const rowIndex = layerNodes.findIndex((entry) => entry.id === node.id);
    const x = (maxLayer - node.layer) * LAYER_GAP + 48;
    const y = rowIndex * ROW_GAP + 48;
    return { ...node, x, y, width: NODE_WIDTH, height: NODE_HEIGHT };
  });

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const edges = GRAPH_EDGES.map((edge) => {
    const from = nodeById.get(edge.from)!;
    const to = nodeById.get(edge.to)!;
    const startX = from.x;
    const startY = from.y + from.height / 2;
    const endX = to.x + to.width;
    const endY = to.y + to.height / 2;
    const midX = (startX + endX) / 2;
    const path = `M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`;
    return { ...edge, path };
  });

  const width = maxLayer * LAYER_GAP + NODE_WIDTH + 160;
  const height = Math.max(...nodes.map((node) => node.y)) + NODE_HEIGHT + 96;
  return { nodes, edges, width, height };
}
