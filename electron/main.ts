import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage, safeStorage, shell, type OpenDialogOptions } from 'electron';
import { existsSync, promises as fs } from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { clearPublishedDesktopSession, publishDesktopSession } from './session.js';
import { generateDesktopApiToken } from './security.js';
import { readDesktopUiState, writeDesktopUiState } from './uiState.js';
import { debugTriggerUpdateInstall, getUpdaterState, installDownloadedUpdate, openUpdateReleasePage, setupAutoUpdater } from './updater.js';

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
    integrationOptions?: {
      runtime?: {
        secretStore?: {
          get<T>(key: string): Promise<T | null>;
          set<T>(key: string, value: T): Promise<void>;
          delete(key: string): Promise<void>;
        };
        openExternalUrl?: (url: string) => Promise<void>;
      };
    };
  }): Promise<RuntimeHandle>;
}

interface DesktopRuntimeConfig {
  readonly apiBaseUrl: string;
  readonly desktopToken: string;
  readonly isDesktop: true;
}

interface RendererProfileState {
  reason: string | null;
  stopTimer: ReturnType<typeof setTimeout> | null;
}

interface DiagnosticsState {
  metricsTimer: ReturnType<typeof setInterval> | null;
  isShuttingDown: boolean;
}

const DEFAULT_DESKTOP_SESSION_TTL_MS = 8 * 60 * 60 * 1000;

const state: {
  window: BrowserWindow | null;
  runtime: RuntimeHandle | null;
  config: DesktopRuntimeConfig | null;
  rendererProfile: RendererProfileState;
  diagnostics: DiagnosticsState;
} = {
  window: null,
  runtime: null,
  config: null,
  rendererProfile: {
    reason: null,
    stopTimer: null,
  },
  diagnostics: {
    metricsTimer: null,
    isShuttingDown: false,
  },
};

const desktopToken = generateDesktopApiToken();
const devUiUrl = process.env.NEARBYTES_ELECTRON_DEV_SERVER_URL?.trim() ?? '';
const isDev = devUiUrl.length > 0;
const enableRendererCpuProfile = process.env.NEARBYTES_RENDERER_PROFILE === '1';
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
  void prepareDiagnosticsShutdown('before-quit');
  void shutdown();
});

app.on('activate', () => {
  void ensureDesktopWindow();
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

process.once('SIGINT', () => {
  void handleTerminationSignal('SIGINT', 130);
});

process.once('SIGTERM', () => {
  void handleTerminationSignal('SIGTERM', 143);
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
    integrationOptions: {
      runtime: {
        secretStore: createDesktopSecretStore(),
        openExternalUrl: async (url: string) => {
          await shell.openExternal(url);
        },
      },
    },
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
  startMetricsSampling();
  await createWindow(apiBaseUrl);
}

function createDesktopSecretStore(): {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
} {
  const filePath = path.join(app.getPath('userData'), 'integration-secrets.json');
  return {
    async get<T>(key: string): Promise<T | null> {
      const entries = await readSecretEntries(filePath);
      const encoded = entries[key];
      if (!encoded) {
        return null;
      }
      const decrypted = decryptDesktopSecret(Buffer.from(encoded, 'base64'));
      return JSON.parse(decrypted.toString('utf8')) as T;
    },
    async set<T>(key: string, value: T): Promise<void> {
      const entries = await readSecretEntries(filePath);
      const encrypted = encryptDesktopSecret(Buffer.from(JSON.stringify(value), 'utf8'));
      entries[key] = encrypted.toString('base64');
      await writeSecretEntries(filePath, entries);
    },
    async delete(key: string): Promise<void> {
      const entries = await readSecretEntries(filePath);
      if (!(key in entries)) {
        return;
      }
      delete entries[key];
      await writeSecretEntries(filePath, entries);
    },
  };
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
  ipcMain.handle('nearbytes-desktop:debug-trigger-update-install', async () => {
    return debugTriggerUpdateInstall();
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
    show: false,
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
  window.on('closed', () => {
    if (state.window === window) {
      state.window = null;
    }
  });
  window.on('unresponsive', () => {
    console.error('[desktop] window became unresponsive');
    void stopRendererCpuProfile(window, 'unresponsive');
  });
  window.once('ready-to-show', () => {
    console.log('[desktop] window ready-to-show');
    presentWindow(window);
  });

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
  window.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    console.log(`[renderer:${level}] ${sourceId}:${line} ${message}`);
  });
  window.webContents.on('dom-ready', () => {
    console.log('[desktop] renderer dom-ready');
  });
  window.webContents.on('did-finish-load', () => {
    console.log('[desktop] renderer did-finish-load');
  });
  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`[desktop] renderer did-fail-load ${errorCode} ${errorDescription} ${validatedURL}`);
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    console.error('[desktop] renderer process gone', details);
    void stopRendererCpuProfile(window, `render-process-gone:${details.reason}`);
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
    presentWindow(window);
    void installRendererDiagnostics(window);
    if (enableRendererCpuProfile) {
      void startRendererCpuProfile(window);
    }
    void assertRuntimeBridge(window);
  });

  if (enableAutoUpdater) {
    setupAutoUpdater(window, true);
  }
}

