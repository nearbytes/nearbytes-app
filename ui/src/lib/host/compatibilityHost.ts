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
      integrations: {
        listProviderAccounts(options) {
          const endpoint = options?.fast ? '/integrations/accounts?fast=1' : '/integrations/accounts';
          return createJsonRequest(endpoint, {
            method: 'GET',
            signal: options?.signal,
          });
        },
        connectProviderAccount(input, options) {
          return createJsonRequest('/integrations/accounts/connect', {
            method: 'POST',
            body: JSON.stringify(input),
            signal: options?.signal,
          });
        },
        disconnectProviderAccount(accountId) {
          return createJsonRequest<void>(`/integrations/accounts/${encodeURIComponent(accountId)}`, {
            method: 'DELETE',
          });
        },
        configureProviderSetup(provider, input) {
          return createJsonRequest(`/integrations/providers/${encodeURIComponent(provider)}/config`, {
            method: 'POST',
            body: JSON.stringify(input),
          });
        },
        installProviderHelper(provider, options) {
          return createJsonRequest(`/integrations/providers/${encodeURIComponent(provider)}/install`, {
            method: 'POST',
            signal: options?.signal,
          });
        },
        reconcileProviderManagedShares(provider, options) {
          return createJsonRequest(`/integrations/providers/${encodeURIComponent(provider)}/reconcile`, {
            method: 'POST',
            signal: options?.signal,
          });
        },
        listManagedShares(options) {
          const endpoint = options?.fast ? '/integrations/shares?fast=1' : '/integrations/shares';
          return createJsonRequest(endpoint, {
            method: 'GET',
            signal: options?.signal,
          });
        },
        listIncomingManagedShares(options) {
          const endpoint = options?.fast ? '/integrations/shares/incoming?fast=1' : '/integrations/shares/incoming';
          return createJsonRequest(endpoint, {
            method: 'GET',
            signal: options?.signal,
          });
        },
        listIncomingProviderContactInvites(options) {
          const endpoint = options?.fast
            ? '/integrations/providers/contact-invites?fast=1'
            : '/integrations/providers/contact-invites';
          return createJsonRequest(endpoint, {
            method: 'GET',
            signal: options?.signal,
          });
        },
        createManagedShare(input) {
          return createJsonRequest('/integrations/shares', {
            method: 'POST',
            body: JSON.stringify(input),
          });
        },
        inviteManagedShare(shareId, emails, accessLevel) {
          return createJsonRequest(`/integrations/shares/${encodeURIComponent(shareId)}/invite`, {
            method: 'POST',
            body: JSON.stringify({ emails, accessLevel }),
          });
        },
        attachManagedShare(shareId, volumeId) {
          return createJsonRequest(`/integrations/shares/${encodeURIComponent(shareId)}/attach`, {
            method: 'POST',
            body: JSON.stringify({ volumeId }),
          });
        },
        removeManagedShare(shareId) {
          return createJsonRequest<void>(`/integrations/shares/${encodeURIComponent(shareId)}`, {
            method: 'DELETE',
          });
        },
        acceptManagedShare(input) {
          return createJsonRequest('/integrations/shares/accept', {
            method: 'POST',
            body: JSON.stringify(input),
          });
        },
        acceptIncomingProviderContactInvite(input) {
          return createJsonRequest<void>('/integrations/providers/contact-invites/accept', {
            method: 'POST',
            body: JSON.stringify(input),
          });
        },
        getManagedShareState(shareId) {
          return createJsonRequest(`/integrations/shares/${encodeURIComponent(shareId)}/state`, {
            method: 'GET',
          });
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