import type { NearbytesThemeRegistry } from '../branding.js';

export interface DesktopRuntimeConfig {
  apiBaseUrl: string;
  desktopToken: string;
  isDesktop: boolean;
  runtimeTokenHeader?: string;
  runtimeHostKind?: 'desktop' | 'phone' | 'web';
  runtimeOwner?: 'embedded' | 'desktop-proxy' | 'remote-runtime';
}

export interface DesktopRemoteFile {
  filename: string;
  mimeType: string;
  bytesBase64: string;
}

export interface PersistedUiState {
  volumeMounts?: unknown;
  activeMountId?: unknown;
  configuredIdentities?: unknown;
  activeChatIdentityId?: unknown;
  volumeChatIdentityAssignments?: unknown;
  uiMachine?: unknown;
  sourceDiscovery?: unknown;
  theme?: unknown;
  savedAt?: unknown;
}

export interface DesktopUpdaterState {
  phase: 'idle' | 'checking' | 'downloading' | 'ready' | 'installing' | 'error';
  version: string;
  message: string;
  detail: string;
  progressPercent: number | null;
  transferredBytes: number;
  totalBytes: number;
  bytesPerSecond: number;
  canInstall: boolean;
  releaseUrl: string;
  assetName: string;
}

export interface DesktopRuntimeLogEntry {
  id: string;
  label: string;
  path: string;
  exists: boolean;
  size: number;
  updatedAt: number | null;
  content: string;
}

export interface DesktopRuntimeLogsResponse {
  generatedAt: number;
  entries: DesktopRuntimeLogEntry[];
}

export interface NearbytesDesktopBridge {
  getRuntimeConfig?: () => Promise<DesktopRuntimeConfig>;
  getApiBaseUrl?: () => Promise<string>;
  getDesktopToken?: () => Promise<string>;
  chooseDirectory?: (initialPath?: string) => Promise<string | null>;
  revealPathInFileManager?: (targetPath: string) => Promise<unknown>;
  readRuntimeLogs?: () => Promise<DesktopRuntimeLogsResponse>;
  isDesktop?: (() => boolean) | boolean;
  connectDeepLinks?: () => Promise<string[]>;
  exportLogoPng?: (dataUrl: string) => Promise<{
    path?: string;
    pngPath?: string;
    icnsPath?: string;
    icoPath?: string;
  } | null>;
  fetchRemoteFile?: (url: string) => Promise<DesktopRemoteFile>;
  getClipboardImageStatus?: () => Promise<{ hasImage: boolean }>;
  readClipboardImage?: () => Promise<DesktopRemoteFile | null>;
  loadUiState?: () => Promise<PersistedUiState>;
  wipeStoredConfig?: (options?: { deleteLocalData?: boolean }) => Promise<{ relaunching: true }>;
  getUpdaterState?: () => Promise<DesktopUpdaterState | null>;
  installDownloadedUpdate?: () => Promise<boolean>;
  openUpdateReleasePage?: () => Promise<boolean>;
  onDeepLink?: (listener: (url: string) => void) => (() => void) | void;
  onUpdaterState?: (listener: (state: DesktopUpdaterState) => void) => (() => void) | void;
  saveUiState?: (state: PersistedUiState) => Promise<unknown>;
  saveThemeRegistry?: (registry: NearbytesThemeRegistry) => Promise<{ path?: string } | null>;
}

type NearbytesWindow = Window & typeof globalThis & {
  nearbytesDesktop?: NearbytesDesktopBridge;
};

export function getDesktopBridge(targetWindow?: NearbytesWindow | null): NearbytesDesktopBridge | null {
  const resolvedWindow = targetWindow ?? (typeof window === 'undefined' ? null : (window as NearbytesWindow));
  return resolvedWindow?.nearbytesDesktop ?? null;
}