async function ensureDesktopWindow(): Promise<void> {
  if (state.window && !state.window.isDestroyed()) {
    presentWindow(state.window);
    return;
  }
  if (!state.config) {
    return;
  }
  await createWindow(state.config.apiBaseUrl);
}

function presentWindow(window: BrowserWindow): void {
  if (window.isDestroyed()) {
    return;
  }
  if (window.isMinimized()) {
    window.restore();
  }
  if (!window.isVisible()) {
    window.show();
  }
  window.focus();
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
  stopMetricsSampling();
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

async function readSecretEntries(filePath: string): Promise<Record<string, string>> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as { entries?: Record<string, string> };
    return parsed.entries && typeof parsed.entries === 'object' ? { ...parsed.entries } : {};
  } catch (error) {
    if (isFileNotFound(error)) {
      return {};
    }
    throw error;
  }
}

async function writeSecretEntries(filePath: string, entries: Record<string, string>): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(
    tempPath,
    `${JSON.stringify({ version: 1, entries }, null, 2)}\n`,
    'utf8'
  );
  await fs.rename(tempPath, filePath);
}

function encryptDesktopSecret(value: Buffer): Buffer {
  if (!safeStorage.isEncryptionAvailable()) {
    return value;
  }
  return safeStorage.encryptString(value.toString('utf8'));
}

function decryptDesktopSecret(value: Buffer): Buffer {
  if (!safeStorage.isEncryptionAvailable()) {
    return value;
  }
  return Buffer.from(safeStorage.decryptString(value), 'utf8');
}

function isFileNotFound(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'ENOENT');
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

