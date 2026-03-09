<script lang="ts">
  import { onMount, tick } from 'svelte';
  import {
    chooseDirectoryPath,
    consolidateRoot,
    discoverSources,
    getRootConsolidationPlan,
    getRootsConfig,
    hasDesktopDirectoryPicker,
    openRootInFileManager,
    type DiscoveryAction,
    type ReconcileSourcesResponse,
    updateRootsConfig,
    type DiscoveredNearbytesSource,
    type RootConsolidationCandidate,
    type RootsConfig,
    type RootsRuntimeSnapshot,
    type SourceConfigEntry,
    type SourceProvider,
    type StorageFullPolicy,
    type VolumeDestinationConfig,
    type VolumePolicyEntry,
  } from '../lib/api.js';
  import ArmedActionButton from './ArmedActionButton.svelte';
  import VolumeIdentity from './VolumeIdentity.svelte';
  import {
    ArrowRightLeft,
    FolderOpen,
    HardDrive,
    Plus,
    Search,
    Shield,
    Trash2,
    WandSparkles,
  } from 'lucide-svelte';

  let {
    mode = 'volume',
    volumeId = null,
    currentVolumePresentation = null,
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
    discoveryDetails?: ReconcileSourcesResponse | null;
    refreshToken?: number;
    focusSection?: 'discovery' | 'defaults' | null;
  }>();

  const DISMISSED_DISCOVERY_KEY = 'nearbytes-source-discovery-dismissed-v1';
  const RESERVE_OPTIONS = [0, 5, 10, 15, 20, 25, 30];
  const DEFAULT_RESERVE_PERCENT = 5;
  const DEFAULT_DESTINATION: VolumeDestinationConfig = {
    sourceId: '',
    enabled: true,
    storeEvents: true,
    storeBlocks: true,
    copySourceBlocks: true,
    reservePercent: DEFAULT_RESERVE_PERCENT,
    fullPolicy: 'block-writes',
  };

  let configPath = $state<string | null>(null);
  let configDraft = $state<RootsConfig | null>(null);
  let runtime = $state<RootsRuntimeSnapshot | null>(null);
  let loading = $state(true);
  let saving = $state(false);
  let errorMessage = $state('');
  let successMessage = $state('');
  let discoveryOpen = $state(false);
  let discoveryLoading = $state(false);
  let discoveredSources = $state<DiscoveredNearbytesSource[]>([]);
  let dismissedDiscoveries = $state<string[]>(loadDismissedDiscoveries());
  let mergeSourceId = $state<string | null>(null);
  let mergeCandidates = $state<RootConsolidationCandidate[]>([]);
  let mergeTargetId = $state('');
  let mergeLoading = $state(false);
  let mergeApplying = $state(false);
  let mergeMessage = $state('');
  let autosaveStatus = $state<'idle' | 'pending' | 'saving' | 'saved' | 'error'>('idle');
  let lastSavedSignature = $state('');
  let lastRefreshToken = $state(0);
  let lastFocusSection = $state<'discovery' | 'defaults' | null>(null);
  let discoveryDetailsElement = $state<HTMLElement | null>(null);
  let defaultsSectionElement = $state<HTMLElement | null>(null);
  onMount(() => {
    void loadPanel();
  });

  $effect(() => {
    if (refreshToken === 0 || refreshToken === lastRefreshToken) return;
    lastRefreshToken = refreshToken;
    void loadPanel();
  });

  $effect(() => {
    if (!focusSection || focusSection === lastFocusSection) return;
    lastFocusSection = focusSection;
    void tick().then(() => {
      const target = focusSection === 'discovery' ? discoveryDetailsElement : defaultsSectionElement;
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  $effect(() => {
    persistDismissedDiscoveries(dismissedDiscoveries);
  });

  $effect(() => {
    if (!configDraft || loading) return;
    const nextSignature = serializeConfig(configDraft);
    if (nextSignature === lastSavedSignature) return;
    autosaveStatus = 'pending';
    const timer = setTimeout(() => {
      void autosavePanel(nextSignature);
    }, 450);
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
      // ignore
    }
  }

  function cloneConfig(config: RootsConfig): RootsConfig {
    return {
      version: 2,
      sources: config.sources.map((source) => ({
        ...source,
        reservePercent: source.reservePercent ?? DEFAULT_RESERVE_PERCENT,
      })),
      defaultVolume: {
        destinations: config.defaultVolume.destinations.map((destination) => ({
          ...destination,
          reservePercent: destination.reservePercent ?? DEFAULT_RESERVE_PERCENT,
        })),
      },
      volumes: config.volumes.map((volume) => ({
        volumeId: volume.volumeId,
        destinations: volume.destinations.map((destination) => ({
          ...destination,
          reservePercent: destination.reservePercent ?? DEFAULT_RESERVE_PERCENT,
        })),
      })),
    };
  }

  function serializeConfig(config: RootsConfig): string {
    return JSON.stringify(config);
  }

  function normalizeComparablePath(value: string): string {
    return value.trim().replace(/\\/g, '/').replace(/\/+$/u, '').toLowerCase();
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
    return 'Local';
  }

  function compactPath(value: string): string {
    const normalized = value.trim().replace(/\\/g, '/');
    if (normalized === '') return 'New source';
    const parts = normalized.split('/').filter((part) => part.length > 0);
    return parts.at(-1) ?? normalized;
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

  function sourceReservePercent(source: SourceConfigEntry): number {
    return Number.isFinite(source.reservePercent) ? source.reservePercent : DEFAULT_RESERVE_PERCENT;
  }

  function destinationReservePercent(destination: VolumeDestinationConfig | null): number {
    return Number.isFinite(destination?.reservePercent) ? destination!.reservePercent : DEFAULT_RESERVE_PERCENT;
  }

  function volumeShortLabel(value: string | null): string {
    if (!value) return 'New space';
    if (value.length <= 18) return value;
    return `${value.slice(0, 10)}...${value.slice(-6)}`;
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
      opportunisticPolicy: 'drop-older-blocks',
    };
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

  function hasDurableDestination(targetVolumeId: string | null): boolean {
    if (!configDraft) return false;
    return configDraft.sources.some((source) => isDurableDestination(destinationFor(targetVolumeId, source.id), source.id));
  }

  function protectionTone(destination: VolumeDestinationConfig | null, sourceId: string): 'durable' | 'replica' | 'events' | 'off' {
    if (!destination || !destination.enabled) return 'off';
    if (isDurableDestination(destination, sourceId)) return 'durable';
    if (keepsFullCopy(destination)) return 'replica';
    return 'off';
  }

  function protectionLabel(destination: VolumeDestinationConfig | null, sourceId: string): string {
    const tone = protectionTone(destination, sourceId);
    if (tone === 'durable') return 'Protected here';
    if (tone === 'replica') return 'Spare copy';
    return 'Off';
  }

  function volumeBadgeText(targetVolumeId: string | null): string {
    return hasDurableDestination(targetVolumeId) ? 'Protected somewhere' : 'Needs one protected copy';
  }

  function autosaveLabel(): string {
    if (autosaveStatus === 'saving') return 'Saving…';
    if (autosaveStatus === 'saved') return 'Saved';
    if (autosaveStatus === 'error') return 'Save failed';
    if (autosaveStatus === 'pending') return 'Autosave';
    return 'Autosave';
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

  function canReuseOtherGuaranteedCopies(destination: VolumeDestinationConfig | null): boolean {
    return keepsFullCopy(destination) && destination?.fullPolicy === 'drop-older-blocks';
  }

  function fullPolicyLabel(destination: VolumeDestinationConfig | null): string {
    return canReuseOtherGuaranteedCopies(destination)
      ? 'Prefer another protected copy'
      : 'Keep this copy';
  }

  function protectedCopyHint(targetVolumeId: string | null): string {
    if (hasDurableDestination(targetVolumeId)) {
      return 'Suggestion: you can keep one spare copy on a second location if you want quicker recovery.';
    }
    return 'Suggestion: turn on “Keep a full copy” for at least one writable location.';
  }

  function setReuseOtherGuaranteedCopies(
    targetVolumeId: string | null,
    sourceId: string,
    reuse: boolean
  ): void {
    updateDestinationField(
      targetVolumeId,
      sourceId,
      'fullPolicy',
      reuse ? 'drop-older-blocks' : 'block-writes'
    );
  }

  function sourceSuggestionRows(): Array<{
    source: DiscoveredNearbytesSource;
    alreadyAdded: boolean;
    dismissed: boolean;
  }> {
    if (!configDraft) return [];
    const unique = new Map<string, DiscoveredNearbytesSource>();
    for (const source of discoveredSources) {
      const key = normalizeComparablePath(source.path);
      const current = unique.get(key);
      if (!current || sourceSuggestionPriority(source.sourceType) < sourceSuggestionPriority(current.sourceType)) {
        unique.set(key, source);
      }
    }

    return Array.from(unique.values())
      .map((source) => {
        const normalized = normalizeComparablePath(source.path);
        return {
          source,
          alreadyAdded: configDraft.sources.some((entry) => normalizeComparablePath(entry.path) === normalized),
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

  function mountedPresentationFor(targetVolumeId: string) {
    if (currentVolumePresentation?.volumeId === targetVolumeId) {
      return currentVolumePresentation;
    }
    return null;
  }

  function hasSourcePath(source: SourceConfigEntry): boolean {
    return source.path.trim() !== '';
  }

  function sourceSuggestionPriority(value: DiscoveredNearbytesSource['sourceType']): number {
    if (value === 'marker') return 0;
    if (value === 'layout') return 1;
    return 2;
  }

  function discoveryGroups(): Array<{
    provider: SourceProvider;
    items: ReconcileSourcesResponse['items'];
  }> {
    if (!discoveryDetails) return [];
    const grouped = new Map<SourceProvider, ReconcileSourcesResponse['items']>();
    for (const item of discoveryDetails.items) {
      const current = grouped.get(item.provider) ?? ([] as ReconcileSourcesResponse['items']);
      current.push(item);
      grouped.set(item.provider, current);
    }
    return Array.from(grouped.entries())
      .map(([provider, items]) => ({
        provider,
        items: [...items].sort((left, right) => left.path.localeCompare(right.path)),
      }))
      .sort((left, right) => formatProvider(left.provider).localeCompare(formatProvider(right.provider)));
  }

  function discoveryActionLabel(action: DiscoveryAction): string {
    if (action === 'added-source') return 'Location added';
    if (action === 'added-volume-target') return 'Sync enabled';
    if (action === 'available-share') return 'Needs review';
    return 'Already known';
  }

  function shortVolumeId(value: string): string {
    if (value.length <= 18) return value;
    return `${value.slice(0, 10)}...${value.slice(-6)}`;
  }

  async function openDiscoverySource(item: ReconcileSourcesResponse['items'][number]) {
    if (!item.configuredSourceId) return;
    await openSourceFolder(item.configuredSourceId);
  }

  function sortedUsageVolumes(sourceId: string) {
    const source = sourceStatus(sourceId);
    return [...(source?.usage.volumeUsages ?? [])].sort((left, right) => {
      const leftTotal = left.fileBytes + left.historyBytes;
      const rightTotal = right.fileBytes + right.historyBytes;
      if (rightTotal !== leftTotal) {
        return rightTotal - leftTotal;
      }
      return right.fileCount + right.historyFileCount - (left.fileCount + left.historyFileCount);
    });
  }

  async function loadPanel() {
    loading = true;
    errorMessage = '';
    successMessage = '';
    try {
      const response = await getRootsConfig();
      configPath = response.configPath;
      configDraft = cloneConfig(response.config);
      runtime = response.runtime;
      lastSavedSignature = serializeConfig(cloneConfig(response.config));
      autosaveStatus = 'idle';
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Failed to load location settings';
    } finally {
      loading = false;
    }
  }

  async function autosavePanel(expectedSignature: string) {
    if (!configDraft) return;
    saving = true;
    errorMessage = '';
    autosaveStatus = 'saving';
    try {
      const response = await updateRootsConfig(configDraft);
      configPath = response.configPath;
      configDraft = cloneConfig(response.config);
      runtime = response.runtime;
      lastSavedSignature = serializeConfig(cloneConfig(response.config));
      if (lastSavedSignature === expectedSignature) {
        autosaveStatus = 'saved';
      } else {
        autosaveStatus = 'pending';
      }
      successMessage = '';
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Failed to save';
      autosaveStatus = 'error';
    } finally {
      saving = false;
    }
  }

  async function toggleDiscovery() {
    discoveryOpen = !discoveryOpen;
    if (!discoveryOpen) return;
    discoveryLoading = true;
    errorMessage = '';
    try {
      const response = await discoverSources();
      discoveredSources = response.sources;
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Failed to scan folders';
    } finally {
      discoveryLoading = false;
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
        successMessage = 'Already added.';
        return;
      }
      configDraft = {
        ...configDraft,
        sources: [...configDraft.sources, createSource(selectedPath)],
      };
      successMessage = 'Added location.';
      return;
    }
    configDraft = {
      ...configDraft,
      sources: [...configDraft.sources, createSource()],
    };
  }

  async function chooseSourceFolder(sourceId: string): Promise<void> {
    if (!configDraft) return;
    const source = configDraft.sources.find((entry) => entry.id === sourceId);
    const selectedPath = await pickFolderPath(source?.path ?? '');
    if (!selectedPath) return;
    const normalized = normalizeComparablePath(selectedPath);
    const duplicate = configDraft.sources.find(
      (entry) => entry.id !== sourceId && normalizeComparablePath(entry.path) === normalized
    );
    if (duplicate) {
      errorMessage = 'That folder is already in the list.';
      return;
    }
    updateSourceField(sourceId, 'path', selectedPath);
    successMessage = 'Folder selected.';
  }

  function addDiscoveredSource(source: DiscoveredNearbytesSource) {
    if (!configDraft) return;
    const normalized = normalizeComparablePath(source.path);
    if (configDraft.sources.some((entry) => normalizeComparablePath(entry.path) === normalized)) {
      successMessage = 'Already added.';
      return;
    }
    configDraft = {
      ...configDraft,
      sources: [...configDraft.sources, createSource(source.path)],
    };
    successMessage = `Added location from ${formatProvider(source.provider)}.`;
  }

  function dismissDiscovery(source: DiscoveredNearbytesSource) {
    const normalized = normalizeComparablePath(source.path);
    if (dismissedDiscoveries.includes(normalized)) return;
    dismissedDiscoveries = [...dismissedDiscoveries, normalized];
  }

  async function openSourceFolder(sourceId: string) {
    errorMessage = '';
    successMessage = '';
    try {
      await openRootInFileManager(sourceId);
      successMessage = 'Opened folder.';
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Failed to open';
    }
  }

  async function startMerge(sourceId: string) {
    mergeSourceId = sourceId;
    mergeCandidates = [];
    mergeTargetId = '';
    mergeMessage = '';
    mergeLoading = true;
    try {
      const response = await getRootConsolidationPlan(sourceId);
      mergeCandidates = response.plan.candidates.filter((candidate) => candidate.eligible);
      if (mergeCandidates.length > 0) {
        mergeTargetId = mergeCandidates[0].id;
        mergeMessage = `Move ${response.plan.source.fileCount} item(s).`;
      } else {
        mergeMessage = 'No compatible location.';
      }
    } catch (error) {
      mergeMessage = error instanceof Error ? error.message : 'Failed to prepare move';
    } finally {
      mergeLoading = false;
    }
  }

  function cancelMerge() {
    mergeSourceId = null;
    mergeCandidates = [];
    mergeTargetId = '';
    mergeLoading = false;
    mergeApplying = false;
    mergeMessage = '';
  }

  async function applyMerge() {
    if (!mergeSourceId || mergeTargetId.trim() === '') return;
    mergeApplying = true;
    errorMessage = '';
    successMessage = '';
    try {
      const response = await consolidateRoot(mergeSourceId, mergeTargetId);
      configPath = response.configPath;
      configDraft = cloneConfig(response.config);
      runtime = response.runtime;
      lastSavedSignature = serializeConfig(cloneConfig(response.config));
      autosaveStatus = 'saved';
      successMessage = 'Moved.';
      cancelMerge();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Failed to move';
    } finally {
      mergeApplying = false;
    }
  }

  function clampReserve(value: string): number {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(0, Math.min(95, parsed));
  }
</script>

{#if loading}
  <section class="storage-panel panel-surface" class:global-mode={mode === 'global'} class:volume-mode={mode === 'volume'}>
    <p class="storage-message">Loading...</p>
  </section>
{:else if configDraft}
  <section class="storage-panel panel-surface" class:global-mode={mode === 'global'} class:volume-mode={mode === 'volume'}>
    {#if mode === 'global'}
      <div class="panel-head">
        <div>
          <p class="panel-eyebrow">Locations</p>
          <h2>Storage locations</h2>
          <p class="panel-caption">Nearbytes reads from these folders. Writable ones can also receive new encrypted data.</p>
        </div>
        <div class="panel-actions">
          <button type="button" class="panel-btn subtle" onclick={toggleDiscovery} disabled={discoveryLoading}>
            <Search size={14} strokeWidth={2} />
            <span>{discoveryOpen ? 'Hide scan' : 'Find folders'}</span>
          </button>
          <button type="button" class="panel-btn subtle" onclick={addSourceCard}>
            <Plus size={14} strokeWidth={2} />
            <span>Add folder</span>
          </button>
          <span class="summary-badge" class:warning={autosaveStatus === 'error'} title="Changes are saved automatically.">
            {autosaveLabel()}
          </span>
        </div>
      </div>

      {#if errorMessage}
        <p class="panel-error">{errorMessage}</p>
      {/if}
      {#if successMessage}
        <p class="panel-success">{successMessage}</p>
      {/if}
      {#if configPath}
        <p class="panel-path">{configPath}</p>
      {/if}

      {#if discoveryDetails}
        <section class="panel-cluster discovery-details-cluster" bind:this={discoveryDetailsElement}>
          <div class="cluster-head">
            <div>
              <p class="cluster-title">Discovery details</p>
              <p class="cluster-caption">Latest automatic location scan and the changes it applied.</p>
            </div>
            <span class="summary-badge" title="Latest automatic discovery summary.">
              {discoveryDetails.summary.sourcesAdded} location(s) · {discoveryDetails.summary.volumeTargetsAdded} sync rule(s)
            </span>
          </div>
          {#if discoveryDetails.items.length === 0}
            <p class="storage-message">No Nearbytes storage locations were detected in the latest scan.</p>
          {:else}
            <div class="discovery-detail-groups">
              {#each discoveryGroups() as group (group.provider)}
                <div class="discovery-detail-group">
                  <div class="detail-group-head">
                    <p class="scan-provider">{formatProvider(group.provider)}</p>
                    <span class="mini-badge">{group.items.length}</span>
                  </div>
                  <div class="discovery-grid">
                    {#each group.items as item (item.path)}
                      <article class="scan-card detail-scan-card">
                        <div class="scan-copy">
                          <p class="scan-path">{item.path}</p>
                          <div class="source-facts compact-detail-facts">
                            <span>{item.classification === 'marker' ? 'Marker' : 'Layout'}</span>
                            {#if item.hasChannels}
                              <span>Channels</span>
                            {/if}
                            {#if item.hasBlocks}
                              <span>Blocks</span>
                            {/if}
                          </div>
                          <div class="detail-action-list">
                            {#each item.actions as action (action)}
                              <span class="mini-badge">{discoveryActionLabel(action)}</span>
                            {/each}
                          </div>
                          {#if item.addedTargetVolumeIds.length > 0}
                            <p class="detail-copy">
                              Enabled for spaces {item.addedTargetVolumeIds.map(shortVolumeId).join(', ')}.
                            </p>
                          {/if}
                          {#if item.unknownVolumeIds.length > 0}
                            <p class="detail-copy">
                              Other space directories detected: {item.unknownVolumeIds.map(shortVolumeId).join(', ')}.
                            </p>
                          {/if}
                        </div>
                        {#if item.configuredSourceId}
                          <div class="scan-actions">
                            <button type="button" class="panel-btn subtle compact" onclick={() => void openDiscoverySource(item)}>
                              <span>Open</span>
                            </button>
                          </div>
                        {/if}
                      </article>
                    {/each}
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        </section>
      {/if}

      {#if discoveryOpen}
        <section class="panel-cluster scan-cluster">
          <div class="cluster-head">
            <div>
              <p class="cluster-title">Discovered folders</p>
              <p class="cluster-caption">Marker-based discovery stays separate from your saved locations list.</p>
            </div>
            {#if dismissedSuggestionCount() > 0}
              <button type="button" class="panel-btn subtle compact" onclick={restoreDismissedSuggestions}>
                <span>Show hidden</span>
              </button>
            {/if}
          </div>
          {#if discoveryLoading}
            <p class="storage-message">Scanning...</p>
          {:else if sourceSuggestionRows().length === 0}
            <p class="storage-message">No new folders found.</p>
          {:else}
            <div class="discovery-grid">
              {#each sourceSuggestionRows() as row (row.source.path)}
                <article class="scan-card">
                  <div class="scan-copy">
                    <p class="scan-provider">{formatProvider(row.source.provider)}</p>
                    <p class="scan-path">{row.source.path}</p>
                  </div>
                  <div class="scan-actions">
                    <button type="button" class="panel-btn subtle compact" onclick={() => addDiscoveredSource(row.source)}>
                      <span>Add</span>
                    </button>
                    <button type="button" class="panel-btn subtle compact danger" onclick={() => dismissDiscovery(row.source)}>
                      <span>Hide</span>
                    </button>
                  </div>
                </article>
              {/each}
            </div>
          {/if}
        </section>
      {/if}

      <section class="panel-cluster" bind:this={defaultsSectionElement}>
        <div class="cluster-head">
          <div>
            <p class="cluster-title">Saved locations</p>
            <p class="cluster-caption">At least one location must remain connected.</p>
          </div>
          <span class="summary-badge" title="Saved locations Nearbytes can read from or write to.">
            {configDraft.sources.length} connected
          </span>
        </div>

        <div class="source-grid">
          {#each configDraft.sources as source (source.id)}
            {@const status = sourceStatus(source.id)}
            <article class="source-card">
              <div class="source-card-head">
                <div class="source-mark">
                  <HardDrive size={16} strokeWidth={2.1} />
                </div>
                <div class="source-copy">
                  <p class="source-provider">{formatProvider(source.provider)}</p>
                  <h3>{compactPath(source.path)}</h3>
                  <p class="source-path">{source.path || 'Choose a folder'}</p>
                </div>
                <div class="source-badges">
                  <span class="mini-badge" class:safe={source.enabled} class:muted={!source.enabled}>{source.enabled ? 'On' : 'Off'}</span>
                  <span class="mini-badge" class:safe={source.writable} class:muted={!source.writable}>{source.writable ? 'Write' : 'Read only'}</span>
                </div>
              </div>

              {#if hasSourcePath(source)}
                <div class="source-location-block">
                  <span class="source-location-label">Folder</span>
                  <p class="source-location-value" title={source.path}>{source.path}</p>
                </div>
              {:else}
                <button type="button" class="panel-btn subtle choose-folder-btn" onclick={() => chooseSourceFolder(source.id)}>
                  <Search size={14} strokeWidth={2} />
                  <span>Choose folder</span>
                </button>
              {/if}

              <div class="field-grid two-up">
                <label class="field-block compact-field">
                  <span>Keep free</span>
                  <select
                    class="panel-input"
                    title="Nearbytes leaves this percentage of disk space free before it starts reclaiming spare encrypted data."
                    value={String(sourceReservePercent(source))}
                    onchange={(event) =>
                      updateSourceField(source.id, 'reservePercent', clampReserve((event.currentTarget as HTMLSelectElement).value))}
                  >
                    {#each RESERVE_OPTIONS as option}
                      <option value={option}>{formatPercent(option)}</option>
                    {/each}
                  </select>
                </label>
                <label class="field-block compact-field">
                  <span>If space is still tight</span>
                  <select
                    class="panel-input"
                    title="If this disk is still full after Nearbytes has already reclaimed spare unprotected data, “Stop new data” preserves the protected copies already here and writes nothing new. “Reuse protected copies elsewhere” allows this location to free data only when another protected copy already exists somewhere else."
                    value={source.opportunisticPolicy}
                    onchange={(event) =>
                      updateSourceField(source.id, 'opportunisticPolicy', (event.currentTarget as HTMLSelectElement).value as StorageFullPolicy)}
                  >
                    <option value="block-writes">Stop new data</option>
                    <option value="drop-older-blocks">Reuse protected copies elsewhere</option>
                  </select>
                </label>
              </div>

              <div class="source-facts">
                <span>{status?.exists ? 'Ready' : 'Missing'}</span>
                <span>{source.enabled ? 'In use' : 'Ignored'}</span>
                <span>{source.writable ? 'Writable' : 'Read only'}</span>
                <span>{status?.availableBytes !== undefined ? formatSize(status.availableBytes) : 'n/a free'}</span>
              </div>

              <div class="usage-strip">
                <span>Nearbytes {formatSize(status?.usage.totalBytes ?? 0)}</span>
                <span>Files {formatSize(status?.usage.blockBytes ?? 0)}</span>
                <span>History {formatSize(status?.usage.channelBytes ?? 0)}</span>
              </div>

              {#if sortedUsageVolumes(source.id).length > 0}
                <details class="usage-details">
                  <summary
                    class="usage-details-summary"
                    title="Show which spaces are using space in this location. Entries are sorted by total Nearbytes size."
                  >
                    <span>Stored spaces</span>
                    <span class="mini-badge">{sortedUsageVolumes(source.id).length}</span>
                  </summary>
                  <div class="usage-volume-list">
                    {#each sortedUsageVolumes(source.id) as usage (usage.volumeId)}
                      {@const mountedPresentation = mountedPresentationFor(usage.volumeId)}
                      <div class="usage-volume-row">
                        <div class="usage-volume-copy">
                          <VolumeIdentity
                            compact={true}
                            label={mountedPresentation ? mountedPresentation.label : volumeShortLabel(usage.volumeId)}
                            secondary={mountedPresentation ? volumeShortLabel(usage.volumeId) : ''}
                            title={usage.volumeId}
                            filePayload={mountedPresentation?.filePayload ?? ''}
                            fileMimeType={mountedPresentation?.fileMimeType ?? ''}
                            fileName={mountedPresentation?.fileName ?? ''}
                          />
                        </div>
                        <div class="usage-volume-stats">
                          <span>{formatSize(usage.fileBytes + usage.historyBytes)} total</span>
                          {#if usage.fileBytes > 0}
                            <span>{formatSize(usage.fileBytes)} files</span>
                          {/if}
                          {#if usage.historyBytes > 0}
                            <span>{formatSize(usage.historyBytes)} history</span>
                          {/if}
                        </div>
                      </div>
                    {/each}
                  </div>
                </details>
              {/if}

              <div class="source-actions">
                <button type="button" class="panel-btn subtle compact" onclick={() => openSourceFolder(source.id)}>
                  <FolderOpen size={14} strokeWidth={2} />
                  <span>Open</span>
                </button>
                <label class="toggle-chip strong compact-inline-toggle">
                  <input type="checkbox" checked={source.enabled} onchange={(event) => updateSourceField(source.id, 'enabled', (event.currentTarget as HTMLInputElement).checked)} />
                  <span>Use location</span>
                </label>
                <label class="toggle-chip compact-inline-toggle">
                  <input type="checkbox" checked={source.writable} onchange={(event) => updateSourceField(source.id, 'writable', (event.currentTarget as HTMLInputElement).checked)} />
                  <span>Can write</span>
                </label>
                <button type="button" class="panel-btn subtle compact" onclick={() => startMerge(source.id)} disabled={configDraft.sources.length < 2}>
                  <ArrowRightLeft size={14} strokeWidth={2} />
                  <span>Move into...</span>
                </button>
                {#if canRemoveAnySource()}
                  <ArmedActionButton
                    class="panel-btn subtle compact danger"
                    icon={Trash2}
                    text="Remove"
                    armed={true}
                    autoDisarmMs={3000}
                    onPress={() => removeSource(source.id)}
                  />
                {/if}
              </div>

              {#if mergeSourceId === source.id}
                <div class="merge-box">
                  {#if mergeLoading}
                    <p class="storage-message">Finding a compatible location...</p>
                  {:else if mergeCandidates.length === 0}
                    <p class="storage-message">{mergeMessage}</p>
                  {:else}
                    <p class="merge-copy">Move this folder's stored data into another saved location, then remove it.</p>
                    <select class="panel-input" bind:value={mergeTargetId}>
                      {#each mergeCandidates as candidate (candidate.id)}
                        <option value={candidate.id}>{candidate.path}</option>
                      {/each}
                    </select>
                    <div class="merge-actions">
                      <button type="button" class="panel-btn subtle compact" onclick={cancelMerge}>Cancel</button>
                      <button type="button" class="panel-btn primary compact" onclick={applyMerge} disabled={mergeApplying || mergeTargetId.trim() === ''}>
                        <span>{mergeApplying ? 'Moving...' : 'Move'}</span>
                      </button>
                    </div>
                  {/if}
                </div>
              {/if}
            </article>
          {/each}
        </div>
      </section>

      <section class="panel-cluster">
        <div class="cluster-head">
          <div>
            <p class="cluster-title">Defaults for newly opened spaces</p>
            <p class="cluster-caption">Used only when a space does not have its own saved keep rule yet.</p>
          </div>
          <span
            class="summary-badge"
            class:warning={!hasDurableDestination(null)}
            title="A protected copy means Nearbytes will keep one full copy of the space in at least one writable location."
          >
            {volumeBadgeText(null)}
          </span>
        </div>
        <p class="panel-tip">
          <WandSparkles size={13} strokeWidth={2} />
          <span>{protectedCopyHint(null)}</span>
        </p>

        <div class="destination-grid">
          {#each configDraft.sources as source (source.id)}
            {@const destination = destinationFor(null, source.id)}
            {@const status = sourceStatus(source.id)}
            <article class="destination-card" class:safe={protectionTone(destination, source.id) === 'durable'}>
              <div class="destination-head">
                <div>
                  <p class="source-provider">{formatProvider(source.provider)}</p>
                  <h3>{compactPath(source.path)}</h3>
                  <p class="source-path">{source.path || 'Choose a folder'}</p>
                </div>
                <span
                  class={`mini-badge tone-${protectionTone(destination, source.id)}`}
                  title={keepsFullCopy(destination)
                    ? canReuseOtherGuaranteedCopies(destination)
                      ? 'This location keeps a spare full copy. If space runs tight, Nearbytes may drop it only after another protected full copy exists elsewhere.'
                      : 'This location keeps a protected full copy. Nearbytes will not reclaim it automatically.'
                    : 'This location is not currently keeping this space.'}
                >
                  {protectionLabel(destination, source.id)}
                </span>
              </div>

              <div class="compact-toggle-stack">
                <label class="toggle-chip strong large">
                  <input
                    type="checkbox"
                    checked={keepsFullCopy(destination)}
                    onchange={(event) => setKeepFullCopy(null, source.id, (event.currentTarget as HTMLInputElement).checked)}
                  />
                  <span title="Keep the full encrypted history and file blocks for this space in this location. Turning this on in more than one location may duplicate the same encrypted data.">Keep a full copy</span>
                </label>
              </div>

              <div class="field-grid two-up compact-fields">
                <label class="field-block compact-field">
                  <span>Keep free</span>
                  <select class="panel-input" disabled={!keepsFullCopy(destination)} title="Nearbytes leaves this percentage of disk space free before it starts reclaiming spare encrypted data." value={String(destination?.reservePercent ?? DEFAULT_RESERVE_PERCENT)} onchange={(event) => updateDestinationField(null, source.id, 'reservePercent', clampReserve((event.currentTarget as HTMLSelectElement).value))}>
                    {#each RESERVE_OPTIONS as option}
                      <option value={option}>{formatPercent(option)}</option>
                    {/each}
                  </select>
                </label>
                <label class="field-block compact-field">
                  <span>When full</span>
                  <select
                    class="panel-input"
                    disabled={!keepsFullCopy(destination)}
                    title="If this disk is still full after Nearbytes has already reclaimed spare unprotected data, “Keep this copy” stops placing new data here to preserve this full copy. “Prefer another protected copy” allows this location to free this full copy, but only after another protected full copy exists elsewhere."
                    value={destination?.fullPolicy ?? 'block-writes'}
                    onchange={(event) =>
                      updateDestinationField(null, source.id, 'fullPolicy', (event.currentTarget as HTMLSelectElement).value as StorageFullPolicy)}
                  >
                    <option value="block-writes">Keep this copy</option>
                    <option value="drop-older-blocks">Prefer another protected copy</option>
                  </select>
                </label>
              </div>

              <p class="card-help">
                {#if keepsFullCopy(destination)}
                  {#if canReuseOtherGuaranteedCopies(destination)}
                    This location keeps a spare copy and may yield only after another protected copy exists.
                  {:else}
                    This location keeps a protected copy that Nearbytes will not reclaim automatically.
                  {/if}
                {:else}
                  This location is not keeping this space yet.
                {/if}
              </p>

              <div class="source-facts">
                <span>{source.enabled ? 'Location on' : 'Location off'}</span>
                <span>{source.writable ? 'Can write' : 'Read only'}</span>
                <span>{status?.availableBytes !== undefined ? formatSize(status.availableBytes) : 'n/a free'}</span>
              </div>
            </article>
          {/each}
        </div>
      </section>
    {:else}
      <div class="panel-actions compact-actions">
        <button type="button" class="panel-btn subtle compact" onclick={toggleDiscovery} disabled={discoveryLoading}>
          <Search size={14} strokeWidth={2} />
          <span>{discoveryOpen ? 'Hide scan' : 'Find folders'}</span>
        </button>
        <button type="button" class="panel-btn subtle compact" onclick={addSourceCard}>
          <Plus size={14} strokeWidth={2} />
          <span>Add folder</span>
        </button>
        <span class="summary-badge" class:warning={autosaveStatus === 'error'} title="Changes are saved automatically.">
          {autosaveLabel()}
        </span>
        {#if volumeId}
          <span
            class="summary-badge"
            class:warning={!hasDurableDestination(volumeId)}
            title="A protected copy means Nearbytes will keep one full copy of this space in at least one writable location."
          >
            {volumeBadgeText(volumeId)}
          </span>
        {/if}
      </div>
      {#if volumeId}
        <p class="panel-tip">
          <WandSparkles size={13} strokeWidth={2} />
          <span>{protectedCopyHint(volumeId)}</span>
        </p>
      {/if}

      {#if errorMessage}
        <p class="panel-error">{errorMessage}</p>
      {/if}
      {#if successMessage}
        <p class="panel-success">{successMessage}</p>
      {/if}

      {#if discoveryOpen}
        <section class="panel-cluster scan-cluster compact-scan">
          <div class="cluster-head">
            <div>
              <p class="cluster-title">Discovered folders</p>
              <p class="cluster-caption">Add a found folder right here without leaving this sheet.</p>
            </div>
          </div>
          {#if discoveryLoading}
            <p class="storage-message">Scanning...</p>
          {:else if sourceSuggestionRows().length === 0}
            <p class="storage-message">No new folders found.</p>
          {:else}
            <div class="discovery-grid">
              {#each sourceSuggestionRows() as row (row.source.path)}
                <article class="scan-card">
                  <div class="scan-copy">
                    <p class="scan-provider">{formatProvider(row.source.provider)}</p>
                    <p class="scan-path">{row.source.path}</p>
                  </div>
                  <div class="scan-actions">
                    <button type="button" class="panel-btn subtle compact" onclick={() => addDiscoveredSource(row.source)}>
                      <span>Add</span>
                    </button>
                    <button type="button" class="panel-btn subtle compact danger" onclick={() => dismissDiscovery(row.source)}>
                      <span>Hide</span>
                    </button>
                  </div>
                </article>
              {/each}
            </div>
          {/if}
        </section>
      {/if}

      {#if !volumeId}
        <p class="storage-message">Open this space first, then choose which locations keep a full copy.</p>
      {:else}
        <div class="destination-grid compact-destination-grid">
          {#each configDraft.sources as source (source.id)}
            {@const destination = destinationFor(volumeId, source.id)}
            {@const status = sourceStatus(source.id)}
            <article class="destination-card compact-destination-card" class:safe={protectionTone(destination, source.id) === 'durable'}>
              <div class="destination-head">
                <div>
                  <p class="source-provider">{formatProvider(source.provider)}</p>
                  <h3>{compactPath(source.path)}</h3>
                  <p class="source-path">{source.path || 'Choose a folder'}</p>
                </div>
                <span
                  class={`mini-badge tone-${protectionTone(destination, source.id)}`}
                  title={keepsFullCopy(destination)
                    ? canReuseOtherGuaranteedCopies(destination)
                      ? 'This location keeps a spare full copy. If space runs tight, Nearbytes may drop it only after another protected full copy exists elsewhere.'
                      : 'This location keeps a protected full copy. Nearbytes will not reclaim it automatically.'
                    : 'This location is not currently keeping this space.'}
                >
                  {protectionLabel(destination, source.id)}
                </span>
              </div>

              <label class="field-block compact-field">
                <span>Folder</span>
                {#if hasSourcePath(source)}
                  <div class="source-location-block compact">
                    <p class="source-location-value" title={source.path}>{source.path}</p>
                  </div>
                {:else}
                  <button type="button" class="panel-btn subtle compact choose-folder-btn" onclick={() => chooseSourceFolder(source.id)}>
                    <Search size={14} strokeWidth={2} />
                    <span>Choose folder</span>
                  </button>
                {/if}
              </label>

              <label class="toggle-chip strong large">
                <input
                  type="checkbox"
                  checked={keepsFullCopy(destination)}
                  onchange={(event) => setKeepFullCopy(volumeId, source.id, (event.currentTarget as HTMLInputElement).checked)}
                />
                <span title="Keep the full encrypted history and file blocks for this space in this location. Turning this on in more than one location may duplicate the same encrypted data.">Keep a full copy</span>
              </label>

              <label class="field-block compact-field">
                <span>Keep free</span>
                <select class="panel-input" disabled={!keepsFullCopy(destination)} title="Nearbytes leaves this percentage of disk space free before it starts reclaiming spare encrypted data." value={String(destinationReservePercent(destination))} onchange={(event) => updateDestinationField(volumeId, source.id, 'reservePercent', clampReserve((event.currentTarget as HTMLSelectElement).value))}>
                  {#each RESERVE_OPTIONS as option}
                    <option value={option}>{formatPercent(option)}</option>
                  {/each}
                </select>
              </label>

              <label class="field-block compact-field">
                <span>When full</span>
                <select
                  class="panel-input"
                  disabled={!keepsFullCopy(destination)}
                  title="If this disk is still full after Nearbytes has already reclaimed spare unprotected data, “Keep this copy” stops placing new data here to preserve this full copy. “Prefer another protected copy” allows this location to free this full copy, but only after another protected full copy exists elsewhere."
                  value={destination?.fullPolicy ?? 'block-writes'}
                  onchange={(event) =>
                    updateDestinationField(volumeId, source.id, 'fullPolicy', (event.currentTarget as HTMLSelectElement).value as StorageFullPolicy)}
                >
                  <option value="block-writes">Keep this copy</option>
                  <option value="drop-older-blocks">Prefer another protected copy</option>
                </select>
              </label>

              <p class="card-help">
                {#if keepsFullCopy(destination)}
                  {#if canReuseOtherGuaranteedCopies(destination)}
                    This location keeps a spare copy and may yield only after another protected copy exists.
                  {:else}
                    This location keeps a protected copy that Nearbytes will not reclaim automatically.
                  {/if}
                {:else}
                  This location is not keeping this space yet.
                {/if}
              </p>

              <div class="source-facts">
                <span>{status?.availableBytes !== undefined ? formatSize(status.availableBytes) : 'n/a free'}</span>
                <span>{source.enabled ? 'Location on' : 'Location off'}</span>
                <span>{source.writable ? 'Can write' : 'Read only'}</span>
              </div>

              <div class="source-actions compact-source-actions">
                <button type="button" class="panel-btn subtle compact" onclick={() => openSourceFolder(source.id)}>
                  <FolderOpen size={14} strokeWidth={2} />
                  <span>Open</span>
                </button>
                {#if canRemoveAnySource()}
                  <ArmedActionButton
                    class="panel-btn subtle compact danger"
                    icon={Trash2}
                    text="Remove"
                    armed={true}
                    autoDisarmMs={3000}
                    onPress={() => removeSource(source.id)}
                  />
                {/if}
              </div>
            </article>
          {/each}
          <button type="button" class="add-source-card" onclick={addSourceCard}>
            <Plus size={18} strokeWidth={2} />
            <span>Add folder</span>
          </button>
        </div>

        {#if explicitVolumePolicy(volumeId)}
          <div class="detail-head-actions">
            <ArmedActionButton
              class="panel-btn subtle compact danger"
              icon={Trash2}
              text="Forget saved space rule"
              armed={true}
              autoDisarmMs={3000}
              onPress={() => removeVolumePolicy(volumeId)}
            />
          </div>
        {/if}
      {/if}
    {/if}
  </section>
{/if}

<style>
  .storage-panel {
    display: grid;
    gap: 1rem;
    padding: 1rem;
    width: 100%;
    min-height: 0;
    border: 1px solid rgba(56, 189, 248, 0.18);
    border-radius: 20px;
    background:
      radial-gradient(130% 130% at 0% 0%, rgba(34, 211, 238, 0.08), transparent 46%),
      linear-gradient(180deg, rgba(8, 17, 31, 0.96), rgba(7, 14, 28, 0.94));
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.04),
      0 20px 44px rgba(2, 6, 23, 0.2);
  }

  .storage-panel.global-mode,
  .storage-panel.volume-mode {
    overflow: auto;
    scrollbar-width: thin;
  }

  .panel-head,
  .cluster-head,
  .source-card-head,
  .source-actions,
  .panel-actions,
  .chip-row,
  .source-facts,
  .detail-head-actions,
  .merge-actions,
  .scan-actions,
  .destination-head {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .panel-head,
  .cluster-head {
    justify-content: space-between;
  }

  .panel-eyebrow,
  .cluster-title,
  .source-provider,
  .scan-provider {
    margin: 0;
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.16em;
    color: rgba(94, 234, 212, 0.88);
  }

  h2,
  h3,
  .panel-caption,
  .panel-path,
  .cluster-caption,
  .storage-message,
  .source-path,
  .merge-copy,
  .volume-card-name,
  .volume-card-meta,
  .detail-note,
  .scan-path {
    margin: 0;
  }

  h2 {
    margin-top: 0.24rem;
    font-size: 1.2rem;
    color: rgba(240, 249, 255, 0.96);
  }

  h3 {
    font-size: 0.98rem;
    color: rgba(240, 249, 255, 0.96);
  }

  .panel-caption,
  .panel-path,
  .cluster-caption,
  .storage-message,
  .source-path,
  .merge-copy,
  .detail-note,
  .scan-path,
  .volume-card-meta {
    font-size: 0.82rem;
    color: rgba(186, 230, 253, 0.72);
  }

  .panel-path {
    font-family: 'Monaco', 'Menlo', monospace;
    font-size: 0.74rem;
    word-break: break-all;
  }

  .panel-error,
  .panel-success {
    margin: 0;
    font-size: 0.82rem;
    border-radius: 12px;
    padding: 0.68rem 0.82rem;
  }

  .panel-error {
    color: rgba(254, 202, 202, 0.96);
    background: rgba(127, 29, 29, 0.28);
    border: 1px solid rgba(248, 113, 113, 0.22);
  }

  .panel-success {
    color: rgba(209, 250, 229, 0.96);
    background: rgba(6, 78, 59, 0.26);
    border: 1px solid rgba(45, 212, 191, 0.22);
  }

  .panel-tip {
    margin: 0;
    display: inline-flex;
    align-items: center;
    gap: 0.46rem;
    font-size: 0.78rem;
    color: rgba(204, 251, 241, 0.9);
    padding: 0.7rem 0.82rem;
    border-radius: 12px;
    border: 1px solid rgba(45, 212, 191, 0.16);
    background: rgba(8, 56, 49, 0.2);
  }

  .panel-cluster,
  .detail-shell {
    display: grid;
    gap: 0.85rem;
    padding: 0.9rem;
    border-radius: 16px;
    border: 1px solid rgba(56, 189, 248, 0.12);
    background: rgba(7, 15, 28, 0.52);
  }

  .summary-badge,
  .mini-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 26px;
    padding: 0 0.7rem;
    border-radius: 999px;
    border: 1px solid rgba(56, 189, 248, 0.18);
    background: rgba(11, 21, 38, 0.72);
    color: rgba(186, 230, 253, 0.9);
    font-size: 0.72rem;
    font-weight: 600;
    white-space: nowrap;
  }

  .summary-badge.warning,
  .volume-card-badge.warning,
  .mini-badge.tone-off {
    border-color: rgba(251, 191, 36, 0.28);
    color: rgba(254, 240, 138, 0.96);
    background: rgba(71, 55, 18, 0.42);
  }

  .mini-badge.safe,
  .volume-card-badge.safe,
  .mini-badge.tone-durable {
    border-color: rgba(45, 212, 191, 0.28);
    color: rgba(204, 251, 241, 0.96);
    background: rgba(10, 58, 58, 0.44);
  }

  .mini-badge.muted,
  .mini-badge.tone-events,
  .mini-badge.tone-replica {
    border-color: rgba(96, 165, 250, 0.2);
    color: rgba(191, 219, 254, 0.88);
    background: rgba(15, 23, 42, 0.42);
  }

  .panel-btn,
  :global(.panel-btn) {
    border: 1px solid rgba(56, 189, 248, 0.22);
    background: rgba(12, 24, 43, 0.82);
    color: rgba(226, 232, 240, 0.92);
    border-radius: 12px;
    min-height: 34px;
    padding: 0 0.86rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.46rem;
    font-size: 0.78rem;
    font-weight: 600;
    line-height: 1;
    cursor: pointer;
    transition: background-color 0.18s ease, border-color 0.18s ease, color 0.18s ease, transform 0.18s ease;
  }

  .panel-btn.compact,
  :global(.panel-btn.compact) {
    min-height: 30px;
    padding: 0 0.72rem;
    font-size: 0.74rem;
  }

  .panel-btn.icon-only,
  :global(.panel-btn.icon-only) {
    min-width: 30px;
    width: 30px;
    padding: 0;
  }

  .panel-btn:hover:not(:disabled),
  :global(.panel-btn:hover:not(:disabled)) {
    transform: translateY(-1px);
    border-color: rgba(96, 165, 250, 0.34);
    background: rgba(16, 32, 56, 0.92);
  }

  .panel-btn.primary,
  :global(.panel-btn.primary) {
    border-color: rgba(45, 212, 191, 0.26);
    background: linear-gradient(180deg, rgba(10, 76, 70, 0.92), rgba(8, 54, 52, 0.96));
    color: rgba(240, 253, 250, 0.98);
  }

  .panel-btn.danger,
  :global(.panel-btn.danger) {
    border-color: rgba(248, 113, 113, 0.24);
    background: rgba(67, 20, 20, 0.62);
    color: rgba(254, 226, 226, 0.95);
  }

  :global(.panel-btn.danger.armed) {
    border-color: rgba(252, 165, 165, 0.84);
    background: linear-gradient(180deg, rgba(220, 38, 38, 0.86), rgba(153, 27, 27, 0.92));
    color: #fff5f5;
  }

  .field-block {
    display: grid;
    gap: 0.34rem;
    min-width: 0;
  }

  .field-block span {
    font-size: 0.7rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: rgba(148, 163, 184, 0.86);
  }

  .panel-input {
    width: 100%;
    min-height: 38px;
    border-radius: 12px;
    border: 1px solid rgba(56, 189, 248, 0.2);
    background: rgba(9, 18, 33, 0.82);
    color: rgba(226, 232, 240, 0.96);
    padding: 0 0.8rem;
    font-size: 0.84rem;
    outline: none;
  }

  .panel-input:focus {
    border-color: rgba(56, 189, 248, 0.5);
    box-shadow: 0 0 0 3px rgba(14, 165, 233, 0.12);
  }

  .panel-input:disabled {
    opacity: 0.54;
    cursor: not-allowed;
  }

  .input-with-action {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 0.5rem;
    align-items: center;
  }

  .field-grid {
    display: grid;
    gap: 0.7rem;
  }

  .field-grid.two-up {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .source-location-block {
    display: grid;
    gap: 0.2rem;
    padding: 0.72rem 0.8rem;
    border-radius: 12px;
    border: 1px solid rgba(56, 189, 248, 0.12);
    background: rgba(9, 18, 33, 0.5);
  }

  .source-location-block.compact {
    padding: 0.62rem 0.72rem;
  }

  .source-location-label {
    font-size: 0.68rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: rgba(148, 163, 184, 0.82);
  }

  .source-location-value {
    margin: 0;
    font-size: 0.8rem;
    color: rgba(226, 232, 240, 0.94);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .choose-folder-btn {
    width: 100%;
    justify-content: center;
  }

  .source-grid,
  .destination-grid,
  .discovery-grid {
    display: grid;
    gap: 0.85rem;
  }

  .source-grid {
    grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
  }

  .destination-grid {
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  }

  .discovery-detail-groups {
    display: grid;
    gap: 0.85rem;
  }

  .discovery-detail-group {
    display: grid;
    gap: 0.65rem;
  }

  .detail-group-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.65rem;
  }

  .discovery-grid {
    grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
  }

  .scan-card,
  .source-card,
  .destination-card {
    border-radius: 16px;
    border: 1px solid rgba(56, 189, 248, 0.14);
    background: rgba(8, 17, 31, 0.74);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
  }

  .scan-card,
  .source-card,
  .destination-card {
    padding: 0.92rem;
  }

  .scan-card,
  .source-card,
  .destination-card,
  .source-copy,
  .scan-copy {
    display: grid;
    gap: 0.7rem;
  }

  .scan-card {
    grid-template-columns: minmax(0, 1fr);
  }

  .detail-scan-card {
    gap: 0.75rem;
  }

  .source-card-head {
    align-items: flex-start;
    justify-content: space-between;
  }

  .source-mark {
    width: 34px;
    height: 34px;
    border-radius: 12px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid rgba(56, 189, 248, 0.2);
    background: rgba(10, 24, 42, 0.78);
    color: rgba(148, 163, 184, 0.96);
    flex: 0 0 auto;
  }

  .source-copy {
    min-width: 0;
    flex: 1 1 auto;
  }

  .compact-inline-toggle {
    min-height: 28px;
  }

  .source-badges {
    display: flex;
    gap: 0.45rem;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .source-path,
  .scan-path {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chip-row {
    gap: 0.5rem;
  }

  .chip-row.dense {
    gap: 0.46rem;
  }

  .toggle-chip {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 0.48rem;
    min-height: 30px;
    padding: 0 0.74rem;
    border-radius: 999px;
    border: 1px solid rgba(56, 189, 248, 0.18);
    background: rgba(10, 19, 34, 0.56);
    color: rgba(226, 232, 240, 0.86);
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
    user-select: none;
  }

  .toggle-chip input {
    accent-color: #2dd4bf;
    margin: 0;
  }

  .toggle-chip.strong {
    border-color: rgba(45, 212, 191, 0.24);
    color: rgba(240, 253, 250, 0.96);
  }

  .toggle-chip.large {
    min-height: 36px;
    padding: 0.28rem 0.84rem;
    align-items: center;
    justify-content: flex-start;
  }

  .compact-toggle-stack {
    display: grid;
    gap: 0.55rem;
  }

  .source-facts {
    font-size: 0.76rem;
    color: rgba(186, 230, 253, 0.72);
    justify-content: space-between;
  }

  .compact-detail-facts {
    justify-content: flex-start;
    gap: 0.45rem;
  }

  .detail-action-list {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-wrap: wrap;
  }

  .detail-copy {
    margin: 0;
    font-size: 0.75rem;
    line-height: 1.35;
    color: rgba(186, 230, 253, 0.74);
  }

  .compact-source-actions {
    justify-content: flex-end;
  }

  .card-help {
    margin: 0;
    font-size: 0.75rem;
    line-height: 1.35;
    color: rgba(186, 230, 253, 0.72);
  }

  .usage-strip,
  .usage-volume-stats {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    flex-wrap: wrap;
  }

  .usage-strip {
    font-size: 0.74rem;
    color: rgba(191, 219, 254, 0.78);
  }

  .usage-volume-list {
    display: grid;
    gap: 0.4rem;
    padding-top: 0.1rem;
  }

  .usage-details {
    display: grid;
    gap: 0.55rem;
    padding-top: 0.1rem;
  }

  .usage-details[open] {
    padding-top: 0.25rem;
  }

  .usage-details-summary {
    list-style: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.7rem;
    cursor: pointer;
    font-size: 0.76rem;
    font-weight: 600;
    color: rgba(226, 232, 240, 0.92);
    padding: 0.58rem 0.68rem;
    border-radius: 12px;
    border: 1px solid rgba(56, 189, 248, 0.12);
    background: rgba(9, 18, 33, 0.44);
  }

  .usage-details-summary::-webkit-details-marker {
    display: none;
  }

  .usage-volume-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.7rem;
    padding: 0.56rem 0.68rem;
    border-radius: 12px;
    border: 1px solid rgba(56, 189, 248, 0.1);
    background: rgba(9, 18, 33, 0.48);
  }

  .usage-volume-copy {
    min-width: 0;
    display: grid;
    gap: 0.1rem;
  }

  .usage-volume-name,
  .usage-volume-meta {
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .usage-volume-name {
    font-size: 0.78rem;
    font-weight: 600;
    color: rgba(240, 249, 255, 0.94);
  }

  .usage-volume-meta,
  .usage-volume-stats {
    font-size: 0.72rem;
    color: rgba(186, 230, 253, 0.68);
  }

  .merge-box {
    display: grid;
    gap: 0.72rem;
    padding-top: 0.2rem;
    border-top: 1px solid rgba(56, 189, 248, 0.1);
  }

  .volume-card {
    display: grid;
    gap: 0.72rem;
    align-content: space-between;
    min-height: 168px;
    padding: 0.9rem;
    text-align: left;
    cursor: pointer;
    transition: transform 0.18s ease, border-color 0.18s ease, background-color 0.18s ease, box-shadow 0.18s ease;
  }

  .volume-card:hover {
    transform: translateY(-1px);
    border-color: rgba(96, 165, 250, 0.26);
    background: rgba(10, 22, 40, 0.86);
  }

  .volume-card.active {
    border-color: rgba(34, 211, 238, 0.42);
    background:
      radial-gradient(140% 120% at 0% 0%, rgba(34, 211, 238, 0.12), transparent 44%),
      rgba(10, 22, 40, 0.9);
    box-shadow: 0 16px 32px rgba(2, 6, 23, 0.24);
  }

  .volume-card.default-card {
    border-style: dashed;
  }

  .volume-card-copy {
    display: grid;
    gap: 0.28rem;
    min-width: 0;
  }

  .volume-card-name {
    font-size: 0.92rem;
    font-weight: 700;
    color: rgba(240, 249, 255, 0.96);
  }

  .volume-card-badge {
    align-self: end;
    justify-self: start;
    display: inline-flex;
    align-items: center;
    min-height: 24px;
    padding: 0 0.64rem;
    border-radius: 999px;
    border: 1px solid rgba(56, 189, 248, 0.18);
    font-size: 0.7rem;
    font-weight: 700;
  }

  .destination-card.safe {
    border-color: rgba(45, 212, 191, 0.22);
    background:
      radial-gradient(140% 120% at 0% 0%, rgba(45, 212, 191, 0.08), transparent 48%),
      rgba(8, 17, 31, 0.78);
  }

  .compact-destination-grid {
    grid-template-columns: repeat(auto-fit, minmax(220px, 250px));
  }

  .compact-destination-card {
    display: grid;
    gap: 0.72rem;
    align-content: start;
    min-height: 248px;
  }

  .compact-actions {
    justify-content: flex-end;
  }

  .add-source-card {
    border: 1px dashed rgba(56, 189, 248, 0.24);
    border-radius: 16px;
    background: rgba(9, 18, 33, 0.48);
    color: rgba(191, 219, 254, 0.84);
    min-height: 248px;
    display: grid;
    align-content: center;
    justify-items: center;
    gap: 0.55rem;
    cursor: pointer;
    font-size: 0.84rem;
    font-weight: 700;
    transition: transform 0.18s ease, border-color 0.18s ease, background-color 0.18s ease;
  }

  .add-source-card:hover {
    transform: translateY(-1px);
    border-color: rgba(96, 165, 250, 0.34);
    background: rgba(12, 24, 43, 0.72);
  }

  .card-side-note {
    display: grid;
    gap: 0.18rem;
    align-content: start;
    padding: 0.2rem 0;
  }

  .card-side-note-label {
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: rgba(186, 230, 253, 0.72);
  }

  .card-side-note-copy {
    font-size: 0.75rem;
    line-height: 1.3;
    color: rgba(186, 230, 253, 0.68);
  }

  .detail-head-actions {
    justify-content: flex-end;
    margin-left: auto;
  }

  @media (max-width: 920px) {
    .panel-head,
    .cluster-head {
      align-items: flex-start;
    }

    .field-grid.two-up {
      grid-template-columns: 1fr;
    }

    .compact-destination-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
