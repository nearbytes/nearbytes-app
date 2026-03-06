<script lang="ts">
  import {
    openVolume,
    listFiles,
    getTimeline,
    uploadFiles,
    deleteFile,
    renameFolder,
    downloadFile,
    getRootsConfig,
    updateRootsConfig,
    getRootConsolidationPlan,
    consolidateRoot as consolidateRootApi,
    openRootInFileManager,
    discoverSources,
    watchVolume,
    type Auth,
    type FileMetadata,
    type TimelineEvent,
    type RootConfigEntry,
    type RootConsolidationCandidate,
    type RootProvider,
    type RootsConfig,
    type RootsRuntimeSnapshot,
    type DiscoveredNearbytesSource,
  } from './lib/api.js';
  import { getCachedFiles, setCachedFiles } from './lib/cache.js';
  import ArmedActionButton from './components/ArmedActionButton.svelte';

  const PINNED_VOLUMES_KEY = 'nearbytes-pinned-volumes';
  const ROOT_SUGGESTIONS_DISMISSED_KEY = 'nearbytes-dismissed-suggestions-v1';
  const DAY_MS = 24 * 60 * 60 * 1000;
  const WEEK_MS = 7 * DAY_MS;
  const MONTH_MS = 30 * DAY_MS;

  type PreviewKind = 'none' | 'image' | 'text' | 'pdf' | 'video' | 'audio' | 'unsupported';
  type PinDuration = 'day' | 'week' | 'month';
  type PinnedVolume = {
    id: string;
    name: string;
    address: string;
    password: string;
    secret: string;
    expiresAt: number;
    pinnedAt: number;
  };

  function buildSecret(addr: string, password: string): string {
    return password ? `${addr}:${password}` : addr;
  }

  function durationToMs(duration: PinDuration): number {
    if (duration === 'day') return DAY_MS;
    if (duration === 'week') return WEEK_MS;
    return MONTH_MS;
  }

  function normalizePins(input: unknown): PinnedVolume[] {
    if (!Array.isArray(input)) return [];
    const now = Date.now();
    return input
      .filter((value) => typeof value === 'object' && value !== null)
      .map((value) => value as Partial<PinnedVolume>)
      .filter(
        (value) =>
          typeof value.id === 'string' &&
          typeof value.name === 'string' &&
          typeof value.address === 'string' &&
          typeof value.password === 'string' &&
          typeof value.secret === 'string' &&
          typeof value.expiresAt === 'number' &&
          typeof value.pinnedAt === 'number'
      )
      .filter((value) => (value.expiresAt as number) > now)
      .sort((a, b) => (b.pinnedAt as number) - (a.pinnedAt as number)) as PinnedVolume[];
  }

  function loadPinnedVolumes(): PinnedVolume[] {
    try {
      const raw = localStorage.getItem(PINNED_VOLUMES_KEY);
      if (!raw) return [];
      return normalizePins(JSON.parse(raw));
    } catch {
      return [];
    }
  }

  function persistPinnedVolumes(pins: PinnedVolume[]): void {
    try {
      localStorage.setItem(PINNED_VOLUMES_KEY, JSON.stringify(pins));
    } catch {
      // ignore
    }
  }

  function loadDismissedRootSuggestions(): string[] {
    try {
      const raw = localStorage.getItem(ROOT_SUGGESTIONS_DISMISSED_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((value) => typeof value === 'string')
        .map((value) => normalizeComparablePath(value))
        .filter((value, index, all) => value.length > 0 && all.indexOf(value) === index);
    } catch {
      return [];
    }
  }

  function persistDismissedRootSuggestions(values: string[]): void {
    try {
      localStorage.setItem(ROOT_SUGGESTIONS_DISMISSED_KEY, JSON.stringify(values));
    } catch {
      // ignore
    }
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
  let isTimelineLoading = $state(false);
  let isTimelinePlaying = $state(false);
  let isOffline = $state(false);
  let lastRefresh = $state<number | null>(null);
  let copiedVolumeId = $state(false);
  let searchQuery = $state('');
  let sortBy = $state<'newest' | 'oldest' | 'name' | 'size'>('newest');
  let selectedBlobHash = $state<string | null>(null);
  let timelineEvents = $state<TimelineEvent[]>([]);
  let timelinePosition = $state(0);
  let previewKind = $state<PreviewKind>('none');
  let previewUrl = $state('');
  let previewText = $state('');
  let previewLoading = $state(false);
  let previewError = $state('');
  let selectedFolder = $state('');
  let currentPreviewObjectUrl: string | null = null;
  const previewBlobCache = new Map<string, Blob>();
  let pinnedVolumes = $state<PinnedVolume[]>(loadPinnedVolumes());
  let showPinMenu = $state(false);
  let pinClock = $state(Date.now());
  let timelinePlayTimer: ReturnType<typeof setInterval> | null = null;
  let showRootsPanel = $state(false);
  let rootsConfigPath = $state<string | null>(null);
  let rootsRuntime = $state<RootsRuntimeSnapshot | null>(null);
  let rootsDraft = $state<RootConfigEntry[]>([]);
  let rootsError = $state('');
  let rootsSuccess = $state('');
  let rootsLoading = $state(false);
  let rootsSaving = $state(false);
  let discoveredSources = $state<DiscoveredNearbytesSource[]>([]);
  let dismissedRootSuggestions = $state<string[]>(loadDismissedRootSuggestions());
  let rootsAdvancedOpen = $state(false);
  let hasAutoScannedRoots = $state(false);
  let consolidatingRootIndex = $state<number | null>(null);
  let consolidateCandidates = $state<RootConsolidationCandidate[]>([]);
  let consolidateTargetId = $state('');
  let consolidateLoading = $state(false);
  let consolidateApplying = $state(false);
  let consolidateMessage = $state('');
  let sourceDiscoveryLoading = $state(false);
  let sourceDiscoveryError = $state('');
  let autoSyncEnabled = $state(false);
  let autoSyncStatus = $state<'idle' | 'connecting' | 'active' | 'unsupported' | 'error'>('idle');
  let isRefreshing = $state(false);
  let watchConnectionSerial = 0;
  let watchDisconnect: (() => void) | null = null;
  let autoRefreshTimer: ReturnType<typeof setTimeout> | null = null;

  type SourceRow = {
    source: DiscoveredNearbytesSource;
    alreadyRegistered: boolean;
    dismissed: boolean;
  };
  type VolumeRouteRow = {
    index: number;
    rootId: string;
    provider: RootProvider;
    kind: 'main' | 'backup';
    selected: boolean;
    routable: boolean;
    enabled: boolean;
    writable: boolean;
  };

  const activePins = $derived.by(() => {
    pinClock;
    return normalizePins(pinnedVolumes);
  });
  const matchedPinned = $derived.by(() => {
    const a = address.trim();
    if (!a) return null;
    const secret = buildSecret(a, addressPassword.trim());
    return activePins.find((pin) => pin.id === secret) ?? null;
  });

  const dismissedRootSuggestionSet = $derived.by(
    () => new Set(dismissedRootSuggestions.map((value) => normalizeComparablePath(value)))
  );

  const discoveredSourceRows = $derived.by(() => {
    const uniqueSources = new Map<string, DiscoveredNearbytesSource>();
    const dismissedSet = dismissedRootSuggestionSet;
    for (const source of discoveredSources) {
      const key = normalizeComparablePath(source.path);
      const existing = uniqueSources.get(key);
      if (!existing || source.sourceType === 'marker') {
        uniqueSources.set(key, source);
      }
    }
    const rows: SourceRow[] = Array.from(uniqueSources.values()).map((source) => {
      const key = normalizeComparablePath(source.path);
      const alreadyRegistered = rootsDraft.some(
        (root) => normalizeComparablePath(root.path) === key
      );
      const dismissed = source.sourceType === 'suggested' && dismissedSet.has(key);
      return { source, alreadyRegistered, dismissed };
    });
    rows.sort((left, right) => left.source.path.localeCompare(right.source.path));
    return rows;
  });

  const sourceRows = $derived.by(
    () => discoveredSourceRows.filter((row) => !row.alreadyRegistered && !row.dismissed)
  );
  const markerSourceRows = $derived.by(() => sourceRows.filter((row) => row.source.sourceType === 'marker'));
  const suggestedSourceRows = $derived.by(
    () => sourceRows.filter((row) => row.source.sourceType === 'suggested')
  );
  const dismissedSuggestionCount = $derived.by(
    () =>
      discoveredSourceRows.filter((row) => row.source.sourceType === 'suggested' && row.dismissed).length
  );
  const discoveredExistingSourceCount = $derived.by(
    () => discoveredSourceRows.filter((row) => row.source.sourceType === 'marker').length
  );
  const discoveredSuggestedSourceCount = $derived.by(
    () => discoveredSourceRows.filter((row) => row.source.sourceType === 'suggested').length
  );
  const alreadyRegisteredSourceCount = $derived.by(
    () => discoveredSourceRows.filter((row) => row.alreadyRegistered).length
  );
  const currentVolumeKey = $derived.by(() => {
    const raw = volumeId?.trim() ?? '';
    if (raw === '') return null;
    return normalizeChannelKey(raw);
  });
  const volumeRouteRows = $derived.by(() => {
    const key = currentVolumeKey;
    if (!key) return [] as VolumeRouteRow[];
    return rootsDraft.map((root, index) => {
      const selected =
        root.kind === 'main'
          ? true
          : root.strategy.name === 'allowlist' &&
            root.strategy.channelKeys.some((entry) => normalizeChannelKey(entry) === key);
      return {
        index,
        rootId: root.id,
        provider: root.provider,
        kind: root.kind,
        selected,
        routable: selected && root.enabled && root.writable,
        enabled: root.enabled,
        writable: root.writable,
      };
    });
  });
  const routedRootCount = $derived.by(() => volumeRouteRows.filter((row) => row.routable).length);

  $effect(() => {
    const interval = setInterval(() => {
      pinClock = Date.now();
    }, 60000);
    return () => clearInterval(interval);
  });

  $effect(() => {
    pinClock;
    const cleaned = normalizePins(pinnedVolumes);
    if (cleaned.length !== pinnedVolumes.length) {
      pinnedVolumes = cleaned;
      persistPinnedVolumes(cleaned);
    }
  });

  $effect(() => {
    persistDismissedRootSuggestions(dismissedRootSuggestions);
  });

  $effect(() => {
    if (matchedPinned && showPinMenu) {
      showPinMenu = false;
    }
  });

  const isHistoryMode = $derived.by(() => timelinePosition < timelineEvents.length);

  const timelineMarker = $derived.by(() => {
    if (timelineEvents.length === 0) return 'No history yet';
    if (timelinePosition === timelineEvents.length) return 'Live view';
    if (timelinePosition === 0) return `Genesis • 0/${timelineEvents.length}`;
    const event = timelineEvents[timelinePosition - 1];
    const verb = event.type === 'CREATE_FILE' ? 'created' : 'deleted';
    return `${timelinePosition}/${timelineEvents.length} • ${event.filename} ${verb}`;
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
      } else {
        files.delete(event.filename);
      }
    }

    const materialized = Array.from(files.values());
    materialized.sort((a, b) => {
      if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
      return a.filename.localeCompare(b.filename);
    });
    return materialized;
  });

  const folderPaths = $derived.by(() => {
    const folders = new Set<string>();
    for (const file of viewFiles) {
      const parts = file.filename.split('/').filter((part) => part.length > 0);
      for (let i = 1; i < parts.length; i += 1) {
        folders.add(parts.slice(0, i).join('/'));
      }
    }
    return Array.from(folders).sort((left, right) => left.localeCompare(right));
  });

  const filesInSelectedFolder = $derived.by(() => {
    if (selectedFolder.trim() === '') {
      return viewFiles;
    }
    const prefix = `${selectedFolder}/`;
    return viewFiles.filter((file) => file.filename.startsWith(prefix));
  });

  const visibleFiles = $derived.by(() => {
    const query = searchQuery.trim().toLowerCase();
    const filtered = query
      ? filesInSelectedFolder.filter((file) => file.filename.toLowerCase().includes(query))
      : filesInSelectedFolder;
    const sorted = [...filtered];
    if (sortBy === 'name') {
      sorted.sort((a, b) => a.filename.localeCompare(b.filename));
      return sorted;
    }
    if (sortBy === 'size') {
      sorted.sort((a, b) => b.size - a.size);
      return sorted;
    }
    if (sortBy === 'oldest') {
      sorted.sort((a, b) => a.createdAt - b.createdAt);
      return sorted;
    }
    sorted.sort((a, b) => b.createdAt - a.createdAt);
    return sorted;
  });

  $effect(() => {
    if (selectedFolder.trim() === '') return;
    if (!folderPaths.includes(selectedFolder)) {
      selectedFolder = '';
    }
  });

  const selectedFile = $derived.by(
    () => visibleFiles.find((file) => file.blobHash === selectedBlobHash) ?? null
  );

  function stopTimelinePlayback() {
    if (timelinePlayTimer) {
      clearInterval(timelinePlayTimer);
      timelinePlayTimer = null;
    }
    isTimelinePlaying = false;
  }

  function setTimelinePosition(next: number) {
    const max = timelineEvents.length;
    const clamped = Math.max(0, Math.min(next, max));
    timelinePosition = clamped;
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

  $effect(() => {
    return () => {
      stopTimelinePlayback();
    };
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

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  $effect(() => {
    const a = address.trim();
    const p = addressPassword.trim();
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (a === '') {
      stopTimelinePlayback();
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
      selectedBlobHash = null;
      previewKind = 'none';
      previewText = '';
      previewError = '';
      previewLoading = false;
      showPinMenu = false;
      previewBlobCache.clear();
      revokePreviewUrl();
      return;
    }
    debounceTimer = setTimeout(() => {
      tryOpenAddress(a, p);
      debounceTimer = null;
    }, 500);
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  });

  async function tryOpenAddress(a: string, p: string) {
    if (!a) return;
    const openSecret = buildSecret(a, p);
    isLoading = true;
    errorMessage = '';
    isOffline = false;
    try {
      const response = await openVolume(openSecret);
      const authResult = response.token
        ? { type: 'token' as const, token: response.token }
        : { type: 'secret' as const, secret: openSecret };
      if (response.token) {
        sessionStorage.setItem('nearbytes-token', response.token);
      } else {
        sessionStorage.removeItem('nearbytes-token');
      }
      auth = authResult;
      volumeId = response.volumeId;
      lastRefresh = Date.now();
      errorMessage = response.storageHint ?? '';
      effectiveSecret = openSecret;
      unlockedAddress = a;
      fileList = response.files;
      previewBlobCache.clear();
      await setCachedFiles(response.volumeId, response.files);
      await refreshTimeline(false);
    } catch (error) {
      if (volumeId) {
        const cached = await getCachedFiles(volumeId);
        if (cached) {
          fileList = cached;
          isOffline = true;
          errorMessage = 'Using cached data. Backend unavailable.';
        } else {
          errorMessage = error instanceof Error ? error.message : 'Failed to load volume';
          fileList = [];
        }
      } else {
        errorMessage = error instanceof Error ? error.message : 'Failed to load volume';
        fileList = [];
      }
      timelineEvents = [];
      timelinePosition = 0;
    } finally {
      isLoading = false;
    }
  }

  $effect(() => {
    const a = address.trim();
    if (a !== '' && a !== unlockedAddress && effectiveSecret !== '') {
      stopTimelinePlayback();
      effectiveSecret = '';
      unlockedAddress = '';
      auth = null;
      volumeId = null;
      fileList = [];
      lastRefresh = null;
      timelineEvents = [];
      timelinePosition = 0;
      selectedBlobHash = null;
      previewKind = 'none';
      previewText = '';
      previewError = '';
      previewLoading = false;
      previewBlobCache.clear();
      revokePreviewUrl();
    }
  });

  function pinCurrentCombo(duration: PinDuration) {
    const a = address.trim();
    if (!a) {
      errorMessage = 'Enter an address before pinning';
      showPinMenu = false;
      return;
    }
    const p = addressPassword.trim();
    const secret = buildSecret(a, p);
    const now = Date.now();
    const next = normalizePins(pinnedVolumes).filter((pin) => pin.id !== secret);
    next.unshift({
      id: secret,
      name: a,
      address: a,
      password: p,
      secret,
      expiresAt: now + durationToMs(duration),
      pinnedAt: now,
    });
    pinnedVolumes = next;
    persistPinnedVolumes(next);
    showPinMenu = false;
  }

  function handlePinButtonAction() {
    if (matchedPinned) {
      removePinnedVolume(matchedPinned.id);
      return;
    }
    togglePinMenu();
  }

  function usePinnedVolume(pin: PinnedVolume) {
    const sameSelection = address.trim() === pin.address && addressPassword.trim() === pin.password;
    address = pin.address;
    addressPassword = pin.password;
    showPinMenu = false;
    if (sameSelection) {
      tryOpenAddress(pin.address, pin.password);
    }
  }

  function removePinnedVolume(pinId: string) {
    const next = normalizePins(pinnedVolumes).filter((pin) => pin.id !== pinId);
    pinnedVolumes = next;
    persistPinnedVolumes(next);
  }

  function togglePinMenu() {
    showPinMenu = !showPinMenu;
  }

  function createDraftRoot(kind: 'main' | 'backup'): RootConfigEntry {
    const idPrefix = kind === 'main' ? 'main' : 'backup';
    const uniqueSuffix = Math.random().toString(16).slice(2, 8);
    return {
      id: `${idPrefix}-${uniqueSuffix}`,
      kind,
      provider: 'local',
      path: '',
      enabled: true,
      writable: true,
      strategy: kind === 'main' ? { name: 'all-keys' } : { name: 'allowlist', channelKeys: [] },
    };
  }

  function cloneRoot(root: RootConfigEntry): RootConfigEntry {
    return {
      ...root,
      strategy:
        root.strategy.name === 'allowlist'
          ? { name: 'allowlist', channelKeys: [...root.strategy.channelKeys] }
          : { name: 'all-keys' },
    };
  }

  function applyRootsState(config: RootsConfig, runtime: RootsRuntimeSnapshot, configPath: string | null) {
    rootsConfigPath = configPath;
    rootsRuntime = runtime;
    rootsDraft = config.roots.map(cloneRoot);
    cancelConsolidation();
  }

  function getAllowlistText(root: RootConfigEntry): string {
    if (root.strategy.name !== 'allowlist') return '';
    return root.strategy.channelKeys.join(', ');
  }

  function setAllowlistText(index: number, value: string) {
    const next = [...rootsDraft];
    const target = next[index];
    if (!target || target.kind !== 'backup') return;

    const channelKeys = value
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length > 0);

    next[index] = {
      ...target,
      strategy: {
        name: 'allowlist',
        channelKeys,
      },
    };
    rootsDraft = next;
  }

  function updateRootField<K extends keyof RootConfigEntry>(index: number, field: K, value: RootConfigEntry[K]) {
    const next = [...rootsDraft];
    if (!next[index]) return;
    next[index] = {
      ...next[index],
      [field]: value,
    };
    rootsDraft = next;
  }

  function updateRootPath(index: number, value: string) {
    const next = [...rootsDraft];
    const current = next[index];
    if (!current) return;
    next[index] = {
      ...current,
      path: value,
      provider: detectProviderFromPath(value),
    };
    rootsDraft = next;
  }

  function updateRootKind(index: number, kind: 'main' | 'backup') {
    const next = [...rootsDraft];
    const current = next[index];
    if (!current) return;

    next[index] = {
      ...current,
      kind,
      strategy: kind === 'main' ? { name: 'all-keys' } : { name: 'allowlist', channelKeys: [] },
    };
    rootsDraft = next;
  }

  function addRoot(kind: 'main' | 'backup') {
    rootsDraft = [...rootsDraft, createDraftRoot(kind)];
  }

  function removeRoot(index: number) {
    if (!canRemoveRoot(index)) {
      rootsError = 'At least one enabled main root is required.';
      return;
    }
    rootsDraft = rootsDraft.filter((_, i) => i !== index);
    if (consolidatingRootIndex === index) {
      cancelConsolidation();
    } else if (consolidatingRootIndex !== null && consolidatingRootIndex > index) {
      consolidatingRootIndex -= 1;
    }
  }

  function canRemoveRoot(index: number): boolean {
    const root = rootsDraft[index];
    if (!root) return false;
    const nextRoots = rootsDraft.filter((_, i) => i !== index);
    return nextRoots.some((entry) => entry.kind === 'main' && entry.enabled);
  }

  async function openRootFolder(rootId: string) {
    rootsError = '';
    rootsSuccess = '';
    try {
      await openRootInFileManager(rootId);
      rootsSuccess = 'Opened root in file manager.';
    } catch (error) {
      rootsError = error instanceof Error ? error.message : 'Failed to open root in file manager';
    }
  }

  function cancelConsolidation() {
    consolidatingRootIndex = null;
    consolidateCandidates = [];
    consolidateTargetId = '';
    consolidateMessage = '';
    consolidateLoading = false;
    consolidateApplying = false;
  }

  async function beginConsolidation(sourceIndex: number) {
    const source = rootsDraft[sourceIndex];
    if (!source) return;
    consolidatingRootIndex = sourceIndex;
    consolidateCandidates = [];
    consolidateTargetId = '';
    consolidateMessage = '';
    consolidateLoading = true;
    rootsError = '';

    try {
      const response = await getRootConsolidationPlan(source.id);
      const candidates = response.plan.candidates.filter((candidate) => candidate.eligible);
      consolidateCandidates = candidates;
      if (candidates.length > 0) {
        consolidateTargetId = candidates[0].id;
        consolidateMessage = `Move ${response.plan.source.fileCount} file(s) from this root into one destination.`;
      } else {
        const firstReason = response.plan.candidates.find((candidate) => candidate.reason)?.reason;
        consolidateMessage = firstReason ?? 'No compatible destinations are available.';
      }
    } catch (error) {
      consolidateMessage =
        error instanceof Error ? error.message : 'Failed to load consolidation destinations';
      consolidateCandidates = [];
    } finally {
      consolidateLoading = false;
    }
  }

  async function applyConsolidation() {
    if (consolidatingRootIndex === null) return;
    const source = rootsDraft[consolidatingRootIndex];
    if (!source) return;
    if (consolidateTargetId.trim() === '') {
      consolidateMessage = 'Choose a destination root first.';
      return;
    }

    const destination = rootsDraft.find((root) => root.id === consolidateTargetId);
    if (!destination) {
      consolidateMessage = 'Destination root no longer exists.';
      return;
    }

    const destinationLabel = `${formatProvider(destination.provider)} • ${destination.path}`;
    const proceed = window.confirm(
      `Consolidate "${source.path}" into:\n${destinationLabel}\n\nThis moves data and removes the source root from configuration.`
    );
    if (!proceed) {
      return;
    }

    consolidateApplying = true;
    rootsError = '';
    rootsSuccess = '';
    try {
      const response = await consolidateRootApi(source.id, consolidateTargetId);
      applyRootsState(response.config, response.runtime, response.configPath);
      rootsSuccess = 'Consolidation complete. Source root removed.';
      cancelConsolidation();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Consolidation failed';
      consolidateMessage = message;
      rootsError = message;
    } finally {
      consolidateApplying = false;
    }
  }

  async function reloadRootsPanel() {
    rootsLoading = true;
    rootsError = '';
    rootsSuccess = '';
    try {
      const response = await getRootsConfig();
      applyRootsState(response.config, response.runtime, response.configPath);
    } catch (error) {
      rootsError = error instanceof Error ? error.message : 'Failed to load roots configuration';
    } finally {
      rootsLoading = false;
    }
  }

  function buildRootsConfigPayload(): RootsConfig {
    return {
      version: 1,
      roots: rootsDraft.map((root) => ({
        ...root,
        provider: root.provider,
        strategy:
          root.kind === 'main'
            ? { name: 'all-keys' as const }
            : {
                name: 'allowlist' as const,
                channelKeys:
                  root.strategy.name === 'allowlist'
                    ? [...root.strategy.channelKeys]
                    : [],
              },
      })),
    };
  }

  function formatProvider(provider: RootProvider): string {
    if (provider === 'gdrive') return 'Google Drive';
    if (provider === 'dropbox') return 'Dropbox';
    if (provider === 'mega') return 'MEGA';
    return 'Local';
  }

  function detectProviderFromPath(pathValue: string): RootProvider {
    const lower = pathValue.toLowerCase();
    if (lower.includes('dropbox')) return 'dropbox';
    if (
      lower.includes('google drive') ||
      lower.includes('googledrive') ||
      lower.includes('google-drive') ||
      lower.includes('gdrive')
    ) {
      return 'gdrive';
    }
    if (lower.includes('mega')) return 'mega';
    return 'local';
  }

  function normalizeComparablePath(value: string): string {
    const normalized = value.trim().replace(/\\/g, '/').replace(/\/+$/, '');
    if (normalized === '') return '';
    if (normalized.startsWith('/')) {
      return normalized.toLowerCase();
    }
    return normalized.toLowerCase();
  }

  function normalizeChannelKey(value: string): string {
    return value.trim().toLowerCase();
  }

  function ensureNearbytesPath(pathValue: string, provider: RootProvider): string {
    if (provider === 'local') {
      return pathValue;
    }
    const trimmed = pathValue.trim().replace(/[/\\]+$/, '');
    if (trimmed === '') {
      return pathValue;
    }
    const normalized = trimmed.replace(/\\/g, '/');
    if (normalized.endsWith('/nearbytes') || normalized.toLowerCase().endsWith('/nearbytes')) {
      return trimmed;
    }
    return `${trimmed}/nearbytes`;
  }

  function sourceTypeLabel(source: DiscoveredNearbytesSource): string {
    return source.sourceType === 'marker' ? 'marker found' : 'default suggestion';
  }

  function rootIdFromSource(source: DiscoveredNearbytesSource, kind: 'main' | 'backup'): string {
    const base = `${kind}-${source.provider}`;
    let attempt = 1;
    while (true) {
      const candidate = `${base}-${attempt}`.toLowerCase();
      if (!rootsDraft.some((root) => root.id === candidate)) {
        return candidate;
      }
      attempt += 1;
    }
  }

  function addSourceAsRoot(source: DiscoveredNearbytesSource, kind: 'main' | 'backup'): boolean {
    const sourcePath = ensureNearbytesPath(source.path, source.provider);
    const normalizedPath = normalizeComparablePath(sourcePath);
    const exists = rootsDraft.some(
      (root) => normalizeComparablePath(root.path) === normalizedPath
    );
    if (exists) {
      rootsSuccess = `${sourcePath} is already configured.`;
      return false;
    }

    const nextRoot: RootConfigEntry = {
      id: rootIdFromSource(source, kind),
      kind,
      provider: source.provider,
      path: sourcePath,
      enabled: true,
      writable: true,
      strategy: kind === 'main' ? { name: 'all-keys' } : { name: 'allowlist', channelKeys: [] },
    };
    rootsDraft = [...rootsDraft, nextRoot];
    rootsSuccess = `Added ${formatProvider(source.provider)} source as ${kind} root.`;
    return true;
  }

  function addSourceAsReadOnlyRoot(source: DiscoveredNearbytesSource): boolean {
    const sourcePath = ensureNearbytesPath(source.path, source.provider);
    const normalizedPath = normalizeComparablePath(sourcePath);
    const exists = rootsDraft.some((root) => normalizeComparablePath(root.path) === normalizedPath);
    if (exists) {
      return false;
    }

    const nextRoot: RootConfigEntry = {
      id: rootIdFromSource(source, 'backup'),
      kind: 'backup',
      provider: source.provider,
      path: sourcePath,
      enabled: true,
      writable: false,
      strategy: { name: 'allowlist', channelKeys: [] },
    };
    rootsDraft = [...rootsDraft, nextRoot];
    return true;
  }

  function materializeSuggestedRoot(source: DiscoveredNearbytesSource, kind: 'main' | 'backup') {
    const pathLabel = ensureNearbytesPath(source.path, source.provider);
    const roleLabel = kind === 'main' ? 'Main' : 'Backup';
    const proceed = window.confirm(`Use ${pathLabel} as a ${roleLabel} root?`);
    if (!proceed) {
      return;
    }

    const added = addSourceAsRoot(source, kind);
    if (!added) {
      return;
    }
    const normalized = normalizeComparablePath(source.path);
    const nextDismissed = dismissedRootSuggestions.filter((entry) => entry !== normalized);
    if (nextDismissed.length !== dismissedRootSuggestions.length) {
      dismissedRootSuggestions = nextDismissed;
    }
  }

  function dismissSuggestedRoot(source: DiscoveredNearbytesSource) {
    const normalized = normalizeComparablePath(source.path);
    if (dismissedRootSuggestions.includes(normalized)) {
      return;
    }
    dismissedRootSuggestions = [...dismissedRootSuggestions, normalized];
    rootsSuccess = `Won't suggest ${source.path} again.`;
  }

  function restoreDismissedRootSuggestions() {
    dismissedRootSuggestions = [];
    rootsSuccess = 'Suggestion visibility restored.';
  }

  async function scanSources(options?: { silent?: boolean }) {
    sourceDiscoveryLoading = true;
    sourceDiscoveryError = '';
    rootsError = '';
    if (!options?.silent) {
      rootsSuccess = '';
    }
    try {
      const response = await discoverSources();
      discoveredSources = response.sources;
      const uniqueDiscovered = new Map<string, DiscoveredNearbytesSource>();
      for (const source of response.sources) {
        const key = normalizeComparablePath(source.path);
        const existing = uniqueDiscovered.get(key);
        if (!existing || source.sourceType === 'marker') {
          uniqueDiscovered.set(key, source);
        }
      }
      const dedupedCount = uniqueDiscovered.size;
      const existingSources = Array.from(uniqueDiscovered.values()).filter(
        (source) => source.sourceType === 'marker'
      );

      let autoAddedReadOnlyRoots = 0;
      for (const source of existingSources) {
        if (addSourceAsReadOnlyRoot(source)) {
          autoAddedReadOnlyRoots += 1;
        }
      }

      if (autoAddedReadOnlyRoots > 0) {
        const saved = await updateRootsConfig(buildRootsConfigPayload());
        applyRootsState(saved.config, saved.runtime, saved.configPath);
      }

      if (dedupedCount === 0) {
        if (!options?.silent) {
          rootsSuccess = 'No synced sources found.';
        }
      } else if (!options?.silent) {
        if (autoAddedReadOnlyRoots > 0) {
          rootsSuccess = `Connected ${autoAddedReadOnlyRoots} existing source${autoAddedReadOnlyRoots === 1 ? '' : 's'} as read-only roots.`;
        } else if (existingSources.length > 0) {
          rootsSuccess = `Found ${existingSources.length} existing source${existingSources.length === 1 ? '' : 's'}. Already connected.`;
        } else {
          rootsSuccess = 'No existing .nearbytes sources found. Suggestions stay hidden.';
        }
      }
    } catch (error) {
      sourceDiscoveryError = error instanceof Error ? error.message : 'Failed to discover sources';
    } finally {
      sourceDiscoveryLoading = false;
    }
  }

  function routeRootForCurrentVolume(index: number) {
    const key = currentVolumeKey;
    if (!key) {
      rootsError = 'Open a volume first to route roots.';
      return;
    }

    const next = [...rootsDraft];
    const root = next[index];
    if (!root) return;

    if (root.kind === 'main') {
      next[index] = {
        ...root,
        enabled: true,
        writable: true,
      };
      rootsDraft = next;
      rootsSuccess = `Main root "${root.id}" is now active for all volumes. Save to apply.`;
      return;
    }

    const existingKeys =
      root.strategy.name === 'allowlist'
        ? root.strategy.channelKeys.map((entry) => normalizeChannelKey(entry))
        : [];
    const hasKey = existingKeys.includes(key);
    const shouldEnableRoute = !hasKey || !root.enabled || !root.writable;

    if (shouldEnableRoute) {
      const merged = Array.from(new Set([...existingKeys, key])).sort((a, b) => a.localeCompare(b));
      next[index] = {
        ...root,
        enabled: true,
        writable: true,
        strategy: {
          name: 'allowlist',
          channelKeys: merged,
        },
      };
      rootsDraft = next;
      rootsSuccess = `Volume routed to backup root "${root.id}". Save to apply.`;
      return;
    }

    next[index] = {
      ...root,
      strategy: {
        name: 'allowlist',
        channelKeys: existingKeys.filter((entry) => entry !== key),
      },
    };
    rootsDraft = next;
    rootsSuccess = `Volume removed from backup root "${root.id}". Save to apply.`;
  }

  function routeCardStatus(row: VolumeRouteRow): string {
    if (row.kind === 'main') {
      return row.routable ? 'Always used (main)' : 'Main root is disabled';
    }
    if (row.routable) {
      return 'Used for this volume';
    }
    if (row.selected && (!row.enabled || !row.writable)) {
      return 'Selected but unavailable';
    }
    return 'Not used for this volume';
  }

  function routeCardActionLabel(row: VolumeRouteRow): string {
    if (row.kind === 'main') {
      return row.routable ? 'Always On' : 'Enable';
    }
    if (row.routable) {
      return 'Stop Using';
    }
    if (row.selected && (!row.enabled || !row.writable)) {
      return 'Fix + Use';
    }
    return 'Use';
  }

  async function saveRootsPanel() {
    rootsSaving = true;
    rootsError = '';
    rootsSuccess = '';
    try {
      const payload = buildRootsConfigPayload();
      const response = await updateRootsConfig(payload);
      applyRootsState(response.config, response.runtime, response.configPath);
      rootsSuccess = 'Roots configuration saved.';
    } catch (error) {
      rootsError = error instanceof Error ? error.message : 'Failed to save roots configuration';
    } finally {
      rootsSaving = false;
    }
  }

  async function toggleRootsPanel() {
    showRootsPanel = !showRootsPanel;
    if (showRootsPanel && rootsDraft.length === 0 && !rootsLoading) {
      await reloadRootsPanel();
    }
    if (showRootsPanel && !sourceDiscoveryLoading && !hasAutoScannedRoots) {
      hasAutoScannedRoots = true;
      void scanSources({ silent: true });
    }
  }

  $effect(() => {
    if (visibleFiles.length === 0) {
      selectedBlobHash = null;
      return;
    }
    const selectedStillVisible = selectedBlobHash
      ? visibleFiles.some((file) => file.blobHash === selectedBlobHash)
      : false;
    if (!selectedStillVisible) {
      selectedBlobHash = visibleFiles[0].blobHash;
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

  $effect(() => {
    let cancelled = false;
    const file = selectedFile;

    previewError = '';
    previewText = '';
    previewLoading = false;
    revokePreviewUrl();

    if (!file || !auth) {
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

  function selectFile(file: FileMetadata) {
    selectedBlobHash = file.blobHash;
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
      openFileInViewer(file);
      return;
    }
    if (e.key === ' ') {
      e.preventDefault();
      selectFile(file);
    }
  }

  function normalizeFolderInput(value: string): string {
    return value
      .trim()
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
      .replace(/\/+$/, '')
      .replace(/\/{2,}/g, '/');
  }

  function displayFileName(file: FileMetadata): string {
    if (selectedFolder.trim() === '') {
      return file.filename;
    }
    const prefix = `${selectedFolder}/`;
    if (!file.filename.startsWith(prefix)) {
      return file.filename;
    }
    return file.filename.slice(prefix.length);
  }

  async function handleRenameFolder() {
    if (!auth) return;
    if (isHistoryMode) {
      errorMessage = 'History mode is read-only. Jump to Latest before renaming folders.';
      return;
    }
    const sourceFolder = normalizeFolderInput(selectedFolder);
    if (sourceFolder.length === 0) {
      errorMessage = 'Select a folder to rename.';
      return;
    }

    const input = window.prompt('Rename folder', sourceFolder);
    if (input === null) {
      return;
    }

    const destinationFolder = normalizeFolderInput(input);
    if (destinationFolder.length === 0) {
      errorMessage = 'Destination folder cannot be empty.';
      return;
    }
    if (destinationFolder === sourceFolder) {
      return;
    }

    let merge = false;
    const destinationExists = folderPaths.includes(destinationFolder);
    if (destinationExists) {
      merge = window.confirm(
        `Folder "${destinationFolder}" already exists. Merge "${sourceFolder}" into it?`
      );
      if (!merge) {
        return;
      }
    }

    try {
      errorMessage = '';
      await renameFolder(auth, sourceFolder, destinationFolder, merge);
      selectedFolder = destinationFolder;
      await refreshFiles();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Folder rename failed';
      if (
        !merge &&
        message.toLowerCase().includes('destination folder already contains')
      ) {
        const retryMerge = window.confirm(
          `Folder "${destinationFolder}" already contains files. Merge and continue?`
        );
        if (!retryMerge) {
          return;
        }
        try {
          errorMessage = '';
          await renameFolder(auth, sourceFolder, destinationFolder, true);
          selectedFolder = destinationFolder;
          await refreshFiles();
          return;
        } catch (retryError) {
          errorMessage = retryError instanceof Error ? retryError.message : 'Folder merge failed';
          return;
        }
      }
      errorMessage = message;
    }
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
    e.preventDefault();
    isDragging = true;
  }

  function handleDragLeave(e: DragEvent) {
    e.preventDefault();
    isDragging = false;
  }

  async function handleDrop(e: DragEvent) {
    e.preventDefault();
    isDragging = false;

    if (!auth || !effectiveSecret) {
      errorMessage = 'Enter address and optional password first';
      return;
    }
    if (isHistoryMode) {
      errorMessage = 'History mode is read-only. Jump to Latest before uploading.';
      return;
    }

    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;

    try {
      errorMessage = '';
      await uploadFiles(auth, files);
      await refreshFiles();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Upload failed';
      console.error('Error uploading files:', error);
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
  if (e.key === 'Delete' && e.target instanceof HTMLElement) {
    const fileItem = e.target.closest('[data-filename]');
    if (fileItem) {
      const filename = fileItem.getAttribute('data-filename');
      if (filename && auth) {
        handleDelete(filename);
      }
    }
  }
}} onpointerdown={(e) => {
  if (!(e.target instanceof Element)) return;
  if (!showPinMenu) return;
  if (e.target.closest('.pin-menu') || e.target.closest('.pin-btn')) return;
  showPinMenu = false;
}} />

<div class="app">
  <!-- Header with branding and secret input -->
  <header class="header">
    <div class="header-content">
      <div class="brand">
        <svg class="brand-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M2 17L12 22L22 17" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M2 12L12 17L22 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <h1 class="brand-title">Nearbytes</h1>
      </div>
      <div class="secret-input-wrapper">
        <input
          type="text"
          placeholder="Enter address..."
          bind:value={address}
          class="secret-input"
          aria-label="Volume address"
        />
        <input
          type="password"
          placeholder="Password (optional)"
          bind:value={addressPassword}
          class="secret-input password-input"
          aria-label="Optional volume password"
          autocomplete="current-password"
        />
        <ArmedActionButton
          class="pin-btn"
          text={matchedPinned ? 'Forget' : 'Pin'}
          armed={matchedPinned !== null}
          armDelayMs={1000}
          autoDisarmMs={3000}
          resetKey={matchedPinned?.id ?? address.trim()}
          disabled={address.trim() === ''}
          ariaHasPopup={matchedPinned ? undefined : 'menu'}
          ariaExpanded={matchedPinned ? undefined : showPinMenu}
          onPress={handlePinButtonAction}
        />
        <button
          type="button"
          class="roots-btn"
          onclick={toggleRootsPanel}
          aria-expanded={showRootsPanel}
          aria-label="Manage storage roots"
        >
          {showRootsPanel ? 'Hide Roots' : 'Roots'}
        </button>
        {#if isLoading}
          <span class="loading-spinner"></span>
        {/if}
        {#if showPinMenu}
          <div class="pin-menu" role="menu" aria-label="Pin volume duration">
            <button type="button" class="pin-menu-item" role="menuitem" onclick={() => pinCurrentCombo('day')}>
              Pin for 1 day
            </button>
            <button type="button" class="pin-menu-item" role="menuitem" onclick={() => pinCurrentCombo('week')}>
              Pin for 1 week
            </button>
            <button type="button" class="pin-menu-item" role="menuitem" onclick={() => pinCurrentCombo('month')}>
              Pin for 1 month
            </button>
          </div>
        {/if}
      </div>
    </div>
  </header>

  {#if activePins.length > 0}
    <div class="pins-bar">
      <div class="pins-content">
        {#each activePins as pin (pin.id)}
          <div class="pin-chip-wrap">
            <button
              type="button"
              class="pin-chip"
              class:active={matchedPinned?.id === pin.id}
              onclick={() => usePinnedVolume(pin)}
              title={"Open pinned volume " + pin.name}
            >
              {pin.name}
            </button>
          </div>
        {/each}
      </div>
    </div>
  {/if}

  <!-- Status bar -->
  {#if volumeId || errorMessage || isOffline}
    <div class="status-bar">
      {#if volumeId}
        <div class="status-item">
          <span class="status-label">Volume:</span>
          <button class="volume-id-btn" onclick={copyVolumeId} title="Copy volume ID">
            {volumeId.slice(0, 16)}...
            {#if copiedVolumeId}
              <span class="copied-indicator">✓ Copied</span>
            {/if}
          </button>
        </div>
      {/if}
      {#if lastRefresh}
        <div class="status-item">
          <span class="status-label">Last refresh:</span>
          <span class="status-value">{formatDate(lastRefresh)}</span>
        </div>
      {/if}
      {#if volumeId}
        <div class="status-item">
          <span class="status-label">Sync:</span>
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
        <div class="status-item history-indicator">
          <span>History mode (read-only)</span>
        </div>
      {/if}
      {#if isOffline}
        <div class="status-item offline-indicator">
          <span>📴 Offline (cached)</span>
        </div>
      {/if}
      {#if errorMessage}
        <div class="status-item error-indicator">
          <span>{errorMessage}</span>
        </div>
      {/if}
      {#if volumeId && !isLoading && !autoSyncEnabled}
        <button class="refresh-btn" onclick={refreshFiles} title="Refresh file list">
          ↻ Refresh
        </button>
      {/if}
    </div>
  {/if}

  <!-- Main file area -->
  <main
    class="file-area"
    class:dragging={isDragging}
    ondragover={handleDragOver}
    ondragleave={handleDragLeave}
    ondrop={handleDrop}
  >
    {#if showRootsPanel}
      <section class="roots-panel" aria-label="Storage roots configuration">
        <div class="roots-panel-header">
          <div class="roots-title-wrap">
            <p class="roots-eyebrow">Storage Roots</p>
            <h3 class="roots-title">Storage Locations</h3>
            <p class="roots-subtitle">
              Choose where data lives. Save applies changes.
            </p>
            {#if rootsAdvancedOpen}
              <p class="roots-path" title={rootsConfigPath ?? ''}>
                {rootsConfigPath ? `Config: ${rootsConfigPath}` : 'Config path unavailable'}
              </p>
            {/if}
          </div>
          <div class="roots-actions">
            <button
              type="button"
              class="roots-action-btn"
              onclick={() => scanSources()}
              disabled={sourceDiscoveryLoading}
            >
              {sourceDiscoveryLoading ? 'Finding…' : 'Find More Roots'}
            </button>
            <button
              type="button"
              class="roots-action-btn"
              onclick={() => {
                rootsAdvancedOpen = !rootsAdvancedOpen;
              }}
            >
              {rootsAdvancedOpen ? 'Simple' : 'Advanced'}
            </button>
            <button
              type="button"
              class="roots-action-btn primary"
              onclick={saveRootsPanel}
              disabled={rootsSaving || rootsLoading}
            >
              {rootsSaving ? 'Saving…' : 'Save'}
            </button>
            {#if rootsAdvancedOpen}
              <button type="button" class="roots-action-btn" onclick={() => addRoot('main')}>
                New Main
              </button>
              <button type="button" class="roots-action-btn" onclick={() => addRoot('backup')}>
                New Backup
              </button>
              <button type="button" class="roots-action-btn" onclick={reloadRootsPanel} disabled={rootsLoading}>
                Reload
              </button>
            {/if}
          </div>
        </div>

        {#if rootsError}
          <p class="roots-error">{rootsError}</p>
        {/if}
        {#if sourceDiscoveryError}
          <p class="roots-error">{sourceDiscoveryError}</p>
        {/if}
        {#if rootsSuccess}
          <p class="roots-success">{rootsSuccess}</p>
        {/if}

        <div class="roots-scroll">
          {#if rootsLoading}
            <p class="roots-info">Loading roots configuration…</p>
          {:else}
            <section class="source-discovery" aria-label="Discovered synced sources">
              <div class="roots-section-head">
                <p class="roots-section-title">Source Discovery</p>
                <p class="roots-section-caption">Existing `.nearbytes` sources are auto-connected read-only.</p>
              </div>
              {#if discoveredSourceRows.length === 0}
                <p class="roots-info">
                  No sources discovered yet. Use “Find More Roots”.
                </p>
              {:else}
                <p class="roots-info">
                  Discovered {discoveredExistingSourceCount} existing source{discoveredExistingSourceCount === 1 ? '' : 's'}
                  and {discoveredSuggestedSourceCount} suggestion{discoveredSuggestedSourceCount === 1 ? '' : 's'}.
                </p>
                <p class="roots-info muted">
                  Suggestions are hidden. Existing sources are connected automatically as read-only roots.
                </p>
              {/if}
              {#if alreadyRegisteredSourceCount > 0}
                <p class="roots-info muted">
                  {alreadyRegisteredSourceCount} discovered source{alreadyRegisteredSourceCount === 1 ? '' : 's'} already materialized.
                </p>
              {/if}
              {#if rootsAdvancedOpen && dismissedSuggestionCount > 0}
                <p class="roots-info muted">
                  {dismissedSuggestionCount} suggestion{dismissedSuggestionCount === 1 ? '' : 's'} hidden.
                </p>
              {/if}
            </section>

            <section class="roots-active" aria-label="Materialized roots">
              <div class="roots-section-head">
                <p class="roots-section-title">Configured Roots</p>
                {#if volumeId}
                  <p class="roots-section-caption">
                    This open volume currently uses {routedRootCount} root{routedRootCount === 1 ? '' : 's'}.
                  </p>
                {/if}
              </div>
              <div class="roots-list">
              {#each rootsDraft as root, index (root.id + ':' + index)}
                <article class="root-card">
                  <div class="root-card-head">
                    <div class="root-pill-row">
                      <span class="root-provider-pill">{formatProvider(root.provider)}</span>
                      <span class="root-kind-pill">{root.kind}</span>
                      {#if rootsAdvancedOpen}
                        <span class="root-id-pill">{root.id}</span>
                      {/if}
                    </div>
                    {#if rootsAdvancedOpen}
                      <div class="root-card-actions">
                        <label class="root-check">
                          <input
                            type="checkbox"
                            checked={root.enabled}
                            onchange={(e) => updateRootField(index, 'enabled', (e.currentTarget as HTMLInputElement).checked)}
                          />
                          enabled
                        </label>
                        <label class="root-check">
                          <input
                            type="checkbox"
                            checked={root.writable}
                            onchange={(e) => updateRootField(index, 'writable', (e.currentTarget as HTMLInputElement).checked)}
                          />
                          writable
                        </label>
                      </div>
                    {:else}
                      <span class="root-active-pill" class:inactive={!root.enabled || !root.writable}>
                        {!root.enabled ? 'Off' : root.writable ? 'On' : 'Read-only'}
                      </span>
                    {/if}
                  </div>

                  <div class="root-row">
                    <label class="root-field">
                      <span>Folder</span>
                      <input
                        type="text"
                        class="root-input root-path-input"
                        value={root.path}
                        oninput={(e) => updateRootPath(index, (e.currentTarget as HTMLInputElement).value)}
                      />
                    </label>
                    <button
                      type="button"
                      class="root-open"
                      onclick={() => openRootFolder(root.id)}
                    >
                      Open in File Manager
                    </button>
                    <button
                      type="button"
                      class="root-consolidate"
                      onclick={() =>
                        consolidatingRootIndex === index ? cancelConsolidation() : beginConsolidation(index)}
                      disabled={rootsDraft.length < 2}
                    >
                      {consolidatingRootIndex === index ? 'Cancel' : 'Consolidate…'}
                    </button>
                    <button
                      type="button"
                      class="root-remove"
                      onclick={() => removeRoot(index)}
                      disabled={!canRemoveRoot(index)}
                      title={!canRemoveRoot(index) ? 'At least one enabled main root is required' : ''}
                    >
                      Remove
                    </button>
                  </div>

                  {#if consolidatingRootIndex === index}
                    <div class="root-consolidation-row">
                      {#if consolidateLoading}
                        <span class="roots-info">Loading destinations…</span>
                      {:else if consolidateCandidates.length === 0}
                        <span class="roots-info">{consolidateMessage}</span>
                      {:else}
                        <select
                          class="root-input root-consolidation-select"
                          bind:value={consolidateTargetId}
                          aria-label="Consolidation destination"
                        >
                          {#each consolidateCandidates as candidate (candidate.id)}
                            <option value={candidate.id}>
                              {formatProvider(candidate.provider)} • {candidate.path}
                            </option>
                          {/each}
                        </select>
                        <button
                          type="button"
                          class="root-route-btn"
                          onclick={applyConsolidation}
                          disabled={consolidateApplying || consolidateTargetId.trim() === ''}
                        >
                          {consolidateApplying ? 'Consolidating…' : 'Consolidate Here'}
                        </button>
                        {#if consolidateMessage}
                          <span class="roots-info muted">{consolidateMessage}</span>
                        {/if}
                      {/if}
                    </div>
                  {/if}

                  {#if root.kind === 'backup' && rootsAdvancedOpen}
                    <label class="root-allowlist">
                      <span>Allowed volume keys (comma-separated)</span>
                      <input
                        type="text"
                        class="root-input"
                        value={getAllowlistText(root)}
                        oninput={(e) => setAllowlistText(index, (e.currentTarget as HTMLInputElement).value)}
                      />
                    </label>
                  {/if}

                  {#if volumeId}
                    {@const routeRow = volumeRouteRows.find((entry) => entry.index === index)}
                    {#if routeRow}
                      <div class="root-volume-route">
                        <span class="root-volume-label">Open volume</span>
                        <span class="root-volume-state" class:active={routeRow.routable}>
                          {routeCardStatus(routeRow)}
                        </span>
                        <button
                          type="button"
                          class="root-route-btn"
                          class:active={routeRow.routable}
                          disabled={routeRow.kind === 'main' && routeRow.routable}
                          onclick={() => routeRootForCurrentVolume(index)}
                        >
                          {routeCardActionLabel(routeRow)}
                        </button>
                      </div>
                    {/if}
                  {/if}

                  {#if rootsAdvancedOpen}
                    <div class="root-advanced-grid">
                      <label>
                        <span>Root ID</span>
                        <input
                          type="text"
                          class="root-input"
                          value={root.id}
                          oninput={(e) => updateRootField(index, 'id', (e.currentTarget as HTMLInputElement).value)}
                        />
                      </label>
                      <label>
                        <span>Kind</span>
                        <select
                          class="root-input"
                          value={root.kind}
                          onchange={(e) =>
                            updateRootKind(index, (e.currentTarget as HTMLSelectElement).value as 'main' | 'backup')}
                        >
                          <option value="main">main</option>
                          <option value="backup">backup</option>
                        </select>
                      </label>
                      <label>
                        <span>Provider (optional override)</span>
                        <select
                          class="root-input"
                          value={root.provider}
                          onchange={(e) =>
                            updateRootField(index, 'provider', (e.currentTarget as HTMLSelectElement).value as RootProvider)}
                        >
                          <option value="local">local</option>
                          <option value="dropbox">dropbox</option>
                          <option value="mega">mega</option>
                          <option value="gdrive">gdrive</option>
                        </select>
                      </label>
                    </div>
                    <p class="roots-info muted">
                      Provider is auto-detected from path and used mainly for source labeling and watch hints.
                    </p>
                  {/if}

                  {#if rootsRuntime && rootsAdvancedOpen}
                    {@const runtime = rootsRuntime.roots.find((entry) => entry.id === root.id)}
                    {#if runtime}
                      <div class="root-runtime">
                        <span>exists: {runtime.exists ? 'yes' : 'no'}</span>
                        <span>canWrite: {runtime.canWrite ? 'yes' : 'no'}</span>
                        <span>
                          free:
                          {runtime.availableBytes !== undefined ? formatSize(runtime.availableBytes) : 'n/a'}
                        </span>
                        {#if runtime.lastWriteFailure}
                          <span class="root-runtime-error">
                            last error: {runtime.lastWriteFailure.code}
                          </span>
                        {/if}
                      </div>
                    {/if}
                  {/if}
                </article>
              {/each}
              </div>
            </section>
            {#if rootsDraft.length === 0}
              <p class="roots-info">No roots configured yet. Materialize a suggestion or create a root manually.</p>
            {/if}
          {/if}
        </div>
      </section>
    {/if}

    {#if address.trim() === ''}
      <!-- Initial state -->
      <div class="empty-state">
        <div class="empty-content">
          <svg class="empty-icon" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M32 8L8 20L32 32L56 20L32 8Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.3"/>
            <path d="M8 20V44L32 56L56 44V20" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.3"/>
            <path d="M32 32V56" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.3"/>
          </svg>
          <p class="empty-hint">Enter an address to access your files</p>
          <p class="empty-subhint">Or drag and drop files here to create a new volume</p>
        </div>
      </div>
    {:else}
      <div class="volume-workspace">
      <section class="time-machine" aria-label="Volume timeline">
        <div class="time-machine-head">
          <div>
            <p class="time-machine-eyebrow">Time Machine</p>
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
          <div class="tm-events">
            {#each timelineEvents as event, index (event.eventHash)}
              <button
                type="button"
                class="tm-event"
                class:applied={index < timelinePosition}
                class:current={index === timelinePosition - 1}
                class:create={event.type === 'CREATE_FILE'}
                class:delete={event.type === 'DELETE_FILE'}
                onclick={() => jumpToEvent(index)}
                title={`${event.type === 'CREATE_FILE' ? 'Create' : 'Delete'} ${event.filename} • ${formatDate(event.timestamp)}`}
              >
                <span class="tm-event-kind">{event.type === 'CREATE_FILE' ? 'Create' : 'Delete'}</span>
                <span class="tm-event-name">{event.filename}</span>
                <span class="tm-event-time">{formatShortDate(event.timestamp)}</span>
              </button>
            {/each}
          </div>
        {:else}
          <p class="tm-empty">Timeline is empty. Add files to create history.</p>
        {/if}
      </section>

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
        <div class="file-manager">
          <section class="file-list-pane">
            <div class="manager-toolbar">
              <input
                type="text"
                class="manager-search"
                placeholder="Search files"
                bind:value={searchQuery}
                aria-label="Search files"
              />
              <select class="manager-sort" bind:value={sortBy} aria-label="Sort files">
                <option value="newest">Newest</option>
                <option value="oldest">Oldest</option>
                <option value="name">Name</option>
                <option value="size">Size</option>
              </select>
              <select class="manager-folder" bind:value={selectedFolder} aria-label="Filter by folder">
                <option value="">All folders</option>
                {#each folderPaths as folder (folder)}
                  <option value={folder}>{folder}</option>
                {/each}
              </select>
              <button
                type="button"
                class="manager-btn toolbar-btn"
                onclick={handleRenameFolder}
                disabled={selectedFolder.trim() === '' || isHistoryMode}
                title={isHistoryMode ? 'Jump to Latest before renaming folders' : 'Rename selected folder'}
              >
                Rename Folder
              </button>
            </div>
            <div class="file-list-head">
              <span>Name</span>
              <span>Size</span>
              <span>Date</span>
            </div>
            {#if visibleFiles.length === 0}
              <div class="list-empty">No files match your search.</div>
            {:else}
              <div class="file-list-scroll">
                {#each visibleFiles as file (file.blobHash)}
                  <div
                    class="file-row"
                    class:selected={selectedBlobHash === file.blobHash}
                    data-filename={file.filename}
                    tabindex="0"
                    role="button"
                    onclick={() => selectFile(file)}
                    ondblclick={() => openFileInViewer(file)}
                    onkeydown={(e) => handleFileRowKeydown(e, file)}
                  >
                    <span class="file-row-name" title={file.filename}>{displayFileName(file)}</span>
                    <span class="file-row-size">{formatSize(file.size)}</span>
                    <span class="file-row-date">{formatShortDate(file.createdAt)}</span>
                  </div>
                {/each}
              </div>
            {/if}
          </section>
          <section class="preview-pane">
            {#if selectedFile}
              <div class="preview-header">
                <div>
                  <h3 class="preview-title" title={selectedFile.filename}>{selectedFile.filename}</h3>
                  <p class="preview-meta">
                    {selectedFile.mimeType || 'Unknown type'} • {formatSize(selectedFile.size)} • {formatDate(selectedFile.createdAt)}
                  </p>
                </div>
                <div class="preview-actions">
                  <button type="button" class="manager-btn" onclick={() => openFileInViewer(selectedFile)}>
                    Open
                  </button>
                  <button type="button" class="manager-btn" onclick={() => handleDownload(selectedFile)}>
                    Download
                  </button>
                  <ArmedActionButton
                    class="manager-btn danger"
                    text="Delete"
                    armed={true}
                    armDelayMs={1000}
                    autoDisarmMs={3000}
                    disabled={isHistoryMode}
                    resetKey={`${selectedFile.blobHash}:${isHistoryMode}`}
                    title={isHistoryMode ? 'Jump to Latest before deleting' : ''}
                    onPress={() => handleDelete(selectedFile.filename)}
                  />
                </div>
              </div>
              <div class="preview-body">
                {#if previewLoading}
                  <p class="preview-message">Loading preview…</p>
                {:else if previewError}
                  <p class="preview-message error">{previewError}</p>
                {:else if previewKind === 'image' && previewUrl}
                  <img class="preview-image" src={previewUrl} alt={"Preview of " + selectedFile.filename} />
                {:else if previewKind === 'video' && previewUrl}
                  <!-- svelte-ignore a11y_media_has_caption -->
                  <video class="preview-media" controls src={previewUrl}></video>
                {:else if previewKind === 'audio' && previewUrl}
                  <audio class="preview-audio" controls src={previewUrl}></audio>
                {:else if previewKind === 'pdf' && previewUrl}
                  <iframe class="preview-pdf" src={previewUrl} title={"PDF preview: " + selectedFile.filename}></iframe>
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
        </div>
      {/if}
      </div>
    {/if}
  </main>

</div>

<style>
  :global(html, body, #app) {
    min-height: 100%;
    overflow-x: hidden;
    overflow-y: auto;
  }

  :global(*, *::before, *::after) {
    box-sizing: border-box;
  }

  :global(body) {
    margin: 0;
    padding: 0;
    background: #0a0a0f;
    color: #e0e0e0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  }

  .app {
    width: 100%;
    min-height: 100dvh;
    height: auto;
    display: flex;
    flex-direction: column;
    background: linear-gradient(135deg, #0a0a0f 0%, #1a1a2e 100%);
    overflow: visible;
  }

  /* Header */
  .header {
    background: rgba(26, 26, 46, 0.8);
    backdrop-filter: blur(10px);
    border-bottom: 1px solid rgba(102, 126, 234, 0.2);
    padding: 1.5rem 2rem;
    position: sticky;
    top: 0;
    z-index: 100;
  }

  .header-content {
    max-width: none;
    margin: 0;
    display: flex;
    align-items: center;
    gap: 2rem;
    width: 100%;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .brand-icon {
    width: 32px;
    height: 32px;
    color: #667eea;
  }

  .brand-title {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 600;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .secret-input-wrapper {
    flex: 1;
    min-width: 0;
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(0, 1fr) auto auto auto;
    gap: 0.75rem;
    align-items: center;
    position: relative;
  }

  .secret-input {
    width: 100%;
    padding: 0.875rem 1.25rem;
    font-size: 1rem;
    background: rgba(255, 255, 255, 0.05);
    border: 2px solid rgba(102, 126, 234, 0.3);
    border-radius: 12px;
    color: #e0e0e0;
    outline: none;
    transition: all 0.2s ease;
  }

  .secret-input:focus {
    border-color: #667eea;
    background: rgba(255, 255, 255, 0.08);
    box-shadow: 0 0 0 4px rgba(102, 126, 234, 0.1);
  }

  .secret-input:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .secret-input::placeholder {
    color: rgba(224, 224, 224, 0.4);
  }

  .loading-spinner {
    justify-self: center;
    width: 16px;
    height: 16px;
    border: 2px solid rgba(102, 126, 234, 0.3);
    border-top-color: #667eea;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  :global(.pin-btn) {
    border: 1px solid rgba(102, 126, 234, 0.35);
    background: rgba(10, 10, 15, 0.35);
    color: #d9e2ff;
    border-radius: 10px;
    padding: 0.75rem 0.95rem;
    font-size: 0.875rem;
    cursor: pointer;
    transition: background-color 0.2s ease;
  }

  :global(.pin-btn:hover:not(:disabled)) {
    background: rgba(102, 126, 234, 0.2);
  }

  :global(.pin-btn.armed) {
    border-color: rgba(248, 113, 113, 0.65);
    background: rgba(248, 113, 113, 0.18);
    color: #fecaca;
  }

  :global(.pin-btn.armed:hover:not(:disabled)) {
    background: rgba(248, 113, 113, 0.28);
  }

  :global(.pin-btn:disabled) {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .roots-btn {
    border: 1px solid rgba(125, 211, 252, 0.35);
    background: rgba(15, 23, 42, 0.45);
    color: #dbeafe;
    border-radius: 10px;
    padding: 0.75rem 0.95rem;
    font-size: 0.875rem;
    cursor: pointer;
  }

  .roots-btn:hover {
    background: rgba(14, 116, 144, 0.25);
  }

  .pin-menu {
    position: absolute;
    right: 0;
    top: calc(100% + 0.5rem);
    min-width: 170px;
    background: rgba(17, 17, 32, 0.95);
    border: 1px solid rgba(102, 126, 234, 0.35);
    border-radius: 10px;
    padding: 0.35rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    z-index: 150;
    backdrop-filter: blur(8px);
  }

  .pin-menu-item {
    text-align: left;
    border: 0;
    background: transparent;
    color: #dde5ff;
    padding: 0.5rem 0.6rem;
    border-radius: 8px;
    font-size: 0.8125rem;
    cursor: pointer;
  }

  .pin-menu-item:hover {
    background: rgba(102, 126, 234, 0.2);
  }

  .pins-bar {
    padding: 0.6rem 2rem 0;
  }

  .pins-content {
    max-width: none;
    margin: 0;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
    width: 100%;
  }

  .pin-chip-wrap {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  .pin-chip {
    border: 1px solid rgba(102, 126, 234, 0.35);
    background: rgba(10, 10, 15, 0.35);
    color: #dce5ff;
    border-radius: 999px;
    padding: 0.38rem 0.75rem;
    font-size: 0.8125rem;
    cursor: pointer;
  }

  .pin-chip:hover {
    background: rgba(102, 126, 234, 0.2);
  }

  .pin-chip.active {
    border-color: rgba(102, 126, 234, 0.75);
    background: rgba(102, 126, 234, 0.28);
    color: #eef2ff;
    box-shadow: inset 0 0 0 1px rgba(102, 126, 234, 0.3);
  }

  /* Status bar */
  .status-bar {
    background: rgba(10, 10, 15, 0.6);
    border-bottom: 1px solid rgba(102, 126, 234, 0.1);
    padding: 0.75rem 2rem;
    display: flex;
    align-items: center;
    gap: 1.5rem;
    flex-wrap: wrap;
    font-size: 0.875rem;
    max-width: none;
    margin: 0;
    width: 100%;
  }

  .status-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: rgba(224, 224, 224, 0.7);
  }

  .status-label {
    font-weight: 500;
    color: rgba(224, 224, 224, 0.5);
  }

  .status-value {
    font-family: 'Monaco', 'Menlo', monospace;
    font-size: 0.8125rem;
  }

  .volume-id-btn {
    background: rgba(102, 126, 234, 0.1);
    border: 1px solid rgba(102, 126, 234, 0.3);
    border-radius: 6px;
    padding: 0.25rem 0.75rem;
    font-family: 'Monaco', 'Menlo', monospace;
    font-size: 0.8125rem;
    color: #667eea;
    cursor: pointer;
    transition: all 0.2s;
    position: relative;
  }

  .volume-id-btn:hover {
    background: rgba(102, 126, 234, 0.2);
    border-color: #667eea;
  }

  .copied-indicator {
    margin-left: 0.5rem;
    color: #4ade80;
    font-size: 0.75rem;
  }

  .offline-indicator {
    color: #fbbf24;
  }

  .history-indicator {
    color: #7dd3fc;
  }

  .error-indicator {
    color: #f87171;
  }

  .refresh-btn {
    background: rgba(102, 126, 234, 0.2);
    border: 1px solid rgba(102, 126, 234, 0.3);
    border-radius: 6px;
    padding: 0.375rem 0.875rem;
    color: #667eea;
    cursor: pointer;
    font-size: 0.875rem;
    transition: all 0.2s;
    margin-left: auto;
  }

  .refresh-btn:hover {
    background: rgba(102, 126, 234, 0.3);
    border-color: #667eea;
  }

  .refresh-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  /* File area */
  .file-area {
    flex: 0 0 auto;
    min-height: auto;
    padding: 2rem;
    overflow: visible;
    transition: background-color 0.3s ease;
  }

  .volume-workspace {
    max-width: none;
    margin: 0;
    width: 100%;
    height: auto;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    min-height: auto;
  }

  .roots-panel {
    max-width: none;
    margin: 0 0 1rem;
    border: 1px solid rgba(125, 211, 252, 0.28);
    border-radius: 18px;
    background:
      radial-gradient(120% 110% at 0% 0%, rgba(45, 212, 191, 0.16), transparent 52%),
      radial-gradient(100% 120% at 100% 0%, rgba(56, 189, 248, 0.1), transparent 58%),
      linear-gradient(145deg, rgba(12, 23, 45, 0.9), rgba(15, 23, 42, 0.82));
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
    max-height: none;
    min-height: 220px;
  }

  .roots-panel-header {
    display: flex;
    justify-content: space-between;
    gap: 1.1rem;
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .roots-title-wrap {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: min(100%, 460px);
  }

  .roots-title {
    margin: 0;
    font-size: 1.1rem;
    color: rgba(224, 242, 254, 0.98);
    letter-spacing: 0.01em;
  }

  .roots-subtitle {
    margin: 0;
    color: rgba(191, 219, 254, 0.84);
    font-size: 0.78rem;
    max-width: 60ch;
  }

  .roots-eyebrow {
    margin: 0;
    color: rgba(94, 234, 212, 0.82);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    font-size: 0.68rem;
  }

  .roots-path {
    margin: 0.25rem 0 0;
    font-size: 0.78rem;
    color: rgba(191, 219, 254, 0.82);
    max-width: 62ch;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .roots-actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    justify-content: flex-end;
    align-items: center;
  }

  .roots-action-btn {
    border: 1px solid rgba(125, 211, 252, 0.36);
    border-radius: 999px;
    background: rgba(15, 23, 42, 0.5);
    color: #dbeafe;
    padding: 0.42rem 0.78rem;
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    cursor: pointer;
    transition: all 0.18s ease;
  }

  .roots-action-btn:hover:not(:disabled) {
    border-color: rgba(94, 234, 212, 0.6);
    background: rgba(17, 94, 89, 0.32);
  }

  .roots-action-btn.primary {
    border-color: rgba(94, 234, 212, 0.65);
    color: #bbf7d0;
    background: rgba(6, 95, 70, 0.42);
    box-shadow: 0 0 0 1px rgba(94, 234, 212, 0.18) inset;
  }

  .roots-action-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .roots-error,
  .roots-success,
  .roots-info {
    margin: 0;
    font-size: 0.8rem;
  }

  .roots-error {
    color: #fecaca;
  }

  .roots-success {
    color: #bbf7d0;
  }

  .roots-info {
    color: rgba(191, 219, 254, 0.85);
  }

  .roots-info.muted {
    color: rgba(148, 163, 184, 0.88);
    font-size: 0.74rem;
  }

  .roots-scroll {
    overflow: visible;
    min-height: auto;
    scrollbar-width: none;
    padding-right: 0;
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
  }

  .roots-scroll::-webkit-scrollbar {
    display: none;
  }

  .roots-section-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.6rem;
    flex-wrap: wrap;
  }

  .roots-section-title {
    margin: 0;
    color: rgba(224, 242, 254, 0.95);
    font-size: 0.92rem;
    font-weight: 700;
    letter-spacing: 0.01em;
  }

  .roots-section-caption {
    margin: 0;
    color: rgba(148, 163, 184, 0.85);
    font-size: 0.74rem;
  }

  .roots-list {
    display: flex;
    flex-direction: column;
    gap: 0.72rem;
  }

  .source-discovery {
    margin-bottom: 0.2rem;
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
  }

  .roots-active {
    display: flex;
    flex-direction: column;
    gap: 0.62rem;
  }

  .root-card {
    border: 1px solid rgba(148, 163, 184, 0.26);
    border-radius: 14px;
    padding: 0.72rem;
    display: flex;
    flex-direction: column;
    gap: 0.58rem;
    background: linear-gradient(145deg, rgba(15, 23, 42, 0.48), rgba(30, 41, 59, 0.34));
  }

  .root-card-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.55rem;
    flex-wrap: wrap;
  }

  .root-pill-row {
    display: flex;
    align-items: center;
    gap: 0.38rem;
    flex-wrap: wrap;
  }

  .root-provider-pill,
  .root-kind-pill,
  .root-id-pill {
    border-radius: 999px;
    padding: 0.12rem 0.46rem;
    font-size: 0.66rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .root-provider-pill {
    background: rgba(8, 145, 178, 0.22);
    border: 1px solid rgba(103, 232, 249, 0.45);
    color: rgba(125, 211, 252, 0.96);
  }

  .root-kind-pill {
    background: rgba(51, 65, 85, 0.4);
    border: 1px solid rgba(148, 163, 184, 0.42);
    color: rgba(226, 232, 240, 0.88);
  }

  .root-id-pill {
    background: rgba(17, 24, 39, 0.5);
    border: 1px solid rgba(71, 85, 105, 0.45);
    color: rgba(148, 163, 184, 0.92);
    text-transform: none;
    letter-spacing: 0.01em;
    font-family: 'Monaco', 'Menlo', monospace;
  }

  .root-card-actions {
    display: flex;
    align-items: center;
    gap: 0.42rem;
    flex-wrap: wrap;
  }

  .root-active-pill {
    border-radius: 999px;
    border: 1px solid rgba(16, 185, 129, 0.5);
    background: rgba(6, 78, 59, 0.3);
    color: #bbf7d0;
    padding: 0.18rem 0.5rem;
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-weight: 700;
  }

  .root-active-pill.inactive {
    border-color: rgba(248, 113, 113, 0.45);
    background: rgba(127, 29, 29, 0.22);
    color: #fecaca;
  }

  .root-row {
    display: flex;
    align-items: flex-end;
    gap: 0.55rem;
    flex-wrap: wrap;
  }

  .root-row label,
  .root-advanced-grid label,
  .root-field {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    min-width: 120px;
    color: rgba(191, 219, 254, 0.85);
    font-size: 0.72rem;
  }

  .root-field {
    flex: 1;
    min-width: 240px;
  }

  .root-input {
    border: 1px solid rgba(125, 211, 252, 0.34);
    border-radius: 10px;
    background: rgba(15, 23, 42, 0.55);
    color: #e2e8f0;
    padding: 0.46rem 0.6rem;
    font-size: 0.8rem;
    min-width: 0;
  }

  .root-input:focus {
    outline: none;
    border-color: rgba(94, 234, 212, 0.62);
    box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.12);
  }

  .root-path-input {
    width: 100%;
  }

  .root-check {
    flex-direction: row;
    align-items: center;
    min-width: 0;
    gap: 0.35rem;
    font-size: 0.73rem;
    color: rgba(191, 219, 254, 0.86);
    border: 1px solid rgba(71, 85, 105, 0.42);
    border-radius: 999px;
    padding: 0.2rem 0.5rem;
    background: rgba(15, 23, 42, 0.4);
  }

  .root-remove {
    border: 1px solid rgba(248, 113, 113, 0.55);
    background: rgba(127, 29, 29, 0.32);
    color: #fecaca;
    border-radius: 10px;
    padding: 0.5rem 0.66rem;
    cursor: pointer;
    font-size: 0.72rem;
    font-weight: 700;
  }

  .root-remove:hover {
    background: rgba(185, 28, 28, 0.3);
  }

  .root-remove:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .root-open {
    border: 1px solid rgba(125, 211, 252, 0.4);
    background: rgba(15, 23, 42, 0.5);
    color: rgba(191, 219, 254, 0.95);
    border-radius: 10px;
    padding: 0.5rem 0.66rem;
    cursor: pointer;
    font-size: 0.72rem;
    font-weight: 700;
  }

  .root-open:hover:not(:disabled) {
    border-color: rgba(94, 234, 212, 0.58);
    background: rgba(17, 94, 89, 0.28);
  }

  .root-consolidate {
    border: 1px solid rgba(125, 211, 252, 0.4);
    background: rgba(15, 23, 42, 0.52);
    color: rgba(191, 219, 254, 0.95);
    border-radius: 10px;
    padding: 0.5rem 0.66rem;
    cursor: pointer;
    font-size: 0.72rem;
    font-weight: 700;
  }

  .root-consolidate:hover:not(:disabled) {
    border-color: rgba(94, 234, 212, 0.58);
    background: rgba(17, 94, 89, 0.3);
  }

  .root-consolidate:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .root-consolidation-row {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    flex-wrap: wrap;
    border: 1px solid rgba(125, 211, 252, 0.2);
    border-radius: 8px;
    background: rgba(15, 23, 42, 0.4);
    padding: 0.45rem 0.5rem;
  }

  .root-consolidation-select {
    flex: 1;
    min-width: 260px;
  }

  .root-allowlist {
    min-width: 220px;
  }

  .root-advanced-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 0.45rem;
  }

  .root-advanced-grid label {
    min-width: 0;
  }

  .root-volume-route {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    flex-wrap: wrap;
    border: 1px solid rgba(125, 211, 252, 0.24);
    border-radius: 8px;
    padding: 0.4rem 0.5rem;
    background: rgba(15, 23, 42, 0.42);
  }

  .root-volume-label {
    font-size: 0.72rem;
    color: rgba(191, 219, 254, 0.92);
    font-weight: 600;
  }

  .root-volume-state {
    font-size: 0.72rem;
    color: rgba(191, 219, 254, 0.86);
  }

  .root-volume-state.active {
    color: #86efac;
  }

  .root-route-btn {
    margin-left: auto;
    border: 1px solid rgba(125, 211, 252, 0.35);
    border-radius: 999px;
    background: rgba(15, 23, 42, 0.6);
    color: #dbeafe;
    font-size: 0.72rem;
    padding: 0.34rem 0.64rem;
    cursor: pointer;
  }

  .root-route-btn.active {
    border-color: rgba(16, 185, 129, 0.55);
    color: #bbf7d0;
  }

  .root-route-btn:disabled {
    opacity: 0.55;
    cursor: default;
  }

  .root-runtime {
    display: flex;
    gap: 0.6rem;
    flex-wrap: wrap;
    font-size: 0.7rem;
    color: rgba(191, 219, 254, 0.82);
    border-top: 1px solid rgba(71, 85, 105, 0.36);
    padding-top: 0.45rem;
  }

  .root-runtime-error {
    color: #fda4af;
  }

  .time-machine {
    border: 1px solid rgba(125, 211, 252, 0.22);
    border-radius: 14px;
    background: linear-gradient(135deg, rgba(15, 23, 42, 0.7), rgba(30, 41, 59, 0.55));
    padding: 0.9rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    min-height: auto;
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
    color: rgba(125, 211, 252, 0.78);
  }

  .time-machine-marker {
    margin: 0.25rem 0 0;
    font-size: 0.875rem;
    color: rgba(226, 232, 240, 0.92);
  }

  .time-machine-actions {
    display: flex;
    gap: 0.5rem;
  }

  .tm-btn {
    border: 1px solid rgba(125, 211, 252, 0.34);
    border-radius: 8px;
    background: rgba(15, 23, 42, 0.55);
    color: #dbeafe;
    padding: 0.38rem 0.75rem;
    cursor: pointer;
    font-size: 0.8125rem;
  }

  .tm-btn.live {
    border-color: rgba(96, 165, 250, 0.65);
    background: rgba(59, 130, 246, 0.2);
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
    color: rgba(191, 219, 254, 0.8);
  }

  .tm-events {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(150px, 180px);
    gap: 0.5rem;
    overflow-x: auto;
    overflow-y: hidden;
    padding-bottom: 0.1rem;
    scrollbar-width: none;
  }

  .tm-events::-webkit-scrollbar {
    display: none;
  }

  .tm-event {
    border: 1px solid rgba(148, 163, 184, 0.22);
    border-radius: 10px;
    background: rgba(15, 23, 42, 0.35);
    color: #e2e8f0;
    display: grid;
    gap: 0.15rem;
    padding: 0.5rem 0.58rem;
    text-align: left;
    cursor: pointer;
    transition: border-color 0.16s ease, background 0.16s ease, transform 0.16s ease;
  }

  .tm-event.applied {
    border-color: rgba(56, 189, 248, 0.5);
    background: rgba(14, 116, 144, 0.22);
  }

  .tm-event.current {
    border-color: rgba(96, 165, 250, 0.85);
    background: rgba(30, 64, 175, 0.38);
    transform: translateY(-1px);
  }

  .tm-event.create .tm-event-kind {
    color: #86efac;
  }

  .tm-event.delete .tm-event-kind {
    color: #fca5a5;
  }

  .tm-event-kind {
    font-size: 0.68rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .tm-event-name {
    font-size: 0.8125rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tm-event-time {
    font-size: 0.72rem;
    color: rgba(191, 219, 254, 0.85);
  }

  .tm-empty {
    margin: 0;
    font-size: 0.8125rem;
    color: rgba(186, 230, 253, 0.7);
  }

  .file-area.dragging {
    background: rgba(102, 126, 234, 0.1);
    border: 2px dashed #667eea;
    border-radius: 12px;
    margin: 1rem;
  }

  .empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 60vh;
  }

  .empty-content {
    text-align: center;
    max-width: 400px;
  }

  .empty-icon {
    width: 80px;
    height: 80px;
    margin: 0 auto 1.5rem;
    color: rgba(102, 126, 234, 0.3);
  }

  .empty-hint {
    font-size: 1.25rem;
    color: rgba(224, 224, 224, 0.8);
    margin: 0 0 0.5rem;
  }

  .empty-subhint {
    font-size: 0.9375rem;
    color: rgba(224, 224, 224, 0.5);
    margin: 0;
  }

  /* File manager */
  .file-manager {
    flex: 0 0 auto;
    min-height: auto;
    display: grid;
    grid-template-columns: minmax(280px, 360px) minmax(0, 1fr);
    gap: 1rem;
  }

  .file-list-pane {
    min-height: auto;
    background: rgba(26, 26, 46, 0.55);
    border: 1px solid rgba(102, 126, 234, 0.2);
    border-radius: 12px;
    display: flex;
    flex-direction: column;
    overflow: visible;
  }

  .manager-toolbar {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 0.5rem;
    padding: 0.75rem;
    border-bottom: 1px solid rgba(102, 126, 234, 0.18);
  }

  .manager-search,
  .manager-sort,
  .manager-folder {
    border: 1px solid rgba(102, 126, 234, 0.35);
    background: rgba(10, 10, 15, 0.35);
    color: #e0e0e0;
    border-radius: 8px;
    padding: 0.5rem 0.75rem;
    font-size: 0.875rem;
    outline: none;
  }

  .manager-search:focus,
  .manager-sort:focus,
  .manager-folder:focus {
    border-color: #667eea;
    box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.12);
  }

  .manager-folder {
    min-width: 0;
  }

  .toolbar-btn {
    justify-self: end;
  }

  .file-list-head {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    gap: 0.75rem;
    padding: 0.5rem 0.75rem;
    font-size: 0.75rem;
    letter-spacing: 0.02em;
    color: rgba(224, 224, 224, 0.56);
    border-bottom: 1px solid rgba(102, 126, 234, 0.12);
  }

  .file-list-scroll {
    flex: 0 0 auto;
    min-height: auto;
    overflow: visible;
    scrollbar-width: none;
  }

  .file-list-scroll::-webkit-scrollbar {
    display: none;
  }

  .file-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    gap: 0.75rem;
    align-items: center;
    padding: 0.6rem 0.75rem;
    cursor: default;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
    transition: background 0.15s ease;
  }

  .file-row:hover {
    background: rgba(102, 126, 234, 0.08);
  }

  .file-row.selected {
    background: rgba(102, 126, 234, 0.16);
  }

  .file-row:focus {
    outline: 2px solid rgba(102, 126, 234, 0.5);
    outline-offset: -2px;
  }

  .file-row-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: #e8e8e8;
  }

  .file-row-size,
  .file-row-date {
    font-size: 0.75rem;
    color: rgba(224, 224, 224, 0.58);
  }

  .list-empty {
    padding: 1rem;
    color: rgba(224, 224, 224, 0.65);
    font-size: 0.875rem;
  }

  .preview-pane {
    min-height: auto;
    background: rgba(26, 26, 46, 0.55);
    border: 1px solid rgba(102, 126, 234, 0.2);
    border-radius: 12px;
    display: flex;
    flex-direction: column;
    overflow: visible;
  }

  .preview-header {
    padding: 1rem;
    border-bottom: 1px solid rgba(102, 126, 234, 0.18);
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    align-items: flex-start;
  }

  .preview-title {
    margin: 0;
    color: #f5f5f5;
    font-size: 1rem;
    font-weight: 600;
    max-width: 48ch;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .preview-meta {
    margin: 0.25rem 0 0;
    color: rgba(224, 224, 224, 0.58);
    font-size: 0.8125rem;
  }

  .preview-actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  :global(.manager-btn) {
    border: 1px solid rgba(102, 126, 234, 0.35);
    background: rgba(10, 10, 15, 0.35);
    color: #d9e2ff;
    border-radius: 8px;
    padding: 0.45rem 0.7rem;
    font-size: 0.8125rem;
    cursor: pointer;
  }

  :global(.manager-btn:hover) {
    background: rgba(102, 126, 234, 0.18);
  }

  :global(.manager-btn.danger) {
    border-color: rgba(248, 113, 113, 0.45);
    color: #fecaca;
  }

  :global(.manager-btn.danger:hover) {
    background: rgba(248, 113, 113, 0.16);
  }

  .preview-body {
    flex: 0 0 auto;
    min-height: auto;
    overflow: visible;
    padding: 1rem;
    scrollbar-width: none;
  }

  .preview-body::-webkit-scrollbar {
    display: none;
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
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    color: rgba(224, 224, 224, 0.65);
    font-size: 0.9375rem;
  }

  @media (max-width: 900px) {
    .header {
      padding: 1rem;
    }

    .header-content {
      gap: 1rem;
      flex-direction: column;
      align-items: stretch;
    }

    .secret-input-wrapper {
      grid-template-columns: 1fr 1fr auto auto auto;
    }

    .pins-bar {
      padding: 0.6rem 1rem 0;
    }

    .status-bar {
      padding: 0.75rem 1rem;
    }

    .file-area {
      padding: 1rem;
    }

    .volume-workspace {
      gap: 0.75rem;
    }

    .time-machine {
      padding: 0.75rem;
    }

    .tm-events {
      grid-auto-columns: minmax(132px, 160px);
    }

    .file-manager {
      grid-template-columns: 1fr;
      gap: 0.75rem;
    }

    .file-list-pane {
      max-height: none;
    }

    .preview-header {
      flex-direction: column;
      align-items: stretch;
    }

    .preview-actions {
      justify-content: flex-start;
    }
  }

  @media (max-width: 640px) {
    .secret-input-wrapper {
      grid-template-columns: 1fr 1fr 1fr;
      grid-template-areas:
        'address address address'
        'password password password'
        'pin roots spinner';
    }

    .secret-input-wrapper > input:first-child {
      grid-area: address;
    }

    .secret-input-wrapper > input:nth-child(2) {
      grid-area: password;
    }

    :global(.pin-btn) {
      grid-area: pin;
      width: fit-content;
    }

    .roots-btn {
      grid-area: roots;
      width: fit-content;
      justify-self: start;
    }

    .loading-spinner {
      grid-area: spinner;
      justify-self: start;
    }

    .time-machine-head {
      flex-direction: column;
    }

    .time-machine-actions {
      width: 100%;
      justify-content: space-between;
    }

    .manager-toolbar {
      grid-template-columns: 1fr;
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
  }
</style>