async function installRendererDiagnostics(window: BrowserWindow): Promise<void> {
  try {
    await window.webContents.executeJavaScript(
      `(() => {
        if (window.__nearbytesRendererDiagnosticsInstalled) {
          return;
        }
        window.__nearbytesRendererDiagnosticsInstalled = true;

        const slowHandlerThresholdMs = 32;
        const stallThresholdMs = 150;
        const frameGapThresholdMs = 250;
        const trackedEvents = new Set([
          'mousemove',
          'mouseover',
          'mouseout',
          'mouseenter',
          'mouseleave',
          'pointermove',
          'pointerover',
          'pointerout',
          'pointerenter',
          'pointerleave',
          'wheel',
        ]);
        const listenerWrappers = new WeakMap();
        let lastInputSummary = 'none';
        let lastInputAt = performance.now();
        let lastFrameAt = performance.now();

        const describeTarget = (target) => {
          try {
            if (target === window) {
              return 'window';
            }
            if (target === document) {
              return 'document';
            }
            if (target instanceof Element) {
              const tag = target.tagName.toLowerCase();
              const id = target.id ? '#' + target.id : '';
              const classes =
                typeof target.className === 'string' && target.className.trim()
                  ? '.' + target.className.trim().split(/\\s+/).slice(0, 3).join('.')
                  : '';
              return tag + id + classes;
            }
            if (target && typeof target === 'object' && 'constructor' in target && target.constructor) {
              return target.constructor.name || 'object';
            }
          } catch {}
          return 'unknown';
        };

        const serializeReason = (value) => {
          if (value instanceof Error) {
            return {
              name: value.name,
              message: value.message,
              stack: value.stack || '',
            };
          }
          if (typeof value === 'string') {
            return value;
          }
          try {
            return JSON.parse(JSON.stringify(value));
          } catch {
            return String(value);
          }
        };

        const inputCapture = (event) => {
          lastInputAt = performance.now();
          lastInputSummary = event.type + ' on ' + describeTarget(event.target);
        };
        trackedEvents.forEach((type) => {
          window.addEventListener(type, inputCapture, { capture: true, passive: true });
        });

        const originalAddEventListener = EventTarget.prototype.addEventListener;
        const originalRemoveEventListener = EventTarget.prototype.removeEventListener;
        const optionsKey = (options) =>
          typeof options === 'boolean' ? String(options) : String(Boolean(options && options.capture));

        EventTarget.prototype.addEventListener = function patchedAddEventListener(type, listener, options) {
          if (!listener || !trackedEvents.has(type)) {
            return originalAddEventListener.call(this, type, listener, options);
          }

          let wrappersByKey = listenerWrappers.get(listener);
          if (!wrappersByKey) {
            wrappersByKey = new Map();
            listenerWrappers.set(listener, wrappersByKey);
          }

          const wrapperKey = type + ':' + optionsKey(options);
          if (!wrappersByKey.has(wrapperKey)) {
            const targetLabel = describeTarget(this);
            const wrapFunction = (fn, thisArg) =>
              function wrappedEventListener(...args) {
                const startedAt = performance.now();
                try {
                  return fn.apply(thisArg, args);
                } finally {
                  const elapsedMs = performance.now() - startedAt;
                  if (elapsedMs >= slowHandlerThresholdMs) {
                    console.warn(
                      '[diag] slow-event-handler',
                      JSON.stringify({
                        type,
                        elapsedMs: Number(elapsedMs.toFixed(1)),
                        target: targetLabel,
                        listener:
                          typeof fn === 'function' && fn.name
                            ? fn.name
                            : typeof thisArg?.handleEvent === 'function' && thisArg.handleEvent.name
                              ? thisArg.handleEvent.name
                              : 'anonymous',
                      })
                    );
                  }
                }
              };

            const wrapped =
              typeof listener === 'function'
                ? wrapFunction(listener, this)
                : typeof listener.handleEvent === 'function'
                  ? { handleEvent: wrapFunction(listener.handleEvent, listener) }
                  : listener;

            wrappersByKey.set(wrapperKey, wrapped);
          }

          return originalAddEventListener.call(this, type, wrappersByKey.get(wrapperKey), options);
        };

        EventTarget.prototype.removeEventListener = function patchedRemoveEventListener(type, listener, options) {
          if (!listener || !trackedEvents.has(type)) {
            return originalRemoveEventListener.call(this, type, listener, options);
          }
          const wrappersByKey = listenerWrappers.get(listener);
          const wrapped = wrappersByKey?.get(type + ':' + optionsKey(options)) ?? listener;
          return originalRemoveEventListener.call(this, type, wrapped, options);
        };

        window.addEventListener('error', (event) => {
          console.error(
            '[diag] window-error',
            JSON.stringify({
              message: event.message,
              filename: event.filename,
              lineno: event.lineno,
              colno: event.colno,
              error: serializeReason(event.error),
            })
          );
        });

        window.addEventListener('unhandledrejection', (event) => {
          console.error(
            '[diag] unhandled-rejection',
            JSON.stringify({
              reason: serializeReason(event.reason),
            })
          );
        });

        if (typeof PerformanceObserver === 'function') {
          try {
            const observer = new PerformanceObserver((list) => {
              for (const entry of list.getEntries()) {
                console.warn(
                  '[diag] long-task',
                  JSON.stringify({
                    name: entry.name,
                    durationMs: Number(entry.duration.toFixed(1)),
                    startMs: Number(entry.startTime.toFixed(1)),
                    lastInputSummary,
                    sinceLastInputMs: Number((performance.now() - lastInputAt).toFixed(1)),
                  })
                );
              }
            });
            observer.observe({ entryTypes: ['longtask'] });
          } catch (error) {
            console.warn('[diag] failed-to-install-longtask-observer', String(error));
          }
        }

        let lastTickAt = performance.now();
        setInterval(() => {
          const now = performance.now();
          const driftMs = now - lastTickAt - 1000;
          if (driftMs >= stallThresholdMs) {
            console.warn(
              '[diag] main-thread-stall',
              JSON.stringify({
                driftMs: Number(driftMs.toFixed(1)),
                lastInputSummary,
                sinceLastInputMs: Number((now - lastInputAt).toFixed(1)),
              })
            );
          }
          lastTickAt = now;
        }, 1000);

        const monitorFrames = (timestamp) => {
          const gapMs = timestamp - lastFrameAt;
          if (gapMs >= frameGapThresholdMs) {
            console.warn(
              '[diag] frame-gap',
              JSON.stringify({
                gapMs: Number(gapMs.toFixed(1)),
                lastInputSummary,
                sinceLastInputMs: Number((performance.now() - lastInputAt).toFixed(1)),
              })
            );
          }
          lastFrameAt = timestamp;
          window.requestAnimationFrame(monitorFrames);
        };
        window.requestAnimationFrame(monitorFrames);

        console.log('[diag] renderer diagnostics installed');
      })();`,
      true
    );
  } catch (error) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    console.error(`[desktop] failed to install renderer diagnostics: ${message}`);
  }
}

