import { spawn } from 'child_process';
import { constants, createWriteStream } from 'fs';
import { access, chmod, mkdir, readdir, rm, writeFile } from 'fs/promises';
import { app, shell, type BrowserWindow } from 'electron';
import path from 'path';
import {
  compareVersions,
  parseGithubLatestRelease,
  selectReleaseAsset,
  type GithubLatestRelease,
  type GithubReleaseAsset,
} from '../src/desktop/customUpdater.js';

export type DesktopUpdaterPhase = 'idle' | 'checking' | 'downloading' | 'ready' | 'installing' | 'error';

export interface DesktopUpdaterState {
  readonly phase: DesktopUpdaterPhase;
  readonly version: string;
  readonly message: string;
  readonly detail: string;
  readonly progressPercent: number | null;
  readonly transferredBytes: number;
  readonly totalBytes: number;
  readonly bytesPerSecond: number;
  readonly canInstall: boolean;
  readonly releaseUrl: string;
  readonly assetName: string;
}

type StagedUpdate =
  | {
      readonly kind: 'mac-app';
      readonly version: string;
      readonly releaseUrl: string;
      readonly assetName: string;
      readonly stageDir: string;
      readonly helperScriptPath: string;
      readonly targetPath: string;
      readonly stagedPath: string;
    }
  | {
      readonly kind: 'windows-installer';
      readonly version: string;
      readonly releaseUrl: string;
      readonly assetName: string;
      readonly stageDir: string;
      readonly helperScriptPath: string;
      readonly targetPath: string;
      readonly stagedPath: string;
    }
  | {
      readonly kind: 'linux-appimage';
      readonly version: string;
      readonly releaseUrl: string;
      readonly assetName: string;
      readonly stageDir: string;
      readonly helperScriptPath: string;
      readonly targetPath: string;
      readonly stagedPath: string;
    };

const DESKTOP_UPDATER_EVENT = 'nearbytes-desktop:update-state';
const DEFAULT_RELEASE_OWNER = 'nearbytes';
const DEFAULT_RELEASE_REPO = 'nearbytes-app';
const UPDATE_RECHECK_INTERVAL_MS = 60 * 60 * 1000;
const UPDATE_FOCUS_RECHECK_DEBOUNCE_MS = UPDATE_RECHECK_INTERVAL_MS;

const trackedWindows = new Set<BrowserWindow>();

let currentState: DesktopUpdaterState = createIdleState();
let checkStarted = false;
let checkInFlight = false;
let quitListenerRegistered = false;
let stagedUpdate: StagedUpdate | null = null;
let relaunchAfterInstall = false;
let installerLaunchStarted = false;
let recheckInterval: ReturnType<typeof setInterval> | null = null;
let lastCheckAt = 0;

function createIdleState(): DesktopUpdaterState {
  return {
    phase: 'idle',
    version: '',
    message: '',
    detail: '',
    progressPercent: null,
    transferredBytes: 0,
    totalBytes: 0,
    bytesPerSecond: 0,
    canInstall: false,
    releaseUrl: '',
    assetName: '',
  };
}

function cloneState(state: DesktopUpdaterState): DesktopUpdaterState {
  return {
    ...state,
  };
}

function emitState(nextState: DesktopUpdaterState): void {
  currentState = cloneState(nextState);
  for (const window of trackedWindows) {
    if (!window.isDestroyed()) {
      window.webContents.send(DESKTOP_UPDATER_EVENT, currentState);
    }
  }
}

function currentReleaseOwner(): string {
  return process.env.NEARBYTES_RELEASE_OWNER?.trim() || DEFAULT_RELEASE_OWNER;
}

function currentReleaseRepo(): string {
  return process.env.NEARBYTES_RELEASE_REPO?.trim() || DEFAULT_RELEASE_REPO;
}

function latestReleaseApiUrl(): string {
  return `https://api.github.com/repos/${currentReleaseOwner()}/${currentReleaseRepo()}/releases/latest`;
}

function latestReleasePageUrl(): string {
  return `https://github.com/${currentReleaseOwner()}/${currentReleaseRepo()}/releases/latest`;
}

function runCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'ignore',
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${path.basename(command)} exited with code ${code ?? 'unknown'}`));
    });
  });
}

async function canReplaceTarget(targetPath: string): Promise<boolean> {
  const candidateDirectory = path.extname(targetPath) === '' || targetPath.endsWith('.app') ? path.dirname(targetPath) : path.dirname(targetPath);
  try {
    await access(candidateDirectory, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveCurrentMacAppPath(): string | null {
  if (process.platform !== 'darwin') {
    return null;
  }
  const executablePath = app.getPath('exe');
  const marker = `${path.sep}Contents${path.sep}MacOS${path.sep}`;
  const markerIndex = executablePath.lastIndexOf(marker);
  if (markerIndex <= 0) {
    return null;
  }
  const bundlePath = executablePath.slice(0, markerIndex);
  return bundlePath.endsWith('.app') ? bundlePath : null;
}

function resolveCurrentWindowsExecutablePath(): string | null {
  if (process.platform !== 'win32') {
    return null;
  }
  return app.getPath('exe');
}

function resolveCurrentLinuxAppImagePath(): string | null {
  if (process.platform !== 'linux') {
    return null;
  }
  const appImagePath = process.env.APPIMAGE?.trim();
  if (appImagePath && appImagePath.length > 0) {
    return appImagePath;
  }
  const executablePath = app.getPath('exe');
  return executablePath.endsWith('.AppImage') ? executablePath : null;
}

async function fetchLatestRelease(): Promise<GithubLatestRelease> {
  const response = await fetch(latestReleaseApiUrl(), {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Nearbytes Desktop Updater',
    },
    redirect: 'follow',
  });
  if (!response.ok) {
    throw new Error(`GitHub release check failed (${response.status})`);
  }
  const payload = await response.json();
  return parseGithubLatestRelease(payload);
}

async function downloadReleaseAsset(
  release: GithubLatestRelease,
  asset: GithubReleaseAsset,
  destinationPath: string
): Promise<void> {
  const response = await fetch(asset.browserDownloadUrl, {
    headers: {
      'User-Agent': 'Nearbytes Desktop Updater',
    },
    redirect: 'follow',
  });
  if (!response.ok || !response.body) {
    throw new Error(`Release download failed (${response.status})`);
  }

  const reader = response.body.getReader();
  const writer = createWriteStream(destinationPath);
  let transferredBytes = 0;
  let progressBytes = 0;
  let progressWindowStartedAt = Date.now();

  emitState({
    phase: 'downloading',
    version: release.version,
    message: `Downloading Nearbytes ${release.version}`,
    detail: `Fetching ${asset.name}.`,
    progressPercent: asset.size > 0 ? 0 : null,
    transferredBytes: 0,
    totalBytes: asset.size,
    bytesPerSecond: 0,
    canInstall: false,
    releaseUrl: release.htmlUrl,
    assetName: asset.name,
  });

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value) {
        continue;
      }
      const chunk = Buffer.from(value);
      transferredBytes += chunk.length;
      progressBytes += chunk.length;
      if (!writer.write(chunk)) {
        await new Promise<void>((resolve) => writer.once('drain', resolve));
      }

      const now = Date.now();
      const elapsedMs = Math.max(now - progressWindowStartedAt, 1);
      const bytesPerSecond = Math.round((progressBytes * 1000) / elapsedMs);

      emitState({
        phase: 'downloading',
        version: release.version,
        message: `Downloading Nearbytes ${release.version}`,
        detail: `Fetching ${asset.name}.`,
        progressPercent: asset.size > 0 ? Math.min(100, (transferredBytes / asset.size) * 100) : null,
        transferredBytes,
        totalBytes: asset.size,
        bytesPerSecond,
        canInstall: false,
        releaseUrl: release.htmlUrl,
        assetName: asset.name,
      });

      if (elapsedMs >= 1000) {
        progressWindowStartedAt = now;
        progressBytes = 0;
      }
    }
  } finally {
    await new Promise<void>((resolve, reject) => {
      writer.once('error', reject);
      writer.end(() => resolve());
    });
  }
}

async function findExtractedApp(directoryPath: string): Promise<string> {
  const entries = await readdir(directoryPath, {
    withFileTypes: true,
  });
  for (const entry of entries) {
    const candidatePath = path.join(directoryPath, entry.name);
    if (entry.isDirectory() && entry.name.endsWith('.app')) {
      return candidatePath;
    }
    if (entry.isDirectory()) {
      try {
        return await findExtractedApp(candidatePath);
      } catch {
        // Keep scanning siblings.
      }
    }
  }
  throw new Error('Downloaded macOS release did not contain an .app bundle.');
}

async function clearMacQuarantine(targetPath: string): Promise<void> {
  await runCommand('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', targetPath]).catch(() => {
    // Downloads may already be clean; quarantine removal is best effort.
  });
}

function macInstallerScript(): string {
  return `#!/bin/sh
set -eu

PID="$1"
TARGET_APP="$2"
STAGED_APP="$3"
RELAUNCH="$4"
STAGE_DIR="$5"
LOG_PATH="$6"

