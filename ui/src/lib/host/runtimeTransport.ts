import {
  getDesktopBridge,
  type DesktopRuntimeConfig,
  type NearbytesDesktopBridge,
} from './desktopBridge.js';

const WEB_RUNTIME_CONFIG: DesktopRuntimeConfig = {
  apiBaseUrl: '',
  desktopToken: '',
  isDesktop: false,
};

let runtimeConfigPromise: Promise<DesktopRuntimeConfig> | null = null;

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
  return {
    apiBaseUrl: config.apiBaseUrl,
    desktopToken: config.desktopToken,
    isDesktop: config.isDesktop === true,
  };
}

export async function getRuntimeConfig(options: {
  bridge?: NearbytesDesktopBridge | null;
} = {}): Promise<DesktopRuntimeConfig> {
  if (runtimeConfigPromise) {
    return runtimeConfigPromise;
  }

  const nextPromise = (async () => {
    const bridge = options.bridge ?? getDesktopBridge();
    if (!bridge) {
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
    headers.set('x-nearbytes-desktop-token', runtimeConfig.desktopToken);
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