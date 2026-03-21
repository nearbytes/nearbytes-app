import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage, safeStorage, shell, type OpenDialogOptions } from 'electron';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'crypto';
import { existsSync, promises as fs } from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { promisify } from 'util';
import { createDesktopCommandExecutor, type DisposableCommandExecutor } from './desktopCommandExecutor.js';
import { clearPublishedDesktopSession, publishDesktopSession } from './session.js';
import { generateDesktopApiToken } from './security.js';
import { readDesktopUiState, writeDesktopUiState } from './uiState.js';
import { debugTriggerUpdateInstall, getUpdaterState, installDownloadedUpdate, openUpdateReleasePage, setupAutoUpdater } from './updater.js';
import { APP_CONFIG } from '../src/config/appConfig.js';
import type { CommandExecutor } from '../src/integrations/runtime.js';
import type { UiDebugAction, UiDebugActionResult, UiDebugExecutor, UiDebugRunRequest, UiDebugRunResponse } from '../src/server/uiDebug.js';

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
        commandExecutor?: CommandExecutor;
        openExternalUrl?: (url: string) => Promise<void>;
      };
    };
    uiDebugExecutor?: UiDebugExecutor;
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
  shutdownPromise: Promise<void> | null;
  quitAllowed: boolean;
}

interface DesktopElementState {
  readonly found: boolean;
  readonly visible: boolean;
  readonly text?: string;
  readonly value?: string;
  readonly html?: string;
  readonly outerHtml?: string;
  readonly attribute?: string | null;
  readonly rect?: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
}

const DEFAULT_DESKTOP_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const DEEP_LINK_PROTOCOL = 'nearbytes';
const DESKTOP_RUNTIME_LOG_TAIL_BYTES = 64 * 1024;
const execFileAsync = promisify(execFile);

applyDebugFlagFromArgv(process.argv);

const initialDeepLinkUrls = extractDeepLinkUrls(process.argv);
const singleInstanceLock = app.requestSingleInstanceLock();

const state: {
  window: BrowserWindow | null;
  runtime: RuntimeHandle | null;
  commandExecutor: DisposableCommandExecutor | null;
  config: DesktopRuntimeConfig | null;
  devUiProcess: ChildProcess | null;
  rendererProfile: RendererProfileState;
  diagnostics: DiagnosticsState;
  deepLinks: {
    pendingUrls: string[];
    rendererReady: boolean;
  };
} = {
  window: null,
  runtime: null,
  commandExecutor: null,
  config: null,
  devUiProcess: null,
  rendererProfile: {
    reason: null,
    stopTimer: null,
  },
  diagnostics: {
    metricsTimer: null,
    isShuttingDown: false,
    shutdownPromise: null,
    quitAllowed: false,
  },
  deepLinks: {
    pendingUrls: [],
    rendererReady: false,
  },
};

if (!singleInstanceLock) {
  app.quit();
}

const desktopToken = generateDesktopApiToken();
const devUiUrl = process.env.NEARBYTES_ELECTRON_DEV_SERVER_URL?.trim() ?? '';
const isDev = devUiUrl.length > 0;
const hasExternalDevUiServer = process.env.NEARBYTES_EXTERNAL_DEV_SERVER === '1';
const enableRendererCpuProfile = process.env.NEARBYTES_RENDERER_PROFILE === '1';
const enableAutoUpdater = !isDev && process.env.NEARBYTES_DISABLE_AUTO_UPDATE !== '1';
const maxUploadBytes = parseMaxUploadBytes(process.env.NEARBYTES_MAX_UPLOAD_MB);
const sessionTtlMs = parsePositiveInt(
  process.env.NEARBYTES_DESKTOP_SESSION_TTL_MS,
  DEFAULT_DESKTOP_SESSION_TTL_MS
);

app.on('window-all-closed', () => {
  void requestAppQuit('window-all-closed');
});

app.on('second-instance', (_event, argv) => {
  void ensureDesktopWindow();
  void enqueueDeepLinkUrls(extractDeepLinkUrls(argv));
});

app.on('open-url', (event, url) => {
  event.preventDefault();
  void enqueueDeepLinkUrls([url]);
});

