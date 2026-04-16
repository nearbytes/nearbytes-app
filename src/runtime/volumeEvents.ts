import { normalizeVolumeId } from '../storage/integrity.js';

// Shared semantic event path per docs/specs/transport/runtime-volume-events-v0.1.md.
export type RuntimeVolumeEventProducer = 'filesystem' | 'lan' | 'mega';
export type RuntimeVolumeEventKind = 'filesystem-change' | 'timeline-advanced';

export interface RuntimeVolumeEventReady {
  readonly volumeId: string;
  readonly autoUpdate: boolean;
  readonly mode: 'semantic' | 'none';
  readonly protocol: 'nb.volume.event.v0.1';
}

export interface RuntimeVolumeEvent {
  readonly p: 'nb.volume.event.v0.1';
  readonly volumeId: string;
  readonly sequence: number;
  readonly producer: RuntimeVolumeEventProducer;
  readonly kind: RuntimeVolumeEventKind;
  readonly timestamp: number;
  readonly paths?: readonly string[];
  readonly eventHashes?: readonly string[];
  readonly nextCursor?: string | null;
  readonly invalidate: {
    readonly files: boolean;
    readonly timeline: boolean;
    readonly chat: boolean;
  };
}

export interface RuntimeVolumeEventInput {
  readonly volumeId: string;
  readonly producer: RuntimeVolumeEventProducer;
  readonly kind: RuntimeVolumeEventKind;
  readonly timestamp?: number;
  readonly paths?: readonly string[];
  readonly eventHashes?: readonly string[];
  readonly nextCursor?: string | null;
  readonly invalidate?: Partial<RuntimeVolumeEvent['invalidate']>;
}

export interface RuntimeVolumeEventSubscription {
  readonly ready: RuntimeVolumeEventReady;
  unsubscribe(): void;
}

export interface RuntimeVolumeEventPublisher {
  publish(event: RuntimeVolumeEventInput): void;
}

export class VolumeEventBus implements RuntimeVolumeEventPublisher {
  private readonly subscribers = new Map<string, Map<number, (event: RuntimeVolumeEvent) => void>>();
  private nextSubscriberId = 1;
  private sequence = 0;

  subscribe(volumeId: string, onEvent: (event: RuntimeVolumeEvent) => void): RuntimeVolumeEventSubscription {
    const normalizedVolumeId = normalizeVolumeId(volumeId);
    if (!normalizedVolumeId) {
      return {
        ready: {
          volumeId,
          autoUpdate: false,
          mode: 'none',
          protocol: 'nb.volume.event.v0.1',
        },
        unsubscribe() {
          // No-op.
        },
      };
    }

    const subscriberId = this.nextSubscriberId++;
    let bucket = this.subscribers.get(normalizedVolumeId);
    if (!bucket) {
      bucket = new Map();
      this.subscribers.set(normalizedVolumeId, bucket);
    }
    bucket.set(subscriberId, onEvent);

    return {
      ready: {
        volumeId: normalizedVolumeId,
        autoUpdate: true,
        mode: 'semantic',
        protocol: 'nb.volume.event.v0.1',
      },
      unsubscribe: () => {
        const currentBucket = this.subscribers.get(normalizedVolumeId);
        if (!currentBucket) {
          return;
        }
        currentBucket.delete(subscriberId);
        if (currentBucket.size === 0) {
          this.subscribers.delete(normalizedVolumeId);
        }
      },
    };
  }

  publish(event: RuntimeVolumeEventInput): void {
    const normalizedVolumeId = normalizeVolumeId(event.volumeId);
    if (!normalizedVolumeId) {
      return;
    }
    const bucket = this.subscribers.get(normalizedVolumeId);
    if (!bucket || bucket.size === 0) {
      return;
    }
    const emitted: RuntimeVolumeEvent = {
      p: 'nb.volume.event.v0.1',
      volumeId: normalizedVolumeId,
      sequence: ++this.sequence,
      producer: event.producer,
      kind: event.kind,
      timestamp: event.timestamp ?? Date.now(),
      paths: normalizeValues(event.paths),
      eventHashes: normalizeValues(event.eventHashes),
      nextCursor: normalizeOptional(event.nextCursor),
      invalidate: {
        files: event.invalidate?.files !== false,
        timeline: event.invalidate?.timeline !== false,
        chat: event.invalidate?.chat !== false,
      },
    };
    for (const subscriber of bucket.values()) {
      subscriber(emitted);
    }
  }
}

function normalizeValues(values: readonly string[] | undefined): readonly string[] | undefined {
  if (!values || values.length === 0) {
    return undefined;
  }
  const normalized = values.map((value) => value.trim()).filter((value) => value.length > 0);
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeOptional(value: string | null | undefined): string | null | undefined {
  if (value === null) {
    return null;
  }
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}