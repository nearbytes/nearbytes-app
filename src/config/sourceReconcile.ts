import { createHash } from 'crypto';
import {
  getExplicitVolumePolicy,
  parseRootsConfig,
  resolveVolumeDestinations,
  type RootProvider,
  type RootsConfig,
  type SourceConfigEntry,
  type StorageFullPolicy,
  type VolumeDestinationConfig,
  type VolumePolicyEntry,
} from './roots.js';
import { discoverNearbytesRoots } from './sourceDiscovery.js';

export type DiscoveryAction =
  | 'added-source'
  | 'added-volume-target'
  | 'available-share'
  | 'already-known-source';

export interface DiscoveryProviderSummary {
  readonly detected: number;
  readonly sourcesAdded: number;
  readonly volumeTargetsAdded: number;
  readonly availableShares: number;
}

export interface ReconciledDiscoveredSourceItem {
  readonly provider: RootProvider;
  readonly path: string;
  readonly markerFile: string;
  readonly classification: 'marker' | 'layout';
  readonly hasMarker: boolean;
  readonly hasBlocks: boolean;
  readonly hasChannels: boolean;
  readonly configuredSourceId?: string;
  readonly detectedVolumeIds: string[];
  readonly matchedVolumeIds: string[];
  readonly unknownVolumeIds: string[];
  readonly addedTargetVolumeIds: string[];
  readonly actions: DiscoveryAction[];
}

export interface ReconciledSourcesSummary {
  readonly scannedAt: number;
  readonly discoveredCount: number;
  readonly sourcesAdded: number;
  readonly volumeTargetsAdded: number;
  readonly availableShares: number;
  readonly meaningfulItemCount: number;
  readonly providers: Partial<Record<RootProvider, DiscoveryProviderSummary>>;
}

export interface ReconcileDiscoveredSourcesResult {
  readonly runKey: string;
  readonly changed: boolean;
  readonly knownVolumeIds: string[];
  readonly summary: ReconciledSourcesSummary;
  readonly items: ReconciledDiscoveredSourceItem[];
  readonly config: RootsConfig;
}

const CHANNEL_DIRECTORY_REGEX = /^[a-f0-9]{64,200}$/i;
const DEFAULT_RESERVE_PERCENT = 5;
const DEFAULT_FULL_POLICY: StorageFullPolicy = 'block-writes';

