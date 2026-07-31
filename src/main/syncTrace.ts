/**
 * Sync protocol debug trace — bridges nearbytes-sync's lifecycle event bus
 * and wire-level debug lines into a single normalized, ring-buffered stream
 * for the renderer's sequence-diagram debug modal.
 *
 * Wire-level capture goes through `engine.syncTraceEnable`/`Disable`, which
 * mutate the same `TraceDestination` object threaded by reference into the
 * live sync engine's `start()` (TRACE-04) — no module-global mutation, no
 * dependence on which physical copy of `nearbytes-sync` node_modules happens
 * to hoist into. See `sync-tracing-v1.md` §1 for why the previous approach
 * (poking `configureSyncDebug` on a hand-picked nested copy) was fragile: it
 * broke the moment node_modules deduped down to a single copy.
 */
import type { NearbytesEngine } from 'nearbytes-engine';

export type SyncDebugLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace';

export interface SyncFrame {
  readonly seq: number;
  readonly at: number;
  readonly assoc: string;
  readonly dir: 'out' | 'in' | 'local';
  readonly phase: 'discovery' | 'handshake' | 'attach' | 'anti-entropy' | 'closed';
  readonly level: SyncDebugLevel;
  readonly msg: string;
  readonly detail: string;
  readonly outcome?: 'ok' | 'rejected' | 'suppressed' | 'missing-local' | 'failed';
  readonly bytes?: number;
}

type SyncEventLike = {
  readonly kind: string;
  readonly at: number;
  readonly transportLabel?: string;
  readonly reason?: string;
  readonly remoteInstancePublicKey?: string;
  readonly remotePeerId?: string;
  readonly bytes?: number;
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

// Burst coalescing state for the "wire" scope, keyed by `${msg}:${dir}`.
const burstState = new Map<string, { count: number; windowStart: number }>();

/**
 * Every wire line is prefixed with the actual protocol message name (hello,
 * subscribe, delta, have, want, attach, session, resume, duplicate) — see
 * `nearbytes-sync/src/core/{handshake,peerLoop,friendSessions}.ts` and
 * `node/start.ts`. Dispatch on that word rather than string-sniffing content.
 */
const PHASE_BY_MSG: Record<string, SyncFrame['phase']> = {
  hello: 'handshake',
  subscribe: 'attach',
  attach: 'attach',
  delta: 'attach',
  resume: 'attach',
  session: 'attach',
  duplicate: 'attach',
  have: 'anti-entropy',
  want: 'anti-entropy',
  data: 'anti-entropy',
};

function classifyWirePhase(msg: string): SyncFrame['phase'] {
  return PHASE_BY_MSG[msg] ?? 'anti-entropy';
}

function classifyWireOutcome(line: string): SyncFrame['outcome'] {
  if (line.includes('reject')) return 'rejected';
  if (line.includes('deduped') || line.includes('ignored') || line.includes('skipped')) return 'suppressed';
  if (line.includes('missing-local')) return 'missing-local';
  return 'ok';
}

function pushFrame(frame: SyncFrame, alsoPending = true): void {
  frames.push(frame);
  if (frames.length > MAX_FRAMES) frames = frames.slice(frames.length - MAX_FRAMES);
  if (alsoPending) pending.push(frame);
}

function handleWireLine(scope: string, level: SyncDebugLevel, line: string): void {
  if (scope !== 'wire') return;
  const now = Date.now();
  const msg = line.split(/\s+/, 1)[0] ?? line;
  // Coalesce key includes direction so a burst of outbound `have` pages
  // doesn't merge with a burst of inbound ones.
  const dir = line.includes('←') ? 'in' : line.includes('→') ? 'out' : 'local';
  const key = `${msg}:${dir}`;
  const state = burstState.get(key);
  if (state && now - state.windowStart < BURST_WINDOW_MS) {
    state.count += 1;
    return;
  }
  if (state && state.count > BURST_THRESHOLD) {
    // Flush the coalesced marker for the previous burst before starting a new one.
    pushFrame({
      seq: seq++,
      at: now,
      assoc: 'active',
      dir: dir as SyncFrame['dir'],
      phase: classifyWirePhase(msg),
      level,
      msg: `${msg} ×${state.count}`,
      detail: 'coalesced burst',
      outcome: 'suppressed',
    });
  }
  burstState.set(key, { count: 1, windowStart: now });
  pushFrame({
    seq: seq++,
    at: now,
    assoc: 'active',
    dir: dir as SyncFrame['dir'],
    phase: classifyWirePhase(msg),
    level,
    msg,
    detail: line,
    outcome: classifyWireOutcome(line),
  });
}

function handleSyncEvent(event: SyncEventLike, live = true): void {
  const assoc = event.remoteInstancePublicKey ?? event.remotePeerId ?? 'unknown';
  const now = event.at;
  switch (event.kind) {
    case 'peer-connected':
      pushFrame({
        seq: seq++, at: now, assoc, dir: 'local', phase: 'discovery', level: 'info',
        msg: 'conn', detail: `via ${event.transportLabel ?? '?'}`, outcome: 'ok',
      }, live);
      break;
    case 'peer-connect-failed':
      pushFrame({
        seq: seq++, at: now, assoc, dir: 'local', phase: 'discovery', level: 'warn',
        msg: 'conn', detail: `${event.reason ?? 'failed'} via ${event.transportLabel ?? '?'}`, outcome: 'failed',
      }, live);
      break;
    case 'peer-stalled':
      pushFrame({
        seq: seq++, at: now, assoc, dir: 'local', phase: 'closed', level: 'warn',
        msg: 'stall', detail: event.reason ?? '', outcome: 'failed',
      }, live);
      break;
    case 'peer-disconnected':
      pushFrame({
        seq: seq++, at: now, assoc, dir: 'local', phase: 'closed', level: 'info',
        msg: 'disconnect', detail: event.transportLabel ?? '', outcome: 'ok',
      }, live);
      break;
    case 'block-sent':
    case 'block-received':
    case 'event-received':
      pushFrame({
        seq: seq++, at: now, assoc,
        dir: event.kind === 'block-sent' ? 'out' : 'in',
        phase: 'anti-entropy', level: 'debug', msg: event.kind, detail: `${event.bytes ?? 0} B`,
        outcome: 'ok', bytes: event.bytes,
      }, live);
      break;
  }
}

export async function startSyncTrace(
  engine: NearbytesEngine,
  emit: (batch: readonly SyncFrame[]) => void,
): Promise<void> {
  onFlush = emit;
  // trace = capture everything; the modal itself filters by level client-side.
  engine.syncTraceEnable(handleWireLine, 'trace');

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