log() {
  printf '%s %s\\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$1" >> "$LOG_PATH"
}

TARGET_DIR="$(dirname "$TARGET_APP")"
TMP_APP="$TARGET_DIR/.Nearbytes.update.$$"
OLD_APP="$TARGET_DIR/.Nearbytes.old.$$"

log "waiting for process $PID"
while kill -0 "$PID" 2>/dev/null; do
  sleep 0.25
done

log "copying staged app"
rm -rf "$TMP_APP" "$OLD_APP"
/usr/bin/ditto "$STAGED_APP" "$TMP_APP"
/usr/bin/xattr -dr com.apple.quarantine "$TMP_APP" >/dev/null 2>&1 || true

if [ -e "$TARGET_APP" ]; then
  mv "$TARGET_APP" "$OLD_APP"
fi
mv "$TMP_APP" "$TARGET_APP"
/usr/bin/xattr -dr com.apple.quarantine "$TARGET_APP" >/dev/null 2>&1 || true
rm -rf "$OLD_APP" "$STAGE_DIR"

if [ "$RELAUNCH" = "1" ]; then
  log "relaunching installed app"
  open "$TARGET_APP"
fi
`;
}

function linuxInstallerScript(): string {
  return `#!/bin/sh
set -eu

PID="$1"
TARGET_APPIMAGE="$2"
STAGED_APPIMAGE="$3"
RELAUNCH="$4"
STAGE_DIR="$5"
LOG_PATH="$6"

log() {
  printf '%s %s\\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$1" >> "$LOG_PATH"
}

TMP_APPIMAGE="$TARGET_APPIMAGE.update.$$"

log "waiting for process $PID"
while kill -0 "$PID" 2>/dev/null; do
  sleep 0.25
done

log "replacing appimage"
cp "$STAGED_APPIMAGE" "$TMP_APPIMAGE"
chmod 755 "$TMP_APPIMAGE"
mv "$TMP_APPIMAGE" "$TARGET_APPIMAGE"
chmod 755 "$TARGET_APPIMAGE"
rm -rf "$STAGE_DIR"

if [ "$RELAUNCH" = "1" ]; then
  log "relaunching installed appimage"
  "$TARGET_APPIMAGE" >/dev/null 2>&1 &
fi
`;
}

function windowsInstallerScript(): string {
  return `@echo off
setlocal

set "PID=%~1"
set "INSTALLER=%~2"
set "TARGET_EXE=%~3"
set "RELAUNCH=%~4"
set "STAGE_DIR=%~5"
set "LOG_PATH=%~6"

:wait_for_exit
tasklist /FI "PID eq %PID%" 2>NUL | find "%PID%" >NUL
if not errorlevel 1 (
  ping -n 2 127.0.0.1 >NUL
  goto wait_for_exit
)

echo Running installer>>"%LOG_PATH%"
start "" /wait "%INSTALLER%" /S

