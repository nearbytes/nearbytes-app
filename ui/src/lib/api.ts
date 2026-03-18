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
}

export interface ReferenceExportResponse<TBundle> {
  bundle: TBundle;
  serialized: string;
  upgradedCount: number;
}

export interface ReferenceImportResponse {
  imported: FileMetadata[];
  importedCount: number;
}

export interface PublishIdentityResponse {
  published: PublishedIdentity;
}

export interface SendChatMessageResponse {
  sent: PublishedChatMessage;
}

export interface OpenVolumeResponse {
  volumeId: string;
  fileCount: number;
  files: FileMetadata[];
  token?: string;
  /** Shown when storage appears empty (e.g. wrong NEARBYTES_STORAGE_DIR). */
  storageHint?: string;
}

export interface ListFilesResponse {
  volumeId: string;
  files: FileMetadata[];
}

export interface UploadResponse {
  created: FileMetadata;
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
}

export interface SerializedEvent {
  payload: {
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
  };
  signature: string;
}

export interface EventDetailResponse {
  eventHash: string;
  event: SerializedEvent;
}

export interface RenameFolderSummary {
  fromFolder: string;
  toFolder: string;
  movedFiles: number;
  mergedConflicts: number;
}

export interface RenameFolderResponse {
  renamed: RenameFolderSummary;
}

export interface RenameFileSummary {
  fromName: string;
  toName: string;
}

export interface RenameFileResponse {
  renamed: RenameFileSummary;
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
  isConnected: boolean;
  connectionState: 'available' | 'connected' | 'setup';
  accountId?: string;
  setup: ProviderSetupState;
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

export interface ManagedSharesResponse {
  shares: ManagedShareSummary[];
}

export interface IncomingManagedSharesResponse {
  shares: IncomingManagedShareOffer[];
}

export interface IncomingProviderContactInvitesResponse {
  invites: IncomingProviderContactInvite[];
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

interface DesktopRuntimeConfig {
  apiBaseUrl: string;
  desktopToken: string;
  isDesktop: boolean;
}

interface NearbytesDesktopBridge {
  getRuntimeConfig?: () => Promise<DesktopRuntimeConfig>;
  getApiBaseUrl?: () => Promise<string>;
  getDesktopToken?: () => Promise<string>;
  chooseDirectory?: (initialPath?: string) => Promise<string | null>;
  isDesktop?: (() => boolean) | boolean;
}

export interface UiDebugCapabilities {
  available: boolean;
  actions: Array<'inspect' | 'navigate' | 'waitFor' | 'click' | 'type' | 'pressKey' | 'read' | 'screenshot'>;
  screenshot: boolean;
  title?: string;
  url?: string;
}

export type UiDebugAction =
  | { type: 'inspect' }
  | { type: 'navigate'; path?: string; url?: string; waitForLoad?: boolean }
  | { type: 'waitFor'; selector: string; state?: 'present' | 'visible' | 'hidden'; timeoutMs?: number; pollIntervalMs?: number }
  | { type: 'click'; selector: string }
  | { type: 'type'; selector: string; value: string; clear?: boolean; submit?: boolean }
  | { type: 'pressKey'; key: string; alt?: boolean; control?: boolean; meta?: boolean; shift?: boolean }
  | { type: 'read'; selector: string; field?: 'text' | 'html' | 'outerHtml' | 'value'; attribute?: string }
  | { type: 'screenshot'; path?: string; selector?: string; fullPage?: boolean };

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

const WEB_RUNTIME_CONFIG: DesktopRuntimeConfig = {
  apiBaseUrl: '',
  desktopToken: '',
  isDesktop: false,
};

let runtimeConfigPromise: Promise<DesktopRuntimeConfig> | null = null;

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

function getDesktopBridge(): NearbytesDesktopBridge | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const globalWindow = window as unknown as { nearbytesDesktop?: NearbytesDesktopBridge };
  if (!globalWindow.nearbytesDesktop) {
    return null;
  }
  return globalWindow.nearbytesDesktop;
}

export function hasDesktopDirectoryPicker(): boolean {
  const bridge = getDesktopBridge();
  return Boolean(bridge && typeof bridge.chooseDirectory === 'function');
}

export async function chooseDirectoryPath(initialPath = ''): Promise<string | null> {
  const bridge = getDesktopBridge();
  if (!bridge || typeof bridge.chooseDirectory !== 'function') {
    return null;
  }
  return bridge.chooseDirectory(initialPath);
}

function isElectronRenderer(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }
  return /\bElectron\//.test(navigator.userAgent);
}

