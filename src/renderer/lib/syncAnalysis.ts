/**
 * Trace analysis: correlation, object lifecycle, invariants, association state.
 *
 * Everything here is a **pure projection over the frame stream** — no engine
 * introspection (TRACE-40). That is what makes the same analysis work on a
 * live session and on an imported JSONL trace (TRACE-51).
 *
 * A note on the design that runs through this whole file: every analysis is
 * *enumerable when empty*. The layer table lists all seven layers even at zero
 * frames, the invariant table lists every rule even when none has ever fired,
 * and the correlator reports "0 outstanding" rather than rendering nothing. A
 * panel that disappears when idle cannot be distinguished from a panel that is
 * broken, which is precisely the failure mode this debugger exists to remove.
 */
import type { SyncFrame } from './syncFrame.js';

// ── layers ────────────────────────────────────────────────────────────────

/** The seven layers `sync-tracing-v1.md` §3 requires coverage for (TRACE-20). */
export const LAYERS = [
  'config',
  'discovery',
  'transport',
  'handshake',
  'session',
  'anti-entropy',
  'block',
] as const;
export type Layer = (typeof LAYERS)[number];

export interface LayerStatus {
  readonly layer: Layer;
  /** Human label for the stack row. */
  readonly title: string;
  /** What this layer answers, shown as the row's subtitle. */
  readonly blurb: string;
  /** Spec rules governing it — rendered in the right margin. */
  readonly rules: string;
  readonly frames: number;
  readonly errors: number;
  readonly warnings: number;
  readonly lastAt: number | null;
  /**
   * `covered` once any frame has arrived; `armed` means instrumented and
   * watching but silent so far. TRACE-20 makes a permanently silent layer a
   * defect, so `armed` is a real state worth showing, not an absence.
   */
  readonly state: 'armed' | 'active' | 'quiet' | 'error';
}

const LAYER_META: Record<Layer, { title: string; blurb: string; rules: string }> = {
  config: {
    title: 'Config',
    blurb: 'friends & profiles this node is set up to serve',
    rules: 'TRACE-23',
  },
  discovery: {
    title: 'Discovery',
    blurb: 'topics joined, peers sighted via mDNS / DHT',
    rules: 'TRACE-20/23',
  },
  transport: {
    title: 'Transport',
    blurb: 'dial attempts, accepts, closes',
    rules: 'TRACE-20/22',
  },
  handshake: {
    title: 'Handshake',
    blurb: 'hello exchange, accept / reject reasons',
    rules: 'SYNC-02..08',
  },
  session: {
    title: 'Session',
    blurb: 'association registry, duplicate resolution, stalls',
    rules: 'SYNC-06',
  },
  'anti-entropy': {
    title: 'Anti-entropy',
    blurb: 'subscribe / delta / have / want paging',
    rules: 'SYNC-10..22',
  },
  block: {
    title: 'Block',
    blurb: 'block streams, want lifecycle, timeouts',
    rules: 'SYNC-14/18',
  },
};

/** Never-empty: returns a row for all seven layers regardless of traffic. */
export function layerStatuses(frames: readonly SyncFrame[], activeWindowMs = 10_000): LayerStatus[] {
  const now = Date.now();
  return LAYERS.map((layer) => {
    const meta = LAYER_META[layer];
    let count = 0;
    let errors = 0;
    let warnings = 0;
    let lastAt: number | null = null;
    for (const f of frames) {
      if (f.phase !== layer) continue;
      count += 1;
      if (f.level === 'error') errors += 1;
      else if (f.level === 'warn') warnings += 1;
      if (lastAt === null || f.at > lastAt) lastAt = f.at;
    }
    const state: LayerStatus['state'] =
      errors > 0
        ? 'error'
        : count === 0
          ? 'armed'
          : lastAt !== null && now - lastAt < activeWindowMs
            ? 'active'
            : 'quiet';
    return {
      layer,
      title: meta.title,
      blurb: meta.blurb,
      rules: meta.rules,
      frames: count,
      errors,
      warnings,
      lastAt,
      state,
    };
  });
}

// ── correlation (TRACE-30..33) ────────────────────────────────────────────