if "%RELAUNCH%"=="1" (
  start "" "%TARGET_EXE%"
)
`;
}

async function writeInstallerScript(stageDir: string, filename: string, contents: string): Promise<string> {
  const scriptPath = path.join(stageDir, filename);
  await writeFile(scriptPath, contents, 'utf8');
  if (process.platform !== 'win32') {
    await chmod(scriptPath, 0o755);
  }
  return scriptPath;
}

function updateReadyState(version: string, releaseUrl: string, assetName: string, totalBytes: number, detail: string, canInstall: boolean): void {
  emitState({
    phase: 'ready',
    version,
    message: `Nearbytes ${version} is ready to install`,
    detail,
    progressPercent: totalBytes > 0 ? 100 : null,
    transferredBytes: totalBytes,
    totalBytes,
    bytesPerSecond: 0,
    canInstall,
    releaseUrl,
    assetName,
  });
}

async function stageMacRelease(release: GithubLatestRelease, asset: GithubReleaseAsset): Promise<boolean> {
  const targetAppPath = resolveCurrentMacAppPath();
  if (!targetAppPath || !(await canReplaceTarget(targetAppPath))) {
    return false;
  }

  const stageDir = path.join(app.getPath('userData'), 'updates', release.version);
  await rm(stageDir, { recursive: true, force: true });
  await mkdir(stageDir, { recursive: true });

  const archivePath = path.join(stageDir, asset.name);
  await downloadReleaseAsset(release, asset, archivePath);

  const extractedDir = path.join(stageDir, 'extracted');
  await mkdir(extractedDir, { recursive: true });
  await runCommand('/usr/bin/ditto', ['-xk', archivePath, extractedDir]);

  const extractedAppPath = await findExtractedApp(extractedDir);
  await clearMacQuarantine(extractedAppPath);
  const helperScriptPath = await writeInstallerScript(stageDir, 'install-update.sh', macInstallerScript());

  stagedUpdate = {
    kind: 'mac-app',
    version: release.version,
    releaseUrl: release.htmlUrl,
    assetName: asset.name,
    stageDir,
    helperScriptPath,
    targetPath: targetAppPath,
    stagedPath: extractedAppPath,
  };
  relaunchAfterInstall = false;
  installerLaunchStarted = false;
  updateReadyState(
    release.version,
    release.htmlUrl,
    asset.name,
    asset.size,
    'Restart Nearbytes to replace the app with the downloaded build.',
    true
  );
  return true;
}

async function stageWindowsRelease(release: GithubLatestRelease, asset: GithubReleaseAsset): Promise<boolean> {
  const targetExecutablePath = resolveCurrentWindowsExecutablePath();
  if (!targetExecutablePath) {
    return false;
  }

  const stageDir = path.join(app.getPath('userData'), 'updates', release.version);
  await rm(stageDir, { recursive: true, force: true });
  await mkdir(stageDir, { recursive: true });

  const installerPath = path.join(stageDir, asset.name);
  await downloadReleaseAsset(release, asset, installerPath);
  const helperScriptPath = await writeInstallerScript(stageDir, 'install-update.cmd', windowsInstallerScript());

  stagedUpdate = {
    kind: 'windows-installer',
    version: release.version,
    releaseUrl: release.htmlUrl,
    assetName: asset.name,
    stageDir,
    helperScriptPath,
    targetPath: targetExecutablePath,
    stagedPath: installerPath,
  };
  relaunchAfterInstall = false;
  installerLaunchStarted = false;
  updateReadyState(
    release.version,
    release.htmlUrl,
    asset.name,
    asset.size,
    'Restart Nearbytes to run the downloaded installer.',
    true
  );
  return true;
}

async function stageLinuxRelease(release: GithubLatestRelease, asset: GithubReleaseAsset): Promise<boolean> {
  const targetAppImagePath = resolveCurrentLinuxAppImagePath();
  if (!targetAppImagePath || !(await canReplaceTarget(targetAppImagePath))) {
    return false;
  }

  const stageDir = path.join(app.getPath('userData'), 'updates', release.version);
  await rm(stageDir, { recursive: true, force: true });
  await mkdir(stageDir, { recursive: true });

  const appImagePath = path.join(stageDir, asset.name);
  await downloadReleaseAsset(release, asset, appImagePath);
  await chmod(appImagePath, 0o755);
  const helperScriptPath = await writeInstallerScript(stageDir, 'install-update.sh', linuxInstallerScript());

  stagedUpdate = {
    kind: 'linux-appimage',
    version: release.version,
    releaseUrl: release.htmlUrl,
    assetName: asset.name,
    stageDir,
    helperScriptPath,
    targetPath: targetAppImagePath,
    stagedPath: appImagePath,
  };
  relaunchAfterInstall = false;
  installerLaunchStarted = false;
  updateReadyState(
    release.version,
    release.htmlUrl,
    asset.name,
    asset.size,
    'Restart Nearbytes to replace the current AppImage.',
    true
  );
  return true;
}

async function stageReleaseForCurrentPlatform(release: GithubLatestRelease): Promise<void> {
  const asset = selectReleaseAsset(release, process.platform, process.arch);
  if (!asset) {
    emitState({
      phase: 'ready',
      version: release.version,
      message: `Nearbytes ${release.version} is available`,
      detail: 'Open the release page to install this update.',
      progressPercent: null,
      transferredBytes: 0,
      totalBytes: 0,
      bytesPerSecond: 0,
      canInstall: false,
      releaseUrl: release.htmlUrl,
      assetName: '',
    });
    return;
  }

  const staged =
    process.platform === 'darwin'
      ? await stageMacRelease(release, asset)
      : process.platform === 'win32'
        ? await stageWindowsRelease(release, asset)
        : process.platform === 'linux'
          ? await stageLinuxRelease(release, asset)
          : false;

  if (!staged) {
    emitState({
      phase: 'ready',
      version: release.version,
      message: `Nearbytes ${release.version} is available`,
      detail: 'Open the release page to install this update.',
      progressPercent: null,
      transferredBytes: 0,
      totalBytes: 0,
      bytesPerSecond: 0,
      canInstall: false,
      releaseUrl: release.htmlUrl,
      assetName: asset.name,
    });
  }
}

async function checkForUpdates(): Promise<void> {
  if (checkInFlight) {
    return;
  }
  if (stagedUpdate || currentState.phase === 'downloading' || currentState.phase === 'installing') {
    return;
  }

  checkInFlight = true;
  lastCheckAt = Date.now();
  emitState({
    phase: 'checking',
    version: '',
    message: 'Checking for Nearbytes updates',
    detail: 'Looking for a newer GitHub release.',
    progressPercent: null,
    transferredBytes: 0,
    totalBytes: 0,
    bytesPerSecond: 0,
    canInstall: false,
    releaseUrl: latestReleasePageUrl(),
    assetName: '',
  });

  try {
    const release = await fetchLatestRelease();
    if (compareVersions(release.version, app.getVersion()) <= 0) {
      emitState(createIdleState());
      return;
    }

    await stageReleaseForCurrentPlatform(release);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Nearbytes update check failed: ${message}`);
    emitState({
      phase: 'error',
      version: '',
      message: 'Nearbytes update check failed',
      detail: message,
      progressPercent: null,
      transferredBytes: 0,
      totalBytes: 0,
      bytesPerSecond: 0,
      canInstall: false,
      releaseUrl: latestReleasePageUrl(),
      assetName: '',
    });
  } finally {
    checkInFlight = false;
  }
}

