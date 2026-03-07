<script lang="ts">
  import { onMount } from 'svelte';
  import {
    consolidateRoot,
    discoverSources,
    getRootConsolidationPlan,
    getRootsConfig,
    openRootInFileManager,
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
  import {
    ArrowRightLeft,
    FileImage,
    FolderOpen,
    HardDrive,
    Plus,
    RefreshCw,
    Save,
    Search,
    Shield,
    Sparkles,
    Trash2,
  } from 'lucide-svelte';

  let {
    mode = 'volume',
    volumeId = null,
    currentVolumeHint = null,
    currentVolumeHintIsFile = false,
  } = $props<{
    mode?: 'global' | 'volume';
    volumeId: string | null;
    currentVolumeHint?: string | null;
    currentVolumeHintIsFile?: boolean;
  }>();

  const DISMISSED_DISCOVERY_KEY = 'nearbytes-source-discovery-dismissed-v1';
  const RESERVE_OPTIONS = [0, 5, 10, 15, 20, 25, 30];
  const DESTINATION_MODES = [
    { value: 'off', label: 'Off', caption: 'ignore this location' },
    { value: 'history', label: 'History', caption: 'keep the event log' },
    { value: 'new-files', label: 'New files', caption: 'keep what arrives now' },
    { value: 'everything', label: 'Everything', caption: 'keep old and new files' },
  ] as const;
  const DEFAULT_DESTINATION: VolumeDestinationConfig = {
    sourceId: '',
    enabled: true,
    storeEvents: true,
    storeBlocks: true,
    copySourceBlocks: true,
    reservePercent: 10,
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
  let selectedPolicyVolumeId = $state<string | null>(null);

  onMount(() => {
    void loadPanel();
  });

  $effect(() => {
    if (!configDraft) return;
    if (volumeId && selectedPolicyVolumeId !== volumeId) {
      selectedPolicyVolumeId = volumeId;
      return;
    }
    if (selectedPolicyVolumeId && !orderedPolicyVolumeIds().includes(selectedPolicyVolumeId)) {
      selectedPolicyVolumeId = volumeId ?? orderedPolicyVolumeIds()[0] ?? null;
      return;
    }
    if (!volumeId && selectedPolicyVolumeId === null && orderedPolicyVolumeIds().length > 0) {
      selectedPolicyVolumeId = orderedPolicyVolumeIds()[0];
    }
  });

  $effect(() => {
    persistDismissedDiscoveries(dismissedDiscoveries);
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
      sources: config.sources.map((source) => ({ ...source })),
      defaultVolume: {
        destinations: config.defaultVolume.destinations.map((destination) => ({ ...destination })),
      },
      volumes: config.volumes.map((volume) => ({
        volumeId: volume.volumeId,
        destinations: volume.destinations.map((destination) => ({ ...destination })),
      })),
    };
  }

  function normalizeComparablePath(value: string): string {
    return value.trim().replace(/\\/g, '/').replace(/\/+$/u, '').toLowerCase();
  }

  function detectProviderFromPath(value: string): SourceProvider {
    const lower = value.toLowerCase();
    if (lower.includes('dropbox')) return 'dropbox';
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

  function volumeShortLabel(value: string | null): string {
    if (!value) return 'New volume';
    if (value.length <= 18) return value;
    return `${value.slice(0, 10)}...${value.slice(-6)}`;
  }

  function orderedPolicyVolumeIds(): string[] {
    if (!configDraft) return [];
    const ids = new Set<string>();
    if (volumeId) ids.add(volumeId);
    for (const entry of configDraft.volumes) {
      ids.add(entry.volumeId);
    }
    return Array.from(ids);
  }

  function policyVolumeLabel(targetVolumeId: string): string {
    if (volumeId === targetVolumeId && currentVolumeHint && currentVolumeHint.trim() !== '') {
      return currentVolumeHint.trim();
    }
    return volumeShortLabel(targetVolumeId);
  }

  function policyVolumeMeta(targetVolumeId: string): string {
    if (volumeId === targetVolumeId && currentVolumeHint && currentVolumeHint.trim() !== '') {
      return volumeShortLabel(targetVolumeId);
    }
    return 'public key';
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
      reservePercent: 10,
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
      errorMessage = 'Nearbytes needs at least one source.';
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
    if (selectedPolicyVolumeId === targetVolumeId) {
      selectedPolicyVolumeId = volumeId ?? configDraft.volumes[0]?.volumeId ?? null;
    }
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
    if (destination.storeBlocks) return 'replica';
    if (destination.storeEvents) return 'events';
    return 'off';
  }

  function protectionLabel(destination: VolumeDestinationConfig | null, sourceId: string): string {
    const tone = protectionTone(destination, sourceId);
    if (tone === 'durable') return 'Guaranteed';
    if (tone === 'replica') return 'New files';
    if (tone === 'events') return 'History';
    return 'Off';
  }

  function volumeBadgeText(targetVolumeId: string | null): string {
    return hasDurableDestination(targetVolumeId) ? 'Guaranteed somewhere' : 'Not guaranteed';
  }

  function destinationMode(
    destination: VolumeDestinationConfig | null
  ): 'off' | 'history' | 'new-files' | 'everything' {
    if (!destination || !destination.enabled) return 'off';
    if (!destination.storeEvents) return 'off';
    if (!destination.storeBlocks) return 'history';
    if (!destination.copySourceBlocks) return 'new-files';
    return 'everything';
  }

  function setDestinationMode(
    targetVolumeId: string | null,
    sourceId: string,
    nextMode: 'off' | 'history' | 'new-files' | 'everything'
  ): void {
    if (!configDraft) return;
    upsertDestination(targetVolumeId, sourceId);
    const apply = (destination: VolumeDestinationConfig): VolumeDestinationConfig => {
      if (nextMode === 'off') {
        return {
          ...destination,
          enabled: false,
          storeEvents: false,
          storeBlocks: false,
          copySourceBlocks: false,
        };
      }
      if (nextMode === 'history') {
        return {
          ...destination,
          enabled: true,
          storeEvents: true,
          storeBlocks: false,
          copySourceBlocks: false,
        };
      }
      if (nextMode === 'new-files') {
        return {
          ...destination,
          enabled: true,
          storeEvents: true,
          storeBlocks: true,
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
      if (!current || source.sourceType === 'marker') {
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

  function selectedPolicyTitle(): string {
    if (selectedPolicyVolumeId === null) return 'Next volume';
    return policyVolumeLabel(selectedPolicyVolumeId);
  }

  function selectedPolicyMeta(): string {
    if (selectedPolicyVolumeId === null) return 'Default rule for volumes that do not have their own saved policy yet';
    if (volumeId === selectedPolicyVolumeId && currentVolumeHint && currentVolumeHint.trim() !== '') {
      return volumeShortLabel(selectedPolicyVolumeId);
    }
    return 'Saved by public key';
  }

  function policyCards(): Array<{
    key: string;
    volumeId: string | null;
    title: string;
    meta: string;
    usesFile: boolean;
    isCurrent: boolean;
    isDefault: boolean;
    safe: boolean;
  }> {
    const cards = orderedPolicyVolumeIds().map((targetVolumeId) => ({
      key: targetVolumeId,
      volumeId: targetVolumeId,
      title: policyVolumeLabel(targetVolumeId),
      meta: policyVolumeMeta(targetVolumeId),
      usesFile: volumeId === targetVolumeId && currentVolumeHintIsFile,
      isCurrent: volumeId === targetVolumeId,
      isDefault: false,
      safe: hasDurableDestination(targetVolumeId),
    }));
    cards.push({
      key: '__default__',
      volumeId: null,
      title: 'Next volume',
      meta: 'default rule',
      usesFile: false,
      isCurrent: false,
      isDefault: true,
      safe: hasDurableDestination(null),
    });
    return cards;
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
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Failed to load storage settings';
    } finally {
      loading = false;
    }
  }

  async function savePanel() {
    if (!configDraft) return;
    saving = true;
    errorMessage = '';
    successMessage = '';
    try {
      const response = await updateRootsConfig(configDraft);
      configPath = response.configPath;
      configDraft = cloneConfig(response.config);
      runtime = response.runtime;
      successMessage = 'Saved.';
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Failed to save';
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
      errorMessage = error instanceof Error ? error.message : 'Failed to scan';
    } finally {
      discoveryLoading = false;
    }
  }

  function addSourceCard() {
    if (!configDraft) return;
    configDraft = {
      ...configDraft,
      sources: [...configDraft.sources, createSource()],
    };
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
    successMessage = `Added ${formatProvider(source.provider)}.`;
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
      successMessage = 'Opened.';
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
        mergeMessage = 'No compatible destination.';
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
          <p class="panel-eyebrow">Sources</p>
          <h2>Data locations</h2>
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
          <button type="button" class="panel-btn subtle" onclick={loadPanel}>
            <RefreshCw size={14} strokeWidth={2} />
            <span>Reload</span>
          </button>
          <button type="button" class="panel-btn primary" onclick={savePanel} disabled={saving}>
            <Save size={14} strokeWidth={2} />
            <span>{saving ? 'Saving...' : 'Save'}</span>
          </button>
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

      {#if discoveryOpen}
        <section class="panel-cluster scan-cluster">
          <div class="cluster-head">
            <div>
              <p class="cluster-title">Discovered folders</p>
              <p class="cluster-caption">Marker-based discovery stays separate from your saved source list.</p>
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
                      <span>Use</span>
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

      <section class="panel-cluster">
        <div class="cluster-head">
          <div>
            <p class="cluster-title">Saved sources</p>
            <p class="cluster-caption">At least one source must remain connected.</p>
          </div>
          <span class="summary-badge">{configDraft.sources.length} connected</span>
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

              <label class="field-block">
                <span>Folder</span>
                <input
                  type="text"
                  class="panel-input"
                  value={source.path}
                  oninput={(event) => updateSourceField(source.id, 'path', (event.currentTarget as HTMLInputElement).value)}
                />
              </label>

              <div class="field-grid two-up">
                <label class="field-block compact-field">
                  <span>Keep free</span>
                  <select
                    class="panel-input"
                    value={String(source.reservePercent)}
                    onchange={(event) =>
                      updateSourceField(source.id, 'reservePercent', clampReserve((event.currentTarget as HTMLSelectElement).value))}
                  >
                    {#each RESERVE_OPTIONS as option}
                      <option value={option}>{formatPercent(option)}</option>
                    {/each}
                  </select>
                </label>
                <label class="field-block compact-field">
                  <span>When full</span>
                  <select
                    class="panel-input"
                    value={source.opportunisticPolicy}
                    onchange={(event) =>
                      updateSourceField(source.id, 'opportunisticPolicy', (event.currentTarget as HTMLSelectElement).value as StorageFullPolicy)}
                  >
                    <option value="drop-older-blocks">Trim spare data</option>
                    <option value="block-writes">Pause new data</option>
                  </select>
                </label>
              </div>

              <div class="chip-row">
                <label class="toggle-chip strong"><input type="checkbox" checked={source.enabled} onchange={(event) => updateSourceField(source.id, 'enabled', (event.currentTarget as HTMLInputElement).checked)} /><span>Use</span></label>
                <label class="toggle-chip"><input type="checkbox" checked={source.writable} onchange={(event) => updateSourceField(source.id, 'writable', (event.currentTarget as HTMLInputElement).checked)} /><span>Can write</span></label>
              </div>

              <div class="source-facts">
                <span>{status?.exists ? 'Ready' : 'Missing'}</span>
                <span>{status?.availableBytes !== undefined ? formatSize(status.availableBytes) : 'n/a free'}</span>
              </div>

              <div class="source-actions">
                <button type="button" class="panel-btn subtle compact" onclick={() => openSourceFolder(source.id)}>
                  <FolderOpen size={14} strokeWidth={2} />
                  <span>Open</span>
                </button>
                <button type="button" class="panel-btn subtle compact" onclick={() => startMerge(source.id)} disabled={configDraft.sources.length < 2}>
                  <ArrowRightLeft size={14} strokeWidth={2} />
                  <span>Move into...</span>
                </button>
                <ArmedActionButton
                  class="panel-btn subtle compact danger"
                  icon={Trash2}
                  text="Remove"
                  armed={true}
                  autoDisarmMs={3000}
                  onPress={() => removeSource(source.id)}
                />
              </div>

              {#if mergeSourceId === source.id}
                <div class="merge-box">
                  {#if mergeLoading}
                    <p class="storage-message">Finding a compatible destination...</p>
                  {:else if mergeCandidates.length === 0}
                    <p class="storage-message">{mergeMessage}</p>
                  {:else}
                    <p class="merge-copy">Move this folder's stored data into another saved source, then remove it.</p>
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
    {:else}
      <div class="panel-head">
        <div>
          <p class="panel-eyebrow">Keep</p>
          <h2>Volume storage</h2>
          <p class="panel-caption">Choose where each volume keeps its history and encrypted files.</p>
        </div>
        <div class="panel-actions">
          <button type="button" class="panel-btn subtle" onclick={loadPanel}>
            <RefreshCw size={14} strokeWidth={2} />
            <span>Reload</span>
          </button>
          <button type="button" class="panel-btn primary" onclick={savePanel} disabled={saving}>
            <Save size={14} strokeWidth={2} />
            <span>{saving ? 'Saving...' : 'Save'}</span>
          </button>
        </div>
      </div>

      {#if errorMessage}
        <p class="panel-error">{errorMessage}</p>
      {/if}
      {#if successMessage}
        <p class="panel-success">{successMessage}</p>
      {/if}

      <div class="volume-grid">
        {#each policyCards() as card (card.key)}
          <button
            type="button"
            class="volume-card"
            class:active={selectedPolicyVolumeId === card.volumeId}
            class:default-card={card.isDefault}
            onclick={() => {
              selectedPolicyVolumeId = card.volumeId;
            }}
          >
            <div class="volume-card-mark" class:safe={card.safe}>
              {#if card.isDefault}
                <Sparkles size={18} strokeWidth={2} />
              {:else if card.isCurrent && card.usesFile}
                <FileImage size={18} strokeWidth={2} />
              {:else}
                <Shield size={18} strokeWidth={2} />
              {/if}
            </div>
            <div class="volume-card-copy">
              <p class="volume-card-name" title={card.title}>{card.title}</p>
              <p class="volume-card-meta">{card.meta}</p>
            </div>
            <span class="volume-card-badge" class:safe={card.safe} class:warning={!card.safe}>
              {card.safe ? 'Guaranteed somewhere' : 'Not guaranteed'}
            </span>
          </button>
        {/each}
      </div>

      {#if orderedPolicyVolumeIds().length === 0}
        <p class="storage-message">Open a volume once and its public key will stay here, even after you close it.</p>
      {/if}

      <section class="detail-shell">
        <div class="detail-head">
          <div>
            <p class="cluster-title">{selectedPolicyTitle()}</p>
            <p class="cluster-caption">{selectedPolicyMeta()}</p>
          </div>
          <div class="detail-head-actions">
            <span class="summary-badge" class:warning={!hasDurableDestination(selectedPolicyVolumeId)}>
              {volumeBadgeText(selectedPolicyVolumeId)}
            </span>
            {#if selectedPolicyVolumeId !== null && explicitVolumePolicy(selectedPolicyVolumeId)}
              <ArmedActionButton
                class="panel-btn subtle compact danger"
                icon={Trash2}
                text="Forget"
                armed={true}
                autoDisarmMs={3000}
                onPress={() => removeVolumePolicy(selectedPolicyVolumeId)}
              />
            {/if}
          </div>
        </div>

        <p class="detail-note">Pick at least one location marked <strong>Guaranteed</strong> if this volume must never be discarded.</p>

        <div class="destination-grid">
          {#each configDraft.sources as source (source.id)}
            {@const destination = destinationFor(selectedPolicyVolumeId, source.id)}
            {@const status = sourceStatus(source.id)}
            {@const modeValue = destinationMode(destination)}
            <article class="destination-card" class:safe={protectionTone(destination, source.id) === 'durable'}>
              <div class="destination-head">
                <div>
                  <p class="source-provider">{formatProvider(source.provider)}</p>
                  <h3>{compactPath(source.path)}</h3>
                  <p class="source-path">{source.path || 'Choose a folder'}</p>
                </div>
                <span class={`mini-badge tone-${protectionTone(destination, source.id)}`}>{protectionLabel(destination, source.id)}</span>
              </div>

              <div class="mode-grid" role="group" aria-label={`Storage mode for ${compactPath(source.path)}`}>
                {#each DESTINATION_MODES as option (option.value)}
                  <button
                    type="button"
                    class="mode-btn"
                    class:selected={modeValue === option.value}
                    onclick={() => setDestinationMode(selectedPolicyVolumeId, source.id, option.value)}
                  >
                    <span class="mode-label">{option.label}</span>
                    <span class="mode-caption">{option.caption}</span>
                  </button>
                {/each}
              </div>

              <div class="field-grid two-up compact-fields">
                <label class="field-block compact-field">
                  <span>Keep free</span>
                  <select class="panel-input" value={String(destination?.reservePercent ?? 10)} onchange={(event) => updateDestinationField(selectedPolicyVolumeId, source.id, 'reservePercent', clampReserve((event.currentTarget as HTMLSelectElement).value))}>
                    {#each RESERVE_OPTIONS as option}
                      <option value={option}>{formatPercent(option)}</option>
                    {/each}
                  </select>
                </label>
                <label class="field-block compact-field">
                  <span>When full</span>
                  <select class="panel-input" value={destination?.fullPolicy ?? 'block-writes'} onchange={(event) => updateDestinationField(selectedPolicyVolumeId, source.id, 'fullPolicy', (event.currentTarget as HTMLSelectElement).value as StorageFullPolicy)}>
                    <option value="block-writes">Pause new files</option>
                    <option value="drop-older-blocks">Trim spare data</option>
                  </select>
                </label>
              </div>

              <div class="source-facts">
                <span>{source.enabled ? 'Source on' : 'Source off'}</span>
                <span>{source.writable ? 'Can write' : 'Read only'}</span>
                <span>{status?.availableBytes !== undefined ? formatSize(status.availableBytes) : 'n/a free'}</span>
              </div>
            </article>
          {/each}
        </div>
      </section>
    {/if}
  </section>
{/if}

<style>
  .storage-panel {
    display: grid;
    gap: 1rem;
    padding: 1rem;
    border: 1px solid rgba(56, 189, 248, 0.18);
    border-radius: 20px;
    background:
      radial-gradient(130% 130% at 0% 0%, rgba(34, 211, 238, 0.08), transparent 46%),
      linear-gradient(180deg, rgba(8, 17, 31, 0.96), rgba(7, 14, 28, 0.94));
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.04),
      0 20px 44px rgba(2, 6, 23, 0.2);
  }

  .panel-head,
  .cluster-head,
  .source-card-head,
  .source-actions,
  .panel-actions,
  .chip-row,
  .source-facts,
  .detail-head,
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
  .cluster-head,
  .detail-head {
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

  .field-grid {
    display: grid;
    gap: 0.7rem;
  }

  .field-grid.two-up {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .source-grid,
  .destination-grid,
  .discovery-grid,
  .volume-grid {
    display: grid;
    gap: 0.85rem;
  }

  .source-grid,
  .destination-grid {
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  }

  .discovery-grid {
    grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
  }

  .volume-grid {
    grid-template-columns: repeat(auto-fit, minmax(150px, 190px));
  }

  .scan-card,
  .source-card,
  .destination-card,
  .volume-card {
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

  .source-card-head {
    align-items: flex-start;
    justify-content: space-between;
  }

  .source-mark,
  .volume-card-mark {
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

  .volume-card-mark.safe {
    border-color: rgba(45, 212, 191, 0.34);
    color: rgba(153, 246, 228, 0.98);
    background: rgba(8, 61, 56, 0.54);
  }

  .source-copy {
    min-width: 0;
    flex: 1 1 auto;
  }

  .source-badges {
    display: flex;
    gap: 0.45rem;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .source-path,
  .scan-path,
  .volume-card-name,
  .volume-card-meta {
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

  .source-facts {
    font-size: 0.76rem;
    color: rgba(186, 230, 253, 0.72);
    justify-content: space-between;
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

  .mode-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.55rem;
  }

  .mode-btn {
    min-width: 0;
    display: grid;
    gap: 0.18rem;
    justify-items: start;
    text-align: left;
    min-height: 64px;
    padding: 0.72rem 0.78rem;
    border-radius: 14px;
    border: 1px solid rgba(56, 189, 248, 0.16);
    background: rgba(10, 19, 34, 0.52);
    color: rgba(226, 232, 240, 0.88);
    cursor: pointer;
    transition: transform 0.18s ease, border-color 0.18s ease, background-color 0.18s ease, box-shadow 0.18s ease;
  }

  .mode-btn:hover {
    transform: translateY(-1px);
    border-color: rgba(96, 165, 250, 0.28);
    background: rgba(12, 24, 43, 0.84);
  }

  .mode-btn.selected {
    border-color: rgba(34, 211, 238, 0.42);
    background:
      radial-gradient(140% 120% at 0% 0%, rgba(34, 211, 238, 0.14), transparent 44%),
      rgba(12, 24, 43, 0.88);
    box-shadow: 0 10px 22px rgba(2, 6, 23, 0.2);
  }

  .mode-label {
    font-size: 0.8rem;
    font-weight: 700;
    color: rgba(240, 249, 255, 0.98);
  }

  .mode-caption {
    font-size: 0.71rem;
    color: rgba(186, 230, 253, 0.72);
    line-height: 1.25;
  }

  .detail-head-actions {
    justify-content: flex-end;
    margin-left: auto;
  }

  .detail-note strong {
    color: rgba(240, 249, 255, 0.96);
  }

  @media (max-width: 920px) {
    .panel-head,
    .cluster-head,
    .detail-head {
      align-items: flex-start;
    }

    .field-grid.two-up {
      grid-template-columns: 1fr;
    }

    .volume-grid {
      grid-template-columns: repeat(auto-fit, minmax(148px, 1fr));
    }

    .mode-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
