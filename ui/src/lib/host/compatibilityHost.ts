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

function createJsonRequest<T>(endpoint: string, options: RequestInit & { auth?: NearbytesAuth } = {}): Promise<T> {
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
      invalidation: {
        watchSources(handlers) {
          return openWatchConnection('/watch/sources', handlers);
        },
        watchVolume(auth, handlers) {
          return openWatchConnection('/watch/volume', handlers, { auth });
        },
      },
      lan: {
        listPeers(options) {
          return createJsonRequest('/integrations/local-network/peers', {
            method: 'GET',
            signal: options?.signal,
          });
        },
        syncPeer(peerId, options) {
          return createJsonRequest(`/integrations/local-network/peers/${encodeURIComponent(peerId)}/sync`, {
            method: 'POST',
            signal: options?.signal,
          });
        },
      },
      shell: {
        chooseDirectory: chooseDesktopDirectoryPath,
      },
      legacyDesktop: {
        openVolume(secret) {
          return createJsonRequest('/open', {
            method: 'POST',
            body: JSON.stringify({ secret }),
          });
        },
        listFiles(auth) {
          return createJsonRequest('/files', {
            method: 'GET',
            auth,
          });
        },
        getTimeline(auth) {
          return createJsonRequest('/timeline', {
            method: 'GET',
            auth,
          });
        },
        getEventDetail(auth, eventHash) {
          return createJsonRequest(`/events/${eventHash}`, {
            method: 'GET',
            auth,
          });
        },
        getEventStorageLocations(auth, eventHash) {
          return createJsonRequest(`/events/${eventHash}/storage-locations`, {
            method: 'GET',
            auth,
          });
        },
        uploadFile(auth, file) {
          const formData = new FormData();
          formData.append('file', file);
          formData.append('filename', file.name);
          return createJsonRequest('/upload', {
            method: 'POST',
            auth,
            body: formData,
          });
        },
        deleteFile(auth, filename) {
          return createJsonRequest<void>(`/files/${encodeURIComponent(filename)}`, {
            method: 'DELETE',
            auth,
          });
        },
        renameFile(auth, from, to) {
          return createJsonRequest('/files/rename', {
            method: 'POST',
            auth,
            body: JSON.stringify({ from, to }),
          });
        },
        renameFolder(auth, from, to, merge) {
          return createJsonRequest('/folders/rename', {
            method: 'POST',
            auth,
            body: JSON.stringify({ from, to, merge }),
          });
        },
        exportSourceReferences(auth, filenames) {
          return createJsonRequest('/references/source/export', {
            method: 'POST',
            auth,
            body: JSON.stringify({ filenames }),
          });
        },
        importSourceReferences(auth, bundle, sourceSecret) {
          return createJsonRequest('/references/source/import', {
            method: 'POST',
            auth,
            body: JSON.stringify({ bundle, sourceSecret }),
          });
        },
        exportRecipientReferences(auth, filenames, recipientVolumeId) {
          return createJsonRequest('/references/recipient/export', {
            method: 'POST',
            auth,
            body: JSON.stringify({ filenames, recipientVolumeId }),
          });
        },
        importRecipientReferences(auth, bundle) {
          return createJsonRequest('/references/recipient/import', {
            method: 'POST',
            auth,
            body: JSON.stringify({ bundle }),
          });
        },
        listChat(auth) {
          return createJsonRequest('/chat', {
            method: 'GET',
            auth,
          });
        },
        publishIdentity(auth, identitySecret, profile) {
          return createJsonRequest('/chat/identities', {
            method: 'POST',
            auth,
            body: JSON.stringify({ identitySecret, profile }),
          });
        },
        sendChatMessage(auth, identitySecret, input) {
          return createJsonRequest('/chat/messages', {
            method: 'POST',
            auth,
            body: JSON.stringify({
              identitySecret,
              body: input.body,
              attachment: input.attachment,
            }),
          });
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