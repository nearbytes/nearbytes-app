/**
 * Sync protocol debug trace — bridges nearbytes-sync's structured wire frames
 * and lifecycle event bus into a single normalized, ring-buffered stream for
 * the renderer's sequence-diagram debug modal.
 *
 * Wire-level capture goes through `engine.syncTraceEnable`/`Disable`, which
 * mutate the same `TraceDestination` object threaded by reference into the
 * live sync engine's `start()` (TRACE-04) — no module-global mutation, no
 * dependence on which physical copy of `nearbytes-sync` node_modules happens
 * to hoist into. See `sync-tracing-v1.md` §1 for why the previous approach
 * (poking `configureSyncDebug` on a hand-picked nested copy) was fragile: it
 * broke the moment node_modules deduped down to a single copy.
 *
 * Frames arrive as structured `WireFrame`s (TRACE-10/11) — this module never
 * parses a message string back apart. `detail`/`outcome` below are display
 * conveniences derived from `data`, not the source of truth.
 */
import type { NearbytesEngine } from 'nearbytes-engine';
import type { WireFrame, WireLayer } from 'nearbytes-sync/node';

export type SyncDebugLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace';

export interface SyncFrame {
  readonly seq: number;
  readonly at: number;
  readonly assoc: string;
  readonly dir: 'out' | 'in' | 'local';
  readonly phase: WireLayer | 'closed';
  readonly level: SyncDebugLevel;
  readonly msg: string;
  readonly detail: string;
  readonly outcome?: 'ok' | 'rejected' | 'suppressed' | 'missing-local' | 'failed';
  readonly bytes?: number;
  /** Full protocol-significant payload (TRACE-15/24) — `detail` is a trimmed display rendering of this. */
  readonly data?: Readonly<Record<string, unknown>>;
  /** Remote profile public key (lower-case hex), when known — which peer this frame is about. */
  readonly remoteProfile?: string;
}

type SyncEventLike = {
  readonly kind: string;
  readonly at: number;
  readonly transportLabel?: string;
  readonly reason?: string;
  readonly remoteInstancePublicKey?: string;
  readonly remotePeerId?: string;
  readonly bytes?: number;
  readonly remoteProfilePublicKey?: string;
  readonly toProfile?: string;
  readonly fromProfile?: string;
  /** Object identity — required for want↔arrival correlation and the object inspector. */
  readonly blockHash?: string;
  readonly eventHash?: string;
};

type RtWithSync = {
  rt: {
    skeleton: {
      sync: {
        onEvent(h: (e: SyncEventLike) => void): () => void;
        recentEvents(): readonly SyncEventLike[];
      };
    };
  };
};

const MAX_FRAMES = 2000;
const FLUSH_MS = 100;
const BURST_WINDOW_MS = 1000;
const BURST_THRESHOLD = 5;

let seq = 0;
let frames: SyncFrame[] = [];
let unsubscribeEvents: (() => void) | undefined;
let flushTimer: ReturnType<typeof setInterval> | undefined;
let pending: SyncFrame[] = [];
let onFlush: ((batch: readonly SyncFrame[]) => void) | undefined;

// Burst coalescing state, keyed by `${layer}:${msg}:${dir}`.
const burstState = new Map<string, { count: number; windowStart: number }>();

/**
 * Renders `data` as a single display line — for the UI only, never re-parsed.
 * Long arrays (e.g. `hashes`, TRACE-24) collapse to a count here; the full
 * list still travels in the frame's `data` for a future object inspector.
 */
function formatData(data: WireFrame['data']): string {
  if (data === undefined) return '';
  return Object.entries(data)
    .map(([k, v]) => {
      if (Array.isArray(v) && v.length > 4) return `${k}=[${v.length}]`;
      return `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`;
    })
    .join(' ');
}

/** Derives a display outcome from the frame's real reason/code, not string sniffing. */
function classifyOutcome(frame: WireFrame): SyncFrame['outcome'] {
  const data = frame.data ?? {};
  const reason = (data['reason'] as string | undefined) ?? (data['code'] as string | undefined);
  if (frame.msg.endsWith('-rejected') || reason?.includes('reject')) return 'rejected';
  if (
    reason === 'deduped' ||
    reason?.includes('duplicate') ||
    reason?.includes('stray') ||
    data['suppressed'] === true
  ) {
    return 'suppressed';
  }
  if (
    reason === 'refs-unavailable' ||
    reason === 'all-refs-unavailable' ||
    ((data['missingLocal'] as number | undefined) ?? 0) > 0
  ) {
    return 'missing-local';
  }
  if (frame.level === 'warn' || frame.level === 'error') return 'failed';
  return 'ok';
}

function pushFrame(frame: SyncFrame, alsoPending = true): void {
  frames.push(frame);
  if (frames.length > MAX_FRAMES) frames = frames.slice(frames.length - MAX_FRAMES);
  if (alsoPending) pending.push(frame);
}

