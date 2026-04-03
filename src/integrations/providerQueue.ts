import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import type { MultiRootStorageBackend } from '../storage/multiRoot.js';
import { parseCanonicalBlockRelativePath, parseCanonicalEventRelativePath } from '../storage/integrity.js';
import type { StorageWriteEvent } from '../types/storage.js';
import { writeFileAtomicallyWithRenameFallback } from '../utils/atomicWrite.js';
import type {
  ProviderObservedObjectKind,
  ProviderObservedObjectRef,
  ProviderQueueObservation,
  ProviderQueueRouteState,
} from './types.js';

const PROVIDER_QUEUE_SCHEMA_VERSION = 2 as const;
const DEFAULT_PAGE_LIMIT = 512;

interface StoredProviderQueueObservation extends ProviderQueueObservation {
  readonly order: number;
}

interface ProviderQueueState {
  readonly version: typeof PROVIDER_QUEUE_SCHEMA_VERSION;
  readonly observations: StoredProviderQueueObservation[];
  readonly routes: ProviderQueueRouteState[];
}

export interface ProviderQueueObservationPage {
  readonly observations: ProviderQueueObservation[];
  readonly headObservationId: string | null;
}

export class PersistentProviderQueue {
  private readonly statePath: string;
  private state: ProviderQueueState = {
    version: PROVIDER_QUEUE_SCHEMA_VERSION,
      observations: [],
      routes: [],
  };
  private observationKeys = new Set<string>();
  private readonly observationListeners = new Set<(observation: ProviderQueueObservation) => void>();
  private unsubscribe: (() => void) | null = null;
  private started = false;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly storage: MultiRootStorageBackend,
    private readonly runtimeDir: string
  ) {
    this.statePath = path.join(runtimeDir, 'provider-queue.json');
  }

  async start(): Promise<void> {
    if (this.started) {
      return;
    }
    this.started = true;
    await fs.mkdir(this.runtimeDir, { recursive: true });
    this.state = await this.loadState();
    this.observationKeys = new Set(this.state.observations.map((entry) => observationKey(entry.kind, entry.hash)));
    await this.seedFromStorage();
    this.unsubscribe = this.storage.onWrite((event) => {
      void this.recordStorageWrite(event);
    });
  }

  async stop(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.started = false;
    this.observationListeners.clear();
    await this.writeChain.catch(() => undefined);
  }

  onObservation(listener: (observation: ProviderQueueObservation) => void): () => void {
    this.observationListeners.add(listener);
    return () => {
      this.observationListeners.delete(listener);
    };
  }

  getHeadObservationId(): string | null {
    return this.state.observations.at(-1)?.observationId ?? null;
  }

  listObservedVolumeIds(): string[] {
    const volumeIds = new Set<string>();
    for (const observation of this.state.observations) {
      if (observation.volumeId && observation.volumeId.trim() !== '') {
        volumeIds.add(observation.volumeId);
      }
    }
    return Array.from(volumeIds).sort((left, right) => left.localeCompare(right));
  }

  listObservations(options: {
    readonly afterObservationId?: string | null;
    readonly volumeIds?: readonly string[];
    readonly limit?: number;
  } = {}): ProviderQueueObservationPage {
    const limit = Math.max(1, Math.min(DEFAULT_PAGE_LIMIT, options.limit ?? DEFAULT_PAGE_LIMIT));
    const volumeFilter = normalizeVolumeFilter(options.volumeIds);
    const startIndex = this.indexAfterObservationId(options.afterObservationId);
    const observations = this.state.observations
      .slice(startIndex)
      .filter((entry) => matchesVolumeFilter(entry, volumeFilter))
      .slice(0, limit);
    return {
      observations,
      headObservationId: this.getHeadObservationId(),
    };
  }

  getRouteState(provider: string, routeKey: string): ProviderQueueRouteState {
    return (
      this.state.routes.find((entry) => entry.provider === provider && entry.routeKey === routeKey) ?? {
        provider,
        routeKey,
        lastAckedObservationId: null,
        lastAttemptedObservationId: null,
        updatedAt: 0,
      }
    );
  }

  async noteRouteAttempt(
    provider: string,
    routeKey: string,
    observationId: string | null
  ): Promise<ProviderQueueRouteState> {
    return this.upsertRouteState(provider, routeKey, (current) => ({
      provider,
      routeKey,
      lastAckedObservationId: current.lastAckedObservationId,
      lastAttemptedObservationId: observationId ?? current.lastAttemptedObservationId,
      updatedAt: Date.now(),
    }));
  }

  async acknowledgeRoute(
    provider: string,
    routeKey: string,
    observationId: string | null
  ): Promise<ProviderQueueRouteState> {
    return this.upsertRouteState(provider, routeKey, (current) => ({
      provider,
      routeKey,
      lastAckedObservationId: observationId ?? current.lastAckedObservationId,
      lastAttemptedObservationId: observationId ?? current.lastAttemptedObservationId,
      updatedAt: Date.now(),
    }));
  }

  async recordStorageWrite(event: StorageWriteEvent): Promise<ProviderQueueObservation | null> {
    const candidate = observationFromStorageWrite(event);
    if (!candidate) {
      return null;
    }
    const key = observationKey(candidate.kind, candidate.hash);
    if (this.observationKeys.has(key)) {
      return null;
    }
    const stored = this.toStoredObservation(candidate);
    this.observationKeys.add(key);
    this.state = {
      ...this.state,
      observations: [...this.state.observations, stored],
    };
    await this.persistState();
    const published = stripStoredObservation(stored);
    this.publishObservation(published);
    return published;
  }

  private async seedFromStorage(): Promise<void> {
    const volumeIds = await this.storage.listKnownVolumeIds();
    for (const volumeId of volumeIds) {
      const inventory = await this.storage.getVolumeSyncInventory(volumeId);
      for (const eventHash of inventory.eventHashes) {
        await this.recordSyntheticObservation({
          kind: 'event',
          hash: eventHash,
          volumeId,
          relativePath: `channels/${volumeId}/${eventHash}.bin`,
          sourceId: 'seed',
        });
      }
      for (const blockHash of inventory.blockHashes) {
        await this.recordSyntheticObservation({
          kind: 'block',
          hash: blockHash,
          relativePath: `blocks/${blockHash}.bin`,
          sourceId: 'seed',
        });
      }
    }
  }

  private async recordSyntheticObservation(input: {
    readonly kind: ProviderObservedObjectKind;
    readonly hash: string;
    readonly relativePath: string;
    readonly sourceId: string;
    readonly volumeId?: string;
  }): Promise<void> {
    const key = observationKey(input.kind, input.hash);
    if (this.observationKeys.has(key)) {
      return;
    }
    const observation: ProviderQueueObservation = {
      observationId: '',
      prevObservationId: null,
      kind: input.kind,
      hash: input.hash,
      relativePath: input.relativePath,
      sourceId: input.sourceId,
      observedAt: Date.now(),
      volumeId: input.volumeId,
    };
    const stored = this.toStoredObservation(observation);
    this.observationKeys.add(key);
    this.state = {
      ...this.state,
      observations: [...this.state.observations, stored],
    };
    await this.persistState();
  }

  private async upsertRouteState(
    provider: string,
    routeKey: string,
    build: (current: ProviderQueueRouteState) => ProviderQueueRouteState
  ): Promise<ProviderQueueRouteState> {
    const current = this.getRouteState(provider, routeKey);
    const next = build(current);
    const routes = this.state.routes.filter((entry) => !(entry.provider === provider && entry.routeKey === routeKey));
    this.state = {
      ...this.state,
      routes: [...routes, next].sort(compareRouteStates),
    };
    await this.persistState();
    return next;
  }

  private async loadState(): Promise<ProviderQueueState> {
    try {
      const raw = JSON.parse(await fs.readFile(this.statePath, 'utf8')) as Partial<ProviderQueueState>;
      return {
        version: PROVIDER_QUEUE_SCHEMA_VERSION,
        observations: Array.isArray(raw.observations)
          ? raw.observations
              .filter(isStoredProviderQueueObservation)
              .sort((left, right) => left.order - right.order)
          : [],
        routes: Array.isArray(raw.routes)
          ? raw.routes.filter(isProviderQueueRouteState).sort(compareRouteStates)
          : [],
      };
    } catch {
      return {
        version: PROVIDER_QUEUE_SCHEMA_VERSION,
        observations: [],
        routes: [],
      };
    }
  }

  private async persistState(): Promise<void> {
    const serialized = `${JSON.stringify(this.state, null, 2)}\n`;
    this.writeChain = this.writeChain
      .catch(() => undefined)
      .then(() => writeFileAtomicallyWithRenameFallback(this.statePath, serialized));
    await this.writeChain;
  }

  private indexAfterObservationId(afterObservationId: string | null | undefined): number {
    if (!afterObservationId) {
      return 0;
    }
    const index = this.state.observations.findIndex((entry) => entry.observationId === afterObservationId);
    return index >= 0 ? index + 1 : 0;
  }

  private toStoredObservation(observation: ProviderQueueObservation): StoredProviderQueueObservation {
    const prevObservationId = this.getHeadObservationId();
    const order = this.state.observations.length + 1;
    const observedAt = observation.observedAt;
    const normalized: ProviderQueueObservation = {
      ...observation,
      prevObservationId,
      observedAt,
      observationId: computeObservationId({
        prevObservationId,
        kind: observation.kind,
        hash: observation.hash,
        volumeId: observation.volumeId,
        relativePath: observation.relativePath,
        sourceId: observation.sourceId,
        observedAt,
      }),
    };
    return {
      ...normalized,
      order,
    };
  }

  private publishObservation(observation: ProviderQueueObservation): void {
    for (const listener of this.observationListeners) {
      try {
        listener(observation);
      } catch {
        // Listener failures must not break queue persistence.
      }
    }
  }
}

