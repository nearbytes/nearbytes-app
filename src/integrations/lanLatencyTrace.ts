export interface LanLatencyTracePoint {
  readonly stage: string;
  readonly at: number;
  readonly detail?: string;
}

export interface LanLatencyTraceEntry {
  readonly eventHash: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly points: LanLatencyTracePoint[];
}

const TRACE_RETENTION_MS = 5 * 60_000;
const TRACE_LIMIT = 512;

const traces = new Map<string, LanLatencyTraceEntry>();

function prune(now: number): void {
  for (const [eventHash, entry] of traces) {
    if (now - entry.updatedAt > TRACE_RETENTION_MS) {
      traces.delete(eventHash);
    }
  }
  while (traces.size > TRACE_LIMIT) {
    const firstKey = traces.keys().next().value;
    if (!firstKey) {
      break;
    }
    traces.delete(firstKey);
  }
}

export function recordLanLatencyTrace(eventHash: string | null | undefined, stage: string, detail?: string): void {
  if (!eventHash || eventHash.trim().length === 0) {
    return;
  }
  const normalizedEventHash = eventHash.trim();
  const now = Date.now();
  const existing = traces.get(normalizedEventHash);
  const point: LanLatencyTracePoint = { stage, at: now, detail };
  if (existing) {
    traces.set(normalizedEventHash, {
      ...existing,
      updatedAt: now,
      points: [...existing.points, point],
    });
  } else {
    traces.set(normalizedEventHash, {
      eventHash: normalizedEventHash,
      createdAt: now,
      updatedAt: now,
      points: [point],
    });
  }
  prune(now);
}

export function listLanLatencyTraces(): LanLatencyTraceEntry[] {
  prune(Date.now());
  return Array.from(traces.values()).sort((left, right) => right.updatedAt - left.updatedAt);
}

export function clearLanLatencyTraces(): void {
  traces.clear();
}