async function startRendererCpuProfile(window: BrowserWindow): Promise<void> {
  if (!isDev) {
    return;
  }
  if (window.webContents.isDestroyed() || state.rendererProfile.reason !== null) {
    return;
  }
  try {
    if (!window.webContents.debugger.isAttached()) {
      window.webContents.debugger.attach();
    }
    await window.webContents.debugger.sendCommand('Profiler.enable');
    await window.webContents.debugger.sendCommand('Profiler.start');
    state.rendererProfile.reason = 'running';
    if (state.rendererProfile.stopTimer) {
      clearTimeout(state.rendererProfile.stopTimer);
    }
    state.rendererProfile.stopTimer = setTimeout(() => {
      void stopRendererCpuProfile(window, 'startup-sample');
    }, 60000);
    console.log('[desktop] renderer CPU profile started');
  } catch (error) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    console.error(`[desktop] failed to start renderer CPU profile: ${message}`);
  }
}

async function stopRendererCpuProfile(window: BrowserWindow, reason: string): Promise<void> {
  if (state.rendererProfile.reason === null || state.rendererProfile.reason === reason) {
    return;
  }
  state.rendererProfile.reason = reason;
  if (state.rendererProfile.stopTimer) {
    clearTimeout(state.rendererProfile.stopTimer);
    state.rendererProfile.stopTimer = null;
  }
  if (window.webContents.isDestroyed() || !window.webContents.debugger.isAttached()) {
    return;
  }
  try {
    const profileResult = (await window.webContents.debugger.sendCommand('Profiler.stop')) as {
      profile: unknown;
    };
    await window.webContents.debugger.sendCommand('Profiler.disable');
    window.webContents.debugger.detach();
    const diagnosticsDir = path.join(app.getPath('userData'), 'diagnostics');
    await fs.mkdir(diagnosticsDir, { recursive: true });
    const outputPath = path.join(
      diagnosticsDir,
      `renderer-profile-${Date.now()}-${sanitizeFilenameSegment(reason)}.cpuprofile`
    );
    await fs.writeFile(outputPath, `${JSON.stringify(profileResult.profile, null, 2)}\n`, 'utf8');
    console.log(`[desktop] renderer CPU profile saved to ${outputPath}`);
  } catch (error) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    console.error(`[desktop] failed to stop renderer CPU profile: ${message}`);
  }
}

function sanitizeFilenameSegment(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'profile';
}

function startMetricsSampling(): void {
  if (!isDev || state.diagnostics.metricsTimer) {
    return;
  }
  state.diagnostics.metricsTimer = setInterval(() => {
    try {
      const metrics = app.getAppMetrics().map((entry) => ({
        pid: entry.pid,
        type: entry.type,
        cpuPercent: Number(entry.cpu.percentCPUUsage.toFixed(1)),
        idleWakeupsPerSecond:
          typeof entry.cpu.idleWakeupsPerSecond === 'number'
            ? Number(entry.cpu.idleWakeupsPerSecond.toFixed(1))
            : null,
        memoryMb:
          typeof entry.memory?.workingSetSize === 'number'
            ? Number((entry.memory.workingSetSize / (1024 * 1024)).toFixed(1))
            : null,
      }));
      console.log(`[desktop] app-metrics ${JSON.stringify(metrics)}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[desktop] failed to sample app metrics: ${message}`);
    }
  }, 1000);
}

function stopMetricsSampling(): void {
  if (state.diagnostics.metricsTimer) {
    clearInterval(state.diagnostics.metricsTimer);
    state.diagnostics.metricsTimer = null;
  }
}

async function prepareDiagnosticsShutdown(reason: string): Promise<void> {
  if (state.diagnostics.isShuttingDown) {
    return;
  }
  state.diagnostics.isShuttingDown = true;
  stopMetricsSampling();
  const window = state.window;
  if (window && !window.isDestroyed()) {
    await stopRendererCpuProfile(window, reason);
  }
}

async function handleTerminationSignal(signal: 'SIGINT' | 'SIGTERM', exitCode: number): Promise<void> {
  console.log(`[desktop] received ${signal}, flushing diagnostics`);
  try {
    await prepareDiagnosticsShutdown(signal.toLowerCase());
  } finally {
    process.exit(exitCode);
  }
}
