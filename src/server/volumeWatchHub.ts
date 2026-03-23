import { existsSync, statSync, watch as fsWatch, type FSWatcher } from 'fs';
import path from 'path';
import { isNearbytesWatchIgnoredPath } from '../config/sourceDiscovery.js';
import type { RootProvider } from '../config/roots.js';
import { isMultiRootStorageBackend } from '../storage/multiRoot.js';
import type { StorageBackend } from '../types/storage.js';
import { debugServerLog } from './debug.js';

export type VolumeChangeType = 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir';

export interface VolumeWatchReady {
  readonly volumeId: string;
  readonly autoUpdate: boolean;
  readonly mode: 'filesystem' | 'none';
  readonly providers: RootProvider[];
}

export interface VolumeWatchUpdate {
  readonly volumeId: string;
  readonly change: VolumeChangeType;
  readonly path: string;
  readonly timestamp: number;
}

export interface VolumeWatchSubscription {
  readonly ready: VolumeWatchReady;
  unsubscribe(): void;
}

interface WatchPlan {
  readonly ready: VolumeWatchReady;
  readonly targets: WatchTargetPlan[];
}

interface WatchTargetPlan {
  readonly rootPath: string;
  readonly channelRoot: string;
  readonly volumeRoot: string;
}

interface WatchEntry {
  readonly id: number;
  readonly targetWatchers: Map<string, ActiveTargetWatcher>;
  readonly subscribers: Set<(update: VolumeWatchUpdate) => void>;
  readonly errorSubscribers: Set<(error: Error) => void>;
}

interface ActiveTargetWatcher {
  readonly mode: 'storage-root' | 'channel-root' | 'volume-root';
  readonly plan: WatchTargetPlan;
  readonly watcher: FSWatcher;
}

let nextVolumeWatchEntryId = 1;

/**
 * Shared hub that broadcasts per-volume filesystem updates to active subscribers.
 */
export class VolumeWatchHub {
  private readonly entries = new Map<string, WatchEntry>();

  constructor(
    private readonly storage: StorageBackend,
    private readonly fallbackStorageDir?: string
  ) {}

  subscribe(
    volumeId: string,
    onUpdate: (update: VolumeWatchUpdate) => void,
    onError: (error: Error) => void
  ): VolumeWatchSubscription {
    const plan = this.buildWatchPlan(volumeId);
    if (!plan.ready.autoUpdate || plan.targets.length === 0) {
      return {
        ready: plan.ready,
        unsubscribe() {
          // No-op for unsupported modes.
        },
      };
    }

    const existing = this.entries.get(volumeId);
    if (existing) {
      debugServerLog(
        'watchers',
        `[volume-watch] reusing watcher #${existing.id} for volume=${volumeId}; subscribers=${existing.subscribers.size + 1}`
      );
      existing.subscribers.add(onUpdate);
      existing.errorSubscribers.add(onError);
      return {
        ready: plan.ready,
        unsubscribe: () => this.unsubscribe(volumeId, onUpdate, onError),
      };
    }

    const entry: WatchEntry = {
      id: nextVolumeWatchEntryId++,
      targetWatchers: new Map(),
      subscribers: new Set([onUpdate]),
      errorSubscribers: new Set([onError]),
    };

    debugServerLog(
      'watchers',
      `[volume-watch] created watcher #${entry.id} for volume=${volumeId}; targets=${JSON.stringify(plan.targets)}`
    );

    for (const target of plan.targets) {
      this.openTargetWatcher(entry, volumeId, target);
    }

    debugServerLog('watchers', `[volume-watch] watcher #${entry.id} ready for volume=${volumeId}`);

    this.entries.set(volumeId, entry);

    return {
      ready: plan.ready,
      unsubscribe: () => this.unsubscribe(volumeId, onUpdate, onError),
    };
  }

