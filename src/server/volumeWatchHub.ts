import chokidar, { type FSWatcher } from 'chokidar';
import path from 'path';
import type { RootProvider } from '../config/roots.js';
import { isMultiRootStorageBackend } from '../storage/multiRoot.js';
import type { StorageBackend } from 'nearbytes-storage';
import { debugServerLog } from './debug.js';
import type { RuntimeVolumeEventPublisher } from './volumeEventBus.js';

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

interface WatchTargetPlan {
  readonly rootPath: string;
  readonly channelRoot: string;
  readonly volumeRoot: string;
}

interface WatchPlan {
  readonly ready: VolumeWatchReady;
  readonly targets: WatchTargetPlan[];
}

interface WatchEntry {
  readonly id: number;
  readonly targets: WatchTargetPlan[];
  readonly watcher: FSWatcher;
  readonly subscribers: Set<(update: VolumeWatchUpdate) => void>;
  readonly errorSubscribers: Set<(error: Error) => void>;
  readonly ready: VolumeWatchReady;
  readonly pendingChanges: Map<string, VolumeChangeType>;
  debounceTimer: ReturnType<typeof setTimeout> | null;
}

let nextVolumeWatchEntryId = 1;
const VOLUME_WATCH_DEBOUNCE_MS = 40;
const VOLUME_WATCH_DEPTH = 4;

export class VolumeWatchHub {
  private readonly entries = new Map<string, WatchEntry>();

  constructor(
    private readonly storage: StorageBackend,
    private readonly fallbackStorageDir?: string,
    private readonly volumeEventPublisher?: RuntimeVolumeEventPublisher,
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
      targets: plan.targets,
      watcher: chokidar.watch(uniquePaths(plan.targets.map((target) => target.rootPath)), {
        persistent: true,
        ignoreInitial: true,
        depth: VOLUME_WATCH_DEPTH,
        awaitWriteFinish: {
          stabilityThreshold: 60,
          pollInterval: 20,
        },
      }),
      subscribers: new Set([onUpdate]),
      errorSubscribers: new Set([onError]),
      ready: plan.ready,
      pendingChanges: new Map(),
      debounceTimer: null,
    };

    debugServerLog(
      'watchers',
      `[volume-watch] created watcher #${entry.id} for volume=${volumeId}; targets=${JSON.stringify(plan.targets.map((target) => target.rootPath))}`
    );

    entry.watcher.on('all', (change, changedPath) => {
      if (!isSupportedChange(change)) {
        return;
      }
      const target = matchWatchTarget(plan.targets, String(changedPath));
      if (!target) {
        return;
      }
      const normalizedPath = normalizePath(changedPath);
      this.volumeEventPublisher?.publish({
        volumeId,
        producer: 'filesystem',
        kind: 'filesystem-change',
        paths: [toRootRelativePath(target.rootPath, normalizedPath)],
        invalidate: inferInvalidationFromPath(target, normalizedPath),
      });
      const publishedPath = target.volumeRoot;
      const nextChange = prioritizeVolumeChange(entry.pendingChanges.get(publishedPath), change);
      entry.pendingChanges.set(publishedPath, nextChange);
      if (entry.debounceTimer) {
        clearTimeout(entry.debounceTimer);
      }
      entry.debounceTimer = setTimeout(() => {
        entry.debounceTimer = null;
        for (const [pendingPath, pendingChange] of entry.pendingChanges.entries()) {
          this.publishUpdate(entry, volumeId, pendingChange, pendingPath);
        }
        entry.pendingChanges.clear();
      }, VOLUME_WATCH_DEBOUNCE_MS);
      debugServerLog(
        'watchers',
        `[volume-watch] watcher #${entry.id} queued ${change} for volume=${volumeId}; changedPath=${normalizedPath}`
      );
    });

    entry.watcher.on('error', (error) => {
      const asError = error instanceof Error ? error : new Error(String(error));
      console.warn(`[volume-watch] watcher #${entry.id} error for volume=${volumeId}: ${asError.message}`);
      for (const subscriber of entry.errorSubscribers) {
        subscriber(asError);
      }
    });

    entry.watcher.on('ready', () => {
      debugServerLog('watchers', `[volume-watch] watcher #${entry.id} ready for volume=${volumeId}`);
    });

    this.entries.set(volumeId, entry);

    return {
      ready: plan.ready,
      unsubscribe: () => this.unsubscribe(volumeId, onUpdate, onError),
    };
  }

  private publishUpdate(
    entry: WatchEntry,
    volumeId: string,
    change: VolumeChangeType,
    changedPath: string
  ): void {
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
    if (entry.debounceTimer) {
      clearTimeout(entry.debounceTimer);
      entry.debounceTimer = null;
    }
    const closeStartedAt = Date.now();
    debugServerLog('watchers', `[volume-watch] closing watcher #${entry.id} for volume=${volumeId}`);
    void entry.watcher.close().then(() => {
      debugServerLog(
        'watchers',
        `[volume-watch] closed watcher #${entry.id} for volume=${volumeId} in ${Date.now() - closeStartedAt}ms`
      );
    });
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
}

function isSupportedChange(value: string): value is VolumeChangeType {
  return value === 'add' || value === 'change' || value === 'unlink' || value === 'addDir' || value === 'unlinkDir';
}

function matchWatchTarget(targets: readonly WatchTargetPlan[], changedPath: string): WatchTargetPlan | null {
  const normalizedPath = normalizePath(changedPath);
  for (const target of targets) {
    if (normalizedPath === target.volumeRoot) {
      return target;
    }
    if (normalizedPath.startsWith(`${target.volumeRoot}/`)) {
      return target;
    }
    if (normalizedPath === target.channelRoot && (target.channelRoot === target.volumeRoot || target.volumeRoot.startsWith(`${target.channelRoot}/`))) {
      return target;
    }
  }
  return null;
}

function prioritizeVolumeChange(
  previous: VolumeChangeType | undefined,
  next: VolumeChangeType
): VolumeChangeType {
  if (!previous) {
    return next;
  }
  if (previous === 'unlinkDir' || next === 'unlinkDir') {
    return 'unlinkDir';
  }
  if (previous === 'addDir' || next === 'addDir') {
    return 'addDir';
  }
  if (previous === 'unlink' || next === 'unlink') {
    return 'unlink';
  }
  if (previous === 'add' || next === 'add') {
    return 'add';
  }
  return 'change';
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

function uniquePaths(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => normalizePath(value))));
}

function uniqueProviders(values: RootProvider[]): RootProvider[] {
  return Array.from(new Set(values));
}

function toRootRelativePath(rootPath: string, absolutePath: string): string {
  const relative = path.relative(rootPath, absolutePath).replace(/\\/g, '/');
  return relative.length > 0 ? relative : '.';
}

function inferInvalidationFromPath(
  target: WatchTargetPlan,
  changedPath: string
): { files: boolean; timeline: boolean; chat: boolean } {
  const isChannelChange =
    changedPath === target.channelRoot ||
    changedPath === target.volumeRoot ||
    changedPath.startsWith(`${target.channelRoot}/`);
  return {
    files: isChannelChange,
    timeline: isChannelChange,
    chat: isChannelChange,
  };
}
