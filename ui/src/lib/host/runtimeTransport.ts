import {
  getDesktopBridge,
  type DesktopRuntimeConfig,
  type NearbytesDesktopBridge,
} from './desktopBridge.js';

interface NearbytesRuntimeWindow extends Window {
  nearbytesRuntimeConfig?: Partial<DesktopRuntimeConfig>;
}

const WEB_RUNTIME_CONFIG: DesktopRuntimeConfig = {
  apiBaseUrl: '',
  desktopToken: '',
  isDesktop: false,
  runtimeTokenHeader: 'x-nearbytes-runtime-token',
  runtimeHostKind: 'web',
  runtimeOwner: 'embedded',
};

let runtimeConfigPromise: Promise<DesktopRuntimeConfig> | null = null;

function normalizeRuntimeTokenHeader(value: unknown): string {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim().toLowerCase()
    : 'x-nearbytes-runtime-token';
}

function normalizeRuntimeHostKind(value: unknown, isDesktop: boolean): NonNullable<DesktopRuntimeConfig['runtimeHostKind']> {
  if (value === 'desktop' || value === 'phone' || value === 'web') {
    return value;
  }
  return isDesktop ? 'desktop' : 'web';
}

function normalizeRuntimeOwner(value: unknown, isDesktop: boolean): NonNullable<DesktopRuntimeConfig['runtimeOwner']> {
  if (value === 'embedded' || value === 'desktop-proxy' || value === 'remote-runtime') {
    return value;
  }
  return isDesktop ? 'embedded' : 'remote-runtime';
}

function normalizePartialRuntimeConfig(config: Partial<DesktopRuntimeConfig>): DesktopRuntimeConfig {
  const isDesktop = config.isDesktop === true;
  return {
    apiBaseUrl: typeof config.apiBaseUrl === 'string' ? config.apiBaseUrl : '',
    desktopToken: typeof config.desktopToken === 'string' ? config.desktopToken : '',
    isDesktop,
    runtimeTokenHeader: normalizeRuntimeTokenHeader(config.runtimeTokenHeader),
    runtimeHostKind: normalizeRuntimeHostKind(config.runtimeHostKind, isDesktop),
    runtimeOwner: normalizeRuntimeOwner(config.runtimeOwner, isDesktop),
  };
}

function readInjectedRuntimeConfig(): DesktopRuntimeConfig | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const injected = (window as NearbytesRuntimeWindow).nearbytesRuntimeConfig;
  if (!injected || typeof injected.apiBaseUrl !== 'string' || injected.apiBaseUrl.trim().length === 0) {
    return null;
  }
  return normalizePartialRuntimeConfig({
    apiBaseUrl: injected.apiBaseUrl,
    desktopToken: typeof injected.desktopToken === 'string' ? injected.desktopToken : '',
    isDesktop: injected.isDesktop === true,
    runtimeTokenHeader: injected.runtimeTokenHeader,
    runtimeHostKind: injected.runtimeHostKind,
    runtimeOwner: injected.runtimeOwner,
  });
}

export function getConfiguredDesktopDevPort(): string {
  const configured = import.meta.env?.VITE_NEARBYTES_WEB_DEV_PORT;
  return typeof configured === 'string' && configured.trim().length > 0 ? configured.trim() : '5177';
}

export function useSameOriginDesktopProxy(
  runtimeConfig: DesktopRuntimeConfig,
  locationLike: Pick<Location, 'protocol' | 'hostname' | 'port'> | null =
    typeof window === 'undefined' ? null : window.location,
  configuredPort = getConfiguredDesktopDevPort()
): boolean {
  if (!runtimeConfig.isDesktop || !locationLike) {
    return false;
  }
  return (
    (locationLike.protocol === 'http:' || locationLike.protocol === 'https:') &&
    (locationLike.hostname === '127.0.0.1' || locationLike.hostname === 'localhost') &&
    locationLike.port === configuredPort
  );
}

export function getRequestBaseUrl(
  runtimeConfig: DesktopRuntimeConfig,
  locationLike: Pick<Location, 'protocol' | 'hostname' | 'port'> | null =
    typeof window === 'undefined' ? null : window.location,
  configuredPort = getConfiguredDesktopDevPort()
): string {
  if (useSameOriginDesktopProxy(runtimeConfig, locationLike, configuredPort)) {
    return '';
  }
  return runtimeConfig.apiBaseUrl;
}

