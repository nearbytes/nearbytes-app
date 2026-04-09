import { getRuntimeConfig, HostRequestError } from './runtimeTransport.js';
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
  embeddedPhoneDiscoverSources,
  embeddedPhoneGetAppConfig,
  embeddedPhoneGetEventStorageLocations,
  embeddedPhoneGetRootsConfig,
  embeddedPhoneHasReadableVolume,
  embeddedPhoneHasLocalVolume,
  embeddedPhoneLanPeersResponse,
  embeddedPhoneReconcileSources,
  embeddedPhoneSubscribeVolumeWatch,
  embeddedPhoneSyncPeer,
  embeddedPhoneUpdateProviderEnabled,
  embeddedPhoneUpdateRootsConfig,
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
import {
  listNativeLanPeers,
  notifyNativeLanVolumeMutation,
  resetNativeLanRuntimeForTests,
  syncNativeLanPeer,
} from './nativeLanSync.js';
import { hasNativeLanPlugin } from './nativeLanPlugin.js';
import type {
  ChatAttachment,
  EventDetailResponse,
  IdentityProfile,
  ConfigureProviderResponse,
  ConnectProviderAccountResponse,
  IncomingManagedSharesResponse,
  IncomingProviderContactInvitesResponse,
  ListFilesResponse,
  LocalNetworkPeersResponse,
  ManagedShareMutationResponse,
  ManagedSharesResponse,
  OpenVolumeResponse,
  PublishIdentityResponse,
  ProviderAccountsResponse,
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
  return new HostRequestError(501, MISSING_PHONE_RUNTIME_MESSAGE);
}

function createMissingPhoneRuntimeRequest<T>(): Promise<T> {
  return Promise.reject(createMissingPhoneRuntimeError());
}

function createUnsupportedPhoneIntegrationError(scope: string): HostRequestError {
  return new HostRequestError(
    501,
    `${MISSING_PHONE_RUNTIME_MESSAGE} ${scope}`
  );
}

function createUnsupportedPhoneIntegrationsFamily(): NearbytesHostContract['integrations'] {
  return {
    async listProviderAccounts(): Promise<ProviderAccountsResponse> {
      return {
        accounts: [],
        providers: [],
        preferredProviders: [],
      };
    },
    async connectProviderAccount(): Promise<ConnectProviderAccountResponse> {
      throw createUnsupportedPhoneIntegrationError('Provider sign-in is not available on this device yet.');
    },
    async disconnectProviderAccount(): Promise<void> {
      throw createUnsupportedPhoneIntegrationError('Provider disconnection is not available on this device yet.');
    },
    async configureProviderSetup(): Promise<ConfigureProviderResponse> {
      throw createUnsupportedPhoneIntegrationError('Provider setup is not available on this device yet.');
    },
    async installProviderHelper(): Promise<ConfigureProviderResponse> {
      throw createUnsupportedPhoneIntegrationError('Provider helper installation is not available on this device yet.');
    },
    async reconcileProviderManagedShares(): Promise<unknown> {
      throw createUnsupportedPhoneIntegrationError('Provider reconciliation is not available on this device yet.');
    },
    async listManagedShares(): Promise<ManagedSharesResponse> {
      return { shares: [] };
    },
    async listIncomingManagedShares(): Promise<IncomingManagedSharesResponse> {
      return { shares: [] };
    },
    async listIncomingProviderContactInvites(): Promise<IncomingProviderContactInvitesResponse> {
      return { invites: [] };
    },
    async createManagedShare(): Promise<ManagedShareMutationResponse> {
      throw createUnsupportedPhoneIntegrationError('Managed-share creation is not available on this device yet.');
    },
    async inviteManagedShare(): Promise<ManagedShareMutationResponse> {
      throw createUnsupportedPhoneIntegrationError('Managed-share invites are not available on this device yet.');
    },
    async attachManagedShare(): Promise<ManagedShareMutationResponse> {
      throw createUnsupportedPhoneIntegrationError('Managed-share attachment is not available on this device yet.');
    },
    async removeManagedShare(): Promise<void> {
      throw createUnsupportedPhoneIntegrationError('Managed-share removal is not available on this device yet.');
    },
    async acceptManagedShare(): Promise<ManagedShareMutationResponse> {
      throw createUnsupportedPhoneIntegrationError('Incoming managed-share acceptance is not available on this device yet.');
    },
    async acceptIncomingProviderContactInvite(): Promise<void> {
      throw createUnsupportedPhoneIntegrationError('Provider contact invites are not available on this device yet.');
    },
    async getManagedShareState(): Promise<ManagedShareMutationResponse> {
      throw createUnsupportedPhoneIntegrationError('Managed-share state inspection is not available on this device yet.');
    },
  };
}

