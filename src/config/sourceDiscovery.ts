import { promises as fs, type Dirent, type Stats } from 'fs';
import os from 'os';
import path from 'path';
import type { RootProvider, SourceConfigEntry } from './roots.js';

export interface DiscoveredNearbytesSource {
  readonly provider: RootProvider;
  readonly path: string;
  readonly markerFile: string;
  readonly autoUpdate: boolean;
  readonly sourceType: 'marker' | 'layout' | 'suggested';
}

export interface NearbytesScanRoot {
  readonly provider: RootProvider;
  readonly path: string;
}

export interface NearbytesRootInspection {
  readonly path: string;
  readonly markerFile: string;
  readonly hasMarker: boolean;
  readonly hasBlocks: boolean;
  readonly hasChannels: boolean;
  readonly volumeIds: string[];
  readonly sourceType: 'marker' | 'layout';
}

export interface DetectedNearbytesSource extends NearbytesRootInspection {
  readonly provider: RootProvider;
  readonly autoUpdate: boolean;
}

export interface MarkerEnsureResult {
  readonly rootId: string;
  readonly path: string;
  readonly markerFile: string;
  readonly created: boolean;
  readonly ok: boolean;
  readonly error?: string;
}

interface ScanCandidate {
  readonly provider: RootProvider;
  readonly path: string;
}

interface QueueEntry {
  readonly path: string;
  readonly depth: number;
}

const DEFAULT_MAX_DEPTH = 4;
const DEFAULT_MAX_DIRECTORIES = 4000;
const CHANNEL_DIRECTORY_REGEX = /^[a-f0-9]{64,200}$/i;
export const NEARBYTES_MARKER_FILE = 'Nearbytes.html';
export const NEARBYTES_LEGACY_MARKER_FILE = '.nearbytes';
export const NEARBYTES_MARKER_FILES = [NEARBYTES_MARKER_FILE, NEARBYTES_LEGACY_MARKER_FILE] as const;
export const NEARBYTES_HOME_URL = 'https://anymatix.github.io/nearbytes/';
const DEFAULT_NEARBYTES_DIRECTORY = 'nearbytes';
const SKIP_DIRECTORY_NAMES = new Set([
  '.git',
  '.idea',
  '.vscode',
  '.DS_Store',
  'node_modules',
  '.Trash',
  '.cache',
]);

export async function discoverNearbytesScanRoots(options?: {
  readonly includeDefaultRoots?: boolean;
}): Promise<NearbytesScanRoot[]> {
  const candidates = await buildScanCandidates(options);
  return candidates.sort((left, right) => {
    if (left.provider !== right.provider) {
      return left.provider.localeCompare(right.provider);
    }
    return left.path.localeCompare(right.path);
  });
}

/**
 * Discovers actual Nearbytes roots by scanning synced folders for markers or storage layout.
 */
export async function discoverNearbytesRoots(options?: {
  readonly maxDepth?: number;
  readonly maxDirectories?: number;
  readonly includeDefaultRoots?: boolean;
}): Promise<DetectedNearbytesSource[]> {
  const maxDepth = clampInt(options?.maxDepth, DEFAULT_MAX_DEPTH, 1, 8);
  const maxDirectories = clampInt(options?.maxDirectories, DEFAULT_MAX_DIRECTORIES, 100, 50000);
  const candidates = await buildScanCandidates(options);
  const seenRoots = new Set<string>();
  const discovered: DetectedNearbytesSource[] = [];

  for (const candidate of candidates) {
    const roots = await scanForNearbytesRoots(candidate.path, maxDepth, maxDirectories);
    for (const root of roots) {
      const canonicalDir = await resolveCanonicalDirectoryPath(root.path);
      if (!canonicalDir) {
        continue;
      }
      const canonicalKey = toCanonicalPathKey(canonicalDir);
      if (seenRoots.has(canonicalKey)) {
        continue;
      }
      seenRoots.add(canonicalKey);
      discovered.push({
        ...root,
        path: canonicalDir,
        provider: candidate.provider,
        autoUpdate: true,
      });
    }
  }

  discovered.sort(compareDiscoveredSource);
  return discovered;
}

/**
 * Discovers local Nearbytes roots and suggested provider folders for manual adoption.
 */