export interface PendingRequest {
  readonly corrId: string;
  readonly corrKind: string;
  readonly msg: string;
  readonly layer: string;
  readonly assoc: string;
  readonly at: number;
  readonly ageMs: number;
  /**
   * `overdue` — a response is owed. `unanswerable` — the peer never announced
   * this object, so SYNC-18 licenses silence and no reply is coming.
   *
   * Without this split every want for a block a partial replica simply does
   * not hold would age to red, and the view would report correct protocol
   * behaviour as a fault — burying the wants that genuinely are broken
   * promises (SYNC-18a).
   */
  readonly kind: 'overdue' | 'unanswerable';
}

export interface CorrelationReport {
  readonly matched: number;
  readonly unmatched: readonly PendingRequest[];
  /** Median round-trip over matched pairs, or null when nothing matched yet. */
  readonly medianRttMs: number | null;
}

/**
 * Requests are `out`/`local` frames carrying a corrId; responses are the
 * opposite-direction frame sharing that corrId. `want-armed` is deliberately
 * treated as a request even though it is `local`: the whole point is to show a
 * want that never produced a block.
 */
const REQUEST_MSGS = new Set(['hello', 'delta', 'subscribe', 'want', 'want-armed', 'attach']);
// `want-served` is deliberately absent: it reports answering the *remote's*
// want, so it is not a response to anything we sent.
const RESPONSE_MSGS = new Set([
  'hello-accepted',
  'hello-rejected',
  'hello-timeout',
  'have',
  'block-received',
  'event-received',
  'want-satisfied',
  'want-timeout',
  'data',
]);

export function correlate(frames: readonly SyncFrame[], now = Date.now()): CorrelationReport {
  // Hashes the peer advertised. A want against one of these is owed a reply;
  // a want against anything else may legitimately go unanswered (SYNC-18).
  const announcedByPeer = new Set<string>();
  for (const f of frames) {
    const hashes = f.data?.['hashes'];
    if (f.msg === 'have' && f.dir === 'in' && Array.isArray(hashes)) {
      for (const h of hashes) if (typeof h === 'string') announcedByPeer.add(h);
    }
  }
  const open = new Map<string, SyncFrame>();
  const rtts: number[] = [];
  let matched = 0;

  for (const f of frames) {
    const key = f.data?.['corrId'] ?? corrIdOf(f);
    if (typeof key !== 'string' || key.length === 0) continue;
    const id = `${f.assoc}::${key}`;
    if (RESPONSE_MSGS.has(f.msg) || (f.dir === 'in' && open.has(id))) {
      const req = open.get(id);
      if (req !== undefined) {
        matched += 1;
        rtts.push(f.at - req.at);
        open.delete(id);
        continue;
      }
    }
    if (REQUEST_MSGS.has(f.msg) && !open.has(id)) {
      open.set(id, f);
    }
  }

  const unmatched: PendingRequest[] = [...open.values()]
    .map((f) => {
      const id = corrIdOf(f) ?? '';
      const isHashWant = corrKindOf(f) === 'hash';
      return {
        corrId: id.slice(0, 16),
        corrKind: String(f.data?.['corrKind'] ?? corrKindOf(f) ?? '—'),
        msg: f.msg,
        layer: f.phase,
        assoc: f.assoc,
        at: f.at,
        ageMs: now - f.at,
        kind: (isHashWant && !announcedByPeer.has(id) ? 'unanswerable' : 'overdue') as PendingRequest['kind'],
      };
    })
    .sort((a, b) => (a.kind === b.kind ? b.ageMs - a.ageMs : a.kind === 'overdue' ? -1 : 1));

  rtts.sort((a, b) => a - b);
  const medianRttMs = rtts.length === 0 ? null : (rtts[Math.floor(rtts.length / 2)] ?? null);
  return { matched, unmatched, medianRttMs };
}

function corrIdOf(f: SyncFrame): string | undefined {
  const v = f.data?.['corrId'];
  return typeof v === 'string' ? v : undefined;
}
function corrKindOf(f: SyncFrame): string | undefined {
  const v = f.data?.['corrKind'];
  return typeof v === 'string' ? v : undefined;
}

// ── object inspector ──────────────────────────────────────────────────────

export interface ObjectRow {
  readonly hash: string;
  readonly announcedAt: number | null;
  readonly wantedAt: number | null;
  readonly arrivedAt: number | null;
  readonly bytes: number | null;
  readonly state: 'announced' | 'wanted' | 'in-flight' | 'arrived' | 'timed-out';
  readonly assoc: string;
}

