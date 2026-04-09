import { previewJoinLink } from './joinLinkPreview.js';
import { openJoinLinkWithRuntime } from './joinLinkOpen.js';

/**
 * API client for Nearbytes Phase 2 backend.
 * Handles authentication, file operations, and error parsing.
 */

export type Auth = { type: 'token'; token: string } | { type: 'secret'; secret: string };

export interface FileMetadata {
  filename: string;
  blobHash: string;
  contentType?: 'b' | 'm';
  size: number;
  mimeType?: string;
  createdAt: number;
}

export interface ContentDescriptor {
  t: 'b' | 'm';
  h: string;
  z: number;
}

export interface SourceFileReference {
  p: 'nb.src.ref.v1';
  s: string;
  c: ContentDescriptor;
  x: string;
}

export interface SourceReferenceBundleItem {
  name: string;
  mime?: string;
  createdAt?: number;
  ref: SourceFileReference;
}

export interface SourceReferenceBundle {
  p: 'nb.src.refs.v1';
  s: string;
  items: SourceReferenceBundleItem[];
}

export interface RecipientKeyCapsule {
  r: string;
  e: string;
  n: string;
  w: string;
}

export interface RecipientFileReference {
  p: 'nb.ref.v1';
  c: ContentDescriptor;
  k: RecipientKeyCapsule;
}

export interface RecipientReferenceBundleItem {
  name: string;
  mime?: string;
  createdAt?: number;
  ref: RecipientFileReference;
}

export interface RecipientReferenceBundle {
  p: 'nb.refs.v1';
  r: string;
  items: RecipientReferenceBundleItem[];
}

export interface IdentityProfile {
  displayName: string;
  bio?: string;
}

export interface IdentityRecord {
  p: 'nb.identity.record.v1';
  k: string;
  ts: number;
  profile: IdentityProfile;
  sig: string;
}

export interface ChatAttachment {
  kind: 'nb.src.ref.v1';
  name: string;
  mime?: string;
  createdAt?: number;
  ref: SourceFileReference;
}

export interface ChatMessage {
  p: 'nb.chat.message.v1';
  k: string;
  ts: number;
  body?: string;
  attachment?: ChatAttachment;
  sig: string;
}

export interface PublishedIdentity {
  eventHash: string;
  authorPublicKey: string;
  publishedAt: number;
  record: IdentityRecord;
}

export interface PublishedChatMessage {
  eventHash: string;
  authorPublicKey: string;
  publishedAt: number;
  message: ChatMessage;
}

export interface VolumeChatState {
  identities: PublishedIdentity[];
  messages: PublishedChatMessage[];
  isOffline?: boolean;
}

export interface ReferenceExportResponse<TBundle> {
  bundle: TBundle;
  serialized: string;
  upgradedCount: number;
}

export interface ReferenceImportResponse {
  imported: FileMetadata[];
  importedCount: number;
  commit?: DurableCommitAck;
}

export interface DurableCommitAck {
  commitId: string;
  status: 'acknowledged';
  durableAt: number;
  resumed: boolean;
}

export interface PublishIdentityResponse {
  published: PublishedIdentity;
  commit?: DurableCommitAck;
}

export interface SendChatMessageResponse {
  sent: PublishedChatMessage;
  commit?: DurableCommitAck;
}

export interface OpenVolumeResponse {
  volumeId: string;
  fileCount: number;
  files: FileMetadata[];
  isOffline?: boolean;
  runtimeFailureReason?: string;
  token?: string;
  /** Shown when storage appears empty (e.g. wrong NEARBYTES_STORAGE_DIR). */
  storageHint?: string;
}

export interface ListFilesResponse {
  volumeId: string;
  files: FileMetadata[];
  isOffline?: boolean;
  runtimeFailureReason?: string;
}

export interface UploadResponse {
  created: FileMetadata;
  commit?: DurableCommitAck;
}

export interface SnapshotSummary {
  generatedAt: number;
  eventCount: number;
  fileCount: number;
  lastEventHash: string | null;
}

export interface SnapshotResponse {
  snapshot: SnapshotSummary;
}

export interface TimelineEvent {
  eventHash: string;
  type: 'CREATE_FILE' | 'DELETE_FILE' | 'RENAME_FILE' | 'DECLARE_IDENTITY' | 'CHAT_MESSAGE' | 'APP_RECORD';
  filename: string;
  timestamp: number;
  protocol?: string;
  blobHash?: string;
  contentType?: 'b' | 'm';
  toFilename?: string;
  size?: number;
  mimeType?: string;
  createdAt?: number;
  deletedAt?: number;
  renamedAt?: number;
  publishedAt?: number;
  authorPublicKey?: string;
  displayName?: string;
  body?: string;
  attachmentName?: string;
  summary?: string;
  record?: IdentityRecord;
  message?: ChatMessage;
}

export interface TimelineResponse {
  volumeId: string;
  eventCount: number;
  events: TimelineEvent[];
  isOffline?: boolean;
  runtimeFailureReason?: string;
}

export interface TimelineDeltaResponse extends TimelineResponse {
  requestedCursor: string | null;
  acceptedCursor: string | null;
  nextCursor: string | null;
  reset: boolean;
  totalEventCount: number;
}

