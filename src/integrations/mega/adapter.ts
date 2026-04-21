import { Buffer } from 'buffer';
import {
  MEGA_AUTH_METHOD_SEEN,
  MEGA_RECONNECT_REQUIRED_MESSAGE,
  type MegaAccountSecret,
  type MegaApiError,
  type MegaFsWatcher,
  type MegaSession,
} from './core.js';
import {
  createMegaPasswordSession,
  decodePersistedMegaShareKeys,
  deserializeSession,
  encodePersistedMegaShareKeys,
  extractMegaReusableCredentials,
  isStoredMegaAccountSecret,
} from './auth.js';
import { deriveMegaPairwiseKey, encryptAesEcb } from './crypto.js';
import {
  createMegaReconnectRequiredError,
  createMegaSyncAbortController,
  debugMegaLog,
  getMegaApiErrorCode,
  getMegaRetryDelayMs,
  isDevLogsEnabled,
  isMegaAccessDeniedError,
  isMegaEventuallyConsistentMutationError,
  isMegaMissingRequestedRootError,
  isMegaRetryableApiError,
  isMegaRetryableTransportError,
  isMegaSessionInvalid,
  isMegaTemporaryLockError,
  isMegaTransientSyncError,
  isMegaUploadProbeEnabled,
  normalizeMegaConnectError,
  touchMegaSyncActivity,
  waitForMegaRetry,
  withMegaApiRetry,
} from './errors.js';
import { getMegaChokidar, getMegaNodeFs, randomBytes } from './runtime.js';
import {
  buildMegaScChannelUrl,
  decodeMegaBase64Url,
  encodeMegaBase64Url,
  MegaApiClient,
  parseMegaActionPacketBatch,
  parseMegaJsonResponse,
  solveMegaHashcashChallenge,
  type MegaActionPacketBatch,
  type MegaFetchNodesSnapshot,
} from './protocol.js';
import {
  mirrorMegaPublicLink,
  normalizeMegaPublicLinkDescriptor,
  resolveMegaPublicLinkTarget,
} from './publicLink.js';
import { managedSharePath as path } from '../managedSharePath.js';
import {
  parseCanonicalEventRelativePath,
  validateCanonicalStorageFile,
} from '../../storage/integrity.js';
import { MirrorWorker } from '../mirrorWorker.js';
import type {
  ManagedShareMirrorEntry,
  ManagedShareReceiveProbe,
  ManagedShareRemoteEntryProbe,
  ManagedShareUploadProbe,
  ProviderShareInventoryDebugEntry,
} from '../adapters.js';
import {
  ProviderRefreshWorker,
  type ProviderRefreshManifestEntry,
} from '../providerRefreshWorker.js';
import type {
  AcceptManagedShareInput,
  ConnectProviderAccountInput,
  ConnectProviderAccountResult,
  ConfigureProviderInput,
  CreateManagedShareInput,
  IncomingManagedShareOffer,
  IncomingProviderContactInvite,
  InviteManagedShareInput,
  ManagedShare,
  ManagedShareCollaborator,
  ProviderAccount,
  ProviderSetupState,
  ShareStorageMetrics,
  TransportEndpoint,
  TransportState,
} from '../types.js';
import type { IntegrationRuntime } from '../runtime.js';
import { type RuntimeTimerHandle } from '../../runtime/scheduler.js';
import * as adapterConstants from './adapterConstants.js';
import type {
  DecryptedMegaNode,
  MegaAdapterOptions,
  MegaFetchedTree,
  MegaKeyManagerState,
  MegaKnownRemoteFile,
  MegaMirrorManifest,
  MegaOwnerRemoteRoot,
  MegaOwnerSyncResult,
  MegaOwnerUploadState,
  MegaPendingInShareRecord,
  MegaRecipientProbeContext,
  MegaShareCryptoContext,
  MegaShareInviteTarget,
} from './adapterTypes.js';
import {
  buildMegaKeyManagerContainerWithShareKey,
  buildMegaShareInventoryDebugEntries,
  collectMegaShareKeyRelatedHandles,
  collectMegaShareKeys,
  fetchMegaKeyManagerState,
  fetchMegaPendingInShareKeys,
  fetchMegaUserPublicCu25519,
  listIncomingMegaShareOffersWithDiag,
  mergeMegaPendingInShares,
  mergeMegaShareKeyMaps,
  resolveMegaKeyManagerShareKeys,
  snapshotHasIncomingShareCandidates,
} from './keyManager.js';
import {
  decryptNodeRecord,
  downloadAuthenticatedMegaFileContent,
  fingerprintMegaShareKey,
  listMegaNodeKeyOwners,
  resolveMegaCloudDriveHandle,
} from './nodeCrypto.js';
import {
  acceptedShareCapabilities,
  annotateMegaOwnerSyncPhaseError,
  buildOwnerShareHealCooldownKey,
  collectMegaOwnerCollaborators,
  collectMegaOwnerShareInviteTargets,
  countMegaOwnerSharePeers,
  createOpaqueId,
  describeMegaOwnerSyncFailure,
  ensureMegaOwnerLocalStructure,
  getMegaShareRemotePath,
  getStringDescriptor,
  incomingShareMatches,
  isMegaUserHandle,
  isLegacyMegaLocalMirror,
  isZeroBuffer,
  mapIncomingMegaContactInvite,
  megaOutgoingShareRecordNodeHandles,
  mirrorManifestKey,
  normalizeMegaRemoteDisplayPath,
  resolveMegaInviteAccessLevel,
  resolveMegaPendingOutShareTarget,
  resolveMegaShareInviteTarget,
  secretKey,
  snapshotHasOutgoingShareForRoot,
  snapshotReflectsOutgoingInvitees,
  uniqueTrimmedStrings,
} from './shareHelpers.js';
import { keepMegaSyncAliveWhile } from './syncUtils.js';
import {
  actionPacketBatchTouchesShare,
  allActionsAreAccountLevel,
  buildManifestHandlePathIndex,
  buildMegaOwnerUploadState,
  buildMegaSetShareCommand,
  buildMegaShareNodeKeyRecords,
  buildMegaUsersByHandleFromActionPackets,
  collectManifestHandles,
  collectRecipientDeletedPacketHandles,
  collectRecipientImmediatePacketHandles,
  collectRecipientImmediatePacketNodes,
  collectTreeHandles,
  compareOwnerMirrorRelativePaths,
  createMegaActionPacketLogDetails,
  createMegaMutationRequestId,
  createProviderRefreshManifestEntry,
  decryptMegaTree,
  deleteMegaNode,
  describeMegaSyncFailure,
  encryptMegaAttributes,
  encryptMegaNodeKeyForOwner,
  extractMegaShareKeysFromActionPackets,
  extractReferencedRuntimeSourceBlockPaths,
  fetchMegaDecryptedTree,
  fetchMegaNodesSnapshot,
  fetchOwnerRootByPath,
  findChildNodeByName,
  findChildNodesByName,
  findNodeByRelativePath,
  hasUsableMegaMirror,
  isMirrorContainerPath,
  isMirrorRelativePath,
  isRecipientMirrorContainerPath,
  isRuntimeSourceMirrorFileMissing,
  listMegaTopLevelEntryNames,
  listUnsupportedMegaTopLevelEntryNames,
  logMegaMirrorRefreshEvents,
  logUnsupportedMegaTopLevelEntries,
  MegaOwnerRemoteAdapter,
  MegaReadonlyRemoteAdapter,
  normalizeRelativePath,
  removeManifestEntriesUnderPath,
  replaceMegaOwnerUploadStateFromTree,
  resolveMegaRecipientMirrorRootName,
  resolveRecipientFetchedNodePath,
  resolveRecipientPacketNodePath,
  shouldApplyRecipientMirrorPath,
  shouldResetScCursor,
  summarizeActionPacketActions,
  summarizeOwnerMirrorResult,
  summarizeRefreshResult,
  visitTree,
} from './treeHelpers.js';

export { decodeMegaPrivateAttributeRecordsForTesting } from './crypto.js';
export {
  clearMegaRemotePathForE2e,
  rebuildMegaSecurityAttributeForE2e,
  resetMegaSecurityAttributeForE2e,
  revokeMegaOutgoingSharesForPeers,
  wipeMegaCloudDriveContentsForE2e,
} from './admin.js';

const {
  MAX_PERSISTED_MEGA_MANIFEST_JSON_BYTES,
  MEGA_CREATE_RECOVERY_ATTEMPTS,
  MEGA_CONTACT_INVITES_CACHE_MS,
  MEGA_DEV_INVENTORY_REFRESH_MIN_INTERVAL_MS,
  MEGA_INCOMING_DISCOVERY_CACHE_MS,
  MEGA_LOCAL_WATCH_DEBOUNCE_MS,
  MEGA_LOCAL_WRITE_SUPPRESSION_MS,
  MEGA_NODE_APPEAR_ATTEMPTS,
  MEGA_NODE_APPEAR_DELAYS_MS,
  MEGA_OWNER_COLLABORATOR_CACHE_MS,
  MEGA_OWNER_SHARE_KEY_HEAL_INTERVAL_MS,
  MEGA_OWNER_SHARE_KEY_HEAL_RETRY_MS,
  MEGA_PENDING_ROOT_DIAGNOSTIC_MIN_INTERVAL_MS,
  MEGA_POST_UPLOAD_SETTLE_MS,
  MEGA_PUT_NODES_PLACEHOLDER_HANDLE,
  MEGA_RECIPIENT_PRIORITY_WINDOW_MS,
  MEGA_RUNTIME_SOURCE_BLOCK_READ_RETRY_DELAYS_MS,
  MEGA_SC_LISTEN_TIMEOUT_MS,
  MEGA_SHARE_INVITE_NON_CONTACT_USER,
  MEGA_SYNC_TIMEOUT_CODE,
  MEGA_SESSION_VALIDATION_CACHE_MS,
  MEGA_TRANSIENT_SYNC_COOLDOWN_MS,
  MEGA_UPLOAD_PROBE_DELAYS_MS,
  MEGA_UPLOAD_PROBE_HISTORY_LIMIT,
  MEGA_UPLOAD_PROBE_TIMEOUT_MS,
  READONLY_BADGES,
} = adapterConstants;

export class MegaTransportAdapter {
  readonly provider = 'mega';
  readonly label = 'MEGA';
  readonly description = 'Native MEGA sync for owner folders plus mirroring for public links and incoming shares.';
  readonly supportsAccountConnection = true;

  private readonly apiClient: MegaApiClient;
  private readonly fetchImpl: typeof fetch;
  private readonly syncStates = new Map<string, TransportState>();
  private readonly syncTimers = new Map<string, RuntimeTimerHandle>();
  private readonly syncControllers = new Map<string, AbortController>();
  private readonly syncTasks = new Map<string, Promise<void>>();
  private readonly accountSyncTasks = new Map<string, Promise<unknown>>();
  private readonly activeAccountSyncs = new Map<string, { shareId: string; role: ManagedShare['role'] }>();
  private readonly accountRecipientPriorityUntil = new Map<string, number>();
  private readonly refreshWorker = new ProviderRefreshWorker();
  private readonly devInventorySignatures = new Map<string, string>();
  private readonly devInventoryRefreshedAt = new Map<string, number>();
  private readonly syncRetryCooldowns = new Map<string, number>();
  private readonly collaboratorCache = new Map<string, { expiresAt: number; collaborators: ManagedShareCollaborator[] }>();
  private readonly localWatchers = new Map<string, MegaFsWatcher>();
  private readonly scListenerControllers = new Map<string, AbortController>();
  private readonly pendingSyncRetryTimers = new Map<string, RuntimeTimerHandle>();
  private readonly shareScsn = new Map<string, string>();
  private readonly shareKnownHandles = new Map<string, string[]>();
  private readonly shareManifestCache = new Map<string, MegaMirrorManifest>();
  private readonly shareRootHandles = new Map<string, string>();
  private readonly pendingRootDiagnosticAt = new Map<string, number>();
  private readonly uploadProbeHistory = new Map<string, ManagedShareUploadProbe[]>();
  private readonly receiveProbeHistory = new Map<string, ManagedShareReceiveProbe[]>();
  private readonly suppressedWatcherPaths = new Map<string, Map<string, number>>();
  private readonly ownerUploadStates = new Map<string, MegaOwnerUploadState>();
  private readonly accountShareKeyCache = new Map<string, ReadonlyMap<string, Buffer>>();
  private readonly accountIdByUserHandle = new Map<string, string>();
  private readonly accountCloudDriveHandleCache = new Map<string, string>();
  private readonly accountSessionValidatedAt = new Map<string, number>();
  private readonly accountSessionRefreshTasks = new Map<string, Promise<MegaSession>>();
  private readonly incomingShareDiscoveryCache = new Map<string, { expiresAt: number; offers: IncomingManagedShareOffer[] }>();
  private readonly incomingShareDiscoveryTasks = new Map<string, Promise<IncomingManagedShareOffer[]>>();
  private readonly ownerShareKeyHealAt = new Map<string, number>();
  private readonly ownerShareTreeHealAt = new Map<string, number>();
  private readonly incomingContactInviteCache = new Map<string, { expiresAt: number; invites: IncomingProviderContactInvite[] }>();
  private readonly incomingContactInviteTasks = new Map<string, Promise<IncomingProviderContactInvite[]>>();
  private uploadProbeSequence = 0;
  private receiveProbeSequence = 0;

  constructor(
    private readonly runtime: IntegrationRuntime,
    options: MegaAdapterOptions = {}
  ) {
    this.fetchImpl = options.fetchImpl ?? this.runtime.fetch;
    this.apiClient = new MegaApiClient({ fetchImpl: this.fetchImpl });
  }

  async dispose(): Promise<void> {
    for (const timer of this.syncTimers.values()) {
      timer.cancel();
    }
    this.syncTimers.clear();
    for (const timer of this.pendingSyncRetryTimers.values()) {
      timer.cancel();
    }
    this.pendingSyncRetryTimers.clear();
    for (const watcher of this.localWatchers.values()) {
      void watcher.close();
    }
    this.localWatchers.clear();
    for (const controller of this.scListenerControllers.values()) {
      controller.abort();
    }
    this.scListenerControllers.clear();
    this.syncStates.clear();
    this.syncTasks.clear();
    this.syncRetryCooldowns.clear();
    this.accountSyncTasks.clear();
    this.activeAccountSyncs.clear();
    this.collaboratorCache.clear();
    this.shareScsn.clear();
    this.shareKnownHandles.clear();
    this.shareManifestCache.clear();
    this.shareRootHandles.clear();
    this.uploadProbeHistory.clear();
    this.receiveProbeHistory.clear();
    this.suppressedWatcherPaths.clear();
    this.ownerUploadStates.clear();
    this.accountShareKeyCache.clear();
    this.accountIdByUserHandle.clear();
    this.accountCloudDriveHandleCache.clear();
    this.accountSessionValidatedAt.clear();
    this.accountSessionRefreshTasks.clear();
    this.incomingShareDiscoveryCache.clear();
    this.incomingShareDiscoveryTasks.clear();
    this.ownerShareKeyHealAt.clear();
    this.ownerShareTreeHealAt.clear();
    this.incomingContactInviteCache.clear();
    this.incomingContactInviteTasks.clear();
  }

  async probe(endpoint: TransportEndpoint): Promise<TransportState> {
    if (endpoint.transport === 'provider-share' && endpoint.provider?.trim().toLowerCase() === this.provider) {
      return {
        status: 'ready',
        detail: 'MEGA native sync is available.',
        badges: ['Native'],
      };
    }
    return {
      status: 'unsupported',
      detail: 'MEGA does not handle this endpoint.',
      badges: [],
    };
  }

  async getSetupState(): Promise<ProviderSetupState> {
    return {
      status: 'ready',
      detail: 'MEGA native sync is built in. No separate local helper install is required.',
    };
  }

  async configure(_input: ConfigureProviderInput): Promise<ProviderSetupState> {
    return this.getSetupState();
  }

  async install(): Promise<ProviderSetupState> {
    return this.getSetupState();
  }

  async connect(input: ConnectProviderAccountInput): Promise<ConnectProviderAccountResult> {
    if (input.authSessionId) {
      throw new Error('MEGA interactive auth sessions are not used by the native adapter.');
    }
    if (input.mode && input.mode !== 'login') {
      throw new Error('MEGA native connection currently supports login only.');
    }

    const email = input.credentials?.email?.trim() || input.email?.trim() || '';
    const password = input.credentials?.password ?? '';
    const mfaCode = input.credentials?.mfaCode?.trim() || undefined;
    if (!email || !password) {
      throw new Error('MEGA needs an email and password.');
    }

    const accountId = input.accountId?.trim() || createOpaqueId('acct-mega');
    const now = this.runtime.now();
    const connectStartedAt = now;
    let activePhase: 'login' | 'persist-secret' = 'login';
    let activePhaseStartedAt = connectStartedAt;
    let loginDurationMs = 0;
    let session: MegaSession;
    try {
      session = await this.loginWithPassword(email, password, mfaCode);
      loginDurationMs = this.runtime.now() - activePhaseStartedAt;
    } catch (error) {
      const failedAt = this.runtime.now();
      this.runtime.logger.warn('MEGA connect failed.', {
        email,
        accountId,
        phase: activePhase,
        phaseDurationMs: failedAt - activePhaseStartedAt,
        totalDurationMs: failedAt - connectStartedAt,
        loginDurationMs,
        fetchNodesDurationMs: 0,
        message: error instanceof Error ? error.message : String(error),
      });
      throw normalizeMegaConnectError(error, email);
    }
    activePhase = 'persist-secret';
    activePhaseStartedAt = this.runtime.now();
    await this.runtime.secretStore.set(secretKey(accountId), {
      email: session.email,
      password,
      mfaCode,
      sid: session.sid,
      masterKey: encodeMegaBase64Url(session.masterKey),
      encryptedPrivateKey: session.encryptedPrivateKey,
      userHandle: session.userHandle,
      accountVersion: session.accountVersion,
      accountSalt: session.accountSalt,
      shareKeys: encodePersistedMegaShareKeys(this.accountShareKeyCache.get(session.userHandle)),
    } satisfies MegaAccountSecret);
    this.accountIdByUserHandle.set(session.userHandle, accountId);
    const persistSecretDurationMs = this.runtime.now() - activePhaseStartedAt;
    this.runtime.logger.log('MEGA connect completed.', {
      email: session.email,
      accountId,
      totalDurationMs: this.runtime.now() - connectStartedAt,
      loginDurationMs,
      fetchNodesDurationMs: 0,
      persistSecretDurationMs,
    });

    return {
      status: 'connected',
      account: {
        id: accountId,
        provider: this.provider,
        label: input.label?.trim() || 'MEGA',
        email: session.email,
        state: 'connected',
        detail: 'MEGA native session is connected.',
        createdAt: now,
        updatedAt: now,
      },
    };
  }

  async disconnect(account: ProviderAccount): Promise<void> {
    this.clearAccountDiscoveryCaches(account.id);
    const secret = await this.runtime.secretStore.get<MegaAccountSecret>(secretKey(account.id));
    if (isStoredMegaAccountSecret(secret) && typeof secret.userHandle === 'string' && secret.userHandle.trim()) {
      this.accountShareKeyCache.delete(secret.userHandle.trim());
      this.accountIdByUserHandle.delete(secret.userHandle.trim());
      this.accountCloudDriveHandleCache.delete(secret.userHandle.trim());
    }
    this.accountSessionValidatedAt.delete(account.id);
    await this.runtime.secretStore.delete(secretKey(account.id));
  }

  async createManagedShare(input: CreateManagedShareInput, _account: ProviderAccount): Promise<Partial<ManagedShare>> {
    const publicLinkDescriptor = normalizeMegaPublicLinkDescriptor(input.remoteDescriptor ?? {});
    if (input.role === 'link' && publicLinkDescriptor) {
      return {
        remoteDescriptor: publicLinkDescriptor,
        capabilities: ['mirror', 'read'],
      };
    }

    throw new Error('Native MEGA writable share creation is not supported. Connect an incoming share or a public link instead.');
  }

