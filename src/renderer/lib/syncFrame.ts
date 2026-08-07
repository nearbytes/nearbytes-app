/**
 * Wire-frame shape shared by the main-process bridge, the renderer client, and
 * the analysis projections.
 *
 * Kept in a plain module with no Svelte runes so `syncAnalysis.ts` — which is
 * pure and unit-tested under `node --test` — does not drag the reactive client
 * (and therefore the Svelte compiler) into a type-only import.
 */
export type SyncDebugLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace';

export interface SyncFrame {
  readonly seq: number;
  readonly at: number;
  readonly assoc: string;
  readonly dir: 'out' | 'in' | 'local';
  readonly phase:
    | 'config'
    | 'discovery'
    | 'transport'
    | 'handshake'
    | 'session'
    | 'anti-entropy'
    | 'block'
    | 'closed';
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