export async function discoverNearbytesSources(options?: {
  readonly maxDepth?: number;
  readonly maxDirectories?: number;
  readonly includeDefaultRoots?: boolean;
}): Promise<DiscoveredNearbytesSource[]> {
  const candidates = await buildScanCandidates(options);
  const discoveredRoots = await discoverNearbytesRoots(options);
  const seenRoots = new Set<string>();
  const discovered: DiscoveredNearbytesSource[] = discoveredRoots.map((source) => {
    seenRoots.add(toCanonicalPathKey(source.path));
    return source;
  });

  for (const candidate of candidates) {
    if (!isSyncedProvider(candidate.provider)) {
      continue;
    }
    const suggestedPath = buildSuggestedNearbytesPath(candidate.path);
    const canonicalSuggestedPath = await resolveCanonicalDirectoryPath(suggestedPath);
    const resolvedSuggestedPath = canonicalSuggestedPath ?? path.resolve(suggestedPath);
    const suggestionKey = toCanonicalPathKey(resolvedSuggestedPath);
    if (seenRoots.has(suggestionKey)) {
      continue;
    }
    seenRoots.add(suggestionKey);
    discovered.push({
      provider: candidate.provider,
      path: resolvedSuggestedPath,
      markerFile: path.join(resolvedSuggestedPath, NEARBYTES_MARKER_FILE),
      autoUpdate: true,
      sourceType: 'suggested',
    });
  }

  discovered.sort(compareDiscoveredSource);
  return discovered;
}

/**
 * Ensures Nearbytes marker files exist for all configured roots.
 * Best-effort: returns per-root status and never throws.
 */