export async function reconcileDiscoveredSources(options: {
  readonly currentConfig: RootsConfig;
  readonly knownVolumeIds?: readonly string[];
  readonly includeDefaultRoots?: boolean;
}): Promise<ReconcileDiscoveredSourcesResult> {
  const discovered = await discoverNearbytesRoots({
    includeDefaultRoots: options.includeDefaultRoots,
  });
  const nextConfig = cloneConfig(options.currentConfig);
  const seenSources = new Map<string, SourceConfigEntry>();
  for (const source of nextConfig.sources) {
    seenSources.set(toComparablePath(source.path), source);
  }

  const knownVolumeIds = collectKnownVolumeIds(nextConfig, options.knownVolumeIds);
  const knownVolumeIdSet = new Set(knownVolumeIds);
  const providerSummary = new Map<RootProvider, DiscoveryProviderSummary>();
  const items: ReconciledDiscoveredSourceItem[] = [];
  let sourcesAdded = 0;
  let volumeTargetsAdded = 0;
  let availableShares = 0;

  for (const discoveredSource of discovered) {
    const comparablePath = toComparablePath(discoveredSource.path);
    let configuredSource = seenSources.get(comparablePath);
    const actions = new Set<DiscoveryAction>();
    const matchedVolumeIds = discoveredSource.volumeIds.filter((value) => knownVolumeIdSet.has(value));
    const unknownVolumeIds = discoveredSource.volumeIds.filter((value) => !knownVolumeIdSet.has(value));
    const addedTargetVolumeIds: string[] = [];

    let summary = providerSummary.get(discoveredSource.provider);
    if (!summary) {
      summary = {
        detected: 0,
        sourcesAdded: 0,
        volumeTargetsAdded: 0,
        availableShares: 0,
      };
      providerSummary.set(discoveredSource.provider, summary);
    }
    incrementProviderSummary(summary, 'detected', 1);

    if (!configuredSource) {
      configuredSource = createAutoSource(nextConfig, discoveredSource.provider, discoveredSource.path);
      nextConfig.sources.push(configuredSource);
      seenSources.set(comparablePath, configuredSource);
      actions.add('added-source');
      sourcesAdded += 1;
      incrementProviderSummary(summary, 'sourcesAdded', 1);
    }

    for (const volumeId of matchedVolumeIds) {
      if (ensureExplicitVolumeDestination(nextConfig, volumeId, configuredSource.id)) {
        addedTargetVolumeIds.push(volumeId);
        actions.add('added-volume-target');
        volumeTargetsAdded += 1;
        incrementProviderSummary(summary, 'volumeTargetsAdded', 1);
      }
    }

    if (
      actions.has('added-source') &&
      (addedTargetVolumeIds.length === 0 || unknownVolumeIds.length > 0)
    ) {
      actions.add('available-share');
      availableShares += 1;
      incrementProviderSummary(summary, 'availableShares', 1);
    }

    if (actions.size === 0) {
      actions.add('already-known-source');
    }

    items.push({
      provider: discoveredSource.provider,
      path: discoveredSource.path,
      markerFile: discoveredSource.markerFile,
      classification: discoveredSource.sourceType,
      hasMarker: discoveredSource.hasMarker,
      hasBlocks: discoveredSource.hasBlocks,
      hasChannels: discoveredSource.hasChannels,
      configuredSourceId: configuredSource.id,
      detectedVolumeIds: discoveredSource.volumeIds,
      matchedVolumeIds,
      unknownVolumeIds,
      addedTargetVolumeIds,
      actions: Array.from(actions.values()),
    });
  }

  items.sort(compareReconciledItem);
  const config = parseRootsConfig(nextConfig);
  const summary: ReconciledSourcesSummary = {
    scannedAt: Date.now(),
    discoveredCount: items.length,
    sourcesAdded,
    volumeTargetsAdded,
    availableShares,
    meaningfulItemCount: items.filter(isMeaningfulItem).length,
    providers: Object.fromEntries(providerSummary.entries()),
  };

  return {
    runKey: createRunKey(summary, items),
    changed: sourcesAdded > 0 || volumeTargetsAdded > 0,
    knownVolumeIds,
    summary,
    items,
    config,
  };
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

function collectKnownVolumeIds(config: RootsConfig, suppliedVolumeIds: readonly string[] | undefined): string[] {
  const all = new Set<string>();
  for (const volume of config.volumes) {
    all.add(volume.volumeId.toLowerCase());
  }
  for (const volumeId of suppliedVolumeIds ?? []) {
    const normalized = volumeId.trim().toLowerCase();
    if (CHANNEL_DIRECTORY_REGEX.test(normalized)) {
      all.add(normalized);
    }
  }
  return Array.from(all.values()).sort((left, right) => left.localeCompare(right));
}

function createAutoSource(config: RootsConfig, provider: RootProvider, sourcePath: string): SourceConfigEntry {
  return {
    id: nextSourceId(config, provider),
    provider,
    path: sourcePath,
    enabled: true,
    writable: true,
    reservePercent: DEFAULT_RESERVE_PERCENT,
    opportunisticPolicy: 'drop-older-blocks',
  };
}

function nextSourceId(config: RootsConfig, provider: RootProvider): string {
  const existingIds = new Set(config.sources.map((source) => source.id));
  const prefix = `src-${provider === 'local' ? 'disk' : provider}`;
  let counter = config.sources.length + 1;
  while (existingIds.has(`${prefix}-${counter}`)) {
    counter += 1;
  }
  return `${prefix}-${counter}`;
}

function ensureExplicitVolumeDestination(config: RootsConfig, volumeId: string, sourceId: string): boolean {
  const normalizedVolumeId = volumeId.trim().toLowerCase();
  if (resolveVolumeDestinations(config, normalizedVolumeId).some((destination) => destination.sourceId === sourceId)) {
    return false;
  }

  const explicit = getExplicitVolumePolicy(config, normalizedVolumeId);
  if (explicit) {
    explicit.destinations.push(createAutoDestination(sourceId));
    return true;
  }

  const nextVolume: VolumePolicyEntry = {
    volumeId: normalizedVolumeId,
    destinations: [createAutoDestination(sourceId)],
  };
  config.volumes.push(nextVolume);
  return true;
}

function createAutoDestination(sourceId: string): VolumeDestinationConfig {
  return {
    sourceId,
    enabled: true,
    storeEvents: true,
    storeBlocks: true,
    copySourceBlocks: true,
    reservePercent: DEFAULT_RESERVE_PERCENT,
    fullPolicy: DEFAULT_FULL_POLICY,
  };
}

function incrementProviderSummary(
  summary: DiscoveryProviderSummary,
  key: keyof DiscoveryProviderSummary,
  value: number
): void {
  (summary as Record<keyof DiscoveryProviderSummary, number>)[key] += value;
}

function createRunKey(
  summary: ReconciledSourcesSummary,
  items: readonly ReconciledDiscoveredSourceItem[]
): string {
  const payload = JSON.stringify({
    summary: {
      discoveredCount: summary.discoveredCount,
      sourcesAdded: summary.sourcesAdded,
      volumeTargetsAdded: summary.volumeTargetsAdded,
      availableShares: summary.availableShares,
      meaningfulItemCount: summary.meaningfulItemCount,
      providers: summary.providers,
    },
    items: items.map((item) => ({
      provider: item.provider,
      path: item.path,
      classification: item.classification,
      actions: item.actions,
      matchedVolumeIds: item.matchedVolumeIds,
      unknownVolumeIds: item.unknownVolumeIds,
      addedTargetVolumeIds: item.addedTargetVolumeIds,
    })),
  });
  return createHash('sha256').update(payload).digest('hex');
}

function compareReconciledItem(left: ReconciledDiscoveredSourceItem, right: ReconciledDiscoveredSourceItem): number {
  if (left.provider !== right.provider) {
    return left.provider.localeCompare(right.provider);
  }
  return left.path.localeCompare(right.path);
}

function isMeaningfulItem(item: ReconciledDiscoveredSourceItem): boolean {
  return (
    item.actions.includes('added-source') ||
    item.actions.includes('added-volume-target') ||
    item.actions.includes('available-share')
  );
}

function toComparablePath(value: string): string {
  const normalized = value.trim().replace(/\\/g, '/').replace(/\/+$/u, '');
  if (process.platform === 'darwin' || process.platform === 'win32') {
    return normalized.toLowerCase();
  }
  return normalized;
}
