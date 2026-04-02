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

const PROVIDER_QUEUE_SCHEMA_VERSION = 1 as const;
const DEFAULT_PAGE_LIMIT = 512;

interface ProviderQueueState {
  readonly version: typeof PROVIDER_QUEUE_SCHEMA_VERSION;
  readonly observations: ProviderQueueObservation[];
  readonly routes: ProviderQueueRouteState[];
}

export interface ProviderQueueObservationPage {
  readonly observations: ProviderQueueObservation[];
  readonly headSequence: number;
}

export class PersistentProviderQueue {
  private readonly statePath: string;
  private state: ProviderQueueState = {
    version: PROVIDER_QUEUE_SCHEMA_VERSION,
    observations: [],
    routes: [],
  };
  private observationKeys = new Set<string>();
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
    await this.writeChain.catch(() => undefined);
  }

  getHeadSequence(): number {
    return this.state.observations.at(-1)?.sequence ?? 0;
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
    readonly afterSequence?: number;
    readonly volumeIds?: readonly string[];
    readonly limit?: number;
  } = {}): ProviderQueueObservationPage {
    const afterSequence = Math.max(0, options.afterSequence ?? 0);
    const limit = Math.max(1, Math.min(DEFAULT_PAGE_LIMIT, options.limit ?? DEFAULT_PAGE_LIMIT));
    const volumeFilter = normalizeVolumeFilter(options.volumeIds);
    const observations = this.state.observations
      .filter((entry) => entry.sequence > afterSequence)
      .filter((entry) => matchesVolumeFilter(entry, volumeFilter))
      .slice(0, limit);
    return {
      observations,
      headSequence: this.getHeadSequence(),
    };
  }

  getRouteState(provider: string, routeKey: string): ProviderQueueRouteState {
    return (
      this.state.routes.find((entry) => entry.provider === provider && entry.routeKey === routeKey) ?? {
        provider,
        routeKey,
        lastAckedSequence: 0,
        lastAttemptedSequence: 0,
        updatedAt: 0,
      }
    );
  }

  async noteRouteAttempt(provider: string, routeKey: string, sequence: number): Promise<ProviderQueueRouteState> {
    return this.upsertRouteState(provider, routeKey, (current) => ({
      provider,
      routeKey,
      lastAckedSequence: current.lastAckedSequence,
      lastAttemptedSequence: Math.max(current.lastAttemptedSequence, sequence),
      updatedAt: Date.now(),
    }));
  }

  async acknowledgeRoute(provider: string, routeKey: string, sequence: number): Promise<ProviderQueueRouteState> {
    return this.upsertRouteState(provider, routeKey, (current) => ({
      provider,
      routeKey,
      lastAckedSequence: Math.max(current.lastAckedSequence, sequence),
      lastAttemptedSequence: Math.max(current.lastAttemptedSequence, sequence),
      updatedAt: Date.now(),
    }));
  }

  async recordStorageWrite(event: StorageWriteEvent): Promise<ProviderQueueObservation | null> {
    const candidate = observationFromStorageWrite(event, this.getHeadSequence() + 1);
    if (!candidate) {
      return null;
    }
    const key = observationKey(candidate.kind, candidate.hash);
    if (this.observationKeys.has(key)) {
      return null;
    }
    this.observationKeys.add(key);
    this.state = {
      ...this.state,
      observations: [...this.state.observations, candidate],
    };
    await this.persistState();
    return candidate;
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
      sequence: this.getHeadSequence() + 1,
      kind: input.kind,
      hash: input.hash,
      relativePath: input.relativePath,
      sourceId: input.sourceId,
      observedAt: Date.now(),
      volumeId: input.volumeId,
    };
    this.observationKeys.add(key);
    this.state = {
      ...this.state,
      observations: [...this.state.observations, observation],
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
          ? raw.observations.filter(isProviderQueueObservation).sort((left, right) => left.sequence - right.sequence)
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
}

function observationFromStorageWrite(
  event: StorageWriteEvent,
  sequence: number
): ProviderQueueObservation | null {
  const parsedEvent = parseCanonicalEventRelativePath(event.path);
  if (parsedEvent) {
    return {
      sequence,
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
      sequence,
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
    typeof candidate.sequence === 'number' &&
    Number.isInteger(candidate.sequence) &&
    candidate.sequence > 0 &&
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
    typeof candidate.lastAckedSequence === 'number' &&
    typeof candidate.lastAttemptedSequence === 'number' &&
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