async function deriveVolumeIdFromSecret(secret: string): Promise<string> {
  const keyPair = await deriveKeys(createSecret(secret));
  return bytesToHex(keyPair.publicKey);
}

async function notifyPhoneLanMutation(secret: string): Promise<void> {
  if (!hasNativeLanPlugin()) {
    return;
  }
  try {
    await notifyNativeLanVolumeMutation(await deriveVolumeIdFromSecret(secret));
  } catch {
    // Peer hinting is best-effort; local mutation has already committed.
  }
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

function describeEmbeddedLiveFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.replace(/\s+/gu, ' ').trim();
  return normalized.length > 0 ? normalized : 'Unknown embedded runtime failure';
}

function logEmbeddedMirrorFallback(scope: string, volumeId: string, reason: string): void {
  console.warn(
    `[Nearbytes Phone Host] Falling back to persisted mirror for ${scope} on ${volumeId}: ${reason}`
  );
}

async function readEmbeddedLiveWithMirrorFallback<T>(options: {
  secret: string;
  state: Awaited<ReturnType<typeof readEmbeddedMirrorState>>;
  scope: string;
  liveRead: () => Promise<T>;
  offlineValue: (state: Awaited<ReturnType<typeof readEmbeddedMirrorState>>, reason: string) => T;
}): Promise<T> {
  try {
    return await options.liveRead();
  } catch (error) {
    if (!options.state.volumeSnapshot && !options.state.timelineSnapshot) {
      throw error;
    }
    const reason = describeEmbeddedLiveFailure(error);
    logEmbeddedMirrorFallback(options.scope, options.state.volumeId, reason);
    return ensureEmbeddedMirrorState(options.state, options.offlineValue(options.state, reason));
  }
}