  private unsubscribe(
    volumeId: string,
    onUpdate: (update: VolumeWatchUpdate) => void,
    onError: (error: Error) => void
  ): void {
    const entry = this.entries.get(volumeId);
    if (!entry) {
      return;
    }

    entry.subscribers.delete(onUpdate);
    entry.errorSubscribers.delete(onError);
    debugServerLog(
      'watchers',
      `[volume-watch] unsubscribe watcher #${entry.id} for volume=${volumeId}; remaining-subscribers=${entry.subscribers.size}`
    );
    if (entry.subscribers.size > 0) {
      return;
    }

    this.entries.delete(volumeId);
    debugServerLog('watchers', `[volume-watch] closing watcher #${entry.id} for volume=${volumeId}`);
    for (const targetWatcher of entry.targetWatchers.values()) {
      targetWatcher.watcher.close();
    }
    entry.targetWatchers.clear();
    debugServerLog('watchers', `[volume-watch] closed watcher #${entry.id} for volume=${volumeId}`);
  }

  private buildWatchPlan(volumeId: string): WatchPlan {
    const normalizedVolumeId = volumeId.trim().toLowerCase();
    if (normalizedVolumeId.length === 0) {
      return {
        ready: {
          volumeId,
          autoUpdate: false,
          mode: 'none',
          providers: [],
        },
        targets: [],
      };
    }

    if (isMultiRootStorageBackend(this.storage)) {
      const activeSources = this.storage
        .getRootsConfig()
        .sources.filter((source) => source.enabled);
      const providers = uniqueProviders(activeSources.map((source) => source.provider));
      const targets = uniqueTargetPlans(
        activeSources.map((source) => ({
          rootPath: source.path,
          channelRoot: path.join(source.path, 'channels'),
          volumeRoot: path.join(source.path, 'channels', normalizedVolumeId),
        }))
      );

      return {
        ready: {
          volumeId: normalizedVolumeId,
          autoUpdate: targets.length > 0,
          mode: targets.length > 0 ? 'filesystem' : 'none',
          providers,
        },
        targets,
      };
    }

    if (!this.fallbackStorageDir) {
      return {
        ready: {
          volumeId: normalizedVolumeId,
          autoUpdate: false,
          mode: 'none',
          providers: [],
        },
        targets: [],
      };
    }

    return {
      ready: {
        volumeId: normalizedVolumeId,
        autoUpdate: true,
        mode: 'filesystem',
        providers: ['local'],
      },
      targets: uniqueTargetPlans([
        {
          rootPath: this.fallbackStorageDir,
          channelRoot: path.join(this.fallbackStorageDir, 'channels'),
          volumeRoot: path.join(this.fallbackStorageDir, 'channels', normalizedVolumeId),
        },
      ]),
    };
  }

  private openTargetWatcher(entry: WatchEntry, volumeId: string, target: WatchTargetPlan): void {
    const activeWatcher = this.createTargetWatcher(entry, volumeId, target);
    entry.targetWatchers.set(target.volumeRoot, activeWatcher);
  }

  private replaceTargetWatcher(entry: WatchEntry, volumeId: string, target: WatchTargetPlan): void {
    entry.targetWatchers.get(target.volumeRoot)?.watcher.close();
    this.openTargetWatcher(entry, volumeId, target);
  }

  private createTargetWatcher(
    entry: WatchEntry,
    volumeId: string,
    target: WatchTargetPlan
  ): ActiveTargetWatcher {
    const mode = resolveWatchMode(target);
    const watchPath = getWatchPath(target, mode);
    const watcher = fsWatch(watchPath, { persistent: true }, (eventType, filename) => {
      this.handleTargetEvent(entry, volumeId, target, mode, eventType, filename?.toString() ?? '');
    });

    watcher.on('error', (error) => {
      const asError = error instanceof Error ? error : new Error(String(error));
      console.warn(`[volume-watch] watcher #${entry.id} error for volume=${volumeId}: ${asError.message}`);
      for (const subscriber of entry.errorSubscribers) {
        subscriber(asError);
      }
    });

    debugServerLog(
      'watchers',
      `[volume-watch] watcher #${entry.id} target=${watchPath} mode=${mode} for volume=${volumeId}`
    );

    return {
      mode,
      plan: target,
      watcher,
    };
  }