export async function ensureNearbytesMarkers(sources: readonly SourceConfigEntry[]): Promise<MarkerEnsureResult[]> {
  const results: MarkerEnsureResult[] = [];

  for (const source of sources) {
    const markerFile = path.join(source.path, NEARBYTES_MARKER_FILE);
    try {
      const created = await ensureNearbytesMarker(source.path);
      results.push({
        rootId: source.id,
        path: source.path,
        markerFile,
        created,
        ok: true,
      });
    } catch (error) {
      results.push({
        rootId: source.id,
        path: source.path,
        markerFile,
        created: false,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}

/**
 * Ensures `Nearbytes.html` exists in a root directory.
 * Returns true if created now, false if already present.
 */
export async function ensureNearbytesMarker(rootPath: string): Promise<boolean> {
  const markerPath = path.join(rootPath, NEARBYTES_MARKER_FILE);
  await fs.mkdir(rootPath, { recursive: true });

  if (await hasNamedMarkerFile(rootPath, NEARBYTES_MARKER_FILE)) {
    return false;
  }

  await fs.writeFile(markerPath, buildNearbytesMarkerHtml(), 'utf8');
  return true;
}

export async function inspectNearbytesRoot(rootPath: string): Promise<NearbytesRootInspection | null> {
  const resolvedRoot = path.resolve(rootPath);
  const stats = await safeStat(resolvedRoot);
  if (!stats?.isDirectory()) {
    return null;
  }

  const channelsPath = path.join(resolvedRoot, 'channels');
  const blocksPath = path.join(resolvedRoot, 'blocks');
  const markerFile = (await resolveMarkerFile(resolvedRoot)) ?? path.join(resolvedRoot, NEARBYTES_MARKER_FILE);
  const hasMarker = await hasMarkerFile(resolvedRoot);
  const hasChannels = await isDirectory(channelsPath);
  const hasBlocks = await isDirectory(blocksPath);
  if (!hasMarker && !hasChannels && !hasBlocks) {
    return null;
  }

  return {
    path: resolvedRoot,
    markerFile,
    hasMarker,
    hasBlocks,
    hasChannels,
    volumeIds: hasChannels ? await listVolumeIds(channelsPath) : [],
    sourceType: hasMarker ? 'marker' : 'layout',
  };
}

async function buildScanCandidates(options?: {
  readonly includeDefaultRoots?: boolean;
}): Promise<ScanCandidate[]> {
  const home = os.homedir();
  const candidates: ScanCandidate[] = [];
  const envPaths = parseScanPathsFromEnv(process.env.NEARBYTES_SOURCE_SCAN_DIRS);
  const includeDefaultRoots = options?.includeDefaultRoots ?? envPaths.length === 0;

  if (includeDefaultRoots) {
    candidates.push(
      { provider: 'dropbox', path: path.join(home, 'Dropbox') },
      { provider: 'mega', path: path.join(home, 'MEGA') },
      { provider: 'mega', path: path.join(home, 'Mega') },
      { provider: 'gdrive', path: path.join(home, 'Google Drive') },
      { provider: 'onedrive', path: path.join(home, 'OneDrive') },
      { provider: 'icloud', path: path.join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs') }
    );

    const cloudStorage = path.join(home, 'Library', 'CloudStorage');
    const cloudEntries = await safeReadDir(cloudStorage);
    for (const entry of cloudEntries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const provider = classifyNearbytesProviderName(entry.name);
      if (!provider) {
        continue;
      }
      candidates.push({
        provider,
        path: path.join(cloudStorage, entry.name),
      });
    }
  }

  for (const envPath of envPaths) {
    candidates.push({
      provider: 'local',
      path: envPath,
    });
  }

  const deduped = new Map<string, ScanCandidate>();
  for (const candidate of candidates) {
    const canonicalPath = await resolveCanonicalDirectoryPath(candidate.path);
    if (!canonicalPath) {
      continue;
    }
    const canonicalKey = toCanonicalPathKey(canonicalPath);
    if (deduped.has(canonicalKey)) {
      continue;
    }
    deduped.set(canonicalKey, {
      provider: candidate.provider,
      path: canonicalPath,
    });
  }

  return Array.from(deduped.values());
}

async function scanForNearbytesRoots(
  rootPath: string,
  maxDepth: number,
  maxDirectories: number
): Promise<NearbytesRootInspection[]> {
  const queue: QueueEntry[] = [{ path: rootPath, depth: 0 }];
  const visited = new Set<string>();
  const discovered: NearbytesRootInspection[] = [];
  let scanned = 0;

  while (queue.length > 0) {
    if (scanned >= maxDirectories) {
      break;
    }

    const current = queue.shift();
    if (!current) {
      break;
    }

    const normalized = path.resolve(current.path);
    if (visited.has(normalized)) {
      continue;
    }
    visited.add(normalized);
    scanned += 1;

    const inspection = await inspectNearbytesRoot(normalized);
    if (inspection) {
      discovered.push(inspection);
    }

    if (current.depth >= maxDepth) {
      continue;
    }

    const entries = await safeReadDir(normalized);
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      if (SKIP_DIRECTORY_NAMES.has(entry.name)) {
        continue;
      }
      if (entry.name.startsWith('.') && entry.name !== NEARBYTES_LEGACY_MARKER_FILE) {
        continue;
      }
      queue.push({
        path: path.join(normalized, entry.name),
        depth: current.depth + 1,
      });
    }
  }

  return discovered;
}

async function hasMarkerFile(dirPath: string): Promise<boolean> {
  for (const markerFile of NEARBYTES_MARKER_FILES) {
    if (await hasNamedMarkerFile(dirPath, markerFile)) {
      return true;
    }
  }
  return false;
}

async function hasNamedMarkerFile(dirPath: string, markerFile: string): Promise<boolean> {
  try {
    const markerPath = path.join(dirPath, markerFile);
    const stats = await fs.stat(markerPath);
    return stats.isFile();
  } catch {
    return false;
  }
}

async function resolveMarkerFile(dirPath: string): Promise<string | null> {
  for (const markerFile of NEARBYTES_MARKER_FILES) {
    if (await hasNamedMarkerFile(dirPath, markerFile)) {
      return path.join(dirPath, markerFile);
    }
  }
  return null;
}

function buildNearbytesMarkerHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Nearbytes storage location</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #07111f;
        --panel: rgba(10, 19, 36, 0.92);
        --line: rgba(148, 163, 184, 0.2);
        --text: #e2e8f0;
        --muted: rgba(226, 232, 240, 0.72);
        --accent: #67e8f9;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background:
          radial-gradient(circle at top left, rgba(34, 211, 238, 0.14), transparent 28%),
          linear-gradient(180deg, #0a1222 0%, var(--bg) 100%);
        color: var(--text);
        font-family: "Avenir Next", "Segoe UI", sans-serif;
      }
      main {
        width: min(760px, calc(100vw - 2rem));
        padding: 1.6rem;
        border-radius: 28px;
        border: 1px solid var(--line);
        background: var(--panel);
        box-shadow: 0 24px 60px rgba(2, 6, 23, 0.42);
      }
      h1 { margin: 0 0 0.9rem; font-size: clamp(2rem, 5vw, 3rem); }
      p { margin: 0.7rem 0 0; color: var(--muted); line-height: 1.65; }
      a {
        color: var(--accent);
        text-decoration: none;
        font-weight: 600;
      }
      code {
        display: inline-block;
        margin-top: 0.8rem;
        padding: 0.22rem 0.45rem;
        border-radius: 8px;
        background: rgba(15, 23, 42, 0.92);
        color: #dbeafe;
        font-family: "IBM Plex Mono", "SFMono-Regular", monospace;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Nearbytes storage location</h1>
      <p>
        This folder is being used by Nearbytes as a shared storage location for encrypted blocks and
        append-only space history.
      </p>
      <p>
        You can leave this file in place. Nearbytes uses it to discover the location automatically.
      </p>
      <p>
        Learn more at <a href="${NEARBYTES_HOME_URL}">${NEARBYTES_HOME_URL}</a>.
      </p>
      <p>
        On macOS, if you have just copied Nearbytes into Applications, you may need:
      </p>
      <code>xattr -dr com.apple.quarantine "/Applications/Nearbytes.app"</code>
    </main>
  </body>
</html>
`;
}

async function resolveCanonicalDirectoryPath(targetPath: string): Promise<string | null> {
  try {
    const resolved = path.resolve(targetPath);
    const stats = await fs.stat(resolved);
    if (!stats.isDirectory()) {
      return null;
    }
    const real = await fs.realpath(resolved);
    return path.resolve(real);
  } catch {
    return null;
  }
}

function toCanonicalPathKey(targetPath: string): string {
  const normalized = path.resolve(targetPath).replace(/\\/g, '/');
  if (process.platform === 'win32' || process.platform === 'darwin') {
    return normalized.toLowerCase();
  }
  return normalized;
}

export function classifyNearbytesProviderName(entryName: string): RootProvider | null {
  const lower = entryName.toLowerCase();
  if (lower.includes('dropbox')) {
    return 'dropbox';
  }
  if (lower.includes('onedrive')) {
    return 'onedrive';
  }
  if (lower.includes('icloud') || lower.includes('apple') || lower.includes('clouddocs')) {
    return 'icloud';
  }
  if (lower.includes('googledrive') || lower.includes('google-drive') || lower.includes('google drive')) {
    return 'gdrive';
  }
  if (lower.includes('mega')) {
    return 'mega';
  }
  return null;
}

function isSyncedProvider(provider: RootProvider): boolean {
  return provider !== 'local';
}

function buildSuggestedNearbytesPath(candidatePath: string): string {
  const normalized = path.resolve(candidatePath).replace(/[\\/]+$/, '');
  const currentBaseName = path.basename(normalized).toLowerCase();
  if (currentBaseName === DEFAULT_NEARBYTES_DIRECTORY) {
    return normalized;
  }
  return path.join(normalized, DEFAULT_NEARBYTES_DIRECTORY);
}

function parseScanPathsFromEnv(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(/[,\n;]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => path.resolve(entry));
}

async function listVolumeIds(channelsPath: string): Promise<string[]> {
  const entries = await safeReadDir(channelsPath);
  return entries
    .filter((entry) => entry.isDirectory() && CHANNEL_DIRECTORY_REGEX.test(entry.name))
    .map((entry) => entry.name.toLowerCase())
    .sort((left, right) => left.localeCompare(right));
}

async function isDirectory(targetPath: string): Promise<boolean> {
  const stats = await safeStat(targetPath);
  return Boolean(stats?.isDirectory());
}

async function safeStat(targetPath: string): Promise<Stats | null> {
  try {
    return await fs.stat(targetPath);
  } catch {
    return null;
  }
}

async function safeReadDir(dirPath: string): Promise<Dirent[]> {
  try {
    return await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  const normalized = Math.floor(value);
  if (normalized < min) return min;
  if (normalized > max) return max;
  return normalized;
}

function compareDiscoveredSource(
  left: Pick<DiscoveredNearbytesSource, 'provider' | 'path' | 'sourceType'>,
  right: Pick<DiscoveredNearbytesSource, 'provider' | 'path' | 'sourceType'>
): number {
  const leftPriority = sourceTypePriority(left.sourceType);
  const rightPriority = sourceTypePriority(right.sourceType);
  if (leftPriority !== rightPriority) {
    return leftPriority - rightPriority;
  }
  if (left.provider !== right.provider) {
    return left.provider.localeCompare(right.provider);
  }
  return left.path.localeCompare(right.path);
}

function sourceTypePriority(value: DiscoveredNearbytesSource['sourceType']): number {
  if (value === 'marker') return 0;
  if (value === 'layout') return 1;
  return 2;
}
