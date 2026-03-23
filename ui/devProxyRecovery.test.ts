import fs from 'fs';
import http from 'http';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('vite', () => ({
  defineConfig: (config: unknown) => config,
}));

vi.mock('@sveltejs/vite-plugin-svelte', () => ({
  svelte: () => ({ name: 'svelte' }),
}));

vi.mock('vite-plugin-pwa', () => ({
  VitePWA: () => ({ name: 'pwa' }),
}));

import { __test__ } from './devApiProxy.js';

describe('nearbytes dev proxy recovery', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('accepts a healthy standalone backend when no desktop session exists', async () => {
    vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
      throw createFsError('ENOENT');
    });

    mockHttpRequestSequence([{ statusCode: 200 }]);

    const result = await __test__.waitForRecoverableProxyTarget(null);

    expect(result.available).toBe(true);
    expect(result.session).toBeNull();
    expect(result.targetUrl.origin).toBe('http://127.0.0.1:3000');
  });

  it('waits for a desktop session to appear after an initial failed probe', async () => {
    vi.useFakeTimers();

    let readCount = 0;
    vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
      readCount += 1;
      if (readCount === 1) {
        throw createFsError('ENOENT');
      }
      return JSON.stringify({
        pid: 4242,
        port: 4310,
        token: 'desktop-token',
        expiresAt: Date.now() + 60_000,
      });
    });
    vi.spyOn(process, 'kill').mockImplementation(() => true as never);

    mockHttpRequestSequence([
      { error: new Error('connect ECONNREFUSED 127.0.0.1:3000') },
      { statusCode: 200 },
    ]);

    const resultPromise = __test__.waitForRecoverableProxyTarget(null);
    await vi.advanceTimersByTimeAsync(250);
    const result = await resultPromise;

    expect(result.available).toBe(true);
    expect(result.session).toMatchObject({
      pid: 4242,
      port: 4310,
      token: 'desktop-token',
    });
    expect(result.targetUrl.origin).toBe('http://127.0.0.1:4310');
  });
});

function mockHttpRequestSequence(sequence: Array<{ statusCode?: number; error?: Error }>): void {
  vi.spyOn(http, 'request').mockImplementation(((options: unknown, callback: (response: {
    statusCode?: number;
    resume(): void;
  }) => void) => {
    const listeners = new Map<string, (error: Error) => void>();
    const next = sequence.shift();
    if (!next) {
      throw new Error(`Unexpected http.request call for ${JSON.stringify(options)}`);
    }

    const request = {
      on(event: string, handler: (error: Error) => void) {
        listeners.set(event, handler);
        return request;
      },
      setTimeout() {
        return request;
      },
      destroy(error: Error) {
        listeners.get('error')?.(error);
      },
      end() {
        queueMicrotask(() => {
          if (next.error) {
            listeners.get('error')?.(next.error);
            return;
          }
          callback({
            statusCode: next.statusCode,
            resume() {
              // no-op
            },
          });
        });
      },
    };

    return request;
  }) as typeof http.request);
}

function createFsError(code: string): NodeJS.ErrnoException {
  const error = new Error(code) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}