import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { z } from 'zod';

export type RootProvider = 'local' | 'dropbox' | 'mega' | 'gdrive' | 'icloud' | 'onedrive';
export type StorageFullPolicy = 'block-writes' | 'drop-older-blocks';

export interface SourceConfigEntry {
  readonly id: string;
  readonly provider: RootProvider;
  readonly path: string;
  readonly enabled: boolean;
  readonly writable: boolean;
  readonly reservePercent: number;
  readonly opportunisticPolicy: StorageFullPolicy;
  readonly moveFromSourceId?: string;
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

const ROOTS_CONFIG_VERSION = 2 as const;
const LEGACY_ROOTS_CONFIG_VERSION = 1 as const;
const CHANNEL_KEY_REGEX = /^[a-f0-9]{64,200}$/;

const fullPolicySchema = z.enum(['block-writes', 'drop-older-blocks']);

const sourceConfigEntrySchema = z.object({
  id: z.string().trim().min(1, 'Source id is required'),
  provider: z.enum(['local', 'dropbox', 'mega', 'gdrive', 'icloud', 'onedrive']).default('local'),
  path: z.string().trim().min(1, 'Source path is required'),
  enabled: z.boolean().default(true),
  writable: z.boolean().default(true),
  reservePercent: z.number().int().min(0).max(95).default(5),
  opportunisticPolicy: fullPolicySchema.default('drop-older-blocks'),
  moveFromSourceId: z.string().trim().min(1).optional(),
});

const volumeDestinationSchema = z.object({
  sourceId: z.string().trim().min(1, 'Destination sourceId is required'),
  enabled: z.boolean().default(true),
  storeEvents: z.boolean().default(true),
  storeBlocks: z.boolean().default(true),
  copySourceBlocks: z.boolean().default(true),
  reservePercent: z.number().int().min(0).max(95).default(5),
  fullPolicy: fullPolicySchema.default('block-writes'),
});

const defaultVolumePolicySchema = z.object({
  destinations: z.array(volumeDestinationSchema).default([]),
});

const volumePolicyEntrySchema = z.object({
  volumeId: z.string().trim().toLowerCase(),
  destinations: z.array(volumeDestinationSchema).default([]),
});

const rootsConfigSchema = z.object({
  version: z.literal(ROOTS_CONFIG_VERSION),
  sources: z.array(sourceConfigEntrySchema).min(1, 'At least one source is required'),
  defaultVolume: defaultVolumePolicySchema.default({ destinations: [] }),
  volumes: z.array(volumePolicyEntrySchema).default([]),
});

const legacyAllKeysStrategySchema = z.object({
  name: z.literal('all-keys'),
});

const legacyAllowlistStrategySchema = z.object({
  name: z.literal('allowlist'),
  channelKeys: z.array(z.string().trim().toLowerCase()).default([]),
});

const legacyRootConfigEntrySchema = z.object({
  id: z.string().trim().min(1, 'Root id is required'),
  kind: z.enum(['main', 'backup']),
  provider: z.enum(['local', 'dropbox', 'mega', 'gdrive', 'icloud', 'onedrive']).default('local'),
  path: z.string().trim().min(1, 'Root path is required'),
  enabled: z.boolean().default(true),
  writable: z.boolean().default(true),
  strategy: z.union([legacyAllKeysStrategySchema, legacyAllowlistStrategySchema]),
});

const legacyRootsConfigSchema = z.object({
  version: z.literal(LEGACY_ROOTS_CONFIG_VERSION),
  roots: z.array(legacyRootConfigEntrySchema).min(1, 'At least one root is required'),
});

export function resolveDefaultRootsConfigPath(): string {
  const envPath = process.env.NEARBYTES_ROOTS_CONFIG?.trim();
  if (envPath && envPath.length > 0) {
    return path.resolve(envPath);
  }
  return path.join(os.homedir(), '.nearbytes', 'roots.json');
}

export function createDefaultRootsConfig(defaultRootPath: string): RootsConfig {
  const sourceId = 'src-default';
  return {
    version: ROOTS_CONFIG_VERSION,
    sources: [
      {
        id: sourceId,
        provider: 'local',
        path: path.resolve(defaultRootPath),
        enabled: true,
        writable: true,
        reservePercent: 5,
        opportunisticPolicy: 'drop-older-blocks',
      },
    ],
    defaultVolume: {
      destinations: [
        {
          sourceId,
          enabled: true,
          storeEvents: true,
          storeBlocks: true,
          copySourceBlocks: true,
          reservePercent: 5,
          fullPolicy: 'block-writes',
        },
      ],
    },
    volumes: [],
  };
}

export function parseRootsConfig(value: unknown): RootsConfig {
  const candidate = migrateLegacyRootsConfig(value);
  const parsed = rootsConfigSchema.parse(candidate);
  const seenSourceIds = new Set<string>();
  const sourceIds = new Set<string>();

  const normalizedSources = parsed.sources.map((source) => {
    const id = source.id.trim();
    if (seenSourceIds.has(id)) {
      throw new Error(`Duplicate source id: ${id}`);
    }
    seenSourceIds.add(id);
    sourceIds.add(id);
    return {
      id,
      provider: source.provider,
      path: path.resolve(source.path),
      enabled: source.enabled,
      writable: source.writable,
      reservePercent: source.reservePercent,
      opportunisticPolicy: source.opportunisticPolicy,
      moveFromSourceId: source.moveFromSourceId?.trim() || undefined,
    } satisfies SourceConfigEntry;
  });

  for (const source of normalizedSources) {
    if (!source.moveFromSourceId) {
      continue;
    }
    if (!sourceIds.has(source.moveFromSourceId)) {
      throw new Error(`Pending move source not found: ${source.moveFromSourceId}`);
    }
    if (source.moveFromSourceId === source.id) {
      throw new Error(`Source ${source.id} cannot move from itself`);
    }
  }

  const normalizedDefault: DefaultVolumePolicy = {
    destinations: normalizeDestinationList(parsed.defaultVolume.destinations, sourceIds),
  };
  if (
    !normalizedDefault.destinations.some((destination) => {
      const source = normalizedSources.find((entry) => entry.id === destination.sourceId);
      return Boolean(source?.enabled && source.writable && isDurableDestination(destination));
    })
  ) {
    throw new Error('At least one durable default storage location is required');
  }
  const seenVolumeIds = new Set<string>();
  const normalizedVolumes = parsed.volumes.map((volume) => {
    const volumeId = volume.volumeId.trim().toLowerCase();
    if (!CHANNEL_KEY_REGEX.test(volumeId)) {
      throw new Error(`Invalid volume id: ${volume.volumeId}`);
    }
    if (seenVolumeIds.has(volumeId)) {
      throw new Error(`Duplicate volume id: ${volumeId}`);
    }
    seenVolumeIds.add(volumeId);
    return {
      volumeId,
      destinations: normalizeDestinationList(volume.destinations, sourceIds),
    } satisfies VolumePolicyEntry;
  });

  for (const volume of normalizedVolumes) {
    const resolved = resolveVolumeDestinations(
      {
        version: ROOTS_CONFIG_VERSION,
        sources: normalizedSources,
        defaultVolume: normalizedDefault,
        volumes: normalizedVolumes,
      },
      volume.volumeId
    );
    if (
      !resolved.some((destination) => {
        const source = normalizedSources.find((entry) => entry.id === destination.sourceId);
        return Boolean(source?.enabled && source.writable && isDurableDestination(destination));
      })
    ) {
      throw new Error(`Volume ${volume.volumeId} must have at least one durable destination`);
    }
  }

  return {
    version: ROOTS_CONFIG_VERSION,
    sources: normalizedSources,
    defaultVolume: normalizedDefault,
    volumes: normalizedVolumes,
  };
}

export async function loadOrCreateRootsConfig(options: {
  readonly configPath?: string;
  readonly defaultRootPath: string;
}): Promise<{
  configPath: string;
  config: RootsConfig;
  created: boolean;
}> {
  const configPath = path.resolve(options.configPath ?? resolveDefaultRootsConfigPath());

  try {
    const raw = await fs.readFile(configPath, 'utf8');
    const parsedRaw = JSON.parse(raw);
    const healedCandidate = ensureBootstrapSourceOnRawConfig(parsedRaw, options.defaultRootPath);
    const parsed = ensureBootstrapSourceAndDefaultDestination(
      parseRootsConfig(healedCandidate),
      options.defaultRootPath
    );
    if (healedCandidate !== parsedRaw || !rootsConfigEquals(parsedRaw, parsed)) {
      await saveRootsConfig(configPath, parsed);
    }
    return {
      configPath,
      config: parsed,
      created: false,
    };
  } catch (error) {
    if (isFileNotFoundError(error)) {
      const config = createDefaultRootsConfig(options.defaultRootPath);
      await saveRootsConfig(configPath, config);
      return {
        configPath,
        config,
        created: true,
      };
    }
    throw error;
  }
}

export async function saveRootsConfig(configPath: string, config: RootsConfig): Promise<void> {
  const resolvedPath = path.resolve(configPath);
  const validated = parseRootsConfig(config);
  const dir = path.dirname(resolvedPath);
  await fs.mkdir(dir, { recursive: true });

  const tempPath = `${resolvedPath}.${process.pid}.tmp`;
  const payload = `${JSON.stringify(validated, null, 2)}\n`;
  await fs.writeFile(tempPath, payload, 'utf8');
  await fs.rename(tempPath, resolvedPath);
}

export function resolveVolumeDestinations(config: RootsConfig, volumeId: string): VolumeDestinationConfig[] {
  const normalizedVolumeId = volumeId.trim().toLowerCase();
  const merged = new Map<string, VolumeDestinationConfig>();

  for (const destination of config.defaultVolume.destinations) {
    merged.set(destination.sourceId, { ...destination });
  }

  const explicit = config.volumes.find((entry) => entry.volumeId === normalizedVolumeId);
  if (!explicit) {
    return Array.from(merged.values());
  }

  for (const destination of explicit.destinations) {
    merged.set(destination.sourceId, { ...destination });
  }

  return Array.from(merged.values());
}

export function getExplicitVolumePolicy(config: RootsConfig, volumeId: string): VolumePolicyEntry | undefined {
  const normalizedVolumeId = volumeId.trim().toLowerCase();
  return config.volumes.find((entry) => entry.volumeId === normalizedVolumeId);
}

export function getSourceById(config: RootsConfig, sourceId: string): SourceConfigEntry | undefined {
  return config.sources.find((source) => source.id === sourceId);
}

export function isDurableDestination(destination: VolumeDestinationConfig): boolean {
  return (
    destination.enabled &&
    destination.storeEvents &&
    destination.storeBlocks &&
    destination.copySourceBlocks &&
    destination.fullPolicy === 'block-writes'
  );
}

function ensureBootstrapSourceOnRawConfig(value: unknown, defaultRootPath: string): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }
  if ((value as { version?: unknown }).version !== ROOTS_CONFIG_VERSION) {
    return value;
  }

  const candidate = value as {
    sources?: unknown;
    defaultVolume?: { destinations?: unknown };
  };
  if (!Array.isArray(candidate.sources)) {
    return value;
  }

  const bootstrapPath = path.resolve(defaultRootPath);
  const normalizedSources = candidate.sources.filter((entry) => entry && typeof entry === 'object') as Array<{
    id?: unknown;
    provider?: unknown;
    path?: unknown;
  }>;

  const existingBootstrap = normalizedSources.find(
    (entry) => typeof entry.path === 'string' && path.resolve(entry.path) === bootstrapPath
  );
  const nextSources = existingBootstrap
    ? candidate.sources
    : [
        ...candidate.sources,
        {
          id: 'src-home',
          provider: 'local',
          path: bootstrapPath,
          enabled: true,
          writable: true,
          reservePercent: 5,
          opportunisticPolicy: 'drop-older-blocks',
        },
      ];

  const currentDefaultDestinations = Array.isArray(candidate.defaultVolume?.destinations)
    ? candidate.defaultVolume?.destinations
    : [];
  const nextDefaultVolume =
    currentDefaultDestinations.length > 0
      ? candidate.defaultVolume
      : {
          destinations: [
            ...currentDefaultDestinations,
            {
              sourceId: existingBootstrap?.id && typeof existingBootstrap.id === 'string' ? existingBootstrap.id : 'src-home',
              enabled: true,
              storeEvents: true,
              storeBlocks: true,
              copySourceBlocks: true,
              reservePercent: 5,
              fullPolicy: 'block-writes',
            },
          ],
        };

  if (nextSources === candidate.sources && nextDefaultVolume === candidate.defaultVolume) {
    return value;
  }

  return {
    ...candidate,
    sources: nextSources,
    defaultVolume: nextDefaultVolume,
  };
}

