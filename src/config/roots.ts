import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { z } from 'zod';

export type RootKind = 'main' | 'backup';
export type RootProvider = 'local' | 'dropbox' | 'mega' | 'gdrive';

export interface AllKeysStrategy {
  readonly name: 'all-keys';
}

export interface AllowlistStrategy {
  readonly name: 'allowlist';
  readonly channelKeys: string[];
}

export type RootStrategy = AllKeysStrategy | AllowlistStrategy;

export interface RootConfigEntry {
  readonly id: string;
  readonly kind: RootKind;
  readonly provider: RootProvider;
  readonly path: string;
  readonly enabled: boolean;
  readonly writable: boolean;
  readonly strategy: RootStrategy;
}

export interface RootsConfig {
  readonly version: 1;
  readonly roots: RootConfigEntry[];
}

const ROOTS_CONFIG_VERSION = 1 as const;
const CHANNEL_KEY_REGEX = /^[a-f0-9]{64,200}$/;

const allKeysStrategySchema = z.object({
  name: z.literal('all-keys'),
});

const allowlistStrategySchema = z.object({
  name: z.literal('allowlist'),
  channelKeys: z.array(z.string().trim().toLowerCase()).default([]),
});

const rootConfigEntrySchema = z.object({
  id: z.string().trim().min(1, 'Root id is required'),
  kind: z.enum(['main', 'backup']),
  provider: z.enum(['local', 'dropbox', 'mega', 'gdrive']).default('local'),
  path: z.string().trim().min(1, 'Root path is required'),
  enabled: z.boolean().default(true),
  writable: z.boolean().default(true),
  strategy: z.union([allKeysStrategySchema, allowlistStrategySchema]),
});

const rootsConfigSchema = z.object({
  version: z.literal(ROOTS_CONFIG_VERSION),
  roots: z.array(rootConfigEntrySchema).min(1, 'At least one root is required'),
});

export function resolveDefaultRootsConfigPath(): string {
  const envPath = process.env.NEARBYTES_ROOTS_CONFIG?.trim();
  if (envPath && envPath.length > 0) {
    return path.resolve(envPath);
  }
  return path.join(os.homedir(), '.nearbytes', 'roots.json');
}

export function createDefaultRootsConfig(defaultRootPath: string): RootsConfig {
  return {
    version: ROOTS_CONFIG_VERSION,
    roots: [
      {
        id: 'main-default',
        kind: 'main',
        provider: 'local',
        path: path.resolve(defaultRootPath),
        enabled: true,
        writable: true,
        strategy: {
          name: 'all-keys',
        },
      },
    ],
  };
}

export function parseRootsConfig(value: unknown): RootsConfig {
  const parsed = rootsConfigSchema.parse(value);
  const seenIds = new Set<string>();

  const normalizedRoots = parsed.roots.map((root) => {
    const id = root.id.trim();
    if (seenIds.has(id)) {
      throw new Error(`Duplicate root id: ${id}`);
    }
    seenIds.add(id);

    const normalizedPath = path.resolve(root.path);
    if (root.kind === 'main') {
      if (root.strategy.name !== 'all-keys') {
        throw new Error(`Main root ${id} must use strategy.name = all-keys`);
      }
      return {
        id,
        kind: root.kind,
        provider: root.provider,
        path: normalizedPath,
        enabled: root.enabled,
        writable: root.writable,
        strategy: {
          name: 'all-keys',
        },
      } as RootConfigEntry;
    }

    if (root.strategy.name !== 'allowlist') {
      throw new Error(`Backup root ${id} must use strategy.name = allowlist`);
    }

    const dedupedKeys = Array.from(new Set(root.strategy.channelKeys.map((key) => key.trim().toLowerCase())))
      .filter((key) => key.length > 0);

    for (const channelKey of dedupedKeys) {
      if (!CHANNEL_KEY_REGEX.test(channelKey)) {
        throw new Error(`Invalid backup allowlist channel key in ${id}: ${channelKey}`);
      }
    }

    return {
      id,
      kind: root.kind,
      provider: root.provider,
      path: normalizedPath,
      enabled: root.enabled,
      writable: root.writable,
      strategy: {
        name: 'allowlist',
        channelKeys: dedupedKeys,
      },
    } as RootConfigEntry;
  });

  if (!normalizedRoots.some((root) => root.kind === 'main' && root.enabled)) {
    throw new Error('At least one enabled main root is required');
  }

  return {
    version: ROOTS_CONFIG_VERSION,
    roots: normalizedRoots,
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
    const parsed = parseRootsConfig(JSON.parse(raw));
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

export function rootAcceptsChannel(root: RootConfigEntry, channelKeyHex: string): boolean {
  if (!root.enabled) {
    return false;
  }
  if (root.kind === 'main') {
    return root.strategy.name === 'all-keys';
  }
  if (root.strategy.name !== 'allowlist') {
    return false;
  }
  const normalizedKey = channelKeyHex.toLowerCase();
  return root.strategy.channelKeys.includes(normalizedKey);
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