/**
 * Per-hash lifecycle, built from `hashes[]` on have/want frames plus block
 * arrivals. This is the view that separates "we never asked for it" from "we
 * asked and it never came" — the distinction the want-timeout deadlock turns on.
 */
export function objectRows(frames: readonly SyncFrame[], limit = 500): ObjectRow[] {
  const rows = new Map<string, {
    announcedAt: number | null;
    wantedAt: number | null;
    arrivedAt: number | null;
    bytes: number | null;
    timedOut: boolean;
    assoc: string;
  }>();
  const touch = (hash: string, assoc: string) => {
    let r = rows.get(hash);
    if (r === undefined) {
      r = { announcedAt: null, wantedAt: null, arrivedAt: null, bytes: null, timedOut: false, assoc };
      rows.set(hash, r);
    }
    return r;
  };

  for (const f of frames) {
    const hashes = f.data?.['hashes'];
    if (Array.isArray(hashes)) {
      for (const h of hashes) {
        if (typeof h !== 'string') continue;
        const r = touch(h, f.assoc);
        if (f.msg === 'have' && r.announcedAt === null) r.announcedAt = f.at;
        if (f.msg === 'want' && r.wantedAt === null) r.wantedAt = f.at;
        if (f.msg === 'want-timeout') r.timedOut = true;
      }
    }
    const single = f.data?.['hash'];
    if (typeof single === 'string') {
      const r = touch(single, f.assoc);
      if (f.msg === 'want-armed' && r.wantedAt === null) r.wantedAt = f.at;
      if (f.msg === 'block-received' || f.msg === 'block-sent') {
        r.arrivedAt = f.at;
        const b = f.data?.['bytes'];
        if (typeof b === 'number') r.bytes = b;
      }
      if (f.msg === 'want-timeout') r.timedOut = true;
    }
  }

  const out: ObjectRow[] = [];
  for (const [hash, r] of rows) {
    const state: ObjectRow['state'] =
      r.arrivedAt !== null
        ? 'arrived'
        : r.timedOut
          ? 'timed-out'
          : r.wantedAt !== null
            ? 'in-flight'
            : r.announcedAt !== null
              ? 'announced'
              : 'wanted';
    out.push({ hash, ...r, state });
  }
  // Unresolved first — those are the interesting ones.
  const rank: Record<ObjectRow['state'], number> = {
    'timed-out': 0, 'in-flight': 1, wanted: 2, announced: 3, arrived: 4,
  };
  return out.sort((a, b) => rank[a.state] - rank[b.state] || (b.wantedAt ?? 0) - (a.wantedAt ?? 0)).slice(0, limit);
}

// ── invariant oracle (TRACE-40/41) ────────────────────────────────────────

export interface InvariantStatus {
  readonly id: string;
  readonly rule: string;
  /** What a violation would mean, shown whether or not it ever fires. */
  readonly checks: string;
  readonly violations: number;
  readonly lastAt: number | null;
  readonly detail: string | null;
  /** `watching` = armed and never tripped. Always shown, never hidden. */
  readonly state: 'watching' | 'ok' | 'violated';
}

interface InvariantDef {
  readonly id: string;
  readonly rule: string;
  readonly checks: string;
  /** Returns violation details, or an empty array when the trace is clean. */
  run(frames: readonly SyncFrame[]): { at: number; detail: string }[];
}

