import {
  openHostStream,
  requestHostBlob,
  requestHostJson,
  getRuntimeConfig,
} from './runtimeTransport.js';
import { createSecret } from '../../../../src/types/keys.js';
import { deriveKeys } from '../../../../src/crypto/asymmetric.js';
import { bytesToHex } from '../../../../src/utils/encoding.js';
import {
  readMirrorEventDetail,
  readMirrorLocalNetworkPeers,
  readMirrorTimelineSnapshot,
  readMirrorVolumeSnapshot,
} from '../mirror/browserMirror.js';
import {
  embeddedPhoneHasLocalVolume,
  embeddedPhoneDeleteFile,
  embeddedPhoneDownloadBlob,
  embeddedPhoneExportRecipientReferences,
  embeddedPhoneExportSourceReferences,
  embeddedPhoneGetEventDetail,
  embeddedPhoneGetTimeline,
  embeddedPhoneImportRecipientReferences,
  embeddedPhoneImportSourceReferences,
  embeddedPhoneListChat,
  embeddedPhoneListFiles,
  embeddedPhoneOpenVolume,
  embeddedPhonePublishIdentity,
  embeddedPhoneRenameFile,
  embeddedPhoneRenameFolder,
  embeddedPhoneSendChatMessage,
  embeddedPhoneUploadFile,
} from './embeddedPhoneServices.js';
import type {
  ChatAttachment,
  EventDetailResponse,
  IdentityProfile,
  ListFilesResponse,
  LocalNetworkPeersResponse,
  OpenVolumeResponse,
  PublishIdentityResponse,
  RecipientReferenceBundle,
  ReferenceExportResponse,
  ReferenceImportResponse,
  RenameFileResponse,
  RenameFolderResponse,
  SendChatMessageResponse,
  SourceReferenceBundle,
  UploadResponse,
  TimelineEvent,
  TimelineResponse,
  VolumeChatState,
} from '../api.js';
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
const EMBEDDED_PHONE_MIRROR_MESSAGE = 'Using persisted mirrored data. Runtime unavailable.';

function createMissingPhoneRuntimeError(): Error {
  return new Error(MISSING_PHONE_RUNTIME_MESSAGE);
}

function createMissingPhoneRuntimeRequest<T>(): Promise<T> {
  return Promise.reject(createMissingPhoneRuntimeError());
}

async function deriveVolumeIdFromSecret(secret: string): Promise<string> {
  const keyPair = await deriveKeys(createSecret(secret));
  return bytesToHex(keyPair.publicKey);
}

function readSecretAuth(auth: NearbytesAuth): string | null {
  return auth.type === 'secret' && auth.secret.trim().length > 0 ? auth.secret : null;
}

async function readEmbeddedMirrorState(secret: string): Promise<{
  volumeId: string;
  volumeSnapshot: Awaited<ReturnType<typeof readMirrorVolumeSnapshot>>;
  timelineSnapshot: Awaited<ReturnType<typeof readMirrorTimelineSnapshot>>;
}> {
  const volumeId = await deriveVolumeIdFromSecret(secret);
  const [volumeSnapshot, timelineSnapshot] = await Promise.all([
    readMirrorVolumeSnapshot(volumeId),
    readMirrorTimelineSnapshot(volumeId),
  ]);
  return {
    volumeId,
    volumeSnapshot,
    timelineSnapshot,
  };
}

function ensureEmbeddedMirrorState<T>(
  state: { volumeSnapshot: unknown; timelineSnapshot: unknown },
  value: T
): T {
  if (!state.volumeSnapshot && !state.timelineSnapshot) {
    throw createMissingPhoneRuntimeError();
  }
  return value;
}

function isTimelineIdentityEvent(event: TimelineEvent): boolean {
  return (
    event.type === 'DECLARE_IDENTITY' ||
    (event.type === 'APP_RECORD' &&
      (event.protocol === 'nb.identity.record.v1' || event.protocol === 'nb.identity.snapshot.v1'))
  );
}

function isTimelineChatEvent(event: TimelineEvent): boolean {
  return (
    event.type === 'CHAT_MESSAGE' ||
    (event.type === 'APP_RECORD' && event.protocol === 'nb.chat.message.v1')
  );
}

