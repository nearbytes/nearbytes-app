import { touchMegaSyncActivity } from './errors.js';

export async function keepMegaSyncAliveWhile<T>(task: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal || signal.aborted) {
    return await task;
  }

  touchMegaSyncActivity(signal);
  const interval = setInterval(() => {
    touchMegaSyncActivity(signal);
  }, 5_000);
  if (typeof (interval as { unref?: () => void }).unref === 'function') {
    (interval as { unref: () => void }).unref();
  }

  try {
    return await task;
  } finally {
    clearInterval(interval);
    touchMegaSyncActivity(signal);
  }
}