function handleWireFrame(frame: WireFrame): void {
  const now = Date.now();
  const assoc = frame.assoc ?? frame.remoteInstance ?? frame.remoteProfile ?? 'active';
  // TRACE-62: coalescing may compress a burst of *like* frames, but must not
  // discard correlation-relevant payload. Keying on layer+msg+dir alone merged
  // genuinely distinct rows — e.g. the one-per-friend `friend-configured`
  // frames, which all share a key and arrive in the same millisecond, leaving a
  // single friend visible out of four. Peer identity is part of the key, and
  // config frames (node state, emitted once) are never coalesced at all.
  const coalescable = frame.layer !== 'config';
  const key = `${frame.layer}:${frame.msg}:${frame.dir}:${assoc}`;
  const state = coalescable ? burstState.get(key) : undefined;
  if (state && now - state.windowStart < BURST_WINDOW_MS) {
    state.count += 1;
    return;
  }
  if (state && state.count > BURST_THRESHOLD) {
    // Flush the coalesced marker for the previous burst before starting a new one.
    pushFrame({
      seq: seq++,
      at: now,
      assoc,
      dir: frame.dir,
      phase: frame.layer,
      level: frame.level,
      msg: `${frame.msg} ×${state.count}`,
      detail: 'coalesced burst',
      outcome: 'suppressed',
    });
  }
  if (coalescable) burstState.set(key, { count: 1, windowStart: now });
  pushFrame({
    seq: seq++,
    at: frame.at,
    assoc,
    dir: frame.dir,
    phase: frame.layer,
    level: frame.level,
    msg: frame.msg,
    detail: formatData(frame.data),
    outcome: classifyOutcome(frame),
    data: frame.data,
    remoteProfile: frame.remoteProfile,
  });
}

function handleSyncEvent(event: SyncEventLike, live = true): void {
  const assoc = event.remoteInstancePublicKey ?? event.remotePeerId ?? 'unknown';
  const remoteProfile = event.remoteProfilePublicKey ?? event.toProfile ?? event.fromProfile;
  const now = event.at;
  switch (event.kind) {
    case 'peer-connected':
      pushFrame({
        seq: seq++, at: now, assoc, dir: 'local', phase: 'discovery', level: 'info',
        msg: 'conn', detail: `via ${event.transportLabel ?? '?'}`, outcome: 'ok', remoteProfile,
      }, live);
      break;
    case 'peer-connect-failed':
      pushFrame({
        seq: seq++, at: now, assoc, dir: 'local', phase: 'discovery', level: 'warn',
        msg: 'conn', detail: `${event.reason ?? 'failed'} via ${event.transportLabel ?? '?'}`, outcome: 'failed', remoteProfile,
      }, live);
      break;
    case 'peer-stalled':
      pushFrame({
        seq: seq++, at: now, assoc, dir: 'local', phase: 'closed', level: 'warn',
        msg: 'stall', detail: event.reason ?? '', outcome: 'failed', remoteProfile,
      }, live);
      break;
    case 'peer-disconnected':
      pushFrame({
        seq: seq++, at: now, assoc, dir: 'local', phase: 'closed', level: 'info',
        msg: 'disconnect', detail: event.transportLabel ?? '', outcome: 'ok', remoteProfile,
      }, live);
      break;
    case 'block-sent':
    case 'block-received':
    case 'event-received': {
      // The object hash is what closes the want-armed ↔ arrival pair and what
      // the object inspector keys on. Without it every want stays outstanding
      // forever and no object ever reaches `arrived`.
      const hash = event.blockHash ?? event.eventHash;
      pushFrame({
        seq: seq++, at: now, assoc,
        dir: event.kind === 'block-sent' ? 'out' : 'in',
        phase: 'block', level: 'debug', msg: event.kind,
        detail: hash === undefined
          ? `${event.bytes ?? 0} B`
          : `hash=${hash.slice(0, 12)}… bytes=${event.bytes ?? 0}`,
        outcome: 'ok', bytes: event.bytes, remoteProfile,
        ...(hash !== undefined
          ? { data: { hash, bytes: event.bytes ?? 0, corrId: hash, corrKind: 'hash' } }
          : {}),
      }, live);
      break;
    }
  }
}

export async function startSyncTrace(
  engine: NearbytesEngine,
  emit: (batch: readonly SyncFrame[]) => void,
): Promise<void> {
  onFlush = emit;
  // trace = capture everything; the modal itself filters by level client-side.
  engine.syncTraceEnable(handleWireFrame, 'trace');

  const rt = (engine as unknown as RtWithSync).rt;
  // Backfill the backlog so the modal isn't empty on first paint if peers
  // connected before the trace was toggled on (recentEvents() is a bounded
  // ring buffer the sync engine keeps regardless of whether anyone's watching).
  if (frames.length === 0) {
    for (const e of rt.skeleton.sync.recentEvents()) handleSyncEvent(e, false);
  }
  unsubscribeEvents = rt.skeleton.sync.onEvent(handleSyncEvent);

  flushTimer = setInterval(() => {
    if (pending.length === 0 || onFlush === undefined) return;
    onFlush(pending);
    pending = [];
  }, FLUSH_MS);
}

export function stopSyncTrace(engine: NearbytesEngine): void {
  engine.syncTraceDisable();
  unsubscribeEvents?.();
  unsubscribeEvents = undefined;
  if (flushTimer !== undefined) clearInterval(flushTimer);
  flushTimer = undefined;
  onFlush = undefined;
  pending = [];
}

export function syncTraceSnapshot(): readonly SyncFrame[] {
  return frames;
}