function useSameOriginDesktopProxy(runtimeConfig: DesktopRuntimeConfig): boolean {
  if (!runtimeConfig.isDesktop || typeof window === 'undefined') {
    return false;
  }
  const { protocol, hostname, port } = window.location;
  return (
    (protocol === 'http:' || protocol === 'https:') &&
    (hostname === '127.0.0.1' || hostname === 'localhost') &&
    port === '5173'
  );
}

function getRequestBaseUrl(runtimeConfig: DesktopRuntimeConfig): string {
  if (useSameOriginDesktopProxy(runtimeConfig)) {
    return '';
  }
  return runtimeConfig.apiBaseUrl;
}

async function getRuntimeConfig(): Promise<DesktopRuntimeConfig> {
  if (runtimeConfigPromise) {
    return runtimeConfigPromise;
  }

  const bridge = getDesktopBridge();
  if (!bridge) {
    if (isElectronRenderer()) {
      runtimeConfigPromise = Promise.reject(
        new Error('Nearbytes desktop bridge is unavailable in Electron renderer.')
      );
      return runtimeConfigPromise;
    }
    runtimeConfigPromise = Promise.resolve(WEB_RUNTIME_CONFIG);
    return runtimeConfigPromise;
  }

  runtimeConfigPromise = (async () => {
    if (typeof bridge.getRuntimeConfig !== 'function') {
      throw new Error('Nearbytes desktop bridge is missing getRuntimeConfig().');
    }
    const config = await bridge.getRuntimeConfig();
    if (!config || config.apiBaseUrl.trim().length === 0 || config.desktopToken.trim().length === 0) {
      throw new Error('Nearbytes desktop bridge returned invalid runtime config.');
    }
    return {
      apiBaseUrl: config.apiBaseUrl,
      desktopToken: config.desktopToken,
      isDesktop: config.isDesktop === true,
    };
  })();
  return runtimeConfigPromise;
}

/**
 * Parses API error responses.
 */
async function parseError(response: Response): Promise<ApiError> {
  try {
    const data = await response.json();
    if (data.error && typeof data.error === 'object') {
      return data as ApiError;
    }
  } catch {
    // Fallback if response isn't JSON
  }
  return {
    error: {
      code: 'INTERNAL_ERROR',
      message: response.statusText || 'Unknown error',
    },
  };
}

/**
 * Makes an API request with error handling.
 */
async function apiRequest<T>(
  endpoint: string,
  options: RequestInit & { auth?: Auth } = {}
): Promise<T> {
  const { auth, ...fetchOptions } = options;
  const runtimeConfig = await getRuntimeConfig();
  const headers = new Headers(fetchOptions.headers);

  if (auth) {
    const authHeaders = createAuthHeaders(auth);
    Object.entries(authHeaders).forEach(([key, value]) => {
      headers.set(key, value);
    });
  }

  if (!headers.has('Content-Type') && fetchOptions.body instanceof FormData === false) {
    headers.set('Content-Type', 'application/json');
  }
  if (runtimeConfig.desktopToken.trim().length > 0) {
    headers.set('x-nearbytes-desktop-token', runtimeConfig.desktopToken);
  }

  const response = await fetch(`${getRequestBaseUrl(runtimeConfig)}${endpoint}`, {
    ...fetchOptions,
    headers,
  });

  if (!response.ok) {
    const error = await parseError(response);
    throw new Error(error.error.message || `Request failed: ${response.statusText}`);
  }

  // Handle empty responses
  const text = await response.text();
  if (!text) {
    return {} as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error('Invalid JSON response from server');
  }
}

/**
 * Opens a volume with a secret and returns volume info + files.
 * If token is returned, it should be used for subsequent requests.
 */
export async function openVolume(secret: string): Promise<OpenVolumeResponse> {
  return apiRequest<OpenVolumeResponse>('/open', {
    method: 'POST',
    body: JSON.stringify({ secret }),
  });
}

/**
 * Lists files for an authenticated volume.
 */
export async function listFiles(auth: Auth): Promise<ListFilesResponse> {
  return apiRequest<ListFilesResponse>('/files', {
    method: 'GET',
    auth,
  });
}

/**
 * Returns a deterministic timeline of all events for the current volume.
 */
export async function getTimeline(auth: Auth): Promise<TimelineResponse> {
  return apiRequest<TimelineResponse>('/timeline', {
    method: 'GET',
    auth,
  });
}

