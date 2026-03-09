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
export const NEARBYTES_MARKER_FILE = '.nearbytes';
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
        markerFile: path.join(canonicalDir, NEARBYTES_MARKER_FILE),
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
 * Ensures `.nearbytes` marker files exist for all configured roots.
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
 * Ensures `.nearbytes` exists in a root directory.
 * Returns true if created now, false if already present.
 */
export async function ensureNearbytesMarker(rootPath: string): Promise<boolean> {
  const markerPath = path.join(rootPath, NEARBYTES_MARKER_FILE);
  await fs.mkdir(rootPath, { recursive: true });

  if (await hasMarkerFile(rootPath)) {
    return false;
  }

  await fs.writeFile(markerPath, 'nearbytes-root-marker\n', 'utf8');
  return true;
}

export async function inspectNearbytesRoot(rootPath: string): Promise<NearbytesRootInspection | null> {
  const resolvedRoot = path.resolve(rootPath);
  const stats = await safeStat(resolvedRoot);
  if (!stats?.isDirectory()) {
    return null;
  }

  const markerFile = path.join(resolvedRoot, NEARBYTES_MARKER_FILE);
  const channelsPath = path.join(resolvedRoot, 'channels');
  const blocksPath = path.join(resolvedRoot, 'blocks');
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
      if (entry.name.startsWith('.') && entry.name !== '.nearbytes') {
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
  try {
    const markerPath = path.join(dirPath, NEARBYTES_MARKER_FILE);
    const stats = await fs.stat(markerPath);
    return stats.isFile();
  } catch {
    return false;
  }
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
