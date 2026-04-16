export interface RuntimeTimerHandle {
  cancel(): void;
  unref?(): void;
}

export interface RuntimeScheduler {
  setTimeout(callback: () => void, delayMs: number): RuntimeTimerHandle;
  setInterval(callback: () => void, intervalMs: number): RuntimeTimerHandle;
}

export const defaultRuntimeScheduler: RuntimeScheduler = {
  setTimeout(callback, delayMs) {
    const timer = setTimeout(callback, delayMs);
    return {
      cancel() {
        clearTimeout(timer);
      },
      unref() {
        timer.unref?.();
      },
    };
  },

  setInterval(callback, intervalMs) {
    const timer = setInterval(callback, intervalMs);
    return {
      cancel() {
        clearInterval(timer);
      },
      unref() {
        timer.unref?.();
      },
    };
  },
};

export async function waitForScheduledDelay(
  scheduler: RuntimeScheduler,
  delayMs: number,
  signal?: AbortSignal
): Promise<void> {
  if (signal?.aborted) {
    const error = new Error('This operation was aborted.');
    error.name = 'AbortError';
    throw error;
  }

  await new Promise<void>((resolve, reject) => {
    const timer = scheduler.setTimeout(() => {
      cleanup();
      resolve();
    }, delayMs);
    timer.unref?.();

    const onAbort = () => {
      cleanup();
      const error = new Error('This operation was aborted.');
      error.name = 'AbortError';
      reject(error);
    };

    const cleanup = () => {
      timer.cancel();
      signal?.removeEventListener('abort', onAbort);
    };

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}