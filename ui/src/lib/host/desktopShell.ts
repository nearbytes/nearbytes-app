import {
  getDesktopBridge,
  type DesktopRemoteFile,
  type DesktopRuntimeLogsResponse,
  type DesktopUpdaterState,
  type NearbytesDesktopBridge,
  type PersistedUiState,
} from './desktopBridge.js';
import type { NearbytesThemeRegistry } from '../branding.js';

type LogoExportResult = {
  path?: string;
  pngPath?: string;
  icnsPath?: string;
  icoPath?: string;
} | null;

function resolveBridge(bridge?: NearbytesDesktopBridge | null): NearbytesDesktopBridge | null {
  return bridge ?? getDesktopBridge();
}

export function hasDesktopDirectoryPicker(bridge?: NearbytesDesktopBridge | null): boolean {
  return typeof resolveBridge(bridge)?.chooseDirectory === 'function';
}

export async function chooseDesktopDirectoryPath(
  initialPath = '',
  bridge?: NearbytesDesktopBridge | null
): Promise<string | null> {
  const resolved = resolveBridge(bridge);
  if (!resolved || typeof resolved.chooseDirectory !== 'function') {
    return null;
  }
  return resolved.chooseDirectory(initialPath);
}

export function hasDesktopRuntimeLogsBridge(bridge?: NearbytesDesktopBridge | null): boolean {
  return typeof resolveBridge(bridge)?.readRuntimeLogs === 'function';
}

export async function readDesktopRuntimeLogs(
  bridge?: NearbytesDesktopBridge | null
): Promise<DesktopRuntimeLogsResponse | null> {
  const resolved = resolveBridge(bridge);
  if (!resolved || typeof resolved.readRuntimeLogs !== 'function') {
    return null;
  }
  return resolved.readRuntimeLogs();
}

export async function tryRevealPathInFileManager(
  targetPath: string,
  bridge?: NearbytesDesktopBridge | null
): Promise<boolean> {
  const resolved = resolveBridge(bridge);
  if (!resolved || typeof resolved.revealPathInFileManager !== 'function') {
    return false;
  }
  await resolved.revealPathInFileManager(targetPath);
  return true;
}

export function canWipeStoredConfig(bridge?: NearbytesDesktopBridge | null): boolean {
  return typeof resolveBridge(bridge)?.wipeStoredConfig === 'function';
}

export async function wipeStoredConfig(
  options?: { deleteLocalData?: boolean },
  bridge?: NearbytesDesktopBridge | null
): Promise<void> {
  const resolved = resolveBridge(bridge);
  if (!resolved || typeof resolved.wipeStoredConfig !== 'function') {
    throw new Error('Desktop reset controls are unavailable in this build.');
  }
  await resolved.wipeStoredConfig(options);
}

export async function fetchDesktopRemoteFile(
  url: string,
  bridge?: NearbytesDesktopBridge | null
): Promise<DesktopRemoteFile | null> {
  const resolved = resolveBridge(bridge);
  if (!resolved || typeof resolved.fetchRemoteFile !== 'function') {
    return null;
  }
  return resolved.fetchRemoteFile(url);
}

export async function readDesktopClipboardImage(
  bridge?: NearbytesDesktopBridge | null
): Promise<DesktopRemoteFile | null> {
  const resolved = resolveBridge(bridge);
  if (!resolved || typeof resolved.readClipboardImage !== 'function') {
    return null;
  }
  return resolved.readClipboardImage();
}

export async function getDesktopClipboardImageStatus(
  bridge?: NearbytesDesktopBridge | null
): Promise<{ hasImage: boolean } | null> {
  const resolved = resolveBridge(bridge);
  if (!resolved || typeof resolved.getClipboardImageStatus !== 'function') {
    return null;
  }
  return resolved.getClipboardImageStatus();
}

export async function saveDesktopThemeRegistry(
  registry: NearbytesThemeRegistry,
  bridge?: NearbytesDesktopBridge | null
): Promise<{ path?: string } | null> {
  const resolved = resolveBridge(bridge);
  if (!resolved || typeof resolved.saveThemeRegistry !== 'function') {
    throw new Error('Desktop theme registry save is unavailable.');
  }
  return resolved.saveThemeRegistry(registry);
}

export async function exportDesktopLogoPng(
  dataUrl: string,
  bridge?: NearbytesDesktopBridge | null
): Promise<LogoExportResult> {
  const resolved = resolveBridge(bridge);
  if (!resolved || typeof resolved.exportLogoPng !== 'function') {
    throw new Error('Desktop logo export is unavailable.');
  }
  return resolved.exportLogoPng(dataUrl);
}

export async function readDesktopUpdaterState(
  bridge?: NearbytesDesktopBridge | null
): Promise<DesktopUpdaterState | null> {
  const resolved = resolveBridge(bridge);
  if (!resolved || typeof resolved.getUpdaterState !== 'function') {
    return null;
  }
  return resolved.getUpdaterState();
}

export function subscribeDesktopUpdaterState(
  listener: (state: DesktopUpdaterState) => void,
  bridge?: NearbytesDesktopBridge | null
): (() => void) | null {
  const resolved = resolveBridge(bridge);
  if (!resolved || typeof resolved.onUpdaterState !== 'function') {
    return null;
  }
  const unsubscribe = resolved.onUpdaterState(listener);
  return typeof unsubscribe === 'function' ? unsubscribe : null;
}

export async function requestDesktopUpdateInstall(
  bridge?: NearbytesDesktopBridge | null
): Promise<boolean> {
  const resolved = resolveBridge(bridge);
  if (!resolved || typeof resolved.installDownloadedUpdate !== 'function') {
    return false;
  }
  return resolved.installDownloadedUpdate();
}

export async function requestDesktopUpdateReleasePage(
  bridge?: NearbytesDesktopBridge | null
): Promise<boolean> {
  const resolved = resolveBridge(bridge);
  if (!resolved || typeof resolved.openUpdateReleasePage !== 'function') {
    return false;
  }
  return resolved.openUpdateReleasePage();
}

export function subscribeDesktopDeepLinks(
  listener: (url: string) => void,
  bridge?: NearbytesDesktopBridge | null
): (() => void) | null {
  const resolved = resolveBridge(bridge);
  if (!resolved || typeof resolved.onDeepLink !== 'function') {
    return null;
  }
  const unsubscribe = resolved.onDeepLink(listener);
  return typeof unsubscribe === 'function' ? unsubscribe : null;
}

export async function connectDesktopDeepLinks(
  bridge?: NearbytesDesktopBridge | null
): Promise<string[]> {
  const resolved = resolveBridge(bridge);
  if (!resolved || typeof resolved.connectDeepLinks !== 'function') {
    return [];
  }
  return resolved.connectDeepLinks();
}

export async function loadDesktopUiState(
  bridge?: NearbytesDesktopBridge | null
): Promise<PersistedUiState | null> {
  const resolved = resolveBridge(bridge);
  if (!resolved || typeof resolved.loadUiState !== 'function') {
    return null;
  }
  return resolved.loadUiState();
}

export async function saveDesktopUiState(
  state: PersistedUiState,
  bridge?: NearbytesDesktopBridge | null
): Promise<boolean> {
  const resolved = resolveBridge(bridge);
  if (!resolved || typeof resolved.saveUiState !== 'function') {
    return false;
  }
  await resolved.saveUiState(state);
  return true;
}