const INVARIANTS: InvariantDef[] = [
  {
    id: 'SYNC-05',
    rule: 'no duplicate session nonce',
    checks: 'two hello frames on one association sharing a sessionNonce',
    run: (frames) => {
      const seen = new Map<string, number>();
      const out: { at: number; detail: string }[] = [];
      for (const f of frames) {
        if (f.msg !== 'hello') continue;
        const id = corrIdOf(f);
        if (id === undefined) continue;
        const key = `${f.assoc}::${id}`;
        const prev = seen.get(key);
        if (prev !== undefined) {
          out.push({ at: f.at, detail: `nonce ${id.slice(0, 12)}… reused on ${f.assoc}` });
        } else seen.set(key, f.at);
      }
      return out;
    },
  },
  {
    id: 'SYNC-06',
    rule: 'one live session per (local, remote, instance)',
    checks: 'a second session-register for a triple with no intervening close',
    run: (frames) => {
      const live = new Set<string>();
      const out: { at: number; detail: string }[] = [];
      for (const f of frames) {
        if (f.msg === 'session-register') {
          if (live.has(f.assoc)) out.push({ at: f.at, detail: `duplicate live session on ${f.assoc}` });
          live.add(f.assoc);
        } else if (f.msg === 'session-close' || f.msg === 'disconnect') {
          live.delete(f.assoc);
        }
      }
      return out;
    },
  },
  {
    id: 'SYNC-14',
    rule: 'single-flight want per block hash',
    checks: 'the same hash armed twice without an intervening arrival',
    run: (frames) => {
      const inflight = new Set<string>();
      const out: { at: number; detail: string }[] = [];
      for (const f of frames) {
        const h = f.data?.['hash'];
        if (typeof h !== 'string') continue;
        if (f.msg === 'want-armed') {
          if (inflight.has(h)) out.push({ at: f.at, detail: `hash ${h.slice(0, 12)}… wanted twice in flight` });
          inflight.add(h);
        } else if (f.msg === 'block-received' || f.msg === 'want-timeout') {
          inflight.delete(h);
        }
      }
      return out;
    },
  },
  {
    id: 'DISC-27',
    rule: 'instance-level loopback is rejected',
    checks: 'a hello accepted where remote profile and instance equal our own',
    run: (frames) => {
      const out: { at: number; detail: string }[] = [];
      for (const f of frames) {
        if (f.msg !== 'hello-accepted') continue;
        if (
          f.remoteProfile !== undefined &&
          f.data?.['localProfile'] === f.remoteProfile &&
          f.data?.['remoteInstance'] === f.data?.['localInstance']
        ) {
          out.push({ at: f.at, detail: `loopback accepted on ${f.assoc}` });
        }
      }
      return out;
    },
  },
  {
    id: 'SYNC-21a',
    rule: 'every delta terminates in a final have',
    checks: 'a resume page requested but never closed with more:false',
    run: (frames) => {
      const open = new Map<string, number>();
      const out: { at: number; detail: string }[] = [];
      for (const f of frames) {
        const id = corrIdOf(f);
        if (id === undefined) continue;
        if (f.msg === 'delta' && f.dir === 'out') open.set(`${f.assoc}::${id}`, f.at);
        if (f.msg === 'have' && f.data?.['more'] === false) open.delete(`${f.assoc}::${id}`);
      }
      // Only stale ones count — a page opened moments ago is simply in flight.
      const cutoff = Date.now() - 60_000;
      for (const [key, at] of open) {
        if (at < cutoff) out.push({ at, detail: `delta ${key.split('::')[1]?.slice(0, 12)}… never terminated` });
      }
      return out;
    },
  },
  {
    id: 'SYNC-18a',
    rule: 'an announced block is served when wanted',
    checks: 'a peer announced have(H), we wanted H, and nothing ever arrived',
    run: (frames) => {
      // SYNC-18 permits silence for a block the sender never claimed to hold.
      // It does not permit silence for one it advertised: announcing have(H)
      // is a promise, and an unanswered want against that promise is a fault,
      // not the normal absence of a partial replica.
      const announced = new Map<string, number>(); // hash -> first announce
      const wanted = new Map<string, number>();
      const arrived = new Set<string>();
      for (const f of frames) {
        const hashes = f.data?.['hashes'];
        if (f.msg === 'have' && f.dir === 'in' && Array.isArray(hashes)) {
          for (const h of hashes) if (typeof h === 'string' && !announced.has(h)) announced.set(h, f.at);
        }
        if ((f.msg === 'want' && f.dir === 'out') || f.msg === 'want-armed') {
          const list = Array.isArray(hashes) ? hashes : [f.data?.['hash']];
          for (const h of list) if (typeof h === 'string' && !wanted.has(h)) wanted.set(h, f.at);
        }
        const single = f.data?.['hash'];
        if (f.msg === 'block-received' && typeof single === 'string') arrived.add(single);
      }
      const cutoff = Date.now() - 60_000;
      const out: { at: number; detail: string }[] = [];
      for (const [hash, wantAt] of wanted) {
        if (arrived.has(hash) || !announced.has(hash) || wantAt >= cutoff) continue;
        out.push({ at: wantAt, detail: `peer announced ${hash.slice(0, 12)}… then never served it` });
      }
      return out;
    },
  },
  {
    id: 'SYNC-18b',
    rule: 'we serve what we announce',
    checks: 'we advertised have(H) and then reported H as missing locally',
    run: (frames) => {
      // The mirror of SYNC-18a, aimed at ourselves: announcing a ref we cannot
      // subsequently produce strands the peer exactly as a broken promise from
      // them would strand us.
      const weAnnounced = new Set<string>();
      const out: { at: number; detail: string }[] = [];
      for (const f of frames) {
        const hashes = f.data?.['hashes'];
        if (f.msg === 'have' && f.dir === 'out' && Array.isArray(hashes)) {
          for (const h of hashes) if (typeof h === 'string') weAnnounced.add(h);
        }
        const missing = f.data?.['missingHashes'];
        if (f.msg === 'want-served' && Array.isArray(missing)) {
          for (const h of missing) {
            if (typeof h === 'string' && weAnnounced.has(h)) {
              out.push({ at: f.at, detail: `we announced ${h.slice(0, 12)}… but could not serve it` });
            }
          }
        }
      }
      return out;
    },
  },
  {
    id: 'SYNC-18',
    rule: 'no stream for an unannounced hash',
    checks: 'a block arriving that was never advertised in a have',
    run: (frames) => {
      const announced = new Set<string>();
      const out: { at: number; detail: string }[] = [];
      for (const f of frames) {
        const hashes = f.data?.['hashes'];
        if (f.msg === 'have' && Array.isArray(hashes)) {
          for (const h of hashes) if (typeof h === 'string') announced.add(h);
        }
        const h = f.data?.['hash'];
        if (f.msg === 'block-received' && typeof h === 'string' && !announced.has(h)) {
          out.push({ at: f.at, detail: `block ${h.slice(0, 12)}… never announced` });
        }
      }
      return out;
    },
  },
];

