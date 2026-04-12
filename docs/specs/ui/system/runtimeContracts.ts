export type SourceProvider = 'local' | 'dropbox' | 'mega' | 'gdrive' | 'icloud' | 'onedrive';
export type StorageFullPolicy = 'block-writes' | 'drop-older-blocks';

export interface ProviderManagedSourceIntegration {
  kind: 'provider-managed';
  provider: string;
  managedShareId: string;
}

export type SourceIntegrationConfig = ProviderManagedSourceIntegration;

export interface SourceConfigEntry {
  id: string;
  provider: SourceProvider;
  path: string;
  enabled: boolean;
  writable: boolean;
  reservePercent: number;
  opportunisticPolicy: StorageFullPolicy;
  moveFromSourceId?: string;
  integration?: SourceIntegrationConfig;
}

export interface VolumeDestinationConfig {
  sourceId: string;
  enabled: boolean;
  storeEvents: boolean;
  storeBlocks: boolean;
  copySourceBlocks: boolean;
  reservePercent: number;
  fullPolicy: StorageFullPolicy;
}

export interface DefaultVolumePolicy {
  destinations: VolumeDestinationConfig[];
}

export interface VolumePolicyEntry {
  volumeId: string;
  destinations: VolumeDestinationConfig[];
}

export interface RootsConfig {
  version: 2;
  sources: SourceConfigEntry[];
  defaultVolume: DefaultVolumePolicy;
  volumes: VolumePolicyEntry[];
}

export interface ProviderSetupState {
  status: 'ready' | 'needs-config' | 'needs-install' | 'installing' | 'unsupported';
  detail: string;
  docsUrl?: string;
  canConfigure?: boolean;
  canInstall?: boolean;
  config?: {
    clientId?: string;
    hasClientSecret?: boolean;
    helperPath?: string;
  };
}

