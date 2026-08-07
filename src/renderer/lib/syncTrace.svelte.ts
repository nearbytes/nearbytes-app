import type { SyncDebugLevel, SyncFrame } from './syncFrame.js';
export type { SyncDebugLevel, SyncFrame } from './syncFrame.js';
/** Client for the main-process sync protocol debug trace (debug.* IPC routes). */


/** Renderer-side bound; must match MAX_FRAMES in main/syncTrace.ts (TRACE-61). */
const MAX_FRAMES = 2000;

export function createSyncTraceClient() {
  let frames = $state<SyncFrame[]>([]);
  let active = $state(false);
  // TRACE-61: overflow must be observable, never a silent truncation.
  let dropped = $state(0);
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
        const merged = [...frames, ...(e.payload as SyncFrame[])];
        if (merged.length > MAX_FRAMES) dropped += merged.length - MAX_FRAMES;
        frames = merged.slice(-MAX_FRAMES);
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
    dropped = 0;
  }

  return {
    get frames() { return frames; },
    get active() { return active; },
    get dropped() { return dropped; },
    start,
    stop,
    clear,
  };
}