  async invite(share: ManagedShare, input: InviteManagedShareInput, account: ProviderAccount): Promise<void> {
    if (share.role !== 'owner') {
      throw new Error('MEGA invitations are available only for owner shares.');
    }
    const emails = uniqueTrimmedStrings(input.emails);
    if (emails.length === 0) {
      return;
    }
    const remotePath = getMegaShareRemotePath(share, this.runtime.mega.remoteBasePath);
    const accessLevel = resolveMegaInviteAccessLevel(input.accessLevel);
    const inviteStartedAt = this.runtime.now();
    const exclusiveShareTaskRequestedAt = inviteStartedAt;
    this.runtime.logger.log('MEGA invite: requesting exclusive share task.', {
      shareId: share.id,
      accountId: account.id,
      emailCount: emails.length,
    });
    await this.withExclusiveShareTask(share.id, async () => {
      const exclusiveShareTaskWaitDurationMs = this.runtime.now() - exclusiveShareTaskRequestedAt;
      this.runtime.logger.log('MEGA invite: exclusive share task acquired.', {
        shareId: share.id,
        accountId: account.id,
        waitDurationMs: exclusiveShareTaskWaitDurationMs,
      });
      const sessionReadyStartedAt = this.runtime.now();
      await this.withRecoveredAccountSession(account, async (session) => {
        const sessionReadyDurationMs = this.runtime.now() - sessionReadyStartedAt;
        this.runtime.logger.log('MEGA invite: active session ready.', {
          shareId: share.id,
          accountId: account.id,
          email: session.email,
          durationMs: sessionReadyDurationMs,
        });
        const rootResolveStartedAt = this.runtime.now();
        const root = await this.resolveOwnerRemoteRootForShare(share, session, remotePath);
        const rootResolveDurationMs = this.runtime.now() - rootResolveStartedAt;
        const initialSnapshotStartedAt = this.runtime.now();
        let snapshot = await this.fetchNodesSnapshot(session);
        const initialSnapshotDurationMs = this.runtime.now() - initialSnapshotStartedAt;
        const collaborators = collectMegaOwnerCollaborators(snapshot, root.root.handle, root.root.shareHandle);
        const existingEmails = new Set(
          collaborators
            .map((collaborator) => collaborator.email?.trim().toLowerCase())
            .filter((value): value is string => Boolean(value))
        );
        const invitees = emails.filter((email) => !existingEmails.has(email.toLowerCase()));
        this.runtime.logger.log('MEGA invite: owner share resolved.', {
          shareId: share.id,
          accountId: account.id,
          email: session.email,
          rootResolveDurationMs,
          initialSnapshotDurationMs,
          existingCollaboratorCount: collaborators.length,
          requestedInviteeCount: emails.length,
          effectiveInviteeCount: invitees.length,
        });
        if (invitees.length === 0) {
          this.runtime.logger.log('MEGA invite completed with no new invitees.', {
            shareId: share.id,
            accountId: account.id,
            email: session.email,
            totalDurationMs: this.runtime.now() - inviteStartedAt,
            exclusiveShareTaskWaitDurationMs,
            sessionReadyDurationMs,
            rootResolveDurationMs,
            initialSnapshotDurationMs,
          });
          return;
        }

        for (const [index, email] of invitees.entries()) {
          const inviteeStartedAt = this.runtime.now();
          let snapshotRefreshDurationMs = 0;
          if (index > 0) {
            const snapshotRefreshStartedAt = this.runtime.now();
            await waitForMegaRetry(400);
            snapshot = await this.fetchNodesSnapshot(session);
            snapshotRefreshDurationMs = this.runtime.now() - snapshotRefreshStartedAt;
          }
          const hasOutgoingForRoot = snapshotHasOutgoingShareForRoot(snapshot, root.root.handle, root.root.shareHandle);
          const isNewShare = !hasOutgoingForRoot && index === 0;
          const includeNodeKeyRecords = index === 0;
          const inviteTargetResolveStartedAt = this.runtime.now();
          let target = resolveMegaShareInviteTarget(snapshot, email);
          const inviteTargetResolveDurationMs = this.runtime.now() - inviteTargetResolveStartedAt;
          this.runtime.logger.log('MEGA invite: resolved invite target.', {
            email: email.trim(),
            index,
            isNewShare,
            inviteTarget: target.u === MEGA_SHARE_INVITE_NON_CONTACT_USER ? 'EXP' : 'contact',
            inviteTargetResolveDurationMs,
            snapshotRefreshDurationMs,
          });
          const cryptoResolveStartedAt = this.runtime.now();
          let cryptoNow: MegaShareCryptoContext | undefined;
          if (!isNewShare) {
            cryptoNow = await this.resolveOwnerShareCryptoContext(session, root);
            for (let keyAttempt = 0; index > 0 && !cryptoNow?.shareKey && keyAttempt < 12; keyAttempt += 1) {
              await waitForMegaRetry(500 + keyAttempt * 200);
              cryptoNow = await this.resolveOwnerShareCryptoContext(session, root);
            }
            if (!cryptoNow?.shareKey) {
              const snap = await this.fetchNodesSnapshot(session);
              const km = await this.fetchKeyManagerState(session);
              const keys = collectMegaShareKeys(snap, session, km.shareKeys);
              for (const handle of [root.root.shareHandle, root.root.handle]) {
                const trimmed = typeof handle === 'string' ? handle.trim() : '';
                if (!trimmed) {
                  continue;
                }
                const material = keys.get(trimmed);
                if (material) {
                  cryptoNow = { shareHandle: trimmed, shareKey: Buffer.from(material) };
                  break;
                }
              }
            }
          }
          this.runtime.logger.log('MEGA invite: owner crypto context ready.', {
            email: email.trim(),
            index,
            durationMs: this.runtime.now() - cryptoResolveStartedAt,
            hasShareKey: Boolean(cryptoNow?.shareKey),
            shareHandle: cryptoNow?.shareHandle,
          });
          const shareKeyForInvite = Buffer.from(cryptoNow?.shareKey ?? randomBytes(16));
          const keyManagerStartedAt = this.runtime.now();
          const keyManager = await this.fetchKeyManagerState(session);
          this.runtime.logger.log('MEGA invite: key-manager state loaded.', {
            email: email.trim(),
            index,
            durationMs: this.runtime.now() - keyManagerStartedAt,
            recordCount: keyManager.records.length,
            shareKeyCount: keyManager.shareKeys.size,
            hasPrivateCu25519: Boolean(keyManager.privateCu25519),
          });
          const useSecureKeyManagerShareFlow = keyManager.records.length > 0;
          if (useSecureKeyManagerShareFlow) {
            const prepareStartedAt = this.runtime.now();
            await this.prepareOwnerOutgoingInviteInKeyManager(session, root, shareKeyForInvite, target, keyManager, {
              trusted: isNewShare,
            });
            this.runtime.logger.log('MEGA invite: secure key-manager state prepared.', {
              email: email.trim(),
              index,
              durationMs: this.runtime.now() - prepareStartedAt,
              trusted: isNewShare,
            });
            cryptoNow = {
              shareHandle: root.root.handle,
              shareKey: Buffer.from(shareKeyForInvite),
            };
          }
          if (!isNewShare && !cryptoNow?.shareKey) {
            throw new Error(
              'MEGA already has an outgoing share on this folder (or Nearbytes could not tell), but the share encryption key is unavailable. Reconnect MEGA, or create/repair the share once on mega.nz, then try inviting again.'
            );
          }
          let pendingContactDurationMs = 0;
          if (target.u === MEGA_SHARE_INVITE_NON_CONTACT_USER && target.e) {
            try {
              const pendingContactStartedAt = this.runtime.now();
              await this.apiCommand({ a: 'upc', u: target.e, aa: 'a' }, session);
              pendingContactDurationMs = this.runtime.now() - pendingContactStartedAt;
              this.runtime.logger.log('MEGA invite: sent pending-contact request before share invite.', {
                email: target.e,
                durationMs: pendingContactDurationMs,
              });
            } catch (error) {
              // Ignore transient/duplicate contact-request failures and continue with s2.
              this.runtime.logger.warn('MEGA invite: pending-contact request failed; continuing with share invite.', {
                email: target.e,
                message: error instanceof Error ? error.message : String(error),
              });
            }
          }
          let sentPendingShareKeyToContact = false;
          if (useSecureKeyManagerShareFlow) {
            const pendingKeyStartedAt = this.runtime.now();
            sentPendingShareKeyToContact = await this.sendMegaPendingOutShareKeyToContact(
              session,
              root.root.handle,
              shareKeyForInvite,
              target,
              keyManager
            );
            this.runtime.logger.log('MEGA invite: secure pending outshare key attempt completed.', {
              email: email.trim(),
              index,
              durationMs: this.runtime.now() - pendingKeyStartedAt,
              sentPendingShareKeyToContact,
            });
          }
          this.runtime.logger.log('MEGA invite: issuing s2 set-share.', {
            email: email.trim(),
            index,
            isNewShare,
            inviteTarget: target.u === MEGA_SHARE_INVITE_NON_CONTACT_USER ? 'EXP' : 'contact',
          });
          const shareCommand = buildMegaSetShareCommand(root, session, target, accessLevel, {
            includeNodeKeyRecords,
            shareKey: shareKeyForInvite,
            secureMode: useSecureKeyManagerShareFlow,
          });
          const shareCommandStartedAt = this.runtime.now();
          try {
            await this.apiCommand(shareCommand.command, session);
            await this.rememberOwnerShareKey(session, root, shareCommand.shareKey);
            if (useSecureKeyManagerShareFlow) {
              await this.finalizeOwnerOutgoingInviteInKeyManager(session, root, shareCommand.shareKey, target, {
                removePendingOutShare: sentPendingShareKeyToContact,
              });
            }
          } catch (error) {
            const code = getMegaApiErrorCode(error);
            const canFallbackToDirectEmail =
              code === -3 &&
              target.u === MEGA_SHARE_INVITE_NON_CONTACT_USER &&
              typeof target.e === 'string' &&
              target.e.trim().length > 0;
            if (!canFallbackToDirectEmail) {
              throw error;
            }
            const fallbackTarget: MegaShareInviteTarget = { u: target.e!.trim() };
            const fallbackCommand = buildMegaSetShareCommand(root, session, fallbackTarget, accessLevel, {
              includeNodeKeyRecords,
              shareKey: shareCommand.shareKey,
              secureMode: useSecureKeyManagerShareFlow,
            });
            this.runtime.logger.warn('MEGA invite: EXP target returned API -3, retrying with direct email target.', {
              email: email.trim(),
            });
            await this.apiCommand(fallbackCommand.command, session);
            await this.rememberOwnerShareKey(session, root, fallbackCommand.shareKey);
            if (useSecureKeyManagerShareFlow) {
              await this.finalizeOwnerOutgoingInviteInKeyManager(session, root, fallbackCommand.shareKey, fallbackTarget, {
                removePendingOutShare: false,
              });
            }
          }
          this.runtime.logger.log('MEGA invite: invitee pipeline completed.', {
            email: email.trim(),
            index,
            isNewShare,
            snapshotRefreshDurationMs,
            inviteTargetResolveDurationMs,
            cryptoResolveDurationMs: this.runtime.now() - cryptoResolveStartedAt,
            pendingContactDurationMs,
            shareCommandDurationMs: this.runtime.now() - shareCommandStartedAt,
            totalDurationMs: this.runtime.now() - inviteeStartedAt,
          });
        }

        this.collaboratorCache.delete(share.id);
        this.incomingShareDiscoveryCache.delete(account.id);
        const reflectionStartedAt = this.runtime.now();
        await this.waitForMegaOutgoingInviteReflection(session, root, invitees);
        this.runtime.logger.log('MEGA invite completed.', {
          shareId: share.id,
          accountId: account.id,
          email: session.email,
          inviteeCount: invitees.length,
          accessLevel: input.accessLevel ?? 'read',
          exclusiveShareTaskWaitDurationMs,
          sessionReadyDurationMs,
          rootResolveDurationMs,
          initialSnapshotDurationMs,
          reflectionDurationMs: this.runtime.now() - reflectionStartedAt,
          totalDurationMs: this.runtime.now() - inviteStartedAt,
        });
      });
    });
  }

  private async waitForMegaOutgoingInviteReflection(
    session: MegaSession,
    root: MegaOwnerRemoteRoot,
    invitees: readonly string[]
  ): Promise<void> {
    const timeoutMs = this.runtime.mega.inviteReflectionTimeoutMs;
    if (timeoutMs <= 0 || invitees.length === 0) {
      return;
    }
    const pollMs = this.runtime.mega.inviteReflectionPollMs;
    const expected = invitees.map((email) => email.trim().toLowerCase()).filter((entry) => entry.length > 0);
    if (expected.length === 0) {
      return;
    }
    const deadline = this.runtime.now() + timeoutMs;
    let poll = pollMs;
    let lastSnapshot: MegaFetchNodesSnapshot | null = null;
    while (this.runtime.now() < deadline) {
      const snapshot = await this.fetchNodesSnapshot(session);
      lastSnapshot = snapshot;
      if (snapshotReflectsOutgoingInvitees(snapshot, root.root.handle, root.root.shareHandle, expected)) {
        this.runtime.logger.log('MEGA outgoing shares now list invited collaborator(s).', {
          emails: expected,
        });
        return;
      }
      await waitForMegaRetry(poll);
      poll = Math.min(Math.floor(poll * 1.45), 8_000);
    }
    if (lastSnapshot && snapshotHasOutgoingShareForRoot(lastSnapshot, root.root.handle, root.root.shareHandle)) {
      this.runtime.logger.warn(
        `MEGA invite reflection timeout for ${expected.join(', ')} — outgoing share exists but collaborator row is still missing.`
      );
      return;
    }
    this.runtime.logger.warn(
      `MEGA invite reflection timed out for ${expected.join(', ')} after ${Math.round(timeoutMs / 1000)}s — the share API call succeeded, but fetch-nodes never reflected the outgoing share yet. Continuing without blocking on reflection.`
    );
  }

  async acceptInvite(input: AcceptManagedShareInput, account: ProviderAccount): Promise<Partial<ManagedShare>> {
    const descriptor = await this.resolveIncomingShareDescriptor(account, input.remoteDescriptor ?? {});
    return {
      remoteDescriptor: descriptor,
      capabilities: acceptedShareCapabilities(descriptor),
    };
  }

  async listIncomingShares(account: ProviderAccount): Promise<IncomingManagedShareOffer[]> {
    const cached = this.incomingShareDiscoveryCache.get(account.id);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.offers.map((offer) => ({ ...offer, remoteDescriptor: { ...offer.remoteDescriptor } }));
    }

    const existingTask = this.incomingShareDiscoveryTasks.get(account.id);
    if (existingTask) {
      return existingTask;
    }

