/**
 * API client for Nearbytes Phase 2 backend.
 * Handles authentication, file operations, and error parsing.
 */

export type Auth = { type: 'token'; token: string } | { type: 'secret'; secret: string };

export interface FileMetadata {
  filename: string;
  blobHash: string;
  size: number;
  mimeType?: string;
  createdAt: number;
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
  type: 'CREATE_FILE' | 'DELETE_FILE';
  filename: string;
  timestamp: number;
  blobHash?: string;
  size?: number;
  mimeType?: string;
  createdAt?: number;
  deletedAt?: number;
}

export interface TimelineResponse {
  volumeId: string;
  eventCount: number;
  events: TimelineEvent[];
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

export type RootKind = 'main' | 'backup';
export type RootProvider = 'local' | 'dropbox' | 'mega' | 'gdrive';
export type RootStrategy =
  | { name: 'all-keys' }
  | { name: 'allowlist'; channelKeys: string[] };

export interface RootConfigEntry {
  id: string;
  kind: RootKind;
  provider: RootProvider;
  path: string;
  enabled: boolean;
  writable: boolean;
  strategy: RootStrategy;
}

export interface RootsConfig {
  version: 1;
  roots: RootConfigEntry[];
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

export interface RootRuntimeStatus {
  id: string;
  kind: RootKind;
  path: string;
  enabled: boolean;
  writable: boolean;
  exists: boolean;
  isDirectory: boolean;
  canWrite: boolean;
  availableBytes?: number;
  lastWriteFailure?: RootWriteFailure;
}

export interface RootsRuntimeSnapshot {
  roots: RootRuntimeStatus[];
  writeFailures: RootWriteFailure[];
}

export interface RootsConfigResponse {
  configPath: string | null;
  config: RootsConfig;
  runtime: RootsRuntimeSnapshot;
}

export interface RootConsolidationSource {
  id: string;
  kind: RootKind;
  provider: RootProvider;
  path: string;
  fileCount: number;
  totalBytes: number;
}

export interface RootConsolidationCandidate {
  id: string;
  kind: RootKind;
  provider: RootProvider;
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
  provider: RootProvider;
  path: string;
  markerFile: string;
  autoUpdate: boolean;
  sourceType: 'marker' | 'suggested';
}

export interface DiscoverSourcesResponse {
  scannedAt: number;
  sourceCount: number;
  sources: DiscoveredNearbytesSource[];
}

export interface VolumeWatchReady {
  volumeId: string;
  autoUpdate: boolean;
  mode: 'filesystem' | 'none';
  providers: RootProvider[];
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

export interface VolumeWatchHandlers {
  onReady?: (event: VolumeWatchReady) => void;
  onUpdate?: (event: VolumeWatchUpdate) => void;
  onError?: (error: Error | VolumeWatchError) => void;
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

const API_BASE = ''; // Use Vite proxy

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

  const response = await fetch(`${API_BASE}${endpoint}`, {
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
 * Returns a deterministic timeline of file events for the current volume.
 */
export async function getTimeline(auth: Auth): Promise<TimelineResponse> {
  return apiRequest<TimelineResponse>('/timeline', {
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
 * Scans local synced directories for `.nearbytes` marker folders.
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

/**
 * Opens a streaming connection that emits volume updates pushed by the backend.
 */
export function watchVolume(auth: Auth, handlers: VolumeWatchHandlers): VolumeWatchConnection {
  const abortController = new AbortController();

  void (async () => {
    try {
      const response = await fetch(`${API_BASE}/watch/volume`, {
        method: 'GET',
        headers: createAuthHeaders(auth),
        signal: abortController.signal,
      });

      if (!response.ok) {
        const apiError = await parseError(response);
        throw new Error(apiError.error.message || 'Failed to open watch stream');
      }

      if (!response.body) {
        throw new Error('Watch stream is not available');
      }

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

      handlers.onClose?.();
    } catch (error) {
      if (abortController.signal.aborted) {
        handlers.onClose?.();
        return;
      }
      handlers.onError?.(error instanceof Error ? error : new Error(String(error)));
      handlers.onClose?.();
    }
  })();

  return {
    close() {
      abortController.abort();
    },
  };
}

/**
 * Downloads a file by blob hash.
 * Returns the file as a Blob.
 */
export async function downloadFile(auth: Auth, blobHash: string): Promise<Blob> {
  const headers = new Headers(createAuthHeaders(auth));
  const response = await fetch(`${API_BASE}/file/${blobHash}`, {
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