function observationFromStorageWrite(
  event: StorageWriteEvent
): ProviderQueueObservation | null {
  const parsedEvent = parseCanonicalEventRelativePath(event.path);
  if (parsedEvent) {
    return {
      observationId: '',
      prevObservationId: null,
      kind: 'event',
      hash: parsedEvent.eventHash,
      volumeId: parsedEvent.volumeId,
      relativePath: event.path,
      sourceId: event.sourceId,
      observedAt: Date.now(),
    };
  }
  const parsedBlock = parseCanonicalBlockRelativePath(event.path);
  if (parsedBlock) {
    return {
      observationId: '',
      prevObservationId: null,
      kind: 'block',
      hash: parsedBlock.hash,
      relativePath: event.path,
      sourceId: event.sourceId,
      observedAt: Date.now(),
    };
  }
  return null;
}

function observationKey(kind: ProviderObservedObjectKind, hash: string): string {
  return `${kind}:${hash}`;
}

function normalizeVolumeFilter(volumeIds: readonly string[] | undefined): Set<string> | null {
  if (!volumeIds || volumeIds.length === 0) {
    return null;
  }
  return new Set(volumeIds.map((entry) => entry.trim()).filter((entry) => entry !== ''));
}

function matchesVolumeFilter(entry: ProviderQueueObservation, volumeFilter: Set<string> | null): boolean {
  if (!volumeFilter) {
    return true;
  }
  return Boolean(entry.volumeId && volumeFilter.has(entry.volumeId));
}