app.on('before-quit', (event) => {
  if (state.diagnostics.quitAllowed) {
    return;
  }
  event.preventDefault();
  void requestAppQuit('before-quit');
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
    await requestAppQuit('startup-failed', 1);
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
  registerDeepLinkProtocol();
  console.log('[desktop] starting API runtime');
  const runtimeModule = await loadRuntimeModule();
  const commandExecutor = createDesktopCommandExecutor(console);
  state.commandExecutor = commandExecutor;
  let runtime: RuntimeHandle;
  try {
    runtime = await runtimeModule.startApiRuntime({
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
          commandExecutor,
          openExternalUrl: async (url: string) => {
            await shell.openExternal(url);
          },
        },
      },
      uiDebugExecutor: isDesktopDebugEnabled() ? createDesktopUiDebugExecutor() : undefined,
    });
  } catch (error) {
    state.commandExecutor = null;
    commandExecutor.dispose();
    throw error;
  }
  state.runtime = runtime;
  console.log(`[desktop] API runtime ready on http://127.0.0.1:${runtime.port}`);

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
  console.log('[desktop] desktop session published');

  registerIpc();
  startMetricsSampling();
  if (isDev) {
    await ensureDevUiServer();
  }
  await createWindow(apiBaseUrl);
  await enqueueDeepLinkUrls(initialDeepLinkUrls);
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

function createDesktopUiDebugExecutor(): UiDebugExecutor {
  return {
    async getCapabilities() {
      return {
        available: true,
        actions: ['inspect', 'quitApp', 'navigate', 'waitFor', 'click', 'type', 'pressKey', 'read', 'screenshot'],
        screenshot: true,
        title: requireDesktopWindow().getTitle(),
        url: requireDesktopWindow().webContents.getURL(),
      };
    },
    async run(request: UiDebugRunRequest): Promise<UiDebugRunResponse> {
      const results: UiDebugActionResult[] = [];
      const stopOnError = request.stopOnError !== false;
      for (const action of request.actions) {
        const startedAt = Date.now();
        try {
          const result = await runDesktopUiDebugAction(action);
          results.push({
            type: action.type,
            ok: true,
            durationMs: Date.now() - startedAt,
            result,
          });
        } catch (error) {
          results.push({
            type: action.type,
            ok: false,
            durationMs: Date.now() - startedAt,
            error: error instanceof Error ? error.message : String(error),
          });
          if (stopOnError) {
            break;
          }
        }
      }
      return {
        ok: results.every((entry) => entry.ok),
        actionCount: request.actions.length,
        results,
      };
    },
  };
}

async function runDesktopUiDebugAction(action: UiDebugAction): Promise<Record<string, unknown>> {
  switch (action.type) {
    case 'inspect':
      return inspectDesktopDocument();
    case 'quitApp':
      return quitDesktopApp();
    case 'navigate':
      return navigateDesktopWindow(action);
    case 'waitFor':
      return waitForDesktopSelector(action.selector, action.state, action.timeoutMs, action.pollIntervalMs);
    case 'click':
      return clickDesktopSelector(action.selector);
    case 'type':
      return typeIntoDesktopSelector(action.selector, action.value, action.clear, action.submit);
    case 'pressKey':
      return pressDesktopKey(action);
    case 'read':
      return readDesktopSelector(action.selector, action.field, action.attribute);
    case 'screenshot':
      return captureDesktopScreenshot(action);
    default:
      throw new Error(`Unsupported UI debug action: ${(action as { type?: string }).type ?? 'unknown'}`);
  }
}

async function quitDesktopApp(): Promise<Record<string, unknown>> {
  queueMicrotask(() => {
    void requestAppQuit('ui-debug');
  });
  return {
    quitting: true,
  };
}

function requireDesktopWindow(): BrowserWindow {
  if (!state.window || state.window.isDestroyed()) {
    throw new Error('Nearbytes desktop window is not available.');
  }
  return state.window;
}

async function inspectDesktopDocument(): Promise<Record<string, unknown>> {
  const snapshot = await evaluateInDesktopWindow<{
    title: string;
    url: string;
    readyState: string;
  }>(`(() => ({
    title: document.title,
    url: window.location.href,
    readyState: document.readyState,
  }))()`);
  return snapshot;
}

