<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import { devSurface, getDevContext } from '../dev.js';
  import {
    acceptManagedShare,
    acceptIncomingProviderContactInvite,
    attachManagedShare,
    chooseDirectoryPath,
    configureProviderSetup,
    connectProviderAccount,
    createManagedShare,
    consolidateRoot,
    disconnectProviderAccount,
    discoverSources,
    getAppConfig,
    readDesktopRuntimeLogs,
    getManagedShareState,
    getStorageLocationRepairReport,
    getRootsConfig,
    hasDesktopDirectoryPicker,
    installProviderHelper,
    inviteManagedShare,
    listLocalNetworkPeers,
    listIncomingManagedShares,
    listIncomingProviderContactInvites,
    listManagedShares,
    listProviderAccounts,
    syncLocalNetworkPeer,
    updateProviderEnabled,
    openPathInFileManager,
    openRootInFileManager,
    repairStorageLocation,
    removeManagedShare,
    watchSources,
    type DiscoveredNearbytesSource,
    type AppConfig,
    type IncomingManagedShareOffer,
    type IncomingProviderContactInvite,
    type LocalNetworkPeer,
    type LocalNetworkPeersResponse,
    type ManagedShareSummary,
    type ProviderAccount,
    type ProviderAuthSession,
    type ProviderCatalogEntry,
    type ReconcileSourcesResponse,
    type RootsConfig,
    type RootsRuntimeSnapshot,
    type SourceConfigEntry,
    type SourceProvider,
    type StorageLocationRepairReport,
    type VolumeDestinationConfig,
    type VolumePolicyEntry,
    updateRootsConfig,
  } from '../../../../../ui/src/lib/api.js';
  import type { DesktopRuntimeLogEntry } from '../desktop.js';
  import { readMirrorLocalNetworkPeers } from '../../../../../ui/src/lib/mirror/browserMirror.js';
  import {
    formatAccessLevelLabel,
    getCollaboratorDedupeKey,
    getCollaboratorDisplayLabel,
    getCollaboratorRoleLabel,
    getIncomingSharePresentation,
    getManagedShareAccessLabel,
  } from '../sharePresentation.js';
  import ArmedActionButton from './ArmedActionButton.svelte';
  import AppDialog from './AppDialog.svelte';
  import IconToggle from './IconToggle.svelte';
  import ProviderStatusCard from './ProviderStatusCard.svelte';
  import ShareCard from './ShareCard.svelte';
  import StatusNotice from './StatusNotice.svelte';
  import {
    ArrowRightLeft,
    BookOpen,
    FolderOpen,
    HardDrive,
    Link2,
    Power,
    Plus,
    RefreshCw,
    Search,
    SquarePen,
    Trash2,
  } from 'lucide-svelte';
  const dev = getDevContext();

  let {
    mode = 'volume',
    volumeId = null,
    currentVolumePresentation = null,
    knownVolumes = [],
    onOpenVolumeRouting = undefined,
    onOpenStorageSetup = undefined,
    discoveryDetails = null,
    refreshToken = 0,
    focusSection = null,
  } = $props<{
    mode?: 'global' | 'volume';
    volumeId: string | null;
    currentVolumePresentation?: {
      volumeId: string;
      label: string;
      filePayload: string;
      fileMimeType: string;
      fileName: string;
    } | null;
    knownVolumes?: Array<{ volumeId: string; label: string }>;
    onOpenVolumeRouting?: ((volumeId: string) => void) | undefined;
    onOpenStorageSetup?: (() => void) | undefined;
    discoveryDetails?: ReconcileSourcesResponse | null;
    refreshToken?: number;
    focusSection?: 'discovery' | 'defaults' | 'shares' | null;
  }>();

  type StatusTone = 'good' | 'warn' | 'muted';
  type HubLocationMode = 'store' | 'off';

  type ProviderTabLoadingState = {
    label: string;
    detail: string;
  };

  type MegaDiagnosticView = {
    id: string;
    title: string;
    summary: string;
    detail: string;
    facts: Array<{ label: string; value: string }>;
  };

  type MegaLocationActivityStep = {
    shareId: string;
    name: string;
    phase: string;
    tone: 'good' | 'muted' | 'warn';
  };

  type MegaStatusView = {
    headline: string;
    detail: string;
    tone: 'good' | 'muted' | 'warn';
    syncing: boolean;
    progressPercent: number | null;
    progressLabel: string;
    selfRepairCopy: string;
    showProgressBar: boolean;
    /** Per-folder native sync phase; clearer than a single ready/total ratio. */
    locationSteps: MegaLocationActivityStep[];
  };

  type MegaTabFocusTarget = 'overview' | 'account' | 'publishing' | 'incoming';

  type MegaToastAction = {
    label: string;
    kind: 'focus' | 'refresh' | 'logs';
    target?: MegaTabFocusTarget;
  };

  type MegaToast = {
    key: string;
    tone: 'good' | 'muted' | 'warn';
    title: string;
    detail: string;
    action: MegaToastAction | null;
    persistent: boolean;
  };

  type CollaboratorView = {
    key: string;
    label: string;
    role?: string;
    status: 'active' | 'invited';
    source: 'provider' | 'nearbytes';
  };

  const DISMISSED_DISCOVERY_KEY = 'nearbytes-source-discovery-dismissed-v1';
  const DISMISSED_INCOMING_OFFERS_KEY = 'nearbytes-incoming-share-dismissed-v1';
  const RESERVE_OPTIONS = [0, 5, 10, 15, 20, 25, 30];
  const DEFAULT_RESERVE_PERCENT = 5;
  const GENERIC_FOLDER_NAMES = new Set(['data', 'files', 'local', 'nearbytes', 'shared', 'storage', 'sync']);
  const DISCOVERY_SCAN_MAX_DEPTH = 1;
  const DISCOVERY_SCAN_MAX_DIRECTORIES = 600;
  const PANEL_REQUEST_TIMEOUT_MS: number | null = null;
  const INITIAL_ROOTS_REQUEST_TIMEOUT_MS = 2_500;
  const BACKGROUND_ROOTS_FALLBACK_TIMEOUT_MS = 2_500;
  const INITIAL_ROOTS_REQUEST_MAX_WAIT_MS = 20_000;
  const INITIAL_ROOTS_REQUEST_RETRY_DELAY_MS = 500;
  const AUTHORITATIVE_MANAGED_SHARE_REFRESH_MS = 3_000;
  const AUTHORITATIVE_MANAGED_SHARE_RAPID_REFRESH_MS = 1_200;
  const LOCAL_NETWORK_REFRESH_MS = 4_000;
  const DEFAULT_DESTINATION: VolumeDestinationConfig = {
    sourceId: '',
    enabled: true,
    storeEvents: true,
    storeBlocks: true,
    copySourceBlocks: true,
    reservePercent: DEFAULT_RESERVE_PERCENT,
    fullPolicy: 'block-writes',
  };

  function sanitizeSource(source: SourceConfigEntry): SourceConfigEntry {
    return {
      ...source,
      reservePercent: source.reservePercent ?? DEFAULT_RESERVE_PERCENT,
      opportunisticPolicy: 'block-writes',
    };
  }

  function sanitizeDestination(destination: VolumeDestinationConfig): VolumeDestinationConfig {
    return {
      ...destination,
      enabled: destination.enabled,
      storeEvents: destination.enabled,
      storeBlocks: destination.enabled,
      copySourceBlocks: destination.enabled,
      reservePercent: destination.reservePercent ?? DEFAULT_RESERVE_PERCENT,
      fullPolicy: 'block-writes',
    };
  }

  function sanitizeConfig(config: RootsConfig): RootsConfig {
    return {
      version: 2,
      sources: config.sources.map((source) => sanitizeSource(source)),
      defaultVolume: {
        destinations: config.defaultVolume.destinations.map((destination) => sanitizeDestination(destination)),
      },
      volumes: config.volumes.map((volume) => ({
        volumeId: volume.volumeId,
        destinations: volume.destinations.map((destination) => sanitizeDestination(destination)),
      })),
    };
  }

  let configPath = $state<string | null>(null);
  let configDraft = $state<RootsConfig | null>(null);
  let runtime = $state<RootsRuntimeSnapshot | null>(null);
  let loading = $state(true);
  let errorMessage = $state('');
  let successMessage = $state('');
  let startupRecoveryMessage = $state('');
  let discoveryLoading = $state(false);
  let discoveryError = $state('');
  let discoveredSources = $state<DiscoveredNearbytesSource[]>([]);
  let dismissedDiscoveries = $state<string[]>(loadDismissedDiscoveries());
  let dismissedIncomingOffers = $state<string[]>(loadDismissedIncomingOffers());
  let movingSourceId = $state<string | null>(null);
  let repairingSourceId = $state<string | null>(null);
  let providerAccounts = $state<ProviderAccount[]>([]);
  let runtimeAppConfig = $state<AppConfig | null>(null);
  let providerCatalog = $state<ProviderCatalogEntry[]>(defaultProviderCatalogEntries());
  let localNetworkService = $state<LocalNetworkPeersResponse['service'] | null>(null);
  let localNetworkPeers = $state<LocalNetworkPeer[]>([]);
  let localNetworkSupported = $state(true);
  let managedShares = $state<ManagedShareSummary[]>([]);
  let incomingManagedShareOffers = $state<IncomingManagedShareOffer[]>([]);
  let incomingProviderContactInvites = $state<IncomingProviderContactInvite[]>([]);
  let providersLoading = $state(false);
  let sharesLoading = $state(false);
  let incomingLoading = $state(false);
  let providerLoadError = $state('');
  let localNetworkLoadError = $state('');
  let shareLoadError = $state('');
  let incomingLoadError = $state('');
  let integrationBusyKey = $state<string | null>(null);
  let syncingLocalNetworkPeerId = $state<string | null>(null);
  let providerAuthSessions = $state<Record<string, ProviderAuthSession>>({});
  let providerFlowStates = $state<Record<string, ProviderFlowState>>({});
  let providerCredentialDrafts = $state<Record<string, {
    mode: 'login';
    name: string;
    email: string;
    password: string;
    mfaCode: string;
    useMfa: boolean;
    confirmationLink: string;
  }>>({});
  let providerSetupDrafts = $state<Record<string, { clientId: string }>>({});
  let providerShareDrafts = $state<Record<string, { repoOwner: string; repoName: string; branch: string; basePath: string }>>({});
  let providerLocationNameDrafts = $state<Record<string, string>>({});
  let providerCreateComposerOpen = $state<Record<string, boolean>>({});
  let managedShareInviteDrafts = $state<Record<string, string>>({});
  let megaIssueLogExpanded = $state<Record<string, boolean>>({});
  let megaRuntimeLogsVisible = $state(false);
  let megaRuntimeLogs = $state<DesktopRuntimeLogEntry[]>([]);
  let megaRuntimeLogsLoading = $state(false);
  let megaRuntimeLogsError = $state('');
  let megaRuntimeLogsUpdatedAt = $state<number | null>(null);
  let megaRuntimeLogSelection = $state<string | null>(null);
  let megaRuntimeLogAutoRefresh = $state(true);
  let megaRuntimeLogWrap = $state(true);
  let megaRuntimeLogFilter = $state('');
  let megaRuntimeLogCopyFeedback = $state('');
  let providerDisconnectArmed = $state<Record<string, boolean>>({});
  let providerConnectionDialog = $state<string | null>(null);
  let sourceRepairReports = $state<Record<string, StorageLocationRepairReport>>({});
  let hubLocationDialogVolumeId = $state<string | null>(null);
  let selectedGlobalProvider = $state('local');
  let selectedGlobalView = $state<'local' | 'provider' | 'incoming'>('local');
  let megaToastDismissals = $state<Record<string, string>>({});
  let autosaveStatus = $state<'idle' | 'pending' | 'saving' | 'saved' | 'error'>('idle');
  let lastSavedSignature = $state('');
  let lastRefreshToken = $state(0);
  let activeReserveEditorKey = $state<string | null>(null);
  let discoveryRunId = 0;

  let megaOverviewSection = $state<HTMLElement | null>(null);
  let megaAccountSection = $state<HTMLElement | null>(null);
  let megaPublishingSection = $state<HTMLElement | null>(null);
  let megaIncomingSection = $state<HTMLElement | null>(null);

  type ShareBadge = {
    label: string;
    tone?: 'good' | 'muted' | 'warn' | 'durable' | 'replica' | 'off';
    description?: string;
  };
  type ShareAttachmentChip = {
    volumeId: string;
    label: string;
    known: boolean;
    usageBytes: number;
    usagePercent: number;
  };
  type ProviderFlowState = {
    phase:
      | 'installing'
      | 'connecting'
      | 'waiting-confirmation'
      | 'confirming'
      | 'polling'
      | 'cancelled';
    title: string;
    detail: string;
    canCancel: boolean;
    canReset: boolean;
  };
  type UnifiedShareView = {
    provider: string;
    title: string;
    pathLabel?: string;
    copy: string;
    active: boolean;
    statusBadges: ShareBadge[];
    meta: string[];
    readable: boolean;
    writable: boolean;
    writableDisabled?: boolean;
    writableTitle?: string;
    reservePercent: number;
    reserveKey: string;
    warning?: string;
    repairSummary?: string;
    repairDetails?: string[];
    attachments: ShareAttachmentChip[];
    onToggleReadable: () => void;
    onToggleWritable: () => void;
    onReserveChange: (nextValue: number) => void;
    onOpen?: () => void;
    openDisabled?: boolean;
    openTitle?: string;
    onTrashIssues?: () => void;
    onDeleteIssues?: () => void;
    repairBusy?: boolean;
    onMove?: () => void;
    moveDisabled?: boolean;
    moveLabel?: string;
    onRemove?: () => void;
    canRemove?: boolean;
    removeResetKey?: string;
  };

  const providerSessionTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const providerAbortControllers = new Map<string, AbortController>();
  let sourceWatchConnection: { close(): void } | null = null;
  let runtimeRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  let backfillPollTimer: ReturnType<typeof setTimeout> | null = null;
  let megaRuntimeLogRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  let localNetworkRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  let panelRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  let startupLoadRetryTimer: ReturnType<typeof setTimeout> | null = null;
  let managedShareStateRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  let runtimeRefreshInFlight = false;
  let managedShareStateRefreshInFlight = false;
  let backfillPollIdleRounds = 0;
  let lastBackfillProgressSignature = '';

  onMount(() => {
    void loadPanel();
    scheduleLocalNetworkRefresh();

    sourceWatchConnection = watchSources({
      onUpdate() {
        scheduleRuntimeRefresh();
      },
      onError(error) {
        console.warn('Storage panel source watch unavailable:', error);
      },
      onClose() {
        sourceWatchConnection = null;
      },
    });
  });

  onDestroy(() => {
    for (const timer of providerSessionTimers.values()) {
      clearTimeout(timer);
    }
    providerSessionTimers.clear();
    for (const controller of providerAbortControllers.values()) {
      controller.abort();
    }
    providerAbortControllers.clear();
    if (runtimeRefreshTimer) {
      clearTimeout(runtimeRefreshTimer);
      runtimeRefreshTimer = null;
    }
    if (backfillPollTimer) {
      clearTimeout(backfillPollTimer);
      backfillPollTimer = null;
    }
    if (megaRuntimeLogRefreshTimer) {
      clearTimeout(megaRuntimeLogRefreshTimer);
      megaRuntimeLogRefreshTimer = null;
    }
    if (localNetworkRefreshTimer) {
      clearTimeout(localNetworkRefreshTimer);
      localNetworkRefreshTimer = null;
    }
    if (panelRefreshTimer) {
      clearTimeout(panelRefreshTimer);
      panelRefreshTimer = null;
    }
    if (startupLoadRetryTimer) {
      clearTimeout(startupLoadRetryTimer);
      startupLoadRetryTimer = null;
    }
    if (managedShareStateRefreshTimer) {
      clearTimeout(managedShareStateRefreshTimer);
      managedShareStateRefreshTimer = null;
    }
    sourceWatchConnection?.close();
    sourceWatchConnection = null;
  });

  function scheduleLocalNetworkRefresh(delayMs = LOCAL_NETWORK_REFRESH_MS): void {
    if (localNetworkRefreshTimer) {
      clearTimeout(localNetworkRefreshTimer);
    }
    localNetworkRefreshTimer = setTimeout(() => {
      localNetworkRefreshTimer = null;
      void refreshLocalNetworkPeers({ background: true }).finally(() => {
        scheduleLocalNetworkRefresh();
      });
    }, delayMs);
  }

  $effect(() => {
    if (refreshToken === 0 || refreshToken === lastRefreshToken) return;
    lastRefreshToken = refreshToken;
    void loadPanel({ background: configDraft !== null });
  });

  $effect(() => {
    persistDismissedDiscoveries(dismissedDiscoveries);
  });

  $effect(() => {
    persistDismissedIncomingOffers(dismissedIncomingOffers);
  });

  $effect(() => {
    if (megaRuntimeLogCopyFeedback === '') return;
    const timer = setTimeout(() => {
      megaRuntimeLogCopyFeedback = '';
    }, 1800);
    return () => {
      clearTimeout(timer);
    };
  });

  $effect(() => {
    if (megaRuntimeLogRefreshTimer) {
      clearTimeout(megaRuntimeLogRefreshTimer);
      megaRuntimeLogRefreshTimer = null;
    }
    if (!megaRuntimeLogsVisible || !megaRuntimeLogAutoRefresh) {
      return;
    }
    megaRuntimeLogRefreshTimer = setTimeout(() => {
      megaRuntimeLogRefreshTimer = null;
      void loadMegaRuntimeLogs();
    }, 2500);
    return () => {
      if (megaRuntimeLogRefreshTimer) {
        clearTimeout(megaRuntimeLogRefreshTimer);
        megaRuntimeLogRefreshTimer = null;
      }
    };
  });

  $effect(() => {
    if (mode === 'global') return;
  });

  $effect(() => {
    if (mode !== 'volume' || !volumeId || hubLocationDialogVolumeId !== volumeId) {
      hubLocationDialogVolumeId = null;
    }
  });

  $effect(() => {
    const availableProviders = new Set(['local', ...providerCatalog.map((provider) => provider.provider)]);
    if (!availableProviders.has(selectedGlobalProvider)) {
      selectedGlobalProvider = 'local';
      selectedGlobalView = 'local';
      return;
    }
    if (selectedGlobalProvider === 'local' && selectedGlobalView !== 'local') {
      selectedGlobalView = 'local';
    }
  });

  $effect(() => {
    if (selectedGlobalView !== 'incoming') {
      return;
    }
    if (incomingReviewTargetProvider() === null) {
      selectedGlobalView = selectedGlobalProvider === 'local' ? 'local' : 'provider';
    }
  });

  $effect(() => {
    if (!configDraft || loading) return;
    const nextSignature = serializeConfig(configDraft);
    if (nextSignature === lastSavedSignature) return;
    autosaveStatus = 'pending';
    const timer = setTimeout(() => {
      void autosavePanel(nextSignature);
    }, 700);
    return () => {
      clearTimeout(timer);
    };
  });

  function loadDismissedDiscoveries(): string[] {
    try {
      const raw = localStorage.getItem(DISMISSED_DISCOVERY_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((value) => typeof value === 'string')
        .map((value) => normalizeComparablePath(value))
        .filter((value, index, values) => value !== '' && values.indexOf(value) === index);
    } catch {
      return [];
    }
  }

  function persistDismissedDiscoveries(values: string[]): void {
    try {
      localStorage.setItem(DISMISSED_DISCOVERY_KEY, JSON.stringify(values));
    } catch {
      // Ignore local storage failures.
    }
  }

  function normalizeDismissedIncomingOfferKey(value: string): string {
    return value.trim().toLowerCase();
  }

  function incomingOfferDismissKey(offer: Pick<IncomingManagedShareOffer, 'provider' | 'accountId' | 'id'>): string {
    return normalizeDismissedIncomingOfferKey(`${offer.provider}:${offer.accountId}:${offer.id}`);
  }

  function loadDismissedIncomingOffers(): string[] {
    try {
      const raw = localStorage.getItem(DISMISSED_INCOMING_OFFERS_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((value) => typeof value === 'string')
        .map((value) => normalizeDismissedIncomingOfferKey(value))
        .filter((value, index, values) => value !== '' && values.indexOf(value) === index);
    } catch {
      return [];
    }
  }

  function persistDismissedIncomingOffers(values: string[]): void {
    try {
      localStorage.setItem(DISMISSED_INCOMING_OFFERS_KEY, JSON.stringify(values));
    } catch {
      // Ignore local storage failures.
    }
  }

  function cloneConfig(config: RootsConfig): RootsConfig {
    return sanitizeConfig(config);
  }

  function serializeConfig(config: RootsConfig): string {
    return JSON.stringify(config);
  }

  function normalizeComparablePath(value: string): string {
    return value.trim().replace(/\\/g, '/').replace(/\/+$/u, '').toLowerCase();
  }

  function normalizeDisplayPath(value: string): string {
    return value.trim().replace(/\\/g, '/').replace(/\/+$/u, '');
  }

  function pathSegments(value: string): string[] {
    return normalizeDisplayPath(value).split('/').filter((segment) => segment.length > 0);
  }

  function detectProviderFromPath(value: string): SourceProvider {
    const lower = value.toLowerCase();
    if (lower.includes('dropbox')) return 'dropbox';
    if (lower.includes('onedrive')) return 'onedrive';
    if (lower.includes('icloud') || lower.includes('clouddocs') || lower.includes('mobile documents')) {
      return 'icloud';
    }
    if (lower.includes('google drive') || lower.includes('googledrive') || lower.includes('gdrive')) {
      return 'gdrive';
    }
    if (lower.includes('mega')) return 'mega';
    return 'local';
  }

  function formatProvider(provider: SourceProvider): string {
    if (provider === 'gdrive') return 'Google Drive';
    if (provider === 'dropbox') return 'Dropbox';
    if (provider === 'mega') return 'MEGA';
    if (provider === 'icloud') return 'Apple/iCloud';
    if (provider === 'onedrive') return 'OneDrive';
    return 'Local folder';
  }

  function sourceLocationKindLabel(provider: SourceProvider): string {
    if (provider === 'gdrive') return 'Google Drive sync folder';
    if (provider === 'dropbox') return 'Dropbox sync folder';
    if (provider === 'mega') return 'MEGA sync folder';
    if (provider === 'icloud') return 'iCloud sync folder';
    if (provider === 'onedrive') return 'OneDrive sync folder';
    return 'Folder on this device';
  }

  function sourceLocationTitle(path: string): string {
    const segments = pathSegments(path);
    if (segments.length === 0) return 'Choose a folder';
    const leaf = segments[segments.length - 1];
    const parent = segments.length > 1 ? segments[segments.length - 2] : null;
    if (!parent) {
      return leaf;
    }
    return `${parent} / ${leaf}`;
  }

  function sourceLocationPath(path: string): string {
    const normalized = normalizeDisplayPath(path);
    return normalized || 'Choose a folder';
  }

  function compactPath(value: string): string {
    const normalized = normalizeDisplayPath(value);
    if (normalized === '') return 'Choose a folder';
    const parts = normalized.split('/').filter((part) => part.length > 0);
    return parts[parts.length - 1] ?? normalized;
  }

  function formatPercent(value: number): string {
    return `${value}%`;
  }

  function formatSize(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes < 0) return 'n/a';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit += 1;
    }
    return `${value >= 100 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
  }

  function storageMeasurementSummary(usedBytes: number | null | undefined, freeBytes: number | null | undefined): string | null {
    const parts: string[] = [];
    if (typeof usedBytes === 'number' && usedBytes > 0) {
      parts.push(`${formatSize(usedBytes)} used`);
    }
    if (typeof freeBytes === 'number' && freeBytes > 0) {
      parts.push(`${formatSize(freeBytes)} free`);
    }
    return parts.length > 0 ? parts.join(' / ') : null;
  }

  function countLabel(count: number, singular: string, plural = `${singular}s`): string {
    return `${count} ${count === 1 ? singular : plural}`;
  }

  function connectedProviderCount(): number {
    return providerAccounts.filter((account) => account.state === 'connected').length;
  }

  function readyMirrorCount(): number {
    return managedShares.filter((summary) => summary.state.status === 'ready').length;
  }

  function isLocalMachineShare(source: SourceConfigEntry): boolean {
    return !source.integration || source.integration.kind !== 'provider-managed';
  }

  function activeFolderCount(): number {
    return localShares().filter((source) => source.enabled).length;
  }

  function totalIncomingReviewCount(): number {
    return incomingManagedShareOffers.length + incomingProviderContactInvites.length;
  }

  function providerIncomingActionableCount(provider: string): number {
    return incomingManagedSharesForProvider(provider).length + incomingProviderInvitesForProvider(provider).length;
  }

  function isIncomingManagedShareOfferDismissed(offer: IncomingManagedShareOffer): boolean {
    return dismissedIncomingOffers.includes(incomingOfferDismissKey(offer));
  }

  function dismissedIncomingManagedShareCount(provider: string): number {
    return incomingManagedShareOffers.filter(
      (offer) => offer.provider === provider && isIncomingManagedShareOfferDismissed(offer)
    ).length;
  }

  function dismissIncomingManagedShareOffer(offer: IncomingManagedShareOffer): void {
    const key = incomingOfferDismissKey(offer);
    if (dismissedIncomingOffers.includes(key)) {
      return;
    }
    dismissedIncomingOffers = [...dismissedIncomingOffers, key];
    successMessage = `${incomingManagedShareTitle(offer)} hidden on this device.`;
  }

  function restoreDismissedIncomingManagedShares(provider: string): void {
    const prefix = normalizeDismissedIncomingOfferKey(`${provider}:`);
    const nextValues = dismissedIncomingOffers.filter((key) => !key.startsWith(prefix));
    if (nextValues.length === dismissedIncomingOffers.length) {
      return;
    }
    dismissedIncomingOffers = nextValues;
    successMessage = `Hidden ${providerLabelForIncoming(provider)} shares are visible again.`;
  }

  function incomingReviewTargetProvider(): string | null {
    for (const provider of providerCatalog) {
      if (providerIncomingActionableCount(provider.provider) > 0) {
        return provider.provider;
      }
    }
    return providerCatalog.find((entry) => entry.isConnected && providerShowsIncomingShareSection(entry.provider))?.provider ?? null;
  }

  function providerSelectionDetail(entry: ProviderCatalogEntry): string {
    if (entry.provider === 'local-network') {
      return 'Nearby Nearbytes peers appear here automatically and sync without manual addresses or ports.';
    }
    if (!entry.isConnected) {
      if (entry.provider === 'mega') {
        return 'Connect this if you want Nearbytes to use MEGA for your own locations or incoming locations.';
      }
      return `Connect ${entry.label} only if you want a storage location there.`;
    }
    if (entry.provider === 'mega') {
      return 'Nearbytes keeps your own MEGA locations separate from incoming locations.';
    }
    if (providerShowsIncomingShareSection(entry.provider)) {
      return 'Your own locations stay separate from incoming locations.';
    }
    return 'Use this service only for the storage locations you choose here.';
  }

  function connectedAccountForProvider(provider: string): ProviderAccount | null {
    return providerAccounts.find((account) => account.provider === provider) ?? null;
  }

  function pendingSessionForProvider(provider: string): ProviderAuthSession | null {
    return providerAuthSessions[provider] ?? null;
  }

  function providerCredentialDraft(provider: string): {
    mode: 'login';
    name: string;
    email: string;
    password: string;
    mfaCode: string;
    useMfa: boolean;
    confirmationLink: string;
  } {
    return providerCredentialDrafts[provider] ?? {
      mode: 'login',
      name: '',
      email: '',
      password: '',
      mfaCode: '',
      useMfa: false,
      confirmationLink: '',
    };
  }

  function providerSetupDraft(provider: string): { clientId: string } {
    return providerSetupDrafts[provider] ?? { clientId: '' };
  }

  function providerFlowState(provider: string): ProviderFlowState | null {
    return providerFlowStates[provider] ?? null;
  }

  function providerShareDraft(provider: string): { repoOwner: string; repoName: string; branch: string; basePath: string } {
    return providerShareDrafts[provider] ?? {
      repoOwner: '',
      repoName: '',
      branch: 'main',
      basePath: '',
    };
  }

  function providerLocationNameDraft(provider: string): string {
    return providerLocationNameDrafts[provider] ?? '';
  }

  function isInlineLocationComposerProvider(provider: string): boolean {
    return provider !== 'github';
  }

  function isProviderCreateComposerOpen(provider: string): boolean {
    return providerCreateComposerOpen[provider] ?? false;
  }

  function setProviderCredential(
    provider: string,
    field: 'mode' | 'name' | 'email' | 'password' | 'mfaCode' | 'useMfa' | 'confirmationLink',
    value: string | boolean
  ): void {
    providerCredentialDrafts = {
      ...providerCredentialDrafts,
      [provider]: {
        ...providerCredentialDraft(provider),
        [field]: value,
      },
    };
  }

  function setProviderSetupField(
    provider: string,
    field: 'clientId',
    value: string
  ): void {
    providerSetupDrafts = {
      ...providerSetupDrafts,
      [provider]: {
        ...providerSetupDraft(provider),
        [field]: value,
      },
    };
  }

  function setProviderShareField(
    provider: string,
    field: 'repoOwner' | 'repoName' | 'branch' | 'basePath',
    value: string
  ): void {
    providerShareDrafts = {
      ...providerShareDrafts,
      [provider]: {
        ...providerShareDraft(provider),
        [field]: value,
      },
    };
  }

  function setProviderLocationName(provider: string, value: string): void {
    providerLocationNameDrafts = {
      ...providerLocationNameDrafts,
      [provider]: value,
    };
  }

  function setProviderCreateComposerOpenState(provider: string, open: boolean): void {
    providerCreateComposerOpen = {
      ...providerCreateComposerOpen,
      [provider]: open,
    };
  }

  function openProviderCreateComposer(provider: string): void {
    setProviderCreateComposerOpenState(provider, true);
  }

  function closeProviderCreateComposer(provider: string): void {
    setProviderCreateComposerOpenState(provider, false);
    setProviderLocationName(provider, '');
  }

  function setProviderFlowState(provider: string, state: ProviderFlowState | null): void {
    if (state === null) {
      if (!(provider in providerFlowStates)) return;
      const next = { ...providerFlowStates };
      delete next[provider];
      providerFlowStates = next;
      return;
    }
    providerFlowStates = {
      ...providerFlowStates,
      [provider]: state,
    };
  }

  function beginProviderRequest(provider: string, state: ProviderFlowState): AbortController {
    const existing = providerAbortControllers.get(provider);
    existing?.abort();
    const controller = new AbortController();
    providerAbortControllers.set(provider, controller);
    setProviderFlowState(provider, state);
    return controller;
  }

  function finishProviderRequest(provider: string, controller: AbortController, clearFlow = true): void {
    if (providerAbortControllers.get(provider) === controller) {
      providerAbortControllers.delete(provider);
    }
    if (clearFlow && providerAbortControllers.get(provider) === undefined) {
      setProviderFlowState(provider, null);
    }
  }

  function isAbortError(error: unknown): boolean {
    return error instanceof DOMException
      ? error.name === 'AbortError'
      : error instanceof Error && error.name === 'AbortError';
  }

  function hasProviderDraft(provider: string): boolean {
    const draft = providerCredentialDraft(provider);
    return Boolean(
      draft.name.trim() ||
        draft.email.trim() ||
        draft.password ||
        draft.mfaCode.trim() ||
        draft.confirmationLink.trim() ||
        draft.useMfa
    );
  }

  function canResetProviderFlow(provider: string): boolean {
    return pendingSessionForProvider(provider) !== null || providerFlowState(provider) !== null || hasProviderDraft(provider);
  }

  function canSubmitMegaAction(provider: string): boolean {
    const draft = providerCredentialDraft(provider);
    if (draft.email.trim() === '' || draft.password.trim() === '') {
      return false;
    }
    return !draft.useMfa || draft.mfaCode.trim() !== '';
  }

  function megaPrimaryActionLabel(provider: string): string {
    if (integrationBusyKey === `confirm:${provider}`) {
      return 'Confirming...';
    }
    if (integrationBusyKey === `connect:${provider}`) {
      return 'Signing in...';
    }
    return 'Sign in to MEGA';
  }

  function megaOnboardingCopy(provider: string): string {
    const pending = pendingSessionForProvider(provider);
    if (pending) {
      return pending.detail || 'Pending signup confirmations are no longer supported in-app. Complete setup on mega.io, then sign in here.';
    }
    return 'Sign in once. Nearbytes creates or reuses your writable MEGA root, refreshes incoming shares locally, and keeps publishing isolated to your own account.';
  }

  async function submitMegaAction(provider: ProviderCatalogEntry): Promise<void> {
    await connectProvider(provider);
  }

  function resetProviderDraft(provider: string): void {
    if (!(provider in providerCredentialDrafts)) return;
    const next = { ...providerCredentialDrafts };
    delete next[provider];
    providerCredentialDrafts = next;
  }

  function cancelProviderFlow(provider: string): void {
    const controller = providerAbortControllers.get(provider);
    if (controller) {
      controller.abort();
      providerAbortControllers.delete(provider);
    }
    const timer = providerSessionTimers.get(provider);
    if (timer) {
      clearTimeout(timer);
      providerSessionTimers.delete(provider);
    }
    setProviderFlowState(provider, {
      phase: 'cancelled',
      title: 'Cancelled',
      detail: 'Stopped waiting for this connection step. If the helper was already installing, it may still finish in the background.',
      canCancel: false,
      canReset: true,
    });
    integrationBusyKey = null;
    successMessage = '';
    errorMessage = '';
  }

  function resetProviderFlow(provider: string): void {
    cancelProviderFlow(provider);
    clearProviderSession(provider);
    resetProviderDraft(provider);
    setProviderFlowState(provider, null);
    errorMessage = '';
    successMessage = '';
  }

  function shareStatusTone(summary: ManagedShareSummary): StatusTone {
    if (summary.state.status === 'ready') return 'good';
    if (summary.state.status === 'idle' || summary.state.status === 'syncing') return 'muted';
    return 'warn';
  }

  function compactShareStatusDetail(detail: string | undefined): string | null {
    const normalized = detail?.trim().replace(/\s+/gu, ' ');
    if (!normalized) {
      return null;
    }
    if (/sync issues?/i.test(normalized)) {
      return 'Sync problem';
    }
    if (/missing or invalid/i.test(normalized)) {
      return 'Folder missing';
    }
    if (/not running/i.test(normalized)) {
      return 'Sync not running';
    }
    if (/cannot write/i.test(normalized)) {
      return 'Cannot write';
    }
    if (/login|session|auth|connected again/i.test(normalized)) {
      return 'Sign-in needed';
    }
    if (normalized.length <= 28) {
      return normalized;
    }
    return `${normalized.slice(0, 25).trimEnd()}...`;
  }

  function shareStatusLabel(summary: ManagedShareSummary): string {
    if (summary.state.status === 'ready') return 'Connected';
    if (summary.state.status === 'idle') return 'Available';
    if (summary.state.status === 'syncing') return compactShareStatusDetail(summary.state.detail) ?? 'Syncing';
    if (summary.state.status === 'needs-auth') return summary.share.provider === 'mega' ? 'Sign-in retry' : 'Reconnect';
    if (summary.state.status === 'attention') return compactShareStatusDetail(summary.state.detail) ?? 'Needs attention';
    return summary.state.status === 'unsupported' ? 'Unsupported' : 'Available';
  }

  function expectedVolumeBytes(targetVolumeId: string): number {
    let historyBytes = 0;
    let fileBytes = 0;
    for (const source of runtime?.sources ?? []) {
      const entry = source.usage?.volumeUsages.find((item) => item.volumeId === targetVolumeId);
      if (!entry) {
        continue;
      }
      historyBytes = Math.max(historyBytes, entry.historyBytes ?? 0);
      fileBytes = Math.max(fileBytes, entry.fileBytes ?? 0);
    }
    return historyBytes + fileBytes;
  }

  function candidateAttachmentVolumeIds(sourceId: string | null): string[] {
    if (!configDraft || !sourceId) {
      return [];
    }

    const ids = new Set<string>();
    for (const volume of knownVolumes) {
      ids.add(volume.volumeId);
    }
    if (currentVolumePresentation?.volumeId) {
      ids.add(currentVolumePresentation.volumeId);
    }
    for (const volume of configDraft.volumes) {
      if (volume.destinations.some((destination) => destination.sourceId === sourceId)) {
        ids.add(volume.volumeId);
      }
    }
    return Array.from(ids.values());
  }

  function effectiveAttachmentLabels(sourceId: string | null, fallbackVolumeIds: string[] = []): ShareAttachmentChip[] {
    if (!configDraft || !sourceId) {
      return [];
    }

    const candidates = new Set<string>(candidateAttachmentVolumeIds(sourceId));
    for (const volumeId of fallbackVolumeIds) {
      candidates.add(volumeId);
    }

    return Array.from(candidates.values())
      .filter((targetVolumeId) => effectiveDestinations(targetVolumeId).some((destination) => destination.sourceId === sourceId))
      .map((targetVolumeId) => {
        const knownLabel = knownVolumeLabel(targetVolumeId);
        const usage = sourceVolumeUsage(sourceId, targetVolumeId);
        return {
          volumeId: targetVolumeId,
          label: knownLabel ?? `Hub ${targetVolumeId.slice(0, 8)}`,
          known: Boolean(knownLabel),
          usageBytes: usage.usageBytes,
          usagePercent: usage.usagePercent,
        };
      })
      .sort((left, right) => left.label.localeCompare(right.label));
  }

  function sourceVolumeUsage(sourceId: string, targetVolumeId: string): { usageBytes: number; usagePercent: number } {
    const usage = sourceStatus(sourceId)?.usage;
    const entry = usage?.volumeUsages.find((item) => item.volumeId === targetVolumeId);
    const usageBytes = (entry?.historyBytes ?? 0) + (entry?.fileBytes ?? 0);
    const expectedBytes = expectedVolumeBytes(targetVolumeId);
    const usagePercent = expectedBytes > 0 ? Math.min(100, Math.round((usageBytes / expectedBytes) * 100)) : 100;
    return {
      usageBytes,
      usagePercent,
    };
  }

  function sourceAttachmentLabels(sourceId: string): ShareAttachmentChip[] {
    return effectiveAttachmentLabels(sourceId);
  }

  function sourceAttachmentSummary(sourceId: string): string {
    const count = sourceAttachmentLabels(sourceId).length;
    if (count === 0) {
      return 'Available to attach to a hub. No hub is using it yet.';
    }
    return `Used by ${countLabel(count, 'hub')}.`;
  }

  function sourceRepairReport(sourceId: string): StorageLocationRepairReport | null {
    return sourceRepairReports[sourceId] ?? null;
  }

  function sourceRepairSummary(sourceId: string): string | null {
    const report = sourceRepairReport(sourceId);
    if (!report || report.issueCount === 0) {
      return null;
    }
    const malformedFileCount = report.issues.filter(
      (issue) => issue.code === 'invalid-event-file-name' || issue.code === 'invalid-block-file-name'
    ).length;
    if (malformedFileCount > 0) {
      return malformedFileCount === 1
        ? 'Nearbytes found 1 malformed event/block file or provider conflict copy. Reads ignore it, but you should clean up this location.'
        : `Nearbytes found ${malformedFileCount} malformed event/block files or provider conflict copies. Reads ignore them, but you should clean up this location.`;
    }
    return report.issueCount === 1
      ? '1 storage issue found. Review and clean up this location.'
      : `${report.issueCount} storage issues found. Review and clean up this location.`;
  }

  function sourceRepairDetails(sourceId: string): string[] {
    const report = sourceRepairReport(sourceId);
    if (!report || report.issueCount === 0) {
      return [];
    }

    const counts = new Map<string, number>();
    for (const issue of report.issues) {
      counts.set(issue.code, (counts.get(issue.code) ?? 0) + 1);
    }

    const details: string[] = [];
    const malformedEventFiles = counts.get('invalid-event-file-name') ?? 0;
    const malformedBlockFiles = counts.get('invalid-block-file-name') ?? 0;
    const invalidChannelDirectories = counts.get('invalid-channel-directory') ?? 0;
    const corruptedFiles =
      (counts.get('block-hash-mismatch') ?? 0) +
      (counts.get('event-deserialize-failed') ?? 0) +
      (counts.get('event-hash-mismatch') ?? 0) +
      (counts.get('event-signature-invalid') ?? 0);

    if (malformedEventFiles > 0) {
      details.push(`${countLabel(malformedEventFiles, 'malformed event file')}`);
    }
    if (malformedBlockFiles > 0) {
      details.push(`${countLabel(malformedBlockFiles, 'malformed block file')}`);
    }
    if (invalidChannelDirectories > 0) {
      details.push(`${countLabel(invalidChannelDirectories, 'invalid channel folder')}`);
    }
    if (corruptedFiles > 0) {
      details.push(`${countLabel(corruptedFiles, 'corrupted stored file')}`);
    }

    if (details.length > 0) {
      return details;
    }

    return report.issues.slice(0, 3).map((issue) => issue.detail);
  }

  async function loadSourceRepairReports(sourceIds: string[]): Promise<void> {
    const reports = await Promise.all(
      sourceIds.map(async (sourceId) => {
        try {
          const response = await getStorageLocationRepairReport(sourceId);
          return [sourceId, response.report] as const;
        } catch {
          return [sourceId, null] as const;
        }
      })
    );

    sourceRepairReports = {
      ...sourceRepairReports,
      ...Object.fromEntries(reports.filter((entry): entry is readonly [string, StorageLocationRepairReport] => entry[1] !== null)),
    };
  }

  async function runSourceRepair(sourceId: string, action: 'trash' | 'delete'): Promise<void> {
    const report = sourceRepairReport(sourceId);
    const warning = action === 'trash'
      ? 'Trash the invalid Nearbytes files in this storage location? Nearbytes will remove malformed event names, malformed block names, corrupted blocks, and invalidly signed events.'
      : 'Delete the invalid Nearbytes files in this storage location permanently? Nearbytes will remove malformed event names, malformed block names, corrupted blocks, and invalidly signed events.';
    const detail = report && report.issueCount > 0
      ? `\n\nThis will target ${countLabel(report.issueCount, 'detected issue')} in the selected Nearbytes storage location.`
      : '';
    if (!globalThis.confirm(`${warning}${detail}`)) {
      return;
    }
    repairingSourceId = sourceId;
    errorMessage = '';
    successMessage = '';
    try {
      const response = await repairStorageLocation(sourceId, action);
      sourceRepairReports = {
        ...sourceRepairReports,
        [sourceId]: response.report,
      };
      void loadSourceRepairReports([sourceId]);
      successMessage = response.result.removedCount === 0
        ? 'Nothing needed cleanup.'
        : action === 'trash'
          ? `Moved ${countLabel(response.result.removedCount, 'issue')} to the system trash.`
          : `Deleted ${countLabel(response.result.removedCount, 'issue')}.`;
      scheduleRuntimeRefresh();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Failed to repair storage location';
    } finally {
      repairingSourceId = null;
    }
  }

  function activeBackfillTargets(): Array<{ sourceId: string; volumeId: string; usagePercent: number }> {
    if (!configDraft || !runtime) {
      return [];
    }
    const trackedVolumeIds = new Set<string>();
    for (const source of runtime.sources) {
      for (const entry of source.usage.volumeUsages) {
        trackedVolumeIds.add(entry.volumeId);
      }
    }

    const active: Array<{ sourceId: string; volumeId: string; usagePercent: number }> = [];
    for (const volumeId of Array.from(trackedVolumeIds.values()).sort()) {
      for (const destination of effectiveDestinations(volumeId)) {
        if (!keepsFullCopy(destination)) {
          continue;
        }
        const source = configDraft.sources.find((entry) => entry.id === destination.sourceId);
        if (!source || !source.enabled || !source.writable) {
          continue;
        }
        const usage = sourceVolumeUsage(destination.sourceId, volumeId);
        if (usage.usagePercent >= 100) {
          continue;
        }
        active.push({
          sourceId: destination.sourceId,
          volumeId,
          usagePercent: usage.usagePercent,
        });
      }
    }

    return active;
  }

  function clearBackfillPolling(): void {
    if (backfillPollTimer) {
      clearTimeout(backfillPollTimer);
      backfillPollTimer = null;
    }
  }

  function updateBackfillPolling(): void {
    const activeTargets = activeBackfillTargets();
    if (activeTargets.length === 0) {
      backfillPollIdleRounds = 0;
      lastBackfillProgressSignature = '';
      clearBackfillPolling();
      return;
    }

    const signature = activeTargets
      .map((target) => `${target.sourceId}:${target.volumeId}:${target.usagePercent}`)
      .sort()
      .join('|');

    if (signature === lastBackfillProgressSignature) {
      backfillPollIdleRounds += 1;
    } else {
      lastBackfillProgressSignature = signature;
      backfillPollIdleRounds = 0;
    }

    if (backfillPollTimer || runtimeRefreshInFlight) {
      return;
    }

    const delayMs = backfillPollIdleRounds >= 3 ? 4500 : 1500;
    backfillPollTimer = setTimeout(() => {
      backfillPollTimer = null;
      void refreshRuntimeSnapshot();
    }, delayMs);
  }

  function shareAttachmentLabels(summary: ManagedShareSummary): ShareAttachmentChip[] {
    return effectiveAttachmentLabels(
      summary.share.sourceId ?? null,
      summary.attachments.map((attachment) => attachment.volumeId)
    );
  }

  function providerDisconnectImpact(provider: string): {
    shares: number;
    spaces: number;
    inaccessibleSpaces: string[];
  } {
    const shares = providerShares(provider);
    const sourceIds = new Set(shares.map((summary) => summary.share.sourceId).filter((value): value is string => Boolean(value)));
    const attachedVolumeIds = Array.from(
      new Set(shares.flatMap((summary) => summary.attachments.map((attachment) => attachment.volumeId)))
    );
    const inaccessibleSpaces = attachedVolumeIds.filter((attachedVolumeId) => {
      const remainingDestinations = effectiveDestinations(attachedVolumeId).filter(
        (destination) => !sourceIds.has(destination.sourceId)
      );
      return !remainingDestinations.some((destination) => {
        const source = configDraft?.sources.find((entry) => entry.id === destination.sourceId);
        return Boolean(source?.enabled);
      });
    });
    return {
      shares: shares.length,
      spaces: attachedVolumeIds.length,
      inaccessibleSpaces,
    };
  }

  function knownVolumeLabel(targetVolumeId: string): string | null {
    if (currentVolumePresentation && currentVolumePresentation.volumeId === targetVolumeId) {
      return currentVolumePresentation.label.trim() || 'Current selection';
    }
    return knownVolumes.find((entry: { volumeId: string; label: string }) => entry.volumeId === targetVolumeId)?.label ?? null;
  }

  function setProviderDisconnectArmed(provider: string, armed: boolean): void {
    if ((providerDisconnectArmed[provider] ?? false) === armed) {
      return;
    }
    providerDisconnectArmed = {
      ...providerDisconnectArmed,
      [provider]: armed,
    };
  }

  function openProviderConnectionDialog(provider: string): void {
    setProviderDisconnectArmed(provider, false);
    providerConnectionDialog = provider;
  }

  function closeProviderConnectionDialog(): void {
    if (providerConnectionDialog) {
      setProviderDisconnectArmed(providerConnectionDialog, false);
    }
    providerConnectionDialog = null;
  }

  function providerCardStatus(entry: ProviderCatalogEntry): string {
    if (!providerEnabled(entry.provider)) return 'Off';
    if (providersLoading) return 'Loading';
    if (entry.provider === 'local-network') {
      if (localNetworkPeers.some((peer) => peer.status === 'syncing')) return 'Syncing';
      if (localNetworkLoadError) return 'Delayed';
      return localNetworkPeers.length > 0 ? 'Live' : 'Listening';
    }
    if (entry.provider === 'mega' && megaProviderReconnectIssue()) return 'Sign-in needed';
    if (entry.provider === 'mega' && sharesLoading) return 'Syncing';
    const pending = pendingSessionForProvider(entry.provider);
    if (pending?.status === 'pending') return 'Almost ready';
    if (pending?.status === 'failed') return 'Try again';
    if (entry.setup.status === 'needs-config') return 'Setup';
    if (entry.setup.status === 'needs-install') return 'Get ready';
    if (entry.setup.status === 'installing') return 'Installing';
    if (entry.setup.status === 'unsupported') return 'Other option';
    if (entry.isConnected) return 'Connected';
    if (entry.connectionState === 'setup') return 'Setup';
    return 'Available';
  }

  function providerCardDetail(entry: ProviderCatalogEntry): string {
    if (!providerEnabled(entry.provider)) {
      return entry.provider === 'local-network'
        ? 'LAN sync is disabled for this Nearbytes configuration.'
        : `${entry.label} is disabled for this Nearbytes configuration.`;
    }
    if (entry.provider === 'local-network') {
      if (!localNetworkSupported) {
        return 'Local network discovery is not available in this runtime.';
      }
      if (localNetworkLoadError) {
        return localNetworkLoadError;
      }
      if (!localNetworkService?.listening) {
        return 'Nearbytes is preparing local network discovery.';
      }
      if (localNetworkPeers.length === 0) {
        return 'LAN discovery is active. Nearby Nearbytes peers will appear here automatically.';
      }
      return `Found ${countLabel(localNetworkPeers.length, 'peer')} via ${localNetworkService.serviceType} over ${localNetworkService.transport}.`;
    }
    if (entry.provider === 'mega' && shareLoadError) {
      return shareLoadError;
    }
    if (entry.provider === 'mega') {
      const reconnectIssue = megaProviderReconnectIssue();
      if (reconnectIssue) {
        return 'MEGA rejected the saved session. Nearbytes will keep retrying with the saved MEGA sign-in; only update this account if the stored credentials changed.';
      }
    }
    const pending = pendingSessionForProvider(entry.provider);
    if (pending) {
      return pending.detail;
    }
    if (entry.setup.status === 'installing') {
      return 'Nearbytes is preparing the local connection in the background.';
    }
    if (entry.setup.status === 'needs-install' && entry.provider === 'mega') {
      return 'Nearbytes will set up MEGA the first time you create a storage location there.';
    }
    if (entry.provider === 'github') {
      return entry.isConnected
        ? 'Use GitHub as a provider for storage locations in Nearbytes.'
        : entry.setup.status === 'needs-config'
          ? 'Add the GitHub app details once, then connect.'
          : 'Use GitHub as another storage location provider.';
    }
    if (entry.provider === 'gdrive') {
      return entry.isConnected
        ? 'Use Google Drive as a provider for storage locations in Nearbytes.'
        : 'Use Google Drive as another storage location provider.';
    }
    if (entry.provider === 'mega') {
      return entry.isConnected
        ? megaProviderReconnectIssue()
          ? 'Nearbytes can see the MEGA account, but MEGA requires account recovery before incoming-share mirroring can resume.'
          : 'Use MEGA for locations in the connected account.'
        : 'Connect MEGA to use locations from that account.';
    }
    return entry.setup.detail || entry.description;
  }

  function providerShares(provider: string): ManagedShareSummary[] {
    return sortManagedShareSummaries(managedShares.filter((summary) => summary.share.provider === provider));
  }

  function incomingManagedSharesForProvider(provider: string): IncomingManagedShareOffer[] {
    return sortIncomingManagedShareOffers(
      incomingManagedShareOffers.filter(
        (offer) => offer.provider === provider && visibleIncomingManagedShareOffer(offer)
      )
    );
  }

  function incomingProviderInvitesForProvider(provider: string): IncomingProviderContactInvite[] {
    return sortIncomingProviderContactInviteEntries(
      incomingProviderContactInvites.filter((invite) => invite.provider === provider)
    );
  }

  function providerShowsIncomingShareSection(provider: string): boolean {
    return provider === 'mega' || provider === 'gdrive';
  }

  function megaOwnerShares(): ManagedShareSummary[] {
    return providerVisibleShares('mega').filter((summary) => managedShareIsOwned(summary));
  }

  function megaRecipientShares(): ManagedShareSummary[] {
    return providerVisibleShares('mega').filter((summary) => managedShareIsIncoming(summary));
  }

  function megaPendingIncomingCount(): number {
    return incomingManagedSharesForProvider('mega').length + incomingProviderInvitesForProvider('mega').length;
  }

  function megaToastSignature(toast: MegaToast): string {
    return `${toast.tone}|${toast.title}|${toast.detail}|${toast.action?.kind ?? ''}|${toast.action?.label ?? ''}|${toast.action?.target ?? ''}`;
  }

  function dismissMegaToast(toast: MegaToast): void {
    megaToastDismissals = {
      ...megaToastDismissals,
      [toast.key]: megaToastSignature(toast),
    };
  }

  function megaToastList(): MegaToast[] {
    const reconnectIssue = megaProviderReconnectIssue();
    const flow = providerFlowState('mega');
    const issue = reconnectIssue ? null : megaDiagnostics(1, { onlyProblems: true })[0] ?? null;
    const account = connectedAccountForProvider('mega');
    const hasWorkingShares = providerShares('mega').some(
      (summary) => summary.state.status === 'syncing' || summary.state.status === 'idle'
    );
    const status = megaStatusView();
    const toasts: MegaToast[] = [];

    if (flow) {
      toasts.push({
        key: 'mega-flow',
        tone: flow.phase === 'cancelled' ? 'warn' : 'muted',
        title: flow.title,
        detail: flow.detail,
        action: {
          label: flow.phase === 'cancelled' ? 'Open account' : 'Show sign-in',
          kind: 'focus',
          target: 'account',
        },
        persistent: true,
      });
    }

    if (reconnectIssue) {
      toasts.push({
        key: 'mega-reconnect',
        tone: 'warn',
        title: reconnectIssue.diagnostic.title,
        detail: reconnectIssue.diagnostic.summary,
        action: {
          label: 'Open account status',
          kind: 'focus',
          target: 'account',
        },
        persistent: true,
      });
    } else if (issue) {
      toasts.push({
        key: 'mega-diagnostic',
        tone: 'warn',
        title: issue.summary,
        detail: issue.title,
        action: {
          label: 'Review status',
          kind: 'focus',
          target: 'overview',
        },
        persistent: true,
      });
    }

    if (account !== null && (providersLoading || sharesLoading || incomingLoading || hasWorkingShares) && !reconnectIssue) {
      toasts.push({
        key: 'mega-progress',
        tone: 'muted',
        title: status.headline,
        detail: status.progressLabel || status.detail || 'Nearbytes is checking your MEGA account and local copies.',
        action: {
          label: incomingLoading ? 'Open inbox' : 'Open status',
          kind: 'focus',
          target: incomingLoading ? 'incoming' : 'overview',
        },
        persistent: true,
      });
    }

    return toasts.filter((toast) => megaToastDismissals[toast.key] !== megaToastSignature(toast));
  }

  function megaFocusElement(target: MegaTabFocusTarget): HTMLElement | null {
    switch (target) {
      case 'account':
        return megaAccountSection;
      case 'publishing':
        return megaPublishingSection;
      case 'incoming':
        return megaIncomingSection;
      case 'overview':
      default:
        return megaOverviewSection;
    }
  }

  async function focusMegaArea(target: MegaTabFocusTarget): Promise<void> {
    if (mode === 'global' && selectedGlobalProvider !== 'mega') {
      selectedGlobalProvider = 'mega';
      selectedGlobalView = 'provider';
      await tick();
    }
    const element = megaFocusElement(target);
    element?.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' });
  }

  async function runMegaToastAction(action: MegaToastAction): Promise<void> {
    if (action.kind === 'focus') {
      if (action.target) {
        await focusMegaArea(action.target);
      }
      return;
    }
    if (action.kind === 'logs') {
      if (action.target) {
        await focusMegaArea(action.target);
      }
      openMegaRuntimeLogsInspector();
      return;
    }
    if (action.target) {
      await focusMegaArea(action.target);
    }
    await loadPanel({ background: configDraft !== null });
  }

  function providerPriority(provider: string): number {
    if (provider === 'local-network') return 0;
    if (provider === 'mega') return 1;
    if (provider === 'gdrive') return 2;
    if (provider === 'github') return 3;
    return 4;
  }

  function sortProviders(entries: readonly ProviderCatalogEntry[]): ProviderCatalogEntry[] {
    return [...entries].sort((left, right) => {
      const connectedOrder = Number(right.isConnected) - Number(left.isConnected);
      if (connectedOrder !== 0) return connectedOrder;
      const providerOrder = providerPriority(left.provider) - providerPriority(right.provider);
      if (providerOrder !== 0) return providerOrder;
      return left.label.localeCompare(right.label);
    });
  }

  function providerPlaceholder(provider: 'local-network' | 'mega' | 'github'): ProviderCatalogEntry {
    return {
      provider,
      label: provider === 'local-network' ? 'Local network' : provider === 'mega' ? 'MEGA' : 'GitHub',
      description:
        provider === 'local-network'
          ? 'Automatic LAN discovery and peer-to-peer Nearbytes sync with nearby devices.'
          : provider === 'mega'
          ? 'Native MEGA syncing for public links plus incoming read-only and writable shares.'
          : 'Managed repo-backed shares synced through a configurable nearbytes subdirectory.',
      badges: provider === 'github' ? ['Device flow'] : provider === 'local-network' ? ['Auto'] : [],
      enabled: providerEnabled(provider),
      isConnected: provider === 'local-network',
      connectionState: provider === 'local-network' ? 'connected' : 'available',
      setup: {
        status: 'ready',
        detail:
          provider === 'local-network'
            ? 'LAN sync is active and scans for nearby Nearbytes peers automatically.'
            : provider === 'mega'
              ? 'MEGA native sync is ready to use.'
              : 'GitHub is available to connect.',
      },
    };
  }

  function defaultProviderCatalogEntries(): ProviderCatalogEntry[] {
    return sortProviders([
      providerPlaceholder('local-network'),
      providerPlaceholder('mega'),
      providerPlaceholder('github'),
    ]);
  }

  function mergeProviderCatalogEntries(nextEntries: readonly ProviderCatalogEntry[]): ProviderCatalogEntry[] {
    const merged = new Map<string, ProviderCatalogEntry>();
    for (const fallback of defaultProviderCatalogEntries()) {
      merged.set(fallback.provider, fallback);
    }
    for (const existing of providerCatalog) {
      merged.set(existing.provider, existing);
    }
    for (const next of nextEntries) {
      merged.set(next.provider, {
        ...next,
        enabled: providerEnabled(next.provider),
      });
    }
    return sortProviders(Array.from(merged.values()).map((entry) => ({
      ...entry,
      enabled: providerEnabled(entry.provider),
    })));
  }

  function providerEnabled(provider: string): boolean {
    const config = runtimeAppConfig;
    if (!config) {
      return provider !== 'github' && provider !== 'gdrive' && provider !== 'google-drive';
    }
    switch (provider) {
      case 'mega':
        return config.features.providers.mega;
      case 'github':
        return config.features.providers.github;
      case 'gdrive':
      case 'google-drive':
        return config.features.providers.googleDrive;
      case 'local-network':
        return config.features.providers.localNetwork;
      default:
        return true;
    }
  }

  function applyAppConfigResponse(response: { config: AppConfig }): void {
    runtimeAppConfig = response.config;
    providerCatalog = mergeProviderCatalogEntries(providerCatalog);
  }

  function sortManagedShareSummaries(entries: readonly ManagedShareSummary[]): ManagedShareSummary[] {
    return [...entries].sort((left, right) => {
      const attachedOrder = right.attachments.length - left.attachments.length;
      if (attachedOrder !== 0) return attachedOrder;
      const providerOrder = providerPriority(left.share.provider) - providerPriority(right.share.provider);
      if (providerOrder !== 0) return providerOrder;
      return left.share.label.localeCompare(right.share.label);
    });
  }

  function mergeManagedShareSummaries(entries: readonly ManagedShareSummary[]): ManagedShareSummary[] {
    if (entries.length === 0) {
      return managedShares;
    }
    const byId = new Map(entries.map((summary) => [summary.share.id, summary]));
    const merged = managedShares.map((summary) => byId.get(summary.share.id) ?? summary);
    managedShares = sortManagedShareSummaries(merged);
    return managedShares;
  }

  function sortIncomingManagedShareOffers(entries: readonly IncomingManagedShareOffer[]): IncomingManagedShareOffer[] {
    return [...entries].sort((left, right) => {
      const providerOrder = providerPriority(left.provider) - providerPriority(right.provider);
      if (providerOrder !== 0) return providerOrder;
      return left.label.localeCompare(right.label);
    });
  }

  function sortIncomingProviderContactInviteEntries(entries: readonly IncomingProviderContactInvite[]): IncomingProviderContactInvite[] {
    return [...entries].sort((left, right) => {
      const providerOrder = providerPriority(left.provider) - providerPriority(right.provider);
      if (providerOrder !== 0) return providerOrder;
      return left.label.localeCompare(right.label);
    });
  }

  function providerShareCount(provider: string): number {
    return providerShares(provider).length;
  }

  function visibleManagedShare(summary: ManagedShareSummary): boolean {
    return sourceById(summary.share.sourceId) !== null;
  }

  function providerVisibleShares(provider: string): ManagedShareSummary[] {
    return providerShares(provider).filter((summary) => visibleManagedShare(summary));
  }

  function providerOwnedVisibleShares(provider: string): ManagedShareSummary[] {
    return providerVisibleShares(provider).filter((summary) => managedShareIsOwned(summary));
  }

  function providerReceivedVisibleShares(provider: string): ManagedShareSummary[] {
    return providerVisibleShares(provider).filter((summary) => managedShareIsIncoming(summary));
  }

  function providerVisibleShareCount(provider: string): number {
    return providerVisibleShares(provider).length;
  }

  function megaShareStatesNeedRapidRefresh(entries: readonly ManagedShareSummary[]): boolean {
    return entries.some((summary) =>
      summary.share.provider === 'mega' && (summary.state.status === 'syncing' || summary.state.status === 'idle')
    );
  }

  function shouldAuthoritativelyRefreshMegaShare(summary: ManagedShareSummary): boolean {
    return summary.share.provider === 'mega' && (
      summary.state.status === 'syncing' ||
      summary.state.status === 'idle' ||
      summary.state.status === 'attention' ||
      summary.state.status === 'needs-auth'
    );
  }

  function shouldRefreshMegaIncomingDiscovery(): boolean {
    const account = connectedAccountForProvider('mega');
    return account?.state === 'connected' || account?.state === 'attention';
  }

  function scheduleManagedShareStateRefresh(delayMs = AUTHORITATIVE_MANAGED_SHARE_REFRESH_MS): void {
    if (managedShareStateRefreshTimer) {
      clearTimeout(managedShareStateRefreshTimer);
      managedShareStateRefreshTimer = null;
    }
    if (
      providerShares('mega').filter((summary) => shouldAuthoritativelyRefreshMegaShare(summary)).length === 0 &&
      !shouldRefreshMegaIncomingDiscovery()
    ) {
      return;
    }
    managedShareStateRefreshTimer = setTimeout(() => {
      managedShareStateRefreshTimer = null;
      void refreshAuthoritativeManagedShareStates();
    }, delayMs);
  }

  async function refreshAuthoritativeManagedShareStates(): Promise<void> {
    if (managedShareStateRefreshInFlight) {
      return;
    }
    const megaShares = providerShares('mega').filter((summary) => shouldAuthoritativelyRefreshMegaShare(summary));
    const shouldRefreshIncomingDiscovery = shouldRefreshMegaIncomingDiscovery();
    if (megaShares.length === 0 && !shouldRefreshIncomingDiscovery) {
      return;
    }
    managedShareStateRefreshInFlight = true;
    try {
      const [refreshed, incomingSharesResponse, incomingInvitesResponse] = await Promise.all([
        Promise.all(
          megaShares.map(async (summary) => {
            try {
              const response = await getManagedShareState(summary.share.id);
              return response.summary;
            } catch {
              return null;
            }
          })
        ),
        listIncomingManagedShares({ fast: false }).catch(() => null),
        listIncomingProviderContactInvites({ fast: false }).catch(() => null),
      ]);

      if (incomingSharesResponse) {
        incomingManagedShareOffers = sortIncomingManagedShareOffers(incomingSharesResponse.shares);
      }
      if (incomingInvitesResponse) {
        incomingProviderContactInvites = sortIncomingProviderContactInviteEntries(incomingInvitesResponse.invites);
      }

      const merged = mergeManagedShareSummaries(
        refreshed.filter((summary): summary is ManagedShareSummary => summary !== null)
      );
      if (
        merged.some((summary) => shouldAuthoritativelyRefreshMegaShare(summary)) ||
        shouldRefreshMegaIncomingDiscovery()
      ) {
        scheduleManagedShareStateRefresh(
          megaShareStatesNeedRapidRefresh(merged)
            ? AUTHORITATIVE_MANAGED_SHARE_RAPID_REFRESH_MS
            : AUTHORITATIVE_MANAGED_SHARE_REFRESH_MS
        );
      }
    } finally {
      managedShareStateRefreshInFlight = false;
    }
  }

  function providerIncomingShareCount(provider: string): number {
    return incomingManagedSharesForProvider(provider).length;
  }

  function providerTabLoadingState(entry: ProviderCatalogEntry): ProviderTabLoadingState | null {
    if (providersLoading) {
      return {
        label: 'Loading',
        detail: 'Checking account',
      };
    }
    if (entry.provider === 'mega' && sharesLoading) {
      return {
        label: 'Sync check',
        detail: 'Checking mirrors',
      };
    }
    if (entry.provider === 'mega' && incomingLoading) {
      return {
        label: 'Incoming',
        detail: 'Checking shared',
      };
    }
    return null;
  }

  function providerTabCopy(entry: ProviderCatalogEntry): string {
    const loadingState = providerTabLoadingState(entry);
    if (loadingState) {
      return loadingState.detail;
    }
    if (!entry.isConnected) {
      return providerCardStatus(entry);
    }
    if (entry.provider === 'local-network') {
      const peerCopy = countLabel(localNetworkPeers.length, 'peer');
      if (localNetworkPeers.length === 0) {
        return localNetworkService?.listening ? 'Listening for peers' : 'Starting discovery';
      }
      const syncingCount = localNetworkPeers.filter((peer) => peer.status === 'syncing').length;
      return syncingCount > 0 ? `${peerCopy} • ${countLabel(syncingCount, 'sync active')}` : peerCopy;
    }
    if (entry.provider === 'mega') {
      return connectedAccountForProvider('mega')?.email ?? 'No account connected';
    }
    const locationCopy = countLabel(
      providerVisibleShareCount(entry.provider),
      entry.provider === 'mega' ? 'mirror' : 'location'
    );
    const incomingShareCount = providerIncomingShareCount(entry.provider);
    if (incomingShareCount === 0) {
      return locationCopy;
    }
    return `${locationCopy} + ${incomingShareCount} shared`;
  }

  function providerSupportsCreateAction(provider: string): boolean {
    return provider !== 'mega' && provider !== 'local-network';
  }

  function destinationComparisonKey(destination: VolumeDestinationConfig): string {
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

  function destinationsEqual(
    left: readonly VolumeDestinationConfig[],
    right: readonly VolumeDestinationConfig[]
  ): boolean {
    if (left.length !== right.length) {
      return false;
    }
    const leftKeys = [...left].map(destinationComparisonKey).sort((a, b) => a.localeCompare(b));
    const rightKeys = [...right].map(destinationComparisonKey).sort((a, b) => a.localeCompare(b));
    return leftKeys.every((entry, index) => entry === rightKeys[index]);
  }

  function providerAttachedShareCount(provider: string): number {
    if (mode !== 'volume' || !volumeId) {
      return 0;
    }
    return providerShares(provider).filter((summary) =>
      summary.attachments.some((attachment) => attachment.volumeId === volumeId)
    ).length;
  }

  function providerPrimaryMirrorPath(entry: ProviderCatalogEntry): string | null {
    const share = providerShares(entry.provider).find(
      (summary) => (summary.storage?.sourcePath ?? summary.share.localPath).trim() !== ''
    );
    return share ? summarySourcePath(share) : null;
  }

  function providerMirrorPaths(entry: ProviderCatalogEntry): string[] {
    const unique = new Set<string>();
    for (const share of providerShares(entry.provider)) {
      const resolved = summarySourcePath(share).trim();
      if (resolved) {
        unique.add(resolved);
      }
    }
    return Array.from(unique.values());
  }

  function providerMirrorPathEntries(entry: ProviderCatalogEntry): Array<{
    heading: string;
    title: string;
    path: string;
  }> {
    const unique = new Map<string, { heading: string; title: string; path: string }>();
    for (const share of providerShares(entry.provider)) {
      const resolved = summarySourcePath(share).trim();
      if (!resolved || unique.has(resolved)) {
        continue;
      }
      unique.set(resolved, {
        heading: managedShareIsIncoming(share) ? 'Mirror folder for shared location' : 'Local mirror folder',
        title: managedShareTitle(share),
        path: resolved,
      });
    }
    return Array.from(unique.values());
  }

  function providerTransparencyFacts(entry: ProviderCatalogEntry): string[] {
    const shareCount = providerVisibleShareCount(entry.provider);
    const attachedCount = providerAttachedShareCount(entry.provider);
    const providerSharesForEntry = providerShares(entry.provider);
    const recipientCount = providerSharesForEntry.filter((summary) => managedShareIsIncoming(summary)).length;
    const ownerCount = providerSharesForEntry.filter((summary) => managedShareIsOwned(summary)).length;
    const facts = [
      countLabel(
        shareCount,
        entry.provider === 'mega' ? 'mirrored location' : 'live location'
      ),
    ];
    const incomingInviteCount = incomingProviderInvitesForProvider(entry.provider).length;
    const incomingShareCount = incomingManagedSharesForProvider(entry.provider).length;
    if (incomingInviteCount > 0) {
      facts.push(countLabel(incomingInviteCount, 'incoming contact invite'));
    }
    if (incomingShareCount > 0) {
      facts.push(countLabel(incomingShareCount, 'incoming storage location'));
    }
    if (mode === 'volume' && volumeId) {
      facts.push(countLabel(attachedCount, 'attached location'));
    }
    if (entry.provider === 'mega') {
      if (recipientCount > 0) {
        facts.push(countLabel(recipientCount, 'incoming mirror'));
      }
      if (ownerCount > 0) {
        facts.push(countLabel(ownerCount, 'owner mirror'));
      }
      facts.push('Connected account identifies remote shares; mirror folders belong to those shared locations');
    }
    return facts.filter((value, index, values) => value && values.indexOf(value) === index);
  }

  function summarizeMegaStateDetail(detail: string): string {
    const normalized = detail.trim();
    if (!normalized) {
      return 'MEGA is still checking this location.';
    }
    return firstMegaDetailLine(normalized);
  }

  function firstMegaDetailLine(detail: string): string {
    const line = detail
      .split(/\r?\n/u)
      .map((entry) => entry.trim())
      .find((entry) => entry !== '');
    return line ?? '';
  }

  function isNoisyMegaLog(detail: string): boolean {
    const normalized = detail.trim();
    if (!normalized) {
      return false;
    }
    if (normalized.includes('\n') || normalized.includes('\r')) {
      return true;
    }
    return /(transfer|\|#{4,}|mb:\s*\d|kb:\s*\d|state change\)|\[[^\]]*%\])/i.test(normalized);
  }

  function conciseMegaDetail(detail: string): string {
    const line = firstMegaDetailLine(detail);
    if (!line || isNoisyMegaLog(detail)) {
      return '';
    }
    return line.length > 140 ? `${line.slice(0, 137).trimEnd()}...` : line;
  }

  function openMegaRuntimeLogsInspector(): void {
    megaRuntimeLogsVisible = true;
    void loadMegaRuntimeLogs();
  }

  function isPreparingManagedShare(summary: ManagedShareSummary): boolean {
    return summary.state.badges.some((badge) => badge.trim() === 'Preparing') || /prepar/i.test(summary.state.detail);
  }

  function isMegaNativeOnlyRuntime(): boolean {
    const entry = providerCatalog.find((e) => e.provider === 'mega');
    if (!entry) {
      return true;
    }
    const helperPath = entry.setup.config?.helperPath?.trim() || '';
    return helperPath === '' || helperPath === 'PATH';
  }

  function megaShareActivityStep(summary: ManagedShareSummary): MegaLocationActivityStep {
    const name = managedShareCardTitle(summary);
    const status = summary.state.status;
    const rawDetail = summary.state.diagnostic?.summary?.trim() || summary.state.detail.trim();
    const detail = rawDetail ? summarizeMegaStateDetail(rawDetail) : '';
    const shortDetail = detail.length > 140 ? `${detail.slice(0, 137).trimEnd()}…` : detail;

    if (status === 'ready') {
      return {
        shareId: summary.share.id,
        name,
        phase: shortDetail || 'Up to date with MEGA',
        tone: 'good',
      };
    }
    if (status === 'syncing') {
      const preparing = isPreparingManagedShare(summary);
      return {
        shareId: summary.share.id,
        name,
        phase: preparing ? 'Preparing local mirror…' : shortDetail || 'Syncing with MEGA…',
        tone: 'muted',
      };
    }
    if (status === 'idle') {
      return {
        shareId: summary.share.id,
        name,
        phase: shortDetail || 'Checking connection and mirror health…',
        tone: 'muted',
      };
    }
    if (status === 'needs-auth') {
      return {
        shareId: summary.share.id,
        name,
        phase: shortDetail || 'MEGA needs you to sign in again.',
        tone: 'warn',
      };
    }
    if (status === 'attention') {
      return {
        shareId: summary.share.id,
        name,
        phase: shortDetail || 'This location needs attention.',
        tone: 'warn',
      };
    }
    if (status === 'unsupported') {
      return {
        shareId: summary.share.id,
        name,
        phase: shortDetail || 'Not supported in this build.',
        tone: 'warn',
      };
    }
    return {
      shareId: summary.share.id,
      name,
      phase: shortDetail || String(status),
      tone: 'muted',
    };
  }

  function megaOverallProgressLabel(shares: ManagedShareSummary[]): string {
    const total = shares.length;
    if (total === 0) {
      return '';
    }
    const ready = shares.filter((s) => s.state.status === 'ready').length;
    const working = shares.filter((s) => s.state.status === 'syncing' || s.state.status === 'idle').length;
    const blocked = shares.filter((s) => s.state.status === 'attention' || s.state.status === 'needs-auth').length;
    if (blocked > 0) {
      return `${countLabel(blocked, 'location')} need attention`;
    }
    if (ready === total) {
      return `All ${countLabel(total, 'location')} ready`;
    }
    if (working > 0 && ready < total) {
      const activeStep = shares
        .map((summary) => megaShareActivityStep(summary))
        .find((step) => step.tone !== 'good');
      return activeStep ? `${activeStep.name}: ${activeStep.phase}` : `${countLabel(working, 'location')} syncing`;
    }
    return `${countLabel(ready, 'location')} ready`;
  }

  function megaRuntimeReconnectLine(detail: string): string | null {
    const lines = detail
      .split(/\r?\n/u)
      .map((entry) => entry.trim())
      .filter((entry) => entry !== '');
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index];
      if (/MEGA API error -15/i.test(line)) {
        return line;
      }
      if (
        /incoming managed share discovery failed/i.test(line) &&
        /(session|auth|login|reconnect|expired|invalid)/i.test(line)
      ) {
        return line;
      }
    }
    return null;
  }

  function megaProviderReconnectIssue(): { diagnostic: MegaDiagnosticView; updatedAt: number } | null {
    const account = connectedAccountForProvider('mega');
    if (account?.state === 'attention') {
      return {
        diagnostic: {
          id: 'mega-provider-reconnect',
          title: 'MEGA account needs attention',
          summary: 'Incoming MEGA shares are paused while Nearbytes retries the saved sign-in.',
          detail: account.detail?.trim() || 'If MEGA asked you to unlock the account or change the password on mega.io, finish that there. Nearbytes will retry the saved sign-in automatically; update this account only if the stored credentials changed.',
          facts: [
            account.email?.trim() ? { label: 'Account', value: account.email.trim() } : null,
            { label: 'Last change', value: formatMegaRuntimeLogTimestamp(account.updatedAt) },
          ].filter((value): value is { label: string; value: string } => value !== null),
        },
        updatedAt: account.updatedAt,
      };
    }

    if (!account || account.state !== 'connected') {
      return null;
    }

    // Native MEGA uses in-process API + per-location status; stale dev log files must not
    // trigger a false "reconnect" banner (previously tied to MEGA.cmd verification output).
    if (isMegaNativeOnlyRuntime()) {
      return null;
    }

    let bestMatch:
      | {
          entry: DesktopRuntimeLogEntry;
          line: string;
          updatedAt: number;
        }
      | null = null;

    for (const entry of megaRuntimeLogs) {
      if (!entry.exists) {
        continue;
      }
      const line = megaRuntimeReconnectLine(normalizeMegaLogContent(entry.content, entry.id));
      if (!line) {
        continue;
      }
      const updatedAt = entry.updatedAt ?? 0;
      if (!bestMatch || updatedAt >= bestMatch.updatedAt) {
        bestMatch = {
          entry,
          line,
          updatedAt,
        };
      }
    }

    if (!bestMatch) {
      return null;
    }

    const facts = [
      account.email?.trim() ? { label: 'Account', value: account.email.trim() } : null,
      { label: 'Runtime log', value: bestMatch.entry.label },
      bestMatch.updatedAt > 0 ? { label: 'Observed', value: formatMegaRuntimeLogTimestamp(bestMatch.updatedAt) } : null,
    ].filter((value): value is { label: string; value: string } => value !== null);

    return {
      diagnostic: {
        id: 'mega-provider-reconnect',
        title: 'MEGA account needs attention',
        summary: 'Incoming MEGA shares are paused while Nearbytes retries the saved sign-in.',
        detail: bestMatch.line,
        facts,
      },
      updatedAt: bestMatch.updatedAt,
    };
  }

  function toggleMegaIssueLog(issueId: string): void {
    megaIssueLogExpanded = {
      ...megaIssueLogExpanded,
      [issueId]: !(megaIssueLogExpanded[issueId] ?? false),
    };
  }

  function selectMegaRuntimeLog(entryId: string): void {
    megaRuntimeLogSelection = entryId;
  }

  function normalizeMegaLogContent(raw: string, entryId: string): string {
    if (raw.trim() === '') {
      return '';
    }
    if (entryId.includes('verify-runtime')) {
      try {
        return JSON.stringify(JSON.parse(raw), null, 2);
      } catch {
        return raw;
      }
    }
    return raw;
  }

  function escapeLogHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function stripUnsupportedControlChars(value: string): string {
    return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, '');
  }

  function ansiCodeToClass(code: number): string | null {
    if (code === 1) return 'ansi-bold';
    if (code === 2) return 'ansi-dim';
    if (code >= 30 && code <= 37) return `ansi-fg-${code - 30}`;
    if (code >= 40 && code <= 47) return `ansi-bg-${code - 40}`;
    if (code >= 90 && code <= 97) return `ansi-fg-bright-${code - 90}`;
    if (code >= 100 && code <= 107) return `ansi-bg-bright-${code - 100}`;
    return null;
  }

  function ansiStateClass(state: {
    bold: boolean;
    dim: boolean;
    fg: number | null;
    fgBright: boolean;
    bg: number | null;
    bgBright: boolean;
  }): string {
    const classes: string[] = [];
    if (state.bold) classes.push('ansi-bold');
    if (state.dim) classes.push('ansi-dim');
    if (state.fg !== null) {
      classes.push(state.fgBright ? `ansi-fg-bright-${state.fg}` : `ansi-fg-${state.fg}`);
    }
    if (state.bg !== null) {
      classes.push(state.bgBright ? `ansi-bg-bright-${state.bg}` : `ansi-bg-${state.bg}`);
    }
    return classes.join(' ');
  }

  function renderAnsiLogHtml(value: string): string {
    const input = stripUnsupportedControlChars(value);
    const pattern = /\u001b\[([0-9;]*)m/gu;
    const state = {
      bold: false,
      dim: false,
      fg: null as number | null,
      fgBright: false,
      bg: null as number | null,
      bgBright: false,
    };

    let result = '';
    let cursor = 0;
    let match: RegExpExecArray | null;

    const appendChunk = (chunk: string) => {
      if (chunk === '') return;
      const escaped = escapeLogHtml(chunk);
      const classes = ansiStateClass(state);
      result += classes ? `<span class="${classes}">${escaped}</span>` : escaped;
    };

    while ((match = pattern.exec(input)) !== null) {
      appendChunk(input.slice(cursor, match.index));
      cursor = match.index + match[0].length;

      const rawCodes = match[1]?.trim() ?? '';
      const codes = rawCodes === '' ? [0] : rawCodes.split(';').map((entry) => Number.parseInt(entry, 10));
      for (const code of codes) {
        if (!Number.isFinite(code)) {
          continue;
        }
        if (code === 0) {
          state.bold = false;
          state.dim = false;
          state.fg = null;
          state.fgBright = false;
          state.bg = null;
          state.bgBright = false;
          continue;
        }
        if (code === 22) {
          state.bold = false;
          state.dim = false;
          continue;
        }
        if (code === 39) {
          state.fg = null;
          state.fgBright = false;
          continue;
        }
        if (code === 49) {
          state.bg = null;
          state.bgBright = false;
          continue;
        }
        if (code === 1) {
          state.bold = true;
          continue;
        }
        if (code === 2) {
          state.dim = true;
          continue;
        }
        const className = ansiCodeToClass(code);
        if (!className) {
          continue;
        }
        if (code >= 30 && code <= 37) {
          state.fg = code - 30;
          state.fgBright = false;
          continue;
        }
        if (code >= 40 && code <= 47) {
          state.bg = code - 40;
          state.bgBright = false;
          continue;
        }
        if (code >= 90 && code <= 97) {
          state.fg = code - 90;
          state.fgBright = true;
          continue;
        }
        if (code >= 100 && code <= 107) {
          state.bg = code - 100;
          state.bgBright = true;
        }
      }
    }

    appendChunk(input.slice(cursor));
    return result;
  }

  function visibleMegaRuntimeLogs(): DesktopRuntimeLogEntry[] {
    const filter = megaRuntimeLogFilter.trim().toLowerCase();
    if (filter === '') {
      return megaRuntimeLogs;
    }
    return megaRuntimeLogs.filter((entry) => {
      const haystack = `${entry.label}\n${entry.path}\n${normalizeMegaLogContent(entry.content, entry.id)}`.toLowerCase();
      return haystack.includes(filter);
    });
  }

  function activeMegaRuntimeLog(): DesktopRuntimeLogEntry | null {
    const visible = visibleMegaRuntimeLogs();
    if (visible.length === 0) {
      return null;
    }
    const exact = megaRuntimeLogSelection
      ? visible.find((entry) => entry.id === megaRuntimeLogSelection) ?? null
      : null;
    return exact ?? visible[0] ?? null;
  }

  function megaRuntimeLogContent(entry: DesktopRuntimeLogEntry | null): string {
    if (!entry) {
      return '';
    }
    return normalizeMegaLogContent(entry.content, entry.id);
  }

  function megaRuntimeLogHtml(entry: DesktopRuntimeLogEntry | null): string {
    return renderAnsiLogHtml(megaRuntimeLogContent(entry));
  }

  function megaRuntimeLogLineCount(entry: DesktopRuntimeLogEntry | null): number {
    const content = megaRuntimeLogContent(entry).trim();
    if (content === '') {
      return 0;
    }
    return content.split(/\r?\n/u).length;
  }

  function formatMegaRuntimeLogTimestamp(value: number | null): string {
    if (!value || !Number.isFinite(value)) {
      return 'Not written yet';
    }
    return new Date(value).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  function formatAbsoluteTimestamp(value: number | null): string {
    if (!value || !Number.isFinite(value)) {
      return 'Waiting';
    }
    return new Date(value).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  async function loadMegaRuntimeLogs(): Promise<void> {
    megaRuntimeLogsLoading = true;
    megaRuntimeLogsError = '';
    try {
      const response = await readDesktopRuntimeLogs();
      if (!response) {
        megaRuntimeLogs = [];
        megaRuntimeLogsUpdatedAt = null;
        megaRuntimeLogSelection = null;
        return;
      }
      megaRuntimeLogs = response.entries;
      megaRuntimeLogsUpdatedAt = response.generatedAt;
      if (
        !megaRuntimeLogSelection ||
        !response.entries.some((entry) => entry.id === megaRuntimeLogSelection)
      ) {
        megaRuntimeLogSelection = response.entries[0]?.id ?? null;
      }
    } catch (error) {
      megaRuntimeLogsError = error instanceof Error ? error.message : 'Failed to load runtime logs';
    } finally {
      megaRuntimeLogsLoading = false;
    }
  }

  async function copyMegaRuntimeLog(entry: DesktopRuntimeLogEntry | null): Promise<void> {
    if (!entry) {
      megaRuntimeLogCopyFeedback = 'Nothing to copy';
      return;
    }
    const content = megaRuntimeLogContent(entry);
    if (content.trim() === '') {
      megaRuntimeLogCopyFeedback = 'Log is empty';
      return;
    }
    try {
      await navigator.clipboard.writeText(content);
      megaRuntimeLogCopyFeedback = 'Copied';
    } catch (error) {
      megaRuntimeLogCopyFeedback = error instanceof Error ? error.message : 'Copy failed';
    }
  }

  async function withPanelRequestTimeout<T>(
    label: string,
    run: (signal: AbortSignal) => Promise<T>,
    timeoutMs = PANEL_REQUEST_TIMEOUT_MS
  ): Promise<T> {
    const controller = new AbortController();
    const timer =
      timeoutMs !== null && timeoutMs > 0
        ? setTimeout(() => {
            controller.abort();
          }, timeoutMs)
        : null;
    try {
      return await run(controller.signal);
    } catch (error) {
      if (isAbortError(error)) {
        const timeoutLabel = timeoutMs !== null && timeoutMs > 0 ? `${Math.ceil(timeoutMs / 1000)}s` : 'the request window';
        throw new Error(`${label} timed out after ${timeoutLabel}.`);
      }
      throw error;
    } finally {
      if (timer !== null) {
        clearTimeout(timer);
      }
    }
  }

  function megaDiagnostics(limit = 3, options?: { onlyProblems?: boolean }): MegaDiagnosticView[] {
    const onlyProblems = options?.onlyProblems === true;
    const ranked: Array<{
      id: string;
      severity: number;
      title: string;
      code: string | undefined;
      summaryText: string;
      detail: string;
      facts: Array<{ label: string; value: string }>;
      updatedAt: number;
    }> = [];

    const providerReconnectIssue = megaProviderReconnectIssue();
    if (providerReconnectIssue) {
      ranked.push({
        id: providerReconnectIssue.diagnostic.id,
        severity: 4,
        title: providerReconnectIssue.diagnostic.title,
        code: undefined,
        summaryText: providerReconnectIssue.diagnostic.summary,
        detail: providerReconnectIssue.diagnostic.detail,
        facts: providerReconnectIssue.diagnostic.facts,
        updatedAt: providerReconnectIssue.updatedAt,
      });
    }

    for (const summary of providerShares('mega')) {
      if (onlyProblems && summary.state.status !== 'attention' && summary.state.status !== 'needs-auth') {
        continue;
      }
      const diagnostic = summary.state.diagnostic;
      const detail = diagnostic?.detail?.trim() || summary.state.detail.trim();
      if (!detail) {
        continue;
      }
      const severity = summary.state.status === 'needs-auth' || summary.state.status === 'attention'
        ? 3
        : summary.state.status === 'syncing'
          ? 2
          : 1;
      ranked.push({
        id: summary.share.id,
        severity,
        title: diagnostic?.title || managedShareTitle(summary),
        code: diagnostic?.code,
        summaryText: diagnostic?.summary || summarizeMegaStateDetail(detail),
        detail,
        facts: diagnostic?.facts ?? [],
        updatedAt: summary.state.lastSyncAt ?? 0,
      });
    }

    const topRanked = ranked
      .sort((left, right) => {
        if (right.severity !== left.severity) {
          return right.severity - left.severity;
        }
        return right.updatedAt - left.updatedAt;
      })
      .slice(0, Math.max(1, limit));

    return topRanked.map((entry) => ({
      id: entry.id,
      title: entry.code ? `${entry.title} (${entry.code})` : entry.title,
      summary: entry.summaryText,
      detail: entry.detail,
      facts: entry.facts,
    }));
  }

  function megaStatusView(): MegaStatusView {
    const shares = providerShares('mega');
    const locationSteps = shares.map((s) => megaShareActivityStep(s));
    const total = shares.length;
    const ready = shares.filter((summary) => summary.state.status === 'ready').length;
    const syncing = shares.filter((summary) => summary.state.status === 'syncing').length;
    const preparing = shares.filter((summary) => summary.state.status === 'syncing' && isPreparingManagedShare(summary)).length;
    const checking = shares.filter((summary) => summary.state.status === 'idle').length;
    const blocked = shares.filter((s) => s.state.status === 'attention' || s.state.status === 'needs-auth').length;
    const working = syncing > 0 || checking > 0;
    const issue = megaDiagnostics(1, { onlyProblems: true })[0] ?? null;
    const reconnectIssue = megaProviderReconnectIssue();
    const loading = providersLoading || sharesLoading || incomingLoading;
    const hasUsableMegaShare = shares.some((summary) => summary.state.status === 'ready');
    const hasBlockingError = shareLoadError || (!hasUsableMegaShare ? incomingLoadError : '');
    const inProgress = syncing > 0 || (loading && total === 0);
    const progressSummary = megaOverallProgressLabel(shares);

    let progressPercent: number | null = null;
    if (total > 0 && ready < total && blocked === 0) {
      if (ready === 0 && working) {
        progressPercent = null;
      } else {
        progressPercent = Math.max(10, Math.min(94, Math.round((ready / total) * 100)));
      }
    }

    const showProgressBar = total > 0 && ready < total && !reconnectIssue;

    const base = {
      locationSteps,
      showProgressBar,
    };

    if (reconnectIssue) {
      return {
        ...base,
        headline: 'Finish any MEGA account recovery on mega.io',
        detail: conciseMegaDetail(reconnectIssue.diagnostic.detail),
        tone: 'warn' as const,
        syncing: false,
        progressPercent: null,
        progressLabel: 'Automatic sign-in retry',
        showProgressBar: false,
        selfRepairCopy:
          'Nearbytes retried the saved MEGA session. If MEGA locked the account, unlock it and complete the password change on mega.io. Nearbytes will keep retrying automatically; update this account only if the stored credentials changed.',
      };
    }

    if (issue) {
      const detail = conciseMegaDetail(issue.detail);
      return {
        ...base,
        headline: issue.summary,
        detail: detail || (locationSteps[0]?.phase ?? ''),
        tone: 'warn' as const,
        syncing: inProgress,
        progressPercent,
        progressLabel: progressSummary || (total > 0 ? 'Working on locations…' : 'Recovering MEGA status'),
        showProgressBar,
        selfRepairCopy:
          'Details for each folder appear below. Nearbytes retries transient MEGA API issues; use Refresh if something stays stuck.',
      };
    }

    if (hasBlockingError) {
      return {
        ...base,
        headline: hasBlockingError,
        detail: total > 0 ? 'Location status below reflects the last check once the panel finishes loading.' : '',
        tone: 'warn' as const,
        syncing: false,
        progressPercent: null,
        progressLabel: total > 0 ? progressSummary : 'Status unavailable',
        showProgressBar: total > 0 && ready < total,
        selfRepairCopy: 'Nearbytes keeps retrying in the background. Use Refresh if status does not recover quickly.',
      };
    }

    if (checking > 0 && !inProgress && ready < total) {
      return {
        ...base,
        headline: 'Checking MEGA locations',
        detail:
          total > 0
            ? `Nearbytes is verifying ${countLabel(total, 'location')}. Status for each location is listed below.`
            : 'Nearbytes is verifying the connected MEGA account in the background.',
        tone: 'muted' as const,
        syncing: false,
        progressPercent,
        progressLabel: progressSummary,
        showProgressBar,
        selfRepairCopy:
          '“Idle” on a location usually means the app is still validating the mirror or waiting on MEGA; it should move to ready on its own.',
      };
    }

    if (inProgress) {
      return {
        ...base,
        headline: preparing > 0 ? 'Preparing MEGA locations' : 'Syncing with MEGA',
        detail: loading
          ? 'Loading the connected account and visible locations. Each location shows its own step below.'
          : preparing > 0
            ? 'Nearbytes is creating or validating the local mirror. Watch the location row below for the exact step.'
            : 'Pulling updates from MEGA. Per-location status is below.',
        tone: 'muted' as const,
        syncing: true,
        progressPercent,
        progressLabel: progressSummary || (preparing > 0 ? 'Preparing local mirror' : 'Refreshing locations'),
        showProgressBar,
        selfRepairCopy:
          'If a folder stays in “Preparing” or “Checking…”, wait for a full sync cycle or tap Refresh MEGA status.',
      };
    }

    if (total > 0) {
      return {
        ...base,
        headline: `${countLabel(total, 'location')} ready`,
        detail: 'All visible MEGA locations are healthy.',
        tone: 'good' as const,
        syncing: false,
        progressPercent: null,
        progressLabel: '',
        showProgressBar: false,
        selfRepairCopy: 'Automatic MEGA recovery runs if a mirror reports a problem.',
      };
    }

    return {
      ...base,
      headline: 'No MEGA locations yet',
      detail: 'Create or accept a MEGA location to start syncing.',
      tone: 'muted' as const,
      syncing: false,
      progressPercent: null,
      progressLabel: '',
      showProgressBar: false,
      selfRepairCopy: 'Automatic recovery runs as soon as a MEGA location exists.',
    };
  }

  function localMachineShareCount(): number {
    return localShares().length;
  }

  function shouldShowProviderDocs(entry: ProviderCatalogEntry): boolean {
    if (entry.provider === 'local-network') {
      return false;
    }
    if (entry.provider === 'gdrive') {
      return entry.setup.status === 'needs-config' || entry.setup.status === 'unsupported';
    }
    return Boolean(entry.setup.docsUrl) &&
      (entry.setup.status === 'needs-config' ||
        entry.setup.status === 'needs-install' ||
        entry.setup.status === 'unsupported');
  }

  function managedShareOpenLabel(summary: ManagedShareSummary): string {
    if (summary.share.provider === 'github') {
      const repoFullName = typeof summary.share.remoteDescriptor.repoFullName === 'string' ? summary.share.remoteDescriptor.repoFullName : null;
      const basePath = typeof summary.share.remoteDescriptor.basePath === 'string' ? summary.share.remoteDescriptor.basePath : null;
      return repoFullName && basePath ? `${repoFullName} → ${basePath}` : 'GitHub repository share';
    }
    return summary.share.sourceId ? 'Local mirror folder managed by Nearbytes' : 'Mirror folder needs attention';
  }

  function localShares(): SourceConfigEntry[] {
    return (configDraft?.sources ?? []).filter((source) => isLocalMachineShare(source));
  }

  function managedShareAccessLabel(summary: ManagedShareSummary): string {
    return getManagedShareAccessLabel(summary);
  }

  function summarySourcePath(summary: ManagedShareSummary): string {
    return summary.storage?.sourcePath?.trim() || summary.share.localPath;
  }

  function normalizeIdentity(value: string | null | undefined): string {
    return value?.trim().toLowerCase() ?? '';
  }

  function managedShareAccountEmail(summary: ManagedShareSummary): string | null {
    const account = providerAccounts.find((entry) => entry.id === summary.share.accountId);
    const email = typeof account?.email === 'string' ? account.email.trim() : '';
    return email || null;
  }

  function managedShareOwnerEmail(summary: ManagedShareSummary): string | null {
    const ownerEmail = typeof summary.share.remoteDescriptor.ownerEmail === 'string'
      ? summary.share.remoteDescriptor.ownerEmail.trim()
      : '';
    return ownerEmail || null;
  }

  function managedShareRemoteName(summary: ManagedShareSummary): string | null {
    const shareName = typeof summary.share.remoteDescriptor.shareName === 'string'
      ? summary.share.remoteDescriptor.shareName.trim()
      : '';
    return shareName || null;
  }

  function managedShareIsOwned(summary: ManagedShareSummary): boolean {
    if (summary.share.provider !== 'mega') {
      return summary.share.role !== 'recipient';
    }
    if (summary.share.role === 'owner') {
      return true;
    }
    const accountIdentity = normalizeIdentity(managedShareAccountEmail(summary));
    const ownerIdentity = normalizeIdentity(managedShareOwnerEmail(summary));
    return Boolean(accountIdentity && ownerIdentity && accountIdentity === ownerIdentity);
  }

  function managedShareIsIncoming(summary: ManagedShareSummary): boolean {
    return !managedShareIsOwned(summary);
  }

  function incomingManagedShareOwnerEmail(offer: IncomingManagedShareOffer): string | null {
    const ownerEmail = typeof offer.remoteDescriptor.ownerEmail === 'string'
      ? offer.remoteDescriptor.ownerEmail.trim()
      : '';
    return ownerEmail || null;
  }

  function incomingManagedShareName(offer: IncomingManagedShareOffer): string | null {
    const shareName = typeof offer.remoteDescriptor.shareName === 'string'
      ? offer.remoteDescriptor.shareName.trim()
      : offer.label.trim();
    return shareName || null;
  }

  function incomingManagedShareBelongsToConnectedAccount(offer: IncomingManagedShareOffer): boolean {
    if (offer.provider !== 'mega') {
      return false;
    }
    const account = providerAccounts.find((entry) => entry.id === offer.accountId);
    const accountIdentity = normalizeIdentity(account?.email);
    const ownerIdentity = normalizeIdentity(incomingManagedShareOwnerEmail(offer));
    return Boolean(accountIdentity && ownerIdentity && accountIdentity === ownerIdentity);
  }

  function incomingManagedShareMatchesExistingShare(offer: IncomingManagedShareOffer): boolean {
    const offerName = normalizeIdentity(incomingManagedShareName(offer));
    const offerOwner = normalizeIdentity(incomingManagedShareOwnerEmail(offer));
    return providerShares(offer.provider).some((summary) => {
      if (summary.share.accountId !== offer.accountId) {
        return false;
      }
      const summaryName = normalizeIdentity(managedShareRemoteName(summary) ?? summary.share.label);
      if (offerName && summaryName && offerName !== summaryName) {
        return false;
      }
      if (offer.provider === 'mega' && offerOwner) {
        const summaryOwner = normalizeIdentity(managedShareOwnerEmail(summary) ?? managedShareAccountEmail(summary));
        if (summaryOwner && offerOwner !== summaryOwner) {
          return false;
        }
      }
      return true;
    });
  }

  function visibleIncomingManagedShareOffer(offer: IncomingManagedShareOffer): boolean {
    if (isIncomingManagedShareOfferDismissed(offer)) {
      return false;
    }
    if (incomingManagedShareBelongsToConnectedAccount(offer)) {
      return false;
    }
    if (incomingManagedShareMatchesExistingShare(offer)) {
      return false;
    }
    return true;
  }

  function managedShareTitle(summary: ManagedShareSummary): string {
    if (summary.share.provider === 'mega') {
      const remoteName = managedShareRemoteName(summary) ?? summary.share.label;
      if (managedShareIsIncoming(summary)) {
        const ownerEmail = managedShareOwnerEmail(summary);
        if (ownerEmail && remoteName) {
          return `${ownerEmail}/${remoteName}`;
        }
      } else {
        const accountEmail = managedShareAccountEmail(summary);
        if (accountEmail && remoteName) {
          return `${accountEmail}/${remoteName}`;
        }
      }
    }
    return summary.share.label;
  }

  function managedShareCardTitle(summary: ManagedShareSummary): string {
    if (summary.share.provider === 'mega') {
      return managedShareRemoteName(summary) ?? summary.share.label;
    }
    return managedShareTitle(summary);
  }

  function managedShareOwnershipLabel(summary: ManagedShareSummary): string | null {
    if (summary.share.provider !== 'mega') {
      return null;
    }
    if (managedShareIsOwned(summary)) {
      const accountEmail = managedShareAccountEmail(summary);
      return accountEmail || 'Your MEGA location';
    }
    const ownerEmail = managedShareOwnerEmail(summary);
    return ownerEmail ? `Owner: ${ownerEmail}` : 'Owner: another MEGA account';
  }

  function sourceDisplayTitle(source: SourceConfigEntry): string {
    const linkedSummary = managedShares.find((summary) => summary.share.sourceId === source.id)
      ?? (source.integration?.managedShareId
        ? managedShares.find((summary) => summary.share.id === source.integration?.managedShareId)
        : undefined);
    if (linkedSummary) {
      return managedShareCardTitle(linkedSummary);
    }
    return sourceLocationTitle(source.path);
  }

  function managedShareRoleLabel(summary: ManagedShareSummary): string {
    if (managedShareIsOwned(summary)) {
      return 'You own this live location';
    }
    const ownerEmail = managedShareOwnerEmail(summary);
    return ownerEmail ? `Received from ${ownerEmail}` : 'Received from someone else';
  }

  function managedShareNarrative(summary: ManagedShareSummary): string {
    if (summary.state.status === 'ready') {
      if (summary.share.provider === 'mega' && managedShareIsOwned(summary)) {
        return 'This is your writable Nearbytes publication root for this MEGA account. Nearbytes publishes your updates here, keeps it synced with MEGA, and retries automatically after transient provider errors.';
      }
      if (summary.share.provider === 'mega' && managedShareIsIncoming(summary)) {
        const ownerEmail = managedShareOwnerEmail(summary);
        return ownerEmail
          ? `This is an automatic local copy of the MEGA location shared with you by ${ownerEmail}. Nearbytes reads from it here, but it never publishes your changes back into ${ownerEmail}'s folder directly.`
          : 'This is an automatic local copy of a MEGA location shared with you. Nearbytes reads from it here, but it never publishes your changes back into the other account directly.';
      }
      return 'This live location is ready. Nearbytes keeps the local copy aligned with the provider and uses your configured writable destinations for publication.';
    }
    if (summary.state.status === 'attention') {
      return summary.state.detail || 'This live location needs attention before Nearbytes can rely on it.';
    }
    if (summary.state.status === 'needs-auth') {
      return 'Nearbytes cannot use this location until the provider account is connected again.';
    }
    if (summary.state.status === 'syncing') {
      if (isPreparingManagedShare(summary)) {
        return `${summary.state.detail} If it does not clear soon, inspect the MEGA runtime logs from the provider card.`;
      }
      return summary.state.detail || 'Nearbytes is still getting this location ready.';
    }
    if (summary.attachments.length === 0) {
      return 'This live location exists in Nearbytes and is ready when you need it.';
    }
    return summary.state.detail;
  }

  function managedShareStorageFacts(summary: ManagedShareSummary): string[] {
    const facts = [
      managedShareRoleLabel(summary),
      managedShareAccessLabel(summary),
      shareAttachmentSummary(summary),
      summary.storage?.keepFullCopy ? 'Keeps a full copy' : 'On-demand copy policy',
      summary.storage?.availableBytes !== undefined ? `Available storage: ${formatSize(summary.storage.availableBytes)} locally` : null,
      summary.storage?.remoteAvailableBytes !== undefined
        ? `Available storage: ${formatSize(summary.storage.remoteAvailableBytes)} in ${providerLabelForManagedShare(summary)}`
        : null,
    ];
    return facts.filter((value): value is string => Boolean(value));
  }

  function shareAttachmentSummary(summary: ManagedShareSummary): string {
    const count = summary.attachments.length;
    if (count === 0) {
      return summary.storage?.keepFullCopy ? 'Ready for hub writes by default. No hub is using it yet.' : 'Readable now. No hub is using it yet.';
    }
    return `Used in ${countLabel(count, 'place')}.`;
  }

  function canInviteManagedShare(summary: ManagedShareSummary): boolean {
    return summary.share.capabilities.includes('invite');
  }

  function managedShareInviteDraft(shareId: string): string {
    return managedShareInviteDrafts[shareId] ?? '';
  }

  function setManagedShareInviteDraft(shareId: string, value: string): void {
    managedShareInviteDrafts = {
      ...managedShareInviteDrafts,
      [shareId]: value,
    };
  }

  function toCollaboratorView(
    collaborator: { label: string; email?: string; role?: string; status: 'active' | 'invited'; source: 'provider' | 'nearbytes' }
  ): CollaboratorView {
    return {
      key: getCollaboratorDedupeKey(collaborator),
      label: getCollaboratorDisplayLabel(collaborator),
      role: collaborator.role,
      status: collaborator.status,
      source: collaborator.source,
    };
  }

  function collaboratorRoleLabel(collaborator: CollaboratorView): string | null {
    return getCollaboratorRoleLabel(collaborator);
  }

  function parseInviteEmails(value: string): string[] {
    return value
      .split(/[\s,;]+/u)
      .map((entry) => entry.trim())
      .filter((entry, index, entries) => entry !== '' && entries.indexOf(entry) === index);
  }

  function invitedCollaborators(summary: ManagedShareSummary): string[] {
    return summary.collaborators.map((collaborator) => collaborator.email ?? collaborator.label);
  }

  function participantCollaborators(summary: ManagedShareSummary): CollaboratorView[] {
    return summary.collaborators
      .filter((collaborator) => collaborator.status === 'active')
      .map((collaborator) => toCollaboratorView(collaborator));
  }

  function pendingCollaborators(summary: ManagedShareSummary): CollaboratorView[] {
    const activeKeys = new Set(participantCollaborators(summary).map((collaborator) => collaborator.key));
    return summary.collaborators
      .filter((collaborator) => collaborator.status === 'invited')
        .filter((collaborator) => !activeKeys.has(getCollaboratorDedupeKey(collaborator)))
      .map((collaborator) => toCollaboratorView(collaborator));
  }

  function sourceById(sourceId: string | undefined): SourceConfigEntry | null {
    if (!sourceId) return null;
    return configDraft?.sources.find((source) => source.id === sourceId) ?? null;
  }

  function shareCardBadgeForSource(source: SourceConfigEntry): ShareBadge[] {
    const availability = locationAvailability(source);
    if (availability.label === 'Ready') {
      return [];
    }
    return [
      {
        label: availability.label,
        tone: availability.tone,
        description: locationSummary(source),
      },
    ];
  }

  function shareCardBadgesForManaged(summary: ManagedShareSummary): ShareBadge[] {
    const badges: ShareBadge[] = [];
    if (summary.share.provider === 'mega') {
      badges.push({
        label: managedShareIsOwned(summary) ? 'Your location' : 'Incoming',
        tone: managedShareIsOwned(summary) ? 'durable' : 'replica',
        description: managedShareOwnershipLabel(summary) ?? undefined,
      });
    }
    const label = shareStatusLabel(summary);
    if (label !== 'Connected' && label !== 'Available') {
      badges.push({
        label,
        tone: shareStatusTone(summary),
        description: summary.state.detail,
      });
    }
    return badges;
  }

  function defaultManagedShareLabel(): string {
    return 'Storage location';
  }

  function nextManagedShareLabel(provider: string): string {
    const baseLabel = defaultManagedShareLabel();
    const matchingCount = providerShares(provider).filter((summary) => {
      const label = summary.share.label.trim();
      return label === baseLabel || /^Storage location \d+$/u.test(label);
    }).length;
    return matchingCount === 0 ? baseLabel : `${baseLabel} ${matchingCount + 1}`;
  }

  function providerEmptyShareCopy(provider: ProviderCatalogEntry): string {
    if (!provider.isConnected) {
      return `Connect ${provider.label} first, then Nearbytes will manage its shares here.`;
    }
    if (provider.provider === 'local-network') {
      return 'Discovery is active. When another Nearbytes device appears on the same LAN, it will show up here and sync automatically.';
    }
    if (provider.provider === 'mega') {
      return 'No MEGA locations yet. After sign-in, Nearbytes will show your writable publication root here and any accepted incoming shares as local read-only copies.';
    }
    return 'Create a storage location here to make it available in Nearbytes.';
  }

  async function refreshLocalNetworkPeers(options?: { background?: boolean }): Promise<void> {
    if (!localNetworkSupported) {
      return;
    }
    try {
      const response = await listLocalNetworkPeers();
      applyLocalNetworkResponse(response);
      if (!options?.background) {
        localNetworkLoadError = response.isOffline === true
          ? 'Live discovery is unavailable. Showing local phone LAN state and any last-known peer snapshots.'
          : '';
      }
    } catch (error) {
      if (isLocalNetworkUnsupportedError(error)) {
        markLocalNetworkUnsupported();
        return;
      }
      const mirrored = await readMirrorLocalNetworkPeers();
      if (mirrored) {
        applyLocalNetworkResponse(mirrored);
        if (!options?.background) {
          localNetworkLoadError = 'Using mirrored local network state. Live discovery is unavailable.';
        }
        return;
      }
      if (!options?.background) {
        localNetworkLoadError = error instanceof Error ? error.message : String(error);
      }
    }
  }

  async function triggerLocalNetworkSync(peerId: string): Promise<void> {
    syncingLocalNetworkPeerId = peerId;
    try {
      const response = await syncLocalNetworkPeer(peerId);
      localNetworkPeers = localNetworkPeers.map((peer) => (peer.peerId === response.peer.peerId ? response.peer : peer));
      await refreshLocalNetworkPeers({ background: true });
    } catch (error) {
      localNetworkLoadError = error instanceof Error ? error.message : String(error);
    } finally {
      syncingLocalNetworkPeerId = null;
    }
  }

  function managedShareCreateLabel(provider: string): string {
    if (provider === 'github') {
      return githubShareLabel();
    }
    const draft = providerLocationNameDraft(provider).trim();
    return draft || nextManagedShareLabel(provider);
  }

  function defaultGithubBasePath(label: string): string {
    const slug =
      label
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/gu, '-')
        .replace(/^-+|-+$/gu, '')
        .slice(0, 40) || 'share';
    return `nearbytes/${slug}`;
  }

  function localShareView(source: SourceConfigEntry): UnifiedShareView {
    const status = sourceStatus(source.id);
    const defaultDestination = destinationFor(null, source.id);
    const attachments = sourceAttachmentLabels(source.id);
    const repairSummary = sourceRepairSummary(source.id);
    const repairReport = sourceRepairReport(source.id);
    const effectiveReserve = Number.isFinite(defaultDestination?.reservePercent)
      ? defaultDestination!.reservePercent
      : Number.isFinite(source.reservePercent)
        ? source.reservePercent
        : DEFAULT_RESERVE_PERCENT;
    const measurement = storageMeasurementSummary(status?.usage.totalBytes, status?.availableBytes);
    return {
      provider: sourceLocationKindLabel(source.provider),
      title: sourceLocationTitle(source.path),
      pathLabel: sourceLocationPath(source.path),
      copy: locationSummary(source),
      active: source.enabled,
      statusBadges: shareCardBadgeForSource(source),
      meta: [
        measurement,
      ].filter((value): value is string => Boolean(value)),
      readable: source.enabled,
      writable: source.writable,
      reservePercent: effectiveReserve,
      reserveKey: `source:${source.id}`,
      warning: status?.lastWriteFailure?.message,
      repairSummary: repairSummary ?? undefined,
      repairDetails: sourceRepairDetails(source.id),
      attachments,
      onToggleReadable: () => updateSourceField(source.id, 'enabled', !source.enabled),
      onToggleWritable: () => updateSourceField(source.id, 'writable', !source.writable),
      onReserveChange: (nextValue) => {
        updateSourceField(source.id, 'reservePercent', nextValue);
        updateDestinationField(null, source.id, 'reservePercent', nextValue);
      },
      onOpen: hasSourcePath(source) ? () => openSourceFolder(source.id, source.path) : undefined,
      openDisabled: !hasSourcePath(source),
      openTitle: source.path || 'Open folder',
      onTrashIssues: repairReport && repairReport.issueCount > 0 ? () => void runSourceRepair(source.id, 'trash') : undefined,
      onDeleteIssues: repairReport && repairReport.issueCount > 0 ? () => void runSourceRepair(source.id, 'delete') : undefined,
      repairBusy: repairingSourceId === source.id,
      onMove: () => void (hasSourcePath(source) ? moveSourceFolder(source.id) : chooseSourceFolder(source.id)),
      moveDisabled: movingSourceId === source.id || Boolean(source.moveFromSourceId) || hasPendingMove(source.id),
      moveLabel: movingSourceId === source.id ? 'Moving...' : hasSourcePath(source) ? 'Move' : 'Choose folder',
      onRemove: canRemoveAnySource() ? () => removeSource(source.id) : undefined,
      canRemove: canRemoveAnySource(),
      removeResetKey: `local:${source.id}:${source.path}:${source.enabled}:${source.writable}:${keepsFullCopy(defaultDestination)}`,
    };
  }

  function managedShareView(summary: ManagedShareSummary): UnifiedShareView | null {
    const source = sourceById(summary.share.sourceId);
    if (!source) {
      return null;
    }
    const defaultDestination = destinationFor(null, source.id);
    const repairSummary = sourceRepairSummary(source.id);
    const repairReport = sourceRepairReport(source.id);
    const effectiveReserve = Number.isFinite(defaultDestination?.reservePercent)
      ? defaultDestination!.reservePercent
      : Number.isFinite(source.reservePercent)
        ? source.reservePercent
        : DEFAULT_RESERVE_PERCENT;
    const measurement = storageMeasurementSummary(
      summary.storage?.usageTotalBytes,
      summary.storage?.availableBytes ?? summary.storage?.remoteAvailableBytes
    );
    const ownershipLabel = managedShareOwnershipLabel(summary);
    return {
      provider: summary.share.provider === 'gdrive' ? 'Google Drive' : summary.share.provider === 'mega' ? 'MEGA' : summary.share.provider === 'github' ? 'GitHub' : summary.share.provider,
      title: managedShareCardTitle(summary),
      copy: managedShareNarrative(summary),
      active: summary.state.status === 'ready',
      statusBadges: shareCardBadgesForManaged(summary),
      meta: [
        ownershipLabel,
        measurement,
        !measurement ? managedShareOpenLabel(summary) : null,
      ].filter((value): value is string => Boolean(value)),
      readable: source.enabled,
      writable: source.writable,
      writableDisabled: summary.storage?.writable === false,
      writableTitle: summary.storage?.writable === false
        ? 'This shared location is read-only here. Nearbytes refreshes it from the provider but does not upload changes from this folder.'
        : undefined,
      reservePercent: effectiveReserve,
      reserveKey: `managed:${summary.share.id}`,
      warning: summary.storage?.lastWriteFailureMessage,
      repairSummary: repairSummary ?? undefined,
      repairDetails: sourceRepairDetails(source.id),
      attachments: shareAttachmentLabels(summary),
      onToggleReadable: () => updateSourceField(source.id, 'enabled', !source.enabled),
      onToggleWritable: () => updateSourceField(source.id, 'writable', !source.writable),
      onReserveChange: (nextValue) => {
        updateSourceField(source.id, 'reservePercent', nextValue);
        updateDestinationField(null, source.id, 'reservePercent', nextValue);
      },
      onOpen: summary.share.sourceId
        ? () => openSourceFolder(summary.share.sourceId!, summarySourcePath(summary))
        : undefined,
      openDisabled: !summary.share.sourceId,
      openTitle: source.path || summary.share.localPath,
      onTrashIssues: repairReport && repairReport.issueCount > 0 ? () => void runSourceRepair(source.id, 'trash') : undefined,
      onDeleteIssues: repairReport && repairReport.issueCount > 0 ? () => void runSourceRepair(source.id, 'delete') : undefined,
      repairBusy: repairingSourceId === source.id,
      onRemove: () => void removeManagedShareSummary(summary),
      canRemove: true,
      removeResetKey: `managed:${summary.share.id}:${summary.share.label}:${summary.attachments.length}`,
    };
  }

  function providerLabelForManagedShare(summary: ManagedShareSummary): string {
    if (summary.share.provider === 'gdrive') return 'Google Drive';
    if (summary.share.provider === 'mega') return 'MEGA cloud';
    if (summary.share.provider === 'github') return 'GitHub';
    return summary.share.provider;
  }

  function providerLabelForIncoming(provider: string): string {
    if (provider === 'local-network') return 'Local network';
    if (provider === 'gdrive') return 'Google Drive';
    if (provider === 'mega') return 'MEGA';
    if (provider === 'github') return 'GitHub';
    return provider;
  }

  function incomingSharePresentation(offer: IncomingManagedShareOffer): ReturnType<typeof getIncomingSharePresentation> {
    return getIncomingSharePresentation(offer, { hasVolumeTarget: Boolean(volumeId) });
  }

  function incomingShareActionLabel(offer: IncomingManagedShareOffer): string {
    return incomingSharePresentation(offer).actionLabel;
  }

  function incomingShareMetaDetail(offer: IncomingManagedShareOffer): string {
    return incomingSharePresentation(offer).metaDetail;
  }

  function incomingShareStatusBadge(offer: IncomingManagedShareOffer): { label: string; tone: 'good' | 'muted' } {
    return incomingSharePresentation(offer).statusBadge;
  }

  function incomingShareKindLabel(offer: IncomingManagedShareOffer): string {
    return incomingShareActionLabel(offer) === 'Add mirror' ? 'mirror' : 'incoming share';
  }

  function incomingManagedShareTitle(offer: IncomingManagedShareOffer): string {
    if (offer.provider === 'mega') {
      const shareName = typeof offer.remoteDescriptor.shareName === 'string'
        ? offer.remoteDescriptor.shareName.trim()
        : offer.label;
      if (shareName) {
        return shareName;
      }
    }
    const label = offer.label.trim();
    if (label) {
      return label;
    }
    return offer.ownerLabel;
  }

  function generateSourceId(provider: SourceProvider): string {
    const existing = new Set(configDraft?.sources.map((source) => source.id) ?? []);
    const prefix = `src-${provider === 'local' ? 'disk' : provider}`;
    let counter = existing.size + 1;
    while (existing.has(`${prefix}-${counter}`)) {
      counter += 1;
    }
    return `${prefix}-${counter}`;
  }

  function createSource(pathValue = ''): SourceConfigEntry {
    const provider = detectProviderFromPath(pathValue);
    return {
      id: generateSourceId(provider),
      provider,
      path: pathValue,
      enabled: true,
      writable: true,
      reservePercent: DEFAULT_RESERVE_PERCENT,
      opportunisticPolicy: 'block-writes',
    };
  }

  function duplicateDestinationList(
    destinations: VolumeDestinationConfig[],
    sourceId: string,
    nextSourceId: string
  ): VolumeDestinationConfig[] {
    const normalized = destinations.map((destination) => ({
      ...destination,
      reservePercent: destination.reservePercent ?? DEFAULT_RESERVE_PERCENT,
    }));
    const matched = normalized.find((destination) => destination.sourceId === sourceId);
    if (!matched || normalized.some((destination) => destination.sourceId === nextSourceId)) {
      return normalized;
    }
    return [
      ...normalized,
      {
        ...matched,
        sourceId: nextSourceId,
      },
    ];
  }

  function prepareSourceMoveConfig(sourceId: string, nextPath: string): {
    config: RootsConfig;
    targetSource: SourceConfigEntry;
  } {
    if (!configDraft) {
      throw new Error('Config not loaded');
    }
    const source = configDraft.sources.find((entry) => entry.id === sourceId);
    if (!source) {
      throw new Error(`Storage location not found: ${sourceId}`);
    }
    const provider = detectProviderFromPath(nextPath);
    const targetSource: SourceConfigEntry = {
      ...source,
      id: generateSourceId(provider),
      provider,
      path: nextPath,
      reservePercent: source.reservePercent ?? DEFAULT_RESERVE_PERCENT,
      moveFromSourceId: source.id,
    };
    return {
      targetSource,
      config: {
        version: configDraft.version,
        sources: [...configDraft.sources.map((entry) => ({ ...entry })), targetSource],
        defaultVolume: {
          destinations: duplicateDestinationList(
            configDraft.defaultVolume.destinations,
            source.id,
            targetSource.id
          ),
        },
        volumes: configDraft.volumes.map((volume) => ({
          volumeId: volume.volumeId,
          destinations: duplicateDestinationList(volume.destinations, source.id, targetSource.id),
        })),
      },
    };
  }

  function hasPendingMove(sourceId: string): boolean {
    return Boolean(configDraft?.sources.some((source) => source.moveFromSourceId === sourceId));
  }

  function sourceStatus(sourceId: string) {
    return runtime?.sources.find((entry) => entry.id === sourceId) ?? null;
  }

  function effectiveDestinations(targetVolumeId: string | null): VolumeDestinationConfig[] {
    if (!configDraft) return [];
    const merged = new Map<string, VolumeDestinationConfig>();
    for (const destination of configDraft.defaultVolume.destinations) {
      merged.set(destination.sourceId, { ...destination });
    }
    if (!targetVolumeId) {
      return Array.from(merged.values());
    }
    const explicit = configDraft.volumes.find((entry) => entry.volumeId === targetVolumeId);
    if (!explicit) {
      return Array.from(merged.values());
    }
    for (const destination of explicit.destinations) {
      merged.set(destination.sourceId, { ...destination });
    }
    return Array.from(merged.values());
  }

  function explicitVolumePolicy(targetVolumeId: string): VolumePolicyEntry | undefined {
    return configDraft?.volumes.find((entry) => entry.volumeId === targetVolumeId);
  }

  function hasMeaningfulExplicitVolumePolicy(targetVolumeId: string): boolean {
    if (!configDraft) {
      return false;
    }
    const explicit = explicitVolumePolicy(targetVolumeId);
    if (!explicit) {
      return false;
    }
    return !destinationsEqual(effectiveDestinations(targetVolumeId), configDraft.defaultVolume.destinations);
  }

  function pruneRedundantVolumePolicy(targetVolumeId: string): void {
    if (!configDraft || hasMeaningfulExplicitVolumePolicy(targetVolumeId)) {
      return;
    }
    configDraft = {
      ...configDraft,
      volumes: configDraft.volumes.filter((entry) => entry.volumeId !== targetVolumeId),
    };
  }

  function ensureExplicitVolumePolicy(targetVolumeId: string): VolumePolicyEntry {
    if (!configDraft) {
      throw new Error('Config not loaded');
    }
    let entry = configDraft.volumes.find((volume) => volume.volumeId === targetVolumeId);
    if (entry) return entry;
    entry = {
      volumeId: targetVolumeId,
      destinations: effectiveDestinations(targetVolumeId).map((destination) => ({ ...destination })),
    };
    configDraft = {
      ...configDraft,
      volumes: [...configDraft.volumes, entry],
    };
    return configDraft.volumes[configDraft.volumes.length - 1];
  }

  function destinationFor(targetVolumeId: string | null, sourceId: string): VolumeDestinationConfig | null {
    return effectiveDestinations(targetVolumeId).find((destination) => destination.sourceId === sourceId) ?? null;
  }

  function upsertDestination(targetVolumeId: string | null, sourceId: string): void {
    if (!configDraft) return;
    if (targetVolumeId === null) {
      if (configDraft.defaultVolume.destinations.some((destination) => destination.sourceId === sourceId)) {
        return;
      }
      configDraft = {
        ...configDraft,
        defaultVolume: {
          destinations: [...configDraft.defaultVolume.destinations, { ...DEFAULT_DESTINATION, sourceId }],
        },
      };
      return;
    }

    const entry = ensureExplicitVolumePolicy(targetVolumeId);
    if (entry.destinations.some((destination) => destination.sourceId === sourceId)) {
      return;
    }
    const volumeIndex = configDraft.volumes.findIndex((volume) => volume.volumeId === targetVolumeId);
    const nextVolumes = [...configDraft.volumes];
    nextVolumes[volumeIndex] = {
      ...entry,
      destinations: [...entry.destinations, { ...DEFAULT_DESTINATION, sourceId }],
    };
    configDraft = {
      ...configDraft,
      volumes: nextVolumes,
    };
    pruneRedundantVolumePolicy(targetVolumeId);
  }

  function updateDestinationField<K extends keyof VolumeDestinationConfig>(
    targetVolumeId: string | null,
    sourceId: string,
    field: K,
    value: VolumeDestinationConfig[K]
  ): void {
    if (!configDraft) return;
    upsertDestination(targetVolumeId, sourceId);
    if (targetVolumeId === null) {
      configDraft = {
        ...configDraft,
        defaultVolume: {
          destinations: configDraft.defaultVolume.destinations.map((destination) =>
            destination.sourceId === sourceId ? { ...destination, [field]: value } : destination
          ),
        },
      };
      return;
    }

    const entry = ensureExplicitVolumePolicy(targetVolumeId);
    const volumeIndex = configDraft.volumes.findIndex((volume) => volume.volumeId === targetVolumeId);
    const nextVolumes = [...configDraft.volumes];
    nextVolumes[volumeIndex] = {
      ...entry,
      destinations: entry.destinations.map((destination) =>
        destination.sourceId === sourceId ? { ...destination, [field]: value } : destination
      ),
    };
    configDraft = {
      ...configDraft,
      volumes: nextVolumes,
    };
  }

  function removeSource(sourceId: string): void {
    if (!configDraft || configDraft.sources.length <= 1) {
      errorMessage = 'Nearbytes needs at least one storage location.';
      return;
    }
    const source = configDraft.sources.find((entry) => entry.id === sourceId);
    if (source?.moveFromSourceId || hasPendingMove(sourceId)) {
      errorMessage = 'Finish the folder move before removing this storage location.';
      return;
    }
    configDraft = {
      ...configDraft,
      sources: configDraft.sources.filter((source) => source.id !== sourceId),
      defaultVolume: {
        destinations: configDraft.defaultVolume.destinations.filter((destination) => destination.sourceId !== sourceId),
      },
      volumes: configDraft.volumes
        .map((volume) => ({
          ...volume,
          destinations: volume.destinations.filter((destination) => destination.sourceId !== sourceId),
        }))
        .filter((volume) => volume.destinations.length > 0),
    };
  }

  function removeVolumePolicy(targetVolumeId: string): void {
    if (!configDraft) return;
    configDraft = {
      ...configDraft,
      volumes: configDraft.volumes.filter((entry) => entry.volumeId !== targetVolumeId),
    };
  }

  function updateSourceField<K extends keyof SourceConfigEntry>(
    sourceId: string,
    field: K,
    value: SourceConfigEntry[K]
  ): void {
    if (!configDraft) return;
    configDraft = {
      ...configDraft,
      sources: configDraft.sources.map((source) => {
        if (source.id !== sourceId) return source;
        if (field === 'path') {
          const pathValue = String(value);
          return {
            ...source,
            path: pathValue,
            provider: detectProviderFromPath(pathValue),
          };
        }
        return {
          ...source,
          [field]: value,
        };
      }),
    };
  }

  function isDurableDestination(destination: VolumeDestinationConfig | null, sourceId: string): boolean {
    if (!destination || !destination.enabled) return false;
    const source = configDraft?.sources.find((entry) => entry.id === sourceId);
    if (!source || !source.enabled || !source.writable) return false;
    return (
      destination.storeEvents &&
      destination.storeBlocks &&
      destination.copySourceBlocks &&
      destination.fullPolicy === 'block-writes'
    );
  }

  function durableLocationCount(targetVolumeId: string | null): number {
    if (!configDraft) return 0;
    return configDraft.sources.filter((source) => isDurableDestination(destinationFor(targetVolumeId, source.id), source.id))
      .length;
  }

  function hasDurableDestination(targetVolumeId: string | null): boolean {
    return durableLocationCount(targetVolumeId) > 0;
  }

  function protectionTone(destination: VolumeDestinationConfig | null, sourceId: string): 'durable' | 'replica' | 'off' {
    if (!destination || !destination.enabled) return 'off';
    if (isDurableDestination(destination, sourceId)) return 'durable';
    return 'off';
  }

  function protectionLabel(destination: VolumeDestinationConfig | null, sourceId: string): string {
    const tone = protectionTone(destination, sourceId);
    if (tone === 'durable') return 'Full copy';
    return 'Not a full copy';
  }

  function hubLocationMode(targetVolumeId: string, sourceId: string): HubLocationMode {
    const destination = destinationFor(targetVolumeId, sourceId);
    if (!destination || !destination.enabled || !destination.storeEvents) {
      return 'off';
    }
    return 'store';
  }

  function setHubLocationMode(targetVolumeId: string, sourceId: string, mode: HubLocationMode): void {
    if (!configDraft) return;
    upsertDestination(targetVolumeId, sourceId);
    const apply = (destination: VolumeDestinationConfig): VolumeDestinationConfig => {
      if (mode === 'off') {
        return {
          ...destination,
          enabled: false,
          storeEvents: false,
          storeBlocks: false,
          copySourceBlocks: false,
        };
      }
      return {
        ...destination,
        enabled: true,
        storeEvents: true,
        storeBlocks: true,
        copySourceBlocks: true,
      };
    };

    const entry = ensureExplicitVolumePolicy(targetVolumeId);
    const volumeIndex = configDraft.volumes.findIndex((volume) => volume.volumeId === targetVolumeId);
    const nextVolumes = [...configDraft.volumes];
    nextVolumes[volumeIndex] = {
      ...entry,
      destinations: entry.destinations.map((destination) =>
        destination.sourceId === sourceId ? apply(destination) : destination
      ),
    };
    configDraft = {
      ...configDraft,
      sources:
        mode === 'off'
          ? configDraft.sources
          : configDraft.sources.map((source) =>
              source.id === sourceId
                ? {
                    ...source,
                    enabled: true,
                  }
                : source
            ),
      volumes: nextVolumes,
    };
    pruneRedundantVolumePolicy(targetVolumeId);
  }

  function hubStorageHeading(targetVolumeId: string): string {
    return hasMeaningfulExplicitVolumePolicy(targetVolumeId)
      ? 'Storage locations for this hub'
      : 'Saved storage locations';
  }

  function hubStorageIntro(targetVolumeId: string): string {
    return hasMeaningfulExplicitVolumePolicy(targetVolumeId)
      ? 'These choices apply only here.'
      : 'These choices start from your saved locations. Change any location below if this hub needs something different.';
  }

  function hubAttachedSources(targetVolumeId: string): SourceConfigEntry[] {
    return (configDraft?.sources ?? []).filter((source) => hubLocationMode(targetVolumeId, source.id) !== 'off');
  }

  function hubFullCopyCount(targetVolumeId: string): number {
    return hubAttachedSources(targetVolumeId).filter((source) => hubLocationMode(targetVolumeId, source.id) === 'store').length;
  }

  function hubWriteOnlyCount(targetVolumeId: string): number {
    return 0;
  }

  function hubModeLabel(mode: HubLocationMode): string {
    if (mode === 'store') {
      return 'Full copy';
    }
    return 'Not used';
  }

  function hubModeCopy(mode: HubLocationMode): string {
    if (mode === 'store') {
      return 'This location keeps the full hub available here.';
    }
    return 'This location is not part of this hub right now.';
  }

  function hubAvailableSources(targetVolumeId: string): SourceConfigEntry[] {
    return (configDraft?.sources ?? []).filter((source) => hubLocationMode(targetVolumeId, source.id) === 'off');
  }

  function openHubLocationDialog(targetVolumeId: string): void {
    hubLocationDialogVolumeId = targetVolumeId;
  }

  function closeHubLocationDialog(): void {
    hubLocationDialogVolumeId = null;
  }

  function addSourceToHub(targetVolumeId: string, sourceId: string): void {
    setHubLocationMode(targetVolumeId, sourceId, 'store');
    hubLocationDialogVolumeId = null;
    successMessage = 'Storage location added.';
  }

  function openStorageSetupFromHubDialog(): void {
    hubLocationDialogVolumeId = null;
    onOpenStorageSetup?.();
  }

  function canRemoveAnySource(): boolean {
    return (configDraft?.sources.length ?? 0) > 1;
  }

  function keepsFullCopy(destination: VolumeDestinationConfig | null): boolean {
    return Boolean(
      destination?.enabled &&
      destination.storeEvents &&
      destination.storeBlocks &&
      destination.copySourceBlocks
    );
  }

  function setKeepFullCopy(
    targetVolumeId: string | null,
    sourceId: string,
    keepFullCopy: boolean
  ): void {
    if (!configDraft) return;
    upsertDestination(targetVolumeId, sourceId);
    const apply = (destination: VolumeDestinationConfig): VolumeDestinationConfig => {
      if (!keepFullCopy) {
        return {
          ...destination,
          enabled: false,
          storeEvents: false,
          storeBlocks: false,
          copySourceBlocks: false,
        };
      }
      return {
        ...destination,
        enabled: true,
        storeEvents: true,
        storeBlocks: true,
        copySourceBlocks: true,
      };
    };

    if (targetVolumeId === null) {
      configDraft = {
        ...configDraft,
        defaultVolume: {
          destinations: configDraft.defaultVolume.destinations.map((destination) =>
            destination.sourceId === sourceId ? apply(destination) : destination
          ),
        },
      };
      return;
    }

    const entry = ensureExplicitVolumePolicy(targetVolumeId);
    const volumeIndex = configDraft.volumes.findIndex((volume) => volume.volumeId === targetVolumeId);
    const nextVolumes = [...configDraft.volumes];
    nextVolumes[volumeIndex] = {
      ...entry,
      destinations: entry.destinations.map((destination) =>
        destination.sourceId === sourceId ? apply(destination) : destination
      ),
    };
    configDraft = {
      ...configDraft,
      volumes: nextVolumes,
    };
  }

  function canReuseOtherGuaranteedCopies(_destination: VolumeDestinationConfig | null): boolean {
    return false;
  }

  function knownManagedMirrorPaths(): Set<string> {
    const known = new Set<string>();
    for (const summary of managedShares) {
      const resolved = normalizeComparablePath(summarySourcePath(summary));
      if (resolved) {
        known.add(resolved);
      }
    }
    return known;
  }

  function providerHasManagedStorage(provider: string): boolean {
    return providerShares(provider).length > 0;
  }

  function sourceSuggestionRows(): Array<{
    source: DiscoveredNearbytesSource;
    alreadyAdded: boolean;
    dismissed: boolean;
  }> {
    if (!configDraft) return [];
    const unique = new Map<string, DiscoveredNearbytesSource>();
    const managedMirrorPaths = knownManagedMirrorPaths();
    for (const source of discoveredSources) {
      if (source.sourceType === 'suggested' && providerHasManagedStorage(source.provider)) {
        continue;
      }
      const key = normalizeComparablePath(source.path);
      if (managedMirrorPaths.has(key)) {
        continue;
      }
      const current = unique.get(key);
      if (!current || sourceSuggestionPriority(source.sourceType) < sourceSuggestionPriority(current.sourceType)) {
        unique.set(key, source);
      }
    }

    const currentSources = configDraft?.sources ?? [];
    return Array.from(unique.values())
      .map((source) => {
        const normalized = normalizeComparablePath(source.path);
        return {
          source,
          alreadyAdded: currentSources.some((entry) => normalizeComparablePath(entry.path) === normalized),
          dismissed: dismissedDiscoveries.includes(normalized),
        };
      })
      .filter((row) => !row.alreadyAdded && !row.dismissed);
  }

  function dismissedSuggestionCount(): number {
    if (!configDraft) return 0;
    const all = new Set<string>();
    for (const source of discoveredSources) {
      all.add(normalizeComparablePath(source.path));
    }
    let count = 0;
    for (const value of dismissedDiscoveries) {
      if (all.has(value)) count += 1;
    }
    return count;
  }

  function restoreDismissedSuggestions(): void {
    dismissedDiscoveries = [];
  }

  function hasSourcePath(source: SourceConfigEntry): boolean {
    return source.path.trim() !== '';
  }

  function sourceSuggestionPriority(value: DiscoveredNearbytesSource['sourceType']): number {
    if (value === 'marker') return 0;
    if (value === 'layout') return 1;
    return 2;
  }

  function sourceSuggestionCopy(source: DiscoveredNearbytesSource): string {
    if (source.sourceType === 'marker') {
      return 'Nearbytes found an existing folder here automatically.';
    }
    if (source.sourceType === 'layout') {
      return 'Nearbytes found stored data here automatically.';
    }
    return 'Suggested synced folder. Add it if you want Nearbytes to use it.';
  }

  function locationAvailability(source: SourceConfigEntry) {
    const status = sourceStatus(source.id);
    if (source.moveFromSourceId) {
      return { label: 'Move target', tone: 'good' as StatusTone };
    }
    if (!source.enabled) {
      return { label: 'Disabled', tone: 'muted' as StatusTone };
    }
    if (!hasSourcePath(source)) {
      return { label: 'Choose a folder', tone: 'warn' as StatusTone };
    }
    if (status?.exists === false) {
      return { label: 'Folder missing', tone: 'warn' as StatusTone };
    }
    if (status && !status.isDirectory) {
      return { label: 'Not a folder', tone: 'warn' as StatusTone };
    }
    return { label: 'Ready', tone: 'good' as StatusTone };
  }

  function locationWriteState(source: SourceConfigEntry) {
    const status = sourceStatus(source.id);
    if (!source.writable) {
      return { label: 'Read only', tone: 'muted' as StatusTone };
    }
    if (!source.enabled) {
      return { label: 'Writing paused', tone: 'muted' as StatusTone };
    }
    if (status && status.exists && !status.canWrite) {
      return { label: 'Cannot write now', tone: 'warn' as StatusTone };
    }
    return { label: 'Can store here', tone: 'good' as StatusTone };
  }

  function locationSummary(source: SourceConfigEntry): string {
    const status = sourceStatus(source.id);
    if (source.moveFromSourceId) {
      return `Nearbytes is moving data here from ${source.moveFromSourceId}. Both folders stay active until the move finishes.`;
    }
    if (hasPendingMove(source.id)) {
      return 'Nearbytes is moving this location to a new folder. Both folders stay active until the move finishes.';
    }
    if (!hasSourcePath(source)) {
      return 'Choose a folder to finish setting up this location.';
    }
    if (!source.enabled) {
      return 'This location is disabled across Nearbytes. Turn it back on before Nearbytes can use it.';
    }
    if (status?.exists === false) {
      return 'This folder is not available right now. Your choices stay stored, but Nearbytes cannot use this location.';
    }
    if (status && !status.isDirectory) {
      return 'This path exists, but it is not a folder.';
    }
    if (source.writable && status?.canWrite === false) {
      return 'Nearbytes can look here, but it cannot store here right now.';
    }
    if (source.writable) {
      return 'This location is ready.';
    }
    return 'This location is ready for reading only.';
  }

  function usageSummary(sourceId: string): string {
    const totalBytes = sourceStatus(sourceId)?.usage.totalBytes ?? 0;
    if (totalBytes <= 0) {
      return '';
    }
    return `${formatSize(totalBytes)} used`;
  }

  function protectionSummary(targetVolumeId: string | null): string {
    const count = durableLocationCount(targetVolumeId);
    if (count === 0) return 'Choose a full copy location';
    if (count === 1) return '1 full copy location';
    return `${count} full copy locations`;
  }

  function protectionHint(targetVolumeId: string | null): string {
    if (hasDurableDestination(targetVolumeId)) {
      return targetVolumeId
        ? 'This selection already has at least one location keeping a full copy.'
        : 'New storage setups will start with at least one location keeping a full copy.';
    }
    return targetVolumeId
      ? 'Choose at least one writable location below to keep a full copy here.'
      : 'Every new storage setup needs at least one writable location that keeps a full copy.';
  }

  function copyHelpText(targetVolumeId: string | null, source: SourceConfigEntry): string {
    const destination = destinationFor(targetVolumeId, source.id);
    const status = sourceStatus(source.id);
    if (!keepsFullCopy(destination)) {
      return 'This location is not currently attached here.';
    }
    if (!source.enabled) {
      return 'This location is chosen, but it is disabled across Nearbytes right now. Turn it back on before Nearbytes can keep a full copy here.';
    }
    if (!source.writable) {
      return 'This location is chosen, but Nearbytes cannot keep a full copy here until writing is allowed.';
    }
    if (status?.exists === false) {
      return 'This location is chosen, but the folder is not available right now.';
    }
    if (status && status.exists && !status.canWrite) {
      return 'This location is chosen, but Nearbytes cannot write to this folder right now.';
    }
    return 'This location keeps a full copy.';
  }

  function hubLocationNote(targetVolumeId: string, source: SourceConfigEntry): string | null {
    const status = sourceStatus(source.id);
    const mode = hubLocationMode(targetVolumeId, source.id);
    if (source.moveFromSourceId) {
      return `Nearbytes is moving data here from ${source.moveFromSourceId}. Both folders stay active until the move finishes.`;
    }
    if (hasPendingMove(source.id)) {
      return 'Nearbytes is moving this location to a new folder. Both folders stay active until the move finishes.';
    }
    if (!hasSourcePath(source)) {
      return 'Choose a folder to finish setting up this location.';
    }
    if (!source.enabled) {
      return mode === 'store'
        ? 'This location is set to keep a full copy here, but it is disabled across Nearbytes right now.'
        : 'This location is disabled across Nearbytes right now.';
    }
    if (status?.exists === false) {
      return 'This folder is not available right now.';
    }
    if (status && !status.isDirectory) {
      return 'This path exists, but it is not a folder.';
    }
    if (mode !== 'off' && !source.writable) {
      return 'Writing is turned off here, so this location cannot keep a full copy yet.';
    }
    if (mode !== 'off' && status?.canWrite === false) {
      return 'Nearbytes cannot write to this folder right now, so it cannot keep a full copy yet.';
    }
    if (mode === 'off') {
      return 'This location is available, but it is not in use here.';
    }
    return null;
  }

  function applyRootsResponse(response: {
    configPath: string | null;
    config: RootsConfig;
    runtime: RootsRuntimeSnapshot;
  }): void {
    configPath = response.configPath;
    configDraft = cloneConfig(sanitizeConfig(response.config));
    runtime = response.runtime;
    lastSavedSignature = serializeConfig(cloneConfig(sanitizeConfig(response.config)));
    updateBackfillPolling();
    void loadSourceRepairReports(response.config.sources.map((source) => source.id));
  }

  async function refreshRuntimeSnapshot(): Promise<void> {
    if (runtimeRefreshInFlight) {
      return;
    }
    runtimeRefreshInFlight = true;
    try {
      const response = await getRootsConfig({ includeUsage: true });
      configPath = response.configPath;
      runtime = response.runtime;
    } catch {
      // Keep existing UI state if the background refresh fails.
    } finally {
      runtimeRefreshInFlight = false;
      updateBackfillPolling();
    }
  }

  function scheduleRuntimeRefresh(delayMs = 220): void {
    if (runtimeRefreshTimer) {
      clearTimeout(runtimeRefreshTimer);
    }
    runtimeRefreshTimer = setTimeout(() => {
      runtimeRefreshTimer = null;
      void refreshRuntimeSnapshot();
    }, delayMs);
  }

  function applyIntegrationsResponse(input: {
    accounts: ProviderAccount[];
    providers: ProviderCatalogEntry[];
    shares: ManagedShareSummary[];
    incomingShares: IncomingManagedShareOffer[];
    incomingInvites: IncomingProviderContactInvite[];
  }): void {
    providerAccounts = input.accounts;
    providerCatalog = mergeProviderCatalogEntries(input.providers);
    managedShares = sortManagedShareSummaries(input.shares);
    incomingManagedShareOffers = sortIncomingManagedShareOffers(input.incomingShares);
    incomingProviderContactInvites = sortIncomingProviderContactInviteEntries(input.incomingInvites);
    providerSetupDrafts = {
      ...providerSetupDrafts,
      ...Object.fromEntries(
        input.providers.map((provider) => [
          provider.provider,
          {
            clientId:
              provider.provider === 'gdrive' || provider.provider === 'github'
                ? provider.setup.config?.clientId ?? providerSetupDraft(provider.provider).clientId
                : providerSetupDraft(provider.provider).clientId,
          },
        ])
      ),
    };
    for (const account of input.accounts) {
      if (account.state === 'connected' || account.state === 'attention') {
        clearProviderSession(account.provider);
      }
    }
  }

  function applyLocalNetworkResponse(response: LocalNetworkPeersResponse): void {
    localNetworkSupported = true;
    localNetworkService = response.service;
    localNetworkPeers = [...response.peers].sort((left, right) => left.label.localeCompare(right.label));
  }

  function isLocalNetworkUnsupportedError(error: unknown): boolean {
    return Boolean(
      error &&
        typeof error === 'object' &&
        'status' in error &&
        (error as { status?: number }).status === 501
    );
  }

  function markLocalNetworkUnsupported(): void {
    localNetworkSupported = false;
    localNetworkService = null;
    localNetworkPeers = [];
    localNetworkLoadError = 'Local network sync is not enabled in this runtime.';
  }

  async function loadPanel(options?: { background?: boolean }) {
    const keepVisible = options?.background === true && configDraft !== null;
    const hadProviderData = providerCatalog.length > 0 || providerAccounts.length > 0;
    let preserveLoadingState = false;
    if (startupLoadRetryTimer) {
      clearTimeout(startupLoadRetryTimer);
      startupLoadRetryTimer = null;
    }
    if (!keepVisible) {
      loading = true;
      errorMessage = '';
      successMessage = '';
    }
    try {
      providersLoading = true;
      sharesLoading = true;
      incomingLoading = true;
      providerLoadError = '';
      if (localNetworkSupported) {
        localNetworkLoadError = '';
      }
      shareLoadError = '';
      incomingLoadError = '';

      let rootsLoadError: unknown = null;

      const rootsPromise = loadRootsConfigWithRetry({ keepVisible })
        .then((rootsResponse) => {
          startupRecoveryMessage = '';
          applyRootsResponse(rootsResponse);
        })
        .catch((error) => {
          rootsLoadError = error;
        });

      const accountsPromise = withPanelRequestTimeout(
        'Provider discovery',
        (signal) => listProviderAccounts({ signal, fast: true })
      )
        .then((accountsResponse) => {
          providerAccounts = accountsResponse.accounts;
          providerCatalog = mergeProviderCatalogEntries(accountsResponse.providers);
          providerSetupDrafts = {
            ...providerSetupDrafts,
            ...Object.fromEntries(
              accountsResponse.providers.map((provider) => [
                provider.provider,
                {
                  clientId:
                    provider.provider === 'gdrive' || provider.provider === 'github'
                      ? provider.setup.config?.clientId ?? providerSetupDraft(provider.provider).clientId
                      : providerSetupDraft(provider.provider).clientId,
                },
              ])
            ),
          };
          for (const account of accountsResponse.accounts) {
            if (account.state === 'connected' || account.state === 'attention') {
              clearProviderSession(account.provider);
            }
          }
        })
        .catch((error) => {
          const detail = error instanceof Error ? error.message : String(error);
          if (keepVisible && hadProviderData) {
            return;
          }
          providerLoadError = '';
        })
        .finally(() => {
          providersLoading = false;
        });

      const appConfigPromise = withPanelRequestTimeout(
        'Provider configuration',
        (signal) => getAppConfig({ signal })
      )
        .then((appConfigResponse) => {
          applyAppConfigResponse(appConfigResponse);
        })
        .catch((error) => {
          const detail = error instanceof Error ? error.message : String(error);
          providerLoadError = providerLoadError || `Provider configuration is delayed: ${detail}`;
        });

      const localNetworkPromise = localNetworkSupported
        ? withPanelRequestTimeout(
            'Local network peer discovery',
            (signal) => listLocalNetworkPeers({ signal })
          )
            .then((response) => {
              applyLocalNetworkResponse(response);
            })
            .catch(async (error) => {
              if (isLocalNetworkUnsupportedError(error)) {
                markLocalNetworkUnsupported();
                return;
              }
              const detail = error instanceof Error ? error.message : String(error);
              const mirrored = await readMirrorLocalNetworkPeers();
              if (mirrored) {
                applyLocalNetworkResponse(mirrored);
                localNetworkLoadError = 'Using mirrored local network state. Live discovery is delayed.';
                return;
              }
              if (keepVisible && localNetworkPeers.length > 0) {
                return;
              }
              localNetworkLoadError = `Local network discovery is delayed: ${detail}`;
            })
        : Promise.resolve();

      const sharesPromise = withPanelRequestTimeout(
        'MEGA and provider share status',
        (signal) => listManagedShares({ signal, fast: !keepVisible })
      )
        .then((sharesResponse) => {
          managedShares = sortManagedShareSummaries(sharesResponse.shares);
        })
        .catch((error) => {
          const detail = error instanceof Error ? error.message : String(error);
          shareLoadError = `Live locations are still syncing: ${detail}`;
        })
        .finally(() => {
          sharesLoading = false;
        });

      await Promise.allSettled([rootsPromise, accountsPromise, appConfigPromise, localNetworkPromise, sharesPromise]);

      if (rootsLoadError) {
        incomingLoading = false;
        throw rootsLoadError;
      }

      // Always load real incoming offers and contact requests (never `fast: true` here).
      // `fast` skips server work and returns empty lists; combined with scheduled refreshes
      // that rarely set `keepVisible`, the UI never showed "Shared with you" or any Add action.
      // Run after share summaries so we do not hit MEGA with a duplicate full-tree fetch in parallel
      // with the same panel refresh (reduces transient API lock / -3 warnings in logs).
      // MEGA fetch-nodes for incoming shares can take 10—50s under load; keep this above
      // `providerIncomingShareDiscoveryTimeoutMs` in managedShares so we do not abort early.
      const incomingSharesPromise = withPanelRequestTimeout(
        'Incoming share discovery',
        (signal) => listIncomingManagedShares({ signal, fast: false }),
        65_000
      )
        .then((incomingSharesResponse) => {
          incomingManagedShareOffers = sortIncomingManagedShareOffers(incomingSharesResponse.shares);
        })
        .catch((error) => {
          const detail = error instanceof Error ? error.message : String(error);
          incomingLoadError = `Incoming shares are delayed: ${detail}`;
        });

      const incomingInvitesPromise = withPanelRequestTimeout(
        'Incoming contact discovery',
        (signal) => listIncomingProviderContactInvites({ signal, fast: false })
      )
        .then((incomingInvitesResponse) => {
          incomingProviderContactInvites = sortIncomingProviderContactInviteEntries(incomingInvitesResponse.invites);
        })
        .catch((error) => {
          const detail = error instanceof Error ? error.message : String(error);
          incomingLoadError = incomingLoadError || `Incoming invites are delayed: ${detail}`;
        });

      void Promise.allSettled([incomingSharesPromise, incomingInvitesPromise]).finally(() => {
        incomingLoading = false;
      });

      if (!keepVisible) {
        loading = false;
      }

      scheduleManagedShareStateRefresh(keepVisible ? 350 : 125);

      if (!keepVisible) {
        setTimeout(() => {
          void loadPanel({ background: true });
        }, 250);
      }

      autosaveStatus = 'idle';
      if (megaRuntimeLogsVisible) {
        void loadMegaRuntimeLogs();
      }
      void refreshDiscoverySuggestions();
    } catch (error) {
      if (keepVisible && isRetriableStorageStartupError(error)) {
        return;
      }
      if (!keepVisible && isRetriableStorageStartupError(error)) {
        preserveLoadingState = true;
        errorMessage = '';
        startupRecoveryMessage = 'Nearbytes is still preparing your storage locations. It will keep retrying automatically.';
        scheduleStartupLoadRetry();
        return;
      }
      errorMessage = error instanceof Error ? error.message : 'Failed to load storage locations';
      startupRecoveryMessage = '';
    } finally {
      if (!keepVisible) {
        loading = preserveLoadingState;
      }
    }
  }

  function scheduleStartupLoadRetry(delayMs = 1_500): void {
    if (startupLoadRetryTimer) {
      clearTimeout(startupLoadRetryTimer);
    }
    startupLoadRetryTimer = setTimeout(() => {
      startupLoadRetryTimer = null;
      void loadPanel();
    }, delayMs);
  }

  async function requestRootsConfig(includeUsage: boolean, timeoutMs: number | null) {
    return withPanelRequestTimeout(
      'Storage configuration',
      (signal) => getRootsConfig({ signal, includeUsage }),
      timeoutMs
    );
  }

  async function loadRootsConfigWithRetry(options: { keepVisible: boolean }) {
    const timeoutMs = options.keepVisible ? PANEL_REQUEST_TIMEOUT_MS : INITIAL_ROOTS_REQUEST_TIMEOUT_MS;
    const maxWaitMs = options.keepVisible ? null : INITIAL_ROOTS_REQUEST_MAX_WAIT_MS;
    const startedAt = Date.now();
    let lastError: unknown = null;

    while (maxWaitMs === null || Date.now() - startedAt < maxWaitMs) {
      try {
        return await requestRootsConfig(options.keepVisible, timeoutMs);
      } catch (error) {
        lastError = error;
        if (options.keepVisible && isRetriableStorageStartupError(error)) {
          try {
            return await requestRootsConfig(false, BACKGROUND_ROOTS_FALLBACK_TIMEOUT_MS);
          } catch (fallbackError) {
            lastError = fallbackError;
          }
        }
        if (!isRetriableStorageStartupError(error) || options.keepVisible) {
          break;
        }
        await wait(INITIAL_ROOTS_REQUEST_RETRY_DELAY_MS);
      }
    }

    if (!options.keepVisible && isRetriableStorageStartupError(lastError)) {
      throw new Error('Storage configuration is still starting. It should appear automatically in a few seconds.');
    }

    throw lastError instanceof Error ? lastError : new Error('Failed to load storage configuration');
  }

  function isRetriableStorageStartupError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error ?? '');
    return (
      /still starting/i.test(message) ||
      /preparing your storage locations/i.test(message) ||
      /timed out/i.test(message) ||
      /failed to fetch/i.test(message) ||
      /networkerror/i.test(message) ||
      /load failed/i.test(message)
    );
  }

  function wait(timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, timeoutMs);
    });
  }

  async function autosavePanel(expectedSignature: string) {
    if (!configDraft) return;
    errorMessage = '';
    autosaveStatus = 'saving';
    try {
      const response = await updateRootsConfig(sanitizeConfig(configDraft));
      applyRootsResponse(response);
      autosaveStatus = lastSavedSignature === expectedSignature ? 'saved' : 'pending';
      successMessage = '';
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Failed to save';
      autosaveStatus = 'error';
    }
  }

  async function refreshDiscoverySuggestions() {
    const runId = ++discoveryRunId;
    discoveryLoading = true;
    discoveryError = '';
    try {
      const response = await discoverSources({
        maxDepth: DISCOVERY_SCAN_MAX_DEPTH,
        maxDirectories: DISCOVERY_SCAN_MAX_DIRECTORIES,
      });
      if (runId !== discoveryRunId) return;
      discoveredSources = response.sources;
    } catch (error) {
      if (runId !== discoveryRunId) return;
      discoveryError = error instanceof Error ? error.message : 'Failed to scan folders';
    } finally {
      if (runId === discoveryRunId) {
        discoveryLoading = false;
      }
    }
  }

  async function pickFolderPath(initialPath = ''): Promise<string | null> {
    const picked = await chooseDirectoryPath(initialPath);
    return typeof picked === 'string' && picked.trim() !== '' ? picked.trim() : null;
  }

  async function addSourceCard() {
    if (!configDraft) return;
    if (hasDesktopDirectoryPicker()) {
      const selectedPath = await pickFolderPath();
      if (!selectedPath) return;
      const normalized = normalizeComparablePath(selectedPath);
      if (configDraft.sources.some((entry) => normalizeComparablePath(entry.path) === normalized)) {
        successMessage = 'That folder is already saved.';
        return;
      }
      configDraft = {
        ...configDraft,
        sources: [...configDraft.sources, createSource(selectedPath)],
      };
      successMessage = 'Storage location added.';
      return;
    }
    errorMessage = 'Adding another on-device storage location is not available on this phone yet.';
  }

  async function chooseSourceFolder(sourceId: string): Promise<void> {
    if (!configDraft) return;
    if (!hasDesktopDirectoryPicker()) {
      errorMessage = 'Choosing folders is not available on this phone yet.';
      return;
    }
    const source = configDraft.sources.find((entry) => entry.id === sourceId);
    const selectedPath = await pickFolderPath(source?.path ?? '');
    if (!selectedPath) return;
    const normalized = normalizeComparablePath(selectedPath);
    const duplicate = configDraft.sources.find(
      (entry) => entry.id !== sourceId && normalizeComparablePath(entry.path) === normalized
    );
    if (duplicate) {
      errorMessage = 'That folder is already in your saved locations.';
      return;
    }
    updateSourceField(sourceId, 'path', selectedPath);
    successMessage = 'Folder updated.';
  }

  async function moveSourceFolder(sourceId: string): Promise<void> {
    if (!configDraft) return;
    if (!hasDesktopDirectoryPicker()) {
      errorMessage = 'Moving storage locations is not available on this phone yet.';
      return;
    }
    const source = configDraft.sources.find((entry) => entry.id === sourceId);
    if (!source) return;
    if (source.moveFromSourceId) {
      errorMessage = 'This storage location is already finishing a move.';
      return;
    }
    if (hasPendingMove(sourceId)) {
      errorMessage = 'This storage location is already moving to another folder.';
      return;
    }

    const selectedPath = await pickFolderPath(source.path);
    if (!selectedPath) return;
    const normalized = normalizeComparablePath(selectedPath);
    if (normalizeComparablePath(source.path) === normalized) {
      successMessage = 'Folder unchanged.';
      return;
    }
    const duplicate = configDraft.sources.find(
      (entry) => entry.id !== sourceId && normalizeComparablePath(entry.path) === normalized
    );
    if (duplicate) {
      errorMessage = 'That folder is already in your saved locations.';
      return;
    }

    movingSourceId = sourceId;
    errorMessage = '';
    successMessage = '';
    autosaveStatus = 'saving';
    try {
      const prepared = prepareSourceMoveConfig(sourceId, selectedPath);
      const saved = await updateRootsConfig(prepared.config);
      applyRootsResponse(saved);
      autosaveStatus = 'saved';
      successMessage = 'Move started. Nearbytes is copying data to the new folder.';

      const consolidated = await consolidateRoot(sourceId, prepared.targetSource.id);
      applyRootsResponse(consolidated);
      autosaveStatus = 'saved';
      successMessage = 'Folder moved.';
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Failed to move folder';
      autosaveStatus = 'error';
    } finally {
      movingSourceId = null;
    }
  }

  function addDiscoveredSource(source: DiscoveredNearbytesSource) {
    if (!configDraft) return;
    const normalized = normalizeComparablePath(source.path);
    if (configDraft.sources.some((entry) => normalizeComparablePath(entry.path) === normalized)) {
      successMessage = 'That folder is already saved.';
      return;
    }
    configDraft = {
      ...configDraft,
      sources: [...configDraft.sources, createSource(source.path)],
    };
    successMessage = `Added ${formatProvider(source.provider)} location.`;
  }

  function dismissDiscovery(source: DiscoveredNearbytesSource) {
    const normalized = normalizeComparablePath(source.path);
    if (dismissedDiscoveries.includes(normalized)) return;
    dismissedDiscoveries = [...dismissedDiscoveries, normalized];
  }

  async function openSourceFolder(sourceId: string, explicitPath?: string | null) {
    errorMessage = '';
    successMessage = '';
    try {
      const targetPath = explicitPath?.trim() || '';
      if (targetPath) {
        await openPathInFileManager(targetPath);
        successMessage = `Opened ${compactPath(targetPath)}.`;
      } else {
        await openRootInFileManager(sourceId);
        successMessage = 'Opened folder.';
      }
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Failed to open folder';
    }
  }

  async function connectProvider(provider: ProviderCatalogEntry): Promise<void> {
    if (provider.provider === 'local-network') {
      integrationBusyKey = `connect:${provider.provider}`;
      errorMessage = '';
      successMessage = '';
      try {
        await refreshLocalNetworkPeers();
      } finally {
        integrationBusyKey = null;
      }
      return;
    }
    integrationBusyKey = `connect:${provider.provider}`;
    errorMessage = '';
    successMessage = '';
    const controller = beginProviderRequest(provider.provider, {
      phase: 'connecting',
      title: provider.provider === 'mega' ? 'Preparing MEGA connection' : `Connecting ${provider.label}`,
      detail:
        provider.provider === 'mega'
          ? 'Connecting directly to MEGA with the built-in native adapter.'
          : `Starting the ${provider.label} sign-in flow.`,
      canCancel: true,
      canReset: true,
    });
    try {
      if (provider.setup.status === 'needs-install' && provider.setup.canInstall) {
        setProviderFlowState(provider.provider, {
          phase: 'installing',
          title: `Installing ${provider.label} helper`,
          detail:
            provider.provider === 'mega'
              ? 'Preparing the MEGA provider flow. The native runtime is already built in.'
              : `Installing the ${provider.label} helper.`,
          canCancel: true,
          canReset: true,
        });
        await installProvider(provider, controller.signal, false);
        if (controller.signal.aborted) {
          return;
        }
      }
      if (provider.setup.status === 'needs-config') {
        throw new Error(provider.setup.detail);
      }

      const draft = providerCredentialDraft(provider.provider);
      setProviderFlowState(provider.provider, {
        phase: 'connecting',
        title: `Connecting ${provider.label}`,
        detail:
          provider.provider === 'mega'
            ? 'Submitting your MEGA credentials and opening a local session.'
            : `Handing off to ${provider.label} to continue sign-in.`,
        canCancel: true,
        canReset: true,
      });
      if (provider.provider === 'mega') {
        if (draft.email.trim() === '' || draft.password.trim() === '') {
          throw new Error('Enter the MEGA email and password first.');
        }
      }

      const response = await connectProviderAccount({
        provider: provider.provider,
        mode: provider.provider === 'mega' ? 'login' : undefined,
        label: provider.label,
        preferred: provider.provider === 'gdrive',
        email: provider.provider === 'mega' ? draft.email.trim() || undefined : undefined,
        credentials:
          provider.provider === 'mega'
            ? {
                email: draft.email.trim() || undefined,
                password: draft.password,
                mfaCode: draft.useMfa ? draft.mfaCode.trim() || undefined : undefined,
              }
            : undefined,
      }, { signal: controller.signal });
      await handleProviderConnectResponse(provider, response);
    } catch (error) {
      if (isAbortError(error)) {
        setProviderFlowState(provider.provider, {
          phase: 'cancelled',
          title: 'Cancelled',
          detail: 'Connection request cancelled.',
          canCancel: false,
          canReset: true,
        });
      } else {
        setProviderFlowState(provider.provider, null);
        errorMessage = error instanceof Error ? error.message : `Failed to connect ${provider.label}`;
      }
    } finally {
      finishProviderRequest(provider.provider, controller, pendingSessionForProvider(provider.provider) === null);
      integrationBusyKey = null;
    }
  }

  async function configureProvider(provider: ProviderCatalogEntry): Promise<void> {
    integrationBusyKey = `setup:${provider.provider}`;
    errorMessage = '';
    successMessage = '';
    try {
      const draft = providerSetupDraft(provider.provider);
      if (provider.provider === 'gdrive' && draft.clientId.trim() === '') {
        throw new Error('Paste the Google Desktop app client id first.');
      }
      await configureProviderSetup(provider.provider, {
        clientId: draft.clientId.trim() || undefined,
      });
      successMessage =
        provider.provider === 'gdrive'
          ? 'Google client ID saved. You can connect now.'
          : `${provider.label} setup updated.`;
      await loadPanel();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : `Failed to configure ${provider.label}`;
    } finally {
      integrationBusyKey = null;
    }
  }

  async function installProvider(
    provider: ProviderCatalogEntry,
    signal?: AbortSignal,
    ownBusyKey = true
  ): Promise<void> {
    const controller = signal ? null : beginProviderRequest(provider.provider, {
      phase: 'installing',
      title: `Installing ${provider.label} helper`,
      detail: `Downloading and installing the ${provider.label} helper locally.`,
      canCancel: true,
      canReset: true,
    });
    if (ownBusyKey) {
      integrationBusyKey = `install:${provider.provider}`;
    }
    errorMessage = '';
    successMessage = '';
    try {
      await installProviderHelper(provider.provider, { signal: signal ?? controller?.signal });
      successMessage = `${provider.label} helper installed.`;
      setProviderFlowState(provider.provider, {
        phase: 'connecting',
        title: `${provider.label} helper ready`,
        detail: 'The local helper is installed. You can continue connecting now.',
        canCancel: false,
        canReset: true,
      });
      await loadPanel();
    } catch (error) {
      if (isAbortError(error)) {
        setProviderFlowState(provider.provider, {
          phase: 'cancelled',
          title: 'Cancelled',
          detail: 'Stopped waiting for the helper installation.',
          canCancel: false,
          canReset: true,
        });
      } else {
        setProviderFlowState(provider.provider, null);
        errorMessage = error instanceof Error ? error.message : `Failed to install ${provider.label} helper`;
        throw error;
      }
    } finally {
      if (controller) {
        finishProviderRequest(provider.provider, controller, false);
      }
      if (ownBusyKey) {
        integrationBusyKey = null;
      }
    }
  }

  function openProviderDocs(url: string | undefined): void {
    if (!url) return;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  async function disconnectProvider(provider: ProviderCatalogEntry): Promise<void> {
    if (provider.provider === 'local-network') return;
    if (!provider.accountId) return;
    integrationBusyKey = `disconnect:${provider.provider}`;
    errorMessage = '';
    successMessage = '';
    try {
      await disconnectProviderAccount(provider.accountId);
      clearProviderSession(provider.provider);
      successMessage = `${provider.label} disconnected.`;
      await loadPanel();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : `Failed to disconnect ${provider.label}`;
    } finally {
      integrationBusyKey = null;
    }
  }

  async function toggleProvider(provider: ProviderCatalogEntry): Promise<void> {
    const nextEnabled = !providerEnabled(provider.provider);
    integrationBusyKey = `provider-toggle:${provider.provider}`;
    errorMessage = '';
    successMessage = '';
    try {
      const response = await updateProviderEnabled(provider.provider, nextEnabled);
      applyAppConfigResponse(response);
      successMessage = `${provider.label} ${nextEnabled ? 'enabled' : 'disabled'}.`;
      await loadPanel({ background: true });
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : `Failed to update ${provider.label}`;
    } finally {
      integrationBusyKey = null;
    }
  }

  async function createManagedShareForVolume(provider: ProviderCatalogEntry): Promise<void> {
    if (!volumeId || !provider.accountId) return;
    integrationBusyKey = `create:${provider.provider}`;
    errorMessage = '';
    successMessage = '';
    try {
      const remoteDescriptor = provider.provider === 'github' ? githubShareDescriptor(defaultManagedShareLabel()) : undefined;
      await createManagedShare({
        provider: provider.provider,
        accountId: provider.accountId,
        label: defaultManagedShareLabel(),
        volumeId,
        remoteDescriptor,
      });
      successMessage = `${provider.label} location created.`;
      await loadPanel();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : `Failed to create ${provider.label} location`;
    } finally {
      integrationBusyKey = null;
    }
  }

  async function createManagedShareForProvider(provider: ProviderCatalogEntry): Promise<void> {
    if (!provider.accountId) return;
    integrationBusyKey = `create:${provider.provider}`;
    errorMessage = '';
    successMessage = '';
    try {
      const label = managedShareCreateLabel(provider.provider);
      await createManagedShare({
        provider: provider.provider,
        accountId: provider.accountId,
        label,
        remoteDescriptor: provider.provider === 'github' ? githubShareDescriptor(label) : undefined,
      });
      if (providerLocationNameDraft(provider.provider).trim()) {
        setProviderLocationName(provider.provider, '');
      }
      setProviderCreateComposerOpenState(provider.provider, false);
      successMessage = `${provider.label} location created.`;
      await loadPanel();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : `Failed to create ${provider.label} location`;
    } finally {
      integrationBusyKey = null;
    }
  }

  function handleProviderAddLocation(provider: ProviderCatalogEntry): void {
    if (!providerSupportsCreateAction(provider.provider)) {
      errorMessage = 'Nearbytes cannot create owner-side MEGA locations yet. Accept an incoming share or use a public link instead.';
      return;
    }
    if (isInlineLocationComposerProvider(provider.provider)) {
      openProviderCreateComposer(provider.provider);
      return;
    }
    void createManagedShareForProvider(provider);
  }

  async function removeManagedShareSummary(summary: ManagedShareSummary): Promise<void> {
    integrationBusyKey = `remove-share:${summary.share.id}`;
    errorMessage = '';
    successMessage = '';
    try {
      await removeManagedShare(summary.share.id);
      successMessage = `${summary.share.label} removed.`;
      await loadPanel();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : `Failed to remove ${summary.share.label}`;
    } finally {
      integrationBusyKey = null;
    }
  }

  function githubShareLabel(): string {
    const draft = providerShareDraft('github');
    const repoName = draft.repoName.trim();
    const basePath = normalizeGithubDraftPath(draft.basePath);
    if (repoName && basePath) {
      const segments = basePath.split('/').filter(Boolean);
      const leaf = segments[segments.length - 1];
      return leaf ? `${repoName}/${leaf}` : repoName;
    }
    if (repoName) {
      return repoName;
    }
    return defaultManagedShareLabel();
  }

  function githubShareDescriptor(label: string): Record<string, unknown> {
    const draft = providerShareDraft('github');
    const repoOwner = draft.repoOwner.trim();
    const repoName = draft.repoName.trim();
    if (!repoOwner || !repoName) {
      throw new Error('Enter the GitHub repo owner and repo name first.');
    }
    return {
      repoOwner,
      repoName,
      branch: draft.branch.trim() || 'main',
      basePath: normalizeGithubDraftPath(draft.basePath) || defaultGithubBasePath(label),
    };
  }

  function normalizeGithubDraftPath(value: string): string {
    return value.trim().replace(/^\/+/u, '').replace(/\/+/gu, '/').replace(/\/+$/u, '');
  }

  function clearProviderSession(provider: string): void {
    const timer = providerSessionTimers.get(provider);
    if (timer) {
      clearTimeout(timer);
      providerSessionTimers.delete(provider);
    }
    if (!(provider in providerAuthSessions)) {
      return;
    }
    const next = { ...providerAuthSessions };
    delete next[provider];
    providerAuthSessions = next;
    if (providerFlowState(provider)?.phase === 'waiting-confirmation') {
      setProviderFlowState(provider, null);
    }
  }

  async function handleProviderConnectResponse(
    provider: ProviderCatalogEntry,
    response: Awaited<ReturnType<typeof connectProviderAccount>>
  ): Promise<void> {
    if (response.status === 'connected' && response.account) {
      clearProviderSession(provider.provider);
      setProviderFlowState(provider.provider, null);
      if (provider.provider === 'mega') {
        setProviderCredential(provider.provider, 'password', '');
        setProviderCredential(provider.provider, 'mfaCode', '');
        setProviderCredential(provider.provider, 'useMfa', false);
        setProviderCredential(provider.provider, 'confirmationLink', '');
      }
      successMessage = `${provider.label} connected.`;
      await loadPanel();
      return;
    }

    if (response.authSession) {
      providerAuthSessions = {
        ...providerAuthSessions,
        [provider.provider]: response.authSession,
      };
    }

    if (response.status === 'failed') {
      setProviderFlowState(provider.provider, null);
      throw new Error(response.authSession?.detail || `Failed to connect ${provider.label}`);
    }

    if (provider.provider === 'mega') {
      setProviderFlowState(provider.provider, {
        phase: 'waiting-confirmation',
        title: 'Waiting for MEGA confirmation',
        detail: response.authSession?.detail || 'Check your inbox, then paste the MEGA confirmation link here.',
        canCancel: false,
        canReset: true,
      });
    } else {
      setProviderFlowState(provider.provider, {
        phase: 'polling',
        title: `Waiting for ${provider.label}`,
        detail: response.authSession?.detail || `Finish the ${provider.label} sign-in flow in the browser.`,
        canCancel: true,
        canReset: true,
      });
    }

    successMessage =
      provider.provider === 'gdrive'
        ? 'Finish Google sign-in in the browser that just opened.'
        : response.authSession?.detail || `${provider.label} is waiting for confirmation.`;
    if (response.authSession && provider.provider !== 'mega') {
      scheduleProviderSessionPoll(provider, response.authSession.id);
    }
  }

  async function confirmMegaSignup(provider: ProviderCatalogEntry): Promise<void> {
    if (provider.provider === 'local-network') return;
    const session = pendingSessionForProvider(provider.provider);
    if (!session) {
      errorMessage = 'Start the MEGA account creation flow first.';
      return;
    }
    const draft = providerCredentialDraft(provider.provider);
    if (draft.confirmationLink.trim() === '') {
      errorMessage = 'Paste the MEGA confirmation link first.';
      return;
    }
    integrationBusyKey = `confirm:${provider.provider}`;
    errorMessage = '';
    successMessage = '';
    const controller = beginProviderRequest(provider.provider, {
      phase: 'confirming',
      title: 'Confirming MEGA account',
      detail: 'Sending the confirmation link back to MEGA to finish account creation.',
      canCancel: true,
      canReset: true,
    });
    try {
      const response = await connectProviderAccount({
        provider: provider.provider,
        mode: 'confirm-signup',
        authSessionId: session.id,
        credentials: {
          confirmationLink: draft.confirmationLink.trim(),
        },
      }, { signal: controller.signal });
      await handleProviderConnectResponse(provider, response);
    } catch (error) {
      if (isAbortError(error)) {
        setProviderFlowState(provider.provider, {
          phase: 'cancelled',
          title: 'Cancelled',
          detail: 'Confirmation request cancelled.',
          canCancel: false,
          canReset: true,
        });
      } else {
        setProviderFlowState(provider.provider, null);
        errorMessage = error instanceof Error ? error.message : `Failed to confirm ${provider.label} account`;
      }
    } finally {
      finishProviderRequest(provider.provider, controller, pendingSessionForProvider(provider.provider) === null);
      integrationBusyKey = null;
    }
  }

  function scheduleProviderSessionPoll(provider: ProviderCatalogEntry, authSessionId: string): void {
    const previous = providerSessionTimers.get(provider.provider);
    if (previous) {
      clearTimeout(previous);
    }

    const timer = setTimeout(() => {
      void pollProviderSession(provider, authSessionId);
    }, 1200);
    providerSessionTimers.set(provider.provider, timer);
  }

  async function pollProviderSession(provider: ProviderCatalogEntry, authSessionId: string): Promise<void> {
    if (provider.provider === 'local-network') return;
    const controller = beginProviderRequest(provider.provider, {
      phase: 'polling',
      title: `Waiting for ${provider.label}`,
      detail: `Checking whether ${provider.label} finished the sign-in flow.`,
      canCancel: true,
      canReset: true,
    });
    try {
      const response = await connectProviderAccount({
        provider: provider.provider,
        authSessionId,
        preferred: provider.provider === 'gdrive',
      }, { signal: controller.signal });
      await handleProviderConnectResponse(provider, response);
    } catch (error) {
      if (isAbortError(error)) {
        setProviderFlowState(provider.provider, {
          phase: 'cancelled',
          title: 'Cancelled',
          detail: 'Stopped waiting for the browser sign-in to finish.',
          canCancel: false,
          canReset: true,
        });
      } else {
        clearProviderSession(provider.provider);
        setProviderFlowState(provider.provider, null);
        errorMessage = error instanceof Error ? error.message : `Failed to finish ${provider.label} sign-in`;
      }
    } finally {
      finishProviderRequest(provider.provider, controller, pendingSessionForProvider(provider.provider) === null);
    }
  }

  async function inviteManagedSharePeers(summary: ManagedShareSummary): Promise<void> {
    const emails = parseInviteEmails(managedShareInviteDraft(summary.share.id));
    if (emails.length === 0) {
      errorMessage = 'Enter at least one email address to invite.';
      return;
    }
    const accessLevel = summary.share.provider === 'mega' ? 'read/write' : undefined;
    integrationBusyKey = `invite:${summary.share.id}`;
    errorMessage = '';
    successMessage = '';
    try {
      await inviteManagedShare(summary.share.id, emails, accessLevel);
      setManagedShareInviteDraft(summary.share.id, '');
      successMessage = accessLevel
        ? `${summary.share.label} location shared with ${emails.join(', ')} as ${formatAccessLevelLabel(accessLevel)}.`
        : `${summary.share.label} location shared with ${emails.join(', ')}.`;
      await loadPanel();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Failed to invite people to this location';
    } finally {
      integrationBusyKey = null;
    }
  }

  async function acceptProviderContactInviteEntry(invite: IncomingProviderContactInvite): Promise<void> {
    integrationBusyKey = `accept-contact:${invite.id}`;
    errorMessage = '';
    successMessage = '';
    try {
      await acceptIncomingProviderContactInvite({
        provider: invite.provider,
        accountId: invite.accountId,
        inviteId: invite.id,
      });
      successMessage = `${invite.label} is now an accepted ${providerLabelForIncoming(invite.provider)} contact.`;
      await loadPanel();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Failed to accept provider contact invite';
    } finally {
      integrationBusyKey = null;
    }
  }

  async function acceptIncomingManagedShareOffer(offer: IncomingManagedShareOffer): Promise<void> {
    integrationBusyKey = `accept-share:${offer.id}`;
    errorMessage = '';
    successMessage = '';
    try {
      const response = await acceptManagedShare({
        provider: offer.provider,
        accountId: offer.accountId,
        label: offer.label,
        volumeId: mode === 'volume' ? volumeId ?? undefined : undefined,
        localPath: offer.suggestedLocalPath,
        remoteDescriptor: offer.remoteDescriptor,
      });
      const writable = response.summary.share.capabilities.includes('write');
      successMessage = response.summary.attachments.length > 0
        ? `${offer.label} is attached and ready in this hub.`
        : writable
          ? `${offer.label} is connected as an incoming share. Nearbytes reads from this local copy, while your own updates still publish through your MEGA Nearbytes root.`
          : `${offer.label} is connected as a read-only mirror. Nearbytes can read from it now.`;
      await loadPanel();
      if (response.summary.state.status === 'syncing') {
        successMessage = `${offer.label} is attached. Nearbytes is preparing the local mirror now.`;
        if (panelRefreshTimer) {
          clearTimeout(panelRefreshTimer);
        }
        panelRefreshTimer = setTimeout(() => {
          panelRefreshTimer = null;
          void loadPanel({ background: true });
        }, 900);
      }
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Failed to accept incoming storage location';
    } finally {
      integrationBusyKey = null;
    }
  }

  function clampReserve(value: string): number {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return DEFAULT_RESERVE_PERCENT;
    return Math.max(0, Math.min(95, parsed));
  }

  function toggleReserveEditor(key: string): void {
    activeReserveEditorKey = activeReserveEditorKey === key ? null : key;
  }

  function closeReserveEditor(key: string): void {
    if (activeReserveEditorKey === key) {
      activeReserveEditorKey = null;
    }
  }

</script>

{#if loading && !configDraft}
  <section class="storage-panel panel-surface" class:global-mode={mode === 'global'} class:volume-mode={mode === 'volume'} use:devSurface={{ enabled: $dev, name: 'StoragePanel' }}>
    <p class="storage-message">Loading storage locations...</p>
    {#if startupRecoveryMessage}
      <p class="storage-message">{startupRecoveryMessage}</p>
    {/if}
    {#if errorMessage}
      <StatusNotice tone="error" role="alert" compact={true} message={errorMessage} />
    {/if}
  </section>
{:else if !configDraft}
  <section class="storage-panel panel-surface" class:global-mode={mode === 'global'} class:volume-mode={mode === 'volume'} use:devSurface={{ enabled: $dev, name: 'StoragePanel' }}>
    <p class="storage-message">Storage locations are not ready yet.</p>
    {#if errorMessage}
      <StatusNotice tone="error" role="alert" compact={true} message={errorMessage} />
    {/if}
    <div class="button-row">
      <button type="button" class="panel-btn subtle" onclick={() => void loadPanel()}>
        <RefreshCw size={14} strokeWidth={2} />
        <span>Retry</span>
      </button>
    </div>
  </section>
{:else if configDraft}
  <section class="storage-panel panel-surface" class:global-mode={mode === 'global'} class:volume-mode={mode === 'volume'} use:devSurface={{ enabled: $dev, name: 'StoragePanel' }}>
    {#if mode === 'global'}
      {@const visibleMegaToasts = megaToastList()}
      {#if visibleMegaToasts.length > 0}
        <div class="mega-toast-region" aria-live="polite" aria-label="MEGA activity">
          {#each visibleMegaToasts as toast (toast.key)}
            <article class="mega-toast" data-tone={toast.tone}>
              <div class="mega-toast-copy">
                <p class="subheading">MEGA</p>
                <p class="mega-toast-title">{toast.title}</p>
                <p class="provider-step-detail">{toast.detail}</p>
              </div>
              <div class="mega-toast-actions">
                {#if toast.action}
                  {@const action = toast.action}
                  <button
                    type="button"
                    class="panel-btn primary compact"
                    onclick={() => void runMegaToastAction(action)}
                  >
                    <span>{action.label}</span>
                  </button>
                {/if}
                <button type="button" class="panel-btn subtle compact" onclick={() => dismissMegaToast(toast)}>
                  <span>Hide</span>
                </button>
              </div>
            </article>
          {/each}
        </div>
      {/if}
    {/if}
    {#snippet unifiedShareCard(view: UnifiedShareView)}
      <div class="compact-share-item">
        <ShareCard
          title={view.title}
          copy={view.active && !view.warning && !view.repairSummary ? '' : view.copy}
          active={view.active}
          compact={true}
          statusBadges={view.statusBadges}
          meta={view.meta}
        >
        {#snippet metaActions()}
          <button
            type="button"
            class="meta-reserve-btn"
            title="Change free-space buffer"
            onclick={() => toggleReserveEditor(view.reserveKey)}
          >{formatPercent(view.reservePercent)} reserved</button>
          {#if activeReserveEditorKey === view.reserveKey}
            <label class="inline-reserve-editor" title="Minimum available storage to leave on this drive.">
              <span>Free-space buffer</span>
              <select
                class="panel-input inline-reserve-select"
                value={String(view.reservePercent)}
                onchange={(event) => {
                  view.onReserveChange(clampReserve((event.currentTarget as HTMLSelectElement).value));
                  closeReserveEditor(view.reserveKey);
                }}
                onblur={() => closeReserveEditor(view.reserveKey)}
              >
                {#each RESERVE_OPTIONS as option}
                  <option value={option}>{formatPercent(option)}</option>
                {/each}
              </select>
            </label>
          {/if}
        {/snippet}
        {#snippet controls()}
          <div class="setting-list compact-toggle-row">
            <IconToggle
              icon={BookOpen}
              label="Read"
              active={view.readable}
              title="Allow this location to serve this app"
              onclick={view.onToggleReadable}
            />
            <IconToggle
              icon={SquarePen}
              label="Write"
              active={view.writable}
              onclick={view.onToggleWritable}
              disabled={view.writableDisabled}
              title={view.writableTitle ?? 'Allow writes here'}
            />
          </div>
        {/snippet}
        {#snippet actions()}
          {#if view.onRemove && view.canRemove}
            <button
              type="button"
              class="panel-btn subtle compact icon-btn armed-icon-danger"
              title="Remove location"
              aria-label="Remove location"
              onclick={() => { if (confirm('Remove this location from nearbytes?')) view.onRemove?.(); }}
            ><Trash2 size={14} strokeWidth={2} /></button>
          {/if}
        {/snippet}
        {#snippet footer()}
          {#if view.warning}
            <StatusNotice tone="warning" compact={true} title="Last write problem" message={view.warning} />
          {/if}
          {#if view.repairSummary}
            <StatusNotice tone="warning" compact={true} message={view.repairSummary}>
              {#snippet actions()}
                {#if view.onTrashIssues}
                  <button
                    type="button"
                    class="panel-btn subtle compact"
                    onclick={view.onTrashIssues}
                    disabled={view.repairBusy}
                    title="Move unexpected or invalid files to the system trash"
                  >
                    <span>{view.repairBusy ? 'Cleaning...' : 'Clean up'}</span>
                  </button>
                {/if}
              {/snippet}
            </StatusNotice>
          {/if}
          {#if view.attachments.length > 0}
            <div class="fact-row share-volume-row">
              {#each view.attachments as attachment}
                {#if attachment.known}
                  <button
                    type="button"
                    class="mini-pill mini-pill-button"
                    title={`${attachment.label}: ${attachment.usagePercent}% of this content is stored here, ${formatSize(attachment.usageBytes)} currently present on this location.`}
                    onclick={() => onOpenVolumeRouting?.(attachment.volumeId)}
                  >
                    <span>{attachment.label}</span>
                    <span class="mini-pill-metric">{attachment.usagePercent}%</span>
                  </button>
                {:else}
                  <span
                    class="mini-pill"
                    title={`${attachment.label}: ${attachment.usagePercent}% of this content is stored here, ${formatSize(attachment.usageBytes)} currently present on this location.`}
                  >
                    <span>{attachment.label}</span>
                    <span class="mini-pill-metric">{attachment.usagePercent}%</span>
                  </span>
                {/if}
              {/each}
            </div>
          {/if}
        {/snippet}
        </ShareCard>
      </div>
    {/snippet}
    {#snippet managedShareCard(summary: ManagedShareSummary)}
      {@const view = managedShareView(summary)}
      {#if view}
        <div class="compact-share-item" data-managed-share-id={summary.share.id}>
          <ShareCard
            title={view.title}
            active={view.active}
            compact={true}
            statusBadges={view.statusBadges}
            meta={view.meta}
          >
          {#snippet metaActions()}
            <button
              type="button"
              class="meta-reserve-btn"
              title="Change free-space buffer"
              onclick={() => toggleReserveEditor(view.reserveKey)}
            >{formatPercent(view.reservePercent)} reserved</button>
            {#if activeReserveEditorKey === view.reserveKey}
              <label class="inline-reserve-editor" title="Minimum available storage to leave on this drive.">
                <span>Free-space buffer</span>
                <select
                  class="panel-input inline-reserve-select"
                  value={String(view.reservePercent)}
                  onchange={(event) => {
                    view.onReserveChange(clampReserve((event.currentTarget as HTMLSelectElement).value));
                    closeReserveEditor(view.reserveKey);
                  }}
                  onblur={() => closeReserveEditor(view.reserveKey)}
                >
                  {#each RESERVE_OPTIONS as option}
                    <option value={option}>{formatPercent(option)}</option>
                  {/each}
                </select>
              </label>
            {/if}
          {/snippet}
          {#snippet controls()}
            <div class="setting-list compact-toggle-row">
              <IconToggle
                icon={BookOpen}
                label="Read"
                active={view.readable}
                title="Allow this location to serve this app"
                onclick={view.onToggleReadable}
              />
              <IconToggle
                icon={SquarePen}
                label="Write"
                active={view.writable}
                onclick={view.onToggleWritable}
                disabled={view.writableDisabled}
                title={view.writableTitle ?? 'Allow writes here'}
              />
            </div>
          {/snippet}
          {#snippet details()}
            {@const activeCollaborators = participantCollaborators(summary)}
            {@const invitedCollaboratorViews = pendingCollaborators(summary)}
            {#if activeCollaborators.length > 0 || invitedCollaboratorViews.length > 0}
              <div class="managed-share-members managed-share-members-inline">
                <p class="subheading">{managedShareIsOwned(summary) ? 'People' : 'Shared with'}</p>
                <div class="managed-share-members-list">
                  {#each activeCollaborators as collaborator (collaborator.key)}
                    <span class="mini-pill">
                      <span>{collaborator.label}</span>
                      {#if collaboratorRoleLabel(collaborator)}
                        <span class="mini-pill-metric">{collaboratorRoleLabel(collaborator)}</span>
                      {/if}
                    </span>
                  {/each}
                  {#each invitedCollaboratorViews as collaborator (collaborator.key)}
                    <span class="mini-pill">
                      <span>{collaborator.label}</span>
                      <span class="mini-pill-metric">Invited</span>
                    </span>
                  {/each}
                </div>
              </div>
            {/if}

            {#if canInviteManagedShare(summary)}
              <form class="managed-share-invite-row managed-share-invite-row-compact" onsubmit={(event) => {
                event.preventDefault();
                void inviteManagedSharePeers(summary);
              }}>
                <label class="field-block managed-share-invite-field">
                  <span>Invite</span>
                  <input
                    class="panel-input"
                    type="text"
                    value={managedShareInviteDraft(summary.share.id)}
                    placeholder="name@example.com"
                    oninput={(event) =>
                      setManagedShareInviteDraft(summary.share.id, (event.currentTarget as HTMLInputElement).value)}
                  />
                </label>
                <button
                  type="submit"
                  class="panel-btn subtle compact"
                  disabled={integrationBusyKey === `invite:${summary.share.id}`}
                >
                  <span>{integrationBusyKey === `invite:${summary.share.id}` ? 'Sending...' : 'Invite'}</span>
                </button>
              </form>
            {/if}
          {/snippet}
          {#snippet actions()}
            {#if view.onRemove && view.canRemove}
              <button
                type="button"
                class="panel-btn subtle compact icon-btn armed-icon-danger"
                title="Remove location"
                aria-label="Remove location"
                onclick={() => { if (confirm('Remove this location from nearbytes?')) view.onRemove?.(); }}
              ><Trash2 size={14} strokeWidth={2} /></button>
            {/if}
          {/snippet}
          {#snippet footer()}
            {#if view.warning}
              <StatusNotice tone="warning" compact={true} title="Last write problem" message={view.warning} />
            {/if}
            {#if view.repairSummary}
              <StatusNotice tone="warning" compact={true} message={view.repairSummary}>
                {#snippet actions()}
                  {#if view.onTrashIssues}
                    <button
                      type="button"
                      class="panel-btn subtle compact"
                      onclick={view.onTrashIssues}
                      disabled={view.repairBusy}
                      title="Move unexpected or invalid files to the system trash"
                    >
                      <span>{view.repairBusy ? 'Cleaning...' : 'Clean up'}</span>
                    </button>
                  {/if}
                {/snippet}
              </StatusNotice>
            {/if}
            {#if view.attachments.length > 0}
              <div class="fact-row share-volume-row">
                {#each view.attachments as attachment}
                  {#if attachment.known}
                    <button
                      type="button"
                      class="mini-pill mini-pill-button"
                        title={`${attachment.label}: ${attachment.usagePercent}% of this content is stored here, ${formatSize(attachment.usageBytes)} currently present on this location.`}
                      onclick={() => onOpenVolumeRouting?.(attachment.volumeId)}
                    >
                        <span>{attachment.label}</span>
                        <span class="mini-pill-metric">{attachment.usagePercent}%</span>
                    </button>
                  {:else}
                      <span
                        class="mini-pill"
                        title={`${attachment.label}: ${attachment.usagePercent}% of this content is stored here, ${formatSize(attachment.usageBytes)} currently present on this location.`}
                      >
                        <span>{attachment.label}</span>
                        <span class="mini-pill-metric">{attachment.usagePercent}%</span>
                      </span>
                  {/if}
                {/each}
              </div>
            {/if}
          {/snippet}
          </ShareCard>
        </div>
      {/if}
    {/snippet}
    {#snippet incomingContactInviteCard(invite: IncomingProviderContactInvite)}
      <div class="compact-share-item">
        <ShareCard
          title={invite.label}
          compact={true}
          statusBadges={[{ label: 'Contact invite', tone: 'warn' }]}
          meta={[]}
        >
          {#snippet actions()}
            <button
              type="button"
              class="panel-btn subtle compact"
              onclick={() => void acceptProviderContactInviteEntry(invite)}
              disabled={integrationBusyKey === `accept-contact:${invite.id}`}
            >
              <span>{integrationBusyKey === `accept-contact:${invite.id}` ? 'Accepting...' : 'Accept contact'}</span>
            </button>
          {/snippet}
        </ShareCard>
      </div>
    {/snippet}
    {#snippet incomingManagedShareCard(offer: IncomingManagedShareOffer)}
      <div class="compact-share-item">
        <ShareCard
          title={incomingManagedShareTitle(offer)}
          compact={true}
          statusBadges={[incomingShareStatusBadge(offer)]}
          meta={[
            `Shared by ${offer.ownerLabel}`,
            incomingShareMetaDetail(offer),
          ]}
        >
          {#snippet details()}
            {#if offer.suggestedLocalPath}
              <div class="provider-path-card managed-share-path-card">
                <p class="subheading">Suggested local {incomingShareKindLabel(offer)}</p>
                <p class="provider-path-copy">{offer.suggestedLocalPath}</p>
              </div>
            {/if}
          {/snippet}
          {#snippet actions()}
            <div class="button-row incoming-share-actions">
              <button
                type="button"
                class="panel-btn subtle compact"
                onclick={() => void acceptIncomingManagedShareOffer(offer)}
                disabled={integrationBusyKey === `accept-share:${offer.id}`}
              >
                {#if integrationBusyKey !== `accept-share:${offer.id}`}
                  <Plus size={14} strokeWidth={2} />
                {/if}
                <span>{integrationBusyKey === `accept-share:${offer.id}` ? 'Adding...' : incomingShareActionLabel(offer)}</span>
              </button>
              <button
                type="button"
                class="panel-btn subtle compact danger"
                onclick={() => dismissIncomingManagedShareOffer(offer)}
                disabled={integrationBusyKey === `accept-share:${offer.id}`}
                title="Hide this incoming share on this device"
              >
                <span>Hide</span>
              </button>
            </div>
          {/snippet}
        </ShareCard>
      </div>
    {/snippet}
    {#snippet incomingFromOthersSection(providerKey: string, heading: string)}
      {@const incomingInvitesHere = incomingProviderInvitesForProvider(providerKey)}
      {@const incomingSharesHere = incomingManagedSharesForProvider(providerKey)}
      {@const hiddenIncomingSharesHere = dismissedIncomingManagedShareCount(providerKey)}
      {#if providerCatalog.some((entry) => entry.provider === providerKey && entry.isConnected)}
        <div class="provider-incoming-section">
          <div class="provider-flow-status">
            <p class="provider-flow-title">{heading}</p>
            {#if incomingLoading}
              <p class="muted-copy">Checking…</p>
            {:else if incomingLoadError}
              <StatusNotice tone="warning" compact={true} message={incomingLoadError} />
            {/if}
            {#if hiddenIncomingSharesHere > 0}
              <div class="button-row">
                <button
                  type="button"
                  class="panel-btn subtle compact"
                  onclick={() => restoreDismissedIncomingManagedShares(providerKey)}
                >
                  <span>Show hidden {countLabel(hiddenIncomingSharesHere, 'share')}</span>
                </button>
              </div>
            {/if}
          </div>
          {#if incomingInvitesHere.length > 0 || incomingSharesHere.length > 0}
            <div class="compact-share-grid">
              {#each incomingInvitesHere as invite (invite.id)}
                {@render incomingContactInviteCard(invite)}
              {/each}
              {#each incomingSharesHere as offer (offer.id)}
                {@render incomingManagedShareCard(offer)}
              {/each}
            </div>
          {:else if !incomingLoading}
            <p class="managed-share-invite-copy">
              {#if hiddenIncomingSharesHere > 0}
                No incoming locations are visible right now. {countLabel(hiddenIncomingSharesHere, 'hidden share')} can be shown again from the button above.
              {:else}
                No incoming locations detected yet. When a location is visible in {providerLabelForIncoming(providerKey)}, it will list here with an add action.
              {/if}
            </p>
          {/if}
        </div>
      {/if}
    {/snippet}
    {#snippet addLocationAction(label: string, title: string, onPress: () => void, disabled: boolean)}
      <button type="button" class="panel-btn subtle compact" onclick={onPress} {title} {disabled}>
        <Plus size={14} strokeWidth={2} />
        <span>{label}</span>
      </button>
    {/snippet}
    {#snippet addLocationComposer(provider: ProviderCatalogEntry)}
      <form class="provider-create-inline" onsubmit={(event) => {
        event.preventDefault();
        void createManagedShareForProvider(provider);
      }}>
        <input
          class="panel-input provider-create-inline-input"
          type="text"
          value={providerLocationNameDraft(provider.provider)}
          placeholder={nextManagedShareLabel(provider.provider)}
          oninput={(event) => setProviderLocationName(provider.provider, (event.currentTarget as HTMLInputElement).value)}
        />
        <button
          type="submit"
          class="panel-btn primary compact"
          disabled={integrationBusyKey === `create:${provider.provider}`}
        >
          <span>{integrationBusyKey === `create:${provider.provider}` ? 'Creating...' : 'Create'}</span>
        </button>
        <button
          type="button"
          class="panel-btn subtle compact"
          onclick={() => closeProviderCreateComposer(provider.provider)}
          disabled={integrationBusyKey === `create:${provider.provider}`}
        >
          <span>Cancel</span>
        </button>
      </form>
    {/snippet}
    {#if mode === 'global'}
      <div class="storage-shell-facts">
          <span class="summary-pill">{countLabel(localMachineShareCount(), 'saved location')}</span>
          <span class="summary-pill">{countLabel(connectedProviderCount(), 'connected service')}</span>
          {#if totalIncomingReviewCount() > 0}<span class="summary-pill tone-warn">{countLabel(totalIncomingReviewCount(), 'incoming item')}</span>{/if}
        </div>

      <div class="provider-choice-grid" role="group" aria-label="Choose a storage provider">
        <button
          type="button"
          class="provider-choice-card"
          class:active={selectedGlobalView === 'local'}
          aria-pressed={selectedGlobalView === 'local'}
          onclick={() => {
            selectedGlobalProvider = 'local';
            selectedGlobalView = 'local';
          }}
        >
          <span class="provider-choice-eyebrow">Start here</span>
          <span class="provider-choice-head">
            <span class="provider-choice-title">This Mac</span>
            <span class="status-pill tone-good">{countLabel(localMachineShareCount(), 'saved location')}</span>
          </span>
          <span class="provider-choice-copy">
            {sourceSuggestionRows().length > 0
              ? `${countLabel(sourceSuggestionRows().length, 'suggestion')} ready to review`
              : 'Choose folders already on this Mac'}
          </span>
        </button>

        {#each providerCatalog as provider (provider.provider)}
          {@const tabLoadingState = providerTabLoadingState(provider)}
          <button
            type="button"
            class="provider-choice-card"
            class:active={selectedGlobalView === 'provider' && selectedGlobalProvider === provider.provider}
            aria-pressed={selectedGlobalView === 'provider' && selectedGlobalProvider === provider.provider}
            onclick={() => {
              selectedGlobalProvider = provider.provider;
              selectedGlobalView = 'provider';
            }}
          >
            <span class="provider-choice-eyebrow">{provider.isConnected ? 'Connected service' : 'Optional service'}</span>
            <span class="provider-choice-head">
              <span class="provider-choice-title">{provider.label}</span>
              <span class={`status-pill tone-${provider.isConnected ? 'good' : provider.setup.status === 'unsupported' ? 'warn' : 'muted'}`}>
                {providerCardStatus(provider)}
              </span>
            </span>
            <span class="provider-choice-copy">
              {#if tabLoadingState}
                {tabLoadingState.detail}
              {:else}
                {providerTabCopy(provider)}
              {/if}
            </span>
          </button>
        {/each}

        <button
          type="button"
          class="provider-choice-card incoming-choice-card"
          class:active={selectedGlobalView === 'incoming'}
          aria-pressed={selectedGlobalView === 'incoming'}
          onclick={() => {
            const provider = incomingReviewTargetProvider();
            if (provider) {
              selectedGlobalProvider = provider;
              selectedGlobalView = 'incoming';
            }
          }}
          disabled={incomingReviewTargetProvider() === null}
        >
          <span class="provider-choice-eyebrow">From other people</span>
          <span class="provider-choice-head">
            <span class="provider-choice-title">Incoming items</span>
            <span class={`status-pill tone-${totalIncomingReviewCount() > 0 ? 'warn' : 'muted'}`}>
              {countLabel(totalIncomingReviewCount(), 'item')}
            </span>
          </span>
          <span class="provider-choice-copy">
            {totalIncomingReviewCount() > 0
              ? 'Review contact requests and incoming locations here'
              : 'No incoming items right now'}
          </span>
        </button>
      </div>

      {#if errorMessage}
        <StatusNotice tone="error" role="alert" compact={true} message={errorMessage} />
      {/if}
      {#if successMessage}
        <StatusNotice tone="success" compact={true} message={successMessage} />
      {/if}

      {#if selectedGlobalView === 'local'}
      <section class="panel-section">
        <div class="section-head compact global-panel-head global-panel-head-actions">
          <div class="button-row compact-panel-actions">
            {@render addLocationAction('Add folder', 'Add a folder on this device', addSourceCard, false)}
            {#if dismissedSuggestionCount() > 0}
              <button type="button" class="panel-btn subtle compact" onclick={restoreDismissedSuggestions}>
                <span>Show hidden</span>
              </button>
            {/if}
          </div>
        </div>

        {#if discoveryError}
          <StatusNotice tone="warning" compact={true} message={discoveryError} />
        {/if}

        <div class="section-stack">
          {#if localShares().length > 0}
            <div class="compact-share-grid">
              {#each localShares() as source (source.id)}
                {@render unifiedShareCard(localShareView(source))}
              {/each}
            </div>
          {:else}
            <article class="rule-card">
              <p class="card-copy">No folders are saved on this device yet.</p>
              <div class="button-row inline-dialog-actions">
                <button type="button" class="panel-btn subtle compact" onclick={addSourceCard}>
                  <Plus size={14} strokeWidth={2} />
                  <span>Add folder</span>
                </button>
              </div>
            </article>
          {/if}
        </div>

        {#if sourceSuggestionRows().length > 0}
          <div class="section-stack section-stack-secondary">
            <div class="section-copy-stack">
              <p class="subheading">Suggested locations</p>
              <p class="managed-share-invite-copy">Folders that already look ready. Add only the ones you want.</p>
            </div>

            <div class="compact-share-grid">
              {#each sourceSuggestionRows() as row (row.source.path)}
                <article class="location-card suggestion-card">
                  <div class="card-head">
                    <div class="card-title">
                      <div class="card-icon" title={row.source.path}>
                        <Search size={16} strokeWidth={2.1} />
                      </div>
                      <div title={row.source.path}>
                        <p class="provider-label">{sourceLocationKindLabel(row.source.provider)}</p>
                        <h4>{sourceLocationTitle(row.source.path)}</h4>
                        <p class="card-path">{sourceLocationPath(row.source.path)}</p>
                      </div>
                    </div>
                  </div>

                  <p class="card-copy">{sourceSuggestionCopy(row.source)}</p>

                  <div class="button-row">
                    <button type="button" class="panel-btn subtle compact" onclick={() => addDiscoveredSource(row.source)}>
                      <Plus size={14} strokeWidth={2} />
                      <span>Use this location</span>
                    </button>
                    <button type="button" class="panel-btn subtle compact danger" onclick={() => dismissDiscovery(row.source)}>
                      <span>Hide</span>
                    </button>
                  </div>
                </article>
              {/each}
            </div>
          </div>
        {/if}
      </section>

      {:else if selectedGlobalView === 'incoming'}
        {@const incomingProviders = providerCatalog.filter((entry) => {
          if (!entry.isConnected || !providerShowsIncomingShareSection(entry.provider)) {
            return false;
          }
          const hasReceivedShares = providerReceivedVisibleShares(entry.provider).length > 0;
          const hasIncomingReviewState =
            incomingProviderInvitesForProvider(entry.provider).length > 0
            || incomingManagedSharesForProvider(entry.provider).length > 0
            || dismissedIncomingManagedShareCount(entry.provider) > 0
            || incomingLoading
            || Boolean(incomingLoadError);
          return hasReceivedShares || hasIncomingReviewState;
        })}
        <section class="panel-section">
          {#if incomingProviders.length === 0}
            <article class="rule-card">
              <p class="card-copy">No incoming items right now.</p>
            </article>
          {:else}
            <div class="section-stack">
              {#each incomingProviders as incomingProvider (incomingProvider.provider)}
                {@const receivedShares = providerReceivedVisibleShares(incomingProvider.provider)}
                {@const hasIncomingReviewState =
                  incomingProviderInvitesForProvider(incomingProvider.provider).length > 0
                  || incomingManagedSharesForProvider(incomingProvider.provider).length > 0
                  || dismissedIncomingManagedShareCount(incomingProvider.provider) > 0
                  || incomingLoading
                  || Boolean(incomingLoadError)}
                <div class="section-stack section-stack-secondary provider-incoming-hub-wrap">
                  <div class="section-copy-stack">
                    <p class="subheading">{incomingProvider.label}</p>
                    <p class="managed-share-invite-copy">Only locations and invites coming from other people appear here.</p>
                  </div>

                  {#if receivedShares.length > 0}
                    <div class="compact-share-grid" class:mega-share-grid={incomingProvider.provider === 'mega'}>
                      {#each receivedShares as summary (summary.share.id)}
                        {@render managedShareCard(summary)}
                      {/each}
                    </div>
                  {/if}

                  {#if hasIncomingReviewState}
                    {@render incomingFromOthersSection(
                      incomingProvider.provider,
                      receivedShares.length > 0
                        ? 'Still to review'
                        : incomingProvider.provider === 'mega'
                          ? 'Incoming locations'
                          : 'Shared with you'
                    )}
                  {/if}
                </div>
              {/each}
            </div>
          {/if}
        </section>
      {:else}
        {@const provider = providerCatalog.find((entry) => entry.provider === selectedGlobalProvider) ?? null}
        {#if provider}
          {@const ownedShares = providerOwnedVisibleShares(provider.provider)}
          {@const receivedShares = providerReceivedVisibleShares(provider.provider)}
          {@const hasIncomingReviewState = providerShowsIncomingShareSection(provider.provider)
            && (
              incomingProviderInvitesForProvider(provider.provider).length > 0
              || incomingManagedSharesForProvider(provider.provider).length > 0
              || dismissedIncomingManagedShareCount(provider.provider) > 0
              || incomingLoading
              || Boolean(incomingLoadError)
            )}
          <section class="panel-section">
            <div class="section-head compact global-panel-head global-panel-head-actions">
              <div class="button-row compact-panel-actions">
                <IconToggle
                  icon={Power}
                  label={providerEnabled(provider.provider) ? 'On' : 'Off'}
                  active={providerEnabled(provider.provider)}
                  disabled={integrationBusyKey === `provider-toggle:${provider.provider}`}
                  title={providerEnabled(provider.provider) ? `Disable ${provider.label}` : `Enable ${provider.label}`}
                  ariaLabel={providerEnabled(provider.provider) ? `Disable ${provider.label}` : `Enable ${provider.label}`}
                  onclick={() => void toggleProvider(provider)}
                />
                {#if providerEnabled(provider.provider)}
                {#if provider.provider === 'local-network'}
                  <button
                    type="button"
                    class="panel-btn subtle compact"
                    onclick={() => void refreshLocalNetworkPeers()}
                  >
                    <span>Refresh peers</span>
                  </button>
                {:else if provider.isConnected && providerSupportsCreateAction(provider.provider)}
                  {#if isInlineLocationComposerProvider(provider.provider) && isProviderCreateComposerOpen(provider.provider)}
                    {@render addLocationComposer(provider)}
                  {:else}
                    {@render addLocationAction(
                      'Add a location',
                      `Add a ${provider.label} storage location`,
                      () => handleProviderAddLocation(provider),
                      integrationBusyKey === `create:${provider.provider}`
                    )}
                  {/if}
                {/if}
                {#if shouldShowProviderDocs(provider) && provider.setup.docsUrl}
                  <button
                    type="button"
                    class="panel-btn subtle compact"
                    onclick={() => openProviderDocs(provider.setup.docsUrl)}
                  >
                    <span>{provider.provider === 'gdrive' ? 'Open Google Console' : 'Open docs'}</span>
                  </button>
                {/if}
                {#if !provider.isConnected && provider.setup.status === 'needs-config'}
                  <button
                    type="button"
                    class="panel-btn subtle compact"
                    onclick={() => void configureProvider(provider)}
                    disabled={integrationBusyKey === `setup:${provider.provider}`}
                  >
                    <span>{integrationBusyKey === `setup:${provider.provider}` ? 'Saving...' : 'Save setup'}</span>
                  </button>
                {/if}
                {#if provider.provider === 'mega'}
                  <button
                    type="button"
                    class="panel-btn subtle compact"
                    bind:this={megaAccountSection}
                    onclick={() => openProviderConnectionDialog(provider.provider)}
                  >
                    <span>{provider.isConnected ? (megaProviderReconnectIssue() ? 'Open account' : 'Disconnect') : 'Connect'}</span>
                  </button>
                {:else if provider.isConnected && provider.provider !== 'local-network'}
                  <button
                    type="button"
                    class="panel-btn subtle compact"
                    onclick={() => openProviderConnectionDialog(provider.provider)}
                  >
                    <span>{providerCardStatus(provider)}</span>
                  </button>
                {:else if provider.provider !== 'mega'}
                  {#if providerFlowState(provider.provider)?.canCancel}
                    <button
                      type="button"
                      class="panel-btn subtle compact"
                      onclick={() => cancelProviderFlow(provider.provider)}
                    >
                      <span>Cancel</span>
                    </button>
                  {/if}
                  {#if canResetProviderFlow(provider.provider)}
                    <button
                      type="button"
                      class="panel-btn subtle compact"
                      onclick={() => resetProviderFlow(provider.provider)}
                      disabled={providerFlowState(provider.provider)?.canCancel === true}
                    >
                      <span>Reset</span>
                    </button>
                  {/if}
                  <button
                    type="button"
                    class="panel-btn subtle compact"
                    onclick={() => void connectProvider(provider)}
                    disabled={
                      integrationBusyKey === `connect:${provider.provider}` ||
                      provider.setup.status === 'needs-config' ||
                      provider.setup.status === 'unsupported'
                    }
                  >
                    <span>
                      {integrationBusyKey === `connect:${provider.provider}`
                        ? provider.setup.status === 'needs-install'
                          ? 'Installing...'
                          : 'Connecting...'
                        : provider.provider === 'gdrive'
                          ? 'Connect with Google'
                          : 'Connect'}
                    </span>
                  </button>
                {/if}
                {/if}
              </div>
            </div>

            {#if provider.provider === 'local-network' && providerEnabled(provider.provider)}
              <div class="section-stack">
                <ProviderStatusCard
                  title={localNetworkService?.listening ? 'Local network sync is active' : 'Preparing local network sync'}
                  detail={providerCardDetail(provider)}
                  tone={localNetworkLoadError ? 'warn' : localNetworkPeers.length > 0 ? 'good' : 'muted'}
                >
                  {#snippet actions()}
                    {#if localNetworkService}
                      <span class="provider-step-detail">Peer ID {localNetworkService.peerId.slice(0, 8)}</span>
                      <span class="provider-step-detail" style="opacity:0.5">Build {__GIT_COMMIT__}</span>
                    {/if}
                  {/snippet}
                </ProviderStatusCard>

                {#if localNetworkLoadError}
                  <StatusNotice tone="warning" compact={true} message={localNetworkLoadError} />
                {/if}

                <div class="compact-share-grid">
                  {#if localNetworkPeers.length === 0}
                    <div class="compact-share-item">
                      <ShareCard
                        title="No nearby peers yet"
                        copy="Keep Nearbytes open on another machine on the same LAN. As soon as it announces itself, this panel will populate and sync will start automatically."
                        statusBadges={localNetworkService?.listening ? [{ label: 'Listening', tone: 'muted' }] : []}
                        meta={localNetworkService ? [localNetworkService.serviceType, localNetworkService.transport.toUpperCase()] : []}
                      />
                    </div>
                  {:else}
                    {#each localNetworkPeers as peer (peer.peerId)}
                      <div class="compact-share-item">
                        <ShareCard
                          title={peer.label}
                          copy={peer.detail}
                          statusBadges={[
                            { label: peer.status === 'ready' ? 'Live' : peer.status === 'syncing' ? 'Syncing' : peer.status === 'error' ? 'Attention' : 'Waiting', tone: peer.status === 'ready' ? 'good' : peer.status === 'syncing' ? 'muted' : peer.status === 'error' ? 'warn' : 'muted' },
                            { label: countLabel(peer.volumeIds.length, 'volume'), tone: 'replica' }
                          ]}
                          meta={[peer.address, `Port ${peer.port}`]}
                        >
                          {#snippet controls()}
                            <button
                              type="button"
                              class="panel-btn subtle compact"
                              onclick={() => void triggerLocalNetworkSync(peer.peerId)}
                              disabled={syncingLocalNetworkPeerId === peer.peerId}
                            >
                              <span>{syncingLocalNetworkPeerId === peer.peerId ? 'Syncing...' : 'Sync now'}</span>
                            </button>
                          {/snippet}
                          {#snippet details()}
                            <div class="provider-fact-list">
                              <p class="provider-step-detail">Last seen: {formatAbsoluteTimestamp(peer.lastSeenAt)}</p>
                              <p class="provider-step-detail">Last sync: {peer.lastSyncAt ? formatAbsoluteTimestamp(peer.lastSyncAt) : 'Waiting'}</p>
                              <p class="provider-step-detail">Imported recently: {peer.lastImportedEvents} events, {peer.lastImportedBlocks} blocks</p>
                              {#if peer.lastSyncError}
                                <StatusNotice tone="warning" compact={true} message={peer.lastSyncError} />
                              {:else if peer.lastSyncNotice}
                                <p class="provider-step-detail">{peer.lastSyncNotice}</p>
                              {/if}
                            </div>
                          {/snippet}
                        </ShareCard>
                      </div>
                    {/each}
                  {/if}
                </div>
              </div>
            {/if}

            {#if provider.provider !== 'local-network' && providerEnabled(provider.provider)}
            {#if provider.provider === 'mega'}
              {@const megaStatus = megaStatusView()}
              {@const megaIssue = megaDiagnostics(1, { onlyProblems: true })[0]}
              {@const megaReconnectIssue = megaProviderReconnectIssue()}
              {#if megaReconnectIssue || shareLoadError || (megaStatus.tone !== 'good' && (megaStatus.detail || megaStatus.progressLabel)) || megaRuntimeLogsVisible}
                <div class="mega-command-deck" bind:this={megaOverviewSection}>
                  {#if megaReconnectIssue || shareLoadError || (megaStatus.tone !== 'good' && (megaStatus.detail || megaStatus.progressLabel))}
                    <ProviderStatusCard
                      title={megaReconnectIssue ? 'Finish any MEGA account recovery on mega.io' : megaStatus.headline}
                      detail={megaReconnectIssue
                        ? 'Nearbytes is retrying the saved MEGA sign-in. If MEGA requires recovery, finish that on mega.io.'
                        : shareLoadError || megaStatus.detail || megaStatus.headline}
                      tone={megaReconnectIssue ? 'warn' : megaStatus.tone}
                      showProgress={megaStatus.showProgressBar}
                      progressPercent={megaStatus.progressPercent}
                      progressLabel={megaStatus.progressLabel}
                    >
                      {#snippet actions()}
                        {#if megaReconnectIssue}
                          <button
                            type="button"
                            class="panel-btn primary compact"
                            onclick={() => openProviderConnectionDialog(provider.provider)}
                          >
                            <span>Open account</span>
                          </button>
                        {/if}
                      {/snippet}
                    </ProviderStatusCard>
                  {/if}

                  {#if megaRuntimeLogsVisible}
                    {@const visibleRuntimeLogs = visibleMegaRuntimeLogs()}
                    {@const activeRuntimeLog = activeMegaRuntimeLog()}
                    <div class="provider-path-card mega-runtime-log-card">
                      <div class="mega-runtime-log-header">
                        <div>
                          <p class="subheading">Developer backend logs</p>
                          <p class="provider-step-detail">
                            {megaRuntimeLogsUpdatedAt ? `Updated ${formatMegaRuntimeLogTimestamp(megaRuntimeLogsUpdatedAt)}` : ''}
                          </p>
                        </div>
                        <div class="mega-runtime-log-header-actions">
                          <button
                            type="button"
                            class="panel-btn subtle compact"
                            onclick={() => void loadMegaRuntimeLogs()}
                            disabled={megaRuntimeLogsLoading}
                          >
                            <span>{megaRuntimeLogsLoading ? 'Loading...' : 'Refresh logs'}</span>
                          </button>
                          <button
                            type="button"
                            class="panel-btn subtle compact"
                            onclick={() => {
                              megaRuntimeLogsVisible = false;
                            }}
                          >
                            <span>Close</span>
                          </button>
                        </div>
                      </div>
                      <div class="mega-runtime-log-toolbar">
                        <label class="mega-runtime-log-search">
                          <span class="subheading">Filter</span>
                          <input
                            class="panel-input"
                            type="text"
                            value={megaRuntimeLogFilter}
                            placeholder="Search paths or log text"
                            oninput={(event) => {
                              megaRuntimeLogFilter = (event.currentTarget as HTMLInputElement).value;
                            }}
                          />
                        </label>
                        <div class="mega-runtime-log-toggle-row">
                          <button
                            type="button"
                            class:primary={megaRuntimeLogAutoRefresh}
                            class="panel-btn subtle compact"
                            onclick={() => {
                              megaRuntimeLogAutoRefresh = !megaRuntimeLogAutoRefresh;
                            }}
                          >
                            <span>{megaRuntimeLogAutoRefresh ? 'Auto-refresh on' : 'Auto-refresh off'}</span>
                          </button>
                          <button
                            type="button"
                            class:primary={megaRuntimeLogWrap}
                            class="panel-btn subtle compact"
                            onclick={() => {
                              megaRuntimeLogWrap = !megaRuntimeLogWrap;
                            }}
                          >
                            <span>{megaRuntimeLogWrap ? 'Wrap on' : 'Wrap off'}</span>
                          </button>
                          <button
                            type="button"
                            class="panel-btn subtle compact"
                            onclick={() => void copyMegaRuntimeLog(activeRuntimeLog)}
                            disabled={!activeRuntimeLog}
                          >
                            <span>{megaRuntimeLogCopyFeedback || 'Copy active log'}</span>
                          </button>
                        </div>
                      </div>
                      {#if megaRuntimeLogsError}
                        <StatusNotice tone="warning" compact={true} message={megaRuntimeLogsError} />
                      {:else if visibleRuntimeLogs.length === 0}
                        <p class="provider-step-detail">
                          No log files found yet. With the built-in MEGA runtime this is normal; use the folder status list for sync progress.
                        </p>
                      {:else}
                        <div class="mega-runtime-log-layout">
                          <div class="mega-runtime-log-list">
                            {#each visibleRuntimeLogs as entry}
                              <button
                                type="button"
                                class="mega-runtime-log-tab"
                                class:active={activeRuntimeLog?.id === entry.id}
                                onclick={() => selectMegaRuntimeLog(entry.id)}
                              >
                                <span class="mega-runtime-log-tab-title">{entry.label}</span>
                                <span class="mega-runtime-log-tab-meta">
                                  {entry.exists
                                    ? `${compactPath(entry.path)} • ${formatSize(entry.size)}`
                                    : `${compactPath(entry.path)} • waiting`}
                                </span>
                              </button>
                            {/each}
                          </div>
                          {#if activeRuntimeLog}
                            <div class="provider-path-card mega-runtime-log-entry">
                              <div class="mega-runtime-log-entry-head">
                                <div>
                                  <p class="provider-step-title">{activeRuntimeLog.label}</p>
                                  <p class="provider-step-detail">{activeRuntimeLog.path}</p>
                                </div>
                                <div class="provider-fact-list">
                                  <p class="provider-step-detail">
                                    {activeRuntimeLog.exists ? formatMegaRuntimeLogTimestamp(activeRuntimeLog.updatedAt) : 'Not written yet'}
                                  </p>
                                  <p class="provider-step-detail">
                                    {countLabel(megaRuntimeLogLineCount(activeRuntimeLog), 'line')}
                                  </p>
                                </div>
                              </div>
                              <pre class:wrap={megaRuntimeLogWrap} class="mega-log-view mega-log-view-large">{#if activeRuntimeLog.exists && megaRuntimeLogContent(activeRuntimeLog).trim() !== ''}{@html megaRuntimeLogHtml(activeRuntimeLog)}{:else}No log content yet.{/if}</pre>
                            </div>
                          {/if}
                        </div>
                      {/if}
                    </div>
                  {/if}
                </div>
              {/if}

              {#if megaIssue}
                <div class="provider-story-card compact-provider-card">
                  <p class="subheading">Needs attention</p>
                  <div class="provider-fact-list">
                    <div class="provider-path-card mega-diagnostic-card">
                      <p class="provider-step-title">{megaIssue.title}</p>
                      <p class="provider-step-detail">{megaIssue.summary}</p>
                      {#if megaIssue.detail.trim() !== ''}
                        <div class="button-row">
                          <button
                            type="button"
                            class="panel-btn subtle compact"
                            onclick={() => toggleMegaIssueLog(megaIssue.id)}
                          >
                            <span>{megaIssueLogExpanded[megaIssue.id] ? 'Hide logs' : 'View logs'}</span>
                          </button>
                        </div>
                        {#if megaIssueLogExpanded[megaIssue.id]}
                          <pre class="mega-log-view">{megaIssue.detail}</pre>
                        {/if}
                      {/if}
                      {#if megaIssue.facts.length > 0}
                        <div class="provider-fact-list">
                          {#each megaIssue.facts as fact}
                            <p class="provider-story-copy"><strong>{fact.label}:</strong> {fact.value}</p>
                          {/each}
                        </div>
                      {/if}
                    </div>
                  </div>
                </div>
              {/if}
            {/if}

            {#if provider.setup.status === 'installing' || (integrationBusyKey === `connect:${provider.provider}` && provider.setup.status === 'needs-install')}
              <div class="inline-progress" aria-label="Installing provider helper">
                <div class="inline-progress-bar"></div>
              </div>
            {/if}

            {#if !provider.isConnected && provider.provider === 'gdrive' && provider.setup.status === 'needs-config'}
                {@const draft = providerSetupDraft(provider.provider)}
                <div class="provider-story-card compact-provider-card">
                  <label class="field-block compact-field">
                    <span>Client ID</span>
                    <input
                      class="panel-input"
                      type="text"
                      value={draft.clientId}
                      placeholder="Google Desktop app client id"
                      oninput={(event) => setProviderSetupField(provider.provider, 'clientId', (event.currentTarget as HTMLInputElement).value)}
                    />
                  </label>
                </div>
            {/if}

            {#if !provider.isConnected && provider.provider === 'github' && provider.setup.status === 'needs-config'}
                {@const draft = providerSetupDraft(provider.provider)}
                <div class="provider-story-card compact-provider-card">
                  <label class="field-block compact-field">
                    <span>Client ID</span>
                    <input
                      class="panel-input"
                      type="text"
                      value={draft.clientId}
                      placeholder="GitHub OAuth app client id"
                      oninput={(event) => setProviderSetupField(provider.provider, 'clientId', (event.currentTarget as HTMLInputElement).value)}
                    />
                  </label>
                </div>
            {/if}

            {#if !provider.isConnected && provider.provider === 'mega'}
                {@const draft = providerCredentialDraft(provider.provider)}
                {@const pendingSession = pendingSessionForProvider(provider.provider)}
                <form class="provider-story-card mega-onboarding-card" onsubmit={(event) => {
                  event.preventDefault();
                  void submitMegaAction(provider);
                }}>
                  <div class="mega-onboarding-head">
                    <h4>MEGA account</h4>
                    <p class="muted-copy compact-mode-copy">{pendingSession ? 'Email confirmation' : 'Sign in'}</p>
                  </div>

                  <div class="provider-credentials">
                    {#if pendingSession}
                      <label class="field-block compact-field">
                        <span>Confirmation link</span>
                        <input
                          class="panel-input"
                          type="url"
                          value={draft.confirmationLink}
                          placeholder="https://mega.nz/confirm#..."
                          oninput={(event) => setProviderCredential(provider.provider, 'confirmationLink', (event.currentTarget as HTMLInputElement).value)}
                        />
                      </label>
                    {:else}
                      <label class="field-block compact-field">
                        <span>Email</span>
                        <input
                          class="panel-input"
                          type="email"
                          value={draft.email}
                          placeholder="name@example.com"
                          oninput={(event) => setProviderCredential(provider.provider, 'email', (event.currentTarget as HTMLInputElement).value)}
                        />
                      </label>
                      <label class="field-block compact-field">
                        <span>Password</span>
                        <input
                          class="panel-input"
                          type="password"
                          value={draft.password}
                          placeholder="MEGA password"
                          oninput={(event) => setProviderCredential(provider.provider, 'password', (event.currentTarget as HTMLInputElement).value)}
                        />
                      </label>
                      <label class="field-block compact-field">
                        <span class="toggle-only-label">
                          <input
                            type="checkbox"
                            checked={draft.useMfa}
                            onchange={(event) => setProviderCredential(provider.provider, 'useMfa', (event.currentTarget as HTMLInputElement).checked)}
                          />
                          <span>I enabled 2-factor authentication on MEGA</span>
                        </span>
                      </label>
                      {#if draft.useMfa}
                        <label class="field-block compact-field">
                          <span>2FA code</span>
                          <input
                            class="panel-input"
                            type="text"
                            value={draft.mfaCode}
                            placeholder="6-digit code"
                            oninput={(event) => setProviderCredential(provider.provider, 'mfaCode', (event.currentTarget as HTMLInputElement).value)}
                          />
                        </label>
                      {/if}
                    {/if}
                  </div>

                  <div class="mega-onboarding-actions">
                    {#if providerFlowState(provider.provider)?.canCancel}
                      <button
                        type="button"
                        class="panel-btn subtle compact"
                        onclick={() => cancelProviderFlow(provider.provider)}
                      >
                        <span>Cancel</span>
                      </button>
                    {/if}
                    {#if pendingSession}
                      <button
                        type="button"
                        class="panel-btn subtle compact"
                        onclick={() => clearProviderSession(provider.provider)}
                        disabled={integrationBusyKey === `confirm:${provider.provider}`}
                      >
                        <span>Start again</span>
                      </button>
                    {:else if canResetProviderFlow(provider.provider)}
                      <button
                        type="button"
                        class="panel-btn subtle compact"
                        onclick={() => resetProviderFlow(provider.provider)}
                        disabled={providerFlowState(provider.provider)?.canCancel === true}
                      >
                        <span>Reset</span>
                      </button>
                    {/if}
                    <button
                      type="submit"
                      class="panel-btn primary"
                      disabled={
                        !canSubmitMegaAction(provider.provider) ||
                        integrationBusyKey === `connect:${provider.provider}` ||
                        integrationBusyKey === `confirm:${provider.provider}` ||
                        provider.setup.status === 'needs-config' ||
                        provider.setup.status === 'unsupported'
                      }
                    >
                      <span>{megaPrimaryActionLabel(provider.provider)}</span>
                    </button>
                  </div>
                </form>
            {/if}

            {#if provider.isConnected && provider.provider === 'github'}
                {@const draft = providerShareDraft(provider.provider)}
                <div class="provider-credentials">
                  <label class="field-block compact-field">
                    <span>Owner</span>
                    <input
                      class="panel-input"
                      type="text"
                      value={draft.repoOwner}
                      placeholder="nearbytes"
                      oninput={(event) => setProviderShareField(provider.provider, 'repoOwner', (event.currentTarget as HTMLInputElement).value)}
                    />
                  </label>
                  <label class="field-block compact-field">
                    <span>Repo</span>
                    <input
                      class="panel-input"
                      type="text"
                      value={draft.repoName}
                      placeholder="nearbytes-sync"
                      oninput={(event) => setProviderShareField(provider.provider, 'repoName', (event.currentTarget as HTMLInputElement).value)}
                    />
                  </label>
                  <label class="field-block compact-field">
                    <span>Branch</span>
                    <input
                      class="panel-input"
                      type="text"
                      value={draft.branch}
                      placeholder="main"
                      oninput={(event) => setProviderShareField(provider.provider, 'branch', (event.currentTarget as HTMLInputElement).value)}
                    />
                  </label>
                  <label class="field-block">
                    <span>nearbytes path</span>
                    <input
                      class="panel-input"
                      type="text"
                      value={draft.basePath}
                      placeholder={defaultGithubBasePath(githubShareLabel())}
                      oninput={(event) => setProviderShareField(provider.provider, 'basePath', (event.currentTarget as HTMLInputElement).value)}
                    />
                  </label>
                </div>
            {/if}

            {#if providerFlowState(provider.provider)}
              <div class="provider-flow-status" data-phase={providerFlowState(provider.provider)?.phase}>
                <p class="provider-flow-title">{providerFlowState(provider.provider)?.title}</p>
                <p class="muted-copy">{providerFlowState(provider.provider)?.detail}</p>
              </div>
            {/if}

            <div class="section-stack" bind:this={megaPublishingSection}>
              <div class="compact-share-grid" class:mega-share-grid={provider.provider === 'mega'}>
                {#if ownedShares.length === 0}
                  <div class="compact-share-item">
                    <ShareCard
                      title="No locations from this account yet"
                      copy={providerEmptyShareCopy(provider)}
                      statusBadges={[]}
                      meta={[]}
                    />
                  </div>
                {:else}
                  {#each ownedShares as summary (summary.share.id)}
                    {@render managedShareCard(summary)}
                  {/each}
                {/if}
              </div>
            </div>

            {#if receivedShares.length > 0 || hasIncomingReviewState}
              <div class="section-stack section-stack-secondary" bind:this={megaIncomingSection}>
                <div class="section-copy-stack">
                  <p class="subheading">{provider.provider === 'mega' ? 'Incoming locations' : 'Shared with you'}</p>
                  <p class="managed-share-invite-copy">Locations someone else shared into this account stay separate from the ones you manage yourself.</p>
                </div>

                {#if receivedShares.length > 0}
                  <div class="compact-share-grid" class:mega-share-grid={provider.provider === 'mega'}>
                    {#each receivedShares as summary (summary.share.id)}
                      {@render managedShareCard(summary)}
                    {/each}
                  </div>
                {/if}

                {#if hasIncomingReviewState}
                  {@render incomingFromOthersSection(provider.provider, receivedShares.length > 0 ? 'Still to review' : provider.provider === 'mega' ? 'Incoming locations' : 'Shared with you')}
                {/if}
              </div>
            {/if}
            {/if}
          </section>
        {/if}
      {/if}
    {:else}
      {#if dismissedSuggestionCount() > 0}
        <div class="toolbar-row">
          <button type="button" class="panel-btn subtle compact" onclick={restoreDismissedSuggestions}>
            <span>Restore hidden suggestions</span>
          </button>
        </div>
      {/if}

      {#if errorMessage}
        <StatusNotice tone="error" role="alert" compact={true} message={errorMessage} />
      {/if}
      {#if successMessage}
        <StatusNotice tone="success" compact={true} message={successMessage} />
      {/if}

      {#if !volumeId}
        <p class="storage-message">Open something first, then choose the places that should keep everything.</p>
      {:else}
        {#if discoveryError}
          <StatusNotice tone="warning" compact={true} message={discoveryError} />
        {/if}

        <section class="panel-section">
          <div class="section-head">
            <div>
              {#if knownVolumeLabel(volumeId)}<p class="subheading">{knownVolumeLabel(volumeId)}</p>{/if}
              <h3>Storage locations</h3>
            </div>
            <div class="section-actions">
              <button type="button" class="panel-btn subtle compact" onclick={() => openHubLocationDialog(volumeId)}>
                <Plus size={14} strokeWidth={2} />
                <span>Add another location</span>
              </button>
              {#if hasMeaningfulExplicitVolumePolicy(volumeId)}
                <ArmedActionButton
                  class="panel-btn subtle compact danger"
                  icon={Trash2}
                  text="Use default storage locations again"
                  armed={true}
                  autoDisarmMs={3000}
                  onPress={() => removeVolumePolicy(volumeId)}
                />
              {/if}
            </div>
          </div>

          <div class="rule-grid">
            {#if hubAttachedSources(volumeId).length === 0}
              <article class="rule-card">
                <p class="card-copy">This hub is not using any storage locations yet. Add one of your saved locations here, or open storage setup if you need to create another first.</p>
                <div class="button-row inline-dialog-actions">
                  <button type="button" class="panel-btn subtle compact" onclick={() => openHubLocationDialog(volumeId)}>
                    <Plus size={14} strokeWidth={2} />
                    <span>Choose a saved location</span>
                  </button>
                  <button type="button" class="panel-btn subtle compact" onclick={openStorageSetupFromHubDialog}>
                    <Link2 size={14} strokeWidth={2} />
                    <span>Open storage setup</span>
                  </button>
                </div>
              </article>
            {/if}

            {#each hubAttachedSources(volumeId) as source (source.id)}
              {@const destination = destinationFor(volumeId, source.id)}
              {@const mode = hubLocationMode(volumeId, source.id)}
              {@const status = sourceStatus(source.id)}
              <article class="rule-card" class:active={mode !== 'off'}>
                <div class="card-head">
                  <div class="card-title">
                    <div>
                      <p class="provider-label">{sourceLocationKindLabel(source.provider)}</p>
                      {#if hasSourcePath(source)}
                        <button
                          type="button"
                          class="storage-title-link"
                          onclick={() => openSourceFolder(source.id, source.path)}
                          title={source.path}
                        >
                          <span class="storage-title-link-text">{sourceLocationTitle(source.path)}</span>
                        </button>
                        <p class="card-path">{sourceLocationPath(source.path)}</p>
                      {:else}
                        <h4>{sourceLocationTitle(source.path)}</h4>
                      {/if}
                    </div>
                  </div>
                </div>

                <p class="managed-share-invite-copy">{hubLocationNote(volumeId, source) ?? 'This location keeps a best-effort full copy for this hub.'}</p>

                {#if !source.enabled}
                  <div class="button-row inline-dialog-actions">
                    <button type="button" class="panel-btn subtle compact" onclick={() => updateSourceField(source.id, 'enabled', true)}>
                      <span>Turn location back on</span>
                    </button>
                    {#if onOpenStorageSetup}
                      <button type="button" class="panel-btn subtle compact" onclick={openStorageSetupFromHubDialog}>
                        <span>Open storage setup</span>
                      </button>
                    {/if}
                  </div>
                {/if}

                <div class="fact-row">
                  {#if storageMeasurementSummary(status?.usage.totalBytes, status?.availableBytes)}
                    <span>{storageMeasurementSummary(status?.usage.totalBytes, status?.availableBytes)}</span>
                  {/if}
                  <div class="inline-reserve-slot">
                    {#if activeReserveEditorKey === `hub:${volumeId}:${source.id}`}
                      <label class="inline-reserve-editor" title="Minimum available storage to leave on this drive.">
                        <span>Free-space buffer</span>
                        <select
                          class="panel-input inline-reserve-select"
                          value={String(Number.isFinite(destination?.reservePercent) ? destination!.reservePercent : DEFAULT_RESERVE_PERCENT)}
                          onchange={(event) => {
                            updateDestinationField(volumeId, source.id, 'reservePercent', clampReserve((event.currentTarget as HTMLSelectElement).value));
                            closeReserveEditor(`hub:${volumeId}:${source.id}`);
                          }}
                          onblur={() => closeReserveEditor(`hub:${volumeId}:${source.id}`)}
                        >
                          {#each RESERVE_OPTIONS as option}
                            <option value={option}>{formatPercent(option)}</option>
                          {/each}
                        </select>
                      </label>
                    {:else}
                      <button type="button" class="inline-reserve-button" onclick={() => toggleReserveEditor(`hub:${volumeId}:${source.id}`)} title="Change free-space buffer">
                        <SquarePen size={13} strokeWidth={2} />
                        <span>Reserve {formatPercent(Number.isFinite(destination?.reservePercent) ? destination!.reservePercent : DEFAULT_RESERVE_PERCENT)} free</span>
                      </button>
                    {/if}
                  </div>
                </div>

                <div class="storage-card-actions">
                  <div class="button-row storage-card-actions-left">
                    <ArmedActionButton
                      class="panel-btn subtle compact icon-btn armed-icon-danger"
                      icon={Trash2}
                      text=""
                      armed={true}
                      autoDisarmMs={3000}
                      title="Stop using this location here"
                      ariaLabel="Stop using this location here"
                      onPress={() => setHubLocationMode(volumeId, source.id, 'off')}
                    />
                    <button
                      type="button"
                      class="panel-btn subtle compact"
                      onclick={() => void (hasSourcePath(source) ? moveSourceFolder(source.id) : chooseSourceFolder(source.id))}
                      disabled={movingSourceId === source.id || Boolean(source.moveFromSourceId) || hasPendingMove(source.id)}
                      title={hasSourcePath(source) ? 'Move this storage location without interrupting service' : 'Choose folder'}
                    >
                      <ArrowRightLeft size={14} strokeWidth={2} />
                      <span>{movingSourceId === source.id ? 'Moving...' : hasSourcePath(source) ? 'Move' : 'Choose folder'}</span>
                    </button>
                  </div>

                  <div class="button-row storage-card-actions-right">
                    <button type="button" class="panel-btn subtle compact" onclick={() => openSourceFolder(source.id, source.path)} disabled={!hasSourcePath(source)}>
                      <FolderOpen size={14} strokeWidth={2} />
                      <span>Open</span>
                    </button>
                  </div>
                </div>
              </article>
            {/each}
          </div>
        </section>

        {#each providerCatalog.filter((entry) => entry.isConnected && providerShowsIncomingShareSection(entry.provider) && (incomingProviderInvitesForProvider(entry.provider).length > 0 || incomingManagedSharesForProvider(entry.provider).length > 0)) as incomingProvider (incomingProvider.provider)}
          <section class="panel-section provider-incoming-hub-wrap">
            {@render incomingFromOthersSection(incomingProvider.provider, 'Incoming items')}
          </section>
        {/each}

        {#if hubLocationDialogVolumeId === volumeId}
          {@const availableSources = hubAvailableSources(volumeId)}
          <AppDialog
            ariaLabel="Add storage location"
            eyebrow="Storage"
            title="Add another location"
            width="wide"
            onClose={closeHubLocationDialog}
          >
            {#snippet body()}
              {#if availableSources.length > 0}
                <div class="rule-grid dialog-rule-grid">
                  {#each availableSources as source (source.id)}
                    {@const status = sourceStatus(source.id)}
                    <article class="rule-card active">
                      <div class="card-head">
                        <div class="card-title">
                          <div>
                            <p class="provider-label">{sourceLocationKindLabel(source.provider)}</p>
                            <h4>{sourceDisplayTitle(source)}</h4>
                            <p class="card-path">{sourceLocationPath(source.path)}</p>
                          </div>
                        </div>
                      </div>

                      <div class="fact-row">
                        {#if storageMeasurementSummary(status?.usage.totalBytes, status?.availableBytes)}
                          <span>{storageMeasurementSummary(status?.usage.totalBytes, status?.availableBytes)}</span>
                        {/if}
                      </div>

                      <div class="button-row inline-dialog-actions">
                        <button type="button" class="panel-btn subtle compact" onclick={() => addSourceToHub(volumeId, source.id)}>
                          <Plus size={14} strokeWidth={2} />
                          <span>Add to this hub</span>
                        </button>
                      </div>
                    </article>
                  {/each}
                </div>
              {:else}
                <article class="rule-card active">
                  <p class="card-copy">You do not have any saved storage locations left to add here.</p>
                </article>
              {/if}
            {/snippet}
          </AppDialog>
        {/if}

      {/if}
    {/if}

    {#if providerConnectionDialog}
      {@const dialogProvider = providerCatalog.find((entry) => entry.provider === providerConnectionDialog) ?? null}
      {@const dialogDisconnectImpact = dialogProvider ? providerDisconnectImpact(dialogProvider.provider) : { shares: 0, spaces: 0, inaccessibleSpaces: [] }}
      {@const dialogAccount = dialogProvider ? connectedAccountForProvider(dialogProvider.provider) : null}
      {#if dialogProvider}
        {@const dialogMegaReconnectIssue = dialogProvider.provider === 'mega' ? megaProviderReconnectIssue() : null}
        <AppDialog
          ariaLabel={`${dialogProvider.label} connection`}
          eyebrow={dialogProvider.label}
          title="Connection details"
          width="wide"
          onClose={closeProviderConnectionDialog}
        >
          {#snippet body()}
            <div class="provider-dialog-grid">
              <div class="provider-path-card">
                <p class="subheading">Account</p>
                <p class="provider-path-copy">{dialogAccount?.email ?? dialogAccount?.label ?? 'No account connected'}</p>
              </div>

              <div class="provider-path-card">
                <p class="subheading">Mirror settings</p>
                <div class="provider-fact-list">
                  {#each providerTransparencyFacts(dialogProvider) as fact}
                    <p class="provider-story-copy">{fact}</p>
                  {/each}
                </div>
              </div>
            </div>

            {#if providerMirrorPathEntries(dialogProvider).length > 0}
              <div class="provider-dialog-path-list">
                {#each providerMirrorPathEntries(dialogProvider) as mirrorEntry}
                  <div class="provider-path-card">
                    <p class="subheading">{mirrorEntry.heading}</p>
                    <p class="provider-step-title">{mirrorEntry.title}</p>
                    <p class="provider-path-copy">{mirrorEntry.path}</p>
                  </div>
                {/each}
              </div>
            {/if}

            {#if dialogMegaReconnectIssue}
              <StatusNotice
                tone="error"
                role="alert"
                compact={true}
                message="Nearbytes cannot discover incoming MEGA shares until this MEGA account is recovered. If MEGA locked it, finish the unlock and password-change flow on mega.io first. Nearbytes will retry the saved sign-in automatically; reconnect here only if the credentials changed."
              />
            {/if}

            {#if dialogProvider.isConnected && providerDisconnectArmed[dialogProvider.provider] && dialogDisconnectImpact.spaces > 0}
              <StatusNotice
                tone="error"
                role="alert"
                compact={true}
                message={dialogDisconnectImpact.inaccessibleSpaces.length > 0
                  ? `Disconnecting ${dialogProvider.label} will make ${countLabel(dialogDisconnectImpact.inaccessibleSpaces.length, 'hub')} not accessible until you reconnect it.`
                  : `Disconnecting ${dialogProvider.label} will remove ${countLabel(dialogDisconnectImpact.shares, 'location')} from ${countLabel(dialogDisconnectImpact.spaces, 'hub')}, but those hubs will stay accessible.`}
              />
            {/if}

            {#if dialogProvider.isConnected && providerDisconnectArmed[dialogProvider.provider] && dialogDisconnectImpact.inaccessibleSpaces.some((targetVolumeId) => knownVolumeLabel(targetVolumeId))}
              <div class="fact-row share-volume-row">
                {#each dialogDisconnectImpact.inaccessibleSpaces as targetVolumeId}
                  {@const label = knownVolumeLabel(targetVolumeId)}
                  {#if label}
                    <button
                      type="button"
                      class="mini-pill mini-pill-button"
                      onclick={() => onOpenVolumeRouting?.(targetVolumeId)}
                    >
                      {label}
                    </button>
                  {/if}
                {/each}
              </div>
            {/if}

            <div class="button-row provider-dialog-actions">
              {#if dialogProvider.isConnected}
                <button
                  type="button"
                  class={`panel-btn subtle compact ${providerDisconnectArmed[dialogProvider.provider] ? 'danger' : ''}`}
                  onclick={async () => {
                    if (providerDisconnectArmed[dialogProvider.provider]) {
                      await disconnectProvider(dialogProvider);
                      closeProviderConnectionDialog();
                      return;
                    }
                    setProviderDisconnectArmed(dialogProvider.provider, true);
                  }}
                  disabled={integrationBusyKey === `disconnect:${dialogProvider.provider}`}
                >
                  {integrationBusyKey === `disconnect:${dialogProvider.provider}`
                    ? 'Disconnecting...'
                    : providerDisconnectArmed[dialogProvider.provider]
                      ? 'Confirm disconnect'
                      : 'Disconnect'}
                </button>
              {:else}
                <button
                  type="button"
                  class="panel-btn primary compact"
                  onclick={() => void connectProvider(dialogProvider)}
                  disabled={
                    integrationBusyKey === `connect:${dialogProvider.provider}` ||
                    dialogProvider.setup.status === 'needs-config' ||
                    dialogProvider.setup.status === 'unsupported'
                  }
                >
                  <span>
                    {integrationBusyKey === `connect:${dialogProvider.provider}`
                      ? dialogProvider.setup.status === 'needs-install'
                        ? 'Installing...'
                        : 'Connecting...'
                      : 'Connect'}
                  </span>
                </button>
              {/if}
            </div>
          {/snippet}
        </AppDialog>
      {/if}
    {/if}
  </section>
{/if}

<style>
  .storage-panel {
    --panel-border: var(--nb-border, rgba(0, 0, 0, 0.10));
    --panel-soft-border: color-mix(in srgb, var(--nb-border, rgba(0, 0, 0, 0.10)) 70%, transparent);
    --panel-bg: var(--nb-panel-bg, #ffffff);
    --card-bg: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 96%, rgba(245, 245, 247, 0.9));
    --card-bg-strong: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 92%, rgba(240, 240, 245, 0.94));
    --text-main: var(--nb-text-main, rgba(0, 0, 0, 0.88));
    --text-soft: var(--nb-text-soft, rgba(60, 60, 67, 0.6));
    --text-faint: var(--nb-text-faint, rgba(60, 60, 67, 0.36));
    --teal: color-mix(in srgb, var(--nb-accent-strong, #5d524a) 52%, var(--nb-text-main, rgba(0, 0, 0, 0.88)));
    --warn: color-mix(in srgb, var(--nb-warning, #FF9500) 78%, var(--nb-text-main, rgba(0, 0, 0, 0.88)));
    --danger: color-mix(in srgb, var(--nb-danger, #FF3B30) 82%, var(--nb-text-main, rgba(0, 0, 0, 0.88)));
    display: grid;
    gap: 1.25rem;
    width: 100%;
    min-height: 0;
    padding: 1.5rem;
    overflow: auto;
    border: 1px solid var(--panel-border);
    border-radius: 16px;
    background: var(--panel-bg);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
  }

  .section-head,
  .card-head,
  .card-status,
  .toolbar-row,
  .button-row,
  .section-metrics,
  .scan-badges,
  .scan-group-head,
  .fact-row,
  .usage-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    align-items: center;
  }

  .section-head,
  .card-head,
  .scan-group-head {
    justify-content: space-between;
  }

  .toolbar-row {
    margin-bottom: 0.25rem;
  }

  .storage-shell-intro,
  .storage-shell-copy,
  .section-stack,
  .section-copy-stack,
  .provider-overview-grid,
  .setup-guidance-grid,
  .hub-mode-panel,
  .hub-mode-summary,
  .mega-inline-status-grid {
    display: grid;
  }

  .storage-shell-intro {
    gap: 1.1rem;
    padding: 0.25rem 0 0.35rem;
  }

  .storage-shell-intro-volume {
    padding-top: 0;
  }

  .storage-shell-copy {
    gap: 0.5rem;
    max-width: 68ch;
  }

  .storage-shell-title,
  .storage-shell-note,
  .provider-choice-copy,
  .provider-choice-detail,
  .provider-overview-value {
    margin: 0;
  }

  .storage-shell-title {
    color: var(--text-main);
    font-size: 1.25rem;
    line-height: 1.3;
    font-weight: 600;
    letter-spacing: -0.01em;
  }

  .storage-shell-note {
    color: var(--text-soft);
    font-size: 0.85rem;
    line-height: 1.55;
  }

  .storage-shell-facts {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
  }

  .provider-choice-grid {
    display: grid;
    gap: 1rem;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  }

  .provider-choice-card {
    display: grid;
    gap: 0.5rem;
    padding: 1.1rem;
    border-radius: 12px;
    border: 1px solid var(--panel-soft-border);
    background: var(--card-bg);
    box-shadow:
      0 1px 3px rgba(0, 0, 0, 0.04),
      0 1px 2px rgba(0, 0, 0, 0.02);
    text-align: left;
    font: inherit;
    cursor: pointer;
    transition: border-color 120ms ease, background 120ms ease, box-shadow 120ms ease, transform 120ms ease;
  }

  .provider-choice-card:hover:not(:disabled) {
    transform: translateY(-1px);
    border-color: color-mix(in srgb, var(--nb-accent, #7c6f64) 16%, var(--nb-border, rgba(60, 60, 67, 0.12)));
    background: color-mix(in srgb, var(--card-bg) 96%, rgba(245, 243, 240, 0.94));
    box-shadow:
      0 4px 12px rgba(0, 0, 0, 0.06),
      0 1px 3px rgba(0, 0, 0, 0.03);
  }

  .provider-choice-card.active {
    border-color: color-mix(in srgb, var(--nb-accent, #7c6f64) 20%, var(--nb-border, rgba(60, 60, 67, 0.12)));
    background: color-mix(in srgb, var(--card-bg-strong) 96%, rgba(245, 243, 240, 0.94));
    box-shadow:
      0 1px 3px rgba(0, 0, 0, 0.04),
      0 1px 2px rgba(0, 0, 0, 0.02);
  }

  .provider-choice-card:disabled {
    opacity: 0.62;
    cursor: default;
    transform: none;
  }

  .provider-choice-eyebrow {
    color: var(--text-soft);
    font-size: 0.68rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .provider-choice-head {
    display: flex;
    gap: 0.55rem;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
  }

  .provider-choice-title {
    color: var(--text-main);
    font-size: 0.95rem;
    line-height: 1.35;
    font-weight: 600;
  }

  .provider-choice-copy {
    color: var(--text-main);
    font-size: 0.82rem;
    line-height: 1.4;
    font-weight: 600;
  }

  .provider-choice-detail {
    color: var(--text-soft);
    font-size: 0.8rem;
    line-height: 1.5;
  }

  .section-stack {
    gap: 1rem;
  }

  .section-stack-secondary {
    padding-top: 0.5rem;
    border-top: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 75%, transparent);
  }

  .section-copy-stack {
    gap: 0.35rem;
  }

  .provider-overview-grid,
  .setup-guidance-grid,
  .mega-inline-status-grid {
    gap: 1rem;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  }

  .setup-guidance-card {
    gap: 0.28rem;
    padding: 0.78rem 0.82rem;
    border-radius: 14px;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 88%, rgba(0, 0, 0, 0.03));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 96%, rgba(249, 244, 240, 0.88));
  }

  .provider-overview-value {
    color: var(--text-main);
    font-size: 0.96rem;
    line-height: 1.3;
    font-weight: 700;
  }

  .hub-mode-panel {
    gap: 0.62rem;
  }

  .provider-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 0.62rem;
    align-items: stretch;
  }

  .provider-tab {
    min-height: 60px;
    min-width: 160px;
    padding: 0.9rem 1rem;
    border-radius: 12px;
    border: 1px solid var(--panel-soft-border);
    background: var(--card-bg);
    color: var(--text-main);
    display: grid;
    align-content: center;
    gap: 0.16rem;
    text-align: left;
    font: inherit;
    cursor: pointer;
    transition: border-color 120ms ease, background 120ms ease, box-shadow 120ms ease;
  }

  .provider-tab:hover {
    border-color: color-mix(in srgb, var(--nb-accent, #7c6f64) 12%, rgba(60, 60, 67, 0.14));
    background: color-mix(in srgb, var(--card-bg) 96%, rgba(255, 252, 249, 0.92));
  }

  .provider-tab.active {
    border-color: color-mix(in srgb, var(--nb-accent, #7c6f64) 18%, rgba(60, 60, 67, 0.14));
    background: color-mix(in srgb, var(--card-bg-strong) 96%, rgba(255, 255, 255, 0.92));
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 72%, rgba(0, 0, 0, 0.03));
  }

  .provider-tab-label {
    font-size: 0.86rem;
    font-weight: 600;
    line-height: 1.25;
  }

  .provider-tab-heading {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.42rem;
  }

  .provider-tab-loading {
    display: inline-flex;
    align-items: center;
    gap: 0.32rem;
    min-height: 20px;
    padding: 0.08rem 0.5rem;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--nb-accent, #7c6f64) 18%, var(--nb-border, rgba(60, 60, 67, 0.12)));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 94%, rgba(248, 243, 239, 0.92));
    color: var(--text-soft);
    font-size: 0.67rem;
    font-weight: 700;
    line-height: 1.1;
    letter-spacing: 0.01em;
  }

  .provider-tab-spinner {
    width: 0.72rem;
    height: 0.72rem;
    border-radius: 999px;
    border: 2px solid color-mix(in srgb, var(--nb-accent, #7c6f64) 28%, transparent);
    border-top-color: color-mix(in srgb, var(--nb-accent, #7c6f64) 82%, var(--text-main));
    animation: provider-tab-spin 0.72s linear infinite;
  }

  .provider-tab-copy {
    color: var(--text-soft);
    font-size: 0.75rem;
    line-height: 1.2;
  }

  .provider-dialog-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(28, 28, 30, 0.18);
    z-index: 30;
  }

  .provider-dialog {
    position: fixed;
    top: 50%;
    left: 50%;
    z-index: 31;
    width: min(640px, calc(100vw - 2rem));
    max-height: min(78vh, 720px);
    overflow: auto;
    display: grid;
    gap: 1.1rem;
    padding: 1.5rem;
    border-radius: 16px;
    border: 1px solid var(--panel-soft-border);
    background: var(--panel-bg);
    box-shadow: 0 24px 60px rgba(93, 56, 34, 0.16);
    transform: translate(-50%, -50%);
  }

  .provider-dialog-head {
    margin-bottom: -0.08rem;
  }

  .provider-dialog-grid,
  .provider-dialog-path-list {
    display: grid;
    gap: 1rem;
  }

  .section-actions,
  .inline-dialog-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.55rem;
  }

  .dialog-rule-grid {
    margin-top: 0.15rem;
  }

  .provider-dialog-grid {
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  }

  .provider-dialog-actions {
    justify-content: flex-end;
  }

  .global-panel-head {
    gap: 0.9rem;
  }

  .global-panel-head-actions {
    justify-content: flex-end;
  }

  .compact-panel-actions {
    gap: 0.5rem;
    justify-content: flex-end;
  }

  .provider-create-inline {
    display: inline-grid;
    grid-template-columns: minmax(160px, 220px) auto auto;
    gap: 0.45rem;
    align-items: center;
    min-width: 0;
  }

  .provider-create-inline-input {
    min-width: 0;
    height: 30px;
    padding-block: 0.2rem;
  }

  .compact-provider-card {
    padding: 0.76rem 0.82rem;
  }

  .section-head > div:first-child,
  .scan-copy,
  .usage-main {
    display: grid;
    gap: 0.28rem;
  }

  .eyebrow,
  .section-step,
  .provider-label,
  .scan-group-title {
    margin: 0;
    font-size: 0.72rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    font-weight: 600;
    color: var(--text-soft);
  }

  h3,
  h4,
  .hero-text,
  .section-copy,
  .path-copy,
  .storage-message,
  .card-copy,
  .scan-note,
  .scan-path,
  .muted-copy,
  .warning-copy {
    margin: 0;
  }

  h3,
  h4 {
    color: var(--text-main);
  }

  h3 {
    font-size: 1rem;
    line-height: 1.4;
  }

  h4 {
    font-size: 0.95rem;
  }

  .storage-title-link {
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .storage-title-link:hover .storage-title-link-text {
    text-decoration: underline;
    text-decoration-color: color-mix(in srgb, var(--nb-accent, #7c6f64) 18%, transparent);
  }

  .storage-title-link-text {
    display: block;
    color: var(--text-main);
    font-size: 0.95rem;
    line-height: 1.3;
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  .card-path {
    margin: 0.3rem 0 0;
    color: var(--text-soft);
    font-size: 0.8rem;
    line-height: 1.4;
    word-break: break-word;
  }

  .hero-text,
  .section-copy,
  .path-copy,
  .storage-message,
  .card-copy,
  .scan-note,
  .scan-path,
  .muted-copy {
    color: var(--text-soft);
    font-size: 0.84rem;
    line-height: 1.5;
  }

  .warning-copy {
    color: var(--warn);
    font-size: 0.82rem;
    line-height: 1.4;
  }

  .panel-section,
  .location-card,
  .rule-card,
  .scan-card,
  .scan-group {
    display: grid;
    gap: 1rem;
    min-width: 0;
    border-radius: 12px;
    border: 1px solid var(--panel-soft-border);
    background: var(--card-bg);
  }

  .panel-section {
    padding: 1.1rem;
  }

  .location-card,
  .rule-card,
  .scan-card,
  .scan-group {
    padding: 1.1rem;
  }

  .card-grid,
  .rule-grid,
  .scan-card-list,
  .scan-group-list {
    display: grid;
    gap: 1rem;
  }

  .card-grid,
  .rule-grid {
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  }

  .location-card,
  .rule-card {
    background: var(--card-bg);
  }

  .location-card.active,
  .rule-card.active {
    border-color: color-mix(in srgb, var(--nb-accent, #7c6f64) 16%, var(--nb-border, rgba(60, 60, 67, 0.12)));
    background: color-mix(in srgb, var(--card-bg-strong) 95%, rgba(245, 243, 240, 0.92));
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
  }

  .card-title {
    display: flex;
    flex: 1 1 0;
    gap: 0.8rem;
    align-items: flex-start;
    min-width: 0;
  }

  .card-title > div,
  .card-head,
  .card-status,
  .usage-main,
  .field-block {
    min-width: 0;
  }

  .card-icon {
    width: 34px;
    height: 34px;
    border-radius: 12px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 88%, rgba(0, 0, 0, 0.03));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 94%, rgba(252, 244, 238, 0.9));
    color: var(--text-soft);
  }

  .summary-pill,
  .status-pill,
  .mini-pill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    align-self: flex-start;
    flex: 0 0 auto;
    min-height: 28px;
    max-width: 100%;
    padding: 0.22rem 1.08rem;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 88%, rgba(0, 0, 0, 0.03));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 95%, rgba(252, 244, 238, 0.9));
    color: var(--text-main);
    font-size: 0.7rem;
    font-weight: 600;
    line-height: 1.2;
    white-space: nowrap;
    box-sizing: border-box;
  }

  .status-pill.ready-badge {
    padding-inline: 1.22rem;
  }

  .mini-pill-button {
    cursor: pointer;
    transition:
      border-color 120ms ease,
      transform 120ms ease,
      background 120ms ease;
  }

  .mini-pill-button:hover {
    transform: translateY(-1px);
    border-color: var(--nb-btn-hover-border, color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 94%, var(--nb-accent, #7c6f64) 8%));
    background: var(--nb-btn-hover-bg, color-mix(in srgb, var(--nb-panel-bg, #ffffff) 92%, white 8%));
    color: var(--nb-btn-hover-color, rgba(28, 28, 30, 0.96));
  }

  .mini-pill-metric {
    margin-left: 0.42rem;
    color: var(--text-main);
    font-size: 0.68rem;
    font-weight: 700;
    opacity: 0.9;
  }

  .summary-pill.warning,
  .status-pill.tone-warn {
    border-color: color-mix(in srgb, var(--nb-warning, rgba(251, 191, 36, 0.28)) 62%, transparent);
    background: color-mix(in srgb, var(--nb-warning-surface, rgba(72, 53, 16, 0.46)) 92%, transparent);
    color: var(--warn);
  }

  .status-pill.tone-good,
  .status-pill.tone-durable {
    border-color: color-mix(in srgb, var(--nb-accent, #7c6f64) 16%, rgba(60, 60, 67, 0.12));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 96%, rgba(248, 243, 239, 0.92));
    color: var(--teal);
  }

  .status-pill.tone-danger {
    border-color: color-mix(in srgb, var(--nb-danger, #c86a6a) 26%, transparent);
    background: color-mix(in srgb, var(--nb-danger-surface, rgba(254, 202, 202, 0.12)) 84%, rgba(255, 248, 247, 0.96));
    color: var(--danger);
  }

  .status-pill.tone-muted,
  .status-pill.tone-replica,
  .status-pill.tone-off,
  .mini-pill {
    border-color: color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 88%, rgba(0, 0, 0, 0.03));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 95%, rgba(245, 243, 240, 0.88));
    color: var(--text-soft);
  }

  .panel-btn,
  :global(.panel-btn) {
    min-height: 36px;
    border-radius: 8px;
    border: 1px solid var(--nb-btn-border, color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 80%, transparent));
    background: var(--nb-btn-bg, color-mix(in srgb, var(--nb-panel-bg, #ffffff) 96%, var(--nb-shell-bottom, #f4f4f7)));
    color: var(--nb-btn-color, rgba(70, 70, 73, 0.94));
    padding: 0 0.82rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    font-size: 0.82rem;
    font-weight: 600;
    cursor: pointer;
    transition:
      border-color 120ms ease,
      transform 120ms ease,
      background 120ms ease;
  }

  .panel-btn:hover,
  :global(.panel-btn:hover) {
    transform: translateY(-1px);
    border-color: var(--nb-btn-hover-border, color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 94%, var(--nb-accent, #7c6f64) 8%));
    background: var(--nb-btn-hover-bg, color-mix(in srgb, var(--nb-panel-bg, #ffffff) 92%, white 8%));
    color: var(--nb-btn-hover-color, rgba(28, 28, 30, 0.96));
  }

  .panel-btn:disabled,
  :global(.panel-btn:disabled) {
    opacity: 0.55;
    cursor: default;
    transform: none;
  }

  .panel-btn.primary,
  :global(.panel-btn.primary) {
    background: var(--nb-btn-active-bg, color-mix(in srgb, var(--nb-panel-bg, #ffffff) 94%, rgba(248, 243, 239, 0.92)));
    border-color: var(--nb-btn-active-border, color-mix(in srgb, var(--nb-accent, #7c6f64) 14%, var(--nb-border, rgba(60, 60, 67, 0.12))));
    color: var(--nb-btn-active-color, rgba(28, 28, 30, 0.96));
    box-shadow: var(--nb-btn-active-shadow, 0 1px 2px rgba(0, 0, 0, 0.03));
  }

  .panel-btn.subtle,
  :global(.panel-btn.subtle) {
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 94%, rgba(245, 243, 240, 0.88));
  }

  .panel-btn.compact,
  :global(.panel-btn.compact) {
    min-height: 30px;
    padding: 0 0.66rem;
  }

  .panel-btn.icon-btn,
  :global(.panel-btn.icon-btn) {
    width: 30px;
    min-width: 30px;
    padding: 0;
  }

  .panel-btn.danger,
  :global(.panel-btn.danger) {
    border-color: var(--nb-btn-danger-border, color-mix(in srgb, var(--nb-danger, #c86a6a) 22%, transparent));
    color: var(--nb-btn-danger-color, rgba(166, 63, 63, 0.94));
  }

  .panel-btn.armed-icon-danger,
  :global(.panel-btn.armed-icon-danger) {
    color: var(--nb-btn-color, rgba(70, 70, 73, 0.94));
  }

  .panel-btn.armed-icon-danger.armed,
  :global(.panel-btn.armed-icon-danger.armed) {
    border-color: var(--nb-btn-danger-border, color-mix(in srgb, var(--nb-danger, #c86a6a) 22%, transparent));
    background: color-mix(in srgb, var(--nb-danger-surface, rgba(254, 202, 202, 0.12)) 84%, rgba(255, 248, 247, 0.96));
    color: var(--nb-btn-danger-color, rgba(166, 63, 63, 0.94));
  }

  .panel-error,
  .panel-success,
  .protection-banner {
    margin: 0;
    display: flex;
    gap: 0.6rem;
    align-items: flex-start;
    border-radius: 12px;
    padding: 0.72rem 0.84rem;
    font-size: 0.8rem;
    line-height: 1.4;
  }

  .panel-error {
    color: var(--danger);
    border: 1px solid color-mix(in srgb, var(--nb-danger, #c86a6a) 24%, transparent);
    background: color-mix(in srgb, var(--nb-danger-surface, rgba(254, 202, 202, 0.12)) 84%, rgba(255, 248, 247, 0.96));
  }

  .panel-success {
    color: var(--teal);
    border: 1px solid color-mix(in srgb, var(--nb-accent, #7c6f64) 18%, transparent);
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 94%, rgba(248, 243, 239, 0.92));
  }

  .protection-banner {
    color: var(--teal);
    border: 1px solid color-mix(in srgb, var(--nb-accent, #7c6f64) 16%, transparent);
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 94%, rgba(248, 243, 239, 0.9));
  }

  .protection-banner.warning {
    color: var(--warn);
    border-color: color-mix(in srgb, var(--nb-warning, #d4945f) 24%, transparent);
    background: color-mix(in srgb, var(--nb-warning-surface, rgba(253, 230, 138, 0.12)) 82%, rgba(255, 250, 245, 0.96));
  }

  .mega-toast-region {
    display: grid;
    gap: 0.7rem;
  }

  .mega-toast {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 0.8rem;
    align-items: center;
    padding: 0.82rem 0.9rem;
    border-radius: 16px;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 84%, rgba(0, 0, 0, 0.03));
    background:
      linear-gradient(180deg, color-mix(in srgb, var(--nb-panel-bg, #ffffff) 97%, rgba(250, 246, 243, 0.94)), color-mix(in srgb, var(--nb-panel-bg, #ffffff) 94%, rgba(248, 240, 234, 0.92))),
      radial-gradient(circle at top right, color-mix(in srgb, var(--nb-accent, #7c6f64) 10%, transparent), transparent 62%);
  }

  .mega-toast[data-tone='warn'] {
    border-color: color-mix(in srgb, var(--nb-warning, #d4945f) 32%, var(--nb-border, rgba(60, 60, 67, 0.12)));
    background:
      linear-gradient(180deg, color-mix(in srgb, rgba(255, 250, 245, 0.98) 92%, rgba(253, 230, 138, 0.12)), color-mix(in srgb, rgba(255, 248, 242, 0.96) 90%, rgba(253, 230, 138, 0.16))),
      radial-gradient(circle at top right, color-mix(in srgb, var(--nb-warning, #d4945f) 10%, transparent), transparent 58%);
  }

  .mega-toast-copy {
    display: grid;
    gap: 0.22rem;
    min-width: 0;
  }

  .mega-toast-title {
    margin: 0;
    color: var(--text-main);
    font-size: 0.92rem;
    line-height: 1.3;
    font-weight: 650;
  }

  .mega-toast-actions {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .toggle-list,
  .usage-list,
  .danger-block {
    display: grid;
    gap: 0.68rem;
  }

  .setting-list {
    display: grid;
    gap: 0.42rem;
  }

  .compact-toggle-row {
    display: flex;
    gap: 0.4rem;
    justify-content: flex-start;
  }

  .setting-list-preface {
    margin: 0 0 0.25rem;
    font-size: 0.78rem;
    line-height: 1.35;
  }

  .provider-incoming-section {
    display: grid;
    gap: 0.65rem;
    margin-top: 0.75rem;
    padding-top: 0.65rem;
    border-top: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 75%, transparent);
  }

  .provider-incoming-hub-wrap .provider-incoming-section {
    margin-top: 0;
    padding-top: 0;
    border-top: none;
  }

  .setting-row {
    min-height: 36px;
    padding: 0.48rem 0.06rem;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 0.75rem;
    align-items: center;
    color: var(--text-main);
    font-size: 0.79rem;
    font-weight: 600;
  }

  .card-control-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.65rem;
    align-items: center;
  }

  .card-control-row {
    justify-content: space-between;
    align-items: end;
  }

  .compact-field {
    min-width: 112px;
    max-width: 148px;
  }

  .fact-row,
  .usage-meta,
  .subheading {
    color: var(--text-soft);
    font-size: 0.77rem;
    line-height: 1.35;
  }

  .fact-row {
    gap: 0.5rem 1rem;
  }

  .share-volume-row {
    margin-top: 0.48rem;
    justify-content: flex-start;
    align-items: flex-start;
    gap: 0.45rem;
  }

  .card-inline-warning {
    display: flex;
    flex-wrap: wrap;
    gap: 0.55rem;
    align-items: center;
    justify-content: space-between;
  }

  .fact-row span {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .inline-reserve-slot {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
  }

  .inline-reserve-button {
    display: inline-flex;
    align-items: center;
    gap: 0.38rem;
    justify-content: center;
    min-height: 30px;
    padding: 0.28rem 0.78rem;
    border-radius: 999px;
    border: 1px solid var(--nb-border, rgba(60, 60, 67, 0.12));
    background: var(--nb-panel-bg, #ffffff);
    color: var(--nb-accent-strong, #5d524a);
    font: inherit;
    font-size: 0.75rem;
    font-weight: 600;
    white-space: nowrap;
    cursor: pointer;
    transition:
      border-color 120ms ease,
      background-color 120ms ease,
      box-shadow 120ms ease,
      transform 120ms ease;
  }

  .inline-reserve-button:hover {
    border-color: color-mix(in srgb, var(--nb-accent, #7c6f64) 24%, var(--nb-border, rgba(60, 60, 67, 0.12)));
    background: color-mix(in srgb, var(--nb-accent, #7c6f64) 4%, var(--nb-panel-bg, #ffffff));
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.06);
    transform: translateY(-1px);
  }

  .meta-reserve-btn {
    all: unset;
    cursor: pointer;
    color: var(--text-soft);
    font-size: 0.75rem;
    opacity: 0.85;
    text-decoration: underline;
    text-decoration-style: dotted;
    text-underline-offset: 2px;
  }
  .meta-reserve-btn:hover {
    opacity: 1;
    color: var(--accent);
  }

  .inline-reserve-editor {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    color: var(--text-soft);
    font-size: 0.75rem;
    white-space: nowrap;
  }

  .inline-reserve-select {
    min-width: 86px;
    height: 30px;
    padding-block: 0.15rem;
    padding-inline: 0.55rem 1.7rem;
    border-radius: 999px;
  }

  .subheading {
    margin: 0;
    color: var(--text-main);
    font-weight: 600;
  }

  .field-grid {
    display: grid;
    gap: 0.65rem;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  }

  .storage-card-actions {
    width: 100%;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: start;
    gap: 0.75rem;
  }

  .storage-card-actions-left {
    flex: 1 1 auto;
    min-width: 0;
    flex-wrap: wrap;
  }

  .storage-card-actions-right {
    min-width: 0;
    align-items: center;
  }

  .storage-card-actions-right {
    gap: 0.5rem;
    justify-content: flex-end;
    margin-left: 0;
  }

  .storage-card-actions-left,
  .storage-card-actions-right {
    width: 100%;
  }

  .storage-card-actions .button-row > :global(*),
  .storage-card-actions .button-row > * {
    min-width: 0;
  }

  .compact-visible-fields {
    margin-top: -0.05rem;
  }

  .managed-share-invite-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(140px, 180px) auto;
    gap: 0.65rem;
    align-items: end;
  }

  .managed-share-invite-field {
    min-width: 0;
  }

  .managed-share-invite-access {
    min-width: 0;
  }

  .managed-share-invite-copy {
    margin: -0.15rem 0 0;
    color: var(--text-soft);
    font-size: 0.75rem;
    line-height: 1.35;
  }

  .flow-note-card {
    display: grid;
    gap: 0.35rem;
    padding: 0.76rem 0.82rem;
    border-radius: 14px;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 88%, rgba(0, 0, 0, 0.03));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 95%, rgba(245, 243, 240, 0.88));
  }

  .onboarding-note-card {
    gap: 0.65rem;
    border-color: color-mix(in srgb, var(--nb-accent, #7c6f64) 16%, var(--nb-border, rgba(60, 60, 67, 0.12)));
    background:
      linear-gradient(180deg, color-mix(in srgb, var(--card-bg-strong) 94%, rgba(255, 250, 246, 0.96)), color-mix(in srgb, var(--card-bg) 98%, rgba(249, 244, 240, 0.88))),
      radial-gradient(circle at top left, color-mix(in srgb, var(--nb-accent, #7c6f64) 10%, transparent), transparent 58%);
  }

  .section-head.compact {
    gap: 0.8rem;
  }

  .volume-share-link-card {
    margin-bottom: 0.8rem;
  }

  .managed-share-members {
    display: grid;
    gap: 0.42rem;
  }

  .managed-share-members-inline {
    gap: 0.34rem;
  }

  .managed-share-members-list {
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
  }

  .managed-share-invite-row-compact {
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: end;
  }

  @media (max-width: 720px) {
    .managed-share-invite-row {
      grid-template-columns: 1fr;
    }
  }

  .provider-credentials {
    display: grid;
    gap: 0.62rem;
    grid-template-columns: repeat(auto-fit, minmax(168px, 1fr));
  }

  .mega-onboarding-card {
    gap: 0.9rem;
    padding: 0.82rem 0.88rem;
    border-color: color-mix(in srgb, var(--nb-accent, #7c6f64) 12%, var(--nb-border, rgba(60, 60, 67, 0.12)));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 96%, rgba(249, 244, 240, 0.88));
  }

  .mega-account-card-actions {
    justify-content: flex-start;
  }

  .mega-share-grid {
    display: grid;
    gap: 0.9rem;
    grid-template-columns: minmax(0, 1fr);
  }

  .mega-share-grid > .compact-share-item {
    width: 100%;
    max-width: 560px;
    flex-basis: 560px;
  }

  .mega-command-metrics,
  .mega-automation-note-grid {
    display: grid;
    gap: 0.65rem;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  }

  .mega-metric-card {
    display: grid;
    gap: 0.32rem;
    min-width: 0;
    padding: 0.8rem 0.82rem;
    border-radius: 14px;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 88%, rgba(0, 0, 0, 0.03));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 96%, rgba(251, 247, 244, 0.9));
    text-align: left;
    cursor: pointer;
    transition:
      transform 140ms ease,
      border-color 140ms ease,
      background 140ms ease;
  }

  .mega-metric-card:hover {
    transform: translateY(-1px);
    border-color: color-mix(in srgb, var(--nb-accent, #7c6f64) 18%, var(--nb-border, rgba(60, 60, 67, 0.12)));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 94%, rgba(248, 243, 239, 0.92));
  }

  .mega-metric-value {
    color: var(--text-main);
    font-size: 0.95rem;
    line-height: 1.3;
    font-weight: 700;
    overflow-wrap: anywhere;
  }

  .mega-metric-detail,
  .mega-metric-pending {
    color: var(--text-soft);
    font-size: 0.76rem;
    line-height: 1.4;
  }

  .mega-metric-pending {
    margin-left: 0.35rem;
    font-weight: 600;
  }

  .mega-command-actions {
    gap: 0.55rem;
    align-items: center;
  }

  .mega-note-card {
    min-height: 100%;
  }

  .mega-onboarding-head {
    display: grid;
    gap: 0.28rem;
  }

  .compact-mode-copy {
    margin: 0;
  }

  .mega-onboarding-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.62rem;
    justify-content: flex-end;
    align-items: center;
  }

  .segmented-toggle {
    display: inline-grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.22rem;
    padding: 0.22rem;
    border-radius: 14px;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 88%, rgba(0, 0, 0, 0.03));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 95%, rgba(252, 244, 238, 0.9));
  }

  .segmented-toggle-btn {
    min-height: 34px;
    padding: 0 0.88rem;
    border: 0;
    border-radius: 11px;
    background: transparent;
    color: var(--text-soft);
    font: inherit;
    font-size: 0.78rem;
    font-weight: 700;
    cursor: pointer;
    transition:
      background 120ms ease,
      color 120ms ease,
      transform 120ms ease,
      box-shadow 120ms ease;
  }

  .segmented-toggle-btn:hover {
    color: var(--text-main);
    transform: translateY(-1px);
  }

  .segmented-toggle-btn.active {
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 94%, rgba(248, 243, 239, 0.94));
    color: var(--text-main);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--nb-accent, #7c6f64) 14%, var(--nb-border, rgba(60, 60, 67, 0.12)));
  }

  .provider-flow-status {
    display: grid;
    gap: 0.25rem;
    padding: 0.62rem 0.78rem;
    border-radius: 0.8rem;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 88%, rgba(0, 0, 0, 0.03));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 98%, rgba(249, 244, 240, 0.8));
  }

  .provider-story-card,
  .managed-share-story-card {
    display: grid;
    gap: 0.65rem;
    padding: 0.82rem 0.9rem;
    border-radius: 0.9rem;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 86%, rgba(0, 0, 0, 0.03));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 95%, rgba(245, 243, 240, 0.88));
  }

  .mega-helper-card {
    gap: 0.32rem;
  }

  .mega-runtime-log-card,
  .mega-runtime-log-entry,
  .mega-runtime-log-list {
    gap: 0.48rem;
  }

  .mega-runtime-log-layout {
    display: grid;
    gap: 0.75rem;
    grid-template-columns: minmax(220px, 0.9fr) minmax(0, 2fr);
    align-items: start;
  }

  .mega-runtime-log-header-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
    align-items: center;
    justify-content: flex-end;
  }

  .mega-runtime-log-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .mega-runtime-log-toolbar {
    display: grid;
    gap: 0.6rem;
  }

  .mega-runtime-log-search {
    display: grid;
    gap: 0.3rem;
  }

  .mega-runtime-log-toggle-row {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .mega-runtime-log-tab {
    display: grid;
    gap: 0.22rem;
    width: 100%;
    text-align: left;
    padding: 0.65rem 0.72rem;
    border-radius: 0.78rem;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 88%, rgba(0, 0, 0, 0.03));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 97%, rgba(248, 243, 239, 0.84));
    cursor: pointer;
    transition:
      border-color 120ms ease,
      transform 120ms ease,
      background 120ms ease;
  }

  .mega-runtime-log-tab:hover {
    transform: translateY(-1px);
    border-color: color-mix(in srgb, var(--nb-accent, #7c6f64) 18%, var(--nb-border, rgba(60, 60, 67, 0.12)));
  }

  .mega-runtime-log-tab.active {
    border-color: color-mix(in srgb, var(--nb-accent, #7c6f64) 22%, var(--nb-border, rgba(60, 60, 67, 0.12)));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 94%, rgba(248, 236, 227, 0.92));
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--nb-accent, #7c6f64) 12%, transparent);
  }

  .mega-runtime-log-tab-title {
    font-size: 0.8rem;
    font-weight: 700;
    color: var(--text-main);
  }

  .mega-runtime-log-tab-meta {
    font-size: 0.72rem;
    line-height: 1.35;
    color: var(--text-faint);
    word-break: break-word;
  }

  .mega-runtime-log-entry-head {
    display: flex;
    justify-content: space-between;
    gap: 0.75rem;
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .mega-status-headline {
    color: var(--text-main);
    font-size: 0.84rem;
    font-weight: 640;
  }

  .mega-log-view {
    margin: 0;
    padding: 0.55rem 0.62rem;
    border-radius: 0.62rem;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 86%, rgba(0, 0, 0, 0.03));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 98%, rgba(248, 243, 239, 0.8));
    color: var(--text-soft);
    font-size: 0.71rem;
    line-height: 1.35;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 180px;
    overflow: auto;
    font-family: var(--nb-font-mono, 'SF Mono', 'Cascadia Code', Consolas, monospace);
  }

  .mega-log-view.wrap {
    white-space: pre-wrap;
    word-break: break-word;
  }

  .mega-log-view-large {
    min-height: 280px;
    max-height: 520px;
    white-space: pre;
    word-break: normal;
  }

  .mega-log-view :global(.ansi-bold) {
    font-weight: 700;
  }

  .mega-log-view :global(.ansi-dim) {
    opacity: 0.72;
  }

  .mega-log-view :global(.ansi-fg-0) { color: #1f2937; }
  .mega-log-view :global(.ansi-fg-1) { color: #b42318; }
  .mega-log-view :global(.ansi-fg-2) { color: #18794e; }
  .mega-log-view :global(.ansi-fg-3) { color: #9a6700; }
  .mega-log-view :global(.ansi-fg-4) { color: #175cd3; }
  .mega-log-view :global(.ansi-fg-5) { color: #a23dad; }
  .mega-log-view :global(.ansi-fg-6) { color: #0f766e; }
  .mega-log-view :global(.ansi-fg-7) { color: #6b7280; }

  .mega-log-view :global(.ansi-fg-bright-0) { color: #4b5563; }
  .mega-log-view :global(.ansi-fg-bright-1) { color: #dc2626; }
  .mega-log-view :global(.ansi-fg-bright-2) { color: #16a34a; }
  .mega-log-view :global(.ansi-fg-bright-3) { color: #ca8a04; }
  .mega-log-view :global(.ansi-fg-bright-4) { color: #2563eb; }
  .mega-log-view :global(.ansi-fg-bright-5) { color: #c026d3; }
  .mega-log-view :global(.ansi-fg-bright-6) { color: #0891b2; }
  .mega-log-view :global(.ansi-fg-bright-7) { color: #9ca3af; }

  .mega-log-view :global(.ansi-bg-0) { background: rgba(31, 41, 55, 0.12); }
  .mega-log-view :global(.ansi-bg-1) { background: rgba(180, 35, 24, 0.12); }
  .mega-log-view :global(.ansi-bg-2) { background: rgba(24, 121, 78, 0.12); }
  .mega-log-view :global(.ansi-bg-3) { background: rgba(154, 103, 0, 0.12); }
  .mega-log-view :global(.ansi-bg-4) { background: rgba(23, 92, 211, 0.12); }
  .mega-log-view :global(.ansi-bg-5) { background: rgba(162, 61, 173, 0.12); }
  .mega-log-view :global(.ansi-bg-6) { background: rgba(15, 118, 110, 0.12); }
  .mega-log-view :global(.ansi-bg-7) { background: rgba(107, 114, 128, 0.12); }

  .mega-log-view :global(.ansi-bg-bright-0) { background: rgba(75, 85, 99, 0.12); }
  .mega-log-view :global(.ansi-bg-bright-1) { background: rgba(220, 38, 38, 0.12); }
  .mega-log-view :global(.ansi-bg-bright-2) { background: rgba(22, 163, 74, 0.12); }
  .mega-log-view :global(.ansi-bg-bright-3) { background: rgba(202, 138, 4, 0.12); }
  .mega-log-view :global(.ansi-bg-bright-4) { background: rgba(37, 99, 235, 0.12); }
  .mega-log-view :global(.ansi-bg-bright-5) { background: rgba(192, 38, 211, 0.12); }
  .mega-log-view :global(.ansi-bg-bright-6) { background: rgba(8, 145, 178, 0.12); }
  .mega-log-view :global(.ansi-bg-bright-7) { background: rgba(156, 163, 175, 0.12); }

  .managed-share-story-card.compact {
    padding: 0.74rem 0.82rem;
  }

  .provider-story-copy,
  .managed-share-story-copy,
  .provider-step-detail,
  .provider-path-copy {
    margin: 0;
    font-size: 0.79rem;
    line-height: 1.45;
    color: var(--text-soft);
  }

  .managed-share-fact-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 0.42rem;
  }

  .provider-fact-list {
    display: grid;
    gap: 0.24rem;
  }

  .provider-step-title {
    margin: 0;
    font-size: 0.81rem;
    font-weight: 700;
    color: var(--text);
  }

  .mega-diagnostic-card {
    gap: 0.45rem;
  }

  .provider-path-card {
    display: grid;
    gap: 0.28rem;
    padding: 0.62rem 0.72rem;
    border-radius: 0.78rem;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 88%, rgba(0, 0, 0, 0.03));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 97%, rgba(248, 243, 239, 0.84));
  }

  .provider-path-copy {
    font-family: var(--nb-font-mono, 'SF Mono', 'Cascadia Code', Consolas, monospace);
    word-break: break-word;
  }

  .managed-share-path-card {
    margin-top: -0.1rem;
  }

  .inline-panel-error {
    margin: 0;
  }

  .provider-flow-status[data-phase='cancelled'] {
    border-color: color-mix(in srgb, var(--nb-warning, #d4945f) 26%, transparent);
    background: color-mix(in srgb, var(--nb-warning-surface, rgba(253, 230, 138, 0.12)) 78%, rgba(255, 250, 245, 0.96));
  }

  .provider-flow-title {
    margin: 0;
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--text-main);
  }

  @media (max-width: 640px) {
    .mega-toast {
      grid-template-columns: minmax(0, 1fr);
    }

    .mega-toast-actions {
      justify-content: flex-start;
    }

    .mega-runtime-log-layout {
      grid-template-columns: minmax(0, 1fr);
    }

    .provider-dialog {
      width: calc(100vw - 1rem);
      padding: 0.82rem;
    }

    .section-actions,
    .inline-dialog-actions {
      width: 100%;
    }
  }

  .compact-share-grid {
    display: flex;
    flex-wrap: wrap;
    align-items: stretch;
    gap: 0.72rem;
  }

  .compact-share-item,
  .compact-share-grid > .location-card {
    flex: 0 1 320px;
    width: min(100%, 320px);
  }

  .compact-share-item {
    display: flex;
  }

  .compact-share-item :global(.share-card) {
    width: 100%;
    height: 100%;
  }

  .compact-share-grid > .location-card {
    height: 100%;
  }

  .field-block {
    display: grid;
    gap: 0.3rem;
  }

  .field-block > span {
    color: var(--text-main);
    font-size: 0.75rem;
    font-weight: 600;
  }

  .toggle-only-label {
    display: inline-flex;
    align-items: center;
    gap: 0.55rem;
    min-height: 34px;
    color: var(--text-main);
    font-size: 0.78rem;
    font-weight: 600;
  }

  .toggle-only-label input {
    width: 16px;
    height: 16px;
    accent-color: var(--nb-accent-strong, #8f6a3b);
  }

  .inline-progress {
    position: relative;
    overflow: hidden;
    height: 6px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 94%, rgba(248, 240, 234, 0.9));
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 86%, rgba(0, 0, 0, 0.03));
  }

  .inline-progress-bar {
    position: absolute;
    inset: 0 auto 0 0;
    width: 34%;
    border-radius: inherit;
    background: color-mix(in srgb, var(--nb-accent, #7c6f64) 54%, rgba(255, 249, 246, 0.98));
    animation: provider-progress-slide 1.1s ease-in-out infinite;
  }

  .panel-input {
    min-height: 34px;
    border-radius: 10px;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 88%, rgba(0, 0, 0, 0.03));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 96%, rgba(252, 244, 238, 0.9));
    color: var(--text-main);
    padding: 0 0.68rem;
    font-size: 0.78rem;
  }

  .panel-input:focus {
    outline: none;
    border-color: color-mix(in srgb, var(--nb-accent, #7c6f64) 18%, rgba(60, 60, 67, 0.14));
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--nb-panel-bg, #ffffff) 72%, rgba(240, 232, 226, 0.8));
  }

  .panel-input:disabled {
    opacity: 0.55;
  }

  .suggestion-card {
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 97%, rgba(248, 243, 239, 0.9));
  }

  .add-card {
    align-content: center;
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 97%, rgba(248, 243, 239, 0.9));
    border-style: dashed;
  }

  .add-card-button {
    min-height: 38px;
    border-radius: 16px;
    border: 1px dashed color-mix(in srgb, var(--nb-accent, #7c6f64) 22%, rgba(60, 60, 67, 0.14));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 95%, rgba(252, 244, 238, 0.9));
    color: var(--text-main);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.45rem;
    padding: 0 0.82rem;
    cursor: pointer;
    transition:
      transform 120ms ease,
      border-color 120ms ease,
      background 120ms ease;
  }

  .add-card-button.wide {
    width: fit-content;
  }

  .add-card-button:hover {
    transform: translateY(-1px);
    border-color: color-mix(in srgb, var(--nb-accent, #7c6f64) 14%, rgba(60, 60, 67, 0.14));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 95%, rgba(248, 243, 239, 0.92));
  }

  .scan-card {
    grid-template-columns: 1fr auto;
    align-items: start;
  }

  .scan-group {
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 97%, rgba(248, 243, 239, 0.9));
  }

  .usage-row {
    display: grid;
    gap: 0.35rem 0.9rem;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    padding: 0.75rem 0.85rem;
    border-radius: 14px;
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 96%, rgba(248, 243, 239, 0.88));
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 88%, rgba(0, 0, 0, 0.03));
  }

  .merge-box {
    display: grid;
    gap: 0.7rem;
    padding: 0.78rem;
    border-radius: 12px;
    border: 1px solid color-mix(in srgb, var(--nb-border, rgba(60, 60, 67, 0.12)) 88%, rgba(0, 0, 0, 0.03));
    background: color-mix(in srgb, var(--nb-panel-bg, #ffffff) 96%, rgba(248, 243, 239, 0.88));
  }

  .path-copy,
  .scan-path {
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  .compact-note {
    font-size: 0.76rem;
    margin-top: -0.12rem;
  }

  @keyframes provider-progress-slide {
    0% {
      transform: translateX(-110%);
    }
    100% {
      transform: translateX(320%);
    }
  }

  @keyframes provider-tab-spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  @media (max-width: 760px) {
    .storage-panel {
      padding: 1.1rem;
      border-radius: 12px;
    }

    .provider-choice-grid,
    .provider-overview-grid,
    .setup-guidance-grid,
    .mega-inline-status-grid {
      grid-template-columns: minmax(0, 1fr);
    }

    .storage-card-actions {
      grid-template-columns: 1fr;
      align-items: stretch;
    }

    .storage-card-actions-right {
      margin-left: 0;
      justify-content: flex-start;
    }

    .storage-card-actions-left,
    .storage-card-actions-right,
    .storage-card-actions .button-row {
      width: 100%;
    }

    .storage-card-actions .button-row > :global(*),
    .storage-card-actions .button-row > * {
      flex: 1 1 100%;
    }

    .inline-reserve-slot {
      margin-left: 0;
    }

    .inline-reserve-editor {
      width: 100%;
      justify-content: space-between;
    }

    .provider-tabs {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    }

    .provider-tab {
      min-width: 0;
    }

    .section-head,
    .card-head,
    .scan-card,
    .usage-row {
      grid-template-columns: 1fr;
    }

    .toolbar-row,
    .section-metrics,
    .card-status,
    .button-row,
    .usage-meta {
      width: 100%;
    }

    .button-row > :global(*),
    .toolbar-row > *,
    .provider-tab {
      flex: 1 1 100%;
    }
  }
</style>
