/**
 * Storage diagnostics: resolve storage root, count channels/blocks, and optionally
 * warn when the storage path looks like it is inside the repo instead of a MEGA sync folder.
 * No secrets, keys, or decrypted content are read or logged.
 */

import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

export interface StorageDiagnosticsResult {
  storageDirAbs: string;
  storageDirExists: boolean;
  channelsDirAbs: string;
  channelsDirExists: boolean;
  channelsCount: number;
  channelIds: string[];
  blocksDirAbs: string;
  blocksDirExists: boolean;
  blocksCount: number;
  megaHints: { found: boolean; candidates: string[] };
}

const MEGA_CANDIDATE_NAMES = ['MEGA', 'Mega', 'mega'];
const MEGA_CLOUD_PREFIX = 'Library/CloudStorage/MEGA';

/**
 * Check which MEGA candidate paths exist on the filesystem.
 */
async function getMegaCandidatesThatExist(): Promise<string[]> {
  const candidates: string[] = [];
  const home = os.homedir();

  for (const name of MEGA_CANDIDATE_NAMES) {
    const p = path.join(home, name);
    try {
      const stat = await fs.stat(p);
      if (stat.isDirectory()) candidates.push(p);
    } catch {
      // skip
    }
  }
  const cloudMega = path.join(home, MEGA_CLOUD_PREFIX);
  try {
    const stat = await fs.stat(cloudMega);
    if (stat.isDirectory()) candidates.push(cloudMega);
  } catch {
    // skip
  }

  return candidates;
}

/**
 * Run storage diagnostics: absolute paths, existence, counts.
 * Safe: only filenames and sizes; no secrets or decrypted content.
 */
export async function getStorageDiagnostics(storageDir: string): Promise<StorageDiagnosticsResult> {
  const storageDirAbs = path.resolve(storageDir);
  const channelsDirAbs = path.join(storageDirAbs, 'channels');
  const blocksDirAbs = path.join(storageDirAbs, 'blocks');

  let storageDirExists = false;
  let channelsDirExists = false;
  let channelsCount = 0;
  let channelIds: string[] = [];
  let blocksDirExists = false;
  let blocksCount = 0;

  try {
    const stat = await fs.stat(storageDirAbs);
    storageDirExists = stat.isDirectory();
  } catch {
    // leave false
  }

  if (storageDirExists) {
    try {
      const stat = await fs.stat(channelsDirAbs);
      channelsDirExists = stat.isDirectory();
    } catch {
      // leave false
    }
    if (channelsDirExists) {
      try {
        const entries = await fs.readdir(channelsDirAbs, { withFileTypes: true });
        const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
        channelsCount = dirs.length;
        channelIds = dirs.slice(0, 20).sort();
      } catch {
        // leave 0
      }
    }

    try {
      const stat = await fs.stat(blocksDirAbs);
      blocksDirExists = stat.isDirectory();
    } catch {
      // leave false
    }
    if (blocksDirExists) {
      try {
        const entries = await fs.readdir(blocksDirAbs, { withFileTypes: true });
        blocksCount = entries.filter((e) => e.isFile() && e.name.endsWith('.bin')).length;
      } catch {
        // leave 0
      }
    }
  }

  const megaCandidates = await getMegaCandidatesThatExist();
  const megaHints = {
    found: megaCandidates.length > 0,
    candidates: megaCandidates,
  };

  return {
    storageDirAbs,
    storageDirExists,
    channelsDirAbs,
    channelsDirExists,
    channelsCount,
    channelIds,
    blocksDirAbs,
    blocksDirExists,
    blocksCount,
    megaHints,
  };
}

/**
 * Returns list of event files in a channel directory (name, sizeBytes, mtimeISO), newest first, max 20.
 */
export async function getChannelDiagnostics(
  storageDir: string,
  channelId: string
): Promise<{
  channelId: string;
  channelDirAbs: string;
  exists: boolean;
  eventFiles: { name: string; sizeBytes: number; mtimeISO: string }[];
}> {
  const storageDirAbs = path.resolve(storageDir);
  const channelDirAbs = path.join(storageDirAbs, 'channels', channelId);

  let exists = false;
  const eventFiles: { name: string; sizeBytes: number; mtimeISO: string }[] = [];

  try {
    const stat = await fs.stat(channelDirAbs);
    exists = stat.isDirectory();
  } catch {
    return { channelId, channelDirAbs, exists, eventFiles };
  }

  if (!exists) return { channelId, channelDirAbs, exists, eventFiles };

  try {
    const entries = await fs.readdir(channelDirAbs, { withFileTypes: true });
    const files = entries.filter((e) => e.isFile() && e.name.endsWith('.bin'));
    const withStats = await Promise.all(
      files.map(async (f) => {
        const fp = path.join(channelDirAbs, f.name);
        const st = await fs.stat(fp);
        return { name: f.name, sizeBytes: st.size, mtimeISO: st.mtime.toISOString() };
      })
    );
    withStats.sort((a, b) => new Date(b.mtimeISO).getTime() - new Date(a.mtimeISO).getTime());
    eventFiles.push(...withStats.slice(0, 20));
  } catch {
    // leave empty
  }

  return { channelId, channelDirAbs, exists, eventFiles };
}

/**
 * Log diagnostics at server startup and warn if storage path appears to be inside the repo rather than MEGA.
 */
export function logStorageDiagnostics(result: StorageDiagnosticsResult): void {
  console.log('[storage] resolved storageDir (absolute):', result.storageDirAbs);
  console.log('[storage] storageDir exists:', result.storageDirExists);
  console.log('[storage] channels path:', result.channelsDirAbs);
  console.log('[storage] channels exists:', result.channelsDirExists);
  console.log('[storage] channel directories count:', result.channelsCount);
  console.log('[storage] blocks path:', result.blocksDirAbs);
  console.log('[storage] blocks exists:', result.blocksDirExists);
  console.log('[storage] blocks *.bin count:', result.blocksCount);

  const looksInsideRepo =
    result.storageDirAbs.endsWith('/Nearbytes') ||
    result.storageDirAbs.endsWith('/Nearbytes/');

  if (looksInsideRepo && result.megaHints.found && result.megaHints.candidates.length > 0) {
    console.warn(
      '[storage] WARNING: Storage path appears to be inside the repo. Set NEARBYTES_STORAGE_DIR to your preferred local or synced folder (for example $HOME/nearbytes or $HOME/MEGA/nearbytes), or a path under: ' +
        result.megaHints.candidates.join(', ') +
        ').'
    );
  }
}