/**
 * Returns the encoded on-disk event payload + signature for a specific event hash.
 */
export async function getEventDetail(auth: Auth, eventHash: string): Promise<EventDetailResponse> {
  return apiRequest<EventDetailResponse>(`/events/${eventHash}`, {
    method: 'GET',
    auth,
  });
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
  const results: UploadResponse[] = [];

  for (const file of fileArray) {
    const formData = new FormData();
    formData.append('file', file);
    // Explicitly send filename to ensure it's preserved
    formData.append('filename', file.name);

    const result = await apiRequest<UploadResponse>('/upload', {
      method: 'POST',
      auth,
      body: formData,
    });
    results.push(result);
  }

  return results;
}

/**
 * Deletes a file by filename.
 */
export async function deleteFile(auth: Auth, filename: string): Promise<void> {
  const encodedName = encodeURIComponent(filename);
  await apiRequest(`/files/${encodedName}`, {
    method: 'DELETE',
    auth,
  });
}

/**
 * Renames a single file without rewriting its blob.
 */
export async function renameFile(
  auth: Auth,
  from: string,
  to: string
): Promise<RenameFileResponse> {
  return apiRequest<RenameFileResponse>('/files/rename', {
    method: 'POST',
    auth,
    body: JSON.stringify({ from, to }),
  });
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
  return apiRequest<RenameFolderResponse>('/folders/rename', {
    method: 'POST',
    auth,
    body: JSON.stringify({ from, to, merge }),
  });
}

export async function exportSourceReferences(
  auth: Auth,
  filenames: string[]
): Promise<ReferenceExportResponse<SourceReferenceBundle>> {
  return apiRequest<ReferenceExportResponse<SourceReferenceBundle>>('/references/source/export', {
    method: 'POST',
    auth,
    body: JSON.stringify({ filenames }),
  });
}

export async function importSourceReferences(
  auth: Auth,
  bundle: SourceReferenceBundle,
  sourceSecret: string
): Promise<ReferenceImportResponse> {
  return apiRequest<ReferenceImportResponse>('/references/source/import', {
    method: 'POST',
    auth,
    body: JSON.stringify({ bundle, sourceSecret }),
  });
}

export async function exportRecipientReferences(
  auth: Auth,
  filenames: string[],
  recipientVolumeId: string
): Promise<ReferenceExportResponse<RecipientReferenceBundle>> {
  return apiRequest<ReferenceExportResponse<RecipientReferenceBundle>>('/references/recipient/export', {
    method: 'POST',
    auth,
    body: JSON.stringify({ filenames, recipientVolumeId }),
  });
}

export async function importRecipientReferences(
  auth: Auth,
  bundle: RecipientReferenceBundle
): Promise<ReferenceImportResponse> {
  return apiRequest<ReferenceImportResponse>('/references/recipient/import', {
    method: 'POST',
    auth,
    body: JSON.stringify({ bundle }),
  });
}

export async function listChat(auth: Auth): Promise<VolumeChatState> {
  return apiRequest<VolumeChatState>('/chat', {
    method: 'GET',
    auth,
  });
}

export async function publishIdentity(
  auth: Auth,
  identitySecret: string,
  profile: IdentityProfile
): Promise<PublishIdentityResponse> {
  return apiRequest<PublishIdentityResponse>('/chat/identities', {
    method: 'POST',
    auth,
    body: JSON.stringify({ identitySecret, profile }),
  });
}