/** Never-empty: every invariant is listed, `watching` when it has never fired. */
export function invariantStatuses(frames: readonly SyncFrame[]): InvariantStatus[] {
  return INVARIANTS.map((inv) => {
    const hits = inv.run(frames);
    const last = hits.at(-1) ?? null;
    return {
      id: inv.id,
      rule: inv.rule,
      checks: inv.checks,
      violations: hits.length,
      lastAt: last?.at ?? null,
      detail: last?.detail ?? null,
      state: hits.length > 0 ? 'violated' : frames.length === 0 ? 'watching' : 'ok',
    };
  });
}

// ── association state machine ─────────────────────────────────────────────

export const ASSOC_STATES = [
  'discovering',
  'dialing',
  'handshaking',
  'attached',
  'resuming',
  'live',
  'stalled',
] as const;
export type AssocState = (typeof ASSOC_STATES)[number];

export interface AssocSummary {
  readonly assoc: string;
  readonly remoteProfile: string | undefined;
  readonly state: AssocState;
  readonly since: number;
  readonly frames: number;
}

const STATE_BY_MSG: Record<string, AssocState> = {
  'topic-join': 'discovering',
  'dht-peer': 'discovering',
  'mdns-sighting': 'discovering',
  'dial-start': 'dialing',
  'dial-fail': 'dialing',
  'dial-ok': 'handshaking',
  hello: 'handshaking',
  'hello-accepted': 'attached',
  'session-register': 'attached',
  attach: 'resuming',
  subscribe: 'resuming',
  delta: 'resuming',
  have: 'live',
  want: 'live',
  'block-received': 'live',
  conn: 'live',
  'want-timeout': 'stalled',
  'session-stall': 'stalled',
  stall: 'stalled',
  disconnect: 'stalled',
};

/** Latest known state per association, with when it entered that state. */
export function associationSummaries(frames: readonly SyncFrame[]): AssocSummary[] {
  const byAssoc = new Map<string, { state: AssocState; since: number; frames: number; remote?: string }>();
  for (const f of frames) {
    // Config frames describe the node, not an association — including them
    // would invent a phantom association per configured friend.
    if (f.phase === 'config') continue;
    const next = STATE_BY_MSG[f.msg];
    const cur = byAssoc.get(f.assoc) ?? { state: 'discovering' as AssocState, since: f.at, frames: 0 };
    cur.frames += 1;
    if (f.remoteProfile !== undefined) cur.remote = f.remoteProfile;
    if (next !== undefined && next !== cur.state) {
      cur.state = next;
      cur.since = f.at;
    }
    byAssoc.set(f.assoc, cur);
  }
  return [...byAssoc.entries()].map(([assoc, v]) => ({
    assoc,
    remoteProfile: v.remote,
    state: v.state,
    since: v.since,
    frames: v.frames,
  }));
}