export interface SerializedEventPayload {
  type: string;
  fileName: string;
  toFileName?: string;
  hash: string;
  encryptedKey: string;
  contentType?: 'b' | 'm';
  size?: number;
  mimeType?: string;
  createdAt?: number;
  deletedAt?: number;
  renamedAt?: number;
  authorPublicKey?: string;
  protocol?: string;
  record?: string;
  message?: string;
  publishedAt?: number;
}

export interface SerializedEvent {
  envelope: {
    version: string;
    publicKey: string;
    blockRefs: string[];
    ciphertext: string;
  };
  signature: string;
}

export interface EventDetailResponse {
  eventHash: string;
  event: SerializedEvent;
  decryptedPayload?: SerializedEventPayload;
}

export interface EventStorageLocationEntry {
  rootId: string | null;
  provider: SourceProvider | string;
  rootPath: string;
  eventPath: string;
  dataPath: string | null;
  hasEventFile: boolean;
  hasDataBlock: boolean;
}

export interface EventStorageLocationsResponse {
  eventHash: string;
  volumeId: string;
  expectedEventRelativePath: string;
  expectedDataRelativePath: string | null;
  locations: EventStorageLocationEntry[];
}

export interface RenameFolderSummary {
  fromFolder: string;
  toFolder: string;
  movedFiles: number;
  mergedConflicts: number;
}

export interface RenameFolderResponse {
  renamed: RenameFolderSummary;
  commit?: DurableCommitAck;
}

export interface RenameFileSummary {
  fromName: string;
  toName: string;
}

export interface RenameFileResponse {
  renamed: RenameFileSummary;
  commit?: DurableCommitAck;
}

export type SourceProvider = 'local' | 'dropbox' | 'mega' | 'gdrive' | 'icloud' | 'onedrive';
export type RootProvider = SourceProvider;
export type StorageFullPolicy = 'block-writes' | 'drop-older-blocks';
export type TransportKind = 'provider-share' | 'http' | 'peer-http' | (string & {});

export interface ProviderCredentialMaterial {
  name?: string;
  email?: string;
  password?: string;
  mfaCode?: string;
  confirmationLink?: string;
}

export interface TransportEndpointAccountBootstrap {
  mode?: 'login' | 'signup' | 'confirm-signup';
  label?: string;
  email?: string;
  preferred?: boolean;
  credentials?: ProviderCredentialMaterial;
}

export interface TransportEndpointStorageBootstrap {
  localPath?: string;
  localPathHint?: string;
}

export interface TransportEndpointBootstrap {
  account?: TransportEndpointAccountBootstrap;
  storage?: TransportEndpointStorageBootstrap;
}

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

export interface TransportEndpoint {
  p: 'nb.transport.endpoint.v1';
  transport: TransportKind;
  provider?: string;
  priority: number;
  capabilities: string[];
  descriptor: Record<string, unknown>;
  label?: string;
  badges?: string[];
  bootstrap?: TransportEndpointBootstrap;
}

export interface TransportRecipe {
  p: 'nb.transport.recipe.v1';
  id: string;
  label: string;
  purpose: string;
  endpoints: TransportEndpoint[];
}

export type JoinLinkSpace =
  | {
      mode: 'seed';
      value: string;
      password?: string;
    }
  | {
      mode: 'secret-file';
      name: string;
      mime?: string;
      payload: string;
    }
  | {
      mode: 'volume-id';
      value: string;
    };

export interface JoinLinkAttachment {
  id: string;
  label: string;
  recipe: TransportRecipe;
}