    const task = this.listIncomingSharesUncached(account)
      .then((offers) => {
        const cachedOffers = offers.map((offer) => ({
          ...offer,
          remoteDescriptor: { ...offer.remoteDescriptor },
        }));
        this.incomingShareDiscoveryCache.set(account.id, {
          expiresAt: Date.now() + MEGA_INCOMING_DISCOVERY_CACHE_MS,
          offers: cachedOffers,
        });
        return cachedOffers.map((offer) => ({ ...offer, remoteDescriptor: { ...offer.remoteDescriptor } }));
      })
      .finally(() => {
        if (this.incomingShareDiscoveryTasks.get(account.id) === task) {
          this.incomingShareDiscoveryTasks.delete(account.id);
        }
      });
    this.incomingShareDiscoveryTasks.set(account.id, task);
    return task;
  }

  private async listIncomingSharesUncached(
    account: ProviderAccount,
    options: {
      readonly bypassAccountSync?: boolean;
    } = {}
  ): Promise<IncomingManagedShareOffer[]> {
    const discover = async (): Promise<IncomingManagedShareOffer[]> => {
      const passCount = 4;
      const delayBeforePassMs = [0, 1_200, 3_000, 7_000] as const;

      for (let pass = 0; pass < passCount; pass += 1) {
        if (pass > 0) {
          await waitForMegaRetry(delayBeforePassMs[pass] ?? 8_000);
        }

        const resolved = await this.withRecoveredAccountSession(account, async (session) => {
          const snapshot = await this.fetchNodesSnapshot(session);
          if (!snapshotHasIncomingShareCandidates(snapshot)) {
            return {
              session,
              snapshot,
              keyManager: undefined,
            };
          }
          return {
            session,
            snapshot,
            keyManager: await this.fetchKeyManagerState(session, undefined, {
              includePendingInShareKeys: true,
              snapshot,
            }),
          };
        });
        const { offers, diag } = listIncomingMegaShareOffersWithDiag(
          resolved.snapshot,
          resolved.session,
          resolved.keyManager?.shareKeys ?? new Map<string, Buffer>(),
          this.provider,
          account.id
        );

        const keysStillPropagating =
          diag.nodesWithSharingUser > 0 &&
          diag.offerCount === 0 &&
          diag.skippedNoDecrypt > 0;

        if (!keysStillPropagating || pass === passCount - 1) {
          if (diag.nodesWithSharingUser > diag.offerCount) {
            this.runtime.logger.log('MEGA incoming share discovery: not every tree node with a sharing user became an offer.', {
              accountId: account.id,
              email: account.email,
              ...diag,
              incomingDiscoveryPasses: pass + 1,
            });
          }
          return offers;
        }

        this.runtime.logger.log('MEGA incoming share discovery: share keys not ready for some incoming nodes; retrying.', {
          accountId: account.id,
          email: account.email,
          ...diag,
          pass: pass + 1,
          nextDelayMs: delayBeforePassMs[pass + 1],
        });
      }

      return [];
    };

    if (options.bypassAccountSync === true) {
      return discover();
    }
    return this.withAccountSyncTask(account.id, discover);
  }

  async listManagedShareMirrors(account: ProviderAccount): Promise<ManagedShareMirrorEntry[]> {
    void account;
    return [];
  }

  async getShareInventoryDebug(account: ProviderAccount): Promise<{
    incoming: ProviderShareInventoryDebugEntry[];
    outgoing: ProviderShareInventoryDebugEntry[];
  }> {
    const resolved = await this.withRecoveredAccountSession(account, async (session) => {
      const snapshot = await this.fetchNodesSnapshot(session);
      return {
        session,
        snapshot,
        keyManager: await this.fetchKeyManagerState(session, undefined, {
          includePendingInShareKeys: true,
          snapshot,
        }),
      };
    });
    return buildMegaShareInventoryDebugEntries(
      resolved.snapshot,
      resolved.session,
      resolved.keyManager.shareKeys
    );
  }

  async listIncomingContactInvites(account: ProviderAccount): Promise<IncomingProviderContactInvite[]> {
    const cached = this.incomingContactInviteCache.get(account.id);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.invites.map((invite) => ({ ...invite }));
    }

    const existingTask = this.incomingContactInviteTasks.get(account.id);
    if (existingTask) {
      return existingTask;
    }

    const task = this.withRecoveredAccountSession(account, (session) => this.fetchNodesSnapshot(session))
      .then((snapshot) =>
        snapshot.incomingPendingContacts
          .map((invite) => mapIncomingMegaContactInvite(invite, account.id, this.provider))
          .filter((value): value is IncomingProviderContactInvite => value !== null)
          .sort((left, right) => left.label.localeCompare(right.label))
      )
      .then((invites) => {
        const cachedInvites = invites.map((invite) => ({ ...invite }));
        this.incomingContactInviteCache.set(account.id, {
          expiresAt: Date.now() + MEGA_CONTACT_INVITES_CACHE_MS,
          invites: cachedInvites,
        });
        return cachedInvites.map((invite) => ({ ...invite }));
      })
      .finally(() => {
        if (this.incomingContactInviteTasks.get(account.id) === task) {
          this.incomingContactInviteTasks.delete(account.id);
        }
      });
    this.incomingContactInviteTasks.set(account.id, task);
    return task;
  }

  async acceptIncomingContactInvite(account: ProviderAccount, inviteId: string): Promise<void> {
    const normalizedInviteId = inviteId.trim();
    if (!normalizedInviteId) {
      throw new Error('MEGA contact invite id is required.');
    }
    await this.withRecoveredAccountSession(account, (session) =>
      this.apiCommand(
        {
          a: 'upca',
          p: normalizedInviteId,
          aa: 'a',
        },
        session
      )
    );
    this.clearAccountDiscoveryCaches(account.id);
  }

  async getState(share: ManagedShare, account: ProviderAccount | null): Promise<TransportState> {
    const cached = this.syncStates.get(share.id);
    if (cached) {
      return cached;
    }
    if (share.role === 'owner') {
      if (isLegacyMegaLocalMirror(share) && !account) {
        return {
          status: 'ready',
          detail: 'This legacy MEGA Nearbytes folder is attached locally. Nearbytes is preserving the local location after reconnect.',
          badges: ['Local'],
        };
      }
      if (!account) {
        return {
          status: 'needs-auth',
          detail: 'Reconnect MEGA to resume this writable owner sync.',
          badges: ['Reconnect'],
        };
      }
      return {
        status: 'idle',
        detail: 'MEGA owner sync is ready to start.',
        badges: ['Writable'],
      };
    }
    if (this.usesPublicLinkMirror(share)) {
      return {
        status: 'ready',
        detail: 'MEGA public link mirror keeps a local read-only copy.',
        badges: READONLY_BADGES,
      };
    }
    if (!account) {
      return {
        status: 'needs-auth',
        detail: 'Reconnect MEGA to resume this incoming shared-folder mirror. If MEGA asked you to unlock the account or change the password first, complete that on mega.io and then reconnect here.',
        badges: ['Reconnect'],
      };
    }
    return {
      status: 'idle',
      detail: 'MEGA incoming shared-folder mirror is ready to start.',
      badges: READONLY_BADGES,
    };
  }

  async getCollaborators(share: ManagedShare, account: ProviderAccount | null): Promise<ManagedShareCollaborator[]> {
    if (share.role === 'owner' && account) {
      const cached = this.collaboratorCache.get(share.id);
      if (cached && cached.expiresAt > Date.now()) {
        return cached.collaborators;
      }
      return this.withRecoveredAccountSession(account, async (session) => {
        const remotePath = getMegaShareRemotePath(share, this.runtime.mega.remoteBasePath);
        const root = await this.ensureOwnerRemoteRoot(session, remotePath);
        const collaborators = collectMegaOwnerCollaborators(
          await this.fetchNodesSnapshot(session),
          root.root.handle,
          root.root.shareHandle
        );
        this.collaboratorCache.set(share.id, {
          expiresAt: Date.now() + MEGA_OWNER_COLLABORATOR_CACHE_MS,
          collaborators,
        });
        return collaborators;
      });
    }
    const ownerEmail = getStringDescriptor(share.remoteDescriptor, 'ownerEmail');
    if (!ownerEmail) {
      return [];
    }
    return [
      {
        label: ownerEmail,
        email: ownerEmail,
        role: getStringDescriptor(share.remoteDescriptor, 'accessLevel') ?? 'shared with you',
        status: 'active',
        source: 'provider',
      },
    ];
  }

  async probeManagedShareRemoteEntry(
    share: ManagedShare,
    account: ProviderAccount | null,
    relativePath: string
  ): Promise<ManagedShareRemoteEntryProbe | null> {
    if (!account) {
      throw new Error('Reconnect MEGA to inspect the remote share state.');
    }
    if (share.role !== 'owner') {
      return null;
    }
    const normalizedPath = normalizeRelativePath(relativePath);
    if (!isMirrorRelativePath(normalizedPath)) {
      return null;
    }
    return this.withRecoveredAccountSession(account, async (session) => {
      const remotePath = getMegaShareRemotePath(share, this.runtime.mega.remoteBasePath);
      const root = await fetchOwnerRootByPath(this.apiClient, session, remotePath);
      const node = findNodeByRelativePath(root.tree, root.root.handle, normalizedPath);
      if (!node) {
        return null;
      }
      return {
        path: normalizedPath,
        kind: node.isFolder ? 'folder' : 'file',
        size: node.isFolder ? undefined : node.size,
        handle: node.handle,
      };
    });
  }

  async forceManagedShareUpload(
    share: ManagedShare,
    account: ProviderAccount | null,
    relativePath: string
  ): Promise<void> {
    if (!account) {
      throw new Error('Reconnect MEGA to upload to the remote share.');
    }
    if (share.role !== 'owner') {
      throw new Error('Forced upload is supported only for your own MEGA publication root.');
    }
    const normalizedPath = normalizeRelativePath(relativePath);
    if (!isMirrorRelativePath(normalizedPath)) {
      throw new Error('Only channels/* and blocks/* paths can be uploaded to MEGA.');
    }

    const localBytes = await this.readManagedShareUploadBytes(share, normalizedPath);
    const uploadStartedAt = this.runtime.now();
    try {
      this.prioritizeOwnerLocalWrite(share, account);
      if (this.runtime.mega.ownerMirrorSource) {
        // Runtime-source owner syncs can be draining a long canonical catch-up. Abort that pass so
        // a fresh local write can publish immediately; the background sync will retry afterward.
        this.abortShareSyncTask(share.id);
      }
      await this.withAccountSyncTask(account.id, async () => {
        await this.withExclusiveShareTask(share.id, async () => {
          await this.withRecoveredAccountSession(account, async (session) => {
            const ownerUploadState = await this.getOwnerUploadState(share, session);
            const adapter = new MegaOwnerRemoteAdapter(
              this.fetchImpl,
              this.apiClient,
              session,
              ownerUploadState,
              undefined
            );
            await adapter.upload(normalizedPath, localBytes, { waitForVisibility: false });
          });
        });
      });
    } catch (error) {
      this.ownerUploadStates.delete(share.id);
      throw error;
    }
    this.scheduleManagedShareUploadProbe({
      share,
      account,
      relativePath: normalizedPath,
      localSize: localBytes.length,
      startedAt: uploadStartedAt,
      committedAt: this.runtime.now(),
    });
  }

  private async readManagedShareUploadBytes(share: ManagedShare, relativePath: string): Promise<Uint8Array> {
    if (this.runtime.mega.ownerMirrorSource) {
      return this.runtime.mega.ownerMirrorSource.readMirrorFile(share, relativePath);
    }
    const localFilePath = path.join(share.localPath, relativePath);
    return new Uint8Array(await (await getMegaNodeFs()).readFile(localFilePath));
  }

  private async readManagedShareUploadBytesWithRetry(
    share: ManagedShare,
    relativePath: string
  ): Promise<Uint8Array> {
    let attempt = 0;
    while (true) {
      try {
        return await this.readManagedShareUploadBytes(share, relativePath);
      } catch (error) {
        if (
          !this.runtime.mega.ownerMirrorSource ||
          !relativePath.startsWith('blocks/') ||
          !isRuntimeSourceMirrorFileMissing(error) ||
          attempt >= MEGA_RUNTIME_SOURCE_BLOCK_READ_RETRY_DELAYS_MS.length
        ) {
          throw error;
        }
        const delayMs = MEGA_RUNTIME_SOURCE_BLOCK_READ_RETRY_DELAYS_MS[attempt] ?? 0;
        attempt += 1;
        await waitForMegaRetry(this.runtime.scheduler, delayMs);
      }
    }
  }

  private async forceManagedShareRuntimeSourceEventUpload(
    share: ManagedShare,
    account: ProviderAccount | null,
    relativePath: string
  ): Promise<void> {
    if (!account) {
      throw new Error('Reconnect MEGA to upload to the remote share.');
    }
    const eventBytes = await this.readManagedShareUploadBytes(share, relativePath);
    const uploadStartedAt = this.runtime.now();
    const referencedBlockPaths = extractReferencedRuntimeSourceBlockPaths(eventBytes);

    this.prioritizeOwnerLocalWrite(share, account);
    this.abortShareSyncTask(share.id);
    await this.withAccountSyncTask(account.id, async () => {
      await this.withExclusiveShareTask(share.id, async () => {
        await this.withRecoveredAccountSession(account, async (session) => {
          const ownerUploadState = await this.getOwnerUploadState(share, session);
          const adapter = new MegaOwnerRemoteAdapter(
            this.fetchImpl,
            this.apiClient,
            session,
            ownerUploadState,
            undefined
          );
          for (const blockPath of referencedBlockPaths) {
            const blockBytes = await this.readManagedShareUploadBytesWithRetry(share, blockPath);
            await adapter.upload(blockPath, blockBytes, { waitForVisibility: true });
          }
          await adapter.upload(relativePath, eventBytes, { waitForVisibility: false });
        });
      });
    });
    this.scheduleManagedShareUploadProbe({
      share,
      account,
      relativePath,
      localSize: eventBytes.length,
      startedAt: uploadStartedAt,
      committedAt: this.runtime.now(),
    });
  }

  async handleManagedShareLocalWrite(
    share: ManagedShare,
    account: ProviderAccount | null,
    relativePath: string
  ): Promise<void> {
    const normalizedPath = normalizeRelativePath(relativePath);
    if (!isMirrorRelativePath(normalizedPath)) {
      return;
    }

    if (this.runtime.mega.ownerMirrorSource) {
      if (normalizedPath.startsWith('blocks/')) {
        // Runtime-source event publication streams referenced blocks itself so standalone block
        // writes do not need an extra upload pass.
        return;
      }
      if (normalizedPath.startsWith('channels/')) {
        this.suppressWatcherPath(share.id, normalizedPath);
        await this.forceManagedShareRuntimeSourceEventUpload(share, account, normalizedPath);
        return;
      }
    }

    this.suppressWatcherPath(share.id, normalizedPath);
    await this.forceManagedShareUpload(share, account, normalizedPath);
  }

  async getManagedShareUploadProbes(
    share: ManagedShare,
    _account: ProviderAccount | null,
    relativePath?: string,
    limit = 20
  ): Promise<ManagedShareUploadProbe[]> {
    const probes = this.uploadProbeHistory.get(share.id) ?? [];
    const normalizedPath = relativePath?.trim().replace(/^\/+/, '');
    const cappedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(Math.trunc(limit), 100)) : 20;
    return probes
      .filter((probe) => !normalizedPath || probe.path === normalizedPath)
      .slice(0, cappedLimit);
  }

  async getManagedShareReceiveProbes(
    share: ManagedShare,
    _account: ProviderAccount | null,
    relativePath?: string,
    limit = 20
  ): Promise<ManagedShareReceiveProbe[]> {
    const probes = this.receiveProbeHistory.get(share.id) ?? [];
    const normalizedPath = relativePath?.trim().replace(/^\/+/, '');
    const cappedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(Math.trunc(limit), 100)) : 20;
    return probes
      .filter((probe) => !normalizedPath || probe.path === normalizedPath)
      .slice(0, cappedLimit);
  }

  private scheduleManagedShareUploadProbe(input: {
    share: ManagedShare;
    account: ProviderAccount | null;
    relativePath: string;
    localSize: number;
    startedAt: number;
    committedAt: number;
  }): void {
    if (!isMegaUploadProbeEnabled() || input.share.role !== 'owner' || !input.account) {
      return;
    }

    const probe: ManagedShareUploadProbe = {
      id: `mega-upload-probe-${++this.uploadProbeSequence}`,
      shareId: input.share.id,
      path: input.relativePath,
      localSize: input.localSize,
      startedAt: input.startedAt,
      committedAt: input.committedAt,
      timeoutMs: MEGA_UPLOAD_PROBE_TIMEOUT_MS,
      attempts: 0,
      status: 'pending',
    };
    this.rememberManagedShareUploadProbe(probe);
    debugMegaLog('[MEGA:probe] queued owner upload visibility probe.', {
      shareId: input.share.id,
      path: input.relativePath,
      startedAt: input.startedAt,
      committedAt: input.committedAt,
    });

    void this.runManagedShareUploadProbe(probe, input.share, input.account);
  }

  private rememberManagedShareUploadProbe(probe: ManagedShareUploadProbe): void {
    const existing = this.uploadProbeHistory.get(probe.shareId) ?? [];
    this.uploadProbeHistory.set(probe.shareId, [probe, ...existing].slice(0, MEGA_UPLOAD_PROBE_HISTORY_LIMIT));
  }

  private updateManagedShareUploadProbe(
    shareId: string,
    probeId: string,
    patch: Partial<ManagedShareUploadProbe>
  ): ManagedShareUploadProbe | null {
    const existing = this.uploadProbeHistory.get(shareId);
    if (!existing) {
      return null;
    }
    let updated: ManagedShareUploadProbe | null = null;
    const next = existing.map((probe) => {
      if (probe.id !== probeId) {
        return probe;
      }
      updated = {
        ...probe,
        ...patch,
      };
      return updated;
    });
    this.uploadProbeHistory.set(shareId, next);
    return updated;
  }

  private async runManagedShareUploadProbe(
    probe: ManagedShareUploadProbe,
    share: ManagedShare,
    account: ProviderAccount
  ): Promise<void> {
    const remotePath = getMegaShareRemotePath(share, this.runtime.mega.remoteBasePath);
    let attempt = 0;

    while (this.runtime.now() - probe.committedAt <= probe.timeoutMs) {
      const delayMs = MEGA_UPLOAD_PROBE_DELAYS_MS[Math.min(attempt, MEGA_UPLOAD_PROBE_DELAYS_MS.length - 1)] ?? 4_000;
      if (delayMs > 0) {
        await waitForMegaRetry(delayMs);
      }

      const checkStartedAt = this.runtime.now();
      const probeBeforeCheck = this.updateManagedShareUploadProbe(
        share.id,
        probe.id,
        attempt === 0
          ? {
              attempts: attempt + 1,
              firstCheckStartedAt: checkStartedAt,
            }
          : {
              attempts: attempt + 1,
            }
      );

      try {
        const node = await this.withRecoveredAccountSession(account, async (session) => {
          const root = await fetchOwnerRootByPath(this.apiClient, session, remotePath);
          return findNodeByRelativePath(root.tree, root.root.handle, probe.path);
        });
        const checkCompletedAt = this.runtime.now();
        const firstCheckStartedAt = probeBeforeCheck?.firstCheckStartedAt ?? checkStartedAt;
        const basePatch: Partial<ManagedShareUploadProbe> = {
          firstCheckCompletedAt: probeBeforeCheck?.firstCheckCompletedAt ?? checkCompletedAt,
          firstCheckDurationMs:
            probeBeforeCheck?.firstCheckDurationMs ?? Math.max(0, checkCompletedAt - firstCheckStartedAt),
          lastCheckedAt: checkCompletedAt,
          lastError: undefined,
        };

        if (node) {
          this.updateManagedShareUploadProbe(share.id, probe.id, {
            ...basePatch,
            status: 'available',
            availableAt: checkCompletedAt,
            availabilityDelayMs: Math.max(0, checkCompletedAt - probe.committedAt),
            remoteHandle: node.handle,
          });
          debugMegaLog('[MEGA:probe] owner upload became visible on MEGA.', {
            shareId: share.id,
            path: probe.path,
            attempts: attempt + 1,
            availabilityDelayMs: Math.max(0, checkCompletedAt - probe.committedAt),
            firstCheckDurationMs: Math.max(0, checkCompletedAt - firstCheckStartedAt),
            remoteHandle: node.handle,
          });
          return;
        }

        this.updateManagedShareUploadProbe(share.id, probe.id, basePatch);
      } catch (error) {
        const checkCompletedAt = this.runtime.now();
        const firstCheckStartedAt = probeBeforeCheck?.firstCheckStartedAt ?? checkStartedAt;
        const message = error instanceof Error ? error.message : String(error);
        this.updateManagedShareUploadProbe(share.id, probe.id, {
          status: 'error',
          firstCheckCompletedAt: probeBeforeCheck?.firstCheckCompletedAt ?? checkCompletedAt,
          firstCheckDurationMs:
            probeBeforeCheck?.firstCheckDurationMs ?? Math.max(0, checkCompletedAt - firstCheckStartedAt),
          lastCheckedAt: checkCompletedAt,
          lastError: message,
        });
        debugMegaLog('[MEGA:probe] owner upload visibility check failed.', {
          shareId: share.id,
          path: probe.path,
          attempts: attempt + 1,
          error: message,
        });
      }

      attempt += 1;
    }

    this.updateManagedShareUploadProbe(share.id, probe.id, {
      status: 'timeout',
      lastCheckedAt: this.runtime.now(),
    });
    debugMegaLog('[MEGA:probe] owner upload visibility probe timed out.', {
      shareId: share.id,
      path: probe.path,
      timeoutMs: probe.timeoutMs,
    });
  }

  async getShareStorageMetrics(_share: ManagedShare, _account: ProviderAccount | null): Promise<ShareStorageMetrics | undefined> {
    return undefined;
  }

  async ensureSync(share: ManagedShare, account: ProviderAccount): Promise<void> {
    this.runtime.logger.log('Provider sync bootstrap entered.', {
      provider: this.provider,
      accountId: account.id,
      shareId: share.id,
      role: share.role,
      localPath: share.localPath,
      remoteDescriptor: share.remoteDescriptor,
    });
    if (share.role === 'owner') {
      if (!this.runtime.mega.ownerMirrorSource) {
        await (await getMegaNodeFs()).mkdir(share.localPath, { recursive: true });
        await ensureMegaOwnerLocalStructure(share.localPath);
      }
      void this.logDevShareInventoryIfChanged(account, 'boot');
      const ownerLoopRunning = this.localWatchers.has(share.id) || this.syncTimers.has(share.id);
      if (!ownerLoopRunning) {
        await this.runSyncLoop(share, account);
      }
      void this.startOwnerPushPullSync(share, account);
      return;
    }
    if (isLegacyMegaLocalMirror(share)) {
      return;
    }
    if (this.usesPublicLinkMirror(share)) {
      this.syncStates.set(share.id, {
        status: 'syncing',
        detail: 'Refreshing the MEGA public link mirror.',
        badges: READONLY_BADGES,
      });
      await mirrorMegaPublicLink({
        descriptor: share.remoteDescriptor,
        localPath: share.localPath,
        fetchImpl: this.fetchImpl,
      });
      this.syncStates.set(share.id, {
        status: 'ready',
        detail: 'MEGA public link mirror is up to date.',
        badges: READONLY_BADGES,
        lastSyncAt: this.runtime.now(),
      });
      return;
    }

    if (share.role !== 'recipient') {
      throw new Error('Only readonly incoming MEGA shares and local owner roots are supported by the native adapter.');
    }

    await (await getMegaNodeFs()).mkdir(share.localPath, { recursive: true });
    void this.logDevShareInventoryIfChanged(account, 'boot');
    try {
      await this.runSyncLoop(share, account);
    } catch (error) {
      if (!isMegaMissingRequestedRootError(error)) {
        throw error;
      }
      await this.seedPendingRecipientShareCursor(share, account);
    }
    this.startScChannelListener(share, account);
    this.startRecurringSyncTimer(share, account);
  }

  async triggerManagedShareSync(share: ManagedShare, account: ProviderAccount): Promise<void> {
    if (share.role === 'recipient') {
      void this.launchExplicitRecipientSync(share, account);
      return;
    }

    await this.requestSyncLoop(share, account);
  }

  private async launchExplicitRecipientSync(share: ManagedShare, account: ProviderAccount): Promise<void> {
    try {
      await this.requestSyncLoop(share, account);
    } catch (error) {
      if (share.role !== 'recipient' || !(error instanceof Error) || error.name !== 'AbortError') {
        this.runtime.logger.warn('MEGA explicit recipient sync launch failed.', {
          shareId: share.id,
          accountId: account.id,
          errorName: error instanceof Error ? error.name : undefined,
          errorMessage: error instanceof Error ? error.message : String(error),
        });
        return;
      }
      this.runtime.logger.warn('MEGA explicit recipient sync saw an aborted in-flight attempt; retrying once.', {
        shareId: share.id,
        accountId: account.id,
      });
      try {
        await this.requestSyncLoop(share, account);
      } catch (retryError) {
        this.runtime.logger.warn('MEGA explicit recipient sync retry failed after launch.', {
          shareId: share.id,
          accountId: account.id,
          errorName: retryError instanceof Error ? retryError.name : undefined,
          errorMessage: retryError instanceof Error ? retryError.message : String(retryError),
        });
      }
    }
  }

  async detachManagedShare(share: ManagedShare, _account: ProviderAccount | null): Promise<void> {
    const timer = this.syncTimers.get(share.id);
    if (timer) {
      timer.cancel();
      this.syncTimers.delete(share.id);
    }
    const watcher = this.localWatchers.get(share.id);
    if (watcher) {
      void watcher.close();
      this.localWatchers.delete(share.id);
    }
    const scController = this.scListenerControllers.get(share.id);
    if (scController) {
      scController.abort();
      this.scListenerControllers.delete(share.id);
    }
    const pendingRetryTimer = this.pendingSyncRetryTimers.get(share.id);
    if (pendingRetryTimer) {
      pendingRetryTimer.cancel();
      this.pendingSyncRetryTimers.delete(share.id);
    }
    const controller = this.syncControllers.get(share.id);
    if (controller) {
      controller.abort();
      this.syncControllers.delete(share.id);
    }
    this.syncStates.delete(share.id);
    this.syncTasks.delete(share.id);
    this.syncRetryCooldowns.delete(share.id);
    const activeAccountSync = this.activeAccountSyncs.get(share.accountId);
    if (activeAccountSync?.shareId === share.id) {
      this.activeAccountSyncs.delete(share.accountId);
    }
    this.collaboratorCache.delete(share.id);
    this.shareScsn.delete(share.id);
    this.shareKnownHandles.delete(share.id);
    this.shareManifestCache.delete(share.id);
    this.shareRootHandles.delete(share.id);
    this.ownerUploadStates.delete(share.id);
  }

  private async runSyncLoop(share: ManagedShare, account: ProviderAccount): Promise<void> {
    const existing = this.syncTasks.get(share.id);
    if (existing) {
      return existing;
    }

    const task = this.withAccountSyncTask(account.id, async () => {
      const syncAbort = createMegaSyncAbortController(
        this.runtime.createAbortController,
        this.runtime.scheduler,
        this.runtime.mega.syncTimeoutMs
      );
      const { controller } = syncAbort;
      this.syncControllers.set(share.id, controller);
      this.activeAccountSyncs.set(account.id, { shareId: share.id, role: share.role });
      try {
        await this.syncShare(share, account, controller.signal);
      } finally {
        syncAbort.dispose();
        if (this.syncControllers.get(share.id) === controller) {
          this.syncControllers.delete(share.id);
        }
        const activeAccountSync = this.activeAccountSyncs.get(account.id);
        if (activeAccountSync?.shareId === share.id) {
          this.activeAccountSyncs.delete(account.id);
        }
      }
    }).finally(() => {
      if (this.syncTasks.get(share.id) === task) {
        this.syncTasks.delete(share.id);
      }
    });
    this.syncTasks.set(share.id, task);
    await task;
  }

  private async withAccountSyncTask<T>(accountId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.accountSyncTasks.get(accountId);
    let queuedTask!: Promise<T>;
    queuedTask = (previous ?? Promise.resolve()).catch(() => undefined).then(async () => {
      try {
        return await operation();
      } finally {
        if (this.accountSyncTasks.get(accountId) === queuedTask) {
          this.accountSyncTasks.delete(accountId);
        }
      }
    });
    this.accountSyncTasks.set(accountId, queuedTask);
    return queuedTask;
  }

  private async withExclusiveShareTask<T>(shareId: string, operation: () => Promise<T>): Promise<T> {
    const existingController = this.syncControllers.get(shareId);
    const existingTask = this.syncTasks.get(shareId);
    this.runtime.logger.log('MEGA exclusive share task requested.', {
      shareId,
      hadExistingController: Boolean(existingController),
      hadExistingTask: Boolean(existingTask),
    });
    if (existingTask) {
      const waitStartedAt = this.runtime.now();
      await existingTask.catch(() => {
        // Exclusive operations should still proceed even if the prior task failed.
      });
      this.runtime.logger.log('MEGA exclusive share task wait completed.', {
        shareId,
        durationMs: this.runtime.now() - waitStartedAt,
      });
    }

    const task = operation();
    const serializedTask = task.then(
      () => undefined,
      () => undefined
    );
    this.syncTasks.set(shareId, serializedTask);
    try {
      return await task;
    } finally {
      if (this.syncTasks.get(shareId) === serializedTask) {
        this.syncTasks.delete(shareId);
      }
    }
  }

  private abortShareSyncTask(shareId: string): void {
    const controller = this.syncControllers.get(shareId);
    if (controller && !controller.signal.aborted) {
      controller.abort();
    }
  }

  private async syncShare(share: ManagedShare, account: ProviderAccount, signal?: AbortSignal): Promise<void> {
    if (share.role === 'owner') {
      await this.syncOwnerShare(share, account, signal);
      return;
    }

    this.syncStates.set(share.id, {
      status: 'syncing',
      detail: 'Refreshing the MEGA readonly mirror.',
      badges: READONLY_BADGES,
    });

    try {
      const session = await this.getAccountSession(account, signal);
      let descriptor = await this.resolveIncomingShareDescriptor(account, share.remoteDescriptor);
      let rootHandle = getStringDescriptor(descriptor, 'rootHandle') ?? getStringDescriptor(descriptor, 'shareHandle');
      if (!rootHandle) {
        throw new Error('MEGA share descriptor is missing a root handle.');
      }

      const manifest = await this.loadManifest(share.id);
      const incrementalScsn = manifest.rootHandle === rootHandle ? manifest.lastScsn?.trim() : undefined;
      if (incrementalScsn) {
        try {
          const actionBatch = await this.fetchActionPackets(session, incrementalScsn, signal);
          const packetReceivedAt = this.runtime.now();
          const learnedShareKeyCount = await this.rememberActionPacketShareKeys(session, actionBatch.packets);
          const touchesShare = actionPacketBatchTouchesShare(actionBatch.packets, rootHandle, manifest);
          if (actionBatch.packets.length) {
            this.runtime.logger.log('MEGA push update received.', {
              shareId: share.id,
              rootHandle,
              packetCount: actionBatch.packets.length,
              actions: summarizeActionPacketActions(actionBatch.packets),
              packetDetails: createMegaActionPacketLogDetails(actionBatch.packets),
              learnedShareKeyCount,
              touchesShare,
              previousScsn: incrementalScsn,
              nextScsn: actionBatch.scsn,
            });
          }
          if (actionBatch.scsn) {
            await this.updateManifestCursor(share.id, actionBatch.scsn);
            this.shareScsn.set(share.id, actionBatch.scsn);
          }
          if (await this.tryApplyRecipientActionPackets(
            share,
            account,
            rootHandle,
            manifest,
            actionBatch,
            {
              source: 'sync',
              rootHandle,
              triggerHandle: rootHandle,
              packetReceivedAt,
              scsn: actionBatch.scsn?.trim() || incrementalScsn,
            },
            session,
          )) {
            return;
          }
          if (!touchesShare) {
            this.syncStates.set(share.id, {
              status: 'ready',
              detail: 'MEGA readonly mirror is up to date.',
              badges: READONLY_BADGES,
              lastSyncAt: this.runtime.now(),
            });
            return;
          }
        } catch (error) {
          if (!shouldResetScCursor(error)) {
            throw error;
          }
        }
      }

      let resolved;
      try {
        const initialRootHandle = rootHandle;
        resolved = await this.withRecoveredAccountSession(account, async (activeSession) => ({
          session: activeSession,
          fetched: await this.fetchPartialTreeWithSnapshot(activeSession, initialRootHandle, signal, {
            allowTransientFullFallback: true,
          }),
        }));
      } catch (error) {
        const shouldRefreshDescriptor = isMegaMissingRequestedRootError(error) || isMegaAccessDeniedError(error);
        if (!shouldRefreshDescriptor) {
          throw error;
        }
        const refreshedDescriptor = await this.resolveIncomingShareDescriptor(account, share.remoteDescriptor, { forceRefresh: true });
        const refreshedRootHandle =
          getStringDescriptor(refreshedDescriptor, 'rootHandle') ?? getStringDescriptor(refreshedDescriptor, 'shareHandle');
        if (!refreshedRootHandle || refreshedRootHandle === rootHandle) {
          throw error;
        }
        this.runtime.logger.warn('MEGA recipient incoming share descriptor refreshed after root lookup failure.', {
          shareId: share.id,
          accountId: account.id,
          previousRootHandle: rootHandle,
          nextRootHandle: refreshedRootHandle,
          ownerEmail: getStringDescriptor(refreshedDescriptor, 'ownerEmail'),
        });
        descriptor = refreshedDescriptor;
        rootHandle = refreshedRootHandle;
        const retryRootHandle = rootHandle;
        resolved = await this.withRecoveredAccountSession(account, async (activeSession) => ({
          session: activeSession,
          fetched: await this.fetchPartialTreeWithSnapshot(activeSession, retryRootHandle, signal, {
            allowTransientFullFallback: true,
          }),
        }));
      }
      const topLevelEntryNames = listMegaTopLevelEntryNames(resolved.fetched.tree);
      this.runtime.logger.log('MEGA share top-level entries.', {
        shareId: share.id,
        accountId: account.id,
        rootHandle,
        names: topLevelEntryNames,
      });
      logUnsupportedMegaTopLevelEntries(this.runtime, share.id, manifest.unsupportedTopLevelNames, topLevelEntryNames);
      const fetchedManifest: MegaMirrorManifest = {
        ...manifest,
        rootHandle: resolved.fetched.tree.root.handle,
        lastScsn: resolved.fetched.snapshot.scsn?.trim() || manifest.lastScsn,
        knownHandles: collectTreeHandles(resolved.fetched.tree),
        unsupportedTopLevelNames: listUnsupportedMegaTopLevelEntryNames(topLevelEntryNames),
      };
      await keepMegaSyncAliveWhile(this.persistManifest(share.id, fetchedManifest), signal);
      this.shareRootHandles.set(share.id, resolved.fetched.tree.root.handle);
      if (fetchedManifest.lastScsn) {
        this.shareScsn.set(share.id, fetchedManifest.lastScsn);
      }
      if (fetchedManifest.knownHandles) {
        this.shareKnownHandles.set(share.id, [...fetchedManifest.knownHandles]);
      }
      const refreshResult = await keepMegaSyncAliveWhile(
        this.refreshWorker.refresh(
          share.localPath,
          new MegaReadonlyRemoteAdapter(this.fetchImpl, this.apiClient, resolved.session, resolved.fetched.tree, signal),
          { entries: manifest.entries },
          {
            onProgress: () => touchMegaSyncActivity(signal),
          }
        ),
        signal
      );
      this.runtime.logger.log('MEGA readonly share refresh completed.', {
        shareId: share.id,
        rootHandle: resolved.fetched.tree.root.handle,
        downloadedCount: refreshResult.downloaded.length,
        removedCount: refreshResult.removed.length,
        skippedUnchangedCount: refreshResult.skipped.length - refreshResult.invalid.length,
        invalidCount: refreshResult.invalid.length,
        downloaded: refreshResult.downloaded,
      });
      logMegaMirrorRefreshEvents(this.runtime, share.id, manifest.entries, refreshResult);
      await keepMegaSyncAliveWhile(
        this.persistManifest(share.id, {
          ...fetchedManifest,
          entries: refreshResult.manifest.entries,
        } satisfies MegaMirrorManifest),
        signal
      );
      this.syncStates.set(share.id, {
        status: 'ready',
        detail: summarizeRefreshResult('MEGA readonly mirror is up to date.', refreshResult),
        badges: READONLY_BADGES,
        lastSyncAt: this.runtime.now(),
      });
    } catch (error) {
      this.runtime.logger.warn('MEGA readonly sync attempt failed.', {
        shareId: share.id,
        accountId: account.id,
        localPath: share.localPath,
        errorName: error instanceof Error ? error.name : undefined,
        errorMessage: error instanceof Error ? error.message : String(error),
        aborted: Boolean(signal?.aborted) || (error instanceof Error && error.name === 'AbortError'),
      });
      const failure = describeMegaSyncFailure(error, share.localPath, signal);
      const needsAuth = /session|auth|credential|login|reconnect|MEGA API error -15/i.test(failure.detail);
      const localMirrorAvailable = await hasUsableMegaMirror(share.localPath);
      const shareKeyPending = failure.code === 'MEGA_SHARE_KEY_PENDING';
      if (shareKeyPending) {
        await this.seedPendingRecipientShareCursor(share, account, signal);
        await this.logPendingRecipientRootDiagnostics(share, account, signal);
      }
      const keepMirrorReady =
        localMirrorAvailable &&
        !needsAuth &&
        (failure.code === MEGA_SYNC_TIMEOUT_CODE ||
          failure.code === 'MEGA_FETCH_FAILED' ||
          failure.code === 'MEGA_API_LOCKED' ||
          failure.code === 'MEGA_RATE_LIMITED' ||
          failure.code === 'MEGA_LOCAL_MIRROR_CHANGED');
      this.syncStates.set(share.id, {
        status: keepMirrorReady ? 'ready' : shareKeyPending ? 'syncing' : needsAuth ? 'needs-auth' : 'attention',
        detail: keepMirrorReady
          ? 'MEGA readonly mirror is available locally. The latest refresh did not complete and will retry automatically.'
          : failure.detail,
        badges: keepMirrorReady
          ? [...READONLY_BADGES, 'Retrying']
          : shareKeyPending
            ? [...READONLY_BADGES, 'Retrying']
            : [needsAuth ? 'Reconnect' : 'Repair'],
        diagnostic: {
          code: failure.code,
          title: failure.summary,
          summary: failure.summary,
          detail: failure.detail,
        },
      });
      throw error;
    }
  }

  private startRecurringSyncTimer(share: ManagedShare, account: ProviderAccount): void {
    if (this.syncTimers.has(share.id)) {
      return;
    }
    if (this.runtime.mega.syncIntervalMs <= 0) {
      this.runtime.logger.log('Provider recurring sync timer disabled.', {
        provider: this.provider,
        accountId: account.id,
        shareId: share.id,
      });
      return;
    }
    this.runtime.logger.log('Provider recurring sync timer started.', {
      provider: this.provider,
      accountId: account.id,
      shareId: share.id,
      intervalMs: this.runtime.mega.syncIntervalMs,
    });
    const timer = this.runtime.scheduler.setInterval(() => {
      if (isDevLogsEnabled() && this.shouldRefreshDevInventory(account, share)) {
        void this.logDevShareInventoryIfChanged(account, 'change');
      }
      this.requestSyncLoop(share, account).catch((error) => {
        this.runtime.logger.warn('MEGA sync loop failed.', error);
      });
    }, this.runtime.mega.syncIntervalMs);
    timer.unref?.();
    this.syncTimers.set(share.id, timer);
  }

  private async startOwnerPushPullSync(share: ManagedShare, account: ProviderAccount): Promise<void> {
    if (this.runtime.mega.ownerMirrorSource) {
      this.startScChannelListener(share, account);
      this.startRecurringSyncTimer(share, account);
      return;
    }

    if (this.localWatchers.has(share.id)) {
      return;
    }

    const watcher = (await getMegaChokidar()).default.watch(
      [path.join(share.localPath, 'blocks'), path.join(share.localPath, 'channels')],
      {
        persistent: true,
        ignoreInitial: true,
        depth: 10,
      }
    );

    let debounceTimer: RuntimeTimerHandle | null = null;
    const pendingRelativePaths = new Set<string>();
    let requiresFullSync = false;
    watcher.on('all', (eventName, changedPath) => {
      const relativePath = typeof changedPath === 'string'
        ? normalizeRelativePath(path.relative(share.localPath, changedPath))
        : '';
      const canPushImmediately =
        (eventName === 'add' || eventName === 'change') &&
        relativePath.length > 0 &&
        isMirrorRelativePath(relativePath) &&
        !this.shouldSuppressWatcherPath(share.id, relativePath);
      if (canPushImmediately) {
        pendingRelativePaths.add(relativePath);
      } else {
        requiresFullSync = true;
      }
      if (debounceTimer) {
        debounceTimer.cancel();
      }
      debounceTimer = this.runtime.scheduler.setTimeout(async () => {
        debounceTimer = null;
        const relativePaths = [...pendingRelativePaths];
        pendingRelativePaths.clear();
        const runFullSync = requiresFullSync || relativePaths.length === 0;
        requiresFullSync = false;

        if (runFullSync) {
          console.log('[MEGA:push] local change detected, triggering writable sync.', { shareId: share.id });
          this.requestSyncLoop(share, account).catch((error) => {
            this.runtime.logger.warn('MEGA writable push sync failed.', error);
          });
          return;
        }

        try {
          for (const relativePath of relativePaths) {
            await this.forceManagedShareUpload(share, account, relativePath);
          }
        } catch (error) {
          this.runtime.logger.warn('MEGA immediate per-path push failed; falling back to writable sync.', error);
          this.requestSyncLoop(share, account).catch((syncError) => {
            this.runtime.logger.warn('MEGA writable push sync failed.', syncError);
          });
        }
      }, MEGA_LOCAL_WATCH_DEBOUNCE_MS);
    });
    this.localWatchers.set(share.id, watcher);

    this.startScChannelListener(share, account);
    this.startRecurringSyncTimer(share, account);

    this.runtime.logger.log('Writable MEGA push/pull sync started.', {
      provider: this.provider,
      accountId: account.id,
      shareId: share.id,
      safetyNetIntervalMs: this.runtime.mega.syncIntervalMs,
      localWatchDebounceMs: MEGA_LOCAL_WATCH_DEBOUNCE_MS,
    });
  }

  private startScChannelListener(share: ManagedShare, account: ProviderAccount): void {
    if (this.scListenerControllers.has(share.id)) {
      return;
    }
    const controller = this.runtime.createAbortController();
    this.scListenerControllers.set(share.id, controller);
    void this.runScChannelLoop(share, account, controller.signal);
    this.runtime.logger.log('SC channel listener started.', {
      provider: this.provider,
      shareId: share.id,
    });
  }

  private suppressWatcherPath(shareId: string, relativePath: string): void {
    const normalizedPath = normalizeRelativePath(relativePath);
    const existing = this.suppressedWatcherPaths.get(shareId) ?? new Map<string, number>();
    existing.set(normalizedPath, this.runtime.now() + MEGA_LOCAL_WRITE_SUPPRESSION_MS);
    this.suppressedWatcherPaths.set(shareId, existing);
  }

  private shouldSuppressWatcherPath(shareId: string, relativePath: string): boolean {
    const existing = this.suppressedWatcherPaths.get(shareId);
    if (!existing) {
      return false;
    }

    const normalizedPath = normalizeRelativePath(relativePath);
    const expiresAt = existing.get(normalizedPath);
    if (!expiresAt) {
      return false;
    }

    const now = this.runtime.now();
    if (now >= expiresAt) {
      existing.delete(normalizedPath);
      if (existing.size === 0) {
        this.suppressedWatcherPaths.delete(shareId);
      }
      return false;
    }

    return true;
  }

  private async runScChannelLoop(share: ManagedShare, account: ProviderAccount, signal: AbortSignal): Promise<void> {
    let backoffMs = 0;

    while (!signal.aborted) {
      try {
        if (backoffMs > 0) {
          await waitForMegaRetry(this.runtime.scheduler, backoffMs, signal);
        }

        const scsn = this.shareScsn.get(share.id);
        if (!scsn) {
          await waitForMegaRetry(this.runtime.scheduler, 5_000, signal);
          continue;
        }

        const session = await this.getAccountSession(account, signal);
        const actionBatch = await this.fetchActionPackets(session, scsn, signal);
        const packetReceivedAt = this.runtime.now();

        if (actionBatch.scsn) {
          this.shareScsn.set(share.id, actionBatch.scsn);
        }

        if (actionBatch.packets.length > 0) {
          const learnedShareKeyCount = await this.rememberActionPacketShareKeys(session, actionBatch.packets);
          const actions = summarizeActionPacketActions(actionBatch.packets);
          const accountLevelOnly = allActionsAreAccountLevel(actions);
          const rootHandle = this.shareRootHandles.get(share.id);
          let touchesShare = !accountLevelOnly;
          if (rootHandle) {
            const knownHandles = this.shareKnownHandles.get(share.id) ?? [];
            touchesShare = actionPacketBatchTouchesShare(actionBatch.packets, rootHandle, {
              entries: {},
              knownHandles,
            });
          }
          const triggerOwnerSync = share.role === 'owner' && !accountLevelOnly;
          const shouldTriggerSync = touchesShare || triggerOwnerSync;

          if (actionBatch.packets.length) {
            this.runtime.logger.log('MEGA sc channel event received.', {
              shareId: share.id,
              rootHandle,
              packetCount: actionBatch.packets.length,
              actions,
              packetDetails: createMegaActionPacketLogDetails(actionBatch.packets),
              accountLevelOnly,
              learnedShareKeyCount,
              touchesShare,
              triggerOwnerSync,
              shouldTriggerSync,
            });
          }

          if (shouldTriggerSync) {
            console.log('[MEGA:sc] remote change detected, triggering sync.', { shareId: share.id });
            try {
              if (
                share.role === 'recipient' &&
                rootHandle &&
                await this.tryApplyRecipientActionPackets(
                  share,
                  account,
                  rootHandle,
                  await this.loadManifest(share.id),
                  actionBatch,
                  {
                    source: 'sc',
                    rootHandle,
                    triggerHandle: rootHandle,
                    packetReceivedAt,
                    scsn: actionBatch.scsn?.trim() || scsn,
                  },
                  session,
                )
              ) {
                backoffMs = 0;
                continue;
              }
              await this.requestSyncLoop(share, account);
            } catch {
              // sync failure is logged inside runSyncLoop; listener continues
            }
          }
          backoffMs = 0;
          continue;
        }

        if (actionBatch.waitUrl) {
          try {
            const waitController = this.runtime.createAbortController();
            const onParentAbort = () => waitController.abort();
            signal.addEventListener('abort', onParentAbort, { once: true });
            const waitTimeout = this.runtime.scheduler.setTimeout(() => waitController.abort(), MEGA_SC_LISTEN_TIMEOUT_MS);
            waitTimeout.unref?.();
            try {
              await this.fetchImpl(actionBatch.waitUrl, { method: 'GET', signal: waitController.signal });
            } finally {
              waitTimeout.cancel();
              signal.removeEventListener('abort', onParentAbort);
            }
          } catch {
            if (signal.aborted) {
              return;
            }
          }
          backoffMs = 0;
          continue;
        }

        backoffMs = 5_000;
      } catch (error) {
        if (signal.aborted) {
          return;
        }
        const resetCursor = shouldResetScCursor(error);
        if (resetCursor) {
          this.shareScsn.delete(share.id);
        }
        const nextBackoffMs = Math.min(backoffMs ? backoffMs * 2 : 2_000, 60_000);
        this.runtime.logger.warn('MEGA sc channel listener iteration failed.', {
          shareId: share.id,
          accountId: account.id,
          currentScsn: this.shareScsn.get(share.id) ?? null,
          resetCursor,
          nextBackoffMs,
          errorName: error instanceof Error ? error.name : undefined,
          errorMessage: error instanceof Error ? error.message : String(error),
        });
        backoffMs = nextBackoffMs;
      }
    }
  }

  private shouldRefreshDevInventory(account: ProviderAccount, share: ManagedShare): boolean {
    if (this.syncTasks.has(share.id) || this.isSyncCoolingDown(share.id)) {
      return false;
    }
    const lastRefreshedAt = this.devInventoryRefreshedAt.get(account.id) ?? 0;
    return Date.now() - lastRefreshedAt >= MEGA_DEV_INVENTORY_REFRESH_MIN_INTERVAL_MS;
  }

  private markSyncCooldown(shareId: string, delayMs = MEGA_TRANSIENT_SYNC_COOLDOWN_MS): void {
    this.syncRetryCooldowns.set(shareId, Date.now() + delayMs);
  }

  private isSyncCoolingDown(shareId: string): boolean {
    const until = this.syncRetryCooldowns.get(shareId);
    if (!until) {
      return false;
    }
    if (Date.now() >= until) {
      this.syncRetryCooldowns.delete(shareId);
      return false;
    }
    return true;
  }

  private getSyncCooldownRemainingMs(shareId: string): number {
    const until = this.syncRetryCooldowns.get(shareId);
    if (!until) {
      return 0;
    }
    const remainingMs = until - Date.now();
    if (remainingMs <= 0) {
      this.syncRetryCooldowns.delete(shareId);
      return 0;
    }
    return remainingMs;
  }

  private schedulePendingSyncRetry(share: ManagedShare, account: ProviderAccount, delayMs = 0): void {
    const existingTimer = this.pendingSyncRetryTimers.get(share.id);
    if (existingTimer) {
      existingTimer.cancel();
    }

    const cooldownDelayMs = this.getSyncCooldownRemainingMs(share.id);
    const waitMs = Math.max(delayMs, cooldownDelayMs, 100);
    const timer = this.runtime.scheduler.setTimeout(() => {
      if (this.pendingSyncRetryTimers.get(share.id) !== timer) {
        return;
      }
      this.pendingSyncRetryTimers.delete(share.id);
      this.requestSyncLoop(share, account).catch((error) => {
        this.runtime.logger.warn('MEGA deferred sync retry failed.', error);
      });
    }, waitMs);
    timer.unref?.();
    this.pendingSyncRetryTimers.set(share.id, timer);
  }

  private async requestSyncLoop(share: ManagedShare, account: ProviderAccount): Promise<void> {
    if (share.role === 'recipient') {
      this.markRecipientPriority(account.id);
    }

    const recipientPriorityDelayMs = this.getRecipientPriorityDelayMs(account.id);
    if (share.role === 'owner' && recipientPriorityDelayMs > 0) {
      this.runtime.logger.log('MEGA owner sync deferred while recipient sync is prioritized on the same account.', {
        accountId: account.id,
        ownerShareId: share.id,
        delayMs: recipientPriorityDelayMs,
      });
      this.schedulePendingSyncRetry(share, account, recipientPriorityDelayMs);
      return;
    }

    const cooldownDelayMs = this.getSyncCooldownRemainingMs(share.id);
    if (cooldownDelayMs > 0) {
      this.schedulePendingSyncRetry(share, account, cooldownDelayMs);
      return;
    }

    this.prioritizeRecipientSync(share, account);

    const existing = this.syncTasks.get(share.id);
    if (existing) {
      this.schedulePendingSyncRetry(share, account, 100);
      return existing;
    }

    await this.runSyncLoop(share, account);
  }

  private prioritizeRecipientSync(share: ManagedShare, account: ProviderAccount): void {
    if (share.role !== 'recipient') {
      return;
    }
    this.markRecipientPriority(account.id);
    const activeAccountSync = this.activeAccountSyncs.get(account.id);
    if (!activeAccountSync || activeAccountSync.shareId === share.id || activeAccountSync.role !== 'owner') {
      return;
    }
    this.runtime.logger.log('MEGA recipient sync preempting active owner sync on the same account.', {
      accountId: account.id,
      recipientShareId: share.id,
      ownerShareId: activeAccountSync.shareId,
    });
    this.abortShareSyncTask(activeAccountSync.shareId);
  }

  private prioritizeOwnerLocalWrite(share: ManagedShare, account: ProviderAccount | null): void {
    if (share.role !== 'owner' || !account) {
      return;
    }
    this.accountRecipientPriorityUntil.delete(account.id);
    const activeAccountSync = this.activeAccountSyncs.get(account.id);
    if (!activeAccountSync || activeAccountSync.shareId === share.id || activeAccountSync.role !== 'recipient') {
      return;
    }
    this.runtime.logger.log('MEGA owner local write preempting active recipient sync on the same account.', {
      accountId: account.id,
      ownerShareId: share.id,
      recipientShareId: activeAccountSync.shareId,
    });
    this.abortShareSyncTask(activeAccountSync.shareId);
  }

  private markRecipientPriority(accountId: string, durationMs = MEGA_RECIPIENT_PRIORITY_WINDOW_MS): void {
    this.accountRecipientPriorityUntil.set(accountId, Date.now() + durationMs);
  }

  private getRecipientPriorityDelayMs(accountId: string): number {
    const until = this.accountRecipientPriorityUntil.get(accountId);
    if (!until) {
      return 0;
    }
    const remainingMs = until - Date.now();
    if (remainingMs <= 0) {
      this.accountRecipientPriorityUntil.delete(accountId);
      return 0;
    }
    return remainingMs;
  }

  private async logDevShareInventoryIfChanged(account: ProviderAccount, reason: 'boot' | 'change'): Promise<void> {
    if (!isDevLogsEnabled()) {
      return;
    }
    try {
      this.devInventoryRefreshedAt.set(account.id, Date.now());
      const inventory = await this.getShareInventoryDebug(account);
      const signature = JSON.stringify(inventory);
      const previous = this.devInventorySignatures.get(account.id);
      if (previous === signature) {
        return;
      }
      this.devInventorySignatures.set(account.id, signature);
      const prefix = reason === 'boot' ? '[MEGA:inventory] boot snapshot' : '[MEGA:inventory] change detected';
      console.log(prefix, {
        accountId: account.id,
        email: account.email ?? account.label,
        incoming: inventory.incoming,
        outgoing: inventory.outgoing,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isMegaTransientSyncError(error)) {
        this.runtime.logger.log('MEGA inventory debug refresh deferred after transient error.', {
          accountId: account.id,
          error: message,
        });
        return;
      }
      this.runtime.logger.warn('MEGA inventory debug refresh failed.', {
        accountId: account.id,
        error: message,
      });
    }
  }

  private async syncOwnerShare(share: ManagedShare, account: ProviderAccount, signal?: AbortSignal): Promise<void> {
    const remotePath = getMegaShareRemotePath(share, this.runtime.mega.remoteBasePath);
    console.log('[MEGA:owner-sync] starting owner share sync.', {
      shareId: share.id,
      accountId: account.id,
      remotePath,
      localPath: share.localPath,
    });
    const priorOwnerState = this.syncStates.get(share.id);
    const keepReadyWhileRefreshing =
      priorOwnerState?.status === 'ready' && priorOwnerState.badges.includes('Synced');
    if (!keepReadyWhileRefreshing) {
      this.syncStates.set(share.id, {
        status: 'syncing',
        detail: 'Syncing the MEGA writable owner folder.',
        badges: ['Writable', 'Syncing'],
      });
    }

    try {
      if (!this.runtime.mega.ownerMirrorSource) {
        await (await getMegaNodeFs()).mkdir(share.localPath, { recursive: true });
        await ensureMegaOwnerLocalStructure(share.localPath);
      }
      const session = await this.getAccountSession(account, signal).catch((error) => {
        throw annotateMegaOwnerSyncPhaseError('Session refresh failed', error);
      });
      console.log('[MEGA:owner-sync] session obtained, resolving remote root.', { remotePath });
      const root = await this.ensureOwnerRemoteRoot(session, remotePath, signal).catch((error) => {
        throw annotateMegaOwnerSyncPhaseError('Remote root resolution failed', error);
      });
      console.log('[MEGA:owner-sync] remote root resolved.', {
        rootHandle: root.root.handle,
        rootName: root.root.name,
        rootPath: root.path,
        scsn: root.scsn,
      });
      this.shareRootHandles.set(share.id, root.root.handle);
      const worker = new MirrorWorker();
      let shareCrypto = await this.resolveOwnerShareCryptoContext(session, root, signal).catch((error) => {
        throw annotateMegaOwnerSyncPhaseError('Share-key resolution failed', error);
      });
      console.log('[MEGA:owner-sync] owner share crypto resolved.', {
        shareId: share.id,
        remotePath,
        rootHandle: root.root.handle,
        explicitShareHandle: root.root.shareHandle,
        resolvedShareHandle: shareCrypto?.shareHandle,
        shareKeyLength: shareCrypto?.shareKey.length ?? 0,
        shareKeyFingerprint: shareCrypto ? fingerprintMegaShareKey(shareCrypto.shareKey) : undefined,
      });
      if (shareCrypto && isZeroBuffer(shareCrypto.shareKey)) {
        this.runtime.logger.warn(
          'MEGA owner sync: detected corrupted (all-zero) share key — repairing the share.',
          { shareId: share.id, shareHandle: root.root.shareHandle, email: session.email }
        );
        shareCrypto = await this.repairOwnerShareKey(session, root, signal);
      }
      if (!shareCrypto && root.root.shareHandle) {
        this.runtime.logger.warn(
          'MEGA owner sync: shared folder has no decryptable share key. Uploaded files will be undecryptable by collaborators.',
          { shareId: share.id, shareHandle: root.root.shareHandle, email: session.email }
        );
      }
      await this.replayMissingOwnerManagedShareInvitesInline(share, account, session, root, signal).catch((error) => {
        throw annotateMegaOwnerSyncPhaseError('Invite replay failed', error);
      });
      shareCrypto = await this.resolveOwnerShareCryptoContext(session, root, signal).catch((error) => {
        throw annotateMegaOwnerSyncPhaseError('Post-invite share-key resolution failed', error);
      }) ?? shareCrypto;
      if (!shareCrypto && root.root.shareHandle && share.invitationEmails.length > 0) {
        this.runtime.logger.warn(
          'MEGA owner sync: share key is still missing after invite replay — repairing the share.',
          { shareId: share.id, shareHandle: root.root.shareHandle, email: session.email }
        );
        shareCrypto = await this.repairOwnerShareKey(session, root, signal);
      }
      const ownerShareKeyHealResult = await this.healOwnerOutgoingShareKeys(share, session, root, shareCrypto, signal).catch((error) => {
        throw annotateMegaOwnerSyncPhaseError('Owner-share key healing failed', error);
      });
      if (
        ownerShareKeyHealResult &&
        ownerShareKeyHealResult.targetCount > 0 &&
        ownerShareKeyHealResult.publishedCount < ownerShareKeyHealResult.targetCount
      ) {
        this.schedulePendingSyncRetry(share, account, MEGA_OWNER_SHARE_KEY_HEAL_RETRY_MS);
      }
      await this.healOwnerShareTreeNodeKeys(share, session, root, shareCrypto, signal).catch((error) => {
        throw annotateMegaOwnerSyncPhaseError('Owner tree-key republish failed', error);
      });
      const previousOwnerUploadState = this.ownerUploadStates.get(share.id);
      const ownerUploadState = buildMegaOwnerUploadState(root, shareCrypto);
      if (
        this.runtime.mega.ownerMirrorSource &&
        previousOwnerUploadState &&
        previousOwnerUploadState.root.path === ownerUploadState.root.path &&
        previousOwnerUploadState.root.root.handle === ownerUploadState.root.root.handle
      ) {
        for (const [relativePath, known] of previousOwnerUploadState.filesByPath.entries()) {
          if (!ownerUploadState.filesByPath.has(relativePath)) {
            ownerUploadState.filesByPath.set(relativePath, known);
          }
        }
      }
      this.ownerUploadStates.set(share.id, ownerUploadState);
      const result = this.runtime.mega.ownerMirrorSource
        ? await this.syncOwnerShareFromRuntimeSource(share, session, ownerUploadState, signal).catch((error) => {
            throw annotateMegaOwnerSyncPhaseError('Runtime-source upload failed', error);
          })
        : await worker.sync(
            share.localPath,
            new MegaOwnerRemoteAdapter(
              this.fetchImpl,
              this.apiClient,
              session,
              ownerUploadState,
              signal
            )
          ).catch((error) => {
            throw annotateMegaOwnerSyncPhaseError('Mirror-worker sync failed', error);
          });
      console.log('[MEGA:owner-sync] owner share sync completed.', {
        shareId: share.id,
        uploaded: result.uploaded,
        downloaded: result.downloaded,
      });
      if (root.scsn) {
        this.shareScsn.set(share.id, root.scsn);
      }
      this.shareKnownHandles.set(share.id, collectTreeHandles(root.tree));
      if (result.uploaded.length > 0) {
        this.markSyncCooldown(share.id, MEGA_POST_UPLOAD_SETTLE_MS);
      } else {
        this.syncRetryCooldowns.delete(share.id);
      }
      this.syncStates.set(share.id, {
        status: 'ready',
        detail: summarizeOwnerMirrorResult(remotePath, result),
        badges: ['Writable', 'Synced'],
        lastSyncAt: this.runtime.now(),
      });
    } catch (error) {
      console.error('[MEGA:owner-sync] owner share sync FAILED.', {
        shareId: share.id,
        remotePath,
        error: error instanceof Error ? error.stack ?? error.message : String(error),
      });
      const ownerTransientRetry =
        isMegaTransientSyncError(error) || (error instanceof Error && error.name === 'AbortError');
      if (ownerTransientRetry) {
        this.markSyncCooldown(share.id);
        this.schedulePendingSyncRetry(share, account);
        this.syncStates.set(share.id, {
          status: 'ready',
          detail:
            'MEGA temporarily asked Nearbytes to retry owner sync. The local writable mirror stays available and the next sync cycle will retry automatically.',
          badges: ['Writable', 'Retrying'],
          diagnostic: {
            code: 'MEGA_OWNER_SYNC_RETRYING',
            title: 'MEGA owner sync retry scheduled',
            summary: 'Retrying automatically',
            detail:
              'MEGA returned a transient lock, rate limit, or network error while syncing this owner folder. Nearbytes will retry automatically.',
          },
        });
        return;
      }
      const detail = describeMegaOwnerSyncFailure(error, remotePath);
      const needsAuth = /login|session|auth|credential|password|reconnect/i.test(detail);
      this.syncStates.set(share.id, {
        status: needsAuth ? 'needs-auth' : 'attention',
        detail,
        badges: ['Writable', needsAuth ? 'Reconnect' : 'Repair'],
        diagnostic: {
          code: needsAuth ? 'MEGA_OWNER_SYNC_RECONNECT_REQUIRED' : 'MEGA_OWNER_SYNC_FAILED',
          title: needsAuth ? 'MEGA owner sync is retrying the saved sign-in' : 'MEGA owner sync needs attention',
          summary: needsAuth ? 'Automatic sign-in retry in progress' : 'MEGA owner sync failed',
          detail,
        },
      });
      throw error;
    }
  }

  private async syncOwnerShareFromRuntimeSource(
    share: ManagedShare,
    session: MegaSession,
    ownerUploadState: MegaOwnerUploadState,
    signal?: AbortSignal
  ): Promise<MegaOwnerSyncResult> {
    const source = this.runtime.mega.ownerMirrorSource;
    if (!source) {
      return { uploaded: [], downloaded: [], skipped: [] };
    }

    const adapter = new MegaOwnerRemoteAdapter(
      this.fetchImpl,
      this.apiClient,
      session,
      ownerUploadState,
      signal
    );
    const uploaded: string[] = [];
    const skipped: string[] = [];
    const activePaths = new Set<string>();
    const syncedPaths = new Set<string>();
    let remoteStateNeedsRefresh = false;
    const mirrorPaths = Array.from(
      new Set<string>(
        (await source.listMirrorFiles(share))
          .map((entry: string) => normalizeRelativePath(entry))
          .filter((entry: string) => entry.length > 0 && isMirrorRelativePath(entry))
      )
    ).sort(compareOwnerMirrorRelativePaths);

    const syncRuntimeSourcePath = async (
      relativePath: string,
      bytes?: Uint8Array,
      options: { readonly waitForVisibility?: boolean } = {}
    ): Promise<void> => {
      if (syncedPaths.has(relativePath)) {
        activePaths.add(relativePath);
        return;
      }
      let fileBytes = bytes;
      if (!fileBytes) {
        try {
          fileBytes = relativePath.startsWith('blocks/')
            ? await this.readManagedShareUploadBytesWithRetry(share, relativePath)
            : await source.readMirrorFile(share, relativePath);
        } catch (error) {
          if (isRuntimeSourceMirrorFileMissing(error)) {
            skipped.push(relativePath);
            return;
          }
          throw error;
        }
      }
      if (!fileBytes) {
        throw new Error(`Runtime source did not return bytes for ${relativePath}`);
      }
      activePaths.add(relativePath);
      const existing = ownerUploadState.filesByPath.get(relativePath);
      const canonicalEventPath = parseCanonicalEventRelativePath(relativePath);
      if (existing && canonicalEventPath) {
        skipped.push(relativePath);
        syncedPaths.add(relativePath);
        return;
      }
      // Runtime-source owner mirrors can produce new canonical channel events with the same byte length
      // as older remote files. Do not use a size-only shortcut for channels/* or we can suppress real push sync.
      if (existing && !relativePath.startsWith('channels/') && existing.size === fileBytes.length) {
        skipped.push(relativePath);
        syncedPaths.add(relativePath);
        return;
      }
      await adapter.upload(relativePath, fileBytes, { waitForVisibility: options.waitForVisibility === true });
      uploaded.push(relativePath);
      syncedPaths.add(relativePath);
      remoteStateNeedsRefresh = true;
    };

    for (const relativePath of mirrorPaths) {
      if (syncedPaths.has(relativePath)) {
        activePaths.add(relativePath);
        continue;
      }
      let bytes: Uint8Array;
      try {
        bytes = await source.readMirrorFile(share, relativePath);
      } catch (error) {
        if (isRuntimeSourceMirrorFileMissing(error)) {
          // Runtime-source listings can race with local compaction or replacement. Skip vanished
          // entries instead of aborting the whole push cycle; the next pass will publish the stable set.
          skipped.push(relativePath);
          continue;
        }
        throw error;
      }
      if (relativePath.startsWith('channels/')) {
        const referencedBlockPaths = extractReferencedRuntimeSourceBlockPaths(bytes);
        let deferredChannelUpload = false;
        for (const blockPath of referencedBlockPaths) {
          try {
            const blockBytes = await this.readManagedShareUploadBytesWithRetry(share, blockPath);
            await syncRuntimeSourcePath(blockPath, blockBytes, { waitForVisibility: true });
          } catch (error) {
            if (isRuntimeSourceMirrorFileMissing(error)) {
              skipped.push(relativePath);
              deferredChannelUpload = true;
              break;
            }
            throw error;
          }
        }
        if (deferredChannelUpload) {
          continue;
        }
      }
      await syncRuntimeSourcePath(relativePath, bytes);
    }

    for (const [relativePath, file] of Array.from(ownerUploadState.filesByPath.entries())) {
      if (!isMirrorRelativePath(relativePath) || activePaths.has(relativePath)) {
        continue;
      }
      await deleteMegaNode(this.apiClient, session, file.handle, signal);
      ownerUploadState.filesByPath.delete(relativePath);
      remoteStateNeedsRefresh = true;
    }

    if (remoteStateNeedsRefresh) {
      const knownActiveRemoteFiles = new Map<string, MegaKnownRemoteFile>();
      for (const relativePath of activePaths) {
        const known = ownerUploadState.filesByPath.get(relativePath);
        if (known) {
          knownActiveRemoteFiles.set(relativePath, known);
        }
      }
      try {
        const refreshed = await fetchMegaDecryptedTree(
          this.apiClient,
          session,
          ownerUploadState.root.root.handle,
          { useCache: false, allowTransientFullFallback: false, extraShareKeys: ownerUploadState.extraShareKeys },
          signal
        );
        replaceMegaOwnerUploadStateFromTree(ownerUploadState, refreshed.tree);
        for (const [relativePath, known] of knownActiveRemoteFiles) {
          if (!ownerUploadState.filesByPath.has(relativePath)) {
            ownerUploadState.filesByPath.set(relativePath, known);
          }
        }
      } catch (error) {
        if (!isMegaTransientSyncError(error) && !(error instanceof Error && error.name === 'AbortError')) {
          throw error;
        }
        this.runtime.logger.warn('MEGA owner runtime-source post-upload refresh deferred after transient failure.', {
          shareId: share.id,
          accountId: share.accountId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      uploaded,
      downloaded: [],
      skipped,
    };
  }

  private async getAccountSession(account: ProviderAccount, signal?: AbortSignal): Promise<MegaSession> {
    const secret = await this.runtime.secretStore.get<MegaAccountSecret>(secretKey(account.id));
    if (!secret) {
      throw new Error(MEGA_RECONNECT_REQUIRED_MESSAGE);
    }
    if (!isStoredMegaAccountSecret(secret)) {
      const recovered = await this.refreshAccountSessionShared(account, secret);
      await this.fetchCurrentUser(recovered, signal);
      return recovered;
    }

    const session = deserializeSession(secret, account.email ?? account.label);
    this.accountIdByUserHandle.set(session.userHandle, account.id);
    await this.loadPersistedShareKeysForSession(session);
    const validatedAt = this.accountSessionValidatedAt.get(account.id);
    if (typeof validatedAt === 'number' && this.runtime.now() - validatedAt < MEGA_SESSION_VALIDATION_CACHE_MS) {
      return session;
    }
    try {
      await this.fetchCurrentUser(session, signal);
      this.accountSessionValidatedAt.set(account.id, this.runtime.now());
      return session;
    } catch (error) {
      if (isMegaSessionInvalid(error)) {
        return this.refreshAccountSessionShared(account, secret, error);
      }
      if (isMegaTemporaryLockError(error)) {
        this.accountSessionValidatedAt.set(account.id, this.runtime.now());
        this.runtime.logger.warn('MEGA account session validation was temporarily locked; continuing with the cached session.', {
          accountId: account.id,
          code: (error as MegaApiError | undefined)?.code,
        });
        return session;
      }
      throw error;
    }
  }

  private async withRecoveredAccountSession<T>(
    account: ProviderAccount,
    operation: (session: MegaSession) => Promise<T>
  ): Promise<T> {
    const session = await this.getAccountSession(account);
    try {
      return await operation(session);
    } catch (error) {
      if (isMegaSessionInvalid(error)) {
        const refreshed = await this.refreshAccountSessionShared(account, undefined, error);
        return operation(refreshed);
      }
      throw error;
    }
  }

  private async loadPersistedShareKeysForSession(
    session: MegaSession,
    options: {
      readonly forceReload?: boolean;
    } = {}
  ): Promise<ReadonlyMap<string, Buffer> | undefined> {
    const userHandle = session.userHandle.trim();
    if (!userHandle) {
      return undefined;
    }

    const cachedShareKeys = this.accountShareKeyCache.get(userHandle);
    if (!options.forceReload && cachedShareKeys && cachedShareKeys.size > 0) {
      return cachedShareKeys;
    }

    const accountId = this.accountIdByUserHandle.get(userHandle);
    if (!accountId) {
      return cachedShareKeys;
    }

    const secret = await this.runtime.secretStore.get<MegaAccountSecret>(secretKey(accountId));
    if (!isStoredMegaAccountSecret(secret)) {
      return cachedShareKeys;
    }

    const persistedShareKeys = decodePersistedMegaShareKeys(secret.shareKeys);
    if (persistedShareKeys.size === 0) {
      return cachedShareKeys;
    }

    this.accountShareKeyCache.set(userHandle, persistedShareKeys);
    return persistedShareKeys;
  }

  private async refreshAccountSessionShared(
    account: ProviderAccount,
    cachedSecret?: MegaAccountSecret | unknown,
    cause?: unknown
  ): Promise<MegaSession> {
    const existingTask = this.accountSessionRefreshTasks.get(account.id);
    if (existingTask) {
      return existingTask;
    }

    const refreshTask = this.refreshAccountSession(account, cachedSecret, cause).finally(() => {
      if (this.accountSessionRefreshTasks.get(account.id) === refreshTask) {
        this.accountSessionRefreshTasks.delete(account.id);
      }
    });
    this.accountSessionRefreshTasks.set(account.id, refreshTask);
    return refreshTask;
  }

  private async refreshAccountSession(
    account: ProviderAccount,
    cachedSecret?: MegaAccountSecret | unknown,
    cause?: unknown
  ): Promise<MegaSession> {
    const storedSecret =
      cachedSecret === undefined
        ? ((await this.runtime.secretStore.get<MegaAccountSecret>(secretKey(account.id))) as unknown)
        : cachedSecret;
    const credentials = extractMegaReusableCredentials(storedSecret, account.email ?? '');
    if (!credentials) {
      this.runtime.logger.warn('MEGA session refresh skipped because reusable credentials are missing.', {
        accountId: account.id,
        hadSecret: Boolean(storedSecret),
      });
      throw createMegaReconnectRequiredError(cause);
    }
    const { email, password, mfaCode } = credentials;

    try {
      this.runtime.logger.log('Refreshing MEGA session with the stored account credentials.', {
        accountId: account.id,
        hasMfaCode: typeof mfaCode === 'string' && mfaCode.trim().length > 0,
      });
      const refreshed = await this.loginWithPassword(email, password, mfaCode);
      await this.runtime.secretStore.set(secretKey(account.id), {
        email,
        sid: refreshed.sid,
        password,
        mfaCode,
        masterKey: encodeMegaBase64Url(refreshed.masterKey),
        encryptedPrivateKey: refreshed.encryptedPrivateKey,
        userHandle: refreshed.userHandle,
        accountVersion: refreshed.accountVersion,
        accountSalt: refreshed.accountSalt,
        shareKeys: encodePersistedMegaShareKeys(this.accountShareKeyCache.get(refreshed.userHandle)),
      } satisfies MegaAccountSecret);
      this.accountIdByUserHandle.set(refreshed.userHandle, account.id);
      this.runtime.logger.log('MEGA session refresh succeeded.', {
        accountId: account.id,
      });
      return refreshed;
    } catch (error) {
      this.runtime.logger.warn('MEGA session refresh failed.', {
        accountId: account.id,
        message: error instanceof Error ? error.message : String(error),
      });
      if (isMegaSessionInvalid(error) || isMegaSessionInvalid(cause)) {
        throw createMegaReconnectRequiredError(error);
      }
      throw error;
    }
  }

  private clearAccountDiscoveryCaches(accountId: string): void {
    this.incomingShareDiscoveryCache.delete(accountId);
    this.incomingShareDiscoveryTasks.delete(accountId);
    this.incomingContactInviteCache.delete(accountId);
    this.incomingContactInviteTasks.delete(accountId);
  }


  private async loginWithPassword(email: string, password: string, mfaCode?: string): Promise<MegaSession> {
    return createMegaPasswordSession(this.apiClient, this.runtime.logger, email, password, mfaCode);
  }

  private async fetchCurrentUser(session: MegaSession, signal?: AbortSignal): Promise<Record<string, unknown>> {
    return this.apiCommand<Record<string, unknown>>({ a: 'ug' }, session, signal);
  }


  private async fetchNodesSnapshot(session: MegaSession, signal?: AbortSignal): Promise<MegaFetchNodesSnapshot> {
    const snapshot = await fetchMegaNodesSnapshot(this.apiClient, session, undefined, { useCache: false }, signal);
    const cloudHandle = resolveMegaCloudDriveHandle(snapshot);
    if (cloudHandle) {
      this.accountCloudDriveHandleCache.set(session.userHandle, cloudHandle);
    }
    return snapshot;
  }

  private async fetchPartialTreeWithSnapshot(
    session: MegaSession,
    rootHandle: string,
    signal?: AbortSignal,
    options: {
      readonly allowTransientFullFallback?: boolean;
      readonly expectedRootName?: string;
      readonly fastPartialFallback?: boolean;
    } = {}
  ): Promise<MegaFetchedTree> {
    const cachedShareKeys = this.accountShareKeyCache.get(session.userHandle);
    let fetched: MegaFetchedTree;
    try {
      fetched = await fetchMegaDecryptedTree(
        this.apiClient,
        session,
        rootHandle,
        {
          useCache: false,
          allowTransientFullFallback: options.allowTransientFullFallback,
          fastPartialFallback: options.fastPartialFallback,
          extraShareKeys: cachedShareKeys,
          expectedRootName: options.expectedRootName,
        },
        signal,
        this.runtime.logger
      );
    } catch (error) {
      if (!(await this.shouldRetryIncomingTreeAfterRootDecryptFailure(session, rootHandle, cachedShareKeys, error, signal))) {
        throw error;
      }
      fetched = await fetchMegaDecryptedTree(
        this.apiClient,
        session,
        rootHandle,
        {
          useCache: false,
          allowTransientFullFallback: options.allowTransientFullFallback,
          fastPartialFallback: options.fastPartialFallback,
          extraShareKeys: this.accountShareKeyCache.get(session.userHandle),
          expectedRootName: options.expectedRootName,
        },
        signal,
        this.runtime.logger
      );
    }

    if (this.shouldRetryIncomingTreeWithoutCachedShareKeys(rootHandle, fetched, cachedShareKeys)) {
      const invalidatedCount = await this.invalidateCachedShareKeysForRoot(session.userHandle, rootHandle, fetched.snapshot);
      if (invalidatedCount > 0) {
        this.runtime.logger.warn('MEGA incoming share self-heal: invalidated cached share keys after empty tree decrypt.', {
          email: session.email,
          rootHandle,
          invalidatedCount,
          snapshotNodeCount: fetched.snapshot.nodes.length,
        });
        fetched = await fetchMegaDecryptedTree(
          this.apiClient,
          session,
          rootHandle,
          {
            useCache: false,
            allowTransientFullFallback: options.allowTransientFullFallback,
            fastPartialFallback: options.fastPartialFallback,
            extraShareKeys: this.accountShareKeyCache.get(session.userHandle),
            expectedRootName: options.expectedRootName,
          },
          signal,
          this.runtime.logger
        );
      }
    }

    return fetched;
  }

  private async fetchPartialTreeWithRetry(
    session: MegaSession,
    rootHandle: string,
    signal?: AbortSignal,
    options: {
      readonly allowTransientFullFallback?: boolean;
      readonly expectedRootName?: string;
      readonly fastPartialFallback?: boolean;
      readonly maxAttempts?: number;
    } = {}
  ): Promise<MegaFetchedTree> {
    const maxAttempts = Math.max(1, options.maxAttempts ?? MEGA_CREATE_RECOVERY_ATTEMPTS);
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        return await this.fetchPartialTreeWithSnapshot(session, rootHandle, signal, options);
      } catch (error) {
        if (
          !isMegaRetryableApiError(error) &&
          !isMegaRetryableTransportError(error) &&
          !isMegaEventuallyConsistentMutationError(error)
        ) {
          throw error;
        }
        if (attempt >= maxAttempts - 1) {
          throw error;
        }
        await waitForMegaRetry(getMegaRetryDelayMs(error, attempt), signal);
      }
    }
    throw new Error(`MEGA did not fetch subtree ${rootHandle}.`);
  }

  private async fetchKeyManagerState(
    session: MegaSession,
    signal?: AbortSignal,
    options: {
      readonly includePendingInShareKeys?: boolean;
      readonly snapshot?: MegaFetchNodesSnapshot;
    } = {}
  ): Promise<MegaKeyManagerState> {
    const cachedShareKeys = this.accountShareKeyCache.get(session.userHandle);
    const fetched = await fetchMegaKeyManagerState(this.apiClient, session, signal, this.runtime.logger);
    const pendingKeys = options.includePendingInShareKeys
      ? await fetchMegaPendingInShareKeys(this.apiClient, session, signal, this.runtime.logger)
      : new Map<string, MegaPendingInShareRecord>();
    const mergedFetched: MegaKeyManagerState = {
      ...fetched,
      pendingInShares: mergeMegaPendingInShares(fetched.pendingInShares, pendingKeys),
    };
    const resolvedShareKeys = await resolveMegaKeyManagerShareKeys(
      this.apiClient,
      session,
      mergedFetched,
      signal,
      this.runtime.logger,
      options.snapshot
    );
    const resolved: MegaKeyManagerState = {
      ...mergedFetched,
      shareKeys: mergeMegaShareKeyMaps(cachedShareKeys, resolvedShareKeys),
    };
    if (resolved.shareKeys.size > 0) {
      this.accountShareKeyCache.set(session.userHandle, new Map(resolved.shareKeys));
      await this.persistCachedShareKeysForUser(session.userHandle);
      return resolved;
    }
    if (cachedShareKeys && cachedShareKeys.size > 0) {
      this.runtime.logger.log('MEGA key-manager state fallback: using cached share keys after empty fetch result.', {
        email: session.email,
        keyCount: cachedShareKeys.size,
      });
      return {
        shareKeys: new Map(cachedShareKeys),
        pendingInShares: mergedFetched.pendingInShares,
        authRingEd25519: mergedFetched.authRingEd25519,
        privateCu25519: mergedFetched.privateCu25519,
        records: mergedFetched.records,
      };
    }
    return resolved;
  }

  private async prepareOwnerOutgoingInviteInKeyManager(
    session: MegaSession,
    root: MegaOwnerRemoteRoot,
    shareKey: Buffer,
    invitee: MegaShareInviteTarget,
    keyManager: MegaKeyManagerState,
    options: {
      readonly trusted?: boolean;
    } = {},
    signal?: AbortSignal
  ): Promise<void> {
    const shareHandle = root.root.handle.trim();
    if (!shareHandle) {
      throw new Error('MEGA owner root is missing a handle; cannot prepare a share key.');
    }

    const updatedContainer = buildMegaKeyManagerContainerWithShareKey(
      keyManager,
      shareHandle,
      shareKey,
      {
        trusted: options.trusted,
        pendingOutShareTarget: resolveMegaPendingOutShareTarget(invitee),
      },
      session.masterKey
    );
    if (updatedContainer === null) {
      throw new Error('MEGA key-manager state is unavailable; cannot prepare an outgoing share in secure mode.');
    }
    if (updatedContainer.length > 0) {
      await this.apiCommand(
        {
          a: 'up2',
          '^!keys': encodeMegaBase64Url(updatedContainer),
        },
        session,
        signal
      );
    }
    await this.rememberOwnerShareKey(session, root, shareKey);
    this.runtime.logger.log('MEGA owner outgoing share state prepared in ^!keys before issuing s2.', {
      shareHandle,
      email: session.email,
      wroteAttribute: updatedContainer.length > 0,
    });
  }

  private async finalizeOwnerOutgoingInviteInKeyManager(
    session: MegaSession,
    root: MegaOwnerRemoteRoot,
    shareKey: Buffer,
    invitee: MegaShareInviteTarget,
    options: {
      readonly removePendingOutShare?: boolean;
    } = {},
    signal?: AbortSignal
  ): Promise<void> {
    const shareHandle = root.root.handle.trim();
    if (!shareHandle) {
      return;
    }

    const keyManager = await this.fetchKeyManagerState(session, signal);
    if (keyManager.records.length === 0) {
      return;
    }

    const updatedContainer = buildMegaKeyManagerContainerWithShareKey(
      keyManager,
      shareHandle,
      shareKey,
      {
        inUse: true,
        pendingOutShareTarget: resolveMegaPendingOutShareTarget(invitee),
        removePendingOutShare: options.removePendingOutShare,
      },
      session.masterKey
    );
    if (updatedContainer === null || updatedContainer.length === 0) {
      return;
    }

    await this.apiCommand(
      {
        a: 'up2',
        '^!keys': encodeMegaBase64Url(updatedContainer),
      },
      session,
      signal
    );
  }

  private async sendMegaPendingOutShareKeyToContact(
    session: MegaSession,
    shareHandle: string,
    shareKey: Buffer,
    invitee: MegaShareInviteTarget,
    keyManager: MegaKeyManagerState,
    signal?: AbortSignal
  ): Promise<boolean> {
    const userHandle = invitee.u.trim();
    if (!isMegaUserHandle(userHandle)) {
      this.runtime.logger.log('MEGA secure pending outshare key skipped: invitee is not a resolved user handle.', {
        email: session.email,
        invitee: invitee.u,
        shareHandle,
      });
      return false;
    }
    if (!keyManager.privateCu25519 || keyManager.privateCu25519.length !== 32) {
      this.runtime.logger.warn('MEGA secure pending outshare key skipped: sender key-manager lacks a usable private Cu25519 key.', {
        email: session.email,
        invitee: userHandle,
        shareHandle,
        hasPrivateCu25519: Boolean(keyManager.privateCu25519),
        privateCu25519Length: keyManager.privateCu25519?.length ?? 0,
      });
      return false;
    }
    const authMethod = keyManager.authRingEd25519.get(userHandle) ?? -1;
    if (authMethod < MEGA_AUTH_METHOD_SEEN) {
      this.runtime.logger.warn('MEGA secure pending outshare key continuing even though invitee auth ring is below SEEN.', {
        email: session.email,
        invitee: userHandle,
        shareHandle,
        authMethod,
      });
    }

    try {
      const publicCu25519 = await fetchMegaUserPublicCu25519(
        this.apiClient,
        session,
        userHandle,
        signal,
        this.runtime.logger
      );
      if (!publicCu25519 || publicCu25519.length !== 32) {
        this.runtime.logger.warn('MEGA secure pending outshare key skipped: invitee public Cu25519 key is unavailable.', {
          email: session.email,
          invitee: userHandle,
          shareHandle,
          publicCu25519Length: publicCu25519?.length ?? 0,
        });
        return false;
      }

      const pairwiseKey = await deriveMegaPairwiseKey(keyManager.privateCu25519, publicCu25519);
      await this.apiCommand(
        {
          a: 'pk',
          u: userHandle,
          h: shareHandle,
          k: encodeMegaBase64Url(encryptAesEcb(shareKey, pairwiseKey)),
        },
        session,
        signal
      );
      this.runtime.logger.log('MEGA secure pending outshare key published for invitee.', {
        email: session.email,
        invitee: userHandle,
        shareHandle,
      });
      return true;
    } catch (error) {
      this.runtime.logger.warn('MEGA failed to send a secure pending outshare key to the invitee.', {
        email: session.email,
        invitee: userHandle,
        shareHandle,
        message: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  private async rememberShareKeys(session: MegaSession, shareKeys: ReadonlyMap<string, Buffer>): Promise<number> {
    if (shareKeys.size === 0) {
      return 0;
    }

    const mergedShareKeys = new Map(this.accountShareKeyCache.get(session.userHandle) ?? []);
    let learnedShareKeyCount = 0;
    for (const [handleRaw, shareKey] of shareKeys.entries()) {
      const handle = handleRaw.trim();
      if (!handle) {
        continue;
      }
      const existing = mergedShareKeys.get(handle);
      if (existing && existing.equals(shareKey)) {
        continue;
      }
      mergedShareKeys.set(handle, Buffer.from(shareKey));
      learnedShareKeyCount += 1;
    }

    if (learnedShareKeyCount > 0) {
      this.accountShareKeyCache.set(session.userHandle, mergedShareKeys);
      await this.persistCachedShareKeysForUser(session.userHandle);
    }
    return learnedShareKeyCount;
  }

  private async rememberOwnerShareKey(session: MegaSession, root: MegaOwnerRemoteRoot, shareKey: Buffer): Promise<void> {
    const handles = [...new Set([root.root.handle, root.root.shareHandle].map((value) => value?.trim() ?? '').filter(Boolean))];
    if (handles.length === 0) {
      return;
    }
    const mapped = new Map<string, Buffer>();
    for (const handle of handles) {
      mapped.set(handle, Buffer.from(shareKey));
    }
    await this.rememberShareKeys(session, mapped);
  }

  private async rememberActionPacketShareKeys(session: MegaSession, packets: readonly Record<string, unknown>[]): Promise<number> {
    if (packets.length === 0) {
      return 0;
    }

    const extractedShareKeys = extractMegaShareKeysFromActionPackets(packets, session);
    if (extractedShareKeys.size === 0) {
      return 0;
    }

    return this.rememberShareKeys(session, extractedShareKeys);
  }

  private async healOwnerOutgoingShareKeys(
    share: ManagedShare,
    session: MegaSession,
    root: MegaOwnerRemoteRoot,
    shareCrypto: MegaShareCryptoContext | undefined,
    signal?: AbortSignal
  ): Promise<{ targetCount: number; publishedCount: number } | null> {
    if (!shareCrypto) {
      return null;
    }

    const cooldownKey = buildOwnerShareHealCooldownKey(share.id, shareCrypto.shareHandle);
    const lastHealedAt = this.ownerShareKeyHealAt.get(cooldownKey) ?? 0;
    if (Date.now() - lastHealedAt < MEGA_OWNER_SHARE_KEY_HEAL_INTERVAL_MS) {
      return null;
    }

    try {
      const snapshot = await this.fetchNodesSnapshot(session, signal);
      const targets = collectMegaOwnerShareInviteTargets(snapshot, root.root.handle, root.root.shareHandle)
        .filter((target) => isMegaUserHandle(target.u));
      if (targets.length === 0) {
        return { targetCount: 0, publishedCount: 0 };
      }

      const keyManager = await this.fetchKeyManagerState(session, signal);
      let publishedCount = 0;
      for (const target of targets) {
        if (await this.sendMegaPendingOutShareKeyToContact(
          session,
          shareCrypto.shareHandle,
          shareCrypto.shareKey,
          target,
          keyManager,
          signal
        )) {
          publishedCount += 1;
        }
      }
      const cooldownMs = publishedCount >= targets.length
        ? MEGA_OWNER_SHARE_KEY_HEAL_INTERVAL_MS
        : MEGA_OWNER_SHARE_KEY_HEAL_RETRY_MS;
      this.ownerShareKeyHealAt.set(cooldownKey, Date.now() - MEGA_OWNER_SHARE_KEY_HEAL_INTERVAL_MS + cooldownMs);
      this.runtime.logger.log('MEGA owner share key healing completed.', {
        shareId: share.id,
        accountId: share.accountId,
        shareHandle: shareCrypto.shareHandle,
        targetCount: targets.length,
        publishedCount,
        nextRetryInMs: cooldownMs,
      });
      return {
        targetCount: targets.length,
        publishedCount,
      };
    } catch (error) {
      this.runtime.logger.warn('MEGA owner share key healing failed.', {
        shareId: share.id,
        accountId: share.accountId,
        shareHandle: shareCrypto.shareHandle,
        message: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private async healOwnerShareTreeNodeKeys(
    share: ManagedShare,
    session: MegaSession,
    root: MegaOwnerRemoteRoot,
    shareCrypto: MegaShareCryptoContext | undefined,
    signal?: AbortSignal
  ): Promise<void> {
    if (!shareCrypto) {
      return;
    }

    const cooldownKey = buildOwnerShareHealCooldownKey(share.id, shareCrypto.shareHandle);
    const lastHealedAt = this.ownerShareTreeHealAt.get(cooldownKey) ?? 0;
    if (Date.now() - lastHealedAt < MEGA_OWNER_SHARE_KEY_HEAL_INTERVAL_MS) {
      return;
    }

    try {
      const snapshot = await this.fetchNodesSnapshot(session, signal);
      const targetCount = countMegaOwnerSharePeers(snapshot, root.root.handle, root.root.shareHandle);
      if (targetCount === 0) {
        this.ownerShareTreeHealAt.set(cooldownKey, Date.now());
        return;
      }

      await this.republishOwnerShareTreeNodeKeys(session, root, shareCrypto, signal);
      await this.rememberOwnerShareKey(session, root, shareCrypto.shareKey);
      this.ownerShareTreeHealAt.set(cooldownKey, Date.now());
      this.runtime.logger.log('MEGA owner share tree key republish completed.', {
        shareId: share.id,
        accountId: share.accountId,
        shareHandle: shareCrypto.shareHandle,
        targetCount,
        nodeCount: root.tree.nodesByHandle.size,
      });
    } catch (error) {
      this.ownerShareTreeHealAt.set(cooldownKey, Date.now() - MEGA_OWNER_SHARE_KEY_HEAL_INTERVAL_MS + MEGA_OWNER_SHARE_KEY_HEAL_RETRY_MS);
      this.runtime.logger.warn('MEGA owner share tree key republish failed.', {
        shareId: share.id,
        accountId: share.accountId,
        shareHandle: shareCrypto.shareHandle,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async republishOwnerShareTreeNodeKeys(
    session: MegaSession,
    root: MegaOwnerRemoteRoot,
    shareCrypto: MegaShareCryptoContext,
    signal?: AbortSignal
  ): Promise<void> {
    const shareHandle = root.root.handle.trim();
    if (!shareHandle) {
      throw new Error('MEGA owner share tree republish requires a share handle.');
    }

    const command: Record<string, unknown> = {
      a: 'k',
      cr: buildMegaShareNodeKeyRecords(root, shareCrypto.shareKey),
    };
    await this.apiCommand(command, session, signal);
  }

  private async replayMissingOwnerManagedShareInvitesInline(
    share: ManagedShare,
    account: ProviderAccount,
    session: MegaSession,
    root: MegaOwnerRemoteRoot,
    signal?: AbortSignal
  ): Promise<void> {
    if (share.role !== 'owner' || share.invitationEmails.length === 0) {
      return;
    }

    let snapshot = await this.fetchNodesSnapshot(session, signal);
    const collaborators = collectMegaOwnerCollaborators(snapshot, root.root.handle, root.root.shareHandle);
    const existingEmails = new Set(
      collaborators
        .map((collaborator) => collaborator.email?.trim().toLowerCase())
        .filter((value): value is string => Boolean(value))
    );
    const invitees = uniqueTrimmedStrings(share.invitationEmails)
      .map((email) => email.trim())
      .filter((email) => email.length > 0 && !existingEmails.has(email.toLowerCase()));
    if (invitees.length === 0) {
      return;
    }

    const accessLevel = resolveMegaInviteAccessLevel('read/write');
    for (const [index, email] of invitees.entries()) {
      if (index > 0) {
        await waitForMegaRetry(400, signal);
        snapshot = await this.fetchNodesSnapshot(session, signal);
      }

      const hasOutgoingForRoot = snapshotHasOutgoingShareForRoot(snapshot, root.root.handle, root.root.shareHandle);
      const isNewShare = !hasOutgoingForRoot && index === 0;
      let target = resolveMegaShareInviteTarget(snapshot, email);
      let shareCrypto = isNewShare ? undefined : await this.resolveOwnerShareCryptoContext(session, root, signal);

      if (!shareCrypto?.shareKey) {
        const shareKey = Buffer.from(shareCrypto?.shareKey ?? randomBytes(16));
        shareCrypto = { shareHandle: root.root.handle, shareKey };
      }

      const keyManager = await this.fetchKeyManagerState(session, signal);
      const useSecureKeyManagerShareFlow = keyManager.records.length > 0;
      if (useSecureKeyManagerShareFlow) {
        await this.prepareOwnerOutgoingInviteInKeyManager(
          session,
          root,
          shareCrypto.shareKey,
          target,
          keyManager,
          { trusted: isNewShare },
          signal
        );
      }

      if (target.u === MEGA_SHARE_INVITE_NON_CONTACT_USER && target.e) {
        try {
          await this.apiCommand({ a: 'upc', u: target.e, aa: 'a' }, session, signal);
        } catch (error) {
          this.runtime.logger.warn('MEGA invite replay: pending-contact request failed; continuing with share invite.', {
            shareId: share.id,
            accountId: account.id,
            email: target.e,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }

      let sentPendingShareKeyToContact = false;
      if (useSecureKeyManagerShareFlow) {
        sentPendingShareKeyToContact = await this.sendMegaPendingOutShareKeyToContact(
          session,
          root.root.handle,
          shareCrypto.shareKey,
          target,
          keyManager,
          signal
        );
      }

      const command = buildMegaSetShareCommand(root, session, target, accessLevel, {
        includeNodeKeyRecords: index === 0,
        shareKey: shareCrypto.shareKey,
        secureMode: useSecureKeyManagerShareFlow,
      });

      try {
        await this.apiCommand(command.command, session, signal);
        await this.rememberOwnerShareKey(session, root, command.shareKey);
        if (useSecureKeyManagerShareFlow) {
          await this.finalizeOwnerOutgoingInviteInKeyManager(session, root, command.shareKey, target, {
            removePendingOutShare: sentPendingShareKeyToContact,
          }, signal);
        }
      } catch (error) {
        const code = getMegaApiErrorCode(error);
        const canFallbackToDirectEmail =
          code === -3 &&
          target.u === MEGA_SHARE_INVITE_NON_CONTACT_USER &&
          typeof target.e === 'string' &&
          target.e.trim().length > 0;
        if (!canFallbackToDirectEmail) {
          throw error;
        }
        const fallbackTarget: MegaShareInviteTarget = { u: target.e!.trim() };
        const fallbackCommand = buildMegaSetShareCommand(root, session, fallbackTarget, accessLevel, {
          includeNodeKeyRecords: index === 0,
          shareKey: command.shareKey,
          secureMode: useSecureKeyManagerShareFlow,
        });
        await this.apiCommand(fallbackCommand.command, session, signal);
        await this.rememberOwnerShareKey(session, root, fallbackCommand.shareKey);
        if (useSecureKeyManagerShareFlow) {
          await this.finalizeOwnerOutgoingInviteInKeyManager(session, root, fallbackCommand.shareKey, fallbackTarget, {
            removePendingOutShare: false,
          }, signal);
        }
        target = fallbackTarget;
      }

      this.runtime.logger.log('MEGA invite replay re-applied missing collaborator.', {
        shareId: share.id,
        accountId: account.id,
        email,
        inviteTarget: target.e ?? target.u,
        isNewShare,
      });
    }

    this.collaboratorCache.delete(share.id);
    this.incomingShareDiscoveryCache.delete(account.id);
    await this.waitForMegaOutgoingInviteReflection(session, root, invitees);
  }

  private async persistCachedShareKeysForUser(userHandleRaw: string): Promise<void> {
    const userHandle = userHandleRaw.trim();
    if (!userHandle) {
      return;
    }
    const accountId = this.accountIdByUserHandle.get(userHandle);
    if (!accountId) {
      return;
    }
    const secret = await this.runtime.secretStore.get<MegaAccountSecret>(secretKey(accountId));
    if (!isStoredMegaAccountSecret(secret) || secret.userHandle.trim() !== userHandle) {
      return;
    }
    await this.runtime.secretStore.set(secretKey(accountId), {
      ...secret,
      shareKeys: encodePersistedMegaShareKeys(this.accountShareKeyCache.get(userHandle)),
    } satisfies MegaAccountSecret);
  }

  private shouldRetryIncomingTreeWithoutCachedShareKeys(
    rootHandle: string,
    fetched: MegaFetchedTree,
    cachedShareKeys: ReadonlyMap<string, Buffer> | undefined
  ): boolean {
    if (!cachedShareKeys || cachedShareKeys.size === 0) {
      return false;
    }
    if (fetched.snapshot.nodes.length <= 1) {
      return false;
    }
    const relatedHandles = collectMegaShareKeyRelatedHandles(rootHandle, fetched.snapshot);
    if (!relatedHandles.some((handle) => {
      const shareKey = cachedShareKeys.get(handle);
      return Buffer.isBuffer(shareKey) && shareKey.length > 0;
    })) {
      return false;
    }
    return listMegaTopLevelEntryNames(fetched.tree).length === 0;
  }

  private async shouldRetryIncomingTreeAfterRootDecryptFailure(
    session: MegaSession,
    rootHandle: string,
    cachedShareKeys: ReadonlyMap<string, Buffer> | undefined,
    error: unknown,
    signal?: AbortSignal
  ): Promise<boolean> {
    const message = error instanceof Error ? error.message : String(error);
    if (!/requested root node/i.test(message)) {
      return false;
    }
    if (!cachedShareKeys || cachedShareKeys.size === 0) {
      return false;
    }
    const snapshot = await this.fetchNodesSnapshot(session, signal);
    const invalidatedCount = await this.invalidateCachedShareKeysForRoot(session.userHandle, rootHandle, snapshot);
    if (invalidatedCount <= 0) {
      return false;
    }
    this.runtime.logger.warn('MEGA incoming share self-heal: invalidated cached share keys after missing-root decrypt failure.', {
      email: session.email,
      rootHandle,
      invalidatedCount,
      snapshotNodeCount: snapshot.nodes.length,
    });
    return true;
  }

  private async invalidateCachedShareKeysForRoot(
    userHandleRaw: string,
    rootHandle: string,
    snapshot: MegaFetchNodesSnapshot
  ): Promise<number> {
    const userHandle = userHandleRaw.trim();
    if (!userHandle) {
      return 0;
    }
    const cachedShareKeys = this.accountShareKeyCache.get(userHandle);
    if (!cachedShareKeys || cachedShareKeys.size === 0) {
      return 0;
    }
    const nextShareKeys = new Map(cachedShareKeys);
    let invalidatedCount = 0;
    for (const handle of collectMegaShareKeyRelatedHandles(rootHandle, snapshot)) {
      if (!nextShareKeys.delete(handle)) {
        continue;
      }
      invalidatedCount += 1;
    }
    if (invalidatedCount === 0) {
      return 0;
    }
    if (nextShareKeys.size > 0) {
      this.accountShareKeyCache.set(userHandle, nextShareKeys);
    } else {
      this.accountShareKeyCache.delete(userHandle);
    }
    await this.persistCachedShareKeysForUser(userHandle);
    return invalidatedCount;
  }

  private async fetchActionPackets(session: MegaSession, scsn: string, signal?: AbortSignal): Promise<MegaActionPacketBatch> {
    return withMegaApiRetry(async () => {
      const url = buildMegaScChannelUrl({ scsn, sessionId: session.sid });
      let hashcashToken: string | undefined;
      for (let attempt = 0; attempt <= 4; attempt++) {
        const headers: Record<string, string> = { accept: 'application/json' };
        if (hashcashToken) {
          headers['X-Hashcash'] = hashcashToken;
        }
        const response = await this.fetchImpl(url, {
          method: 'GET',
          headers,
          signal,
        });
        // Check X-Hashcash on any response — MEGA may challenge on 200 OK.
        const challenge = response.headers.get('X-Hashcash');
        if (challenge && attempt < 4) {
          hashcashToken = await solveMegaHashcashChallenge(challenge);
          continue;
        }
        if (response.statusText === 'Server Too Busy') {
          const error = new Error('MEGA API error -3.') as MegaApiError;
          error.code = -3;
          throw error;
        }
        if (!response.ok) {
          throw new Error(`MEGA action-packet request failed with HTTP ${response.status}.`);
        }
        const payload = await parseMegaJsonResponse(response, 'MEGA action-packet API');
        if (typeof payload === 'number') {
          const error = new Error(`MEGA API error ${payload}.`) as MegaApiError;
          error.code = payload;
          throw error;
        }
        return parseMegaActionPacketBatch(payload);
      }
      const error = new Error('MEGA API error -3.') as MegaApiError;
      error.code = -3;
      throw error;
    }, signal);
  }

  private async resolveIncomingShareDescriptor(
    account: ProviderAccount,
    descriptor: Record<string, unknown>,
    options: {
      readonly forceRefresh?: boolean;
    } = {}
  ): Promise<Record<string, unknown>> {
    const existingHandle = getStringDescriptor(descriptor, 'rootHandle') ?? getStringDescriptor(descriptor, 'shareHandle');
    if (existingHandle && options.forceRefresh !== true) {
      return descriptor;
    }

    const offers = await this.listIncomingSharesUncached(account, {
      bypassAccountSync: options.forceRefresh === true,
    });
    const match = offers.find((offer) => incomingShareMatches(offer.remoteDescriptor, descriptor));
    if (!match) {
      throw new Error('The requested MEGA incoming share is no longer available.');
    }
    return match.remoteDescriptor;
  }

  private async loadManifest(shareId: string): Promise<MegaMirrorManifest> {
    const cached = this.shareManifestCache.get(shareId);
    if (cached) {
      return cached;
    }
    const manifest = (await this.runtime.secretStore.get<MegaMirrorManifest>(mirrorManifestKey(shareId))) ?? { entries: {} };
    this.shareManifestCache.set(shareId, manifest);
    return manifest;
  }

  private async persistManifest(shareId: string, manifest: MegaMirrorManifest): Promise<void> {
    this.shareManifestCache.set(shareId, manifest);
    const serialized = JSON.stringify(manifest);
    if (serialized.length > MAX_PERSISTED_MEGA_MANIFEST_JSON_BYTES) {
      this.runtime.logger.warn('Skipping persisted MEGA mirror manifest because it is too large for durable secret storage.', {
        shareId,
        bytes: serialized.length,
        maxBytes: MAX_PERSISTED_MEGA_MANIFEST_JSON_BYTES,
      });
      return;
    }
    await this.runtime.secretStore.set(mirrorManifestKey(shareId), manifest);
  }

  private async seedPendingRecipientShareCursor(
    share: ManagedShare,
    account: ProviderAccount,
    signal?: AbortSignal
  ): Promise<void> {
    if (share.role !== 'recipient' || this.shareScsn.has(share.id)) {
      return;
    }
    try {
      const session = await this.getAccountSession(account, signal);
      const snapshot = await this.fetchNodesSnapshot(session, signal);
      const scsn = snapshot.scsn?.trim();
      if (!scsn) {
        return;
      }
      this.shareScsn.set(share.id, scsn);
      this.runtime.logger.log('Seeded MEGA recipient SC cursor while the incoming root key is pending.', {
        shareId: share.id,
        accountId: account.id,
        scsn,
      });
    } catch (error) {
      this.runtime.logger.warn('Failed to seed MEGA recipient SC cursor while the incoming root key is pending.', {
        shareId: share.id,
        accountId: account.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async updateManifestCursor(shareId: string, scsn: string): Promise<void> {
    const manifest = await this.loadManifest(shareId);
    await this.persistManifest(shareId, {
      ...manifest,
      lastScsn: scsn.trim(),
    } satisfies MegaMirrorManifest);
  }

  private async tryApplyRecipientActionPackets(
    share: ManagedShare,
    account: ProviderAccount,
    rootHandle: string,
    manifest: MegaMirrorManifest,
    actionBatch: MegaActionPacketBatch,
    baseProbeContext?: MegaRecipientProbeContext,
    activeSession?: MegaSession,
  ): Promise<boolean> {
    if (share.role !== 'recipient') {
      return false;
    }
    const handles = collectRecipientImmediatePacketHandles(actionBatch.packets, rootHandle);
    debugMegaLog('[MEGA:immediate-apply] candidate handles resolved.', {
      shareId: share.id,
      rootHandle,
      handles,
      actions: summarizeActionPacketActions(actionBatch.packets),
    });
    const hasDeletionPackets = actionBatch.packets.some(
      (packet) => (typeof packet.a === 'string' ? packet.a.trim() : '') === 'd'
    );
    if (handles.length === 0 && !hasDeletionPackets) {
      return false;
    }

    const applyUpdates = async (session: MegaSession) => {
      const nextEntries = { ...manifest.entries };
      const handlePathIndex = buildManifestHandlePathIndex(nextEntries);
      const shareKeys = this.accountShareKeyCache.get(session.userHandle) ?? new Map<string, Buffer>();
      let appliedCount = 0;

      const deletionResult = await this.applyRecipientDeletionPackets(
        share,
        rootHandle,
        actionBatch.packets,
        nextEntries,
        handlePathIndex,
      );
      appliedCount += deletionResult.deletedHandles.size;

      const directlyAppliedResult = await this.applyRecipientPacketNodes(
        share,
        session,
        rootHandle,
        actionBatch.packets,
        nextEntries,
        handlePathIndex,
        shareKeys,
        baseProbeContext,
      );
      appliedCount += directlyAppliedResult.appliedCount;
      let contentApplied = deletionResult.contentApplied || directlyAppliedResult.contentApplied;

      let pendingHandles = handles.filter((handle) => !deletionResult.deletedHandles.has(handle));
      while (pendingHandles.length > 0) {
        let progressedThisPass = false;
        const deferredHandles: string[] = [];
        for (const handle of pendingHandles) {
          if (handlePathIndex.has(handle)) {
            progressedThisPass = true;
            continue;
          }
          const applied = await this.applyRecipientHandleUpdate(
            share,
            session,
            rootHandle,
            handle,
            nextEntries,
            handlePathIndex,
            {
              source: baseProbeContext?.source ?? 'sync',
              rootHandle,
              triggerHandle: handle,
              packetReceivedAt: baseProbeContext?.packetReceivedAt ?? this.runtime.now(),
              scsn: baseProbeContext?.scsn ?? actionBatch.scsn?.trim(),
            }
          );
          if (!applied.applied) {
            deferredHandles.push(handle);
            continue;
          }
          appliedCount += 1;
          contentApplied ||= applied.contentApplied;
          progressedThisPass = true;
        }
        if (!progressedThisPass) {
          break;
        }
        pendingHandles = deferredHandles;
      }

      if (appliedCount === 0) {
        debugMegaLog('[MEGA:immediate-apply] no candidate handle could be applied.', {
          shareId: share.id,
          rootHandle,
          handles,
        });
        return false;
      }
      if (!contentApplied) {
        debugMegaLog('[MEGA:immediate-apply] only container updates were applied; falling back to full sync.', {
          shareId: share.id,
          rootHandle,
          handles,
        });
        return false;
      }

      const nextManifest: MegaMirrorManifest = {
        ...manifest,
        rootHandle,
        lastScsn: actionBatch.scsn?.trim() || manifest.lastScsn,
        knownHandles: collectManifestHandles(nextEntries, rootHandle),
        entries: nextEntries,
      };
      await this.persistManifest(share.id, nextManifest);
      this.shareRootHandles.set(share.id, rootHandle);
      this.shareKnownHandles.set(share.id, [...(nextManifest.knownHandles ?? [])]);
      if (nextManifest.lastScsn) {
        this.shareScsn.set(share.id, nextManifest.lastScsn);
      }
      this.syncStates.set(share.id, {
        status: 'ready',
        detail: `MEGA readonly mirror is up to date. Applied ${handles.length} immediate update${handles.length === 1 ? '' : 's'}.`,
        badges: READONLY_BADGES,
        lastSyncAt: this.runtime.now(),
      });
      return true;
    };

    const runApply = async (): Promise<boolean> => {
      try {
        if (activeSession) {
          try {
            return await applyUpdates(activeSession);
          } catch (error) {
            if (!isMegaSessionInvalid(error)) {
              throw error;
            }
          }
        }
        return await this.withRecoveredAccountSession(account, applyUpdates);
      } catch (error) {
        this.runtime.logger.warn('MEGA immediate readonly apply failed; falling back to mirror refresh.', {
          shareId: share.id,
          accountId: account.id,
          message: error instanceof Error ? error.message : String(error),
        });
        return false;
      }
    };

    if (this.syncTasks.has(share.id)) {
      return runApply();
    }
    return this.withExclusiveShareTask(share.id, runApply);
  }

  private async applyRecipientDeletionPackets(
    share: ManagedShare,
    rootHandle: string,
    packets: readonly Record<string, unknown>[],
    entries: Record<string, ProviderRefreshManifestEntry>,
    handlePathIndex: Map<string, string>,
  ): Promise<{ deletedHandles: Set<string>; contentApplied: boolean }> {
    const deletedHandles = collectRecipientDeletedPacketHandles(packets, rootHandle);
    if (deletedHandles.length === 0) {
      return { deletedHandles: new Set(), contentApplied: false };
    }

    const appliedHandles = new Set<string>();
    let contentApplied = false;
    for (const handle of deletedHandles) {
      const relativePath = handlePathIndex.get(handle);
      if (!relativePath) {
        continue;
      }
      const removedPaths = removeManifestEntriesUnderPath(relativePath, entries, handlePathIndex);
      if (removedPaths.length === 0) {
        continue;
      }
      await (await getMegaNodeFs()).rm(path.join(share.localPath, relativePath), { recursive: true, force: true }).catch(() => undefined);
      this.publishReactiveMirrorEvent(relativePath);
      appliedHandles.add(handle);
      if (!isRecipientMirrorContainerPath(relativePath)) {
        contentApplied = true;
      }
      debugMegaLog('[MEGA:immediate-apply] removed recipient path from delete action packet.', {
        shareId: share.id,
        rootHandle,
        handle,
        relativePath,
        removedPathCount: removedPaths.length,
      });
    }

    return { deletedHandles: appliedHandles, contentApplied };
  }

  private async applyRecipientHandleUpdate(
    share: ManagedShare,
    session: MegaSession,
    rootHandle: string,
    handle: string,
    entries: Record<string, ProviderRefreshManifestEntry>,
    handlePathIndex: Map<string, string>,
    probeContext: MegaRecipientProbeContext
  ): Promise<{ applied: boolean; contentApplied: boolean }> {
    let fetchStartedAt = this.runtime.now();
    let fetched;
    try {
      fetched = await this.fetchPartialTreeWithRetry(session, handle, undefined, {
        allowTransientFullFallback: true,
        fastPartialFallback: true,
        maxAttempts: 1,
      });
    } catch (error) {
      if (isMegaMissingRequestedRootError(error) || (error as MegaApiError | undefined)?.code === -9) {
        debugMegaLog('[MEGA:immediate-apply] skipped stale recipient handle after fetch miss.', {
          shareId: share.id,
          rootHandle,
          handle,
          message: error instanceof Error ? error.message : String(error),
        });
        return { applied: false, contentApplied: false };
      }
      throw error;
    }
    let fetchCompletedAt = this.runtime.now();
    if (fetched.tree.root.handle !== handle && !fetched.tree.nodesByHandle.has(handle)) {
      debugMegaLog('[MEGA:immediate-apply] fetched subtree still does not contain the requested handle.', {
        shareId: share.id,
        rootHandle,
        handle,
        fetchedRootHandle: fetched.tree.root.handle,
      });
      return { applied: false, contentApplied: false };
    }
    let baseRelativePath = resolveRecipientFetchedNodePath(
      fetched.tree.root,
      rootHandle,
      handlePathIndex,
      resolveMegaRecipientMirrorRootName(share)
    );
    // Immediate MEGA pushes can surface a new event file before the local recipient manifest has
    // learned the parent volume-folder handle. Refetch from that parent handle so canonical
    // channels/<volumeId>/<event>.bin paths still resolve without waiting for a later full sweep.
    if (
      (baseRelativePath === undefined || (!isMirrorRelativePath(baseRelativePath) && !isRecipientMirrorContainerPath(baseRelativePath))) &&
      fetched.tree.root.parentHandle &&
      fetched.tree.root.parentHandle !== rootHandle &&
      fetched.tree.root.parentHandle !== handle &&
      !handlePathIndex.has(fetched.tree.root.parentHandle)
    ) {
      fetchStartedAt = this.runtime.now();
      try {
        fetched = await this.fetchPartialTreeWithRetry(session, fetched.tree.root.parentHandle, undefined, {
          allowTransientFullFallback: true,
          fastPartialFallback: true,
          maxAttempts: 1,
        });
      } catch (error) {
        if (isMegaMissingRequestedRootError(error) || (error as MegaApiError | undefined)?.code === -9) {
          debugMegaLog('[MEGA:immediate-apply] skipped stale recipient parent-handle refetch after fetch miss.', {
            shareId: share.id,
            rootHandle,
            handle,
            parentHandle: fetched.tree.root.parentHandle,
            message: error instanceof Error ? error.message : String(error),
          });
          return { applied: false, contentApplied: false };
        }
        throw error;
      }
      fetchCompletedAt = this.runtime.now();
      baseRelativePath = resolveRecipientFetchedNodePath(
        fetched.tree.root,
        rootHandle,
        handlePathIndex,
        resolveMegaRecipientMirrorRootName(share)
      );
    }
    const isMirrorRoot = baseRelativePath === '';
    const isMirrorContainer = baseRelativePath !== undefined && isRecipientMirrorContainerPath(baseRelativePath);
    if (baseRelativePath === undefined || (!isMirrorRoot && !isMirrorRelativePath(baseRelativePath) && !isMirrorContainer)) {
      debugMegaLog('[MEGA:immediate-apply] fetched subtree could not be resolved to a mirror path.', {
        shareId: share.id,
        rootHandle,
        handle,
        fetchedRootHandle: fetched.tree.root.handle,
        fetchedRootName: fetched.tree.root.name,
        fetchedRootParentHandle: fetched.tree.root.parentHandle,
        baseRelativePath,
        knownParentPath: fetched.tree.root.parentHandle ? handlePathIndex.get(fetched.tree.root.parentHandle) : undefined,
        knownHandlePath: handlePathIndex.get(fetched.tree.root.handle),
      });
      return { applied: false, contentApplied: false };
    }

    const resolvedProbeContext: MegaRecipientProbeContext = {
      ...probeContext,
      fetchStartedAt,
      fetchCompletedAt,
    };
    let contentApplied = false;

    if (!isMirrorContainer && !isMirrorRoot) {
      contentApplied = await this.applyRecipientFetchedNode(
        share,
        session,
        fetched.tree.root,
        baseRelativePath,
        entries,
        handlePathIndex,
        resolvedProbeContext
      );
    }
    await visitTree(fetched.tree, async (relativePath, node) => {
      const fullRelativePath = normalizeRelativePath(path.join(baseRelativePath, relativePath));
      if (!isMirrorRelativePath(fullRelativePath)) {
        return;
      }
      contentApplied = (await this.applyRecipientFetchedNode(
        share,
        session,
        node,
        fullRelativePath,
        entries,
        handlePathIndex,
        resolvedProbeContext
      )) || contentApplied;
    });
    return { applied: true, contentApplied };
  }

  private async applyRecipientPacketNodes(
    share: ManagedShare,
    session: MegaSession,
    rootHandle: string,
    packets: readonly Record<string, unknown>[],
    entries: Record<string, ProviderRefreshManifestEntry>,
    handlePathIndex: Map<string, string>,
    shareKeys: ReadonlyMap<string, Buffer>,
    baseProbeContext?: MegaRecipientProbeContext,
  ): Promise<{ appliedCount: number; contentApplied: boolean }> {
    const packetNodes = collectRecipientImmediatePacketNodes(packets);
    if (packetNodes.length === 0) {
      return { appliedCount: 0, contentApplied: false };
    }

    const usersByHandle = buildMegaUsersByHandleFromActionPackets(packets);
    const packetNodesByHandle = new Map<string, DecryptedMegaNode>();
    for (const node of packetNodes) {
      const decrypted = decryptNodeRecord(node, session, shareKeys, usersByHandle);
      if (!decrypted) {
        continue;
      }
      packetNodesByHandle.set(decrypted.handle, decrypted);
    }
    if (packetNodesByHandle.size === 0) {
      return { appliedCount: 0, contentApplied: false };
    }

    const resolvedNodes = [...packetNodesByHandle.values()]
      .map((node) => ({
        node,
        relativePath: resolveRecipientPacketNodePath(node, rootHandle, handlePathIndex, packetNodesByHandle),
      }))
      .filter((entry): entry is { node: DecryptedMegaNode; relativePath: string } => Boolean(entry.relativePath))
      .filter((entry) => isMirrorRelativePath(entry.relativePath) || isMirrorContainerPath(entry.relativePath));

    resolvedNodes.sort((left, right) => {
      const leftDepth = left.relativePath.split('/').length;
      const rightDepth = right.relativePath.split('/').length;
      if (leftDepth !== rightDepth) {
        return leftDepth - rightDepth;
      }
      if (left.node.isFolder !== right.node.isFolder) {
        return left.node.isFolder ? -1 : 1;
      }
      return left.relativePath.localeCompare(right.relativePath);
    });

    let appliedCount = 0;
    let contentApplied = false;
    for (const { node, relativePath } of resolvedNodes) {
      const probeContext: MegaRecipientProbeContext = {
        ...baseProbeContext,
        source: baseProbeContext?.source ?? 'sync',
        rootHandle,
        triggerHandle: node.handle,
        packetReceivedAt: baseProbeContext?.packetReceivedAt ?? this.runtime.now(),
        scsn: baseProbeContext?.scsn,
        fetchStartedAt: baseProbeContext?.packetReceivedAt ?? this.runtime.now(),
        fetchCompletedAt: baseProbeContext?.packetReceivedAt ?? this.runtime.now(),
      };
      contentApplied = (await this.applyRecipientFetchedNode(
        share,
        session,
        node,
        relativePath,
        entries,
        handlePathIndex,
        probeContext
      )) || contentApplied;
      appliedCount += 1;
    }

    return { appliedCount, contentApplied };
  }

  private async applyRecipientFetchedNode(
    share: ManagedShare,
    session: MegaSession,
    node: DecryptedMegaNode,
    relativePath: string,
    entries: Record<string, ProviderRefreshManifestEntry>,
    handlePathIndex: Map<string, string>,
    probeContext: MegaRecipientProbeContext
  ): Promise<boolean> {
    if (!shouldApplyRecipientMirrorPath(share, relativePath)) {
      return false;
    }
    const existingPath = handlePathIndex.get(node.handle);
    if (existingPath && existingPath !== relativePath) {
      delete entries[existingPath];
      handlePathIndex.delete(node.handle);
      await (await getMegaNodeFs()).rm(path.join(share.localPath, existingPath), { recursive: true, force: true }).catch(() => undefined);
    }

    const targetPath = path.join(share.localPath, relativePath);
    if (node.isFolder) {
      await (await getMegaNodeFs()).mkdir(targetPath, { recursive: true });
      entries[relativePath] = createProviderRefreshManifestEntry(node);
      handlePathIndex.set(node.handle, relativePath);
      return false;
    }

    const nextEntry = createProviderRefreshManifestEntry(node);
    const existingEntry = entries[relativePath];
    if (existingEntry?.kind === 'file' && existingEntry.fingerprint === nextEntry.fingerprint) {
      const localFileExists = await (await getMegaNodeFs()).access(targetPath).then(() => true).catch(() => false);
      if (localFileExists) {
        entries[relativePath] = nextEntry;
        handlePathIndex.set(node.handle, relativePath);
        return true;
      }
    }

    const receiveProbe = this.createManagedShareReceiveProbe(share.id, relativePath, node, probeContext);
    const remoteBytes = await downloadAuthenticatedMegaFileContent(
      this.fetchImpl,
      this.apiClient,
      session,
      node.handle,
      node.nodeKey,
      node.size
    );
    this.updateManagedShareReceiveProbe(share.id, receiveProbe.id, {
      downloadCompletedAt: this.runtime.now(),
    });
    const remoteValidation = await validateCanonicalStorageFile(relativePath, remoteBytes);
    if (!remoteValidation.ok) {
      this.updateManagedShareReceiveProbe(share.id, receiveProbe.id, {
        status: 'error',
        validationCompletedAt: this.runtime.now(),
        lastError: remoteValidation.detail ?? `Invalid MEGA canonical file for ${relativePath}`,
      });
      throw new Error(remoteValidation.detail ?? `Invalid MEGA canonical file for ${relativePath}`);
    }
    this.updateManagedShareReceiveProbe(share.id, receiveProbe.id, {
      validationCompletedAt: this.runtime.now(),
      localWriteStartedAt: this.runtime.now(),
    });
    await (await getMegaNodeFs()).mkdir(path.dirname(targetPath), { recursive: true });
    await (await getMegaNodeFs()).writeFile(targetPath, remoteBytes);
    const localWriteCompletedAt = this.runtime.now();
    await (await getMegaNodeFs()).access(targetPath);
    const localVisibleAt = this.runtime.now();
    this.publishReactiveMirrorEvent(relativePath);
    this.updateManagedShareReceiveProbe(share.id, receiveProbe.id, {
      localWriteCompletedAt,
      localVisibleAt,
      applyCompletedAt: localVisibleAt,
      totalApplyMs: Math.max(0, localVisibleAt - receiveProbe.applyStartedAt),
      packetToLocalVisibleMs: Math.max(0, localVisibleAt - receiveProbe.packetReceivedAt),
      status: 'applied',
    });
    entries[relativePath] = nextEntry;
    handlePathIndex.set(node.handle, relativePath);
    return true;
  }

  private publishReactiveMirrorEvent(relativePath: string): void {
    if (!relativePath.startsWith('channels/')) {
      return;
    }
    const match = /^channels\/([^/]+)\/([^/]+)\.bin$/u.exec(relativePath);
    if (!match) {
      return;
    }
    const [, volumeId, eventHash] = match;
    this.runtime.volumeEvents?.publish({
      volumeId,
      producer: 'mega',
      kind: 'timeline-advanced',
      paths: [relativePath],
      eventHashes: [eventHash],
      nextCursor: eventHash,
      invalidate: {
        files: true,
        timeline: true,
        chat: true,
      },
    });
  }

  private createManagedShareReceiveProbe(
    shareId: string,
    relativePath: string,
    node: DecryptedMegaNode,
    context: MegaRecipientProbeContext
  ): ManagedShareReceiveProbe {
    const now = this.runtime.now();
    const probe: ManagedShareReceiveProbe = {
      id: `mega-receive-probe-${++this.receiveProbeSequence}`,
      shareId,
      path: relativePath,
      trigger: context.source,
      triggerHandle: context.triggerHandle,
      rootHandle: context.rootHandle,
      packetReceivedAt: context.packetReceivedAt,
      applyStartedAt: now,
      remoteHandle: node.handle,
      scsn: context.scsn,
      fetchStartedAt: context.fetchStartedAt ?? now,
      fetchCompletedAt: context.fetchCompletedAt ?? now,
      downloadStartedAt: now,
      status: 'pending',
    };
    this.rememberManagedShareReceiveProbe(probe);
    debugMegaLog('[MEGA:probe] queued recipient apply probe.', {
      shareId,
      path: relativePath,
      trigger: context.source,
      triggerHandle: context.triggerHandle,
      packetReceivedAt: context.packetReceivedAt,
      remoteHandle: node.handle,
    });
    return probe;
  }

  private rememberManagedShareReceiveProbe(probe: ManagedShareReceiveProbe): void {
    const existing = this.receiveProbeHistory.get(probe.shareId) ?? [];
    this.receiveProbeHistory.set(probe.shareId, [probe, ...existing].slice(0, MEGA_UPLOAD_PROBE_HISTORY_LIMIT));
  }

  private updateManagedShareReceiveProbe(
    shareId: string,
    probeId: string,
    patch: Partial<ManagedShareReceiveProbe>
  ): ManagedShareReceiveProbe | null {
    const existing = this.receiveProbeHistory.get(shareId);
    if (!existing) {
      return null;
    }
    let updated: ManagedShareReceiveProbe | null = null;
    const next = existing.map((probe) => {
      if (probe.id !== probeId) {
        return probe;
      }
      updated = {
        ...probe,
        ...patch,
      };
      return updated;
    });
    this.receiveProbeHistory.set(shareId, next);
    return updated;
  }

  private async logPendingRecipientRootDiagnostics(
    share: ManagedShare,
    account: ProviderAccount,
    signal?: AbortSignal
  ): Promise<void> {
    if (share.role !== 'recipient') {
      return;
    }
    const lastLoggedAt = this.pendingRootDiagnosticAt.get(share.id) ?? 0;
    if (Date.now() - lastLoggedAt < MEGA_PENDING_ROOT_DIAGNOSTIC_MIN_INTERVAL_MS) {
      return;
    }
    this.pendingRootDiagnosticAt.set(share.id, Date.now());

    const rootHandle =
      getStringDescriptor(share.remoteDescriptor, 'rootHandle') ?? getStringDescriptor(share.remoteDescriptor, 'shareHandle');
    if (!rootHandle) {
      return;
    }

    try {
      const session = await this.getAccountSession(account, signal);
      const snapshot = await this.fetchNodesSnapshot(session, signal);
      const keyManager = await this.fetchKeyManagerState(session, signal, { includePendingInShareKeys: true });
      const shareKeys = collectMegaShareKeys(snapshot, session, keyManager.shareKeys);
      const node = snapshot.nodes.find((entry) => typeof entry.h === 'string' && entry.h.trim() === rootHandle);
      const nodeMeta = (node as Record<string, unknown> | undefined) ?? {};
      const nodeKeyOwners = listMegaNodeKeyOwners(typeof nodeMeta.k === 'string' ? nodeMeta.k : undefined);
      const matchingShareRows = [...snapshot.outgoingShares, ...snapshot.pendingShares].filter((record) =>
        megaOutgoingShareRecordNodeHandles(record).includes(rootHandle)
      );

      this.runtime.logger.log('MEGA pending recipient root diagnostics.', {
        shareId: share.id,
        accountId: account.id,
        rootHandle,
        snapshotScsn: snapshot.scsn?.trim(),
        nodePresent: Boolean(node),
        nodeParentHandle: typeof nodeMeta.p === 'string' ? nodeMeta.p.trim() || undefined : undefined,
        nodeOwnerHandle: typeof nodeMeta.su === 'string' ? nodeMeta.su.trim() || undefined : undefined,
        hasSk: typeof nodeMeta.sk === 'string' && nodeMeta.sk.trim() !== '',
        nodeKeyOwners,
        shareKeysAvailable: shareKeys.size,
        hasShareKeyForRootHandle: shareKeys.has(rootHandle),
        matchingNodeKeyOwners: nodeKeyOwners.filter((owner) => shareKeys.has(owner)),
        pendingInShareCount: keyManager.pendingInShares.size,
        pendingInShareHasRootHandle: keyManager.pendingInShares.has(rootHandle),
        matchingShareRowCount: matchingShareRows.length,
        shareRowTargets: matchingShareRows.map((record) => ({
          u: typeof record.u === 'string' ? record.u.trim() || undefined : undefined,
          p: typeof record.p === 'string' ? record.p.trim() || undefined : undefined,
          n: typeof record.n === 'string' ? record.n.trim() || undefined : undefined,
        })),
      });
    } catch (diagnosticError) {
      this.runtime.logger.warn('MEGA pending recipient root diagnostics failed.', {
        shareId: share.id,
        accountId: account.id,
        rootHandle,
        message: diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError),
      });
    }
  }

  private async apiCommand<T = Record<string, unknown>>(
    command: Record<string, unknown>,
    session?: MegaSession,
    signal?: AbortSignal
  ): Promise<T> {
    return withMegaApiRetry(async () => {
      const response = await this.apiClient.requestSingle<T | number>(command, {
        sessionId: session?.sid,
        signal,
      });
      if (typeof response === 'number') {
        if (response === 0) {
          return response as T;
        }
        const error = new Error(`MEGA API error ${response}.`) as MegaApiError;
        error.code = response;
        throw error;
      }
      return response;
    }, signal);
  }

  private usesPublicLinkMirror(share: ManagedShare): boolean {
    return resolveMegaPublicLinkTarget(share.remoteDescriptor) !== null;
  }

  private async ensureOwnerRemoteRoot(
    session: MegaSession,
    remotePath: string,
    signal?: AbortSignal
  ): Promise<MegaOwnerRemoteRoot> {
    const normalizedPath = normalizeMegaRemoteDisplayPath(remotePath);
    const segments = normalizedPath.split('/').filter((segment) => segment.length > 0);
    let cloudHandle = this.accountCloudDriveHandleCache.get(session.userHandle);
    if (!cloudHandle) {
      const snapshot = await this.fetchNodesSnapshot(session, signal);
      cloudHandle = resolveMegaCloudDriveHandle(snapshot);
      if (cloudHandle) {
        this.accountCloudDriveHandleCache.set(session.userHandle, cloudHandle);
      }
    }
    if (!cloudHandle) {
      throw new Error('MEGA snapshot did not include a Cloud Drive root.');
    }

    let currentHandle = cloudHandle;

    for (const segment of segments) {
      const fetched = await this.fetchPartialTreeWithRetry(session, currentHandle, signal, {
        allowTransientFullFallback: true,
      });
      const existing = findChildNodeByName(fetched.tree, currentHandle, segment, true);
      if (existing) {
        currentHandle = existing.handle;
        continue;
      }
      const created = await this.ensureOwnerRemoteFolder(session, currentHandle, segment, signal);
      currentHandle = created.node.handle;
      continue;
    }

    const fetched = await this.fetchPartialTreeWithRetry(session, currentHandle, signal, {
      allowTransientFullFallback: true,
    });

    return {
      path: normalizedPath,
      root: fetched.tree.root,
      tree: fetched.tree,
      scsn: fetched.snapshot.scsn?.trim(),
    };
  }

  private async resolveOwnerRemoteRootForShare(
    share: ManagedShare,
    session: MegaSession,
    remotePath: string,
    signal?: AbortSignal
  ): Promise<MegaOwnerRemoteRoot> {
    const normalizedPath = normalizeMegaRemoteDisplayPath(remotePath);
    const expectedRootName = path.posix.basename(normalizedPath);
    const preferredRootHandle = await this.resolvePreferredOwnerRootHandle(session, normalizedPath, signal);
    const cachedRootHandle = this.shareRootHandles.get(share.id)?.trim();
    const candidateRootHandles = [preferredRootHandle, cachedRootHandle].filter(
      (value): value is string => typeof value === 'string' && value.trim().length > 0
    );
    for (const candidateRootHandle of uniqueTrimmedStrings(candidateRootHandles)) {
      try {
        const fetched = await this.fetchPartialTreeWithRetry(session, candidateRootHandle, signal, {
          allowTransientFullFallback: true,
          expectedRootName,
        });
        return {
          path: normalizedPath,
          root: fetched.tree.root,
          tree: fetched.tree,
          scsn: fetched.snapshot.scsn?.trim(),
        };
      } catch (error) {
        this.runtime.logger.warn('MEGA invite: cached owner root handle lookup failed; falling back to path resolution.', {
          shareId: share.id,
          accountEmail: session.email,
          cachedRootHandle: candidateRootHandle,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return this.ensureOwnerRemoteRoot(session, remotePath, signal);
  }

  private async resolvePreferredOwnerRootHandle(
    session: MegaSession,
    remotePath: string,
    signal?: AbortSignal
  ): Promise<string | undefined> {
    const normalizedPath = normalizeMegaRemoteDisplayPath(remotePath);
    const segments = normalizedPath.split('/').filter((segment) => segment.length > 0);
    if (segments.length === 0) {
      return undefined;
    }

    const snapshot = await this.fetchNodesSnapshot(session, signal);
    const outgoingRootHandles = new Set<string>();
    for (const record of [...snapshot.outgoingShares, ...snapshot.pendingShares]) {
      for (const handle of megaOutgoingShareRecordNodeHandles(record)) {
        outgoingRootHandles.add(handle);
      }
    }
    if (outgoingRootHandles.size === 0) {
      return undefined;
    }

    const tree = decryptMegaTree(snapshot, session, {}, this.accountShareKeyCache.get(session.userHandle), this.runtime.logger);
    let parentHandle = tree.root.handle;
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index]!;
      const candidates = findChildNodesByName(tree, parentHandle, segment, index < segments.length - 1);
      if (candidates.length === 0) {
        return undefined;
      }
      const matchingSharedCandidates = candidates.filter((candidate) => outgoingRootHandles.has(candidate.handle));
      const selected = (matchingSharedCandidates.length > 0 ? matchingSharedCandidates : candidates)[0]!;
      parentHandle = selected.handle;
    }
    return parentHandle;
  }

  private async ensureOwnerRemoteFolder(
    session: MegaSession,
    parentHandle: string,
    name: string,
    signal?: AbortSignal
  ): Promise<{
    fetched: MegaFetchedTree;
    node: DecryptedMegaNode;
  }> {
    for (let attempt = 0; attempt < MEGA_CREATE_RECOVERY_ATTEMPTS; attempt += 1) {
      const fetched = await this.fetchPartialTreeWithRetry(session, parentHandle, signal, {
        allowTransientFullFallback: true,
      });
      const created = findChildNodeByName(fetched.tree, parentHandle, name, true);
      if (created) {
        return {
          fetched,
          node: created,
        };
      }

      try {
        await this.createRemoteFolderNode(session, parentHandle, name, signal);
        return this.waitForOwnerRemoteFolder(session, parentHandle, name, signal);
      } catch (error) {
        const recovered = await this.findOwnerRemoteFolder(session, parentHandle, name, signal);
        if (recovered) {
          return recovered;
        }
        if (
          !isMegaRetryableApiError(error) &&
          !isMegaRetryableTransportError(error) &&
          !isMegaEventuallyConsistentMutationError(error)
        ) {
          throw error;
        }
        if (attempt >= MEGA_CREATE_RECOVERY_ATTEMPTS - 1) {
          throw error;
        }
        await waitForMegaRetry(getMegaRetryDelayMs(error, attempt), signal);
      }
    }
    throw new Error(`MEGA did not create ${name}.`);
  }

  private async findOwnerRemoteFolder(
    session: MegaSession,
    parentHandle: string,
    name: string,
    signal?: AbortSignal
  ): Promise<{
    fetched: MegaFetchedTree;
    node: DecryptedMegaNode;
  } | null> {
    const fetched = await this.fetchPartialTreeWithRetry(session, parentHandle, signal, {
      allowTransientFullFallback: true,
    });
    const node = findChildNodeByName(fetched.tree, parentHandle, name, true);
    if (!node) {
      return null;
    }
    return { fetched, node };
  }

  private async waitForOwnerRemoteFolder(
    session: MegaSession,
    parentHandle: string,
    name: string,
    signal?: AbortSignal
  ): Promise<{
    fetched: MegaFetchedTree;
    node: DecryptedMegaNode;
  }> {
    for (let attempt = 0; attempt < MEGA_NODE_APPEAR_ATTEMPTS; attempt += 1) {
      const recovered = await this.findOwnerRemoteFolder(session, parentHandle, name, signal);
      if (recovered) {
        return recovered;
      }
      if (attempt < MEGA_NODE_APPEAR_DELAYS_MS.length) {
        await waitForMegaRetry(MEGA_NODE_APPEAR_DELAYS_MS[attempt]!, signal);
      }
    }
    throw new Error(`MEGA did not create ${name}.`);
  }

  private async createRemoteFolderNode(
    session: MegaSession,
    parentHandle: string,
    name: string,
    signal?: AbortSignal
  ): Promise<void> {
    touchMegaSyncActivity(signal);
    const nodeKey = randomBytes(16);
    const encryptedNodeKey = encryptMegaNodeKeyForOwner(nodeKey, session.masterKey);
    const response = await this.apiClient.requestSingle<Record<string, unknown> | number>(
      {
        a: 'p',
        t: parentHandle,
        i: createMegaMutationRequestId(),
        n: [
          {
            h: MEGA_PUT_NODES_PLACEHOLDER_HANDLE,
            t: 1,
            a: encryptMegaAttributes(name, nodeKey),
            k: encodeMegaBase64Url(encryptedNodeKey),
          },
        ],
      },
      { sessionId: session.sid, signal }
    );
    if (typeof response === 'number') {
      const error = new Error(`MEGA API error ${response}.`) as MegaApiError;
      error.code = response;
      throw error;
    }
  }

  private async resolveOwnerShareCryptoContext(
    session: MegaSession,
    root: MegaOwnerRemoteRoot,
    signal?: AbortSignal
  ): Promise<MegaShareCryptoContext | undefined> {
    const shareHandle = root.root.handle.trim();
    const explicitShareHandle = root.root.shareHandle?.trim();
    const shareHandleCandidates = [...new Set([shareHandle, explicitShareHandle].filter((value): value is string => Boolean(value)))];
    if (shareHandleCandidates.length === 0) {
      return undefined;
    }

    const cachedShareKeys = this.accountShareKeyCache.get(session.userHandle);
    if (cachedShareKeys) {
      for (const handle of shareHandleCandidates) {
        const shareKey = cachedShareKeys.get(handle);
        if (shareKey) {
          return { shareHandle: handle, shareKey: Buffer.from(shareKey) };
        }
      }
    }

    const persistedShareKeys = await this.loadPersistedShareKeysForSession(session, { forceReload: true });
    if (persistedShareKeys) {
      for (const handle of shareHandleCandidates) {
        const shareKey = persistedShareKeys.get(handle);
        if (shareKey) {
          return { shareHandle: handle, shareKey: Buffer.from(shareKey) };
        }
      }
    }

    const keyManager = await this.fetchKeyManagerState(session, signal);
    for (const handle of shareHandleCandidates) {
      const shareKey = keyManager.shareKeys.get(handle);
      if (shareKey) {
        return { shareHandle: handle, shareKey: Buffer.from(shareKey) };
      }
    }

    // Fallback: look for the share key in the snapshot (outgoing shares `ok` field,
    // or the `sk` field on the root node itself).
    const snapshot = await this.fetchNodesSnapshot(session, signal);
    const snapshotShareKeys = collectMegaShareKeys(snapshot, session);
    for (const handle of shareHandleCandidates) {
      const fallbackKey = snapshotShareKeys.get(handle);
      if (fallbackKey) {
        await this.rememberShareKeys(session, new Map([[shareHandle, Buffer.from(fallbackKey)], [handle, Buffer.from(fallbackKey)]]));
        this.runtime.logger.log('MEGA share crypto context resolved via snapshot fallback (key-manager miss).', {
          shareHandle,
          matchedHandle: handle,
          email: session.email,
        });
        return { shareHandle, shareKey: Buffer.from(fallbackKey) };
      }
    }

    this.runtime.logger.warn('MEGA share crypto context could not be resolved — share key not found in key-manager or snapshot.', {
      shareHandle,
      shareHandleCandidates,
      email: session.email,
      keyManagerShareCount: keyManager.shareKeys.size,
      snapshotShareKeyCount: snapshotShareKeys.size,
    });
    return undefined;
  }

  private async getOwnerUploadState(
    share: ManagedShare,
    session: MegaSession,
    signal?: AbortSignal
  ): Promise<MegaOwnerUploadState> {
    const cached = this.ownerUploadStates.get(share.id);
    if (cached) {
      return cached;
    }

    const remotePath = getMegaShareRemotePath(share, this.runtime.mega.remoteBasePath);
    const root = await this.resolveOwnerRemoteRootForShare(share, session, remotePath, signal);
    this.shareRootHandles.set(share.id, root.root.handle);
    const shareCrypto = await this.resolveOwnerShareCryptoContext(session, root, signal);
    const ownerUploadState = buildMegaOwnerUploadState(root, shareCrypto);
    this.ownerUploadStates.set(share.id, ownerUploadState);
    return ownerUploadState;
  }

  /**
   * Re-key an owner share whose share key was lost or stored as all-zeros.
   * Issues a new `s2` command with a fresh share key and rebuilds `cr` records
   * for every node already in the tree, making them decryptable by collaborators.
   */
  private async repairOwnerShareKey(
    session: MegaSession,
    root: MegaOwnerRemoteRoot,
    signal?: AbortSignal
  ): Promise<MegaShareCryptoContext | undefined> {
    const shareHandle = root.root.handle.trim();
    if (!shareHandle) {
      return undefined;
    }

    const newShareKey = randomBytes(16);
    const handleBytes = decodeMegaBase64Url(shareHandle);
    const paddedHandle = Buffer.alloc(16, 0);
    handleBytes.copy(paddedHandle, 0, 0, Math.min(handleBytes.length, 16));

    const cr = buildMegaShareNodeKeyRecords(root, newShareKey);
    const command: Record<string, unknown> = {
      a: 's2',
      n: shareHandle,
      ok: encodeMegaBase64Url(encryptAesEcb(newShareKey, session.masterKey)),
      ha: encodeMegaBase64Url(encryptAesEcb(paddedHandle, newShareKey)),
      s: [],
      cr,
    };
    touchMegaSyncActivity(signal);
    await this.apiClient.requestSingle(command, { sessionId: session.sid, signal });
    await this.rememberOwnerShareKey(session, root, newShareKey);
    this.runtime.logger.log('MEGA owner share key repaired — new share key set and cr records rebuilt.', {
      shareHandle,
      email: session.email,
      nodeCount: root.tree.nodesByHandle.size,
    });
    return { shareHandle, shareKey: newShareKey };
  }
}