export interface ProviderAccount {
  id: string;
  provider: string;
  label: string;
  email?: string;
  state: 'connected' | 'attention' | 'unsupported';
  detail?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ProviderAuthSession {
  id: string;
  provider: string;
  accountId: string;
  status: 'pending' | 'ready' | 'failed';
  detail: string;
  authUrl?: string;
  openedAt: number;
  expiresAt: number;
}

export interface ProviderCatalogEntry {
  provider: string;
  label: string;
  description: string;
  badges: string[];
  enabled?: boolean;
  isConnected: boolean;
  connectionState: 'available' | 'connected' | 'setup';
  accountId?: string;
  setup: ProviderSetupState;
}

export interface AppConfig {
  version: 1;
  features: {
    providers: {
      googleDrive: boolean;
      mega: boolean;
      github: boolean;
      localNetwork: boolean;
    };
    performance: {
      appMetrics: boolean;
    };
  };
}

export interface ManagedShare {
  id: string;
  provider: string;
  accountId: string;
  label: string;
  role: 'owner' | 'recipient' | 'link';
  localPath: string;
  sourceId?: string;
  syncMode: 'mirror';
  remoteDescriptor: Record<string, unknown>;
  capabilities: string[];
  invitationEmails: string[];
  createdAt: number;
  updatedAt: number;
}

export interface ManagedShareAttachment {
  id: string;
  shareId: string;
  sourceId: string;
  volumeId: string;
  createdAt: number;
}

export interface ManagedShareCollaborator {
  label: string;
  email?: string;
  role?: string;
  status: 'active' | 'invited';
  source: 'provider' | 'nearbytes';
}

export interface TransportState {
  status: 'idle' | 'ready' | 'syncing' | 'needs-auth' | 'unsupported' | 'attention';
  detail: string;
  badges: string[];
  lastSyncAt?: number;
  diagnostic?: {
    code: string;
    title: string;
    summary: string;
    detail?: string;
    facts?: Array<{
      label: string;
      value: string;
    }>;
  };
}

export interface ManagedShareSummary {
  share: ManagedShare;
  attachments: ManagedShareAttachment[];
  state: TransportState;
  collaborators: ManagedShareCollaborator[];
  storage?: {
    sourcePath?: string;
    enabled?: boolean;
    writable?: boolean;
    keepFullCopy?: boolean;
    reservePercent?: number;
    availableBytes?: number;
    usageTotalBytes?: number;
    lastWriteFailureMessage?: string;
    remoteAvailableBytes?: number;
    remoteTotalBytes?: number;
    remoteUsedBytes?: number;
  };
}

export interface IncomingManagedShareOffer {
  id: string;
  provider: string;
  accountId: string;
  label: string;
  ownerLabel: string;
  detail: string;
  remoteDescriptor: Record<string, unknown>;
  suggestedLocalPath?: string;
}

export interface IncomingProviderContactInvite {
  id: string;
  provider: string;
  accountId: string;
  label: string;
  detail: string;
}

export interface LocalNetworkPeer {
  peerId: string;
  label: string;
  address: string;
  port: number;
  endpointUrl: string;
  capabilities: string[];
  volumeIds: string[];
  firstSeenAt: number;
  lastSeenAt: number;
  lastHelloAt: number | null;
  lastSyncAt: number | null;
  lastSyncStartedAt: number | null;
  lastSyncError: string | null;
  lastSyncNotice: string | null;
  lastImportedEvents: number;
  lastImportedBlocks: number;
  remoteCursorObservationId?: string | null;
  lastRemoteHeadObservationId?: string | null;
  status: 'ready' | 'syncing' | 'error' | 'stale';
  detail: string;
}

export interface LocalNetworkServiceState {
  protocol: string;
  peerId: string;
  label: string;
  listening: boolean;
  port: number | null;
  discovery: 'dns-sd+multicast-fallback';
  transport: 'webrtc';
  serviceType: string;
  announceIntervalMs: number;
  peerCount: number;
}

export interface LocalNetworkPeersResponse {
  service: LocalNetworkServiceState;
  peers: LocalNetworkPeer[];
  isOffline?: boolean;
}

export interface RootWriteFailure {
  rootId: string;
  code: string;
  message: string;
  at: number;
  relativePath: string;
  channelKeyHex?: string;
  category: 'resource_exhausted' | 'unavailable' | 'unknown';
}

export interface SourceVolumeUsage {
  volumeId: string;
  historyBytes: number;
  historyFileCount: number;
  fileBytes: number;
  fileCount: number;
}

export interface SourceUsageSummary {
  totalBytes: number;
  channelBytes: number;
  blockBytes: number;
  otherBytes: number;
  blockCount: number;
  volumeUsages: SourceVolumeUsage[];
}

export interface RootRuntimeStatus {
  id: string;
  kind: 'source';
  provider: SourceProvider;
  path: string;
  enabled: boolean;
  writable: boolean;
  reservePercent: number;
  opportunisticPolicy: StorageFullPolicy;
  exists: boolean;
  isDirectory: boolean;
  canWrite: boolean;
  availableBytes?: number;
  usage: SourceUsageSummary;
  lastWriteFailure?: RootWriteFailure;
}

export interface RootsRuntimeSnapshot {
  sources: RootRuntimeStatus[];
  writeFailures: RootWriteFailure[];
}

export interface StorageLocationIssue {
  code:
    | 'unexpected-top-level-entry'
    | 'invalid-block-file-name'
    | 'invalid-channel-directory'
    | 'invalid-event-file-name'
    | 'block-hash-mismatch'
    | 'event-deserialize-failed'
    | 'event-hash-mismatch'
    | 'event-signature-invalid';
  severity: 'warn' | 'error';
  relativePath: string;
  absolutePath: string;
  detail: string;
}

export interface StorageLocationRepairReport {
  sourceId: string;
  path: string;
  issueCount: number;
  cleanupCandidateCount: number;
  issues: StorageLocationIssue[];
}

export interface StorageLocationRepairResult {
  sourceId: string;
  removedCount: number;
  issueCount: number;
  cleanupCandidateCount: number;
  action: 'delete' | 'trash';
}

export interface RootConsolidationResult {
  sourceId: string;
  targetId: string;
  movedFiles: number;
  renamedFiles: number;
  copiedFiles: number;
  removedSourceFiles: number;
  skippedExisting: number;
  bytesTransferred: number;
  sameDevice: boolean;
}

export interface DiscoveredNearbytesSource {
  provider: SourceProvider;
  path: string;
  markerFile: string;
  autoUpdate: boolean;
  sourceType: 'marker' | 'layout' | 'suggested';
}

export type DiscoveryAction =
  | 'added-source'
  | 'added-volume-target'
  | 'available-share'
  | 'already-known-source';

export interface DiscoveryProviderSummary {
  detected: number;
  sourcesAdded: number;
  volumeTargetsAdded: number;
  availableShares: number;
}

export interface ReconciledDiscoveredSourceItem {
  provider: SourceProvider;
  path: string;
  markerFile: string;
  classification: 'marker' | 'layout';
  hasMarker: boolean;
  hasBlocks: boolean;
  hasChannels: boolean;
  configuredSourceId?: string;
  detectedVolumeIds: string[];
  matchedVolumeIds: string[];
  unknownVolumeIds: string[];
  addedTargetVolumeIds: string[];
  actions: DiscoveryAction[];
}

export interface ReconciledSourcesSummary {
  scannedAt: number;
  discoveredCount: number;
  sourcesAdded: number;
  volumeTargetsAdded: number;
  availableShares: number;
  meaningfulItemCount: number;
  providers: Partial<Record<SourceProvider, DiscoveryProviderSummary>>;
}

export interface ReconcileSourcesResponse {
  configPath: string | null;
  config: RootsConfig;
  runtime: RootsRuntimeSnapshot;
  runKey: string;
  changed: boolean;
  knownVolumeIds: string[];
  summary: ReconciledSourcesSummary;
  items: ReconciledDiscoveredSourceItem[];
}

export interface VolumeWatchReady {
  volumeId: string;
  autoUpdate: boolean;
  mode: 'filesystem' | 'none';
  providers: SourceProvider[];
}

export interface VolumeWatchUpdate {
  volumeId: string;
  change: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir';
  path: string;
  timestamp: number;
}

export interface VolumeWatchError {
  volumeId: string;
  message: string;
  timestamp: number;
}

export interface SourceWatchReady {
  autoUpdate: boolean;
  mode: 'filesystem' | 'none';
  providers: SourceProvider[];
}

export interface SourceWatchUpdate {
  reason: 'rescan';
  timestamp: number;
  changedPaths: string[];
  providers: SourceProvider[];
}

export interface SourceWatchError {
  message: string;
  timestamp: number;
}

export interface VolumeWatchHandlers {
  onReady?: (event: VolumeWatchReady) => void;
  onUpdate?: (event: VolumeWatchUpdate) => void;
  onError?: (error: Error | VolumeWatchError) => void;
  onClose?: () => void;
}

export interface SourceWatchHandlers {
  onReady?: (event: SourceWatchReady) => void;
  onUpdate?: (event: SourceWatchUpdate) => void;
  onError?: (error: Error | SourceWatchError) => void;
  onClose?: () => void;
}

export interface VolumeWatchConnection {
  close(): void;
}