async function navigateDesktopWindow(action: Extract<UiDebugAction, { type: 'navigate' }>): Promise<Record<string, unknown>> {
  const window = requireDesktopWindow();
  const currentUrl = window.webContents.getURL();
  const targetUrl = action.url?.trim()
    ? action.url.trim()
    : action.path?.trim()
      ? new URL(action.path.trim(), currentUrl).toString()
      : currentUrl;
  await window.loadURL(targetUrl);
  if (action.waitForLoad !== false) {
    await waitForDesktopReadyState('complete', 10_000);
  }
  return {
    url: window.webContents.getURL(),
    title: window.getTitle(),
  };
}

async function waitForDesktopReadyState(expectedState: 'interactive' | 'complete', timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const stateValue = await evaluateInDesktopWindow<string>('document.readyState');
    if (stateValue === expectedState || (expectedState === 'interactive' && stateValue === 'complete')) {
      return;
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for document.readyState=${expectedState}.`);
}

async function waitForDesktopSelector(
  selector: string,
  stateName: 'present' | 'visible' | 'hidden' = 'visible',
  timeoutMs = 10_000,
  pollIntervalMs = 100
): Promise<Record<string, unknown>> {
  const trimmedSelector = selector.trim();
  if (!trimmedSelector) {
    throw new Error('UI debug selector is required.');
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const entry = await readDesktopElementState(trimmedSelector);
    if (
      (stateName === 'present' && entry.found) ||
      (stateName === 'visible' && entry.found && entry.visible) ||
      (stateName === 'hidden' && (!entry.found || !entry.visible))
    ) {
      return {
        selector: trimmedSelector,
        state: stateName,
        found: entry.found,
        visible: entry.visible,
      };
    }
    await delay(pollIntervalMs);
  }
  throw new Error(`Timed out waiting for selector "${trimmedSelector}" to become ${stateName}.`);
}

async function clickDesktopSelector(selector: string): Promise<Record<string, unknown>> {
  const trimmedSelector = selector.trim();
  const entry = await readDesktopElementState(trimmedSelector);
  if (!entry.found) {
    throw new Error(`Selector not found: ${trimmedSelector}`);
  }
  if (!entry.visible) {
    throw new Error(`Selector is not visible: ${trimmedSelector}`);
  }
  await evaluateInDesktopWindow<boolean>(buildSelectorScript(trimmedSelector, `
    element.scrollIntoView({ block: 'center', inline: 'center' });
    element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }));
    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 }));
    if (typeof element.click === 'function') {
      element.click();
    } else {
      element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    }
    return true;
  `));
  return {
    selector: trimmedSelector,
    clicked: true,
  };
}

async function typeIntoDesktopSelector(
  selector: string,
  value: string,
  clear = true,
  submit = false
): Promise<Record<string, unknown>> {
  const trimmedSelector = selector.trim();
  const entry = await readDesktopElementState(trimmedSelector);
  if (!entry.found) {
    throw new Error(`Selector not found: ${trimmedSelector}`);
  }
  await evaluateInDesktopWindow<boolean>(buildSelectorScript(trimmedSelector, `
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
      throw new Error('Target element is not a text input.');
    }
    element.scrollIntoView({ block: 'center', inline: 'center' });
    element.focus();
    ${clear ? `element.value = '';` : ''}
    element.value = ${JSON.stringify(value)};
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    ${submit ? `element.form?.requestSubmit?.();` : ''}
    return true;
  `));
  return {
    selector: trimmedSelector,
    valueLength: value.length,
    submitted: submit,
  };
}

async function pressDesktopKey(
  action: Extract<UiDebugAction, { type: 'pressKey' }>
): Promise<Record<string, unknown>> {
  const window = requireDesktopWindow();
  const modifiers: Array<'alt' | 'control' | 'meta' | 'shift'> = [];
  if (action.alt) modifiers.push('alt');
  if (action.control) modifiers.push('control');
  if (action.meta) modifiers.push('meta');
  if (action.shift) modifiers.push('shift');
  window.webContents.sendInputEvent({
    type: 'keyDown',
    keyCode: action.key,
    modifiers,
  });
  if (action.key.length === 1) {
    window.webContents.sendInputEvent({
      type: 'char',
      keyCode: action.key,
      modifiers,
    });
  }
  window.webContents.sendInputEvent({
    type: 'keyUp',
    keyCode: action.key,
    modifiers,
  });
  return {
    key: action.key,
    modifiers,
  };
}

async function readDesktopSelector(
  selector: string,
  field: 'text' | 'html' | 'outerHtml' | 'value' = 'text',
  attribute?: string
): Promise<Record<string, unknown>> {
  const trimmedSelector = selector.trim();
  const entry = await readDesktopElementState(trimmedSelector, attribute?.trim() || undefined);
  if (!entry.found) {
    throw new Error(`Selector not found: ${trimmedSelector}`);
  }
  const value =
    field === 'html'
      ? entry.html
      : field === 'outerHtml'
        ? entry.outerHtml
        : field === 'value'
          ? entry.value
          : entry.text;
  return {
    selector: trimmedSelector,
    field,
    value: value ?? '',
    attribute: attribute?.trim() ? entry.attribute ?? null : undefined,
  };
}

async function captureDesktopScreenshot(
  action: Extract<UiDebugAction, { type: 'screenshot' }>
): Promise<Record<string, unknown>> {
  const window = requireDesktopWindow();
  const targetPath = await resolveDesktopScreenshotPath(action.path);
  const rect = action.selector?.trim()
    ? await readDesktopElementState(action.selector.trim()).then((entry) => {
        if (!entry.found || !entry.rect) {
          throw new Error(`Selector not found for screenshot: ${action.selector}`);
        }
        return {
          x: Math.max(0, Math.floor(entry.rect.x)),
          y: Math.max(0, Math.floor(entry.rect.y)),
          width: Math.max(1, Math.ceil(entry.rect.width)),
          height: Math.max(1, Math.ceil(entry.rect.height)),
        };
      })
    : undefined;
  const image = rect && action.fullPage !== true
    ? await window.webContents.capturePage(rect)
    : await window.webContents.capturePage();
  const png = image.toPNG();
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, png);
  return {
    path: targetPath,
    selector: action.selector?.trim() || undefined,
    width: image.getSize().width,
    height: image.getSize().height,
  };
}

async function resolveDesktopScreenshotPath(rawPath: string | undefined): Promise<string> {
  if (rawPath?.trim()) {
    return path.resolve(rawPath.trim());
  }
  const diagnosticsDir = path.join(app.getPath('userData'), 'diagnostics', 'screenshots');
  await fs.mkdir(diagnosticsDir, { recursive: true });
  return path.join(diagnosticsDir, `nearbytes-ui-${Date.now()}.png`);
}

async function readDesktopElementState(selector: string, attribute?: string): Promise<DesktopElementState> {
  return evaluateInDesktopWindow<DesktopElementState>(buildSelectorScript(selector, `
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return {
      found: true,
      visible: rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none',
      text: element.textContent ?? '',
      value: 'value' in element ? String(element.value ?? '') : undefined,
      html: element instanceof HTMLElement ? element.innerHTML : undefined,
      outerHtml: element instanceof HTMLElement ? element.outerHTML : undefined,
      attribute: ${attribute ? `element.getAttribute(${JSON.stringify(attribute)})` : 'undefined'},
      rect: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      },
    };
  `, `
    return {
      found: false,
      visible: false,
    };
  `));
}

function buildSelectorScript(selector: string, onFound: string, onMissing?: string): string {
  return `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) {
      ${onMissing ?? `throw new Error(${JSON.stringify(`Selector not found: ${selector}`)});`}
    }
    ${onFound}
  })()`;
}

async function evaluateInDesktopWindow<T>(source: string): Promise<T> {
  const window = requireDesktopWindow();
  return window.webContents.executeJavaScript(source, true) as Promise<T>;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  ipcMain.handle('nearbytes-desktop:connect-deep-links', () => {
    state.deepLinks.rendererReady = true;
    const pending = [...state.deepLinks.pendingUrls];
    state.deepLinks.pendingUrls = [];
    return pending;
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
      rawState as { volumeMounts?: unknown; sourceDiscovery?: unknown; dismissedRootSuggestions?: unknown; theme?: unknown }
    );
    return true;
  });
  ipcMain.handle('nearbytes-desktop:save-theme-registry', async (_event, rawRegistry: unknown) => {
    if (!isDev) {
      throw new Error('Theme registry editing is only available in development.');
    }
    if (!rawRegistry || typeof rawRegistry !== 'object' || Array.isArray(rawRegistry)) {
      throw new Error('Theme registry payload must be an object.');
    }
    const targetPath = resolveThemePresetRegistryPath();
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, JSON.stringify(rawRegistry, null, 2), 'utf8');
    return { path: targetPath };
  });
  ipcMain.handle('nearbytes-desktop:export-logo-png', async (_event, rawDataUrl: unknown) => {
    if (!isDev) {
      throw new Error('Logo export is only available in development.');
    }
    if (typeof rawDataUrl !== 'string' || !rawDataUrl.startsWith('data:image/png;base64,')) {
      throw new Error('A PNG data URL is required.');
    }
    const targetPath = resolveThemeLogoExportPath();
    const base64 = rawDataUrl.slice('data:image/png;base64,'.length);
    const pngBuffer = Buffer.from(base64, 'base64');
    await fs.writeFile(targetPath, pngBuffer);
    const publicIconPath = resolvePublicAppIconPath();
    await fs.mkdir(path.dirname(publicIconPath), { recursive: true });
    await fs.writeFile(publicIconPath, pngBuffer);
    const iconPaths = await syncPackagedIconAssets(targetPath);
    applyDesktopIcon();
    return { path: targetPath, publicPath: publicIconPath, ...iconPaths };
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
  ipcMain.handle('nearbytes-desktop:read-runtime-logs', async () => {
    return readDesktopRuntimeLogs();
  });
}

function resolveThemePresetRegistryPath(): string {
  return path.join(resolveProjectRoot(), 'ui', 'public', 'branding', 'theme-presets.json');
}

function resolveThemeLogoExportPath(): string {
  return path.join(resolveProjectRoot(), 'build', 'icons', 'icon-master.png');
}

function resolvePublicAppIconPath(): string {
  return path.join(resolveProjectRoot(), 'ui', 'public', 'branding', 'app-icon.png');
}

function resolveProjectRoot(): string {
  const candidates = [
    process.cwd(),
    app.getAppPath(),
    path.resolve(app.getAppPath(), '..'),
    path.resolve(app.getAppPath(), '..', '..'),
    path.resolve(app.getAppPath(), '..', '..', '..'),
  ];
  for (const candidate of candidates) {
    if (
      existsSync(path.join(candidate, 'package.json')) &&
      existsSync(path.join(candidate, 'electron')) &&
      existsSync(path.join(candidate, 'ui'))
    ) {
      return candidate;
    }
  }
  return process.cwd();
}

async function readDesktopRuntimeLogs(): Promise<{
  generatedAt: number;
  entries: Array<{
    id: string;
    label: string;
    path: string;
    exists: boolean;
    size: number;
    updatedAt: number | null;
    content: string;
  }>;
}> {
  const entries = await Promise.all(
    resolveDesktopRuntimeLogCandidates().map(async (entry) => {
      try {
        const stats = await fs.stat(entry.path);
        if (!stats.isFile()) {
          return {
            ...entry,
            exists: false,
            size: 0,
            updatedAt: null,
            content: '',
          };
        }
        const raw = await fs.readFile(entry.path, 'utf8');
        const content = raw.length > DESKTOP_RUNTIME_LOG_TAIL_BYTES
          ? raw.slice(-DESKTOP_RUNTIME_LOG_TAIL_BYTES)
          : raw;
        return {
          ...entry,
          exists: true,
          size: stats.size,
          updatedAt: stats.mtimeMs,
          content,
        };
      } catch (error) {
        if (isFileNotFound(error)) {
          return {
            ...entry,
            exists: false,
            size: 0,
            updatedAt: null,
            content: '',
          };
        }
        throw error;
      }
    })
  );

  return {
    generatedAt: Date.now(),
    entries,
  };
}

function resolveDesktopRuntimeLogCandidates(): Array<{
  id: string;
  label: string;
  path: string;
}> {
  const projectRoot = resolveProjectRoot();
  return [
    {
      id: 'server-stdout',
      label: 'Backend stdout',
      path: path.join(projectRoot, '.nearbytes-dev', 'server.stdout.log'),
    },
    {
      id: 'server-stderr',
      label: 'Backend stderr',
      path: path.join(projectRoot, '.nearbytes-dev', 'server.stderr.log'),
    },
    {
      id: 'mega-verify-runtime',
      label: 'Last MEGA runtime check',
      path: path.join(projectRoot, '.nearbytes-dev', 'verify-mega-runtime.json'),
    },
  ];
}

async function syncPackagedIconAssets(inputPath: string): Promise<{
  pngPath: string;
  icnsPath: string;
  icoPath: string;
}> {
  const projectRoot = resolveProjectRoot();
  const scriptPath = path.join(projectRoot, 'scripts', 'sync-brand-icons.mjs');
  const nodeExecutable = process.env.npm_node_execpath || 'node';
  const { stdout } = await execFileAsync(nodeExecutable, [scriptPath, '--input', inputPath], {
    cwd: projectRoot,
  });
  const parsed = JSON.parse(stdout) as {
    png?: string;
    icns?: string;
    ico?: string;
  };
  return {
    pngPath: parsed.png ?? path.join(projectRoot, 'build', 'icons', 'icon.png'),
    icnsPath: parsed.icns ?? path.join(projectRoot, 'build', 'icons', 'icon.icns'),
    icoPath: parsed.ico ?? path.join(projectRoot, 'build', 'icons', 'icon.ico'),
  };
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
    icon: resolveDesktopIconPath() ?? undefined,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  state.window = window;
  state.deepLinks.rendererReady = false;
  window.on('closed', () => {
    if (state.window === window) {
      state.window = null;
    }
    state.deepLinks.rendererReady = false;
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

  const targetUrl = isDev ? devUiUrl : `${apiBaseUrl}/`;
  const allowedOrigins = new Set<string>([new URL(targetUrl).origin]);

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedOrigin(url, allowedOrigins)) {
      return { action: 'allow' };
    }
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

function registerDeepLinkProtocol(): void {
  const success = app.isPackaged
    ? app.setAsDefaultProtocolClient(DEEP_LINK_PROTOCOL)
    : process.argv[1]
      ? app.setAsDefaultProtocolClient(DEEP_LINK_PROTOCOL, process.execPath, [path.resolve(process.argv[1])])
      : app.setAsDefaultProtocolClient(DEEP_LINK_PROTOCOL);
  if (!success) {
    console.warn(`[desktop] failed to register ${DEEP_LINK_PROTOCOL}:// as the default protocol client`);
  }
}

