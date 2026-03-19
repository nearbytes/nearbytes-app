import chokidar, { type FSWatcher } from 'chokidar';
import path from 'path';
import {
  discoverNearbytesSources,
  isNearbytesWatchIgnoredPath,
  type DiscoveredNearbytesSource,
} from '../config/sourceDiscovery.js';
import type { RootProvider } from '../config/roots.js';
import { debugServerLog } from './debug.js';

export interface SourceWatchReady {
  readonly autoUpdate: boolean;
  readonly mode: 'filesystem' | 'none';
  readonly providers: RootProvider[];
}

export interface SourceWatchUpdate {
  readonly reason: 'rescan';
  readonly timestamp: number;
  readonly changedPaths: string[];
  readonly providers: RootProvider[];
}

export interface SourceWatchSubscription {
  readonly ready: SourceWatchReady;
  unsubscribe(): void;
}

interface WatchPlan {
  readonly ready: SourceWatchReady;
  readonly targets: string[];
}

interface WatchEntry {
  readonly id: number;
  readonly watcher: FSWatcher;
  readonly ready: SourceWatchReady;
  readonly subscribers: Set<(update: SourceWatchUpdate) => void>;
  readonly errorSubscribers: Set<(error: Error) => void>;
  readonly pendingPaths: Set<string>;
  debounceTimer: ReturnType<typeof setTimeout> | null;
}

let nextSourceWatchEntryId = 1;

export class SourceWatchHub {
  private readonly sourcesResolver: () => Promise<DiscoveredNearbytesSource[]>;
  private readonly debounceMs: number;
  private readonly watchDepth: number;
  private entry: WatchEntry | null = null;
  private readonly quietWindowMs: number;

  constructor(options?: {
    readonly sourcesResolver?: () => Promise<DiscoveredNearbytesSource[]>;
    readonly debounceMs?: number;
    readonly watchDepth?: number;
  }) {
    this.sourcesResolver = options?.sourcesResolver ?? (() => discoverNearbytesSources());
    this.debounceMs = options?.debounceMs ?? 300;
    this.watchDepth = options?.watchDepth ?? 3;
    this.quietWindowMs = Math.max(this.debounceMs, 200);
  }

  async subscribe(
    onUpdate: (update: SourceWatchUpdate) => void,
    onError: (error: Error) => void
  ): Promise<SourceWatchSubscription> {
    const plan = await this.buildWatchPlan();
    if (!plan.ready.autoUpdate || plan.targets.length === 0) {
      return {
        ready: plan.ready,
        unsubscribe() {
          // no-op
        },
      };
    }

    if (this.entry) {
      debugServerLog(
        'watchers',
        `[source-watch] reusing watcher #${this.entry.id} for subscriber; subscribers=${this.entry.subscribers.size + 1}`
      );
      this.entry.subscribers.add(onUpdate);
      this.entry.errorSubscribers.add(onError);
      return {
        ready: this.entry.ready,
        unsubscribe: () => this.unsubscribe(onUpdate, onError),
      };
    }

    const watcher = chokidar.watch(plan.targets, {
      persistent: true,
      ignoreInitial: true,
      ignored: (candidatePath) => isNearbytesWatchIgnoredPath(String(candidatePath), plan.targets),
      depth: this.watchDepth,
      awaitWriteFinish: {
        stabilityThreshold: 150,
        pollInterval: 50,
      },
    });

    const entry: WatchEntry = {
      id: nextSourceWatchEntryId++,
      watcher,
      ready: plan.ready,
      subscribers: new Set([onUpdate]),
      errorSubscribers: new Set([onError]),
      pendingPaths: new Set(),
      debounceTimer: null,
    };

    debugServerLog(
      'watchers',
      `[source-watch] created watcher #${entry.id}; targets=${JSON.stringify(plan.targets)} depth=${this.watchDepth}`
    );

    watcher.on('all', (change, changedPath) => {
      if (!isSupportedChange(change)) {
        return;
      }
      entry.pendingPaths.add(normalizePath(changedPath));
      if (entry.debounceTimer) {
        clearTimeout(entry.debounceTimer);
      }
      entry.debounceTimer = setTimeout(() => {
        entry.debounceTimer = null;
        const changedPaths = Array.from(entry.pendingPaths.values()).sort((left, right) =>
          left.localeCompare(right)
        );
        entry.pendingPaths.clear();
        const update: SourceWatchUpdate = {
          reason: 'rescan',
          timestamp: Date.now(),
          changedPaths,
          providers: entry.ready.providers,
        };
        for (const subscriber of entry.subscribers) {
          subscriber(update);
        }
      }, this.quietWindowMs);
    });

    watcher.on('error', (error) => {
      const asError = error instanceof Error ? error : new Error(String(error));
      console.warn(`[source-watch] watcher #${entry.id} error: ${asError.message}`);
      for (const subscriber of entry.errorSubscribers) {
        subscriber(asError);
      }
    });

    watcher.on('ready', () => {
      debugServerLog('watchers', `[source-watch] watcher #${entry.id} ready`);
    });

    this.entry = entry;
    return {
      ready: entry.ready,
      unsubscribe: () => this.unsubscribe(onUpdate, onError),
    };
  }

  private unsubscribe(
    onUpdate: (update: SourceWatchUpdate) => void,
    onError: (error: Error) => void
  ): void {
    const entry = this.entry;
    if (!entry) {
      return;
    }

    entry.subscribers.delete(onUpdate);
    entry.errorSubscribers.delete(onError);
    debugServerLog(
      'watchers',
      `[source-watch] unsubscribe watcher #${entry.id}; remaining-subscribers=${entry.subscribers.size}`
    );
    if (entry.subscribers.size > 0) {
      return;
    }

    if (entry.debounceTimer) {
      clearTimeout(entry.debounceTimer);
      entry.debounceTimer = null;
    }
    this.entry = null;
    const closeStartedAt = Date.now();
    debugServerLog('watchers', `[source-watch] closing watcher #${entry.id}`);
    void entry.watcher.close().then(() => {
      debugServerLog(
        'watchers',
        `[source-watch] closed watcher #${entry.id} in ${Date.now() - closeStartedAt}ms`
      );
    });
  }

  private async buildWatchPlan(): Promise<WatchPlan> {
    const sources = await this.sourcesResolver();
    const targets = uniquePaths(sources.map((source) => source.path));
    const providers = uniqueProviders(sources.map((source) => source.provider));
    return {
      ready: {
        autoUpdate: targets.length > 0,
        mode: targets.length > 0 ? 'filesystem' : 'none',
        providers,
      },
      targets,
    };
  }
}

function isSupportedChange(value: string): boolean {
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
  return Array.from(new Set(values.map((value) => normalizePath(value))));
}

function uniqueProviders(values: RootProvider[]): RootProvider[] {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}