export async function sendChatMessage(
  auth: Auth,
  identitySecret: string,
  input: { body?: string; attachment?: ChatAttachment }
): Promise<SendChatMessageResponse> {
  return apiRequest<SendChatMessageResponse>('/chat/messages', {
    method: 'POST',
    auth,
    body: JSON.stringify({
      identitySecret,
      body: input.body,
      attachment: input.attachment,
    }),
  });
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
export async function getRootsConfig(): Promise<RootsConfigResponse> {
  return apiRequest<RootsConfigResponse>('/config/roots', {
    method: 'GET',
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

export async function listProviderAccounts(): Promise<ProviderAccountsResponse> {
  return apiRequest<ProviderAccountsResponse>('/integrations/accounts', {
    method: 'GET',
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
  return apiRequest<ConnectProviderAccountResponse>('/integrations/accounts/connect', {
    method: 'POST',
    body: JSON.stringify(input),
    signal: options.signal,
  });
}

export async function disconnectProviderAccount(accountId: string): Promise<void> {
  const encoded = encodeURIComponent(accountId);
  await apiRequest(`/integrations/accounts/${encoded}`, {
    method: 'DELETE',
  });
}

export async function configureProviderSetup(
  provider: string,
  input: {
    clientId?: string;
    clientSecret?: string;
  }
): Promise<ConfigureProviderResponse> {
  const encoded = encodeURIComponent(provider);
  return apiRequest<ConfigureProviderResponse>(`/integrations/providers/${encoded}/config`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function installProviderHelper(
  provider: string,
  options: { signal?: AbortSignal } = {}
): Promise<ConfigureProviderResponse> {
  const encoded = encodeURIComponent(provider);
  return apiRequest<ConfigureProviderResponse>(`/integrations/providers/${encoded}/install`, {
    method: 'POST',
    signal: options.signal,
  });
}

export async function reconcileProviderManagedShares(
  provider: string,
  options: { signal?: AbortSignal } = {}
): Promise<ReconcileProviderManagedSharesResponse> {
  const encoded = encodeURIComponent(provider);
  return apiRequest<ReconcileProviderManagedSharesResponse>(`/integrations/providers/${encoded}/reconcile`, {
    method: 'POST',
    signal: options.signal,
  });
}

export async function listManagedShares(): Promise<ManagedSharesResponse> {
  return apiRequest<ManagedSharesResponse>('/integrations/shares', {
    method: 'GET',
  });
}

export async function listIncomingManagedShares(): Promise<IncomingManagedSharesResponse> {
  return apiRequest<IncomingManagedSharesResponse>('/integrations/shares/incoming', {
    method: 'GET',
  });
}

export async function listIncomingProviderContactInvites(): Promise<IncomingProviderContactInvitesResponse> {
  return apiRequest<IncomingProviderContactInvitesResponse>('/integrations/providers/contact-invites', {
    method: 'GET',
  });
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
  return apiRequest<ManagedShareMutationResponse>('/integrations/shares', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function inviteManagedShare(
  shareId: string,
  emails: string[]
): Promise<ManagedShareMutationResponse> {
  const encoded = encodeURIComponent(shareId);
  return apiRequest<ManagedShareMutationResponse>(`/integrations/shares/${encoded}/invite`, {
    method: 'POST',
    body: JSON.stringify({ emails }),
  });
}

export async function attachManagedShare(
  shareId: string,
  volumeId: string
): Promise<ManagedShareMutationResponse> {
  const encoded = encodeURIComponent(shareId);
  return apiRequest<ManagedShareMutationResponse>(`/integrations/shares/${encoded}/attach`, {
    method: 'POST',
    body: JSON.stringify({ volumeId }),
  });
}

export async function removeManagedShare(shareId: string): Promise<void> {
  const encoded = encodeURIComponent(shareId);
  await apiRequest<{ ok: true }>(`/integrations/shares/${encoded}`, {
    method: 'DELETE',
  });
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
  return apiRequest<ManagedShareMutationResponse>('/integrations/shares/accept', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function acceptIncomingProviderContactInvite(input: {
  provider: string;
  accountId: string;
  inviteId: string;
}): Promise<void> {
  await apiRequest<{ ok: true }>('/integrations/providers/contact-invites/accept', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function getManagedShareState(shareId: string): Promise<ManagedShareMutationResponse> {
  const encoded = encodeURIComponent(shareId);
  return apiRequest<ManagedShareMutationResponse>(`/integrations/shares/${encoded}/state`, {
    method: 'GET',
  });
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

export async function parseJoinLink(input: {
  serialized?: string;
  link?: unknown;
  preferredProviders?: string[];
}): Promise<JoinLinkParseResponse> {
  return apiRequest<JoinLinkParseResponse>('/links/join/parse', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function openJoinLink(input: {
  serialized?: string;
  link?: unknown;
  volumeId?: string;
  allowCredentialBootstrap?: boolean;
  preferredProviders?: string[];
}): Promise<JoinLinkOpenResponse> {
  return apiRequest<JoinLinkOpenResponse>('/links/join/open', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

import { uiDebugLog } from './debug.js';

export function watchSources(handlers: SourceWatchHandlers): VolumeWatchConnection {
  const abortController = new AbortController();
  const connectionId = Math.random().toString(36).slice(2, 8);

  void (async () => {
    try {
      uiDebugLog('watchers', `[watch-sources:${connectionId}] opening`);
      const runtimeConfig = await getRuntimeConfig();
      const headers = new Headers();
      if (runtimeConfig.desktopToken.trim().length > 0) {
        headers.set('x-nearbytes-desktop-token', runtimeConfig.desktopToken);
      }

      const response = await fetch(`${getRequestBaseUrl(runtimeConfig)}/watch/sources`, {
        method: 'GET',
        headers,
        signal: abortController.signal,
      });

      if (!response.ok) {
        const apiError = await parseError(response);
        throw new Error(apiError.error.message || 'Failed to open source watch stream');
      }

      if (!response.body) {
        throw new Error('Source watch stream is not available');
      }

      uiDebugLog('watchers', `[watch-sources:${connectionId}] opened`);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        let boundaryIndex = buffer.indexOf('\n\n');
        while (boundaryIndex >= 0) {
          const message = buffer.slice(0, boundaryIndex);
          buffer = buffer.slice(boundaryIndex + 2);
          parseSourceWatchMessage(message, handlers);
          boundaryIndex = buffer.indexOf('\n\n');
        }
      }

      uiDebugLog('watchers', `[watch-sources:${connectionId}] stream ended`);
      handlers.onClose?.();
    } catch (error) {
      if (abortController.signal.aborted) {
        uiDebugLog('watchers', `[watch-sources:${connectionId}] aborted`);
        handlers.onClose?.();
        return;
      }
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
      abortController.abort();
    },
  };
}

/**
 * Opens a streaming connection that emits volume updates pushed by the backend.
 */
export function watchVolume(auth: Auth, handlers: VolumeWatchHandlers): VolumeWatchConnection {
  const abortController = new AbortController();
  const connectionId = Math.random().toString(36).slice(2, 8);

  void (async () => {
    try {
      uiDebugLog('watchers', `[watch-volume:${connectionId}] opening`);
      const runtimeConfig = await getRuntimeConfig();
      const headers = new Headers(createAuthHeaders(auth));
      if (runtimeConfig.desktopToken.trim().length > 0) {
        headers.set('x-nearbytes-desktop-token', runtimeConfig.desktopToken);
      }

      const response = await fetch(`${getRequestBaseUrl(runtimeConfig)}/watch/volume`, {
        method: 'GET',
        headers,
        signal: abortController.signal,
      });

      if (!response.ok) {
        const apiError = await parseError(response);
        throw new Error(apiError.error.message || 'Failed to open watch stream');
      }

      if (!response.body) {
        throw new Error('Watch stream is not available');
      }

      uiDebugLog('watchers', `[watch-volume:${connectionId}] opened`);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        let boundaryIndex = buffer.indexOf('\n\n');
        while (boundaryIndex >= 0) {
          const message = buffer.slice(0, boundaryIndex);
          buffer = buffer.slice(boundaryIndex + 2);
          parseWatchMessage(message, handlers);
          boundaryIndex = buffer.indexOf('\n\n');
        }
      }

      uiDebugLog('watchers', `[watch-volume:${connectionId}] stream ended`);
      handlers.onClose?.();
    } catch (error) {
      if (abortController.signal.aborted) {
        uiDebugLog('watchers', `[watch-volume:${connectionId}] aborted`);
        handlers.onClose?.();
        return;
      }
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
      abortController.abort();
    },
  };
}

/**
 * Downloads a file by blob hash.
 * Returns the file as a Blob.
 */
export async function downloadFile(auth: Auth, blobHash: string): Promise<Blob> {
  const runtimeConfig = await getRuntimeConfig();
  const headers = new Headers(createAuthHeaders(auth));
  if (runtimeConfig.desktopToken.trim().length > 0) {
    headers.set('x-nearbytes-desktop-token', runtimeConfig.desktopToken);
  }

  const response = await fetch(`${getRequestBaseUrl(runtimeConfig)}/file/${blobHash}`, {
    method: 'GET',
    headers,
  });

  if (!response.ok) {
    const error = await parseError(response);
    throw new Error(error.error.message || `Download failed: ${response.statusText}`);
  }

  return response.blob();
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
    handlers.onReady?.(payload as VolumeWatchReady);
    return;
  }
  if (eventName === 'volume-update') {
    handlers.onUpdate?.(payload as VolumeWatchUpdate);
    return;
  }
  if (eventName === 'watch-error') {
    handlers.onError?.(payload as VolumeWatchError);
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
    handlers.onReady?.(payload as SourceWatchReady);
    return;
  }
  if (eventName === 'source-watch-update') {
    handlers.onUpdate?.(payload as SourceWatchUpdate);
    return;
  }
  if (eventName === 'watch-error') {
    handlers.onError?.(payload as SourceWatchError);
  }
}