  private handleTargetEvent(
    entry: WatchEntry,
    volumeId: string,
    target: WatchTargetPlan,
    mode: ActiveTargetWatcher['mode'],
    eventType: 'rename' | 'change',
    filename: string
  ): void {
    if (mode === 'storage-root') {
      if (filename && filename !== 'channels') {
        return;
      }
      const nextPath = existsSync(target.volumeRoot) && isDirectory(target.volumeRoot)
        ? target.volumeRoot
        : target.channelRoot;
      this.publishUpdate(entry, volumeId, classifyWatchEvent(nextPath, eventType), nextPath);
      if (existsSync(target.channelRoot) && isDirectory(target.channelRoot)) {
        this.replaceTargetWatcher(entry, volumeId, target);
      }
      return;
    }

    if (mode === 'channel-root') {
      const watchedVolumeName = path.basename(target.volumeRoot);
      if (filename && filename !== watchedVolumeName) {
        return;
      }
      const nextPath = existsSync(target.volumeRoot) && isDirectory(target.volumeRoot)
        ? target.volumeRoot
        : target.channelRoot;
      this.publishUpdate(entry, volumeId, classifyWatchEvent(nextPath, eventType), nextPath);
      if (existsSync(target.volumeRoot) && isDirectory(target.volumeRoot)) {
        this.replaceTargetWatcher(entry, volumeId, target);
      }
      return;
    }

    const changedPath = filename ? path.join(target.volumeRoot, filename) : target.volumeRoot;
    if (isNearbytesWatchIgnoredPath(changedPath, [target.rootPath])) {
      return;
    }
    this.publishUpdate(entry, volumeId, classifyWatchEvent(changedPath, eventType), changedPath);
    if (!existsSync(target.volumeRoot)) {
      this.replaceTargetWatcher(entry, volumeId, target);
    }
  }

  private publishUpdate(entry: WatchEntry, volumeId: string, change: VolumeChangeType, changedPath: string): void {
    const update: VolumeWatchUpdate = {
      volumeId,
      change,
      path: changedPath,
      timestamp: Date.now(),
    };

    for (const subscriber of entry.subscribers) {
      subscriber(update);
    }
  }
}

function normalizePath(value: string): string {
  const normalized = path.resolve(value).replace(/\\/g, '/');
  if (process.platform === 'win32') {
    return normalized.toLowerCase();
  }
  return normalized;
}

function uniqueTargetPlans(values: WatchTargetPlan[]): WatchTargetPlan[] {
  const plans = new Map<string, WatchTargetPlan>();
  for (const value of values) {
    const normalizedValue = {
      rootPath: normalizePath(value.rootPath),
      channelRoot: normalizePath(value.channelRoot),
      volumeRoot: normalizePath(value.volumeRoot),
    };
    plans.set(normalizedValue.volumeRoot, normalizedValue);
  }
  return Array.from(plans.values());
}

function resolveWatchMode(target: WatchTargetPlan): ActiveTargetWatcher['mode'] {
  if (existsSync(target.volumeRoot) && isDirectory(target.volumeRoot)) {
    return 'volume-root';
  }
  if (existsSync(target.channelRoot) && isDirectory(target.channelRoot)) {
    return 'channel-root';
  }
  return 'storage-root';
}

function getWatchPath(target: WatchTargetPlan, mode: ActiveTargetWatcher['mode']): string {
  if (mode === 'volume-root') {
    return target.volumeRoot;
  }
  if (mode === 'channel-root') {
    return target.channelRoot;
  }
  return target.rootPath;
}

function classifyWatchEvent(changedPath: string, eventType: 'rename' | 'change'): VolumeChangeType {
  const exists = existsSync(changedPath);
  if (!exists) {
    return changedPath === path.dirname(changedPath) ? 'unlinkDir' : 'unlink';
  }

  if (eventType === 'change') {
    return 'change';
  }

  return isDirectory(changedPath) ? 'addDir' : 'add';
}

function isDirectory(targetPath: string): boolean {
  try {
    return statSync(targetPath).isDirectory();
  } catch {
    return false;
  }
}

function uniqueProviders(values: RootProvider[]): RootProvider[] {
  return Array.from(new Set(values));
}