function buildChatStateFromTimeline(events: TimelineEvent[]): VolumeChatState {
  const identitiesByPublicKey = new Map<string, VolumeChatState['identities'][number]>();
  const messages: VolumeChatState['messages'] = [];

  for (const event of events) {
    if (isTimelineIdentityEvent(event) && event.authorPublicKey && event.record) {
      identitiesByPublicKey.set(event.authorPublicKey, {
        eventHash: event.eventHash,
        authorPublicKey: event.authorPublicKey,
        publishedAt: event.publishedAt ?? event.timestamp,
        record: event.record,
      });
      continue;
    }

    if (isTimelineChatEvent(event) && event.authorPublicKey && event.message) {
      messages.push({
        eventHash: event.eventHash,
        authorPublicKey: event.authorPublicKey,
        publishedAt: event.publishedAt ?? event.timestamp,
        message: event.message,
      });
    }
  }

  return {
    identities: Array.from(identitiesByPublicKey.values()),
    messages,
    isOffline: true,
  };
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
    async openVolume(secret: string): Promise<OpenVolumeResponse> {
      if (await embeddedPhoneHasLocalVolume(secret)) {
        return await embeddedPhoneOpenVolume(secret);
      }
      const state = await readEmbeddedMirrorState(secret);
      if (!state.volumeSnapshot && !state.timelineSnapshot) {
        return embeddedPhoneOpenVolume(secret);
      }
      return ensureEmbeddedMirrorState(state, {
        volumeId: state.volumeId,
        fileCount: state.volumeSnapshot?.files.length ?? 0,
        files: state.volumeSnapshot?.files ?? [],
        isOffline: true,
        storageHint: EMBEDDED_PHONE_MIRROR_MESSAGE,
      });
    },
    async listFiles(auth: NearbytesAuth): Promise<ListFilesResponse> {
      const secret = readSecretAuth(auth);
      if (!secret) {
        return createMissingPhoneRuntimeRequest();
      }
      if (await embeddedPhoneHasLocalVolume(secret)) {
        return await embeddedPhoneListFiles(secret);
      }
      const state = await readEmbeddedMirrorState(secret);
      if (!state.volumeSnapshot && !state.timelineSnapshot) {
        return embeddedPhoneListFiles(secret);
      }
      return ensureEmbeddedMirrorState(state, {
        volumeId: state.volumeId,
        files: state.volumeSnapshot?.files ?? [],
        isOffline: true,
      });
    },
    async getTimeline(auth: NearbytesAuth): Promise<TimelineResponse> {
      const secret = readSecretAuth(auth);
      if (!secret) {
        return createMissingPhoneRuntimeRequest();
      }
      if (await embeddedPhoneHasLocalVolume(secret)) {
        return await embeddedPhoneGetTimeline(secret);
      }
      const state = await readEmbeddedMirrorState(secret);
      if (!state.volumeSnapshot && !state.timelineSnapshot) {
        return embeddedPhoneGetTimeline(secret);
      }
      return ensureEmbeddedMirrorState(state, {
        volumeId: state.volumeId,
        eventCount: state.timelineSnapshot?.eventCount ?? state.timelineSnapshot?.events.length ?? 0,
        events: state.timelineSnapshot?.events ?? [],
        isOffline: true,
      });
    },
    async getEventDetail(auth: NearbytesAuth, eventHash: string): Promise<EventDetailResponse> {
      const secret = readSecretAuth(auth);
      if (secret && await embeddedPhoneHasLocalVolume(secret)) {
          return await embeddedPhoneGetEventDetail(secret, eventHash);
      }
      const mirrored = await readMirrorEventDetail(eventHash);
      if (!mirrored) {
        return createMissingPhoneRuntimeRequest();
      }
      return {
        eventHash: mirrored.eventHash,
        event: mirrored.event,
        decryptedPayload: mirrored.decryptedPayload,
      };
    },
    getEventStorageLocations(_auth: NearbytesAuth, _eventHash: string): Promise<unknown> {
      return createMissingPhoneRuntimeRequest();
    },
    async uploadFile(auth: NearbytesAuth, file: File): Promise<UploadResponse> {
      const secret = readSecretAuth(auth);
      if (!secret) {
        return createMissingPhoneRuntimeRequest();
      }
      return embeddedPhoneUploadFile(secret, file);
    },
    async deleteFile(auth: NearbytesAuth, filename: string): Promise<void> {
      const secret = readSecretAuth(auth);
      if (!secret) {
        return createMissingPhoneRuntimeRequest();
      }
      return embeddedPhoneDeleteFile(secret, filename);
    },
    async renameFile(auth: NearbytesAuth, from: string, to: string): Promise<RenameFileResponse> {
      const secret = readSecretAuth(auth);
      if (!secret) {
        return createMissingPhoneRuntimeRequest();
      }
      return embeddedPhoneRenameFile(secret, from, to);
    },
    async renameFolder(auth: NearbytesAuth, from: string, to: string, merge: boolean): Promise<RenameFolderResponse> {
      const secret = readSecretAuth(auth);
      if (!secret) {
        return createMissingPhoneRuntimeRequest();
      }
      return embeddedPhoneRenameFolder(secret, from, to, merge);
    },
    async exportSourceReferences(auth: NearbytesAuth, filenames: string[]): Promise<ReferenceExportResponse<SourceReferenceBundle>> {
      const secret = readSecretAuth(auth);
      if (!secret) {
        return createMissingPhoneRuntimeRequest();
      }
      return embeddedPhoneExportSourceReferences(secret, filenames);
    },
    async importSourceReferences(auth: NearbytesAuth, bundle: unknown, sourceSecret: string): Promise<ReferenceImportResponse> {
      const secret = readSecretAuth(auth);
      if (!secret) {
        return createMissingPhoneRuntimeRequest();
      }
      return embeddedPhoneImportSourceReferences(secret, bundle as SourceReferenceBundle, sourceSecret);
    },
    async exportRecipientReferences(
      auth: NearbytesAuth,
      filenames: string[],
      recipientVolumeId: string
    ): Promise<ReferenceExportResponse<RecipientReferenceBundle>> {
      const secret = readSecretAuth(auth);
      if (!secret) {
        return createMissingPhoneRuntimeRequest();
      }
      return embeddedPhoneExportRecipientReferences(secret, filenames, recipientVolumeId);
    },
    async importRecipientReferences(auth: NearbytesAuth, bundle: unknown): Promise<ReferenceImportResponse> {
      const secret = readSecretAuth(auth);
      if (!secret) {
        return createMissingPhoneRuntimeRequest();
      }
      return embeddedPhoneImportRecipientReferences(secret, bundle as RecipientReferenceBundle);
    },
    async listChat(auth: NearbytesAuth): Promise<VolumeChatState> {
      const secret = readSecretAuth(auth);
      if (!secret) {
        return createMissingPhoneRuntimeRequest();
      }
      if (await embeddedPhoneHasLocalVolume(secret)) {
        return await embeddedPhoneListChat(secret);
      }
      const state = await readEmbeddedMirrorState(secret);
      if (!state.volumeSnapshot && !state.timelineSnapshot) {
        return embeddedPhoneListChat(secret);
      }
      return ensureEmbeddedMirrorState(
        state,
        buildChatStateFromTimeline(state.timelineSnapshot?.events ?? [])
      );
    },
    async publishIdentity(auth: NearbytesAuth, identitySecret: string, profile: unknown): Promise<PublishIdentityResponse> {
      const secret = readSecretAuth(auth);
      if (!secret) {
        return createMissingPhoneRuntimeRequest();
      }
      return embeddedPhonePublishIdentity(secret, identitySecret, profile as IdentityProfile);
    },
    async sendChatMessage(
      auth: NearbytesAuth,
      identitySecret: string,
      input: { body?: string; attachment?: unknown }
    ): Promise<SendChatMessageResponse> {
      const secret = readSecretAuth(auth);
      if (!secret) {
        return createMissingPhoneRuntimeRequest();
      }
      return embeddedPhoneSendChatMessage(secret, identitySecret, input as { body?: string; attachment?: ChatAttachment });
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
            async requestBlob(endpoint, options) {
              const headers = new Headers(options?.headers);
              const secret = headers.get('x-nearbytes-secret');
              if (!secret || !endpoint.startsWith('/file/')) {
                return createMissingPhoneRuntimeRequest();
              }
              const blobHash = endpoint.slice('/file/'.length);
              return embeddedPhoneDownloadBlob(secret, blobHash);
            },
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
            async listPeers(): Promise<LocalNetworkPeersResponse> {
              const mirrored = await readMirrorLocalNetworkPeers();
              if (!mirrored) {
                return createMissingPhoneRuntimeRequest();
              }
              return {
                ...mirrored,
                isOffline: true,
              };
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