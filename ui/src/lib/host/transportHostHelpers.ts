import {
  openHostStream,
  requestHostJson,
} from './runtimeTransport.js';
import type {
  NearbytesAuth,
  NearbytesSourceWatchHandlers,
  NearbytesVolumeWatchHandlers,
  NearbytesWatchConnection,
} from './contract.js';

export function createAuthHeaders(auth: NearbytesAuth): HeadersInit {
  if (auth.type === 'token') {
    return {
      Authorization: `Bearer ${auth.token}`,
    };
  }

  return {
    'x-nearbytes-secret': auth.secret,
  };
}

export function createJsonRequest<T>(endpoint: string, options: RequestInit & { auth?: NearbytesAuth } = {}): Promise<T> {
  const { auth, headers: inputHeaders, ...requestOptions } = options;
  const headers = new Headers(inputHeaders);

  if (auth) {
    const authHeaders = createAuthHeaders(auth);
    Object.entries(authHeaders).forEach(([key, value]) => {
      headers.set(key, value);
    });
  }

  return requestHostJson<T>(endpoint, {
    ...requestOptions,
    headers,
  });
}

export function openWatchConnection(
  endpoint: string,
  handlers: NearbytesSourceWatchHandlers | NearbytesVolumeWatchHandlers,
  options: { auth?: NearbytesAuth } = {}
): NearbytesWatchConnection {
  const abortController = new AbortController();

  void (async () => {
    try {
      const headers = new Headers();
      if (options.auth) {
        const authHeaders = createAuthHeaders(options.auth);
        Object.entries(authHeaders).forEach(([key, value]) => {
          headers.set(key, value);
        });
      }

      const response = await openHostStream(endpoint, {
        method: 'GET',
        headers,
        signal: abortController.signal,
      });

      if (!response.body) {
        throw new Error('Watch stream is not available');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        let boundaryIndex = buffer.indexOf('\n\n');
        while (boundaryIndex >= 0) {
          const message = buffer.slice(0, boundaryIndex);
          buffer = buffer.slice(boundaryIndex + 2);
          handlers.onMessage?.(new MessageEvent('message', { data: message }));
          boundaryIndex = buffer.indexOf('\n\n');
        }
      }

      handlers.onClose?.();
    } catch (error) {
      if (abortController.signal.aborted) {
        handlers.onClose?.();
        return;
      }

      handlers.onError?.(error instanceof Error ? error : new Error(String(error)));
      handlers.onClose?.();
    }
  })();

  return {
    close() {
      abortController.abort();
    },
  };
}