// ── journal progress (SYNC-19/22) ─────────────────────────────────────────

export interface JournalProgress {
  /** Highest resume cursor we have paged up to locally. */
  readonly localCursor: number | null;
  /** Highest cursor the remote has advertised as available. */
  readonly remoteMax: number | null;
  readonly pct: number | null;
  readonly walking: boolean;
}

/**
 * Catch-up position, read from resume-walk paging alone: `fromCursor` on our
 * own requests is where we have reached, `nextCursor` on inbound pages is how
 * far the remote says its journal goes.
 */
export function journalProgress(frames: readonly SyncFrame[]): JournalProgress {
  let local: number | null = null;
  let remote: number | null = null;
  let walking = false;
  for (const f of frames) {
    if (f.phase !== 'anti-entropy') continue;
    const num = (v: unknown): number | null => {
      const n = typeof v === 'string' ? Number.parseInt(v, 10) : typeof v === 'number' ? v : NaN;
      return Number.isFinite(n) ? n : null;
    };
    if (f.msg === 'delta' && f.dir === 'out') {
      const c = num(f.data?.['cursor']);
      if (c !== null && (local === null || c > local)) local = c;
      walking = true;
    }
    if (f.msg === 'have') {
      const n = num(f.data?.['nextCursor']);
      if (n !== null && (remote === null || n > remote)) remote = n;
      if (f.data?.['more'] === false) walking = false;
    }
  }
  const pct =
    local !== null && remote !== null && remote > 0
      ? Math.min(100, Math.round((local / remote) * 100))
      : null;
  return { localCursor: local, remoteMax: remote, pct, walking };
}

// ── friend status table (TRACE-23) ────────────────────────────────────────

export interface FriendStatus {
  readonly profile: string;
  readonly sibling: boolean;
  readonly sightings: number;
  readonly dials: number;
  readonly dialFails: number;
  readonly handshakes: number;
  readonly rejects: number;
  readonly stalls: number;
  readonly lastSeenAt: number | null;
  /**
   * `never-contacted` is the state this whole table exists to make visible:
   * a friend that is configured but that discovery has never yielded produces
   * no frames of its own, so without an explicit row it is indistinguishable
   * from one that was contacted and failed (TRACE-23).
   */
  readonly state: 'never-contacted' | 'sighted' | 'dial-failed' | 'rejected' | 'connected' | 'stalled';
}

/**
 * One row per *configured* friend, whether or not it was ever contacted.
 * Rows come from config-layer `friend-configured` frames, so the table is
 * populated from the moment tracing starts rather than only once traffic
 * happens to occur.
 */
export function friendStatuses(frames: readonly SyncFrame[]): FriendStatus[] {
  const rows = new Map<string, {
    sibling: boolean; sightings: number; dials: number; dialFails: number;
    handshakes: number; rejects: number; stalls: number; lastSeenAt: number | null;
  }>();

  // Pass 1: the configured set.
  for (const f of frames) {
    if (f.phase !== 'config' || f.msg !== 'friend-configured') continue;
    const key = f.remoteProfile;
    if (key === undefined) continue;
    if (!rows.has(key)) {
      rows.set(key, {
        sibling: f.data?.['sibling'] === true,
        sightings: 0, dials: 0, dialFails: 0, handshakes: 0, rejects: 0, stalls: 0,
        lastSeenAt: null,
      });
    }
  }

  // Pass 2: activity attributed to a configured key.
  for (const f of frames) {
    if (f.phase === 'config') continue;
    const key = f.remoteProfile;
    if (key === undefined) continue;
    const r = rows.get(key);
    if (r === undefined) continue;
    r.lastSeenAt = r.lastSeenAt === null ? f.at : Math.max(r.lastSeenAt, f.at);
    switch (f.msg) {
      case 'dht-peer': case 'mdns-sighting': r.sightings += 1; break;
      case 'dial-start': r.dials += 1; break;
      case 'dial-fail': r.dialFails += 1; break;
      case 'hello-accepted': r.handshakes += 1; break;
      case 'hello-rejected': r.rejects += 1; break;
      case 'stall': case 'want-timeout': r.stalls += 1; break;
      // `session-rotation` is the healthy periodic re-dial, not a fault —
      // counting it would make every long-lived peer look permanently sick.
      case 'session-stall':
        if (f.data?.['reason'] !== 'session-rotation') r.stalls += 1;
        break;
      default: break;
    }
  }

  return [...rows.entries()].map(([profile, r]) => {
    const state: FriendStatus['state'] =
      r.stalls > 0 && r.handshakes > 0
        ? 'stalled'
        : r.handshakes > 0
          ? 'connected'
          : r.rejects > 0
            ? 'rejected'
            : r.dialFails > 0
              ? 'dial-failed'
              : r.sightings > 0
                ? 'sighted'
                : 'never-contacted';
    return { profile, ...r, state };
  }).sort((a, b) => {
    // Problems first: never-contacted is the diagnosis this table is for.
    const rank: Record<FriendStatus['state'], number> = {
      'never-contacted': 0, 'dial-failed': 1, rejected: 2, stalled: 3, sighted: 4, connected: 5,
    };
    return rank[a.state] - rank[b.state];
  });
}