export function resetRuntimeConfigCacheForTests(): void {
  runtimeConfigPromise = null;
}

function normalizeRuntimeConfig(config: DesktopRuntimeConfig): DesktopRuntimeConfig {
  return normalizePartialRuntimeConfig(config);
}

export async function getRuntimeConfig(options: {
  bridge?: NearbytesDesktopBridge | null;
  injectedConfig?: Partial<DesktopRuntimeConfig> | null;
} = {}): Promise<DesktopRuntimeConfig> {
  if (runtimeConfigPromise) {
    return runtimeConfigPromise;
  }

  const nextPromise = (async () => {
    const injectedConfig = options.injectedConfig;
    if (injectedConfig && typeof injectedConfig.apiBaseUrl === 'string' && injectedConfig.apiBaseUrl.trim().length > 0) {
      return normalizePartialRuntimeConfig({
        apiBaseUrl: injectedConfig.apiBaseUrl,
        desktopToken: typeof injectedConfig.desktopToken === 'string' ? injectedConfig.desktopToken : '',
        isDesktop: injectedConfig.isDesktop === true,
        runtimeTokenHeader: injectedConfig.runtimeTokenHeader,
        runtimeHostKind: injectedConfig.runtimeHostKind,
        runtimeOwner: injectedConfig.runtimeOwner,
      });
    }

    const bridge = options.bridge ?? getDesktopBridge();
    if (!bridge) {
      const injectedWindowConfig = readInjectedRuntimeConfig();
      if (injectedWindowConfig) {
        return injectedWindowConfig;
      }
      return WEB_RUNTIME_CONFIG;
    }
    if (typeof bridge.getRuntimeConfig !== 'function') {
      throw new Error('Nearbytes desktop bridge is missing getRuntimeConfig().');
    }
    const config = await bridge.getRuntimeConfig();
    if (!config || config.apiBaseUrl.trim().length === 0 || config.desktopToken.trim().length === 0) {
      throw new Error('Nearbytes desktop bridge returned invalid runtime config.');
    }
    return normalizeRuntimeConfig(config);
  })();

  runtimeConfigPromise = nextPromise;
  try {
    return await nextPromise;
  } catch (error) {
    if (runtimeConfigPromise === nextPromise) {
      runtimeConfigPromise = null;
    }
    throw error;
  }
}

export function getRuntimeTokenHeader(runtimeConfig: DesktopRuntimeConfig): string {
  return normalizeRuntimeTokenHeader(runtimeConfig.runtimeTokenHeader);
}

async function parseErrorMessage(response: Response): Promise<string> {
  try {
    const data = await response.json() as { error?: { message?: unknown } };
    if (typeof data.error?.message === 'string' && data.error.message.trim().length > 0) {
      return data.error.message;
    }
  } catch {
    // Fall back to status text.
  }
  return response.statusText || 'Unknown error';
}

function applyDefaultHeaders(
  headers: Headers,
  runtimeConfig: DesktopRuntimeConfig,
  body: BodyInit | null | undefined
): void {
  if (!headers.has('Content-Type') && !(body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  if (runtimeConfig.desktopToken.trim().length > 0) {
    headers.set(getRuntimeTokenHeader(runtimeConfig), runtimeConfig.desktopToken);
  }
}

export async function requestHostJson<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const runtimeConfig = await getRuntimeConfig();
  const headers = new Headers(options.headers);
  applyDefaultHeaders(headers, runtimeConfig, options.body);

  const response = await fetch(`${getRequestBaseUrl(runtimeConfig)}${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response));
  }

  const text = await response.text();
  if (!text) {
    return {} as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error('Invalid JSON response from server');
  }
}

export async function openHostStream(endpoint: string, options: RequestInit = {}): Promise<Response> {
  const runtimeConfig = await getRuntimeConfig();
  const headers = new Headers(options.headers);
  applyDefaultHeaders(headers, runtimeConfig, options.body);

  const response = await fetch(`${getRequestBaseUrl(runtimeConfig)}${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response));
  }

  return response;
}

export async function requestHostBlob(endpoint: string, options: RequestInit = {}): Promise<Blob> {
  const response = await openHostStream(endpoint, options);
  return response.blob();
}