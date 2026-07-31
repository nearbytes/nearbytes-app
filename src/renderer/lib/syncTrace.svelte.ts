/** Client for the main-process sync protocol debug trace (debug.* IPC routes). */
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

export function createSyncTraceClient() {
  let frames = $state<SyncFrame[]>([]);
  let active = $state(false);
  let unsubscribe: (() => void) | undefined;

  async function start(): Promise<void> {
    if (active) return;
    const backlog = (await window.nb.invoke({
      api: 'debug' as never,
      method: 'syncTraceStart',
      args: [],
    })) as SyncFrame[];
    frames = [...backlog];
    unsubscribe = window.nb.on((e) => {
      if (e.channel === 'syncTrace') {
        frames = [...frames, ...(e.payload as SyncFrame[])].slice(-2000);
      }
    });
    active = true;
  }

  function stop(): void {
    if (!active) return;
    void window.nb.invoke({ api: 'debug' as never, method: 'syncTraceStop', args: [] });
    unsubscribe?.();
    unsubscribe = undefined;
    active = false;
  }

  function clear(): void {
    frames = [];
  }

  return {
    get frames() { return frames; },
    get active() { return active; },
    start,
    stop,
    clear,
  };
}
