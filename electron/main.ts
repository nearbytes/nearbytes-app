import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage, shell, type OpenDialogOptions } from 'electron';
import { existsSync } from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { clearPublishedDesktopSession, publishDesktopSession } from './session.js';
import { generateDesktopApiToken } from './security.js';
import { readDesktopUiState, writeDesktopUiState } from './uiState.js';
import { getUpdaterState, installDownloadedUpdate, openUpdateReleasePage, setupAutoUpdater } from './updater.js';

interface RuntimeHandle {
  readonly port: number;
  stop(): Promise<void>;
}

interface RuntimeModule {
  startApiRuntime(options: {
    host: string;
    port: number;
    corsOrigin: string | string[] | boolean;
    desktopApiToken: string;
    uiDistPath?: string;
    maxUploadBytes?: number;
  }): Promise<RuntimeHandle>;
}

interface DesktopRuntimeConfig {
  readonly apiBaseUrl: string;
  readonly desktopToken: string;
  readonly isDesktop: true;
}

const DEFAULT_DESKTOP_SESSION_TTL_MS = 8 * 60 * 60 * 1000;

const state: {
  window: BrowserWindow | null;
  runtime: RuntimeHandle | null;
  config: DesktopRuntimeConfig | null;
} = {
  window: null,
  runtime: null,
  config: null,
};

const desktopToken = generateDesktopApiToken();
const devUiUrl = process.env.NEARBYTES_ELECTRON_DEV_SERVER_URL?.trim() ?? '';
const isDev = devUiUrl.length > 0;
const enableAutoUpdater = !isDev && process.env.NEARBYTES_DISABLE_AUTO_UPDATE !== '1';
const maxUploadBytes = parseMaxUploadBytes(process.env.NEARBYTES_MAX_UPLOAD_MB);
const sessionTtlMs = parsePositiveInt(
  process.env.NEARBYTES_DESKTOP_SESSION_TTL_MS,
  DEFAULT_DESKTOP_SESSION_TTL_MS
);
const desktopIconPath = resolveDesktopIconPath();

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', () => {
  void shutdown();
});

app.whenReady().then(async () => {
  try {
    await startDesktop();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    dialog.showErrorBox('Nearbytes desktop startup failed', message);
    await shutdown();
    app.quit();
  }
});

async function startDesktop(): Promise<void> {
  app.setName('Nearbytes');
  applyDesktopIcon();
  const runtimeModule = await loadRuntimeModule();
  const runtime = await runtimeModule.startApiRuntime({
    host: '127.0.0.1',
    port: 0,
    corsOrigin: isDev
      ? ['http://127.0.0.1:5173', 'http://localhost:5173']
      : false,
    desktopApiToken: desktopToken,
    uiDistPath: isDev ? undefined : resolveUiDistPath(),
    maxUploadBytes,
  });
  state.runtime = runtime;

  const apiBaseUrl = `http://127.0.0.1:${runtime.port}`;
  state.config = {
    apiBaseUrl,
    desktopToken,
    isDesktop: true,
  };

  await publishDesktopSession({
    version: 1,
    pid: process.pid,
    port: runtime.port,
    token: desktopToken,
    expiresAt: Date.now() + sessionTtlMs,
    createdAt: Date.now(),
  });

  registerIpc();
  await createWindow(apiBaseUrl);
}

