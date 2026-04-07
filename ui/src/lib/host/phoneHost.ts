import { getRuntimeConfig } from './runtimeTransport.js';
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
  embeddedPhoneLanPeersResponse,
  embeddedPhoneSubscribeVolumeWatch,
  embeddedPhoneSyncPeer,
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

let hostPromise: Promise<NearbytesHostContract> | null = null;

const MISSING_PHONE_RUNTIME_MESSAGE =
  'Phone runtime capability is not implemented in the embedded phone host yet.';
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

function createUnsupportedWatchConnection(): { close(): void } {
  return {
    close() {
      // No-op because the phone runtime was unavailable.
    },
  };
}

function createEmbeddedWatchMessage(eventName: string, payload: unknown): MessageEvent {
  const data = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
  if (typeof MessageEvent === 'function') {
    return new MessageEvent('message', { data });
  }
  return { data } as MessageEvent;
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

export function resetPhoneHostForTests(): void {
  hostPromise = null;
}

export async function getPhoneHost(): Promise<NearbytesHostContract> {
  if (hostPromise) {
    return hostPromise;
  }

  hostPromise = (async () => {
    await getRuntimeConfig();
    const runtimeOwner: NearbytesHostContract['capabilities']['runtimeOwner'] = 'embedded';
    const legacyDesktop = createUnsupportedLegacyDesktopFamily();

    return {
      capabilities: {
        hostKind: 'phone',
        runtimeOwner,
        supportsDirectoryPicker: false,
        supportsRuntimeLogs: false,
      },
      objects: {
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
      invalidation: {
        watchSources(handlers) {
          queueMicrotask(() => {
            handlers.onError?.(createMissingPhoneRuntimeError());
            handlers.onClose?.();
          });
          return createUnsupportedWatchConnection();
        },
        watchVolume(auth, handlers) {
          const secret = readSecretAuth(auth);
          if (!secret) {
            queueMicrotask(() => {
              handlers.onError?.(createMissingPhoneRuntimeError());
              handlers.onClose?.();
            });
            return createUnsupportedWatchConnection();
          }

          let unsubscribe: (() => void) | null = null;
          let closed = false;

          void (async () => {
            try {
              const subscription = await embeddedPhoneSubscribeVolumeWatch(secret, (update) => {
                if (closed) {
                  return;
                }
                handlers.onMessage?.(createEmbeddedWatchMessage('volume-update', update));
              });
              if (closed) {
                subscription.unsubscribe();
                return;
              }
              unsubscribe = () => {
                subscription.unsubscribe();
              };
              handlers.onMessage?.(createEmbeddedWatchMessage('watch-ready', subscription.ready));
            } catch (error) {
              if (closed) {
                return;
              }
              handlers.onError?.(error instanceof Error ? error : new Error(String(error)));
              handlers.onClose?.();
            }
          })();

          return {
            close() {
              closed = true;
              unsubscribe?.();
              unsubscribe = null;
            },
          };
        },
      },
      lan: {
        async listPeers(): Promise<LocalNetworkPeersResponse> {
          const mirrored = await readMirrorLocalNetworkPeers();
          return embeddedPhoneLanPeersResponse(mirrored?.peers ?? []);
        },
        async syncPeer(peerId: string) {
          const mirrored = await readMirrorLocalNetworkPeers();
          return embeddedPhoneSyncPeer(peerId, mirrored?.peers ?? []);
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