async function ensureEmbeddedReadableVolume(secret: string, volumeIdHint?: string): Promise<boolean> {
  if (await embeddedPhoneHasReadableVolume(secret)) {
    return true;
  }
  if (!hasNativeLanPlugin()) {
    return false;
  }

  const targetVolumeId = volumeIdHint ?? await deriveVolumeIdFromSecret(secret);
  const response = await listNativeLanPeers();
  const matchingPeers = response.peers.filter((peer) => peer.volumeIds.includes(targetVolumeId));
  const candidatePeers = matchingPeers.length > 0 ? matchingPeers : response.peers;
  if (candidatePeers.length === 0) {
    return false;
  }

  await Promise.allSettled(candidatePeers.map((peer) => syncNativeLanPeer(peer.peerId)));
  return embeddedPhoneHasReadableVolume(secret);
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
      const state = await readEmbeddedMirrorState(secret);
      await ensureEmbeddedReadableVolume(secret, state.volumeId);
      if (!state.volumeSnapshot && !state.timelineSnapshot) {
        return embeddedPhoneOpenVolume(secret);
      }
      return readEmbeddedLiveWithMirrorFallback({
        secret,
        state,
        scope: 'openVolume',
        liveRead: () => embeddedPhoneOpenVolume(secret),
        offlineValue: (offlineState, reason) => ({
          volumeId: offlineState.volumeId,
          fileCount: offlineState.volumeSnapshot?.files.length ?? 0,
          files: offlineState.volumeSnapshot?.files ?? [],
          isOffline: true,
          runtimeFailureReason: reason,
          storageHint: EMBEDDED_PHONE_MIRROR_MESSAGE,
        }),
      });
    },
    async listFiles(auth: NearbytesAuth): Promise<ListFilesResponse> {
      const secret = readSecretAuth(auth);
      if (!secret) {
        return createMissingPhoneRuntimeRequest();
      }
      const state = await readEmbeddedMirrorState(secret);
      await ensureEmbeddedReadableVolume(secret, state.volumeId);
      if (!state.volumeSnapshot && !state.timelineSnapshot) {
        return embeddedPhoneListFiles(secret);
      }
      return readEmbeddedLiveWithMirrorFallback({
        secret,
        state,
        scope: 'listFiles',
        liveRead: () => embeddedPhoneListFiles(secret),
        offlineValue: (offlineState, reason) => ({
          volumeId: offlineState.volumeId,
          files: offlineState.volumeSnapshot?.files ?? [],
          isOffline: true,
          runtimeFailureReason: reason,
        }),
      });
    },
    async getTimeline(auth: NearbytesAuth): Promise<TimelineResponse> {
      const secret = readSecretAuth(auth);
      if (!secret) {
        return createMissingPhoneRuntimeRequest();
      }
      const state = await readEmbeddedMirrorState(secret);
      await ensureEmbeddedReadableVolume(secret, state.volumeId);
      if (!state.volumeSnapshot && !state.timelineSnapshot) {
        return embeddedPhoneGetTimeline(secret);
      }
      return readEmbeddedLiveWithMirrorFallback({
        secret,
        state,
        scope: 'getTimeline',
        liveRead: () => embeddedPhoneGetTimeline(secret),
        offlineValue: (offlineState, reason) => ({
          volumeId: offlineState.volumeId,
          eventCount: offlineState.timelineSnapshot?.eventCount ?? offlineState.timelineSnapshot?.events.length ?? 0,
          events: offlineState.timelineSnapshot?.events ?? [],
          isOffline: true,
          runtimeFailureReason: reason,
        }),
      });
    },
    async getEventDetail(auth: NearbytesAuth, eventHash: string): Promise<EventDetailResponse> {
      const secret = readSecretAuth(auth);
      const mirrored = await readMirrorEventDetail(eventHash);
      if (!secret) {
        if (!mirrored) {
          return createMissingPhoneRuntimeRequest();
        }
        return {
          eventHash: mirrored.eventHash,
          event: mirrored.event,
          decryptedPayload: mirrored.decryptedPayload,
        };
      }

      await ensureEmbeddedReadableVolume(secret);
      try {
        return await embeddedPhoneGetEventDetail(secret, eventHash);
      } catch (error) {
        if (!mirrored) {
          throw error;
        }
        logEmbeddedMirrorFallback('getEventDetail', eventHash, describeEmbeddedLiveFailure(error));
      }
      return {
        eventHash: mirrored.eventHash,
        event: mirrored.event,
        decryptedPayload: mirrored.decryptedPayload,
      };
    },
    getEventStorageLocations(_auth: NearbytesAuth, _eventHash: string): Promise<unknown> {
      const secret = readSecretAuth(_auth);
      if (!secret) {
        return createMissingPhoneRuntimeRequest();
      }
      return embeddedPhoneGetEventStorageLocations(secret, _eventHash);
    },
    async uploadFile(auth: NearbytesAuth, file: File): Promise<UploadResponse> {
      const secret = readSecretAuth(auth);
      if (!secret) {
        return createMissingPhoneRuntimeRequest();
      }
      const result = await embeddedPhoneUploadFile(secret, file);
      await notifyPhoneLanMutation(secret);
      return result;
    },
    async deleteFile(auth: NearbytesAuth, filename: string): Promise<void> {
      const secret = readSecretAuth(auth);
      if (!secret) {
        return createMissingPhoneRuntimeRequest();
      }
      await embeddedPhoneDeleteFile(secret, filename);
      await notifyPhoneLanMutation(secret);
    },
    async renameFile(auth: NearbytesAuth, from: string, to: string): Promise<RenameFileResponse> {
      const secret = readSecretAuth(auth);
      if (!secret) {
        return createMissingPhoneRuntimeRequest();
      }
      const result = await embeddedPhoneRenameFile(secret, from, to);
      await notifyPhoneLanMutation(secret);
      return result;
    },
    async renameFolder(auth: NearbytesAuth, from: string, to: string, merge: boolean): Promise<RenameFolderResponse> {
      const secret = readSecretAuth(auth);
      if (!secret) {
        return createMissingPhoneRuntimeRequest();
      }
      const result = await embeddedPhoneRenameFolder(secret, from, to, merge);
      await notifyPhoneLanMutation(secret);
      return result;
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
      const result = await embeddedPhoneImportSourceReferences(secret, bundle as SourceReferenceBundle, sourceSecret);
      await notifyPhoneLanMutation(secret);
      return result;
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
      const result = await embeddedPhoneImportRecipientReferences(secret, bundle as RecipientReferenceBundle);
      await notifyPhoneLanMutation(secret);
      return result;
    },
    async listChat(auth: NearbytesAuth): Promise<VolumeChatState> {
      const secret = readSecretAuth(auth);
      if (!secret) {
        return createMissingPhoneRuntimeRequest();
      }
      const state = await readEmbeddedMirrorState(secret);
      await ensureEmbeddedReadableVolume(secret, state.volumeId);
      if (!state.volumeSnapshot && !state.timelineSnapshot) {
        return embeddedPhoneListChat(secret);
      }
      return readEmbeddedLiveWithMirrorFallback({
        secret,
        state,
        scope: 'listChat',
        liveRead: () => embeddedPhoneListChat(secret),
        offlineValue: (offlineState) => buildChatStateFromTimeline(offlineState.timelineSnapshot?.events ?? []),
      });
    },
    async publishIdentity(auth: NearbytesAuth, identitySecret: string, profile: unknown): Promise<PublishIdentityResponse> {
      const secret = readSecretAuth(auth);
      if (!secret) {
        return createMissingPhoneRuntimeRequest();
      }
      const result = await embeddedPhonePublishIdentity(secret, identitySecret, profile as IdentityProfile);
      await notifyPhoneLanMutation(secret);
      return result;
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
      const result = await embeddedPhoneSendChatMessage(secret, identitySecret, input as { body?: string; attachment?: ChatAttachment });
      await notifyPhoneLanMutation(secret);
      return result;
    },
  };
}