export interface JoinLink {
  p: 'nb.join.v1';
  space: JoinLinkSpace;
  attachments: JoinLinkAttachment[];
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

export interface PlannedTransportCandidate {
  endpoint: TransportEndpoint;
  score: [number, number, number, number, number, number];
  badges: string[];
  supported: boolean;
  reason: string;
  matchKey?: string;
}

export interface PlannedAttachment {
  attachment: JoinLinkAttachment;
  selectedEndpoint: PlannedTransportCandidate | null;
  candidates: PlannedTransportCandidate[];
}

export interface JoinLinkPlan {
  link: JoinLink;
  attachments: PlannedAttachment[];
}

export interface ProviderAccountsResponse {
  accounts: ProviderAccount[];
  providers: ProviderCatalogEntry[];
  preferredProviders: string[];
}

export interface AppConfigResponse {
  config: AppConfig;
}

export interface ManagedSharesResponse {
  shares: ManagedShareSummary[];
}

export interface IncomingManagedSharesResponse {
  shares: IncomingManagedShareOffer[];
}

export interface IncomingProviderContactInvitesResponse {
  invites: IncomingProviderContactInvite[];
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

export interface LocalNetworkPeerMutationResponse {
  peer: LocalNetworkPeer;
}

export interface ConnectProviderAccountResponse {
  status: 'connected' | 'pending' | 'failed';
  account?: ProviderAccount;
  authSession?: ProviderAuthSession;
}

export interface ConfigureProviderResponse {
  setup: ProviderSetupState;
}

export interface ReconcileProviderManagedSharesResponse {
  provider: string;
  adoptedShares: number;
  retiredShares: number;
  migratedShares: number;
}

export interface ManagedShareMutationResponse {
  summary: ManagedShareSummary;
}

export interface JoinLinkParseResponse {
  plan: JoinLinkPlan;
  space: JoinLinkSpace;
}

export interface JoinLinkOpenResponse extends JoinLinkParseResponse {
  secret: string | null;
  volumeId: string | null;
  actions: Array<{
    attachmentId: string;
    endpointTransport?: string;
    provider?: string;
    status: 'attached' | 'planned' | 'needs-account' | 'pending-auth' | 'unsupported';
    accountId?: string;
    shareId?: string;
    suggestedLocalPath?: string;
    usedCredentialBootstrap?: boolean;
    detail: string;
  }>;
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

export interface StorageLocationRepairReportResponse {
  report: StorageLocationRepairReport;
}

export interface StorageLocationRepairResponse {
  result: StorageLocationRepairResult;
  report: StorageLocationRepairReport;
}

export interface RootsConfigResponse {
  configPath: string | null;
  config: RootsConfig;
  runtime: RootsRuntimeSnapshot;
}

export interface RootConsolidationSource {
  id: string;
  kind: 'source';
  provider: SourceProvider;
  path: string;
  fileCount: number;
  totalBytes: number;
}

export interface RootConsolidationCandidate {
  id: string;
  kind: 'source';
  provider: SourceProvider;
  path: string;
  sameDevice: boolean;
  filesToTransfer: number;
  bytesToTransfer: number;
  availableBytes?: number;
  enoughSpace: boolean;
  eligible: boolean;
  reason?: string;
}

export interface RootConsolidationPlan {
  generatedAt: number;
  source: RootConsolidationSource;
  candidates: RootConsolidationCandidate[];
}

export interface RootConsolidationPlanResponse {
  plan: RootConsolidationPlan;
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

export interface RootConsolidationResponse extends RootsConfigResponse {
  result: RootConsolidationResult;
}

export interface DiscoveredNearbytesSource {
  provider: SourceProvider;
  path: string;
  markerFile: string;
  autoUpdate: boolean;
  sourceType: 'marker' | 'layout' | 'suggested';
}

export interface DiscoverSourcesResponse {
  scannedAt: number;
  sourceCount: number;
  sources: DiscoveredNearbytesSource[];
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

export interface ReconcileSourcesResponse extends RootsConfigResponse {
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

export interface ApiError {
  error: {
    code: string;
    message: string;
  };
}

import {
  getDesktopBridge,
  type DesktopRuntimeLogsResponse,
} from './host/desktopBridge.js';
import {
  chooseDesktopDirectoryPath,
  hasDesktopDirectoryPicker as shellHasDesktopDirectoryPicker,
  hasDesktopRuntimeLogsBridge as shellHasDesktopRuntimeLogsBridge,
  readDesktopRuntimeLogs as shellReadDesktopRuntimeLogs,
  tryRevealPathInFileManager,
} from './host/desktopShell.js';
import { getActiveHost } from './host/resolveHost.js';
import {
  importCompatibilityEventDetail,
  importCompatibilityTimelineSnapshot,
  importCompatibilityVolumeSnapshot,
  importLocalNetworkPeersSnapshot,
  writeMirrorCheckpoint,
} from './mirror/browserMirror.js';
import {
  openHostStream,
  requestHostBlob,
} from './host/runtimeTransport.js';

export interface UiDebugCapabilities {
  available: boolean;
  actions: Array<
    'inspect'
    | 'quitApp'
    | 'navigate'
    | 'waitFor'
    | 'click'
    | 'type'
    | 'pressKey'
    | 'read'
    | 'screenshot'
    | 'snapshotDom'
    | 'filesystem.readTextFile'
    | 'mega.syncUntilFileReadable'
  >;
  screenshot: boolean;
  title?: string;
  url?: string;
}

export type UiDebugAction =
  | { type: 'inspect' }
  | { type: 'quitApp' }
  | { type: 'navigate'; path?: string; url?: string; waitForLoad?: boolean }
  | { type: 'waitFor'; selector: string; state?: 'present' | 'visible' | 'hidden'; timeoutMs?: number; pollIntervalMs?: number }
  | { type: 'click'; selector: string }
  | { type: 'type'; selector: string; value: string; clear?: boolean; submit?: boolean }
  | { type: 'pressKey'; key: string; alt?: boolean; control?: boolean; meta?: boolean; shift?: boolean }
  | { type: 'read'; selector: string; field?: 'text' | 'html' | 'outerHtml' | 'value'; attribute?: string }
  | { type: 'screenshot'; path?: string; selector?: string; fullPage?: boolean }
  | { type: 'snapshotDom'; selector?: string; maxLength?: number }
  | { type: 'filesystem.readTextFile'; path: string; maxBytes?: number }
  | {
      type: 'mega.syncUntilFileReadable';
      shareId?: string;
      ownerEmail?: string;
      shareName?: string;
      relativePath?: string;
      timeoutMs?: number;
      pollIntervalMs?: number;
      maxBytes?: number;
    };

export interface UiDebugRunResponse {
  ok: boolean;
  actionCount: number;
  results: Array<{
    type: UiDebugAction['type'];
    ok: boolean;
    durationMs: number;
    result?: Record<string, unknown>;
    error?: string;
  }>;
}
/**
 * Creates auth headers for API requests.
 */
function createAuthHeaders(auth: Auth): HeadersInit {
  if (auth.type === 'token') {
    return {
      Authorization: `Bearer ${auth.token}`,
    };
  }
  return {
    'x-nearbytes-secret': auth.secret,
  };
}

function decodeWatchMessageData(event: MessageEvent): string {
  return typeof event.data === 'string' ? event.data : String(event.data ?? '');
}

export function hasDesktopDirectoryPicker(): boolean {
  return shellHasDesktopDirectoryPicker();
}

export async function chooseDirectoryPath(initialPath = ''): Promise<string | null> {
  return chooseDesktopDirectoryPath(initialPath);
}

export async function readDesktopRuntimeLogs(): Promise<DesktopRuntimeLogsResponse | null> {
  return shellReadDesktopRuntimeLogs();
}

/** True when the desktop bridge can read dev backend log files (stdout/stderr tails). Not used for native MEGA sync state. */
export function hasDesktopRuntimeLogsBridge(): boolean {
  return shellHasDesktopRuntimeLogsBridge();
}

/**
 * Makes an API request with error handling.
 */
async function apiRequest<T>(
  endpoint: string,
  options: RequestInit & { auth?: Auth } = {}
): Promise<T> {
  const host = await getActiveHost();
  const { auth, ...fetchOptions } = options;
  const headers = new Headers(fetchOptions.headers);

  if (auth) {
    const authHeaders = createAuthHeaders(auth);
    Object.entries(authHeaders).forEach(([key, value]) => {
      headers.set(key, value);
    });
  }

  return host.objects.requestJson<T>(endpoint, {
    ...fetchOptions,
    headers,
  });
}

/**
 * Opens a volume with a secret and returns volume info + files.
 * If token is returned, it should be used for subsequent requests.
 */
export async function openVolume(secret: string): Promise<OpenVolumeResponse> {
  const host = await getActiveHost();
  const response = await host.legacyDesktop.openVolume(secret) as OpenVolumeResponse;
  await importCompatibilityVolumeSnapshot(response);
  return response;
}

/**
 * Lists files for an authenticated volume.
 */
export async function listFiles(auth: Auth): Promise<ListFilesResponse> {
  const host = await getActiveHost();
  const response = await host.legacyDesktop.listFiles(auth) as ListFilesResponse;
  await importCompatibilityVolumeSnapshot(response);
  return response;
}

/**
 * Returns a deterministic timeline of all events for the current volume.
 */
export async function getTimeline(auth: Auth): Promise<TimelineResponse> {
  const host = await getActiveHost();
  const response = await host.legacyDesktop.getTimeline(auth) as TimelineResponse;
  await importCompatibilityTimelineSnapshot(response);
  return response;
}

export async function getTimelineDelta(auth: Auth, afterEventHash: string | null): Promise<TimelineDeltaResponse> {
  const params = new URLSearchParams();
  if (afterEventHash) {
    params.set('afterEventHash', afterEventHash);
  }
  const endpoint = params.size > 0 ? `/timeline?${params.toString()}` : '/timeline';
  return apiRequest<TimelineDeltaResponse>(endpoint, { auth });
}

/**
 * Returns the encoded on-disk event payload + signature for a specific event hash.
 */
export async function getEventDetail(auth: Auth, eventHash: string): Promise<EventDetailResponse> {
  const host = await getActiveHost();
  const response = await host.legacyDesktop.getEventDetail(auth, eventHash) as EventDetailResponse;
  await importCompatibilityEventDetail(response);
  return response;
}

/**
 * Returns expected event/block paths and per-root presence for a specific event.
 */
export async function getEventStorageLocations(
  auth: Auth,
  eventHash: string
): Promise<EventStorageLocationsResponse> {
  const host = await getActiveHost();
  return host.legacyDesktop.getEventStorageLocations(auth, eventHash) as Promise<EventStorageLocationsResponse>;
}

/**
 * Uploads one or more files using multipart/form-data.
 * Returns array of created file metadata.
 */
export async function uploadFiles(
  auth: Auth,
  files: FileList | File[]
): Promise<UploadResponse[]> {
  const fileArray = Array.from(files);
  const host = await getActiveHost();
  const results: UploadResponse[] = [];

  for (const file of fileArray) {
    const result = await host.legacyDesktop.uploadFile(auth, file) as UploadResponse;
    results.push(result);
  }

  return results;
}

/**
 * Deletes a file by filename.
 */
export async function deleteFile(auth: Auth, filename: string): Promise<void> {
  const host = await getActiveHost();
  await host.legacyDesktop.deleteFile(auth, filename);
}

/**
 * Renames a single file without rewriting its blob.
 */
export async function renameFile(
  auth: Auth,
  from: string,
  to: string
): Promise<RenameFileResponse> {
  const host = await getActiveHost();
  return host.legacyDesktop.renameFile(auth, from, to) as Promise<RenameFileResponse>;
}

/**
 * Renames a virtual folder prefix by rewriting file metadata events.
 */
export async function renameFolder(
  auth: Auth,
  from: string,
  to: string,
  merge = false
): Promise<RenameFolderResponse> {
  const host = await getActiveHost();
  return host.legacyDesktop.renameFolder(auth, from, to, merge) as Promise<RenameFolderResponse>;
}

export async function exportSourceReferences(
  auth: Auth,
  filenames: string[]
): Promise<ReferenceExportResponse<SourceReferenceBundle>> {
  const host = await getActiveHost();
  return host.legacyDesktop.exportSourceReferences(auth, filenames) as Promise<ReferenceExportResponse<SourceReferenceBundle>>;
}

export async function importSourceReferences(
  auth: Auth,
  bundle: SourceReferenceBundle,
  sourceSecret: string
): Promise<ReferenceImportResponse> {
  const host = await getActiveHost();
  return host.legacyDesktop.importSourceReferences(auth, bundle, sourceSecret) as Promise<ReferenceImportResponse>;
}

export async function exportRecipientReferences(
  auth: Auth,
  filenames: string[],
  recipientVolumeId: string
): Promise<ReferenceExportResponse<RecipientReferenceBundle>> {
  const host = await getActiveHost();
  return host.legacyDesktop.exportRecipientReferences(auth, filenames, recipientVolumeId) as Promise<ReferenceExportResponse<RecipientReferenceBundle>>;
}

export async function importRecipientReferences(
  auth: Auth,
  bundle: RecipientReferenceBundle
): Promise<ReferenceImportResponse> {
  const host = await getActiveHost();
  return host.legacyDesktop.importRecipientReferences(auth, bundle) as Promise<ReferenceImportResponse>;
}

export async function listChat(auth: Auth): Promise<VolumeChatState> {
  const host = await getActiveHost();
  return host.legacyDesktop.listChat(auth) as Promise<VolumeChatState>;
}

export async function publishIdentity(
  auth: Auth,
  identitySecret: string,
  profile: IdentityProfile
): Promise<PublishIdentityResponse> {
  const host = await getActiveHost();
  return host.legacyDesktop.publishIdentity(auth, identitySecret, profile) as Promise<PublishIdentityResponse>;
}

export async function sendChatMessage(
  auth: Auth,
  identitySecret: string,
  input: { body?: string; attachment?: ChatAttachment }
): Promise<SendChatMessageResponse> {
  const host = await getActiveHost();
  return host.legacyDesktop.sendChatMessage(auth, identitySecret, input) as Promise<SendChatMessageResponse>;
}

/**
 * Computes and persists a snapshot for the current volume on demand.
 */
export async function computeSnapshot(auth: Auth): Promise<SnapshotResponse> {
  return apiRequest<SnapshotResponse>('/snapshot', {
    method: 'POST',
    auth,
  });
}

/**
 * Reads local multi-root storage configuration.
 */
export async function getRootsConfig(options: { signal?: AbortSignal; includeUsage?: boolean } = {}): Promise<RootsConfigResponse> {
  const query = options.includeUsage === true ? '?includeUsage=1' : '';
  return apiRequest<RootsConfigResponse>(`/config/roots${query}`, {
    method: 'GET',
    signal: options.signal,
  });
}

/**
 * Saves local multi-root storage configuration.
 */
export async function updateRootsConfig(config: RootsConfig): Promise<RootsConfigResponse> {
  return apiRequest<RootsConfigResponse>('/config/roots', {
    method: 'PUT',
    body: JSON.stringify({ config }),
  });
}

/**
 * Reads valid destination candidates for consolidating one root into another.
 */
export async function getRootConsolidationPlan(sourceId: string): Promise<RootConsolidationPlanResponse> {
  const encodedSourceId = encodeURIComponent(sourceId);
  return apiRequest<RootConsolidationPlanResponse>(`/config/roots/consolidate/${encodedSourceId}/plan`, {
    method: 'GET',
  });
}

/**
 * Consolidates one root into another and removes the source root from config.
 */
export async function consolidateRoot(sourceId: string, targetId: string): Promise<RootConsolidationResponse> {
  return apiRequest<RootConsolidationResponse>('/config/roots/consolidate', {
    method: 'POST',
    body: JSON.stringify({ sourceId, targetId }),
  });
}

/**
 * Opens a configured root path in the OS file manager.
 */
export async function openRootInFileManager(rootId: string): Promise<void> {
  try {
    await apiRequest('/config/roots/open-file-manager', {
      method: 'POST',
      body: JSON.stringify({ rootId }),
    });
  } catch (error) {
    if (!(error instanceof Error) || !/not found|404/i.test(error.message)) {
      throw error;
    }
    await apiRequest('/config/open-file-manager', {
      method: 'POST',
      body: JSON.stringify({ rootId }),
    });
  }
}

export async function getStorageLocationRepairReport(sourceId: string): Promise<StorageLocationRepairReportResponse> {
  const encodedSourceId = encodeURIComponent(sourceId);
  return apiRequest<StorageLocationRepairReportResponse>(`/config/roots/sources/${encodedSourceId}/repair`, {
    method: 'GET',
  });
}

export async function repairStorageLocation(
  sourceId: string,
  action: 'trash' | 'delete'
): Promise<StorageLocationRepairResponse> {
  const encodedSourceId = encodeURIComponent(sourceId);
  return apiRequest<StorageLocationRepairResponse>(`/config/roots/sources/${encodedSourceId}/repair`, {
    method: 'POST',
    body: JSON.stringify({ action }),
  });
}

/**
 * Opens an explicit path in the OS file manager.
 */
export async function openPathInFileManager(targetPath: string): Promise<void> {
  if (await tryRevealPathInFileManager(targetPath)) {
    return;
  }
  await apiRequest('/config/open-path-in-file-manager', {
    method: 'POST',
    body: JSON.stringify({ path: targetPath }),
  });
}

/**
 * Scans local synced directories for Nearbytes marker locations.
 */
export async function discoverSources(params?: {
  maxDepth?: number;
  maxDirectories?: number;
}): Promise<DiscoverSourcesResponse> {
  const query = new URLSearchParams();
  if (params?.maxDepth !== undefined) {
    query.set('maxDepth', String(params.maxDepth));
  }
  if (params?.maxDirectories !== undefined) {
    query.set('maxDirectories', String(params.maxDirectories));
  }

  const suffix = query.toString();
  const endpoint = suffix.length > 0 ? `/sources/discover?${suffix}` : '/sources/discover';
  return apiRequest<DiscoverSourcesResponse>(endpoint, {
    method: 'GET',
  });
}

export async function reconcileDiscoveredSources(
  knownVolumeIds: string[] = []
): Promise<ReconcileSourcesResponse> {
  return apiRequest<ReconcileSourcesResponse>('/sources/reconcile', {
    method: 'POST',
    body: JSON.stringify({ knownVolumeIds }),
  });
}

export async function listProviderAccounts(
  options: { signal?: AbortSignal; fast?: boolean } = {}
): Promise<ProviderAccountsResponse> {
  const host = await getActiveHost();
  return host.integrations.listProviderAccounts(options) as Promise<ProviderAccountsResponse>;
}

export async function getAppConfig(options: { signal?: AbortSignal } = {}): Promise<AppConfigResponse> {
  return apiRequest<AppConfigResponse>('/config/app', {
    method: 'GET',
    signal: options.signal,
  });
}

export async function updateProviderEnabled(provider: string, enabled: boolean): Promise<AppConfigResponse> {
  const encoded = encodeURIComponent(provider);
  return apiRequest<AppConfigResponse>(`/config/app/providers/${encoded}`, {
    method: 'PUT',
    body: JSON.stringify({ enabled }),
  });
}

export async function connectProviderAccount(input: {
  provider: string;
  mode?: 'login' | 'signup' | 'confirm-signup';
  label?: string;
  email?: string;
  preferred?: boolean;
  authSessionId?: string;
  credentials?: {
    name?: string;
    email?: string;
    password?: string;
    mfaCode?: string;
    confirmationLink?: string;
  };
}, options: { signal?: AbortSignal } = {}): Promise<ConnectProviderAccountResponse> {
  const host = await getActiveHost();
  return host.integrations.connectProviderAccount(input, options) as Promise<ConnectProviderAccountResponse>;
}

export async function disconnectProviderAccount(accountId: string): Promise<void> {
  const host = await getActiveHost();
  await host.integrations.disconnectProviderAccount(accountId);
}

export async function configureProviderSetup(
  provider: string,
  input: {
    clientId?: string;
    clientSecret?: string;
  }
): Promise<ConfigureProviderResponse> {
  const host = await getActiveHost();
  return host.integrations.configureProviderSetup(provider, input) as Promise<ConfigureProviderResponse>;
}

export async function installProviderHelper(
  provider: string,
  options: { signal?: AbortSignal } = {}
): Promise<ConfigureProviderResponse> {
  const host = await getActiveHost();
  return host.integrations.installProviderHelper(provider, options) as Promise<ConfigureProviderResponse>;
}

export async function reconcileProviderManagedShares(
  provider: string,
  options: { signal?: AbortSignal } = {}
): Promise<ReconcileProviderManagedSharesResponse> {
  const host = await getActiveHost();
  return host.integrations.reconcileProviderManagedShares(provider, options) as Promise<ReconcileProviderManagedSharesResponse>;
}

export async function listManagedShares(
  options: { signal?: AbortSignal; fast?: boolean } = {}
): Promise<ManagedSharesResponse> {
  const host = await getActiveHost();
  return host.integrations.listManagedShares(options) as Promise<ManagedSharesResponse>;
}

export async function listIncomingManagedShares(
  options: { signal?: AbortSignal; fast?: boolean } = {}
): Promise<IncomingManagedSharesResponse> {
  const host = await getActiveHost();
  return host.integrations.listIncomingManagedShares(options) as Promise<IncomingManagedSharesResponse>;
}

export async function listIncomingProviderContactInvites(
  options: { signal?: AbortSignal; fast?: boolean } = {}
): Promise<IncomingProviderContactInvitesResponse> {
  const host = await getActiveHost();
  return host.integrations.listIncomingProviderContactInvites(options) as Promise<IncomingProviderContactInvitesResponse>;
}

export async function listLocalNetworkPeers(
  options: { signal?: AbortSignal } = {}
): Promise<LocalNetworkPeersResponse> {
  const host = await getActiveHost();
  const response = await host.lan.listPeers(options) as LocalNetworkPeersResponse;
  await importLocalNetworkPeersSnapshot(response);
  return response;
}

export async function syncLocalNetworkPeer(
  peerId: string,
  options: { signal?: AbortSignal } = {}
): Promise<LocalNetworkPeerMutationResponse> {
  const host = await getActiveHost();
  return host.lan.syncPeer(peerId, options) as Promise<LocalNetworkPeerMutationResponse>;
}

export async function createManagedShare(input: {
  provider: string;
  accountId: string;
  label: string;
  localPath?: string;
  role?: ManagedShare['role'];
  volumeId?: string;
  remoteDescriptor?: Record<string, unknown>;
  capabilities?: string[];
}): Promise<ManagedShareMutationResponse> {
  const host = await getActiveHost();
  return host.integrations.createManagedShare(input) as Promise<ManagedShareMutationResponse>;
}

export async function inviteManagedShare(
  shareId: string,
  emails: string[],
  accessLevel?: 'read' | 'read/write' | 'full access'
): Promise<ManagedShareMutationResponse> {
  const host = await getActiveHost();
  return host.integrations.inviteManagedShare(shareId, emails, accessLevel) as Promise<ManagedShareMutationResponse>;
}

export async function attachManagedShare(
  shareId: string,
  volumeId: string
): Promise<ManagedShareMutationResponse> {
  const host = await getActiveHost();
  return host.integrations.attachManagedShare(shareId, volumeId) as Promise<ManagedShareMutationResponse>;
}

export async function removeManagedShare(shareId: string): Promise<void> {
  const host = await getActiveHost();
  await host.integrations.removeManagedShare(shareId);
}

export async function acceptManagedShare(input: {
  provider: string;
  accountId: string;
  label: string;
  volumeId?: string;
  localPath?: string;
  remoteDescriptor?: Record<string, unknown>;
  capabilities?: string[];
}): Promise<ManagedShareMutationResponse> {
  const host = await getActiveHost();
  return host.integrations.acceptManagedShare(input) as Promise<ManagedShareMutationResponse>;
}

export async function acceptIncomingProviderContactInvite(input: {
  provider: string;
  accountId: string;
  inviteId: string;
}): Promise<void> {
  const host = await getActiveHost();
  await host.integrations.acceptIncomingProviderContactInvite(input);
}

export async function getManagedShareState(shareId: string): Promise<ManagedShareMutationResponse> {
  const host = await getActiveHost();
  return host.integrations.getManagedShareState(shareId) as Promise<ManagedShareMutationResponse>;
}

export async function getUiDebugCapabilities(): Promise<UiDebugCapabilities> {
  return apiRequest<UiDebugCapabilities>('/__debug/ui', {
    method: 'GET',
  });
}

export async function runUiDebugActions(
  actions: UiDebugAction[],
  options: { stopOnError?: boolean } = {}
): Promise<UiDebugRunResponse> {
  return apiRequest<UiDebugRunResponse>('/__debug/ui/actions/run', {
    method: 'POST',
    body: JSON.stringify({
      actions,
      stopOnError: options.stopOnError ?? true,
    }),
  });
}

export async function captureUiDebugScreenshot(input: {
  path?: string;
  selector?: string;
  fullPage?: boolean;
} = {}): Promise<UiDebugRunResponse> {
  return apiRequest<UiDebugRunResponse>('/__debug/ui/screenshot', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function captureUiDebugDomSnapshot(input: {
  selector?: string;
  maxLength?: number;
} = {}): Promise<UiDebugRunResponse> {
  return apiRequest<UiDebugRunResponse>('/__debug/ui/dom', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function parseJoinLink(input: {
  serialized?: string;
  link?: unknown;
  preferredProviders?: string[];
}): Promise<JoinLinkParseResponse> {
  return previewJoinLink(input);
}

export async function openJoinLink(input: {
  serialized?: string;
  link?: unknown;
  volumeId?: string;
  allowCredentialBootstrap?: boolean;
  preferredProviders?: string[];
}): Promise<JoinLinkOpenResponse> {
  return openJoinLinkWithRuntime(input, {
    listProviderAccounts,
    listManagedShares,
    connectProviderAccount,
    acceptManagedShare,
    attachManagedShare,
    previewJoinLink,
  });
}

import { uiDebugLog } from './debug.js';

export function watchSources(handlers: SourceWatchHandlers): VolumeWatchConnection {
  const connectionId = Math.random().toString(36).slice(2, 8);
  let currentConnection: VolumeWatchConnection | null = null;

  void (async () => {
    try {
      uiDebugLog('watchers', `[watch-sources:${connectionId}] opening`);
      const host = await getActiveHost();
      currentConnection = host.invalidation.watchSources({
        onMessage(event) {
          parseSourceWatchMessage(decodeWatchMessageData(event), handlers);
        },
        onClose() {
          uiDebugLog('watchers', `[watch-sources:${connectionId}] stream ended`);
          handlers.onClose?.();
        },
        onError(error) {
          console.warn(`[watch-sources:${connectionId}] error`, error.message);
          handlers.onError?.(error);
        },
      });
      uiDebugLog('watchers', `[watch-sources:${connectionId}] opened`);
    } catch (error) {
      console.warn(
        `[watch-sources:${connectionId}] error`,
        error instanceof Error ? error.message : String(error)
      );
      handlers.onError?.(error instanceof Error ? error : new Error(String(error)));
      handlers.onClose?.();
    }
  })();

  return {
    close() {
      uiDebugLog('watchers', `[watch-sources:${connectionId}] close requested`);
      currentConnection?.close();
    },
  };
}

/**
 * Opens a streaming connection that emits volume updates pushed by the backend.
 */
export function watchVolume(auth: Auth, handlers: VolumeWatchHandlers): VolumeWatchConnection {
  const connectionId = Math.random().toString(36).slice(2, 8);
  let currentConnection: VolumeWatchConnection | null = null;

  void (async () => {
    try {
      uiDebugLog('watchers', `[watch-volume:${connectionId}] opening`);
      const host = await getActiveHost();
      currentConnection = host.invalidation.watchVolume(auth, {
        onMessage(event) {
          parseWatchMessage(decodeWatchMessageData(event), handlers);
        },
        onClose() {
          uiDebugLog('watchers', `[watch-volume:${connectionId}] stream ended`);
          handlers.onClose?.();
        },
        onError(error) {
          console.warn(`[watch-volume:${connectionId}] error`, error.message);
          handlers.onError?.(error);
        },
      });
      uiDebugLog('watchers', `[watch-volume:${connectionId}] opened`);
    } catch (error) {
      console.warn(
        `[watch-volume:${connectionId}] error`,
        error instanceof Error ? error.message : String(error)
      );
      handlers.onError?.(error instanceof Error ? error : new Error(String(error)));
      handlers.onClose?.();
    }
  })();

  return {
    close() {
      uiDebugLog('watchers', `[watch-volume:${connectionId}] close requested`);
      currentConnection?.close();
    },
  };
}

/**
 * Downloads a file by blob hash.
 * Returns the file as a Blob.
 */
export async function downloadFile(auth: Auth, blobHash: string): Promise<Blob> {
  const host = await getActiveHost();
  const headers = new Headers(createAuthHeaders(auth));
  return host.objects.requestBlob(`/file/${blobHash}`, {
    method: 'GET',
    headers,
  });
}

function parseWatchMessage(rawMessage: string, handlers: VolumeWatchHandlers): void {
  const normalized = rawMessage.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  let eventName = 'message';
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim();
      continue;
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  if (dataLines.length === 0) {
    return;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(dataLines.join('\n'));
  } catch {
    return;
  }

  if (eventName === 'watch-ready') {
    const ready = payload as VolumeWatchReady;
    void writeMirrorCheckpoint(`watch:volume:${ready.volumeId}`, {
      kind: 'ready',
      autoUpdate: ready.autoUpdate,
      mode: ready.mode,
      providers: ready.providers,
      updatedAt: Date.now(),
    });
    handlers.onReady?.(ready);
    return;
  }
  if (eventName === 'volume-update') {
    const update = payload as VolumeWatchUpdate;
    void writeMirrorCheckpoint(`watch:volume:${update.volumeId}`, {
      kind: 'update',
      change: update.change,
      path: update.path,
      timestamp: update.timestamp,
    });
    handlers.onUpdate?.(update);
    return;
  }
  if (eventName === 'watch-error') {
    const errorPayload = payload as VolumeWatchError;
    void writeMirrorCheckpoint(`watch:volume:${errorPayload.volumeId}`, {
      kind: 'error',
      message: errorPayload.message,
      timestamp: errorPayload.timestamp,
    });
    handlers.onError?.(errorPayload);
  }
}

function parseSourceWatchMessage(rawMessage: string, handlers: SourceWatchHandlers): void {
  const normalized = rawMessage.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  let eventName = 'message';
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim();
      continue;
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  if (dataLines.length === 0) {
    return;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(dataLines.join('\n'));
  } catch {
    return;
  }

  if (eventName === 'source-watch-ready') {
    const ready = payload as SourceWatchReady;
    void writeMirrorCheckpoint('watch:sources', {
      kind: 'ready',
      autoUpdate: ready.autoUpdate,
      mode: ready.mode,
      providers: ready.providers,
      updatedAt: Date.now(),
    });
    handlers.onReady?.(ready);
    return;
  }
  if (eventName === 'source-watch-update') {
    const update = payload as SourceWatchUpdate;
    void writeMirrorCheckpoint('watch:sources', {
      kind: 'update',
      reason: update.reason,
      timestamp: update.timestamp,
      changedPaths: update.changedPaths,
      providers: update.providers,
    });
    handlers.onUpdate?.(update);
    return;
  }
  if (eventName === 'watch-error') {
    const errorPayload = payload as SourceWatchError;
    void writeMirrorCheckpoint('watch:sources', {
      kind: 'error',
      message: errorPayload.message,
      timestamp: errorPayload.timestamp,
    });
    handlers.onError?.(errorPayload);
  }
}
