import {
  openHostStream,
  requestHostBlob,
  requestHostJson,
  getRuntimeConfig,
} from './runtimeTransport.js';
import type {
  NearbytesHostContract,
  NearbytesAuth,
} from './contract.js';
import {
  createJsonRequest,
  openWatchConnection,
} from './transportHostHelpers.js';

let hostPromise: Promise<NearbytesHostContract> | null = null;

const MISSING_PHONE_RUNTIME_MESSAGE =
  'Phone runtime is missing. Start the desktop-backed phone dev runtime or implement the native phone host runtime.';

function createMissingPhoneRuntimeError(): Error {
  return new Error(MISSING_PHONE_RUNTIME_MESSAGE);
}

function createMissingPhoneRuntimeRequest<T>(): Promise<T> {
  return Promise.reject(createMissingPhoneRuntimeError());
}

function hasCompatibilityTransport(runtimeOwner: NearbytesHostContract['capabilities']['runtimeOwner']): boolean {
  return runtimeOwner === 'desktop-proxy' || runtimeOwner === 'remote-runtime';
}

function createUnsupportedWatchConnection(): { close(): void } {
  return {
    close() {
      // No-op because the phone runtime was unavailable.
    },
  };
}

function createUnsupportedLegacyDesktopFamily(): NearbytesHostContract['legacyDesktop'] {
  return {
    openVolume(_secret: string): Promise<unknown> {
      return createMissingPhoneRuntimeRequest();
    },
    listFiles(_auth: NearbytesAuth): Promise<unknown> {
      return createMissingPhoneRuntimeRequest();
    },
    getTimeline(_auth: NearbytesAuth): Promise<unknown> {
      return createMissingPhoneRuntimeRequest();
    },
    getEventDetail(_auth: NearbytesAuth, _eventHash: string): Promise<unknown> {
      return createMissingPhoneRuntimeRequest();
    },
    getEventStorageLocations(_auth: NearbytesAuth, _eventHash: string): Promise<unknown> {
      return createMissingPhoneRuntimeRequest();
    },
    uploadFile(_auth: NearbytesAuth, _file: File): Promise<unknown> {
      return createMissingPhoneRuntimeRequest();
    },
    deleteFile(_auth: NearbytesAuth, _filename: string): Promise<void> {
      return createMissingPhoneRuntimeRequest();
    },
    renameFile(_auth: NearbytesAuth, _from: string, _to: string): Promise<unknown> {
      return createMissingPhoneRuntimeRequest();
    },
    renameFolder(_auth: NearbytesAuth, _from: string, _to: string, _merge: boolean): Promise<unknown> {
      return createMissingPhoneRuntimeRequest();
    },
    exportSourceReferences(_auth: NearbytesAuth, _filenames: string[]): Promise<unknown> {
      return createMissingPhoneRuntimeRequest();
    },
    importSourceReferences(_auth: NearbytesAuth, _bundle: unknown, _sourceSecret: string): Promise<unknown> {
      return createMissingPhoneRuntimeRequest();
    },
    exportRecipientReferences(_auth: NearbytesAuth, _filenames: string[], _recipientVolumeId: string): Promise<unknown> {
      return createMissingPhoneRuntimeRequest();
    },
    importRecipientReferences(_auth: NearbytesAuth, _bundle: unknown): Promise<unknown> {
      return createMissingPhoneRuntimeRequest();
    },
    listChat(_auth: NearbytesAuth): Promise<unknown> {
      return createMissingPhoneRuntimeRequest();
    },
    publishIdentity(_auth: NearbytesAuth, _identitySecret: string, _profile: unknown): Promise<unknown> {
      return createMissingPhoneRuntimeRequest();
    },
    sendChatMessage(_auth: NearbytesAuth, _identitySecret: string, _input: { body?: string; attachment?: unknown }): Promise<unknown> {
      return createMissingPhoneRuntimeRequest();
    },
  };
}

function createCompatibilityLegacyDesktopFamily(): NearbytesHostContract['legacyDesktop'] {
  return {
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
  };
}

export function resetPhoneHostForTests(): void {
  hostPromise = null;
}

export async function getPhoneHost(): Promise<NearbytesHostContract> {
  if (hostPromise) {
    return hostPromise;
  }

  hostPromise = (async () => {
    const runtimeConfig = await getRuntimeConfig();
    const runtimeOwner = runtimeConfig.runtimeOwner ?? 'embedded';
    const compatibilityTransport = hasCompatibilityTransport(runtimeOwner);
    const legacyDesktop = compatibilityTransport
      ? createCompatibilityLegacyDesktopFamily()
      : createUnsupportedLegacyDesktopFamily();

    return {
      capabilities: {
        hostKind: 'phone',
        runtimeOwner,
        supportsDirectoryPicker: false,
        supportsRuntimeLogs: false,
      },
      objects: compatibilityTransport
        ? {
            requestJson: requestHostJson,
            requestBlob: requestHostBlob,
            openStream: openHostStream,
          }
        : {
            requestJson: () => createMissingPhoneRuntimeRequest(),
            requestBlob: () => createMissingPhoneRuntimeRequest(),
            openStream: () => createMissingPhoneRuntimeRequest(),
          },
      invalidation: compatibilityTransport
        ? {
            watchSources(handlers) {
              return openWatchConnection('/watch/sources', handlers);
            },
            watchVolume(auth, handlers) {
              return openWatchConnection('/watch/volume', handlers, { auth });
            },
          }
        : {
            watchSources(handlers) {
              queueMicrotask(() => {
                handlers.onError?.(createMissingPhoneRuntimeError());
                handlers.onClose?.();
              });
              return createUnsupportedWatchConnection();
            },
            watchVolume(_auth, handlers) {
              queueMicrotask(() => {
                handlers.onError?.(createMissingPhoneRuntimeError());
                handlers.onClose?.();
              });
              return createUnsupportedWatchConnection();
            },
          },
      lan: compatibilityTransport
        ? {
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
          }
        : {
            listPeers() {
              return createMissingPhoneRuntimeRequest();
            },
            syncPeer() {
              return createMissingPhoneRuntimeRequest();
            },
          },
      shell: {
        chooseDirectory: async () => null,
      },
      legacyDesktop,
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