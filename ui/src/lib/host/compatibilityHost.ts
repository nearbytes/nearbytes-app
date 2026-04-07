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
  NearbytesHostContract,
} from './contract.js';
import {
  createJsonRequest,
  openWatchConnection,
} from './transportHostHelpers.js';

let hostPromise: Promise<NearbytesHostContract> | null = null;

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