function ensureBootstrapSourceAndDefaultDestination(
  config: RootsConfig,
  defaultRootPath: string
): RootsConfig {
  const bootstrapPath = path.resolve(defaultRootPath);
  const existingBootstrapSource =
    config.sources.find((source) => path.resolve(source.path) === bootstrapPath) ?? null;
  const bootstrapSource =
    existingBootstrapSource ??
    ({
      id: 'src-home',
      provider: 'local',
      path: bootstrapPath,
      enabled: true,
      writable: true,
      reservePercent: 5,
      opportunisticPolicy: 'drop-older-blocks',
    } satisfies SourceConfigEntry);

  const nextSources = existingBootstrapSource ? config.sources : [...config.sources, bootstrapSource];
  const hasDurableDefaultDestination = config.defaultVolume.destinations.some((destination) => {
    const source = nextSources.find((entry) => entry.id === destination.sourceId);
    return Boolean(source?.enabled && source.writable && isDurableDestination(destination));
  });

  if (hasDurableDefaultDestination && existingBootstrapSource) {
    return config;
  }

  const nextDefaultDestinations = hasDurableDefaultDestination
    ? config.defaultVolume.destinations
    : dedupeDestinationList([
        ...config.defaultVolume.destinations,
        {
          sourceId: bootstrapSource.id,
          enabled: true,
          storeEvents: true,
          storeBlocks: true,
          copySourceBlocks: true,
          reservePercent: 5,
          fullPolicy: 'block-writes',
        },
      ]);

  return {
    version: ROOTS_CONFIG_VERSION,
    sources: nextSources,
    defaultVolume: {
      destinations: nextDefaultDestinations,
    },
    volumes: config.volumes,
  };
}

