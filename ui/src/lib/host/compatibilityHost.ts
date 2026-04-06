import {
  chooseDesktopDirectoryPath,
  hasDesktopDirectoryPicker,
  hasDesktopRuntimeLogsBridge,
} from './desktopShell.js';
import {
  getRuntimeConfig,
  openHostStream,
  requestHostBlob,
  requestHostJson,
} from './runtimeTransport.js';
import type {
  NearbytesAuth,
  NearbytesHostContract,
  NearbytesSourceWatchHandlers,
  NearbytesVolumeWatchHandlers,
  NearbytesWatchConnection,
} from './contract.js';

let hostPromise: Promise<NearbytesHostContract> | null = null;

function createAuthHeaders(auth: NearbytesAuth): HeadersInit {
  if (auth.type === 'token') {
    return {
      Authorization: `Bearer ${auth.token}`,
    };
  }

  return {
    'x-nearbytes-secret': auth.secret,
  };
}

function openWatchConnection(
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

export function resetCompatibilityHostForTests(): void {
  hostPromise = null;
}

export async function getCompatibilityHost(): Promise<NearbytesHostContract> {
  if (hostPromise) {
    return hostPromise;
  }

  hostPromise = (async () => {
    const runtimeConfig = await getRuntimeConfig();

    return {
      capabilities: {
        hostKind: runtimeConfig.runtimeHostKind ?? (runtimeConfig.isDesktop ? 'desktop' : 'web'),
        runtimeOwner:
          runtimeConfig.runtimeOwner ?? (runtimeConfig.isDesktop ? 'embedded' : 'remote-runtime'),
        supportsDirectoryPicker: hasDesktopDirectoryPicker(),
        supportsRuntimeLogs: hasDesktopRuntimeLogsBridge(),
      },
      objects: {
        requestJson: requestHostJson,
        requestBlob: requestHostBlob,
        openStream: openHostStream,
      },
      shell: {
        chooseDirectory: chooseDesktopDirectoryPath,
      },
      legacyDesktop: {
        openVolume(secret) {
          return requestHostJson('/open', {
            method: 'POST',
            body: JSON.stringify({ secret }),
          });
        },
        listFiles(auth) {
          return requestHostJson('/files', {
            method: 'GET',
            headers: createAuthHeaders(auth),
          });
        },
        getTimeline(auth) {
          return requestHostJson('/timeline', {
            method: 'GET',
            headers: createAuthHeaders(auth),
          });
        },
        getEventDetail(auth, eventHash) {
          return requestHostJson(`/events/${eventHash}`, {
            method: 'GET',
            headers: createAuthHeaders(auth),
          });
        },
        watchSources(handlers) {
          return openWatchConnection('/watch/sources', handlers);
        },
        watchVolume(auth, handlers) {
          return openWatchConnection('/watch/volume', handlers, { auth });
        },
      },
    } satisfies NearbytesHostContract;
  })();

  try {
    return await hostPromise;
  } catch (error) {
    if (hostPromise) {
      hostPromise = null;
    }
    throw error;
  }
}