async function enqueueDeepLinkUrls(urls: readonly string[]): Promise<void> {
  const normalized = urls
    .map((url) => normalizeDeepLinkUrl(url))
    .filter((value): value is string => value !== null);
  if (normalized.length === 0) {
    return;
  }

  await ensureDesktopWindow();
  if (state.deepLinks.rendererReady && state.window && !state.window.isDestroyed()) {
    for (const url of normalized) {
      state.window.webContents.send('nearbytes-desktop:deep-link', url);
    }
    presentWindow(state.window);
    return;
  }

  state.deepLinks.pendingUrls.push(...normalized);
  if (state.window && !state.window.isDestroyed()) {
    presentWindow(state.window);
  }
}

function extractDeepLinkUrls(argv: readonly string[]): string[] {
  return argv.filter((value) => typeof value === 'string' && value.trim().toLowerCase().startsWith(`${DEEP_LINK_PROTOCOL}://`));
}

function normalizeDeepLinkUrl(value: string): string | null {
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== `${DEEP_LINK_PROTOCOL}:`) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
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
  const desktopIconPath = resolveDesktopIconPath();
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
  if (process.platform !== 'darwin' && state.window && typeof state.window.setIcon === 'function') {
    state.window.setIcon(icon);
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
  const errors: unknown[] = [];

  try {
    await clearPublishedDesktopSession();
  } catch (error) {
    errors.push(error);
  }

  const runtime = state.runtime;
  state.runtime = null;
  if (runtime) {
    try {
      await runtime.stop();
    } catch (error) {
      errors.push(error);
    }
  }

  const commandExecutor = state.commandExecutor;
  state.commandExecutor = null;
  if (commandExecutor) {
    try {
      commandExecutor.dispose();
    } catch (error) {
      errors.push(error);
    }
  }

  try {
    await stopDevUiServer();
  } catch (error) {
    errors.push(error);
  }

  if (errors.length > 0) {
    throw errors[0];
  }
}