function maybeCheckForUpdates(reason: 'startup' | 'focus' | 'interval'): void {
  if (checkInFlight) {
    return;
  }
  if (reason !== 'startup' && Date.now() - lastCheckAt < UPDATE_FOCUS_RECHECK_DEBOUNCE_MS) {
    return;
  }
  void checkForUpdates();
}

function spawnInstallerHelper(update: StagedUpdate, relaunch: boolean): void {
  const logPath = path.join(update.stageDir, 'install.log');
  const launcher =
    update.kind === 'windows-installer'
      ? 'cmd.exe'
      : process.platform === 'win32'
        ? 'cmd.exe'
        : '/bin/sh';
  const args =
    update.kind === 'windows-installer'
      ? ['/c', update.helperScriptPath, String(process.pid), update.stagedPath, update.targetPath, relaunch ? '1' : '0', update.stageDir, logPath]
      : [update.helperScriptPath, String(process.pid), update.targetPath, update.stagedPath, relaunch ? '1' : '0', update.stageDir, logPath];

  const child = spawn(launcher, args, {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

function handleBeforeQuit(): void {
  if (!stagedUpdate || installerLaunchStarted) {
    return;
  }
  installerLaunchStarted = true;
  try {
    spawnInstallerHelper(stagedUpdate, relaunchAfterInstall);
  } catch (error) {
    installerLaunchStarted = false;
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Nearbytes update install failed to launch: ${message}`);
  }
}

export function setupAutoUpdater(window: BrowserWindow, enabled: boolean): void {
  if (!enabled) {
    return;
  }

  trackedWindows.add(window);
  window.on('closed', () => {
    trackedWindows.delete(window);
  });
  window.on('focus', () => {
    maybeCheckForUpdates('focus');
  });
  window.webContents.once('did-finish-load', () => {
    if (!window.isDestroyed()) {
      window.webContents.send(DESKTOP_UPDATER_EVENT, currentState);
    }
  });

  if (!quitListenerRegistered) {
    quitListenerRegistered = true;
    app.on('before-quit', handleBeforeQuit);
  }

  if (!checkStarted) {
    checkStarted = true;
    if (!recheckInterval) {
      recheckInterval = setInterval(() => {
        maybeCheckForUpdates('interval');
      }, UPDATE_RECHECK_INTERVAL_MS);
    }
    maybeCheckForUpdates('startup');
  }
}

export function getUpdaterState(): DesktopUpdaterState {
  return cloneState(currentState);
}

export async function installDownloadedUpdate(): Promise<boolean> {
  if (stagedUpdate) {
    relaunchAfterInstall = true;
    emitState({
      ...currentState,
      phase: 'installing',
      message: `Restarting Nearbytes to install ${stagedUpdate.version}`,
      detail: 'Nearbytes will relaunch after applying the downloaded update.',
      canInstall: false,
    });
    app.quit();
    return true;
  }

  if (currentState.releaseUrl) {
    await shell.openExternal(currentState.releaseUrl);
    return false;
  }
  return false;
}

export async function openUpdateReleasePage(): Promise<boolean> {
  const targetUrl = currentState.releaseUrl || latestReleasePageUrl();
  await shell.openExternal(targetUrl);
  return true;
}

export { DESKTOP_UPDATER_EVENT };
