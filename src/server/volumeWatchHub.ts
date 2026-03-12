import chokidar, { type FSWatcher } from 'chokidar';
import path from 'path';
import type { RootProvider } from '../config/roots.js';
import { isMultiRootStorageBackend } from '../storage/multiRoot.js';
import type { StorageBackend } from '../types/storage.js';

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
  readonly targets: string[];
  readonly includePrefixes: string[];
}

interface WatchEntry {
  readonly watcher: FSWatcher;
  readonly includePrefixes: string[];
  readonly subscribers: Set<(update: VolumeWatchUpdate) => void>;
  readonly errorSubscribers: Set<(error: Error) => void>;
}

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
      existing.subscribers.add(onUpdate);
      existing.errorSubscribers.add(onError);
      return {
        ready: plan.ready,
        unsubscribe: () => this.unsubscribe(volumeId, onUpdate, onError),
      };
    }

    const watcher = chokidar.watch(plan.targets, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 120,
        pollInterval: 40,
      },
    });

    const entry: WatchEntry = {
      watcher,
      includePrefixes: plan.includePrefixes,
      subscribers: new Set([onUpdate]),
      errorSubscribers: new Set([onError]),
    };

    watcher.on('all', (change, changedPath) => {
      if (!isSupportedChange(change)) {
        return;
      }
      const normalized = normalizePath(changedPath);
      if (!entry.includePrefixes.some((prefix) => normalized.startsWith(prefix))) {
        return;
      }
      const update: VolumeWatchUpdate = {
        volumeId,
        change,
        path: changedPath,
        timestamp: Date.now(),
      };
      for (const subscriber of entry.subscribers) {
        subscriber(update);
      }
    });

    watcher.on('error', (error) => {
      const asError = error instanceof Error ? error : new Error(String(error));
      for (const subscriber of entry.errorSubscribers) {
        subscriber(asError);
      }
    });

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
    if (entry.subscribers.size > 0) {
      return;
    }

    this.entries.delete(volumeId);
    void entry.watcher.close();
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
        includePrefixes: [],
      };
    }

    if (isMultiRootStorageBackend(this.storage)) {
      const activeSources = this.storage
        .getRootsConfig()
        .sources.filter((source) => source.enabled);
      const providers = uniqueProviders(activeSources.map((source) => source.provider));
      const targets = uniquePaths(activeSources.map((source) => source.path));
      const includePrefixes = activeSources.map((source) =>
        normalizePath(path.join(source.path, 'channels', normalizedVolumeId)) + '/'
      );

      return {
        ready: {
          volumeId: normalizedVolumeId,
          autoUpdate: targets.length > 0,
          mode: targets.length > 0 ? 'filesystem' : 'none',
          providers,
        },
        targets,
        includePrefixes,
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
        includePrefixes: [],
      };
    }

    return {
      ready: {
        volumeId: normalizedVolumeId,
        autoUpdate: true,
        mode: 'filesystem',
        providers: ['local'],
      },
      targets: [this.fallbackStorageDir],
      includePrefixes: [
        normalizePath(path.join(this.fallbackStorageDir, 'channels', normalizedVolumeId)) + '/',
      ],
    };
  }
}

function isSupportedChange(value: string): value is VolumeChangeType {
  return value === 'add' || value === 'change' || value === 'unlink' || value === 'addDir' || value === 'unlinkDir';
}

function normalizePath(value: string): string {
  const normalized = path.resolve(value).replace(/\\/g, '/');
  if (process.platform === 'win32') {
    return normalized.toLowerCase();
  }
  return normalized;
}

function uniquePaths(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => path.resolve(value))));
}

function uniqueProviders(values: RootProvider[]): RootProvider[] {
  return Array.from(new Set(values));
}