function dedupeDestinationList(destinations: readonly VolumeDestinationConfig[]): VolumeDestinationConfig[] {
  const deduped = new Map<string, VolumeDestinationConfig>();
  for (const destination of destinations) {
    deduped.set(destination.sourceId, { ...destination });
  }
  return Array.from(deduped.values());
}

function rootsConfigEquals(left: unknown, right: RootsConfig): boolean {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

function normalizeDestinationList(
  destinations: readonly VolumeDestinationConfig[],
  sourceIds: ReadonlySet<string>
): VolumeDestinationConfig[] {
  const deduped = new Map<string, VolumeDestinationConfig>();
  for (const destination of destinations) {
    const sourceId = destination.sourceId.trim();
    if (!sourceIds.has(sourceId)) {
      throw new Error(`Unknown destination sourceId: ${sourceId}`);
    }
    deduped.set(sourceId, {
      sourceId,
      enabled: destination.enabled,
      storeEvents: destination.storeEvents,
      storeBlocks: destination.storeBlocks,
      copySourceBlocks: destination.copySourceBlocks,
      reservePercent: destination.reservePercent,
      fullPolicy: destination.fullPolicy,
    });
  }
  return Array.from(deduped.values());
}

function migrateLegacyRootsConfig(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }

  const rawVersion = (value as { version?: unknown }).version;
  if (rawVersion !== LEGACY_ROOTS_CONFIG_VERSION) {
    return value;
  }

  const legacy = legacyRootsConfigSchema.parse(value);
  for (const root of legacy.roots) {
    if (root.kind === 'main' && root.strategy.name !== 'all-keys') {
      throw new Error(`Legacy main root ${root.id} must use all-keys strategy`);
    }
    if (root.kind === 'backup' && root.strategy.name !== 'allowlist') {
      throw new Error(`Legacy backup root ${root.id} must use allowlist strategy`);
    }
  }

  const sources: SourceConfigEntry[] = legacy.roots.map((root) => ({
    id: root.id,
    provider: root.provider,
    path: path.resolve(root.path),
    enabled: root.enabled,
    writable: root.writable,
    reservePercent: 5,
    opportunisticPolicy: 'drop-older-blocks',
  }));

  const defaultDestinations: VolumeDestinationConfig[] = legacy.roots
    .filter((root) => root.kind === 'main' && root.enabled)
    .map((root) => ({
      sourceId: root.id,
      enabled: root.enabled,
      storeEvents: true,
      storeBlocks: true,
      copySourceBlocks: true,
      reservePercent: 5,
      fullPolicy: 'block-writes',
    }));

  const volumeMap = new Map<string, VolumeDestinationConfig[]>();
  for (const root of legacy.roots) {
    if (root.kind !== 'backup' || root.strategy.name !== 'allowlist') {
      continue;
    }
    for (const channelKey of root.strategy.channelKeys) {
      const normalizedKey = channelKey.trim().toLowerCase();
      if (!CHANNEL_KEY_REGEX.test(normalizedKey)) {
        throw new Error(`Invalid backup allowlist channel key in ${root.id}: ${channelKey}`);
      }
      const destinations = volumeMap.get(normalizedKey) ?? [];
      destinations.push({
        sourceId: root.id,
        enabled: root.enabled,
        storeEvents: true,
        storeBlocks: true,
        copySourceBlocks: true,
        reservePercent: 5,
        fullPolicy: 'block-writes',
      });
      volumeMap.set(normalizedKey, destinations);
    }
  }

  return {
    version: ROOTS_CONFIG_VERSION,
    sources,
    defaultVolume: {
      destinations: defaultDestinations,
    },
    volumes: Array.from(volumeMap.entries()).map(([volumeId, destinations]) => ({
      volumeId,
      destinations,
    })),
  } satisfies RootsConfig;
}

function isFileNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  if (!error || typeof error !== 'object') {
    return false;
  }
  if (!('code' in error)) {
    return false;
  }
  return (error as { code?: string }).code === 'ENOENT';
}
