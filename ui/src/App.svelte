<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import { flip } from 'svelte/animate';
  import {
    openVolume,
    openJoinLink,
    parseJoinLink,
    type JoinLinkOpenResponse,
    type JoinLinkParseResponse,
    listFiles,
    getTimeline,
    getEventDetail,
    getEventStorageLocations,
    openPathInFileManager,
    uploadFiles,
    deleteFile,
    downloadFile,
    exportSourceReferences,
    publishIdentity,
    reconcileDiscoveredSources,
    renameFile,
    watchSources,
    watchVolume,
    type Auth,
    type ChatAttachment,
    type FileMetadata,
    type JoinLink,
    type SerializedEvent,
    type SourceFileReference,
    type RecipientFileReference,
    type ReconcileSourcesResponse,
    type EventStorageLocationsResponse,
    type SourceReferenceBundle,
    type SourceProvider,
    type TimelineEvent,
    type VolumeChatState,
  } from './lib/api.js';
  import { getCachedFiles, setCachedFiles } from './lib/cache.js';
  import {
    buildIdentitySecret,
    createConfiguredIdentity,
    hasConfiguredIdentitySecret,
    loadActiveIdentityId,
    loadConfiguredIdentities,
    loadVolumeIdentityAssignments,
    persistActiveIdentityId,
    persistConfiguredIdentities,
    persistVolumeIdentityAssignments,
    type ConfiguredIdentity,
  } from './lib/chatIdentities.js';
  import {
    exportSourceReferenceBundleFromDrag,
    importMountedSourceReferenceBundle,
    parseSourceReferenceBundleText,
  } from './lib/nearbytesReferenceTransfer.js';
  import { writeNearbytesClipboardPayload } from './lib/referenceClipboard.js';
  import ArmedActionButton from './components/ArmedActionButton.svelte';
  import AudioPreview from './components/AudioPreview.svelte';
  import HubStorageButton from './components/HubStorageButton.svelte';
  import NearbytesLogo from './components/NearbytesLogo.svelte';
  import MountRail from './components/MountRail.svelte';
  import SharedSecretEditor from './components/SharedSecretEditor.svelte';
  import ShareSpaceLinkSection from './components/ShareSpaceLinkSection.svelte';
  import StoragePanel from './components/StoragePanel.svelte';
  import VolumeChat from './components/VolumeChat.svelte';
  import VolumeIdentity from './components/VolumeIdentity.svelte';
  import { NEARBYTES_DRAG_TYPE } from './lib/nearbytesDrag.js';
  import {
    cloneThemeSettings,
    defaultThemeRegistry,
    defaultThemeSettings,
    normalizeThemeRegistry,
    normalizeThemeSettings,
    replaceThemePresetInRegistry,
    themeCssVariables,
    type NearbytesArcStyle,
    type NearbytesSurfaceStyle,
    type NearbytesThemeRegistry,
    type NearbytesThemePresetId,
    type NearbytesThemeSettings,
  } from './lib/branding.js';
  import {
    ClipboardPaste,
    Download,
    FileArchive,
    FileAudio,
    FileCode2,
    FileText,
    FileVideo,
    GripVertical,
    HardDrive,
    History,
    Image as ImageIcon,
    LayoutGrid,
    Link2,
    MessageSquareText,
    Plus,
    RefreshCw,
    Rows3,
    Search,
    Settings2,
    Trash2,
    UserRound,
    X,
  } from 'lucide-svelte';

  const VOLUME_MOUNTS_KEY = 'nearbytes-volume-mounts-v1';
  const SOURCE_DISCOVERY_UI_KEY = 'nearbytes-source-discovery-ui-v1';
  const UI_STATE_SHADOW_KEY = 'nearbytes-ui-state-shadow-v1';
  const THEME_REGISTRY_ASSET_PATH = '/branding/theme-presets.json';
  const FILE_SECRET_PREFIX = 'nb-file-secret:v1:';
  const WORKSPACE_DIVIDER_WIDTH = 14;
  const WORKSPACE_FILE_PANE_MIN_WIDTH = 360;
  const WORKSPACE_CHAT_PANE_MIN_WIDTH = 180;
  const PARKED_MOUNT_WIDTH = 46;
  const isDevThemeStudio = import.meta.env.DEV;
  const SPEC_DOC_CONTENTS = import.meta.glob('../../docs/specs/*.md', {
    as: 'raw',
    eager: true,
  }) as Record<string, string>;
  const SPEC_CONTENT_BY_FILE = new Map<string, string>();
  for (const [specPath, content] of Object.entries(SPEC_DOC_CONTENTS)) {
    const filename = specPath.split('/').pop();
    if (filename) {
      SPEC_CONTENT_BY_FILE.set(filename, content);
    }
  }
  const SPEC_DOCS: SpecDoc[] = [
    {
      id: 'hub-model-v1',
      title: 'Hub model v1',
      filename: 'hub-model-v1.md',
      summary: 'Hub log model and subsystem projection rules.',
      always: true,
    },
    {
      id: 'app-records-v1',
      title: 'App records v1',
      filename: 'app-records-v1.md',
      summary: 'APP_RECORD envelope + replay rules.',
      eventTypes: ['APP_RECORD'],
    },
    {
      id: 'file-events-v2',
      title: 'File protocol v2',
      filename: 'file-events-v2.md',
      summary: 'CREATE/DELETE/RENAME file replay semantics.',
      eventTypes: ['CREATE_FILE', 'DELETE_FILE', 'RENAME_FILE'],
    },
    {
      id: 'chat-events-v1',
      title: 'Chat protocol v1',
      filename: 'chat-events-v1.md',
      summary: 'Hub chat payload and replay rules.',
      protocols: ['nb.chat.message.v1'],
      eventTypes: ['CHAT_MESSAGE', 'DECLARE_IDENTITY'],
    },
    {
      id: 'identity-management-v1',
      title: 'Identity management v1',
      filename: 'identity-management-v1.md',
      summary: 'Identity lifecycle from local creation to hub materialization.',
      always: true,
    },
    {
      id: 'identity-record-v1',
      title: 'Identity record v1',
      filename: 'identity-record-v1.md',
      summary: 'Schema + signature for nb.identity.record.v1.',
      protocols: ['nb.identity.record.v1'],
      eventTypes: ['DECLARE_IDENTITY'],
    },
    {
      id: 'identity-snapshot-v1',
      title: 'Identity snapshot v1',
      filename: 'identity-snapshot-v1.md',
      summary: 'Identity snapshot schema + channel reference.',
      protocols: ['nb.identity.snapshot.v1'],
    },
    {
      id: 'identity-channel-v1',
      title: 'Identity publication v1',
      filename: 'identity-channel-v1.md',
      summary: 'Canonical publication rules for identity records.',
      protocols: ['nb.identity.record.v1'],
    },
    {
      id: 'log-command-map-v1',
      title: 'Log command map v1',
      filename: 'log-command-map-v1.md',
      summary: 'Lookup from event/protocol to governing spec.',
      always: true,
    },
    {
      id: 'protocol-registry',
      title: 'Protocol registry',
      filename: 'protocol-registry.md',
      summary: 'Known protocol IDs + versioning rules.',
      always: true,
    },
  ];
  const NEARBYTES_JOIN_DEEP_LINK_MAX_LENGTH = 16_384;

  type PreviewKind = 'none' | 'image' | 'text' | 'pdf' | 'video' | 'audio' | 'unsupported';
  type EventReference = {
    kind: 'source' | 'recipient';
    name?: string;
    mime?: string;
    createdAt?: number;
    ref: SourceFileReference | RecipientFileReference;
  };
  type TimelineStorageLocationView = EventStorageLocationsResponse['locations'][number];
  type SpecDoc = {
    id: string;
    title: string;
    filename: string;
    summary: string;
    protocols?: string[];
    eventTypes?: string[];
    always?: boolean;
  };
  type DesktopRemoteFile = {
    filename: string;
    mimeType: string;
    bytesBase64: string;
  };

  type PersistedUiState = {
    volumeMounts?: unknown;
    sourceDiscovery?: unknown;
    theme?: unknown;
    savedAt?: unknown;
  };

  type PersistedSourceDiscoveryUiState = {
    lastAcknowledgedRunKey: string;
    latestRunKey: string;
    latestResult: ReconcileSourcesResponse | null;
  };

  type PersistedDiscoveryResult = Pick<ReconcileSourcesResponse, 'runKey' | 'changed' | 'summary' | 'items'>;

  type DesktopUpdaterState = {
    phase: 'idle' | 'checking' | 'downloading' | 'ready' | 'installing' | 'error';
    version: string;
    message: string;
    detail: string;
    progressPercent: number | null;
    transferredBytes: number;
    totalBytes: number;
    bytesPerSecond: number;
    canInstall: boolean;
    releaseUrl: string;
    assetName: string;
  };

  type NearbytesDesktopBridge = {
    connectDeepLinks?: () => Promise<string[]>;
    exportLogoPng?: (dataUrl: string) => Promise<{
      path?: string;
      pngPath?: string;
      icnsPath?: string;
      icoPath?: string;
    } | null>;
    fetchRemoteFile?: (url: string) => Promise<DesktopRemoteFile>;
    getClipboardImageStatus?: () => Promise<{ hasImage: boolean }>;
    readClipboardImage?: () => Promise<DesktopRemoteFile | null>;
    loadUiState?: () => Promise<PersistedUiState>;
    getUpdaterState?: () => Promise<DesktopUpdaterState | null>;
    installDownloadedUpdate?: () => Promise<boolean>;
    openUpdateReleasePage?: () => Promise<boolean>;
    onDeepLink?: (listener: (url: string) => void) => (() => void) | void;
    onUpdaterState?: (listener: (state: DesktopUpdaterState) => void) => (() => void) | void;
    saveUiState?: (state: PersistedUiState) => Promise<unknown>;
    saveThemeRegistry?: (registry: NearbytesThemeRegistry) => Promise<{ path?: string } | null>;
  };

  type ThemeDialogSection = 'preset' | 'material' | 'accent' | 'logo';

  type SecretFileHashEntry = {
    payload: string;
    hash: string;
    pending: boolean;
  };

  type VolumeMount = {
    id: string;
    address: string;
    password: string;
    secretFilePayload: string;
    secretFileName: string;
    secretFileMimeType: string;
    volumeId?: string;
    collapsed: boolean;
    showFilesPane: boolean;
    showChatPane: boolean;
    workspaceSplit: number;
    createdAt: number;
  };

  type MountRuntimeState = {
    mountId: string;
    secret: string;
    label: string;
    auth: Auth;
    volumeId: string;
    files: FileMetadata[];
    timelineEvents: TimelineEvent[];
    timelinePosition: number;
    lastRefresh: number | null;
    isOffline: boolean;
    errorMessage: string;
  };

  function normalizeWorkspaceSplit(value: number | undefined): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return 56;
    }
    return Math.max(1, Math.min(99, value));
  }

  type MountedVolumePresentation = {
    volumeId: string;
    label: string;
    filePayload: string;
    fileMimeType: string;
    fileName: string;
  };

  type FileManagerViewMode = 'icons' | 'details';
  type MountDialogMode = 'secret' | 'join-link';

  type AppReferenceClipboard = {
    bundle: SourceReferenceBundle;
    itemCount: number;
  };

  type DiscoveryToastState = {
    runKey: string;
    message: string;
  };

  type JoinLinkCopyFeedbackState = {
    tone: 'success' | 'warning';
    message: string;
  };

  function normalizeDesktopUpdaterState(input: unknown): DesktopUpdaterState | null {
    if (!input || typeof input !== 'object') {
      return null;
    }
    const candidate = input as Partial<DesktopUpdaterState>;
    if (typeof candidate.phase !== 'string') {
      return null;
    }
    return {
      phase: candidate.phase as DesktopUpdaterState['phase'],
      version: typeof candidate.version === 'string' ? candidate.version : '',
      message: typeof candidate.message === 'string' ? candidate.message : '',
      detail: typeof candidate.detail === 'string' ? candidate.detail : '',
      progressPercent: typeof candidate.progressPercent === 'number' ? candidate.progressPercent : null,
      transferredBytes: typeof candidate.transferredBytes === 'number' ? candidate.transferredBytes : 0,
      totalBytes: typeof candidate.totalBytes === 'number' ? candidate.totalBytes : 0,
      bytesPerSecond: typeof candidate.bytesPerSecond === 'number' ? candidate.bytesPerSecond : 0,
      canInstall: candidate.canInstall === true,
      releaseUrl: typeof candidate.releaseUrl === 'string' ? candidate.releaseUrl : '',
      assetName: typeof candidate.assetName === 'string' ? candidate.assetName : '',
    };
  }

  function formatByteCount(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) {
      return '0 B';
    }
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = bytes;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex += 1;
    }
    const digits = value >= 10 || unitIndex === 0 ? 0 : 1;
    return `${value.toFixed(digits)} ${units[unitIndex]}`;
  }

  function desktopUpdaterProgressSummary(state: DesktopUpdaterState): string {
    const transferred = formatByteCount(state.transferredBytes);
    const total = state.totalBytes > 0 ? formatByteCount(state.totalBytes) : '';
    const rate = state.bytesPerSecond > 0 ? `${formatByteCount(state.bytesPerSecond)}/s` : '';
    const percent =
      typeof state.progressPercent === 'number' ? `${Math.round(Math.max(0, Math.min(100, state.progressPercent)))}%` : '';
    return [percent, total ? `${transferred} of ${total}` : transferred, rate].filter(Boolean).join(' • ');
  }

  function desktopUpdaterPrimaryActionLabel(state: DesktopUpdaterState): string {
    if (state.canInstall) {
      return 'Restart now';
    }
    return 'Open release';
  }

  function createMount(overrides: Partial<VolumeMount> = {}): VolumeMount {
    return {
      id: overrides.id ?? `mount-${Math.random().toString(16).slice(2, 10)}`,
      address: typeof overrides.address === 'string' ? overrides.address.trim() : '',
      password: typeof overrides.password === 'string' ? overrides.password.trim() : '',
      secretFilePayload:
        typeof overrides.secretFilePayload === 'string' ? overrides.secretFilePayload.trim() : '',
      secretFileName: typeof overrides.secretFileName === 'string' ? overrides.secretFileName.trim() : '',
      secretFileMimeType:
        typeof overrides.secretFileMimeType === 'string' ? overrides.secretFileMimeType.trim() : '',
      volumeId: typeof overrides.volumeId === 'string' ? overrides.volumeId.trim().toLowerCase() : undefined,
      collapsed: overrides.collapsed ?? false,
      showFilesPane: overrides.showFilesPane ?? true,
      showChatPane: overrides.showChatPane ?? false,
      workspaceSplit: normalizeWorkspaceSplit(overrides.workspaceSplit),
      createdAt: overrides.createdAt ?? Date.now(),
    };
  }

  function normalizeMounts(input: unknown): VolumeMount[] {
    if (!Array.isArray(input)) return [];
    return input
      .filter((value) => typeof value === 'object' && value !== null)
      .map((value) => value as Partial<VolumeMount>)
      .filter(
        (value) =>
          typeof value.id === 'string' &&
          typeof value.address === 'string' &&
          typeof value.password === 'string' &&
          (value.secretFilePayload === undefined || typeof value.secretFilePayload === 'string') &&
          (value.secretFileName === undefined || typeof value.secretFileName === 'string') &&
          (value.secretFileMimeType === undefined || typeof value.secretFileMimeType === 'string') &&
          (value.volumeId === undefined || typeof value.volumeId === 'string') &&
          typeof value.collapsed === 'boolean' &&
          (value.showFilesPane === undefined || typeof value.showFilesPane === 'boolean') &&
          (value.showChatPane === undefined || typeof value.showChatPane === 'boolean') &&
          (value.workspaceSplit === undefined || typeof value.workspaceSplit === 'number')
      )
      .map((value) =>
        createMount({
          id: value.id,
          address: value.address,
          password: value.password,
          secretFilePayload: value.secretFilePayload,
          secretFileName: value.secretFileName,
          secretFileMimeType: value.secretFileMimeType,
          volumeId: value.volumeId,
          collapsed: value.collapsed,
          showFilesPane: value.showFilesPane,
          showChatPane: value.showChatPane,
          workspaceSplit: value.workspaceSplit,
          createdAt: value.createdAt,
        })
      );
  }

  function loadVolumeMounts(): VolumeMount[] {
    try {
      const shadowState = loadPersistedUiStateLocally();
      if (Array.isArray(shadowState.volumeMounts)) {
        const shadowMounts = normalizeMounts(shadowState.volumeMounts);
        if (shadowMounts.length > 0) {
          return shadowMounts;
        }
      }
      const raw = localStorage.getItem(VOLUME_MOUNTS_KEY);
      if (!raw) return [createMount()];
      const mounts = normalizeMounts(JSON.parse(raw));
      return mounts;
    } catch {
      return [createMount()];
    }
  }

  function persistVolumeMounts(mounts: VolumeMount[]): void {
    try {
      localStorage.setItem(VOLUME_MOUNTS_KEY, JSON.stringify(snapshotVolumeMounts(mounts)));
    } catch {
      // ignore
    }
  }

  function snapshotVolumeMounts(input: VolumeMount[]): VolumeMount[] {
    return input.map((mount) => ({
      id: mount.id,
      address: mount.address,
      password: mount.password,
      secretFilePayload: mount.secretFilePayload,
      secretFileName: mount.secretFileName,
      secretFileMimeType: mount.secretFileMimeType,
      volumeId: mount.volumeId,
      collapsed: mount.collapsed,
      showFilesPane: mount.showFilesPane,
      showChatPane: mount.showChatPane,
      workspaceSplit: mount.workspaceSplit,
      createdAt: mount.createdAt,
    }));
  }

  function formatSourceProvider(provider: SourceProvider): string {
    if (provider === 'gdrive') return 'Google Drive';
    if (provider === 'dropbox') return 'Dropbox';
    if (provider === 'mega') return 'MEGA';
    if (provider === 'icloud') return 'Apple/iCloud';
    if (provider === 'onedrive') return 'OneDrive';
    return 'Local';
  }

  function joinLabels(values: string[]): string {
    if (values.length <= 1) {
      return values[0] ?? 'shared storage';
    }
    if (values.length === 2) {
      return `${values[0]} and ${values[1]}`;
    }
    return `${values.slice(0, -1).join(', ')}, and ${values[values.length - 1]}`;
  }

  function hasMeaningfulSourceDiscovery(result: ReconcileSourcesResponse): boolean {
    return result.summary.meaningfulItemCount > 0;
  }

  function buildSourceDiscoveryToastMessage(result: ReconcileSourcesResponse): string {
    const providers = Object.entries(result.summary.providers)
      .filter(([, counts]) => counts && (counts.sourcesAdded > 0 || counts.volumeTargetsAdded > 0 || counts.availableShares > 0))
      .map(([provider]) => formatSourceProvider(provider as SourceProvider));
    const details: string[] = [];
    if (result.summary.sourcesAdded > 0) {
      details.push(`${result.summary.sourcesAdded} location${result.summary.sourcesAdded === 1 ? '' : 's'} added`);
    }
    if (result.summary.volumeTargetsAdded > 0) {
        details.push(`sync enabled for ${result.summary.volumeTargetsAdded} known hub${result.summary.volumeTargetsAdded === 1 ? '' : 's'}`);
    }
    if (result.summary.availableShares > 0) {
      details.push(`${result.summary.availableShares} location${result.summary.availableShares === 1 ? '' : 's'} to review`);
    }
    const providerCopy = providers.length > 0 ? joinLabels(providers) : 'your synced folders';
    if (details.length === 0) {
      return `New Nearbytes storage locations detected in ${providerCopy}.`;
    }
    return `New Nearbytes storage locations detected in ${providerCopy}. ${details.join(', ')}.`;
  }

  function collectKnownVolumeIdsForDiscovery(): string[] {
    const values = new Set<string>();
    for (const mount of mounts) {
      if (mount.volumeId) {
        values.add(mount.volumeId.trim().toLowerCase());
      }
    }
    if (volumeId) {
      values.add(volumeId.trim().toLowerCase());
    }
    return Array.from(values.values()).sort((left, right) => left.localeCompare(right));
  }

  function acknowledgeSourceDiscovery(runKey: string): void {
    lastAcknowledgedSourceDiscoveryRunKey = runKey;
    if (sourceDiscoveryToast?.runKey === runKey) {
      sourceDiscoveryToast = null;
    }
  }

  function openSourcesPanelWithFocus(focus: 'discovery' | 'defaults' | null): void {
    sourceDiscoveryPanelFocus = focus;
    showSourcesPanel = true;
    showVolumeStoragePanel = false;
  }

  function openVolumeStoragePanel(): void {
    sourceDiscoveryPanelFocus = null;
    showVolumeStoragePanel = true;
    showSourcesPanel = false;
  }

  function stopSourceDiscoveryWatch(): void {
    if (sourceDiscoveryScheduleTimer) {
      clearTimeout(sourceDiscoveryScheduleTimer);
      sourceDiscoveryScheduleTimer = null;
    }
    if (sourceDiscoveryWatchDisconnect) {
      sourceDiscoveryWatchDisconnect();
      sourceDiscoveryWatchDisconnect = null;
    }
  }

  function scheduleSourceDiscovery(delayMs = 180): void {
    if (!persistedUiStateReady) {
      return;
    }
    if (sourceDiscoveryScheduleTimer) {
      clearTimeout(sourceDiscoveryScheduleTimer);
    }
    sourceDiscoveryScheduleTimer = setTimeout(() => {
      sourceDiscoveryScheduleTimer = null;
      void runSourceDiscoveryReconcile();
    }, delayMs);
  }

  async function runSourceDiscoveryReconcile(): Promise<void> {
    if (sourceDiscoveryInFlight) {
      sourceDiscoveryQueued = true;
      return;
    }
    sourceDiscoveryInFlight = true;
    try {
      const result = await reconcileDiscoveredSources(collectKnownVolumeIdsForDiscovery());
      const previousRunKey = latestSourceDiscoveryRunKey;
      latestSourceDiscovery = result;
      latestSourceDiscoveryRunKey = result.runKey;
      if (previousRunKey !== result.runKey) {
        sourceDiscoveryRefreshToken += 1;
      }
      if (hasMeaningfulSourceDiscovery(result) && result.runKey !== lastAcknowledgedSourceDiscoveryRunKey) {
        sourceDiscoveryToast = {
          runKey: result.runKey,
          message: buildSourceDiscoveryToastMessage(result),
        };
      } else if (sourceDiscoveryToast?.runKey !== result.runKey || !hasMeaningfulSourceDiscovery(result)) {
        sourceDiscoveryToast = null;
      }
    } catch (error) {
      console.warn('Failed to reconcile source discovery:', error);
    } finally {
      sourceDiscoveryInFlight = false;
      if (sourceDiscoveryQueued) {
        sourceDiscoveryQueued = false;
        void runSourceDiscoveryReconcile();
      }
    }
  }

  function openSourceDiscoveryDetails(): void {
    if (sourceDiscoveryToast) {
      acknowledgeSourceDiscovery(sourceDiscoveryToast.runKey);
    }
    openSourcesPanelWithFocus('discovery');
  }

  function openSourceDiscoveryDefaults(): void {
    if (sourceDiscoveryToast) {
      acknowledgeSourceDiscovery(sourceDiscoveryToast.runKey);
    }
    openSourcesPanelWithFocus('defaults');
  }

  function normalizeDiscoveryResult(value: unknown): ReconcileSourcesResponse | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    const candidate = value as Partial<ReconcileSourcesResponse>;
    if (typeof candidate.runKey !== 'string' || !candidate.summary || !Array.isArray(candidate.items)) {
      return null;
    }
    return candidate as ReconcileSourcesResponse;
  }

  function compactDiscoveryResult(value: ReconcileSourcesResponse | null): PersistedDiscoveryResult | null {
    if (!value) {
      return null;
    }
    return {
      runKey: value.runKey,
      changed: value.changed,
      summary: value.summary,
      items: value.items,
    };
  }

  function normalizePersistedSourceDiscovery(input: unknown): PersistedSourceDiscoveryUiState {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return {
        lastAcknowledgedRunKey: '',
        latestRunKey: '',
        latestResult: null,
      };
    }
    const candidate = input as {
      lastAcknowledgedRunKey?: unknown;
      latestRunKey?: unknown;
      latestResult?: unknown;
    };
    const latestResult = normalizeDiscoveryResult(candidate.latestResult);
    return {
      lastAcknowledgedRunKey:
        typeof candidate.lastAcknowledgedRunKey === 'string' ? candidate.lastAcknowledgedRunKey : '',
      latestRunKey:
        typeof candidate.latestRunKey === 'string'
          ? candidate.latestRunKey
          : latestResult?.runKey ?? '',
      latestResult,
    };
  }

  function loadPersistedSourceDiscovery(): PersistedSourceDiscoveryUiState {
    try {
      const shadowState = loadPersistedUiStateLocally();
      if (shadowState.sourceDiscovery !== undefined) {
        return normalizePersistedSourceDiscovery(shadowState.sourceDiscovery);
      }
      const raw = localStorage.getItem(SOURCE_DISCOVERY_UI_KEY);
      if (!raw) {
        return {
          lastAcknowledgedRunKey: '',
          latestRunKey: '',
          latestResult: null,
        };
      }
      return normalizePersistedSourceDiscovery(JSON.parse(raw));
    } catch {
      return {
        lastAcknowledgedRunKey: '',
        latestRunKey: '',
        latestResult: null,
      };
    }
  }

  function persistSourceDiscoveryLocally(state: PersistedSourceDiscoveryUiState): void {
    try {
      localStorage.setItem(SOURCE_DISCOVERY_UI_KEY, JSON.stringify(state));
    } catch {
      // ignore
    }
  }

  function normalizePersistedUiState(input: unknown): PersistedUiState {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return {};
    }
    const candidate = input as PersistedUiState;
    return {
      volumeMounts: candidate.volumeMounts,
      sourceDiscovery: candidate.sourceDiscovery,
      theme: candidate.theme,
      savedAt: typeof candidate.savedAt === 'number' && Number.isFinite(candidate.savedAt) ? candidate.savedAt : 0,
    };
  }

  function loadPersistedUiStateLocally(): PersistedUiState {
    try {
      const raw = localStorage.getItem(UI_STATE_SHADOW_KEY);
      if (!raw) {
        return {};
      }
      return normalizePersistedUiState(JSON.parse(raw));
    } catch {
      return {};
    }
  }

  function persistedUiStateTimestamp(input: PersistedUiState | null | undefined): number {
    return typeof input?.savedAt === 'number' && Number.isFinite(input.savedAt) ? input.savedAt : 0;
  }

  function choosePreferredPersistedUiState(
    desktopState: PersistedUiState | null | undefined,
    localState: PersistedUiState | null | undefined
  ): PersistedUiState {
    const normalizedDesktop = normalizePersistedUiState(desktopState);
    const normalizedLocal = normalizePersistedUiState(localState);
    if (persistedUiStateTimestamp(normalizedLocal) > persistedUiStateTimestamp(normalizedDesktop)) {
      return normalizedLocal;
    }
    return normalizedDesktop;
  }

  function persistUiStateLocally(state: PersistedUiState): void {
    const mergedState = {
      ...loadPersistedUiStateLocally(),
      ...state,
    };
    try {
      localStorage.setItem(UI_STATE_SHADOW_KEY, JSON.stringify(mergedState));
    } catch {
      // ignore
    }
    if (mergedState.volumeMounts !== undefined) {
      persistVolumeMounts(normalizeMounts(mergedState.volumeMounts));
    }
    if (mergedState.sourceDiscovery !== undefined) {
      persistSourceDiscoveryLocally(normalizePersistedSourceDiscovery(mergedState.sourceDiscovery));
    }
  }

  function clonePersistedUiStateForBridge(state: PersistedUiState): PersistedUiState {
    return JSON.parse(JSON.stringify(state)) as PersistedUiState;
  }

  function trimSecretPart(value: string): string {
    return value.trim();
  }

  function buildSecret(addr: string, password: string): string {
    const trimmedAddress = trimSecretPart(addr);
    const trimmedPassword = trimSecretPart(password);
    return trimmedPassword ? `${trimmedAddress}:${trimmedPassword}` : trimmedAddress;
  }

  function hasFileSecret(mount: VolumeMount): boolean {
    return trimSecretPart(mount.secretFilePayload) !== '';
  }

  function bytesToBase64Url(bytes: Uint8Array): string {
    let binary = '';
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
      const chunk = bytes.subarray(index, index + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
  }

  function buildFileSecretPayload(bytes: Uint8Array): string {
    return `${FILE_SECRET_PREFIX}${bytesToBase64Url(bytes)}`;
  }

  function buildMountSecret(mount: VolumeMount): string {
    if (hasFileSecret(mount)) {
      return trimSecretPart(mount.secretFilePayload);
    }
    return buildSecret(mount.address, mount.password);
  }

  function mountDisplayLabel(mount: VolumeMount): string {
    if (trimSecretPart(mount.secretFileName) !== '') {
      return trimSecretPart(mount.secretFileName);
    }
    const seedLabel = trimSecretPart(mount.address);
    if (seedLabel !== '') {
      return seedLabel;
    }
      return mount.volumeId ? 'Shared hub' : '';
  }

  function base64UrlToBase64(value: string): string {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const remainder = normalized.length % 4;
    if (remainder === 0) return normalized;
    return `${normalized}${'='.repeat(4 - remainder)}`;
  }

  function decodeNearbytesJoinDeepLink(urlString: string): string {
    const parsed = new URL(urlString);
    if (parsed.protocol !== 'nearbytes:') {
      throw new Error('Unsupported Nearbytes link protocol.');
    }
    const route = (parsed.hostname || parsed.pathname.replace(/^\/+/, '').split('/')[0] || '').trim().toLowerCase();
    if (route !== 'join') {
      throw new Error('Only nearbytes://join links are supported right now.');
    }
    const encoded = parsed.searchParams.get('data')?.trim() || parsed.hash.replace(/^#/, '').trim();
    if (!encoded) {
      throw new Error('This Nearbytes link is missing its join payload.');
    }
    return new TextDecoder().decode(base64ToBytes(base64UrlToBase64(encoded)));
  }

  function normalizeJoinLinkSerialized(value: string): string {
    const trimmed = value.trim();
    if (trimmed === '') {
      throw new Error('Paste a Nearbytes join link first.');
    }
    if (/^nearbytes:/iu.test(trimmed)) {
      return decodeNearbytesJoinDeepLink(trimmed);
    }
    return trimmed;
  }

  function secretFilePayloadDataUrl(mount: VolumeMount): string | null {
    const payload = trimSecretPart(mount.secretFilePayload);
    if (!payload.startsWith(FILE_SECRET_PREFIX)) return null;
    const encoded = payload.slice(FILE_SECRET_PREFIX.length);
    if (encoded === '') return null;
    const mimeType = trimSecretPart(mount.secretFileMimeType) || 'application/octet-stream';
    return `data:${mimeType};base64,${base64UrlToBase64(encoded)}`;
  }

  function configuredIdentitySecretDataUrl(identity: ConfiguredIdentity): string | null {
    const payload = trimSecretPart(identity.secretFilePayload);
    if (!payload.startsWith(FILE_SECRET_PREFIX)) return null;
    const encoded = payload.slice(FILE_SECRET_PREFIX.length);
    if (encoded === '') return null;
    const mimeType = trimSecretPart(identity.secretFileMimeType) || 'application/octet-stream';
    return `data:${mimeType};base64,${base64UrlToBase64(encoded)}`;
  }

  function configuredIdentityHasImageSecret(identity: ConfiguredIdentity): boolean {
    return (
      trimSecretPart(identity.secretFilePayload) !== '' &&
      trimSecretPart(identity.secretFileMimeType).startsWith('image/')
    );
  }

  function configuredIdentityAvatarLabel(identity: ConfiguredIdentity): string {
    const displayName = identity.displayName.trim();
    if (displayName !== '') {
      return displayName.charAt(0).toUpperCase();
    }
    return '?';
  }

  function readFileAsDataUrl(file: globalThis.File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          resolve(reader.result);
          return;
        }
        reject(new Error('Failed to read file'));
      };
      reader.onerror = () => {
        reject(reader.error ?? new Error('Failed to read file'));
      };
      reader.readAsDataURL(file);
    });
  }

  function secretFileBytesFromPayload(payload: string): Uint8Array | null {
    const trimmed = trimSecretPart(payload);
    if (!trimmed.startsWith(FILE_SECRET_PREFIX)) return null;
    const encoded = trimmed.slice(FILE_SECRET_PREFIX.length);
    if (encoded === '') return null;
    return base64ToBytes(base64UrlToBase64(encoded));
  }

  function secretFileBytes(mount: VolumeMount): Uint8Array | null {
    return secretFileBytesFromPayload(mount.secretFilePayload);
  }

  function secretFileHashForMount(mount: VolumeMount): SecretFileHashEntry | null {
    const payload = trimSecretPart(mount.secretFilePayload);
    const entry = secretFileHashes[mount.id];
    if (!entry || entry.payload !== payload) {
      return null;
    }
    return entry;
  }

  async function computeSecretFileHash(mountId: string, payload: string): Promise<void> {
    const bytes = secretFileBytesFromPayload(payload);
    if (!bytes) return;
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hash = Array.from(new Uint8Array(digest))
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('');

    const currentMount = mounts.find((mount) => mount.id === mountId);
    if (!currentMount || trimSecretPart(currentMount.secretFilePayload) !== payload) {
      return;
    }

    secretFileHashes = {
      ...secretFileHashes,
      [mountId]: {
        payload,
        hash,
        pending: false,
      },
    };
  }

  function downloadSecretFile(mount: VolumeMount) {
    const bytes = secretFileBytes(mount);
    if (!bytes) return;
    const blob = new Blob([bytes], {
      type: trimSecretPart(mount.secretFileMimeType) || 'application/octet-stream',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
      anchor.download = mount.secretFileName || mount.address || 'hub-secret-file';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }

  function hasImageSecretPreview(mount: VolumeMount): boolean {
    return hasFileSecret(mount) && trimSecretPart(mount.secretFileMimeType).startsWith('image/');
  }

  $effect(() => {
    for (const mount of mounts) {
      if (!hasFileSecret(mount)) continue;
      const payload = trimSecretPart(mount.secretFilePayload);
      const current = secretFileHashes[mount.id];
      if (current && current.payload === payload) continue;
      secretFileHashes = {
        ...secretFileHashes,
        [mount.id]: {
          payload,
          hash: '',
          pending: true,
        },
      };
      void computeSecretFileHash(mount.id, payload);
    }
  });

  function transferTypes(dataTransfer: DataTransfer | null | undefined): string[] {
    if (!dataTransfer) return [];
    return Array.from(dataTransfer.types ?? []);
  }

  function canHandleDropPayload(dataTransfer: DataTransfer | null | undefined): boolean {
    const types = transferTypes(dataTransfer);
    if (types.includes('Files') || types.includes('DownloadURL') || types.includes(NEARBYTES_DRAG_TYPE)) {
      return true;
    }
    return types.some((type) =>
      type === 'text/uri-list' ||
      type === 'text/html' ||
      type === 'text/plain' ||
      type === 'public.url' ||
      type === 'public.url-name' ||
      type === 'UniformResourceLocator'
    );
  }

  function canHandleSecretDropPayload(dataTransfer: DataTransfer | null | undefined): boolean {
    const types = transferTypes(dataTransfer);
    if (types.includes(NEARBYTES_DRAG_TYPE)) {
      return false;
    }
    if (types.includes('Files') || types.includes('DownloadURL')) {
      return true;
    }
    return types.some((type) =>
      type === 'text/uri-list' ||
      type === 'text/html' ||
      type === 'text/plain' ||
      type === 'public.url' ||
      type === 'public.url-name' ||
      type === 'UniformResourceLocator'
    );
  }

  function decodeUriComponentSafe(value: string): string {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  function extensionFromMimeType(mimeType: string): string {
    const normalized = trimSecretPart(mimeType).toLowerCase();
    if (normalized === 'image/jpeg') return '.jpg';
    if (normalized === 'image/png') return '.png';
    if (normalized === 'image/webp') return '.webp';
    if (normalized === 'image/gif') return '.gif';
    if (normalized === 'image/svg+xml') return '.svg';
    if (normalized === 'image/bmp') return '.bmp';
    if (normalized === 'image/heic') return '.heic';
    if (normalized === 'application/pdf') return '.pdf';
    if (normalized === 'text/plain') return '.txt';
    return '';
  }

  function sanitizeDroppedFilename(value: string, fallback = 'dropped-file'): string {
    const trimmed = trimSecretPart(value);
    const normalized = trimmed.replace(/[\\]/g, '/');
    const lastSegment = normalized.split('/').filter(Boolean).at(-1) ?? normalized;
    const clean = decodeUriComponentSafe(lastSegment.split('?')[0]?.split('#')[0] ?? '').trim();
    const safe = clean.replace(/[:*?"<>|]/g, '_');
    return safe === '' ? fallback : safe;
  }

  function filenameFromUrl(url: string, fallback = 'dropped-file'): string {
    try {
      const parsed = new URL(url);
      return sanitizeDroppedFilename(parsed.pathname, fallback);
    } catch {
      return sanitizeDroppedFilename(url, fallback);
    }
  }

  function isHttpUrl(value: string): boolean {
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }

  function looksLikeMediaUrl(value: string): boolean {
    try {
      const url = new URL(value);
      const pathname = url.pathname.toLowerCase();
      return /\.(png|jpe?g|gif|webp|bmp|svg|heic|avif|mp4|mov|webm|mp3|wav|ogg|pdf)$/i.test(pathname);
    } catch {
      return false;
    }
  }

  function extractUrlFromHtml(html: string): string | null {
    const trimmed = html.trim();
    if (trimmed === '') return null;
    try {
      const doc = new DOMParser().parseFromString(trimmed, 'text/html');
      const baseHref = doc.querySelector('base[href]')?.getAttribute('href') ?? '';
      const media = doc.querySelector('img[src], source[src], video[src], audio[src]');
      if (media instanceof HTMLElement) {
        const src = media.getAttribute('src');
        if (src) {
          try {
            const resolved = new URL(src, baseHref || undefined).href;
            if (isHttpUrl(resolved)) {
              return resolved;
            }
          } catch {
            if (isHttpUrl(src)) {
              return src;
            }
          }
        }
      }
    } catch {
      return null;
    }
    return null;
  }

  type RemoteDropDescriptor = {
    url: string;
    filename?: string;
    mimeType?: string;
  };

  function parseDownloadUrl(raw: string): RemoteDropDescriptor | null {
    const trimmed = raw.trim();
    if (trimmed === '') return null;
    const firstColon = trimmed.indexOf(':');
    const secondColon = firstColon >= 0 ? trimmed.indexOf(':', firstColon + 1) : -1;
    if (firstColon <= 0 || secondColon <= firstColon) {
      return null;
    }
    const mimeType = trimmed.slice(0, firstColon);
    const filename = trimmed.slice(firstColon + 1, secondColon);
    const url = trimmed.slice(secondColon + 1);
    if (!isHttpUrl(url)) {
      return null;
    }
    if (trimSecretPart(mimeType).toLowerCase() === 'text/html' && !looksLikeMediaUrl(url)) {
      return null;
    }
    return {
      url,
      filename: sanitizeDroppedFilename(filename),
      mimeType: trimSecretPart(mimeType),
    };
  }

  function extractRemoteDropDescriptor(dataTransfer: DataTransfer): RemoteDropDescriptor | null {
    const downloadUrl = parseDownloadUrl(dataTransfer.getData('DownloadURL'));
    if (downloadUrl) {
      return downloadUrl;
    }

    const htmlUrl = extractUrlFromHtml(dataTransfer.getData('text/html'));
    if (htmlUrl) {
      return { url: htmlUrl };
    }

    const uriList = dataTransfer
      .getData('text/uri-list')
      .split('\n')
      .map((entry) => entry.trim())
      .find(
        (entry) =>
          entry !== '' &&
          !entry.startsWith('#') &&
          isHttpUrl(entry) &&
          looksLikeMediaUrl(entry)
      );
    if (uriList) {
      return { url: uriList };
    }

    const publicUrl = trimSecretPart(dataTransfer.getData('public.url'));
    if (isHttpUrl(publicUrl) && looksLikeMediaUrl(publicUrl)) {
      return { url: publicUrl };
    }

    const uniformResourceLocator = trimSecretPart(dataTransfer.getData('UniformResourceLocator'));
    if (isHttpUrl(uniformResourceLocator) && looksLikeMediaUrl(uniformResourceLocator)) {
      return { url: uniformResourceLocator };
    }

    const plainText = trimSecretPart(dataTransfer.getData('text/plain'));
    if (isHttpUrl(plainText) && looksLikeMediaUrl(plainText)) {
      return { url: plainText };
    }

    return null;
  }

  function getDesktopBridge(): NearbytesDesktopBridge | null {
    if (typeof window === 'undefined') {
      return null;
    }
    const globalWindow = window as Window & { nearbytesDesktop?: NearbytesDesktopBridge };
    return globalWindow.nearbytesDesktop ?? null;
  }

  function shouldShowDesktopUpdaterToast(state: DesktopUpdaterState | null): boolean {
    return state !== null && state.phase !== 'idle' && state.message.trim().length > 0;
  }

  async function handleDesktopUpdaterPrimaryAction(): Promise<void> {
    const bridge = getDesktopBridge();
    if (!bridge || !desktopUpdaterState) {
      return;
    }
    if (desktopUpdaterState.canInstall && typeof bridge.installDownloadedUpdate === 'function') {
      await bridge.installDownloadedUpdate();
      return;
    }
    if (typeof bridge.openUpdateReleasePage === 'function') {
      await bridge.openUpdateReleasePage();
    }
  }

  async function openDesktopUpdaterReleasePage(): Promise<void> {
    const bridge = getDesktopBridge();
    if (!bridge || typeof bridge.openUpdateReleasePage !== 'function') {
      return;
    }
    await bridge.openUpdateReleasePage();
  }

  function base64ToBytes(value: string): Uint8Array {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  async function fileFromDesktopRemoteDrop(descriptor: RemoteDropDescriptor): Promise<File | null> {
    const bridge = getDesktopBridge();
    if (!bridge || typeof bridge.fetchRemoteFile !== 'function') {
      return null;
    }

    const fetched = await bridge.fetchRemoteFile(descriptor.url);
    const bytes = base64ToBytes(fetched.bytesBase64);
    const mimeType = trimSecretPart(fetched.mimeType) || descriptor.mimeType || 'application/octet-stream';
    let filename = trimSecretPart(fetched.filename) || trimSecretPart(descriptor.filename ?? '');
    if (filename === '') {
      filename = filenameFromUrl(descriptor.url);
    }
    if (!/\.[a-z0-9]+$/i.test(filename)) {
      filename = `${filename}${extensionFromMimeType(mimeType)}`;
    }

    return new File([bytes], sanitizeDroppedFilename(filename), {
      type: mimeType,
      lastModified: Date.now(),
    });
  }

  async function fileFromClipboardImage(): Promise<File | null> {
    const bridge = getDesktopBridge();
    if (!bridge || typeof bridge.readClipboardImage !== 'function') {
      return null;
    }

    const clipboardFile = await bridge.readClipboardImage();
    if (!clipboardFile) {
      return null;
    }

    const bytes = base64ToBytes(clipboardFile.bytesBase64);
    const mimeType = trimSecretPart(clipboardFile.mimeType) || 'image/png';
    let filename = trimSecretPart(clipboardFile.filename) || 'clipboard-image';
    if (!/\.[a-z0-9]+$/i.test(filename)) {
      filename = `${filename}${extensionFromMimeType(mimeType)}`;
    }

    return new File([bytes], sanitizeDroppedFilename(filename, 'clipboard-image'), {
      type: mimeType,
      lastModified: Date.now(),
    });
  }

  async function fileFromRemoteDrop(dataTransfer: DataTransfer): Promise<File | null> {
    const descriptor = extractRemoteDropDescriptor(dataTransfer);
    if (!descriptor) {
      return null;
    }

    const desktopFile = await fileFromDesktopRemoteDrop(descriptor);
    if (desktopFile) {
      return desktopFile;
    }

    const response = await fetch(descriptor.url);
    if (!response.ok) {
      throw new Error(`Remote download failed (${response.status})`);
    }

    const blob = await response.blob();
    const responseType = trimSecretPart(response.headers.get('content-type') ?? '');
    if (responseType.toLowerCase().startsWith('text/html')) {
      throw new Error('Dragged page URL instead of media. Drag the image itself, or use Copy Image then paste.');
    }
    const mimeType = responseType || trimSecretPart(blob.type) || descriptor.mimeType || 'application/octet-stream';
    let filename = trimSecretPart(descriptor.filename ?? '');
    if (filename === '') {
      filename = filenameFromUrl(descriptor.url);
    }
    if (!/\.[a-z0-9]+$/i.test(filename)) {
      filename = `${filename}${extensionFromMimeType(mimeType)}`;
    }

    return new File([blob], sanitizeDroppedFilename(filename), {
      type: mimeType,
      lastModified: Date.now(),
    });
  }

  function localFilesFromTransfer(dataTransfer: DataTransfer | null | undefined): File[] {
    if (!dataTransfer) return [];
    const directFiles = Array.from(dataTransfer.files ?? []);
    const itemFiles = Array.from(dataTransfer.items ?? [])
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile())
      .filter((value): value is File => value instanceof File);
    return directFiles.length > 0 ? directFiles : itemFiles;
  }

  async function filesFromTransfer(dataTransfer: DataTransfer | null | undefined): Promise<File[]> {
    if (!dataTransfer) return [];
    const localFiles = localFilesFromTransfer(dataTransfer);
    if (localFiles.length > 0) {
      return localFiles;
    }
    const remoteFile = await fileFromRemoteDrop(dataTransfer);
    return remoteFile ? [remoteFile] : [];
  }

  function dropFailureMessage(error: unknown, fallback: string): string {
    if (error instanceof Error) {
      if (error.name === 'TypeError') {
        return 'This site blocked direct access. Save it first or copy and paste a local image.';
      }
      return error.message;
    }
    return fallback;
  }

  // State: address = main input; effectiveSecret = sent to API
  let address = $state('');
  let addressPassword = $state('');
  let effectiveSecret = $state('');
  let unlockedAddress = $state('');
  let fileList = $state<FileMetadata[]>([]);
  let volumeId = $state<string | null>(null);
  let auth = $state<Auth | null>(null);
  let isDragging = $state(false);
  let errorMessage = $state('');
  let isLoading = $state(false);
  let isVolumeTransitioning = $state(false);
  let isTimelineLoading = $state(false);
  let isTimelinePlaying = $state(false);
  let isOffline = $state(false);
  let lastRefresh = $state<number | null>(null);
  let copiedVolumeId = $state(false);
  let searchQuery = $state('');
  let sortBy = $state<'newest' | 'oldest' | 'name' | 'name-desc' | 'size' | 'size-asc'>('newest');
  let selectedFileName = $state<string | null>(null);
  let selectedFileNames = $state<string[]>([]);
  let selectionAnchorFileName = $state<string | null>(null);
  let renamingFileName = $state<string | null>(null);
  let renameDraft = $state('');
  let renamePending = $state(false);
  let timelineEvents = $state<TimelineEvent[]>([]);
  let timelinePosition = $state(0);
  let previewKind = $state<PreviewKind>('none');
  let previewUrl = $state('');
  let previewText = $state('');
  let previewLoading = $state(false);
  let previewError = $state('');
  let showPreviewPane = $state(false);
  let previewFileOverride = $state<FileMetadata | null>(null);
  let timelineDetailEvent = $state<TimelineEvent | null>(null);
  let timelineDetailOpen = $state(false);
  let timelineDetailLoading = $state(false);
  let timelineDetailError = $state('');
  let timelineDetailPayload = $state<SerializedEvent | null>(null);
  let timelineDetailHash = $state('');
  let timelineDetailEncoded = $state('');
  let timelineDetailRecord = $state('');
  let timelineDetailRecordError = $state('');
  let timelineDetailMessage = $state('');
  let timelineDetailMessageError = $state('');
  let timelineDetailAppSignature = $state<'yes' | 'no' | 'unknown'>('unknown');
  let timelineDetailAppSignatureSource = $state('');
  let timelineDetailReferences = $state<EventReference[]>([]);
  let timelineDetailEventRefs = $state<string[]>([]);
  let timelineDetailStorage = $state<EventStorageLocationsResponse | null>(null);
  let timelineDetailStorageError = $state('');
  let timelineDetailRevealBusyPath = $state('');
  let timelineDetailRequestId = 0;
  let specModalOpen = $state(false);
  let specModalDoc = $state<SpecDoc | null>(null);
  let specModalContent = $state('');
  let currentPreviewObjectUrl: string | null = null;
  const previewBlobCache = new Map<string, Blob>();
  const initialMounts = loadVolumeMounts();
  let mounts = $state<VolumeMount[]>(initialMounts);
  let activeMountId = $state(initialMounts[0]?.id ?? '');
  let mountRuntimeById = $state<Record<string, MountRuntimeState>>({});
  let pendingMountId = $state<string | null>(null);
  let mountDialogMountId = $state<string | null>(null);
  let mountDialogMode = $state<MountDialogMode>('secret');
  let secretPasteTargetMountId = $state<string | null>(null);
  let secretFileHashes = $state<Record<string, SecretFileHashEntry>>({});
  let clipboardImageAvailable = $state(false);
  let clipboardImageLoading = $state(false);
  let persistedUiStateReady = $state(false);
  let themeRegistry = $state<NearbytesThemeRegistry>(defaultThemeRegistry());
  let themeSettings = $state<NearbytesThemeSettings>(defaultThemeSettings());
  let showThemeDialog = $state(false);
  let themeDialogSection = $state<ThemeDialogSection>('preset');
  let themeDialogBusy = $state(false);
  let themeDialogFeedback = $state<{ tone: 'success' | 'warning'; message: string } | null>(null);
  let themeDialogError = $state('');
  let themeDialogLogoPreview = $state<{ exportPngDataUrl: () => Promise<string | null> } | null>(null);
  let hydratedThemeState = $state<unknown>(null);
  let isHeaderHovering = $state(false);
  let isSecretDropTarget = $state(false);
  let timelinePlayTimer: ReturnType<typeof setInterval> | null = null;
  let showTimeMachinePanel = $state(false);
  let showSourcesPanel = $state(false);
  let showVolumeStoragePanel = $state(false);
  let autoSyncEnabled = $state(false);
  let autoSyncStatus = $state<'idle' | 'connecting' | 'active' | 'unsupported' | 'error'>('idle');
  let isRefreshing = $state(false);
  let pressedMountId = $state<string | null>(null);
  let configuredIdentities = $state<ConfiguredIdentity[]>([]);
  let activeChatIdentityId = $state('');
  let volumeChatIdentityAssignments = $state<Record<string, string>>({});
  let showIdentityManager = $state(false);
  let showCreateChooser = $state(false);
  let identityManagerLoading = $state(false);
  let identityManagerMessage = $state('');
  let identityManagerError = $state('');
  let identityAvatarFileInput = $state<HTMLInputElement | null>(null);
  let identityHydrated = false;
  let chatRefreshVersion = $state(0);
  let fileManagerViewMode = $state<FileManagerViewMode>('icons');
  let fileManagerSplit = $state(38);
  let fileManagerElement = $state<HTMLElement | null>(null);
  let workspacePanelsElement = $state<HTMLElement | null>(null);
  let timelineEventsElement = $state<HTMLElement | null>(null);
  let fileManagerActive = $state(false);
  let appReferenceClipboard = $state<AppReferenceClipboard | null>(null);
  let watchConnectionSerial = 0;
  let watchDisconnect: (() => void) | null = null;
  let autoRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  let mountPressReleaseTimer: ReturnType<typeof setTimeout> | null = null;
  let latestSourceDiscovery = $state<ReconcileSourcesResponse | null>(null);
  let latestSourceDiscoveryRunKey = $state('');
  let lastAcknowledgedSourceDiscoveryRunKey = $state('');
  let sourceDiscoveryToast = $state<DiscoveryToastState | null>(null);
  let desktopUpdaterState = $state<DesktopUpdaterState | null>(null);
  let joinLinkCopyBusy = $state(false);
  let joinLinkCopyFeedback = $state<JoinLinkCopyFeedbackState | null>(null);
  let volumeSharingFeedback = $state<{ tone: 'success' | 'warning'; message: string } | null>(null);
  let showJoinVolumeDialog = $state(false);
  let joinDialogSerialized = $state('');
  let joinDialogAllowCredentialBootstrap = $state(false);
  let joinDialogPreview = $state<JoinLinkParseResponse | JoinLinkOpenResponse | null>(null);
  let joinDialogOpened = $state<JoinLinkOpenResponse | null>(null);
  let joinDialogError = $state('');
  let joinDialogClipboardBusy = $state(false);
  let joinDialogPreviewBusy = $state(false);
  let joinDialogOpenBusy = $state(false);
  let showVolumeShareDialog = $state(false);
  let sourceDiscoveryRefreshToken = $state(0);
  let sourceDiscoveryPanelFocus = $state<'discovery' | 'defaults' | 'shares' | null>(null);
  let sourceDiscoveryInFlight = false;
  let sourceDiscoveryQueued = false;
  let sourceDiscoveryScheduleTimer: ReturnType<typeof setTimeout> | null = null;
  let sourceDiscoveryWatchDisconnect: (() => void) | null = null;
  let lastStoragePanelOpen = false;
  let timelineAutoFollow = true;
  let draggingMountId = $state<string | null>(null);
  let dragPreparedMountId = $state<string | null>(null);
  let dragOverMountId = $state<string | null>(null);
  let dragOriginIndex = $state<number | null>(null);
  let dragPointerId = $state<number | null>(null);
  const appThemeCssText = $derived.by(() => themeCssVariables(themeSettings));
  let dragStartX = $state(0);
  let dragStartY = $state(0);
  let dragOffsetX = $state(0);
  let dragTranslateX = $state(0);
  let dragMoved = $state(false);
  let suppressMountClickMountId = $state<string | null>(null);
  let dragRaf = 0;
  let dragClientX = 0;
  let dragCaptureElement: HTMLElement | null = null;
  let joinLinkCopyFeedbackTimer: ReturnType<typeof setTimeout> | null = null;
  let suppressMountClickTimer: ReturnType<typeof setTimeout> | null = null;
  const mountNodes = new Map<string, HTMLElement>();
  let mountDragListenersActive = false;
  const mountWarmPromises = new Map<string, Promise<void>>();
  const mountRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const MOUNT_RUNTIME_REFRESH_MS = 15000;

  async function loadThemeRegistryAsset(): Promise<void> {
    try {
      const response = await fetch(THEME_REGISTRY_ASSET_PATH, {
        cache: isDevThemeStudio ? 'no-store' : 'default',
      });
      if (!response.ok) {
        throw new Error(`Theme registry request failed (${response.status})`);
      }
      const nextRegistry = normalizeThemeRegistry(await response.json());
      themeRegistry = nextRegistry;
      themeSettings = normalizeThemeSettings(hydratedThemeState ?? themeSettings, nextRegistry);
    } catch (error) {
      console.warn('Failed to load theme registry asset:', error);
      const fallbackRegistry = defaultThemeRegistry();
      themeRegistry = fallbackRegistry;
      themeSettings = normalizeThemeSettings(hydratedThemeState ?? themeSettings, fallbackRegistry);
    }
  }

  function applyHydratedThemeState(value: unknown): void {
    hydratedThemeState = value;
    themeSettings = normalizeThemeSettings(value, themeRegistry);
  }

  function openThemeStudio(section: ThemeDialogSection = 'preset'): void {
    if (!isDevThemeStudio) {
      return;
    }
    themeDialogSection = section;
    themeDialogFeedback = null;
    themeDialogError = '';
    showThemeDialog = true;
  }

  async function persistThemeRegistry(
    nextRegistry: NearbytesThemeRegistry,
    successMessage: string
  ): Promise<void> {
    const bridge = getDesktopBridge();
    if (!bridge || typeof bridge.saveThemeRegistry !== 'function') {
      throw new Error('Desktop theme registry save is unavailable.');
    }
    const result = await bridge.saveThemeRegistry(nextRegistry);
    themeDialogFeedback = {
      tone: 'success',
      message: result?.path ? `${successMessage} ${result.path}` : successMessage,
    };
  }

  async function saveThemePresetEdits(): Promise<void> {
    if (!isDevThemeStudio) {
      return;
    }
    themeDialogBusy = true;
    themeDialogError = '';
    themeDialogFeedback = null;
    const nextRegistry = replaceThemePresetInRegistry(themeRegistry, themeSettings);
    themeRegistry = nextRegistry;
    try {
      await persistThemeRegistry(nextRegistry, 'Saved preset registry to');
    } catch (error) {
      themeDialogError = error instanceof Error ? error.message : 'Failed to save theme presets';
    } finally {
      themeDialogBusy = false;
    }
  }

  async function setThemePresetAsDefault(): Promise<void> {
    if (!isDevThemeStudio) {
      return;
    }
    themeDialogBusy = true;
    themeDialogError = '';
    themeDialogFeedback = null;
    const nextRegistry = {
      ...replaceThemePresetInRegistry(themeRegistry, themeSettings),
      defaultPresetId: themeSettings.presetId,
    };
    themeRegistry = nextRegistry;
    try {
      await persistThemeRegistry(nextRegistry, 'Saved default preset to');
    } catch (error) {
      themeDialogError = error instanceof Error ? error.message : 'Failed to save default theme preset';
    } finally {
      themeDialogBusy = false;
    }
  }

  async function exportThemeLogoPng(): Promise<void> {
    if (!isDevThemeStudio) {
      return;
    }
    const bridge = getDesktopBridge();
    if (!bridge || typeof bridge.exportLogoPng !== 'function') {
      themeDialogError = 'Desktop logo export is unavailable.';
      return;
    }
    themeDialogBusy = true;
    themeDialogError = '';
    themeDialogFeedback = null;
    try {
      const dataUrl = await themeDialogLogoPreview?.exportPngDataUrl();
      if (!dataUrl) {
        throw new Error('Logo preview is not ready yet.');
      }
      const result = await bridge.exportLogoPng(dataUrl);
      themeDialogFeedback = {
        tone: 'success',
        message:
          result?.pngPath && result?.icnsPath && result?.icoPath
            ? `Synced app icons for packaging from ${result.path ?? 'the exported master PNG'}`
            : result?.path
              ? `Exported logo PNG to ${result.path}`
              : 'Exported logo PNG.',
      };
    } catch (error) {
      themeDialogError = error instanceof Error ? error.message : 'Failed to export logo PNG';
    } finally {
      themeDialogBusy = false;
    }
  }

  function preferredActiveMountId(nextMounts: VolumeMount[]): string {
    return nextMounts.find((mount) => !mount.collapsed)?.id ?? nextMounts[0]?.id ?? '';
  }

  function providerPriority(provider: string): number {
    if (provider === 'mega') return 0;
    if (provider === 'gdrive') return 1;
    if (provider === 'github') return 2;
    return 3;
  }

  function trackMountNode(node: HTMLElement, mountId: string) {
    mountNodes.set(mountId, node);
    return {
      destroy() {
        mountNodes.delete(mountId);
      },
    };
  }

  function isMountReorderActive(mountId: string): boolean {
    return draggingMountId === mountId;
  }

  async function handleDesktopDeepLink(url: string): Promise<void> {
    try {
      errorMessage = '';
      const response = await openJoinLink({
        serialized: decodeNearbytesJoinDeepLink(url),
      });
      await handleJoinLinkOpened(response);
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Failed to open Nearbytes link';
    }
  }

  onMount(() => {
    void loadThemeRegistryAsset();
    configuredIdentities = loadConfiguredIdentities();
    activeChatIdentityId = loadActiveIdentityId();
    volumeChatIdentityAssignments = loadVolumeIdentityAssignments();
    identityHydrated = true;
    const localUiState = loadPersistedUiStateLocally();
    applyHydratedThemeState(localUiState.theme);
    const localDiscoveryState =
      localUiState.sourceDiscovery !== undefined
        ? normalizePersistedSourceDiscovery(localUiState.sourceDiscovery)
        : loadPersistedSourceDiscovery();
    latestSourceDiscovery = localDiscoveryState.latestResult;
    latestSourceDiscoveryRunKey = localDiscoveryState.latestRunKey;
    lastAcknowledgedSourceDiscoveryRunKey = localDiscoveryState.lastAcknowledgedRunKey;

    const bridge = getDesktopBridge();
    let cancelUpdaterSubscription: (() => void) | null = null;
    let cancelDeepLinkSubscription: (() => void) | null = null;
    if (bridge) {
      if (typeof bridge.getUpdaterState === 'function') {
        void bridge
          .getUpdaterState()
          .then((nextState) => {
            const normalized = normalizeDesktopUpdaterState(nextState);
            if (normalized) {
              desktopUpdaterState = normalized;
            }
          })
          .catch((error) => {
            console.warn('Failed to read desktop updater state:', error);
          });
      }
      if (typeof bridge.onUpdaterState === 'function') {
        const unsubscribe = bridge.onUpdaterState((nextState) => {
          const normalized = normalizeDesktopUpdaterState(nextState);
          if (normalized) {
            desktopUpdaterState = normalized;
          }
        });
        if (typeof unsubscribe === 'function') {
          cancelUpdaterSubscription = unsubscribe;
        }
      }
      if (typeof bridge.onDeepLink === 'function') {
        const unsubscribe = bridge.onDeepLink((url) => {
          void handleDesktopDeepLink(url);
        });
        if (typeof unsubscribe === 'function') {
          cancelDeepLinkSubscription = unsubscribe;
        }
      }
      if (typeof bridge.connectDeepLinks === 'function') {
        void bridge
          .connectDeepLinks()
          .then((urls) => {
            for (const url of urls) {
              void handleDesktopDeepLink(url);
            }
          })
          .catch((error) => {
            console.warn('Failed to connect desktop deep link stream:', error);
          });
      }
    }
    if (!bridge || typeof bridge.loadUiState !== 'function') {
      persistedUiStateReady = true;
      return () => {
        cancelUpdaterSubscription?.();
        cancelDeepLinkSubscription?.();
      };
    }

    void (async () => {
      try {
        const nextState = choosePreferredPersistedUiState(await bridge.loadUiState(), loadPersistedUiStateLocally());
        const hasPersistedMounts = Object.prototype.hasOwnProperty.call(nextState ?? {}, 'volumeMounts');
        const nextMounts = normalizeMounts(nextState.volumeMounts);
        if (hasPersistedMounts) {
          mounts = nextMounts.length > 0 ? nextMounts : [createMount()];
          activeMountId = preferredActiveMountId(mounts);
        }
        const discoveryState = normalizePersistedSourceDiscovery(nextState.sourceDiscovery);
        latestSourceDiscovery = discoveryState.latestResult;
        latestSourceDiscoveryRunKey = discoveryState.latestRunKey;
        lastAcknowledgedSourceDiscoveryRunKey = discoveryState.lastAcknowledgedRunKey;
        applyHydratedThemeState(nextState.theme);
      } catch (error) {
        console.warn('Failed to hydrate desktop UI state:', error);
      } finally {
        persistedUiStateReady = true;
      }
    })();

    return () => {
      cancelUpdaterSubscription?.();
      cancelDeepLinkSubscription?.();
    };
  });

  onMount(() => {
    return () => {
    };
  });

  onDestroy(() => {
    if (mountPressReleaseTimer) {
      clearTimeout(mountPressReleaseTimer);
      mountPressReleaseTimer = null;
    }
    if (suppressMountClickTimer) {
      clearTimeout(suppressMountClickTimer);
      suppressMountClickTimer = null;
    }
    if (joinLinkCopyFeedbackTimer) {
      clearTimeout(joinLinkCopyFeedbackTimer);
      joinLinkCopyFeedbackTimer = null;
    }
    for (const timer of mountRefreshTimers.values()) {
      clearTimeout(timer);
    }
    mountRefreshTimers.clear();
  });

  $effect(() => {
    if (!identityHydrated) {
      return;
    }
    persistConfiguredIdentities(configuredIdentities);
  });

  $effect(() => {
    if (!identityHydrated) {
      return;
    }
    persistActiveIdentityId(activeChatIdentityId);
  });

  $effect(() => {
    if (!identityHydrated) {
      return;
    }
    persistVolumeIdentityAssignments(volumeChatIdentityAssignments);
  });

  $effect(() => {
    if (configuredIdentities.length === 0) {
      if (activeChatIdentityId !== '') {
        activeChatIdentityId = '';
      }
      return;
    }
    if (configuredIdentities.some((identity) => identity.id === activeChatIdentityId)) {
      return;
    }
    activeChatIdentityId = configuredIdentities[0].id;
  });

  $effect(() => {
    const validIds = new Set(configuredIdentities.map((identity) => identity.id));
    let changed = false;
    const nextAssignments: Record<string, string> = {};
    for (const [targetVolumeId, identityId] of Object.entries(volumeChatIdentityAssignments)) {
      if (validIds.has(identityId)) {
        nextAssignments[targetVolumeId] = identityId;
      } else {
        changed = true;
      }
    }
    if (changed) {
      volumeChatIdentityAssignments = nextAssignments;
    }
  });

  $effect(() => {
    const expandedMount = mounts.find((mount) => mount.id === activeMountId && !mount.collapsed);
    if (!expandedMount) {
      clipboardImageAvailable = false;
      clipboardImageLoading = false;
      return;
    }

    const bridge = getDesktopBridge();
    if (!bridge || typeof bridge.getClipboardImageStatus !== 'function') {
      clipboardImageAvailable = false;
      return;
    }

    let cancelled = false;
    let pollingTimer: ReturnType<typeof setInterval> | null = null;

    const refresh = async () => {
      try {
        const status = await bridge.getClipboardImageStatus?.();
        if (!cancelled) {
          clipboardImageAvailable = Boolean(status?.hasImage);
        }
      } catch {
        if (!cancelled) {
          clipboardImageAvailable = false;
        }
      }
    };

    void refresh();
    const handleWindowFocus = () => {
      void refresh();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void refresh();
      }
    };

    window.addEventListener('focus', handleWindowFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    pollingTimer = setInterval(() => {
      void refresh();
    }, 1500);

    return () => {
      cancelled = true;
      if (pollingTimer) {
        clearInterval(pollingTimer);
      }
      window.removeEventListener('focus', handleWindowFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  });

  $effect(() => {
    const currentMount = mounts.find((mount) => mount.id === activeMountId);
    if (currentMount) return;
    if (mounts.length === 0) {
      if (activeMountId !== '') activeMountId = '';
      if (address !== '') address = '';
      if (addressPassword !== '') addressPassword = '';
      return;
    }
    activeMountId = mounts[0].id;
  });

  $effect(() => {
    const currentMount = mounts.find((mount) => mount.id === activeMountId);
    if (!currentMount) return;
    if (address !== currentMount.address) {
      address = currentMount.address;
    }
    if (addressPassword !== currentMount.password) {
      addressPassword = currentMount.password;
    }
  });

  $effect(() => {
    const index = mounts.findIndex((mount) => mount.id === activeMountId);
    if (index < 0) return;
    const currentMount = mounts[index];
    if (currentMount.address === address && currentMount.password === addressPassword) {
      return;
    }
    const next = [...mounts];
    next[index] = {
      ...currentMount,
      address,
      password: addressPassword,
      volumeId: undefined,
    };
    mounts = next;
  });

  $effect(() => {
    if (!persistedUiStateReady) {
      return;
    }

    const payload: PersistedUiState = {
      volumeMounts: snapshotVolumeMounts(mounts),
      savedAt: Date.now(),
    };
    const desktopPayload = clonePersistedUiStateForBridge(payload);
    persistUiStateLocally(payload);
    const bridge = getDesktopBridge();
    const persistTimer = setTimeout(() => {
      if (bridge && typeof bridge.saveUiState === 'function') {
        void bridge.saveUiState(desktopPayload).catch((error) => {
          console.warn('Failed to persist desktop volume mounts:', error);
        });
        return;
      }
      persistUiStateLocally(payload);
    }, 120);

    return () => {
      clearTimeout(persistTimer);
    };
  });

  $effect(() => {
    if (!persistedUiStateReady) {
      return;
    }

    const sourceDiscoveryState: PersistedSourceDiscoveryUiState = {
      lastAcknowledgedRunKey: lastAcknowledgedSourceDiscoveryRunKey,
      latestRunKey: latestSourceDiscoveryRunKey,
      latestResult: latestSourceDiscovery,
    };
    const payload: PersistedUiState = {
      sourceDiscovery: {
        lastAcknowledgedRunKey: sourceDiscoveryState.lastAcknowledgedRunKey,
        latestRunKey: sourceDiscoveryState.latestRunKey,
        latestResult: compactDiscoveryResult(sourceDiscoveryState.latestResult),
      },
      savedAt: Date.now(),
    };
    const desktopPayload = clonePersistedUiStateForBridge(payload);
    persistUiStateLocally(payload);
    const bridge = getDesktopBridge();
    const persistTimer = setTimeout(() => {
      if (bridge && typeof bridge.saveUiState === 'function') {
        void bridge.saveUiState(desktopPayload).catch((error) => {
          console.warn('Failed to persist desktop source discovery state:', error);
        });
        return;
      }
      persistUiStateLocally(payload);
    }, 120);

    return () => {
      clearTimeout(persistTimer);
    };
  });

  $effect(() => {
    if (!persistedUiStateReady) {
      return;
    }

    const payload: PersistedUiState = {
      theme: cloneThemeSettings(themeSettings),
      savedAt: Date.now(),
    };
    const desktopPayload = clonePersistedUiStateForBridge(payload);
    persistUiStateLocally(payload);
    const bridge = getDesktopBridge();
    const persistTimer = setTimeout(() => {
      if (bridge && typeof bridge.saveUiState === 'function') {
        void bridge.saveUiState(desktopPayload).catch((error) => {
          console.warn('Failed to persist desktop theme state:', error);
        });
        return;
      }
      persistUiStateLocally(payload);
    }, 120);

    return () => {
      clearTimeout(persistTimer);
    };
  });

  onMount(() => {
    const flushPersistedUiState = () => {
      if (!persistedUiStateReady) {
        return;
      }
      const payload: PersistedUiState = {
        volumeMounts: snapshotVolumeMounts(mounts),
        sourceDiscovery: {
          lastAcknowledgedRunKey: lastAcknowledgedSourceDiscoveryRunKey,
          latestRunKey: latestSourceDiscoveryRunKey,
          latestResult: compactDiscoveryResult(latestSourceDiscovery),
        },
        theme: cloneThemeSettings(themeSettings),
        savedAt: Date.now(),
      };
      const desktopPayload = clonePersistedUiStateForBridge(payload);
      persistUiStateLocally(payload);
      const bridge = getDesktopBridge();
      if (bridge && typeof bridge.saveUiState === 'function') {
        void bridge.saveUiState(desktopPayload).catch((error) => {
          console.warn('Failed to flush desktop UI state:', error);
        });
      }
    };

    window.addEventListener('beforeunload', flushPersistedUiState);
    window.addEventListener('pagehide', flushPersistedUiState);
    return () => {
      window.removeEventListener('beforeunload', flushPersistedUiState);
      window.removeEventListener('pagehide', flushPersistedUiState);
    };
  });

  $effect(() => {
    if (!persistedUiStateReady) {
      return;
    }

    scheduleSourceDiscovery(0);
    const handleWindowFocus = () => {
      scheduleSourceDiscovery(0);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        scheduleSourceDiscovery(0);
      }
    };
    const pollingTimer = setInterval(() => {
      scheduleSourceDiscovery(0);
    }, 5 * 60 * 1000);
    const sourceWatch = watchSources({
      onUpdate() {
        scheduleSourceDiscovery(180);
      },
      onError(error) {
        console.warn('Source watch unavailable:', error);
      },
      onClose() {
        sourceDiscoveryWatchDisconnect = null;
      },
    });
    sourceDiscoveryWatchDisconnect = () => {
      sourceWatch.close();
    };

    window.addEventListener('focus', handleWindowFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(pollingTimer);
      window.removeEventListener('focus', handleWindowFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      stopSourceDiscoveryWatch();
    };
  });

  $effect(() => {
    const storagePanelOpen = showSourcesPanel || showVolumeStoragePanel;
    if (storagePanelOpen && !lastStoragePanelOpen) {
      scheduleSourceDiscovery(0);
    }
    lastStoragePanelOpen = storagePanelOpen;
  });

  const isHistoryMode = $derived.by(() => timelinePosition < timelineEvents.length);
  const timelineDetailTimestamp = $derived.by(() => {
    if (timelineDetailEvent) return timelineDetailEvent.timestamp;
    if (!timelineDetailPayload) return null;
    const payload = timelineDetailPayload.payload;
    return (
      payload.createdAt ??
      payload.deletedAt ??
      payload.renamedAt ??
      payload.publishedAt ??
      null
    );
  });

  function timelineKindLabel(event: TimelineEvent): string {
    switch (event.type) {
      case 'CREATE_FILE':
        return 'Create';
      case 'DELETE_FILE':
        return 'Delete';
      case 'RENAME_FILE':
        return 'Rename';
      case 'DECLARE_IDENTITY':
        return 'Identity';
      case 'CHAT_MESSAGE':
        return 'Chat';
      case 'APP_RECORD':
        if (event.protocol === 'nb.identity.record.v1' || event.protocol === 'nb.identity.snapshot.v1') {
          return 'Identity';
        }
        if (event.protocol === 'nb.chat.message.v1') {
          return 'Chat';
        }
        return 'App';
    }
  }

  function timelineHeadline(event: TimelineEvent): string {
    switch (event.type) {
      case 'CREATE_FILE':
      case 'DELETE_FILE':
        return fileBaseName(event.filename);
      case 'RENAME_FILE': {
        const fromName = fileBaseName(event.filename);
        const toName = fileBaseName(event.toFilename ?? '');
        return toName ? `${fromName} -> ${toName}` : fromName;
      }
      case 'DECLARE_IDENTITY':
        return event.displayName ? `Publish ${event.displayName}` : 'Publish identity';
      case 'CHAT_MESSAGE':
        return event.summary ?? 'Chat message';
      case 'APP_RECORD':
        if (event.protocol === 'nb.identity.snapshot.v1') {
          return event.displayName ? `Sync ${event.displayName}` : 'Sync identity';
        }
        if (event.protocol === 'nb.identity.record.v1') {
          return event.displayName ? `Publish ${event.displayName}` : 'Publish identity';
        }
        if (event.protocol === 'nb.chat.message.v1') {
          return event.summary ?? 'Chat message';
        }
        return event.protocol ?? event.summary ?? 'App record';
    }
  }

  function timelineMarkerText(event: TimelineEvent, position: number, total: number): string {
    switch (event.type) {
      case 'CREATE_FILE':
        return `${position}/${total} • ${fileBaseName(event.filename)} created`;
      case 'DELETE_FILE':
        return `${position}/${total} • ${fileBaseName(event.filename)} deleted`;
      case 'RENAME_FILE':
        return `${position}/${total} • ${fileBaseName(event.filename)} renamed`;
      case 'DECLARE_IDENTITY':
        return `${position}/${total} • ${event.displayName ? `${event.displayName} published identity` : 'Identity published'}`;
      case 'CHAT_MESSAGE':
        return `${position}/${total} • ${event.summary ?? 'Chat message'}`;
      case 'APP_RECORD':
        if (event.protocol === 'nb.identity.snapshot.v1') {
          return `${position}/${total} • ${event.displayName ? `${event.displayName} synced` : 'Identity synced'}`;
        }
        if (event.protocol === 'nb.identity.record.v1') {
          return `${position}/${total} • ${event.displayName ? `${event.displayName} published identity` : 'Identity published'}`;
        }
        if (event.protocol === 'nb.chat.message.v1') {
          return `${position}/${total} • ${event.summary ?? 'Chat message'}`;
        }
        return `${position}/${total} • ${event.protocol ?? 'App record'}`;
    }
  }

  function isTimelineIdentityEvent(event: TimelineEvent): boolean {
    return (
      event.type === 'DECLARE_IDENTITY' ||
      (event.type === 'APP_RECORD' &&
        (event.protocol === 'nb.identity.record.v1' || event.protocol === 'nb.identity.snapshot.v1'))
    );
  }

  function isTimelineChatEvent(event: TimelineEvent): boolean {
    return (
      event.type === 'CHAT_MESSAGE' ||
      (event.type === 'APP_RECORD' && event.protocol === 'nb.chat.message.v1')
    );
  }

  function timelineTitle(event: TimelineEvent): string {
    return `${timelineKindLabel(event)} ${timelineHeadline(event)} • ${formatDate(event.timestamp)}`;
  }

  const timelineMarker = $derived.by(() => {
    if (timelineEvents.length === 0) return 'No history yet';
    if (timelinePosition === timelineEvents.length) return 'Live view';
    if (timelinePosition === 0) return `Genesis • 0/${timelineEvents.length}`;
    const event = timelineEvents[timelinePosition - 1];
    return timelineMarkerText(event, timelinePosition, timelineEvents.length);
  });

  function reconstructChatStateFromTimeline(limit: number): VolumeChatState {
    const identitiesByPublicKey = new Map<string, VolumeChatState['identities'][number]>();
    const messages: VolumeChatState['messages'] = [];
    const clampedLimit = Math.max(0, Math.min(limit, timelineEvents.length));

    for (let index = 0; index < clampedLimit; index += 1) {
      const event = timelineEvents[index];
      if (
        isTimelineIdentityEvent(event) &&
        event.authorPublicKey &&
        event.record
      ) {
        identitiesByPublicKey.set(event.authorPublicKey, {
          eventHash: event.eventHash,
          authorPublicKey: event.authorPublicKey,
          publishedAt: event.publishedAt ?? event.timestamp,
          record: event.record,
        });
        continue;
      }

      if (
        isTimelineChatEvent(event) &&
        event.authorPublicKey &&
        event.message
      ) {
        messages.push({
          eventHash: event.eventHash,
          authorPublicKey: event.authorPublicKey,
          publishedAt: event.publishedAt ?? event.timestamp,
          message: event.message,
        });
      }
    }

    return {
      identities: Array.from(identitiesByPublicKey.values()),
      messages,
    };
  }

  const historicalChatState = $derived.by((): VolumeChatState =>
    reconstructChatStateFromTimeline(timelinePosition)
  );

  const latestTimelineChatState = $derived.by((): VolumeChatState =>
    reconstructChatStateFromTimeline(timelineEvents.length)
  );

  const selectedChatIdentity = $derived.by(
    () => configuredIdentities.find((identity) => identity.id === activeChatIdentityId) ?? null
  );

  const currentVolumeChatIdentityId = $derived.by(() => {
    if (!volumeId) {
      return '';
    }
    return volumeChatIdentityAssignments[volumeId] ?? '';
  });

  const joinedChatIdentity = $derived.by(
    () =>
      configuredIdentities.find((identity) => identity.id === currentVolumeChatIdentityId) ?? null
  );

  const publishedIdentityByPublicKey = $derived.by(() => {
    const map = new Map<string, VolumeChatState['identities'][number]>();
    for (const identity of latestTimelineChatState.identities) {
      map.set(identity.authorPublicKey, identity);
    }
    return map;
  });

  const selectedPublishedIdentity = $derived.by(() => {
    if (!selectedChatIdentity?.publicKey) {
      return null;
    }
    return publishedIdentityByPublicKey.get(selectedChatIdentity.publicKey) ?? null;
  });

  const selectedChatIdentityNeedsPublish = $derived.by(() => {
    if (!selectedChatIdentity) {
      return false;
    }
    if (!selectedChatIdentity.publicKey || !selectedPublishedIdentity) {
      return true;
    }
    return (
      selectedPublishedIdentity.record.profile.displayName !==
        selectedChatIdentity.displayName.trim() ||
      (selectedPublishedIdentity.record.profile.bio ?? '') !== selectedChatIdentity.bio.trim()
    );
  });

  const joinedPublishedIdentity = $derived.by(() => {
    if (!joinedChatIdentity?.publicKey) {
      return null;
    }
    return publishedIdentityByPublicKey.get(joinedChatIdentity.publicKey) ?? null;
  });

  const joinedChatIdentityNeedsPublish = $derived.by(() => {
    if (!joinedChatIdentity) {
      return false;
    }
    return configuredIdentityNeedsPublish(joinedChatIdentity);
  });

  const viewFiles = $derived.by(() => {
    if (timelinePosition >= timelineEvents.length) return fileList;

    const files = new Map<string, FileMetadata>();
    const limit = Math.max(0, Math.min(timelinePosition, timelineEvents.length));
    for (let i = 0; i < limit; i += 1) {
      const event = timelineEvents[i];
      if (event.type === 'CREATE_FILE') {
        if (
          event.blobHash === undefined ||
          event.size === undefined ||
          event.createdAt === undefined
        ) {
          continue;
        }
        files.set(event.filename, {
          filename: event.filename,
          blobHash: event.blobHash,
          size: event.size,
          mimeType: event.mimeType,
          createdAt: event.createdAt,
        });
        continue;
      }
      if (event.type === 'DELETE_FILE') {
        files.delete(event.filename);
        continue;
      }
      if (event.type === 'RENAME_FILE' && event.toFilename) {
        const existing = files.get(event.filename);
        if (!existing) {
          continue;
        }
        files.delete(event.filename);
        files.set(event.toFilename, {
          ...existing,
          filename: event.toFilename,
        });
      }
    }

    const materialized = Array.from(files.values());
    materialized.sort((a, b) => {
      if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
      return a.filename.localeCompare(b.filename);
    });
    return materialized;
  });

  const visibleFiles = $derived.by(() => {
    const query = searchQuery.trim().toLowerCase();
    const filtered = query
      ? viewFiles.filter((file) => file.filename.toLowerCase().includes(query))
      : viewFiles;
    const sorted = [...filtered];
    if (sortBy === 'name') {
      sorted.sort((a, b) => a.filename.localeCompare(b.filename));
      return sorted;
    }
    if (sortBy === 'name-desc') {
      sorted.sort((a, b) => b.filename.localeCompare(a.filename));
      return sorted;
    }
    if (sortBy === 'size') {
      sorted.sort((a, b) => b.size - a.size);
      return sorted;
    }
    if (sortBy === 'size-asc') {
      sorted.sort((a, b) => a.size - b.size);
      return sorted;
    }
    if (sortBy === 'oldest') {
      sorted.sort((a, b) => a.createdAt - b.createdAt);
      return sorted;
    }
    sorted.sort((a, b) => b.createdAt - a.createdAt);
    return sorted;
  });

  const activeMount = $derived.by(() => mounts.find((mount) => mount.id === activeMountId) ?? null);
  const mountDialogMount = $derived.by(() =>
    mountDialogMountId ? mounts.find((mount) => mount.id === mountDialogMountId) ?? null : null
  );
  const showFilesWorkspace = $derived.by(() => activeMount?.showFilesPane ?? true);
  const showChatWorkspace = $derived.by(() => activeMount?.showChatPane ?? false);
  const workspaceSplit = $derived.by(() => activeMount?.workspaceSplit ?? 56);
  const showSplitWorkspace = $derived.by(() => showFilesWorkspace && showChatWorkspace);
  const workspacePanelsTemplate = $derived.by(() =>
    showSplitWorkspace
      ? `minmax(0, 1fr) ${WORKSPACE_DIVIDER_WIDTH}px minmax(${WORKSPACE_CHAT_PANE_MIN_WIDTH}px, ${100 - workspaceSplit}%)`
      : '1fr'
  );
  const fileManagerTemplate = $derived.by(
    () => (showPreviewPane ? `minmax(300px, ${fileManagerSplit}%) 14px minmax(360px, 1fr)` : '1fr')
  );

  const selectedFiles = $derived.by(() =>
    visibleFiles.filter((file) => selectedFileNames.includes(file.filename))
  );

  const selectedFile = $derived.by(
    () => visibleFiles.find((file) => file.filename === selectedFileName) ?? null
  );
  const currentPreviewFile = $derived.by(() => previewFileOverride ?? selectedFile);
  const currentMountedVolumePresentation = $derived.by<MountedVolumePresentation | null>(() => {
    const currentVolumeId = volumeId ?? activeMount?.volumeId?.trim().toLowerCase() ?? null;
    if (!activeMount || !currentVolumeId) {
      return null;
    }
    return {
      volumeId: currentVolumeId,
      label: mountLabel(activeMount),
      filePayload: activeMount.secretFilePayload,
      fileMimeType: activeMount.secretFileMimeType,
      fileName: activeMount.secretFileName,
    };
  });
  const shareableVolumeId = $derived.by(() => volumeId ?? activeMount?.volumeId?.trim().toLowerCase() ?? null);

  const knownMountedVolumes = $derived.by<Array<{ volumeId: string; label: string }>>(() => {
    const known = new Map<string, string>();
    for (const mount of mounts) {
      const normalizedVolumeId = mount.volumeId?.trim().toLowerCase();
      if (normalizedVolumeId) {
        known.set(normalizedVolumeId, mountLabel(mount));
      }
    }
    for (const runtime of Object.values(mountRuntimeById)) {
      const normalizedVolumeId = runtime.volumeId.trim().toLowerCase();
      if (!known.has(normalizedVolumeId)) {
        known.set(normalizedVolumeId, runtime.label);
      }
    }
    return Array.from(known, ([volumeId, label]) => ({ volumeId, label }));
  });

  function matchingMountRuntime(mount: VolumeMount | null): MountRuntimeState | null {
    if (!mount) return null;
    const runtime = mountRuntimeById[mount.id];
    if (!runtime) return null;
    const secret = buildMountSecret(mount);
    const label = mountLabel(mount);
    if (runtime.secret !== secret || runtime.label !== label) {
      return null;
    }
    return runtime;
  }

  function writeMountRuntime(mountId: string, runtime: MountRuntimeState): void {
    const current = mountRuntimeById[mountId];
    if (
      current &&
      current.secret === runtime.secret &&
      current.label === runtime.label &&
      current.auth === runtime.auth &&
      current.volumeId === runtime.volumeId &&
      current.files === runtime.files &&
      current.timelineEvents === runtime.timelineEvents &&
      current.timelinePosition === runtime.timelinePosition &&
      current.lastRefresh === runtime.lastRefresh &&
      current.isOffline === runtime.isOffline &&
      current.errorMessage === runtime.errorMessage
    ) {
      return;
    }
    mountRuntimeById = {
      ...mountRuntimeById,
      [mountId]: runtime,
    };
  }

  function clearMountRuntime(mountId: string): void {
    clearMountRuntimeRefresh(mountId);
    if (!(mountId in mountRuntimeById)) {
      return;
    }
    const next = { ...mountRuntimeById };
    delete next[mountId];
    mountRuntimeById = next;
  }

  function applyMountRuntime(runtime: MountRuntimeState): void {
    effectiveSecret = runtime.secret;
    unlockedAddress = runtime.label;
    auth = runtime.auth;
    volumeId = runtime.volumeId;
    fileList = runtime.files;
    timelineEvents = runtime.timelineEvents;
    timelinePosition = runtime.timelinePosition;
    lastRefresh = runtime.lastRefresh;
    isOffline = runtime.isOffline;
    errorMessage = runtime.errorMessage;
    isVolumeTransitioning = false;
    if (pendingMountId === runtime.mountId) {
      pendingMountId = null;
    }
  }

  function authEquals(left: Auth | null, right: Auth | null): boolean {
    if (!left || !right || left.type !== right.type) {
      return false;
    }
    return left.type === 'token' ? left.token === right.token : left.secret === right.secret;
  }

  function clearMountRuntimeRefresh(mountId: string): void {
    const timer = mountRefreshTimers.get(mountId);
    if (timer) {
      clearTimeout(timer);
      mountRefreshTimers.delete(mountId);
    }
  }

  function scheduleMountRuntimeRefresh(mountId: string, delayMs = MOUNT_RUNTIME_REFRESH_MS): void {
    clearMountRuntimeRefresh(mountId);
    if (!(mountId in mountRuntimeById)) {
      return;
    }
    const timer = setTimeout(() => {
      mountRefreshTimers.delete(mountId);
      void refreshMountRuntime(mountId);
    }, delayMs);
    mountRefreshTimers.set(mountId, timer);
  }

  async function refreshMountRuntime(mountId: string): Promise<void> {
    const mount = mounts.find((entry) => entry.id === mountId) ?? null;
    const runtime = mountRuntimeById[mountId];
    if (!mount || !runtime || matchingMountRuntime(mount) !== runtime) {
      clearMountRuntimeRefresh(mountId);
      return;
    }

    try {
      const [filesResponse, timelineResponse] = await Promise.all([
        listFiles(runtime.auth),
        getTimeline(runtime.auth),
      ]);
      const nextRuntime: MountRuntimeState = {
        ...runtime,
        files: filesResponse.files,
        timelineEvents: timelineResponse.events,
        timelinePosition:
          runtime.timelinePosition >= runtime.timelineEvents.length
            ? timelineResponse.events.length
            : Math.min(runtime.timelinePosition, timelineResponse.events.length),
        lastRefresh: Date.now(),
        isOffline: false,
        errorMessage: '',
      };
      writeMountRuntime(mountId, nextRuntime);
      if (activeMountId === mountId && authEquals(auth, runtime.auth)) {
        applyMountRuntime(nextRuntime);
        chatRefreshVersion += 1;
      }
      await setCachedFiles(runtime.volumeId, filesResponse.files);
    } catch (error) {
      const nextRuntime: MountRuntimeState = {
        ...runtime,
        isOffline: true,
        errorMessage: error instanceof Error ? error.message : 'Failed to refresh hub',
      };
      writeMountRuntime(mountId, nextRuntime);
      if (activeMountId === mountId && authEquals(auth, runtime.auth)) {
        applyMountRuntime(nextRuntime);
      }
    } finally {
      scheduleMountRuntimeRefresh(mountId);
    }
  }

  function clearActiveVolumeState(): void {
    stopTimelinePlayback();
    isVolumeTransitioning = false;
    effectiveSecret = '';
    unlockedAddress = '';
    fileList = [];
    volumeId = null;
    auth = null;
    lastRefresh = null;
    isOffline = false;
    isLoading = false;
    isTimelineLoading = false;
    timelineEvents = [];
    timelinePosition = 0;
    searchQuery = '';
    selectedFileName = null;
    previewKind = 'none';
    previewText = '';
    previewError = '';
    previewLoading = false;
    previewFileOverride = null;
    previewBlobCache.clear();
    revokePreviewUrl();
    pendingMountId = null;
  }

  function stopTimelinePlayback() {
    if (timelinePlayTimer) {
      clearInterval(timelinePlayTimer);
      timelinePlayTimer = null;
    }
    isTimelinePlaying = false;
  }

  function fileAccentTone(file: FileMetadata): string {
    const mime = (file.mimeType || '').toLowerCase();
    if (mime.startsWith('image/')) return 'tone-image';
    if (mime.startsWith('video/')) return 'tone-video';
    if (mime.startsWith('audio/')) return 'tone-audio';
    if (mime.includes('pdf') || mime.startsWith('text/')) return 'tone-text';
    if (mime.includes('zip') || mime.includes('tar') || mime.includes('compressed')) return 'tone-archive';
    return 'tone-default';
  }

  function fileIconComponent(file: FileMetadata) {
    const mime = (file.mimeType || '').toLowerCase();
    if (mime.startsWith('image/')) return ImageIcon;
    if (mime.startsWith('video/')) return FileVideo;
    if (mime.startsWith('audio/')) return FileAudio;
    if (mime.startsWith('text/') || mime.includes('json') || mime.includes('xml') || mime.includes('javascript') || mime.includes('typescript')) {
      return FileCode2;
    }
    if (mime.includes('zip') || mime.includes('tar') || mime.includes('compressed')) return FileArchive;
    if (mime.includes('pdf')) return FileText;
    return FileText;
  }

  function formatRelativeDay(value: number): string {
    const diffMs = Date.now() - value;
    const dayMs = 24 * 60 * 60 * 1000;
    if (diffMs < dayMs) return 'Today';
    if (diffMs < dayMs * 2) return 'Yesterday';
    const days = Math.floor(diffMs / dayMs);
    if (days < 7) return `${days}d ago`;
    return formatShortDate(value);
  }

  function isFileSelected(filename: string): boolean {
    return selectedFileNames.includes(filename);
  }

  function fileBaseName(filename: string): string {
    return filename.split('/').filter(Boolean).at(-1) ?? filename;
  }

  function fileParentPath(filename: string): string {
    return filename.split('/').filter(Boolean).slice(0, -1).join('/');
  }

  function renameDestination(file: FileMetadata, nextBaseName: string): string {
    const parent = fileParentPath(file.filename);
    return parent ? `${parent}/${nextBaseName}` : nextBaseName;
  }

  function startFileManagerResize(event: PointerEvent) {
    const container = fileManagerElement;
    if (!container) return;
    event.preventDefault();
    const rect = container.getBoundingClientRect();
    const minLeft = 300;
    const minRight = 360;

    const updateSplit = (clientX: number) => {
      const clamped = Math.min(rect.width - minRight, Math.max(minLeft, clientX - rect.left));
      fileManagerSplit = Math.max(28, Math.min(62, (clamped / rect.width) * 100));
    };

    updateSplit(event.clientX);

    const onMove = (moveEvent: PointerEvent) => updateSplit(moveEvent.clientX);
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  }

  function startWorkspaceResize(event: PointerEvent) {
    const container = workspacePanelsElement;
    if (!container || !showSplitWorkspace) return;
    event.preventDefault();
    const rect = container.getBoundingClientRect();
    const minLeft = WORKSPACE_FILE_PANE_MIN_WIDTH;
    const minRight = WORKSPACE_CHAT_PANE_MIN_WIDTH;

    const updateSplit = (clientX: number) => {
      const maxLeft = Math.max(minLeft, rect.width - minRight);
      const clamped = Math.min(maxLeft, Math.max(minLeft, clientX - rect.left));
      updateActiveMountWorkspace({
        workspaceSplit: normalizeWorkspaceSplit((clamped / rect.width) * 100),
      });
    };

    updateSplit(event.clientX);

    const onMove = (moveEvent: PointerEvent) => updateSplit(moveEvent.clientX);
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  }

  function delayReject<T>(ms: number, message: string): Promise<T> {
    return new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(message)), ms);
    });
  }

  async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
    return Promise.race([promise, delayReject<T>(ms, message)]);
  }

  function setTimelinePosition(next: number) {
    const max = timelineEvents.length;
    const clamped = Math.max(0, Math.min(next, max));
    timelinePosition = clamped;
  }

  function timelineCurrentIndex(): number {
    if (timelinePosition === 0 || timelineEvents.length === 0) {
      return -1;
    }
    return Math.min(timelinePosition - 1, timelineEvents.length - 1);
  }

  function isElementNearTimelineEnd(element: HTMLElement, threshold = 28): boolean {
    return element.scrollWidth - element.scrollLeft - element.clientWidth <= threshold;
  }

  function handleTimelineScroll() {
    if (!timelineEventsElement) {
      return;
    }
    timelineAutoFollow = isElementNearTimelineEnd(timelineEventsElement);
  }

  function jumpToLatest() {
    stopTimelinePlayback();
    setTimelinePosition(timelineEvents.length);
  }

  function jumpToEvent(index: number) {
    stopTimelinePlayback();
    setTimelinePosition(index + 1);
  }

  function toggleTimelinePlayback() {
    if (timelineEvents.length === 0) return;
    if (isTimelinePlaying) {
      stopTimelinePlayback();
      return;
    }
    if (timelinePosition >= timelineEvents.length) {
      timelinePosition = 0;
    }
    isTimelinePlaying = true;
    timelinePlayTimer = setInterval(() => {
      if (timelinePosition >= timelineEvents.length) {
        stopTimelinePlayback();
        return;
      }
      timelinePosition += 1;
      if (timelinePosition >= timelineEvents.length) {
        stopTimelinePlayback();
      }
    }, 700);
  }

  async function refreshTimeline(keepPosition = true) {
    if (!auth) {
      timelineEvents = [];
      timelinePosition = 0;
      return;
    }

    const previousLength = timelineEvents.length;
    const previousPosition = timelinePosition;
    const wasAtLatest = previousPosition >= previousLength;
    isTimelineLoading = true;

    try {
      const response = await getTimeline(auth);
      timelineEvents = response.events;
      const latest = response.events.length;
      if (!keepPosition || wasAtLatest) {
        timelinePosition = latest;
      } else {
        timelinePosition = Math.min(previousPosition, latest);
      }
    } catch (error) {
      timelineEvents = [];
      timelinePosition = 0;
      errorMessage = error instanceof Error ? error.message : 'Failed to load timeline';
    } finally {
      isTimelineLoading = false;
    }
  }

  async function ensureMountRuntimeLoaded(
    mount: VolumeMount,
    options: { activateIfCurrent?: boolean } = {}
  ): Promise<void> {
    const secret = buildMountSecret(mount);
    const label = mountLabel(mount);
    if (!secret) {
      clearMountRuntime(mount.id);
      return;
    }

    const existing = matchingMountRuntime(mount);
    if (existing) {
      if (options.activateIfCurrent && activeMountId === mount.id) {
        applyMountRuntime(existing);
      }
      return;
    }

    const pending = mountWarmPromises.get(mount.id);
    if (pending) {
      await pending;
      const warmed = matchingMountRuntime(mount);
      if (warmed && options.activateIfCurrent && activeMountId === mount.id) {
        applyMountRuntime(warmed);
      }
      return;
    }

    const run = (async () => {
      const response = await withTimeout(
        openVolume(secret),
        12000,
        'Opening this hub timed out. Check the storage locations and try again.'
      );
      const nextAuth =
        response.token
          ? ({ type: 'token', token: response.token } as const)
          : ({ type: 'secret', secret } as const);
      let nextTimelineEvents: TimelineEvent[] = [];
      let nextTimelinePosition = 0;
      let nextErrorMessage = response.storageHint ?? '';
      try {
        const timeline = await getTimeline(nextAuth);
        nextTimelineEvents = timeline.events;
        nextTimelinePosition = timeline.events.length;
      } catch (error) {
        nextErrorMessage = nextErrorMessage || (error instanceof Error ? error.message : 'Failed to load timeline');
      }

      mounts = mounts.map((entry) =>
        entry.id === mount.id ? { ...entry, volumeId: response.volumeId } : entry
      );
      writeMountRuntime(mount.id, {
        mountId: mount.id,
        secret,
        label,
        auth: nextAuth,
        volumeId: response.volumeId,
        files: response.files,
        timelineEvents: nextTimelineEvents,
        timelinePosition: nextTimelinePosition,
        lastRefresh: Date.now(),
        isOffline: false,
        errorMessage: nextErrorMessage,
      });

      const warmed = matchingMountRuntime(mounts.find((entry) => entry.id === mount.id) ?? mount);
      if (warmed && options.activateIfCurrent && activeMountId === mount.id) {
        if (nextAuth.type === 'token') {
          sessionStorage.setItem('nearbytes-token', nextAuth.token);
        } else {
          sessionStorage.removeItem('nearbytes-token');
        }
        applyMountRuntime(warmed);
      }

      void setCachedFiles(response.volumeId, response.files).catch((error) => {
        console.warn('Failed to cache volume file list:', error);
      });
      scheduleMountRuntimeRefresh(mount.id);
    })().finally(() => {
      mountWarmPromises.delete(mount.id);
    });

    mountWarmPromises.set(mount.id, run);
    await run;
  }

  $effect(() => {
    return () => {
      stopTimelinePlayback();
    };
  });

  $effect(() => {
    const element = timelineEventsElement;
    if (!element || !showTimeMachinePanel) {
      return;
    }
    const currentIndex = timelineCurrentIndex();
    void tick().then(() => {
      const currentEvent = element.querySelector<HTMLElement>('.tm-event.current');
      if (currentEvent) {
        currentEvent.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        return;
      }
      if (timelinePosition >= timelineEvents.length || timelineAutoFollow) {
        element.scrollLeft = element.scrollWidth;
      } else if (currentIndex <= 0) {
        element.scrollLeft = 0;
      }
    });
  });

  function stopVolumeWatch() {
    if (watchDisconnect) {
      watchDisconnect();
      watchDisconnect = null;
    }
    if (autoRefreshTimer) {
      clearTimeout(autoRefreshTimer);
      autoRefreshTimer = null;
    }
    autoSyncEnabled = false;
    autoSyncStatus = 'idle';
  }

  function scheduleAutoRefresh() {
    if (autoRefreshTimer) {
      return;
    }
    autoRefreshTimer = setTimeout(() => {
      autoRefreshTimer = null;
      void refreshFiles();
    }, 260);
  }

  $effect(() => {
    const nextKnownIds = new Set(mounts.map((mount) => mount.id));
    let changed = false;
    for (const [mountId, runtime] of Object.entries(mountRuntimeById)) {
      const mount = mounts.find((entry) => entry.id === mountId) ?? null;
      if (!mount || matchingMountRuntime(mount) !== runtime) {
        clearMountRuntime(mountId);
        changed = true;
      }
    }
    if (changed) {
      return;
    }
    for (const mount of mounts) {
      const secret = buildMountSecret(mount);
      if (!secret) {
        if (mount.volumeId) {
          mounts = mounts.map((entry) => (entry.id === mount.id ? { ...entry, volumeId: undefined } : entry));
          return;
        }
        continue;
      }
      if (!matchingMountRuntime(mount) && !mountWarmPromises.has(mount.id)) {
        void ensureMountRuntimeLoaded(mount, { activateIfCurrent: mount.id === activeMountId });
      }
    }
    if (Object.keys(mountRuntimeById).some((mountId) => !nextKnownIds.has(mountId))) {
      const next: Record<string, MountRuntimeState> = {};
      for (const [mountId, runtime] of Object.entries(mountRuntimeById)) {
        if (nextKnownIds.has(mountId)) {
          next[mountId] = runtime;
        }
      }
      mountRuntimeById = next;
    }
  });

  $effect(() => {
    const currentAuth = auth;
    const currentVolumeId = volumeId;
    watchConnectionSerial += 1;
    const serial = watchConnectionSerial;
    stopVolumeWatch();

    if (!currentAuth || !currentVolumeId) {
      return;
    }

    autoSyncStatus = 'connecting';
    const connection = watchVolume(currentAuth, {
      onReady: (event) => {
        if (serial !== watchConnectionSerial || event.volumeId !== currentVolumeId) {
          return;
        }
        autoSyncEnabled = event.autoUpdate;
        autoSyncStatus = event.autoUpdate ? 'active' : 'unsupported';
      },
      onUpdate: (event) => {
        if (serial !== watchConnectionSerial || event.volumeId !== currentVolumeId) {
          return;
        }
        scheduleAutoRefresh();
      },
      onError: () => {
        if (serial !== watchConnectionSerial) {
          return;
        }
        autoSyncEnabled = false;
        autoSyncStatus = 'error';
      },
      onClose: () => {
        if (serial !== watchConnectionSerial) {
          return;
        }
        if (autoSyncStatus === 'connecting' || autoSyncStatus === 'active') {
          autoSyncEnabled = false;
          autoSyncStatus = 'error';
        }
      },
    });
    watchDisconnect = () => {
      connection.close();
    };

    return () => {
      connection.close();
      if (watchDisconnect) {
        watchDisconnect = null;
      }
    };
  });

  $effect(() => {
    const currentMount = mounts.find((mount) => mount.id === activeMountId) ?? null;
    if (!currentMount || !auth || !volumeId || !effectiveSecret) {
      return;
    }
    const currentLabel = mountLabel(currentMount);
    if (buildMountSecret(currentMount) !== effectiveSecret || currentLabel !== unlockedAddress) {
      return;
    }
    writeMountRuntime(currentMount.id, {
      mountId: currentMount.id,
      secret: effectiveSecret,
      label: unlockedAddress,
      auth,
      volumeId,
      files: fileList,
      timelineEvents,
      timelinePosition,
      lastRefresh,
      isOffline,
      errorMessage,
    });
  });

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  $effect(() => {
    const currentMount = mounts.find((mount) => mount.id === activeMountId);
    const openSecret = currentMount ? buildMountSecret(currentMount) : '';
    const cachedRuntime = matchingMountRuntime(currentMount ?? null);
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (!currentMount || openSecret === '') {
      clearActiveVolumeState();
      return;
    }
    if (cachedRuntime) {
      if (cachedRuntime.auth.type === 'token') {
        sessionStorage.setItem('nearbytes-token', cachedRuntime.auth.token);
      } else {
        sessionStorage.removeItem('nearbytes-token');
      }
      applyMountRuntime(cachedRuntime);
      return;
    }
    isVolumeTransitioning = true;
    debounceTimer = setTimeout(() => {
      void ensureMountRuntimeLoaded(currentMount, { activateIfCurrent: true }).catch((error) => {
        if (activeMountId !== currentMount.id) {
          return;
        }
        errorMessage = error instanceof Error ? error.message : 'Failed to load hub';
        isVolumeTransitioning = false;
        isLoading = false;
      });
      debounceTimer = null;
    }, 500);
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  });

  function mountLabel(mount: VolumeMount): string {
    return mountDisplayLabel(mount);
  }

  function focusMountDialogInput(mountId: string) {
    void tick().then(() => {
      const input = document.querySelector<HTMLInputElement>(
        `.mount-dialog[data-mount-id="${mountId}"] .secret-seed-fields input`
      );
      input?.focus();
    });
  }

  function focusMountDialogJoinInput(mountId: string) {
    void tick().then(() => {
      const input = document.querySelector<HTMLTextAreaElement>(
        `.mount-dialog[data-mount-id="${mountId}"] .join-dialog-textarea`
      );
      input?.focus();
    });
  }

  function resetJoinDialogState(options: { preserveSerialized?: boolean } = {}): void {
    if (!options.preserveSerialized) {
      joinDialogSerialized = '';
    }
    joinDialogError = '';
    joinDialogPreview = null;
    joinDialogOpened = null;
    joinDialogClipboardBusy = false;
    joinDialogPreviewBusy = false;
    joinDialogOpenBusy = false;
  }

  function openMountDialog(mountId: string, options: { mode?: MountDialogMode } = {}) {
    if (!mounts.some((mount) => mount.id === mountId)) {
      return;
    }
    mountDialogMode = options.mode ?? 'secret';
    resetJoinDialogState();
    mountDialogMountId = mountId;
    secretPasteTargetMountId = mountId;
    if (mountDialogMode === 'join-link') {
      focusMountDialogJoinInput(mountId);
      return;
    }
    focusMountDialogInput(mountId);
  }

  function setMountDialogMode(mode: MountDialogMode): void {
    if (mountDialogMode === mode) {
      return;
    }
    mountDialogMode = mode;
    resetJoinDialogState();
    if (!mountDialogMountId) {
      return;
    }
    if (mode === 'join-link') {
      focusMountDialogJoinInput(mountDialogMountId);
      return;
    }
    focusMountDialogInput(mountDialogMountId);
  }

  function isMountEmpty(mount: VolumeMount): boolean {
    return trimSecretPart(mount.address) === '' && trimSecretPart(mount.password) === '' && !hasFileSecret(mount) && !mount.volumeId;
  }

  function addMount() {
    const nextMount = createMount({ collapsed: true });
    const collapsedExisting = mounts.map((mount) => ({ ...mount, collapsed: true }));
    mounts = [nextMount, ...collapsedExisting];
    activeMountId = nextMount.id;
    pendingMountId = null;
    openMountDialog(nextMount.id, { mode: 'secret' });
  }

  function selectMount(mountId: string) {
    const target = mounts.find((mount) => mount.id === mountId);
    if (!target) return;
    if (isMountEmpty(target)) {
      removeMount(mountId);
      return;
    }
    pendingMountId = mountId;
    secretPasteTargetMountId = null;
    activeMountId = mountId;
  }

  function selectMountPreservingLayout(mountId: string) {
    const target = mounts.find((mount) => mount.id === mountId);
    if (!target) return;
    if (isMountEmpty(target)) {
      removeMount(mountId);
      return;
    }
    pendingMountId = mountId;
    secretPasteTargetMountId = null;
    activeMountId = mountId;
  }

  function reopenMount(mountId: string) {
    pendingMountId = null;
    activeMountId = mountId;
    openMountDialog(mountId);
  }

  function collapseMount(mountId: string) {
    const target = mounts.find((mount) => mount.id === mountId);
    if (!target) return;
    if (isMountEmpty(target)) {
      removeMount(mountId);
      return;
    }
    if (pendingMountId === mountId) {
      pendingMountId = null;
    }
    if (mountDialogMountId === mountId) {
      mountDialogMountId = null;
      mountDialogMode = 'secret';
      resetJoinDialogState();
    }
    if (secretPasteTargetMountId === mountId) {
      secretPasteTargetMountId = null;
    }
    mounts = mounts.map((mount) =>
      mount.id === mountId ? { ...mount, collapsed: true } : mount
    );
  }

  function removeMount(mountId: string) {
    clearMountRuntime(mountId);
    if (pendingMountId === mountId) {
      pendingMountId = null;
    }
    if (mountDialogMountId === mountId) {
      mountDialogMountId = null;
    }
    if (secretPasteTargetMountId === mountId) {
      secretPasteTargetMountId = null;
    }
    const next = mounts.filter((mount) => mount.id !== mountId);
    mounts = next;
    if (activeMountId !== mountId) return;
    const fallback = next[0];
    if (fallback) {
      activeMountId = fallback.id;
    } else {
      activeMountId = '';
      address = '';
      addressPassword = '';
    }
  }

  function handleChipClick(mountId: string) {
    const target = mounts.find((mount) => mount.id === mountId);
    if (!target || !target.collapsed) {
      return;
    }
    selectMountPreservingLayout(mountId);
  }

  function collapseExpandedMountFromOutside(target: EventTarget | null) {
    if (!(target instanceof Element)) {
      if (mountDialogMountId) {
        collapseMount(mountDialogMountId);
      }
      return;
    }

    if (!mountDialogMountId) return;
    if (target.closest('.mount-dialog')) {
      return;
    }
    collapseMount(mountDialogMountId);
  }

  function updateMountAddress(mountId: string, value: string) {
    clearMountRuntime(mountId);
    const trimmedValue = trimSecretPart(value);
    const next = mounts.map((mount) =>
      mount.id === mountId
        ? {
            ...mount,
            address: trimmedValue,
            secretFilePayload: '',
            secretFileName: '',
            secretFileMimeType: '',
            volumeId: undefined,
          }
        : mount
    );
    mounts = next;
    if (mountId === activeMountId) {
      address = trimmedValue;
    }
  }

  function updateMountPassword(mountId: string, value: string) {
    clearMountRuntime(mountId);
    const trimmedValue = trimSecretPart(value);
    const next = mounts.map((mount) =>
      mount.id === mountId
        ? {
            ...mount,
            password: trimmedValue,
            secretFilePayload: '',
            secretFileName: '',
            secretFileMimeType: '',
            volumeId: undefined,
          }
        : mount
    );
    mounts = next;
    if (mountId === activeMountId) {
      addressPassword = trimmedValue;
    }
  }

  async function applySecretFileToMount(file: globalThis.File, mountId: string) {
    clearMountRuntime(mountId);
    const fileBytes = new Uint8Array(await file.arrayBuffer());
    const payload = buildFileSecretPayload(fileBytes);
    const label = trimSecretPart(file.name) || 'secret-file';

    mounts = mounts.map((mount) =>
      mount.id === mountId
        ? {
            ...mount,
            address: label,
            password: '',
            secretFilePayload: payload,
            secretFileName: label,
            secretFileMimeType: trimSecretPart(file.type),
            volumeId: undefined,
            collapsed: true,
          }
        : { ...mount, collapsed: true }
    );
    activeMountId = mountId;
    address = label;
    addressPassword = '';
    pendingMountId = null;
    openMountDialog(mountId);
  }

  function clearMountDragState() {
    if (mountDragListenersActive) {
      window.removeEventListener('pointermove', handleMountPointerMove);
      window.removeEventListener('pointerup', handleMountPointerUp);
      window.removeEventListener('pointercancel', handleMountPointerCancel);
      mountDragListenersActive = false;
    }
    if (dragRaf) {
      cancelAnimationFrame(dragRaf);
    }
    if (dragCaptureElement && dragPointerId !== null && dragCaptureElement.hasPointerCapture(dragPointerId)) {
      dragCaptureElement.releasePointerCapture(dragPointerId);
    }
    dragCaptureElement = null;
    dragPreparedMountId = null;
    draggingMountId = null;
    dragOverMountId = null;
    dragOriginIndex = null;
    dragPointerId = null;
    dragTranslateX = 0;
    dragMoved = false;
    dragRaf = 0;
    dragClientX = 0;
    dragStartX = 0;
    dragStartY = 0;
    dragOffsetX = 0;
  }

  function suppressMountClickFor(mountId: string) {
    if (suppressMountClickTimer) {
      clearTimeout(suppressMountClickTimer);
    }
    suppressMountClickMountId = mountId;
    suppressMountClickTimer = setTimeout(() => {
      suppressMountClickMountId = null;
      suppressMountClickTimer = null;
    }, 220);
  }

  function moveMountToIndex(draggedId: string, targetIndex: number) {
    const currentIndex = mounts.findIndex((mount) => mount.id === draggedId);
    if (currentIndex < 0) return;
    if (currentIndex === targetIndex) return;
    const without = mounts.filter((mount) => mount.id !== draggedId);
    const clampedIndex = Math.max(0, Math.min(without.length, targetIndex));
    without.splice(clampedIndex, 0, mounts[currentIndex]);
    mounts = without;
  }

  function computeDropIndex(clientX: number): { index: number; overId: string | null } {
    const orderedIds = mounts.map((mount) => mount.id).filter((id) => id !== draggingMountId);
    for (let index = 0; index < orderedIds.length; index += 1) {
      const id = orderedIds[index];
      const node = mountNodes.get(id);
      if (!node) continue;
      const rect = node.getBoundingClientRect();
      const midpoint = rect.left + rect.width / 2;
      if (clientX < midpoint) {
        return { index, overId: id };
      }
    }
    return { index: orderedIds.length, overId: null };
  }

  function applyDragUpdate(clientX: number) {
    if (!draggingMountId) return;
    const dragNode = mountNodes.get(draggingMountId);
    if (dragNode) {
      const rect = dragNode.getBoundingClientRect();
      dragTranslateX = clientX - rect.left - dragOffsetX;
    }
    const { index, overId } = computeDropIndex(clientX);
    dragOverMountId = overId;
    moveMountToIndex(draggingMountId, index);
  }

  function scheduleDragUpdate() {
    if (dragRaf) return;
    dragRaf = requestAnimationFrame(() => {
      dragRaf = 0;
      if (!draggingMountId) return;
      applyDragUpdate(dragClientX);
    });
  }

  function activateMountReorder(pointerEvent: PointerEvent, mountId: string): boolean {
    const node = mountNodes.get(mountId);
    if (!node) {
      return false;
    }
    draggingMountId = mountId;
    dragOriginIndex = mounts.findIndex((mount) => mount.id === mountId);
    dragOverMountId = null;
    dragClientX = pointerEvent.clientX;
    const rect = node.getBoundingClientRect();
    if (rect.width > PARKED_MOUNT_WIDTH + 4) {
      dragOffsetX = PARKED_MOUNT_WIDTH / 2;
    } else {
      dragOffsetX = Math.max(0, Math.min(PARKED_MOUNT_WIDTH, pointerEvent.clientX - rect.left));
    }
    dragTranslateX = pointerEvent.clientX - rect.left - dragOffsetX;
    dragMoved = true;
    pressedMountId = null;
    return true;
  }

  function beginMountReorder(event: PointerEvent, mountId: string, isCollapsed: boolean) {
    if (!isCollapsed) return;
    if (event.button !== 0) return;
    const node = mountNodes.get(mountId);
    if (!node) return;
    pressedMountId = mountId;
    dragPreparedMountId = mountId;
    dragPointerId = event.pointerId;
    dragOverMountId = null;
    dragStartX = event.clientX;
    dragStartY = event.clientY;
    dragClientX = event.clientX;
    dragMoved = false;
    suppressMountClickMountId = null;
    const captureTarget = event.currentTarget instanceof HTMLElement ? event.currentTarget : node;
    captureTarget.setPointerCapture(event.pointerId);
    dragCaptureElement = captureTarget;
    if (!mountDragListenersActive) {
      window.addEventListener('pointermove', handleMountPointerMove);
      window.addEventListener('pointerup', handleMountPointerUp);
      window.addEventListener('pointercancel', handleMountPointerCancel);
      mountDragListenersActive = true;
    }
  }

  function handleMountPointerMove(event: PointerEvent) {
    if (!dragPreparedMountId || dragPointerId !== event.pointerId) return;
    const dx = event.clientX - dragStartX;
    const dy = event.clientY - dragStartY;
    if (!draggingMountId && Math.hypot(dx, dy) < 4) {
      return;
    }
    event.preventDefault();
    if (!draggingMountId && !activateMountReorder(event, dragPreparedMountId)) {
      clearMountDragState();
      return;
    }
    dragClientX = event.clientX;
    scheduleDragUpdate();
  }

  function handleMountPointerUp(event: PointerEvent) {
    if (dragPointerId !== event.pointerId) return;
    const draggedMountId = draggingMountId;
    if (draggedMountId && dragMoved) {
      suppressMountClickFor(draggedMountId);
      dragClientX = event.clientX;
      applyDragUpdate(dragClientX);
    }
    clearMountDragState();
  }

  function shouldRenderMountHoleBefore(index: number): boolean {
    if (!dragMoved || dragOriginIndex === null || !draggingMountId) return false;
    const currentIndex = mounts.findIndex((mount) => mount.id === draggingMountId);
    return dragOriginIndex === index && currentIndex !== dragOriginIndex;
  }

  function handleMountPointerCancel(event: PointerEvent) {
    if (dragPointerId !== event.pointerId) return;
    clearMountDragState();
    if (pressedMountId) {
      pressedMountId = null;
    }
  }

  function handleMountClick(mountId: string) {
    if (suppressMountClickMountId === mountId) {
      if (suppressMountClickTimer) {
        clearTimeout(suppressMountClickTimer);
        suppressMountClickTimer = null;
      }
      suppressMountClickMountId = null;
      pressedMountId = null;
      return;
    }
    pressedMountId = mountId;
    handleChipClick(mountId);
    if (mountPressReleaseTimer) {
      clearTimeout(mountPressReleaseTimer);
    }
    mountPressReleaseTimer = setTimeout(() => {
      if (pressedMountId === mountId) {
        pressedMountId = null;
      }
      mountPressReleaseTimer = null;
    }, 180);
  }

  function mountIdFromDropTarget(target: EventTarget | null): string | null {
    if (!(target instanceof Element)) return null;
    const mountNode = target.closest<HTMLElement>('[data-mount-id]');
    return mountNode?.dataset.mountId ?? null;
  }

  function createCollapsedMount(): string {
    const nextMount = createMount({ collapsed: true });
    const collapsedExisting = mounts.map((mount) => ({ ...mount, collapsed: true }));
    mounts = [nextMount, ...collapsedExisting];
    activeMountId = nextMount.id;
    return nextMount.id;
  }

  function prepareMountForSecretDrop(target: EventTarget | null, preferNewMount = false): string {
    const explicitTargetId = mountIdFromDropTarget(target);
    if (explicitTargetId && mounts.some((mount) => mount.id === explicitTargetId)) {
      return explicitTargetId;
    }

    if (mountDialogMountId && mounts.some((mount) => mount.id === mountDialogMountId)) {
      return mountDialogMountId;
    }

    if (preferNewMount) {
      return createCollapsedMount();
    }

    return createCollapsedMount();
  }

  async function handleSecretFileDrop(event: DragEvent) {
    if (event.dataTransfer?.types.includes(NEARBYTES_DRAG_TYPE)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    isSecretDropTarget = false;
    const file = (await filesFromTransfer(event.dataTransfer))[0];
    if (!file) return;

    try {
      errorMessage = '';
      const targetMountId = prepareMountForSecretDrop(event.target, true);
      await applySecretFileToMount(file, targetMountId);
    } catch (error) {
      errorMessage = dropFailureMessage(error, 'Failed to use secret file');
      pendingMountId = null;
    }
  }

  async function handlePasteImageButton(mountId: string) {
    clipboardImageLoading = true;
    try {
      errorMessage = '';
      const file = await fileFromClipboardImage();
      if (!file) {
        clipboardImageAvailable = false;
        errorMessage = 'Clipboard does not contain an image.';
        return;
      }
      secretPasteTargetMountId = mountId;
      await applySecretFileToMount(file, mountId);
    } catch (error) {
      errorMessage = dropFailureMessage(error, 'Failed to use clipboard image as secret');
    } finally {
      clipboardImageLoading = false;
    }
  }

  function toggleVolumeStoragePanel() {
    showVolumeStoragePanel = !showVolumeStoragePanel;
    sourceDiscoveryPanelFocus = null;
    if (showVolumeStoragePanel) {
      showSourcesPanel = false;
    }
  }

  function toggleSourcesPanel() {
    showSourcesPanel = !showSourcesPanel;
    sourceDiscoveryPanelFocus = null;
    if (showSourcesPanel) {
      showVolumeStoragePanel = false;
    }
  }

  function openMountedVolumeRouting(targetVolumeId: string) {
    const normalized = targetVolumeId.trim().toLowerCase();
    const targetMount = mounts.find((mount) => mount.volumeId?.trim().toLowerCase() === normalized);
    if (!targetMount) {
      return;
    }
    selectMountPreservingLayout(targetMount.id);
    openVolumeStoragePanel();
  }

  function openVolumeShareStoragePanel(): void {
    showVolumeShareDialog = false;
    openVolumeStoragePanel();
    sourceDiscoveryPanelFocus = 'shares';
  }

  function openJoinVolumeDialog(): void {
    showVolumeShareDialog = false;
    showCreateChooser = false;
    resetJoinDialogState();
    showJoinVolumeDialog = true;
  }

  async function openJoinVolumeDialogFromClipboard(): Promise<void> {
    openJoinVolumeDialog();
    await readJoinDialogClipboard();
  }

  function closeJoinVolumeDialog(): void {
    showJoinVolumeDialog = false;
    resetJoinDialogState();
  }

  function openVolumeShareDialog(): void {
    if (!activeMount && !shareableVolumeId) {
      return;
    }
    showJoinVolumeDialog = false;
    showCreateChooser = false;
    showVolumeShareDialog = true;
  }

  function openCreateChooser(): void {
    showIdentityManager = false;
    showCreateChooser = true;
  }

  function closeCreateChooser(): void {
    showCreateChooser = false;
  }

  function startCreateHub(): void {
    closeCreateChooser();
    addMount();
  }

  function startCreateIdentity(): void {
    closeCreateChooser();
    addConfiguredChatIdentity();
  }

  function closeVolumeShareDialog(): void {
    showVolumeShareDialog = false;
  }

  function joinDialogEndpointLabel(
    candidate: NonNullable<JoinLinkParseResponse['plan']['attachments'][number]['selectedEndpoint']>
  ): string {
    const endpoint = candidate.endpoint;
    const provider = endpoint.provider?.trim().toLowerCase() || '';
    const providerLabel =
      provider === 'mega'
        ? 'MEGA'
        : provider === 'gdrive'
          ? 'Google Drive'
          : provider === 'github'
            ? 'GitHub'
            : endpoint.provider?.trim() || '';
    if (candidate.badges.includes('Connected') && providerLabel !== '') {
      return `${providerLabel} ready here`;
    }
    if (candidate.badges.includes('Suggested folder') && providerLabel !== '') {
      return `${providerLabel} suggested`;
    }
    if (providerLabel !== '') {
      return `Via ${providerLabel}`;
    }
    if (endpoint.transport === 'provider-share') {
      return 'Provider route';
    }
    return `Via ${endpoint.transport}`;
  }

  function joinDialogSpaceSummary(space: JoinLinkParseResponse['space']): string {
    if (space.mode === 'volume-id') {
      return 'Needs separate secret';
    }
    if (space.mode === 'secret-file') {
      return 'Secret file included';
    }
    return space.password ? 'Secret and password included' : 'Secret included';
  }

  function joinDialogActionTone(
    status: JoinLinkOpenResponse['actions'][number]['status']
  ): 'success' | 'warning' | 'neutral' {
    if (status === 'attached') {
      return 'success';
    }
    if (status === 'needs-account' || status === 'pending-auth' || status === 'unsupported') {
      return 'warning';
    }
    return 'neutral';
  }

  function joinDialogActionStatusLabel(
    action: JoinLinkOpenResponse['actions'][number]
  ): string {
    if (action.status === 'attached') return 'Added';
    if (action.status === 'planned') return 'Recognized';
    if (action.status === 'needs-account') return 'Sign in needed';
    if (action.status === 'pending-auth') return 'Finish sign-in';
    return 'Unavailable';
  }

  function joinDialogActionTitle(
    action: JoinLinkOpenResponse['actions'][number]
  ): string {
    const provider = action.provider === 'mega'
      ? 'MEGA'
      : action.provider === 'gdrive'
        ? 'Google Drive'
        : action.provider === 'github'
          ? 'GitHub'
          : action.provider || action.endpointTransport || 'Route';
    if (action.status === 'attached') {
      return `${provider} storage added to this hub`;
    }
    if (action.status === 'planned') {
      return `${provider} storage found`;
    }
    if (action.status === 'needs-account') {
      return `Connect ${provider}`;
    }
    if (action.status === 'pending-auth') {
      return `Finish ${provider} sign-in`;
    }
    return `${provider} storage unavailable`;
  }

  function joinDialogAttachmentTitle(
    attachment: JoinLinkParseResponse['plan']['attachments'][number]
  ): string {
    const rawLabel = attachment.attachment.label.trim();
    const normalized = rawLabel.toLowerCase();
    const provider = attachment.selectedEndpoint?.endpoint.provider?.trim().toLowerCase() || '';
    const providerLabel =
      provider === 'mega'
        ? 'MEGA'
        : provider === 'gdrive'
          ? 'Google Drive'
          : provider === 'github'
            ? 'GitHub'
            : attachment.selectedEndpoint?.endpoint.provider?.trim() || '';
    if (normalized === '' || normalized === 'nearbytes' || normalized === 'shared storage' || normalized === 'share') {
      return providerLabel !== '' ? `${providerLabel} shared storage` : 'Shared storage';
    }
    return rawLabel;
  }

  async function previewJoinDialogLink(): Promise<void> {
    joinDialogPreviewBusy = true;
    joinDialogError = '';
    joinDialogOpened = null;
    try {
      const serialized = normalizeJoinLinkSerialized(joinDialogSerialized);
      joinDialogPreview = await parseJoinLink({
        serialized,
      });
    } catch (error) {
      joinDialogPreview = null;
      joinDialogError = error instanceof Error ? error.message : 'Failed to preview this Nearbytes link';
    } finally {
      joinDialogPreviewBusy = false;
    }
  }

  async function readJoinDialogClipboard(): Promise<void> {
    if (!navigator.clipboard || typeof navigator.clipboard.readText !== 'function') {
      joinDialogError = 'Clipboard text access is unavailable in this build. Paste the link manually instead.';
      return;
    }
    joinDialogClipboardBusy = true;
    joinDialogError = '';
    try {
      const clipboardText = (await navigator.clipboard.readText()).trim();
      if (clipboardText === '') {
        throw new Error('Clipboard is empty. Copy a Nearbytes join link first.');
      }
      joinDialogSerialized = clipboardText;
      await previewJoinDialogLink();
    } catch (error) {
      joinDialogError = error instanceof Error ? error.message : 'Failed to read the clipboard';
    } finally {
      joinDialogClipboardBusy = false;
    }
  }

  async function openJoinDialogLink(): Promise<void> {
    joinDialogOpenBusy = true;
    joinDialogError = '';
    try {
      const serialized = normalizeJoinLinkSerialized(joinDialogSerialized);
      const response = await openJoinLink({
        serialized,
        allowCredentialBootstrap: joinDialogAllowCredentialBootstrap,
      });
      joinDialogPreview = response;
      joinDialogOpened = response;
      await handleJoinLinkOpened(response);
      if (mountDialogMode === 'join-link' && mountDialogMountId) {
        const currentMountId = mountDialogMountId;
        collapseMount(currentMountId);
        return;
      }
      closeJoinVolumeDialog();
    } catch (error) {
      joinDialogOpened = null;
      joinDialogError = error instanceof Error ? error.message : 'Failed to join this Nearbytes link';
    } finally {
      joinDialogOpenBusy = false;
    }
  }

  async function handleJoinLinkOpened(response: JoinLinkOpenResponse): Promise<void> {
    if (response.space.mode === 'volume-id') {
      const normalizedVolumeId = response.space.value.trim().toLowerCase();
      const existingMount = mounts.find((mount) => mount.volumeId?.trim().toLowerCase() === normalizedVolumeId) ?? null;
      const targetMountId = existingMount?.id ?? createCollapsedMount();
      mounts = mounts.map((mount) => {
        if (mount.id !== targetMountId) {
          return { ...mount, collapsed: true };
        }
        return {
          ...mount,
          volumeId: normalizedVolumeId,
          collapsed: true,
        };
      });
      activeMountId = targetMountId;
      pendingMountId = null;
      secretPasteTargetMountId = null;
      showVolumeStoragePanel = true;
      showSourcesPanel = false;
      sourceDiscoveryPanelFocus = 'shares';
      return;
    }

    const targetMountId = activeMountId || createCollapsedMount();
    mounts = mounts.map((mount) => {
      if (mount.id !== targetMountId) {
        return { ...mount, collapsed: true };
      }
      if (response.space.mode === 'secret-file') {
        return {
          ...mount,
          address: response.space.name,
          password: '',
          secretFilePayload: `${FILE_SECRET_PREFIX}${response.space.payload}`,
          secretFileName: response.space.name,
          secretFileMimeType: response.space.mime ?? '',
          volumeId: response.volumeId ?? undefined,
          collapsed: true,
        };
      }
      if (response.space.mode !== 'seed') {
        return mount;
      }
      return {
        ...mount,
        address: response.space.value,
        password: response.space.password ?? '',
        secretFilePayload: '',
        secretFileName: '',
        secretFileMimeType: '',
        volumeId: response.volumeId ?? undefined,
        collapsed: true,
      };
    });
    activeMountId = targetMountId;
    pendingMountId = targetMountId;
    secretPasteTargetMountId = null;
    showSourcesPanel = false;
    showVolumeStoragePanel = false;
    sourceDiscoveryPanelFocus = null;

    await tick();
    const targetMount = mounts.find((mount) => mount.id === targetMountId);
    if (targetMount) {
      await ensureMountRuntimeLoaded(targetMount, { activateIfCurrent: true });
    }
  }

  $effect(() => {
    if (visibleFiles.length === 0) {
      selectedFileName = null;
      selectedFileNames = [];
      selectionAnchorFileName = null;
      renamingFileName = null;
      if (!previewFileOverride) {
        showPreviewPane = false;
      }
      return;
    }
    const visibleFileNames = new Set(visibleFiles.map((file) => file.filename));
    const nextSelected = selectedFileNames.filter((filename) => visibleFileNames.has(filename));
    if (nextSelected.length !== selectedFileNames.length) {
      selectedFileNames = nextSelected;
    }
    if (selectionAnchorFileName && !visibleFileNames.has(selectionAnchorFileName)) {
      selectionAnchorFileName = nextSelected[0] ?? null;
    }
    if (!selectedFileName || !visibleFileNames.has(selectedFileName)) {
      selectedFileName = nextSelected[0] ?? null;
    }
    if (renamingFileName && !visibleFileNames.has(renamingFileName)) {
      renamingFileName = null;
      renameDraft = '';
    }
    if (nextSelected.length === 0 && renamingFileName) {
      renamingFileName = null;
      renameDraft = '';
    }
    if ((nextSelected[0] ?? null) === null && selectedFileName === null && !previewFileOverride) {
      showPreviewPane = false;
    }
  });

  function revokePreviewUrl() {
    if (currentPreviewObjectUrl) {
      URL.revokeObjectURL(currentPreviewObjectUrl);
      currentPreviewObjectUrl = null;
    }
    previewUrl = '';
  }

  function detectPreviewKind(file: FileMetadata): PreviewKind {
    const mime = file.mimeType ?? '';
    const filename = file.filename.toLowerCase();
    if (mime.startsWith('image/')) return 'image';
    if (mime.startsWith('video/')) return 'video';
    if (mime.startsWith('audio/')) return 'audio';
    if (mime.includes('pdf')) return 'pdf';
    if (
      mime.startsWith('text/') ||
      mime.includes('json') ||
      mime.includes('xml') ||
      mime.includes('javascript')
    ) {
      return 'text';
    }
    if (mime === '' || mime === 'application/octet-stream') {
      if (/\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i.test(filename)) return 'image';
      if (/\.(mp4|webm|mov|m4v|avi|mkv)$/i.test(filename)) return 'video';
      if (/\.(mp3|wav|ogg|m4a|flac|aac)$/i.test(filename)) return 'audio';
      if (/\.pdf$/i.test(filename)) return 'pdf';
      if (/\.(txt|md|json|xml|csv|log|yaml|yml|js|ts|css|html)$/i.test(filename)) return 'text';
    }
    return 'unsupported';
  }

  function asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    return value as Record<string, unknown>;
  }

  function hasSignatureField(value: unknown): boolean {
    const obj = asRecord(value);
    if (!obj) return false;
    const sig = obj.sig;
    return typeof sig === 'string' && sig.trim().length > 0;
  }

  function isHexHash(value: unknown): value is string {
    return typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value);
  }

  function isDescriptor(value: unknown): value is { t: 'b' | 'm'; h: string; z: number } {
    const obj = asRecord(value);
    if (!obj) return false;
    if (obj.t !== 'b' && obj.t !== 'm') return false;
    if (!isHexHash(obj.h)) return false;
    return typeof obj.z === 'number' && Number.isFinite(obj.z) && obj.z >= 0;
  }

  function isSourceFileReference(value: unknown): value is SourceFileReference {
    const obj = asRecord(value);
    if (!obj || obj.p !== 'nb.src.ref.v1') return false;
    return typeof obj.s === 'string' && isDescriptor(obj.c) && typeof obj.x === 'string';
  }

  function isRecipientFileReference(value: unknown): value is RecipientFileReference {
    const obj = asRecord(value);
    if (!obj || obj.p !== 'nb.ref.v1') return false;
    const capsule = asRecord(obj.k);
    return Boolean(capsule && typeof capsule.r === 'string' && isDescriptor(obj.c));
  }

  function tryParseJson(text?: string): { value?: unknown; error?: string } {
    if (!text) {
      return {};
    }
    try {
      return { value: JSON.parse(text) };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'Invalid JSON',
      };
    }
  }

  function extractReferences(value: unknown): EventReference[] {
    if (!value) return [];
    const references: EventReference[] = [];
    const seen = new Set<string>();
    const queue: unknown[] = [value];

    const pushReference = (ref: EventReference) => {
      const refValue = ref.ref;
      const refHash = refValue.c.h;
      const refScope =
        ref.kind === 'source'
          ? (refValue as SourceFileReference).s
          : (refValue as RecipientFileReference).k.r;
      const key = `${ref.kind}|${ref.name ?? ''}|${refHash}|${refScope}`;
      if (seen.has(key)) return;
      seen.add(key);
      references.push(ref);
    };

    while (queue.length > 0) {
      const current = queue.pop();
      if (Array.isArray(current)) {
        for (const item of current) {
          queue.push(item);
        }
        continue;
      }
      const obj = asRecord(current);
      if (!obj) {
        continue;
      }

      if (isSourceFileReference(obj)) {
        pushReference({ kind: 'source', ref: obj });
      } else if (isRecipientFileReference(obj)) {
        pushReference({ kind: 'recipient', ref: obj });
      }

      if (obj.p === 'nb.src.refs.v1' && Array.isArray(obj.items)) {
        for (const item of obj.items) {
          const itemObj = asRecord(item);
          if (!itemObj) continue;
          const refObj = itemObj.ref;
          if (isSourceFileReference(refObj)) {
            pushReference({
              kind: 'source',
              name: typeof itemObj.name === 'string' ? itemObj.name : undefined,
              mime: typeof itemObj.mime === 'string' ? itemObj.mime : undefined,
              createdAt: typeof itemObj.createdAt === 'number' ? itemObj.createdAt : undefined,
              ref: refObj,
            });
          }
        }
      }

      if (obj.p === 'nb.refs.v1' && Array.isArray(obj.items)) {
        for (const item of obj.items) {
          const itemObj = asRecord(item);
          if (!itemObj) continue;
          const refObj = itemObj.ref;
          if (isRecipientFileReference(refObj)) {
            pushReference({
              kind: 'recipient',
              name: typeof itemObj.name === 'string' ? itemObj.name : undefined,
              mime: typeof itemObj.mime === 'string' ? itemObj.mime : undefined,
              createdAt: typeof itemObj.createdAt === 'number' ? itemObj.createdAt : undefined,
              ref: refObj,
            });
          }
        }
      }

      if (obj.attachment) {
        const attachment = asRecord(obj.attachment);
        const attachmentRef = attachment?.ref;
        if (isSourceFileReference(attachmentRef)) {
          pushReference({
            kind: 'source',
            name: typeof attachment?.name === 'string' ? attachment.name : undefined,
            mime: typeof attachment?.mime === 'string' ? attachment.mime : undefined,
            createdAt: typeof attachment?.createdAt === 'number' ? attachment.createdAt : undefined,
            ref: attachmentRef,
          });
        }
      }

      for (const value of Object.values(obj)) {
        queue.push(value);
      }
    }

    return references;
  }

  function extractEventHashes(value: unknown): string[] {
    if (!value) return [];
    const hashes = new Set<string>();
    const queue: unknown[] = [value];
    while (queue.length > 0) {
      const current = queue.pop();
      if (Array.isArray(current)) {
        for (const item of current) {
          queue.push(item);
        }
        continue;
      }
      const obj = asRecord(current);
      if (!obj) {
        continue;
      }
      if (isHexHash(obj.eventHash)) {
        hashes.add(obj.eventHash);
      }
      for (const value of Object.values(obj)) {
        queue.push(value);
      }
    }
    return Array.from(hashes);
  }

  function specDocsForPayload(payload: SerializedEvent['payload']): SpecDoc[] {
    const docs: SpecDoc[] = [];
    for (const doc of SPEC_DOCS) {
      if (doc.always) {
        docs.push(doc);
        continue;
      }
      if (doc.eventTypes?.includes(payload.type)) {
        docs.push(doc);
        continue;
      }
      if (payload.protocol && doc.protocols?.includes(payload.protocol)) {
        docs.push(doc);
      }
    }
    return docs;
  }

  function openSpecDoc(doc: SpecDoc): void {
    specModalDoc = doc;
    specModalContent = SPEC_CONTENT_BY_FILE.get(doc.filename) ?? 'Spec not bundled.';
    specModalOpen = true;
  }

  function closeSpecDoc(): void {
    specModalOpen = false;
    specModalDoc = null;
    specModalContent = '';
  }

  function previewSourceReference(reference: EventReference) {
    if (reference.kind !== 'source') return;
    const attachment: ChatAttachment = {
      kind: 'nb.src.ref.v1',
      name: reference.name ?? 'Reference',
      mime: reference.mime,
      createdAt: reference.createdAt,
      ref: reference.ref as SourceFileReference,
    };
    previewChatAttachment(attachment);
  }

  function closeTimelineDetails() {
    timelineDetailOpen = false;
    timelineDetailEvent = null;
    timelineDetailPayload = null;
    timelineDetailHash = '';
    timelineDetailEncoded = '';
    timelineDetailRecord = '';
    timelineDetailRecordError = '';
    timelineDetailMessage = '';
    timelineDetailMessageError = '';
    timelineDetailAppSignature = 'unknown';
    timelineDetailAppSignatureSource = '';
    timelineDetailReferences = [];
    timelineDetailEventRefs = [];
    timelineDetailStorage = null;
    timelineDetailStorageError = '';
    timelineDetailRevealBusyPath = '';
    timelineDetailError = '';
    timelineDetailLoading = false;
    timelineDetailRequestId += 1;
    closeSpecDoc();
  }

  async function openTimelineDetailsByHash(eventHash: string, seedEvent?: TimelineEvent) {
    if (!auth) {
      errorMessage = 'Open a hub to view event details.';
      return;
    }
    timelineDetailOpen = true;
    timelineDetailLoading = true;
    timelineDetailError = '';
    timelineDetailPayload = null;
    timelineDetailHash = eventHash;
    timelineDetailEncoded = '';
    timelineDetailRecord = '';
    timelineDetailRecordError = '';
    timelineDetailMessage = '';
    timelineDetailMessageError = '';
    timelineDetailAppSignature = 'unknown';
    timelineDetailAppSignatureSource = '';
    timelineDetailReferences = [];
    timelineDetailEventRefs = [];
    timelineDetailStorage = null;
    timelineDetailStorageError = '';
    timelineDetailRevealBusyPath = '';
    timelineDetailEvent = seedEvent ?? timelineEvents.find((entry) => entry.eventHash === eventHash) ?? null;

    const requestId = (timelineDetailRequestId += 1);
    try {
      const [detailResult, storageResult] = await Promise.allSettled([
        getEventDetail(auth, eventHash),
        getEventStorageLocations(auth, eventHash),
      ]);

      if (detailResult.status !== 'fulfilled') {
        throw detailResult.reason;
      }
      const detail = detailResult.value;
      if (requestId !== timelineDetailRequestId) return;
      timelineDetailPayload = detail.event;
      timelineDetailHash = detail.eventHash;
      timelineDetailEncoded = JSON.stringify(detail.event, null, 2);

      if (storageResult.status === 'fulfilled') {
        timelineDetailStorage = storageResult.value;
      } else {
        const message =
          storageResult.reason instanceof Error
            ? storageResult.reason.message
            : String(storageResult.reason);
        if (/route not found/i.test(message)) {
          timelineDetailStorageError =
            'Storage location debug info unavailable: this desktop backend is running an older API build. Restart Nearbytes desktop to load the storage debug route.';
        } else {
          timelineDetailStorageError = `Storage location debug info unavailable: ${message}`;
        }
      }

      const recordParse = tryParseJson(detail.event.payload.record);
      if (recordParse.value !== undefined) {
        timelineDetailRecord = JSON.stringify(recordParse.value, null, 2);
      } else if (detail.event.payload.record) {
        timelineDetailRecord = detail.event.payload.record;
      }
      if (recordParse.error) {
        timelineDetailRecordError = recordParse.error;
      }

      const messageParse = tryParseJson(detail.event.payload.message);
      if (messageParse.value !== undefined) {
        timelineDetailMessage = JSON.stringify(messageParse.value, null, 2);
      } else if (detail.event.payload.message) {
        timelineDetailMessage = detail.event.payload.message;
      }
      if (messageParse.error) {
        timelineDetailMessageError = messageParse.error;
      }

      const recordSig = hasSignatureField(recordParse.value);
      const messageSig = hasSignatureField(messageParse.value);
      if (recordSig || messageSig) {
        timelineDetailAppSignature = 'yes';
        timelineDetailAppSignatureSource = recordSig ? 'record.sig' : 'message.sig';
      } else if (recordParse.value !== undefined || messageParse.value !== undefined) {
        timelineDetailAppSignature = 'no';
        timelineDetailAppSignatureSource = '';
      } else {
        timelineDetailAppSignature = 'unknown';
        timelineDetailAppSignatureSource = '';
      }

      const references = [
        ...extractReferences(recordParse.value),
        ...extractReferences(messageParse.value),
      ];
      timelineDetailReferences = references;

      const eventRefs = new Set<string>();
      for (const hash of extractEventHashes(recordParse.value)) {
        if (hash !== eventHash) eventRefs.add(hash);
      }
      for (const hash of extractEventHashes(messageParse.value)) {
        if (hash !== eventHash) eventRefs.add(hash);
      }
      timelineDetailEventRefs = Array.from(eventRefs);
    } catch (error) {
      if (requestId !== timelineDetailRequestId) return;
      timelineDetailError = error instanceof Error ? error.message : 'Unable to load event';
    } finally {
      if (requestId === timelineDetailRequestId) {
        timelineDetailLoading = false;
      }
    }
  }

  async function openTimelineDetails(event: TimelineEvent) {
    await openTimelineDetailsByHash(event.eventHash, event);
  }

  function timelineExpectedEventPath(): string {
    if (timelineDetailStorage?.expectedEventRelativePath) {
      return timelineDetailStorage.expectedEventRelativePath;
    }
    const resolvedVolumeId =
      timelineDetailStorage?.volumeId?.trim() || volumeId?.trim() || activeMount?.volumeId?.trim() || '';
    const eventHash = timelineDetailHash.trim();
    if (resolvedVolumeId) {
      return `channels/${resolvedVolumeId}/${eventHash || '<event-hash>'}.bin`;
    }
    if (!eventHash) {
      return 'channels/<volume-id>/<event-hash>.bin';
    }
    return `channels/<volume-id>/${eventHash}.bin`;
  }

  function timelineExpectedBlockPath(): string | null {
    const fromStorage = timelineDetailStorage?.expectedDataRelativePath;
    if (typeof fromStorage === 'string' && fromStorage.trim() !== '') {
      return fromStorage;
    }
    const hash = timelineDetailPayload?.payload.hash?.trim() ?? '';
    if (!/^[a-f0-9]{64}$/i.test(hash) || /^0+$/i.test(hash)) {
      return null;
    }
    return `blocks/${hash}.bin`;
  }

  function timelineStorageHits(): TimelineStorageLocationView[] {
    if (!timelineDetailStorage) {
      return [];
    }
    return timelineDetailStorage.locations.filter((location) => location.hasEventFile || location.hasDataBlock);
  }

  function timelineStorageLocationLabel(location: TimelineStorageLocationView): string {
    const provider = String(location.provider).toUpperCase();
    const normalizedPath = location.rootPath.replace(/\\/g, '/').replace(/\/+$/u, '');
    const segments = normalizedPath.split('/').filter(Boolean);
    const shareName = segments.length > 0 ? segments[segments.length - 1] : '';

    if (shareName) {
      return `${provider} • ${shareName}`;
    }
    return `${provider} • default storage`;
  }

  function timelineStorageLocationPath(location: TimelineStorageLocationView): string {
    if (location.hasDataBlock && location.dataPath) {
      return location.dataPath;
    }
    return location.eventPath;
  }

  function timelineStoragePresenceBadges(location: TimelineStorageLocationView): string {
    const parts: string[] = [];
    parts.push(location.hasEventFile ? 'event file' : 'event missing');
    if (location.dataPath) {
      parts.push(location.hasDataBlock ? 'block present' : 'block missing');
    }
    return parts.join(' • ');
  }

  async function revealTimelineStorageLocation(location: TimelineStorageLocationView): Promise<void> {
    const targetPath = timelineStorageLocationPath(location);
    if (!targetPath) {
      return;
    }
    timelineDetailStorageError = '';
    timelineDetailRevealBusyPath = targetPath;
    try {
      await openPathInFileManager(targetPath);
    } catch (error) {
      timelineDetailStorageError = error instanceof Error ? error.message : 'Failed to reveal storage location';
    } finally {
      timelineDetailRevealBusyPath = '';
    }
  }

  function findPreviewFileForPayload(payload: SerializedEvent['payload']): FileMetadata | null {
    const byHash = visibleFiles.find((file) => file.blobHash === payload.hash) ?? null;
    if (byHash) return byHash;
    if (!payload.fileName) return null;
    return visibleFiles.find((file) => file.filename === payload.fileName) ?? null;
  }

  function openEventPayloadPreview(payload: SerializedEvent['payload']): void {
    if (!auth || payload.type !== 'CREATE_FILE' || !payload.hash) {
      return;
    }

    const existingFile = findPreviewFileForPayload(payload);
    if (existingFile) {
      openPreviewPane(existingFile);
      return;
    }

    if (activeMount && !activeMount.showFilesPane) {
      updateActiveMountWorkspace({
        showFilesPane: true,
        showChatPane: activeMount.showChatPane,
      });
    }

    previewFileOverride = {
      filename: payload.fileName || `${payload.hash}.bin`,
      blobHash: payload.hash,
      size: payload.size ?? 0,
      mimeType: payload.mimeType ?? '',
      createdAt: payload.createdAt ?? payload.publishedAt ?? Date.now(),
    };
    showPreviewPane = true;
  }

  $effect(() => {
    let cancelled = false;
    const file = currentPreviewFile;

    previewError = '';
    previewText = '';
    previewLoading = false;
    revokePreviewUrl();

    if (!showPreviewPane || !file || !auth) {
      previewKind = 'none';
      return;
    }

    const kind = detectPreviewKind(file);
    previewKind = kind;
    if (kind === 'unsupported') {
      return;
    }

    previewLoading = true;
    (async () => {
      try {
        let blob = previewBlobCache.get(file.blobHash);
        if (!blob) {
          blob = await downloadFile(auth, file.blobHash);
          previewBlobCache.set(file.blobHash, blob);
        }
        if (cancelled) return;
        if (kind === 'text') {
          const raw = await blob.text();
          if (cancelled) return;
          const textLimit = 24000;
          previewText = raw.length > textLimit ? `${raw.slice(0, textLimit)}\n\n...truncated` : raw;
        } else {
          const objectUrl = URL.createObjectURL(blob);
          currentPreviewObjectUrl = objectUrl;
          previewUrl = objectUrl;
        }
      } catch (error) {
        if (!cancelled) {
          previewError = error instanceof Error ? error.message : 'Unable to load preview';
        }
      } finally {
        if (!cancelled) {
          previewLoading = false;
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  });

  function setSelection(nextSelection: string[], activeFileName: string | null, anchorFileName: string | null) {
    selectedFileNames = nextSelection;
    selectedFileName = activeFileName;
    selectionAnchorFileName = anchorFileName;
  }

  function clearSelection() {
    setSelection([], null, null);
    renamingFileName = null;
    renameDraft = '';
  }

  function selectFile(
    file: FileMetadata,
    options: {
      toggle?: boolean;
      range?: boolean;
      additiveRange?: boolean;
    } = {}
  ) {
    const targetFileName = file.filename;
    const visibleFileNames = new Set(visibleFiles.map((item) => item.filename));
    const targetIndex = visibleFiles.findIndex((item) => item.filename === targetFileName);
    const anchorFileName =
      selectionAnchorFileName && visibleFileNames.has(selectionAnchorFileName)
        ? selectionAnchorFileName
        : selectedFileName && visibleFileNames.has(selectedFileName)
          ? selectedFileName
          : targetFileName;

    if (options.range && targetIndex >= 0) {
      const anchorIndex = visibleFiles.findIndex((item) => item.filename === anchorFileName);
      const start = Math.min(anchorIndex >= 0 ? anchorIndex : targetIndex, targetIndex);
      const end = Math.max(anchorIndex >= 0 ? anchorIndex : targetIndex, targetIndex);
      const rangeSelection = visibleFiles.slice(start, end + 1).map((item) => item.filename);
      const nextSelection = options.additiveRange
        ? Array.from(new Set([...selectedFileNames, ...rangeSelection]))
        : rangeSelection;
      setSelection(nextSelection, targetFileName, anchorFileName);
      renamingFileName = null;
      renameDraft = '';
      return;
    }

    if (options.toggle) {
      const nextSelection = isFileSelected(targetFileName)
        ? selectedFileNames.filter((filename) => filename !== targetFileName)
        : [...selectedFileNames, targetFileName];
      setSelection(
        nextSelection,
        nextSelection.includes(targetFileName) ? targetFileName : (nextSelection.at(-1) ?? null),
        targetFileName
      );
      renamingFileName = null;
      renameDraft = '';
      return;
    }

    setSelection([targetFileName], targetFileName, targetFileName);
    renamingFileName = null;
    renameDraft = '';
  }

  function openPreviewPane(file?: FileMetadata) {
    previewFileOverride = null;
    if (file) {
      if (!isFileSelected(file.filename)) {
        setSelection([file.filename], file.filename, file.filename);
      } else {
        selectedFileName = file.filename;
      }
    }
    if (selectedFileName) {
      showPreviewPane = true;
    }
  }

  function closePreviewPane() {
    previewFileOverride = null;
    showPreviewPane = false;
  }

  function previewChatAttachment(attachment: ChatAttachment) {
    const existingFile =
      visibleFiles.find((file) => file.filename === attachment.name && file.blobHash === attachment.ref.c.h) ??
      visibleFiles.find((file) => file.blobHash === attachment.ref.c.h) ??
      null;
    if (existingFile) {
      openPreviewPane(existingFile);
      return;
    }

    if (activeMount && !activeMount.showFilesPane) {
      updateActiveMountWorkspace({
        showFilesPane: true,
        showChatPane: activeMount.showChatPane,
      });
    }

    previewFileOverride = {
      filename: attachment.name,
      blobHash: attachment.ref.c.h,
      size: attachment.ref.c.z,
      mimeType: attachment.mime ?? '',
      createdAt: attachment.createdAt ?? Date.now(),
    };
    showPreviewPane = true;
  }

  function updateActiveMountWorkspace(
    patch: Partial<Pick<VolumeMount, 'showFilesPane' | 'showChatPane' | 'workspaceSplit'>>
  ) {
    if (!activeMountId) {
      return;
    }
    mounts = mounts.map((mount) =>
      mount.id === activeMountId
        ? createMount({
            ...mount,
            ...patch,
          })
        : mount
    );
  }

  function toggleWorkspacePane(pane: 'files' | 'chat') {
    const currentMount = mounts.find((mount) => mount.id === activeMountId);
    if (!currentMount) {
      return;
    }
    const nextShowFiles = pane === 'files' ? !currentMount.showFilesPane : currentMount.showFilesPane;
    const nextShowChat = pane === 'chat' ? !currentMount.showChatPane : currentMount.showChatPane;
    if (!nextShowFiles && !nextShowChat) {
      return;
    }

    updateActiveMountWorkspace({
      showFilesPane: nextShowFiles,
      showChatPane: nextShowChat,
    });

    if (!nextShowFiles) {
      showPreviewPane = false;
      renamingFileName = null;
      renameDraft = '';
      fileManagerActive = false;
    }
    if (!nextShowChat) {
    }
  }

  function addConfiguredChatIdentity() {
    const next = createConfiguredIdentity();
    configuredIdentities = [...configuredIdentities, next];
    activeChatIdentityId = next.id;
    showIdentityManager = true;
    identityManagerError = '';
    identityManagerMessage = '';
  }

  function updateConfiguredChatIdentity(identityId: string, patch: Partial<ConfiguredIdentity>) {
    let secretChanged = false;
    configuredIdentities = configuredIdentities.map((identity) => {
      if (identity.id !== identityId) {
        return identity;
      }

      const previousSecret = buildIdentitySecret(identity);
      const nextIdentity = createConfiguredIdentity({
        ...identity,
        ...patch,
        publicKey: patch.publicKey ?? identity.publicKey,
      });

      secretChanged = buildIdentitySecret(nextIdentity) !== previousSecret;

      return secretChanged
        ? createConfiguredIdentity({
            ...nextIdentity,
            publicKey: undefined,
          })
        : nextIdentity;
    });

    if (secretChanged) {
      const nextAssignments = Object.fromEntries(
        Object.entries(volumeChatIdentityAssignments).filter(
          ([, assignedIdentityId]) => assignedIdentityId !== identityId
        )
      );
      if (Object.keys(nextAssignments).length !== Object.keys(volumeChatIdentityAssignments).length) {
        volumeChatIdentityAssignments = nextAssignments;
        identityManagerError = '';
        identityManagerMessage = 'Identity secret changed. Rejoin any hub chats explicitly.';
      }
    }
  }

  function updateConfiguredChatIdentitySecretText(
    identityId: string,
    field: 'address' | 'password',
    value: string
  ) {
    updateConfiguredChatIdentity(identityId, {
      [field]: value,
      secretFilePayload: '',
      secretFileName: '',
      secretFileMimeType: '',
    });
  }

  function clearConfiguredChatIdentitySecretFile(identityId: string) {
    updateConfiguredChatIdentity(identityId, {
      secretFilePayload: '',
      secretFileName: '',
      secretFileMimeType: '',
    });
  }

  async function applySecretFileToIdentity(file: globalThis.File, identityId: string) {
    const fileBytes = new Uint8Array(await file.arrayBuffer());
    const payload = buildFileSecretPayload(fileBytes);
    const label = trimSecretPart(file.name) || 'identity-secret-file';

    updateConfiguredChatIdentity(identityId, {
      address: label,
      password: '',
      secretFilePayload: payload,
      secretFileName: label,
      secretFileMimeType: trimSecretPart(file.type),
    });
    identityManagerError = '';
    identityManagerMessage = 'Identity secret file attached.';
  }

  function handleMountDialogSecretSelected(file: globalThis.File) {
    if (!mountDialogMount) {
      return;
    }
    return applySecretFileToMount(file, mountDialogMount.id);
  }

  function handleSelectedIdentitySecretSelected(file: globalThis.File) {
    if (!selectedChatIdentity) {
      return;
    }
    return applySecretFileToIdentity(file, selectedChatIdentity.id);
  }

  async function applyAvatarFileToIdentity(file: globalThis.File, identityId: string) {
    if (!trimSecretPart(file.type).startsWith('image/')) {
      throw new Error('Avatar must be an image file.');
    }
    const dataUrl = await readFileAsDataUrl(file);
    updateConfiguredChatIdentity(identityId, {
      avatarDataUrl: dataUrl,
      avatarFileName: trimSecretPart(file.name) || 'avatar',
      avatarMimeType: trimSecretPart(file.type),
    });
    identityManagerError = '';
    identityManagerMessage = 'Identity picture updated.';
  }

  async function handleIdentityAvatarFileChange(event: Event, identityId: string) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) {
      return;
    }
    try {
      await applyAvatarFileToIdentity(file, identityId);
    } catch (error) {
      identityManagerError = error instanceof Error ? error.message : 'Failed to read avatar image';
      identityManagerMessage = '';
    }
  }

  function clearConfiguredChatIdentityAvatar(identityId: string) {
    updateConfiguredChatIdentity(identityId, {
      avatarDataUrl: '',
      avatarFileName: '',
      avatarMimeType: '',
    });
    identityManagerError = '';
    identityManagerMessage = 'Identity picture removed.';
  }

  function removeConfiguredChatIdentity(identityId: string) {
    const nextIdentities = configuredIdentities.filter((identity) => identity.id !== identityId);
    configuredIdentities = nextIdentities;
    if (activeChatIdentityId === identityId) {
      activeChatIdentityId = nextIdentities[0]?.id ?? '';
    }
    identityManagerError = '';
    identityManagerMessage = '';
  }

  async function handleChatMutated() {
    await refreshTimeline();
    chatRefreshVersion += 1;
  }

  function openIdentityManager() {
    showCreateChooser = false;
    if (currentVolumeChatIdentityId) {
      activeChatIdentityId = currentVolumeChatIdentityId;
    }
    showIdentityManager = true;
  }

  function closeIdentityManager() {
    showIdentityManager = false;
  }

  function configuredIdentityNeedsPublish(identity: ConfiguredIdentity): boolean {
    if (!identity.publicKey) {
      return true;
    }
    const publishedIdentity = publishedIdentityByPublicKey.get(identity.publicKey);
    if (!publishedIdentity) {
      return true;
    }
    return (
      publishedIdentity.record.profile.displayName !== identity.displayName.trim() ||
      (publishedIdentity.record.profile.bio ?? '') !== identity.bio.trim()
    );
  }

  async function ensureChatIdentityPublished(
    identity: ConfiguredIdentity,
    options: { announceSuccess?: boolean; openManagerOnError?: boolean } = {}
  ): Promise<ConfiguredIdentity | null> {
    if (!auth) {
      identityManagerError = 'Open a hub before publishing an identity.';
      identityManagerMessage = '';
      return null;
    }
    if (isHistoryMode) {
      identityManagerError = 'History mode is read-only. Jump to Latest before publishing.';
      identityManagerMessage = '';
      return null;
    }
    if (!hasConfiguredIdentitySecret(identity)) {
      identityManagerError = 'Identity secret is required.';
      identityManagerMessage = '';
      if (options.openManagerOnError) {
        showIdentityManager = true;
      }
      return null;
    }
    if (identity.displayName.trim() === '') {
      identityManagerError = 'Display name is required before publishing.';
      identityManagerMessage = '';
      if (options.openManagerOnError) {
        showIdentityManager = true;
      }
      return null;
    }
    if (!configuredIdentityNeedsPublish(identity) && identity.publicKey) {
      return identity;
    }

    identityManagerLoading = true;
    identityManagerError = '';
    if (options.announceSuccess) {
      identityManagerMessage = '';
    }
    try {
      const published = await publishIdentity(auth, buildIdentitySecret(identity), {
        displayName: identity.displayName.trim(),
        bio: identity.bio.trim() || undefined,
      });
      updateConfiguredChatIdentity(identity.id, {
        publicKey: published.published.authorPublicKey,
      });
      try {
        await handleChatMutated();
      } catch (refreshError) {
        console.warn('Identity was published but chat refresh failed:', refreshError);
      }
      if (options.announceSuccess) {
        identityManagerMessage = `Published ${identity.displayName.trim()} to this hub.`;
      }
      return {
        ...identity,
        publicKey: published.published.authorPublicKey,
      };
    } catch (error) {
      identityManagerError = error instanceof Error ? error.message : 'Failed to publish identity';
      if (options.openManagerOnError) {
        showIdentityManager = true;
      }
      return null;
    } finally {
      identityManagerLoading = false;
    }
  }

  async function publishSelectedChatIdentity(): Promise<ConfiguredIdentity | null> {
    if (!selectedChatIdentity) {
      identityManagerError = 'Choose an identity first.';
      identityManagerMessage = '';
      return null;
    }
    return ensureChatIdentityPublished(selectedChatIdentity, {
      announceSuccess: true,
      openManagerOnError: true,
    });
  }

  async function joinCurrentVolumeChat(): Promise<ConfiguredIdentity | null> {
    if (!auth || !volumeId) {
      identityManagerError = 'Open a hub before joining chat.';
      identityManagerMessage = '';
      return null;
    }
    if (!selectedChatIdentity) {
      identityManagerError = 'Choose an identity before joining this chat.';
      identityManagerMessage = '';
      showIdentityManager = true;
      return null;
    }
    if (isHistoryMode) {
      identityManagerError = 'History mode is read-only. Jump to Latest before joining chat.';
      identityManagerMessage = '';
      return null;
    }

    const publishedIdentity = await publishSelectedChatIdentity();
    if (!publishedIdentity) {
      return null;
    }

    volumeChatIdentityAssignments = {
      ...volumeChatIdentityAssignments,
      [volumeId]: publishedIdentity.id,
    };
    identityManagerError = '';
    identityManagerMessage = `Joined this hub as ${publishedIdentity.displayName.trim()}.`;
    return publishedIdentity;
  }

  function toggleColumnSort(column: 'name' | 'size' | 'date') {
    if (column === 'name') {
      sortBy = sortBy === 'name' ? 'name-desc' : 'name';
      return;
    }
    if (column === 'size') {
      sortBy = sortBy === 'size' ? 'size-asc' : 'size';
      return;
    }
    sortBy = sortBy === 'newest' ? 'oldest' : 'newest';
  }

  function columnSortState(column: 'name' | 'size' | 'date'): 'ascending' | 'descending' | 'none' {
    if (column === 'name') {
      if (sortBy === 'name') return 'ascending';
      if (sortBy === 'name-desc') return 'descending';
      return 'none';
    }
    if (column === 'size') {
      if (sortBy === 'size-asc') return 'ascending';
      if (sortBy === 'size') return 'descending';
      return 'none';
    }
    if (sortBy === 'oldest') return 'ascending';
    if (sortBy === 'newest') return 'descending';
    return 'none';
  }

  function handleManagerKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && showCreateChooser) {
      event.preventDefault();
      closeCreateChooser();
      return;
    }

    if (event.key === 'Escape' && showIdentityManager) {
      event.preventDefault();
      closeIdentityManager();
      return;
    }

    const activeElement = document.activeElement;
    if (
      event.key === 'Escape' &&
      fileManagerElement &&
      activeElement instanceof Node &&
      fileManagerElement.contains(activeElement)
    ) {
      event.preventDefault();
      if (renamingFileName) {
        cancelRenaming();
        return;
      }
      if (showPreviewPane) {
        closePreviewPane();
      }
    }
  }

  function isFileManagerFocused(target: EventTarget | null): boolean {
    if (!fileManagerElement) {
      return false;
    }
    if (target instanceof Node && fileManagerElement.contains(target)) {
      return true;
    }
    const activeElement = document.activeElement;
    if (activeElement instanceof Node && fileManagerElement.contains(activeElement)) {
      return true;
    }
    return fileManagerActive;
  }

  function isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) {
      return false;
    }
    return (
      target.isContentEditable ||
      target.closest('input, textarea, select, [contenteditable="true"]') !== null
    );
  }

  function mountedSecretForVolumeId(targetVolumeId: string): string | null {
    const normalized = targetVolumeId.trim().toLowerCase();
    const mount = mounts.find(
      (candidate) =>
        candidate.volumeId?.trim().toLowerCase() === normalized && buildMountSecret(candidate).trim() !== ''
    );
    return mount ? buildMountSecret(mount) : null;
  }

  async function importNearbytesBundleIntoCurrentVolume(bundle: SourceReferenceBundle) {
    if (!auth || !effectiveSecret) {
      throw new Error('Open a destination hub before pasting.');
    }
    if (isHistoryMode) {
      throw new Error('History mode is read-only. Jump to Latest before pasting.');
    }

    errorMessage = '';
    await importMountedSourceReferenceBundle(auth, bundle, mountedSecretForVolumeId);
    await refreshFiles();
  }

  async function copySelectedFilesToClipboard() {
    if (!auth || !effectiveSecret) {
      return;
    }
    if (isHistoryMode) {
      errorMessage = 'History mode is read-only. Jump to Latest before copying.';
      return;
    }
    if (selectedFiles.length === 0) {
      return;
    }

    errorMessage = '';
    const exported = await exportSourceReferences(
      auth,
      selectedFiles.map((file) => file.filename)
    );
    appReferenceClipboard = {
      bundle: exported.bundle,
      itemCount: exported.bundle.items.length,
    };
    await writeNearbytesClipboardPayload(exported.serialized);
  }

  async function pasteCopiedFiles() {
    if (!appReferenceClipboard) {
      return;
    }
    await importNearbytesBundleIntoCurrentVolume(appReferenceClipboard.bundle);
  }

  async function openFileInViewer(file: FileMetadata) {
    if (!auth) return;
    const popup = window.open('', '_blank', 'noopener,noreferrer');
    try {
      errorMessage = '';
      const blob = await downloadFile(auth, file.blobHash);
      const viewUrl = URL.createObjectURL(blob);
      if (popup) {
        popup.location.href = viewUrl;
      } else {
        const a = document.createElement('a');
        a.href = viewUrl;
        a.download = file.filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
      setTimeout(() => URL.revokeObjectURL(viewUrl), 60000);
    } catch (error) {
      if (popup) {
        popup.close();
      }
      errorMessage = error instanceof Error ? error.message : 'Open failed';
    }
  }

  function handleFileRowKeydown(e: KeyboardEvent, file: FileMetadata) {
    if (e.key === 'Enter') {
      e.preventDefault();
      openPreviewPane(file);
      return;
    }
    if (e.key === ' ') {
      e.preventDefault();
      selectFile(file);
    }
  }

  function handleFilePointerSelect(event: MouseEvent, file: FileMetadata) {
    selectFile(file, {
      toggle: event.metaKey || event.ctrlKey,
      range: event.shiftKey,
      additiveRange: event.shiftKey && (event.metaKey || event.ctrlKey),
    });
  }

  function startRenaming(file: FileMetadata) {
    if (!auth || isHistoryMode) {
      return;
    }
    setSelection([file.filename], file.filename, file.filename);
    renamingFileName = file.filename;
    renameDraft = fileBaseName(file.filename);
    renamePending = false;
  }

  function cancelRenaming() {
    renamingFileName = null;
    renameDraft = '';
    renamePending = false;
  }

  async function commitRename(file: FileMetadata) {
    if (renamePending || renamingFileName !== file.filename) {
      return;
    }
    if (!auth || isHistoryMode) {
      cancelRenaming();
      return;
    }
    const nextBaseName = renameDraft.trim();
    if (nextBaseName === '') {
      errorMessage = 'File name cannot be empty.';
      return;
    }
    if (nextBaseName.includes('/')) {
      errorMessage = 'Rename only changes the file name, not the path.';
      return;
    }
    const nextFilename = renameDestination(file, nextBaseName);
    if (nextFilename === file.filename) {
      cancelRenaming();
      return;
    }

    try {
      renamePending = true;
      errorMessage = '';
      await renameFile(auth, file.filename, nextFilename);
      cancelRenaming();
      await refreshFiles();
      const renamed = fileList.find((entry) => entry.filename === nextFilename) ?? null;
      if (renamed) {
        setSelection([renamed.filename], renamed.filename, renamed.filename);
      }
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Rename failed';
    } finally {
      renamePending = false;
    }
  }

  function displayFileName(file: FileMetadata): string {
    return file.filename.split('/').filter(Boolean).at(-1) ?? file.filename;
  }

  // Refresh file list
  async function refreshFiles() {
    if (!auth || !volumeId || isRefreshing) return;
    isRefreshing = true;

    try {
      const response = await listFiles(auth);
      fileList = response.files;
      lastRefresh = Date.now();
      isOffline = false;
      errorMessage = '';

      // Update cache
      await setCachedFiles(volumeId, response.files);
      await refreshTimeline(true);
      chatRefreshVersion += 1;
    } catch (error) {
      // Try cached data
      const cached = await getCachedFiles(volumeId);
      if (cached) {
        fileList = cached;
        isOffline = true;
        errorMessage = 'Using cached data. Backend unavailable.';
      } else {
        errorMessage = error instanceof Error ? error.message : 'Failed to refresh';
      }
    } finally {
      isRefreshing = false;
    }
  }

  // Drag and drop handlers
  function handleDragOver(e: DragEvent) {
    if (!canHandleDropPayload(e.dataTransfer)) return;
    e.preventDefault();
    isDragging = true;
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy';
    }
  }

  function handleDragLeave(e: DragEvent) {
    e.preventDefault();
    isDragging = false;
  }

  async function handleDrop(e: DragEvent) {
    e.preventDefault();
    isDragging = false;
    if (isHistoryMode) {
      errorMessage = 'History mode is read-only. Jump to Latest before uploading.';
      return;
    }

    try {
      errorMessage = '';
      if (e.dataTransfer?.types.includes(NEARBYTES_DRAG_TYPE)) {
        if (!auth || !effectiveSecret) {
          throw new Error('Open a destination hub before pasting.');
        }
        const bundle = await exportSourceReferenceBundleFromDrag(
          auth,
          e.dataTransfer.getData(NEARBYTES_DRAG_TYPE)
        );
        await importNearbytesBundleIntoCurrentVolume(bundle);
        return;
      }

      const sourceBundle = parseSourceReferenceBundleText(e.dataTransfer?.getData('text/plain') ?? '');
      if (sourceBundle) {
        await importNearbytesBundleIntoCurrentVolume(sourceBundle);
        return;
      }

      if (!auth || !effectiveSecret) {
        errorMessage = 'Enter address and optional password first';
        return;
      }
      const files = await filesFromTransfer(e.dataTransfer);
      if (files.length === 0) return;
      await uploadFiles(auth, files);
      await refreshFiles();
    } catch (error) {
      errorMessage = dropFailureMessage(error, 'Upload failed');
      console.error('Error uploading files:', error);
    }
  }

  function shouldRoutePasteToSecret(target: EventTarget | null): boolean {
    if (secretPasteTargetMountId && mounts.some((mount) => mount.id === secretPasteTargetMountId)) {
      return true;
    }

    if (!mountDialogMountId || !mounts.some((mount) => mount.id === mountDialogMountId)) {
      return false;
    }

    if (!(target instanceof Element)) {
      return true;
    }

    return target.closest('.mount-dialog') !== null || target.closest('.header-shell') !== null;
  }

  function handleNearbytesFileDragStart(event: DragEvent, file: FileMetadata) {
    if (!event.dataTransfer) {
      return;
    }
    const payload = {
      filenames:
        selectedFileNames.includes(file.filename) && selectedFileNames.length > 1
          ? [...selectedFileNames]
          : [file.filename],
      primaryFilename: file.filename,
      mimeType: file.mimeType,
    };
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData(NEARBYTES_DRAG_TYPE, JSON.stringify(payload));
    event.dataTransfer.setData('text/plain', file.filename);
  }

  async function handlePaste(event: ClipboardEvent) {
    if (
      appReferenceClipboard &&
      isFileManagerFocused(event.target) &&
      !isEditableTarget(event.target)
    ) {
      event.preventDefault();
      try {
        await pasteCopiedFiles();
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : 'Paste import failed';
      }
      return;
    }

    const clipboardData = event.clipboardData;
    if (
      clipboardData &&
      isFileManagerFocused(event.target) &&
      !isEditableTarget(event.target)
    ) {
      const sourceBundle = parseSourceReferenceBundleText(clipboardData.getData('text/plain'));
      if (sourceBundle) {
        event.preventDefault();
        try {
          await importNearbytesBundleIntoCurrentVolume(sourceBundle);
        } catch (error) {
          errorMessage = error instanceof Error ? error.message : 'Paste import failed';
        }
        return;
      }
    }
    if (!clipboardData || !canHandleDropPayload(clipboardData)) {
      return;
    }

    const localFiles = localFilesFromTransfer(clipboardData);
    const allowRemoteClipboardImport =
      transferTypes(clipboardData).includes('DownloadURL') ||
      /<img[\s>]/i.test(clipboardData.getData('text/html'));
    const files =
      localFiles.length > 0
        ? localFiles
        : allowRemoteClipboardImport
          ? await filesFromTransfer(clipboardData)
          : [];
    if (files.length === 0) {
      return;
    }

    if (shouldRoutePasteToSecret(event.target)) {
      event.preventDefault();
      try {
        errorMessage = '';
        const targetMountId =
          secretPasteTargetMountId && mounts.some((mount) => mount.id === secretPasteTargetMountId)
            ? secretPasteTargetMountId
            : prepareMountForSecretDrop(event.target);
        await applySecretFileToMount(files[0], targetMountId);
      } catch (error) {
        errorMessage = dropFailureMessage(error, 'Failed to use pasted file as secret');
        pendingMountId = null;
      }
      return;
    }

    if (!auth || !effectiveSecret) {
      return;
    }
    if (isHistoryMode) {
      event.preventDefault();
      errorMessage = 'History mode is read-only. Jump to Latest before uploading.';
      return;
    }

    event.preventDefault();
    try {
      errorMessage = '';
      await uploadFiles(auth, files);
      await refreshFiles();
    } catch (error) {
      errorMessage = dropFailureMessage(error, 'Paste upload failed');
      console.error('Error uploading pasted files:', error);
    }
  }

  // Delete file
  async function handleDelete(filename: string) {
    if (!auth) return;
    if (isHistoryMode) {
      errorMessage = 'History mode is read-only. Jump to Latest before deleting.';
      return;
    }

    try {
      errorMessage = '';
      await deleteFile(auth, filename);
      // Refresh file list
      await refreshFiles();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Delete failed';
      console.error('Error deleting file:', error);
    }
  }

  // Download file
  async function handleDownload(file: FileMetadata) {
    if (!auth) return;

    try {
      errorMessage = '';
      const blob = await downloadFile(auth, file.blobHash);
      
      // Create download link
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Download failed';
      console.error('Error downloading file:', error);
    }
  }

  // Copy volumeId to clipboard
  async function copyVolumeId() {
    if (!volumeId) return;
    try {
      await navigator.clipboard.writeText(volumeId);
      copiedVolumeId = true;
      setTimeout(() => {
        copiedVolumeId = false;
      }, 2000);
    } catch (error) {
      console.error('Failed to copy volumeId:', error);
    }
  }

  function normalizeJoinLinkJsonValue(value: unknown): unknown {
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }
    if (Array.isArray(value)) {
      return value.map((entry) => normalizeJoinLinkJsonValue(entry));
    }
    if (!value || typeof value !== 'object') {
      return null;
    }
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, normalizeJoinLinkJsonValue(entry)])
    );
  }

  function serializeCanonicalJoinLink(link: JoinLink): string {
    return JSON.stringify(normalizeJoinLinkJsonValue(link));
  }

  function buildNearbytesJoinDeepLink(serialized: string): string {
    return `nearbytes://join?data=${bytesToBase64Url(new TextEncoder().encode(serialized))}`;
  }

  function setJoinLinkCopyFeedback(tone: JoinLinkCopyFeedbackState['tone'], message: string): void {
    joinLinkCopyFeedback = { tone, message };
    if (joinLinkCopyFeedbackTimer) {
      clearTimeout(joinLinkCopyFeedbackTimer);
    }
    joinLinkCopyFeedbackTimer = setTimeout(() => {
      joinLinkCopyFeedback = null;
      joinLinkCopyFeedbackTimer = null;
    }, 3200);
  }

  function buildCurrentJoinLinkSpace(includeSecret: boolean): JoinLink['space'] | null {
    if (!includeSecret) {
      return shareableVolumeId ? { mode: 'volume-id', value: shareableVolumeId } : null;
    }
    if (!activeMount) {
      return null;
    }
    const secretPayload = trimSecretPart(activeMount.secretFilePayload);
    if (secretPayload.startsWith(FILE_SECRET_PREFIX)) {
      const payload = secretPayload.slice(FILE_SECRET_PREFIX.length);
      if (payload !== '') {
        return {
          mode: 'secret-file',
          name: trimSecretPart(activeMount.secretFileName) || mountLabel(activeMount),
          mime: trimSecretPart(activeMount.secretFileMimeType) || undefined,
          payload,
        };
      }
    }
    const seedValue = trimSecretPart(activeMount.address);
    if (seedValue === '') {
      return null;
    }
    const password = trimSecretPart(activeMount.password);
    return password === '' ? { mode: 'seed', value: seedValue } : { mode: 'seed', value: seedValue, password };
  }

  function hasCopyableCurrentSecret(): boolean {
    return buildCurrentJoinLinkSpace(true) !== null;
  }

  async function buildCurrentJoinLink(includeSecret: boolean): Promise<JoinLink> {
    const space = buildCurrentJoinLinkSpace(includeSecret);
    if (!space) {
      throw new Error(includeSecret ? 'Open a hub with its secret before copying that link.' : 'Open a hub first.');
    }
    return {
      p: 'nb.join.v1',
      space,
      attachments: [],
    };
  }

  async function copyCurrentJoinLink(includeSecret: boolean): Promise<void> {
    joinLinkCopyBusy = true;
    try {
      const link = await buildCurrentJoinLink(includeSecret);
      const serialized = serializeCanonicalJoinLink(link);
      let clipboardText = buildNearbytesJoinDeepLink(serialized);
      let feedbackTone: JoinLinkCopyFeedbackState['tone'] = 'success';
      let feedbackMessage = includeSecret ? 'Copied secret share payload.' : 'Copied share link.';
      if (clipboardText.length > NEARBYTES_JOIN_DEEP_LINK_MAX_LENGTH) {
        if (!includeSecret) {
          throw new Error(
            'This link is too large to fit in a nearbytes:// link. Copy the secret payload instead, or share the hub without embedding a large secret file.'
          );
        }
        clipboardText = serialized;
        feedbackTone = 'warning';
        feedbackMessage =
          'Copied raw share data JSON, not a nearbytes:// link. Send or paste this text into Open from clipboard. This happened because the embedded secret payload exceeded the 16 KB deep-link limit.';
      }
      await navigator.clipboard.writeText(clipboardText);
      setJoinLinkCopyFeedback(feedbackTone, feedbackMessage);
      volumeSharingFeedback = { tone: feedbackTone, message: feedbackMessage };
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Failed to copy Nearbytes link';
    } finally {
      joinLinkCopyBusy = false;
    }
  }

  function activeThemePreset() {
    return (
      themeRegistry.presets.find((preset) => preset.presetId === themeSettings.presetId) ??
      themeRegistry.presets[0]
    );
  }

  function applyThemePreset(presetId: NearbytesThemePresetId): void {
    const preset = themeRegistry.presets.find((entry) => entry.presetId === presetId);
    if (!preset) {
      return;
    }
    themeSettings = cloneThemeSettings(preset);
    themeDialogFeedback = null;
    themeDialogError = '';
  }

  function updateThemePaletteColor(key: keyof NearbytesThemeSettings['palette'], value: string): void {
    themeSettings = {
      ...themeSettings,
      palette: {
        ...themeSettings.palette,
        [key]: value,
      },
    };
  }

  function updateThemeSurfaceStyle(value: NearbytesSurfaceStyle): void {
    themeSettings = normalizeThemeSettings({
      ...themeSettings,
      palette: {
        ...themeSettings.palette,
        surfaceStyle: value,
      },
    }, themeRegistry);
  }

  function updateThemeLogoColor(key: 'accentColor' | 'peerColor' | 'arcColor' | 'bgFill' | 'nodeFill' | 'nodeStroke', value: string): void {
    themeSettings = {
      ...themeSettings,
      logo: {
        ...themeSettings.logo,
        [key]: value,
      },
    };
  }

  function updateThemeLogoNumber(key: 'peers' | 'orbitScale' | 'sizeScale' | 'bulgeScale' | 'lineWeight' | 'circleStroke' | 'pulseSpeed' | 'pulseMag' | 'luminosity' | 'contrast', value: number): void {
    themeSettings = normalizeThemeSettings({
      ...themeSettings,
      logo: {
        ...themeSettings.logo,
        [key]: value,
      },
    }, themeRegistry);
  }

  function updateThemeArcStyle(value: NearbytesArcStyle): void {
    themeSettings = {
      ...themeSettings,
      logo: {
        ...themeSettings.logo,
        arcStyle: value,
      },
    };
  }

  function resetThemeToPreset(): void {
    applyThemePreset(themeSettings.presetId);
  }

  // Format file size
  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  // Format date
  function formatDate(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toLocaleString();
  }

  function formatShortDate(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }
</script>

<svelte:window onkeydown={(e) => {
  if (e.key === 'Escape') {
    if (timelineDetailOpen) {
      e.preventDefault();
      closeTimelineDetails();
      return;
    }
    if (showThemeDialog) {
      e.preventDefault();
      showThemeDialog = false;
      return;
    }
    if (showJoinVolumeDialog) {
      e.preventDefault();
      closeJoinVolumeDialog();
      return;
    }
    if (showVolumeShareDialog) {
      e.preventDefault();
      closeVolumeShareDialog();
      return;
    }
    handleManagerKeydown(e);
    collapseMount(activeMountId);
  }
  if (
    (e.metaKey || e.ctrlKey) &&
    !e.altKey &&
    !e.shiftKey &&
    e.key.toLowerCase() === 'c' &&
    isFileManagerFocused(e.target) &&
    selectedFiles.length > 0 &&
    !isEditableTarget(e.target)
  ) {
    e.preventDefault();
    void copySelectedFilesToClipboard().catch((error) => {
      errorMessage = error instanceof Error ? error.message : 'Copy failed';
    });
  }
  if (e.key === 'Delete' && e.target instanceof HTMLElement) {
    const fileItem = e.target.closest('[data-filename]');
    if (fileItem) {
      const filename = fileItem.getAttribute('data-filename');
      if (filename && auth) {
        handleDelete(filename);
      }
    }
  }
}} onpointerdown={(event) => {
  if (
    fileManagerElement &&
    (!(event.target instanceof Node) || !fileManagerElement.contains(event.target))
  ) {
    fileManagerActive = false;
  }
  collapseExpandedMountFromOutside(event.target);
}} onpaste={handlePaste} />

<div class="app" style={appThemeCssText}>
  <header class="header">
    <div
      class="header-shell"
      class:secret-drop-target={isSecretDropTarget}
      role="group"
      aria-label="Hub controls"
      onmouseenter={() => {
        isHeaderHovering = true;
      }}
      onmouseleave={() => {
        isHeaderHovering = false;
      }}
      onfocusin={() => {
        isHeaderHovering = true;
      }}
      onfocusout={(event) => {
        const relatedTarget = event.relatedTarget;
        if (relatedTarget instanceof Node && (event.currentTarget as HTMLElement).contains(relatedTarget)) {
          return;
        }
        isHeaderHovering = false;
      }}
      ondragenter={(event) => {
        if (canHandleSecretDropPayload(event.dataTransfer)) {
          isSecretDropTarget = true;
        }
      }}
      ondragover={(event) => {
        if (!canHandleSecretDropPayload(event.dataTransfer)) return;
        event.preventDefault();
        isSecretDropTarget = true;
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = 'copy';
        }
      }}
      ondragleave={(event) => {
        const relatedTarget = event.relatedTarget;
        if (relatedTarget instanceof Node && (event.currentTarget as HTMLElement).contains(relatedTarget)) {
          return;
        }
        isSecretDropTarget = false;
      }}
      ondrop={handleSecretFileDrop}
    >
      <div class="brand-rail panel-surface">
        <div class="brand-badge static" aria-label="Nearbytes branding">
          {#if isDevThemeStudio}
            <button
              type="button"
              class="brand-logo-trigger"
              onclick={() => openThemeStudio('preset')}
              aria-label="Open theme studio"
              title="Open theme studio"
            >
              <span class="brand-logo-frame interactive">
                <NearbytesLogo size={64} options={themeSettings.logo} ariaLabel="Nearbytes brand mark" />
              </span>
            </button>
          {:else}
            <span class="brand-logo-frame">
              <NearbytesLogo size={64} options={themeSettings.logo} ariaLabel="Nearbytes brand mark" />
            </span>
          {/if}
          <div class="brand-stack">
            <div class="brand-meta-row">
              <span class="brand-copy">
                <span class="brand-title">Nearbytes</span>
                <span class="brand-note">{activeThemePreset().palette.label}</span>
              </span>

              <MountRail dragging={draggingMountId !== null}>
        {#snippet children()}
        {#each mounts as mount, index (mount.id)}
          {@const isPending = pendingMountId === mount.id}
          <div
            class="mount-stack"
            animate:flip={{ duration: 160 }}
          >
            {#if shouldRenderMountHoleBefore(index)}
              <div class="mount-item drag-hole" aria-hidden="true">
                <div class="volume-chip collapsed-shell parked hole-shell">
                  <div class="header-dock">
                    <div class="header-dock-main">
                      <div class="header-dock-badge">
                        <div class="header-dock-badge-top"></div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            {/if}
            <div
              class="mount-item"
              class:dragging={draggingMountId === mount.id}
              use:trackMountNode={mount.id}
            >
              <div
                class="volume-chip collapsed-shell parked"
                class:selected={mount.id === activeMountId}
                class:pressed={pressedMountId === mount.id}
                class:dragging={draggingMountId === mount.id && dragMoved}
                class:drag-over={dragOverMountId === mount.id && dragMoved}
                data-mount-id={mount.id}
                style:transform={isMountReorderActive(mount.id) ? `translate3d(${dragTranslateX}px, 0, 0)` : undefined}
              >
                <button
                  type="button"
                  class="volume-chip-select"
                  aria-label={mountLabel(mount) || 'Hub entry'}
                  onclick={() => handleMountClick(mount.id)}
                  onpointerdown={(event) => beginMountReorder(event, mount.id, mount.collapsed)}
                  onpointermove={handleMountPointerMove}
                  onpointerup={handleMountPointerUp}
                  onpointercancel={handleMountPointerCancel}
                  title={mountLabel(mount) || 'Open hub'}
                >
                  <div class="header-dock">
                    <div class="header-dock-main">
                      <div class="header-dock-badge" class:loading={isPending}>
                        <div class="header-dock-badge-top">
                          <VolumeIdentity
                            compact={true}
                            label={mountLabel(mount)}
                            title={mountLabel(mount)}
                            filePayload={mount.secretFilePayload}
                            fileMimeType={mount.secretFileMimeType}
                            fileName={mount.secretFileName}
                          />
                        </div>
                        {#if isPending}
                          <span class="badge-meter" aria-hidden="true">
                            <span class="badge-meter-bar"></span>
                          </span>
                        {/if}
                      </div>
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  class="volume-chip-action-btn volume-chip-config-btn"
                  aria-label={`Edit ${mountLabel(mount) || 'hub'}`}
                  title="Edit hub"
                  onclick={(event) => {
                    event.stopPropagation();
                    reopenMount(mount.id);
                  }}
                >
                  <Settings2 size={14} strokeWidth={2} />
                </button>
              </div>
            </div>
          </div>
        {/each}
        {/snippet}
        {#snippet actions()}
          <div class="mount-quick-actions" class:revealed={isHeaderHovering}>
            <button
              type="button"
              class="mount-add-btn mount-quick-primary"
              onclick={openCreateChooser}
              aria-label="Create"
              title="Create"
            >
              <Plus size={15} strokeWidth={2.2} />
            </button>
          </div>
        {/snippet}
              </MountRail>

              <div class="mounts-actions brand-actions">
                <button
                  type="button"
                  class="header-tool-btn"
                  class:active={showIdentityManager}
                  aria-label="Identities"
                  title="Identities"
                  onclick={(event) => {
                    event.stopPropagation();
                    openIdentityManager();
                  }}
                >
                  <UserRound class="button-icon" size={14} strokeWidth={2} />
                </button>
                <button
                  type="button"
                  class="header-tool-btn"
                  class:active={showSourcesPanel}
                  aria-label="Locations"
                  title="Locations"
                  onclick={(event) => {
                    event.stopPropagation();
                    toggleSourcesPanel();
                  }}
                >
                  <HardDrive class="button-icon" size={14} strokeWidth={2} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      </div>
  </header>

  <!-- Main file area -->
  <main
    class="file-area"
    class:volume-workspace-active={!showSourcesPanel && !showVolumeStoragePanel && address.trim() !== ''}
    class:dragging={isDragging}
    ondragover={handleDragOver}
    ondragleave={handleDragLeave}
    ondrop={handleDrop}
  >
    {#if showSourcesPanel}
      <div class="workspace-panel-view">
        <StoragePanel
          mode="global"
          volumeId={shareableVolumeId}
          currentVolumePresentation={currentMountedVolumePresentation}
          knownVolumes={knownMountedVolumes}
          onOpenVolumeRouting={openMountedVolumeRouting}
          onOpenStorageSetup={() => openSourcesPanelWithFocus(null)}
          discoveryDetails={latestSourceDiscovery}
          refreshToken={sourceDiscoveryRefreshToken}
          focusSection={sourceDiscoveryPanelFocus}
        />
      </div>
    {:else if showVolumeStoragePanel}
      <div class="workspace-panel-view">
        <StoragePanel
          mode="volume"
          volumeId={shareableVolumeId}
          currentVolumePresentation={currentMountedVolumePresentation}
          knownVolumes={knownMountedVolumes}
          onOpenVolumeRouting={openMountedVolumeRouting}
          onOpenStorageSetup={() => openSourcesPanelWithFocus(null)}
          refreshToken={sourceDiscoveryRefreshToken}
        />
      </div>
    {:else if address.trim() === ''}
      <!-- Initial state -->
      <div class="empty-state">
        <div class="empty-content">
          <div class="empty-brand-shell">
            <NearbytesLogo size={112} options={themeSettings.logo} ariaLabel="Nearbytes logo" />
          </div>
          <p class="empty-eyebrow">{activeThemePreset().palette.label}</p>
          <p class="empty-hint">Enter an address to access your files</p>
          <p class="empty-subhint">Or drag and drop files here to create a new hub.{#if isDevThemeStudio} Click the brand mark to edit presets and export the checked-in logo asset.{:else} The active preset stays consistent across launches.{/if}</p>
        </div>
      </div>
    {:else}
      <div class="volume-workspace">
      {#if isVolumeTransitioning}
        <div class="volume-transition-state panel-surface" aria-live="polite">
          <div class="volume-transition-spinner"></div>
          <div class="volume-transition-copy">
            <p class="volume-transition-title">Switching hub</p>
            <p class="volume-transition-subtitle">Replaying history off-screen…</p>
          </div>
        </div>
      {:else}
      {#if showTimeMachinePanel}
      <section class="time-machine panel-surface" aria-label="Hub timeline">
        <div class="time-machine-head">
          <div>
            <p class="time-machine-eyebrow">Timeline</p>
            <p class="time-machine-marker">{timelineMarker}</p>
          </div>
          <div class="time-machine-actions">
            <button
              type="button"
              class="tm-btn"
              onclick={toggleTimelinePlayback}
              disabled={timelineEvents.length === 0 || isTimelineLoading}
            >
              {isTimelinePlaying ? 'Pause' : 'Play'}
            </button>
            <button
              type="button"
              class="tm-btn live"
              onclick={jumpToLatest}
              disabled={timelinePosition === timelineEvents.length}
            >
              Latest
            </button>
          </div>
        </div>
        <div class="time-machine-track">
          <input
            class="tm-slider"
            type="range"
            min="0"
            max={timelineEvents.length}
            value={timelinePosition}
            disabled={timelineEvents.length === 0}
            aria-label="Timeline position"
            oninput={(e) => {
              stopTimelinePlayback();
              setTimelinePosition(Number((e.currentTarget as HTMLInputElement).value));
            }}
          />
          <div class="tm-scale">
            <span>Start</span>
            <span>{timelinePosition}/{timelineEvents.length}</span>
            <span>Latest</span>
          </div>
        </div>
        {#if timelineEvents.length > 0}
          <div class="tm-events" bind:this={timelineEventsElement} onscroll={handleTimelineScroll}>
            {#each timelineEvents as event, index (event.eventHash)}
              <div class="tm-event-row">
                <button
                  type="button"
                  class="tm-event"
                  class:applied={index < timelinePosition}
                  class:current={index === timelinePosition - 1}
                  class:create={event.type === 'CREATE_FILE'}
                  class:delete={event.type === 'DELETE_FILE'}
                  class:rename={event.type === 'RENAME_FILE'}
                  class:identity={isTimelineIdentityEvent(event)}
                  class:chat={isTimelineChatEvent(event)}
                  onclick={() => jumpToEvent(index)}
                  title={timelineTitle(event)}
                >
                  <span class="tm-event-kind">{timelineKindLabel(event)}</span>
                  <span class="tm-event-name">{timelineHeadline(event)}</span>
                  <span class="tm-event-time">{formatShortDate(event.timestamp)}</span>
                </button>
                <button
                  type="button"
                  class="tm-event-details"
                  onclick={(clickEvent) => {
                    clickEvent.stopPropagation();
                    void openTimelineDetails(event);
                  }}
                  aria-label={`View details for ${event.filename || 'event'}`}
                >
                  Details
                </button>
              </div>
            {/each}
          </div>
        {:else}
          <p class="tm-empty">Timeline is empty. Add files to create history.</p>
        {/if}
      </section>
      {/if}

      <div class="workspace-mode-bar panel-surface" role="group" aria-label="Hub workspace">
        <div class="workspace-mode-primary">
          <button
            type="button"
            class="workspace-mode-btn"
            class:active={showFilesWorkspace}
            aria-pressed={showFilesWorkspace}
            onclick={() => toggleWorkspacePane('files')}
          >
            <FileText size={15} strokeWidth={2} />
            <span>Files</span>
          </button>
          <button
            type="button"
            class="workspace-mode-btn"
            class:active={showChatWorkspace}
            aria-pressed={showChatWorkspace}
            onclick={() => toggleWorkspacePane('chat')}
          >
            <MessageSquareText size={15} strokeWidth={2} />
            <span>Chat</span>
          </button>
        </div>
        {#if showFilesWorkspace || activeMount || shareableVolumeId}
          <div class="workspace-mode-secondary">
            {#if showFilesWorkspace}
              <span class="workspace-selection-summary">
                {selectedFileNames.length === 0
                  ? `${visibleFiles.length} file${visibleFiles.length === 1 ? '' : 's'} · no selection`
                  : selectedFileNames.length === 1 && selectedFile
                    ? `${visibleFiles.length} file${visibleFiles.length === 1 ? '' : 's'} · ${displayFileName(selectedFile)}`
                    : `${visibleFiles.length} file${visibleFiles.length === 1 ? '' : 's'} · ${selectedFileNames.length} selected`}
              </span>
              <input
                type="text"
                class="manager-search workspace-compact-control"
                placeholder="Search files"
                bind:value={searchQuery}
                aria-label="Search files"
              />
              <select class="manager-sort workspace-compact-control" bind:value={sortBy} aria-label="Sort files">
                <option value="newest">Newest</option>
                <option value="oldest">Oldest</option>
                <option value="name">Name</option>
                <option value="name-desc">Name (Z-A)</option>
                <option value="size">Size</option>
                <option value="size-asc">Size (Smallest)</option>
              </select>
              {#if appReferenceClipboard}
                <button
                  type="button"
                  class="manager-btn workspace-toolbar-btn"
                  onclick={() => void pasteCopiedFiles()}
                  disabled={!auth || isHistoryMode}
                  title={!auth ? 'Open a destination hub before pasting' : isHistoryMode ? 'Jump to Latest before pasting' : ''}
                >
                  <ClipboardPaste class="button-icon" size={15} strokeWidth={2} />
                  Paste {appReferenceClipboard.itemCount} item{appReferenceClipboard.itemCount === 1 ? '' : 's'}
                </button>
              {/if}
            {/if}
            <div class="workspace-utility-actions">
              <button
                type="button"
                class="manager-btn workspace-toolbar-btn workspace-toolbar-utility"
                class:active={showVolumeShareDialog}
                onclick={openVolumeShareDialog}
                disabled={!activeMount && !shareableVolumeId}
                title="Share this hub"
              >
                <Link2 class="button-icon" size={15} strokeWidth={2} />
                <span>Share</span>
              </button>
              <button
                type="button"
                class="manager-btn workspace-toolbar-btn workspace-toolbar-utility"
                class:active={showTimeMachinePanel}
                onclick={() => {
                  showTimeMachinePanel = !showTimeMachinePanel;
                }}
                title="Show hub timeline"
              >
                <History class="button-icon" size={15} strokeWidth={2} />
                <span>Timeline</span>
              </button>
            </div>
            {#if showFilesWorkspace}
              <div class="manager-view-switch" role="tablist" aria-label="File browser view">
                <button
                  type="button"
                  class="view-toggle"
                  class:active={fileManagerViewMode === 'icons'}
                  onclick={() => (fileManagerViewMode = 'icons')}
                  aria-pressed={fileManagerViewMode === 'icons'}
                  title="Icon view"
                >
                  <LayoutGrid size={15} strokeWidth={2} />
                </button>
                <button
                  type="button"
                  class="view-toggle"
                  class:active={fileManagerViewMode === 'details'}
                  onclick={() => (fileManagerViewMode = 'details')}
                  aria-pressed={fileManagerViewMode === 'details'}
                  title="Details view"
                >
                  <Rows3 size={15} strokeWidth={2} />
                </button>
              </div>
            {/if}
          </div>
        {/if}
      </div>

      <div
        class="workspace-panels"
        bind:this={workspacePanelsElement}
        style:grid-template-columns={workspacePanelsTemplate}
      >
        {#if showFilesWorkspace}
          <div class="workspace-pane">
            {#if viewFiles.length === 0 && !isLoading}
              <div class="empty-state">
                <div class="empty-content">
                  <svg class="empty-icon" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M32 8L8 20L32 32L56 20L32 8Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.3"/>
                    <path d="M8 20V44L32 56L56 44V20" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.3"/>
                    <path d="M32 32V56" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.3"/>
                  </svg>
                  {#if isHistoryMode}
                    <p class="empty-hint">No files at this point in history</p>
                    <p class="empty-subhint">Move the timeline toward Latest to see newer files</p>
                  {:else}
                    <p class="empty-hint">No files yet</p>
                    <p class="empty-subhint">Drop files here to add them</p>
                  {/if}
                </div>
              </div>
            {:else}
              <div
                class="file-manager"
                role="presentation"
                bind:this={fileManagerElement}
                style:grid-template-columns={fileManagerTemplate}
                onpointerdown={() => {
                  fileManagerActive = true;
                }}
                onfocusin={() => {
                  fileManagerActive = true;
                }}
              >
                <section class="file-list-pane" class:with-preview={showPreviewPane}>
                  {#if visibleFiles.length === 0}
                    <div class="list-empty">No files match your search.</div>
                  {:else}
                    <div class="file-list-scroll" class:icons={fileManagerViewMode === 'icons'}>
                      {#if fileManagerViewMode === 'details'}
                        <div class="file-list-head">
                          <span class="file-list-sort-wrap" data-sort={columnSortState('name')}>
                            <button type="button" class="file-list-sort" onclick={() => toggleColumnSort('name')}>
                              Name
                            </button>
                          </span>
                          <span class="file-list-sort-wrap" data-sort={columnSortState('size')}>
                            <button type="button" class="file-list-sort" onclick={() => toggleColumnSort('size')}>
                              Size
                            </button>
                          </span>
                          <span class="file-list-sort-wrap" data-sort={columnSortState('date')}>
                            <button type="button" class="file-list-sort" onclick={() => toggleColumnSort('date')}>
                              Updated
                            </button>
                          </span>
                        </div>
                      {/if}
                      {#each visibleFiles as file (file.filename)}
                        {@const FileIcon = fileIconComponent(file)}
                        <div
                          class:file-card={fileManagerViewMode === 'icons'}
                          class:file-row={fileManagerViewMode === 'details'}
                          class:selected={isFileSelected(file.filename)}
                          data-filename={file.filename}
                          draggable="true"
                          tabindex="0"
                          role="button"
                          onclick={(event) => handleFilePointerSelect(event, file)}
                          ondblclick={() => openPreviewPane(file)}
                          ondragstart={(event) => handleNearbytesFileDragStart(event, file)}
                          onkeydown={(e) => handleFileRowKeydown(e, file)}
                        >
                          {#if fileManagerViewMode === 'icons'}
                            <div class={`file-card-art ${fileAccentTone(file)}`}>
                              <FileIcon size={28} strokeWidth={1.8} />
                            </div>
                            <div class="file-card-copy">
                              {#if renamingFileName === file.filename}
                                <input
                                  type="text"
                                  class="file-rename-input"
                                  bind:value={renameDraft}
                                  onclick={(event) => event.stopPropagation()}
                                  ondblclick={(event) => event.stopPropagation()}
                                  onblur={() => commitRename(file)}
                                  onkeydown={(event) => {
                                    event.stopPropagation();
                                    if (event.key === 'Enter') {
                                      void commitRename(file);
                                    } else if (event.key === 'Escape') {
                                      cancelRenaming();
                                    }
                                  }}
                                />
                              {:else}
                                <button
                                  type="button"
                                  class="file-name-trigger file-card-name"
                                  title={file.filename}
                                  ondblclick={(event) => {
                                    event.stopPropagation();
                                    startRenaming(file);
                                  }}
                                  onclick={(event) => handleFilePointerSelect(event, file)}
                                >
                                  {displayFileName(file)}
                                </button>
                              {/if}
                            </div>
                          {:else}
                            <div class="file-row-main">
                              <span class={`file-row-icon ${fileAccentTone(file)}`}>
                                <FileIcon size={15} strokeWidth={2} />
                              </span>
                              <div class="file-row-copy">
                                {#if renamingFileName === file.filename}
                                  <input
                                    type="text"
                                    class="file-rename-input"
                                    bind:value={renameDraft}
                                    onclick={(event) => event.stopPropagation()}
                                    ondblclick={(event) => event.stopPropagation()}
                                    onblur={() => commitRename(file)}
                                    onkeydown={(event) => {
                                      event.stopPropagation();
                                      if (event.key === 'Enter') {
                                        void commitRename(file);
                                      } else if (event.key === 'Escape') {
                                        cancelRenaming();
                                      }
                                    }}
                                  />
                                {:else}
                                  <button
                                    type="button"
                                    class="file-name-trigger file-row-name"
                                    title={file.filename}
                                    ondblclick={(event) => {
                                      event.stopPropagation();
                                      startRenaming(file);
                                    }}
                                    onclick={(event) => handleFilePointerSelect(event, file)}
                                  >
                                    {displayFileName(file)}
                                  </button>
                                {/if}
                                <span class="file-row-path" title={file.filename}>{file.filename}</span>
                              </div>
                            </div>
                            <span class="file-row-size">{formatSize(file.size)}</span>
                            <span class="file-row-date">{formatRelativeDay(file.createdAt)}</span>
                          {/if}
                        </div>
                      {/each}
                      <button
                        type="button"
                        class="file-list-clear-hitbox"
                        aria-label="Clear file selection"
                        tabindex="-1"
                        onclick={clearSelection}
                      ></button>
                    </div>
                  {/if}
                </section>
                {#if showPreviewPane}
                  <button
                    type="button"
                    class="file-manager-divider"
                    aria-label="Resize file manager panes"
                    onpointerdown={startFileManagerResize}
                  >
                    <span class="file-manager-divider-grip">
                      <GripVertical size={16} strokeWidth={1.8} />
                    </span>
                  </button>
                  <section class="preview-pane">
                    {#if currentPreviewFile}
                      <div class="preview-header">
                        <div>
                          <h3 class="preview-title" title={currentPreviewFile.filename}>{currentPreviewFile.filename}</h3>
                          <p class="preview-meta">
                            {currentPreviewFile.mimeType || 'Unknown type'} • {formatSize(currentPreviewFile.size)} • {formatDate(currentPreviewFile.createdAt)}
                          </p>
                        </div>
                        <div class="preview-actions">
                          {#if !previewFileOverride && selectedFile}
                            <ArmedActionButton
                              class="manager-btn danger"
                              text="Delete"
                              armed={true}
                              armDelayMs={0}
                              autoDisarmMs={3000}
                              disabled={isHistoryMode}
                              resetKey={`${selectedFile.blobHash}:${isHistoryMode}`}
                              title={isHistoryMode ? 'Jump to Latest before deleting' : ''}
                              onPress={() => handleDelete(selectedFile.filename)}
                            />
                          {/if}
                          <button type="button" class="manager-btn" onclick={() => handleDownload(currentPreviewFile)}>
                            <Download class="button-icon" size={15} strokeWidth={2} />
                            Download
                          </button>
                          <button type="button" class="manager-btn preview-close-btn" onclick={closePreviewPane}>
                            <X class="button-icon" size={15} strokeWidth={2} />
                            Close
                          </button>
                        </div>
                      </div>
                      <div class="preview-body">
                        {#if previewLoading}
                          <p class="preview-message">Loading preview…</p>
                        {:else if previewError}
                          <p class="preview-message error">{previewError}</p>
                        {:else if previewKind === 'image' && previewUrl}
                          <img class="preview-image" src={previewUrl} alt={"Preview of " + currentPreviewFile.filename} />
                        {:else if previewKind === 'video' && previewUrl}
                          <!-- svelte-ignore a11y_media_has_caption -->
                          <video class="preview-media" autoplay muted loop playsinline src={previewUrl}></video>
                        {:else if previewKind === 'audio' && previewUrl}
                          <AudioPreview
                            src={previewUrl}
                            title={displayFileName(currentPreviewFile)}
                            mimeType={currentPreviewFile.mimeType}
                          />
                        {:else if previewKind === 'pdf' && previewUrl}
                          <iframe class="preview-pdf" src={previewUrl} title={"PDF preview: " + currentPreviewFile.filename}></iframe>
                        {:else if previewKind === 'text'}
                          <pre class="preview-text">{previewText}</pre>
                        {:else}
                          <p class="preview-message">Preview unavailable. Double-click the file to open it.</p>
                        {/if}
                      </div>
                    {:else}
                      <div class="preview-empty">
                        <p>Select a file to preview.</p>
                      </div>
                    {/if}
                  </section>
                {/if}
              </div>
            {/if}
          </div>
        {/if}

        {#if showSplitWorkspace}
          <button
            type="button"
            class="workspace-divider"
            aria-label="Resize files and chat panes"
            onpointerdown={startWorkspaceResize}
          >
            <span class="workspace-divider-grip">
              <GripVertical size={16} strokeWidth={1.8} />
            </span>
          </button>
        {/if}

        {#if showChatWorkspace}
          <div class="workspace-pane">
            <VolumeChat
              {auth}
              {volumeId}
              readonlyMode={isHistoryMode}
              historyState={isHistoryMode ? historicalChatState : null}
              activeIdentity={joinedChatIdentity}
              identityNeedsPublish={joinedChatIdentityNeedsPublish}
              onOpenIdentityManager={openIdentityManager}
              onEnsureIdentityPublished={async (identity) =>
                (await ensureChatIdentityPublished(identity, {
                  announceSuccess: false,
                  openManagerOnError: false,
                })) !== null}
              onPreviewAttachment={previewChatAttachment}
              onChatMutated={handleChatMutated}
              externalRefreshVersion={chatRefreshVersion}
            />
          </div>
        {/if}
      </div>
      {/if}
      </div>
    {/if}
  </main>

  {#if shouldShowDesktopUpdaterToast(desktopUpdaterState) || sourceDiscoveryToast}
    <div class="toast-stack">
      {#if shouldShowDesktopUpdaterToast(desktopUpdaterState) && desktopUpdaterState}
        <aside class="update-toast panel-surface" role="status" aria-live="polite">
          <div class="update-toast-copy">
            <p class="update-toast-title">{desktopUpdaterState.message}</p>
            <p>{desktopUpdaterState.detail}</p>
          </div>
          {#if desktopUpdaterState.phase === 'downloading'}
            <div class="update-toast-progress" aria-hidden="true">
              <span
                class="update-toast-progress-bar"
                style={`width: ${Math.max(0, Math.min(100, desktopUpdaterState.progressPercent ?? 0))}%`}
              ></span>
            </div>
            <p class="update-toast-meta">{desktopUpdaterProgressSummary(desktopUpdaterState)}</p>
          {/if}
          {#if desktopUpdaterState.phase === 'ready' || desktopUpdaterState.phase === 'error'}
            <div class="update-toast-actions">
              {#if desktopUpdaterState.phase === 'ready'}
                <button type="button" class="update-toast-btn" onclick={handleDesktopUpdaterPrimaryAction}>
                  {#if desktopUpdaterState.canInstall}
                    <RefreshCw class="button-icon" size={15} strokeWidth={2} />
                  {:else}
                    <Download class="button-icon" size={15} strokeWidth={2} />
                  {/if}
                  <span>{desktopUpdaterPrimaryActionLabel(desktopUpdaterState)}</span>
                </button>
              {:else}
                <button type="button" class="update-toast-btn" onclick={openDesktopUpdaterReleasePage}>
                  <Download class="button-icon" size={15} strokeWidth={2} />
                  <span>Open release</span>
                </button>
              {/if}
            </div>
            <button
              type="button"
              class="discovery-toast-close"
              aria-label="Dismiss update notice"
              onclick={() => {
                desktopUpdaterState = null;
              }}
            >
              <X size={15} strokeWidth={2} />
            </button>
          {/if}
        </aside>
      {/if}

      {#if sourceDiscoveryToast}
        <aside class="discovery-toast panel-surface" role="status" aria-live="polite">
          <div class="discovery-toast-copy">
            <p class="discovery-toast-title">Storage locations updated</p>
            <p>{sourceDiscoveryToast.message}</p>
          </div>
          <div class="discovery-toast-actions">
            <button type="button" class="discovery-toast-btn" onclick={openSourceDiscoveryDetails}>
              <Search class="button-icon" size={15} strokeWidth={2} />
              <span>Details</span>
            </button>
            <button type="button" class="discovery-toast-btn" onclick={openSourceDiscoveryDefaults}>
              <Settings2 class="button-icon" size={15} strokeWidth={2} />
              <span>Edit rules</span>
            </button>
          </div>
          <button
            type="button"
            class="discovery-toast-close"
            aria-label="Dismiss discovery notice"
            onclick={() => acknowledgeSourceDiscovery(sourceDiscoveryToast?.runKey ?? '')}
          >
            <X size={15} strokeWidth={2} />
          </button>
        </aside>
      {/if}
    </div>
  {/if}

  {#if timelineDetailOpen}
    <div
      class="tm-details-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Timeline event details"
      onclick={closeTimelineDetails}
    >
      <div class="tm-details-modal panel-surface" onclick={(event) => event.stopPropagation()}>
        <div class="tm-details-header">
          <div class="tm-details-head-meta">
            <p class="tm-details-eyebrow">Timeline details</p>
            <p class="tm-details-title">
              {#if timelineDetailEvent}
                {timelineKindLabel(timelineDetailEvent)} {timelineHeadline(timelineDetailEvent)}
              {:else if timelineDetailPayload}
                {timelineDetailPayload.payload.type} {timelineDetailPayload.payload.fileName}
              {:else}
                Event details
              {/if}
            </p>
            {#if timelineDetailTimestamp !== null}
              <p class="tm-details-subtitle">{formatDate(timelineDetailTimestamp)}</p>
            {/if}
          </div>
          <button
            type="button"
            class="tm-details-close"
            aria-label="Close details"
            onclick={closeTimelineDetails}
          >
            <X size={18} strokeWidth={2} />
          </button>
        </div>
        <div class="tm-details-body">
          {#if timelineDetailLoading}
            <div class="tm-details-loading">
              <span class="loading-spinner"></span>
              <span>Loading event…</span>
            </div>
          {:else if timelineDetailError}
            <p class="tm-details-error">{timelineDetailError}</p>
          {:else if timelineDetailPayload}
            {@const payload = timelineDetailPayload.payload}
            {@const hasEncryptedPayload = payload.type === 'CREATE_FILE'}
            {@const relevantSpecs = specDocsForPayload(payload)}
            <div class="tm-details-meta">
              <span>{payload.type}</span>
              <span>{payload.fileName || '—'}</span>
            </div>
            {#if timelineDetailHash}
              <p class="tm-details-hash">{timelineDetailHash}</p>
              <p class="tm-details-hint">
                Event hash = SHA-256 of the serialized payload bytes (signature not included).
              </p>
            {/if}

            <div class="tm-details-section tm-details-debug-section">
              <p class="tm-details-section-title">Protocol storage</p>
              <p class="tm-details-section-note">
                Expected nearbytes-root paths for this event.
              </p>
              <div class="tm-details-path-shell">
                <div class="tm-details-path-row">
                  <span class="tm-details-label">event file</span>
                  <span class="tm-details-value mono">{timelineExpectedEventPath()}</span>
                </div>
                {#if timelineExpectedBlockPath()}
                  <div class="tm-details-path-row">
                    <span class="tm-details-label">data block</span>
                    <span class="tm-details-value mono">{timelineExpectedBlockPath()}</span>
                  </div>
                {/if}
              </div>

              {#if timelineDetailStorageError}
                <p class="tm-details-error">{timelineDetailStorageError}</p>
              {/if}

              {#if timelineStorageHits().length > 0}
                <div class="tm-details-hit-list">
                  {#each timelineStorageHits() as location}
                    {@const targetPath = timelineStorageLocationPath(location)}
                    <div class="tm-details-hit-row">
                      <div class="tm-details-hit-copy">
                        <p class="tm-details-hit-title">{timelineStorageLocationLabel(location)}</p>
                        <p class="tm-details-hit-meta">{timelineStoragePresenceBadges(location)}</p>
                        <p class="tm-details-hit-path mono">{targetPath}</p>
                      </div>
                      <div class="tm-details-hit-actions">
                        <button
                          type="button"
                          class="tm-details-ref-btn"
                          onclick={() => void revealTimelineStorageLocation(location)}
                          disabled={timelineDetailRevealBusyPath === targetPath}
                        >
                          {timelineDetailRevealBusyPath === targetPath ? 'Opening…' : 'Reveal in folder'}
                        </button>
                      </div>
                    </div>
                  {/each}
                </div>
              {:else}
                <p class="tm-details-section-note">
                  No configured storage location currently reports this event path.
                </p>
              {/if}
            </div>

            <div class="tm-details-section">
              <p class="tm-details-section-title">Summary</p>
              <div class="tm-details-grid">
                <div class="tm-details-grid-row">
                  <span class="tm-details-label">signedBy</span>
                  <div class="tm-details-value-group">
                    <span class="tm-details-value">volume key (hub secret)</span>
                    <span class="tm-details-help">Outer signature proves this event belongs to the hub.</span>
                  </div>
                </div>
                <div class="tm-details-grid-row">
                  <span class="tm-details-label">visibility</span>
                  <div class="tm-details-value-group">
                    <span class="tm-details-value">
                      {hasEncryptedPayload ? 'payload cleartext, file bytes encrypted' : 'payload cleartext, no encrypted file bytes'}
                    </span>
                    <span class="tm-details-help">
                      {hasEncryptedPayload
                        ? 'Decrypt file bytes with encryptedKey + volume key.'
                        : 'App record/message fields are cleartext JSON.'}
                    </span>
                  </div>
                </div>
                {#if timelineDetailAppSignature !== 'unknown'}
                  <div class="tm-details-grid-row">
                    <span class="tm-details-label">appSignature</span>
                    <div class="tm-details-value-group">
                      <span class="tm-details-value">
                        {timelineDetailAppSignature === 'yes' ? 'present' : 'not detected'}
                      </span>
                      <span class="tm-details-help">
                        {timelineDetailAppSignature === 'yes' && timelineDetailAppSignatureSource
                          ? `Detected ${timelineDetailAppSignatureSource}.`
                          : 'Nested app records may include their own signature fields.'}
                      </span>
                    </div>
                  </div>
                {/if}
              </div>
            </div>

            <div class="tm-details-section">
              <p class="tm-details-section-title">Signed envelope</p>
              <p class="tm-details-section-note">
                The signature covers the serialized payload fields below and is verified with the volume public key
                derived from this hub secret.
              </p>
              <div class="tm-details-grid">
                <div class="tm-details-grid-row">
                  <span class="tm-details-label">signature</span>
                  <div class="tm-details-value-group">
                    <span class="tm-details-value mono">{timelineDetailPayload.signature}</span>
                    <span class="tm-details-help">Base64 signature bytes stored alongside the payload.</span>
                  </div>
                </div>
              </div>
            </div>

            <div class="tm-details-section">
              <p class="tm-details-section-title">Encoded event</p>
              <p class="tm-details-section-note">Raw JSON stored for this event (payload + signature).</p>
              <pre class="tm-details-pre">{timelineDetailEncoded}</pre>
            </div>

            <div class="tm-details-section">
              <p class="tm-details-section-title">Payload fields (signed)</p>
              <p class="tm-details-section-note">
                Payload fields are cleartext metadata. File bytes are encrypted separately; record/message fields are
                stored as canonical JSON strings.
              </p>
              <div class="tm-details-grid">
                <div class="tm-details-grid-row">
                  <span class="tm-details-label">type</span>
                  <div class="tm-details-value-group">
                    <span class="tm-details-value">{payload.type}</span>
                    <span class="tm-details-help">Event kind; controls which fields are used.</span>
                  </div>
                </div>
                <div class="tm-details-grid-row">
                  <span class="tm-details-label">fileName</span>
                  <div class="tm-details-value-group">
                    <span class="tm-details-value">{payload.fileName}</span>
                    <span class="tm-details-help">Logical file name in the volume (empty for app/chat events).</span>
                  </div>
                </div>
                {#if payload.toFileName}
                  <div class="tm-details-grid-row">
                    <span class="tm-details-label">toFileName</span>
                    <div class="tm-details-value-group">
                      <span class="tm-details-value">{payload.toFileName}</span>
                      <span class="tm-details-help">Destination name for rename events.</span>
                    </div>
                  </div>
                {/if}
                <div class="tm-details-grid-row">
                  <span class="tm-details-label">hash</span>
                  <div class="tm-details-value-group">
                    <span class="tm-details-value mono">{payload.hash}</span>
                    <span class="tm-details-help">
                      SHA-256 of the encrypted data block. Empty (all zeros) for delete/rename/app events.
                    </span>
                  </div>
                </div>
                <div class="tm-details-grid-row">
                  <span class="tm-details-label">encryptedKey</span>
                  <div class="tm-details-value-group">
                    <span class="tm-details-value mono">{payload.encryptedKey}</span>
                    <span class="tm-details-help">
                      Wrapped file key (encrypted with a key derived from the volume private key). Empty for
                      delete/rename/app events and legacy blocks.
                    </span>
                  </div>
                </div>
                {#if payload.contentType}
                  <div class="tm-details-grid-row">
                    <span class="tm-details-label">contentType</span>
                    <div class="tm-details-value-group">
                      <span class="tm-details-value">{payload.contentType}</span>
                      <span class="tm-details-help">Ciphertext kind: b = block, m = manifest.</span>
                    </div>
                  </div>
                {/if}
                {#if payload.size !== undefined}
                  <div class="tm-details-grid-row">
                    <span class="tm-details-label">size</span>
                    <div class="tm-details-value-group">
                      <span class="tm-details-value">{payload.size}</span>
                      <span class="tm-details-help">Original plaintext size in bytes.</span>
                    </div>
                  </div>
                {/if}
                {#if payload.mimeType}
                  <div class="tm-details-grid-row">
                    <span class="tm-details-label">mimeType</span>
                    <div class="tm-details-value-group">
                      <span class="tm-details-value">{payload.mimeType}</span>
                      <span class="tm-details-help">MIME type hint from the uploader.</span>
                    </div>
                  </div>
                {/if}
                {#if payload.createdAt !== undefined}
                  <div class="tm-details-grid-row">
                    <span class="tm-details-label">createdAt</span>
                    <div class="tm-details-value-group">
                      <span class="tm-details-value">{formatDate(payload.createdAt)}</span>
                      <span class="tm-details-help">Client timestamp when the file was created.</span>
                    </div>
                  </div>
                {/if}
                {#if payload.deletedAt !== undefined}
                  <div class="tm-details-grid-row">
                    <span class="tm-details-label">deletedAt</span>
                    <div class="tm-details-value-group">
                      <span class="tm-details-value">{formatDate(payload.deletedAt)}</span>
                      <span class="tm-details-help">Client timestamp when the delete was authored.</span>
                    </div>
                  </div>
                {/if}
                {#if payload.renamedAt !== undefined}
                  <div class="tm-details-grid-row">
                    <span class="tm-details-label">renamedAt</span>
                    <div class="tm-details-value-group">
                      <span class="tm-details-value">{formatDate(payload.renamedAt)}</span>
                      <span class="tm-details-help">Client timestamp when the rename was authored.</span>
                    </div>
                  </div>
                {/if}
                {#if payload.authorPublicKey}
                  <div class="tm-details-grid-row">
                    <span class="tm-details-label">authorPublicKey</span>
                    <div class="tm-details-value-group">
                      <span class="tm-details-value mono">{payload.authorPublicKey}</span>
                      <span class="tm-details-help">
                        Author identity key for app/identity/chat payloads (not the volume key).
                      </span>
                    </div>
                  </div>
                {/if}
                {#if payload.protocol}
                  <div class="tm-details-grid-row">
                    <span class="tm-details-label">protocol</span>
                    <div class="tm-details-value-group">
                      <span class="tm-details-value">{payload.protocol}</span>
                      <span class="tm-details-help">Protocol id for APP_RECORD (should match the record p field).</span>
                    </div>
                  </div>
                {/if}
                {#if payload.publishedAt !== undefined}
                  <div class="tm-details-grid-row">
                    <span class="tm-details-label">publishedAt</span>
                    <div class="tm-details-value-group">
                      <span class="tm-details-value">{formatDate(payload.publishedAt)}</span>
                      <span class="tm-details-help">Client timestamp when the app record/message was published.</span>
                    </div>
                  </div>
                {/if}
              </div>
            </div>

            {#if hasEncryptedPayload}
              <div class="tm-details-section">
                <p class="tm-details-section-title">Encrypted file payload</p>
                <p class="tm-details-section-note">
                  Ciphertext is stored as a block addressed by the hash above. Use the hub secret to decrypt; this
                  panel can open a decrypted preview when available.
                </p>
                <div class="tm-details-action-row">
                  <button
                    type="button"
                    class="tm-details-ref-btn"
                    onclick={() => openEventPayloadPreview(payload)}
                    disabled={!auth}
                  >
                    Open decrypted preview
                  </button>
                </div>
              </div>
            {/if}

            {#if timelineDetailRecord || timelineDetailRecordError}
              <div class="tm-details-section">
                <p class="tm-details-section-title">App record</p>
                <p class="tm-details-section-note">
                  Cleartext canonical JSON string embedded in the signed payload. Not encrypted; any app-level
                  signature lives inside the record (for example a sig field).
                </p>
                {#if timelineDetailRecordError}
                  <p class="tm-details-error">Record parse error: {timelineDetailRecordError}</p>
                {/if}
                {#if timelineDetailRecord}
                  <pre class="tm-details-pre">{timelineDetailRecord}</pre>
                {/if}
              </div>
            {/if}

            {#if timelineDetailMessage || timelineDetailMessageError}
              <div class="tm-details-section">
                <p class="tm-details-section-title">App message</p>
                <p class="tm-details-section-note">
                  Cleartext canonical JSON string embedded in the signed payload. Not encrypted; chat protocols often
                  include their own sig field.
                </p>
                {#if timelineDetailMessageError}
                  <p class="tm-details-error">Message parse error: {timelineDetailMessageError}</p>
                {/if}
                {#if timelineDetailMessage}
                  <pre class="tm-details-pre">{timelineDetailMessage}</pre>
                {/if}
              </div>
            {/if}

            {#if relevantSpecs.length > 0}
              <div class="tm-details-section">
                <p class="tm-details-section-title">Specs</p>
                <p class="tm-details-section-note">Bundled protocol specs relevant to this event.</p>
                <div class="tm-details-spec-list">
                  {#each relevantSpecs as spec}
                    <div class="tm-details-spec-card">
                      <div class="tm-details-spec-copy">
                        <p class="tm-details-spec-title">{spec.title}</p>
                        <p class="tm-details-spec-meta">{spec.summary}</p>
                        <p class="tm-details-spec-file mono">{spec.filename}</p>
                      </div>
                      <div class="tm-details-spec-actions">
                        <button type="button" class="tm-details-ref-btn" onclick={() => openSpecDoc(spec)}>
                          View
                        </button>
                      </div>
                    </div>
                  {/each}
                </div>
              </div>
            {/if}

            {#if timelineDetailReferences.length > 0}
              <div class="tm-details-section">
                <p class="tm-details-section-title">References</p>
                <div class="tm-details-ref-list">
                  {#each timelineDetailReferences as reference}
                    <div class="tm-details-ref-row">
                      <div class="tm-details-ref-copy">
                        <p class="tm-details-ref-name">
                          {reference.name ?? (reference.kind === 'source' ? 'Source reference' : 'Recipient reference')}
                        </p>
                        {#if reference.kind === 'source'}
                          <p class="tm-details-ref-meta mono">{(reference.ref as SourceFileReference).s}</p>
                        {:else}
                          <p class="tm-details-ref-meta mono">
                            {(reference.ref as RecipientFileReference).k.r}
                          </p>
                        {/if}
                        <p class="tm-details-ref-hash mono">{reference.ref.c.h}</p>
                        <p class="tm-details-ref-meta">
                          {reference.ref.c.t} • {reference.ref.c.z} bytes
                        </p>
                      </div>
                      <div class="tm-details-ref-actions">
                        {#if reference.kind === 'source'}
                          <button
                            type="button"
                            class="tm-details-ref-btn"
                            onclick={() => previewSourceReference(reference)}
                          >
                            Preview
                          </button>
                        {:else}
                          <button type="button" class="tm-details-ref-btn" disabled>
                            Recipient
                          </button>
                        {/if}
                      </div>
                    </div>
                  {/each}
                </div>
              </div>
            {/if}

            {#if timelineDetailEventRefs.length > 0}
              <div class="tm-details-section">
                <p class="tm-details-section-title">Event references</p>
                <div class="tm-details-ref-list">
                  {#each timelineDetailEventRefs as eventHash}
                    <button
                      type="button"
                      class="tm-details-ref-btn link"
                      onclick={() => openTimelineDetailsByHash(eventHash)}
                    >
                      {eventHash}
                    </button>
                  {/each}
                </div>
              </div>
            {/if}
          {:else}
            <p class="tm-details-empty">No event payload available.</p>
          {/if}
        </div>
      </div>
    </div>
  {/if}

  {#if specModalOpen && specModalDoc}
    <div
      class="tm-details-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Spec details"
      onclick={closeSpecDoc}
    >
      <div class="tm-spec-modal panel-surface" onclick={(event) => event.stopPropagation()}>
        <div class="tm-spec-header">
          <div class="tm-spec-head-meta">
            <p class="tm-spec-title">{specModalDoc.title}</p>
            <p class="tm-spec-subtitle mono">{specModalDoc.filename}</p>
          </div>
          <button type="button" class="tm-details-close" aria-label="Close spec" onclick={closeSpecDoc}>
            <X size={18} strokeWidth={2} />
          </button>
        </div>
        <div class="tm-spec-body">
          <pre class="tm-details-pre">{specModalContent}</pre>
        </div>
      </div>
    </div>
  {/if}

  {#if mountDialogMount}
    <div
      class="mount-dialog-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={isMountEmpty(mountDialogMount) ? 'Create hub' : 'Edit hub properties'}
      tabindex="-1"
      onclick={(event) => {
        if (event.target === event.currentTarget) {
          collapseMount(mountDialogMount.id);
        }
      }}
      onkeydown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          collapseMount(mountDialogMount.id);
        }
      }}
    >
      <div class="mount-dialog panel-surface" role="document" tabindex="-1" data-mount-id={mountDialogMount.id}>
        <div class="mount-dialog-header">
          <div class="mount-dialog-head-meta">
            <p class="mount-dialog-eyebrow">Hub properties</p>
            <p class="mount-dialog-title">{isMountEmpty(mountDialogMount) ? 'Create or open a hub' : 'Edit this hub'}</p>
            <p class="mount-dialog-subtitle">
              {#if mountDialogMode === 'join-link' && isMountEmpty(mountDialogMount)}
                Paste a nearbytes://join link or canonical join JSON. Nearbytes will preview the hub first, then stage attached live storage when you join.
              {:else}
                Set the secret or attach one secret file.
              {/if}
            </p>
            {#if isMountEmpty(mountDialogMount)}
              <div class="mount-dialog-mode-switch" role="tablist" aria-label="Create hub mode">
                <button
                  type="button"
                  class="mount-dialog-mode-btn"
                  class:active={mountDialogMode === 'secret'}
                  aria-pressed={mountDialogMode === 'secret'}
                  onclick={() => setMountDialogMode('secret')}
                >
                  <Plus size={14} strokeWidth={2.2} />
                  <span>Secret</span>
                </button>
                <button
                  type="button"
                  class="mount-dialog-mode-btn"
                  class:active={mountDialogMode === 'join-link'}
                  aria-pressed={mountDialogMode === 'join-link'}
                  onclick={() => setMountDialogMode('join-link')}
                >
                  <ClipboardPaste size={14} strokeWidth={2} />
                  <span>Paste link</span>
                </button>
              </div>
            {/if}
          </div>
          <button type="button" class="tm-details-close" aria-label="Close hub properties" onclick={() => collapseMount(mountDialogMount.id)}>
            <X size={18} strokeWidth={2} />
          </button>
        </div>

        <div class="mount-dialog-body">
          {#if mountDialogMode === 'join-link' && isMountEmpty(mountDialogMount)}
            <section class="mount-dialog-section join-dialog-input-shell">
              <div class="join-dialog-input-head">
                <div>
                  <p class="join-dialog-section-title">Join link</p>
                  <p class="join-dialog-note">Copy the share link, then paste it here or press Paste from clipboard.</p>
                </div>
                <button
                  type="button"
                  class="status-link-btn secondary"
                  onclick={() => void readJoinDialogClipboard()}
                  disabled={joinDialogClipboardBusy || joinDialogPreviewBusy || joinDialogOpenBusy}
                >
                  <ClipboardPaste class="button-icon" size={15} strokeWidth={2} />
                  <span>{joinDialogClipboardBusy ? 'Reading…' : 'Paste from clipboard'}</span>
                </button>
              </div>

              <textarea
                class="join-dialog-textarea"
                bind:value={joinDialogSerialized}
                spellcheck="false"
                placeholder="nearbytes://join?data=..."
              ></textarea>

              <div class="join-dialog-actions">
                <button
                  type="button"
                  class="status-link-btn"
                  onclick={() => void openJoinDialogLink()}
                  disabled={joinDialogOpenBusy || joinDialogPreviewBusy || joinDialogClipboardBusy}
                >
                  <span>{joinDialogOpenBusy ? 'Opening…' : 'Open shared hub'}</span>
                </button>
              </div>

              {#if joinDialogError}
                <p class="join-dialog-message error">{joinDialogError}</p>
              {/if}
            </section>

            {#if joinDialogPreview}
              <section class="mount-dialog-section">
                <div class="join-dialog-preview-head">
                  <span class="join-dialog-chip strong">{joinDialogSpaceSummary(joinDialogPreview.space)}</span>
                  <span class="join-dialog-chip">{joinDialogPreview.plan.attachments.length} storage route{joinDialogPreview.plan.attachments.length === 1 ? '' : 's'}</span>
                </div>

                {#if joinDialogPreview.plan.attachments.length === 0}
                  <p class="join-dialog-note">This link tells Nearbytes which hub to join, but it does not include any extra shared storage routes.</p>
                {:else}
                  <div class="join-dialog-route-list">
                    {#each joinDialogPreview.plan.attachments as attachment}
                      <article class="join-dialog-route-card">
                        <div class="join-dialog-route-head">
                          <div>
                            <p class="join-dialog-route-title">{joinDialogAttachmentTitle(attachment)}</p>
                            <p class="join-dialog-route-detail">
                              {attachment.selectedEndpoint?.reason ?? 'No supported route is available for this storage yet.'}
                            </p>
                          </div>
                          {#if attachment.selectedEndpoint}
                            <span class="join-dialog-chip strong">{joinDialogEndpointLabel(attachment.selectedEndpoint)}</span>
                          {:else}
                            <span class="join-dialog-chip warning">Unavailable</span>
                          {/if}
                        </div>
                      </article>
                    {/each}
                  </div>
                {/if}
              </section>
            {/if}

            <section class="mount-dialog-section">
              <div class="mount-dialog-actions">
                <button
                  type="button"
                  class="workspace-toggle"
                  onclick={() => setMountDialogMode('secret')}
                >
                  <span>Use secret instead</span>
                </button>
                <button
                  type="button"
                  class="workspace-toggle"
                  onclick={() => collapseMount(mountDialogMount.id)}
                >
                  <span>Cancel</span>
                </button>
              </div>
            </section>
          {:else}
          {#if mountDialogMount.id === activeMountId && (volumeId || errorMessage || isOffline)}
            <section class="mount-dialog-section mount-dialog-status-section">
              <div class="mount-dialog-status-grid">
                {#if volumeId}
                  <div class="status-item mount-dialog-status-item">
                    <span class="status-label">Hub ID</span>
                    <button class="volume-id-btn" onclick={copyVolumeId} title="Copy hub ID">
                      {volumeId.slice(0, 16)}...
                      {#if copiedVolumeId}
                        <span class="copied-indicator">✓ Copied</span>
                      {/if}
                    </button>
                  </div>
                {/if}
                {#if lastRefresh}
                  <div class="status-item mount-dialog-status-item">
                    <span class="status-label">Last refresh</span>
                    <span class="status-value">{formatDate(lastRefresh)}</span>
                  </div>
                {/if}
                {#if volumeId}
                  <div class="status-item mount-dialog-status-item">
                    <span class="status-label">Sync</span>
                    <span class="status-value">
                      {#if autoSyncStatus === 'connecting'}
                        Connecting…
                      {:else if autoSyncEnabled}
                        Auto
                      {:else if autoSyncStatus === 'unsupported'}
                        Manual
                      {:else if autoSyncStatus === 'error'}
                        Manual (watch offline)
                      {:else}
                        Manual
                      {/if}
                    </span>
                  </div>
                {/if}
                {#if isHistoryMode}
                  <div class="status-item mount-dialog-status-item history-indicator">
                    <span>History mode (read-only)</span>
                  </div>
                {/if}
                {#if isOffline}
                  <div class="status-item mount-dialog-status-item offline-indicator">
                    <span>Offline (cached)</span>
                  </div>
                {/if}
                {#if errorMessage}
                  <div class="status-item mount-dialog-status-item error-indicator mount-dialog-status-error">
                    <span>{errorMessage}</span>
                  </div>
                {/if}
              </div>
              {#if volumeId && !isLoading && !autoSyncEnabled}
                <div class="mount-dialog-status-actions">
                  <button class="refresh-btn" onclick={refreshFiles} title="Refresh file list">
                    <RefreshCw class="button-icon" size={15} strokeWidth={2} />
                    <span>Refresh</span>
                  </button>
                </div>
              {/if}
            </section>
          {/if}

          {@const secretHash = hasFileSecret(mountDialogMount) ? secretFileHashForMount(mountDialogMount) : null}
          <section class="mount-dialog-section">
            <div class="secret-input-wrapper mount-dialog-inputs">
              <SharedSecretEditor
                dense={true}
                value={mountDialogMount.address}
                password={mountDialogMount.password}
                valueLabel="Hub secret"
                valueAriaLabel="Hub address"
                valuePlaceholder="address or secret seed"
                passwordLabel="Password (optional)"
                passwordAriaLabel="Optional hub password"
                passwordPlaceholder="optional"
                hint="Drop an image/file here, or press Cmd/Ctrl + V."
                showPasteButton={clipboardImageAvailable || clipboardImageLoading}
                pasteButtonLabel="Paste image"
                pasteButtonBusy={clipboardImageLoading}
                fileName={mountDialogMount.secretFileName}
                fileMimeType={mountDialogMount.secretFileMimeType}
                filePreviewUrl={secretFilePayloadDataUrl(mountDialogMount)}
                fileIsImage={hasImageSecretPreview(mountDialogMount)}
                fileInfo={secretFileBytes(mountDialogMount) ? formatSize(secretFileBytes(mountDialogMount)?.byteLength ?? 0) : ''}
                fileHashLabel={hasFileSecret(mountDialogMount) ? 'SHA-256' : ''}
                fileHashValue={secretHash?.hash ?? ''}
                fileHashPending={secretHash?.pending ?? false}
                showDownloadButton={hasFileSecret(mountDialogMount)}
                onValueInput={(value) => updateMountAddress(mountDialogMount.id, value)}
                onPasswordInput={(value) => updateMountPassword(mountDialogMount.id, value)}
                onFileSelected={handleMountDialogSecretSelected}
                onPasteButton={() => handlePasteImageButton(mountDialogMount.id)}
                onDownloadFile={() => downloadSecretFile(mountDialogMount)}
              />
              {#if isLoading && mountDialogMount.id === activeMountId}
                <span class="loading-spinner"></span>
              {/if}
            </div>
          </section>

          <section class="mount-dialog-section">
            <div class="mount-dialog-actions">
              <ArmedActionButton
                class="panel-action-btn danger"
                text="Remove"
                icon={Trash2}
                armed={true}
                armDelayMs={0}
                autoDisarmMs={3000}
                resetKey={mountDialogMount.id}
                onPress={() => removeMount(mountDialogMount.id)}
                title="Remove hub"
                ariaLabel="Remove hub"
              />
              <HubStorageButton
                active={showVolumeStoragePanel}
                badge="Hub"
                label="Storage locations"
                onclick={() => {
                  openVolumeStoragePanel();
                  collapseMount(mountDialogMount.id);
                }}
              />
              <button
                type="button"
                class="workspace-toggle"
                onclick={() => collapseMount(mountDialogMount.id)}
              >
                <span>Done</span>
              </button>
            </div>
          </section>
          {/if}
        </div>
      </div>
    </div>
  {/if}

  {#if showCreateChooser}
    <div
      class="mount-dialog-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Create"
      tabindex="-1"
      onclick={(event) => {
        if (event.target === event.currentTarget) {
          closeCreateChooser();
        }
      }}
      onkeydown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          closeCreateChooser();
        }
      }}
    >
      <div class="create-chooser-modal panel-surface" role="document" tabindex="-1">
        <div class="create-chooser-head">
          <div>
            <p class="mount-dialog-eyebrow">Create</p>
            <p class="mount-dialog-title">What do you want to make?</p>
            <p class="mount-dialog-subtitle">Hubs hold app logs and files. Identities are your local signing personas.</p>
          </div>
          <button type="button" class="tm-details-close" aria-label="Close create chooser" onclick={closeCreateChooser}>
            <X size={18} strokeWidth={2} />
          </button>
        </div>
        <div class="create-chooser-grid">
          <button type="button" class="create-chooser-card" onclick={startCreateHub}>
            <Plus size={18} strokeWidth={2.2} />
            <span class="create-chooser-card-title">Hub</span>
            <span class="create-chooser-card-copy">Create or open a hub from a secret.</span>
          </button>
          <button type="button" class="create-chooser-card" onclick={startCreateIdentity}>
            <UserRound size={18} strokeWidth={2} />
            <span class="create-chooser-card-title">Identity</span>
            <span class="create-chooser-card-copy">Create a local identity with the same secret model.</span>
          </button>
          <button type="button" class="create-chooser-card" onclick={() => void openJoinVolumeDialogFromClipboard()}>
            <ClipboardPaste size={18} strokeWidth={2} />
            <span class="create-chooser-card-title">Paste link</span>
            <span class="create-chooser-card-copy">Join a shared hub from a Nearbytes link.</span>
          </button>
        </div>
      </div>
    </div>
  {/if}

  {#if showIdentityManager}
    <div
      class="mount-dialog-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Manage identities"
      tabindex="-1"
      onclick={(event) => {
        if (event.target === event.currentTarget) {
          closeIdentityManager();
        }
      }}
      onkeydown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          closeIdentityManager();
        }
      }}
    >
      <div class="identity-manager-modal panel-surface" role="document" tabindex="-1">
        <div class="identity-row identity-manager-panel">
          <div class="identity-row-head">
            <div class="identity-row-title">
              <UserRound class="button-icon" size={15} strokeWidth={2} />
              <span>Identities</span>
            </div>
            <div class="identity-row-actions">
              <button
                type="button"
                class="workspace-toggle"
                onclick={() => void joinCurrentVolumeChat()}
                disabled={!auth || isHistoryMode || identityManagerLoading || !selectedChatIdentity}
                title={
                  !auth
                    ? 'Open a hub before joining'
                    : isHistoryMode
                      ? 'Jump to Latest before joining'
                      : ''
                }
              >
                <MessageSquareText class="button-icon" size={15} strokeWidth={2} />
                <span>
                  {identityManagerLoading
                    ? 'Joining…'
                    : selectedChatIdentity && selectedChatIdentity.id === currentVolumeChatIdentityId
                      ? 'Joined'
                      : 'Join this hub'}
                </span>
              </button>
              <button
                type="button"
                class="workspace-toggle"
                onclick={() => void publishSelectedChatIdentity()}
                disabled={!auth || isHistoryMode || identityManagerLoading || !selectedChatIdentity}
                title={
                  !auth
                    ? 'Open a hub before publishing'
                    : isHistoryMode
                      ? 'Jump to Latest before publishing'
                      : ''
                }
              >
                <MessageSquareText class="button-icon" size={15} strokeWidth={2} />
                <span>
                  {identityManagerLoading
                    ? 'Publishing…'
                    : selectedChatIdentityNeedsPublish
                      ? 'Publish identity'
                      : 'Published'}
                </span>
              </button>
              <button type="button" class="tm-details-close" aria-label="Close identities" onclick={closeIdentityManager}>
                <X size={18} strokeWidth={2} />
              </button>
            </div>
          </div>

          <div class="identity-chip-row">
            {#if configuredIdentities.length === 0}
              <button type="button" class="identity-pill add" onclick={addConfiguredChatIdentity}>
                <Plus size={14} strokeWidth={2} />
                <span>Add identity</span>
              </button>
            {:else}
              {#each configuredIdentities as identity (identity.id)}
                <button
                  type="button"
                  class="identity-pill"
                  class:active={identity.id === activeChatIdentityId}
                  onclick={() => {
                    activeChatIdentityId = identity.id;
                    identityManagerError = '';
                    identityManagerMessage = '';
                  }}
                >
                  <span class="identity-pill-name">{identity.displayName || 'Unnamed identity'}</span>
                  <span class="identity-pill-state">
                    {#if identity.id === currentVolumeChatIdentityId && joinedChatIdentityNeedsPublish}
                      Joined · update pending
                    {:else if identity.id === currentVolumeChatIdentityId}
                      Joined
                    {:else if identity.id === activeChatIdentityId && selectedChatIdentityNeedsPublish}
                      Needs publish
                    {:else if identity.publicKey}
                      Published
                    {:else}
                      Local
                    {/if}
                  </span>
                </button>
              {/each}
              <button type="button" class="identity-pill add" onclick={addConfiguredChatIdentity}>
                <Plus size={14} strokeWidth={2} />
                <span>New</span>
              </button>
            {/if}
          </div>

          <p class="identity-row-note">
            {#if activeMount}
              This hub will chat as <strong>{joinedChatIdentity?.displayName || 'no identity yet'}</strong>. Joining is an explicit per-hub local choice.
            {:else}
              Identities are global to this app. Joining remains an explicit local choice per hub.
            {/if}
          </p>
          <p class="identity-row-note">
            Publish writes the signed public profile into the identity channel and syncs the latest snapshot into the current hub.
          </p>

          {#if identityManagerError}
            <p class="identity-row-banner error">{identityManagerError}</p>
          {:else if identityManagerMessage}
            <p class="identity-row-banner success">{identityManagerMessage}</p>
          {/if}

          {#if selectedChatIdentity}
            <div class="identity-editor-panel">
              <div class="identity-editor-panel-wide">
                <SharedSecretEditor
                  value={selectedChatIdentity.address}
                  password={selectedChatIdentity.password}
                  valueLabel="Identity secret"
                  valueAriaLabel="Identity secret"
                  valuePlaceholder="address or secret seed"
                  passwordLabel="Password (optional)"
                  passwordAriaLabel="Optional identity password"
                  passwordPlaceholder="optional"
                  hint="Use text, or attach a file to act as this identity secret."
                  fileName={selectedChatIdentity.secretFileName}
                  fileMimeType={selectedChatIdentity.secretFileMimeType}
                  filePreviewUrl={configuredIdentitySecretDataUrl(selectedChatIdentity)}
                  fileIsImage={configuredIdentityHasImageSecret(selectedChatIdentity)}
                  onValueInput={(value) => updateConfiguredChatIdentitySecretText(selectedChatIdentity.id, 'address', value)}
                  onPasswordInput={(value) => updateConfiguredChatIdentitySecretText(selectedChatIdentity.id, 'password', value)}
                  onFileSelected={handleSelectedIdentitySecretSelected}
                  onClearFile={() => clearConfiguredChatIdentitySecretFile(selectedChatIdentity.id)}
                />
              </div>
              <label class="identity-editor-panel-wide">
                <span>Picture</span>
                <div class="identity-avatar-row">
                  <div class="identity-avatar-preview">
                    {#if selectedChatIdentity.avatarDataUrl}
                      <img
                        class="identity-avatar-image"
                        src={selectedChatIdentity.avatarDataUrl}
                        alt={selectedChatIdentity.displayName || 'Identity avatar'}
                      />
                    {:else}
                      <span>{configuredIdentityAvatarLabel(selectedChatIdentity)}</span>
                    {/if}
                  </div>
                  <div class="identity-avatar-actions">
                    <input
                      bind:this={identityAvatarFileInput}
                      hidden
                      type="file"
                      accept="image/*"
                      aria-label="Choose identity picture"
                      onchange={(event) => void handleIdentityAvatarFileChange(event, selectedChatIdentity.id)}
                    />
                    <button type="button" class="workspace-toggle" onclick={() => identityAvatarFileInput?.click()}>
                      <span>{selectedChatIdentity.avatarDataUrl ? 'Change picture' : 'Choose picture'}</span>
                    </button>
                    {#if selectedChatIdentity.avatarDataUrl}
                      <button
                        type="button"
                        class="workspace-toggle remove"
                        onclick={() => clearConfiguredChatIdentityAvatar(selectedChatIdentity.id)}
                      >
                        <span>Remove picture</span>
                      </button>
                    {/if}
                  </div>
                </div>
              </label>
              <label>
                <span>Display name</span>
                <input
                  type="text"
                  value={selectedChatIdentity.displayName}
                  oninput={(event) =>
                    updateConfiguredChatIdentity(selectedChatIdentity.id, {
                      displayName: (event.currentTarget as HTMLInputElement).value,
                    })}
                  placeholder="Ada"
                />
              </label>
              <label class="identity-editor-panel-wide">
                <span>Bio</span>
                <textarea
                  rows="2"
                  oninput={(event) =>
                    updateConfiguredChatIdentity(selectedChatIdentity.id, {
                      bio: (event.currentTarget as HTMLTextAreaElement).value,
                    })}
                  placeholder="Who is speaking from this key?"
                >{selectedChatIdentity.bio}</textarea>
              </label>
              <div class="identity-editor-panel-actions">
                <button
                  type="button"
                  class="workspace-toggle remove"
                  onclick={() => removeConfiguredChatIdentity(selectedChatIdentity.id)}
                >
                  <Trash2 class="button-icon" size={15} strokeWidth={2} />
                  <span>Remove</span>
                </button>
                <button
                  type="button"
                  class="workspace-toggle"
                  onclick={() => void publishSelectedChatIdentity()}
                  disabled={!auth || isHistoryMode || identityManagerLoading}
                >
                  <MessageSquareText class="button-icon" size={15} strokeWidth={2} />
                  <span>
                    {identityManagerLoading
                      ? 'Publishing…'
                      : selectedChatIdentityNeedsPublish
                        ? 'Publish to hub'
                        : 'Published'}
                  </span>
                </button>
              </div>
            </div>
          {/if}
        </div>
      </div>
    </div>
  {/if}

  {#if showVolumeShareDialog}
    <div
      class="share-dialog-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Share this hub"
      tabindex="-1"
      onclick={(event) => {
        if (event.target === event.currentTarget) {
          closeVolumeShareDialog();
        }
      }}
      onkeydown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          closeVolumeShareDialog();
        }
      }}
    >
      <div class="share-dialog panel-surface" role="document" tabindex="-1">
        <div class="share-dialog-header">
          <div class="share-dialog-head-meta">
            <p class="share-dialog-eyebrow">Shared hub</p>
            <p class="share-dialog-title">Share this hub</p>
            <p class="share-dialog-subtitle">Share the hub itself here. Configure shared storage separately in storage settings.</p>
          </div>
          <button type="button" class="tm-details-close" aria-label="Close share dialog" onclick={closeVolumeShareDialog}>
            <X size={18} strokeWidth={2} />
          </button>
        </div>

        <div class="share-dialog-body">
          <section class="share-dialog-section">
            <ShareSpaceLinkSection
              canCopySecretLink={hasCopyableCurrentSecret()}
              shareLinkBusy={joinLinkCopyBusy}
              shareLinkFeedback={volumeSharingFeedback}
              onCopyShareLink={copyCurrentJoinLink}
              onManageStorage={openVolumeShareStoragePanel}
              showManageStorage={true}
            />
          </section>
        </div>
      </div>
    </div>
  {/if}

  {#if showJoinVolumeDialog}
    <div
      class="join-dialog-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Join a shared volume"
      tabindex="-1"
      onclick={(event) => {
        if (event.target === event.currentTarget) {
          closeJoinVolumeDialog();
        }
      }}
      onkeydown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          closeJoinVolumeDialog();
        }
      }}
    >
      <div class="join-dialog panel-surface" role="document" tabindex="-1">
        <div class="join-dialog-header">
          <div class="join-dialog-head-meta">
            <p class="join-dialog-eyebrow">Join shared hub</p>
            <p class="join-dialog-title">Open from clipboard</p>
            <p class="join-dialog-subtitle">Paste a nearbytes://join link or canonical join JSON. Nearbytes will preview the hub first, then stage any attached live storage when you join.</p>
          </div>
          <button type="button" class="tm-details-close" aria-label="Close join dialog" onclick={closeJoinVolumeDialog}>
            <X size={18} strokeWidth={2} />
          </button>
        </div>

        <div class="join-dialog-body">
          <section class="join-dialog-section join-dialog-input-shell">
            <div class="join-dialog-input-head">
              <div>
                <p class="join-dialog-section-title">Join link</p>
                <p class="join-dialog-note">Copy the share link, then paste it here or press Paste from clipboard.</p>
              </div>
              <button
                type="button"
                class="status-link-btn secondary"
                onclick={() => void readJoinDialogClipboard()}
                disabled={joinDialogClipboardBusy || joinDialogPreviewBusy || joinDialogOpenBusy}
              >
                <ClipboardPaste class="button-icon" size={15} strokeWidth={2} />
                <span>{joinDialogClipboardBusy ? 'Reading…' : 'Paste from clipboard'}</span>
              </button>
            </div>

            <textarea
              class="join-dialog-textarea"
              bind:value={joinDialogSerialized}
              spellcheck="false"
              placeholder="nearbytes://join?data=..."
            ></textarea>

            <div class="join-dialog-actions">
              <button
                type="button"
                class="status-link-btn"
                onclick={() => void openJoinDialogLink()}
                disabled={joinDialogOpenBusy || joinDialogPreviewBusy || joinDialogClipboardBusy}
              >
                <span>{joinDialogOpenBusy ? 'Opening…' : 'Open shared hub'}</span>
              </button>
            </div>

            {#if joinDialogError}
              <p class="join-dialog-message error">{joinDialogError}</p>
            {/if}
          </section>

          {#if joinDialogPreview}
            <section class="join-dialog-section">
              <div class="join-dialog-preview-head">
                <span class="join-dialog-chip strong">{joinDialogSpaceSummary(joinDialogPreview.space)}</span>
                <span class="join-dialog-chip">{joinDialogPreview.plan.attachments.length} storage route{joinDialogPreview.plan.attachments.length === 1 ? '' : 's'}</span>
              </div>

              {#if joinDialogPreview.plan.attachments.length === 0}
                <p class="join-dialog-note">This link tells Nearbytes which hub to join, but it does not include any extra shared storage routes.</p>
              {:else}
                <div class="join-dialog-route-list">
                  {#each joinDialogPreview.plan.attachments as attachment (attachment.attachment.id)}
                    <article class="join-dialog-route-card">
                      <div class="join-dialog-route-head">
                        <div>
                          <p class="join-dialog-route-title">{joinDialogAttachmentTitle(attachment)}</p>
                          <p class="join-dialog-route-detail">
                            {attachment.selectedEndpoint?.reason || 'No supported route is available in this build.'}
                          </p>
                        </div>
                        {#if attachment.selectedEndpoint}
                          <span class="join-dialog-chip strong">{joinDialogEndpointLabel(attachment.selectedEndpoint)}</span>
                        {:else}
                          <span class="join-dialog-chip warning">Unavailable</span>
                        {/if}
                      </div>
                    </article>
                  {/each}
                </div>
              {/if}
            </section>
          {/if}

          {#if joinDialogOpened}
            <section class="join-dialog-section">
              <div class="join-dialog-result-head">
                <p class="join-dialog-section-title">Join result</p>
                {#if joinDialogOpened.secret === null}
                  <span class="join-dialog-chip warning">No secret included</span>
                {/if}
              </div>
              {#if joinDialogOpened.secret === null}
                <p class="join-dialog-note">Nearbytes staged the shared storage, but this link does not contain the hub secret. You still need the secret to open the hub contents.</p>
              {/if}
              <div class="join-dialog-result-list">
                {#each joinDialogOpened.actions as action (`${action.attachmentId}-${action.provider || action.endpointTransport || 'route'}`)}
                  <div class={`join-dialog-result-row ${joinDialogActionTone(action.status)}`}>
                    <div>
                      <p class="join-dialog-route-title">{joinDialogActionTitle(action)}</p>
                      <p class="join-dialog-route-detail">{action.detail}</p>
                      {#if action.suggestedLocalPath}
                        <p class="join-dialog-path">Nearbytes will mirror it in: {action.suggestedLocalPath}</p>
                      {/if}
                    </div>
                    <span class="join-dialog-chip strong">{joinDialogActionStatusLabel(action)}</span>
                  </div>
                {/each}
              </div>
            </section>
          {/if}
        </div>
      </div>
    </div>
  {/if}

  {#if isDevThemeStudio && showThemeDialog}
    <div
      class="theme-dialog-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Appearance settings"
      tabindex="-1"
      onclick={(event) => {
        if (event.target === event.currentTarget) {
          showThemeDialog = false;
        }
      }}
      onkeydown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          showThemeDialog = false;
        }
      }}
    >
      <div class="theme-dialog panel-surface" role="document" tabindex="-1">
        <div class="theme-dialog-header">
          <div class="theme-dialog-head-meta">
            <p class="theme-dialog-eyebrow">Appearance</p>
            <p class="theme-dialog-title">Brand system</p>
            <p class="theme-dialog-subtitle">The animated logo, shell palette, and accent treatment stay in sync. Changes apply live and persist across launches.</p>
          </div>
          <button type="button" class="tm-details-close" aria-label="Close appearance dialog" onclick={() => (showThemeDialog = false)}>
            <X size={18} strokeWidth={2} />
          </button>
        </div>

        <div class="theme-dialog-body">
          <section class="theme-dialog-section theme-dialog-hero">
            <div class="theme-dialog-preview-mark">
              <NearbytesLogo bind:this={themeDialogLogoPreview} size={132} options={themeSettings.logo} ariaLabel="Current Nearbytes logo preview" />
            </div>
            <div class="theme-dialog-preview-copy">
              <p class="theme-dialog-section-title">{activeThemePreset().palette.label}</p>
              <p class="theme-dialog-note">{activeThemePreset().palette.description}</p>
              <div class="theme-dialog-chip-row">
                <span class="theme-studio-chip strong">Accent {themeSettings.palette.accent}</span>
                <span class="theme-studio-chip">{themeSettings.logo.arcStyle}</span>
                <span class="theme-studio-chip">{themeSettings.logo.peers} peers</span>
              </div>
            </div>
          </section>

          <section class="theme-dialog-section">
            <div class="theme-dialog-tab-row" role="tablist" aria-label="Appearance sections">
              <button type="button" class="theme-dialog-tab" class:active={themeDialogSection === 'preset'} onclick={() => (themeDialogSection = 'preset')}>Presets</button>
              <button type="button" class="theme-dialog-tab" class:active={themeDialogSection === 'material'} onclick={() => (themeDialogSection = 'material')}>Material</button>
              <button type="button" class="theme-dialog-tab" class:active={themeDialogSection === 'accent'} onclick={() => (themeDialogSection = 'accent')}>Accent</button>
              <button type="button" class="theme-dialog-tab" class:active={themeDialogSection === 'logo'} onclick={() => (themeDialogSection = 'logo')}>Logo</button>
            </div>

            {#if themeDialogSection === 'preset'}
              <div class="theme-preset-grid">
                {#each themeRegistry.presets as preset (preset.presetId)}
                  <button
                    type="button"
                    class="theme-preset-card"
                    class:active={themeSettings.presetId === preset.presetId}
                    onclick={() => applyThemePreset(preset.presetId)}
                  >
                    <span class="theme-preset-swatches">
                      <span style:background={preset.palette.appBg}></span>
                      <span style:background={preset.palette.accent}></span>
                      <span style:background={preset.logo.peerColor}></span>
                    </span>
                    <span class="theme-preset-copy">
                      <strong>{preset.palette.label}</strong>
                      <span>{preset.palette.description}</span>
                    </span>
                  </button>
                {/each}
              </div>
            {:else if themeDialogSection === 'material'}
              <div class="theme-form-grid theme-form-grid-wide">
                <label>
                  <span>Surface style</span>
                  <select
                    value={themeSettings.palette.surfaceStyle}
                    oninput={(event) => updateThemeSurfaceStyle((event.currentTarget as HTMLSelectElement).value as NearbytesSurfaceStyle)}
                  >
                    <option value="gradient">Gradient</option>
                    <option value="flat">Flat</option>
                  </select>
                </label>
                <label><span>App background</span><input type="color" value={themeSettings.palette.appBg} oninput={(event) => updateThemePaletteColor('appBg', (event.currentTarget as HTMLInputElement).value)} /></label>
                <label><span>Shell top</span><input type="text" value={themeSettings.palette.shellTop} oninput={(event) => updateThemePaletteColor('shellTop', (event.currentTarget as HTMLInputElement).value)} /></label>
                <label><span>Shell bottom</span><input type="text" value={themeSettings.palette.shellBottom} oninput={(event) => updateThemePaletteColor('shellBottom', (event.currentTarget as HTMLInputElement).value)} /></label>
                <label><span>Shell glow</span><input type="text" value={themeSettings.palette.shellGlow} oninput={(event) => updateThemePaletteColor('shellGlow', (event.currentTarget as HTMLInputElement).value)} /></label>
                <label><span>Panel background</span><input type="text" value={themeSettings.palette.panelBg} oninput={(event) => updateThemePaletteColor('panelBg', (event.currentTarget as HTMLInputElement).value)} /></label>
                <label><span>Panel glow</span><input type="text" value={themeSettings.palette.panelGlow} oninput={(event) => updateThemePaletteColor('panelGlow', (event.currentTarget as HTMLInputElement).value)} /></label>
                <label><span>Border</span><input type="text" value={themeSettings.palette.border} oninput={(event) => updateThemePaletteColor('border', (event.currentTarget as HTMLInputElement).value)} /></label>
                <label><span>Border strong</span><input type="text" value={themeSettings.palette.borderStrong} oninput={(event) => updateThemePaletteColor('borderStrong', (event.currentTarget as HTMLInputElement).value)} /></label>
                <label><span>Main text</span><input type="text" value={themeSettings.palette.textMain} oninput={(event) => updateThemePaletteColor('textMain', (event.currentTarget as HTMLInputElement).value)} /></label>
                <label><span>Soft text</span><input type="text" value={themeSettings.palette.textSoft} oninput={(event) => updateThemePaletteColor('textSoft', (event.currentTarget as HTMLInputElement).value)} /></label>
                <label><span>Faint text</span><input type="text" value={themeSettings.palette.textFaint} oninput={(event) => updateThemePaletteColor('textFaint', (event.currentTarget as HTMLInputElement).value)} /></label>
                <label><span>Accent text</span><input type="text" value={themeSettings.palette.accentText} oninput={(event) => updateThemePaletteColor('accentText', (event.currentTarget as HTMLInputElement).value)} /></label>
              </div>
            {:else if themeDialogSection === 'accent'}
              <div class="theme-form-grid">
                <label><span>Accent</span><input type="color" value={themeSettings.palette.accent} oninput={(event) => updateThemePaletteColor('accent', (event.currentTarget as HTMLInputElement).value)} /></label>
                <label><span>Accent strong</span><input type="color" value={themeSettings.palette.accentStrong} oninput={(event) => updateThemePaletteColor('accentStrong', (event.currentTarget as HTMLInputElement).value)} /></label>
                <label><span>Accent soft</span><input type="text" value={themeSettings.palette.accentSoft} oninput={(event) => updateThemePaletteColor('accentSoft', (event.currentTarget as HTMLInputElement).value)} /></label>
                <label><span>Success</span><input type="color" value={themeSettings.palette.success} oninput={(event) => updateThemePaletteColor('success', (event.currentTarget as HTMLInputElement).value)} /></label>
                <label><span>Warning</span><input type="color" value={themeSettings.palette.warning} oninput={(event) => updateThemePaletteColor('warning', (event.currentTarget as HTMLInputElement).value)} /></label>
                <label><span>Danger</span><input type="color" value={themeSettings.palette.danger} oninput={(event) => updateThemePaletteColor('danger', (event.currentTarget as HTMLInputElement).value)} /></label>
              </div>
            {:else}
              <div class="theme-form-grid logo-grid">
                <label><span>Accent node</span><input type="color" value={themeSettings.logo.accentColor} oninput={(event) => updateThemeLogoColor('accentColor', (event.currentTarget as HTMLInputElement).value)} /></label>
                <label><span>Peer node</span><input type="color" value={themeSettings.logo.peerColor} oninput={(event) => updateThemeLogoColor('peerColor', (event.currentTarget as HTMLInputElement).value)} /></label>
                <label><span>Arc color</span><input type="color" value={themeSettings.logo.arcColor} oninput={(event) => updateThemeLogoColor('arcColor', (event.currentTarget as HTMLInputElement).value)} /></label>
                <label><span>Background</span><input type="color" value={themeSettings.logo.bgFill} oninput={(event) => updateThemeLogoColor('bgFill', (event.currentTarget as HTMLInputElement).value)} /></label>
                <label><span>Node fill</span><input type="color" value={themeSettings.logo.nodeFill} oninput={(event) => updateThemeLogoColor('nodeFill', (event.currentTarget as HTMLInputElement).value)} /></label>
                <label><span>Node stroke</span><input type="color" value={themeSettings.logo.nodeStroke} oninput={(event) => updateThemeLogoColor('nodeStroke', (event.currentTarget as HTMLInputElement).value)} /></label>
                <label><span>Peers</span><input type="range" min="2" max="8" step="1" value={themeSettings.logo.peers} oninput={(event) => updateThemeLogoNumber('peers', Number((event.currentTarget as HTMLInputElement).value))} /><em>{themeSettings.logo.peers}</em></label>
                <label><span>Orbit scale</span><input type="range" min="0.5" max="1.8" step="0.01" value={themeSettings.logo.orbitScale} oninput={(event) => updateThemeLogoNumber('orbitScale', Number((event.currentTarget as HTMLInputElement).value))} /><em>{themeSettings.logo.orbitScale.toFixed(2)}</em></label>
                <label><span>Size scale</span><input type="range" min="0.7" max="1.8" step="0.01" value={themeSettings.logo.sizeScale} oninput={(event) => updateThemeLogoNumber('sizeScale', Number((event.currentTarget as HTMLInputElement).value))} /><em>{themeSettings.logo.sizeScale.toFixed(2)}</em></label>
                <label><span>Bulge</span><input type="range" min="0.5" max="2.2" step="0.01" value={themeSettings.logo.bulgeScale} oninput={(event) => updateThemeLogoNumber('bulgeScale', Number((event.currentTarget as HTMLInputElement).value))} /><em>{themeSettings.logo.bulgeScale.toFixed(2)}</em></label>
                <label><span>Line weight</span><input type="range" min="0.5" max="8" step="0.01" value={themeSettings.logo.lineWeight} oninput={(event) => updateThemeLogoNumber('lineWeight', Number((event.currentTarget as HTMLInputElement).value))} /><em>{themeSettings.logo.lineWeight.toFixed(2)}</em></label>
                <label><span>Circle stroke</span><input type="range" min="0.5" max="4" step="0.01" value={themeSettings.logo.circleStroke} oninput={(event) => updateThemeLogoNumber('circleStroke', Number((event.currentTarget as HTMLInputElement).value))} /><em>{themeSettings.logo.circleStroke.toFixed(2)}</em></label>
                <label><span>Pulse speed</span><input type="range" min="0.2" max="2" step="0.01" value={themeSettings.logo.pulseSpeed} oninput={(event) => updateThemeLogoNumber('pulseSpeed', Number((event.currentTarget as HTMLInputElement).value))} /><em>{themeSettings.logo.pulseSpeed.toFixed(2)}</em></label>
                <label><span>Pulse magnitude</span><input type="range" min="0.2" max="2" step="0.01" value={themeSettings.logo.pulseMag} oninput={(event) => updateThemeLogoNumber('pulseMag', Number((event.currentTarget as HTMLInputElement).value))} /><em>{themeSettings.logo.pulseMag.toFixed(2)}</em></label>
                <label><span>Luminosity</span><input type="range" min="-40" max="40" step="1" value={themeSettings.logo.luminosity} oninput={(event) => updateThemeLogoNumber('luminosity', Number((event.currentTarget as HTMLInputElement).value))} /><em>{themeSettings.logo.luminosity}</em></label>
                <label><span>Contrast</span><input type="range" min="-60" max="60" step="1" value={themeSettings.logo.contrast} oninput={(event) => updateThemeLogoNumber('contrast', Number((event.currentTarget as HTMLInputElement).value))} /><em>{themeSettings.logo.contrast}</em></label>
                <label>
                  <span>Arc style</span>
                  <select value={themeSettings.logo.arcStyle} oninput={(event) => updateThemeArcStyle((event.currentTarget as HTMLSelectElement).value as NearbytesArcStyle)}>
                    <option value="dashed">Dashed</option>
                    <option value="dotted">Dotted</option>
                    <option value="solid">Solid</option>
                  </select>
                </label>
              </div>
            {/if}

            {#if themeDialogFeedback}
              <p class={`theme-dialog-status ${themeDialogFeedback.tone}`}>{themeDialogFeedback.message}</p>
            {/if}
            {#if themeDialogError}
              <p class="theme-dialog-status error">{themeDialogError}</p>
            {/if}

            <div class="theme-dialog-actions">
              <button type="button" class="status-link-btn secondary" disabled={themeDialogBusy} onclick={saveThemePresetEdits}>Save preset JSON</button>
              <button type="button" class="status-link-btn secondary" disabled={themeDialogBusy} onclick={setThemePresetAsDefault}>Set as default</button>
              <button type="button" class="status-link-btn secondary" disabled={themeDialogBusy} onclick={exportThemeLogoPng}>Export logo PNG</button>
              <button type="button" class="status-link-btn secondary" onclick={resetThemeToPreset}>Reset to preset</button>
              <button type="button" class="status-link-btn" onclick={() => (showThemeDialog = false)}>Done</button>
            </div>
          </section>
        </div>
      </div>
    </div>
  {/if}

</div>
<style>
  :global(html, body, #app) {
    height: 100%;
    min-height: 100%;
    overflow: hidden;
  }

  :global(*, *::before, *::after) {
    box-sizing: border-box;
  }

  :global(:root) {
    --nb-font-display: 'Avenir Next', 'SF Pro Display', 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif;
    --nb-font-body: 'Avenir Next', 'SF Pro Display', 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif;
  }

  :global(body) {
    margin: 0;
    padding: 0;
    background: var(--nb-app-bg, #0a0a0f);
    color: var(--nb-text-main, #e0e0e0);
    font-family: var(--nb-font-body, 'SF Pro Text', 'Avenir Next', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif);
    overscroll-behavior: none;
  }

  :global(button),
  :global(input),
  :global(select),
  :global(textarea) {
    font-family: inherit;
  }

  .app {
    width: 100%;
    min-height: 100dvh;
    height: 100dvh;
    display: flex;
    flex-direction: column;
    background: var(--nb-app-shell-bg, var(--nb-app-bg, #f3f2f5));
    overflow: hidden;
    color: var(--nb-text-main, rgba(241, 245, 249, 0.96));
  }

  .header {
    background: var(--nb-header-bg, color-mix(in srgb, var(--nb-panel-bg, rgba(255, 255, 255, 0.98)) 98%, var(--nb-shell-top, white)));
    backdrop-filter: blur(18px);
    border-bottom: 1px solid var(--nb-border, rgba(56, 189, 248, 0.14));
    padding: 0.75rem 2rem 0.9rem;
    position: sticky;
    top: 0;
    z-index: 120;
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
  }

  .brand-rail {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.9rem;
    padding: 0.7rem 0.82rem;
    border: 1px solid var(--nb-border, rgba(56, 189, 248, 0.14));
    border-radius: 18px;
    background: var(--nb-brand-rail-bg, color-mix(in srgb, var(--nb-panel-bg, rgba(255, 255, 255, 0.98)) 98%, var(--nb-shell-bottom, rgba(244, 244, 247, 0.99))));
  }

  .brand-badge {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.95rem;
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }

  .brand-badge.static {
    cursor: default;
  }

  .brand-logo-trigger {
    appearance: none;
    padding: 0;
    margin: 0;
    border: 0;
    background: transparent;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }

  .brand-logo-frame {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 78px;
    height: 78px;
    padding: 0;
    border-radius: 18px;
    background: color-mix(in srgb, var(--nb-logo-bg, #ffffff) 96%, var(--nb-panel-bg, #ffffff));
    border: 1px solid var(--nb-border, rgba(56, 189, 248, 0.16));
    box-shadow:
      0 8px 24px rgba(28, 28, 30, 0.08),
      inset 0 1px 0 rgba(255, 255, 255, 0.72);
  }

  .brand-logo-frame.interactive {
    transition: border-color 0.18s ease, background-color 0.18s ease;
  }

  .brand-logo-trigger:hover .brand-logo-frame.interactive,
  .brand-logo-trigger:focus-visible .brand-logo-frame.interactive {
    border-color: var(--nb-border-strong, rgba(56, 189, 248, 0.32));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 92%, var(--nb-accent-soft, rgba(255, 59, 48, 0.08)));
    box-shadow:
      0 10px 28px rgba(28, 28, 30, 0.1),
      inset 0 1px 0 rgba(255, 255, 255, 0.78);
  }

  .brand-copy {
    flex: 0 0 auto;
    display: grid;
    gap: 0.08rem;
    align-content: center;
    justify-content: center;
    white-space: nowrap;
  }

  .brand-stack {
    min-width: 0;
    display: flex;
    align-items: center;
    min-height: 78px;
    flex: 1 1 auto;
  }

  .brand-meta-row {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    min-width: 0;
    width: 100%;
  }

  .brand-meta-row :global(.mount-rail) {
    flex: 0 1 auto;
    min-width: 0;
  }

  .brand-title {
    font-family: var(--nb-font-display, 'Avenir Next', 'SF Pro Display', 'Helvetica Neue', Arial, sans-serif);
    font-size: 1.66rem;
    font-weight: 650;
    line-height: 1.02;
    letter-spacing: 0.01em;
    color: var(--nb-text-main, rgba(28, 28, 30, 0.98));
  }

  .brand-note {
    font-family: var(--nb-font-body, 'SF Pro Text', 'Avenir Next', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif);
    font-size: 0.82rem;
    font-weight: 450;
    letter-spacing: 0.02em;
    line-height: 1.25;
    color: var(--nb-text-soft, rgba(191, 219, 254, 0.74));
  }

  .brand-actions {
    flex: 0 0 auto;
    flex-wrap: wrap;
  }

  .mount-quick-actions {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.16rem;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(56, 189, 248, 0.18)) 88%, transparent);
    background: color-mix(in srgb, var(--nb-btn-bg, rgba(10, 19, 34, 0.52)) 92%, transparent);
    box-shadow: 0 8px 20px rgba(6, 23, 43, 0.08);
  }

  .identity-row-title,
  .status-storage-title,
  .discovery-toast-title,
  .volume-transition-title,
  .join-dialog-route-title,
  .share-dialog-empty-title,
  .tm-details-title,
  .tm-details-section-title,
  .tm-details-spec-title,
  .tm-spec-title,
  .preview-title {
    font-family: var(--nb-font-display, 'Avenir Next', 'SF Pro Display', 'Helvetica Neue', Arial, sans-serif);
  }

  .status-label,
  .time-machine-eyebrow,
  .tm-details-eyebrow,
  .tm-details-label,
  .empty-eyebrow {
    font-family: var(--nb-font-body, 'SF Pro Text', 'Avenir Next', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif);
  }

  .brand-rail {
    align-items: flex-start;
  }

  .brand-badge {
    align-items: flex-start;
  }

  .header-shell {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    align-items: flex-start;
    position: relative;
    transition: transform 0.24s ease, filter 0.24s ease;
  }

  .header-shell.secret-drop-target {
    transform: translateY(-1px);
    filter: drop-shadow(0 14px 28px rgba(34, 211, 238, 0.12));
  }

  .mount-stack,
  .mount-item {
    display: flex;
    flex: 0 0 auto;
    align-items: stretch;
  }

  .mount-stack {
    position: relative;
    will-change: transform;
  }

  .mount-item.dragging {
    z-index: 80;
  }

  .mount-item.drag-hole {
    pointer-events: none;
  }

  .hole-shell {
    visibility: hidden;
    box-shadow: none;
  }

  .identity-row {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
    padding: 0.78rem 0.9rem;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 88%, rgba(210, 122, 84, 0.08));
    border-radius: 18px;
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 97%, rgba(248, 243, 239, 0.9));
    box-shadow: 0 10px 28px rgba(82, 53, 33, 0.06);
  }

  .identity-row-head,
  .identity-row-actions,
  .identity-editor-panel-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.7rem;
    flex-wrap: wrap;
  }

  .identity-row-title {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    font-size: 0.88rem;
    font-weight: 600;
    color: var(--nb-text-main, rgba(28, 28, 30, 0.96));
  }

  .identity-chip-row {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    overflow-x: auto;
    padding-bottom: 0.1rem;
    scrollbar-width: thin;
  }

  .identity-pill {
    appearance: none;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 88%, rgba(210, 122, 84, 0.08));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 95%, rgba(250, 244, 239, 0.9));
    color: var(--nb-text-main, rgba(28, 28, 30, 0.96));
    border-radius: 14px;
    min-height: 42px;
    padding: 0.58rem 0.82rem;
    display: inline-flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: center;
    gap: 0.12rem;
    min-width: 132px;
    font: inherit;
    cursor: pointer;
    transition:
      border-color 0.18s ease,
      background-color 0.18s ease,
      transform 0.18s ease,
      box-shadow 0.18s ease;
  }

  .identity-pill:hover {
    border-color: color-mix(in srgb, var(--nb-accent, #d27a54) 10%, var(--nb-border, rgba(60, 60, 67, 0.12)));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 92%, white 8%);
  }

  .identity-pill.active {
    border-color: color-mix(in srgb, var(--nb-accent, #d27a54) 14%, rgba(60, 60, 67, 0.12));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 95%, rgba(248, 243, 239, 0.92));
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 72%, rgba(210, 122, 84, 0.08));
  }

  .identity-pill.add {
    min-width: auto;
    flex-direction: row;
    align-items: center;
    gap: 0.45rem;
  }

  .identity-pill-name {
    font-size: 0.84rem;
    font-weight: 600;
    white-space: nowrap;
  }

  .identity-pill-state {
    font-size: 0.72rem;
    color: var(--nb-text-faint, rgba(110, 110, 115, 0.68));
    white-space: nowrap;
  }

  .identity-row-note {
    margin: 0;
    font-size: 0.78rem;
    color: var(--nb-text-soft, rgba(70, 70, 73, 0.76));
  }

  .identity-row-banner {
    margin: 0;
    align-self: flex-start;
    border-radius: 12px;
    padding: 0.52rem 0.76rem;
    font-size: 0.8rem;
    border: 1px solid transparent;
  }

  .identity-row-banner.error {
    background: color-mix(in srgb, var(--nb-danger-surface, rgba(254, 202, 202, 0.12)) 84%, rgba(255, 248, 247, 0.96));
    border-color: color-mix(in srgb, var(--nb-danger, #c86a6a) 24%, transparent);
    color: color-mix(in srgb, var(--nb-danger, #c86a6a) 84%, var(--nb-text-main, rgba(28, 28, 30, 0.96)));
  }

  .identity-row-banner.success {
    background: color-mix(in srgb, var(--nb-success-surface, rgba(134, 239, 172, 0.12)) 84%, rgba(247, 252, 248, 0.96));
    border-color: color-mix(in srgb, var(--nb-success, #6aa975) 24%, transparent);
    color: color-mix(in srgb, var(--nb-success, #6aa975) 84%, var(--nb-text-main, rgba(28, 28, 30, 0.96)));
  }

  .identity-editor-panel {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.75rem;
    align-items: start;
  }

  .identity-editor-panel label {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    color: var(--nb-text-soft, rgba(70, 70, 73, 0.78));
    font-size: 0.82rem;
  }

  .identity-editor-panel input,
  .identity-editor-panel textarea {
    width: 100%;
    border-radius: 14px;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 88%, rgba(210, 122, 84, 0.08));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 96%, rgba(249, 244, 240, 0.9));
    color: var(--nb-text-main, rgba(28, 28, 30, 0.96));
    font: inherit;
    padding: 0.75rem 0.85rem;
  }

  .identity-editor-panel input:focus,
  .identity-editor-panel textarea:focus {
    outline: none;
    border-color: color-mix(in srgb, var(--nb-accent, #d27a54) 18%, rgba(60, 60, 67, 0.14));
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--nb-panel-bg, #ffffff) 72%, rgba(240, 232, 226, 0.8));
  }

  .identity-editor-panel-wide {
    grid-column: 1 / -1;
  }

  .identity-editor-panel-actions {
    grid-column: 1 / -1;
  }

  .identity-avatar-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.85rem;
  }

  .identity-avatar-preview {
    width: 58px;
    height: 58px;
    border-radius: 18px;
    overflow: hidden;
    display: grid;
    place-items: center;
    background: color-mix(in srgb, var(--nb-accent, #d27a54) 8%, #fff8f2);
    color: var(--nb-text-main, rgba(28, 28, 30, 0.96));
    font-size: 1.2rem;
    font-weight: 700;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(56, 189, 248, 0.16)) 88%, transparent);
    flex: 0 0 auto;
  }

  .identity-avatar-image {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .identity-avatar-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.55rem;
  }

  .create-chooser-modal,
  .identity-manager-modal {
    width: min(760px, calc(100vw - 2rem));
    max-height: min(86vh, 920px);
    overflow: auto;
    border-radius: 24px;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 88%, rgba(210, 122, 84, 0.08));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 97%, rgba(248, 243, 239, 0.92));
    box-shadow: 0 24px 72px rgba(42, 28, 18, 0.18);
  }

  .create-chooser-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    padding: 1rem 1rem 0;
  }

  .create-chooser-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.85rem;
    padding: 1rem;
  }

  .create-chooser-card {
    appearance: none;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 88%, rgba(210, 122, 84, 0.08));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 95%, rgba(250, 244, 239, 0.9));
    color: var(--nb-text-main, rgba(28, 28, 30, 0.96));
    border-radius: 18px;
    padding: 1rem;
    display: grid;
    gap: 0.45rem;
    justify-items: start;
    text-align: left;
    cursor: pointer;
    transition:
      transform 0.18s ease,
      background-color 0.18s ease,
      border-color 0.18s ease,
      box-shadow 0.18s ease;
  }

  .create-chooser-card:hover {
    transform: translateY(-1px);
    border-color: color-mix(in srgb, var(--nb-accent, #d27a54) 10%, var(--nb-border, rgba(60, 60, 67, 0.12)));
    box-shadow: 0 14px 28px rgba(82, 53, 33, 0.08);
  }

  .create-chooser-card-title {
    font-size: 0.94rem;
    font-weight: 700;
  }

  .create-chooser-card-copy {
    font-size: 0.79rem;
    line-height: 1.45;
    color: var(--nb-text-soft, rgba(70, 70, 73, 0.76));
  }

  .identity-manager-panel {
    width: 100%;
    border: 0;
    border-radius: 0;
    box-shadow: none;
    background: transparent;
  }

  .workspace-toggle.remove {
    border-color: var(--nb-btn-danger-border, color-mix(in srgb, var(--nb-danger, #c86a6a) 24%, transparent));
    background: var(--nb-btn-danger-bg, color-mix(in srgb, var(--nb-danger-surface, rgba(254, 202, 202, 0.12)) 84%, rgba(255, 248, 247, 0.96)));
    color: var(--nb-btn-danger-color, color-mix(in srgb, var(--nb-danger, #c86a6a) 84%, var(--nb-text-main, rgba(28, 28, 30, 0.96))));
  }

  .workspace-toggle.remove:hover {
    border-color: var(--nb-btn-danger-hover-border, color-mix(in srgb, var(--nb-danger, #c86a6a) 30%, transparent));
    background: var(--nb-btn-danger-hover-bg, color-mix(in srgb, var(--nb-danger-surface, rgba(254, 202, 202, 0.12)) 76%, rgba(255, 244, 243, 0.98)));
  }

  .mounts-actions {
    display: inline-flex;
    align-items: center;
    gap: 0.38rem;
    opacity: 1;
    pointer-events: auto;
    transform: none;
  }

  .volume-chip {
    appearance: none;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(56, 189, 248, 0.22)) 90%, transparent);
    border-radius: 14px;
    background: var(--nb-volume-chip-bg, linear-gradient(180deg, color-mix(in srgb, var(--nb-shell-top, rgba(12, 25, 45, 0.9)) 94%, transparent), color-mix(in srgb, var(--nb-panel-bg, rgba(9, 18, 34, 0.88)) 94%, transparent)));
    width: fit-content;
    min-width: 132px;
    max-width: min(72vw, 420px);
    padding: 0.1rem;
    transition: min-width 0.28s ease, max-width 0.28s ease, border-radius 0.28s ease, background-color 0.28s ease, border-color 0.28s ease, box-shadow 0.28s ease, transform 0.28s ease;
    overflow: hidden;
    font: inherit;
    color: inherit;
    text-align: left;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
  }

  .volume-chip.collapsed-shell {
    display: flex;
    align-items: stretch;
    gap: 0;
    transition:
      min-width 0.22s ease,
      max-width 0.22s ease,
      opacity 0.18s ease,
      transform 0.22s ease,
      margin 0.22s ease,
      border-color 0.18s ease;
  }

  .volume-chip.collapsed-shell.parked {
    min-width: 46px;
    max-width: 46px;
    transform: translateX(0) scale(1);
  }

  .volume-chip.collapsed-shell.parked .header-dock {
    padding: 0.32rem;
  }

  .volume-chip.collapsed-shell.parked .header-dock-badge {
    gap: 0;
  }

  .volume-chip.collapsed-shell.parked .header-dock-badge-top {
    gap: 0;
  }

  .volume-chip.collapsed-shell :global(.volume-identity-copy) {
    max-width: 220px;
    opacity: 1;
    transform: translateX(0);
    overflow: hidden;
    transition:
      max-width 0.22s ease,
      opacity 0.18s ease,
      transform 0.22s ease;
  }

  .volume-chip.collapsed-shell.parked :global(.volume-identity-copy) {
    max-width: 0;
    opacity: 0;
    transform: translateX(-5px);
  }

  :global(.mount-rail:not(.dragging)) .volume-chip.collapsed-shell.parked:focus-within:not(.drag-armed):not(.dragging) {
    min-width: 132px;
    max-width: min(72vw, 420px);
  }

  :global(.mount-rail:not(.dragging)) .volume-chip.collapsed-shell.parked:hover:not(.drag-armed):not(.dragging),
  :global(.mount-rail:not(.dragging)) .volume-chip.collapsed-shell.parked.selected:not(.drag-armed):not(.dragging),
  :global(.mount-rail:not(.dragging)) .volume-chip.collapsed-shell.parked.pressed:not(.drag-armed):not(.dragging),
  :global(.mount-rail:not(.dragging)) .volume-chip.collapsed-shell.parked:active:not(.drag-armed):not(.dragging) {
    min-width: 132px;
    max-width: min(72vw, 420px);
  }

  :global(.mount-rail:not(.dragging)) .volume-chip.collapsed-shell.parked:focus-within:not(.drag-armed):not(.dragging) .header-dock,
  :global(.mount-rail:not(.dragging)) .volume-chip.collapsed-shell.parked:hover:not(.drag-armed):not(.dragging) .header-dock,
  :global(.mount-rail:not(.dragging)) .volume-chip.collapsed-shell.parked.selected:not(.drag-armed):not(.dragging) .header-dock,
  :global(.mount-rail:not(.dragging)) .volume-chip.collapsed-shell.parked.pressed:not(.drag-armed):not(.dragging) .header-dock,
  :global(.mount-rail:not(.dragging)) .volume-chip.collapsed-shell.parked:active:not(.drag-armed):not(.dragging) .header-dock {
    padding: 0.26rem 0.36rem 0.26rem 0.62rem;
  }

  :global(.mount-rail:not(.dragging)) .volume-chip.collapsed-shell.parked:hover:not(.drag-armed):not(.dragging) .header-dock-badge-top,
  :global(.mount-rail:not(.dragging)) .volume-chip.collapsed-shell.parked:focus-within:not(.drag-armed):not(.dragging) .header-dock-badge-top,
  :global(.mount-rail:not(.dragging)) .volume-chip.collapsed-shell.parked.selected:not(.drag-armed):not(.dragging) .header-dock-badge-top,
  :global(.mount-rail:not(.dragging)) .volume-chip.collapsed-shell.parked.pressed:not(.drag-armed):not(.dragging) .header-dock-badge-top,
  :global(.mount-rail:not(.dragging)) .volume-chip.collapsed-shell.parked:active:not(.drag-armed):not(.dragging) .header-dock-badge-top {
    gap: 0.5rem;
  }

  :global(.mount-rail:not(.dragging)) .volume-chip.collapsed-shell.parked:focus-within:not(.drag-armed):not(.dragging) :global(.volume-identity-copy),
  :global(.mount-rail:not(.dragging)) .volume-chip.collapsed-shell.parked:hover:not(.drag-armed):not(.dragging) :global(.volume-identity-copy),
  :global(.mount-rail:not(.dragging)) .volume-chip.collapsed-shell.parked.selected:not(.drag-armed):not(.dragging) :global(.volume-identity-copy),
  :global(.mount-rail:not(.dragging)) .volume-chip.collapsed-shell.parked.pressed:not(.drag-armed):not(.dragging) :global(.volume-identity-copy),
  :global(.mount-rail:not(.dragging)) .volume-chip.collapsed-shell.parked:active:not(.drag-armed):not(.dragging) :global(.volume-identity-copy) {
    max-width: 220px;
    opacity: 1;
    transform: translateX(0);
  }

  .volume-chip.expanded {
    width: min(100%, 1120px);
    max-width: min(100%, 1120px);
    border-radius: 18px;
    background: var(--nb-volume-chip-expanded-bg, linear-gradient(180deg, color-mix(in srgb, var(--nb-shell-top, rgba(10, 23, 43, 0.96)) 98%, transparent), color-mix(in srgb, var(--nb-panel-bg, rgba(8, 18, 35, 0.94)) 98%, transparent)));
    border-color: color-mix(in srgb, var(--nb-border-strong, rgba(56, 189, 248, 0.34)) 88%, transparent);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.1);
    cursor: default;
  }

  .volume-chip.selected:not(.drag-armed):not(.dragging) {
    --volume-identity-label-color: var(--nb-text-main, rgba(28, 28, 30, 0.98));
    --volume-identity-secondary-color: var(--nb-text-soft, rgba(58, 58, 60, 0.72));
    border-color: color-mix(in srgb, var(--nb-accent, #ff3b30) 24%, transparent);
    background: var(--nb-volume-chip-selected-bg, color-mix(in srgb, var(--nb-accent, #ff3b30) 10%, var(--nb-panel-bg, white)));
    box-shadow:
      0 0 0 1px color-mix(in srgb, var(--nb-accent, #ff3b30) 10%, transparent),
      0 1px 3px rgba(0, 0, 0, 0.05);
  }

  .volume-chip.selected:not(.drag-armed):not(.dragging) .header-dock {
    padding-left: 0.72rem;
  }

  .volume-chip.selected:not(.drag-armed):not(.dragging) .header-dock-badge {
    position: relative;
    padding-left: 0.68rem;
  }

  .volume-chip.selected:not(.drag-armed):not(.dragging) .header-dock-badge::before {
    content: '';
    position: absolute;
    left: 0;
    top: 50%;
    transform: translateY(-50%);
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: var(--nb-accent, #ff3b30);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--nb-panel-bg, white) 88%, transparent);
  }

  .volume-chip.selected:not(.drag-armed):not(.dragging) .badge-meter {
    background: color-mix(in srgb, var(--nb-accent, rgba(34, 211, 238, 0.18)) 28%, transparent);
  }

  .volume-chip.drag-over {
    border-color: color-mix(in srgb, var(--nb-accent, rgba(56, 189, 248, 0.6)) 80%, transparent);
    box-shadow:
      inset 0 0 0 1px color-mix(in srgb, var(--nb-accent, rgba(56, 189, 248, 0.28)) 40%, transparent),
      0 8px 20px rgba(0, 0, 0, 0.12);
  }

  .volume-chip.dragging {
    opacity: 1;
    min-width: 46px;
    max-width: 46px;
    margin-left: 0;
    cursor: grabbing;
    transition: none;
    border-color: color-mix(in srgb, var(--nb-border, rgba(56, 189, 248, 0.22)) 90%, transparent);
    background: var(--nb-volume-chip-dragging-bg, linear-gradient(180deg, rgba(12, 25, 45, 0.9), rgba(9, 18, 34, 0.88)));
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.12);
    z-index: 40;
  }

  .volume-chip.dragging .header-dock {
    padding: 0.32rem;
  }

  .volume-chip.dragging .header-dock-badge,
  .volume-chip.dragging .header-dock-badge-top {
    gap: 0;
  }

  .volume-chip.dragging :global(.volume-identity-copy) {
    max-width: 0;
    opacity: 0;
    transform: translateX(-5px);
  }

  .volume-chip.dragging .header-dock-badge::before {
    width: 0;
    height: 0;
    opacity: 0;
    box-shadow: none;
  }

  .volume-chip.dragging .volume-chip-select {
    cursor: grabbing;
  }

  .header-dock {
    border: 0;
    background: transparent;
    padding: 0.26rem 0.36rem 0.26rem 0.62rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    min-height: 36px;
    transition: padding 0.24s ease;
  }

  .volume-chip-select {
    appearance: none;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    padding: 0;
    min-width: 0;
    flex: 1 1 auto;
    cursor: pointer;
    touch-action: pan-y;
  }

  .volume-chip-select:hover .header-dock {
    background: var(--nb-volume-chip-hover-bg, color-mix(in srgb, var(--nb-panel-bg, #ffffff) 92%, white 8%));
  }

  .volume-chip-select:focus-visible {
    outline: none;
  }

  .volume-chip-select:focus-visible .header-dock {
    background: var(--nb-volume-chip-focus-bg, color-mix(in srgb, var(--nb-panel-bg, #ffffff) 88%, white 12%));
    box-shadow: var(--nb-btn-focus-ring, inset 0 0 0 1px rgba(125, 211, 252, 0.18));
  }

  .volume-chip.dragging .volume-chip-select:hover .header-dock,
  .volume-chip.dragging .volume-chip-select:focus-visible .header-dock {
    background: transparent;
    box-shadow: none;
  }

  .volume-chip.dragging .volume-chip-config-btn {
    width: 0;
    min-width: 0;
    opacity: 0;
    pointer-events: none;
    border-left-color: transparent;
  }

  .volume-chip.dragging:hover .volume-chip-config-btn,
  .volume-chip.dragging:focus-within .volume-chip-config-btn {
    width: 0;
    min-width: 0;
    opacity: 0;
    pointer-events: none;
    transform: none;
    border-left-color: transparent;
  }

  .volume-chip-action-btn {
    appearance: none;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 88%, transparent);
    background: var(--nb-volume-chip-action-bg, color-mix(in srgb, var(--nb-panel-bg, #ffffff) 94%, var(--nb-shell-bottom, #f4f4f7)));
    color: var(--nb-text-soft, rgba(70, 70, 73, 0.78));
    width: 32px;
    min-width: 32px;
    height: 32px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    margin: 0.14rem 0.16rem 0.14rem 0;
    border-radius: 999px;
    cursor: pointer;
    overflow: hidden;
    opacity: 0;
    pointer-events: none;
    transition:
      width 0.2s ease,
      min-width 0.2s ease,
      opacity 0.16s ease,
      background-color 0.2s ease,
      color 0.2s ease,
      border-color 0.2s ease,
      transform 0.2s ease;
  }

  .volume-chip.collapsed-shell:hover .volume-chip-action-btn,
  .volume-chip.collapsed-shell:focus-within .volume-chip-action-btn {
    width: 32px;
    min-width: 32px;
    opacity: 1;
    pointer-events: auto;
  }

  .volume-chip.dragging:hover .volume-chip-action-btn,
  .volume-chip.dragging:focus-within .volume-chip-action-btn {
    width: 0;
    min-width: 0;
    border-left-color: transparent;
    opacity: 0;
    pointer-events: none;
    transform: none;
  }

  .volume-chip-action-btn:hover {
    background: var(--nb-volume-chip-action-hover-bg, color-mix(in srgb, var(--nb-panel-bg, #ffffff) 90%, white 10%));
    border-color: color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 96%, transparent);
    color: var(--nb-text-main, rgba(28, 28, 30, 0.96));
  }

  .volume-chip-action-btn:focus-visible {
    outline: none;
    background: var(--nb-volume-chip-action-focus-bg, color-mix(in srgb, var(--nb-panel-bg, #ffffff) 86%, white 14%));
    border-color: color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 96%, transparent);
    color: var(--nb-text-main, rgba(28, 28, 30, 0.98));
    box-shadow: var(--nb-btn-focus-ring, inset 0 0 0 1px rgba(125, 211, 252, 0.18));
  }

  .header-dock-main {
    min-width: 0;
    display: flex;
    align-items: center;
    flex: 1;
  }

  .header-dock-main.editing {
    align-items: stretch;
    min-width: 0;
  }

  .header-dock-badge {
    min-width: 0;
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 0.38rem;
    padding: 0.1rem 0;
  }

  .header-dock-badge-top {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .volume-chip-expanded {
    max-height: 0;
    opacity: 0;
    transform: translateY(-6px);
    pointer-events: none;
    transition: max-height 0.28s ease, opacity 0.24s ease, transform 0.24s ease, padding 0.24s ease;
    padding: 0;
    overflow: hidden;
  }

  .volume-chip-expanded.expanded {
    max-height: 320px;
    opacity: 1;
    transform: translateY(0);
    pointer-events: auto;
    padding: 0.38rem 0 0.28rem;
  }

  .secret-file-card {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 0.8rem;
    align-items: center;
    padding: 0.78rem 0.82rem;
    margin: 0 0 0.6rem;
    border-radius: 14px;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(56, 189, 248, 0.16)) 88%, transparent);
    background: var(--nb-identity-surface-bg, linear-gradient(180deg, rgba(8, 17, 31, 0.88), rgba(7, 14, 27, 0.82)));
  }

  .secret-file-card-preview {
    width: 56px;
    height: 56px;
    border-radius: 14px;
    overflow: hidden;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: var(--nb-btn-bg, rgba(10, 19, 35, 0.92));
    border: 1px solid var(--nb-border, rgba(96, 165, 250, 0.18));
    color: var(--nb-text-soft, rgba(191, 219, 254, 0.86));
    flex: 0 0 auto;
  }

  .secret-file-card-preview.image {
    background: color-mix(in srgb, var(--nb-shell-bottom, rgba(7, 14, 28, 0.98)) 96%, transparent);
  }

  .secret-file-card-image {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .secret-file-card-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .secret-file-card-meta {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.14rem;
  }

  .secret-file-card-name,
  .secret-file-card-info,
  .secret-file-card-hash-label,
  .secret-file-card-hash {
    margin: 0;
  }

  .secret-file-card-name {
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--nb-text-main, rgba(240, 249, 255, 0.97));
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .secret-file-card-info {
    font-size: 0.74rem;
    color: var(--nb-text-soft, rgba(191, 219, 254, 0.74));
  }

  .secret-file-card-hash-label {
    margin-top: 0.18rem;
    font-size: 0.68rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--nb-accent, rgba(94, 234, 212, 0.7));
  }

  .secret-file-card-hash {
    font-family: 'Monaco', 'Menlo', monospace;
    font-size: 0.72rem;
    line-height: 1.35;
    color: var(--nb-text-main, rgba(226, 232, 240, 0.9));
    word-break: break-all;
  }

  .secret-file-download {
    min-width: 108px;
  }

  .header-dock-actions {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 0.55rem;
    flex-wrap: wrap;
    width: 100%;
    padding-top: 0.12rem;
  }

  .workspace-toggle {
    border: 1px solid var(--nb-btn-border, rgba(56, 189, 248, 0.24));
    background: var(--nb-btn-bg, rgba(12, 24, 43, 0.82));
    color: var(--nb-btn-color, rgba(226, 232, 240, 0.92));
    border-radius: 999px;
    padding: 0 0.72rem;
    min-height: 28px;
    min-width: 116px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.46rem;
    font-family: var(--nb-font-body, 'SF Pro Text', 'Avenir Next', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif);
    font-size: 0.74rem;
    font-weight: 600;
    letter-spacing: 0.01em;
    line-height: 1;
    cursor: pointer;
    transition: background-color 0.18s ease, border-color 0.18s ease, color 0.18s ease, box-shadow 0.18s ease;
  }

  .workspace-toggle:hover {
    background: var(--nb-btn-hover-bg, rgba(18, 34, 60, 0.94));
    border-color: var(--nb-btn-hover-border, rgba(96, 165, 250, 0.34));
    color: var(--nb-btn-hover-color, rgba(224, 242, 254, 0.96));
  }

  .workspace-toggle:focus-visible {
    outline: none;
    box-shadow: var(--nb-btn-focus-ring, inset 0 0 0 1px rgba(125, 211, 252, 0.18));
  }

  .workspace-toggle.active {
    border-color: var(--nb-btn-active-border, rgba(34, 211, 238, 0.48));
    background: var(--nb-btn-active-bg, linear-gradient(180deg, rgba(16, 66, 91, 0.96), rgba(10, 44, 66, 0.96)));
    color: var(--nb-btn-active-color, #ecfeff);
    box-shadow: var(--nb-btn-active-shadow, 0 10px 24px rgba(6, 182, 212, 0.16));
  }

  .panel-surface {
    animation: panel-fade-in 240ms ease;
  }

  @keyframes panel-fade-in {
    from {
      opacity: 0;
      transform: translateY(-6px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .secret-input-wrapper {
    flex: 1;
    min-width: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 0.5rem;
    align-items: end;
    position: relative;
  }

  .secret-input-wrapper.in-dock {
    width: 100%;
  }

  .secret-input-wrapper.in-dock :global(.secret-seed-fields) {
    width: 100%;
  }

  .secret-input-hint-row {
    margin-top: 0.18rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .secret-input-hint {
    margin: 0;
    font-size: 0.66rem;
    line-height: 1.25;
    color: var(--nb-text-faint, rgba(191, 219, 254, 0.64));
    letter-spacing: 0.01em;
  }

  .secret-input-hint kbd {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 1.25rem;
    padding: 0 0.34rem;
    border-radius: 6px;
    border: 1px solid var(--nb-border, rgba(96, 165, 250, 0.18));
    background: var(--nb-btn-bg, rgba(10, 18, 33, 0.7));
    color: var(--nb-text-main, rgba(226, 232, 240, 0.86));
    font-size: 0.68rem;
    font-weight: 600;
    font-family: inherit;
    vertical-align: middle;
  }

  .secret-clipboard-btn {
    min-width: 108px;
  }

  .secret-input-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0.42rem;
    flex-wrap: wrap;
  }

  .secret-link-btn {
    min-width: 118px;
  }

  .inline-join-link-panel {
    margin-top: 0.7rem;
    padding-top: 0.1rem;
  }

  :global(.secret-seed-fields input) {
    width: 100%;
    min-height: 38px;
    padding: 0 0.78rem;
    font-size: 0.82rem;
    background: var(--nb-btn-bg, rgba(10, 18, 33, 0.82));
    border: 1px solid var(--nb-border, rgba(96, 165, 250, 0.24));
    border-radius: 12px;
    color: var(--nb-text-main, #e0e0e0);
    outline: none;
    transition: border-color 0.18s ease, background-color 0.18s ease, box-shadow 0.18s ease;
  }

  :global(.secret-seed-fields input:focus) {
    border-color: var(--nb-border-strong, rgba(56, 189, 248, 0.52));
    background: var(--nb-btn-hover-bg, rgba(10, 18, 33, 0.96));
    box-shadow: var(--nb-btn-focus-ring, 0 0 0 3px rgba(14, 165, 233, 0.12));
  }

  :global(.secret-seed-fields input:disabled) {
    opacity: 0.5;
    cursor: not-allowed;
  }

  :global(.secret-seed-fields input::placeholder) {
    color: var(--nb-text-faint, rgba(224, 224, 224, 0.4));
  }

  .loading-spinner {
    justify-self: center;
    width: 16px;
    height: 16px;
    border: 2px solid color-mix(in srgb, var(--nb-accent, rgba(102, 126, 234, 0.3)) 36%, transparent);
    border-top-color: var(--nb-accent, #667eea);
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .badge-meter {
    position: relative;
    display: block;
    width: 100%;
    height: 3px;
    border-radius: 999px;
    overflow: hidden;
    background: color-mix(in srgb, var(--nb-accent, rgba(56, 189, 248, 0.16)) 24%, transparent);
  }

  .badge-meter-bar {
    position: absolute;
    top: 0;
    bottom: 0;
    left: -42%;
    width: 42%;
    border-radius: inherit;
    background: color-mix(in srgb, var(--nb-accent, rgba(255, 59, 48, 1)) 44%, white);
    animation: badge-meter-slide 1.08s ease-in-out infinite;
  }

  @keyframes badge-meter-slide {
    0% {
      left: -42%;
    }
    100% {
      left: 100%;
    }
  }

  .chip-collapse-btn {
    border: 1px solid var(--nb-btn-border, rgba(148, 163, 184, 0.2));
    background: var(--nb-btn-bg, rgba(11, 19, 34, 0.5));
    color: var(--nb-btn-color, rgba(203, 213, 225, 0.72));
    border-radius: 999px;
    width: 24px;
    height: 24px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    cursor: pointer;
    transition: background-color 0.18s ease, border-color 0.18s ease, color 0.18s ease;
  }

  .chip-collapse-btn:hover {
    background: var(--nb-btn-hover-bg, rgba(15, 23, 42, 0.82));
    border-color: var(--nb-btn-hover-border, rgba(148, 163, 184, 0.34));
    color: var(--nb-btn-hover-color, rgba(226, 232, 240, 0.94));
  }

  .chip-collapse-btn:focus-visible {
    outline: none;
    box-shadow: var(--nb-btn-focus-ring, inset 0 0 0 1px rgba(125, 211, 252, 0.18));
  }

  :global(.panel-action-btn) {
    border: 1px solid var(--nb-btn-border, rgba(56, 189, 248, 0.24));
    background: var(--nb-btn-bg, rgba(12, 24, 43, 0.82));
    color: var(--nb-btn-color, rgba(226, 232, 240, 0.92));
    border-radius: 999px;
    padding: 0 0.72rem;
    min-height: 28px;
    min-width: 116px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.46rem;
    font-family: var(--nb-font-body, 'SF Pro Text', 'Avenir Next', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif);
    font-size: 0.74rem;
    font-weight: 600;
    letter-spacing: 0.01em;
    line-height: 1;
    cursor: pointer;
    transition: background-color 0.18s ease, border-color 0.18s ease, color 0.18s ease, box-shadow 0.18s ease;
  }

  :global(.panel-action-btn:hover:not(:disabled)) {
    background: var(--nb-btn-hover-bg, rgba(18, 34, 60, 0.94));
    border-color: var(--nb-btn-hover-border, rgba(96, 165, 250, 0.34));
    color: var(--nb-btn-hover-color, rgba(224, 242, 254, 0.96));
  }

  :global(.panel-action-btn:focus-visible) {
    outline: none;
    box-shadow: var(--nb-btn-focus-ring, inset 0 0 0 1px rgba(125, 211, 252, 0.18));
  }

  :global(.panel-action-btn:disabled) {
    cursor: default;
    opacity: 0.5;
  }

  :global(.panel-action-btn.danger) {
    border-color: var(--nb-btn-danger-border, rgba(248, 113, 113, 0.24));
    background: var(--nb-btn-danger-bg, rgba(67, 20, 20, 0.62));
    color: var(--nb-btn-danger-color, rgba(254, 226, 226, 0.95));
  }

  :global(.panel-action-btn.danger:hover:not(:disabled)) {
    border-color: var(--nb-btn-danger-hover-border, rgba(252, 165, 165, 0.4));
    background: var(--nb-btn-danger-hover-bg, rgba(88, 24, 24, 0.76));
  }

  :global(.panel-action-btn.danger.armed) {
    border-color: var(--nb-btn-danger-hover-border, rgba(252, 165, 165, 0.84));
    background: var(--nb-danger, rgba(220, 38, 38, 0.86));
    color: var(--nb-accent-text, #fff5f5);
    box-shadow: 0 4px 12px color-mix(in srgb, var(--nb-danger, rgba(127, 29, 29, 0.24)) 24%, transparent);
  }

  .mount-add-btn,
  .header-tool-btn {
    border: 1px solid var(--nb-btn-border, rgba(56, 189, 248, 0.14));
    background: var(--nb-btn-bg, rgba(10, 19, 34, 0.52));
    color: var(--nb-btn-color, rgba(191, 219, 254, 0.78));
    border-radius: 999px;
    width: 36px;
    height: 36px;
    line-height: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    padding: 0;
    opacity: 0;
    pointer-events: none;
    transform: scale(0.94);
    transition:
      opacity 0.18s ease,
      transform 0.18s ease,
      background-color 0.18s ease,
      border-color 0.18s ease,
      color 0.18s ease,
      box-shadow 0.18s ease;
  }

  .header-tool-btn {
    opacity: 1;
    pointer-events: auto;
    transform: none;
  }

  .mount-add-btn {
    opacity: 1;
    pointer-events: auto;
    transform: none;
  }

  .mount-add-btn:hover,
  .header-tool-btn:hover {
    background: var(--nb-btn-hover-bg, rgba(16, 32, 56, 0.88));
    border-color: var(--nb-btn-hover-border, rgba(96, 165, 250, 0.28));
    color: var(--nb-btn-hover-color, rgba(224, 242, 254, 0.96));
  }

  .mount-add-btn:focus-visible,
  .header-tool-btn:focus-visible {
    outline: none;
    box-shadow: var(--nb-btn-focus-ring, inset 0 0 0 1px rgba(125, 211, 252, 0.18));
  }

  .header-tool-btn.active {
    border-color: var(--nb-btn-active-border, rgba(34, 211, 238, 0.42));
    background: var(--nb-btn-active-bg, linear-gradient(180deg, rgba(16, 66, 91, 0.92), rgba(10, 44, 66, 0.94)));
    color: var(--nb-btn-active-color, rgba(236, 254, 255, 0.98));
    box-shadow: var(--nb-btn-active-shadow, 0 10px 24px rgba(6, 182, 212, 0.16));
  }

  :global(.button-icon) {
    flex: 0 0 auto;
  }

  .status-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: var(--nb-text-soft, rgba(224, 224, 224, 0.7));
  }

  .status-label {
    font-weight: 500;
    color: var(--nb-text-faint, rgba(224, 224, 224, 0.5));
  }

  .status-value {
    font-family: 'Monaco', 'Menlo', monospace;
    font-size: 0.8125rem;
  }

  .volume-id-btn {
    background: var(--nb-btn-bg, rgba(12, 24, 43, 0.82));
    border: 1px solid var(--nb-btn-border, rgba(56, 189, 248, 0.24));
    border-radius: 999px;
    padding: 0.32rem 0.82rem;
    font-family: 'Monaco', 'Menlo', monospace;
    font-size: 0.8125rem;
    color: var(--nb-accent, rgba(125, 211, 252, 0.96));
    cursor: pointer;
    transition: background-color 0.18s ease, border-color 0.18s ease;
    position: relative;
  }

  .volume-id-btn:hover {
    background: var(--nb-btn-hover-bg, rgba(16, 32, 56, 0.96));
    border-color: var(--nb-btn-hover-border, rgba(96, 165, 250, 0.34));
  }

  .mount-dialog-status-section {
    gap: 0.85rem;
  }

  .mount-dialog-status-grid {
    display: grid;
    gap: 0.7rem;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  }

  .mount-dialog-status-item {
    min-width: 0;
    align-items: flex-start;
    flex-direction: column;
    gap: 0.35rem;
    padding: 0.78rem 0.86rem;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(56, 189, 248, 0.12)) 88%, transparent);
    border-radius: 14px;
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 96%, rgba(249, 244, 240, 0.88));
  }

  .mount-dialog-status-error {
    grid-column: 1 / -1;
  }

  .mount-dialog-status-actions {
    display: flex;
    justify-content: flex-start;
  }

  .copied-indicator {
    margin-left: 0.5rem;
    color: var(--nb-success, #4ade80);
    font-size: 0.75rem;
  }

  .status-link-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .status-link-btn {
    appearance: none;
    border: 1px solid var(--nb-btn-border, rgba(56, 189, 248, 0.24));
    border-radius: 999px;
    background: var(--nb-btn-bg, rgba(12, 24, 43, 0.82));
    color: var(--nb-btn-color, rgba(226, 232, 240, 0.92));
    box-sizing: border-box;
    min-height: 34px;
    height: 34px;
    padding: 0 0.8rem;
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    cursor: pointer;
    font: inherit;
    font-size: 0.78rem;
    font-weight: 600;
    transition: background-color 0.18s ease, border-color 0.18s ease;
  }

  .status-link-btn.secondary {
    background: var(--nb-btn-bg, rgba(8, 17, 31, 0.8));
  }

  .status-link-btn:hover:not(:disabled) {
    background: var(--nb-btn-hover-bg, rgba(16, 32, 56, 0.96));
    border-color: var(--nb-btn-hover-border, rgba(96, 165, 250, 0.34));
  }

  .status-link-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .status-link-feedback {
    font-size: 0.75rem;
    color: var(--nb-success, #86efac);
  }

  .status-link-feedback.warning {
    color: var(--nb-warning, #facc15);
  }

  .status-storage-list {
    display: grid;
    gap: 0.65rem;
  }

  .status-storage-card {
    display: grid;
    gap: 0.55rem;
    padding: 0.72rem 0.78rem;
    border-radius: 14px;
    border: 1px solid var(--nb-border, rgba(96, 165, 250, 0.12));
    background: var(--nb-btn-bg, rgba(8, 15, 27, 0.64));
  }

  .status-storage-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.55rem;
  }

  .status-storage-provider,
  .status-storage-title {
    margin: 0;
  }

  .status-storage-provider {
    color: var(--nb-accent, rgba(125, 211, 252, 0.8));
    font-size: 0.68rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  .status-storage-title {
    color: var(--nb-text-main, rgba(226, 232, 240, 0.96));
    font-size: 0.82rem;
    font-weight: 600;
  }

  .status-storage-state {
    color: var(--nb-text-soft, rgba(191, 219, 254, 0.72));
    font-size: 0.74rem;
  }

  .status-storage-invite-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 0.55rem;
    align-items: center;
  }

  .status-storage-input {
    min-height: 32px;
    border-radius: 14px;
    border: 1px solid var(--nb-border, rgba(56, 189, 248, 0.2));
    background: var(--nb-btn-bg, rgba(10, 18, 31, 0.9));
    color: var(--nb-text-main, rgba(226, 232, 240, 0.96));
    padding: 0 0.7rem;
    font: inherit;
    font-size: 0.77rem;
  }

  .status-storage-members {
    display: grid;
    gap: 0.4rem;
  }

  .status-storage-members-list {
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
  }

  .members-label {
    margin: 0;
  }

  .status-storage-chip {
    display: inline-flex;
    align-items: center;
    min-height: 24px;
    padding: 0.16rem 0.62rem;
    border-radius: 999px;
    border: 1px solid var(--nb-border, rgba(96, 165, 250, 0.16));
    background: var(--nb-btn-bg, rgba(12, 23, 41, 0.82));
    color: var(--nb-text-soft, rgba(191, 219, 254, 0.88));
    font-size: 0.72rem;
    line-height: 1.2;
  }

  .offline-indicator {
    color: var(--nb-warning, #fbbf24);
  }

  .history-indicator {
    color: var(--nb-accent, #7dd3fc);
  }

  .error-indicator {
    color: var(--nb-danger, #f87171);
  }

  .refresh-btn {
    background: var(--nb-btn-bg, rgba(12, 24, 43, 0.82));
    border: 1px solid var(--nb-btn-border, rgba(56, 189, 248, 0.24));
    border-radius: 999px;
    min-height: 32px;
    padding: 0 0.8rem;
    color: var(--nb-btn-color, rgba(226, 232, 240, 0.92));
    cursor: pointer;
    font-size: 0.78rem;
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    transition: background-color 0.18s ease, border-color 0.18s ease;
    margin-left: auto;
  }

  .refresh-btn:hover {
    background: var(--nb-btn-hover-bg, rgba(16, 32, 56, 0.96));
    border-color: var(--nb-btn-hover-border, rgba(96, 165, 250, 0.34));
  }

  .refresh-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  /* File area */
  .file-area {
    flex: 1 1 auto;
    min-height: 0;
    height: 100%;
    padding: 2rem;
    overflow: hidden;
    transition: background-color 0.3s ease;
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .file-area.volume-workspace-active {
    padding: 0;
  }

  .workspace-panel-view {
    flex: 1 1 auto;
    min-height: 0;
    width: 100%;
    overflow: auto;
    scrollbar-width: thin;
  }

  .toast-stack {
    position: fixed;
    right: 1.25rem;
    bottom: 1.25rem;
    z-index: 40;
    display: grid;
    gap: 0.85rem;
    width: min(420px, calc(100vw - 2rem));
  }

  .update-toast,
  .discovery-toast {
    width: min(420px, calc(100vw - 2rem));
    display: grid;
    gap: 0.9rem;
    padding: 0.95rem 1rem 1rem;
    border: 1px solid rgba(56, 189, 248, 0.22);
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 98%, var(--nb-shell-bottom, #f4f4f7));
    box-shadow:
      0 22px 44px rgba(2, 6, 23, 0.42),
      inset 0 1px 0 rgba(255, 255, 255, 0.03);
  }

  .update-toast {
    position: relative;
    border-color: rgba(96, 165, 250, 0.28);
  }

  .update-toast-copy,
  .discovery-toast-copy {
    display: grid;
    gap: 0.32rem;
    padding-right: 2rem;
  }

  .update-toast-copy p,
  .discovery-toast-copy p {
    margin: 0;
  }

  .update-toast-title,
  .discovery-toast-title {
    font-size: 0.84rem;
    font-weight: 700;
    color: var(--nb-text-main, rgba(236, 254, 255, 0.98));
  }

  .update-toast-copy :not(.update-toast-title),
  .discovery-toast-copy :not(.discovery-toast-title) {
    font-size: 0.79rem;
    line-height: 1.45;
    color: var(--nb-text-soft, rgba(191, 219, 254, 0.82));
  }

  .update-toast-progress {
    position: relative;
    width: 100%;
    height: 0.44rem;
    border-radius: 999px;
    overflow: hidden;
    background: var(--nb-panel-bg, rgba(30, 41, 59, 0.88));
  }

  .update-toast-progress-bar {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: color-mix(in srgb, var(--nb-accent, rgba(255, 59, 48, 1)) 28%, white);
    box-shadow: none;
  }

  .update-toast-meta {
    margin: -0.2rem 0 0;
    font-size: 0.74rem;
    color: var(--nb-text-soft, rgba(191, 219, 254, 0.72));
  }

  .update-toast-actions,
  .discovery-toast-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
  }

  .update-toast-btn,
  .discovery-toast-btn {
    appearance: none;
    border: 1px solid var(--nb-btn-border, rgba(56, 189, 248, 0.24));
    border-radius: 999px;
    background: var(--nb-btn-bg, rgba(12, 24, 43, 0.82));
    color: var(--nb-btn-color, rgba(226, 232, 240, 0.92));
    min-height: 34px;
    padding: 0 0.82rem;
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    cursor: pointer;
    font: inherit;
    font-size: 0.78rem;
    font-weight: 600;
    transition:
      background-color 0.18s ease,
      border-color 0.18s ease,
      color 0.18s ease;
  }

  .update-toast-btn:hover,
  .discovery-toast-btn:hover {
    background: var(--nb-btn-hover-bg, rgba(16, 32, 56, 0.96));
    border-color: var(--nb-btn-hover-border, rgba(96, 165, 250, 0.34));
  }

  .discovery-toast-close {
    position: absolute;
    top: 0.7rem;
    right: 0.72rem;
    appearance: none;
    border: 0;
    background: transparent;
    color: var(--nb-text-soft, rgba(191, 219, 254, 0.7));
    cursor: pointer;
    padding: 0.12rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: color 0.18s ease;
  }

  .discovery-toast-close:hover {
    color: var(--nb-text-main, rgba(236, 254, 255, 0.95));
  }

  .workspace-mode-bar {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    align-self: stretch;
    margin: 0;
    padding: 0.32rem;
    border-radius: 14px;
    border: 1px solid var(--nb-border, rgba(60, 60, 67, 0.12));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 98%, var(--nb-shell-bottom, #f4f4f7));
    backdrop-filter: blur(12px);
    flex: 0 0 auto;
    flex-wrap: wrap;
  }

  .workspace-mode-primary,
  .workspace-mode-secondary {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
    flex-wrap: wrap;
    font-family: var(--nb-font-body, 'Avenir Next', 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif);
  }

  .workspace-mode-secondary {
    margin-left: auto;
    justify-content: flex-end;
    flex: 1 1 420px;
  }

  .workspace-utility-actions {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    margin-left: auto;
    flex: 0 0 auto;
  }

  .workspace-selection-summary {
    font-size: 0.74rem;
    font-weight: 460;
    letter-spacing: 0.02em;
    color: var(--nb-text-faint, rgba(186, 230, 253, 0.72));
    white-space: nowrap;
  }

  .workspace-compact-control {
    min-width: 0;
  }

  .workspace-mode-secondary .manager-search {
    width: min(28vw, 240px);
  }

  .workspace-mode-secondary .manager-sort {
    width: min(24vw, 180px);
  }

  .workspace-toolbar-btn {
    flex: 0 0 auto;
  }

  .workspace-toolbar-utility.active {
    border-color: var(--nb-btn-active-border, rgba(34, 211, 238, 0.42));
    background: var(--nb-btn-active-bg, linear-gradient(180deg, rgba(16, 66, 91, 0.92), rgba(10, 44, 66, 0.94)));
    color: var(--nb-btn-active-color, rgba(236, 254, 255, 0.98));
    box-shadow: var(--nb-btn-active-shadow, 0 10px 24px rgba(6, 182, 212, 0.16));
  }

  .workspace-mode-btn {
    appearance: none;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 92%, transparent);
    background: transparent;
    color: var(--nb-text-soft, rgba(191, 219, 254, 0.72));
    border-radius: 999px;
    min-height: 34px;
    padding: 0 0.86rem;
    display: inline-flex;
    align-items: center;
    gap: 0.42rem;
    font: inherit;
    font-size: 0.76rem;
    font-weight: 600;
    cursor: pointer;
    transition:
      color 0.18s ease,
      border-color 0.18s ease,
      background-color 0.18s ease,
      box-shadow 0.18s ease;
  }

  .workspace-mode-btn:hover {
    color: var(--nb-btn-hover-color, rgba(224, 242, 254, 0.94));
    background: var(--nb-btn-bg, rgba(12, 26, 46, 0.9));
    border-color: var(--nb-btn-border, rgba(96, 165, 250, 0.18));
  }

  .workspace-mode-btn.active {
    color: rgba(255, 251, 245, 0.94);
    background: var(--nb-btn-active-bg, color-mix(in srgb, var(--nb-accent, #ff3b30) 12%, var(--nb-panel-bg, white)));
    border-color: color-mix(in srgb, var(--nb-accent, #ff3b30) 26%, var(--nb-border-strong, rgba(166, 151, 136, 0.18)));
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04), inset 0 1px 0 rgba(255, 255, 255, 0.12);
  }

  .volume-workspace {
    max-width: none;
    margin: 0;
    width: 100%;
    padding: 0.85rem 1rem 1rem;
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    min-height: 0;
    flex: 1 1 auto;
    overflow: hidden;
  }

  .workspace-panels {
    flex: 1 1 auto;
    min-height: 0;
    width: 100%;
    display: grid;
    gap: 0;
    align-items: stretch;
  }

  .workspace-pane {
    min-width: 0;
    min-height: 0;
    display: flex;
    overflow: hidden;
    width: 100%;
  }

  .volume-transition-state {
    min-height: 420px;
    border: 1px solid var(--nb-border, rgba(56, 189, 248, 0.18));
    border-radius: 22px;
    background: var(--nb-volume-transition-bg, linear-gradient(160deg, rgba(8, 18, 34, 0.96), rgba(7, 14, 28, 0.94)));
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    padding: 2rem;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
  }

  .volume-transition-spinner {
    width: 18px;
    height: 18px;
    border: 2px solid color-mix(in srgb, var(--nb-accent, rgba(125, 211, 252, 0.24)) 36%, transparent);
    border-top-color: var(--nb-accent, rgba(125, 211, 252, 0.96));
    border-radius: 999px;
    animation: spin 0.7s linear infinite;
    flex: 0 0 auto;
  }

  .volume-transition-copy {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  .volume-transition-title,
  .volume-transition-subtitle {
    margin: 0;
  }

  .volume-transition-title {
    font-size: 1rem;
    font-weight: 600;
    color: var(--nb-text-main, rgba(28, 28, 30, 0.96));
  }

  .volume-transition-subtitle {
    font-size: 0.88rem;
    color: var(--nb-text-soft, rgba(58, 58, 60, 0.72));
  }

  .time-machine {
    flex: 0 0 auto;
    border: 1px solid var(--nb-border, rgba(60, 60, 67, 0.12));
    border-radius: 16px;
    background: var(--nb-time-machine-bg, color-mix(in srgb, var(--nb-panel-bg, #ffffff) 98%, var(--nb-shell-bottom, #f4f4f7)));
    padding: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    min-height: auto;
    overflow: hidden;
  }

  .time-machine-head {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    align-items: flex-start;
  }

  .time-machine-eyebrow {
    margin: 0;
    font-size: 0.75rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--nb-accent, rgba(125, 211, 252, 0.78));
  }

  .time-machine-marker {
    margin: 0.25rem 0 0;
    font-size: 0.875rem;
    color: var(--nb-text-main, rgba(226, 232, 240, 0.92));
    font-weight: 520;
  }

  .time-machine-actions {
    display: flex;
    gap: 0.5rem;
  }

  .tm-btn {
    border: 1px solid var(--nb-btn-border, rgba(56, 189, 248, 0.22));
    border-radius: 999px;
    background: var(--nb-btn-bg, rgba(12, 24, 43, 0.82));
    color: var(--nb-btn-color, #dbeafe);
    min-height: 34px;
    padding: 0 0.8rem;
    cursor: pointer;
    font-size: 0.78rem;
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.45rem;
  }

  .tm-btn.live {
    border-color: color-mix(in srgb, var(--nb-accent, #ff3b30) 24%, transparent);
    background: var(--nb-btn-active-bg, color-mix(in srgb, var(--nb-accent, #ff3b30) 10%, var(--nb-panel-bg, white)));
    color: var(--nb-btn-active-color, rgba(28, 28, 30, 0.98));
  }

  .tm-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .time-machine-track {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .tm-slider {
    width: 100%;
    accent-color: #38bdf8;
  }

  .tm-scale {
    display: flex;
    justify-content: space-between;
    font-size: 0.75rem;
    color: var(--nb-text-soft, rgba(191, 219, 254, 0.8));
  }

  .tm-events {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(132px, 162px);
    gap: 0.42rem;
    align-items: start;
    overflow-x: auto;
    overflow-y: hidden;
    padding: 0.15rem 1rem 0.32rem 0;
    scroll-padding-inline-end: 1rem;
    scrollbar-width: none;
    box-sizing: border-box;
  }

  .tm-events::after {
    content: '';
    display: block;
    width: 0.55rem;
  }

  .tm-events::-webkit-scrollbar {
    display: none;
  }

  .tm-event {
    --tm-event-bg: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 98%, var(--nb-shell-bottom, #f4f4f7));
    --tm-event-border: color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 94%, transparent);
    --tm-event-kind-color: var(--nb-text-soft, rgba(58, 58, 60, 0.72));
    border: 1px solid var(--tm-event-border);
    border-radius: 14px;
    background: color-mix(in srgb, var(--tm-event-bg) 56%, rgba(255, 255, 255, 0.98));
    color: var(--nb-text-main, rgba(28, 28, 30, 0.96));
    display: grid;
    gap: 0.15rem;
    padding: 0.42rem 0.5rem;
    text-align: left;
    cursor: pointer;
    transition: border-color 0.18s ease, background 0.18s ease, opacity 0.18s ease, transform 0.18s ease, filter 0.18s ease;
    box-sizing: border-box;
    min-width: 0;
    max-width: 100%;
    overflow: hidden;
    outline: none;
    opacity: 0.54;
    border-style: dashed;
    transform: translateY(1px) scale(0.985);
    filter: saturate(0.7);
  }

  .tm-event-row {
    display: grid;
    gap: 0.32rem;
    min-width: 0;
  }

  .tm-event-details {
    border: 1px solid var(--nb-btn-border, rgba(148, 163, 184, 0.2));
    border-radius: 8px;
    background: var(--nb-btn-bg, rgba(12, 22, 41, 0.6));
    color: var(--nb-btn-color, rgba(226, 232, 240, 0.85));
    font-size: 0.64rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 0.3rem 0.4rem;
    cursor: pointer;
    transition: border-color 0.18s ease, background 0.18s ease, color 0.18s ease;
  }

  .tm-event-details:hover {
    border-color: var(--nb-btn-hover-border, rgba(56, 189, 248, 0.4));
    background: var(--nb-btn-hover-bg, rgba(14, 116, 144, 0.22));
    color: var(--nb-btn-hover-color, #e0f2fe);
  }

  .tm-event-details:focus-visible {
    outline: none;
    box-shadow: var(--nb-btn-focus-ring, inset 0 0 0 1px rgba(125, 211, 252, 0.7));
  }

  .tm-event:focus-visible {
    box-shadow: var(--nb-btn-focus-ring, inset 0 0 0 1px rgba(125, 211, 252, 0.7));
  }

  .tm-event.applied {
    opacity: 1;
    border-style: solid;
    background: var(--tm-event-bg);
    transform: none;
    filter: none;
    box-shadow: inset 3px 0 0 rgba(97, 114, 67, 0.38);
  }

  .tm-event.current {
    opacity: 1;
    border-style: solid;
    border-color: color-mix(in srgb, var(--nb-text-main, rgba(28, 28, 30, 1)) 12%, transparent);
    background: var(--tm-event-bg);
    transform: translateY(-1px);
    filter: none;
    box-shadow:
      inset 3px 0 0 rgba(28, 28, 30, 0.42),
      0 1px 2px rgba(0, 0, 0, 0.05);
  }

  .tm-event.create {
    --tm-event-bg: rgba(206, 233, 250, 0.78);
    --tm-event-border: rgba(130, 172, 204, 0.28);
    --tm-event-kind-color: #35506b;
  }

  .tm-event.delete {
    --tm-event-bg: rgba(242, 222, 189, 0.84);
    --tm-event-border: rgba(168, 137, 96, 0.28);
    --tm-event-kind-color: #87613a;
  }

  .tm-event.rename {
    --tm-event-bg: rgba(231, 217, 248, 0.82);
    --tm-event-border: rgba(153, 130, 184, 0.26);
    --tm-event-kind-color: #6c4d88;
  }

  .tm-event.identity {
    --tm-event-bg: rgba(224, 235, 200, 0.82);
    --tm-event-border: rgba(143, 165, 110, 0.28);
    --tm-event-kind-color: #617243;
  }

  .tm-event.chat {
    --tm-event-bg: rgba(244, 224, 208, 0.84);
    --tm-event-border: rgba(204, 152, 120, 0.28);
    --tm-event-kind-color: #8b6148;
  }

  .tm-event-kind {
    font-size: 0.64rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--tm-event-kind-color);
    font-weight: 560;
  }

  .tm-event-name {
    font-size: 0.77rem;
    font-weight: 520;
    display: -webkit-box;
    overflow: hidden;
    text-overflow: ellipsis;
    line-clamp: 2;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    line-height: 1.25;
    min-height: calc(1.25em * 2);
  }

  .tm-event-time {
    font-size: 0.68rem;
    color: var(--nb-text-soft, rgba(191, 219, 254, 0.85));
    font-weight: 450;
  }

  .tm-empty {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--nb-text-soft, rgba(186, 230, 253, 0.7));
  }

  .tm-details-backdrop {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.5rem;
    background: rgba(2, 6, 23, 0.72);
    backdrop-filter: blur(8px);
    z-index: 200;
  }

  .share-dialog-backdrop {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.5rem;
    background: rgba(2, 6, 23, 0.76);
    backdrop-filter: blur(10px);
    z-index: 220;
  }

  .join-dialog-backdrop {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.5rem;
    background: rgba(2, 6, 23, 0.8);
    backdrop-filter: blur(12px);
    z-index: 225;
  }

  .theme-dialog-backdrop {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.5rem;
    background: rgba(2, 6, 23, 0.82);
    backdrop-filter: blur(14px);
    z-index: 230;
  }

  .mount-dialog-backdrop {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.5rem;
    background: rgba(246, 238, 232, 0.72);
    backdrop-filter: blur(18px);
    z-index: 235;
  }

  .mount-dialog {
    width: min(720px, 94vw);
    max-height: 88vh;
    display: flex;
    flex-direction: column;
    background: linear-gradient(180deg, color-mix(in srgb, var(--nb-panel-bg, #ffffff) 98%, rgba(255, 246, 240, 0.9)), color-mix(in srgb, var(--nb-shell-bottom, #f4f4f7) 92%, rgba(255, 250, 247, 0.88)));
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.16)) 80%, rgba(210, 122, 84, 0.18));
    border-radius: 24px;
    box-shadow: 0 26px 90px rgba(93, 56, 34, 0.16);
  }

  .share-dialog {
    width: min(760px, 95vw);
    max-height: 86vh;
    display: flex;
    flex-direction: column;
    background: linear-gradient(180deg, color-mix(in srgb, var(--nb-panel-bg, #ffffff) 99%, rgba(255, 248, 244, 0.9)), color-mix(in srgb, var(--nb-shell-bottom, #f4f4f7) 96%, rgba(250, 242, 236, 0.92)));
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 90%, rgba(210, 122, 84, 0.12));
    border-radius: 22px;
    box-shadow: 0 24px 72px rgba(82, 53, 33, 0.12);
  }

  .join-dialog {
    width: min(760px, 95vw);
    max-height: 86vh;
    display: flex;
    flex-direction: column;
    background: linear-gradient(180deg, color-mix(in srgb, var(--nb-panel-bg, #ffffff) 99%, rgba(255, 247, 241, 0.9)), color-mix(in srgb, var(--nb-shell-bottom, #f4f4f7) 95%, rgba(251, 243, 236, 0.92)));
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 88%, rgba(210, 122, 84, 0.16));
    border-radius: 22px;
    box-shadow: 0 24px 72px rgba(82, 53, 33, 0.12);
  }

  .theme-dialog {
    width: min(920px, 96vw);
    max-height: 88vh;
    display: flex;
    flex-direction: column;
    background: linear-gradient(180deg, color-mix(in srgb, var(--nb-panel-bg, #ffffff) 98%, rgba(255, 247, 241, 0.94)), color-mix(in srgb, var(--nb-shell-bottom, #f4f4f7) 96%, rgba(248, 239, 232, 0.92)));
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 88%, rgba(210, 122, 84, 0.14));
    border-radius: 24px;
    box-shadow: 0 24px 80px rgba(82, 53, 33, 0.12);
  }

  .mount-dialog-header,
  .share-dialog-header,
  .join-dialog-header,
  .theme-dialog-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
  }

  .mount-dialog-header {
    padding: 1.35rem 1.45rem 1rem;
    border-bottom: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 86%, rgba(210, 122, 84, 0.12));
  }

  .share-dialog-header {
    padding: 1.2rem 1.3rem 0.95rem;
    border-bottom: 1px solid var(--nb-border, rgba(148, 163, 184, 0.14));
  }

  .join-dialog-header {
    padding: 1.2rem 1.3rem 0.95rem;
    border-bottom: 1px solid var(--nb-border, rgba(148, 163, 184, 0.14));
  }

  .theme-dialog-header {
    padding: 1.3rem 1.4rem 1rem;
    border-bottom: 1px solid var(--nb-border, rgba(148, 163, 184, 0.14));
  }

  .mount-dialog-head-meta,
  .share-dialog-head-meta,
  .join-dialog-head-meta,
  .theme-dialog-head-meta {
    display: grid;
    min-width: 0;
  }

  .mount-dialog-head-meta {
    gap: 0.38rem;
  }

  .share-dialog-head-meta {
    gap: 0.34rem;
  }

  .join-dialog-head-meta {
    gap: 0.34rem;
  }

  .theme-dialog-head-meta {
    gap: 0.36rem;
  }

  .mount-dialog-eyebrow,
  .theme-dialog-eyebrow,
  .share-dialog-eyebrow,
  .join-dialog-eyebrow {
    margin: 0;
    font-family: var(--nb-font-body, 'SF Pro Text', 'Avenir Next', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif);
    font-size: 0.68rem;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: color-mix(in srgb, var(--nb-accent-strong, #b85f39) 72%, rgba(110, 110, 115, 0.8));
  }

  .mount-dialog-title,
  .theme-dialog-title,
  .share-dialog-title,
  .join-dialog-title {
    margin: 0;
    font-family: var(--nb-font-display, 'Avenir Next', 'SF Pro Display', 'Helvetica Neue', Arial, sans-serif);
    font-size: 1.16rem;
    font-weight: 650;
    color: var(--nb-text-main, rgba(28, 28, 30, 0.96));
  }

  .mount-dialog-subtitle,
  .theme-dialog-subtitle,
  .share-dialog-subtitle,
  .join-dialog-subtitle {
    margin: 0;
    font-size: 0.84rem;
    line-height: 1.55;
    color: var(--nb-text-soft, rgba(70, 70, 73, 0.78));
  }

  .mount-dialog-subtitle {
    max-width: 58ch;
  }

  .mount-dialog-mode-switch {
    display: inline-flex;
    align-items: center;
    gap: 0.32rem;
    padding: 0.2rem;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 84%, rgba(210, 122, 84, 0.1));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 94%, rgba(249, 244, 240, 0.82));
  }

  .mount-dialog-mode-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    min-height: 32px;
    padding: 0.4rem 0.72rem;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: var(--nb-text-soft, rgba(70, 70, 73, 0.82));
    font-size: 0.78rem;
    font-weight: 600;
    letter-spacing: 0.01em;
    transition:
      background-color 160ms ease,
      color 160ms ease,
      box-shadow 160ms ease;
  }

  .mount-dialog-mode-btn:hover,
  .mount-dialog-mode-btn:focus-visible {
    color: var(--nb-text-main, rgba(28, 28, 30, 0.96));
  }

  .mount-dialog-mode-btn.active {
    background: color-mix(in srgb, var(--nb-accent, #d27a54) 14%, rgba(255, 255, 255, 0.92));
    color: var(--nb-text-main, rgba(28, 28, 30, 0.96));
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--nb-accent, #d27a54) 16%, transparent);
  }

  .mount-dialog-mode-btn:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--nb-accent, #d27a54) 34%, transparent);
    outline-offset: 2px;
  }

  .theme-dialog-subtitle {
    max-width: 62ch;
    max-width: 54ch;
  }

  .join-dialog-subtitle {
    max-width: 58ch;
  }

  .mount-dialog-body,
  .share-dialog-body,
  .join-dialog-body,
  .theme-dialog-body {
    overflow: auto;
    display: grid;
  }

  .mount-dialog-body {
    gap: 0.95rem;
    padding: 1.1rem 1.45rem 1.35rem;
  }

  .share-dialog-body {
    gap: 0.95rem;
    padding: 1rem 1.3rem 1.3rem;
  }

  .join-dialog-body {
    gap: 0.95rem;
    padding: 1rem 1.3rem 1.3rem;
  }

  .theme-dialog-body {
    gap: 1rem;
    padding: 1rem 1.3rem 1.3rem;
  }

  .mount-dialog-section,
  .share-dialog-section,
  .join-dialog-section,
  .theme-dialog-section {
    display: grid;
  }

  .mount-dialog-section {
    gap: 0.8rem;
    padding: 1rem 1.05rem;
    border-radius: 18px;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 90%, rgba(210, 122, 84, 0.1));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 97%, rgba(255, 245, 239, 0.9));
  }

  .share-dialog-section {
    gap: 0.7rem;
    padding: 1rem;
    border-radius: 16px;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 90%, rgba(210, 122, 84, 0.08));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 98%, rgba(252, 244, 238, 0.86));
  }

  .join-dialog-section {
    gap: 0.78rem;
    padding: 1rem;
    border-radius: 16px;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 88%, rgba(210, 122, 84, 0.1));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 98%, rgba(252, 244, 238, 0.88));
  }

  .theme-dialog-section {
    gap: 0.9rem;
    padding: 1rem;
    border-radius: 18px;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 88%, rgba(210, 122, 84, 0.1));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 97%, rgba(252, 244, 238, 0.88));
  }

  .theme-dialog-hero {
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
  }

  .theme-dialog-preview-mark {
    display: inline-flex;
    padding: 0.8rem;
    border-radius: 24px;
    background: color-mix(in srgb, var(--nb-logo-bg, #f7efe9) 70%, rgba(255, 247, 241, 0.95));
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 82%, rgba(210, 122, 84, 0.12));
  }

  .theme-dialog-preview-copy {
    display: grid;
    gap: 0.45rem;
  }

  .theme-dialog-note {
    margin: 0;
    color: var(--nb-text-soft, rgba(70, 70, 73, 0.76));
    font-size: 0.84rem;
    line-height: 1.55;
  }

  .theme-form-grid-wide {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .theme-dialog-chip-row,
  .theme-dialog-tab-row,
  .theme-dialog-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.65rem;
  }

  .theme-dialog-status {
    margin: 0;
    padding: 0.85rem 1rem;
    border-radius: 12px;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 78%, rgba(210, 122, 84, 0.16));
    background: color-mix(in srgb, var(--nb-accent-soft, rgba(210, 122, 84, 0.08)) 72%, rgba(255, 250, 247, 0.98));
    color: var(--nb-text-main, rgba(28, 28, 30, 0.96));
    font-size: 0.88rem;
  }

  .theme-dialog-status.success {
    border-color: color-mix(in srgb, var(--nb-success, #86efac) 40%, transparent);
    background: var(--nb-success-surface, rgba(134, 239, 172, 0.12));
  }

  .theme-dialog-status.warning {
    border-color: color-mix(in srgb, var(--nb-warning, #fde68a) 40%, transparent);
    background: var(--nb-warning-surface, rgba(253, 230, 138, 0.12));
  }

  .theme-dialog-status.error {
    border-color: color-mix(in srgb, var(--nb-danger, #fecaca) 42%, transparent);
    background: var(--nb-danger-surface, rgba(254, 202, 202, 0.12));
  }

  .theme-studio-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.38rem 0.72rem;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 88%, rgba(210, 122, 84, 0.08));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 92%, rgba(252, 244, 238, 0.92));
    color: var(--nb-text-soft, rgba(70, 70, 73, 0.78));
    font-family: var(--nb-font-body, 'SF Pro Text', 'Avenir Next', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif);
    font-size: 0.76rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .theme-studio-chip.strong {
    border-color: color-mix(in srgb, var(--nb-accent, #d27a54) 28%, rgba(60, 60, 67, 0.16));
    background: color-mix(in srgb, var(--nb-accent-soft, rgba(210, 122, 84, 0.08)) 85%, rgba(255, 247, 241, 0.98));
    color: color-mix(in srgb, var(--nb-accent-strong, #b85f39) 70%, rgba(28, 28, 30, 0.96));
  }

  .theme-dialog-tab {
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 90%, rgba(210, 122, 84, 0.1));
    background: var(--nb-btn-bg, color-mix(in srgb, var(--nb-panel-bg, #ffffff) 96%, var(--nb-shell-bottom, #f4f4f7)));
    color: var(--nb-text-soft, rgba(70, 70, 73, 0.88));
    border-radius: 999px;
    min-height: 34px;
    padding: 0 0.95rem;
    font-family: var(--nb-font-body, 'SF Pro Text', 'Avenir Next', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif);
    font-size: 0.82rem;
    font-weight: 600;
    cursor: pointer;
  }

  .theme-dialog-tab.active {
    border-color: color-mix(in srgb, var(--nb-accent, #d27a54) 26%, rgba(60, 60, 67, 0.14));
    background: color-mix(in srgb, var(--nb-accent-soft, rgba(210, 122, 84, 0.08)) 86%, var(--nb-panel-bg, white));
    color: color-mix(in srgb, var(--nb-accent-strong, #b85f39) 78%, rgba(28, 28, 30, 0.96));
  }

  .theme-preset-grid,
  .theme-form-grid {
    display: grid;
    gap: 0.8rem;
  }

  .theme-preset-grid {
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  }

  .theme-preset-card {
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 90%, rgba(210, 122, 84, 0.08));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 98%, rgba(252, 244, 238, 0.86));
    border-radius: 18px;
    padding: 0.95rem;
    display: grid;
    gap: 0.75rem;
    color: inherit;
    cursor: pointer;
    text-align: left;
  }

  .theme-preset-card.active {
    border-color: color-mix(in srgb, var(--nb-accent, #d27a54) 24%, rgba(60, 60, 67, 0.14));
    background: color-mix(in srgb, var(--nb-accent-soft, rgba(210, 122, 84, 0.08)) 82%, var(--nb-panel-bg, white));
  }

  .theme-preset-swatches {
    display: flex;
    gap: 0.5rem;
  }

  .theme-preset-swatches span {
    width: 38px;
    height: 38px;
    border-radius: 12px;
    border: 1px solid rgba(255, 255, 255, 0.08);
  }

  .theme-preset-copy {
    display: grid;
    gap: 0.18rem;
  }

  .theme-preset-copy strong {
    font-family: var(--nb-font-display, 'Avenir Next', 'SF Pro Display', 'Helvetica Neue', Arial, sans-serif);
    font-size: 0.92rem;
    color: var(--nb-text-main, rgba(28, 28, 30, 0.96));
  }

  .theme-preset-copy span {
    font-size: 0.8rem;
    line-height: 1.45;
    color: var(--nb-text-soft, rgba(70, 70, 73, 0.78));
  }

  .theme-form-grid {
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  }

  .theme-form-grid.logo-grid {
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  }

  .theme-form-grid label {
    display: grid;
    gap: 0.45rem;
    color: var(--nb-text-soft, rgba(70, 70, 73, 0.78));
    font-family: var(--nb-font-body, 'SF Pro Text', 'Avenir Next', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif);
    font-size: 0.8rem;
  }

  .theme-form-grid input[type='color'],
  .theme-form-grid input[type='range'],
  .theme-form-grid select {
    width: 100%;
  }

  .theme-form-grid input[type='color'],
  .theme-form-grid select {
    min-height: 40px;
    border-radius: 12px;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 90%, rgba(210, 122, 84, 0.08));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 96%, rgba(252, 244, 238, 0.88));
    color: var(--nb-text-main, rgba(28, 28, 30, 0.96));
    padding: 0.45rem 0.6rem;
  }

  .theme-form-grid em {
    font-style: normal;
    font-size: 0.75rem;
    color: var(--nb-text-faint, rgba(110, 110, 115, 0.66));
  }

  .mount-dialog .secret-input-wrapper {
    display: grid;
    gap: 0.72rem;
  }

  .mount-dialog :global(.secret-seed-fields.dense) {
    grid-template-columns: minmax(0, 1.5fr) minmax(172px, 0.92fr);
    gap: 0.6rem;
  }

  .mount-dialog :global(.secret-seed-fields.dense span) {
    color: var(--nb-text-faint, rgba(110, 110, 115, 0.76));
  }

  .mount-dialog-hint-row {
    align-items: center;
    gap: 0.75rem;
  }

  .mount-dialog-secret-card {
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 98%, rgba(252, 244, 238, 0.92));
  }

  .mount-dialog-actions {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 180px), 1fr));
    align-items: stretch;
    gap: 0.7rem;
  }

  .mount-dialog-actions > .workspace-toggle,
  .mount-dialog-actions :global(.hub-storage-button),
  .mount-dialog-actions :global(.panel-action-btn) {
    width: 100%;
    min-width: 0;
    max-width: none;
  }

  .share-dialog-section-title {
    font-family: var(--nb-font-display, 'Avenir Next', 'SF Pro Display', 'Helvetica Neue', Arial, sans-serif);
    font-size: 0.88rem;
    font-weight: 600;
    color: color-mix(in srgb, var(--nb-accent-strong, #b85f39) 28%, var(--nb-text-main, rgba(28, 28, 30, 0.96)));
  }

  .join-dialog-section-title {
    margin: 0;
    font-family: var(--nb-font-display, 'Avenir Next', 'SF Pro Display', 'Helvetica Neue', Arial, sans-serif);
    font-size: 0.88rem;
    font-weight: 600;
    color: color-mix(in srgb, var(--nb-accent-strong, #b85f39) 28%, var(--nb-text-main, rgba(28, 28, 30, 0.96)));
  }

  .join-dialog-input-shell {
    gap: 0.9rem;
  }

  .join-dialog-input-head,
  .join-dialog-preview-head,
  .join-dialog-result-head,
  .join-dialog-route-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .join-dialog-textarea {
    width: 100%;
    min-height: 8.75rem;
    resize: vertical;
    border-radius: 16px;
    border: 1px solid var(--nb-border, rgba(60, 60, 67, 0.12));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 96%, var(--nb-shell-bottom, #f4f4f7));
    color: var(--nb-text-main, rgba(28, 28, 30, 0.96));
    padding: 0.95rem 1rem;
    font: 0.92rem/1.45 "Cascadia Code", "Fira Code", Consolas, monospace;
  }

  .join-dialog-textarea:focus {
    outline: none;
    border-color: color-mix(in srgb, var(--nb-accent, #d27a54) 44%, transparent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--nb-accent-soft, rgba(210, 122, 84, 0.08)) 90%, transparent);
  }

  .join-dialog-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.55rem;
    color: var(--nb-text-main, rgba(28, 28, 30, 0.9));
    font-size: 0.86rem;
  }

  .join-dialog-note,
  .join-dialog-route-detail,
  .join-dialog-path,
  .join-dialog-message {
    margin: 0;
    font-size: 0.82rem;
    line-height: 1.5;
    color: var(--nb-text-soft, rgba(70, 70, 73, 0.76));
  }

  .join-dialog-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.65rem;
  }

  .join-dialog-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.34rem 0.65rem;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 88%, rgba(210, 122, 84, 0.08));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 96%, rgba(252, 244, 238, 0.88));
    color: var(--nb-text-main, rgba(28, 28, 30, 0.9));
    font-size: 0.75rem;
    font-weight: 600;
  }

  .join-dialog-chip.strong {
    border-color: color-mix(in srgb, var(--nb-accent, #d27a54) 26%, rgba(60, 60, 67, 0.14));
    background: color-mix(in srgb, var(--nb-accent-soft, rgba(210, 122, 84, 0.08)) 82%, rgba(255, 247, 241, 0.98));
    color: color-mix(in srgb, var(--nb-accent-strong, #b85f39) 74%, rgba(28, 28, 30, 0.96));
  }

  .join-dialog-chip.warning {
    border-color: color-mix(in srgb, #d4945f 34%, rgba(60, 60, 67, 0.14));
    background: rgba(242, 223, 206, 0.86);
    color: rgba(126, 76, 34, 0.96);
  }

  .join-dialog-route-list,
  .join-dialog-result-list {
    display: grid;
    gap: 0.75rem;
  }

  .join-dialog-route-card,
  .join-dialog-result-row {
    display: grid;
    gap: 0.55rem;
    padding: 0.9rem 0.95rem;
    border-radius: 14px;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 88%, rgba(210, 122, 84, 0.08));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 97%, rgba(252, 244, 238, 0.88));
  }

  .join-dialog-result-row {
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: start;
  }

  .join-dialog-result-row.success {
    border-color: rgba(104, 170, 117, 0.24);
    background: rgba(232, 242, 233, 0.94);
  }

  .join-dialog-result-row.warning {
    border-color: rgba(212, 148, 95, 0.28);
    background: rgba(247, 236, 225, 0.94);
  }

  .join-dialog-route-title {
    margin: 0;
    font-size: 0.88rem;
    font-weight: 600;
    color: var(--nb-text-main, rgba(28, 28, 30, 0.96));
  }

  .join-dialog-badge-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
  }

  .join-dialog-badge-row.action-badges {
    margin-top: 0.45rem;
  }

  .join-dialog-badge {
    display: inline-flex;
    align-items: center;
    padding: 0.26rem 0.5rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 95%, rgba(252, 244, 238, 0.88));
    border: 1px solid color-mix(in srgb, var(--nb-accent, #d27a54) 14%, rgba(60, 60, 67, 0.12));
    color: var(--nb-text-soft, rgba(70, 70, 73, 0.86));
    font-size: 0.72rem;
  }

  .join-dialog-message.error {
    color: rgba(166, 63, 63, 0.94);
  }

  .share-dialog-empty {
    display: grid;
    gap: 0.3rem;
    padding: 0.9rem 0.95rem;
    border-radius: 14px;
    border: 1px dashed color-mix(in srgb, var(--nb-accent, #d27a54) 22%, rgba(60, 60, 67, 0.14));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 95%, rgba(252, 244, 238, 0.88));
  }

  .share-dialog-empty-title {
    margin: 0;
    font-size: 0.84rem;
    font-weight: 600;
    color: var(--nb-text-main, rgba(28, 28, 30, 0.94));
  }

  .share-dialog-storage-list {
    gap: 0.8rem;
  }

  .tm-details-modal {
    width: min(860px, 95vw);
    max-height: 86vh;
    display: flex;
    flex-direction: column;
    gap: 0;
    background: var(--nb-dialog-bg, linear-gradient(180deg, rgba(9, 18, 34, 0.98), rgba(6, 12, 24, 0.96)));
    border: 1px solid var(--nb-border, rgba(148, 163, 184, 0.2));
    border-radius: 18px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.18);
  }

  .tm-details-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    padding: 1.1rem 1.3rem 0.8rem;
    border-bottom: 1px solid var(--nb-border, rgba(148, 163, 184, 0.16));
  }

  .tm-details-head-meta {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    min-width: 0;
  }

  .tm-details-eyebrow {
    margin: 0;
    font-size: 0.65rem;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--nb-accent, rgba(125, 211, 252, 0.7));
  }

  .tm-details-title {
    margin: 0;
    font-size: 1.05rem;
    font-weight: 600;
    color: var(--nb-text-main, #e2e8f0);
    word-break: break-word;
  }

  .tm-details-subtitle {
    margin: 0;
    font-size: 0.72rem;
    color: var(--nb-text-soft, rgba(191, 219, 254, 0.7));
  }

  .tm-details-close {
    border: 1px solid var(--nb-border, rgba(148, 163, 184, 0.22));
    border-radius: 999px;
    background: var(--nb-btn-bg, rgba(15, 23, 42, 0.6));
    color: var(--nb-text-main, rgba(226, 232, 240, 0.9));
    padding: 0.35rem;
    cursor: pointer;
    transition: border-color 0.18s ease, background 0.18s ease;
  }

  .tm-details-close:hover {
    border-color: var(--nb-btn-hover-border, rgba(96, 165, 250, 0.5));
    background: var(--nb-btn-hover-bg, rgba(30, 64, 175, 0.3));
  }

  .tm-details-body {
    padding: 1rem 1.3rem 1.2rem;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .tm-details-meta {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    font-size: 0.7rem;
    color: var(--nb-text-faint, rgba(148, 163, 184, 0.9));
  }

  .tm-details-hash {
    margin: 0;
    font-family: 'Monaco', 'Menlo', monospace;
    font-size: 0.7rem;
    color: var(--nb-text-main, rgba(226, 232, 240, 0.85));
    word-break: break-all;
  }

  .tm-details-hint {
    margin: 0;
    font-size: 0.66rem;
    color: var(--nb-text-faint, rgba(148, 163, 184, 0.8));
  }

  .tm-details-loading {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    font-size: 0.82rem;
    color: var(--nb-text-soft, rgba(191, 219, 254, 0.8));
  }

  .tm-details-error {
    margin: 0;
    font-size: 0.82rem;
    color: var(--nb-btn-danger-color, rgba(252, 165, 165, 0.9));
  }

  .tm-details-empty {
    margin: 0;
    font-size: 0.82rem;
    color: var(--nb-text-soft, rgba(191, 219, 254, 0.8));
  }

  .tm-details-pre {
    margin: 0;
    background: var(--nb-panel-bg, rgba(8, 14, 28, 0.7));
    border: 1px solid var(--nb-border, rgba(148, 163, 184, 0.18));
    border-radius: 14px;
    padding: 0.85rem 0.95rem;
    font-family: 'Monaco', 'Menlo', monospace;
    font-size: 0.78rem;
    line-height: 1.5;
    color: var(--nb-text-main, rgba(226, 232, 240, 0.95));
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 56vh;
    overflow: auto;
  }

  .tm-details-section {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .tm-details-debug-section {
    padding: 0.75rem 0.8rem;
    border-radius: 14px;
    border: 1px solid color-mix(in srgb, var(--nb-accent, rgba(125, 211, 252, 0.75)) 22%, var(--nb-border, rgba(148, 163, 184, 0.2)));
    background: color-mix(in srgb, var(--nb-panel-bg, rgba(8, 14, 28, 0.7)) 96%, rgba(14, 116, 144, 0.18));
  }

  .tm-details-path-shell {
    display: grid;
    gap: 0.36rem;
    padding: 0.6rem 0.66rem;
    border-radius: 12px;
    border: 1px solid var(--nb-border, rgba(148, 163, 184, 0.18));
    background: color-mix(in srgb, var(--nb-panel-bg, rgba(9, 16, 30, 0.7)) 94%, rgba(56, 189, 248, 0.08));
  }

  .tm-details-path-row {
    display: grid;
    grid-template-columns: minmax(96px, 120px) minmax(0, 1fr);
    gap: 0.55rem;
    align-items: start;
  }

  .tm-details-hit-list {
    display: grid;
    gap: 0.5rem;
  }

  .tm-details-hit-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 0.65rem;
    align-items: start;
    padding: 0.62rem 0.68rem;
    border-radius: 12px;
    border: 1px solid rgba(148, 163, 184, 0.16);
    background: rgba(9, 16, 30, 0.68);
  }

  .tm-details-hit-copy {
    display: grid;
    gap: 0.24rem;
    min-width: 0;
  }

  .tm-details-hit-title {
    margin: 0;
    font-size: 0.76rem;
    font-weight: 620;
    color: rgba(226, 232, 240, 0.95);
  }

  .tm-details-hit-meta {
    margin: 0;
    font-size: 0.67rem;
    color: rgba(148, 163, 184, 0.86);
  }

  .tm-details-hit-path {
    margin: 0;
    font-size: 0.68rem;
    color: rgba(191, 219, 254, 0.9);
    word-break: break-all;
  }

  .tm-details-hit-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
  }

  .tm-details-section-title {
    margin: 0;
    font-size: 0.65rem;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--nb-accent, rgba(125, 211, 252, 0.7));
  }

  .tm-details-section-note {
    margin: 0;
    font-size: 0.66rem;
    color: var(--nb-text-faint, rgba(148, 163, 184, 0.8));
    line-height: 1.4;
  }

  .tm-details-grid {
    display: grid;
    gap: 0.4rem;
  }

  .tm-details-grid-row {
    display: grid;
    grid-template-columns: minmax(0, 140px) minmax(0, 1fr);
    gap: 0.6rem;
    align-items: start;
  }

  .tm-details-label {
    font-size: 0.7rem;
    color: var(--nb-text-faint, rgba(148, 163, 184, 0.85));
    text-transform: lowercase;
  }

  .tm-details-value {
    font-size: 0.78rem;
    color: var(--nb-text-main, rgba(226, 232, 240, 0.92));
    word-break: break-word;
  }

  .tm-details-value-group {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  .tm-details-value.mono {
    font-family: 'Monaco', 'Menlo', monospace;
    font-size: 0.72rem;
  }

  .tm-details-help {
    font-size: 0.66rem;
    color: var(--nb-text-faint, rgba(148, 163, 184, 0.75));
    line-height: 1.35;
  }

  .tm-details-action-row {
    display: flex;
    justify-content: flex-start;
  }

  .tm-details-spec-list {
    display: grid;
    gap: 0.6rem;
  }

  .tm-details-spec-card {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 0.8rem;
    padding: 0.7rem 0.85rem;
    border-radius: 14px;
    border: 1px solid var(--nb-border, rgba(148, 163, 184, 0.16));
    background: var(--nb-panel-bg, rgba(9, 16, 30, 0.7));
  }

  .tm-details-spec-copy {
    display: flex;
    flex-direction: column;
    gap: 0.28rem;
  }

  .tm-details-spec-title {
    margin: 0;
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--nb-text-main, rgba(226, 232, 240, 0.96));
  }

  .tm-details-spec-meta {
    margin: 0;
    font-size: 0.7rem;
    color: var(--nb-text-faint, rgba(148, 163, 184, 0.85));
  }

  .tm-details-spec-file {
    margin: 0;
    font-size: 0.66rem;
    color: rgba(148, 163, 184, 0.7);
    word-break: break-all;
  }

  .tm-details-spec-actions {
    display: flex;
    align-items: center;
  }

  .tm-spec-modal {
    width: min(920px, 96vw);
    max-height: 88vh;
    display: flex;
    flex-direction: column;
    gap: 0;
    background: linear-gradient(180deg, rgba(9, 18, 34, 0.98), rgba(6, 12, 24, 0.96));
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 16px;
    box-shadow: 0 30px 80px rgba(2, 6, 23, 0.5);
  }

  .tm-spec-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    padding: 1.1rem 1.3rem 0.8rem;
    border-bottom: 1px solid rgba(148, 163, 184, 0.16);
  }

  .tm-spec-head-meta {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 0;
  }

  .tm-spec-title {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
    color: #e2e8f0;
  }

  .tm-spec-subtitle {
    margin: 0;
    font-size: 0.7rem;
    color: rgba(148, 163, 184, 0.8);
  }

  .tm-spec-body {
    padding: 1rem 1.3rem 1.2rem;
    overflow: auto;
  }

  .tm-details-ref-list {
    display: grid;
    gap: 0.7rem;
  }

  .tm-details-ref-row {
    display: grid;
    gap: 0.6rem;
    padding: 0.7rem 0.8rem;
    border-radius: 12px;
    border: 1px solid rgba(148, 163, 184, 0.16);
    background: rgba(9, 16, 30, 0.7);
  }

  .tm-details-ref-copy {
    display: flex;
    flex-direction: column;
    gap: 0.28rem;
  }

  .tm-details-ref-name {
    margin: 0;
    font-size: 0.78rem;
    font-weight: 600;
    color: rgba(226, 232, 240, 0.95);
  }

  .tm-details-ref-meta {
    margin: 0;
    font-size: 0.7rem;
    color: rgba(148, 163, 184, 0.85);
    word-break: break-all;
  }

  .tm-details-ref-hash {
    margin: 0;
    font-size: 0.72rem;
    color: rgba(226, 232, 240, 0.9);
    word-break: break-all;
  }

  .tm-details-ref-actions {
    display: flex;
    justify-content: flex-end;
  }

  .tm-details-ref-btn {
    border: 1px solid var(--nb-btn-border, rgba(148, 163, 184, 0.2));
    border-radius: 8px;
    background: var(--nb-btn-bg, rgba(12, 22, 41, 0.6));
    color: var(--nb-btn-color, rgba(226, 232, 240, 0.85));
    font-size: 0.66rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 0.35rem 0.5rem;
    cursor: pointer;
    transition: border-color 0.18s ease, background 0.18s ease, color 0.18s ease;
  }

  .tm-details-ref-btn:hover:not(:disabled) {
    border-color: var(--nb-btn-hover-border, rgba(56, 189, 248, 0.4));
    background: var(--nb-btn-hover-bg, rgba(14, 116, 144, 0.22));
    color: var(--nb-btn-hover-color, #e0f2fe);
  }

  .tm-details-ref-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .tm-details-ref-btn.link {
    width: 100%;
    text-align: left;
  }

  .mono {
    font-family: 'Monaco', 'Menlo', monospace;
  }

  .tm-details-media {
    width: 100%;
    border-radius: 14px;
    border: 1px solid var(--nb-border, rgba(148, 163, 184, 0.16));
    background: var(--nb-panel-bg, rgba(8, 14, 28, 0.7));
  }

  .tm-details-embed {
    width: 100%;
    min-height: 360px;
    border-radius: 14px;
    border: 1px solid var(--nb-border, rgba(148, 163, 184, 0.16));
    background: var(--nb-panel-bg, rgba(8, 14, 28, 0.7));
  }

  .file-area.dragging {
    background: color-mix(in srgb, var(--nb-accent, rgba(255, 59, 48, 1)) 8%, var(--nb-panel-bg, #ffffff));
  }

  .empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
  }

  .empty-content {
    text-align: center;
    max-width: 520px;
    display: grid;
    gap: 0.7rem;
    justify-items: center;
  }

  .empty-brand-shell {
    padding: 0.75rem;
    border-radius: 28px;
    background: color-mix(in srgb, var(--nb-accent, rgba(255, 59, 48, 1)) 6%, var(--nb-panel-bg, #ffffff));
    border: 1px solid var(--nb-border, rgba(56, 189, 248, 0.18));
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
  }

  .empty-eyebrow {
    margin: 0;
    font-size: 0.76rem;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--nb-accent-strong, rgba(125, 211, 252, 0.8));
  }

  .empty-hint {
    font-size: 1.25rem;
    color: var(--nb-text-main, rgba(224, 224, 224, 0.8));
    margin: 0 0 0.5rem;
  }

  .empty-subhint {
    font-size: 0.9375rem;
    color: var(--nb-text-soft, rgba(224, 224, 224, 0.5));
    margin: 0;
    max-width: 52ch;
  }

  /* File manager */
  .file-manager {
    flex: 1 1 auto;
    min-height: 0;
    width: 100%;
    display: grid;
    gap: 0;
    align-items: stretch;
    font-family: var(--nb-font-body, 'Avenir Next', 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif);
  }

  .file-list-pane,
  .preview-pane {
    min-height: 0;
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 97%, var(--nb-shell-bottom, #f4f4f7));
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(56, 189, 248, 0.16)) 88%, transparent);
    border-radius: 18px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    height: 100%;
  }

  .file-list-pane {
    border-top-right-radius: 18px;
    border-bottom-right-radius: 18px;
  }

  .file-list-pane.with-preview {
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
  }

  .manager-search,
  .manager-sort,
  .manager-folder {
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(56, 189, 248, 0.22)) 88%, transparent);
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 96%, var(--nb-shell-bottom, #f4f4f7));
    color: var(--nb-text-main, rgba(28, 28, 30, 0.98));
    border-radius: 12px;
    min-height: 38px;
    padding: 0 0.8rem;
    font-size: 0.875rem;
    font-weight: 470;
    outline: none;
  }

  .manager-search:focus,
  .manager-sort:focus,
  .manager-folder:focus {
    border-color: color-mix(in srgb, var(--nb-border-strong, rgba(56, 189, 248, 0.52)) 92%, transparent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--nb-accent, rgba(14, 165, 233, 0.12)) 22%, transparent);
  }

  .manager-folder {
    min-width: 0;
  }

  .manager-view-switch {
    display: inline-flex;
    align-items: center;
    gap: 0.32rem;
    padding: 0.22rem;
    border-radius: 14px;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(56, 189, 248, 0.18)) 90%, transparent);
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 96%, var(--nb-shell-bottom, #f4f4f7));
  }

  .view-toggle {
    width: 34px;
    height: 34px;
    border: 0;
    border-radius: 10px;
    background: transparent;
    color: var(--nb-text-faint, rgba(186, 230, 253, 0.72));
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background-color 0.18s ease, color 0.18s ease, transform 0.18s ease;
  }

  .view-toggle:hover {
    color: var(--nb-text-main, rgba(28, 28, 30, 0.96));
    background: color-mix(in srgb, var(--nb-accent, rgba(14, 165, 233, 0.12)) 20%, transparent);
  }

  .view-toggle.active {
    color: var(--nb-btn-active-color, rgba(28, 28, 30, 0.98));
    background: var(--nb-btn-active-bg, color-mix(in srgb, var(--nb-accent, #ff3b30) 12%, var(--nb-panel-bg, white)));
    box-shadow: var(--nb-btn-active-shadow, 0 4px 12px rgba(6, 182, 212, 0.14));
  }

  .file-list-head {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    gap: 0.75rem;
    padding: 0 0.9rem 0.55rem;
    font-size: 0.75rem;
    font-weight: 520;
    letter-spacing: 0.02em;
    color: color-mix(in srgb, var(--nb-text-soft, rgba(224, 224, 224, 0.56)) 70%, transparent);
    border-bottom: 1px solid color-mix(in srgb, var(--nb-border, rgba(102, 126, 234, 0.12)) 68%, transparent);
    position: sticky;
    top: 0;
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 98%, var(--nb-shell-bottom, #f4f4f7));
    z-index: 1;
  }

  .file-list-sort {
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    letter-spacing: inherit;
    text-align: left;
    padding: 0;
    cursor: pointer;
  }

  .file-list-sort:hover {
    color: rgba(236, 254, 255, 0.92);
  }

  .file-list-sort-wrap[data-sort='ascending'] .file-list-sort::after {
    content: ' ↑';
  }

  .file-list-sort-wrap[data-sort='descending'] .file-list-sort::after {
    content: ' ↓';
  }

  .file-list-scroll {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    scrollbar-width: thin;
    padding: 0.2rem;
  }

  .file-list-scroll.icons {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    align-content: start;
    gap: 0.7rem;
    padding: 0.9rem;
  }

  .file-list-clear-hitbox {
    appearance: none;
    border: 0;
    background: transparent;
    display: block;
    width: 100%;
    min-height: 3rem;
    padding: 0;
    margin: 0;
    cursor: default;
  }

  .file-list-scroll.icons .file-list-clear-hitbox {
    grid-column: 1 / -1;
  }

  .file-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    gap: 0.75rem;
    align-items: center;
    padding: 0.65rem 0.75rem;
    cursor: grab;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
    transition: background 0.15s ease, border-color 0.15s ease;
  }

  .file-row:hover {
    background: color-mix(in srgb, var(--nb-accent, rgba(102, 126, 234, 0.08)) 14%, transparent);
  }

  .file-row:active {
    cursor: grabbing;
  }

  .file-row.selected {
    background: color-mix(in srgb, var(--nb-accent, rgba(102, 126, 234, 0.16)) 22%, transparent);
  }

  .file-row:focus {
    outline: 2px solid color-mix(in srgb, var(--nb-border-strong, rgba(102, 126, 234, 0.5)) 92%, transparent);
    outline-offset: -2px;
  }

  .file-row-main {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.7rem;
  }

  .file-row-icon {
    flex: 0 0 auto;
    width: 28px;
    height: 28px;
    border-radius: 9px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid rgba(255, 255, 255, 0.07);
    background: rgba(10, 18, 33, 0.84);
  }

  .file-row-copy {
    min-width: 0;
    display: grid;
    gap: 0.08rem;
  }

  .file-row-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--nb-text-main, #e8e8e8);
    font-size: 0.83rem;
    font-weight: 540;
  }

  .file-row-path {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: color-mix(in srgb, var(--nb-text-faint, rgba(186, 230, 253, 0.45)) 76%, transparent);
    font-size: 0.72rem;
    font-weight: 440;
  }

  .file-rename-input {
    width: 100%;
    min-height: 32px;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(56, 189, 248, 0.26)) 92%, transparent);
    border-radius: 10px;
    background: color-mix(in srgb, var(--nb-shell-bottom, rgba(10, 18, 33, 0.9)) 94%, transparent);
    color: var(--nb-text-main, #f8fafc);
    padding: 0 0.68rem;
    font: inherit;
    outline: none;
  }

  .file-rename-input:focus {
    border-color: color-mix(in srgb, var(--nb-border-strong, rgba(56, 189, 248, 0.52)) 92%, transparent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--nb-accent, rgba(14, 165, 233, 0.12)) 22%, transparent);
  }

  .file-name-trigger {
    border: 0;
    background: transparent;
    padding: 0;
    text-align: left;
    font: inherit;
    cursor: text;
  }

  .file-row-size,
  .file-row-date {
    font-size: 0.75rem;
    color: var(--nb-text-faint, rgba(110, 110, 115, 0.58));
    font-weight: 430;
  }

  .file-card {
    min-height: 118px;
    border-radius: 18px;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(56, 189, 248, 0.12)) 84%, transparent);
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 98%, var(--nb-shell-bottom, #f4f4f7));
    padding: 0.9rem;
    display: grid;
    grid-template-rows: auto 1fr;
    justify-items: start;
    align-content: start;
    gap: 0.7rem;
    cursor: grab;
    transition: transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
  }

  .file-card:hover {
    border-color: color-mix(in srgb, var(--nb-accent-strong, rgba(103, 232, 249, 0.28)) 62%, transparent);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  }

  .file-card.selected {
    border-color: color-mix(in srgb, var(--nb-accent-strong, rgba(103, 232, 249, 0.44)) 74%, transparent);
    box-shadow:
      0 0 0 1px color-mix(in srgb, var(--nb-accent-strong, rgba(103, 232, 249, 0.12)) 28%, transparent),
      0 4px 12px rgba(0, 0, 0, 0.1);
  }

  .file-card-art {
    width: 58px;
    height: 58px;
    border-radius: 14px;
    display: grid;
    place-items: center;
    position: relative;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(255, 255, 255, 0.08)) 40%, transparent);
    overflow: hidden;
  }

  .file-card-copy {
    display: grid;
    gap: 0.18rem;
    min-width: 0;
    width: 100%;
  }

  .file-card-name {
    font-size: 0.88rem;
    font-weight: 570;
    color: var(--nb-text-main, rgba(248, 250, 252, 0.98));
    line-height: 1.3;
    display: -webkit-box;
    line-clamp: 2;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .tone-default {
    color: #35506b;
    background: rgba(202, 227, 249, 0.72);
  }

  .tone-image {
    color: #2d5d7b;
    background: rgba(206, 233, 250, 0.78);
  }

  .tone-video {
    color: #6c4d88;
    background: rgba(231, 217, 248, 0.82);
  }

  .tone-audio {
    color: #617243;
    background: rgba(224, 235, 200, 0.82);
  }

  .tone-text {
    color: #8d6a32;
    background: rgba(248, 228, 192, 0.82);
  }

  .tone-archive {
    color: #87613a;
    background: rgba(242, 222, 189, 0.84);
  }

  .list-empty {
    padding: 1rem;
    color: var(--nb-text-soft, rgba(58, 58, 60, 0.65));
    font-size: 0.875rem;
  }

  .preview-pane {
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
  }

  .preview-header {
    padding: 1rem;
    border-bottom: 1px solid color-mix(in srgb, var(--nb-border, rgba(102, 126, 234, 0.18)) 84%, transparent);
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    align-items: flex-start;
  }

  .preview-title {
    margin: 0;
    color: var(--nb-text-main, rgba(28, 28, 30, 0.98));
    font-size: 1rem;
    font-weight: 560;
    max-width: 48ch;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .preview-meta {
    margin: 0.25rem 0 0;
    color: color-mix(in srgb, var(--nb-text-soft, rgba(58, 58, 60, 0.72)) 74%, transparent);
    font-size: 0.8125rem;
  }

  .preview-actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .preview-close-btn {
    margin-left: auto;
  }

  :global(.manager-btn) {
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(56, 189, 248, 0.22)) 88%, transparent);
    background: var(--nb-btn-bg, color-mix(in srgb, var(--nb-panel-bg, #ffffff) 96%, var(--nb-shell-bottom, #f4f4f7)));
    color: var(--nb-btn-color, rgba(28, 28, 30, 0.92));
    border-radius: 999px;
    box-sizing: border-box;
    min-height: 34px;
    height: 34px;
    padding: 0 0.82rem;
    font-size: 0.78rem;
    font-weight: 600;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.45rem;
  }

  :global(.manager-btn:hover) {
    background: var(--nb-btn-hover-bg, color-mix(in srgb, var(--nb-panel-bg, #ffffff) 90%, var(--nb-accent-soft, rgba(255, 59, 48, 0.08))));
  }

  :global(.manager-btn.danger) {
    border-color: rgba(248, 113, 113, 0.45);
    color: #fecaca;
  }

  :global(.manager-btn.danger:hover) {
    background: rgba(248, 113, 113, 0.16);
  }

  .file-manager-divider,
  .workspace-divider {
    position: relative;
    min-height: 0;
    cursor: col-resize;
    touch-action: none;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 0;
    background: transparent;
  }

  .file-manager-divider::before,
  .workspace-divider::before {
    content: '';
    width: 1px;
    height: 100%;
    background: color-mix(in srgb, var(--nb-border, rgba(56, 189, 248, 0.16)) 88%, transparent);
    transition: background 0.18s ease;
  }

  .file-manager-divider-grip,
  .workspace-divider-grip {
    position: absolute;
    width: 6px;
    height: 52px;
    border-radius: 999px;
    border: 0;
    background: color-mix(in srgb, var(--nb-text-faint, rgba(186, 230, 253, 0.06)) 18%, transparent);
    color: transparent;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    box-shadow: none;
    transition: background-color 0.18s ease;
  }

  .file-manager-divider:hover::before,
  .file-manager-divider:focus-visible::before,
  .workspace-divider:hover::before,
  .workspace-divider:focus-visible::before {
    background: color-mix(in srgb, var(--nb-accent, rgba(255, 59, 48, 1)) 18%, white);
  }

  .file-manager-divider:hover .file-manager-divider-grip,
  .file-manager-divider:focus-visible .file-manager-divider-grip,
  .workspace-divider:hover .workspace-divider-grip,
  .workspace-divider:focus-visible .workspace-divider-grip {
    background: color-mix(in srgb, var(--nb-text-soft, rgba(186, 230, 253, 0.14)) 28%, transparent);
  }

  .preview-body {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    padding: 1rem;
    scrollbar-width: thin;
  }

  .preview-image,
  .preview-media {
    width: 100%;
    max-height: 100%;
    object-fit: contain;
    border-radius: 8px;
    background: rgba(10, 10, 15, 0.5);
  }

  .preview-audio {
    width: 100%;
    margin-top: 0.5rem;
  }

  .preview-pdf {
    width: 100%;
    min-height: 420px;
    height: 100%;
    border: 0;
    border-radius: 8px;
    background: #fff;
  }

  .preview-text {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: 'Monaco', 'Menlo', monospace;
    font-size: 0.8125rem;
    line-height: 1.5;
    color: #d9d9d9;
  }

  .preview-message {
    margin: 0;
    color: rgba(224, 224, 224, 0.76);
  }

  .preview-message.error {
    color: #fca5a5;
  }

  .preview-empty {
    flex: 1 1 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    color: rgba(224, 224, 224, 0.65);
    font-size: 0.9375rem;
  }

  @media (max-width: 900px) {
    .header {
      padding: 0.7rem 1rem 0.9rem;
    }

    .header-dock {
      padding: 0.3rem 0.32rem 0.3rem 0.55rem;
    }

    .header-dock-actions {
      width: 100%;
      justify-content: flex-start;
    }

    .secret-input-wrapper {
      grid-template-columns: 1fr auto;
    }

    .file-area {
      padding: 1rem;
    }

    .file-area.volume-workspace-active {
      padding: 0;
    }

    .volume-workspace {
      margin: 0;
      width: 100%;
      padding: 0.75rem 0.8rem 0.85rem;
      gap: 0.75rem;
    }

    .workspace-panels {
      grid-template-columns: 1fr !important;
      grid-template-rows: auto auto;
      gap: 0.75rem;
    }

    .identity-editor-panel {
      grid-template-columns: 1fr;
    }

    .time-machine {
      padding: 0.75rem;
    }

    .tm-events {
      grid-auto-columns: minmax(132px, 160px);
    }

    .file-manager {
      grid-template-columns: 1fr !important;
      gap: 0.75rem;
    }

    .file-manager-divider,
    .workspace-divider {
      display: none;
    }

    .file-list-pane,
    .preview-pane {
      border-radius: 18px;
      min-height: 280px;
    }

    .preview-header {
      flex-direction: column;
      align-items: stretch;
    }

    .preview-actions {
      justify-content: flex-start;
    }

    .toast-stack {
      right: 1rem;
      bottom: 1rem;
      width: min(100%, calc(100vw - 1.5rem));
    }
  }

  @media (hover: none) {
    .mounts-actions {
      opacity: 1;
      pointer-events: auto;
      transform: none;
    }

    .mount-add-btn {
      opacity: 1;
      pointer-events: auto;
      transform: none;
    }

    .volume-chip.collapsed-shell.parked {
      max-width: min(72vw, 420px);
      opacity: 1;
      transform: none;
      pointer-events: auto;
      border-color: rgba(56, 189, 248, 0.22);
    }

  }

  @media (max-width: 640px) {
    .brand-meta-row {
      flex-direction: column;
      align-items: flex-start;
    }

    .brand-meta-row :global(.mount-rail),
    .brand-meta-row :global(.mount-rail-track) {
      width: 100%;
      justify-content: flex-start;
    }

    .brand-actions {
      width: 100%;
      justify-content: flex-start;
    }

    .mount-quick-actions {
      max-width: 100%;
    }

    .workspace-toggle {
      font-size: 0.72rem;
      min-width: auto;
      padding: 0 0.68rem;
    }

    :global(.panel-action-btn) {
      min-width: auto;
      width: 100%;
    }

    .mount-add-btn,
    .header-tool-btn {
      width: 30px;
      height: 30px;
    }

    .volume-chip-action-btn {
      width: 30px;
      min-width: 30px;
      height: 30px;
    }

    .secret-input-wrapper {
      grid-template-columns: 1fr;
      grid-template-areas:
        'fields'
        'spinner spinner spinner';
    }

    .secret-input-wrapper :global(.secret-seed-fields) {
      grid-area: fields;
    }

    .loading-spinner {
      grid-area: spinner;
      justify-self: start;
    }

    .header-dock-actions {
      flex-direction: column;
      align-items: stretch;
    }

    .identity-row-head,
    .identity-row-actions {
      align-items: stretch;
    }

    .time-machine-head {
      flex-direction: column;
    }

    .time-machine-actions {
      width: 100%;
      justify-content: space-between;
    }

    .workspace-mode-bar {
      align-items: stretch;
    }

    .brand-badge {
      flex-direction: column;
    }

    .brand-stack {
      width: 100%;
    }

    .workspace-mode-secondary {
      margin-left: 0;
      width: 100%;
      justify-content: flex-start;
    }

    .workspace-selection-summary {
      width: 100%;
      white-space: normal;
    }

    .workspace-mode-secondary .manager-search,
    .workspace-mode-secondary .manager-sort,
    .workspace-toolbar-btn {
      width: 100%;
    }

    .file-list-head {
      grid-template-columns: minmax(0, 1fr) auto;
    }

    .file-row {
      grid-template-columns: minmax(0, 1fr) auto;
    }

    .file-row-date {
      display: none;
    }

    .discovery-toast {
      left: 0.75rem;
      right: 0.75rem;
      bottom: 0.75rem;
      width: auto;
    }

    .discovery-toast-actions {
      flex-direction: column;
    }

    .discovery-toast-btn {
      width: 100%;
      justify-content: center;
    }
  }
</style>
