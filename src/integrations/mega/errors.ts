import {
  MEGA_LOCK_RETRY_DELAYS_MS,
  MEGA_RATE_LIMIT_RETRY_DELAYS_MS,
  MEGA_RECONNECT_REQUIRED_MESSAGE,
  MEGA_RETRYABLE_API_ERROR_CODES,
  MEGA_TRANSIENT_RETRY_DELAYS_MS,
  type MegaApiError,
} from './core.js';
import {
  defaultRuntimeScheduler,
  waitForScheduledDelay,
  type RuntimeScheduler,
  type RuntimeTimerHandle,
} from '../../runtime/scheduler.js';

const megaSyncActivityTouchers = new WeakMap<AbortSignal, () => void>();

export function getMegaApiErrorCode(error: unknown): number | null {
  const direct = typeof (error as MegaApiError | undefined)?.code === 'number' ? (error as MegaApiError).code : null;
  if (direct !== null && Number.isFinite(direct)) {
    return Math.trunc(direct);
  }
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/MEGA API error\s+(-?\d+)/i);
  return match ? Number.parseInt(match[1]!, 10) : null;
}

export function isMegaSessionInvalid(error: unknown): boolean {
  const code = getMegaApiErrorCode(error);
  if (code === -15) {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /MEGA API error -15|session|auth|login/i.test(message);
}

export function isMegaRetryableApiError(error: unknown): error is MegaApiError {
  const code = getMegaApiErrorCode(error);
  return code !== null && MEGA_RETRYABLE_API_ERROR_CODES.has(code);
}

export function isMegaTemporaryLockError(error: unknown): boolean {
  const code = getMegaApiErrorCode(error);
  return code === -3;
}

export function normalizeMegaConnectError(error: unknown, email: string): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (/HTTP 402\b/i.test(message)) {
    return new Error(
      `MEGA refused login for ${email} (HTTP 402). Verify the account on mega.io (captcha, security check, account lock, or temporary service restriction), then retry in Nearbytes.`
    );
  }
  return error instanceof Error ? error : new Error(message);
}

export function isMegaTransientSyncError(error: unknown): boolean {
  return isMegaTemporaryLockError(error) || isMegaRateLimitedError(error) || isMegaRetryableTransportError(error);
}

export function isMegaAccessDeniedError(error: unknown): error is MegaApiError {
  const code = getMegaApiErrorCode(error);
  return code === -11;
}

export function readProcessEnv(name: string): string | undefined {
  if (typeof process === 'undefined' || !process?.env) {
    return undefined;
  }
  const value = process.env[name];
  return typeof value === 'string' ? value : undefined;
}

export function isDevLogsEnabled(): boolean {
  return (readProcessEnv('NODE_ENV') ?? '').trim().toLowerCase() === 'development';
}

export function debugMegaLog(...args: unknown[]): void {
  if ((readProcessEnv('DEBUG') ?? '').trim() !== '') {
    console.log(...args);
  }
}

export function isMegaUploadProbeEnabled(): boolean {
  return matchesMegaDebugScope(readProcessEnv('DEBUG'), 'mega');
}

export function matchesMegaDebugScope(rawValue: string | undefined, scope?: string): boolean {
  const value = rawValue?.trim();
  if (!value) {
    return false;
  }
  const normalizedScope = scope?.trim().toLowerCase();
  return value
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .some((token) => {
      if (token === '1' || token === 'true' || token === '*') {
        return true;
      }
      if (!normalizedScope) {
        return false;
      }
      return token === normalizedScope || token === `nearbytes:${normalizedScope}`;
    });
}

export function getMegaHttpStatus(error: unknown): number | null {
  const status = typeof (error as { status?: unknown } | undefined)?.status === 'number'
    ? Number((error as { status: number }).status)
    : null;
  if (status !== null && Number.isFinite(status)) {
    return Math.trunc(status);
  }
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/HTTP\s+(\d{3})/i);
  return match ? Number.parseInt(match[1]!, 10) : null;
}

export function isMegaRateLimitedError(error: unknown): boolean {
  const apiCode = getMegaApiErrorCode(error);
  const httpStatus = getMegaHttpStatus(error);
  return apiCode === -4 || httpStatus === 429;
}

