export type DesignerTab =
  | 'moodboards'
  | 'typography'
  | 'palette'
  | 'components'
  | 'graph'
  | 'desktop'
  | 'phone';

export type MoodboardId =
  | 'quartz-light'
  | 'slate-day'
  | 'sand'
  | 'graphite-night'
  | 'workbench'
  | 'pine-night';

export type FixturePreset = 'populated' | 'empty' | 'warning' | 'capability-limited';

export type WorkspacePaneMode = 'balanced' | 'files-focus' | 'chat-focus';

export type FileBrowserView = 'icons' | 'details';

export type FileSort = 'newest' | 'oldest' | 'name' | 'size';

export type OverlayKind =
  | 'none'
  | 'join'
  | 'share'
  | 'identity'
  | 'create'
  | 'sources'
  | 'storage'
  | 'hub-storage'
  | 'event-flow'
  | 'timeline-detail'
  | 'reset';

export type PrimaryPane = 'files' | 'chat';

export type GraphNodeId =
  | 'workspace-home'
  | 'files-focus'
  | 'chat-focus'
  | 'preview-open'
  | 'timeline-open'
  | 'timeline-detail-dialog'
  | 'join-dialog'
  | 'share-dialog'
  | 'identity-manager'
  | 'create-chooser'
  | 'sources-panel'
  | 'storage-panel'
  | 'hub-storage-dialog'
  | 'event-flow-panel'
  | 'reset-dialog';

export type ComponentFamily =
  | 'primitives'
  | 'inputs'
  | 'display'
  | 'shell'
  | 'protocol';

export type HubFixture = {
  id: string;
  label: string;
  members: number;
  unreadCount: number;
  status: 'active' | 'syncing' | 'warning';
};

export type FileFixture = {
  id: string;
  name: string;
  kind: 'image' | 'document' | 'audio' | 'archive';
  accent: 'cyan' | 'amber' | 'violet' | 'rose';
  sizeLabel: string;
  updatedAt: string;
  mimeLabel: string;
  summary: string;
  providers: string[];
  status: 'ready' | 'syncing' | 'warning';
};

export type MessageFixture = {
  id: string;
  author: string;
  body: string;
  tone: 'local' | 'remote' | 'system';
  at: string;
};

export type EventFixture = {
  id: string;
  title: string;
  summary: string;
  eventType: 'FILE' | 'CHAT' | 'IDENTITY' | 'TRANSPORT';
  at: string;
  tone: 'stable' | 'syncing' | 'attention';
  actor: string;
  transport: string;
  happenedAt: string;
  payloadPreview: string;
  specRefs: string[];
  outcome: string[];
};

export type PeerFixture = {
  id: string;
  label: string;
  status: 'reachable' | 'syncing' | 'limited';
  medium: 'LAN' | 'MEGA' | 'LOCAL';
};

export type StorageFixture = {
  id: string;
  label: string;
  provider: string;
  status: 'healthy' | 'watching' | 'attention';
  pathLabel: string;
  usageLabel: string;
  reserveLabel: string;
  mode: 'read-write' | 'read-only';
};

export type ProviderShareFixture = {
  id: string;
  provider: string;
  title: string;
  status: 'healthy' | 'syncing' | 'attention';
  access: 'read-write' | 'read-only';
  progressPercent: number | null;
  progressLabel: string;
  shareCountLabel: string;
  locationLabel: string;
  detail: string;
  attachments: string[];
};

export type IdentityFixture = {
  id: string;
  displayName: string;
  summary: string;
  status: 'joined' | 'published' | 'draft';
};

export type DesignerFixtures = {
  hubs: HubFixture[];
  files: FileFixture[];
  messages: MessageFixture[];
  events: EventFixture[];
  peers: PeerFixture[];
  storageLocations: StorageFixture[];
  providerShares: ProviderShareFixture[];
  identities: IdentityFixture[];
};

export type SurfaceCapabilities = {
  providers: boolean;
  desktopHelpers: boolean;
  lanSync: boolean;
  destructiveReset: boolean;
};

export type SharedWorkspaceState = {
  activeHubId: string;
  primaryPane: PrimaryPane;
  paneMode: WorkspacePaneMode;
  fileBrowserView: FileBrowserView;
  fileSearch: string;
  fileSort: FileSort;
  overlay: OverlayKind;
  showPreview: boolean;
  showTimeline: boolean;
  selectedFileId: string | null;
  selectedEventId: string | null;
  selectedPeerId: string | null;
};

export type UiDesignerState = {
  tab: DesignerTab;
  moodboardId: MoodboardId;
  fixturePreset: FixturePreset;
  componentFamily: ComponentFamily;
  workspace: SharedWorkspaceState;
};

export type SurfaceAction =
  | { type: 'select-hub'; hubId: string }
  | { type: 'select-pane'; pane: PrimaryPane }
  | { type: 'set-pane-mode'; paneMode: WorkspacePaneMode }
  | { type: 'set-file-browser-view'; view: FileBrowserView }
  | { type: 'set-file-search'; value: string }
  | { type: 'set-file-sort'; sort: FileSort }
  | { type: 'toggle-preview' }
  | { type: 'toggle-timeline' }
  | { type: 'open-timeline-detail'; eventId?: string }
  | { type: 'open-overlay'; overlay: Exclude<OverlayKind, 'none'> }
  | { type: 'close-overlay' }
  | { type: 'select-file'; fileId: string }
  | { type: 'select-event'; eventId: string }
  | { type: 'select-peer'; peerId: string };

export type SurfaceHandlerSet = {
  onAction?: (action: SurfaceAction) => void;
};

export type WorkspaceSurfaceProps = {
  ui: SharedWorkspaceState;
  data: DesignerFixtures;
  capabilities?: SurfaceCapabilities;
  handlers?: SurfaceHandlerSet;
};
