import { promises as fs, type Dirent } from 'fs';
import os from 'os';
import path from 'path';
import type { RootConfigEntry, RootProvider } from './roots.js';

export interface DiscoveredNearbytesSource {
  readonly provider: RootProvider;
  readonly path: string;
  readonly markerFile: string;
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
export const NEARBYTES_MARKER_FILE = '.nearbytes';
const SKIP_DIRECTORY_NAMES = new Set([
  '.git',
  '.idea',
  '.vscode',
  '.DS_Store',
  'node_modules',
  '.Trash',
  '.cache',
]);

/**
 * Discovers local Nearbytes roots by scanning synced folders for `.nearbytes` markers.
 */
export async function discoverNearbytesSources(options?: {
  readonly maxDepth?: number;
  readonly maxDirectories?: number;
}): Promise<DiscoveredNearbytesSource[]> {
  const maxDepth = clampInt(options?.maxDepth, DEFAULT_MAX_DEPTH, 1, 8);
  const maxDirectories = clampInt(options?.maxDirectories, DEFAULT_MAX_DIRECTORIES, 100, 50000);

  const candidates = await buildScanCandidates();
  const seenRoots = new Set<string>();
  const discovered: DiscoveredNearbytesSource[] = [];

  for (const candidate of candidates) {
    const markerDirs = await scanForMarkers(candidate.path, maxDepth, maxDirectories);
    for (const markerDir of markerDirs) {
      const canonicalDir = await resolveCanonicalDirectoryPath(markerDir);
      if (!canonicalDir) {
        continue;
      }
      const canonicalKey = toCanonicalPathKey(canonicalDir);
      if (seenRoots.has(canonicalKey)) {
        continue;
      }
      seenRoots.add(canonicalKey);
      discovered.push({
        provider: candidate.provider,
        path: canonicalDir,
        markerFile: path.join(canonicalDir, NEARBYTES_MARKER_FILE),
        autoUpdate: true,
      });
    }
  }

  discovered.sort((left, right) => {
    if (left.provider !== right.provider) {
      return left.provider.localeCompare(right.provider);
    }
    return left.path.localeCompare(right.path);
  });

  return discovered;
}

/**
 * Ensures `.nearbytes` marker files exist for all configured roots.
 * Best-effort: returns per-root status and never throws.
 */
export async function ensureNearbytesMarkers(roots: readonly RootConfigEntry[]): Promise<MarkerEnsureResult[]> {
  const results: MarkerEnsureResult[] = [];

  for (const root of roots) {
    const markerFile = path.join(root.path, NEARBYTES_MARKER_FILE);
    try {
      const created = await ensureNearbytesMarker(root.path);
      results.push({
        rootId: root.id,
        path: root.path,
        markerFile,
        created,
        ok: true,
      });
    } catch (error) {
      results.push({
        rootId: root.id,
        path: root.path,
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

async function buildScanCandidates(): Promise<ScanCandidate[]> {
  const home = os.homedir();
  const candidates: ScanCandidate[] = [
    { provider: 'dropbox', path: path.join(home, 'Dropbox') },
    { provider: 'mega', path: path.join(home, 'MEGA') },
    { provider: 'mega', path: path.join(home, 'Mega') },
    { provider: 'gdrive', path: path.join(home, 'Google Drive') },
  ];

  const cloudStorage = path.join(home, 'Library', 'CloudStorage');
  const cloudEntries = await safeReadDir(cloudStorage);
  for (const entry of cloudEntries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const provider = classifyProvider(entry.name);
    if (!provider) {
      continue;
    }
    candidates.push({
      provider,
      path: path.join(cloudStorage, entry.name),
    });
  }

  const envPaths = parseScanPathsFromEnv(process.env.NEARBYTES_SOURCE_SCAN_DIRS);
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

async function scanForMarkers(rootPath: string, maxDepth: number, maxDirectories: number): Promise<string[]> {
  const queue: QueueEntry[] = [{ path: rootPath, depth: 0 }];
  const visited = new Set<string>();
  const markerDirs: string[] = [];
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

    if (await hasMarkerFile(normalized)) {
      markerDirs.push(normalized);
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

  return markerDirs;
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

function classifyProvider(entryName: string): RootProvider | null {
  const lower = entryName.toLowerCase();
  if (lower.includes('dropbox')) {
    return 'dropbox';
  }
  if (lower.includes('googledrive') || lower.includes('google-drive') || lower.includes('google drive')) {
    return 'gdrive';
  }
  if (lower.includes('mega')) {
    return 'mega';
  }
  return null;
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