export function getMegaRetryDelayMs(error: unknown, attempt: number): number {
  const apiCode = getMegaApiErrorCode(error);
  const httpStatus = getMegaHttpStatus(error);
  const delays =
    apiCode === -3
      ? MEGA_LOCK_RETRY_DELAYS_MS
      : isMegaRateLimitedError(error) || httpStatus === 503
        ? MEGA_RATE_LIMIT_RETRY_DELAYS_MS
        : MEGA_TRANSIENT_RETRY_DELAYS_MS;
  return delays[Math.min(attempt, delays.length - 1)]!;
}

export function isMegaRetryableTransportError(error: unknown): boolean {
  const httpStatus = getMegaHttpStatus(error);
  if (httpStatus === 429 || httpStatus === 408 || (httpStatus !== null && httpStatus >= 500)) {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return (
    /fetch failed/i.test(message) ||
    /ECONNRESET|ECONNREFUSED|ETIMEDOUT|network/i.test(message) ||
    /EAI_AGAIN|ENOTFOUND|socket hang up/i.test(message)
  );
}

export function isMegaEventuallyConsistentMutationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /did not make the created folder (globally )?visible|did not make the uploaded file (globally )?visible/i.test(
    message
  );
}

export async function withMegaApiRetry<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      touchMegaSyncActivity(signal);
      return await operation();
    } catch (error) {
      if (
        (!isMegaRetryableApiError(error) && !isMegaRetryableTransportError(error)) ||
        attempt >= Math.max(MEGA_LOCK_RETRY_DELAYS_MS.length, MEGA_RATE_LIMIT_RETRY_DELAYS_MS.length, MEGA_TRANSIENT_RETRY_DELAYS_MS.length)
      ) {
        throw error;
      }
      const delayMs = getMegaRetryDelayMs(error, attempt);
      attempt += 1;
      await waitForMegaRetry(delayMs, signal);
    }
  }
}

export async function waitForMegaRetry(
  schedulerOrDelayMs: RuntimeScheduler | number,
  delayMsOrSignal?: number | AbortSignal,
  signal?: AbortSignal
): Promise<void> {
  const scheduler =
    typeof schedulerOrDelayMs === 'number'
      ? defaultRuntimeScheduler
      : schedulerOrDelayMs;
  const delayMs =
    typeof schedulerOrDelayMs === 'number'
      ? schedulerOrDelayMs
      : typeof delayMsOrSignal === 'number'
        ? delayMsOrSignal
        : 0;
  const effectiveSignal =
    typeof schedulerOrDelayMs === 'number'
      ? (delayMsOrSignal as AbortSignal | undefined)
      : signal;

  if (effectiveSignal?.aborted) {
    throw createMegaAbortError();
  }
  try {
    await waitForScheduledDelay(scheduler, delayMs, effectiveSignal);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw createMegaAbortError();
    }
    throw error;
  }
}

export function createMegaAbortError(): Error {
  const error = new Error('This operation was aborted.');
  error.name = 'AbortError';
  return error;
}

export function isMegaMissingRequestedRootError(error: unknown): boolean {
  return error instanceof Error && error.message === 'MEGA tree did not include the requested root node.';
}

export function createMegaSyncAbortController(
  createAbortController: () => AbortController,
  scheduler: RuntimeScheduler,
  timeoutMs: number
): {
  controller: AbortController;
  dispose: () => void;
} {
  const controller = createAbortController();
  let timer: RuntimeTimerHandle | null = null;

  const scheduleAbort = () => {
    if (timer) {
      timer.cancel();
    }
    timer = scheduler.setTimeout(() => {
      timer = null;
      controller.abort();
    }, timeoutMs);
    timer.unref?.();
  };

  scheduleAbort();
  megaSyncActivityTouchers.set(controller.signal, scheduleAbort);

  return {
    controller,
    dispose: () => {
      if (timer) {
        timer.cancel();
        timer = null;
      }
      megaSyncActivityTouchers.delete(controller.signal);
    },
  };
}

export function touchMegaSyncActivity(signal?: AbortSignal): void {
  if (!signal || signal.aborted) {
    return;
  }
  megaSyncActivityTouchers.get(signal)?.();
}

export function createMegaReconnectRequiredError(error: unknown): Error {
  const reason =
    error == null
      ? ''
      : error instanceof Error
        ? error.message.trim()
        : String(error).trim();
  const suffix = reason ? ` ${reason}` : '';
  return new Error(`${MEGA_RECONNECT_REQUIRED_MESSAGE}${suffix}`);
}