function isProviderQueueObservation(value: unknown): value is ProviderQueueObservation {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<ProviderQueueObservation>;
  return (
    typeof candidate.observationId === 'string' &&
    /^[0-9a-f]{64}$/.test(candidate.observationId) &&
    (candidate.prevObservationId === null ||
      (typeof candidate.prevObservationId === 'string' && /^[0-9a-f]{64}$/.test(candidate.prevObservationId))) &&
    (candidate.kind === 'event' || candidate.kind === 'block') &&
    typeof candidate.hash === 'string' &&
    candidate.hash.trim() !== '' &&
    typeof candidate.relativePath === 'string' &&
    candidate.relativePath.trim() !== '' &&
    typeof candidate.sourceId === 'string' &&
    candidate.sourceId.trim() !== '' &&
    typeof candidate.observedAt === 'number' &&
    Number.isFinite(candidate.observedAt) &&
    (candidate.volumeId === undefined || typeof candidate.volumeId === 'string')
  );
}

function isStoredProviderQueueObservation(value: unknown): value is StoredProviderQueueObservation {
  if (!isProviderQueueObservation(value)) {
    return false;
  }
  const candidate = value as Partial<StoredProviderQueueObservation>;
  return typeof candidate.order === 'number' && Number.isInteger(candidate.order) && candidate.order > 0;
}

function isProviderQueueRouteState(value: unknown): value is ProviderQueueRouteState {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<ProviderQueueRouteState>;
  return (
    typeof candidate.provider === 'string' &&
    candidate.provider.trim() !== '' &&
    typeof candidate.routeKey === 'string' &&
    candidate.routeKey.trim() !== '' &&
    (candidate.lastAckedObservationId === null ||
      (typeof candidate.lastAckedObservationId === 'string' && /^[0-9a-f]{64}$/.test(candidate.lastAckedObservationId))) &&
    (candidate.lastAttemptedObservationId === null ||
      (typeof candidate.lastAttemptedObservationId === 'string' &&
        /^[0-9a-f]{64}$/.test(candidate.lastAttemptedObservationId))) &&
    typeof candidate.updatedAt === 'number'
  );
}

function compareRouteStates(left: ProviderQueueRouteState, right: ProviderQueueRouteState): number {
  return left.provider.localeCompare(right.provider) || left.routeKey.localeCompare(right.routeKey);
}

export function queueObservationObjectId(observation: ProviderQueueObservation): ProviderObservedObjectRef {
  return {
    kind: observation.kind,
    hash: observation.hash,
  };
}

function stripStoredObservation(observation: StoredProviderQueueObservation): ProviderQueueObservation {
  const { order: _order, ...rest } = observation;
  return rest;
}

function computeObservationId(input: {
  readonly prevObservationId: string | null;
  readonly kind: ProviderObservedObjectKind;
  readonly hash: string;
  readonly volumeId?: string;
  readonly relativePath: string;
  readonly sourceId: string;
  readonly observedAt: number;
}): string {
  const canonical = JSON.stringify({
    prevObservationId: input.prevObservationId,
    kind: input.kind,
    hash: input.hash,
    volumeId: input.volumeId ?? null,
    relativePath: input.relativePath,
    sourceId: input.sourceId,
    observedAt: input.observedAt,
  });
  return createHash('sha256').update(canonical).digest('hex');
}
