<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import {
    attachManagedShare,
    chooseDirectoryPath,
    configureProviderSetup,
    connectProviderAccount,
    createManagedShare,
    consolidateRoot,
    disconnectProviderAccount,
    discoverSources,
    getRootsConfig,
    hasDesktopDirectoryPicker,
    installProviderHelper,
    listManagedShares,
    listProviderAccounts,
    openRootInFileManager,
    type DiscoveredNearbytesSource,
    type ManagedShareSummary,
    type ProviderAccount,
    type ProviderAuthSession,
    type ProviderCatalogEntry,
    type ReconcileSourcesResponse,
    type RootsConfig,
    type RootsRuntimeSnapshot,
    type SourceConfigEntry,
    type SourceProvider,
    type StorageFullPolicy,
    type VolumeDestinationConfig,
    type VolumePolicyEntry,
    updateRootsConfig,
  } from '../lib/api.js';
  import ArmedActionButton from './ArmedActionButton.svelte';
  import ShareCard from './ShareCard.svelte';
  import {
    ArrowRightLeft,
    Check,
    FolderOpen,
    HardDrive,
    Plus,
    RefreshCw,
    Search,
    Shield,
    Trash2,
  } from 'lucide-svelte';

  let {
    mode = 'volume',
    volumeId = null,
    currentVolumePresentation = null,
    knownVolumes = [],
    onOpenVolumeRouting = undefined,
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
    discoveryDetails?: ReconcileSourcesResponse | null;
    refreshToken?: number;
    focusSection?: 'discovery' | 'defaults' | null;
  }>();

  type StatusTone = 'good' | 'warn' | 'muted';
  type VolumeStorageView = 'copies' | 'shares' | 'folders';

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
  let errorMessage = $state('');
  let successMessage = $state('');
  let discoveryLoading = $state(false);
  let discoveryError = $state('');
  let discoveredSources = $state<DiscoveredNearbytesSource[]>([]);
  let dismissedDiscoveries = $state<string[]>(loadDismissedDiscoveries());
  let movingSourceId = $state<string | null>(null);
  let providerAccounts = $state<ProviderAccount[]>([]);
  let providerCatalog = $state<ProviderCatalogEntry[]>([]);
  let managedShares = $state<ManagedShareSummary[]>([]);
  let integrationBusyKey = $state<string | null>(null);
  let providerAuthSessions = $state<Record<string, ProviderAuthSession>>({});
  let providerCredentialDrafts = $state<Record<string, { email: string; password: string; mfaCode: string; useMfa: boolean }>>({});
  let providerSetupDrafts = $state<Record<string, { clientId: string }>>({});
  let providerShareDrafts = $state<Record<string, { repoOwner: string; repoName: string; branch: string; basePath: string }>>({});
  let providerDisconnectArmed = $state<Record<string, boolean>>({});
  let selectedGlobalProvider = $state('local');
  let volumeView = $state<VolumeStorageView>('copies');
  let autosaveStatus = $state<'idle' | 'pending' | 'saving' | 'saved' | 'error'>('idle');
  let lastSavedSignature = $state('');
  let lastRefreshToken = $state(0);
  let discoveryRunId = 0;

  const providerSessionTimers = new Map<string, ReturnType<typeof setTimeout>>();

  onMount(() => {
    void loadPanel();
  });

  onDestroy(() => {
    for (const timer of providerSessionTimers.values()) {
      clearTimeout(timer);
    }
    providerSessionTimers.clear();
  });

  $effect(() => {
    if (refreshToken === 0 || refreshToken === lastRefreshToken) return;
    lastRefreshToken = refreshToken;
    void loadPanel();
  });

  $effect(() => {
    persistDismissedDiscoveries(dismissedDiscoveries);
  });

  $effect(() => {
    if (mode === 'global') return;
    if (focusSection === 'discovery' || focusSection === 'defaults') {
      volumeView = 'folders';
    }
  });

  $effect(() => {
    const availableProviders = new Set(['local', ...providerCatalog.map((provider) => provider.provider)]);
    if (!availableProviders.has(selectedGlobalProvider)) {
      selectedGlobalProvider = 'local';
    }
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
      // Ignore local storage failures.
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
    return 'Local folder';
  }

  function compactPath(value: string): string {
    const normalized = value.trim().replace(/\\/g, '/');
    if (normalized === '') return 'Choose a folder';
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

  function connectedAccountForProvider(provider: string): ProviderAccount | null {
    return providerAccounts.find((account) => account.provider === provider) ?? null;
  }

  function pendingSessionForProvider(provider: string): ProviderAuthSession | null {
    return providerAuthSessions[provider] ?? null;
  }

  function providerCredentialDraft(provider: string): { email: string; password: string; mfaCode: string; useMfa: boolean } {
    return providerCredentialDrafts[provider] ?? { email: '', password: '', mfaCode: '', useMfa: false };
  }

  function providerSetupDraft(provider: string): { clientId: string } {
    return providerSetupDrafts[provider] ?? { clientId: '' };
  }

  function providerShareDraft(provider: string): { repoOwner: string; repoName: string; branch: string; basePath: string } {
    return providerShareDrafts[provider] ?? {
      repoOwner: '',
      repoName: '',
      branch: 'main',
      basePath: '',
    };
  }

  function setProviderCredential(
    provider: string,
    field: 'email' | 'password' | 'mfaCode' | 'useMfa',
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

  function managedSharesForVolume(targetVolumeId: string | null): ManagedShareSummary[] {
    if (!targetVolumeId) return [];
    return managedShares.filter((summary) =>
      summary.attachments.some((attachment) => attachment.volumeId === targetVolumeId)
    );
  }

  function availableManagedSharesForVolume(targetVolumeId: string | null): ManagedShareSummary[] {
    if (!targetVolumeId) return managedShares;
    return managedShares.filter(
      (summary) => !summary.attachments.some((attachment) => attachment.volumeId === targetVolumeId)
    );
  }

  function shareStatusTone(summary: ManagedShareSummary): StatusTone {
    if (summary.state.status === 'ready') return 'good';
    if (summary.state.status === 'idle' || summary.state.status === 'syncing') return 'muted';
    return 'warn';
  }

  function shareStatusLabel(summary: ManagedShareSummary): string {
    if (summary.state.status === 'ready') return 'Ready';
    if (summary.state.status === 'syncing') return 'Syncing';
    if (summary.state.status === 'idle') return 'Planned';
    if (summary.state.status === 'needs-auth') return 'Needs login';
    if (summary.state.status === 'unsupported') return 'Experimental';
    return 'Needs attention';
  }

  function shareAttachmentSummary(summary: ManagedShareSummary): string {
    const count = summary.attachments.length;
    if (count === 0) {
      return 'Not attached to a space yet.';
    }
    return `${countLabel(count, 'space')} attached`;
  }

  function shareAttachmentLabels(summary: ManagedShareSummary): Array<{ volumeId: string; label: string; known: boolean }> {
    if (summary.attachments.length === 0) {
      return [];
    }
    return summary.attachments.map((attachment) => {
      const knownLabel = knownVolumeLabel(attachment.volumeId);
      return {
        volumeId: attachment.volumeId,
        label: knownLabel ?? `Space ${attachment.volumeId.slice(0, 8)}`,
        known: Boolean(knownLabel),
      };
    });
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
      return currentVolumePresentation.label.trim() || 'Current space';
    }
    return knownVolumes.find((entry) => entry.volumeId === targetVolumeId)?.label ?? null;
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

  function providerCardTone(entry: ProviderCatalogEntry): StatusTone {
    const pending = pendingSessionForProvider(entry.provider);
    if (pending && pending.status === 'pending') return 'muted';
    if (pending && pending.status === 'failed') return 'warn';
    if (entry.setup.status === 'needs-config' || entry.setup.status === 'needs-install' || entry.setup.status === 'unsupported') {
      return entry.setup.status === 'unsupported' ? 'warn' : 'muted';
    }
    if (entry.setup.status === 'installing') return 'muted';
    return entry.isConnected ? 'good' : entry.connectionState === 'setup' ? 'warn' : 'muted';
  }

  function providerCardStatus(entry: ProviderCatalogEntry): string {
    const pending = pendingSessionForProvider(entry.provider);
    if (pending?.status === 'pending') return 'Waiting';
    if (pending?.status === 'failed') return 'Retry';
    if (entry.setup.status === 'needs-config') return 'Setup';
    if (entry.setup.status === 'needs-install') return 'Install';
    if (entry.setup.status === 'installing') return 'Installing';
    if (entry.setup.status === 'unsupported') return 'Unavailable';
    if (entry.isConnected) return 'Connected';
    if (entry.connectionState === 'setup') return 'Setup';
    return 'Available';
  }

  function providerCardHeadline(entry: ProviderCatalogEntry): string {
    if (entry.provider === 'github') return entry.isConnected ? 'Choose how Nearbytes uses GitHub' : 'Connect your GitHub account';
    if (entry.provider === 'mega') return entry.isConnected ? 'Choose how Nearbytes uses MEGA' : 'Connect your MEGA account';
    if (entry.provider === 'gdrive') return entry.isConnected ? 'Choose how Nearbytes uses Google Drive' : 'Connect your Google Drive account';
    return `Use ${entry.label}`;
  }

  function providerCardDetail(entry: ProviderCatalogEntry): string {
    const pending = pendingSessionForProvider(entry.provider);
    if (pending) {
      return pending.detail;
    }
    if (entry.setup.status === 'installing') {
      return 'Nearbytes is downloading and preparing the latest helper.';
    }
    if (entry.setup.status === 'needs-install' && entry.provider === 'mega') {
      return 'Nearbytes will download and install the latest MEGA helper when you connect.';
    }
    if (entry.provider === 'github') {
      return entry.isConnected
        ? 'Choose a repository and a nearbytes subdirectory for each share.'
        : entry.setup.status === 'needs-config'
          ? 'Add the GitHub OAuth app client ID with device flow enabled, then connect.'
          : 'GitHub shares sync blocks and channels through a configurable subdirectory in your repository.';
    }
    return entry.setup.detail || entry.description;
  }

  function providerShares(provider: string): ManagedShareSummary[] {
    return managedShares.filter((summary) => summary.share.provider === provider);
  }

  function selectedProviderEntry(): ProviderCatalogEntry | null {
    return providerCatalog.find((provider) => provider.provider === selectedGlobalProvider) ?? null;
  }

  function localMachineShareCount(): number {
    return localShares().length;
  }

  function shouldShowProviderDocs(entry: ProviderCatalogEntry): boolean {
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
    return summary.share.sourceId ? 'Local folder managed by Nearbytes' : 'Waiting for local folder';
  }

  function localShares(): SourceConfigEntry[] {
    return (configDraft?.sources ?? []).filter((source) => isLocalMachineShare(source));
  }

  function managedShareAccessLabel(summary: ManagedShareSummary): string {
    return summary.share.capabilities.includes('write') ? 'Read and write' : 'Read only';
  }

  function shareCardBadgeForSource(source: SourceConfigEntry): Array<{ label: string; tone: 'good' | 'muted' | 'warn' | 'durable' | 'replica' | 'off' }> {
    const availability = locationAvailability(source);
    return [
      {
        label: availability.label,
        tone: availability.tone,
      },
    ];
  }

  function shareCardBadgesForManaged(summary: ManagedShareSummary): Array<{ label: string; tone: 'good' | 'muted' | 'warn' | 'durable' | 'replica' | 'off' }> {
    return [
      {
        label: shareStatusLabel(summary),
        tone: shareStatusTone(summary),
      },
    ];
  }

  function defaultManagedShareLabel(): string {
    if (currentVolumePresentation?.label?.trim()) {
      return `${currentVolumePresentation.label.trim()} share`;
    }
    if (volumeId) {
      return `Space ${volumeId.slice(0, 8)} share`;
    }
    return 'Nearbytes share';
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

  function sourceReservePercent(source: SourceConfigEntry): number {
    return Number.isFinite(source.reservePercent) ? source.reservePercent : DEFAULT_RESERVE_PERCENT;
  }

  function destinationReservePercent(destination: VolumeDestinationConfig | null): number {
    return Number.isFinite(destination?.reservePercent) ? destination!.reservePercent : DEFAULT_RESERVE_PERCENT;
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
    if (keepsFullCopy(destination)) return 'replica';
    return 'off';
  }

  function protectionLabel(destination: VolumeDestinationConfig | null, sourceId: string): string {
    const tone = protectionTone(destination, sourceId);
    if (tone === 'durable') return 'Protected copy';
    if (tone === 'replica') return 'Spare copy';
    return 'Not keeping a copy';
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
      return { label: 'Turned off', tone: 'muted' as StatusTone };
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
    return { label: 'Can save new data', tone: 'good' as StatusTone };
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
      return 'Choose a folder to finish setting up this storage location.';
    }
    if (!source.enabled) {
      return 'Nearbytes will ignore this location until you turn it back on.';
    }
    if (status?.exists === false) {
      return 'This folder is not available right now. Your rules stay saved, but Nearbytes cannot use it.';
    }
    if (status && !status.isDirectory) {
      return 'This path exists, but it is not a folder.';
    }
    if (source.writable && status?.canWrite === false) {
      return 'Nearbytes can read this location, but it cannot save new data here right now.';
    }
    if (source.writable) {
      return 'Nearbytes can read this location and save new encrypted data here.';
    }
    return 'Nearbytes can read this location, but it will not save new data here.';
  }

  function usageSummary(sourceId: string): string {
    const totalBytes = sourceStatus(sourceId)?.usage.totalBytes ?? 0;
    if (totalBytes <= 0) {
      return 'No Nearbytes data is stored here yet.';
    }
    return `Nearbytes is using ${formatSize(totalBytes)} in this location.`;
  }

  function protectionSummary(targetVolumeId: string | null): string {
    const count = durableLocationCount(targetVolumeId);
    if (count === 0) return 'Choose at least one protected copy';
    if (count === 1) return '1 protected copy ready';
    return `${count} protected copies ready`;
  }

  function protectionHint(targetVolumeId: string | null): string {
    if (hasDurableDestination(targetVolumeId)) {
      return targetVolumeId
        ? 'This space already has at least one writable protected copy.'
        : 'New spaces will start with at least one writable protected copy.';
    }
    return targetVolumeId
      ? 'Turn on "Keep a full copy" for at least one writable location below.'
      : 'Every new space needs at least one writable location that keeps a protected copy.';
  }

  function copyHelpText(targetVolumeId: string | null, source: SourceConfigEntry): string {
    const destination = destinationFor(targetVolumeId, source.id);
    const status = sourceStatus(source.id);
    if (!keepsFullCopy(destination)) {
      return targetVolumeId
        ? 'This space is not being kept here.'
        : 'New spaces will not keep a full copy here.';
    }
    if (!source.enabled) {
      return 'This rule is saved, but the location itself is turned off.';
    }
    if (!source.writable) {
      return 'This rule is saved, but Nearbytes cannot keep a protected copy here until writing is allowed.';
    }
    if (status?.exists === false) {
      return 'This rule is saved, but the folder is not available right now.';
    }
    if (status && status.exists && !status.canWrite) {
      return 'This rule is saved, but Nearbytes cannot write to this folder right now.';
    }
    if (canReuseOtherGuaranteedCopies(destination)) {
      return 'If space runs low, Nearbytes may delete blocks from this location, but only after another protected location already has them.';
    }
    return 'This location keeps a protected full copy.';
  }

  function applyRootsResponse(response: {
    configPath: string | null;
    config: RootsConfig;
    runtime: RootsRuntimeSnapshot;
  }): void {
    configPath = response.configPath;
    configDraft = cloneConfig(response.config);
    runtime = response.runtime;
    lastSavedSignature = serializeConfig(cloneConfig(response.config));
  }

  function applyIntegrationsResponse(input: {
    accounts: ProviderAccount[];
    providers: ProviderCatalogEntry[];
    shares: ManagedShareSummary[];
  }): void {
    providerAccounts = input.accounts;
    providerCatalog = input.providers;
    managedShares = input.shares;
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
      if (account.state === 'connected') {
        clearProviderSession(account.provider);
      }
    }
  }

  async function loadPanel() {
    loading = true;
    errorMessage = '';
    successMessage = '';
    try {
      const [rootsResponse, accountsResponse, sharesResponse] = await Promise.all([
        getRootsConfig(),
        listProviderAccounts(),
        listManagedShares(),
      ]);
      applyRootsResponse(rootsResponse);
      applyIntegrationsResponse({
        accounts: accountsResponse.accounts,
        providers: accountsResponse.providers,
        shares: sharesResponse.shares,
      });
      autosaveStatus = 'idle';
      void refreshDiscoverySuggestions();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Failed to load storage locations';
    } finally {
      loading = false;
    }
  }

  async function autosavePanel(expectedSignature: string) {
    if (!configDraft) return;
    errorMessage = '';
    autosaveStatus = 'saving';
    try {
      const response = await updateRootsConfig(configDraft);
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
      const response = await discoverSources();
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
      errorMessage = 'That folder is already in your saved locations.';
      return;
    }
    updateSourceField(sourceId, 'path', selectedPath);
    successMessage = 'Folder updated.';
  }

  async function moveSourceFolder(sourceId: string): Promise<void> {
    if (!configDraft) return;
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

  async function openSourceFolder(sourceId: string) {
    errorMessage = '';
    successMessage = '';
    try {
      await openRootInFileManager(sourceId);
      successMessage = 'Opened folder.';
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Failed to open folder';
    }
  }

  async function connectProvider(provider: ProviderCatalogEntry): Promise<void> {
    integrationBusyKey = `connect:${provider.provider}`;
    errorMessage = '';
    successMessage = '';
    try {
      if (provider.setup.status === 'needs-install' && provider.setup.canInstall) {
        await installProvider(provider);
      }
      if (provider.setup.status === 'needs-config') {
        throw new Error(provider.setup.detail);
      }

      const draft = providerCredentialDraft(provider.provider);
      if (provider.provider === 'mega' && (draft.email.trim() === '' || draft.password.trim() === '')) {
        throw new Error('Enter the MEGA email and password first.');
      }

      const response = await connectProviderAccount({
        provider: provider.provider,
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
      });
      await handleProviderConnectResponse(provider, response);
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : `Failed to connect ${provider.label}`;
    } finally {
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

  async function installProvider(provider: ProviderCatalogEntry): Promise<void> {
    integrationBusyKey = `install:${provider.provider}`;
    errorMessage = '';
    successMessage = '';
    try {
      await installProviderHelper(provider.provider);
      successMessage = `${provider.label} helper installed.`;
      await loadPanel();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : `Failed to install ${provider.label} helper`;
      throw error;
    } finally {
      integrationBusyKey = null;
    }
  }

  function openProviderDocs(url: string | undefined): void {
    if (!url) return;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  async function disconnectProvider(provider: ProviderCatalogEntry): Promise<void> {
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
      successMessage = `${provider.label} share created for this space.`;
      await loadPanel();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : `Failed to create ${provider.label} share`;
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
      const label = provider.provider === 'github' ? githubShareLabel() : defaultManagedShareLabel();
      await createManagedShare({
        provider: provider.provider,
        accountId: provider.accountId,
        label,
        remoteDescriptor: provider.provider === 'github' ? githubShareDescriptor(label) : undefined,
      });
      successMessage = `${provider.label} share created.`;
      await loadPanel();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : `Failed to create ${provider.label} share`;
    } finally {
      integrationBusyKey = null;
    }
  }

  function githubShareLabel(): string {
    const draft = providerShareDraft('github');
    const repoName = draft.repoName.trim();
    const basePath = normalizeGithubDraftPath(draft.basePath);
    if (repoName && basePath) {
      const leaf = basePath.split('/').filter(Boolean).at(-1);
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
  }

  async function handleProviderConnectResponse(
    provider: ProviderCatalogEntry,
    response: Awaited<ReturnType<typeof connectProviderAccount>>
  ): Promise<void> {
    if (response.status === 'connected' && response.account) {
      clearProviderSession(provider.provider);
      if (provider.provider === 'mega') {
        setProviderCredential(provider.provider, 'password', '');
        setProviderCredential(provider.provider, 'mfaCode', '');
        setProviderCredential(provider.provider, 'useMfa', false);
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
      throw new Error(response.authSession?.detail || `Failed to connect ${provider.label}`);
    }

    successMessage =
      provider.provider === 'gdrive'
        ? 'Finish Google sign-in in the browser that just opened.'
        : response.authSession?.detail || `${provider.label} is waiting for confirmation.`;
    if (response.authSession) {
      scheduleProviderSessionPoll(provider, response.authSession.id);
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
    try {
      const response = await connectProviderAccount({
        provider: provider.provider,
        authSessionId,
        preferred: provider.provider === 'gdrive',
      });
      await handleProviderConnectResponse(provider, response);
    } catch (error) {
      clearProviderSession(provider.provider);
      errorMessage = error instanceof Error ? error.message : `Failed to finish ${provider.label} sign-in`;
    }
  }

  async function attachManagedShareToVolume(summary: ManagedShareSummary): Promise<void> {
    if (!volumeId) return;
    integrationBusyKey = `attach:${summary.share.id}`;
    errorMessage = '';
    successMessage = '';
    try {
      await attachManagedShare(summary.share.id, volumeId);
      successMessage = `${summary.share.label} attached to this space.`;
      await loadPanel();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'Failed to attach managed share';
    } finally {
      integrationBusyKey = null;
    }
  }

  function clampReserve(value: string): number {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return DEFAULT_RESERVE_PERCENT;
    return Math.max(0, Math.min(95, parsed));
  }
</script>

{#if loading}
  <section class="storage-panel panel-surface" class:global-mode={mode === 'global'} class:volume-mode={mode === 'volume'}>
    <p class="storage-message">Loading storage locations...</p>
  </section>
{:else if configDraft}
  <section class="storage-panel panel-surface" class:global-mode={mode === 'global'} class:volume-mode={mode === 'volume'}>
    {#if mode === 'global'}
      <div class="overview-grid">
        <button type="button" class="overview-card tab-card" class:active={selectedGlobalProvider === 'local'} onclick={() => (selectedGlobalProvider = 'local')}>
          <p class="provider-label">Local machine</p>
          <h3>{countLabel(localMachineShareCount(), 'share')}</h3>
          <p class="card-copy">{activeFolderCount()} enabled on this device.</p>
        </button>
        {#each providerCatalog as provider (provider.provider)}
          <button type="button" class="overview-card tab-card" class:active={selectedGlobalProvider === provider.provider} onclick={() => (selectedGlobalProvider = provider.provider)}>
            <p class="provider-label">{provider.label}</p>
            <h3>{provider.isConnected ? provider.label : providerCardStatus(provider)}</h3>
            <p class="card-copy">{providerShares(provider.provider).length} shares</p>
          </button>
        {/each}
      </div>

      {#if errorMessage}
        <p class="panel-error">{errorMessage}</p>
      {/if}
      {#if successMessage}
        <p class="panel-success">{successMessage}</p>
      {/if}

      {#if selectedGlobalProvider === 'local'}
      <section class="panel-section">
        <div class="section-head">
          <div>
            <p class="section-step">Local machine</p>
            <h3>Choose how Nearbytes sends and receives data on this device</h3>
          </div>
          <div class="section-metrics">
            <button
              type="button"
              class="panel-btn subtle compact icon-btn"
              onclick={() => void refreshDiscoverySuggestions()}
              disabled={discoveryLoading}
              title="Scan again"
            >
              <RefreshCw size={14} strokeWidth={2} />
            </button>
            {#if dismissedSuggestionCount() > 0}
              <button type="button" class="panel-btn subtle compact" onclick={restoreDismissedSuggestions}>
                <span>Show hidden</span>
              </button>
            {/if}
          </div>
        </div>
        {#if discoveryError}
          <p class="warning-copy">{discoveryError}</p>
        {/if}

        <article class="location-card provider-card" class:active={hasDurableDestination(null)}>
          <div class="card-head">
            <div class="card-title">
              <div class="card-icon">
                <HardDrive size={16} strokeWidth={2.1} />
              </div>
              <div>
                <p class="provider-label">Provider</p>
                <h4>Local machine</h4>
              </div>
            </div>
            <div class="card-status">
              <span class="status-pill tone-good">Available</span>
              <span class="status-pill tone-muted">{countLabel(localShares().length, 'share')}</span>
            </div>
          </div>
          <p class="card-copy">{protectionHint(null)}</p>
          <div class="fact-row">
            <span>{countLabel(activeFolderCount(), 'share')} enabled</span>
            <span>{hasDurableDestination(null) ? 'A protected default copy exists.' : 'Choose one default protected share.'}</span>
          </div>
        </article>

        <div class="compact-share-grid">
          {#each localShares() as source (source.id)}
            {@const status = sourceStatus(source.id)}
            {@const defaultDestination = destinationFor(null, source.id)}
            <ShareCard
              provider={formatProvider(source.provider)}
              title={compactPath(source.path)}
              copy={locationSummary(source)}
              active={protectionTone(defaultDestination, source.id) === 'durable'}
              statusBadges={shareCardBadgeForSource(source)}
              meta={[
                status?.availableBytes !== undefined ? `${formatSize(status.availableBytes)} free` : 'Free space unknown',
                usageSummary(source.id),
              ]}
            >
              {#snippet controls()}
                <div class="share-toggle-row">
                  <button
                    type="button"
                    class="share-toggle-pill"
                    class:active={source.enabled}
                    aria-pressed={source.enabled}
                    onclick={() => updateSourceField(source.id, 'enabled', !source.enabled)}
                  >
                    <span class="share-toggle-icon" aria-hidden="true">
                      {#if source.enabled}
                        <Check size={13} strokeWidth={2.6} />
                      {/if}
                    </span>
                    <span>Readable</span>
                  </button>
                  <button
                    type="button"
                    class="share-toggle-pill"
                    class:active={source.writable}
                    aria-pressed={source.writable}
                    onclick={() => updateSourceField(source.id, 'writable', !source.writable)}
                  >
                    <span class="share-toggle-icon" aria-hidden="true">
                      {#if source.writable}
                        <Check size={13} strokeWidth={2.6} />
                      {/if}
                    </span>
                    <span>Writable</span>
                  </button>
                  <button
                    type="button"
                    class="share-toggle-pill"
                    class:active={keepsFullCopy(defaultDestination)}
                    aria-pressed={keepsFullCopy(defaultDestination)}
                    onclick={() => setKeepFullCopy(null, source.id, !keepsFullCopy(defaultDestination))}
                  >
                    <span class="share-toggle-icon" aria-hidden="true">
                      {#if keepsFullCopy(defaultDestination)}
                        <Check size={13} strokeWidth={2.6} />
                      {/if}
                    </span>
                    <span>Default</span>
                  </button>
                </div>
              {/snippet}
              {#snippet details()}
                <details class="details-card inline-details compact-share-advanced">
                  <summary>Advanced</summary>
                  <div class="card-control-row">
                    <label class="field-block compact-field" title="Minimum free space to leave on this drive. Default is 5%.">
                      <span>Keep free</span>
                      <select
                        class="panel-input"
                        value={String(sourceReservePercent(source))}
                        onchange={(event) => {
                          const nextValue = clampReserve((event.currentTarget as HTMLSelectElement).value);
                          updateSourceField(source.id, 'reservePercent', nextValue);
                          if (keepsFullCopy(defaultDestination)) {
                            updateDestinationField(null, source.id, 'reservePercent', nextValue);
                          }
                        }}
                      >
                        {#each RESERVE_OPTIONS as option}
                          <option value={option}>{formatPercent(option)}</option>
                        {/each}
                      </select>
                    </label>
                    <div class="button-row">
                      {#if hasSourcePath(source)}
                        <button
                          type="button"
                          class="panel-btn subtle compact"
                          onclick={() => openSourceFolder(source.id)}
                          title={source.path || 'Open folder'}
                        >
                          <FolderOpen size={14} strokeWidth={2} />
                          <span>Open</span>
                        </button>
                        <button
                          type="button"
                          class="panel-btn subtle compact"
                          onclick={() => void moveSourceFolder(source.id)}
                          disabled={movingSourceId === source.id || Boolean(source.moveFromSourceId) || hasPendingMove(source.id)}
                          title="Move this share to a different folder"
                        >
                          <ArrowRightLeft size={14} strokeWidth={2} />
                          <span>{movingSourceId === source.id ? 'Moving...' : 'Move'}</span>
                        </button>
                      {:else}
                        <button type="button" class="panel-btn subtle compact" onclick={() => chooseSourceFolder(source.id)}>
                          <Search size={14} strokeWidth={2} />
                          <span>Choose folder</span>
                        </button>
                      {/if}
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
                  </div>
                  {#if status?.lastWriteFailure}
                    <p class="warning-copy">Last write problem: {status.lastWriteFailure.message}</p>
                  {/if}
                </details>
              {/snippet}
            </ShareCard>
          {/each}
          {#each sourceSuggestionRows() as row (row.source.path)}
            <article class="location-card suggestion-card">
              <div class="card-head">
                <div class="card-title">
                  <div class="card-icon" title={row.source.path}>
                    <Search size={16} strokeWidth={2.1} />
                  </div>
                  <div title={row.source.path}>
                    <p class="provider-label">{formatProvider(row.source.provider)}</p>
                    <h4>{compactPath(row.source.path)}</h4>
                  </div>
                </div>
                <div class="card-status">
                  <span class="status-pill tone-muted">Found automatically</span>
                </div>
              </div>

              <p class="card-copy">{sourceSuggestionCopy(row.source)}</p>

              <div class="button-row">
                <button type="button" class="panel-btn subtle compact" onclick={() => addDiscoveredSource(row.source)}>
                  <Plus size={14} strokeWidth={2} />
                  <span>Use folder</span>
                </button>
                <button type="button" class="panel-btn subtle compact danger" onclick={() => dismissDiscovery(row.source)}>
                  <span>Hide</span>
                </button>
              </div>
            </article>
          {/each}

          <article class="location-card add-card">
            <button type="button" class="add-card-button" onclick={addSourceCard} title="Add a storage location manually">
              <Plus size={20} strokeWidth={2.1} />
            </button>
            <div class="usage-main">
              <p class="provider-label">Manual</p>
              <h4>Add a folder</h4>
            </div>
            <p class="card-copy">Choose a folder yourself if Nearbytes did not find it automatically.</p>
          </article>
        </div>
      </section>

      {#if configPath}
        <details class="details-card minor-details">
          <summary>Configuration file</summary>
          <p class="mono-copy">{configPath}</p>
        </details>
      {/if}
      {:else}
        {@const provider = selectedProviderEntry()}
        {@const account = provider ? connectedAccountForProvider(provider.provider) : null}
        {@const shares = provider ? providerShares(provider.provider) : []}
        {@const disconnectImpact = provider ? providerDisconnectImpact(provider.provider) : { shares: 0, spaces: 0, inaccessibleSpaces: [] }}
        {#if provider}
          <section class="panel-section">
            <div class="section-head">
              <div>
                <p class="section-step">Data provider</p>
                <h3>{providerCardHeadline(provider)}</h3>
              </div>
              <div class="section-metrics">
                <span class="summary-pill">{countLabel(shares.length, 'share')}</span>
                {#if account}
                  <span class="summary-pill">{account.label}</span>
                {/if}
              </div>
            </div>

            <article class="location-card provider-card" class:active={provider.isConnected}>
              <div class="card-head">
                <div class="card-title">
                  <div class="card-icon">
                    <HardDrive size={16} strokeWidth={2.1} />
                  </div>
                  <div>
                    <p class="provider-label">Provider</p>
                    <h4>{provider.label}</h4>
                  </div>
                </div>
                <div class="card-status">
                  <span class={`status-pill tone-${providerCardTone(provider)}`}>{providerCardStatus(provider)}</span>
                  {#each provider.badges as badge}
                    <span class="status-pill tone-muted">{badge}</span>
                  {/each}
                </div>
              </div>

              <p class="card-copy">{providerCardDetail(provider)}</p>

              {#if provider.setup.status === 'installing' || (integrationBusyKey === `connect:${provider.provider}` && provider.setup.status === 'needs-install')}
                <div class="inline-progress" aria-label="Installing provider helper">
                  <div class="inline-progress-bar"></div>
                </div>
              {/if}

              {#if !provider.isConnected && provider.provider === 'gdrive' && provider.setup.status === 'needs-config'}
                {@const draft = providerSetupDraft(provider.provider)}
                <div class="provider-credentials">
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
                <p class="muted-copy">Create an OAuth client in Google Cloud, choose <strong>Desktop app</strong>, then paste the client ID here.</p>
              {/if}

              {#if !provider.isConnected && provider.provider === 'github' && provider.setup.status === 'needs-config'}
                {@const draft = providerSetupDraft(provider.provider)}
                <div class="provider-credentials">
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
                <p class="muted-copy">Create a GitHub OAuth app, enable device flow, then paste the client ID here.</p>
              {/if}

              {#if !provider.isConnected && provider.provider === 'mega'}
                {@const draft = providerCredentialDraft(provider.provider)}
                <div class="provider-credentials">
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
                </div>
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

              <div class="fact-row">
                <span>{account ? account.label : 'No account saved yet'}</span>
                {#if account?.email}
                  <span>{account.email}</span>
                {/if}
              </div>

              <div class="button-row">
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
                {#if provider.isConnected}
                  {#if provider.provider === 'github'}
                    <button
                      type="button"
                      class="panel-btn subtle compact"
                      onclick={() => void createManagedShareForProvider(provider)}
                      disabled={integrationBusyKey === `create:${provider.provider}`}
                    >
                      <span>{integrationBusyKey === `create:${provider.provider}` ? 'Creating...' : 'Create share'}</span>
                    </button>
                  {/if}
                  <ArmedActionButton
                    class="panel-btn subtle compact danger"
                    icon={Trash2}
                    text={integrationBusyKey === `disconnect:${provider.provider}` ? 'Disconnecting...' : 'Disconnect'}
                    armed={true}
                    autoDisarmMs={4000}
                    disabled={integrationBusyKey === `disconnect:${provider.provider}`}
                    resetKey={`${provider.provider}:${integrationBusyKey ?? 'idle'}`}
                    onArmStateChange={(armed) => setProviderDisconnectArmed(provider.provider, armed)}
                    onPress={() => void disconnectProvider(provider)}
                  />
                {:else}
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
              </div>
            </article>

            {#if provider.isConnected && providerDisconnectArmed[provider.provider] && disconnectImpact.spaces > 0}
              <p class="panel-error">
                {#if disconnectImpact.inaccessibleSpaces.length > 0}
                  Disconnecting {provider.label} will make {countLabel(disconnectImpact.inaccessibleSpaces.length, 'space')} not accessible until you reconnect it.
                {:else}
                  Disconnecting {provider.label} will remove {countLabel(disconnectImpact.shares, 'share')} from {countLabel(disconnectImpact.spaces, 'space')}, but those spaces will stay accessible.
                {/if}
              </p>
            {/if}

            {#if provider.isConnected && providerDisconnectArmed[provider.provider] && disconnectImpact.inaccessibleSpaces.some((targetVolumeId) => knownVolumeLabel(targetVolumeId))}
              <div class="fact-row share-volume-row">
                {#each disconnectImpact.inaccessibleSpaces as targetVolumeId}
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

            <div class="compact-share-grid">
              {#if shares.length === 0}
                <ShareCard
                  provider={provider.label}
                  title="No shares yet"
                  copy={provider.isConnected ? `Nearbytes should create or adopt the default nearbytes share automatically.` : `Connect ${provider.label} first, then Nearbytes will manage its shares here.`}
                  statusBadges={[{ label: provider.isConnected ? 'Connected' : providerCardStatus(provider), tone: providerCardTone(provider) }]}
                  meta={[provider.label]}
                />
              {:else}
                {#each shares as summary (summary.share.id)}
                  <ShareCard
                    provider={provider.label}
                    title={summary.share.label}
                  copy={summary.state.detail}
                  active={summary.state.status === 'ready'}
                  statusBadges={shareCardBadgesForManaged(summary)}
                  meta={[
                    managedShareAccessLabel(summary),
                    managedShareOpenLabel(summary),
                  ]}
                >
                    {#snippet footer()}
                      {#if shareAttachmentLabels(summary).length > 0}
                        <div class="fact-row share-volume-row">
                          {#each shareAttachmentLabels(summary) as attachment}
                            {#if attachment.known}
                              <button
                                type="button"
                                class="mini-pill mini-pill-button"
                                onclick={() => onOpenVolumeRouting?.(attachment.volumeId)}
                              >
                                {attachment.label}
                              </button>
                            {:else}
                              <span class="mini-pill">{attachment.label}</span>
                            {/if}
                          {/each}
                        </div>
                      {/if}
                    {/snippet}
                    {#snippet actions()}
                      <button
                        type="button"
                        class="panel-btn subtle compact"
                        onclick={() => summary.share.sourceId && openSourceFolder(summary.share.sourceId)}
                        disabled={!summary.share.sourceId}
                      >
                        <FolderOpen size={14} strokeWidth={2} />
                        <span>Open</span>
                      </button>
                    {/snippet}
                  </ShareCard>
                {/each}
              {/if}
            </div>
          </section>
        {/if}
      {/if}
    {:else}
      <div class="toolbar-row">
        {#if volumeId}
          <span class="summary-pill" class:warning={!hasDurableDestination(volumeId)}>{protectionSummary(volumeId)}</span>
        {/if}
        <button
          type="button"
          class="panel-btn subtle compact icon-btn"
          onclick={() => void refreshDiscoverySuggestions()}
          disabled={discoveryLoading}
          title="Scan again"
        >
          <RefreshCw size={14} strokeWidth={2} />
        </button>
        {#if dismissedSuggestionCount() > 0}
          <button type="button" class="panel-btn subtle compact" onclick={restoreDismissedSuggestions}>
            <span>Show hidden</span>
          </button>
        {/if}
      </div>

      {#if volumeId}
        <div class="overview-grid">
          <button type="button" class="overview-card tab-card" class:active={volumeView === 'copies'} onclick={() => (volumeView = 'copies')}>
            <p class="provider-label">Copies</p>
            <h3>{protectionSummary(volumeId)}</h3>
            <p class="card-copy">{hasDurableDestination(volumeId) ? 'This space is protected.' : 'Choose at least one protected copy.'}</p>
          </button>
          <button type="button" class="overview-card tab-card" class:active={volumeView === 'shares'} onclick={() => (volumeView = 'shares')}>
            <p class="provider-label">Shares</p>
            <h3>{countLabel(managedSharesForVolume(volumeId).length, 'share')}</h3>
            <p class="card-copy">{countLabel(availableManagedSharesForVolume(volumeId).length, 'share')} available to attach.</p>
          </button>
          <button type="button" class="overview-card tab-card" class:active={volumeView === 'folders'} onclick={() => (volumeView = 'folders')}>
            <p class="provider-label">Folders</p>
            <h3>{countLabel(configDraft.sources.length, 'folder')}</h3>
            <p class="card-copy">Machine-level storage shared by all spaces on this device.</p>
          </button>
        </div>
      {/if}

      {#if errorMessage}
        <p class="panel-error">{errorMessage}</p>
      {/if}
      {#if successMessage}
        <p class="panel-success">{successMessage}</p>
      {/if}

      {#if !volumeId}
        <p class="storage-message">Open this space first, then choose which locations keep a full copy.</p>
      {:else}
        {#if volumeView === 'shares'}
        <section class="panel-section">
          <div class="section-head">
            <div>
              <p class="section-step">Shares</p>
              <h3>Provider shares for this space</h3>
              <p class="section-copy">Create a new provider share for this space, or attach one that Nearbytes already knows about.</p>
            </div>
            <div class="section-metrics">
              <span class="summary-pill">{countLabel(managedSharesForVolume(volumeId).length, 'share')} attached</span>
              <span class="summary-pill">{countLabel(availableManagedSharesForVolume(volumeId).length, 'share')} available</span>
            </div>
          </div>

          <div class="card-grid">
            {#each providerCatalog as provider (provider.provider)}
              <article class="rule-card provider-card" class:active={provider.isConnected}>
                <div class="card-head">
                  <div class="card-title">
                    <div>
                      <p class="provider-label">Provider</p>
                      <h4>{provider.label}</h4>
                    </div>
                  </div>
                  <div class="card-status">
                    <span class={`status-pill tone-${providerCardTone(provider)}`}>{providerCardStatus(provider)}</span>
                    {#each provider.badges as badge}
                      <span class="status-pill tone-muted">{badge}</span>
                    {/each}
                  </div>
                </div>

                <p class="card-copy">
                  {#if provider.isConnected}
                    Nearbytes can create a managed {provider.label} share for this space and prefer it when future join links offer several routes.
                  {:else}
                    {providerCardDetail(provider)}
                  {/if}
                </p>

                {#if provider.setup.status === 'installing' || (integrationBusyKey === `connect:${provider.provider}` && provider.setup.status === 'needs-install')}
                  <div class="inline-progress" aria-label="Installing provider helper">
                    <div class="inline-progress-bar"></div>
                  </div>
                {/if}

                {#if !provider.isConnected && provider.provider === 'gdrive' && provider.setup.status === 'needs-config'}
                  {@const draft = providerSetupDraft(provider.provider)}
                  <div class="provider-credentials">
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
                  <p class="muted-copy">Create a Google OAuth Desktop app client, paste the client ID here, then connect. Nearbytes uses the installed-app PKCE flow, so you do not need a client secret.</p>
                {/if}

                {#if !provider.isConnected && provider.provider === 'github' && provider.setup.status === 'needs-config'}
                  {@const draft = providerSetupDraft(provider.provider)}
                  <div class="provider-credentials">
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
                  <p class="muted-copy">Create a GitHub OAuth app, enable device flow, then paste the client ID here.</p>
                {/if}

                {#if !provider.isConnected && provider.provider === 'mega'}
                  {@const draft = providerCredentialDraft(provider.provider)}
                  <div class="provider-credentials">
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
                  </div>
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
                        placeholder={defaultGithubBasePath(defaultManagedShareLabel())}
                        oninput={(event) => setProviderShareField(provider.provider, 'basePath', (event.currentTarget as HTMLInputElement).value)}
                      />
                    </label>
                  </div>
                {/if}

                <div class="button-row">
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
                  {#if provider.isConnected}
                    <button
                      type="button"
                      class="panel-btn subtle compact"
                      onclick={() => void createManagedShareForVolume(provider)}
                      disabled={integrationBusyKey === `create:${provider.provider}`}
                    >
                      <span>{integrationBusyKey === `create:${provider.provider}` ? 'Creating...' : 'Create share'}</span>
                    </button>
                  {:else}
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
                </div>
              </article>
            {/each}

            {#each managedSharesForVolume(volumeId) as summary (summary.share.id)}
              <article class="rule-card" class:active={true}>
                <div class="card-head">
                  <div class="card-title">
                    <div>
                      <p class="provider-label">{summary.share.provider === 'gdrive' ? 'Google Drive' : summary.share.provider === 'mega' ? 'MEGA' : summary.share.provider}</p>
                      <h4>{summary.share.label}</h4>
                    </div>
                  </div>
                  <div class="card-status">
                    <span class={`status-pill tone-${shareStatusTone(summary)}`}>Attached</span>
                    <span class={`status-pill tone-${shareStatusTone(summary)}`}>{shareStatusLabel(summary)}</span>
                  </div>
                </div>

                <p class="card-copy">{summary.state.detail}</p>

                <div class="fact-row">
                  <span title={summary.share.localPath}>{managedShareOpenLabel(summary)}</span>
                  <span>{shareAttachmentSummary(summary)}</span>
                </div>

                <div class="button-row">
                  <button
                    type="button"
                    class="panel-btn subtle compact"
                    onclick={() => summary.share.sourceId && openSourceFolder(summary.share.sourceId)}
                    disabled={!summary.share.sourceId}
                  >
                    <FolderOpen size={14} strokeWidth={2} />
                    <span>Open</span>
                  </button>
                </div>
              </article>
            {/each}

            {#each availableManagedSharesForVolume(volumeId) as summary (summary.share.id)}
              <article class="rule-card suggestion-card">
                <div class="card-head">
                  <div class="card-title">
                    <div>
                      <p class="provider-label">{summary.share.provider === 'gdrive' ? 'Google Drive' : summary.share.provider === 'mega' ? 'MEGA' : summary.share.provider}</p>
                      <h4>{summary.share.label}</h4>
                    </div>
                  </div>
                  <div class="card-status">
                    <span class={`status-pill tone-${shareStatusTone(summary)}`}>{shareStatusLabel(summary)}</span>
                    <span class="status-pill tone-muted">Available</span>
                  </div>
                </div>

                <p class="card-copy">{summary.state.detail}</p>

                <div class="fact-row">
                  <span title={summary.share.localPath}>{managedShareOpenLabel(summary)}</span>
                  <span>{shareAttachmentSummary(summary)}</span>
                </div>

                <div class="button-row">
                  <button
                    type="button"
                    class="panel-btn subtle compact"
                    onclick={() => void attachManagedShareToVolume(summary)}
                    disabled={integrationBusyKey === `attach:${summary.share.id}`}
                  >
                    <span>{integrationBusyKey === `attach:${summary.share.id}` ? 'Attaching...' : 'Attach to this space'}</span>
                  </button>
                </div>
              </article>
            {/each}
          </div>
        </section>
        {/if}

        {#if volumeView === 'copies'}
        <div class="protection-banner" class:warning={!hasDurableDestination(volumeId)}>
          <Shield size={15} strokeWidth={2} />
          <span>{protectionHint(volumeId)}</span>
        </div>

        {#if discoveryError}
          <p class="warning-copy">{discoveryError}</p>
        {/if}

        <section class="panel-section">
          <div class="section-head">
            <div>
              <p class="section-step">Copies</p>
              <h3>{explicitVolumePolicy(volumeId) ? 'This space has its own copy rule' : 'This space currently inherits the default copy rule'}</h3>
              <p class="section-copy">
                {#if explicitVolumePolicy(volumeId)}
                  Changes below are saved only for this space. Remove the custom rule to use the default rule again.
                {:else}
                  The switches below start from your default rule. Changing them will create a saved rule for this space only.
                {/if}
              </p>
            </div>
            {#if explicitVolumePolicy(volumeId)}
              <ArmedActionButton
                class="panel-btn subtle compact danger"
                icon={Trash2}
                text="Use default rules again"
                armed={true}
                autoDisarmMs={3000}
                onPress={() => removeVolumePolicy(volumeId)}
              />
            {/if}
          </div>

          <div class="rule-grid">
            {#each configDraft.sources as source (source.id)}
              {@const destination = destinationFor(volumeId, source.id)}
              {@const availability = locationAvailability(source)}
              {@const writeState = locationWriteState(source)}
              <article class="rule-card" class:active={protectionTone(destination, source.id) === 'durable'}>
                <div class="card-head">
                  <div class="card-title">
                    <div>
                      <p class="provider-label">{formatProvider(source.provider)}</p>
                      <h4>{compactPath(source.path)}</h4>
                    </div>
                  </div>
                  <div class="card-status">
                    <span class={`status-pill tone-${availability.tone}`}>{availability.label}</span>
                    <span class={`status-pill tone-${writeState.tone}`}>{writeState.label}</span>
                    <span class={`status-pill tone-${protectionTone(destination, source.id)}`}>{protectionLabel(destination, source.id)}</span>
                  </div>
                </div>

                <label class="inline-toggle">
                  <input
                    type="checkbox"
                    checked={keepsFullCopy(destination)}
                    onchange={(event) => setKeepFullCopy(volumeId, source.id, (event.currentTarget as HTMLInputElement).checked)}
                  />
                  <div>
                    <span class="toggle-title">Keep this space here</span>
                    <span class="toggle-copy">Full history and file data.</span>
                  </div>
                </label>

                <p class="card-copy">{copyHelpText(volumeId, source)}</p>

                <details class="details-card inline-details">
                  <summary>Advanced</summary>
                  {#if keepsFullCopy(destination)}
                    <div class="field-grid">
                      <label class="field-block">
                        <span>Keep free</span>
                        <select
                          class="panel-input"
                          value={String(destinationReservePercent(destination))}
                          onchange={(event) =>
                            updateDestinationField(volumeId, source.id, 'reservePercent', clampReserve((event.currentTarget as HTMLSelectElement).value))}
                        >
                          {#each RESERVE_OPTIONS as option}
                            <option value={option}>{formatPercent(option)}</option>
                          {/each}
                        </select>
                      </label>
                      <label class="field-block">
                        <span>If space runs low</span>
                        <select
                          class="panel-input"
                          value={destination?.fullPolicy ?? 'block-writes'}
                          onchange={(event) =>
                            updateDestinationField(volumeId, source.id, 'fullPolicy', (event.currentTarget as HTMLSelectElement).value as StorageFullPolicy)}
                        >
                          <option value="block-writes">Never delete this protected copy</option>
                          <option value="drop-older-blocks">Delete blocks here after another protected copy exists</option>
                        </select>
                      </label>
                    </div>
                  {/if}

                  <div class="button-row">
                    <button type="button" class="panel-btn subtle compact" onclick={() => openSourceFolder(source.id)} disabled={!hasSourcePath(source)}>
                      <FolderOpen size={14} strokeWidth={2} />
                      <span>Open</span>
                    </button>
                    <button
                      type="button"
                      class="panel-btn subtle compact"
                      onclick={() => void (hasSourcePath(source) ? moveSourceFolder(source.id) : chooseSourceFolder(source.id))}
                      disabled={movingSourceId === source.id || Boolean(source.moveFromSourceId) || hasPendingMove(source.id)}
                      title={hasSourcePath(source) ? 'Move this storage location without interrupting service' : 'Choose folder'}
                    >
                      <ArrowRightLeft size={14} strokeWidth={2} />
                      <span>{movingSourceId === source.id ? 'Moving...' : hasSourcePath(source) ? 'Move folder' : 'Choose folder'}</span>
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
                </details>

                <div class="fact-row">
                  <span>{locationSummary(source)}</span>
                </div>
              </article>
            {/each}
            {#each sourceSuggestionRows() as row (row.source.path)}
              <article class="rule-card suggestion-card">
                <div class="card-head">
                  <div class="card-title">
                    <div class="card-icon" title={row.source.path}>
                      <Search size={16} strokeWidth={2.1} />
                    </div>
                    <div title={row.source.path}>
                      <p class="provider-label">{formatProvider(row.source.provider)}</p>
                      <h4>{compactPath(row.source.path)}</h4>
                    </div>
                  </div>
                  <div class="card-status">
                    <span class="status-pill tone-muted">Found automatically</span>
                  </div>
                </div>

                <p class="card-copy">{sourceSuggestionCopy(row.source)}</p>

                <div class="button-row">
                  <button type="button" class="panel-btn subtle compact" onclick={() => addDiscoveredSource(row.source)}>
                    <Plus size={14} strokeWidth={2} />
                    <span>Add location</span>
                  </button>
                  <button type="button" class="panel-btn subtle compact danger" onclick={() => dismissDiscovery(row.source)}>
                    <span>Hide</span>
                  </button>
                </div>
              </article>
            {/each}

            <article class="rule-card add-card">
              <button type="button" class="add-card-button" onclick={addSourceCard} title="Add a storage location manually">
                <Plus size={20} strokeWidth={2.1} />
              </button>
              <div class="usage-main">
                <p class="provider-label">Manual</p>
                <h4>Add a folder</h4>
              </div>
              <p class="card-copy">Choose a folder yourself if Nearbytes did not find it automatically.</p>
            </article>
          </div>
        </section>
        {/if}

        {#if volumeView === 'folders'}
        <section class="panel-section">
          <div class="section-head">
            <div>
              <p class="section-step">Folders</p>
              <h3>Machine-level folders</h3>
              <p class="section-copy">Changes here affect every space on this device. Use this view when you want to add, move, or disable a local storage folder.</p>
            </div>
            <div class="section-metrics">
              <span class="summary-pill">{countLabel(configDraft.sources.length, 'folder')} saved</span>
              <span class="summary-pill" class:warning={!hasDurableDestination(null)}>{protectionSummary(null)}</span>
            </div>
          </div>

          {#if discoveryError}
            <p class="warning-copy">{discoveryError}</p>
          {/if}

          <div class="protection-banner" class:warning={!hasDurableDestination(null)}>
            <Shield size={15} strokeWidth={2} />
            <span>{protectionHint(null)}</span>
          </div>

          <div class="card-grid">
            {#each configDraft.sources as source (source.id)}
              {@const status = sourceStatus(source.id)}
              {@const availability = locationAvailability(source)}
              {@const writeState = locationWriteState(source)}
              {@const defaultDestination = destinationFor(null, source.id)}
              <article class="location-card" class:active={protectionTone(defaultDestination, source.id) === 'durable'}>
                <div class="card-head">
                  <div class="card-title">
                    <div class="card-icon" title={source.path || 'No folder selected yet'}>
                      <HardDrive size={16} strokeWidth={2.1} />
                    </div>
                    <div title={source.path || 'No folder selected yet'}>
                      <p class="provider-label">{formatProvider(source.provider)}</p>
                      <h4>{compactPath(source.path)}</h4>
                    </div>
                  </div>
                  <div class="card-status">
                    <span class={`status-pill tone-${availability.tone}`}>{availability.label}</span>
                    <span class={`status-pill tone-${writeState.tone}`}>{writeState.label}</span>
                  </div>
                </div>

                <p class="card-copy">{locationSummary(source)}</p>

                <div class="toggle-stack">
                  <label class="inline-toggle compact-toggle-line">
                    <input
                      type="checkbox"
                      checked={source.enabled}
                      aria-label="Use this folder for reads"
                      onchange={(event) => updateSourceField(source.id, 'enabled', (event.currentTarget as HTMLInputElement).checked)}
                    />
                    <div>
                      <span class="toggle-title">Use for reads</span>
                      <span class="toggle-copy">Read existing Nearbytes data from this folder.</span>
                    </div>
                  </label>
                  <label class="inline-toggle compact-toggle-line">
                    <input
                      type="checkbox"
                      checked={source.writable}
                      aria-label="Save new data here"
                      onchange={(event) => updateSourceField(source.id, 'writable', (event.currentTarget as HTMLInputElement).checked)}
                    />
                    <div>
                      <span class="toggle-title">Save new data here</span>
                      <span class="toggle-copy">Allow Nearbytes to write new encrypted data here.</span>
                    </div>
                  </label>
                  <label class="inline-toggle compact-toggle-line">
                    <input
                      type="checkbox"
                      checked={keepsFullCopy(defaultDestination)}
                      aria-label="Use by default for new spaces"
                      onchange={(event) => setKeepFullCopy(null, source.id, (event.currentTarget as HTMLInputElement).checked)}
                    />
                    <div>
                      <span class="toggle-title">Use by default for new spaces</span>
                      <span class="toggle-copy">{copyHelpText(null, source)}</span>
                    </div>
                  </label>
                </div>

                <div class="fact-row">
                  <span>{status?.availableBytes !== undefined ? `${formatSize(status.availableBytes)} free` : 'Free space unknown'}</span>
                  <span>{usageSummary(source.id)}</span>
                </div>

                <details class="details-card inline-details">
                  <summary>Advanced</summary>
                  <div class="card-control-row">
                    <label class="field-block compact-field" title="Minimum free space to leave on this drive. Default is 5%.">
                      <span>Keep free</span>
                      <select
                        class="panel-input"
                        value={String(sourceReservePercent(source))}
                        onchange={(event) => {
                          const nextValue = clampReserve((event.currentTarget as HTMLSelectElement).value);
                          updateSourceField(source.id, 'reservePercent', nextValue);
                          if (keepsFullCopy(defaultDestination)) {
                            updateDestinationField(null, source.id, 'reservePercent', nextValue);
                          }
                        }}
                      >
                        {#each RESERVE_OPTIONS as option}
                          <option value={option}>{formatPercent(option)}</option>
                        {/each}
                      </select>
                    </label>

                    <div class="button-row">
                      {#if hasSourcePath(source)}
                        <button
                          type="button"
                          class="panel-btn subtle compact"
                          onclick={() => void moveSourceFolder(source.id)}
                          disabled={movingSourceId === source.id || Boolean(source.moveFromSourceId) || hasPendingMove(source.id)}
                          title="Move this storage location to a different folder without interrupting service"
                        >
                          <ArrowRightLeft size={14} strokeWidth={2} />
                          <span>{movingSourceId === source.id ? 'Moving...' : 'Move folder'}</span>
                        </button>
                        <button
                          type="button"
                          class="panel-btn subtle compact"
                          onclick={() => openSourceFolder(source.id)}
                          title={source.path || 'Open folder'}
                        >
                          <FolderOpen size={14} strokeWidth={2} />
                          <span>Open</span>
                        </button>
                      {:else}
                        <button type="button" class="panel-btn subtle compact" onclick={() => chooseSourceFolder(source.id)}>
                          <Search size={14} strokeWidth={2} />
                          <span>Choose folder</span>
                        </button>
                      {/if}
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
                  </div>

                  {#if status?.lastWriteFailure}
                    <p class="warning-copy">Last write problem: {status.lastWriteFailure.message}</p>
                  {/if}
                </details>
              </article>
            {/each}
            {#each sourceSuggestionRows() as row (row.source.path)}
              <article class="location-card suggestion-card">
                <div class="card-head">
                  <div class="card-title">
                    <div class="card-icon" title={row.source.path}>
                      <Search size={16} strokeWidth={2.1} />
                    </div>
                    <div title={row.source.path}>
                      <p class="provider-label">{formatProvider(row.source.provider)}</p>
                      <h4>{compactPath(row.source.path)}</h4>
                    </div>
                  </div>
                  <div class="card-status">
                    <span class="status-pill tone-muted">Found automatically</span>
                  </div>
                </div>

                <p class="card-copy">{sourceSuggestionCopy(row.source)}</p>

                <div class="button-row">
                  <button type="button" class="panel-btn subtle compact" onclick={() => addDiscoveredSource(row.source)}>
                    <Plus size={14} strokeWidth={2} />
                    <span>Use folder</span>
                  </button>
                  <button type="button" class="panel-btn subtle compact danger" onclick={() => dismissDiscovery(row.source)}>
                    <span>Hide</span>
                  </button>
                </div>
              </article>
            {/each}

            <article class="location-card add-card">
              <button type="button" class="add-card-button" onclick={addSourceCard} title="Add a storage location manually">
                <Plus size={20} strokeWidth={2.1} />
              </button>
              <div class="usage-main">
                <p class="provider-label">Manual</p>
                <h4>Add a folder</h4>
              </div>
              <p class="card-copy">Choose a folder yourself if Nearbytes did not find it automatically.</p>
            </article>
          </div>
        </section>
        {/if}
      {/if}
    {/if}
  </section>
{/if}

<style>
  .storage-panel {
    --panel-border: rgba(111, 173, 252, 0.18);
    --panel-soft-border: rgba(111, 173, 252, 0.12);
    --panel-bg:
      radial-gradient(circle at top left, rgba(56, 189, 248, 0.09), transparent 32%),
      linear-gradient(180deg, rgba(8, 16, 30, 0.97), rgba(7, 12, 24, 0.95));
    --card-bg: rgba(10, 19, 34, 0.8);
    --card-bg-strong: rgba(12, 22, 40, 0.92);
    --text-main: rgba(241, 245, 249, 0.96);
    --text-soft: rgba(191, 219, 254, 0.78);
    --text-faint: rgba(191, 219, 254, 0.62);
    --teal: rgba(153, 246, 228, 0.96);
    --warn: rgba(254, 240, 138, 0.96);
    --danger: rgba(254, 202, 202, 0.96);
    display: grid;
    gap: 0.85rem;
    width: 100%;
    min-height: 0;
    padding: 0.9rem;
    overflow: auto;
    border: 1px solid var(--panel-border);
    border-radius: 22px;
    background: var(--panel-bg);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.04),
      0 18px 40px rgba(2, 6, 23, 0.18);
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
    gap: 0.75rem;
    align-items: center;
  }

  .section-head,
  .card-head,
  .scan-group-head {
    justify-content: space-between;
  }

  .toolbar-row {
    margin-bottom: 0.15rem;
  }

  .overview-grid {
    display: grid;
    gap: 0.75rem;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  }

  .overview-card {
    display: grid;
    text-align: left;
    gap: 0.35rem;
    padding: 0.82rem;
    border-radius: 16px;
    border: 1px solid var(--panel-soft-border);
    background: rgba(7, 15, 29, 0.56);
  }

  .tab-card {
    cursor: pointer;
    transition:
      transform 120ms ease,
      border-color 120ms ease,
      background 120ms ease,
      box-shadow 120ms ease;
  }

  .tab-card:hover {
    transform: translateY(-1px);
    border-color: rgba(103, 232, 249, 0.24);
  }

  .tab-card.active {
    border-color: rgba(245, 158, 11, 0.76);
    background:
      radial-gradient(circle at top left, rgba(250, 204, 21, 0.08), transparent 36%),
      rgba(12, 31, 56, 0.96);
    box-shadow: inset 0 0 0 2px rgba(245, 158, 11, 0.96);
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
    font-size: 0.7rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: rgba(110, 231, 249, 0.9);
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
  .warning-copy,
  .mono-copy {
    margin: 0;
  }

  h3,
  h4 {
    color: var(--text-main);
  }

  h3 {
    font-size: 0.96rem;
    line-height: 1.35;
  }

  h4 {
    font-size: 0.92rem;
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
    font-size: 0.8rem;
    line-height: 1.4;
  }

  .warning-copy {
    color: var(--warn);
    font-size: 0.82rem;
    line-height: 1.4;
  }

  .mono-copy {
    font-family: 'Monaco', 'Menlo', monospace;
    font-size: 0.75rem;
    color: var(--text-soft);
    word-break: break-all;
  }

  .panel-section,
  .details-card,
  .location-card,
  .rule-card,
  .scan-card,
  .scan-group {
    display: grid;
    gap: 0.75rem;
    min-width: 0;
    border-radius: 16px;
    border: 1px solid var(--panel-soft-border);
    background: rgba(7, 15, 29, 0.56);
  }

  .panel-section,
  .details-card {
    padding: 0.82rem;
  }

  .location-card,
  .rule-card,
  .scan-card,
  .scan-group {
    padding: 0.85rem;
  }

  .card-grid,
  .rule-grid,
  .scan-card-list,
  .scan-group-list {
    display: grid;
    gap: 0.75rem;
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
    border-color: rgba(45, 212, 191, 0.26);
    background:
      radial-gradient(circle at top left, rgba(45, 212, 191, 0.08), transparent 36%),
      var(--card-bg-strong);
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
  .inline-toggle > div,
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
    border: 1px solid rgba(96, 165, 250, 0.18);
    background: rgba(14, 27, 49, 0.88);
    color: rgba(191, 219, 254, 0.9);
  }

  .summary-pill,
  .status-pill,
  .mini-pill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 28px;
    max-width: 100%;
    padding: 0.22rem 1rem;
    border-radius: 999px;
    border: 1px solid rgba(96, 165, 250, 0.18);
    background: rgba(12, 23, 41, 0.84);
    color: rgba(219, 234, 254, 0.92);
    font-size: 0.7rem;
    font-weight: 600;
    line-height: 1.2;
    white-space: nowrap;
    box-sizing: border-box;
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
    border-color: rgba(250, 204, 21, 0.34);
    background: rgba(46, 35, 8, 0.78);
    color: rgba(254, 240, 138, 0.96);
  }

  .summary-pill.warning,
  .status-pill.tone-warn {
    border-color: rgba(251, 191, 36, 0.28);
    background: rgba(72, 53, 16, 0.46);
    color: var(--warn);
  }

  .status-pill.tone-good,
  .status-pill.tone-durable {
    border-color: rgba(45, 212, 191, 0.28);
    background: rgba(9, 58, 58, 0.42);
    color: var(--teal);
  }

  .status-pill.tone-muted,
  .status-pill.tone-replica,
  .status-pill.tone-off,
  .mini-pill {
    border-color: rgba(96, 165, 250, 0.18);
    background: rgba(12, 23, 41, 0.82);
    color: rgba(191, 219, 254, 0.88);
  }

  .panel-btn,
  :global(.panel-btn) {
    min-height: 34px;
    border-radius: 12px;
    border: 1px solid rgba(96, 165, 250, 0.22);
    background: rgba(12, 24, 43, 0.84);
    color: rgba(241, 245, 249, 0.94);
    padding: 0 0.82rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.48rem;
    font-size: 0.79rem;
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
    border-color: rgba(125, 211, 252, 0.32);
  }

  .panel-btn:disabled,
  :global(.panel-btn:disabled) {
    opacity: 0.55;
    cursor: default;
    transform: none;
  }

  .panel-btn.primary,
  :global(.panel-btn.primary) {
    background: linear-gradient(135deg, rgba(14, 116, 144, 0.94), rgba(37, 99, 235, 0.9));
    border-color: rgba(103, 232, 249, 0.24);
  }

  .panel-btn.subtle,
  :global(.panel-btn.subtle) {
    background: rgba(12, 24, 43, 0.68);
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
    border-color: rgba(248, 113, 113, 0.24);
    color: rgba(254, 226, 226, 0.94);
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
    border: 1px solid rgba(248, 113, 113, 0.22);
    background: rgba(127, 29, 29, 0.26);
  }

  .panel-success {
    color: rgba(209, 250, 229, 0.96);
    border: 1px solid rgba(45, 212, 191, 0.22);
    background: rgba(6, 78, 59, 0.24);
  }

  .protection-banner {
    color: rgba(204, 251, 241, 0.94);
    border: 1px solid rgba(45, 212, 191, 0.18);
    background: rgba(8, 56, 49, 0.22);
  }

  .protection-banner.warning {
    color: var(--warn);
    border-color: rgba(251, 191, 36, 0.2);
    background: rgba(72, 53, 16, 0.3);
  }

  .toggle-list,
  .usage-list,
  .danger-block {
    display: grid;
    gap: 0.68rem;
  }

  .toggle-stack {
    display: grid;
    gap: 0.55rem;
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

  .inline-toggle {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.55rem;
    align-items: start;
  }

  .inline-toggle input {
    margin-top: 0.22rem;
    width: 17px;
    height: 17px;
    accent-color: #14b8a6;
  }

  .inline-toggle > div {
    display: grid;
    gap: 0.12rem;
  }

  .compact-toggle-line {
    padding: 0.68rem 0.74rem;
    border-radius: 12px;
    border: 1px solid rgba(96, 165, 250, 0.12);
    background: rgba(10, 18, 31, 0.56);
  }

  .toggle-title {
    color: var(--text-main);
    font-size: 0.82rem;
    font-weight: 600;
  }

  .toggle-copy,
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

  .fact-row span {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .subheading {
    margin: 0;
    color: rgba(224, 242, 254, 0.92);
    font-weight: 600;
  }

  .field-grid {
    display: grid;
    gap: 0.65rem;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  }

  .provider-credentials {
    display: grid;
    gap: 0.55rem;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  }

  .compact-share-grid {
    display: grid;
    gap: 0.72rem;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  }

  .share-toggle-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.46rem;
  }

  .share-toggle-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    min-height: 32px;
    padding: 0.28rem 0.78rem 0.28rem 0.62rem;
    border-radius: 999px;
    border: 1px solid rgba(96, 165, 250, 0.14);
    background: rgba(9, 18, 34, 0.7);
    color: rgba(191, 219, 254, 0.88);
    font: inherit;
    font-size: 0.78rem;
    font-weight: 600;
    line-height: 1.1;
    cursor: pointer;
    transition:
      border-color 140ms ease,
      background 140ms ease,
      color 140ms ease,
      transform 140ms ease;
  }

  .share-toggle-pill:hover {
    transform: translateY(-1px);
    border-color: rgba(125, 211, 252, 0.26);
  }

  .share-toggle-pill.active {
    border-color: rgba(45, 212, 191, 0.28);
    background: rgba(9, 58, 58, 0.34);
    color: #5eead4;
  }

  .share-toggle-icon {
    width: 16px;
    height: 16px;
    border-radius: 999px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid rgba(96, 165, 250, 0.18);
    background: rgba(12, 23, 41, 0.9);
    color: inherit;
    flex: 0 0 auto;
  }

  .share-toggle-pill.active .share-toggle-icon {
    border-color: rgba(45, 212, 191, 0.22);
    background: rgba(9, 58, 58, 0.58);
  }

  .compact-share-advanced {
    padding: 0.72rem;
    background: rgba(7, 15, 29, 0.42);
  }

  .field-block {
    display: grid;
    gap: 0.3rem;
  }

  .field-block > span {
    color: rgba(224, 242, 254, 0.92);
    font-size: 0.75rem;
    font-weight: 600;
  }

  .toggle-only-label {
    display: inline-flex;
    align-items: center;
    gap: 0.55rem;
    min-height: 34px;
    color: rgba(224, 242, 254, 0.92);
    font-size: 0.78rem;
    font-weight: 600;
  }

  .toggle-only-label input {
    width: 16px;
    height: 16px;
    accent-color: #14b8a6;
  }

  .inline-progress {
    position: relative;
    overflow: hidden;
    height: 6px;
    border-radius: 999px;
    background: rgba(12, 24, 43, 0.82);
    border: 1px solid rgba(96, 165, 250, 0.14);
  }

  .inline-progress-bar {
    position: absolute;
    inset: 0 auto 0 0;
    width: 34%;
    border-radius: inherit;
    background: linear-gradient(90deg, rgba(250, 204, 21, 0.18), rgba(245, 158, 11, 0.95), rgba(250, 204, 21, 0.18));
    animation: provider-progress-slide 1.1s ease-in-out infinite;
  }

  .panel-input {
    min-height: 34px;
    border-radius: 10px;
    border: 1px solid rgba(96, 165, 250, 0.18);
    background: rgba(10, 18, 31, 0.92);
    color: var(--text-main);
    padding: 0 0.68rem;
    font-size: 0.78rem;
  }

  .panel-input:disabled {
    opacity: 0.55;
  }

  .details-card summary {
    cursor: pointer;
    color: rgba(224, 242, 254, 0.94);
    font-size: 0.83rem;
    font-weight: 600;
    list-style: none;
  }

  .details-card summary::-webkit-details-marker {
    display: none;
  }

  .details-card summary::before {
    content: '+';
    display: inline-block;
    width: 1rem;
    color: rgba(103, 232, 249, 0.9);
  }

  .details-card[open] summary::before {
    content: '-';
  }

  .suggestion-card {
    background: rgba(8, 18, 33, 0.56);
  }

  .add-card {
    place-items: center;
    align-content: center;
    text-align: center;
    background: rgba(8, 18, 33, 0.42);
    border-style: dashed;
  }

  .add-card-button {
    width: 46px;
    height: 46px;
    border-radius: 16px;
    border: 1px dashed rgba(103, 232, 249, 0.28);
    background: rgba(12, 24, 43, 0.72);
    color: rgba(241, 245, 249, 0.94);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition:
      transform 120ms ease,
      border-color 120ms ease,
      background 120ms ease;
  }

  .add-card-button:hover {
    transform: translateY(-1px);
    border-color: rgba(153, 246, 228, 0.42);
    background: rgba(14, 32, 56, 0.88);
  }

  .scan-card {
    grid-template-columns: 1fr auto;
    align-items: start;
  }

  .scan-group {
    background: rgba(8, 18, 33, 0.62);
  }

  .usage-row {
    display: grid;
    gap: 0.35rem 0.9rem;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    padding: 0.75rem 0.85rem;
    border-radius: 14px;
    background: rgba(12, 23, 41, 0.5);
    border: 1px solid rgba(96, 165, 250, 0.12);
  }

  .merge-box {
    display: grid;
    gap: 0.7rem;
    padding: 0.78rem;
    border-radius: 12px;
    border: 1px solid rgba(96, 165, 250, 0.14);
    background: rgba(12, 23, 41, 0.54);
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

  .minor-details {
    background: rgba(7, 15, 29, 0.46);
  }

  .inline-details {
    padding: 0.72rem 0.78rem;
    background: rgba(8, 18, 33, 0.42);
  }

  @keyframes provider-progress-slide {
    0% {
      transform: translateX(-110%);
    }
    100% {
      transform: translateX(320%);
    }
  }

  @media (max-width: 760px) {
    .storage-panel {
      padding: 0.85rem;
      border-radius: 18px;
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
    .tab-card {
      flex: 1 1 100%;
    }
  }
</style>
