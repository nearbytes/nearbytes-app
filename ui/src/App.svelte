<script lang="ts">
  import { get } from 'svelte/store';
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
    getRootsConfig,
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
    type SerializedEventPayload,
    type SourceFileReference,
    type RecipientFileReference,
    type ReconcileSourcesResponse,
    type EventStorageLocationsResponse,
    type SourceReferenceBundle,
    type SourceProvider,
    type TimelineEvent,
    type RootsConfig,
    type VolumeDestinationConfig,
    type VolumeChatState,
  } from './lib/api.js';
  import { resolveActiveHubAuth } from './lib/activeHub.js';
  import { clearCache, getCachedFiles, setCachedFiles } from './lib/cache.js';
  import {
    readMirrorEventDetail,
    readMirrorTimelineSnapshot,
    readMirrorVolumeSnapshot,
  } from './lib/mirror/browserMirror.js';
  import {
    buildIdentitySecret,
    createConfiguredIdentity,
    hasConfiguredIdentitySecret,
    loadActiveIdentityId,
    loadConfiguredIdentities,
    loadVolumeIdentityAssignments,
    normalizeConfiguredIdentities,
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
  import {
    type DesktopRemoteFile,
    type DesktopUpdaterState,
    type PersistedUiState,
  } from './lib/host/desktopBridge.js';
  import {
    loadHostPersistedUiState,
    normalizePersistedUiState,
    saveHostPersistedUiState,
  } from './lib/host/persistedUiState.js';
  import {
    hasPhoneAutomationBridge,
    processPendingPhoneAutomationCommand,
  } from './lib/host/phoneAutomation.js';
  import { subscribePhoneAppState } from './lib/host/phonePersistence.js';
  import {
    canWipeStoredConfig,
    connectDesktopDeepLinks,
    exportDesktopLogoPng,
    fetchDesktopRemoteFile,
    getDesktopClipboardImageStatus,
    readDesktopClipboardImage,
    readDesktopUpdaterState,
    requestDesktopUpdateInstall,
    requestDesktopUpdateReleasePage,
    saveDesktopThemeRegistry,
    subscribeDesktopDeepLinks,
    subscribeDesktopUpdaterState,
    wipeStoredConfig,
  } from './lib/host/desktopShell.js';
  import { setDevContext } from '../../docs/specs/ui/system/dev.js';
  import './app-shell.css';
  import './lib/design/uiBridgeShared.js';
  import DevBadge from '../../docs/specs/ui/system/components/DevBadge.svelte';
  import CreateChooserDialog from '../../docs/specs/ui/system/components/CreateChooserDialog.svelte';
  import FileManagerWorkspace from '../../docs/specs/ui/system/components/FileManagerWorkspace.svelte';
  import IdentityManagerDialog from '../../docs/specs/ui/system/components/IdentityManagerDialog.svelte';
  import JoinDialog from '../../docs/specs/ui/system/components/JoinDialog.svelte';
  import MountDialog from '../../docs/specs/ui/system/components/MountDialog.svelte';
  import ResetDialog from '../../docs/specs/ui/system/components/ResetDialog.svelte';
  import ShareDialog from '../../docs/specs/ui/system/components/ShareDialog.svelte';
  import SpecDialog from '../../docs/specs/ui/system/components/SpecDialog.svelte';
  import MountRail from '../../docs/specs/ui/system/components/MountRail.svelte';
  import StatusNotice from '../../docs/specs/ui/system/components/StatusNotice.svelte';
  import StoragePanel from '../../docs/specs/ui/system/components/StoragePanel.svelte';
  import SystemToastStack from '../../docs/specs/ui/system/components/SystemToastStack.svelte';
  import ThemeStudioDialog from '../../docs/specs/ui/system/components/ThemeStudioDialog.svelte';
  import TimelineDetailDialog from '../../docs/specs/ui/system/components/TimelineDetailDialog.svelte';
  import VolumeStorageDialog from '../../docs/specs/ui/system/components/VolumeStorageDialog.svelte';
  import EventFlowPanel from '../../docs/specs/ui/system/components/EventFlowPanel.svelte';
  import VolumeChat from '../../docs/specs/ui/system/components/VolumeChat.svelte';
  import VolumeIdentity from '../../docs/specs/ui/system/components/VolumeIdentity.svelte';
  import PhoneOverflowMenu from '../../docs/specs/ui/system/components/PhoneOverflowMenu.svelte';
  import WorkspaceModeBar from '../../docs/specs/ui/system/components/WorkspaceModeBar.svelte';
  import WorkspaceSearchStrip from '../../docs/specs/ui/system/components/WorkspaceSearchStrip.svelte';
  import AppHeader from '../../docs/specs/ui/system/components/AppHeader.svelte';
  import WorkspaceStage from '../../docs/specs/ui/system/components/WorkspaceStage.svelte';
  import TimeMachinePanel from '../../docs/specs/ui/system/components/TimeMachinePanel.svelte';
  import EmptyStatePanel from '../../docs/specs/ui/system/components/EmptyStatePanel.svelte';
  import {
    createWorkspaceChromeState,
    createWorkspaceSelectionSummary,
    type WorkspaceChromeActions,
  } from '../../docs/specs/ui/system/workspaceChrome.js';
  import {
    createUiTransitionStore,
    normalizeUiTransitionState,
    type UiThemeDialogSection,
  } from '../../docs/specs/ui/system/uiTransitionStore.js';
  import {
    joinDialogAttachmentTitle,
  } from './lib/joinLinkPresentation.js';

  setDevContext(true);
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
    Activity,
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
  const isInAppThemeStudioEnabled = false;
  const sharedUiBridge = (
    globalThis as typeof globalThis & {
      NearbytesUiBridgeShared?: {
        createAppSnapshot?: (input: Record<string, unknown>) => unknown;
        publishAppSnapshot?: (snapshot: unknown) => void;
        clearAppSnapshot?: () => void;
      };
    }
  ).NearbytesUiBridgeShared;
  const SPEC_DOC_CONTENTS = import.meta.glob('../../docs/specs/**/*.md', {
    query: '?raw',
    import: 'default',
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
      id: 'hub-model-v0.2',
      title: 'Hub model v0.2',
      filename: 'hub-model-v0.2.md',
      summary: 'Hub log model and subsystem projection rules.',
      always: true,
    },
    {
      id: 'app-records-v0.2',
      title: 'App records v0.2',
      filename: 'app-records-v0.2.md',
      summary: 'APP_RECORD envelope + replay rules.',
      eventTypes: ['APP_RECORD'],
    },
    {
      id: 'chat-events-v0.2',
      title: 'Chat events v0.2',
      filename: 'chat-events-v0.2.md',
      summary: 'Chat message payloads, identities, and attachment references.',
      eventTypes: ['CHAT'],
    },
    {
      id: 'identity-management-v0.2',
      title: 'Identity management v0.2',
      filename: 'identity-management-v0.2.md',
      summary: 'Publishing and rotating chat identity material.',
      eventTypes: ['IDENTITY'],
    },
    {
      id: 'file-events-v0.3',
      title: 'File events v0.3',
      filename: 'file-events-v0.3.md',
      summary: 'Opaque file event envelope and projection semantics.',
      eventTypes: ['CREATE_FILE', 'DELETE_FILE'],
    },
    {
      id: 'file-commands-v0.2',
      title: 'File commands v0.2',
      filename: 'file-commands-v0.2.md',
      summary: 'Command payload formats before file-event projection.',
      eventTypes: ['CREATE_FILE', 'DELETE_FILE'],
    },
    {
      id: 'lan-sync-v0.3',
      title: 'LAN sync v0.3',
      filename: 'lan-sync-v0.3.md',
      summary: 'Receiver-driven LAN inventory sync over WebRTC.',
      always: true,
    },
    {
      id: 'data-correctness-v0.2',
      title: 'Data correctness v0.2',
      filename: 'data-correctness-v0.2.md',
      summary: 'Storage durability, integrity, and replay expectations.',
      always: true,
    },
  ];
  const NEARBYTES_JOIN_DEEP_LINK_MAX_LENGTH = 16_384;
  const DEFAULT_VOLUME_RESERVE_PERCENT = 5;

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

  type PersistedSourceDiscoveryUiState = {
    lastAcknowledgedRunKey: string;
    latestRunKey: string;
    latestResult: ReconcileSourcesResponse | null;
  };

  type PersistedDiscoveryResult = Pick<ReconcileSourcesResponse, 'runKey' | 'changed' | 'summary' | 'items'>;

  type ThemeDialogSection = UiThemeDialogSection;

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
    showSearchPane: boolean;
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
  type MountStorageMode = 'default' | 'custom' | 'unknown';

  type AppReferenceClipboard = {
    bundle: SourceReferenceBundle;
    itemCount: number;
  };

  const uiTransitionStore = createUiTransitionStore(
    normalizeUiTransitionState(loadPersistedUiStateLocally().uiMachine)
  );
  const uiTransitions = uiTransitionStore.transitions;

  function normalizeVolumeKey(value: string | null | undefined): string | null {
    if (typeof value !== 'string') {
      return null;
    }
    const normalized = value.trim().toLowerCase();
    return normalized || null;
  }

  function sanitizeMountStorageDestination(destination: VolumeDestinationConfig): VolumeDestinationConfig {
    return {
      ...destination,
      enabled: destination.enabled,
      storeEvents: destination.enabled,
      storeBlocks: destination.enabled,
      copySourceBlocks: destination.enabled,
      reservePercent: destination.reservePercent ?? DEFAULT_VOLUME_RESERVE_PERCENT,
      fullPolicy: 'block-writes',
    };
  }

  function mountStorageDestinationKey(destination: VolumeDestinationConfig): string {
    return JSON.stringify({
      sourceId: destination.sourceId,
      enabled: destination.enabled,
      storeEvents: destination.storeEvents,
      storeBlocks: destination.storeBlocks,
      copySourceBlocks: destination.copySourceBlocks,
      reservePercent: destination.reservePercent,
      fullPolicy: destination.fullPolicy,
    });
  }

  function mountStorageDestinationsEqual(
    left: readonly VolumeDestinationConfig[],
    right: readonly VolumeDestinationConfig[]
  ): boolean {
    if (left.length !== right.length) {
      return false;
    }
    const leftKeys = [...left].map(mountStorageDestinationKey).sort((a, b) => a.localeCompare(b));
    const rightKeys = [...right].map(mountStorageDestinationKey).sort((a, b) => a.localeCompare(b));
    return leftKeys.every((entry, index) => entry === rightKeys[index]);
  }

  function effectiveMountStorageDestinations(config: RootsConfig, targetVolumeId: string): VolumeDestinationConfig[] {
    const normalizedVolumeId = normalizeVolumeKey(targetVolumeId);
    const merged = new Map<string, VolumeDestinationConfig>();
    for (const destination of config.defaultVolume.destinations) {
      merged.set(destination.sourceId, sanitizeMountStorageDestination(destination));
    }
    if (!normalizedVolumeId) {
      return Array.from(merged.values());
    }
    const explicit = config.volumes.find((entry) => normalizeVolumeKey(entry.volumeId) === normalizedVolumeId);
    if (!explicit) {
      return Array.from(merged.values());
    }
    for (const destination of explicit.destinations) {
      merged.set(destination.sourceId, sanitizeMountStorageDestination(destination));
    }
    return Array.from(merged.values());
  }

  function resolveMountStorageMode(config: RootsConfig, targetVolumeId: string): MountStorageMode {
    const normalizedVolumeId = normalizeVolumeKey(targetVolumeId);
    if (!normalizedVolumeId) {
      return 'unknown';
    }
    const defaultDestinations = config.defaultVolume.destinations.map((destination) =>
      sanitizeMountStorageDestination(destination)
    );
    const effectiveDestinations = effectiveMountStorageDestinations(config, normalizedVolumeId);
    return mountStorageDestinationsEqual(effectiveDestinations, defaultDestinations) ? 'default' : 'custom';
  }

  type DiscoveryToastState = {
    runKey: string;
    message: string;
  };

  type JoinLinkCopyFeedbackState = {
    tone: 'success' | 'warning';
    message: string;
  };

  type IdentityManagerAction = 'idle' | 'publish' | 'join';

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
      showSearchPane: overrides.showSearchPane ?? false,
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
          (value.showSearchPane === undefined || typeof value.showSearchPane === 'boolean') &&
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
          showSearchPane: value.showSearchPane,
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
      showSearchPane: mount.showSearchPane,
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
    uiTransitions.openSourcesPanel();
  }

  function openVolumeStoragePanel(): void {
    sourceDiscoveryPanelFocus = null;
    uiTransitions.openVolumeStoragePanel();
  }

  function openMountStorageDialog(targetMountId: string | null = activeMountId): void {
    const targetMount = targetMountId ? mounts.find((mount) => mount.id === targetMountId) ?? null : activeMount;
    const targetVolumeId = normalizeVolumeKey(
      targetMount?.id === activeMountId ? shareableVolumeId ?? targetMount?.volumeId ?? null : targetMount?.volumeId ?? null
    );
    if (!targetMount || !targetVolumeId) {
      return;
    }
    sourceDiscoveryPanelFocus = null;
    mountStorageDialogMountId = targetMount.id;
    if (mountDialogMountId) {
      mountDialogMountId = null;
      mountDialogMode = 'secret';
      resetJoinDialogState();
    }
    if (secretPasteTargetMountId === targetMount.id) {
      secretPasteTargetMountId = null;
    }
    uiTransitions.openMountStorageDialog();
  }

  function closeMountStorageDialog(): void {
    uiTransitions.closeMountStorageDialog();
    mountStorageDialogMountId = null;
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

  function normalizeActiveMountId(value: unknown): string {
    return typeof value === 'string' ? value : '';
  }

  function normalizeVolumeIdentityAssignmentsState(value: unknown): Record<string, string> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(value).filter(([key, entry]) => typeof key === 'string' && typeof entry === 'string')
    );
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
    const passwordLabel = trimSecretPart(mount.password) !== '' ? ' · password' : '';
    if (trimSecretPart(mount.secretFileName) !== '') {
      return `${trimSecretPart(mount.secretFileName)} · file`;
    }
    const seedLabel = trimSecretPart(mount.address);
    if (seedLabel !== '') {
      return `${seedLabel}${passwordLabel}`;
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
    const digest = await crypto.subtle.digest('SHA-256', bytesToArrayBuffer(bytes));
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
    const blob = new Blob([bytesToArrayBuffer(bytes)], {
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

  function shouldShowDesktopUpdaterToast(state: DesktopUpdaterState | null): boolean {
    return state !== null && state.phase !== 'idle' && state.message.trim().length > 0;
  }

  async function handleDesktopUpdaterPrimaryAction(): Promise<void> {
    if (!desktopUpdaterState) {
      return;
    }
    if (desktopUpdaterState.canInstall && (await requestDesktopUpdateInstall())) {
      return;
    }
    await requestDesktopUpdateReleasePage();
  }

  async function openDesktopUpdaterReleasePage(): Promise<void> {
    await requestDesktopUpdateReleasePage();
  }

  function openResetDialog(): void {
    if (!canWipeStoredConfig()) {
      return;
    }
    resetDialogDeleteLocalData = false;
    resetDialogBusy = false;
    resetDialogError = '';
    uiTransitions.openResetDialog();
  }

  function closeResetDialog(): void {
    if (resetDialogBusy) {
      return;
    }
    uiTransitions.closeResetDialog();
    resetDialogDeleteLocalData = false;
    resetDialogError = '';
  }

  async function confirmStoredConfigReset(): Promise<void> {
    resetDialogBusy = true;
    resetDialogError = '';
    try {
      await wipeStoredConfig({
        deleteLocalData: resetDialogDeleteLocalData,
      });
    } catch (error) {
      resetDialogError = error instanceof Error ? error.message : 'Failed to wipe stored configuration';
      resetDialogBusy = false;
    }
  }

  function base64ToBytes(value: string): Uint8Array {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  }

  async function fileFromDesktopRemoteDrop(descriptor: RemoteDropDescriptor): Promise<File | null> {
    const fetched = await fetchDesktopRemoteFile(descriptor.url);
    if (!fetched) {
      return null;
    }
    const bytes = base64ToBytes(fetched.bytesBase64);
    const mimeType = trimSecretPart(fetched.mimeType) || descriptor.mimeType || 'application/octet-stream';
    let filename = trimSecretPart(fetched.filename) || trimSecretPart(descriptor.filename ?? '');
    if (filename === '') {
      filename = filenameFromUrl(descriptor.url);
    }
    if (!/\.[a-z0-9]+$/i.test(filename)) {
      filename = `${filename}${extensionFromMimeType(mimeType)}`;
    }

    return new File([bytesToArrayBuffer(bytes)], sanitizeDroppedFilename(filename), {
      type: mimeType,
      lastModified: Date.now(),
    });
  }

  async function fileFromClipboardImage(): Promise<File | null> {
    const clipboardFile = await readDesktopClipboardImage();
    if (!clipboardFile) {
      return null;
    }

    const bytes = base64ToBytes(clipboardFile.bytesBase64);
    const mimeType = trimSecretPart(clipboardFile.mimeType) || 'image/png';
    let filename = trimSecretPart(clipboardFile.filename) || 'clipboard-image';
    if (!/\.[a-z0-9]+$/i.test(filename)) {
      filename = `${filename}${extensionFromMimeType(mimeType)}`;
    }

    return new File([bytesToArrayBuffer(bytes)], sanitizeDroppedFilename(filename, 'clipboard-image'), {
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
  let previewFileOverride = $state<FileMetadata | null>(null);
  let timelineDetailEvent = $state<TimelineEvent | null>(null);
  let timelineDetailLoading = $state(false);
  let timelineDetailError = $state('');
  let timelineDetailPayload = $state<SerializedEvent | null>(null);
  let timelineDetailDecryptedPayload = $state<SerializedEventPayload | null>(null);
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
  let specModalDoc = $state<SpecDoc | null>(null);
  let specModalContent = $state('');
  let currentPreviewObjectUrl: string | null = null;
  const previewBlobCache = new Map<string, Blob>();
  const thumbnailLoadGuard = new Set<string>();
  let thumbnailUrls = $state(new Map<string, string>());
  const thumbnailBlobUrls: string[] = [];
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
  let uiMachineState = $state(get(uiTransitionStore));
  let themeRegistry = $state<NearbytesThemeRegistry>(defaultThemeRegistry());
  let themeSettings = $state<NearbytesThemeSettings>(defaultThemeSettings());
  let resetDialogDeleteLocalData = $state(false);
  let resetDialogBusy = $state(false);
  let resetDialogError = $state('');
  let themeDialogBusy = $state(false);
  let themeDialogFeedback = $state<{ tone: 'success' | 'warning'; message: string } | null>(null);
  let themeDialogError = $state('');
  let themeDialogLogoPreview = $state<any>(null);
  let hydratedThemeState = $state<unknown>(null);
  let isHeaderHovering = $state(false);
  let isSecretDropTarget = $state(false);

  function setHeaderHoveringFromSpec(value: boolean): void {
    isHeaderHovering = value;
  }

  function setSecretDropTargetFromSpec(value: boolean): void {
    isSecretDropTarget = value;
  }
  let timelinePlayTimer: ReturnType<typeof setInterval> | null = null;
  let mountStorageDialogMountId = $state<string | null>(null);
  let mountDialogStorageMode = $state<MountStorageMode>('unknown');
  let mountDialogStorageModeLoading = $state(false);
  let autoSyncEnabled = $state(false);
  let autoSyncStatus = $state<'idle' | 'connecting' | 'active' | 'unsupported' | 'error'>('idle');
  let isRefreshing = $state(false);
  let pressedMountId = $state<string | null>(null);
  let configuredIdentities = $state<ConfiguredIdentity[]>([]);
  let activeChatIdentityId = $state('');
  let volumeChatIdentityAssignments = $state<Record<string, string>>({});
  let phoneOverflowMenuElement = $state<HTMLElement | null>(null);
  let phoneOverflowMenuButtonElement = $state<HTMLButtonElement | null>(null);
  let identityManagerLoading = $state(false);
  let identityManagerAction = $state<IdentityManagerAction>('idle');
  let identityManagerMessage = $state('');
  let identityManagerError = $state('');
  let identityAvatarFileInput = $state<HTMLInputElement | null>(null);
  let identityHydrated = false;
  let chatRefreshVersion = $state(0);
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
  let joinDialogSerialized = $state('');
  let joinDialogAllowCredentialBootstrap = $state(false);
  let joinDialogPreview = $state<JoinLinkParseResponse | JoinLinkOpenResponse | null>(null);
  let joinDialogOpened = $state<JoinLinkOpenResponse | null>(null);
  let joinDialogError = $state('');
  let joinDialogClipboardBusy = $state(false);
  let joinDialogPreviewBusy = $state(false);
  let joinDialogOpenBusy = $state(false);
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
  const ACTIVE_MOUNT_RUNTIME_STALE_MS = 2500;
  const AUTO_REFRESH_DEBOUNCE_MS = 25;
  const destroyUiTransitionSubscription = uiTransitionStore.subscribe((value) => {
    uiMachineState = value;
  });
  const showThemeDialog = $derived(uiMachineState.showThemeDialog);
  const showPreviewPane = $derived(uiMachineState.showPreviewPane);
  const showResetDialog = $derived(uiMachineState.showResetDialog);
  const themeDialogSection = $derived(uiMachineState.themeDialogSection);
  const showTimeMachinePanel = $derived(uiMachineState.showTimeMachinePanel);
  const timelineDetailOpen = $derived(uiMachineState.showTimelineDetailDialog);
  const showSourcesPanel = $derived(uiMachineState.showSourcesPanel);
  const showVolumeStoragePanel = $derived(uiMachineState.showVolumeStoragePanel);
  const showMountStorageDialog = $derived(uiMachineState.showMountStorageDialog);
  const showEventFlowPanel = $derived(uiMachineState.showEventFlowPanel);
  const showPhoneOverflowMenu = $derived(uiMachineState.showPhoneOverflowMenu);
  const showIdentityManager = $derived(uiMachineState.showIdentityManager);
  const showCreateChooser = $derived(uiMachineState.showCreateChooser);
  const fileManagerViewMode = $derived(uiMachineState.fileManagerViewMode);
  const searchQuery = $derived(uiMachineState.searchQuery);
  const sortBy = $derived(uiMachineState.sortBy);
  const specModalOpen = $derived(uiMachineState.showSpecDialog);
  const showJoinVolumeDialog = $derived(uiMachineState.showJoinVolumeDialog);
  const showVolumeShareDialog = $derived(uiMachineState.showVolumeShareDialog);

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
    if (!isInAppThemeStudioEnabled) {
      return;
    }
    themeDialogFeedback = null;
    themeDialogError = '';
    uiTransitions.openThemeDialog(section);
  }

  async function persistThemeRegistry(
    nextRegistry: NearbytesThemeRegistry,
    successMessage: string
  ): Promise<void> {
    const result = await saveDesktopThemeRegistry(nextRegistry);
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
    themeDialogBusy = true;
    themeDialogError = '';
    themeDialogFeedback = null;
    try {
      const dataUrl = await themeDialogLogoPreview?.exportPngDataUrl();
      if (!dataUrl) {
        throw new Error('Logo preview is not ready yet.');
      }
      const result = await exportDesktopLogoPng(dataUrl);
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

  function preferredActiveMountId(nextMounts: VolumeMount[], preferredId: string | null = null): string {
    if (preferredId && nextMounts.some((mount) => mount.id === preferredId)) {
      return preferredId;
    }
    return nextMounts.find((mount) => !mount.collapsed)?.id ?? nextMounts[0]?.id ?? '';
  }

  function workspacePaneModeValue(mount: VolumeMount | null): 'files' | 'chat' | 'split' {
    if (!mount) {
      return 'files';
    }
    if (mount.showFilesPane && mount.showChatPane) {
      return 'split';
    }
    return mount.showChatPane ? 'chat' : 'files';
  }

  function applyWorkspacePaneMode(mode: 'files' | 'chat' | 'split') {
    const currentMount = mounts.find((mount) => mount.id === activeMountId);
    if (!currentMount) {
      return;
    }
    if (mode === 'files') {
      updateActiveMountWorkspace({
        showFilesPane: true,
        showChatPane: false,
        showSearchPane: currentMount.showSearchPane,
      });
      return;
    }
    if (mode === 'chat') {
      updateActiveMountWorkspace({
        showFilesPane: false,
        showChatPane: true,
        showSearchPane: false,
      });
      uiTransitions.closePreviewPane();
      renamingFileName = null;
      renameDraft = '';
      fileManagerActive = false;
      uiTransitions.clearSearchQuery();
      return;
    }
    updateActiveMountWorkspace({
      showFilesPane: true,
      showChatPane: true,
      showSearchPane: currentMount.showSearchPane,
    });
  }

  function handleCompactWorkspaceAction(value: string) {
    if (value === 'new-hub') {
      openCreateChooser();
      return;
    }
    if (value === 'search') {
      toggleWorkspaceSearch();
      return;
    }
    if (value === 'storage') {
      toggleVolumeStoragePanel();
      return;
    }
    if (value === 'share') {
      openVolumeShareDialog();
      return;
    }
    if (value === 'timeline') {
      uiTransitions.toggleTimeMachinePanel();
      return;
    }
    if (value === 'flow') {
      uiTransitions.toggleEventFlowPanel();
      return;
    }
    if (value === 'identities') {
      openIdentityManager();
      return;
    }
    if (value === 'reset') {
      openResetDialog();
      return;
    }
    if (value === 'locations') {
      toggleSourcesPanel();
    }
  }

  function togglePhoneOverflowMenu(): void {
    uiTransitions.togglePhoneOverflowMenu();
  }

  function closePhoneOverflowMenu(): void {
    uiTransitions.closePhoneOverflowMenu();
  }

  function runPhoneOverflowAction(value: string): void {
    closePhoneOverflowMenu();
    handleCompactWorkspaceAction(value);
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

    let cancelUpdaterSubscription: (() => void) | null = null;
    let cancelDeepLinkSubscription: (() => void) | null = null;
    let phoneAutomationPollTimer: ReturnType<typeof setInterval> | null = null;

    void readDesktopUpdaterState()
      .then((nextState) => {
        const normalized = normalizeDesktopUpdaterState(nextState);
        if (normalized) {
          desktopUpdaterState = normalized;
        }
      })
      .catch((error) => {
        console.warn('Failed to read desktop updater state:', error);
      });

    cancelUpdaterSubscription = subscribeDesktopUpdaterState((nextState) => {
      const normalized = normalizeDesktopUpdaterState(nextState);
      if (normalized) {
        desktopUpdaterState = normalized;
      }
    });

    cancelDeepLinkSubscription = subscribeDesktopDeepLinks((url) => {
      void handleDesktopDeepLink(url);
    });

    void processPendingPhoneAutomationCommand().catch((error) => {
      console.warn('Failed to process pending phone automation command:', error);
    });

    if (hasPhoneAutomationBridge()) {
      phoneAutomationPollTimer = setInterval(() => {
        void processPendingPhoneAutomationCommand().catch((error) => {
          console.warn('Failed to process pending phone automation command:', error);
        });
      }, 25);
    }

    void connectDesktopDeepLinks()
      .then((urls) => {
        for (const url of urls) {
          void handleDesktopDeepLink(url);
        }
      })
      .catch((error) => {
        console.warn('Failed to connect desktop deep link stream:', error);
      });

    void (async () => {
      try {
        const nextState = await loadHostPersistedUiState(loadPersistedUiStateLocally());
        const hasPersistedMounts = Object.prototype.hasOwnProperty.call(nextState ?? {}, 'volumeMounts');
        const nextMounts = normalizeMounts(nextState.volumeMounts);
        if (hasPersistedMounts) {
          mounts = nextMounts.length > 0 ? nextMounts : [createMount()];
          activeMountId = preferredActiveMountId(mounts, normalizeActiveMountId(nextState.activeMountId));
        } else if (normalizeActiveMountId(nextState.activeMountId)) {
          activeMountId = preferredActiveMountId(mounts, normalizeActiveMountId(nextState.activeMountId));
        }
        if (Object.prototype.hasOwnProperty.call(nextState ?? {}, 'configuredIdentities')) {
          configuredIdentities = normalizeConfiguredIdentities(nextState.configuredIdentities);
        }
        if (Object.prototype.hasOwnProperty.call(nextState ?? {}, 'activeChatIdentityId')) {
          activeChatIdentityId = typeof nextState.activeChatIdentityId === 'string' ? nextState.activeChatIdentityId : '';
        }
        if (Object.prototype.hasOwnProperty.call(nextState ?? {}, 'volumeChatIdentityAssignments')) {
          volumeChatIdentityAssignments = normalizeVolumeIdentityAssignmentsState(nextState.volumeChatIdentityAssignments);
        }
        const discoveryState = normalizePersistedSourceDiscovery(nextState.sourceDiscovery);
        latestSourceDiscovery = discoveryState.latestResult;
        latestSourceDiscoveryRunKey = discoveryState.latestRunKey;
        lastAcknowledgedSourceDiscoveryRunKey = discoveryState.lastAcknowledgedRunKey;
        applyHydratedThemeState(nextState.theme);
        uiTransitionStore.replaceState(normalizeUiTransitionState(nextState.uiMachine));
      } catch (error) {
        console.warn('Failed to hydrate desktop UI state:', error);
      } finally {
        persistedUiStateReady = true;
      }
    })();

    return () => {
      if (phoneAutomationPollTimer) {
        clearInterval(phoneAutomationPollTimer);
      }
      cancelUpdaterSubscription?.();
      cancelDeepLinkSubscription?.();
    };
  });

  onMount(() => {
    return () => {
      if (isDevThemeStudio) {
        sharedUiBridge?.clearAppSnapshot?.();
      }
    };
  });

  onDestroy(() => {
    destroyUiTransitionSubscription();
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

    let cancelled = false;
    let pollingTimer: ReturnType<typeof setInterval> | null = null;

    const refresh = async () => {
      try {
        const status = await getDesktopClipboardImageStatus();
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
      activeMountId,
      savedAt: Date.now(),
    };
    persistUiStateLocally(payload);
    const persistTimer = setTimeout(() => {
      void saveHostPersistedUiState(payload).then((saved) => {
        if (!saved) {
          persistUiStateLocally(payload);
        }
      }).catch((error) => {
          console.warn('Failed to persist host volume mounts:', error);
      });
    }, 120);

    return () => {
      clearTimeout(persistTimer);
    };
  });

  $effect(() => {
    if (!persistedUiStateReady || !identityHydrated) {
      return;
    }

    const payload: PersistedUiState = {
      configuredIdentities,
      activeChatIdentityId,
      volumeChatIdentityAssignments,
      savedAt: Date.now(),
    };
    persistUiStateLocally(payload);
    const persistTimer = setTimeout(() => {
      void saveHostPersistedUiState(payload).then((saved) => {
        if (!saved) {
          persistUiStateLocally(payload);
        }
      }).catch((error) => {
        console.warn('Failed to persist host identity state:', error);
      });
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
    persistUiStateLocally(payload);
    const persistTimer = setTimeout(() => {
      void saveHostPersistedUiState(payload).then((saved) => {
        if (!saved) {
          persistUiStateLocally(payload);
        }
      }).catch((error) => {
          console.warn('Failed to persist host source discovery state:', error);
      });
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
      uiMachine: uiMachineState,
      savedAt: Date.now(),
    };
    persistUiStateLocally(payload);
    const persistTimer = setTimeout(() => {
      void saveHostPersistedUiState(payload).then((saved) => {
        if (!saved) {
          persistUiStateLocally(payload);
        }
      }).catch((error) => {
          console.warn('Failed to persist host UI machine state:', error);
      });
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
    persistUiStateLocally(payload);
    const persistTimer = setTimeout(() => {
      void saveHostPersistedUiState(payload).then((saved) => {
        if (!saved) {
          persistUiStateLocally(payload);
        }
      }).catch((error) => {
          console.warn('Failed to persist host theme state:', error);
      });
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
        activeMountId,
        configuredIdentities,
        activeChatIdentityId,
        volumeChatIdentityAssignments,
        uiMachine: uiMachineState,
        sourceDiscovery: {
          lastAcknowledgedRunKey: lastAcknowledgedSourceDiscoveryRunKey,
          latestRunKey: latestSourceDiscoveryRunKey,
          latestResult: compactDiscoveryResult(latestSourceDiscovery),
        },
        theme: cloneThemeSettings(themeSettings),
        savedAt: Date.now(),
      };
      persistUiStateLocally(payload);
      void saveHostPersistedUiState(payload).catch((error) => {
          console.warn('Failed to flush host UI state:', error);
      });
    };

    let cancelPhoneAppState: (() => void) | null = null;

    void subscribePhoneAppState((isActive) => {
      if (isActive) {
        scheduleSourceDiscovery(0);
        void processPendingPhoneAutomationCommand().catch((error) => {
          console.warn('Failed to process pending phone automation command:', error);
        });
        return;
      }
      flushPersistedUiState();
    })
      .then((unsubscribe) => {
        cancelPhoneAppState = unsubscribe;
      })
      .catch((error) => {
        console.warn('Failed to subscribe to phone app state:', error);
      });

    window.addEventListener('beforeunload', flushPersistedUiState);
    window.addEventListener('pagehide', flushPersistedUiState);
    return () => {
      cancelPhoneAppState?.();
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
    const storagePanelOpen = showSourcesPanel || showVolumeStoragePanel || showEventFlowPanel;
    if (storagePanelOpen && !lastStoragePanelOpen) {
      scheduleSourceDiscovery(0);
    }
    lastStoragePanelOpen = storagePanelOpen;
  });

  const isHistoryMode = $derived.by(() => timelinePosition < timelineEvents.length);
  const timelineDetailTimestamp = $derived.by(() => {
    if (timelineDetailEvent) return timelineDetailEvent.timestamp;
    const payload = timelineDetailPayloadDecrypted;
    if (!payload) return null;
    return (
      payload.createdAt ??
      payload.deletedAt ??
      payload.renamedAt ??
      payload.publishedAt ??
      null
    );
  });

  const timelineDetailPayloadDecrypted = $derived.by<SerializedEventPayload>(() => {
    return (
      timelineDetailDecryptedPayload ?? {
        type: 'ENCRYPTED_OPAQUE',
        fileName: 'Opaque payload',
        hash: '',
        encryptedKey: '',
      }
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
    if (!activeHubVolumeId) {
      return '';
    }
    return volumeChatIdentityAssignments[activeHubVolumeId] ?? '';
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

  const selectedChatIdentityStatus = $derived.by(() => {
    if (!selectedChatIdentity) {
      return null;
    }
    if (!activeHubVolumeId) {
      return {
        tone: 'warning',
        title: 'Open a hub to use chat',
        detail: 'Joining is local to the current hub.',
      };
    }
    if (!activeHubAuth) {
      return {
        tone: 'warning',
        title: 'Add this hub secret to use chat',
        detail: 'This view only has the hub ID and mirrored history. Add the hub secret to join locally.',
      };
    }
    if (isHistoryMode) {
      return {
        tone: 'warning',
        title: 'History mode is read-only',
        detail: 'Jump to Latest before publishing or joining.',
      };
    }
    if (!hasConfiguredIdentitySecret(selectedChatIdentity)) {
      return {
        tone: 'warning',
        title: 'Add an identity secret',
        detail: 'This identity needs a secret before it can join chat.',
      };
    }
    if (selectedChatIdentity.displayName.trim() === '') {
      return {
        tone: 'warning',
        title: 'Add a display name',
        detail: 'Nearbytes publishes chat identities with a visible name.',
      };
    }
    if (selectedChatIdentity.id === currentVolumeChatIdentityId) {
      return selectedChatIdentityNeedsPublish
        ? {
            tone: 'warning',
            title: 'Joined with a pending profile update',
            detail: 'Publish once to refresh the public profile for this hub.',
          }
        : {
            tone: 'success',
            title: `Joined as ${selectedChatIdentity.displayName.trim()}`,
            detail: 'New messages in this hub will use this identity.',
          };
    }
    return selectedChatIdentityNeedsPublish
      ? {
          tone: 'neutral',
          title: 'Ready to publish and join',
          detail: 'Publish this profile, then join the hub chat.',
        }
      : {
          tone: 'success',
          title: 'Ready to join this hub',
          detail: 'Use this identity for new chat messages here.',
        };
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
  const mountStorageDialogMount = $derived.by(() =>
    mountStorageDialogMountId ? mounts.find((mount) => mount.id === mountStorageDialogMountId) ?? null : null
  );
  const mountDialogRuntime = $derived.by(() =>
    mountDialogMount ? mountRuntimeById[mountDialogMount.id] ?? null : null
  );
  const mountStorageDialogRuntime = $derived.by(() =>
    mountStorageDialogMount ? mountRuntimeById[mountStorageDialogMount.id] ?? null : null
  );
  const mountDialogResolvedVolumeId = $derived.by(() =>
    normalizeVolumeKey(
      mountDialogMount?.id === activeMountId
        ? volumeId ?? mountDialogRuntime?.volumeId ?? mountDialogMount?.volumeId ?? null
        : mountDialogRuntime?.volumeId ?? mountDialogMount?.volumeId ?? null
    )
  );
  const mountStorageDialogVolumeId = $derived.by(() =>
    normalizeVolumeKey(
      mountStorageDialogMount?.id === activeMountId
        ? shareableVolumeId ?? mountStorageDialogRuntime?.volumeId ?? mountStorageDialogMount?.volumeId ?? null
        : mountStorageDialogRuntime?.volumeId ?? mountStorageDialogMount?.volumeId ?? null
    )
  );
  const mountDialogResolvedLastRefresh = $derived.by(() =>
    mountDialogMount?.id === activeMountId
      ? lastRefresh ?? mountDialogRuntime?.lastRefresh ?? null
      : mountDialogRuntime?.lastRefresh ?? null
  );
  const mountDialogResolvedOffline = $derived.by(() =>
    mountDialogMount?.id === activeMountId
      ? isOffline || mountDialogRuntime?.isOffline === true
      : mountDialogRuntime?.isOffline === true
  );
  const mountDialogResolvedError = $derived.by(() =>
    mountDialogMount?.id === activeMountId
      ? errorMessage || mountDialogRuntime?.errorMessage || ''
      : mountDialogRuntime?.errorMessage ?? ''
  );
  const mountDialogStorageLabel = $derived.by(() => {
    if (mountDialogStorageModeLoading && mountDialogResolvedVolumeId) {
      return 'checking';
    }
    if (mountDialogStorageMode === 'custom') {
      return 'custom';
    }
    if (mountDialogStorageMode === 'default') {
      return 'default';
    }
    return 'unavailable';
  });
  const showFilesWorkspace = $derived.by(() => activeMount?.showFilesPane ?? true);
  const showChatWorkspace = $derived.by(() => activeMount?.showChatPane ?? false);
  const showSearchWorkspace = $derived.by(() => activeMount?.showSearchPane ?? false);
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
  const activeMountRuntime = $derived.by(() => matchingMountRuntime(activeMount));
  const activeHubVolumeId = $derived.by(
    () => activeMountRuntime?.volumeId ?? volumeId ?? activeMount?.volumeId?.trim().toLowerCase() ?? null
  );
  const activeHubAuth = $derived.by(() =>
    resolveActiveHubAuth({
      runtimeAuth: activeMountRuntime?.auth ?? null,
      currentAuth: auth,
      activeMountSecret: activeMount ? buildMountSecret(activeMount) : null,
      mountedSecretForVolumeId: activeHubVolumeId ? mountedSecretForVolumeId(activeHubVolumeId) : null,
    })
  );
  const currentMountedVolumePresentation = $derived.by<MountedVolumePresentation | null>(() => {
    const currentVolumeId = activeHubVolumeId;
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
  const mountStorageDialogPresentation = $derived.by<MountedVolumePresentation | null>(() => {
    if (!mountStorageDialogMount || !mountStorageDialogVolumeId) {
      return null;
    }
    return {
      volumeId: mountStorageDialogVolumeId,
      label: mountLabel(mountStorageDialogMount),
      filePayload: mountStorageDialogMount.secretFilePayload,
      fileMimeType: mountStorageDialogMount.secretFileMimeType,
      fileName: mountStorageDialogMount.secretFileName,
    };
  });
  const shareableVolumeId = $derived.by(() => activeHubVolumeId);
  const workspaceChromeState = $derived.by(() =>
    createWorkspaceChromeState({
      workspaceMode: workspacePaneModeValue(activeMount),
      showFilesWorkspace,
      showChatWorkspace,
      showSearchWorkspace,
      showVolumeStoragePanel,
      showVolumeShareDialog,
      showTimeMachinePanel,
      showEventFlowPanel,
      fileManagerViewMode,
      showWorkspaceUtilities: showFilesWorkspace || Boolean(activeMount) || Boolean(shareableVolumeId),
      selectionSummary: createWorkspaceSelectionSummary({
        fileCount: visibleFiles.length,
        selectedCount: selectedFileNames.length,
        selectedLabel: selectedFileNames.length === 1 && selectedFile ? displayFileName(selectedFile) : null,
      }),
      storageDisabled: !activeMount && !shareableVolumeId,
      searchQuery,
      sortBy,
      pasteVisible: Boolean(appReferenceClipboard),
      pasteCount: appReferenceClipboard?.itemCount ?? 0,
      pasteDisabled: !auth || isHistoryMode,
      pasteTitle: !auth ? 'Open a destination hub before pasting' : isHistoryMode ? 'Jump to Latest before pasting' : '',
      showResetAction: canWipeStoredConfig(),
    })
  );
  const workspaceChromeActions: WorkspaceChromeActions = {
    applyWorkspaceMode: applyWorkspacePaneMode,
    toggleWorkspacePane,
    toggleSearch: toggleWorkspaceSearch,
    toggleStorage: toggleVolumeStoragePanel,
    openShare: openVolumeShareDialog,
    toggleTimeline: () => {
      uiTransitions.toggleTimeMachinePanel();
    },
    toggleFlow: () => {
      uiTransitions.toggleEventFlowPanel();
    },
    setViewMode: (mode) => {
      uiTransitions.setFileManagerViewMode(mode);
    },
    setSearchQuery: (value) => {
      uiTransitions.setSearchQuery(value);
    },
    setSortBy: (value) => {
      uiTransitions.setSortBy(value);
    },
    paste: () => {
      void pasteCopiedFiles();
    },
    overflowAction: runPhoneOverflowAction,
  };

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

  $effect(() => {
    if (!isDevThemeStudio || !sharedUiBridge?.createAppSnapshot || !sharedUiBridge.publishAppSnapshot) {
      return;
    }
    sharedUiBridge.publishAppSnapshot(
      sharedUiBridge.createAppSnapshot({
        mountCount: mounts.length,
        mountLabel: currentMountedVolumePresentation?.label ?? (activeMount ? mountLabel(activeMount) : ''),
        emptyState: address.trim() === '',
        workspaceMode: workspaceChromeState.workspaceMode,
        showFilesWorkspace: workspaceChromeState.showFilesWorkspace,
        showChatWorkspace: workspaceChromeState.showChatWorkspace,
        showSearchWorkspace: workspaceChromeState.showSearchWorkspace,
        fileManagerViewMode: workspaceChromeState.fileManagerViewMode,
        fileCount: fileList.length,
        selectedCount: selectedFileNames.length,
        searchQuery: workspaceChromeState.searchQuery,
        showPreviewPane,
        showTimeMachinePanel: workspaceChromeState.showTimeMachinePanel,
        timelineCount: timelineEvents.length,
        timelinePosition,
        timelineDetailOpen,
        showSpecDialog: specModalOpen,
        showThemeDialog: isInAppThemeStudioEnabled && showThemeDialog,
        showSourcesPanel,
        showVolumeStoragePanel: workspaceChromeState.showVolumeStoragePanel,
        showMountStorageDialog,
        showEventFlowPanel: workspaceChromeState.showEventFlowPanel,
        showPhoneOverflowMenu,
        showMountDialog: Boolean(mountDialogMount),
        showIdentityManager,
        showCreateChooser,
        showJoinVolumeDialog,
        showVolumeShareDialog: workspaceChromeState.showVolumeShareDialog,
        showResetDialog,
        activeModal: showVolumeShareDialog
          ? 'share'
          : showJoinVolumeDialog
            ? 'join'
            : mountDialogMount
              ? 'mount'
            : showCreateChooser
              ? 'create'
              : showIdentityManager
                ? 'identity'
                : showResetDialog
                  ? 'reset'
                  : 'none',
      })
    );
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
    if (left.type === 'token' && right.type === 'token') {
      return left.token === right.token;
    }
    if (left.type === 'secret' && right.type === 'secret') {
      return left.secret === right.secret;
    }
    return false;
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

  function shouldKeepMountTimelineWarm(mount: VolumeMount | null, runtime?: MountRuntimeState | null): boolean {
    if (!mount) {
      return false;
    }
    if (showTimeMachinePanel && activeMountId === mount.id) {
      return true;
    }
    if (mount.showChatPane) {
      return true;
    }
    return (runtime?.timelineEvents.length ?? 0) > 0;
  }

  async function refreshMountTimeline(
    mountId: string,
    authOverride?: Auth,
    options: { applyIfCurrent?: boolean; keepPosition?: boolean } = {}
  ): Promise<void> {
    const mount = mounts.find((entry) => entry.id === mountId) ?? null;
    const runtime = mountRuntimeById[mountId] ?? null;
    const targetAuth = authOverride ?? runtime?.auth ?? null;
    if (!mount || !runtime || !targetAuth || matchingMountRuntime(mount) !== runtime) {
      return;
    }

    const applyIfCurrent = options.applyIfCurrent === true;
    const keepPosition = options.keepPosition !== false;
    const previousEvents = runtime.timelineEvents;
    const previousPosition = runtime.timelinePosition;
    const isCurrentMount = activeMountId === mountId && authEquals(auth, runtime.auth);

    if (applyIfCurrent && isCurrentMount) {
      isTimelineLoading = true;
    }

    try {
      const timeline = await getTimeline(targetAuth);
      const nextRuntime: MountRuntimeState = {
        ...runtime,
        timelineEvents: timeline.events,
        timelinePosition: keepPosition
          ? previousPosition >= previousEvents.length
            ? timeline.events.length
            : Math.min(previousPosition, timeline.events.length)
          : timeline.events.length,
        isOffline: timeline.isOffline === true,
      };
      writeMountRuntime(mountId, nextRuntime);
      if (isCurrentMount) {
        applyMountRuntime(nextRuntime);
        chatRefreshVersion += 1;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load timeline';
      const mirrored = await readMirrorTimelineSnapshot(runtime.volumeId);
      const nextTimelineEvents = mirrored?.events ?? runtime.timelineEvents;
      const nextRuntime: MountRuntimeState = {
        ...runtime,
        timelineEvents: nextTimelineEvents,
        timelinePosition: keepPosition
          ? previousPosition >= previousEvents.length
            ? nextTimelineEvents.length
            : Math.min(previousPosition, nextTimelineEvents.length)
          : nextTimelineEvents.length,
        errorMessage: runtime.errorMessage || message,
      };
      writeMountRuntime(mountId, nextRuntime);
      if (isCurrentMount) {
        errorMessage = runtime.errorMessage || message;
      }
    } finally {
      if (applyIfCurrent && isCurrentMount) {
        isTimelineLoading = false;
      }
    }
  }

  async function refreshMountRuntime(mountId: string): Promise<void> {
    const mount = mounts.find((entry) => entry.id === mountId) ?? null;
    const runtime = mountRuntimeById[mountId];
    if (!mount || !runtime || matchingMountRuntime(mount) !== runtime) {
      clearMountRuntimeRefresh(mountId);
      return;
    }

    try {
      const filesResponse = await listFiles(runtime.auth);
      const timelineResponse = shouldKeepMountTimelineWarm(mount, runtime)
        ? await getTimeline(runtime.auth)
        : null;
      const nextTimelineEvents = timelineResponse?.events ?? runtime.timelineEvents;
      const nextRuntime: MountRuntimeState = {
        ...runtime,
        files: filesResponse.files,
        timelineEvents: nextTimelineEvents,
        timelinePosition:
          runtime.timelinePosition >= runtime.timelineEvents.length
            ? nextTimelineEvents.length
            : Math.min(runtime.timelinePosition, nextTimelineEvents.length),
        lastRefresh: Date.now(),
        isOffline: filesResponse.isOffline === true || timelineResponse?.isOffline === true,
        errorMessage: '',
      };
      writeMountRuntime(mountId, nextRuntime);
      if (activeMountId === mountId && authEquals(auth, runtime.auth)) {
        applyMountRuntime(nextRuntime);
        chatRefreshVersion += 1;
      }
      await setCachedFiles(runtime.volumeId, filesResponse.files);
    } catch (error) {
      const mirrorFiles = await readMirrorVolumeSnapshot(runtime.volumeId);
      const mirrorTimeline = await readMirrorTimelineSnapshot(runtime.volumeId);
      const nextTimelineEvents = mirrorTimeline?.events ?? runtime.timelineEvents;
      const nextRuntime: MountRuntimeState = {
        ...runtime,
        files: mirrorFiles?.files ?? runtime.files,
        timelineEvents: nextTimelineEvents,
        timelinePosition:
          runtime.timelinePosition >= runtime.timelineEvents.length
            ? nextTimelineEvents.length
            : Math.min(runtime.timelinePosition, nextTimelineEvents.length),
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
    uiTransitions.clearSearchQuery();
    selectedFileName = null;
    previewKind = 'none';
    previewText = '';
    previewError = '';
    previewLoading = false;
    previewFileOverride = null;
    previewBlobCache.clear();
    revokePreviewUrl();
    revokeThumbnails();
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
      isOffline = response.isOffline === true;
      errorMessage = response.isOffline === true ? 'Using mirrored timeline. Runtime unavailable.' : '';
    } catch (error) {
      const mirrored = volumeId ? await readMirrorTimelineSnapshot(volumeId) : null;
      if (mirrored) {
        timelineEvents = mirrored.events;
        timelinePosition = keepPosition ? Math.min(previousPosition, mirrored.events.length) : mirrored.events.length;
        errorMessage = 'Using mirrored timeline. Runtime unavailable.';
      } else {
        timelineEvents = [];
        timelinePosition = 0;
        errorMessage = error instanceof Error ? error.message : 'Failed to load timeline';
      }
    } finally {
      isTimelineLoading = false;
    }
  }

  async function ensureMountRuntimeLoaded(
    mount: VolumeMount,
      options: { activateIfCurrent?: boolean; preloadTimeline?: boolean } = {}
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
      try {
        const response = await withTimeout(
          openVolume(secret),
          12000,
          'Opening this hub timed out. Check the storage locations and try again.'
        );
        const shouldLoadTimeline = options.preloadTimeline ?? shouldKeepMountTimelineWarm(mount);
        const nextAuth =
          response.token
            ? ({ type: 'token', token: response.token } as const)
            : ({ type: 'secret', secret } as const);
        const nextErrorMessage = response.storageHint ?? '';

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
          timelineEvents: [],
          timelinePosition: 0,
          lastRefresh: Date.now(),
          isOffline: response.isOffline === true,
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
        if (shouldLoadTimeline) {
          void refreshMountTimeline(mount.id, nextAuth, {
            applyIfCurrent: options.activateIfCurrent === true,
            keepPosition: false,
          });
        }
        scheduleMountRuntimeRefresh(mount.id);
      } catch (error) {
        const persistedVolumeId = normalizeVolumeKey(mount.volumeId);
        const mirrorFiles = persistedVolumeId ? await readMirrorVolumeSnapshot(persistedVolumeId) : null;
        const mirrorTimeline = persistedVolumeId ? await readMirrorTimelineSnapshot(persistedVolumeId) : null;
        const cachedFiles = persistedVolumeId ? await getCachedFiles(persistedVolumeId) : null;
        if (!persistedVolumeId || (!mirrorFiles && !mirrorTimeline && !cachedFiles)) {
          throw error;
        }

        const nextRuntime: MountRuntimeState = {
          mountId: mount.id,
          secret,
          label,
          auth: { type: 'secret', secret },
          volumeId: persistedVolumeId,
          files: mirrorFiles?.files ?? cachedFiles ?? [],
          timelineEvents: mirrorTimeline?.events ?? [],
          timelinePosition: mirrorTimeline?.events.length ?? 0,
          lastRefresh: Date.now(),
          isOffline: true,
          errorMessage: 'Using persisted mirrored data. Runtime unavailable.',
        };

        writeMountRuntime(mount.id, nextRuntime);
        if (options.activateIfCurrent && activeMountId === mount.id) {
          sessionStorage.removeItem('nearbytes-token');
          applyMountRuntime(nextRuntime);
        }
      }
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
    }, AUTO_REFRESH_DEBOUNCE_MS);
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
        void ensureMountRuntimeLoaded(mount, {
          activateIfCurrent: mount.id === activeMountId,
          preloadTimeline: mount.id === activeMountId && shouldKeepMountTimelineWarm(mount),
        });
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

  $effect(() => {
    const dialogMountId = mountDialogMount?.id ?? null;
    const targetVolumeId = mountDialogResolvedVolumeId;
    let cancelled = false;

    mountDialogStorageMode = 'unknown';
    mountDialogStorageModeLoading = false;

    if (!dialogMountId || !targetVolumeId) {
      return;
    }

    mountDialogStorageModeLoading = true;
    void (async () => {
      try {
        const response = await getRootsConfig();
        if (cancelled) {
          return;
        }
        mountDialogStorageMode = resolveMountStorageMode(response.config, targetVolumeId);
      } catch {
        if (cancelled) {
          return;
        }
        mountDialogStorageMode = 'unknown';
      } finally {
        if (!cancelled) {
          mountDialogStorageModeLoading = false;
        }
      }
    })();

    return () => {
      cancelled = true;
    };
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
      if (Date.now() - (cachedRuntime.lastRefresh ?? 0) > ACTIVE_MOUNT_RUNTIME_STALE_MS) {
        scheduleMountRuntimeRefresh(currentMount.id, 0);
      }
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
    uiTransitions.toggleVolumeStoragePanel();
    sourceDiscoveryPanelFocus = null;
    if (!showVolumeStoragePanel) {
      uiTransitions.closeSourcesPanel();
      uiTransitions.closeEventFlowPanel();
    }
  }

  function toggleSourcesPanel() {
    uiTransitions.toggleSourcesPanel();
    sourceDiscoveryPanelFocus = null;
    if (!showSourcesPanel) {
      uiTransitions.closeVolumeStoragePanel();
      uiTransitions.closeEventFlowPanel();
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
    uiTransitions.closeVolumeShareDialog();
    openVolumeStoragePanel();
    sourceDiscoveryPanelFocus = 'shares';
  }

  function openJoinVolumeDialog(): void {
    uiTransitions.openJoinVolumeDialog();
    resetJoinDialogState();
  }

  async function openJoinVolumeDialogFromClipboard(): Promise<void> {
    openJoinVolumeDialog();
    await readJoinDialogClipboard();
  }

  function closeJoinVolumeDialog(): void {
    uiTransitions.closeJoinVolumeDialog();
    resetJoinDialogState();
  }

  function openVolumeShareDialog(): void {
    if (!activeMount && !shareableVolumeId) {
      return;
    }
    uiTransitions.openVolumeShareDialog();
  }

  function openCreateChooser(): void {
    uiTransitions.openCreateChooser();
  }

  function closeCreateChooser(): void {
    uiTransitions.closeCreateChooser();
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
    uiTransitions.closeVolumeShareDialog();
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
      uiTransitions.openVolumeStoragePanel();
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
    uiTransitions.closeSourcesPanel();
    uiTransitions.closeVolumeStoragePanel();
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
        uiTransitions.closePreviewPane();
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
      uiTransitions.closePreviewPane();
    }
  });

  function revokePreviewUrl() {
    if (currentPreviewObjectUrl) {
      URL.revokeObjectURL(currentPreviewObjectUrl);
      currentPreviewObjectUrl = null;
    }
    previewUrl = '';
  }

  function revokeThumbnails(): void {
    for (const url of thumbnailBlobUrls) {
      URL.revokeObjectURL(url);
    }
    thumbnailBlobUrls.length = 0;
    thumbnailLoadGuard.clear();
    thumbnailUrls = new Map();
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

  function queueThumbnailLoad(file: FileMetadata): void {
    if (!auth || thumbnailLoadGuard.has(file.blobHash)) return;
    if (detectPreviewKind(file) !== 'image') return;
    thumbnailLoadGuard.add(file.blobHash);
    void (async () => {
      try {
        let blob = previewBlobCache.get(file.blobHash);
        if (!blob) {
          blob = await downloadFile(auth!, file.blobHash);
          previewBlobCache.set(file.blobHash, blob);
        }
        const url = URL.createObjectURL(blob);
        thumbnailBlobUrls.push(url);
        thumbnailUrls = new Map(thumbnailUrls).set(file.blobHash, url);
      } catch {
        thumbnailLoadGuard.delete(file.blobHash);
      }
    })();
  }

  $effect(() => {
    if (fileManagerViewMode !== 'icons' || !auth) return;
    for (const file of visibleFiles) {
      queueThumbnailLoad(file);
    }
  });

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

  function specDocsForPayload(
    payload: SerializedEventPayload | null,
    seedEvent: TimelineEvent | null
  ): SpecDoc[] {
    const docs: SpecDoc[] = [];
    for (const doc of SPEC_DOCS) {
      if (doc.always) {
        docs.push(doc);
        continue;
      }
      if (seedEvent && doc.eventTypes?.includes(seedEvent.type)) {
        docs.push(doc);
        continue;
      }
      if (payload?.protocol && doc.protocols?.includes(payload.protocol)) {
        docs.push(doc);
      }
    }
    return docs;
  }

  function openSpecDoc(doc: SpecDoc): void {
    specModalDoc = doc;
    specModalContent = SPEC_CONTENT_BY_FILE.get(doc.filename) ?? 'Spec not bundled.';
    uiTransitions.openSpecDialog();
  }

  function closeSpecDoc(): void {
    uiTransitions.closeSpecDialog();
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
    uiTransitions.closeTimelineDetailDialog();
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
    timelineDetailDecryptedPayload = null;
    timelineDetailRequestId += 1;
    closeSpecDoc();
  }
  function applyTimelineDetailSnapshot(detail: {
    eventHash: string;
    event: SerializedEvent;
    decryptedPayload?: SerializedEventPayload;
  }): void {
    timelineDetailPayload = detail.event;
    timelineDetailDecryptedPayload = detail.decryptedPayload ?? null;
    timelineDetailHash = detail.eventHash;
    timelineDetailEncoded = JSON.stringify(detail.event, null, 2);

    const decryptedPayload = timelineDetailDecryptedPayload;
    const recordParse = tryParseJson(decryptedPayload?.record);
    if (recordParse.value !== undefined) {
      timelineDetailRecord = JSON.stringify(recordParse.value, null, 2);
    } else if (decryptedPayload?.record) {
      timelineDetailRecord = decryptedPayload.record;
    }
    if (recordParse.error) {
      timelineDetailRecordError = recordParse.error;
    }

    const messageParse = tryParseJson(decryptedPayload?.message);
    if (messageParse.value !== undefined) {
      timelineDetailMessage = JSON.stringify(messageParse.value, null, 2);
    } else if (decryptedPayload?.message) {
      timelineDetailMessage = decryptedPayload.message;
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

    timelineDetailReferences = [
      ...extractReferences(recordParse.value),
      ...extractReferences(messageParse.value),
    ];

    const eventRefs = new Set<string>();
    for (const hash of extractEventHashes(recordParse.value)) {
      if (hash !== detail.eventHash) eventRefs.add(hash);
    }
    for (const hash of extractEventHashes(messageParse.value)) {
      if (hash !== detail.eventHash) eventRefs.add(hash);
    }
    timelineDetailEventRefs = Array.from(eventRefs);
  }

  async function openTimelineDetailsByHash(eventHash: string, seedEvent?: TimelineEvent) {
    if (!auth) {
      errorMessage = 'Open a hub to view event details.';
      return;
    }
    uiTransitions.openTimelineDetailDialog();
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
        const mirroredDetail = await readMirrorEventDetail(eventHash);
        if (!mirroredDetail) {
          throw detailResult.reason;
        }
        if (requestId !== timelineDetailRequestId) return;
        applyTimelineDetailSnapshot(mirroredDetail);
      } else {
        const detail = detailResult.value;
        if (requestId !== timelineDetailRequestId) return;
        applyTimelineDetailSnapshot(detail);
      }

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
    const hash = timelineDetailDecryptedPayload?.hash?.trim() ?? '';
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
    if (location.eventPath) {
      return location.eventPath;
    }
    if (location.dataPath) {
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

  function findPreviewFileForPayload(payload: SerializedEventPayload): FileMetadata | null {
    const byHash = visibleFiles.find((file) => file.blobHash === payload.hash) ?? null;
    if (byHash) return byHash;
    if (!payload.fileName) return null;
    return visibleFiles.find((file) => file.filename === payload.fileName) ?? null;
  }

  function openEventPayloadPreview(payload: SerializedEventPayload): void {
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
    uiTransitions.openPreviewPane();
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
      uiTransitions.openPreviewPane();
    }
  }

  function closePreviewPane() {
    previewFileOverride = null;
    uiTransitions.closePreviewPane();
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
    uiTransitions.openPreviewPane();
  }

  function updateActiveMountWorkspace(
    patch: Partial<Pick<VolumeMount, 'showFilesPane' | 'showChatPane' | 'showSearchPane' | 'workspaceSplit'>>
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
      showSearchPane: nextShowFiles ? currentMount.showSearchPane : false,
    });

    if (!nextShowFiles) {
      uiTransitions.closePreviewPane();
      renamingFileName = null;
      renameDraft = '';
      fileManagerActive = false;
      uiTransitions.clearSearchQuery();
    }
    if (!nextShowChat) {
    }
  }

  function toggleWorkspaceSearch() {
    const currentMount = mounts.find((mount) => mount.id === activeMountId);
    if (!currentMount || !currentMount.showFilesPane) {
      return;
    }
    const nextShowSearch = !currentMount.showSearchPane;
    updateActiveMountWorkspace({
      showSearchPane: nextShowSearch,
    });
    if (!nextShowSearch) {
      uiTransitions.clearSearchQuery();
    }
  }

  function addConfiguredChatIdentity() {
    const next = createConfiguredIdentity();
    configuredIdentities = [...configuredIdentities, next];
    activeChatIdentityId = next.id;
    uiTransitions.openIdentityManager();
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

  function handleMountDialogValueInput(value: string): void {
    if (!mountDialogMount) {
      return;
    }
    updateMountAddress(mountDialogMount.id, value);
  }

  function handleMountDialogPasswordInput(value: string): void {
    if (!mountDialogMount) {
      return;
    }
    updateMountPassword(mountDialogMount.id, value);
  }

  function handleSelectedIdentitySecretSelected(file: globalThis.File) {
    if (!selectedChatIdentity) {
      return;
    }
    return applySecretFileToIdentity(file, selectedChatIdentity.id);
  }

  function handleSelectedIdentityValueInput(value: string): void {
    if (!selectedChatIdentity) {
      return;
    }
    updateConfiguredChatIdentitySecretText(selectedChatIdentity.id, 'address', value);
  }

  function handleSelectedIdentityPasswordInput(value: string): void {
    if (!selectedChatIdentity) {
      return;
    }
    updateConfiguredChatIdentitySecretText(selectedChatIdentity.id, 'password', value);
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
    uiTransitions.openIdentityManager();
    if (currentVolumeChatIdentityId) {
      activeChatIdentityId = currentVolumeChatIdentityId;
    }
  }

  function closeIdentityManager() {
    uiTransitions.closeIdentityManager();
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
    options: { announceSuccess?: boolean; openManagerOnError?: boolean; action?: IdentityManagerAction } = {}
  ): Promise<ConfiguredIdentity | null> {
    if (!activeHubAuth) {
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
        uiTransitions.openIdentityManager();
      }
      return null;
    }
    if (identity.displayName.trim() === '') {
      identityManagerError = 'Display name is required before publishing.';
      identityManagerMessage = '';
      if (options.openManagerOnError) {
        uiTransitions.openIdentityManager();
      }
      return null;
    }
    if (!configuredIdentityNeedsPublish(identity) && identity.publicKey) {
      return identity;
    }

    identityManagerLoading = true;
    identityManagerAction = options.action ?? 'publish';
    identityManagerError = '';
    if (options.announceSuccess) {
      identityManagerMessage = '';
    }
    try {
      const published = await publishIdentity(activeHubAuth, buildIdentitySecret(identity), {
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
        uiTransitions.openIdentityManager();
      }
      return null;
    } finally {
      identityManagerLoading = false;
      identityManagerAction = 'idle';
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
      action: 'publish',
    });
  }

  async function joinCurrentVolumeChat(): Promise<ConfiguredIdentity | null> {
    if (!activeHubAuth || !activeHubVolumeId) {
      identityManagerError = 'Open a hub before joining chat.';
      identityManagerMessage = '';
      return null;
    }
    if (!selectedChatIdentity) {
      identityManagerError = 'Choose an identity before joining this chat.';
      identityManagerMessage = '';
      uiTransitions.openIdentityManager();
      return null;
    }
    if (isHistoryMode) {
      identityManagerError = 'History mode is read-only. Jump to Latest before joining chat.';
      identityManagerMessage = '';
      return null;
    }

    const publishedIdentity = await ensureChatIdentityPublished(selectedChatIdentity, {
      announceSuccess: false,
      openManagerOnError: true,
      action: 'join',
    });
    if (!publishedIdentity) {
      return null;
    }

    volumeChatIdentityAssignments = {
      ...volumeChatIdentityAssignments,
      [activeHubVolumeId]: publishedIdentity.id,
    };
    identityManagerError = '';
    identityManagerMessage = `Joined this hub as ${publishedIdentity.displayName.trim()}.`;
    uiTransitions.closeIdentityManager();
    return publishedIdentity;
  }

  function toggleColumnSort(column: 'name' | 'size' | 'date') {
    if (column === 'name') {
      uiTransitions.setSortBy(sortBy === 'name' ? 'name-desc' : 'name');
      return;
    }
    if (column === 'size') {
      uiTransitions.setSortBy(sortBy === 'size' ? 'size-asc' : 'size');
      return;
    }
    uiTransitions.setSortBy(sortBy === 'newest' ? 'oldest' : 'newest');
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
      isOffline = response.isOffline === true;
      errorMessage = response.isOffline === true ? 'Using mirrored data. Runtime unavailable.' : '';

      // Update cache
      await setCachedFiles(volumeId, response.files);
      if (showTimeMachinePanel || showChatWorkspace || timelineEvents.length > 0) {
        await refreshTimeline(true);
      }
      chatRefreshVersion += 1;
    } catch (error) {
      const mirrored = await readMirrorVolumeSnapshot(volumeId);
      if (mirrored) {
        fileList = mirrored.files;
        isOffline = true;
        errorMessage = 'Using mirrored data. Runtime unavailable.';
      } else {
        const cached = await getCachedFiles(volumeId);
        if (cached) {
          fileList = cached;
          isOffline = true;
          errorMessage = 'Using cached data. Runtime unavailable.';
        } else {
          errorMessage = error instanceof Error ? error.message : 'Failed to refresh';
        }
      }
    } finally {
      isRefreshing = false;
    }
  }

  $effect(() => {
    if (!auth || !activeMount) {
      return;
    }
    if (!showTimeMachinePanel && !showChatWorkspace) {
      return;
    }
    const runtime = matchingMountRuntime(activeMount);
    if (!runtime || isTimelineLoading || runtime.timelineEvents.length > 0) {
      return;
    }
    void refreshMountTimeline(activeMount.id, runtime.auth, {
      applyIfCurrent: true,
      keepPosition: true,
    });
  });

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
  async function copyVolumeId(targetVolumeId: string | null = volumeId) {
    if (!targetVolumeId) return;
    try {
      await navigator.clipboard.writeText(targetVolumeId);
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
    if (showPhoneOverflowMenu) {
      e.preventDefault();
      closePhoneOverflowMenu();
      return;
    }
    if (timelineDetailOpen) {
      e.preventDefault();
      closeTimelineDetails();
      return;
    }
    if (showThemeDialog) {
      e.preventDefault();
      uiTransitions.closeThemeDialog();
      return;
    }
    if (showResetDialog) {
      e.preventDefault();
      closeResetDialog();
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
    if (showEventFlowPanel) {
      e.preventDefault();
      uiTransitions.closeEventFlowPanel();
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
    showPhoneOverflowMenu &&
    event.target instanceof Node &&
    !phoneOverflowMenuElement?.contains(event.target) &&
    !phoneOverflowMenuButtonElement?.contains(event.target)
  ) {
    closePhoneOverflowMenu();
  }
  if (
    fileManagerElement &&
    (!(event.target instanceof Node) || !fileManagerElement.contains(event.target))
  ) {
    fileManagerActive = false;
  }
  collapseExpandedMountFromOutside(event.target);
}} onpaste={handlePaste} />

<div class="app" style={appThemeCssText}>
  <AppHeader
    isDevThemeStudio={isInAppThemeStudioEnabled}
    themeLogoOptions={themeSettings.logo}
    paletteLabel={activeThemePreset().palette.label}
    activeMountId={activeMountId}
    mounts={mounts.map((mount) => ({ id: mount.id, label: mountLabel(mount) || 'Unnamed hub' }))}
    draggingMounts={draggingMountId !== null}
    isHeaderHovering={isHeaderHovering}
    setHeaderHovering={setHeaderHoveringFromSpec}
    isSecretDropTarget={isSecretDropTarget}
    canHandleSecretDropPayload={canHandleSecretDropPayload}
    setSecretDropTarget={setSecretDropTargetFromSpec}
    onSecretFileDrop={handleSecretFileDrop}
    onSelectMount={handleMountClick}
    onOpenThemeStudio={() => openThemeStudio('preset')}
    onOpenCreateChooser={openCreateChooser}
    showPhoneOverflowMenu={showPhoneOverflowMenu}
    bind:phoneOverflowMenuButtonElement
    bind:phoneOverflowMenuElement
    showIdentityManager={showIdentityManager}
    showResetAction={canWipeStoredConfig()}
    showResetDialog={showResetDialog}
    showSourcesPanel={showSourcesPanel}
    onTogglePhoneOverflowMenu={togglePhoneOverflowMenu}
    onOpenIdentityManager={openIdentityManager}
    onOpenResetDialog={openResetDialog}
    onToggleSourcesPanel={toggleSourcesPanel}
    workspaceState={workspaceChromeState}
    workspaceActions={workspaceChromeActions}
  >
    {#snippet mountRailChildren()}
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
    {#snippet mountRailActions()}
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
  </AppHeader>

  <!-- Main file area -->
  <WorkspaceStage
    mode={showSourcesPanel ? 'global-panel' : showVolumeStoragePanel ? 'volume-panel' : address.trim() === '' ? 'empty' : 'workspace'}
    isVolumeWorkspaceActive={!showSourcesPanel && !showVolumeStoragePanel && address.trim() !== ''}
    {isDragging}
    onDragOver={handleDragOver}
    onDragLeave={handleDragLeave}
    onDrop={handleDrop}
    {showEventFlowPanel}
    onCloseFlow={() => {
      uiTransitions.closeEventFlowPanel();
    }}
  >
    {#snippet globalPanel()}
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
    {/snippet}
    {#snippet volumePanel()}
        <StoragePanel
          mode="volume"
          volumeId={shareableVolumeId}
          currentVolumePresentation={currentMountedVolumePresentation}
          knownVolumes={knownMountedVolumes}
          onOpenVolumeRouting={openMountedVolumeRouting}
          onOpenStorageSetup={() => openSourcesPanelWithFocus(null)}
          refreshToken={sourceDiscoveryRefreshToken}
        />
    {/snippet}
    {#snippet emptyState()}
      <EmptyStatePanel
        showBrand={true}
        themeLogoOptions={themeSettings.logo}
        eyebrow={activeThemePreset().palette.label}
        title="Enter an address to access your files"
        subtitle={`Or drag and drop files here to create a new hub.${isInAppThemeStudioEnabled ? ' Click the brand mark to edit presets and export the checked-in logo asset.' : ' The active preset stays consistent across launches.'}`}
      />
    {/snippet}
    {#snippet workspaceContent()}
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
      <TimeMachinePanel
        timelineMarker={timelineMarker}
        {isTimelinePlaying}
        {isTimelineLoading}
        timelineEvents={timelineEvents}
        {timelinePosition}
        bind:timelineEventsElement
        {timelineKindLabel}
        {timelineHeadline}
        {timelineTitle}
        {formatShortDate}
        {isTimelineIdentityEvent}
        {isTimelineChatEvent}
        onTogglePlayback={toggleTimelinePlayback}
        onJumpToLatest={jumpToLatest}
        onSetTimelinePosition={(value) => {
          stopTimelinePlayback();
          setTimelinePosition(value);
        }}
        onJumpToEvent={jumpToEvent}
        onOpenDetails={(event) => {
          void openTimelineDetails(event);
        }}
        onScroll={handleTimelineScroll}
      />
      {/if}

      <WorkspaceModeBar
        state={workspaceChromeState}
        actions={workspaceChromeActions}
      />

      {#if workspaceChromeState.showFilesWorkspace && workspaceChromeState.showSearchWorkspace}
        <WorkspaceSearchStrip
          state={workspaceChromeState}
          actions={workspaceChromeActions}
        />
      {/if}

      <div
        class="workspace-panels"
        bind:this={workspacePanelsElement}
        style:grid-template-columns={workspacePanelsTemplate}
      >
        {#if showFilesWorkspace}
          <div class="workspace-pane">
            <FileManagerWorkspace
              {viewFiles}
              {visibleFiles}
              {isLoading}
              {fileManagerViewMode}
              {showPreviewPane}
              {fileManagerTemplate}
              {thumbnailUrls}
              currentPreviewFile={currentPreviewFile}
              {selectedFile}
              {previewFileOverride}
              {previewKind}
              {previewUrl}
              {previewText}
              {previewLoading}
              previewError={previewError}
              {renamingFileName}
              {renameDraft}
              {isHistoryMode}
              {fileAccentTone}
              {fileIconComponent}
              {isFileSelected}
              {columnSortState}
              {formatSize}
              {formatDate}
              {formatRelativeDay}
              {displayFileName}
              onElementChange={(element) => {
                fileManagerElement = element;
              }}
              onActivate={() => {
                fileManagerActive = true;
              }}
              onToggleColumnSort={toggleColumnSort}
              onFilePointerSelect={handleFilePointerSelect}
              onOpenPreview={openPreviewPane}
              onDragStart={handleNearbytesFileDragStart}
              onFileRowKeydown={handleFileRowKeydown}
              onStartRenaming={startRenaming}
              onRenameDraftChange={(value) => {
                renameDraft = value;
              }}
              onCommitRename={(file) => commitRename(file)}
              onCancelRenaming={cancelRenaming}
              onClearSelection={clearSelection}
              onStartResize={startFileManagerResize}
              onDelete={() => {
                if (selectedFile) {
                  handleDelete(selectedFile.filename);
                }
              }}
              onDownload={() => {
                if (currentPreviewFile) {
                  handleDownload(currentPreviewFile);
                }
              }}
              onClosePreview={closePreviewPane}
            >
              {#snippet empty()}
                <EmptyStatePanel
                  title={isHistoryMode ? 'No files at this point in history' : 'No files yet'}
                  subtitle={isHistoryMode ? 'Move the timeline toward Latest to see newer files' : 'Drop files here to add them'}
                >
                  {#snippet icon()}
                    <svg class="empty-icon" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M32 8L8 20L32 32L56 20L32 8Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.3"/>
                      <path d="M8 20V44L32 56L56 44V20" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.3"/>
                      <path d="M32 32V56" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.3"/>
                    </svg>
                  {/snippet}
                </EmptyStatePanel>
              {/snippet}
            </FileManagerWorkspace>
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
              auth={activeHubAuth}
              volumeId={activeHubVolumeId}
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
    {/snippet}
    {#snippet flowPanel()}
      <EventFlowPanel auth={auth ?? undefined} volumeId={shareableVolumeId ?? undefined} />
    {/snippet}
  </WorkspaceStage>

      {#if showMountStorageDialog}
        <VolumeStorageDialog
          title={mountStorageDialogPresentation ? `Storage for ${mountStorageDialogPresentation.label}` : 'Hub storage'}
          volumeId={mountStorageDialogVolumeId}
          currentVolumePresentation={mountStorageDialogPresentation}
          knownVolumes={knownMountedVolumes}
          onOpenVolumeRouting={openMountedVolumeRouting}
          onOpenStorageSetup={() => {
            closeMountStorageDialog();
            openSourcesPanelWithFocus(null);
          }}
          refreshToken={sourceDiscoveryRefreshToken}
          onClose={closeMountStorageDialog}
        />
      {/if}

  <SystemToastStack
    updaterState={desktopUpdaterState}
    discoveryToast={sourceDiscoveryToast}
    shouldShowUpdater={shouldShowDesktopUpdaterToast(desktopUpdaterState)}
    updaterProgressSummary={desktopUpdaterProgressSummary as unknown as (state: any) => string}
    updaterPrimaryActionLabel={desktopUpdaterPrimaryActionLabel as unknown as (state: any) => string}
    onPrimaryAction={handleDesktopUpdaterPrimaryAction}
    onOpenRelease={openDesktopUpdaterReleasePage}
    onDismissUpdater={() => {
      desktopUpdaterState = null;
    }}
    onOpenDiscoveryDetails={openSourceDiscoveryDetails}
    onOpenDiscoveryDefaults={openSourceDiscoveryDefaults}
    onDismissDiscovery={acknowledgeSourceDiscovery}
  />

  {#if timelineDetailOpen}
    <TimelineDetailDialog
      title={timelineDetailEvent
        ? `${timelineKindLabel(timelineDetailEvent)} ${timelineHeadline(timelineDetailEvent)}`
        : timelineDetailPayloadDecrypted
          ? `${timelineDetailPayloadDecrypted.type} ${timelineDetailPayloadDecrypted.fileName}`
          : 'Event details'}
      subtitle={timelineDetailTimestamp !== null ? formatDate(timelineDetailTimestamp) : ''}
      loading={timelineDetailLoading}
      errorMessage={timelineDetailError}
      payload={timelineDetailPayload}
      decryptedPayload={timelineDetailPayloadDecrypted}
      hash={timelineDetailHash}
      encoded={timelineDetailEncoded}
      appSignature={timelineDetailAppSignature}
      appSignatureSource={timelineDetailAppSignatureSource}
      record={timelineDetailRecord}
      recordError={timelineDetailRecordError}
      message={timelineDetailMessage}
      messageError={timelineDetailMessageError}
      references={timelineDetailReferences}
      eventRefs={timelineDetailEventRefs}
      relevantSpecs={specDocsForPayload(timelineDetailPayloadDecrypted, timelineDetailEvent)}
      storageHits={timelineStorageHits()}
      storageError={timelineDetailStorageError}
      revealBusyPath={timelineDetailRevealBusyPath}
      expectedEventPath={timelineExpectedEventPath()}
      expectedBlockPath={timelineExpectedBlockPath()}
      authAvailable={Boolean(auth)}
      {formatDate}
      getStorageLabel={timelineStorageLocationLabel}
      getStoragePath={timelineStorageLocationPath}
      getStoragePresence={timelineStoragePresenceBadges}
      onClose={closeTimelineDetails}
      onRevealStorage={(location) => revealTimelineStorageLocation(location)}
      onOpenPayloadPreview={openEventPayloadPreview as unknown as (payload: any) => void}
      onOpenSpec={openSpecDoc}
      onPreviewReference={previewSourceReference as unknown as (reference: any) => void}
      onOpenEventRef={(eventHash) => openTimelineDetailsByHash(eventHash)}
    />
  {/if}

  {#if specModalOpen && specModalDoc}
    <SpecDialog
      title={specModalDoc.title}
      filename={specModalDoc.filename}
      content={specModalContent}
      onClose={closeSpecDoc}
    />
  {/if}

  {#if mountDialogMount}
    {@const secretHash = hasFileSecret(mountDialogMount) ? secretFileHashForMount(mountDialogMount) : null}
    <MountDialog
      mount={mountDialogMount}
      isEmpty={isMountEmpty(mountDialogMount)}
      mountLabel={mountLabel(mountDialogMount)}
      mode={mountDialogMode}
      resolvedVolumeId={mountDialogResolvedVolumeId ?? undefined}
      resolvedLastRefresh={mountDialogResolvedLastRefresh ? formatDate(mountDialogResolvedLastRefresh) : ''}
      storageLabel={mountDialogStorageLabel}
      isHistoryMode={mountDialogMount.id === activeMountId && isHistoryMode}
      resolvedOffline={mountDialogResolvedOffline}
      resolvedError={mountDialogResolvedError}
      {joinDialogSerialized}
      {joinDialogError}
      joinDialogPreview={joinDialogPreview}
      {joinDialogClipboardBusy}
      {joinDialogPreviewBusy}
      {joinDialogOpenBusy}
      {clipboardImageAvailable}
      clipboardImageLoading={clipboardImageLoading}
      filePreviewUrl={secretFilePayloadDataUrl(mountDialogMount)}
      fileIsImage={hasImageSecretPreview(mountDialogMount)}
      fileInfo={secretFileBytes(mountDialogMount) ? formatSize(secretFileBytes(mountDialogMount)?.byteLength ?? 0) : ''}
      fileHashLabel={hasFileSecret(mountDialogMount) ? 'SHA-256' : ''}
      fileHashValue={secretHash?.hash ?? ''}
      fileHashPending={secretHash?.pending ?? false}
      loading={isLoading && mountDialogMount.id === activeMountId}
      onClose={() => collapseMount(mountDialogMount.id)}
      onCopyVolumeId={() => void copyVolumeId(mountDialogResolvedVolumeId)}
      onOpenStorage={() => openMountStorageDialog(mountDialogMount.id)}
      onSetMode={setMountDialogMode}
      onJoinSerializedInput={(value) => {
        joinDialogSerialized = value;
      }}
      onReadClipboard={readJoinDialogClipboard}
      onOpenLink={openJoinDialogLink}
      onSecretValueInput={handleMountDialogValueInput}
      onSecretPasswordInput={handleMountDialogPasswordInput}
      onSecretFileSelected={handleMountDialogSecretSelected}
      onPasteButton={() => handlePasteImageButton(mountDialogMount.id)}
      onDownloadFile={() => downloadSecretFile(mountDialogMount)}
      onRemove={() => removeMount(mountDialogMount.id)}
    />
  {/if}

  {#if showCreateChooser}
    <CreateChooserDialog
      onClose={closeCreateChooser}
      onCreateHub={startCreateHub}
      onCreateIdentity={startCreateIdentity}
      onPasteLink={() => void openJoinVolumeDialogFromClipboard()}
    />
  {/if}

  {#if showIdentityManager}
    <IdentityManagerDialog
      {configuredIdentities}
      {activeChatIdentityId}
      {currentVolumeChatIdentityId}
      {joinedChatIdentityNeedsPublish}
      {selectedChatIdentityNeedsPublish}
      {selectedChatIdentity}
      {selectedChatIdentityStatus}
      selectedSecretPreviewUrl={selectedChatIdentity ? configuredIdentitySecretDataUrl(selectedChatIdentity) : null}
      selectedSecretIsImage={selectedChatIdentity ? configuredIdentityHasImageSecret(selectedChatIdentity) : false}
      selectedAvatarLabel={selectedChatIdentity ? configuredIdentityAvatarLabel(selectedChatIdentity) : ''}
      errorMessage={identityManagerError}
      successMessage={identityManagerMessage}
      {identityManagerLoading}
      {identityManagerAction}
      activeHubAuth={Boolean(activeHubAuth)}
      {isHistoryMode}
      onClose={closeIdentityManager}
      onAddIdentity={addConfiguredChatIdentity}
      onSelectIdentity={(identityId) => {
        activeChatIdentityId = identityId;
        identityManagerError = '';
        identityManagerMessage = '';
      }}
      onSecretValueInput={handleSelectedIdentityValueInput}
      onSecretPasswordInput={handleSelectedIdentityPasswordInput}
      onSecretFileSelected={handleSelectedIdentitySecretSelected}
      onClearSecretFile={() => {
        if (selectedChatIdentity) {
          clearConfiguredChatIdentitySecretFile(selectedChatIdentity.id);
        }
      }}
      onAvatarFileSelected={(file) => {
        if (selectedChatIdentity) {
          return applyAvatarFileToIdentity(file, selectedChatIdentity.id);
        }
      }}
      onClearAvatar={() => {
        if (selectedChatIdentity) {
          clearConfiguredChatIdentityAvatar(selectedChatIdentity.id);
        }
      }}
      onDisplayNameInput={(value) => {
        if (selectedChatIdentity) {
          updateConfiguredChatIdentity(selectedChatIdentity.id, { displayName: value });
        }
      }}
      onBioInput={(value) => {
        if (selectedChatIdentity) {
          updateConfiguredChatIdentity(selectedChatIdentity.id, { bio: value });
        }
      }}
      onRemoveIdentity={() => {
        if (selectedChatIdentity) {
          removeConfiguredChatIdentity(selectedChatIdentity.id);
        }
      }}
      onPublish={() => void publishSelectedChatIdentity()}
      onJoin={() => void joinCurrentVolumeChat()}
    />
  {/if}

  {#if showVolumeShareDialog}
    <ShareDialog
      canCopySecretLink={hasCopyableCurrentSecret()}
      shareLinkBusy={joinLinkCopyBusy}
      shareLinkFeedback={volumeSharingFeedback}
      onCopyShareLink={copyCurrentJoinLink}
      onManageStorage={openVolumeShareStoragePanel}
      onClose={closeVolumeShareDialog}
    />
  {/if}

  {#if showJoinVolumeDialog}
    <JoinDialog
      serialized={joinDialogSerialized}
      error={joinDialogError}
      preview={joinDialogPreview}
      opened={joinDialogOpened}
      clipboardBusy={joinDialogClipboardBusy}
      previewBusy={joinDialogPreviewBusy}
      openBusy={joinDialogOpenBusy}
      onSerializedInput={(value) => {
        joinDialogSerialized = value;
      }}
      onReadClipboard={readJoinDialogClipboard}
      onOpenLink={openJoinDialogLink}
      onClose={closeJoinVolumeDialog}
    />
  {/if}

  {#if showResetDialog}
    <ResetDialog
      deleteLocalData={resetDialogDeleteLocalData}
      busy={resetDialogBusy}
      errorMessage={resetDialogError}
      onDeleteLocalDataChange={(value) => {
        resetDialogDeleteLocalData = value;
      }}
      onCancel={closeResetDialog}
      onConfirm={confirmStoredConfigReset}
    />
  {/if}

  {#if isInAppThemeStudioEnabled && showThemeDialog}
    <ThemeStudioDialog
      {themeSettings}
      {themeRegistry}
      activePreset={activeThemePreset()}
      section={themeDialogSection}
      busy={themeDialogBusy}
      errorMessage={themeDialogError}
      feedback={themeDialogFeedback}
      onClose={() => uiTransitions.closeThemeDialog()}
      onSetSection={(value) => uiTransitions.setThemeDialogSection(value)}
      onApplyPreset={applyThemePreset}
      onUpdateSurfaceStyle={updateThemeSurfaceStyle as unknown as (value: any) => void}
      onUpdatePaletteColor={updateThemePaletteColor}
      onUpdateLogoColor={updateThemeLogoColor as unknown as (key: any, value: string) => void}
      onUpdateLogoNumber={updateThemeLogoNumber as unknown as (key: any, value: number) => void}
      onUpdateArcStyle={updateThemeArcStyle as unknown as (value: any) => void}
      onSavePresetJson={saveThemePresetEdits}
      onSetAsDefault={setThemePresetAsDefault}
      onExportLogoPng={exportThemeLogoPng}
      onResetToPreset={resetThemeToPreset}
      onLogoPreviewChange={(value) => {
        themeDialogLogoPreview = value;
      }}
    />
  {/if}

</div>

<DevBadge />