function parseObjectRequestBody(options?: RequestInit): unknown {
  if (typeof options?.body !== 'string' || options.body.trim().length === 0) {
    return null;
  }
  try {
    return JSON.parse(options.body);
  } catch {
    throw new HostRequestError(400, 'Invalid JSON body');
  }
}

async function handleEmbeddedPhoneJsonRequest<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const requestUrl = new URL(endpoint, 'http://nearbytes.invalid');
  const method = (options?.method ?? 'GET').toUpperCase();

  if (method === 'GET' && requestUrl.pathname === '/config/roots') {
    return embeddedPhoneGetRootsConfig(requestUrl.searchParams.get('includeUsage') === '1') as Promise<T>;
  }
  if (method === 'PUT' && requestUrl.pathname === '/config/roots') {
    const body = parseObjectRequestBody(options) as { config?: unknown } | null;
    if (!body?.config) {
      throw new HostRequestError(400, 'Missing roots config payload');
    }
    return embeddedPhoneUpdateRootsConfig(body.config as never) as Promise<T>;
  }
  if (method === 'GET' && requestUrl.pathname === '/config/app') {
    return embeddedPhoneGetAppConfig() as Promise<T>;
  }
  if (method === 'PUT' && requestUrl.pathname.startsWith('/config/app/providers/')) {
    const provider = decodeURIComponent(requestUrl.pathname.slice('/config/app/providers/'.length));
    const body = parseObjectRequestBody(options) as { enabled?: unknown } | null;
    if (typeof body?.enabled !== 'boolean') {
      throw new HostRequestError(400, 'Provider enabled must be a boolean.');
    }
    return embeddedPhoneUpdateProviderEnabled(provider, body.enabled) as Promise<T>;
  }
  if (method === 'GET' && requestUrl.pathname === '/sources/discover') {
    return embeddedPhoneDiscoverSources() as Promise<T>;
  }
  if (method === 'POST' && requestUrl.pathname === '/sources/reconcile') {
    const body = parseObjectRequestBody(options) as { knownVolumeIds?: unknown } | null;
    const knownVolumeIds = Array.isArray(body?.knownVolumeIds)
      ? body.knownVolumeIds.map((value) => String(value))
      : [];
    return embeddedPhoneReconcileSources(knownVolumeIds) as Promise<T>;
  }

  return createMissingPhoneRuntimeRequest();
}

export function resetPhoneHostForTests(): void {
  hostPromise = null;
  resetNativeLanRuntimeForTests();
}

export async function getPhoneHost(): Promise<NearbytesHostContract> {
  if (hostPromise) {
    return hostPromise;
  }

  hostPromise = (async () => {
    await getRuntimeConfig();
    const runtimeOwner: NearbytesHostContract['capabilities']['runtimeOwner'] = 'embedded';
    const integrations = createUnsupportedPhoneIntegrationsFamily();
    const legacyDesktop = createUnsupportedLegacyDesktopFamily();

    if (hasNativeLanPlugin()) {
      void listNativeLanPeers().catch((error) => {
        console.warn('[Nearbytes LAN][Phone] Failed to warm the embedded native LAN runtime.', error);
      });
    }

    return {
      capabilities: {
        hostKind: 'phone',
        runtimeOwner,
        supportsDirectoryPicker: false,
        supportsRuntimeLogs: false,
      },
      objects: {
        requestJson: handleEmbeddedPhoneJsonRequest,
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
      integrations,
      lan: {
        async listPeers(): Promise<LocalNetworkPeersResponse> {
          if (hasNativeLanPlugin()) {
            return await listNativeLanPeers();
          }
          const mirrored = await readMirrorLocalNetworkPeers();
          return embeddedPhoneLanPeersResponse(mirrored?.peers ?? [], {}, { isOffline: true });
        },
        async syncPeer(peerId: string) {
          if (hasNativeLanPlugin()) {
            return await syncNativeLanPeer(peerId);
          }
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