async function requestAppQuit(reason: string, exitCode = 0): Promise<void> {
  try {
    await ensureAppShutdown(reason);
  } finally {
    state.diagnostics.quitAllowed = true;
    app.exit(exitCode);
  }
}

function ensureAppShutdown(reason: string): Promise<void> {
  if (!state.diagnostics.shutdownPromise) {
    state.diagnostics.shutdownPromise = (async () => {
      await prepareDiagnosticsShutdown(reason);
      await shutdown();
    })();
  }
  return state.diagnostics.shutdownPromise;
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

type DevUiServerInfo = {
  url: URL;
  host: string;
  port: number;
};

function parseDevUiInfo(): DevUiServerInfo | null {
  if (!isDev) {
    return null;
  }
  try {
    const url = new URL(devUiUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }
    const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
    if (!Number.isFinite(port)) {
      return null;
    }
    return {
      url,
      host: url.hostname || '127.0.0.1',
      port,
    };
  } catch {
    return null;
  }
}

async function isDevUiReachable(url: URL): Promise<boolean> {
  try {
    const response = await fetch(url.toString(), { method: 'GET' });
    return response.ok || response.status >= 200;
  } catch {
    return false;
  }
}

function startDevUiServer(info: DevUiServerInfo): void {
  if (state.devUiProcess && !state.devUiProcess.killed) {
    return;
  }
  const child = spawn('yarn', ['--cwd', 'ui', 'dev', '--host', info.host, '--port', String(info.port), '--strictPort'], {
    cwd: process.cwd(),
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  state.devUiProcess = child;
  child.on('exit', () => {
    if (state.devUiProcess === child) {
      state.devUiProcess = null;
    }
  });
}

async function waitForDevUiServer(info: DevUiServerInfo, timeoutMs = 20000): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isDevUiReachable(info.url)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

async function ensureDevUiServer(): Promise<void> {
  const info = parseDevUiInfo();
  if (!info) {
    return;
  }
  if (hasExternalDevUiServer) {
    return;
  }
  if (await isDevUiReachable(info.url)) {
    return;
  }
  startDevUiServer(info);
  await waitForDevUiServer(info);
}

async function stopDevUiServer(): Promise<void> {
  const child = state.devUiProcess;
  if (!child) {
    return;
  }
  state.devUiProcess = null;
  if (!child.killed) {
    child.kill('SIGTERM');
  }
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
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
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
  if (!isDesktopDebugEnabled('renderer-diag')) {
    return;
  }
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

        const isRendererVisible = () => !document.hidden && document.visibilityState === 'visible';

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
        document.addEventListener('visibilitychange', () => {
          const now = performance.now();
          lastFrameAt = now;
          lastInputAt = now;
          if (!isRendererVisible()) {
            lastInputSummary = 'none';
          }
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
          if (!isRendererVisible()) {
            lastTickAt = now;
            return;
          }
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
          if (!isRendererVisible()) {
            lastFrameAt = timestamp;
            window.requestAnimationFrame(monitorFrames);
            return;
          }
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

function isDesktopDebugEnabled(scope?: string): boolean {
  const value = process.env.DEBUG?.trim();
  if (!value) {
    return false;
  }
  const tokens = value.split(',').map((entry) => entry.trim()).filter(Boolean);
  const normalizedScope = scope?.trim().toLowerCase();
  return tokens.some((token) => {
    const normalized = token.toLowerCase();
    if (normalized === '1' || normalized === 'true' || normalized === '*' || normalized === 'nearbytes') {
      return true;
    }
    if (!normalizedScope) {
      return false;
    }
    return normalized === normalizedScope || normalized === `nearbytes:${normalizedScope}`;
  });
}

function applyDebugFlagFromArgv(argv: readonly string[]): void {
  const debugValue = readDebugFlagFromArgv(argv);
  if (!debugValue) {
    return;
  }
  const existing = process.env.DEBUG?.trim();
  process.env.DEBUG = existing ? `${existing},${debugValue}` : debugValue;
}

function readDebugFlagFromArgv(argv: readonly string[]): string | null {
  for (let index = 0; index < argv.length; index += 1) {
    const entry = argv[index]?.trim();
    if (!entry) {
      continue;
    }
    if (entry === '--debug') {
      const next = argv[index + 1]?.trim();
      if (next && !next.startsWith('-')) {
        return next;
      }
      return 'nearbytes';
    }
    if (entry.startsWith('--debug=')) {
      const value = entry.slice('--debug='.length).trim();
      return value || 'nearbytes';
    }
  }
  return null;
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
  if (!isDev || !APP_CONFIG.features.performance.appMetrics || state.diagnostics.metricsTimer) {
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
  await requestAppQuit(signal.toLowerCase(), exitCode);
}
