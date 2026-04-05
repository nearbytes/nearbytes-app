import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface AppConfig {
  readonly version: 1;
  readonly features: {
    readonly providers: {
      readonly googleDrive: boolean;
      readonly mega: boolean;
      readonly github: boolean;
      readonly localNetwork: boolean;
    };
    readonly performance: {
      readonly appMetrics: boolean;
    };
  };
}

const APP_CONFIG_VERSION = 1 as const;

const DEFAULT_APP_CONFIG: AppConfig = {
  version: APP_CONFIG_VERSION,
  features: {
    providers: {
      googleDrive: false,
      mega: true,
      github: true,
      localNetwork: true,
    },
    performance: {
      appMetrics: false,
    },
  },
};

export const APP_CONFIG = DEFAULT_APP_CONFIG;

let cachedConfigPath: string | null = null;
let cachedAppConfig: AppConfig | null = null;

export function resolveDefaultAppConfigPath(): string {
  const envPath = process.env.NEARBYTES_APP_CONFIG?.trim();
  if (envPath && envPath.length > 0) {
    return path.resolve(envPath);
  }
  return path.join(os.homedir(), '.nearbytes', 'app-config.json');
}

export function getAppConfig(): AppConfig {
  const configPath = resolveDefaultAppConfigPath();
  if (cachedAppConfig && cachedConfigPath === configPath) {
    return cachedAppConfig;
  }

  const loaded = loadAppConfigFromDisk(configPath);
  cachedConfigPath = configPath;
  cachedAppConfig = loaded;
  return loaded;
}

export function saveAppConfig(config: AppConfig): AppConfig {
  const validated = normalizeAppConfig(config);
  const configPath = resolveDefaultAppConfigPath();
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(validated, null, 2)}\n`, 'utf8');
  cachedConfigPath = configPath;
  cachedAppConfig = validated;
  return validated;
}

export function setProviderEnabled(provider: string, enabled: boolean): AppConfig {
  const current = getAppConfig();
  const key = providerConfigKey(provider);
  if (!key) {
    return current;
  }
  return saveAppConfig({
    ...current,
    features: {
      ...current.features,
      providers: {
        ...current.features.providers,
        [key]: enabled,
      },
    },
  });
}

export function isProviderEnabled(provider: string): boolean {
  const key = providerConfigKey(provider);
  if (!key) {
    return true;
  }
  return getAppConfig().features.providers[key];
}

function loadAppConfigFromDisk(configPath: string): AppConfig {
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    return normalizeAppConfig(JSON.parse(raw));
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return DEFAULT_APP_CONFIG;
    }
    return DEFAULT_APP_CONFIG;
  }
}

function normalizeAppConfig(value: unknown): AppConfig {
  const candidate = value && typeof value === 'object' ? value as Partial<AppConfig> : {};
  const providers = candidate.features && typeof candidate.features === 'object'
    ? candidate.features.providers
    : undefined;
  const performance = candidate.features && typeof candidate.features === 'object'
    ? candidate.features.performance
    : undefined;
  return {
    version: APP_CONFIG_VERSION,
    features: {
      providers: {
        googleDrive: providers?.googleDrive ?? DEFAULT_APP_CONFIG.features.providers.googleDrive,
        mega: providers?.mega ?? DEFAULT_APP_CONFIG.features.providers.mega,
        github: providers?.github ?? DEFAULT_APP_CONFIG.features.providers.github,
        localNetwork: providers?.localNetwork ?? DEFAULT_APP_CONFIG.features.providers.localNetwork,
      },
      performance: {
        appMetrics: performance?.appMetrics ?? DEFAULT_APP_CONFIG.features.performance.appMetrics,
      },
    },
  };
}

function providerConfigKey(provider: string): keyof AppConfig['features']['providers'] | null {
  switch (normalizeProvider(provider)) {
    case 'gdrive':
    case 'google-drive':
    case 'google_drive':
    case 'googledrive':
      return 'googleDrive';
    case 'mega':
      return 'mega';
    case 'github':
      return 'github';
    case 'local-network':
    case 'local_network':
    case 'lan':
      return 'localNetwork';
    default:
      return null;
  }
}

function normalizeProvider(value: string): string {
  return value.trim().toLowerCase();
}

function isFileNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'ENOENT');
}