// ── JSONL artifact (TRACE-50..53) ─────────────────────────────────────────

/** One frame per line, §2 field names verbatim (TRACE-50). */
export function toJsonl(frames: readonly SyncFrame[]): string {
  return frames
    .map((f) =>
      JSON.stringify({
        seq: f.seq,
        at: f.at,
        layer: f.phase,
        level: f.level,
        dir: f.dir,
        msg: f.msg,
        assoc: f.assoc,
        ...(f.remoteProfile !== undefined ? { remoteProfile: f.remoteProfile } : {}),
        ...(f.bytes !== undefined ? { bytes: f.bytes } : {}),
        ...(f.outcome !== undefined ? { outcome: f.outcome } : {}),
        data: f.data ?? {},
      }),
    )
    .join('\n');
}

/** Inverse of {@link toJsonl}; unparseable lines are skipped, not fatal. */
export function fromJsonl(text: string): SyncFrame[] {
  const out: SyncFrame[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      const o = JSON.parse(trimmed) as Record<string, unknown>;
      out.push({
        seq: Number(o['seq'] ?? out.length),
        at: Number(o['at'] ?? 0),
        assoc: String(o['assoc'] ?? 'unknown'),
        dir: (o['dir'] as SyncFrame['dir']) ?? 'local',
        phase: (o['layer'] as SyncFrame['phase']) ?? 'session',
        level: (o['level'] as SyncFrame['level']) ?? 'info',
        msg: String(o['msg'] ?? '?'),
        detail: formatData(o['data'] as Record<string, unknown> | undefined),
        ...(o['outcome'] !== undefined ? { outcome: o['outcome'] as SyncFrame['outcome'] } : {}),
        ...(o['bytes'] !== undefined ? { bytes: Number(o['bytes']) } : {}),
        ...(o['remoteProfile'] !== undefined ? { remoteProfile: String(o['remoteProfile']) } : {}),
        ...(o['data'] !== undefined ? { data: o['data'] as Record<string, unknown> } : {}),
      });
    } catch {
      continue;
    }
  }
  return out;
}

function formatData(data: Record<string, unknown> | undefined): string {
  if (data === undefined) return '';
  return Object.entries(data)
    .map(([k, v]) => (Array.isArray(v) && v.length > 4 ? `${k}=[${v.length}]` : `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`))
    .join(' ');
}

/**
 * Two-sided diff (TRACE-53): correlation ids one side sent but the other never
 * recorded receiving. Attributing a lost message to sender, transport, or
 * receiver is a join, not an investigation.
 */
export function diffSides(
  a: readonly SyncFrame[],
  b: readonly SyncFrame[],
): { readonly onlyInA: string[]; readonly onlyInB: string[] } {
  const ids = (frames: readonly SyncFrame[], dir: SyncFrame['dir']) => {
    const s = new Set<string>();
    for (const f of frames) {
      const id = corrIdOf(f);
      if (id !== undefined && f.dir === dir) s.add(`${f.msg}:${id}`);
    }
    return s;
  };
  const aOut = ids(a, 'out');
  const bIn = ids(b, 'in');
  const bOut = ids(b, 'out');
  const aIn = ids(a, 'in');
  return {
    onlyInA: [...aOut].filter((k) => !bIn.has(k)),
    onlyInB: [...bOut].filter((k) => !aIn.has(k)),
  };
}