function registerIpc(): void {
  ipcMain.handle('nearbytes-desktop:get-runtime-config', () => {
    if (!state.config) {
      return {
        apiBaseUrl: '',
        desktopToken: '',
        isDesktop: true,
      };
    }
    return state.config;
  });
  ipcMain.handle('nearbytes-desktop:fetch-remote-file', async (_event, rawUrl: unknown) => {
    if (typeof rawUrl !== 'string' || rawUrl.trim().length === 0) {
      throw new Error('Remote URL is required.');
    }
    const url = new URL(rawUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('Only http(s) remote URLs are supported.');
    }

    const response = await fetch(url, { redirect: 'follow' });
    if (!response.ok) {
      throw new Error(`Remote download failed (${response.status})`);
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    return {
      filename: filenameFromRemoteResponse(url, response.headers.get('content-disposition')),
      mimeType: response.headers.get('content-type') ?? 'application/octet-stream',
      bytesBase64: bytes.toString('base64'),
    };
  });
  ipcMain.handle('nearbytes-desktop:get-clipboard-image-status', () => {
    const image = clipboard.readImage();
    return {
      hasImage: !image.isEmpty(),
    };
  });
  ipcMain.handle('nearbytes-desktop:read-clipboard-image', () => {
    const image = clipboard.readImage();
    if (image.isEmpty()) {
      return null;
    }
    const bytes = image.toPNG();
    return {
      filename: 'clipboard-image.png',
      mimeType: 'image/png',
      bytesBase64: bytes.toString('base64'),
    };
  });
  ipcMain.handle('nearbytes-desktop:load-ui-state', async () => {
    return readDesktopUiState();
  });
  ipcMain.handle('nearbytes-desktop:get-updater-state', () => {
    return getUpdaterState();
  });
  ipcMain.handle('nearbytes-desktop:install-downloaded-update', async () => {
    return installDownloadedUpdate();
  });
  ipcMain.handle('nearbytes-desktop:open-update-release-page', async () => {
    return openUpdateReleasePage();
  });
  ipcMain.handle('nearbytes-desktop:save-ui-state', async (_event, rawState: unknown) => {
    if (!rawState || typeof rawState !== 'object' || Array.isArray(rawState)) {
      throw new Error('Desktop UI state must be an object.');
    }
    await writeDesktopUiState(
      rawState as { volumeMounts?: unknown; sourceDiscovery?: unknown; dismissedRootSuggestions?: unknown }
    );
    return true;
  });
  ipcMain.handle('nearbytes-desktop:choose-directory', async (_event, rawInitialPath: unknown) => {
    const initialPath =
      typeof rawInitialPath === 'string' && rawInitialPath.trim().length > 0
        ? rawInitialPath.trim()
        : app.getPath('home');
    const dialogOptions: OpenDialogOptions = {
      defaultPath: initialPath,
      properties: ['openDirectory', 'createDirectory'],
    };
    const result = state.window
      ? await dialog.showOpenDialog(state.window, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0] ?? null;
  });
}

async function createWindow(apiBaseUrl: string): Promise<void> {
  const preloadPath = resolvePreloadPath();
  if (!preloadPath) {
    throw new Error('Could not locate Electron preload script (preload.cjs).');
  }
  const window = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 980,
    minHeight: 680,
    icon: desktopIconPath ?? undefined,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  state.window = window;

  if (isDev) {
    await window.webContents.session.clearStorageData({
      storages: ['serviceworkers', 'cachestorage'],
    }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Failed to clear dev service-worker/cache state: ${message}`);
    });
  }

  const targetUrl = isDev ? devUiUrl : apiBaseUrl;
  const allowedOrigins = new Set<string>([new URL(targetUrl).origin]);

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedOrigin(url, allowedOrigins)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  window.loadURL(targetUrl).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    dialog.showErrorBox('Nearbytes desktop UI failed to load', message);
  });
  window.webContents.once('did-finish-load', () => {
    void assertRuntimeBridge(window);
  });

  if (enableAutoUpdater) {
    setupAutoUpdater(window, true);
  }
}

function applyDesktopIcon(): void {
  if (!desktopIconPath) {
    return;
  }
  const icon = nativeImage.createFromPath(desktopIconPath);
  if (icon.isEmpty()) {
    return;
  }
  if (process.platform === 'darwin') {
    app.dock?.setIcon(icon);
  }
}

function resolveDesktopIconPath(): string | null {
  const iconName = process.platform === 'darwin' ? 'icon.png' : process.platform === 'win32' ? 'icon.ico' : 'icon.png';
  return resolveExistingPath([
    path.join(app.getAppPath(), 'build', 'icons', iconName),
    path.join(process.resourcesPath, 'build', 'icons', iconName),
    path.join(process.cwd(), 'build', 'icons', iconName),
  ]) ?? null;
}

async function shutdown(): Promise<void> {
  if (state.runtime) {
    await state.runtime.stop();
    state.runtime = null;
  }
  await clearPublishedDesktopSession();
}

async function loadRuntimeModule(): Promise<RuntimeModule> {
  const runtimePath = resolveExistingPath([
    path.join(app.getAppPath(), 'dist', 'server', 'runtime.js'),
    path.join(process.resourcesPath, 'app.asar.unpacked', 'dist', 'server', 'runtime.js'),
    path.join(process.cwd(), 'dist', 'server', 'runtime.js'),
  ]);
  if (!runtimePath) {
    throw new Error('Could not locate dist/server/runtime.js. Run `yarn build` first.');
  }

  const imported = (await import(pathToFileURL(runtimePath).href)) as Partial<RuntimeModule>;
  if (typeof imported.startApiRuntime !== 'function') {
    throw new Error('Runtime module does not export startApiRuntime');
  }
  return imported as RuntimeModule;
}

function resolveUiDistPath(): string | undefined {
  const uiPath = resolveExistingPath([
    path.join(app.getAppPath(), 'ui', 'dist'),
    path.join(process.resourcesPath, 'app.asar.unpacked', 'ui', 'dist'),
    path.join(process.cwd(), 'ui', 'dist'),
  ]);
  return uiPath;
}

function resolveExistingPath(candidates: string[]): string | undefined {
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function resolvePreloadPath(): string | undefined {
  return resolveExistingPath([
    path.join(app.getAppPath(), 'electron', 'preload.cjs'),
    path.join(process.resourcesPath, 'app.asar.unpacked', 'electron', 'preload.cjs'),
    path.join(process.cwd(), 'electron', 'preload.cjs'),
  ]);
}

function filenameFromRemoteResponse(url: URL, contentDisposition: string | null): string {
  const headerMatch = contentDisposition
    ? /filename\*=UTF-8''([^;]+)|filename=\"?([^\";]+)\"?/i.exec(contentDisposition)
    : null;
  const rawFilename = headerMatch?.[1] ?? headerMatch?.[2] ?? '';
  if (rawFilename.trim().length > 0) {
    return decodeURIComponentSafe(rawFilename.trim());
  }
  const pathname = url.pathname.split('/').filter(Boolean).at(-1) ?? 'dropped-file';
  return decodeURIComponentSafe(pathname);
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function parseMaxUploadBytes(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? '50', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 50 * 1024 * 1024;
  }
  return parsed * 1024 * 1024;
}

function isAllowedOrigin(url: string, allowedOrigins: Set<string>): boolean {
  try {
    const parsed = new URL(url);
    return allowedOrigins.has(parsed.origin);
  } catch {
    return false;
  }
}

async function assertRuntimeBridge(window: BrowserWindow): Promise<void> {
  try {
    const config = (await window.webContents.executeJavaScript(
      `window.nearbytesDesktop?.getRuntimeConfig ? window.nearbytesDesktop.getRuntimeConfig() : null`,
      true
    )) as DesktopRuntimeConfig | null;

    if (!config || !config.apiBaseUrl || !config.desktopToken) {
      throw new Error('Desktop preload bridge is missing or returned invalid runtime config.');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    dialog.showErrorBox('Nearbytes desktop runtime error', message);
    app.quit();
  }
}
