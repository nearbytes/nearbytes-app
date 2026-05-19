import { normalizeVolumeId } from 'nearbytes-log';

export type RootProvider = 'local' | 'dropbox' | 'mega' | 'gdrive' | 'icloud' | 'onedrive';
export type StorageFullPolicy = 'block-writes' | 'drop-older-blocks';

export interface ProviderManagedSourceIntegration {
  readonly kind: 'provider-managed';
  readonly provider: string;
  readonly managedShareId: string;
}

export type SourceIntegrationConfig = ProviderManagedSourceIntegration;

export interface SourceConfigEntry {
  readonly id: string;
  readonly provider: RootProvider;
  readonly path: string;
  readonly enabled: boolean;
  readonly writable: boolean;
  readonly reservePercent: number;
  readonly opportunisticPolicy: StorageFullPolicy;
  readonly moveFromSourceId?: string;
  readonly integration?: SourceIntegrationConfig;
}

export interface VolumeDestinationConfig {
  readonly sourceId: string;
  readonly enabled: boolean;
  readonly storeEvents: boolean;
  readonly storeBlocks: boolean;
  readonly copySourceBlocks: boolean;
  readonly reservePercent: number;
  readonly fullPolicy: StorageFullPolicy;
}

export interface DefaultVolumePolicy {
  readonly destinations: VolumeDestinationConfig[];
}

export interface VolumePolicyEntry {
  readonly volumeId: string;
  readonly destinations: VolumeDestinationConfig[];
}

export interface RootsConfig {
  readonly version: 2;
  readonly sources: SourceConfigEntry[];
  readonly defaultVolume: DefaultVolumePolicy;
  readonly volumes: VolumePolicyEntry[];
}

export function sanitizeVolumeDestination(destination: VolumeDestinationConfig): VolumeDestinationConfig {
  const enabled = destination.enabled;
  return {
    sourceId: destination.sourceId,
    enabled,
    storeEvents: enabled,
    storeBlocks: enabled,
    copySourceBlocks: enabled,
    reservePercent: destination.reservePercent,
    fullPolicy: 'block-writes',
  };
}

export function resolveVolumeDestinations(config: RootsConfig, volumeId: string): VolumeDestinationConfig[] {
  const normalizedVolumeId = normalizeVolumeId(volumeId);
  const merged = new Map<string, VolumeDestinationConfig>();

  for (const destination of config.defaultVolume.destinations) {
    merged.set(destination.sourceId, sanitizeVolumeDestination({ ...destination }));
  }

  const explicit = config.volumes.find((entry) => normalizeVolumeId(entry.volumeId) === normalizedVolumeId);
  if (!explicit) {
    return Array.from(merged.values());
  }

  for (const destination of explicit.destinations) {
    merged.set(destination.sourceId, sanitizeVolumeDestination({ ...destination }));
  }

  return Array.from(merged.values());
}

export function isDurableDestination(destination: VolumeDestinationConfig): boolean {
  return destination.enabled;
}
