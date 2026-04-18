import { Buffer } from 'buffer';
import { cbc as nobleAesCbc, ctr as nobleAesCtr, ecb as nobleAesEcb, gcm as nobleAesGcm } from '@noble/ciphers/aes.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import {
  buildMegaScChannelUrl,
  buildMegaFetchNodesCommand,
  decodeMegaBase64Url,
  encodeMegaBase64Url,
  MegaApiClient,
  parseMegaActionPacketBatch,
  parseMegaFetchNodesSnapshot,
  parseMegaJsonResponse,
  solveMegaHashcashChallenge,
  type MegaActionPacketBatch,
  type MegaFetchNodesSnapshot,
  type MegaNodeRecord,
  type MegaUserRecord,
} from './megaProtocol.js';
import {
  mirrorMegaPublicLink,
  normalizeMegaPublicLinkDescriptor,
  resolveMegaPublicLinkTarget,
} from './megaPublicLink.js';
import { managedSharePath as path } from './managedSharePath.js';
import { validateCanonicalStorageFile } from '../storage/integrity.js';
import { MirrorWorker } from './mirrorWorker.js';
import type {
  ManagedShareMirrorEntry,
  ManagedShareReceiveProbe,
  ManagedShareRemoteEntryProbe,
  ManagedShareUploadProbe,
  MirrorRemoteEntry,
  ProviderShareInventoryDebugEntry,
} from './adapters.js';
import {
  ProviderRefreshWorker,
  type ProviderRefreshManifestEntry,
  type ProviderRefreshRemoteAdapter,
  type ProviderRefreshRemoteEntry,
} from './providerRefreshWorker.js';
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
} from './types.js';
import type { IntegrationRuntime } from './runtime.js';
import {
  defaultRuntimeScheduler,
  waitForScheduledDelay,
  type RuntimeScheduler,
  type RuntimeTimerHandle,
} from '../runtime/scheduler.js';

const MEGA_SECRET_PREFIX = 'provider-account:mega:';
const MEGA_MANIFEST_PREFIX = 'provider-share:mega:manifest:';
const MEGA_RECONNECT_REQUIRED_MESSAGE =
  'Nearbytes could not refresh the saved MEGA sign-in. It will keep retrying automatically. If MEGA asked you to unlock the account or change the password first, finish that on mega.io. Update the saved sign-in in Nearbytes only if the stored credentials no longer work.';
const ZERO_IV = Buffer.alloc(16, 0);
const READONLY_BADGES = ['Readonly'];
const MEGA_SYNC_TIMEOUT_CODE = 'MEGA_SYNC_TIMEOUT';
const MEGA_RETRYABLE_API_ERROR_CODES = new Set([-3, -4]);
const MEGA_LOCK_RETRY_DELAYS_MS = [500, 1_000, 2_000, 4_000, 8_000] as const;
const MEGA_RATE_LIMIT_RETRY_DELAYS_MS = [1_500, 3_000, 5_000, 8_000, 12_000, 18_000] as const;
const MEGA_TRANSIENT_RETRY_DELAYS_MS = [500, 1_000, 2_000, 4_000, 8_000] as const;
const MEGA_TRANSIENT_SYNC_COOLDOWN_MS = 30_000;
const MEGA_POST_UPLOAD_SETTLE_MS = 30_000;
const MEGA_LOCAL_WATCH_DEBOUNCE_MS = 75;
const MEGA_SC_LISTEN_TIMEOUT_MS = 90_000;
const MEGA_DEV_INVENTORY_REFRESH_MIN_INTERVAL_MS = 60_000;
const MEGA_PENDING_ROOT_DIAGNOSTIC_MIN_INTERVAL_MS = 60_000;
const MEGA_OWNER_SHARE_KEY_HEAL_INTERVAL_MS = 15 * 60_000;
const MEGA_OWNER_SHARE_KEY_HEAL_RETRY_MS = 20_000;
const MEGA_OWNER_COLLABORATOR_CACHE_MS = 30_000;
const MEGA_INCOMING_DISCOVERY_CACHE_MS = 5_000;
const MEGA_CONTACT_INVITES_CACHE_MS = 5_000;
const MEGA_SESSION_VALIDATION_CACHE_MS = 15_000;
const MEGA_CREATE_RECOVERY_ATTEMPTS = 7;
const MEGA_UPLOAD_RECOVERY_ATTEMPTS = 7;
const MEGA_NODE_APPEAR_ATTEMPTS = 7;
const MEGA_NODE_APPEAR_DELAYS_MS = [250, 500, 1_000, 1_500, 2_500, 4_000] as const;
const MEGA_UPLOAD_PROBE_TIMEOUT_MS = 15_000;
const MEGA_UPLOAD_PROBE_DELAYS_MS = [0, 100, 150, 250, 500, 1_000, 1_500, 2_000, 3_000, 4_000] as const;
const MEGA_UPLOAD_PROBE_HISTORY_LIMIT = 50;
const MEGA_LOCAL_WRITE_SUPPRESSION_MS = 5_000;
const EXPECTED_MEGA_TOP_LEVEL_NAMES = new Set(['blocks', 'channels', 'Nearbytes.html']);
const MEGA_PUT_NODES_PLACEHOLDER_HANDLE = 'xxxxxxxx';
const MEGA_SHARE_ACCESS_LEVEL_READ_ONLY = 0;
const MEGA_SHARE_ACCESS_LEVEL_READ_WRITE = 1;
const MEGA_SHARE_ACCESS_LEVEL_FULL = 2;
/** Placeholder `u` for share targets who are not yet contacts (see MegaClient::EXPORTEDLINK in meganz/sdk). */
const MEGA_SHARE_INVITE_NON_CONTACT_USER = 'EXP';
const MEGA_KEY_MANAGER_VERSION_TAG = 1;
const MEGA_KEY_MANAGER_CREATION_TIME_TAG = 2;
const MEGA_KEY_MANAGER_IDENTITY_TAG = 3;
const MEGA_KEY_MANAGER_GENERATION_TAG = 4;
const MEGA_KEY_MANAGER_ATTR_TAG = 5;
const MEGA_KEY_MANAGER_PRIVATE_ED25519_TAG = 16;
const MEGA_KEY_MANAGER_PRIVATE_CU25519_TAG = 17;
const MEGA_KEY_MANAGER_PRIVATE_RSA_TAG = 18;
const MEGA_KEY_MANAGER_AUTH_RING_ED25519_TAG = 32;
const MEGA_KEY_MANAGER_AUTH_RING_CU25519_TAG = 33;
const MEGA_KEY_MANAGER_SHARE_KEYS_TAG = 48;
const MEGA_KEY_MANAGER_PENDING_OUTSHARES_TAG = 64;
const MEGA_KEY_MANAGER_PENDING_INSHARES_TAG = 65;
const MEGA_KEY_MANAGER_BACKUPS_TAG = 80;
const MEGA_KEY_MANAGER_WARNINGS_TAG = 96;
const MEGA_PRIVATE_ATTRIBUTE_KEYRING = '*keyring';
const MEGA_PRIVATE_ATTRIBUTE_AUTH_RING_ED25519 = '*!authring';
const MEGA_PRIVATE_ATTRIBUTE_AUTH_RING_CU25519 = '*!authCu255';
const MEGA_PRIVATE_ATTRIBUTE_ENCRYPTION_PARAMETERS: Record<
  number,
  { readonly nonceSize: number; readonly authTagSize: number; readonly algorithm: 'aes-128-ccm' | 'aes-128-gcm' }
> = {
  0x00: { nonceSize: 12, authTagSize: 16, algorithm: 'aes-128-ccm' },
  0x01: { nonceSize: 10, authTagSize: 16, algorithm: 'aes-128-ccm' },
  0x02: { nonceSize: 10, authTagSize: 8, algorithm: 'aes-128-ccm' },
  0x03: { nonceSize: 12, authTagSize: 16, algorithm: 'aes-128-ccm' },
  0x04: { nonceSize: 10, authTagSize: 8, algorithm: 'aes-128-ccm' },
  0x10: { nonceSize: 12, authTagSize: 16, algorithm: 'aes-128-gcm' },
  0x11: { nonceSize: 10, authTagSize: 8, algorithm: 'aes-128-gcm' },
};
const MEGA_RECOVERY_KEY_MANAGER_TAGS = new Set<number>([
  MEGA_KEY_MANAGER_VERSION_TAG,
  MEGA_KEY_MANAGER_CREATION_TIME_TAG,
  MEGA_KEY_MANAGER_IDENTITY_TAG,
  MEGA_KEY_MANAGER_GENERATION_TAG,
  MEGA_KEY_MANAGER_ATTR_TAG,
  MEGA_KEY_MANAGER_PRIVATE_ED25519_TAG,
  MEGA_KEY_MANAGER_PRIVATE_CU25519_TAG,
  MEGA_KEY_MANAGER_PRIVATE_RSA_TAG,
  MEGA_KEY_MANAGER_AUTH_RING_ED25519_TAG,
  MEGA_KEY_MANAGER_AUTH_RING_CU25519_TAG,
  MEGA_KEY_MANAGER_SHARE_KEYS_TAG,
  MEGA_KEY_MANAGER_PENDING_OUTSHARES_TAG,
  MEGA_KEY_MANAGER_PENDING_INSHARES_TAG,
  MEGA_KEY_MANAGER_BACKUPS_TAG,
  MEGA_KEY_MANAGER_WARNINGS_TAG,
]);
const MEGA_AUTH_METHOD_SEEN = 0;
const MEGA_AUTH_RING_RECORD_SIZE = 29;
const MEGA_SHARE_KEY_RECORD_SIZE = 23;
const MEGA_SHARE_KEY_FLAG_TRUSTED = 1 << 0;
const MEGA_SHARE_KEY_FLAG_IN_USE = 1 << 1;
const MEGA_PAIRWISE_KEY_LABEL = Buffer.from('strongvelope pairwise key\x01', 'latin1');
const megaSyncActivityTouchers = new WeakMap<AbortSignal, () => void>();
type MegaNodeCryptoModule = typeof import('node:crypto') | typeof import('crypto');
let megaNodeCryptoModule: MegaNodeCryptoModule | null = null;
let megaNodeCryptoModulePromise: Promise<MegaNodeCryptoModule> | null = null;
let megaNodeFsModulePromise: Promise<typeof import('node:fs/promises') | typeof import('fs/promises')> | null = null;
let megaChokidarModulePromise: Promise<{ default: { watch(...args: unknown[]): MegaFsWatcher } }> | null = null;

async function ensureMegaNodeCrypto(): Promise<MegaNodeCryptoModule> {
  if (megaNodeCryptoModule) {
    return megaNodeCryptoModule;
  }
  if (!megaNodeCryptoModulePromise) {
    megaNodeCryptoModulePromise = import('node:crypto')
      .catch(() => import('crypto'))
      .then((module) => {
        megaNodeCryptoModule = module;
        return module;
      });
  }
  return megaNodeCryptoModulePromise;
}

function getMegaNodeCrypto(): MegaNodeCryptoModule {
  if (megaNodeCryptoModule) {
    return megaNodeCryptoModule;
  }
  throw new Error('MEGA Node crypto is not initialized.');
}

function randomBytes(size: number): Buffer {
  if (megaNodeCryptoModule) {
    return megaNodeCryptoModule.randomBytes(size);
  }
  if (globalThis.crypto?.getRandomValues) {
    const bytes = new Uint8Array(size);
    globalThis.crypto.getRandomValues(bytes);
    return Buffer.from(bytes);
  }
  return getMegaNodeCrypto().randomBytes(size);
}

function getMegaWebCrypto(): Crypto {
  if (globalThis.crypto?.subtle) {
    return globalThis.crypto;
  }
  return getMegaNodeCrypto().webcrypto as Crypto;
}

async function getMegaNodeFs(): Promise<typeof import('node:fs/promises') | typeof import('fs/promises')> {
  if (!megaNodeFsModulePromise) {
    megaNodeFsModulePromise = import('node:fs/promises').catch(() => import('fs/promises'));
  }
  return megaNodeFsModulePromise;
}

async function getMegaChokidar(): Promise<{ default: { watch(...args: unknown[]): MegaFsWatcher } }> {
  if (!megaChokidarModulePromise) {
    const moduleName = 'chokidar';
    megaChokidarModulePromise = import(/* @vite-ignore */ moduleName) as Promise<{
      default: { watch(...args: unknown[]): MegaFsWatcher };
    }>;
  }
  return megaChokidarModulePromise;
}

interface MegaShareInviteTarget {
  readonly u: string;
  readonly e?: string;
}

interface MegaAdapterOptions {
  readonly fetchImpl?: typeof fetch;
}

interface MegaFsWatcher {
  close(): Promise<void> | void;
  on(event: string, listener: (...args: unknown[]) => void): MegaFsWatcher;
}

interface MegaAccountSecret {
  readonly email: string;
  readonly password?: string;
  readonly mfaCode?: string;
  readonly sid: string;
  readonly masterKey: string;
  readonly encryptedPrivateKey?: string;
  readonly userHandle: string;
  readonly accountVersion: number;
  readonly accountSalt?: string;
  readonly shareKeys?: Record<string, string>;
}

interface MegaSession {
  readonly email: string;
  readonly password?: string;
  readonly mfaCode?: string;
  readonly sid: string;
  readonly masterKey: Buffer;
  readonly encryptedPrivateKey?: string;
  readonly privateKey?: MegaPrivateKey;
  readonly userHandle: string;
  readonly accountVersion: number;
  readonly accountSalt?: string;
}

interface MegaMirrorManifest {
  readonly rootHandle?: string;
  readonly lastScsn?: string;
  readonly knownHandles?: readonly string[];
  readonly unsupportedTopLevelNames?: readonly string[];
  readonly entries: Record<string, ProviderRefreshManifestEntry>;
}

interface MegaRecipientProbeContext {
  readonly source: 'sc' | 'sync';
  readonly rootHandle: string;
  readonly triggerHandle: string;
  readonly packetReceivedAt: number;
  readonly scsn?: string;
  readonly fetchStartedAt?: number;
  readonly fetchCompletedAt?: number;
}

interface MegaFetchedTree {
  readonly snapshot: MegaFetchNodesSnapshot;
  readonly tree: DecryptedMegaTree;
}

interface DecryptedMegaNode {
  readonly handle: string;
  readonly parentHandle?: string;
  readonly nodeType: number;
  readonly isFolder: boolean;
  readonly size: number;
  readonly name: string;
  readonly modifiedAt?: number;
  readonly nodeKey: Buffer;
  readonly encodedKey?: string;
  readonly encodedAttributes?: string;
  readonly ownerHandle?: string;
  readonly ownerEmail?: string;
  readonly accessLevel?: string;
  readonly shareHandle?: string;
}

interface DecryptedMegaTree {
  readonly root: DecryptedMegaNode;
  readonly nodesByHandle: ReadonlyMap<string, DecryptedMegaNode>;
  readonly childrenByParent: ReadonlyMap<string, readonly DecryptedMegaNode[]>;
}

interface MegaDecryptTreeOptions {
  readonly expectedRootHandle?: string;
  readonly expectedRootName?: string;
}

interface MegaKeyManagerRecord {
  readonly tag: number;
  readonly payload: Buffer;
}

interface MegaKeyManagerState {
  readonly shareKeys: ReadonlyMap<string, Buffer>;
  readonly pendingInShares: ReadonlyMap<string, MegaPendingInShareRecord>;
  readonly authRingEd25519: ReadonlyMap<string, number>;
  readonly privateCu25519?: Buffer;
  readonly records: readonly MegaKeyManagerRecord[];
}

interface MegaKeyManagerRecoveryPayload {
  readonly version: number;
  readonly creationTime: Buffer;
  readonly identity: Buffer;
  readonly generation: number;
  readonly attr: Buffer;
  readonly privateEd25519: Buffer;
  readonly privateCu25519: Buffer;
  readonly privateRsa: Buffer;
  readonly authRingEd25519: Buffer;
  readonly authRingCu25519: Buffer;
  readonly otherRecords: readonly MegaKeyManagerRecord[];
}

interface MegaPendingInShareRecord {
  readonly ownerHandle: string;
  readonly encryptedShareKey: Buffer;
}

interface MegaApiError extends Error {
  code: number;
}

interface MegaPrivateKey {
  readonly modulus: bigint;
  readonly privateExponent: bigint;
  readonly modulusLength: number;
}

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

  private async listIncomingSharesUncached(account: ProviderAccount): Promise<IncomingManagedShareOffer[]> {
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

    const localFilePath = path.join(share.localPath, normalizedPath);
    const localBytes = new Uint8Array(await (await getMegaNodeFs()).readFile(localFilePath));
    const uploadStartedAt = this.runtime.now();
    try {
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

  async handleManagedShareLocalWrite(
    share: ManagedShare,
    account: ProviderAccount | null,
    relativePath: string
  ): Promise<void> {
    const normalizedPath = normalizeRelativePath(relativePath);
    if (!isMirrorRelativePath(normalizedPath)) {
      return;
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
    await this.requestSyncLoop(share, account);
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

    const syncAbort = createMegaSyncAbortController(
      this.runtime.createAbortController,
      this.runtime.scheduler,
      this.runtime.mega.syncTimeoutMs
    );
    const { controller } = syncAbort;
    this.syncControllers.set(share.id, controller);

    const task = this.syncShare(share, account, controller.signal).finally(() => {
      syncAbort.dispose();
      if (this.syncTasks.get(share.id) === task) {
        this.syncTasks.delete(share.id);
      }
      if (this.syncControllers.get(share.id) === controller) {
        this.syncControllers.delete(share.id);
      }
    });
    this.syncTasks.set(share.id, task);
    await task;
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
          if (!touchesShare) {
            this.syncStates.set(share.id, {
              status: 'ready',
              detail: 'MEGA readonly mirror is up to date.',
              badges: READONLY_BADGES,
              lastSyncAt: this.runtime.now(),
            });
            return;
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
      await this.persistManifest(share.id, fetchedManifest);
      this.shareRootHandles.set(share.id, resolved.fetched.tree.root.handle);
      if (fetchedManifest.lastScsn) {
        this.shareScsn.set(share.id, fetchedManifest.lastScsn);
      }
      if (fetchedManifest.knownHandles) {
        this.shareKnownHandles.set(share.id, [...fetchedManifest.knownHandles]);
      }
      const refreshResult = await this.refreshWorker.refresh(
        share.localPath,
        new MegaReadonlyRemoteAdapter(this.fetchImpl, this.apiClient, resolved.session, resolved.fetched.tree, signal),
        { entries: manifest.entries }
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
      await this.persistManifest(share.id, {
        ...fetchedManifest,
        entries: refreshResult.manifest.entries,
      } satisfies MegaMirrorManifest);
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
    const cooldownDelayMs = this.getSyncCooldownRemainingMs(share.id);
    if (cooldownDelayMs > 0) {
      this.schedulePendingSyncRetry(share, account, cooldownDelayMs);
      return;
    }

    const existing = this.syncTasks.get(share.id);
    if (existing) {
      this.schedulePendingSyncRetry(share, account, 100);
      return existing;
    }

    await this.runSyncLoop(share, account);
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
      const ownerUploadState = buildMegaOwnerUploadState(root, shareCrypto);
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
    const mirrorPaths = Array.from(
      new Set(
        (await source.listMirrorFiles(share))
          .map((entry) => normalizeRelativePath(entry))
          .filter((entry) => entry.length > 0 && isMirrorRelativePath(entry))
      )
    ).sort((left, right) => left.localeCompare(right));

    for (const relativePath of mirrorPaths) {
      activePaths.add(relativePath);
      const bytes = await source.readMirrorFile(share, relativePath);
      const existing = ownerUploadState.filesByPath.get(relativePath);
      if (existing && existing.size === bytes.length) {
        skipped.push(relativePath);
        continue;
      }
      await adapter.upload(relativePath, bytes, { waitForVisibility: true });
      uploaded.push(relativePath);
    }

    for (const [relativePath, file] of Array.from(ownerUploadState.filesByPath.entries())) {
      if (!isMirrorRelativePath(relativePath) || activePaths.has(relativePath)) {
        continue;
      }
      await deleteMegaNode(this.apiClient, session, file.handle, signal);
      ownerUploadState.filesByPath.delete(relativePath);
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
    if (!this.accountShareKeyCache.has(session.userHandle)) {
      const persistedShareKeys = decodePersistedMegaShareKeys(secret.shareKeys);
      if (persistedShareKeys.size > 0) {
        this.accountShareKeyCache.set(session.userHandle, persistedShareKeys);
      }
    }
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

    const offers = await this.listIncomingShares(account);
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
    if (handles.length === 0) {
      return false;
    }

    const applyUpdates = async (session: MegaSession) => {
      const nextEntries = { ...manifest.entries };
      const handlePathIndex = buildManifestHandlePathIndex(nextEntries);
      const shareKeys = this.accountShareKeyCache.get(session.userHandle) ?? new Map<string, Buffer>();
      let appliedCount = 0;

      const deletedHandles = await this.applyRecipientDeletionPackets(
        share,
        rootHandle,
        actionBatch.packets,
        nextEntries,
        handlePathIndex,
      );
      appliedCount += deletedHandles.size;

      const directlyAppliedCount = await this.applyRecipientPacketNodes(
        share,
        session,
        rootHandle,
        actionBatch.packets,
        nextEntries,
        handlePathIndex,
        shareKeys,
        baseProbeContext,
      );
      appliedCount += directlyAppliedCount;

      for (const handle of handles) {
        if (deletedHandles.has(handle)) {
          continue;
        }
        if (handlePathIndex.has(handle)) {
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
        if (!applied) {
          continue;
        }
        appliedCount += 1;
      }

      if (appliedCount === 0) {
        debugMegaLog('[MEGA:immediate-apply] no candidate handle could be applied.', {
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
  ): Promise<Set<string>> {
    const deletedHandles = collectRecipientDeletedPacketHandles(packets, rootHandle);
    if (deletedHandles.length === 0) {
      return new Set();
    }

    const appliedHandles = new Set<string>();
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
      debugMegaLog('[MEGA:immediate-apply] removed recipient path from delete action packet.', {
        shareId: share.id,
        rootHandle,
        handle,
        relativePath,
        removedPathCount: removedPaths.length,
      });
    }

    return appliedHandles;
  }

  private async applyRecipientHandleUpdate(
    share: ManagedShare,
    session: MegaSession,
    rootHandle: string,
    handle: string,
    entries: Record<string, ProviderRefreshManifestEntry>,
    handlePathIndex: Map<string, string>,
    probeContext: MegaRecipientProbeContext
  ): Promise<boolean> {
    const fetchStartedAt = this.runtime.now();
    const fetched = await this.fetchPartialTreeWithRetry(session, handle, undefined, {
      allowTransientFullFallback: true,
      fastPartialFallback: true,
      maxAttempts: 1,
    });
    const fetchCompletedAt = this.runtime.now();
    const baseRelativePath = resolveRecipientFetchedNodePath(fetched.tree.root, rootHandle, handlePathIndex);
    const isMirrorContainer = baseRelativePath ? isMirrorContainerPath(baseRelativePath) : false;
    if (!baseRelativePath || (!isMirrorRelativePath(baseRelativePath) && !isMirrorContainer)) {
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
      return false;
    }

    const resolvedProbeContext: MegaRecipientProbeContext = {
      ...probeContext,
      fetchStartedAt,
      fetchCompletedAt,
    };

    if (!isMirrorContainer) {
      await this.applyRecipientFetchedNode(
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
      await this.applyRecipientFetchedNode(
        share,
        session,
        node,
        fullRelativePath,
        entries,
        handlePathIndex,
        resolvedProbeContext
      );
    });
    return true;
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
  ): Promise<number> {
    const packetNodes = collectRecipientImmediatePacketNodes(packets);
    if (packetNodes.length === 0) {
      return 0;
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
      return 0;
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
      await this.applyRecipientFetchedNode(
        share,
        session,
        node,
        relativePath,
        entries,
        handlePathIndex,
        probeContext
      );
      appliedCount += 1;
    }

    return appliedCount;
  }

  private async applyRecipientFetchedNode(
    share: ManagedShare,
    session: MegaSession,
    node: DecryptedMegaNode,
    relativePath: string,
    entries: Record<string, ProviderRefreshManifestEntry>,
    handlePathIndex: Map<string, string>,
    probeContext: MegaRecipientProbeContext
  ): Promise<void> {
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
      return;
    }

    const nextEntry = createProviderRefreshManifestEntry(node);
    const existingEntry = entries[relativePath];
    if (
      existingEntry?.kind === 'file' &&
      existingEntry.fingerprint === nextEntry.fingerprint &&
      existingEntry.handle === nextEntry.handle
    ) {
      const localFileExists = await (await getMegaNodeFs()).access(targetPath).then(() => true).catch(() => false);
      if (localFileExists) {
        entries[relativePath] = nextEntry;
        handlePathIndex.set(node.handle, relativePath);
        return;
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
        allowTransientFullFallback: false,
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
      allowTransientFullFallback: false,
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
          allowTransientFullFallback: false,
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
        allowTransientFullFallback: false,
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
      allowTransientFullFallback: false,
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

function secretKey(accountId: string): string {
  return `${MEGA_SECRET_PREFIX}${accountId}`;
}

function mirrorManifestKey(shareId: string): string {
  return `${MEGA_MANIFEST_PREFIX}${shareId}`;
}

function createOpaqueId(prefix: string): string {
  return `${prefix}-${randomBytes(6).toString('hex')}`;
}

function isZeroBuffer(value: Buffer): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== 0) {
      return false;
    }
  }
  return true;
}

function xorBuffers(left: Buffer, right: Buffer): Buffer {
  const result = Buffer.alloc(Math.min(left.length, right.length));
  for (let index = 0; index < result.length; index += 1) {
    result[index] = left[index]! ^ right[index]!;
  }
  return result;
}

function uniqueTrimmedStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }
    const normalized = trimmed.toLowerCase();
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(trimmed);
  }
  return result;
}

function megaOutgoingShareRecordNodeHandles(record: Record<string, unknown>): string[] {
  const handles: string[] = [];
  // MEGA SDK `readoutshareelement` documents the shared node as `h`; older snapshots sometimes used `t`.
  for (const key of ['h', 't'] as const) {
    const raw = record[key];
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (trimmed) {
        handles.push(trimmed);
      }
    }
  }
  return [...new Set(handles)];
}

function resolveMegaShareInviteTarget(snapshot: MegaFetchNodesSnapshot, email: string): MegaShareInviteTarget {
  const normalized = email.trim().toLowerCase();
  for (const user of snapshot.users) {
    const handle = typeof user.u === 'string' ? user.u.trim() : '';
    const mail = typeof user.m === 'string' ? user.m.trim().toLowerCase() : '';
    if (handle && mail === normalized) {
      return { u: handle };
    }
  }
  const trimmed = email.trim();
  return trimmed ? { u: MEGA_SHARE_INVITE_NON_CONTACT_USER, e: trimmed } : { u: MEGA_SHARE_INVITE_NON_CONTACT_USER };
}

function resolveMegaPendingOutShareTarget(invitee: MegaShareInviteTarget): string {
  const user = invitee.u.trim();
  if (user && user !== MEGA_SHARE_INVITE_NON_CONTACT_USER) {
    return user;
  }
  return invitee.e?.trim() ?? '';
}

function isMegaUserHandle(value: string): boolean {
  return /^[A-Za-z0-9_-]{11}$/u.test(value.trim());
}

function isMegaNodeHandle(value: string): boolean {
  return /^[A-Za-z0-9_-]{8}$/u.test(value.trim());
}

function isMegaRecordHandle(value: string): boolean {
  return /^[A-Za-z0-9_-]{8,11}$/u.test(value.trim());
}

function isMegaKeyOwnerHandle(value: string): boolean {
  const normalized = value.trim();
  return isMegaRecordHandle(normalized) || isMegaUserHandle(normalized);
}

function resolveOutgoingSharePeerEmail(
  record: Record<string, unknown>,
  usersByHandle: Map<string, MegaUserRecord>,
  pendingContactsByHandle: ReadonlyMap<string, string>
): string | undefined {
  const pendingHandle = typeof record.p === 'string' ? record.p.trim() : '';
  if (pendingHandle) {
    const fromPending = pendingContactsByHandle.get(pendingHandle)?.trim();
    if (fromPending) {
      return fromPending;
    }
  }
  const uRaw = typeof record.u === 'string' ? record.u.trim() : '';
  if (!uRaw) {
    return undefined;
  }
  if (uRaw.includes('@')) {
    return uRaw;
  }
  const fromUser = usersByHandle.get(uRaw)?.m;
  return typeof fromUser === 'string' && fromUser.trim() ? fromUser.trim() : undefined;
}

function collectMegaOwnerShareInviteTargets(
  snapshot: MegaFetchNodesSnapshot,
  rootNodeHandle: string,
  rootShareHandle?: string
): MegaShareInviteTarget[] {
  const usersByHandle = buildMegaUsersByHandle(snapshot);
  const pendingContactsByHandle = new Map<string, string>();
  for (const pending of snapshot.outgoingPendingContacts) {
    const handle = typeof pending.p === 'string' ? pending.p.trim() : '';
    const email = typeof pending.e === 'string' ? pending.e.trim() : '';
    if (handle && email) {
      pendingContactsByHandle.set(handle, email);
    }
  }

  const targets = new Map<string, MegaShareInviteTarget>();
  const records = [...snapshot.outgoingShares, ...snapshot.pendingShares];
  for (const record of records) {
    const recordHandles = megaOutgoingShareRecordNodeHandles(record);
    if (
      !recordHandles.some(
        (handle) =>
          handle === rootNodeHandle || (typeof rootShareHandle === 'string' && rootShareHandle.trim() !== '' && handle === rootShareHandle.trim())
      )
    ) {
      continue;
    }

    const userHandle = typeof record.u === 'string' ? record.u.trim() : '';
    const email = resolveOutgoingSharePeerEmail(record, usersByHandle, pendingContactsByHandle)?.trim();
    if (isMegaUserHandle(userHandle)) {
      targets.set(`user:${userHandle}`, email ? { u: userHandle, e: email } : { u: userHandle });
      continue;
    }
    if (email) {
      targets.set(`email:${email.toLowerCase()}`, { u: MEGA_SHARE_INVITE_NON_CONTACT_USER, e: email });
    }
  }

  return [...targets.values()];
}

function collectMegaOwnerCollaborators(
  snapshot: MegaFetchNodesSnapshot,
  rootNodeHandle: string,
  rootShareHandle?: string
): ManagedShareCollaborator[] {
  const usersByHandle = buildMegaUsersByHandle(snapshot);
  const pendingContactsByHandle = new Map<string, string>();
  for (const pending of snapshot.outgoingPendingContacts) {
    const handle = typeof pending.p === 'string' ? pending.p.trim() : '';
    const email = typeof pending.e === 'string' ? pending.e.trim() : '';
    if (handle && email) {
      pendingContactsByHandle.set(handle, email);
    }
  }

  const collaborators = new Map<string, ManagedShareCollaborator>();
  const records = [...snapshot.outgoingShares, ...snapshot.pendingShares];
  for (const record of records) {
    const recordHandles = megaOutgoingShareRecordNodeHandles(record);
    if (
      !recordHandles.some(
        (handle) =>
          handle === rootNodeHandle || (typeof rootShareHandle === 'string' && rootShareHandle.trim() !== '' && handle === rootShareHandle.trim())
      )
    ) {
      continue;
    }
    const pendingHandle = typeof record.p === 'string' ? record.p.trim() : '';
    const email = resolveOutgoingSharePeerEmail(record, usersByHandle, pendingContactsByHandle);
    if (!email) {
      continue;
    }

    const key = email.toLowerCase();
    const collaborator: ManagedShareCollaborator = {
      label: email,
      email,
      role: describeAccessLevel(Number(record.r ?? 0)),
      status: pendingHandle ? 'invited' : 'active',
      source: 'provider',
    };
    const existing = collaborators.get(key);
    if (!existing || existing.status === 'invited') {
      collaborators.set(key, collaborator);
    }
  }

  return [...collaborators.values()].sort((left, right) => {
    if (left.status !== right.status) {
      return left.status === 'active' ? -1 : 1;
    }
    return left.label.localeCompare(right.label);
  });
}

function snapshotReflectsOutgoingInvitees(
  snapshot: MegaFetchNodesSnapshot,
  rootNodeHandle: string,
  rootShareHandle: string | undefined,
  expectedLowercaseEmails: readonly string[]
): boolean {
  if (expectedLowercaseEmails.length === 0) {
    return true;
  }
  const fromCollaborators = new Set(
    collectMegaOwnerCollaborators(snapshot, rootNodeHandle, rootShareHandle)
      .map((c) => c.email?.trim().toLowerCase())
      .filter((v): v is string => Boolean(v))
  );
  const pendingByHandle = new Map<string, string>();
  for (const pending of snapshot.outgoingPendingContacts) {
    const handle = typeof pending.p === 'string' ? pending.p.trim() : '';
    const mail = typeof pending.e === 'string' ? pending.e.trim().toLowerCase() : '';
    if (handle && mail) {
      pendingByHandle.set(handle, mail);
    }
  }
  const fromRawRows = new Set<string>();
  for (const record of [...snapshot.outgoingShares, ...snapshot.pendingShares]) {
    const recordHandles = megaOutgoingShareRecordNodeHandles(record);
    if (
      !recordHandles.some(
        (handle) =>
          handle === rootNodeHandle ||
          (typeof rootShareHandle === 'string' && rootShareHandle.trim() !== '' && handle === rootShareHandle.trim())
      )
    ) {
      continue;
    }
    const uRaw = typeof record.u === 'string' ? record.u.trim() : '';
    if (uRaw.includes('@')) {
      fromRawRows.add(uRaw.toLowerCase());
    }
    const pending = typeof record.p === 'string' ? record.p.trim() : '';
    const pendingEmail = pending ? pendingByHandle.get(pending) : undefined;
    if (pendingEmail) {
      fromRawRows.add(pendingEmail);
    }
  }
  return expectedLowercaseEmails.every((email) => fromCollaborators.has(email) || fromRawRows.has(email));
}

function countMegaOwnerSharePeers(
  snapshot: MegaFetchNodesSnapshot,
  rootNodeHandle: string,
  rootShareHandle?: string
): number {
  return collectMegaOwnerShareInviteTargets(snapshot, rootNodeHandle, rootShareHandle).length;
}

function snapshotHasOutgoingShareForRoot(
  snapshot: MegaFetchNodesSnapshot,
  rootNodeHandle: string,
  rootShareHandle: string | undefined
): boolean {
  for (const record of [...snapshot.outgoingShares, ...snapshot.pendingShares]) {
    const handles = megaOutgoingShareRecordNodeHandles(record);
    if (
      handles.some(
        (handle) =>
          handle === rootNodeHandle || (typeof rootShareHandle === 'string' && rootShareHandle.trim() !== '' && handle === rootShareHandle.trim())
      )
    ) {
      return true;
    }
  }
  return false;
}

function getMegaShareRemotePath(share: ManagedShare, fallbackPath: string): string {
  return getStringDescriptor(share.remoteDescriptor, 'remotePath') ?? fallbackPath;
}

async function ensureMegaOwnerLocalStructure(localPath: string): Promise<void> {
  const fs = await getMegaNodeFs();
  await Promise.all([
    fs.mkdir(path.join(localPath, 'blocks'), { recursive: true }),
    fs.mkdir(path.join(localPath, 'channels'), { recursive: true }),
  ]);
}

interface MegaOwnerRemoteRoot {
  readonly path: string;
  readonly root: DecryptedMegaNode;
  readonly tree: DecryptedMegaTree;
  readonly scsn?: string;
}

interface MegaShareCryptoContext {
  readonly shareHandle: string;
  readonly shareKey: Buffer;
}

interface MegaKnownRemoteFile {
  readonly handle: string;
  readonly size: number;
}

interface MegaOwnerUploadState {
  readonly root: MegaOwnerRemoteRoot;
  readonly shareCrypto: MegaShareCryptoContext | undefined;
  readonly extraShareKeys: ReadonlyMap<string, Buffer> | undefined;
  readonly folderHandlesByPath: Map<string, string>;
  readonly filesByPath: Map<string, MegaKnownRemoteFile>;
}

interface MegaOwnerSyncResult {
  readonly uploaded: string[];
  readonly downloaded: string[];
  readonly skipped: string[];
}

function createMegaShareCryptoExtraKeys(
  shareCrypto: MegaShareCryptoContext | undefined
): ReadonlyMap<string, Buffer> | undefined {
  if (!shareCrypto) {
    return undefined;
  }
  return new Map([[shareCrypto.shareHandle, Buffer.from(shareCrypto.shareKey)]]);
}

class MegaOwnerRemoteAdapter {
  constructor(
    private readonly fetchImpl: typeof fetch,
    private readonly apiClient: MegaApiClient,
    private readonly session: MegaSession,
    private readonly ownerUploadState: MegaOwnerUploadState,
    private readonly signal?: AbortSignal
  ) { }

  reconcileUploadsByRemoteSize(): boolean {
    return true;
  }

  async confirmEntry(relativePath: string, expectedSize: number): Promise<boolean> {
    const normalized = normalizeRelativePath(relativePath);
    let node = findNodeByRelativePath(this.ownerUploadState.root.tree, this.ownerUploadState.root.root.handle, normalized);
    node = node && !node.isFolder ? node : undefined;
    if (node && node.size === expectedSize) {
      return true;
    }

    const fetched = await fetchMegaDecryptedTree(
      this.apiClient,
      this.session,
      this.ownerUploadState.root.root.handle,
      { useCache: false, allowTransientFullFallback: false, extraShareKeys: this.ownerUploadState.extraShareKeys },
      this.signal
    );
    replaceMegaOwnerUploadStateFromTree(this.ownerUploadState, fetched.tree);
    const resolved = findNodeByRelativePath(fetched.tree, this.ownerUploadState.root.root.handle, normalized);
    const confirmed = resolved && !resolved.isFolder ? resolved : undefined;
    const matches = Boolean(confirmed && confirmed.size === expectedSize);
    if (!matches) {
      debugMegaLog('[MEGA:owner-adapter] remote entry confirmation failed.', {
        relativePath: normalized,
        expectedSize,
        actualSize: confirmed?.size,
        found: Boolean(confirmed),
      });
    }
    return matches;
  }

  async list(): Promise<readonly MirrorRemoteEntry[]> {
    debugMegaLog('[MEGA:owner-adapter] listing remote entries.', {
      rootHandle: this.ownerUploadState.root.root.handle,
      rootPath: this.ownerUploadState.root.path,
    });
    const listEntriesFromTree = async (tree: DecryptedMegaTree): Promise<MirrorRemoteEntry[]> => {
      const entries: MirrorRemoteEntry[] = [];
      await visitTree(tree, async (relativePath, node) => {
        if (!isMirrorRelativePath(relativePath) || node.isFolder) {
          return;
        }
        entries.push({
          path: normalizeRelativePath(relativePath),
          size: node.size,
        });
      });
      return entries.sort((left, right) => left.path.localeCompare(right.path));
    };

    const fetched = await fetchMegaDecryptedTree(
      this.apiClient,
      this.session,
      this.ownerUploadState.root.root.handle,
      { useCache: false, allowTransientFullFallback: false, extraShareKeys: this.ownerUploadState.extraShareKeys },
      this.signal
    );
    let selectedTree = fetched.tree;
    let selectedEntries = await listEntriesFromTree(fetched.tree);

    if (selectedEntries.length > 0) {
      const confirmed = await fetchMegaDecryptedTree(
        this.apiClient,
        this.session,
        this.ownerUploadState.root.root.handle,
        { useCache: false, allowTransientFullFallback: false, extraShareKeys: this.ownerUploadState.extraShareKeys },
        this.signal
      );
      const confirmedEntries = await listEntriesFromTree(confirmed.tree);
      const initialCount = selectedEntries.length;
      const selectedSignature = JSON.stringify(selectedEntries);
      const confirmedSignature = JSON.stringify(confirmedEntries);
      if (selectedSignature !== confirmedSignature) {
        selectedTree = confirmed.tree;
        selectedEntries = confirmedEntries;
        debugMegaLog('[MEGA:owner-adapter] remote entry listing changed between consecutive fetches; using the confirmed snapshot.', {
          initialCount,
          confirmedCount: confirmedEntries.length,
        });
      }
    }

    const duplicateHandles = collectDuplicateSiblingFileHandles(selectedTree);
    if (duplicateHandles.length > 0) {
      debugMegaLog('[MEGA:owner-adapter] removing duplicate sibling file nodes from MEGA.', {
        count: duplicateHandles.length,
        handles: duplicateHandles,
      });
      for (const handle of duplicateHandles) {
        try {
          await deleteMegaNode(this.apiClient, this.session, handle, this.signal);
        } catch (error) {
          debugMegaLog('[MEGA:owner-adapter] failed to remove duplicate node; will retry next cycle.', {
            handle,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      const refreshed = await fetchMegaDecryptedTree(
        this.apiClient,
        this.session,
        this.ownerUploadState.root.root.handle,
        { useCache: false, allowTransientFullFallback: false, extraShareKeys: this.ownerUploadState.extraShareKeys },
        this.signal
      );
      selectedTree = refreshed.tree;
      selectedEntries = await listEntriesFromTree(refreshed.tree);
    }

    replaceMegaOwnerUploadStateFromTree(this.ownerUploadState, selectedTree);
    const sorted = selectedEntries;
    debugMegaLog('[MEGA:owner-adapter] remote entries listed.', {
      count: sorted.length,
      paths: sorted.map((e) => e.path),
    });
    return sorted;
  }

  async download(relativePath: string): Promise<Uint8Array> {
    const normalized = normalizeRelativePath(relativePath);
    debugMegaLog('[MEGA:owner-adapter] downloading file from owner root.', { relativePath: normalized });
    let node = findNodeByRelativePath(this.ownerUploadState.root.tree, this.ownerUploadState.root.root.handle, normalized);
    node = node && !node.isFolder ? node : undefined;
    if (!node) {
      const fetched = await fetchMegaDecryptedTree(
        this.apiClient,
        this.session,
        this.ownerUploadState.root.root.handle,
        { useCache: false, allowTransientFullFallback: false, extraShareKeys: this.ownerUploadState.extraShareKeys },
        this.signal
      );
      replaceMegaOwnerUploadStateFromTree(this.ownerUploadState, fetched.tree);
      const resolved = findNodeByRelativePath(fetched.tree, this.ownerUploadState.root.root.handle, normalized);
      node = resolved && !resolved.isFolder ? resolved : undefined;
    }
    if (!node) {
      console.error('[MEGA:owner-adapter] download target not found in tree.', { relativePath: normalized });
      throw new Error(`MEGA owner folder is missing ${normalized}.`);
    }
    const data = await downloadAuthenticatedMegaFileContent(
      this.fetchImpl,
      this.apiClient,
      this.session,
      node.handle,
      node.nodeKey,
      node.size,
      this.signal
    );
    debugMegaLog('[MEGA:owner-adapter] download completed.', { relativePath: normalized, size: data.length });
    return data;
  }

  async upload(
    relativePath: string,
    data: Uint8Array,
    options: { readonly waitForVisibility?: boolean } = {}
  ): Promise<void> {
    const normalized = normalizeRelativePath(relativePath);
    const folderSegments = normalized.split('/').slice(0, -1);
    const name = normalized.split('/').at(-1)?.trim() ?? '';
    if (!name) {
      throw new Error('MEGA upload path must include a file name.');
    }

    debugMegaLog('[MEGA:owner-adapter] preparing upload.', {
      relativePath: normalized,
      name,
      folderSegments,
      dataSize: data.length,
    });

    const parent = await ensureTreePathWithCache(
      this.apiClient,
      this.session,
      this.ownerUploadState,
      folderSegments,
      this.signal,
    );
    const existing = this.ownerUploadState.filesByPath.get(normalized);
    if (existing && existing.size === data.length) {
      debugMegaLog('[MEGA:owner-adapter] upload skipped (already exists on remote).', {
        relativePath: normalized,
        existingHandle: existing.handle,
      });
      return;
    }
    if (existing && existing.size !== data.length) {
      await deleteMegaNode(this.apiClient, this.session, existing.handle, this.signal);
      this.ownerUploadState.filesByPath.delete(normalized);
    }

    debugMegaLog('[MEGA:owner-adapter] uploading file to MEGA.', {
      relativePath: normalized,
      parentHandle: parent.handle,
      name,
      dataSize: data.length,
    });
    const uploaded = await uploadMegaOwnerFile(
      this.fetchImpl,
      this.apiClient,
      this.session,
      parent.handle,
      name,
      Buffer.from(data),
      this.ownerUploadState.shareCrypto,
      this.signal,
      this.ownerUploadState.extraShareKeys,
      { waitForVisibility: options.waitForVisibility }
    );
    this.ownerUploadState.filesByPath.set(normalized, {
      handle: uploaded.handle,
      size: data.length,
    });
    debugMegaLog('[MEGA:owner-adapter] upload completed.', { relativePath: normalized });
  }
}

function isMirrorRelativePath(value: string): boolean {
  return value.startsWith('blocks/') || value.startsWith('channels/');
}

function isMirrorContainerPath(value: string): boolean {
  return value === 'blocks' || value === 'channels';
}

function resolveMegaMirrorRelativePath(value: string): string | null {
  const normalized = normalizeRelativePath(value);
  if (!normalized) {
    return null;
  }
  if (isMirrorContainerPath(normalized) || isMirrorRelativePath(normalized)) {
    return normalized;
  }
  const segments = normalized.split('/').filter((segment) => segment.length > 0);
  const mirrorIndex = segments.findIndex((segment) => segment === 'blocks' || segment === 'channels');
  if (mirrorIndex === -1) {
    return null;
  }
  const suffix = segments.slice(mirrorIndex).join('/');
  return isMirrorContainerPath(suffix) || isMirrorRelativePath(suffix) ? suffix : null;
}

function summarizeOwnerMirrorResult(
  remotePath: string,
  result: { uploaded: readonly string[]; downloaded: readonly string[] }
): string {
  const parts: string[] = [];
  if (result.uploaded.length > 0) {
    parts.push(`${result.uploaded.length} uploaded`);
  }
  if (result.downloaded.length > 0) {
    parts.push(`${result.downloaded.length} downloaded`);
  }
  return parts.length > 0
    ? `MEGA owner sync is active for ${remotePath}. ${parts.join(', ')}.`
    : `MEGA owner sync is active for ${remotePath}.`;
}

function findChildNodeByName(
  tree: DecryptedMegaTree,
  parentHandle: string,
  name: string,
  folderOnly?: boolean
): DecryptedMegaNode | undefined {
  return findChildNodesByName(tree, parentHandle, name, folderOnly)[0];
}

function findChildNodesByName(
  tree: DecryptedMegaTree,
  parentHandle: string,
  name: string,
  folderOnly?: boolean
): DecryptedMegaNode[] {
  const candidates = [...(tree.childrenByParent.get(parentHandle) ?? [])].filter((node) => {
    if (folderOnly && !node.isFolder) {
      return false;
    }
    return node.name === name;
  });
  candidates.sort((left, right) => compareMegaNodeCandidates(tree, left, right));
  return candidates;
}

function findNodeByRelativePath(
  tree: DecryptedMegaTree,
  rootHandle: string,
  relativePath: string
): DecryptedMegaNode | undefined {
  const segments = normalizeRelativePath(relativePath).split('/').filter((segment) => segment.length > 0);
  let parentHandle = rootHandle;
  let current: DecryptedMegaNode | undefined;
  for (let index = 0; index < segments.length; index += 1) {
    current = findChildNodeByName(tree, parentHandle, segments[index]!, index < segments.length - 1);
    if (!current) {
      return undefined;
    }
    parentHandle = current.handle;
  }
  return current;
}

async function ensureTreePathWithCache(
  apiClient: MegaApiClient,
  session: MegaSession,
  ownerUploadState: MegaOwnerUploadState,
  segments: readonly string[],
  signal?: AbortSignal,
): Promise<DecryptedMegaNode> {
  const root = ownerUploadState.root.root;
  let current = root;
  let currentPath = '';
  for (const segment of segments) {
    currentPath = currentPath ? `${currentPath}/${segment}` : segment;
    const cachedHandle = ownerUploadState.folderHandlesByPath.get(currentPath);
    if (cachedHandle) {
      current = {
        handle: cachedHandle,
        parentHandle: current.handle,
        nodeType: 1,
        isFolder: true,
        size: 0,
        name: segment,
        nodeKey: Buffer.alloc(16),
        shareHandle: ownerUploadState.shareCrypto?.shareHandle ?? root.shareHandle,
      };
      continue;
    }

    const existing = await findMegaRemoteChildNode(
      apiClient,
      session,
      current.handle,
      segment,
      true,
      signal,
      ownerUploadState.extraShareKeys
    );
    if (existing) {
      ownerUploadState.folderHandlesByPath.set(currentPath, existing.handle);
      current = existing;
      continue;
    }

    const createdHandle = await createMegaFolder(
      apiClient,
      session,
      current.handle,
      segment,
      ownerUploadState.shareCrypto,
      signal,
      ownerUploadState.extraShareKeys
    );
    ownerUploadState.folderHandlesByPath.set(currentPath, createdHandle);
    debugMegaLog('[MEGA:ensureTreePath] folder created.', { segment, parentHandle: current.handle, createdHandle });
    current = {
      handle: createdHandle,
      parentHandle: current.handle,
      nodeType: 1,
      isFolder: true,
      size: 0,
      name: segment,
      nodeKey: Buffer.alloc(16),
      shareHandle: ownerUploadState.shareCrypto?.shareHandle ?? root.shareHandle,
    };
  }
  return current;
}

function buildMegaOwnerUploadState(
  root: MegaOwnerRemoteRoot,
  shareCrypto: MegaShareCryptoContext | undefined
): MegaOwnerUploadState {
  const ownerUploadState: MegaOwnerUploadState = {
    root,
    shareCrypto,
    extraShareKeys: createMegaShareCryptoExtraKeys(shareCrypto),
    folderHandlesByPath: new Map<string, string>([['', root.root.handle]]),
    filesByPath: new Map<string, MegaKnownRemoteFile>(),
  };
  replaceMegaOwnerUploadStateFromTree(ownerUploadState, root.tree);
  return ownerUploadState;
}

function replaceMegaOwnerUploadStateFromTree(
  ownerUploadState: MegaOwnerUploadState,
  tree: DecryptedMegaTree
): void {
  ownerUploadState.folderHandlesByPath.clear();
  ownerUploadState.filesByPath.clear();
  ownerUploadState.folderHandlesByPath.set('', tree.root.handle);
  visitMegaTreeSync(tree, tree.root.handle, '', (relativePath, node) => {
    if (!relativePath) {
      return;
    }
    if (node.isFolder) {
      ownerUploadState.folderHandlesByPath.set(relativePath, node.handle);
      return;
    }
    if (isMirrorRelativePath(relativePath)) {
      ownerUploadState.filesByPath.set(relativePath, {
        handle: node.handle,
        size: node.size,
      });
    }
  });
}

function visitMegaTreeSync(
  tree: DecryptedMegaTree,
  parentHandle: string,
  parentPath: string,
  visitor: (relativePath: string, node: DecryptedMegaNode) => void
): void {
  const children = [...(tree.childrenByParent.get(parentHandle) ?? [])].sort((left, right) =>
    compareMegaNodeCandidates(tree, left, right)
  );
  for (const child of children) {
    const relativePath = parentPath ? `${parentPath}/${child.name}` : child.name;
    visitor(relativePath, child);
    if (child.isFolder) {
      visitMegaTreeSync(tree, child.handle, relativePath, visitor);
    }
  }
}

function buildMegaSetShareCommand(
  ownerRoot: MegaOwnerRemoteRoot,
  session: MegaSession,
  invitee: MegaShareInviteTarget,
  accessLevel: number,
  options: {
    readonly includeNodeKeyRecords?: boolean;
    readonly shareKey?: Buffer;
    readonly secureMode?: boolean;
  } = {}
): {
  readonly command: Record<string, unknown>;
  readonly shareKey: Buffer;
} {
  const shareKey = Buffer.from(options.shareKey ?? randomBytes(16));
  const zeroOwnerKey = encodeMegaBase64Url(Buffer.alloc(16, 0));
  const command: Record<string, unknown> = {
    a: 's2',
    n: ownerRoot.root.handle,
    ok: zeroOwnerKey,
    ha: zeroOwnerKey,
    s: [
      {
        u: invitee.u,
        r: accessLevel,
      },
    ],
  };
  if (!options.secureMode) {
    const shareHandleBytes = decodeMegaBase64Url(ownerRoot.root.handle);
    const paddedShareHandle = Buffer.alloc(16, 0);
    shareHandleBytes.copy(paddedShareHandle, 0, 0, Math.min(shareHandleBytes.length, 16));
    command.ok = encodeMegaBase64Url(encryptAesEcb(shareKey, session.masterKey));
    command.ha = encodeMegaBase64Url(encryptAesEcb(paddedShareHandle, shareKey));
  }
  if (invitee.e) {
    command.e = invitee.e;
  }
  if (options.includeNodeKeyRecords !== false) {
    command.cr = buildMegaShareNodeKeyRecords(ownerRoot, shareKey);
  }
  return { command, shareKey };
}

/** MEGA SDK: `ACCESS_UNKNOWN` removes access — `s2` omits `ok`/`ha`/`r` (see CommandSetShare). */
function buildMegaRevokeShareCommand(sharedFolderNodeHandle: string, invitee: MegaShareInviteTarget): Record<string, unknown> {
  const command: Record<string, unknown> = {
    a: 's2',
    n: sharedFolderNodeHandle,
    s: [
      {
        u: invitee.u,
      },
    ],
  };
  if (invitee.e) {
    command.e = invitee.e;
  }
  return command;
}

function buildMegaShareNodeKeyRecords(ownerRoot: MegaOwnerRemoteRoot, shareKey: Buffer): readonly unknown[] {
  const shareHandles = [ownerRoot.root.handle];
  const itemHandles: string[] = [];
  const records: Array<number | string> = [];
  const nodes = [ownerRoot.root, ...collectChildNodes(ownerRoot.tree, ownerRoot.root.handle)];
  for (const node of nodes) {
    const itemIndex = itemHandles.length;
    itemHandles.push(node.handle);
    records.push(0, itemIndex, encodeMegaBase64Url(encryptAesEcb(node.nodeKey, shareKey)));
  }
  return [shareHandles, itemHandles, records];
}

function buildMegaChildNodeShareRecords(
  shareCrypto: MegaShareCryptoContext,
  nodeHandle: string,
  nodeKey: Buffer
): readonly unknown[] {
  return [
    [shareCrypto.shareHandle],
    [nodeHandle],
    [0, 0, encodeMegaBase64Url(encryptAesEcb(nodeKey, shareCrypto.shareKey))],
  ];
}

function collectChildNodes(tree: DecryptedMegaTree, parentHandle: string): DecryptedMegaNode[] {
  const result: DecryptedMegaNode[] = [];
  const pending = [...(tree.childrenByParent.get(parentHandle) ?? [])];
  while (pending.length > 0) {
    const current = pending.shift();
    if (!current) {
      continue;
    }
    result.push(current);
    pending.unshift(...(tree.childrenByParent.get(current.handle) ?? []));
  }
  return result;
}

/**
 * Detect duplicate file nodes under the same parent (same name) and return
 * the handles of the extras that should be deleted. Keeps the node with the
 * largest size (or most recent modifiedAt as tiebreaker).
 */
function collectDuplicateSiblingFileHandles(tree: DecryptedMegaTree): string[] {
  const toDelete: string[] = [];
  for (const [, children] of tree.childrenByParent) {
    const filesByName = new Map<string, DecryptedMegaNode[]>();
    for (const child of children) {
      if (child.isFolder) continue;
      const key = child.name;
      const group = filesByName.get(key);
      if (group) {
        group.push(child);
      } else {
        filesByName.set(key, [child]);
      }
    }
    for (const [, group] of filesByName) {
      if (group.length <= 1) continue;
      group.sort((a, b) => {
        if (a.size !== b.size) return b.size - a.size;
        const aTime = a.modifiedAt ?? 0;
        const bTime = b.modifiedAt ?? 0;
        if (aTime !== bTime) return bTime - aTime;
        return a.handle.localeCompare(b.handle);
      });
      for (let i = 1; i < group.length; i++) {
        toDelete.push(group[i].handle);
      }
    }
  }
  return toDelete;
}

function compareMegaNodeCandidates(tree: DecryptedMegaTree, left: DecryptedMegaNode, right: DecryptedMegaNode): number {
  const leftScore = scoreMegaNodeCandidate(tree, left);
  const rightScore = scoreMegaNodeCandidate(tree, right);
  if (leftScore !== rightScore) {
    return rightScore - leftScore;
  }
  const leftModifiedAt = left.modifiedAt ?? 0;
  const rightModifiedAt = right.modifiedAt ?? 0;
  if (leftModifiedAt !== rightModifiedAt) {
    return rightModifiedAt - leftModifiedAt;
  }
  return left.handle.localeCompare(right.handle);
}

function scoreMegaNodeCandidate(tree: DecryptedMegaTree, node: DecryptedMegaNode): number {
  if (!node.isFolder) {
    return 0;
  }
  const children = [...(tree.childrenByParent.get(node.handle) ?? [])];
  const childNames = new Set(children.map((child) => child.name));
  const descendantCount = collectChildNodes(tree, node.handle).length;
  const expectedTopLevelChildren = Number(childNames.has('blocks')) + Number(childNames.has('channels'));
  const directChildCount = children.length;
  return expectedTopLevelChildren * 1_000_000 + directChildCount * 1_000 + descendantCount;
}

async function fetchMegaNodesSnapshot(
  apiClient: MegaApiClient,
  session: MegaSession,
  partialRoot?: string,
  options: {
    readonly useCache?: boolean;
  } = {},
  signal?: AbortSignal
): Promise<MegaFetchNodesSnapshot> {
  const response = await withMegaApiRetry(
    () => requestMegaNodesSnapshot(apiClient, session, partialRoot, options, signal),
    signal
  );
  return parseMegaFetchNodesSnapshot(response);
}

async function requestMegaNodesSnapshot(
  apiClient: MegaApiClient,
  session: MegaSession,
  partialRoot?: string,
  options: {
    readonly useCache?: boolean;
  } = {},
  signal?: AbortSignal
): Promise<Record<string, unknown>> {
  touchMegaSyncActivity(signal);
  const result = await apiClient.requestSingle<Record<string, unknown> | number>(
    buildMegaFetchNodesCommand({
      ...(partialRoot ? { partialRoot } : {}),
      ...(options.useCache === false ? { useCache: false } : {}),
    }),
    { sessionId: session.sid, signal }
  );
  if (typeof result === 'number') {
    const error = new Error(`MEGA API error ${result}.`) as MegaApiError;
    error.code = result;
    throw error;
  }
  return result;
}

async function fetchMegaKeyManagerState(
  apiClient: MegaApiClient,
  session: MegaSession,
  signal?: AbortSignal,
  logger?: Pick<IntegrationRuntime['logger'], 'warn'>
): Promise<MegaKeyManagerState> {
  try {
    const response = await withMegaApiRetry(async () => {
      const result = await apiClient.requestSingle<Record<string, unknown> | number>(
        { a: 'uga', u: session.userHandle, ua: '^!keys', v: 1 },
        { sessionId: session.sid, signal }
      );
      if (typeof result === 'number') {
        const error = new Error(`MEGA API error ${result}.`) as MegaApiError;
        error.code = result;
        throw error;
      }
      return result;
    }, signal);
    return parseMegaKeyManagerState(response, session.masterKey);
  } catch (error) {
    if ((error as MegaApiError | undefined)?.code !== -9) {
      logger?.warn?.('MEGA key-manager state fetch failed.', {
        email: session.email,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return {
      shareKeys: new Map(),
      pendingInShares: new Map(),
      authRingEd25519: new Map(),
      privateCu25519: undefined,
      records: [],
    };
  }
}

async function fetchMegaPrivateAttributeRecords(
  apiClient: MegaApiClient,
  session: MegaSession,
  attributeName: string,
  signal?: AbortSignal,
  logger?: Pick<IntegrationRuntime['logger'], 'warn'>
): Promise<ReadonlyMap<string, Buffer> | null> {
  try {
    const response = await withMegaApiRetry(async () => {
      const result = await apiClient.requestSingle<Record<string, unknown> | number>(
        { a: 'uga', u: session.userHandle, ua: attributeName, v: 1 },
        { sessionId: session.sid, signal }
      );
      if (typeof result === 'number') {
        const error = new Error(`MEGA API error ${result}.`) as MegaApiError;
        error.code = result;
        throw error;
      }
      return result;
    }, signal);

    const encodedValue = typeof response.av === 'string' ? response.av.trim() : '';
    if (!encodedValue) {
      return null;
    }
    return parseMegaPrivateAttributeRecords(decodeMegaBase64Url(encodedValue), session.masterKey);
  } catch (error) {
    if ((error as MegaApiError | undefined)?.code !== -9) {
      logger?.warn?.('MEGA private attribute fetch failed during ^!keys recovery.', {
        email: session.email,
        attributeName,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return null;
  }
}

async function fetchMegaPrivateAttributeValue(
  apiClient: MegaApiClient,
  session: MegaSession,
  attributeName: string,
  recordName: string,
  signal?: AbortSignal,
  logger?: Pick<IntegrationRuntime['logger'], 'warn'>
): Promise<Buffer | null> {
  const records = await fetchMegaPrivateAttributeRecords(apiClient, session, attributeName, signal, logger);
  const value = records?.get(recordName);
  return value ? Buffer.from(value) : null;
}

async function fetchMegaDecryptedTree(
  apiClient: MegaApiClient,
  session: MegaSession,
  rootHandle?: string,
  options: {
    readonly useCache?: boolean;
    readonly allowTransientFullFallback?: boolean;
    readonly fastPartialFallback?: boolean;
    readonly extraShareKeys?: ReadonlyMap<string, Buffer>;
    readonly expectedRootName?: string;
  } = {},
  signal?: AbortSignal,
  logger?: Pick<IntegrationRuntime['logger'], 'warn'>
): Promise<MegaFetchedTree> {
  let snapshot: MegaFetchNodesSnapshot;
  if (rootHandle) {
    try {
      snapshot = options.fastPartialFallback
        ? parseMegaFetchNodesSnapshot(await requestMegaNodesSnapshot(apiClient, session, rootHandle, options, signal))
        : await fetchMegaNodesSnapshot(apiClient, session, rootHandle, options, signal);
    } catch (error) {
      const transientPartialFetchFailure =
        isMegaTemporaryLockError(error) || isMegaRateLimitedError(error) || isMegaRetryableTransportError(error);
      if (transientPartialFetchFailure && options.allowTransientFullFallback !== true) {
        throw error;
      }
      if (!transientPartialFetchFailure && !isMegaAccessDeniedError(error)) {
        throw error;
      }
      logger?.warn?.('MEGA partial tree fetch failed; falling back to a full node snapshot.', {
        email: session.email,
        rootHandle,
        message: error instanceof Error ? error.message : String(error),
      });
      snapshot = await fetchMegaNodesSnapshot(apiClient, session, undefined, options, signal);
    }
  } else {
    snapshot = await fetchMegaNodesSnapshot(apiClient, session, undefined, options, signal);
  }

  const keyManager = await fetchMegaKeyManagerState(apiClient, session, signal, logger);
  const pendingKeys = snapshotIncludesIncomingShareNodes(snapshot)
    ? await fetchMegaPendingInShareKeys(apiClient, session, signal, logger)
    : new Map<string, MegaPendingInShareRecord>();
  const mergedKeyManager: MegaKeyManagerState = {
    ...keyManager,
    pendingInShares: mergeMegaPendingInShares(keyManager.pendingInShares, pendingKeys),
  };
  const resolveShareKeysForSnapshot = async (activeSnapshot: MegaFetchNodesSnapshot): Promise<ReadonlyMap<string, Buffer>> =>
    mergeMegaShareKeyMaps(
      options.extraShareKeys,
      await resolveMegaKeyManagerShareKeys(apiClient, session, mergedKeyManager, signal, logger, activeSnapshot)
    );
  const shareKeys = await resolveShareKeysForSnapshot(snapshot);
  const expectedRootHandle = rootHandle?.trim() || resolveMegaCloudDriveHandle(snapshot);
  const treeOptions: MegaDecryptTreeOptions = {
    expectedRootHandle,
    expectedRootName: options.expectedRootName,
  };
  try {
    return {
      snapshot,
      tree: decryptMegaTree(snapshot, session, treeOptions, shareKeys, logger),
    };
  } catch (error) {
    if (
      !expectedRootHandle ||
      !(error instanceof Error) ||
      error.message !== 'MEGA tree did not include the requested root node.'
    ) {
      throw error;
    }
    logger?.warn?.('MEGA partial tree decryption missed the requested root; falling back to a full node snapshot.', {
      email: session.email,
      rootHandle: expectedRootHandle,
    });
    const fullSnapshot = await fetchMegaNodesSnapshot(apiClient, session, undefined, options, signal);
    const fullShareKeys = await resolveShareKeysForSnapshot(fullSnapshot);
    return {
      snapshot: fullSnapshot,
      tree: decryptMegaTree(fullSnapshot, session, treeOptions, fullShareKeys, logger),
    };
  }
}

async function findMegaRemoteChildNode(
  apiClient: MegaApiClient,
  session: MegaSession,
  parentHandle: string,
  name: string,
  folderOnly: boolean,
  signal?: AbortSignal,
  extraShareKeys?: ReadonlyMap<string, Buffer>
): Promise<DecryptedMegaNode | undefined> {
  try {
    const fetched = await fetchMegaDecryptedTree(apiClient, session, parentHandle, { extraShareKeys }, signal);
    return findChildNodeByName(fetched.tree, parentHandle, name, folderOnly);
  } catch (error) {
    if (!isMegaMissingRequestedRootError(error)) {
      throw error;
    }
    const fetched = await fetchMegaDecryptedTree(apiClient, session, undefined, { extraShareKeys }, signal);
    return findChildNodeByName(fetched.tree, parentHandle, name, folderOnly);
  }
}


function snapshotIncludesIncomingShareNodes(snapshot: MegaFetchNodesSnapshot): boolean {
  return snapshot.nodes.some((node) => {
    const sharingUser = (node as Record<string, unknown>).su;
    return typeof sharingUser === 'string' && sharingUser.trim() !== '';
  });
}

async function waitForMegaChildNode(
  apiClient: MegaApiClient,
  session: MegaSession,
  parentHandle: string,
  name: string,
  folderOnly: boolean,
  signal?: AbortSignal,
  extraShareKeys?: ReadonlyMap<string, Buffer>
): Promise<DecryptedMegaNode | undefined> {
  for (let attempt = 0; attempt < MEGA_NODE_APPEAR_ATTEMPTS; attempt += 1) {
    const node = await findMegaRemoteChildNode(apiClient, session, parentHandle, name, folderOnly, signal, extraShareKeys);
    if (node) {
      return node;
    }
    if (attempt < MEGA_NODE_APPEAR_DELAYS_MS.length) {
      await waitForMegaRetry(MEGA_NODE_APPEAR_DELAYS_MS[attempt]!, signal);
    }
  }
  return undefined;
}

async function fetchOwnerRootByPath(
  apiClient: MegaApiClient,
  session: MegaSession,
  remotePath: string,
  signal?: AbortSignal
): Promise<MegaOwnerRemoteRoot> {
  const snapshot = await fetchMegaNodesSnapshot(apiClient, session, undefined, { useCache: false }, signal);
  const cloudHandle = resolveMegaCloudDriveHandle(snapshot);
  if (!cloudHandle) {
    throw new Error('MEGA snapshot did not include a Cloud Drive root.');
  }

  let currentHandle = cloudHandle;
  const segments = normalizeMegaRemoteDisplayPath(remotePath).split('/').filter((entry) => entry.length > 0);
  for (const segment of segments) {
    const fetched = await fetchMegaDecryptedTree(
      apiClient,
      session,
      currentHandle,
      { useCache: false, allowTransientFullFallback: false },
      signal
    );
    const next = findChildNodeByName(fetched.tree, currentHandle, segment, true);
    if (!next) {
      throw new Error(`MEGA path ${remotePath} is missing ${segment}.`);
    }
    currentHandle = next.handle;
  }

  const fetched = await fetchMegaDecryptedTree(
    apiClient,
    session,
    currentHandle,
    { useCache: false, allowTransientFullFallback: false },
    signal
  );
  return {
    path: normalizeMegaRemoteDisplayPath(remotePath),
    root: fetched.tree.root,
    tree: fetched.tree,
  };
}

async function createMegaFolder(
  apiClient: MegaApiClient,
  session: MegaSession,
  parentHandle: string,
  name: string,
  shareCrypto: MegaShareCryptoContext | undefined,
  signal?: AbortSignal,
  extraShareKeys?: ReadonlyMap<string, Buffer>
): Promise<string> {
  for (let attempt = 0; attempt < MEGA_CREATE_RECOVERY_ATTEMPTS; attempt += 1) {
    const nodeKey = randomBytes(16);
    try {
      console.log('[MEGA:create-folder] request context.', {
        parentHandle,
        name,
        attempt,
        shareHandle: shareCrypto?.shareHandle,
        shareKeyLength: shareCrypto?.shareKey.length ?? 0,
      });
      const request = {
        a: 'p',
        ...(shareCrypto ? { v: 3, sm: 1 } : {}),
        t: parentHandle,
        i: createMegaMutationRequestId(),
        ...(shareCrypto ? { cr: buildMegaChildNodeShareRecords(shareCrypto, MEGA_PUT_NODES_PLACEHOLDER_HANDLE, nodeKey) } : {}),
        n: [
          {
            h: MEGA_PUT_NODES_PLACEHOLDER_HANDLE,
            t: 1,
            a: encryptMegaAttributes(name, nodeKey),
            k: encodeMegaBase64Url(encryptMegaNodeKeyForOwner(nodeKey, session.masterKey)),
          },
        ],
      } satisfies Record<string, unknown>;
      debugMegaLog('[MEGA:create-folder] sending create request.', {
        parentHandle,
        name,
        attempt,
        shareHandle: shareCrypto?.shareHandle,
        cr: request.cr ?? null,
      });
      touchMegaSyncActivity(signal);
      const response = await apiClient.requestSingle<Record<string, unknown> | number>(request, { sessionId: session.sid, signal });
      debugMegaLog('[MEGA:create-folder] create response received.', {
        parentHandle,
        name,
        attempt,
        createdNode:
          typeof response === 'object' && response !== null && Array.isArray((response as { f?: unknown }).f)
            ? ((response as { f: unknown[] }).f[0] ?? null)
            : null,
      });
      if (typeof response === 'number' && response !== 0) {
        const error = new Error(`MEGA API error ${response}.`) as MegaApiError;
        error.code = response;
        throw error;
      }
      const committedNode = await waitForMegaChildNode(apiClient, session, parentHandle, name, true, signal, extraShareKeys);
      if (!committedNode || !committedNode.isFolder) {
        throw new Error(`MEGA did not make the created folder visible for ${name}.`);
      }
      debugMegaLog('[MEGA:create-folder] folder became visible in the target subtree.', {
        parentHandle,
        name,
        attempt,
        handle: committedNode.handle,
      });
      return committedNode.handle;
    } catch (error) {
      console.warn('[MEGA:create-folder] create attempt failed.', {
        parentHandle,
        name,
        attempt,
        message: error instanceof Error ? error.message : String(error),
      });
      const recovered = await tryFindMegaRemoteChildNode(
        apiClient,
        session,
        parentHandle,
        name,
        true,
        signal,
        extraShareKeys
      );
      if (recovered?.isFolder) {
        return recovered.handle;
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

async function uploadMegaOwnerFile(
  fetchImpl: typeof fetch,
  apiClient: MegaApiClient,
  session: MegaSession,
  parentHandle: string,
  name: string,
  data: Buffer,
  shareCrypto: MegaShareCryptoContext | undefined,
  signal?: AbortSignal,
  extraShareKeys?: ReadonlyMap<string, Buffer>,
  options: {
    readonly waitForVisibility?: boolean;
  } = {}
): Promise<DecryptedMegaNode> {
  const waitForVisibility = options.waitForVisibility !== false;
  for (let attempt = 0; attempt < MEGA_UPLOAD_RECOVERY_ATTEMPTS; attempt += 1) {
    try {
      const transferKey = randomBytes(16);
      const iv = randomBytes(8);
      console.log('[MEGA:upload-file] request context.', {
        parentHandle,
        name,
        attempt,
        dataSize: data.length,
        shareHandle: shareCrypto?.shareHandle,
        shareKeyLength: shareCrypto?.shareKey.length ?? 0,
      });

      touchMegaSyncActivity(signal);
      const uploadReservation = await apiClient.requestSingle<Record<string, unknown> | number>(
        {
          a: 'u',
          ssl: 2,
          v: 2,
          s: data.length,
          t: [parentHandle],
        },
        { sessionId: session.sid, signal }
      );
      if (typeof uploadReservation === 'number') {
        const error = new Error(`MEGA API error ${uploadReservation}.`) as MegaApiError;
        error.code = uploadReservation;
        throw error;
      }

      const uploadUrl = assertString(uploadReservation.p, `MEGA did not return an upload URL for ${name}.`);
      const encrypted = encryptMegaFileContent(data, transferKey, iv);
      const crc = computeMegaUploadChecksum(encrypted);
      touchMegaSyncActivity(signal);
      const uploadResponse = await fetchImpl(`${uploadUrl}/0?d=${encodeMegaBase64Url(crc)}`, {
        method: 'POST',
        body: new Uint8Array(encrypted),
        signal,
      });
      if (!uploadResponse.ok) {
        throw new Error(`MEGA upload failed with HTTP ${uploadResponse.status}.`);
      }
      const uploadToken = Buffer.from(await uploadResponse.arrayBuffer());
      if (uploadToken.length === 0) {
        throw new Error(`MEGA did not return an upload token for ${name}.`);
      }

      const sentNodeKey = buildMegaFileNodeKey(transferKey, iv, computeMegaMetaMac(data, transferKey, iv));
      const uploadHandle = normalizeMegaUploadTokenHandle(uploadToken);
      touchMegaSyncActivity(signal);
      const response = await apiClient.requestSingle<Record<string, unknown> | number>(
        {
          a: 'p',
          v: 3,
          ...(shareCrypto ? { sm: 1 } : {}),
          t: parentHandle,
          i: createMegaMutationRequestId(),
          ...(shareCrypto ? { cr: buildMegaChildNodeShareRecords(shareCrypto, uploadHandle, sentNodeKey) } : {}),
          n: [
            {
              h: uploadHandle,
              t: 0,
              a: encryptMegaAttributes(name, transferKey),
              k: encodeMegaBase64Url(encryptMegaNodeKeyForOwner(sentNodeKey, session.masterKey)),
            },
          ],
        },
        { sessionId: session.sid, signal }
      );
      if (typeof response === 'number' && response !== 0) {
        const error = new Error(`MEGA API error ${response}.`) as MegaApiError;
        error.code = response;
        throw error;
      }
      if (!waitForVisibility) {
        return {
          handle: uploadHandle,
          parentHandle,
          nodeType: 0,
          isFolder: false,
          size: data.length,
          name,
          nodeKey: sentNodeKey,
        };
      }
      const committedNode = await waitForMegaChildNode(apiClient, session, parentHandle, name, false, signal, extraShareKeys);
      if (!committedNode || committedNode.isFolder) {
        throw new Error(`MEGA did not make the uploaded file visible for ${name}.`);
      }
      return committedNode;
    } catch (error) {
      const recovered = await tryFindMegaRemoteChildNode(
        apiClient,
        session,
        parentHandle,
        name,
        false,
        signal,
        extraShareKeys
      );
      if (recovered && !recovered.isFolder) {
        return recovered;
      }
      if (
        !isMegaRetryableApiError(error) &&
        !isMegaRetryableTransportError(error) &&
        !isMegaEventuallyConsistentMutationError(error)
      ) {
        throw error;
      }
      if (attempt >= MEGA_UPLOAD_RECOVERY_ATTEMPTS - 1) {
        throw error;
      }
      await waitForMegaRetry(getMegaRetryDelayMs(error, attempt), signal);
    }
  }
  throw new Error(`MEGA did not upload ${name}.`);
}

async function deleteMegaNode(
  apiClient: MegaApiClient,
  session: MegaSession,
  nodeHandle: string,
  signal?: AbortSignal
): Promise<void> {
  for (let attempt = 0; attempt < MEGA_UPLOAD_RECOVERY_ATTEMPTS; attempt += 1) {
    try {
      touchMegaSyncActivity(signal);
      const response = await apiClient.requestSingle<Record<string, unknown> | number>(
        { a: 'd', i: createMegaMutationRequestId(), n: nodeHandle },
        { sessionId: session.sid, signal }
      );
      if (typeof response === 'number' && response !== 0) {
        const error = new Error(`MEGA API error ${response}.`) as MegaApiError;
        error.code = response;
        throw error;
      }
      return;
    } catch (error) {
      if (!isMegaRetryableApiError(error) && !isMegaRetryableTransportError(error)) {
        throw error;
      }
      if (attempt >= MEGA_UPLOAD_RECOVERY_ATTEMPTS - 1) {
        throw error;
      }
      await waitForMegaRetry(getMegaRetryDelayMs(error, attempt), signal);
    }
  }
}

async function tryFindMegaRemoteChildNode(
  apiClient: MegaApiClient,
  session: MegaSession,
  parentHandle: string,
  name: string,
  folderOnly: boolean,
  signal?: AbortSignal,
  extraShareKeys?: ReadonlyMap<string, Buffer>
): Promise<DecryptedMegaNode | undefined> {
  try {
    return await findMegaRemoteChildNode(apiClient, session, parentHandle, name, folderOnly, signal, extraShareKeys);
  } catch (error) {
    if (isMegaRetryableApiError(error) || isMegaRetryableTransportError(error)) {
      return undefined;
    }
    throw error;
  }
}

function encryptMegaNodeKeyForOwner(nodeKey: Buffer, masterKey: Buffer): Buffer {
  return encryptAesEcb(nodeKey, masterKey);
}

function createMegaMutationRequestId(): number {
  return randomBytes(4).readUInt32BE(0);
}

function normalizeMegaUploadTokenHandle(uploadToken: Buffer): string {
  const ascii = uploadToken.toString('utf8').trim();
  if (/^[A-Za-z0-9_-]{6,}$/u.test(ascii)) {
    return ascii;
  }
  return encodeMegaBase64Url(uploadToken);
}

function encryptMegaAttributes(name: string, key: Buffer): string {
  const raw = Buffer.from(`MEGA${JSON.stringify({ n: name })}`, 'utf8');
  const paddedLength = Math.ceil(raw.length / 16) * 16;
  const padded = Buffer.concat([raw, Buffer.alloc(paddedLength - raw.length, 0)]);
  return encodeMegaBase64Url(Buffer.from(nobleAesCbc(key.subarray(0, 16), ZERO_IV, { disablePadding: true }).encrypt(padded)));
}

function encryptMegaFileContent(data: Buffer, transferKey: Buffer, iv: Buffer): Buffer {
  const counter = Buffer.alloc(16, 0);
  iv.copy(counter, 0);
  return Buffer.from(nobleAesCtr(transferKey, counter).encrypt(data));
}

function buildMegaFileNodeKey(transferKey: Buffer, iv: Buffer, metaMac: Buffer): Buffer {
  const secondHalf = Buffer.concat([iv.subarray(0, 8), metaMac.subarray(0, 8)]);
  return Buffer.concat([xorBuffers(transferKey, secondHalf), secondHalf]);
}

function computeMegaMetaMac(data: Buffer, transferKey: Buffer, iv: Buffer): Buffer {
  const cipher = transferKey.subarray(0, 16);
  const chunkMacs: Buffer[] = [];
  let offset = 0;
  while (offset < data.length) {
    const end = Math.min(nextMegaChunkBoundary(offset), data.length);
    chunkMacs.push(computeMegaChunkMac(data.subarray(offset, end), cipher, iv));
    offset = end;
  }

  let mac: Buffer = Buffer.alloc(16, 0);
  for (const chunkMac of chunkMacs) {
    mac = encryptAesEcb(xorBuffers(mac, chunkMac), cipher) as Buffer;
  }
  mac = Buffer.from(mac);
  mac.writeUInt32LE((mac.readUInt32LE(0) ^ mac.readUInt32LE(4)) >>> 0, 0);
  mac.writeUInt32LE((mac.readUInt32LE(8) ^ mac.readUInt32LE(12)) >>> 0, 4);
  return mac.subarray(0, 8);
}

function computeMegaChunkMac(chunk: Buffer, transferKey: Buffer, iv: Buffer): Buffer {
  const mac = Buffer.concat([iv.subarray(0, 8), iv.subarray(0, 8)]);
  for (let offset = 0; offset < chunk.length; offset += 16) {
    const block = Buffer.alloc(16, 0);
    chunk.copy(block, 0, offset, Math.min(offset + 16, chunk.length));
    mac.set(encryptAesEcb(xorBuffers(block, mac), transferKey));
  }
  return mac;
}

function nextMegaChunkBoundary(position: number): number {
  const segmentSize = 131_072;
  let chunkStart = 0;
  for (let multiplier = 1; multiplier <= 8; multiplier += 1) {
    const chunkEnd = chunkStart + multiplier * segmentSize;
    if (position >= chunkStart && position < chunkEnd) {
      return chunkEnd;
    }
    chunkStart = chunkEnd;
  }
  return Math.floor((position - chunkStart) / (8 * segmentSize)) * (8 * segmentSize) + chunkStart + 8 * segmentSize;
}

function computeMegaUploadChecksum(data: Buffer): Buffer {
  const crc = Buffer.alloc(12, 0);
  let offset = 0;
  const alignedBytes = data.length - (data.length % crc.length);
  while (offset < alignedBytes) {
    for (let index = 0; index < crc.length; index += 1) {
      crc[index] = crc[index]! ^ data[offset + index]!;
    }
    offset += crc.length;
  }
  for (let index = 0; offset + index < data.length; index += 1) {
    crc[index] = crc[index]! ^ data[offset + index]!;
  }
  return crc;
}

function describeMegaOwnerSyncFailure(error: unknown, remotePath: string): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/timed out/i.test(message)) {
    return `Nearbytes timed out while syncing the MEGA owner folder ${remotePath}. Open the runtime logs and retry.`;
  }
  if (/login|session|auth|credential|password/i.test(message)) {
    return `Nearbytes could not refresh the saved MEGA sign-in for the writable owner sync at ${remotePath}. It will retry automatically. ${message}`.trim();
  }
  return `Nearbytes could not sync the writable MEGA owner folder ${remotePath}. ${message}`.trim();
}

function annotateMegaOwnerSyncPhaseError(phase: string, error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`${phase}: ${message}`);
}

function normalizeMegaRemoteDisplayPath(value: string): string {
  const trimmed = value.trim().replace(/\\/g, '/');
  if (!trimmed) {
    return '/';
  }
  const normalized = path.posix.normalize(trimmed);
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

function mapIncomingMegaContactInvite(
  invite: Record<string, unknown>,
  accountId: string,
  provider: string
): IncomingProviderContactInvite | null {
  const id = typeof invite.p === 'string' ? invite.p.trim() : '';
  const label = typeof invite.m === 'string' ? invite.m.trim() : '';
  if (!id || !label) {
    return null;
  }
  return {
    id,
    provider,
    accountId,
    label,
    detail: `${label} wants to connect on MEGA.`,
  };
}

function deserializeSession(secret: MegaAccountSecret, fallbackEmail = ''): MegaSession {
  const masterKey = decodeMegaBase64Url(secret.masterKey);
  const encryptedPrivateKey = typeof secret.encryptedPrivateKey === 'string' && secret.encryptedPrivateKey.trim() !== ''
    ? secret.encryptedPrivateKey.trim()
    : undefined;
  return {
    email: typeof secret.email === 'string' && secret.email.trim() !== '' ? secret.email : fallbackEmail,
    password: secret.password,
    mfaCode: secret.mfaCode,
    sid: secret.sid,
    masterKey,
    encryptedPrivateKey,
    privateKey: encryptedPrivateKey
      ? decodeMegaPrivateKey(decryptMegaPrivateKey(decodeMegaBase64Url(encryptedPrivateKey), masterKey))
      : undefined,
    userHandle: secret.userHandle,
    accountVersion: secret.accountVersion,
    accountSalt: secret.accountSalt,
  };
}

function encodePersistedMegaShareKeys(shareKeys: ReadonlyMap<string, Buffer> | undefined): Record<string, string> | undefined {
  if (!shareKeys || shareKeys.size === 0) {
    return undefined;
  }
  const encoded: Record<string, string> = {};
  for (const [handleRaw, shareKey] of shareKeys.entries()) {
    const handle = handleRaw.trim();
    if (!handle || shareKey.length === 0) {
      continue;
    }
    encoded[handle] = encodeMegaBase64Url(Buffer.from(shareKey));
  }
  return Object.keys(encoded).length > 0 ? encoded : undefined;
}

function decodePersistedMegaShareKeys(value: unknown): ReadonlyMap<string, Buffer> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return new Map();
  }
  const decoded = new Map<string, Buffer>();
  for (const [handleRaw, shareKeyRaw] of Object.entries(value)) {
    const handle = handleRaw.trim();
    const encodedShareKey = typeof shareKeyRaw === 'string' ? shareKeyRaw.trim() : '';
    if (!handle || !encodedShareKey) {
      continue;
    }
    try {
      const shareKey = decodeMegaBase64Url(encodedShareKey);
      if (shareKey.length === 16) {
        decoded.set(handle, shareKey);
      }
    } catch {
      // Ignore malformed persisted share-key entries.
    }
  }
  return decoded;
}

function isStoredMegaAccountSecret(secret: unknown): secret is MegaAccountSecret {
  if (!secret || typeof secret !== 'object') {
    return false;
  }
  const candidate = secret as Partial<MegaAccountSecret>;
  return (
    typeof candidate.sid === 'string' &&
    candidate.sid.trim() !== '' &&
    typeof candidate.masterKey === 'string' &&
    candidate.masterKey.trim() !== '' &&
    typeof candidate.userHandle === 'string' &&
    candidate.userHandle.trim() !== '' &&
    typeof candidate.accountVersion === 'number' &&
    Number.isFinite(candidate.accountVersion)
  );
}

function extractMegaReusableCredentials(
  secret: unknown,
  fallbackEmail = ''
): { email: string; password: string; mfaCode?: string } | null {
  if (!secret || typeof secret !== 'object') {
    return null;
  }
  const candidate = secret as Partial<MegaAccountSecret>;
  const email = (typeof candidate.email === 'string' && candidate.email.trim() !== '' ? candidate.email : fallbackEmail).trim();
  const password = typeof candidate.password === 'string' ? candidate.password : '';
  const mfaCode = typeof candidate.mfaCode === 'string' && candidate.mfaCode.trim() !== '' ? candidate.mfaCode.trim() : undefined;
  if (!email || !password) {
    return null;
  }
  return { email, password, mfaCode };
}

function acceptedShareCapabilities(descriptor: Record<string, unknown>): string[] {
  return megaAccessLevelAllowsWrites(getStringDescriptor(descriptor, 'accessLevel'))
    ? ['mirror', 'read', 'write', 'accept']
    : ['mirror', 'read', 'accept'];
}

function resolveMegaInviteAccessLevel(accessLevel: string | undefined): number {
  const normalized = accessLevel?.trim().toLowerCase() ?? '';
  switch (normalized) {
    case 'read/write':
      return MEGA_SHARE_ACCESS_LEVEL_READ_WRITE;
    case 'full access':
      return MEGA_SHARE_ACCESS_LEVEL_FULL;
    default:
      return MEGA_SHARE_ACCESS_LEVEL_READ_ONLY;
  }
}

function megaAccessLevelAllowsWrites(accessLevel: string | undefined): boolean {
  const normalized = accessLevel?.trim().toLowerCase() ?? '';
  return normalized === 'read/write' || normalized === 'full access' || normalized === 'owner';
}

function incomingShareMatches(candidate: Record<string, unknown>, target: Record<string, unknown>): boolean {
  const candidateHandle = getStringDescriptor(candidate, 'rootHandle') ?? getStringDescriptor(candidate, 'shareHandle');
  const targetHandle = getStringDescriptor(target, 'rootHandle') ?? getStringDescriptor(target, 'shareHandle');
  if (candidateHandle && targetHandle) {
    return candidateHandle === targetHandle;
  }
  return (
    getStringDescriptor(candidate, 'remotePath') === getStringDescriptor(target, 'remotePath') &&
    getStringDescriptor(candidate, 'ownerEmail') === getStringDescriptor(target, 'ownerEmail')
  );
}

function buildOwnerShareHealCooldownKey(shareId: string, shareHandle: string | undefined): string {
  const normalizedHandle = typeof shareHandle === 'string' ? shareHandle.trim().toLowerCase() : '';
  return normalizedHandle ? `${shareId}:${normalizedHandle}` : shareId;
}

function getMegaApiErrorCode(error: unknown): number | null {
  const direct = typeof (error as MegaApiError | undefined)?.code === 'number' ? (error as MegaApiError).code : null;
  if (direct !== null && Number.isFinite(direct)) {
    return Math.trunc(direct);
  }
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/MEGA API error\s+(-?\d+)/i);
  return match ? Number.parseInt(match[1]!, 10) : null;
}

function isMegaSessionInvalid(error: unknown): boolean {
  const code = getMegaApiErrorCode(error);
  if (code === -15) {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /MEGA API error -15|session|auth|login/i.test(message);
}

function isMegaRetryableApiError(error: unknown): error is MegaApiError {
  const code = getMegaApiErrorCode(error);
  return code !== null && MEGA_RETRYABLE_API_ERROR_CODES.has(code);
}

function isMegaTemporaryLockError(error: unknown): boolean {
  const code = getMegaApiErrorCode(error);
  return code === -3;
}

function normalizeMegaConnectError(error: unknown, email: string): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (/HTTP 402\b/i.test(message)) {
    return new Error(
      `MEGA refused login for ${email} (HTTP 402). Verify the account on mega.io (captcha, security check, account lock, or temporary service restriction), then retry in Nearbytes.`
    );
  }
  return error instanceof Error ? error : new Error(message);
}

function isMegaTransientSyncError(error: unknown): boolean {
  return isMegaTemporaryLockError(error) || isMegaRateLimitedError(error) || isMegaRetryableTransportError(error);
}

function isMegaAccessDeniedError(error: unknown): error is MegaApiError {
  const code = getMegaApiErrorCode(error);
  return code === -11;
}

function isDevLogsEnabled(): boolean {
  return (process.env.NODE_ENV ?? '').trim().toLowerCase() === 'development';
}

function debugMegaLog(...args: unknown[]): void {
  if ((process.env.DEBUG ?? '').trim() !== '') {
    console.log(...args);
  }
}

function isMegaUploadProbeEnabled(): boolean {
  return matchesMegaDebugScope(process.env.DEBUG, 'mega');
}

function matchesMegaDebugScope(rawValue: string | undefined, scope?: string): boolean {
  const value = rawValue?.trim();
  if (!value) {
    return false;
  }
  const normalizedScope = scope?.trim().toLowerCase();
  return value
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .some((token) => {
      if (token === '1' || token === 'true' || token === '*') {
        return true;
      }
      if (!normalizedScope) {
        return false;
      }
      return token === normalizedScope || token === `nearbytes:${normalizedScope}`;
    });
}

function getMegaHttpStatus(error: unknown): number | null {
  const status = typeof (error as { status?: unknown } | undefined)?.status === 'number'
    ? Number((error as { status: number }).status)
    : null;
  if (status !== null && Number.isFinite(status)) {
    return Math.trunc(status);
  }
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/HTTP\s+(\d{3})/i);
  return match ? Number.parseInt(match[1]!, 10) : null;
}

function isMegaRateLimitedError(error: unknown): boolean {
  const apiCode = getMegaApiErrorCode(error);
  const httpStatus = getMegaHttpStatus(error);
  return apiCode === -4 || httpStatus === 429;
}

function getMegaRetryDelayMs(error: unknown, attempt: number): number {
  const apiCode = getMegaApiErrorCode(error);
  const httpStatus = getMegaHttpStatus(error);
  const delays =
    apiCode === -3
      ? MEGA_LOCK_RETRY_DELAYS_MS
      : isMegaRateLimitedError(error) || httpStatus === 503
        ? MEGA_RATE_LIMIT_RETRY_DELAYS_MS
        : MEGA_TRANSIENT_RETRY_DELAYS_MS;
  return delays[Math.min(attempt, delays.length - 1)]!;
}

function isMegaRetryableTransportError(error: unknown): boolean {
  const httpStatus = getMegaHttpStatus(error);
  if (httpStatus === 429 || httpStatus === 408 || (httpStatus !== null && httpStatus >= 500)) {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return (
    /fetch failed/i.test(message) ||
    /ECONNRESET|ECONNREFUSED|ETIMEDOUT|network/i.test(message) ||
    /EAI_AGAIN|ENOTFOUND|socket hang up/i.test(message)
  );
}

function isMegaEventuallyConsistentMutationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /did not make the created folder (globally )?visible|did not make the uploaded file (globally )?visible/i.test(
    message
  );
}

async function withMegaApiRetry<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      touchMegaSyncActivity(signal);
      return await operation();
    } catch (error) {
      if (
        (!isMegaRetryableApiError(error) && !isMegaRetryableTransportError(error)) ||
        attempt >= Math.max(MEGA_LOCK_RETRY_DELAYS_MS.length, MEGA_RATE_LIMIT_RETRY_DELAYS_MS.length, MEGA_TRANSIENT_RETRY_DELAYS_MS.length)
      ) {
        throw error;
      }
      const delayMs = getMegaRetryDelayMs(error, attempt);
      attempt += 1;
      await waitForMegaRetry(delayMs, signal);
    }
  }
}

async function waitForMegaRetry(
  schedulerOrDelayMs: RuntimeScheduler | number,
  delayMsOrSignal?: number | AbortSignal,
  signal?: AbortSignal
): Promise<void> {
  const scheduler =
    typeof schedulerOrDelayMs === 'number'
      ? defaultRuntimeScheduler
      : schedulerOrDelayMs;
  const delayMs =
    typeof schedulerOrDelayMs === 'number'
      ? schedulerOrDelayMs
      : typeof delayMsOrSignal === 'number'
        ? delayMsOrSignal
        : 0;
  const effectiveSignal =
    typeof schedulerOrDelayMs === 'number'
      ? (delayMsOrSignal as AbortSignal | undefined)
      : signal;

  if (effectiveSignal?.aborted) {
    throw createMegaAbortError();
  }
  try {
    await waitForScheduledDelay(scheduler, delayMs, effectiveSignal);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw createMegaAbortError();
    }
    throw error;
  }
}

function createMegaAbortError(): Error {
  const error = new Error('This operation was aborted.');
  error.name = 'AbortError';
  return error;
}

function isMegaMissingRequestedRootError(error: unknown): boolean {
  return error instanceof Error && error.message === 'MEGA tree did not include the requested root node.';
}

function createMegaSyncAbortController(
  createAbortController: () => AbortController,
  scheduler: RuntimeScheduler,
  timeoutMs: number
): {
  controller: AbortController;
  dispose: () => void;
} {
  const controller = createAbortController();
  let timer: RuntimeTimerHandle | null = null;

  const scheduleAbort = () => {
    if (timer) {
      timer.cancel();
    }
    timer = scheduler.setTimeout(() => {
      timer = null;
      controller.abort();
    }, timeoutMs);
    timer.unref?.();
  };

  scheduleAbort();
  megaSyncActivityTouchers.set(controller.signal, scheduleAbort);

  return {
    controller,
    dispose: () => {
      if (timer) {
        timer.cancel();
        timer = null;
      }
      megaSyncActivityTouchers.delete(controller.signal);
    },
  };
}

function touchMegaSyncActivity(signal?: AbortSignal): void {
  if (!signal || signal.aborted) {
    return;
  }
  megaSyncActivityTouchers.get(signal)?.();
}

function createMegaReconnectRequiredError(error: unknown): Error {
  const reason =
    error == null
      ? ''
      : error instanceof Error
        ? error.message.trim()
        : String(error).trim();
  const suffix = reason ? ` ${reason}` : '';
  return new Error(`${MEGA_RECONNECT_REQUIRED_MESSAGE}${suffix}`);
}

function isLegacyMegaLocalMirror(share: ManagedShare): boolean {
  return share.remoteDescriptor?.legacyLocalMirror === true && getStringDescriptor(share.remoteDescriptor, 'remotePath') === '/nearbytes';
}

function assertString(value: unknown, message: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(message);
  }
  return value.trim();
}

function getStringDescriptor(descriptor: Record<string, unknown>, key: string): string | undefined {
  const value = descriptor[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function normalizeMegaIncomingShareName(name: string | undefined, handle: string): string {
  const normalized = typeof name === 'string' ? name.trim() : '';
  return normalized || `MEGA share ${handle.slice(-6)}`;
}

function normalizeMegaIncomingOwnerIdentity(ownerEmail: string | undefined, ownerHandle: string | undefined): string {
  const email = typeof ownerEmail === 'string' ? ownerEmail.trim() : '';
  if (email) {
    return email;
  }
  const handle = typeof ownerHandle === 'string' ? ownerHandle.trim() : '';
  return handle || 'unknown-owner';
}

function normalizeMegaIncomingOwnerLabel(ownerEmail: string | undefined, ownerHandle: string | undefined): string {
  const identity = normalizeMegaIncomingOwnerIdentity(ownerEmail, ownerHandle);
  return identity === 'unknown-owner' ? 'Unknown MEGA owner' : identity;
}

function decryptMegaTree(
  snapshot: MegaFetchNodesSnapshot,
  session: MegaSession,
  options: MegaDecryptTreeOptions = {},
  extraShareKeys: ReadonlyMap<string, Buffer> = new Map(),
  logger?: Pick<IntegrationRuntime['logger'], 'warn'>
): DecryptedMegaTree {
  const expectedRootHandle = options.expectedRootHandle?.trim() || undefined;
  const usersByHandle = new Map<string, MegaUserRecord>();
  for (const user of snapshot.users) {
    const handle = typeof user.u === 'string' ? user.u.trim() : '';
    if (handle) {
      usersByHandle.set(handle, user);
    }
  }

  const shareKeys = collectMegaShareKeys(snapshot, session, extraShareKeys);

  const nodesByHandle = new Map<string, DecryptedMegaNode>();
  const availableNodeKeys = new Map<string, Buffer>();
  const pendingNodes = [...snapshot.nodes];
  let madeProgress = true;
  while (madeProgress && pendingNodes.length > 0) {
    madeProgress = false;
    for (let index = 0; index < pendingNodes.length; ) {
      const node = pendingNodes[index]!;
      const decrypted = decryptNodeRecord(node, session, shareKeys, usersByHandle, availableNodeKeys);
      if (!decrypted) {
        index += 1;
        continue;
      }
      nodesByHandle.set(decrypted.handle, decrypted);
      availableNodeKeys.set(decrypted.handle, Buffer.from(decrypted.nodeKey));
      pendingNodes.splice(index, 1);
      madeProgress = true;
    }
  }

  let undecryptedNodeCount = 0;
  const undecryptedNodes: Array<{
    handle: string;
    parentHandle?: string;
    nodeType: number;
    keyOwners: string;
    knownOwners: string;
    hasNodeHandleKey: boolean;
    hasSharingUser: boolean;
    encodedKeyLength: number;
    encodedAttributesLength: number;
    candidateCount: number;
    candidateKeyOwners: string;
    candidateKeyLengths: string;
  }> = [];
  for (const node of pendingNodes) {
    if (typeof node.h === 'string') {
      undecryptedNodeCount += 1;
      const handle = node.h.trim();
      if (handle && undecryptedNodes.length < 8) {
        const keyOwners = listMegaNodeKeyOwners(typeof node.k === 'string' ? node.k : undefined);
        const candidateKeys = decryptNodeKeys(node, session, shareKeys, availableNodeKeys);
        undecryptedNodes.push({
          handle,
          parentHandle: typeof node.p === 'string' && node.p.trim() ? node.p.trim() : undefined,
          nodeType: Number(node.t ?? 0),
          keyOwners: keyOwners.join(','),
          knownOwners: keyOwners.filter((owner) => shareKeys.has(owner)).join(','),
          hasNodeHandleKey: shareKeys.has(handle),
          hasSharingUser: typeof (node as Record<string, unknown>).su === 'string' && String((node as Record<string, unknown>).su).trim() !== '',
          encodedKeyLength: typeof node.k === 'string' ? node.k.trim().length : 0,
          encodedAttributesLength: typeof node.a === 'string' ? node.a.trim().length : 0,
          candidateCount: candidateKeys.length,
          candidateKeyOwners: candidateKeys.map((candidate) => candidate.keyOwner ?? '').join(','),
          candidateKeyLengths: candidateKeys.map((candidate) => String(candidate.nodeKey.length)).join(','),
        });
      }
    }
  }
  if (undecryptedNodeCount > 0 && logger) {
    const rootShareKeyFingerprint = expectedRootHandle
      ? (() => {
          const rootShareKey = shareKeys.get(expectedRootHandle);
          return rootShareKey ? fingerprintMegaShareKey(rootShareKey) : undefined;
        })()
      : undefined;
    logger.warn('MEGA tree decryption: some nodes could not be decrypted.', {
      undecryptedNodeCount,
      totalNodes: snapshot.nodes.length,
      decryptedNodes: nodesByHandle.size,
      shareKeysAvailable: shareKeys.size,
      hasPrivateKey: Boolean(session.privateKey),
      expectedRootHandle,
      rootShareKeyFingerprint,
      undecryptedNodes,
    });
  }

  const childrenByParent = new Map<string, DecryptedMegaNode[]>();
  for (const node of nodesByHandle.values()) {
    if (!node.parentHandle) {
      continue;
    }
    const children = childrenByParent.get(node.parentHandle) ?? [];
    children.push(node);
    childrenByParent.set(node.parentHandle, children);
  }

  const rootHandle = expectedRootHandle?.trim() || resolveTreeRootHandle(nodesByHandle);
  let root = nodesByHandle.get(rootHandle);
  if (!root && expectedRootHandle) {
    const fallbackRoot = buildFallbackDecryptedMegaNode(
      snapshot.nodes.find((node) => typeof node.h === 'string' && node.h.trim() === expectedRootHandle),
      session,
      shareKeys,
      usersByHandle,
      availableNodeKeys,
      options.expectedRootName
    );
    if (fallbackRoot) {
      nodesByHandle.set(fallbackRoot.handle, fallbackRoot);
      root = fallbackRoot;
    }
  }
  if (!root) {
    throw new Error('MEGA tree did not include the requested root node.');
  }

  return {
    root,
    nodesByHandle,
    childrenByParent,
  };
}

function buildFallbackDecryptedMegaNode(
  node: MegaNodeRecord | undefined,
  session: MegaSession,
  shareKeys: ReadonlyMap<string, Buffer>,
  usersByHandle: ReadonlyMap<string, MegaUserRecord>,
  availableNodeKeys: ReadonlyMap<string, Buffer>,
  fallbackName?: string
): DecryptedMegaNode | null {
  if (!node) {
    return null;
  }

  const handle = typeof node.h === 'string' ? node.h.trim() : '';
  if (!handle) {
    return null;
  }

  const nodeType = Number(node.t ?? 0);
  const isSpecialRoot = nodeType === 2 || nodeType === 3 || nodeType === 4;
  const normalizedFallbackName = fallbackName?.trim() || describeMegaSpecialNodeName(nodeType) || normalizeMegaIncomingShareName(undefined, handle);
  const candidateKeys = decryptNodeKeys(node, session, shareKeys, availableNodeKeys);
  const nodeMeta = node as Record<string, unknown>;
  const directShareKey =
    typeof nodeMeta.su === 'string' && nodeMeta.su.trim() !== '' && shareKeys.has(handle)
      ? shareKeys.get(handle)
      : undefined;
  if (directShareKey && !candidateKeys.some((candidate) => candidate.nodeKey.equals(directShareKey))) {
    candidateKeys.unshift({ nodeKey: Buffer.from(directShareKey), keyOwner: handle });
  }
  const nodeCandidates = candidateKeys.length > 0 ? candidateKeys : isSpecialRoot ? [{ nodeKey: Buffer.alloc(16, 0) }] : [];
  const resolvedNodeKey = nodeCandidates[0]?.nodeKey;
  if (!resolvedNodeKey) {
    return null;
  }

  const ownerHandle = typeof nodeMeta.su === 'string' ? nodeMeta.su.trim() : undefined;
  const ownerEmail = ownerHandle
    ? (typeof usersByHandle.get(ownerHandle)?.m === 'string' ? String(usersByHandle.get(ownerHandle)?.m) : undefined)
    : undefined;
  const accessLevel = megaIncomingAccessLevelFromMeta(nodeMeta);
  const shareHandle = deriveShareHandle(typeof node.k === 'string' ? node.k : undefined, shareKeys) ?? handle;

  return {
    handle,
    parentHandle: typeof node.p === 'string' && node.p.trim() ? node.p.trim() : undefined,
    nodeType,
    isFolder: nodeType !== 0,
    size: Number(node.s ?? 0) || 0,
    name: normalizedFallbackName,
    modifiedAt: typeof node.ts === 'number' && Number.isFinite(node.ts) ? Math.trunc(node.ts) : undefined,
    nodeKey: resolvedNodeKey,
    encodedKey: typeof node.k === 'string' ? node.k : undefined,
    encodedAttributes: typeof node.a === 'string' ? node.a : undefined,
    ownerHandle,
    ownerEmail,
    accessLevel,
    shareHandle,
  };
}

interface MegaIncomingShareDiscoveryDiag {
  readonly nodesWithSharingUser: number;
  readonly skippedExplicitFile: number;
  readonly skippedNoDecrypt: number;
  readonly skippedShareHandleMismatch: number;
  readonly provisionalOfferCount: number;
  readonly offerCount: number;
  readonly skippedNoDecryptSample: ReadonlyArray<{
    handle: string;
    ownerHandle?: string;
    parentHandle?: string;
    hasShareKey: boolean;
    nodeKeyOwners: string;
    matchedKeyOwners: string;
    hasSk: boolean;
  }>;
}

function listIncomingMegaShareOffersWithDiag(
  snapshot: MegaFetchNodesSnapshot,
  session: MegaSession,
  extraShareKeys: ReadonlyMap<string, Buffer>,
  provider: string,
  accountId: string
): { offers: IncomingManagedShareOffer[]; diag: MegaIncomingShareDiscoveryDiag } {
  const usersByHandle = buildMegaUsersByHandle(snapshot);
  const shareKeys = collectMegaShareKeys(snapshot, session, extraShareKeys);
  const offersByHandle = new Map<string, IncomingManagedShareOffer>();
  let skippedExplicitFile = 0;
  let skippedNoDecrypt = 0;
  let skippedShareHandleMismatch = 0;
  let provisionalOfferCount = 0;
  let nodesWithSharingUser = 0;
  const skippedNoDecryptSample: Array<{
    handle: string;
    ownerHandle?: string;
    parentHandle?: string;
    hasShareKey: boolean;
    nodeKeyOwners: string;
    matchedKeyOwners: string;
    hasSk: boolean;
  }> = [];

  for (const node of snapshot.nodes) {
    const nodeMeta = node as Record<string, unknown>;
    const ownerHandle = typeof nodeMeta.su === 'string' ? nodeMeta.su.trim() : '';
    if (!ownerHandle) {
      continue;
    }
    nodesWithSharingUser += 1;
    if (megaNodeExplicitFileType(nodeMeta)) {
      skippedExplicitFile += 1;
      continue;
    }
    const decrypted = decryptNodeRecord(node, session, shareKeys, usersByHandle);
    if (!decrypted || !decrypted.ownerHandle) {
      skippedNoDecrypt += 1;
      const provisional = buildProvisionalIncomingMegaShareOffer(node, usersByHandle, provider, accountId);
      const provisionalHandle = provisional
        ? getStringDescriptor(provisional.remoteDescriptor, 'shareHandle') ?? getStringDescriptor(provisional.remoteDescriptor, 'rootHandle')
        : undefined;
      if (provisional && provisionalHandle && !offersByHandle.has(provisionalHandle)) {
        offersByHandle.set(provisionalHandle, provisional);
        provisionalOfferCount += 1;
      }
      if (skippedNoDecryptSample.length < 5) {
        const nodeKeyOwners = listMegaNodeKeyOwners(typeof nodeMeta.k === 'string' ? nodeMeta.k : undefined);
        skippedNoDecryptSample.push({
          handle: typeof node.h === 'string' ? node.h.trim() : '',
          ownerHandle: ownerHandle || undefined,
          parentHandle: typeof node.p === 'string' && node.p.trim() ? node.p.trim() : undefined,
          hasShareKey: nodeKeyOwners.some((candidateOwner) => shareKeys.has(candidateOwner)),
          nodeKeyOwners: nodeKeyOwners.join(','),
          matchedKeyOwners: nodeKeyOwners.filter((candidateOwner) => shareKeys.has(candidateOwner)).join(','),
          hasSk: typeof nodeMeta.sk === 'string' && nodeMeta.sk.trim() !== '',
        });
      }
      continue;
    }
    if (decrypted.shareHandle !== decrypted.handle) {
      skippedShareHandleMismatch += 1;
    }
    const shareHandle = decrypted.shareHandle?.trim() || decrypted.handle;
    const rootHandle = decrypted.handle;
    offersByHandle.set(
      shareHandle,
      createIncomingMegaShareOffer(
        shareHandle,
        rootHandle,
        decrypted.name,
        decrypted.ownerHandle,
        decrypted.ownerEmail,
        decrypted.accessLevel ?? 'read',
        provider,
        accountId
      )
    );
  }

  const offers = Array.from(offersByHandle.values()).sort((left, right) => left.label.localeCompare(right.label));
  const diag: MegaIncomingShareDiscoveryDiag = {
    nodesWithSharingUser,
    skippedExplicitFile,
    skippedNoDecrypt,
    skippedShareHandleMismatch,
    provisionalOfferCount,
    offerCount: offers.length,
    skippedNoDecryptSample,
  };
  return { offers, diag };
}

function snapshotHasIncomingShareCandidates(snapshot: MegaFetchNodesSnapshot): boolean {
  return snapshot.nodes.some((node) => {
    const sharingUser = (node as Record<string, unknown>).su;
    return typeof sharingUser === 'string' && sharingUser.trim() !== '';
  });
}

function createIncomingMegaShareOffer(
  shareHandle: string,
  rootHandle: string,
  name: string | undefined,
  ownerHandle: string | undefined,
  ownerEmail: string | undefined,
  accessLevel: string | undefined,
  provider: string,
  accountId: string
): IncomingManagedShareOffer {
  const normalizedShareHandle = shareHandle.trim();
  const normalizedRootHandle = rootHandle.trim() || normalizedShareHandle;
  const shareName = normalizeMegaIncomingShareName(name, normalizedRootHandle || normalizedShareHandle);
  const ownerIdentity = normalizeMegaIncomingOwnerIdentity(ownerEmail, ownerHandle);
  const ownerLabel = normalizeMegaIncomingOwnerLabel(ownerEmail, ownerHandle);
  const remotePath = `${ownerIdentity}:${shareName}`;
  return {
    id: `mega:incoming:${normalizedShareHandle || normalizedRootHandle}`,
    provider,
    accountId,
    label: shareName,
    ownerLabel,
    detail: `${ownerLabel} shared this MEGA location${accessLevel ? ` with ${accessLevel}` : ''}.`,
    remoteDescriptor: {
      remotePath,
      shareName,
      ownerEmail: ownerIdentity,
      accessLevel: accessLevel ?? 'read',
      shareHandle: normalizedShareHandle || normalizedRootHandle,
      rootHandle: normalizedRootHandle || normalizedShareHandle,
    },
  };
}

function buildProvisionalIncomingMegaShareOffer(
  node: MegaNodeRecord,
  usersByHandle: ReadonlyMap<string, MegaUserRecord>,
  provider: string,
  accountId: string
): IncomingManagedShareOffer | null {
  const handle = typeof node.h === 'string' ? node.h.trim() : '';
  if (!handle) {
    return null;
  }
  const nodeMeta = node as Record<string, unknown>;
  const ownerHandle = typeof nodeMeta.su === 'string' ? nodeMeta.su.trim() : '';
  if (!ownerHandle) {
    return null;
  }
  const ownerEmail = typeof usersByHandle.get(ownerHandle)?.m === 'string'
    ? String(usersByHandle.get(ownerHandle)?.m)
    : undefined;
  return createIncomingMegaShareOffer(
    handle,
    handle,
    undefined,
    ownerHandle,
    ownerEmail,
    megaIncomingAccessLevelFromMeta(nodeMeta) ?? 'read',
    provider,
    accountId
  );
}

function listMegaNodeKeyOwners(encodedKey: string | undefined): string[] {
  const encoded = encodedKey?.trim();
  if (!encoded) {
    return [];
  }
  const owners: string[] = [];
  for (const segment of encoded.split('/')) {
    const colonIndex = segment.indexOf(':');
    if (colonIndex <= 0) {
      continue;
    }
    const owner = segment.slice(0, colonIndex).trim();
    if (owner && !owners.includes(owner)) {
      owners.push(owner);
    }
  }
  return owners;
}

function listIncomingMegaShareOffers(
  snapshot: MegaFetchNodesSnapshot,
  session: MegaSession,
  extraShareKeys: ReadonlyMap<string, Buffer>,
  provider: string,
  accountId: string
): IncomingManagedShareOffer[] {
  return listIncomingMegaShareOffersWithDiag(snapshot, session, extraShareKeys, provider, accountId).offers;
}

function buildMegaShareInventoryDebugEntries(
  snapshot: MegaFetchNodesSnapshot,
  session: MegaSession,
  extraShareKeys: ReadonlyMap<string, Buffer> = new Map()
): {
  incoming: ProviderShareInventoryDebugEntry[];
  outgoing: ProviderShareInventoryDebugEntry[];
} {
  const incoming = listIncomingMegaShareOffers(snapshot, session, extraShareKeys, 'mega', 'debug')
    .map((offer) => ({
      shareHandle:
        getStringDescriptor(offer.remoteDescriptor, 'shareHandle') ??
        getStringDescriptor(offer.remoteDescriptor, 'rootHandle') ??
        '',
      rootHandle:
        getStringDescriptor(offer.remoteDescriptor, 'rootHandle') ??
        getStringDescriptor(offer.remoteDescriptor, 'shareHandle'),
      ownerEmail: getStringDescriptor(offer.remoteDescriptor, 'ownerEmail'),
      label: offer.label,
    }))
    .filter((entry) => entry.shareHandle.length > 0);

  const usersByHandle = buildMegaUsersByHandle(snapshot);
  const shareKeys = collectMegaShareKeys(snapshot, session, extraShareKeys);
  const outgoingByHandle = new Map<string, ProviderShareInventoryDebugEntry>();
  for (const shareRecord of snapshot.outgoingShares) {
    const shareHandle =
      typeof shareRecord.t === 'string'
        ? shareRecord.t.trim()
        : typeof shareRecord.h === 'string'
          ? shareRecord.h.trim()
          : '';
    if (!shareHandle) {
      continue;
    }
    if (outgoingByHandle.has(shareHandle)) {
      continue;
    }
    const matchingNode = snapshot.nodes.find((node) => typeof node.h === 'string' && node.h.trim() === shareHandle);
    const decrypted = matchingNode ? decryptNodeRecord(matchingNode, session, shareKeys, usersByHandle) : null;
    outgoingByHandle.set(shareHandle, {
      shareHandle,
      rootHandle: shareHandle,
      ownerEmail: session.email,
      label: normalizeMegaIncomingShareName(decrypted?.name, shareHandle),
    });
  }

  return {
    incoming: incoming.sort((left, right) => left.label.localeCompare(right.label)),
    outgoing: Array.from(outgoingByHandle.values()).sort((left, right) => left.label.localeCompare(right.label)),
  };
}

function buildMegaUsersByHandle(snapshot: MegaFetchNodesSnapshot): Map<string, MegaUserRecord> {
  const usersByHandle = new Map<string, MegaUserRecord>();
  for (const user of snapshot.users) {
    const handle = typeof user.u === 'string' ? user.u.trim() : '';
    if (handle) {
      usersByHandle.set(handle, user);
    }
  }
  return usersByHandle;
}

/**
 * Incoming shared nodes use `node.k` segments whose owner handle is often the sharer's folder handle,
 * not the recipient copy's `node.h`. `decryptNodeKey` looks up `shareKeys` by those segment owners,
 * so we register the decrypted `sk` material under every handle that appears in `k` as well as `h`.
 */
function registerMegaShareKeyHandlesForNode(shareKeys: Map<string, Buffer>, node: MegaNodeRecord, shareKey: Buffer): void {
  const handles = new Set<string>();
  const h = typeof node.h === 'string' ? node.h.trim() : '';
  if (isMegaRecordHandle(h)) {
    handles.add(h);
  }
  const encoded = typeof node.k === 'string' ? node.k.trim() : '';
  if (encoded) {
    if (encoded.length > 12 && encoded[11] === ':') {
      const owner = encoded.slice(0, 11).trim();
      if (isMegaKeyOwnerHandle(owner)) {
        handles.add(owner);
      }
    }
    for (const segment of encoded.split('/')) {
      const colonIndex = segment.indexOf(':');
      if (colonIndex <= 0) {
        continue;
      }
      const owner = segment.slice(0, colonIndex).trim();
      if (isMegaKeyOwnerHandle(owner)) {
        handles.add(owner);
      }
    }
  }
  for (const handle of handles) {
    if (handle) {
      shareKeys.set(handle, shareKey);
    }
  }
}

function collectMegaShareKeyRelatedHandles(rootHandle: string, snapshot: MegaFetchNodesSnapshot): string[] {
  const handles = new Set<string>();
  const normalizedRootHandle = rootHandle.trim();
  if (isMegaNodeHandle(normalizedRootHandle)) {
    handles.add(normalizedRootHandle);
  }

  const rootNode = snapshot.nodes.find(
    (node) => typeof node.h === 'string' && node.h.trim() === normalizedRootHandle
  );
  if (!rootNode) {
    return [...handles];
  }

  for (const owner of listMegaNodeKeyOwners(typeof rootNode.k === 'string' ? rootNode.k : undefined)) {
    if (isMegaKeyOwnerHandle(owner)) {
      handles.add(owner);
    }
  }

  const ownerHandle = typeof (rootNode as Record<string, unknown>).su === 'string'
    ? String((rootNode as Record<string, unknown>).su).trim()
    : '';
  if (isMegaNodeHandle(ownerHandle)) {
    handles.add(ownerHandle);
  }

  return [...handles];
}

function propagateMegaResolvedShareKeyAliases(
  snapshot: MegaFetchNodesSnapshot,
  session: MegaSession,
  shareKeys: Map<string, Buffer>
): void {
  for (const node of snapshot.nodes) {
    const nodeHandle = typeof node.h === 'string' ? node.h.trim() : '';
    const ownerHandles = listMegaNodeKeyOwners(typeof node.k === 'string' ? node.k : undefined)
      .filter((owner) => owner !== session.userHandle);
    const hasIncomingShareMetadata = typeof (node as Record<string, unknown>).su === 'string'
      && String((node as Record<string, unknown>).su).trim() !== '';
    if (!hasIncomingShareMetadata && ownerHandles.length === 0) {
      continue;
    }

    const shareKey =
      (nodeHandle ? shareKeys.get(nodeHandle) : undefined)
      ?? ownerHandles.map((owner) => shareKeys.get(owner)).find((candidate): candidate is Buffer => Buffer.isBuffer(candidate));
    if (!shareKey) {
      continue;
    }
    registerMegaShareKeyHandlesForNode(shareKeys, node, shareKey);
  }
}

function collectMegaShareKeys(
  snapshot: MegaFetchNodesSnapshot,
  session: MegaSession,
  extraShareKeys: ReadonlyMap<string, Buffer> = new Map()
): Map<string, Buffer> {
  const shareKeys = new Map<string, Buffer>();
  for (const [handle, shareKey] of extraShareKeys.entries()) {
    shareKeys.set(handle, shareKey);
  }
  for (const node of snapshot.nodes) {
    if (
      typeof node.h !== 'string' ||
      typeof (node as Record<string, unknown>).su !== 'string' ||
      typeof (node as Record<string, unknown>).sk !== 'string'
    ) {
      continue;
    }
    const shareKey = decryptShareKey(String((node as Record<string, unknown>).sk), session);
    if (shareKey) {
      registerMegaShareKeyHandlesForNode(shareKeys, node, shareKey);
    }
  }
  for (const shareRecord of snapshot.outgoingShares) {
    const handle =
      typeof shareRecord.t === 'string'
        ? shareRecord.t.trim()
        : typeof shareRecord.h === 'string'
          ? shareRecord.h.trim()
          : '';
    const encodedShareKey = typeof shareRecord.sk === 'string' ? shareRecord.sk.trim() : '';
    if (!handle || !encodedShareKey || shareKeys.has(handle)) {
      continue;
    }
    const shareKey = decryptShareKey(encodedShareKey, session);
    if (shareKey) {
      const node = snapshot.nodes.find((entry) => typeof entry.h === 'string' && entry.h.trim() === handle);
      if (node) {
        registerMegaShareKeyHandlesForNode(shareKeys, node, shareKey);
      } else {
        shareKeys.set(handle, shareKey);
      }
    }
  }
  // Pending shares (ps) can also carry share keys — MEGA uses this for shares whose
  // invitation the recipient hasn't fully processed yet.
  for (const shareRecord of snapshot.pendingShares) {
    const handle =
      typeof shareRecord.t === 'string'
        ? (shareRecord.t as string).trim()
        : typeof shareRecord.h === 'string'
          ? (shareRecord.h as string).trim()
          : '';
    const encodedShareKey = typeof shareRecord.sk === 'string' ? (shareRecord.sk as string).trim() : '';
    if (!handle || !encodedShareKey || shareKeys.has(handle)) {
      continue;
    }
    const shareKey = decryptShareKey(encodedShareKey, session);
    if (shareKey) {
      const node = snapshot.nodes.find((entry) => typeof entry.h === 'string' && entry.h.trim() === handle);
      if (node) {
        registerMegaShareKeyHandlesForNode(shareKeys, node, shareKey);
      } else {
        shareKeys.set(handle, shareKey);
      }
    }
  }
  propagateMegaResolvedShareKeyAliases(snapshot, session, shareKeys);
  return shareKeys;
}

function mergeMegaShareKeyMaps(
  ...maps: Array<ReadonlyMap<string, Buffer> | undefined>
): ReadonlyMap<string, Buffer> {
  const merged = new Map<string, Buffer>();
  for (const current of maps) {
    if (!current || current.size === 0) {
      continue;
    }
    for (const [handle, shareKey] of current.entries()) {
      if (shareKey.length === 0) {
        merged.delete(handle);
        continue;
      }
      merged.set(handle, Buffer.from(shareKey));
    }
  }
  return merged;
}

function createEmptyMegaKeyManagerState(): MegaKeyManagerState {
  return {
    shareKeys: new Map(),
    pendingInShares: new Map(),
    authRingEd25519: new Map(),
    privateCu25519: undefined,
    records: [],
  };
}

function parseMegaKeyManagerState(response: Record<string, unknown>, masterKey: Buffer): MegaKeyManagerState {
  const encodedValue = typeof response.av === 'string' ? response.av.trim() : '';
  if (!encodedValue) {
    return createEmptyMegaKeyManagerState();
  }

  const container = decodeMegaBase64Url(encodedValue);
  const plaintext = decryptMegaKeyManagerContainer(container, masterKey);
  const shareKeys = new Map<string, Buffer>();
  const pendingInShares = new Map<string, MegaPendingInShareRecord>();
  const authRingEd25519 = new Map<string, number>();
  const records: MegaKeyManagerRecord[] = [];
  let privateCu25519: Buffer | undefined;

  for (const { tag, payload } of iterateMegaKeyManagerRecords(plaintext)) {
    records.push({ tag, payload: Buffer.from(payload) });
    switch (tag) {
      case MEGA_KEY_MANAGER_SHARE_KEYS_TAG:
        for (const [handle, shareKey] of parseMegaKeyManagerShareKeys(payload)) {
          shareKeys.set(handle, shareKey);
        }
        break;
      case MEGA_KEY_MANAGER_PENDING_INSHARES_TAG:
        for (const [handle, record] of parseMegaKeyManagerPendingInShares(payload)) {
          pendingInShares.set(handle, record);
        }
        break;
      case MEGA_KEY_MANAGER_AUTH_RING_ED25519_TAG:
        for (const [handle, authMethod] of parseMegaKeyManagerAuthRing(payload)) {
          authRingEd25519.set(handle, authMethod);
        }
        break;
      case MEGA_KEY_MANAGER_PRIVATE_CU25519_TAG:
        privateCu25519 = Buffer.from(payload);
        break;
      default:
        break;
    }
  }

  return {
    shareKeys,
    pendingInShares,
    authRingEd25519,
    privateCu25519,
    records,
  };
}

function* iterateMegaKeyManagerRecords(value: Buffer): Generator<{ tag: number; payload: Buffer }> {
  let offset = 0;
  while (offset + 4 <= value.length) {
    const tag = value[offset] ?? 0;
    const length = ((value[offset + 1] ?? 0) << 16) | ((value[offset + 2] ?? 0) << 8) | (value[offset + 3] ?? 0);
    offset += 4;
    if (offset + length > value.length) {
      throw new Error('MEGA key-manager record is malformed.');
    }
    yield {
      tag,
      payload: value.subarray(offset, offset + length),
    };
    offset += length;
  }
  if (offset !== value.length) {
    throw new Error('MEGA key-manager payload is malformed.');
  }
}

function decryptMegaKeyManagerContainer(container: Buffer, masterKey: Buffer): Buffer {
  if (container.length <= 14 || container[0] !== 20) {
    throw new Error('MEGA key-manager container is invalid.');
  }

  const ivLength = 12;
  const authTagLength = 16;
  if (container.length <= 2 + ivLength + authTagLength) {
    throw new Error('MEGA key-manager container is truncated.');
  }

  const derivedKey = deriveMegaKeyManagerKey(masterKey);
  const iv = container.subarray(2, 2 + ivLength);
  const encrypted = container.subarray(2 + ivLength);
  const ciphertext = encrypted.subarray(0, encrypted.length - authTagLength);
  const authTag = encrypted.subarray(encrypted.length - authTagLength);
  return Buffer.from(nobleAesGcm(derivedKey, iv).decrypt(Buffer.concat([ciphertext, authTag])));
}

function parseMegaPrivateAttributeRecords(container: Buffer, masterKey: Buffer): Map<string, Buffer> {
  const plaintext = decryptMegaPrivateAttributeContainer(container, masterKey);
  return decodeMegaPrivateAttributeRecords(plaintext);
}

export function decodeMegaPrivateAttributeRecordsForTesting(encodedValue: string, masterKey: Buffer): ReadonlyMap<string, Buffer> {
  return parseMegaPrivateAttributeRecords(decodeMegaBase64Url(encodedValue), masterKey);
}

function decryptMegaPrivateAttributeContainer(container: Buffer, masterKey: Buffer): Buffer {
  const mode = container[0];
  const parameters = mode === undefined ? undefined : MEGA_PRIVATE_ATTRIBUTE_ENCRYPTION_PARAMETERS[mode];
  if (!parameters) {
    throw new Error('MEGA private attribute encryption mode is unsupported.');
  }

  const minLength = 1 + parameters.nonceSize + parameters.authTagSize;
  if (container.length < minLength) {
    throw new Error('MEGA private attribute payload is truncated.');
  }

  const nonce = container.subarray(1, 1 + parameters.nonceSize);
  const encrypted = container.subarray(1 + parameters.nonceSize);
  const ciphertext = encrypted.subarray(0, encrypted.length - parameters.authTagSize);
  const authTag = encrypted.subarray(encrypted.length - parameters.authTagSize);
  const key = masterKey.subarray(0, 16);

  if (parameters.algorithm === 'aes-128-ccm') {
    return decryptMegaPrivateAttributeCcm(ciphertext, authTag, key, nonce, parameters.authTagSize);
  }

  return Buffer.from(nobleAesGcm(key, nonce).decrypt(Buffer.concat([ciphertext, authTag])));
}

function decryptMegaPrivateAttributeCcm(
  ciphertext: Buffer,
  authTag: Buffer,
  key: Buffer,
  nonce: Buffer,
  authTagSize: number
): Buffer {
  const lengthSize = 15 - nonce.length;
  if (lengthSize < 2 || lengthSize > 8) {
    throw new Error('MEGA private attribute CCM nonce is invalid.');
  }

  const counter0 = buildMegaCcmCounterBlock(nonce, lengthSize, 0);
  const authMask = encryptAesEcb(counter0, key).subarray(0, authTagSize);
  const plaintext = Buffer.alloc(ciphertext.length);
  for (let offset = 0, counter = 1; offset < ciphertext.length; offset += 16, counter += 1) {
    const keystream = encryptAesEcb(buildMegaCcmCounterBlock(nonce, lengthSize, counter), key);
    const chunkLength = Math.min(16, ciphertext.length - offset);
    for (let index = 0; index < chunkLength; index += 1) {
      plaintext[offset + index] = ciphertext[offset + index]! ^ keystream[index]!;
    }
  }

  const expectedTag = computeMegaCcmMac(plaintext, key, nonce, authTagSize, lengthSize);
  if (!xorBuffers(authTag, authMask).equals(expectedTag)) {
    throw new Error('MEGA private attribute payload failed authentication.');
  }

  return plaintext;
}

function computeMegaCcmMac(
  plaintext: Buffer,
  key: Buffer,
  nonce: Buffer,
  authTagSize: number,
  lengthSize: number
): Buffer {
  let state = encryptAesEcb(buildMegaCcmB0(plaintext.length, nonce, authTagSize, lengthSize), key);
  for (let offset = 0; offset < plaintext.length; offset += 16) {
    const block = Buffer.alloc(16, 0);
    plaintext.copy(block, 0, offset, Math.min(offset + 16, plaintext.length));
    state = encryptAesEcb(xorBuffers(state, block), key);
  }
  return state.subarray(0, authTagSize);
}

function buildMegaCcmB0(plaintextLength: number, nonce: Buffer, authTagSize: number, lengthSize: number): Buffer {
  const flags = (((authTagSize - 2) / 2) << 3) | (lengthSize - 1);
  return Buffer.concat([Buffer.from([flags]), nonce, encodeMegaCcmLength(plaintextLength, lengthSize)]);
}

function buildMegaCcmCounterBlock(nonce: Buffer, lengthSize: number, counter: number): Buffer {
  return Buffer.concat([Buffer.from([lengthSize - 1]), nonce, encodeMegaCcmLength(counter, lengthSize)]);
}

function encodeMegaCcmLength(value: number, length: number): Buffer {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('MEGA private attribute CCM length is invalid.');
  }
  const result = Buffer.alloc(length, 0);
  let remaining = value;
  for (let index = length - 1; index >= 0; index -= 1) {
    result[index] = remaining & 0xff;
    remaining = Math.floor(remaining / 0x100);
  }
  if (remaining !== 0) {
    throw new Error('MEGA private attribute CCM payload is too large.');
  }
  return result;
}

function decodeMegaPrivateAttributeRecords(value: Buffer): Map<string, Buffer> {
  const records = new Map<string, Buffer>();
  if ((value[0] ?? 0) === 0 && value.length > 65_538) {
    records.set('', Buffer.from(value.subarray(3)));
    return records;
  }

  let offset = 0;
  while (offset < value.length) {
    const keyEnd = value.indexOf(0, offset);
    if (keyEnd < 0 || keyEnd + 3 > value.length) {
      throw new Error('MEGA private attribute TLV payload is malformed.');
    }
    const key = value.toString('ascii', offset, keyEnd);
    let payloadLength = value.readUInt16BE(keyEnd + 1);
    offset = keyEnd + 3;
    if (payloadLength === 0xffff) {
      payloadLength = value.length - offset;
    }
    if (offset + payloadLength > value.length) {
      throw new Error('MEGA private attribute TLV payload is malformed.');
    }
    records.set(key, Buffer.from(value.subarray(offset, offset + payloadLength)));
    offset += payloadLength;
  }
  return records;
}

function deriveMegaKeyManagerKey(masterKey: Buffer): Buffer {
  return Buffer.from(hkdf(sha256, masterKey, Buffer.alloc(0), Buffer.from([1]), 16));
}

function findMegaKeyManagerRecord(
  records: readonly MegaKeyManagerRecord[],
  tag: number
): MegaKeyManagerRecord | undefined {
  return records.find((record) => record.tag === tag);
}

function readMegaKeyManagerUint32(payload?: Buffer): number | undefined {
  return payload?.length === 4 ? payload.readUInt32BE(0) : undefined;
}

function buildMegaKeyManagerUint32(value: number): Buffer {
  const payload = Buffer.alloc(4);
  payload.writeUInt32BE(value >>> 0, 0);
  return payload;
}

function parseMegaKeyManagerShareKeys(value: Buffer): Map<string, Buffer> {
  const result = new Map<string, Buffer>();
  for (let entryOffset = 0; entryOffset + MEGA_SHARE_KEY_RECORD_SIZE <= value.length; entryOffset += MEGA_SHARE_KEY_RECORD_SIZE) {
    const handle = encodeMegaBase64Url(value.subarray(entryOffset, entryOffset + 6));
    const shareKey = value.subarray(entryOffset + 6, entryOffset + 22);
    result.set(handle, Buffer.from(shareKey));
  }
  if (value.length % MEGA_SHARE_KEY_RECORD_SIZE !== 0) {
    throw new Error('MEGA key-manager share-key payload is malformed.');
  }
  return result;
}

function parseMegaKeyManagerShareKeyEntries(
  value: Buffer
): Array<{ handle: string; shareKey: Buffer; flags: number }> {
  const result: Array<{ handle: string; shareKey: Buffer; flags: number }> = [];
  for (let entryOffset = 0; entryOffset + MEGA_SHARE_KEY_RECORD_SIZE <= value.length; entryOffset += MEGA_SHARE_KEY_RECORD_SIZE) {
    result.push({
      handle: encodeMegaBase64Url(value.subarray(entryOffset, entryOffset + 6)),
      shareKey: Buffer.from(value.subarray(entryOffset + 6, entryOffset + 22)),
      flags: value[entryOffset + 22] ?? 0,
    });
  }
  if (value.length % MEGA_SHARE_KEY_RECORD_SIZE !== 0) {
    throw new Error('MEGA key-manager share-key payload is malformed.');
  }
  return result;
}

function parseMegaKeyManagerPendingOutShares(value: Buffer): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  let offset = 0;
  while (offset < value.length) {
    const targetLength = value[offset];
    if (targetLength === undefined || offset + 7 > value.length) {
      throw new Error('MEGA key-manager pending outshare payload is malformed.');
    }
    offset += 1;
    const handle = encodeMegaBase64Url(value.subarray(offset, offset + 6));
    offset += 6;

    let target: string;
    if (targetLength === 0) {
      if (offset + 8 > value.length) {
        throw new Error('MEGA key-manager pending outshare payload is malformed.');
      }
      target = encodeMegaBase64Url(value.subarray(offset, offset + 8));
      offset += 8;
    } else {
      if (offset + targetLength > value.length) {
        throw new Error('MEGA key-manager pending outshare payload is malformed.');
      }
      target = value.subarray(offset, offset + targetLength).toString('utf8');
      offset += targetLength;
    }

    const targets = result.get(handle) ?? new Set<string>();
    targets.add(target);
    result.set(handle, targets);
  }
  return result;
}

function serializeMegaKeyManagerShareKeyEntries(
  entries: ReadonlyArray<{ handle: string; shareKey: Buffer; flags: number }>
): Buffer {
  const buffers: Buffer[] = [];
  for (const entry of entries) {
    const handle = entry.handle.trim();
    const handleBytes = decodeMegaBase64Url(handle);
    if (handleBytes.length !== 6) {
      throw new Error(`MEGA key-manager share handle is invalid: ${handle}`);
    }
    if (entry.shareKey.length !== 16) {
      throw new Error(`MEGA key-manager share key has invalid length for ${handle}: ${entry.shareKey.length}`);
    }
    buffers.push(handleBytes, Buffer.from(entry.shareKey), Buffer.from([entry.flags & 0xff]));
  }
  return Buffer.concat(buffers);
}

function serializeMegaKeyManagerPendingOutShares(entries: ReadonlyMap<string, ReadonlySet<string>>): Buffer {
  const buffers: Buffer[] = [];
  for (const handle of [...entries.keys()].sort()) {
    const handleBytes = decodeMegaBase64Url(handle);
    if (handleBytes.length !== 6) {
      throw new Error(`MEGA key-manager pending outshare handle is invalid: ${handle}`);
    }
    const targets = [...(entries.get(handle) ?? new Set<string>())].sort();
    for (const target of targets) {
      const normalizedTarget = target.trim();
      if (!normalizedTarget) {
        continue;
      }
      if (isMegaUserHandle(normalizedTarget)) {
        const targetBytes = decodeMegaBase64Url(normalizedTarget);
        if (targetBytes.length !== 8) {
          throw new Error(`MEGA key-manager pending outshare user handle is invalid: ${normalizedTarget}`);
        }
        buffers.push(Buffer.from([0]), handleBytes, targetBytes);
        continue;
      }
      const targetBytes = Buffer.from(normalizedTarget, 'utf8');
      if (targetBytes.length >= 0x100) {
        throw new Error(`MEGA key-manager pending outshare email is too long: ${normalizedTarget}`);
      }
      buffers.push(Buffer.from([targetBytes.length]), handleBytes, targetBytes);
    }
  }
  return Buffer.concat(buffers);
}

function buildMegaKeyManagerRecordHeader(tag: number, length: number): Buffer {
  return Buffer.from([tag & 0xff, (length >> 16) & 0xff, (length >> 8) & 0xff, length & 0xff]);
}

function serializeMegaKeyManagerRecords(records: readonly MegaKeyManagerRecord[]): Buffer {
  const chunks: Buffer[] = [];
  for (const record of records) {
    chunks.push(buildMegaKeyManagerRecordHeader(record.tag, record.payload.length), Buffer.from(record.payload));
  }
  return Buffer.concat(chunks);
}

function encryptMegaKeyManagerContainer(plaintext: Buffer, masterKey: Buffer): Buffer {
  const iv = randomBytes(12);
  const encrypted = Buffer.from(nobleAesGcm(deriveMegaKeyManagerKey(masterKey), iv).encrypt(plaintext));
  const authTag = encrypted.subarray(encrypted.length - 16);
  const ciphertext = encrypted.subarray(0, encrypted.length - 16);
  return Buffer.concat([Buffer.from([20, 0]), iv, ciphertext, authTag]);
}

function buildMegaRecoveryKeyManagerContainer(payload: MegaKeyManagerRecoveryPayload, masterKey: Buffer): Buffer {
  const records: MegaKeyManagerRecord[] = [
    {
      tag: MEGA_KEY_MANAGER_VERSION_TAG,
      payload: Buffer.from([payload.version & 0xff]),
    },
    {
      tag: MEGA_KEY_MANAGER_CREATION_TIME_TAG,
      payload: Buffer.from(payload.creationTime),
    },
    {
      tag: MEGA_KEY_MANAGER_IDENTITY_TAG,
      payload: Buffer.from(payload.identity),
    },
    {
      tag: MEGA_KEY_MANAGER_GENERATION_TAG,
      payload: buildMegaKeyManagerUint32(payload.generation),
    },
    {
      tag: MEGA_KEY_MANAGER_ATTR_TAG,
      payload: Buffer.from(payload.attr),
    },
    {
      tag: MEGA_KEY_MANAGER_PRIVATE_ED25519_TAG,
      payload: Buffer.from(payload.privateEd25519),
    },
    {
      tag: MEGA_KEY_MANAGER_PRIVATE_CU25519_TAG,
      payload: Buffer.from(payload.privateCu25519),
    },
    {
      tag: MEGA_KEY_MANAGER_PRIVATE_RSA_TAG,
      payload: Buffer.from(payload.privateRsa),
    },
    {
      tag: MEGA_KEY_MANAGER_AUTH_RING_ED25519_TAG,
      payload: Buffer.from(payload.authRingEd25519),
    },
    {
      tag: MEGA_KEY_MANAGER_AUTH_RING_CU25519_TAG,
      payload: Buffer.from(payload.authRingCu25519),
    },
    {
      tag: MEGA_KEY_MANAGER_SHARE_KEYS_TAG,
      payload: Buffer.alloc(0),
    },
    {
      tag: MEGA_KEY_MANAGER_PENDING_OUTSHARES_TAG,
      payload: Buffer.alloc(0),
    },
    {
      tag: MEGA_KEY_MANAGER_PENDING_INSHARES_TAG,
      payload: Buffer.alloc(0),
    },
    {
      tag: MEGA_KEY_MANAGER_BACKUPS_TAG,
      payload: Buffer.alloc(0),
    },
    {
      tag: MEGA_KEY_MANAGER_WARNINGS_TAG,
      payload: Buffer.alloc(0),
    },
  ];

  for (const record of payload.otherRecords) {
    records.push({
      tag: record.tag,
      payload: Buffer.from(record.payload),
    });
  }

  return encryptMegaKeyManagerContainer(serializeMegaKeyManagerRecords(records), masterKey);
}

function buildMegaKeyManagerContainerWithShareKey(
  state: MegaKeyManagerState,
  shareHandle: string,
  shareKey: Buffer,
  options: {
    readonly trusted?: boolean;
    readonly inUse?: boolean;
    readonly pendingOutShareTarget?: string;
    readonly removePendingOutShare?: boolean;
  },
  masterKey: Buffer
): Buffer | null {
  if (state.records.length === 0) {
    return null;
  }

  const updatedRecords: MegaKeyManagerRecord[] = state.records.map((record) => ({
    tag: record.tag,
    payload: Buffer.from(record.payload),
  }));
  const generationIndex = updatedRecords.findIndex((record) => record.tag === MEGA_KEY_MANAGER_GENERATION_TAG);
  if (generationIndex < 0 || updatedRecords[generationIndex]!.payload.length !== 4) {
    return null;
  }

  const shareKeyIndex = updatedRecords.findIndex((record) => record.tag === MEGA_KEY_MANAGER_SHARE_KEYS_TAG);
  const shareKeyEntries =
    shareKeyIndex >= 0
      ? parseMegaKeyManagerShareKeyEntries(updatedRecords[shareKeyIndex]!.payload)
      : [];
  const pendingOutShares =
    updatedRecords.findIndex((record) => record.tag === MEGA_KEY_MANAGER_PENDING_OUTSHARES_TAG) >= 0
      ? parseMegaKeyManagerPendingOutShares(
          updatedRecords[updatedRecords.findIndex((record) => record.tag === MEGA_KEY_MANAGER_PENDING_OUTSHARES_TAG)]!.payload
        )
      : new Map<string, Set<string>>();
  const normalizedHandle = shareHandle.trim();
  const applyFlags = (currentFlags: number): number => {
    let nextFlags = currentFlags;
    if (options.trusted !== undefined) {
      nextFlags = options.trusted
        ? nextFlags | MEGA_SHARE_KEY_FLAG_TRUSTED
        : nextFlags & ~MEGA_SHARE_KEY_FLAG_TRUSTED;
    }
    if (options.inUse !== undefined) {
      nextFlags = options.inUse
        ? nextFlags | MEGA_SHARE_KEY_FLAG_IN_USE
        : nextFlags & ~MEGA_SHARE_KEY_FLAG_IN_USE;
    }
    return nextFlags;
  };
  const pendingOutShareTarget = options.pendingOutShareTarget?.trim() ?? '';

  let changed = false;
  const existingEntry = shareKeyEntries.find((entry) => entry.handle === normalizedHandle);
  if (existingEntry) {
    const nextFlags = applyFlags(existingEntry.flags);
    if (!existingEntry.shareKey.equals(shareKey) || existingEntry.flags !== nextFlags) {
      existingEntry.shareKey = Buffer.from(shareKey);
      existingEntry.flags = nextFlags;
      changed = true;
    }
  } else {
    shareKeyEntries.push({
      handle: normalizedHandle,
      shareKey: Buffer.from(shareKey),
      flags: applyFlags(0),
    });
    changed = true;
  }

  if (pendingOutShareTarget) {
    const targets = new Set(pendingOutShares.get(normalizedHandle) ?? []);
    if (options.removePendingOutShare) {
      if (targets.delete(pendingOutShareTarget)) {
        changed = true;
      }
    } else if (!targets.has(pendingOutShareTarget)) {
      targets.add(pendingOutShareTarget);
      changed = true;
    }

    if (targets.size > 0) {
      pendingOutShares.set(normalizedHandle, targets);
    } else {
      pendingOutShares.delete(normalizedHandle);
    }
  }

  if (!changed) {
    return Buffer.alloc(0);
  }

  const generation = updatedRecords[generationIndex]!.payload.readUInt32BE(0);
  const nextGeneration = Buffer.alloc(4);
  nextGeneration.writeUInt32BE((generation + 1) >>> 0, 0);
  updatedRecords[generationIndex] = {
    tag: MEGA_KEY_MANAGER_GENERATION_TAG,
    payload: nextGeneration,
  };

  const shareKeyRecord: MegaKeyManagerRecord = {
    tag: MEGA_KEY_MANAGER_SHARE_KEYS_TAG,
    payload: serializeMegaKeyManagerShareKeyEntries(shareKeyEntries),
  };
  if (shareKeyIndex >= 0) {
    updatedRecords[shareKeyIndex] = shareKeyRecord;
  } else {
    const insertionIndex = updatedRecords.findIndex((record) => record.tag > MEGA_KEY_MANAGER_SHARE_KEYS_TAG);
    if (insertionIndex >= 0) {
      updatedRecords.splice(insertionIndex, 0, shareKeyRecord);
    } else {
      updatedRecords.push(shareKeyRecord);
    }
  }

  const pendingOutSharePayload = serializeMegaKeyManagerPendingOutShares(pendingOutShares);
  const pendingOutShareRecordIndex = updatedRecords.findIndex(
    (record) => record.tag === MEGA_KEY_MANAGER_PENDING_OUTSHARES_TAG
  );
  if (pendingOutSharePayload.length > 0) {
    const pendingOutShareRecord: MegaKeyManagerRecord = {
      tag: MEGA_KEY_MANAGER_PENDING_OUTSHARES_TAG,
      payload: pendingOutSharePayload,
    };
    if (pendingOutShareRecordIndex >= 0) {
      updatedRecords[pendingOutShareRecordIndex] = pendingOutShareRecord;
    } else {
      const insertionIndex = updatedRecords.findIndex((record) => record.tag > MEGA_KEY_MANAGER_PENDING_OUTSHARES_TAG);
      if (insertionIndex >= 0) {
        updatedRecords.splice(insertionIndex, 0, pendingOutShareRecord);
      } else {
        updatedRecords.push(pendingOutShareRecord);
      }
    }
  } else if (pendingOutShareRecordIndex >= 0) {
    updatedRecords.splice(pendingOutShareRecordIndex, 1);
  }

  return encryptMegaKeyManagerContainer(serializeMegaKeyManagerRecords(updatedRecords), masterKey);
}

function parseMegaKeyManagerAuthRing(value: Buffer): Map<string, number> {
  if (value.length % MEGA_AUTH_RING_RECORD_SIZE !== 0) {
    throw new Error('MEGA key-manager auth-ring payload is malformed.');
  }
  const result = new Map<string, number>();
  for (let offset = 0; offset < value.length; offset += MEGA_AUTH_RING_RECORD_SIZE) {
    const handle = encodeMegaBase64Url(value.subarray(offset, offset + 8));
    const authMethod = value.readInt8(offset + 28);
    result.set(handle, authMethod);
  }
  return result;
}

function parseMegaKeyManagerPendingInShares(value: Buffer): Map<string, MegaPendingInShareRecord> {
  const result = new Map<string, MegaPendingInShareRecord>();
  for (const { tag, payload } of parseMegaLtlvRecords(value)) {
    if (payload.length < 8) {
      throw new Error('MEGA key-manager pending inshare payload is malformed.');
    }
    result.set(encodeMegaBase64Url(tag), {
      ownerHandle: encodeMegaBase64Url(payload.subarray(0, 8)),
      encryptedShareKey: Buffer.from(payload.subarray(8)),
    });
  }
  return result;
}

function parseMegaLtlvRecords(value: Buffer): Array<{ tag: Buffer; payload: Buffer }> {
  const records: Array<{ tag: Buffer; payload: Buffer }> = [];
  let offset = 0;
  while (offset < value.length) {
    const tagLength = value[offset];
    if (tagLength === undefined) {
      throw new Error('MEGA key-manager LTLV tag length is missing.');
    }
    offset += 1;
    if (offset + tagLength + 2 > value.length) {
      throw new Error('MEGA key-manager LTLV tag is malformed.');
    }
    const tag = Buffer.from(value.subarray(offset, offset + tagLength));
    offset += tagLength;
    let payloadLength = value.readUInt16BE(offset);
    offset += 2;
    if (payloadLength === 0xffff) {
      if (offset + 4 > value.length) {
        throw new Error('MEGA key-manager LTLV extended length is malformed.');
      }
      payloadLength = value.readUInt32BE(offset);
      offset += 4;
    }
    if (offset + payloadLength > value.length) {
      throw new Error('MEGA key-manager LTLV value is malformed.');
    }
    records.push({
      tag,
      payload: Buffer.from(value.subarray(offset, offset + payloadLength)),
    });
    offset += payloadLength;
  }
  return records;
}

async function resolveMegaKeyManagerShareKeys(
  apiClient: MegaApiClient,
  session: MegaSession,
  keyManager: MegaKeyManagerState,
  signal?: AbortSignal,
  logger?: Pick<IntegrationRuntime['logger'], 'warn'> & Partial<Pick<IntegrationRuntime['logger'], 'log'>>,
  snapshot?: MegaFetchNodesSnapshot
): Promise<ReadonlyMap<string, Buffer>> {
  const resolved = new Map(keyManager.shareKeys);
  const usersByHandle = new Map<string, MegaUserRecord>();
  if (snapshot) {
    for (const user of snapshot.users) {
      const handle = typeof user.u === 'string' ? user.u.trim() : '';
      if (handle) {
        usersByHandle.set(handle, user);
      }
    }
  }
  if (
    keyManager.pendingInShares.size === 0 ||
    !keyManager.privateCu25519 ||
    keyManager.privateCu25519.length !== 32
  ) {
    if (keyManager.pendingInShares.size > 0) {
      logger?.warn?.('MEGA pending inshare keys are present but recipient key-manager state cannot decrypt them.', {
        email: session.email,
        pendingInShareCount: keyManager.pendingInShares.size,
        hasPrivateCu25519: Boolean(keyManager.privateCu25519),
        privateCu25519Length: keyManager.privateCu25519?.length ?? 0,
      });
    }
    return resolved;
  }

  const publicKeyCache = new Map<string, Promise<Buffer | null>>();
  const getOwnerPublicCu25519 = (ownerHandle: string): Promise<Buffer | null> => {
    let task = publicKeyCache.get(ownerHandle);
    if (!task) {
      task = fetchMegaUserPublicCu25519(apiClient, session, ownerHandle, signal, logger);
      publicKeyCache.set(ownerHandle, task);
    }
    return task;
  };

  for (const [shareHandle, pendingInShare] of keyManager.pendingInShares) {
    const matchingNode = snapshot?.nodes.find((node) => typeof node.h === 'string' && node.h.trim() === shareHandle);
    const existingShareKey = resolved.get(shareHandle);
    let pendingCandidateShareKey: Buffer | undefined;
    if (pendingInShare.encryptedShareKey.length > 0) {
      const authMethod = keyManager.authRingEd25519.get(pendingInShare.ownerHandle) ?? -1;
      if (authMethod < MEGA_AUTH_METHOD_SEEN) {
        logger?.warn?.('MEGA pending inshare key continuing even though the sharer auth ring is below SEEN.', {
          email: session.email,
          shareHandle,
          ownerHandle: pendingInShare.ownerHandle,
          authMethod,
        });
      }

      const ownerPublicKey = await getOwnerPublicCu25519(pendingInShare.ownerHandle);
      if (!ownerPublicKey || ownerPublicKey.length !== 32) {
        logger?.warn?.('MEGA pending inshare key skipped because the sharer public Cu25519 key is unavailable.', {
          email: session.email,
          shareHandle,
          ownerHandle: pendingInShare.ownerHandle,
          publicCu25519Length: ownerPublicKey?.length ?? 0,
        });
      } else {
        const pairwiseKey = await deriveMegaPairwiseKey(keyManager.privateCu25519, ownerPublicKey);
        const decryptedShareKey = decryptAesEcb(pendingInShare.encryptedShareKey, pairwiseKey);
        if (decryptedShareKey.length < 16) {
          logger?.warn?.('MEGA pending inshare key decrypted to an invalid length.', {
            email: session.email,
            shareHandle,
            ownerHandle: pendingInShare.ownerHandle,
            decryptedLength: decryptedShareKey.length,
          });
        } else {
          pendingCandidateShareKey = Buffer.from(decryptedShareKey.subarray(0, 16));
        }
      }
    } else {
      logger?.warn?.('MEGA pending inshare entry has no encrypted share key payload.', {
        email: session.email,
        shareHandle,
        ownerHandle: pendingInShare.ownerHandle,
      });
    }

    if (matchingNode && pendingCandidateShareKey) {
      const validationShareKeys = new Map(resolved);
      registerMegaShareKeyHandlesForNode(validationShareKeys, matchingNode, pendingCandidateShareKey);
      const decryptedNode = decryptNodeRecord(matchingNode, session, validationShareKeys, usersByHandle);
      if (decryptedNode) {
        resolved.set(shareHandle, pendingCandidateShareKey);
        logger?.log?.('MEGA pending inshare key resolved from pairwise encryption.', {
          email: session.email,
          shareHandle,
          ownerHandle: pendingInShare.ownerHandle,
          shareKeyFingerprint: fingerprintMegaShareKey(pendingCandidateShareKey),
        });
        continue;
      }
      logger?.warn?.('MEGA pending inshare key was rejected because it does not decrypt the incoming root node.', {
        email: session.email,
        shareHandle,
        ownerHandle: pendingInShare.ownerHandle,
      });
    }

    if (snapshot && matchingNode) {
      const aliasCandidates = [shareHandle, ...listMegaNodeKeyOwners(typeof matchingNode.k === 'string' ? matchingNode.k : undefined)];
      let validatedExistingHandle: string | undefined;
      let validatedExistingShareKey: Buffer | undefined;
      for (const candidateHandle of aliasCandidates) {
        const candidateShareKey = resolved.get(candidateHandle);
        if (!candidateShareKey || candidateShareKey.length === 0) {
          continue;
        }
        const validationShareKeys = new Map(resolved);
        registerMegaShareKeyHandlesForNode(validationShareKeys, matchingNode, candidateShareKey);
        const decryptedNode = decryptNodeRecord(matchingNode, session, validationShareKeys, usersByHandle);
        if (!decryptedNode) {
          continue;
        }
        validatedExistingHandle = candidateHandle;
        validatedExistingShareKey = Buffer.from(candidateShareKey);
        break;
      }
      if (validatedExistingShareKey) {
        if (validatedExistingHandle !== shareHandle) {
          resolved.set(shareHandle, Buffer.from(validatedExistingShareKey));
          logger?.log?.('MEGA existing share key aliased from an alternate incoming root handle.', {
            email: session.email,
            shareHandle,
            matchedHandle: validatedExistingHandle,
            ownerHandle: pendingInShare.ownerHandle,
            shareKeyFingerprint: fingerprintMegaShareKey(validatedExistingShareKey),
          });
        }
        continue;
      }
      if (existingShareKey) {
        logger?.warn?.('MEGA existing share key failed to decrypt the incoming root; retrying pending inshare resolution.', {
          email: session.email,
          shareHandle,
          ownerHandle: pendingInShare.ownerHandle,
          existingShareKeyFingerprint: fingerprintMegaShareKey(existingShareKey),
        });
        resolved.set(shareHandle, Buffer.alloc(0));
      }
    } else if (existingShareKey) {
      continue;
    }
    if (!pendingCandidateShareKey) {
      continue;
    }
    resolved.set(shareHandle, pendingCandidateShareKey);
    logger?.log?.('MEGA pending inshare key resolved from pairwise encryption.', {
      email: session.email,
      shareHandle,
      ownerHandle: pendingInShare.ownerHandle,
      shareKeyFingerprint: fingerprintMegaShareKey(pendingCandidateShareKey),
    });
  }

  return resolved;
}

function fingerprintMegaShareKey(shareKey: Buffer): string {
  return Buffer.from(sha256(shareKey)).toString('hex').slice(0, 16);
}

function mergeMegaPendingInShares(
  base: ReadonlyMap<string, MegaPendingInShareRecord>,
  extra: ReadonlyMap<string, MegaPendingInShareRecord>
): ReadonlyMap<string, MegaPendingInShareRecord> {
  if (extra.size === 0) {
    return base;
  }
  const merged = new Map(base);
  for (const [shareHandle, record] of extra.entries()) {
    const existing = merged.get(shareHandle);
    if (!existing) {
      merged.set(shareHandle, record);
      continue;
    }
    merged.set(shareHandle, {
      ownerHandle: existing.ownerHandle || record.ownerHandle,
      encryptedShareKey: record.encryptedShareKey.length > 0 ? record.encryptedShareKey : existing.encryptedShareKey,
    });
  }
  return merged;
}

async function fetchMegaPendingInShareKeys(
  apiClient: MegaApiClient,
  session: MegaSession,
  signal?: AbortSignal,
  logger?: Pick<IntegrationRuntime['logger'], 'warn'>
): Promise<ReadonlyMap<string, MegaPendingInShareRecord>> {
  try {
    const response = await withMegaApiRetry(async () => {
      const result = await apiClient.requestSingle<Record<string, unknown>>(
        { a: 'pk' },
        { sessionId: session.sid, signal }
      );
      if (typeof result === 'number') {
        const error = new Error(`MEGA API error ${result}.`) as MegaApiError;
        error.code = result;
        throw error;
      }
      return result;
    }, signal);
    return parseMegaPendingInShareKeysResponse(response);
  } catch (error) {
    const errorCode = typeof (error as MegaApiError | undefined)?.code === 'number'
      ? (error as MegaApiError).code
      : undefined;
    if (errorCode === -9) {
      return new Map();
    }
    logger?.warn?.('MEGA pending inshare key fetch failed.', {
      email: session.email,
      message: error instanceof Error ? error.message : String(error),
    });
    return new Map();
  }
}

function parseMegaPendingInShareKeysResponse(response: Record<string, unknown>): Map<string, MegaPendingInShareRecord> {
  const result = new Map<string, MegaPendingInShareRecord>();
  for (const [ownerHandleRaw, pendingEntries] of Object.entries(response)) {
    const ownerHandle = ownerHandleRaw.trim();
    if (!ownerHandle || ownerHandle === 'd' || !pendingEntries || typeof pendingEntries !== 'object' || Array.isArray(pendingEntries)) {
      continue;
    }
    for (const [shareHandleRaw, encodedKey] of Object.entries(pendingEntries as Record<string, unknown>)) {
      const shareHandle = shareHandleRaw.trim();
      if (!shareHandle || typeof encodedKey !== 'string' || !encodedKey.trim()) {
        continue;
      }
      result.set(shareHandle, {
        ownerHandle,
        encryptedShareKey: decodeMegaBase64Url(encodedKey),
      });
    }
  }
  return result;
}

async function fetchMegaUserPublicCu25519(
  apiClient: MegaApiClient,
  session: MegaSession,
  userHandle: string,
  signal?: AbortSignal,
  logger?: Pick<IntegrationRuntime['logger'], 'warn'>
): Promise<Buffer | null> {
  try {
    const response = await withMegaApiRetry(async () => {
      const result = await apiClient.requestSingle<Record<string, unknown>>(
        { a: 'uga', u: userHandle, ua: '+puCu255', v: 1 },
        { sessionId: session.sid, signal }
      );
      if (typeof result === 'number') {
        const error = new Error(`MEGA API error ${result}.`) as MegaApiError;
        error.code = result;
        throw error;
      }
      return result;
    }, signal);
    const encoded = typeof response.av === 'string' ? response.av.trim() : '';
    if (!encoded) {
      return null;
    }
    return decodeMegaBase64Url(encoded);
  } catch (error) {
    logger?.warn?.('MEGA failed to fetch a sharer Cu25519 public key for pending incoming shares.', {
      email: session.email,
      userHandle,
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function deriveMegaPairwiseKey(privateCu25519: Buffer, publicCu25519: Buffer): Promise<Buffer> {
  const sharedSecret = Buffer.from(x25519.getSharedSecret(privateCu25519, publicCu25519));
  const step1 = await signMegaHmacSha256(Buffer.alloc(0), sharedSecret);
  return (await signMegaHmacSha256(step1, MEGA_PAIRWISE_KEY_LABEL)).subarray(0, 16);
}

async function signMegaHmacSha256(key: Buffer, data: Buffer): Promise<Buffer> {
  const normalizedKey = key.length > 64 ? await digestMegaSha256(key) : Buffer.from(key);
  const paddedKey = Buffer.alloc(64, 0);
  normalizedKey.copy(paddedKey, 0, 0, Math.min(normalizedKey.length, 64));
  const innerPad = Buffer.alloc(64);
  const outerPad = Buffer.alloc(64);
  for (let index = 0; index < 64; index += 1) {
    innerPad[index] = paddedKey[index] ^ 0x36;
    outerPad[index] = paddedKey[index] ^ 0x5c;
  }
  const innerDigest = await digestMegaSha256(Buffer.concat([innerPad, data]));
  return digestMegaSha256(Buffer.concat([outerPad, innerDigest]));
}

async function digestMegaSha256(data: Buffer): Promise<Buffer> {
  const crypto = globalThis.crypto?.subtle
    ? getMegaWebCrypto()
    : ((await ensureMegaNodeCrypto()).webcrypto as Crypto);
  return Buffer.from(await crypto.subtle.digest('SHA-256', Uint8Array.from(data)));
}

function resolveTreeRootHandle(nodesByHandle: ReadonlyMap<string, DecryptedMegaNode>): string {
  for (const node of nodesByHandle.values()) {
    if (node.nodeType === 2) {
      return node.handle;
    }
  }
  for (const node of nodesByHandle.values()) {
    if (!node.parentHandle || !nodesByHandle.has(node.parentHandle)) {
      return node.handle;
    }
  }
  throw new Error('MEGA tree root could not be determined.');
}

function decryptNodeRecord(
  node: MegaNodeRecord,
  session: MegaSession,
  shareKeys: ReadonlyMap<string, Buffer>,
  usersByHandle: ReadonlyMap<string, MegaUserRecord>,
  availableNodeKeys: ReadonlyMap<string, Buffer> = new Map()
): DecryptedMegaNode | null {
  const handle = typeof node.h === 'string' ? node.h.trim() : '';
  if (!handle) {
    return null;
  }

  const nodeType = Number(node.t ?? 0);
  const isSpecialRoot = nodeType === 2 || nodeType === 3 || nodeType === 4;
  const candidateKeys = decryptNodeKeys(node, session, shareKeys, availableNodeKeys);
  const nodeMeta = node as Record<string, unknown>;
  const directShareKey =
    typeof nodeMeta.su === 'string' && nodeMeta.su.trim() !== '' && shareKeys.has(handle)
      ? shareKeys.get(handle)
      : undefined;
  if (directShareKey && !candidateKeys.some((candidate) => candidate.nodeKey.equals(directShareKey))) {
    candidateKeys.unshift({ nodeKey: Buffer.from(directShareKey), keyOwner: handle });
  }
  const nodeCandidates = candidateKeys.length > 0 ? candidateKeys : isSpecialRoot ? [{ nodeKey: Buffer.alloc(16, 0) }] : [];
  let resolvedNodeKey: Buffer | null = null;
  let name: string | undefined;
  for (const candidate of nodeCandidates) {
    const candidateName = decryptNodeName(typeof node.a === 'string' ? node.a : undefined, candidate.nodeKey)
      ?? describeMegaSpecialNodeName(nodeType);
    if (!candidateName) {
      continue;
    }
    resolvedNodeKey = candidate.nodeKey;
    name = candidateName;
    break;
  }
  if (!resolvedNodeKey || !name) {
    return null;
  }

  const ownerHandle = typeof nodeMeta.su === 'string' ? nodeMeta.su.trim() : undefined;
  const ownerEmail = ownerHandle ? (typeof usersByHandle.get(ownerHandle)?.m === 'string' ? String(usersByHandle.get(ownerHandle)?.m) : undefined) : undefined;
  const accessLevel = megaIncomingAccessLevelFromMeta(nodeMeta);
  const shareHandle = deriveShareHandle(typeof node.k === 'string' ? node.k : undefined, shareKeys) ?? handle;

    return {
      handle,
      parentHandle: typeof node.p === 'string' && node.p.trim() ? node.p.trim() : undefined,
      nodeType,
      isFolder: nodeType !== 0,
      size: Number(node.s ?? 0) || 0,
      name,
      modifiedAt: typeof node.ts === 'number' && Number.isFinite(node.ts) ? Math.trunc(node.ts) : undefined,
      nodeKey: resolvedNodeKey,
      encodedKey: typeof node.k === 'string' ? node.k : undefined,
      encodedAttributes: typeof node.a === 'string' ? node.a : undefined,
      ownerHandle,
    ownerEmail,
    accessLevel,
    shareHandle,
  };
}

function resolveMegaCloudDriveHandle(snapshot: MegaFetchNodesSnapshot): string | undefined {
  for (const node of snapshot.nodes) {
    if (Number(node.t ?? 0) === 2 && typeof node.h === 'string' && node.h.trim()) {
      return node.h.trim();
    }
  }
  for (const node of snapshot.nodes) {
    const handle = typeof node.h === 'string' ? node.h.trim() : '';
    const parent = typeof node.p === 'string' ? node.p.trim() : '';
    const nodeType = Number(node.t ?? 0);
    if (handle && !parent && nodeType !== 0) {
      return handle;
    }
  }
  return undefined;
}

function describeMegaSpecialNodeName(nodeType: number): string | undefined {
  switch (nodeType) {
    case 2:
      return 'Cloud Drive';
    case 3:
      return 'Inbox';
    case 4:
      return 'Rubbish Bin';
    default:
      return undefined;
  }
}

function describeAccessLevel(level: number): string {
  switch (level) {
    case 0:
      return 'read';
    case 1:
      return 'read/write';
    case 2:
      return 'full access';
    case 3:
      return 'owner';
    default:
      return String(level);
  }
}

/** MEGA sometimes omits `t` on incoming share roots; treating that as `t === 0` wrongly skipped folders. */
function megaNodeExplicitFileType(nodeMeta: Record<string, unknown>): boolean {
  if (!('t' in nodeMeta)) {
    return false;
  }
  const raw = nodeMeta.t;
  if (raw === undefined || raw === null) {
    return false;
  }
  return Number(raw) === 0;
}

function megaIncomingAccessLevelFromMeta(nodeMeta: Record<string, unknown>): string | undefined {
  const raw = nodeMeta.r;
  const level =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && raw.trim() !== ''
        ? Number.parseInt(raw.trim(), 10)
        : NaN;
  return Number.isFinite(level) ? describeAccessLevel(level) : undefined;
}

function deriveShareHandle(encodedKey: string | undefined, shareKeys: ReadonlyMap<string, Buffer>): string | undefined {
  const key = encodedKey?.trim();
  if (!key) {
    return undefined;
  }
  for (const segment of key.split('/')) {
    const colonIndex = segment.indexOf(':');
    if (colonIndex <= 0) {
      continue;
    }
    const handle = segment.slice(0, colonIndex).trim();
    if (isMegaNodeHandle(handle) && shareKeys.has(handle)) {
      return handle;
    }
  }
  return undefined;
}

let warnedMissingPrivateKeyForShareKey = false;

function decryptShareKey(value: string, session: MegaSession): Buffer | null {
  const payload = value.trim();
  if (!payload) {
    return null;
  }
  if (payload.length > 43) {
    if (!session.privateKey) {
      if (!warnedMissingPrivateKeyForShareKey) {
        warnedMissingPrivateKeyForShareKey = true;
        console.warn(
          '[MEGA] RSA-encrypted share key found but session has no private key.',
          'This share cannot be decrypted — reconnect MEGA so Nearbytes can obtain the RSA private key.',
          { email: session.email, skLength: payload.length }
        );
      }
      return null;
    }
    const cleartext = rsaRawDecryptMpi(decodeMegaBase64Url(payload), session.privateKey);
    return cleartext.length >= 16 ? cleartext.subarray(0, 16) : null;
  }

  const encrypted = decodeMegaBase64Url(payload);
  if (encrypted.length !== 16) {
    return null;
  }
  return decryptAesEcb(encrypted, session.masterKey);
}

function decryptNodeKeys(
  node: MegaNodeRecord,
  session: MegaSession,
  shareKeys: ReadonlyMap<string, Buffer>,
  availableNodeKeys: ReadonlyMap<string, Buffer> = new Map()
): Array<{ nodeKey: Buffer; keyOwner?: string }> {
  const encoded = typeof node.k === 'string' ? node.k.trim() : '';
  const nodeHandle = typeof node.h === 'string' ? node.h.trim() : '';
  if (!encoded) {
    return [];
  }

  const candidates: Array<{ keyOwner: string; payload: string }> = [];
  if (encoded.length === 22 || encoded.length === 43) {
    candidates.push({ keyOwner: session.userHandle, payload: encoded });
  } else {
    const ownedSegments: Array<{ owner: string; payload: string }> = [];
    for (const segment of encoded.split('/')) {
      const colonIndex = segment.indexOf(':');
      if (colonIndex <= 0) {
        continue;
      }
      const owner = segment.slice(0, colonIndex).trim();
      const candidate = segment.slice(colonIndex + 1).trim();
      if (!owner || !candidate) {
        continue;
      }
      ownedSegments.push({ owner, payload: candidate });
    }
    for (const segment of ownedSegments) {
      if (segment.owner === session.userHandle || shareKeys.has(segment.owner)) {
        candidates.push({ keyOwner: segment.owner, payload: segment.payload });
      }
    }
    if (candidates.length === 0 && encoded.length > 12 && encoded[11] === ':') {
      const owner = encoded.slice(0, 11).trim();
      const candidate = encoded.slice(12).trim();
      if (owner === session.userHandle || shareKeys.has(owner)) {
        candidates.push({ keyOwner: owner, payload: candidate });
      }
    }

    if (candidates.length === 0 && nodeHandle && shareKeys.has(nodeHandle)) {
      for (const segment of ownedSegments) {
        candidates.push({ keyOwner: nodeHandle, payload: segment.payload });
      }
      if (candidates.length === 0 && encoded.length > 12 && encoded[11] === ':') {
        const candidate = encoded.slice(12).trim();
        if (candidate) {
          candidates.push({ keyOwner: nodeHandle, payload: candidate });
        }
      }
    }
  }

  if (candidates.length === 0) {
    return [];
  }

  const seen = new Set<string>();
  const decrypted: Array<{ nodeKey: Buffer; keyOwner?: string }> = [];
  for (const candidate of candidates) {
    const dedupeKey = `${candidate.keyOwner}:${candidate.payload}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    const encrypted = decodeMegaBase64Url(candidate.payload);
    if (candidate.payload.length > 43) {
      if (!session.privateKey) {
        continue;
      }
      const cleartext = rsaRawDecryptMpi(encrypted, session.privateKey);
      const keyLength = Number(node.t ?? 0) !== 0 ? 16 : 32;
      if (cleartext.length >= keyLength) {
        decrypted.push({ nodeKey: cleartext.subarray(0, keyLength), keyOwner: candidate.keyOwner });
      }
      continue;
    }

    const candidateDecryptionKeys =
      candidate.keyOwner === session.userHandle
        ? [session.masterKey]
        : [shareKeys.get(candidate.keyOwner), availableNodeKeys.get(candidate.keyOwner)].filter(
            (value): value is Buffer => Buffer.isBuffer(value)
          );
    if (candidateDecryptionKeys.length === 0 || encrypted.length === 0 || encrypted.length % 16 !== 0) {
      continue;
    }
    for (const key of candidateDecryptionKeys) {
      decrypted.push({ nodeKey: decryptAesEcb(encrypted, key), keyOwner: candidate.keyOwner });
    }
  }
  return decrypted;
}

function decryptNodeName(attributes: string | undefined, nodeKey: Buffer): string | null {
  const encoded = attributes?.trim();
  if (!encoded) {
    return null;
  }

  const ciphertext = decodeMegaBase64Url(encoded);
  if (ciphertext.length === 0 || ciphertext.length % 16 !== 0) {
    return null;
  }
  const plaintext = Buffer.from(
    nobleAesCbc(deriveAttributeKey(nodeKey), ZERO_IV, { disablePadding: true }).decrypt(ciphertext)
  ).toString('utf8').replace(/\u0000+$/u, '');
  if (!plaintext.startsWith('MEGA')) {
    return null;
  }
  try {
    const parsed = JSON.parse(plaintext.slice(4)) as { n?: unknown };
    return typeof parsed.n === 'string' && parsed.n.trim() ? parsed.n : null;
  } catch {
    return null;
  }
}

function deriveAttributeKey(nodeKey: Buffer): Buffer {
  if (nodeKey.length >= 32) {
    const result = Buffer.alloc(16);
    for (let index = 0; index < 16; index += 1) {
      result[index] = nodeKey[index]! ^ nodeKey[index + 16]!;
    }
    return result;
  }
  return nodeKey.subarray(0, 16);
}

async function downloadAuthenticatedMegaFileContent(
  fetchImpl: typeof fetch,
  apiClient: MegaApiClient,
  session: MegaSession,
  handle: string,
  nodeKey: Buffer,
  expectedSize?: number,
  signal?: AbortSignal
): Promise<Uint8Array> {
  const response = await apiClient.requestSingle<Record<string, unknown> | number>(
    { a: 'g', g: 1, n: handle },
    { sessionId: session.sid, signal }
  );
  if (typeof response === 'number') {
    throw new Error(`MEGA API error ${response}.`);
  }
  const url = assertString(response.g, `MEGA did not return a download URL for ${handle}.`);
  const download = await fetchImpl(url, { signal });
  if (!download.ok) {
    throw new Error(`MEGA file download failed with HTTP ${download.status}.`);
  }
  const ciphertext = Buffer.from(await download.arrayBuffer());
  const plaintext = decryptFileCiphertext(ciphertext, nodeKey);
  if (typeof expectedSize === 'number' && expectedSize > 0 && plaintext.length !== expectedSize) {
    throw new Error(`MEGA file download size mismatch for handle ${handle}.`);
  }
  return plaintext;
}

function decryptFileCiphertext(ciphertext: Buffer, nodeKey: Buffer): Buffer {
  const iv = Buffer.alloc(16, 0);
  if (nodeKey.length >= 24) {
    nodeKey.copy(iv, 0, 16, 24);
  }
  return Buffer.from(nobleAesCtr(deriveAttributeKey(nodeKey), iv).decrypt(ciphertext));
}

async function visitTree(
  tree: DecryptedMegaTree,
  visit: (relativePath: string, node: DecryptedMegaNode) => Promise<void>
): Promise<void> {
  const walk = async (parentHandle: string, prefix = ''): Promise<void> => {
    const children = [...(tree.childrenByParent.get(parentHandle) ?? [])].sort((left, right) => left.name.localeCompare(right.name));
    for (const child of children) {
      const relativePath = prefix ? path.join(prefix, sanitizePathSegment(child.name)) : sanitizePathSegment(child.name);
      await visit(relativePath, child);
      if (child.isFolder) {
        await walk(child.handle, relativePath);
      }
    }
  };
  await walk(tree.root.handle);
}

function actionPacketBatchTouchesShare(
  packets: readonly Record<string, unknown>[],
  rootHandle: string,
  manifest: MegaMirrorManifest
): boolean {
  if (!packets.length) {
    return false;
  }
  const relevantHandles = new Set<string>(manifest.knownHandles ?? []);
  relevantHandles.add(rootHandle);
  return packets.some((packet) => actionPacketTouchesShare(packet, relevantHandles));
}

function actionPacketTouchesShare(packet: Record<string, unknown>, relevantHandles: ReadonlySet<string>): boolean {
  const handles = collectActionPacketHandles(packet);
  if (handles.some((handle) => relevantHandles.has(handle))) {
    return true;
  }
  const action = typeof packet.a === 'string' ? packet.a.trim() : '';
  return action === 't';
}

function collectActionPacketHandles(packet: Record<string, unknown>): string[] {
  const result = new Set<string>();
  collectPacketHandlesRecursive(packet, result);
  return [...result];
}

function summarizeActionPacketActions(packets: readonly Record<string, unknown>[]): string[] {
  const actions = new Set<string>();
  for (const packet of packets) {
    const action = typeof packet.a === 'string' ? packet.a.trim() : '';
    if (action) {
      actions.add(action);
    }
  }
  return [...actions];
}

function createMegaActionPacketLogDetails(
  packets: readonly Record<string, unknown>[]
): Array<{
  readonly action: string;
  readonly handles: string[];
  readonly keys: string[];
  readonly packet: unknown;
}> {
  return packets.map((packet) => ({
    action: typeof packet.a === 'string' ? packet.a.trim() : '',
    handles: collectActionPacketHandles(packet),
    keys: Object.keys(packet).sort(),
    packet: sanitizeMegaActionPacketForLogging(packet),
  }));
}

function sanitizeMegaActionPacketForLogging(value: unknown, parentKey?: string): unknown {
  if (parentKey && MEGA_REDACTED_ACTION_PACKET_LOG_KEYS.has(parentKey)) {
    return '[redacted]';
  }
  if (typeof value === 'string') {
    return value.length > 160 ? `${value.slice(0, 157)}...` : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return value;
  }
  if (Array.isArray(value)) {
    const limit = 25;
    const sanitized = value.slice(0, limit).map((entry) => sanitizeMegaActionPacketForLogging(entry, parentKey));
    if (value.length > limit) {
      sanitized.push(`[${value.length - limit} more item(s)]`);
    }
    return sanitized;
  }
  if (!value || typeof value !== 'object') {
    return value === undefined ? undefined : String(value);
  }
  const sanitized: Record<string, unknown> = {};
  for (const [key, entryValue] of Object.entries(value)) {
    const entry = sanitizeMegaActionPacketForLogging(entryValue, key);
    if (entry !== undefined) {
      sanitized[key] = entry;
    }
  }
  return sanitized;
}

function collectRecipientImmediatePacketHandles(
  packets: readonly Record<string, unknown>[],
  rootHandle: string
): string[] {
  const handles: string[] = [];
  const seen = new Set<string>();
  const addHandle = (handle: string | undefined): void => {
    const normalized = handle?.trim();
    if (!normalized || normalized === rootHandle || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    handles.push(normalized);
  };

  for (const packet of packets) {
    const action = typeof packet.a === 'string' ? packet.a.trim() : '';
    if (action === 't') {
      const tree = packet.t;
      const fetchedNodes =
        tree && typeof tree === 'object' && Array.isArray((tree as { f?: unknown }).f)
          ? (tree as { f: unknown[] }).f
          : [];
      const pendingParentHandles: string[] = [];
      for (const node of fetchedNodes) {
        if (!node || typeof node !== 'object') {
          continue;
        }
        addHandle(typeof (node as { h?: unknown }).h === 'string' ? (node as { h: string }).h : undefined);
        const parentHandle = typeof (node as { p?: unknown }).p === 'string' ? (node as { p: string }).p : undefined;
        if (parentHandle && parentHandle.trim() && parentHandle.trim() !== rootHandle) {
          pendingParentHandles.push(parentHandle);
        }
      }
      for (const parentHandle of pendingParentHandles) {
        addHandle(parentHandle);
      }
      continue;
    }
    for (const handle of collectActionPacketHandles(packet)) {
      addHandle(handle);
    }
  }
  return handles;
}

function collectRecipientImmediatePacketNodes(
  packets: readonly Record<string, unknown>[]
): MegaNodeRecord[] {
  const nodesByHandle = new Map<string, MegaNodeRecord>();
  for (const packet of packets) {
    const action = typeof packet.a === 'string' ? packet.a.trim() : '';
    if (action !== 't') {
      continue;
    }
    const tree = packet.t;
    const fetchedNodes =
      tree && typeof tree === 'object' && Array.isArray((tree as { f?: unknown }).f)
        ? (tree as { f: unknown[] }).f
        : [];
    for (const node of fetchedNodes) {
      if (!node || typeof node !== 'object') {
        continue;
      }
      const handle = typeof (node as { h?: unknown }).h === 'string' ? (node as { h: string }).h.trim() : '';
      if (!handle) {
        continue;
      }
      nodesByHandle.set(handle, node as MegaNodeRecord);
    }
  }
  return [...nodesByHandle.values()];
}

function collectRecipientDeletedPacketHandles(
  packets: readonly Record<string, unknown>[],
  rootHandle: string
): string[] {
  const handles: string[] = [];
  const seen = new Set<string>();
  for (const packet of packets) {
    const action = typeof packet.a === 'string' ? packet.a.trim() : '';
    if (action !== 'd') {
      continue;
    }
    const handle = getActionPacketString(packet, 'n') ?? getActionPacketString(packet, 'h');
    if (!handle || handle === rootHandle || seen.has(handle)) {
      continue;
    }
    seen.add(handle);
    handles.push(handle);
  }
  return handles;
}

function buildMegaUsersByHandleFromActionPackets(
  packets: readonly Record<string, unknown>[]
): Map<string, MegaUserRecord> {
  const usersByHandle = new Map<string, MegaUserRecord>();
  for (const packet of packets) {
    const tree = packet.t;
    const users =
      tree && typeof tree === 'object' && Array.isArray((tree as { u?: unknown }).u)
        ? (tree as { u: unknown[] }).u
        : Array.isArray((packet as { u?: unknown }).u)
          ? ((packet as { u: unknown[] }).u)
          : [];
    for (const user of users) {
      if (!user || typeof user !== 'object') {
        continue;
      }
      const handle = typeof (user as { u?: unknown }).u === 'string' ? (user as { u: string }).u.trim() : '';
      if (!handle) {
        continue;
      }
      usersByHandle.set(handle, user as MegaUserRecord);
    }
  }
  return usersByHandle;
}

function resolveRecipientPacketNodePath(
  node: DecryptedMegaNode,
  rootHandle: string,
  handlePathIndex: ReadonlyMap<string, string>,
  packetNodesByHandle: ReadonlyMap<string, DecryptedMegaNode>,
  visited = new Set<string>()
): string | undefined {
  const existingPath = handlePathIndex.get(node.handle);
  if (existingPath) {
    return existingPath;
  }
  if (node.parentHandle === rootHandle) {
    return sanitizePathSegment(node.name);
  }
  if (!node.parentHandle || visited.has(node.handle)) {
    return undefined;
  }

  const parentPath = handlePathIndex.get(node.parentHandle);
  if (parentPath) {
    return normalizeRelativePath(path.join(parentPath, sanitizePathSegment(node.name)));
  }

  const packetParent = packetNodesByHandle.get(node.parentHandle);
  if (!packetParent) {
    return undefined;
  }

  const nextVisited = new Set(visited);
  nextVisited.add(node.handle);
  const resolvedParentPath = resolveRecipientPacketNodePath(
    packetParent,
    rootHandle,
    handlePathIndex,
    packetNodesByHandle,
    nextVisited,
  );
  if (!resolvedParentPath) {
    return undefined;
  }
  return normalizeRelativePath(path.join(resolvedParentPath, sanitizePathSegment(node.name)));
}

function extractMegaShareKeysFromActionPackets(
  packets: readonly Record<string, unknown>[],
  session: MegaSession
): Map<string, Buffer> {
  const shareKeys = new Map<string, Buffer>();
  for (const packet of packets) {
    const action = typeof packet.a === 'string' ? packet.a.trim() : '';
    if (action !== 's' && action !== 's2') {
      continue;
    }

    const shareHandle = getActionPacketString(packet, 'n') ?? getActionPacketString(packet, 'h');
    if (!shareHandle) {
      continue;
    }

    const ownerHandle = getActionPacketString(packet, 'o');
    const encodedShareKey = ownerHandle === session.userHandle
      ? getActionPacketString(packet, 'ok') ?? getActionPacketString(packet, 'k')
      : getActionPacketString(packet, 'k') ?? getActionPacketString(packet, 'ok');
    if (!encodedShareKey) {
      continue;
    }

    const shareKey = decryptShareKey(encodedShareKey, session);
    if (!shareKey) {
      continue;
    }
    shareKeys.set(shareHandle, Buffer.from(shareKey));
  }
  return shareKeys;
}

function getActionPacketString(packet: Record<string, unknown>, key: string): string | undefined {
  const value = packet[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function removeManifestEntriesUnderPath(
  relativePath: string,
  entries: Record<string, ProviderRefreshManifestEntry>,
  handlePathIndex: Map<string, string>,
): string[] {
  const normalizedPath = normalizeRelativePath(relativePath);
  const removedPaths: string[] = [];
  for (const [entryPath, entry] of Object.entries(entries)) {
    if (entryPath !== normalizedPath && !entryPath.startsWith(`${normalizedPath}/`)) {
      continue;
    }
    removedPaths.push(entryPath);
    delete entries[entryPath];
    if (typeof entry.handle === 'string' && entry.handle.trim()) {
      handlePathIndex.delete(entry.handle);
    }
  }
  return removedPaths;
}

function collectPacketHandlesRecursive(value: unknown, result: Set<string>, key?: string): void {
  if (typeof value === 'string') {
    if (key && ACTION_PACKET_HANDLE_KEYS.has(key) && value.trim()) {
      result.add(value.trim());
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectPacketHandlesRecursive(entry, result, key);
    }
    return;
  }
  if (!value || typeof value !== 'object') {
    return;
  }
  for (const [entryKey, entryValue] of Object.entries(value)) {
    collectPacketHandlesRecursive(entryValue, result, entryKey);
  }
}

function shouldResetScCursor(error: unknown): boolean {
  return typeof (error as MegaApiError | undefined)?.code === 'number' && (error as MegaApiError).code === -6;
}

const ACTION_PACKET_HANDLE_KEYS = new Set(['h', 'n', 'p', 'ph', 'sh']);
const ACCOUNT_LEVEL_ACTIONS = new Set(['ua']);
const MEGA_REDACTED_ACTION_PACKET_LOG_KEYS = new Set(['at', 'cr', 'fa', 'ha', 'k', 'ok']);

function allActionsAreAccountLevel(actions: readonly string[]): boolean {
  return actions.length > 0 && actions.every((action) => ACCOUNT_LEVEL_ACTIONS.has(action));
}

function sanitizePathSegment(value: string): string {
  const cleaned = value.replace(/[<>:"/\\|?*\u0000-\u001f]+/gu, ' ').trim();
  return cleaned || 'unnamed';
}

function createNodeFingerprint(node: DecryptedMegaNode): string {
  return Buffer.from(
    sha256(
      Buffer.from(
        [
          node.handle,
          String(node.size),
          node.encodedAttributes ?? '',
          node.encodedKey ?? '',
        ].join('\n'),
        'utf8'
      )
    )
  ).toString('hex');
}

function createProviderRefreshManifestEntry(node: DecryptedMegaNode): ProviderRefreshManifestEntry {
  return {
    fingerprint: createNodeFingerprint(node),
    kind: node.isFolder ? 'folder' : 'file',
    ...(node.isFolder ? {} : { size: node.size }),
    handle: node.handle,
    ...(node.parentHandle ? { parentHandle: node.parentHandle } : {}),
  };
}

function buildManifestHandlePathIndex(entries: Record<string, ProviderRefreshManifestEntry>): Map<string, string> {
  const index = new Map<string, string>();
  for (const [relativePath, entry] of Object.entries(entries)) {
    if (entry.handle) {
      index.set(entry.handle, relativePath);
    }
  }
  return index;
}

function collectManifestHandles(entries: Record<string, ProviderRefreshManifestEntry>, rootHandle: string): string[] {
  const handles = new Set<string>([rootHandle]);
  for (const entry of Object.values(entries)) {
    if (entry.handle) {
      handles.add(entry.handle);
    }
    if (entry.parentHandle) {
      handles.add(entry.parentHandle);
    }
  }
  return [...handles].sort();
}

function resolveRecipientFetchedNodePath(
  node: DecryptedMegaNode,
  rootHandle: string,
  handlePathIndex: ReadonlyMap<string, string>
): string | undefined {
  if (node.parentHandle === rootHandle) {
    return sanitizePathSegment(node.name);
  }
  if (node.parentHandle) {
    const parentPath = handlePathIndex.get(node.parentHandle);
    if (parentPath) {
      return normalizeRelativePath(path.join(parentPath, sanitizePathSegment(node.name)));
    }
  }
  return handlePathIndex.get(node.handle);
}

function collectTreeHandles(tree: DecryptedMegaTree): string[] {
  return [...tree.nodesByHandle.keys()].sort();
}

function listMegaTopLevelEntryNames(tree: DecryptedMegaTree): string[] {
  return [...(tree.childrenByParent.get(tree.root.handle) ?? [])]
    .map((node) => node.name.trim())
    .filter((name) => name.length > 0)
    .sort((left, right) => left.localeCompare(right));
}

function listUnsupportedMegaTopLevelEntryNames(names: readonly string[]): string[] {
  return names.filter((name) => !EXPECTED_MEGA_TOP_LEVEL_NAMES.has(name));
}

function logUnsupportedMegaTopLevelEntries(
  runtime: Pick<IntegrationRuntime, 'logger'>,
  shareId: string,
  previousNames: readonly string[] | undefined,
  currentTopLevelNames: readonly string[]
): void {
  const previousUnsupported = new Set(previousNames ?? []);
  const currentUnsupported = listUnsupportedMegaTopLevelEntryNames(currentTopLevelNames);
  const currentUnsupportedSet = new Set(currentUnsupported);
  const added = currentUnsupported.filter((name) => !previousUnsupported.has(name));
  const removed = [...previousUnsupported]
    .filter((name) => !currentUnsupportedSet.has(name))
    .sort((left, right) => left.localeCompare(right));
  if (added.length === 0 && removed.length === 0) {
    return;
  }
  runtime.logger.log('MEGA readonly share reported unsupported top-level entries.', {
    shareId,
    added,
    removed,
    current: currentUnsupported,
  });
}

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+/, '');
}

function summarizeRefreshResult(
  prefix: string,
  result: { downloaded: string[]; removed: string[] }
): string {
  const changes: string[] = [];
  if (result.downloaded.length > 0) {
    changes.push(`${result.downloaded.length} downloaded`);
  }
  if (result.removed.length > 0) {
    changes.push(`${result.removed.length} removed`);
  }
  return changes.length > 0 ? `${prefix} ${changes.join(', ')}.` : prefix;
}

function logMegaMirrorRefreshEvents(
  runtime: Pick<IntegrationRuntime, 'logger'>,
  shareId: string,
  previousEntries: Record<string, ProviderRefreshManifestEntry>,
  result: {
    downloaded: string[];
    skipped: string[];
    invalid?: string[];
    skippedDetails?: Record<string, { code?: string; detail?: string }>;
    manifest: { entries: Record<string, ProviderRefreshManifestEntry> };
  }
): void {
  for (const relativePath of result.invalid ?? []) {
    const detail = result.skippedDetails?.[relativePath];
    runtime.logger.warn('MEGA readonly share skipped invalid entry.', {
      shareId,
      path: relativePath,
      code: detail?.code,
      detail: detail?.detail,
    });
  }

  for (const relativePath of result.downloaded) {
    const nextEntry = result.manifest.entries[relativePath];
    if (!nextEntry || nextEntry.kind !== 'file') {
      continue;
    }
    const previousEntry = previousEntries[relativePath];
    const basePayload = {
      shareId,
      path: relativePath,
      size: nextEntry.size ?? 0,
    };
    if (!previousEntry || previousEntry.kind !== 'file') {
      if (relativePath.startsWith('blocks/')) {
        runtime.logger.log('MEGA readonly share reported new block.', basePayload);
      } else {
        runtime.logger.log('MEGA readonly share reported new file.', basePayload);
      }
      continue;
    }
    runtime.logger.log(
      relativePath.startsWith('blocks/')
        ? 'MEGA readonly share reported updated block.'
        : 'MEGA readonly share reported updated file.',
      {
        ...basePayload,
        previousSize: previousEntry.size ?? 0,
      }
    );
  }
}

class MegaReadonlyRemoteAdapter implements ProviderRefreshRemoteAdapter {
  private readonly nodesByPath = new Map<string, DecryptedMegaNode>();

  constructor(
    private readonly fetchImpl: typeof fetch,
    private readonly apiClient: MegaApiClient,
    private readonly session: MegaSession,
    private readonly tree: DecryptedMegaTree,
    private readonly signal?: AbortSignal
  ) { }

  async list(): Promise<readonly ProviderRefreshRemoteEntry[]> {
    this.nodesByPath.clear();
    const entries: ProviderRefreshRemoteEntry[] = [];
    await visitTree(this.tree, async (relativePath, node) => {
      const normalizedPath = resolveMegaMirrorRelativePath(relativePath);
      if (!normalizedPath) {
        return;
      }
      this.nodesByPath.set(normalizedPath, node);
      entries.push({
        path: normalizedPath,
        kind: node.isFolder ? 'folder' : 'file',
        fingerprint: createNodeFingerprint(node),
        size: node.isFolder ? undefined : node.size,
        handle: node.handle,
        parentHandle: node.parentHandle,
      });
    });
    return entries;
  }

  async download(relativePath: string): Promise<Uint8Array> {
    const normalizedPath = normalizeRelativePath(relativePath);
    const node = this.nodesByPath.get(normalizedPath);
    if (!node || node.isFolder) {
      throw new Error(`MEGA mirror entry not found: ${normalizedPath}`);
    }
    return downloadAuthenticatedMegaFileContent(
      this.fetchImpl,
      this.apiClient,
      this.session,
      node.handle,
      node.nodeKey,
      node.size,
      this.signal
    );
  }
}

function describeMegaSyncFailure(
  error: unknown,
  localPath: string,
  signal?: AbortSignal
): { code: string; summary: string; detail: string } {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const aborted = Boolean(signal?.aborted) || (error instanceof Error && error.name === 'AbortError');

  if (aborted) {
    return {
      code: MEGA_SYNC_TIMEOUT_CODE,
      summary: 'MEGA mirror timed out',
      detail:
        'Nearbytes waited too long for MEGA while refreshing this mirror. It stopped this sync attempt and will retry automatically. Open the runtime logs if this keeps happening.',
    };
  }

  if (/ENOENT: no such file or directory/i.test(rawMessage) && rawMessage.includes(localPath)) {
    return {
      code: 'MEGA_LOCAL_MIRROR_CHANGED',
      summary: 'MEGA mirror changed mid-refresh',
      detail:
        'Nearbytes saw the local MEGA mirror change while files were being refreshed. It will retry automatically. Open the runtime logs if the same location keeps failing.',
    };
  }

  if (isMegaRetryableApiError(error)) {
    const code = (error as MegaApiError).code;
    if (code === -3) {
      return {
        code: 'MEGA_API_LOCKED',
        summary: 'MEGA asked Nearbytes to retry',
        detail:
          'MEGA temporarily locked this mirror refresh request. Nearbytes will keep the current local mirror and retry automatically.',
      };
    }
    if (code === -4) {
      return {
        code: 'MEGA_RATE_LIMITED',
        summary: 'MEGA rate limited this refresh',
        detail:
          'MEGA temporarily rate limited this mirror refresh request. Nearbytes will keep the current local mirror and retry automatically.',
      };
    }
  }

  if (isMegaRateLimitedError(error)) {
    return {
      code: 'MEGA_RATE_LIMITED',
      summary: 'MEGA rate limited this refresh',
      detail:
        'MEGA temporarily rate limited this mirror refresh request. Nearbytes will keep the current local mirror and retry automatically.',
    };
  }

  if (/fetch failed/i.test(rawMessage)) {
    return {
      code: 'MEGA_FETCH_FAILED',
      summary: 'MEGA refresh request failed',
      detail:
        'Nearbytes could not complete a MEGA network request while refreshing this mirror. Check connectivity and inspect the runtime logs for the failing request.',
    };
  }

  if (isMegaMissingRequestedRootError(error)) {
    return {
      code: 'MEGA_SHARE_KEY_PENDING',
      summary: 'Waiting for MEGA share key',
      detail:
        'Nearbytes can see this incoming MEGA share, but MEGA has not delivered a usable decryption key for the root yet. Nearbytes will retry automatically.',
    };
  }

  return {
    code: 'MEGA_SYNC_FAILED',
    summary: 'MEGA mirror refresh failed',
    detail: rawMessage,
  };
}

function validateTemporarySessionId(sessionId: string, masterKey: Buffer): void {
  const raw = decodeMegaBase64Url(sessionId);
  if (raw.length < 32) {
    throw new Error('MEGA temporary session id is invalid.');
  }
  const left = raw.subarray(0, 16);
  const right = raw.subarray(16, 32);
  if (!encryptAesEcb(left, masterKey).equals(right)) {
    throw new Error('MEGA temporary session id verification failed.');
  }
}

function decryptMegaPrivateKey(encryptedPrivateKey: Buffer, masterKey: Buffer): Buffer {
  if (encryptedPrivateKey.length === 0 || encryptedPrivateKey.length % 16 !== 0) {
    throw new Error('MEGA private key payload is invalid.');
  }
  return decryptAesEcb(encryptedPrivateKey, masterKey);
}

function encodeMegaKeyManagerPrivateRsaFromLogin(encryptedPrivateKey: string | undefined, masterKey: Buffer): Buffer {
  if (!encryptedPrivateKey) {
    throw new Error('MEGA login response is missing the RSA private key required to rebuild ^!keys.');
  }
  const decryptedPrivateKey = decryptMegaPrivateKey(decodeMegaBase64Url(encryptedPrivateKey), masterKey);
  return extractMegaPrivateKeyComponents(decryptedPrivateKey, 3);
}

function extractMegaPrivateKeyComponents(value: Buffer, componentCount: number): Buffer {
  let offset = 0;
  for (let index = 0; index < componentCount; index += 1) {
    if (offset + 2 > value.length) {
      throw new Error('MEGA private key blob is truncated.');
    }
    const bitLength = ((value[offset] ?? 0) << 8) + (value[offset + 1] ?? 0);
    const byteLength = Math.ceil(bitLength / 8);
    const nextOffset = offset + 2 + byteLength;
    if (nextOffset > value.length) {
      throw new Error('MEGA private key blob is malformed.');
    }
    offset = nextOffset;
  }
  return Buffer.from(value.subarray(0, offset));
}

function decryptSessionIdFromCsid(ciphertext: Buffer, privateKey: MegaPrivateKey, userHandle: string): string {
  const cleartext = rsaRawDecryptMpi(ciphertext, privateKey);
  if (cleartext.length !== 255) {
    throw new Error(`MEGA session id length is invalid: ${cleartext.length}.`);
  }
  const sid = encodeMegaBase64Url(cleartext.subarray(0, 43));
  const embeddedUserHandle = cleartext.subarray(16, 27).toString('latin1');
  if (embeddedUserHandle !== userHandle) {
    throw new Error('MEGA session id user-handle validation failed.');
  }
  return sid;
}

function rsaRawDecryptMpi(ciphertext: Buffer, privateKey: MegaPrivateKey): Buffer {
  if (ciphertext.length < 2) {
    throw new Error('MEGA RSA ciphertext is invalid.');
  }
  const bitLength = ((ciphertext[0] ?? 0) << 8) + (ciphertext[1] ?? 0);
  const byteLength = Math.ceil(bitLength / 8);
  const payload = ciphertext.subarray(2, 2 + byteLength);
  const decrypted = modPow(bytesToBigInt(payload), privateKey.privateExponent, privateKey.modulus);
  let result = bigIntToBuffer(decrypted, privateKey.modulusLength);
  if (result[1] !== 0) {
    result = Buffer.concat([Buffer.from([0]), result]);
  }
  return result.subarray(2);
}

function decodeMegaPrivateKey(value: Buffer): MegaPrivateKey {
  const parts: bigint[] = [];
  let offset = 0;
  for (let index = 0; index < 4; index += 1) {
    if (offset + 2 > value.length) {
      throw new Error('MEGA private key blob is truncated.');
    }
    const bitLength = ((value[offset] ?? 0) << 8) + (value[offset + 1] ?? 0);
    const byteLength = Math.ceil(bitLength / 8);
    offset += 2;
    if (offset + byteLength > value.length) {
      throw new Error('MEGA private key blob is malformed.');
    }
    parts.push(bytesToBigInt(value.subarray(offset, offset + byteLength)));
    offset += byteLength;
  }
  const [q, p, d] = parts;
  return {
    modulus: p * q,
    privateExponent: d,
    modulusLength: bufferLengthForBigInt(p * q),
  };
}

async function hasUsableMegaMirror(localPath: string): Promise<boolean> {
  try {
    const fs = await getMegaNodeFs();
    const stats = await fs.stat(localPath);
    if (!stats.isDirectory()) {
      return false;
    }
    const entries = await fs.readdir(localPath);
    return entries.length > 0;
  } catch {
    return false;
  }
}

function bytesToBigInt(value: Buffer): bigint {
  const hex = value.toString('hex');
  return hex ? BigInt(`0x${hex}`) : 0n;
}

function bigIntToBuffer(value: bigint, length: number): Buffer {
  return Buffer.from(value.toString(16).padStart(length * 2, '0'), 'hex');
}

function bufferLengthForBigInt(value: bigint): number {
  return Math.ceil(value.toString(16).length / 2);
}

function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  if (modulus === 1n) {
    return 0n;
  }
  let result = 1n;
  let currentBase = base % modulus;
  let currentExponent = exponent;
  while (currentExponent > 0n) {
    if ((currentExponent & 1n) === 1n) {
      result = (result * currentBase) % modulus;
    }
    currentExponent >>= 1n;
    currentBase = (currentBase * currentBase) % modulus;
  }
  return result;
}

async function deriveV2PasswordKey(password: string, saltBase64: string): Promise<{ masterKey: Buffer; authKey: Buffer }> {
  const passwordBytes = new TextEncoder().encode(password);
  const saltBytes = decodeMegaBase64Url(saltBase64);
  const subtle = getMegaWebCrypto().subtle;
  const key = await subtle.importKey('raw', passwordBytes, 'PBKDF2', false, ['deriveBits']);
  const derived = Buffer.from(
    await subtle.deriveBits(
      {
        name: 'PBKDF2',
        hash: 'SHA-512',
        salt: Uint8Array.from(saltBytes),
        iterations: 100000,
      },
      key,
      256
    )
  );
  return {
    masterKey: derived.subarray(0, 16),
    authKey: derived.subarray(16, 32),
  };
}

function prepareV1PasswordKey(password: string): Buffer {
  const words = strToA32(Buffer.from(password, 'utf8'));
  const keys: Buffer[] = [];
  for (let index = 0; index < words.length; index += 4) {
    keys.push(wordsToBuffer([words[index] ?? 0, words[index + 1] ?? 0, words[index + 2] ?? 0, words[index + 3] ?? 0]));
  }

  let pkey = wordsToBuffer([0x93c467e3, 0x7db0c7a4, 0xd1be3f81, 0x0152cb56]);
  for (let round = 0; round < 65536; round += 1) {
    for (const key of keys) {
      pkey = encryptAesEcb(pkey, key);
    }
  }
  return pkey;
}

function stringHash(email: string, passwordKey: Buffer): string {
  const words = strToA32(Buffer.from(email, 'utf8'));
  const hash = [0, 0, 0, 0];
  for (let index = 0; index < words.length; index += 1) {
    hash[index & 3] = (hash[index & 3] ?? 0) ^ (words[index] ?? 0);
  }
  let state = wordsToBuffer(hash);
  for (let round = 0; round < 16384; round += 1) {
    state = encryptAesEcb(state, passwordKey);
  }
  return encodeMegaBase64Url(Buffer.concat([state.subarray(0, 4), state.subarray(8, 12)]));
}

function strToA32(value: Buffer): number[] {
  const words = new Array<number>((value.length + 3) >> 2).fill(0);
  for (let index = 0; index < value.length; index += 1) {
    words[index >> 2] |= (value[index] ?? 0) << (24 - (index & 3) * 8);
  }
  return words;
}

function wordsToBuffer(words: readonly number[]): Buffer {
  const buffer = Buffer.alloc(words.length * 4);
  for (let index = 0; index < words.length; index += 1) {
    buffer.writeUInt32BE((words[index] ?? 0) >>> 0, index * 4);
  }
  return buffer;
}

function encryptAesEcb(value: Buffer, key: Buffer): Buffer {
  return Buffer.from(nobleAesEcb(key.subarray(0, 16), { disablePadding: true }).encrypt(value));
}

function decryptAesEcb(value: Buffer, key: Buffer): Buffer {
  return Buffer.from(nobleAesEcb(key.subarray(0, 16), { disablePadding: true }).decrypt(value));
}

type MegaPasswordSessionLogger = Pick<IntegrationRuntime['logger'], 'log'> | undefined;

async function megaApiCommandStandalone<T = Record<string, unknown>>(
  apiClient: MegaApiClient,
  command: Record<string, unknown>,
  session?: MegaSession,
  signal?: AbortSignal
): Promise<T> {
  return withMegaApiRetry(async () => {
    const response = await apiClient.requestSingle<T | number>(command, {
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

async function clearMegaRubbishBin(
  apiClient: MegaApiClient,
  session: MegaSession,
  signal?: AbortSignal
): Promise<void> {
  await megaApiCommandStandalone(apiClient, { a: 'dr', i: createMegaMutationRequestId() }, session, signal);
}

async function rebuildMegaSecurityAttribute(
  apiClient: MegaApiClient,
  session: MegaSession,
  signal?: AbortSignal
): Promise<{ generation: number }> {
  const currentState = await fetchMegaKeyManagerState(apiClient, session, signal);
  const currentRecords = currentState.records;
  const identityFromSession = decodeMegaBase64Url(session.userHandle);
  if (identityFromSession.length !== 8) {
    throw new Error('MEGA user handle is invalid; cannot rebuild ^!keys.');
  }

  const existingVersion = findMegaKeyManagerRecord(currentRecords, MEGA_KEY_MANAGER_VERSION_TAG)?.payload[0] ?? 1;
  const currentGeneration = readMegaKeyManagerUint32(
    findMegaKeyManagerRecord(currentRecords, MEGA_KEY_MANAGER_GENERATION_TAG)?.payload
  );
  const nowSeconds = Math.max(1, Math.floor(Date.now() / 1000));
  const nextGeneration = currentGeneration === undefined
    ? nowSeconds
    : currentGeneration >= 0xffff_ffff
      ? currentGeneration
      : (currentGeneration + 1) >>> 0;

  const existingCreationTime = findMegaKeyManagerRecord(currentRecords, MEGA_KEY_MANAGER_CREATION_TIME_TAG)?.payload;
  const creationTime = existingCreationTime?.length === 4
    ? Buffer.from(existingCreationTime)
    : buildMegaKeyManagerUint32(nowSeconds);
  const existingIdentity = findMegaKeyManagerRecord(currentRecords, MEGA_KEY_MANAGER_IDENTITY_TAG)?.payload;
  const identity = existingIdentity?.length === 8 && Buffer.from(existingIdentity).equals(identityFromSession)
    ? Buffer.from(existingIdentity)
    : Buffer.from(identityFromSession);
  const attr = Buffer.from(findMegaKeyManagerRecord(currentRecords, MEGA_KEY_MANAGER_ATTR_TAG)?.payload ?? Buffer.alloc(0));

  const existingPrivateEd25519 = findMegaKeyManagerRecord(currentRecords, MEGA_KEY_MANAGER_PRIVATE_ED25519_TAG)?.payload;
  const existingPrivateCu25519 = findMegaKeyManagerRecord(currentRecords, MEGA_KEY_MANAGER_PRIVATE_CU25519_TAG)?.payload;
  const existingPrivateRsa = findMegaKeyManagerRecord(currentRecords, MEGA_KEY_MANAGER_PRIVATE_RSA_TAG)?.payload;
  const keyring = (!existingPrivateEd25519 || !existingPrivateCu25519)
    ? await fetchMegaPrivateAttributeRecords(apiClient, session, MEGA_PRIVATE_ATTRIBUTE_KEYRING, signal)
    : null;

  const privateEd25519 = Buffer.from(existingPrivateEd25519 ?? keyring?.get('prEd255') ?? Buffer.alloc(0));
  const privateCu25519 = Buffer.from(existingPrivateCu25519 ?? keyring?.get('prCu255') ?? Buffer.alloc(0));
  const privateRsa = Buffer.from(
    existingPrivateRsa ?? encodeMegaKeyManagerPrivateRsaFromLogin(session.encryptedPrivateKey, session.masterKey)
  );

  if (privateEd25519.length !== 32 || privateCu25519.length !== 32) {
    throw new Error('MEGA keyring is missing the Ed25519 or Cu25519 private key required to rebuild ^!keys.');
  }
  if (privateRsa.length < 512) {
    throw new Error('MEGA RSA private key payload is too short for a valid ^!keys rebuild.');
  }

  const existingAuthRingEd25519 = findMegaKeyManagerRecord(currentRecords, MEGA_KEY_MANAGER_AUTH_RING_ED25519_TAG)?.payload;
  const existingAuthRingCu25519 = findMegaKeyManagerRecord(currentRecords, MEGA_KEY_MANAGER_AUTH_RING_CU25519_TAG)?.payload;
  const authRingEd25519 = Buffer.from(
    existingAuthRingEd25519
      ?? (await fetchMegaPrivateAttributeValue(apiClient, session, MEGA_PRIVATE_ATTRIBUTE_AUTH_RING_ED25519, '', signal))
      ?? Buffer.alloc(0)
  );
  const authRingCu25519 = Buffer.from(
    existingAuthRingCu25519
      ?? (await fetchMegaPrivateAttributeValue(apiClient, session, MEGA_PRIVATE_ATTRIBUTE_AUTH_RING_CU25519, '', signal))
      ?? Buffer.alloc(0)
  );

  const otherRecords = currentRecords
    .filter((record) => !MEGA_RECOVERY_KEY_MANAGER_TAGS.has(record.tag))
    .map((record) => ({
      tag: record.tag,
      payload: Buffer.from(record.payload),
    }));

  const rebuiltContainer = buildMegaRecoveryKeyManagerContainer(
    {
      version: existingVersion > 0 ? existingVersion : 1,
      creationTime,
      identity,
      generation: nextGeneration > 0 ? nextGeneration : nowSeconds,
      attr,
      privateEd25519,
      privateCu25519,
      privateRsa,
      authRingEd25519,
      authRingCu25519,
      otherRecords,
    },
    session.masterKey
  );

  await megaApiCommandStandalone(
    apiClient,
    { a: 'up2', '^!keys': encodeMegaBase64Url(rebuiltContainer) },
    session,
    signal
  );

  const verifiedState = await fetchMegaKeyManagerState(apiClient, session, signal);
  const verifiedGeneration = readMegaKeyManagerUint32(
    findMegaKeyManagerRecord(verifiedState.records, MEGA_KEY_MANAGER_GENERATION_TAG)?.payload
  );
  if (!verifiedGeneration) {
    throw new Error('MEGA ^!keys rebuild could not be verified.');
  }
  return { generation: verifiedGeneration };
}

async function createMegaPasswordSession(
  apiClient: MegaApiClient,
  logger: MegaPasswordSessionLogger,
  email: string,
  password: string,
  mfaCode?: string
): Promise<MegaSession> {
  const trimmedEmail = email.trim();
  const prelogin = await megaApiCommandStandalone<{ v?: number; s?: string }>(apiClient, { a: 'us0', user: trimmedEmail });
  const version = Number(prelogin.v ?? 1) || 1;

  let passwordKey: Buffer;
  let uh: string;
  let accountSalt: string | undefined;

  if (version > 1) {
    const salt = String(prelogin.s ?? '').trim();
    if (!salt) {
      throw new Error('MEGA did not return an authentication salt for this account.');
    }
    const derived = await deriveV2PasswordKey(password, salt);
    passwordKey = derived.masterKey;
    uh = encodeMegaBase64Url(derived.authKey);
    accountSalt = salt;
  } else {
    passwordKey = prepareV1PasswordKey(password);
    uh = stringHash(trimmedEmail.toLowerCase(), passwordKey);
  }

  const response = await megaApiCommandStandalone<Record<string, unknown>>(apiClient, {
    a: 'us',
    user: trimmedEmail,
    uh,
    ...(mfaCode ? { mfa: mfaCode } : {}),
  });

  logger?.log('MEGA login response received.', {
    email: trimmedEmail,
    hasTsid: typeof response.tsid === 'string' && response.tsid.trim().length > 0,
    hasCsid: typeof response.csid === 'string' && response.csid.trim().length > 0,
    hasPrivk: typeof response.privk === 'string' && response.privk.trim().length > 0,
    hasSek: typeof response.sek === 'string' && response.sek.trim().length > 0,
  });

  const encryptedMasterKey = decodeMegaBase64Url(assertString(response.k, 'MEGA login response is missing the encrypted master key.'));
  const masterKey = decryptAesEcb(encryptedMasterKey, passwordKey);
  const userHandle = assertString(response.u, 'MEGA login response is missing the user handle.');

  const encryptedPrivateKey = typeof response.privk === 'string' && response.privk.trim() ? response.privk.trim() : undefined;
  const privateKey = encryptedPrivateKey
    ? decodeMegaPrivateKey(decryptMegaPrivateKey(decodeMegaBase64Url(encryptedPrivateKey), masterKey))
    : undefined;

  let sid = typeof response.tsid === 'string' ? response.tsid.trim() : '';
  if (sid) {
    logger?.log('Using temporary MEGA session identifier from login response.', {
      email: trimmedEmail,
    });
    validateTemporarySessionId(sid, masterKey);
  } else {
    if (!privateKey) {
      throw new Error('MEGA login response is missing the private key.');
    }
    const sidCiphertext = decodeMegaBase64Url(assertString(response.csid, 'MEGA login response is missing the session id.'));
    sid = decryptSessionIdFromCsid(sidCiphertext, privateKey, userHandle);
    logger?.log('Using RSA-backed MEGA session identifier from login response.', {
      email: trimmedEmail,
    });
  }

  return {
    email: trimmedEmail,
    password,
    mfaCode,
    sid,
    masterKey,
    encryptedPrivateKey,
    privateKey,
    userHandle,
    accountVersion: version,
    accountSalt,
  };
}

function resolveRubbishBinHandle(snapshot: MegaFetchNodesSnapshot): string | undefined {
  for (const node of snapshot.nodes) {
    if (Number(node.t ?? 0) === 4 && typeof node.h === 'string' && node.h.trim()) {
      return node.h.trim();
    }
  }
  return undefined;
}

function collectDirectChildHandles(snapshot: MegaFetchNodesSnapshot, parentHandle: string): string[] {
  const directChildren: string[] = [];
  for (const node of snapshot.nodes) {
    const h = typeof node.h === 'string' ? node.h.trim() : '';
    if (!h) {
      continue;
    }
    const p = typeof node.p === 'string' ? node.p.trim() : '';
    if (p === parentHandle) {
      directChildren.push(h);
    }
  };
  return directChildren;
}

async function wipeMegaSubtreeHandles(
  apiClient: MegaApiClient,
  session: MegaSession,
  handles: readonly string[],
  signal?: AbortSignal
): Promise<void> {
  for (const handle of handles) {
    await deleteMegaNode(apiClient, session, handle, signal);
    await waitForMegaRetry(25, signal);
  }
}

/**
 * Revokes outgoing folder shares from this account to any of the given peer emails (e2e cleanup).
 * Uses `s2` without access level (MEGA SDK ACCESS_UNKNOWN / remove share).
 * Requires `NEARBYTES_ALLOW_DESTRUCTIVE_MEGA_E2E_WIPE=1`.
 */
export async function revokeMegaOutgoingSharesForPeers(options: {
  email: string;
  password: string;
  peerEmails: readonly string[];
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}): Promise<{ revokedCount: number }> {
  if (process.env.NEARBYTES_ALLOW_DESTRUCTIVE_MEGA_E2E_WIPE?.trim() !== '1') {
    throw new Error(
      'Refusing to revoke MEGA shares: set NEARBYTES_ALLOW_DESTRUCTIVE_MEGA_E2E_WIPE=1 (destructive; dev/e2e only).'
    );
  }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const apiClient = new MegaApiClient({ fetchImpl });
  const session = await createMegaPasswordSession(apiClient, undefined, options.email.trim(), options.password);
  const peerSet = new Set(
    options.peerEmails.map((entry) => entry.trim().toLowerCase()).filter((entry) => entry.length > 0)
  );
  if (peerSet.size === 0) {
    return { revokedCount: 0 };
  }

  const doneKeys = new Set<string>();
  let revokedCount = 0;
  const signal = options.signal;

  for (let round = 0; round < 10; round += 1) {
    const snapshot = await fetchMegaNodesSnapshot(apiClient, session, undefined, { useCache: false }, signal);
    const usersByHandle = buildMegaUsersByHandle(snapshot);
    const pendingContactsByHandle = new Map<string, string>();
    for (const pending of snapshot.outgoingPendingContacts) {
      const handle = typeof pending.p === 'string' ? pending.p.trim() : '';
      const mail = typeof pending.e === 'string' ? pending.e.trim() : '';
      if (handle && mail) {
        pendingContactsByHandle.set(handle, mail);
      }
    }

    let revokedThisRound = 0;
    for (const record of [...snapshot.outgoingShares, ...snapshot.pendingShares]) {
      const peerRaw = resolveOutgoingSharePeerEmail(record, usersByHandle, pendingContactsByHandle)?.trim();
      if (!peerRaw || !peerSet.has(peerRaw.toLowerCase())) {
        continue;
      }
      const handles = megaOutgoingShareRecordNodeHandles(record);
      const nodeHandle = handles[0];
      if (!nodeHandle) {
        continue;
      }
      const dedupeKey = `${nodeHandle}:${peerRaw.toLowerCase()}`;
      if (doneKeys.has(dedupeKey)) {
        continue;
      }

      const invitee = resolveMegaShareInviteTarget(snapshot, peerRaw);
      const command = buildMegaRevokeShareCommand(nodeHandle, invitee);
      await megaApiCommandStandalone(apiClient, command, session, signal);
      doneKeys.add(dedupeKey);
      revokedThisRound += 1;
      revokedCount += 1;
      await waitForMegaRetry(250, signal);
    }

    if (revokedThisRound === 0) {
      break;
    }
  }

  return { revokedCount };
}

/**
 * Deletes all user nodes under Cloud Drive and empties Rubbish Bin contents (e2e / dev only).
 * Requires `NEARBYTES_ALLOW_DESTRUCTIVE_MEGA_E2E_WIPE=1`.
 */
export async function wipeMegaCloudDriveContentsForE2e(options: {
  email: string;
  password: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}): Promise<{ deletedNodeCount: number }> {
  if (process.env.NEARBYTES_ALLOW_DESTRUCTIVE_MEGA_E2E_WIPE?.trim() !== '1') {
    throw new Error(
      'Refusing to wipe MEGA: set NEARBYTES_ALLOW_DESTRUCTIVE_MEGA_E2E_WIPE=1 (destructive; dev/e2e only).'
    );
  }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const apiClient = new MegaApiClient({ fetchImpl });
  const session = await createMegaPasswordSession(apiClient, undefined, options.email, options.password);

  let deleted = 0;
  const signal = options.signal;

  for (let round = 0; round < 12; round += 1) {
    const snapshot = await fetchMegaNodesSnapshot(apiClient, session, undefined, { useCache: false }, signal);
    const cloudHandle = resolveMegaCloudDriveHandle(snapshot);
    if (!cloudHandle) {
      throw new Error('MEGA snapshot did not include a Cloud Drive root.');
    }
    const underDrive = collectDirectChildHandles(snapshot, cloudHandle);
    if (underDrive.length > 0) {
      await wipeMegaSubtreeHandles(apiClient, session, underDrive, signal);
      deleted += underDrive.length;
      continue;
    }

    const rubbish = resolveRubbishBinHandle(snapshot);
    if (!rubbish) {
      break;
    }
    const inRubbish = collectDirectChildHandles(snapshot, rubbish);
    if (inRubbish.length === 0) {
      break;
    }
    await clearMegaRubbishBin(apiClient, session, signal);
    await waitForMegaRetry(250, signal);
    deleted += inRubbish.length;
  }

  return { deletedNodeCount: deleted };
}

/**
 * Deletes a specific owner path under Cloud Drive and empties Rubbish Bin afterward (e2e / dev only).
 * Requires `NEARBYTES_ALLOW_DESTRUCTIVE_MEGA_E2E_WIPE=1`.
 */
export async function clearMegaRemotePathForE2e(options: {
  email: string;
  password: string;
  remotePath: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}): Promise<{ deletedNodeCount: number }> {
  if (process.env.NEARBYTES_ALLOW_DESTRUCTIVE_MEGA_E2E_WIPE?.trim() !== '1') {
    throw new Error(
      'Refusing to clear a MEGA path: set NEARBYTES_ALLOW_DESTRUCTIVE_MEGA_E2E_WIPE=1 (destructive; dev/e2e only).'
    );
  }
  const normalizedPath = normalizeMegaRemoteDisplayPath(options.remotePath);
  if (normalizedPath === '/') {
    return wipeMegaCloudDriveContentsForE2e(options);
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const apiClient = new MegaApiClient({ fetchImpl });
  const session = await createMegaPasswordSession(apiClient, undefined, options.email.trim(), options.password);
  const signal = options.signal;

  let root: MegaOwnerRemoteRoot;
  try {
    root = await fetchOwnerRootByPath(apiClient, session, normalizedPath, signal);
  } catch (error) {
    if (error instanceof Error && /is missing\b/u.test(error.message)) {
      return { deletedNodeCount: 0 };
    }
    throw error;
  }

  await wipeMegaSubtreeHandles(apiClient, session, [root.root.handle], signal);
  await waitForMegaRetry(250, signal);

  const snapshot = await fetchMegaNodesSnapshot(apiClient, session, undefined, { useCache: false }, signal);
  const rubbish = resolveRubbishBinHandle(snapshot);
  if (rubbish && collectDirectChildHandles(snapshot, rubbish).length > 0) {
    await clearMegaRubbishBin(apiClient, session, signal);
  }

  return { deletedNodeCount: 1 };
}

/**
 * Rebuilds the MEGA ^!keys attribute from the account's surviving key material.
 * Destructive; intended only for dev/e2e recovery of broken test accounts.
 */
export async function rebuildMegaSecurityAttributeForE2e(options: {
  email: string;
  password: string;
  mfaCode?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}): Promise<{ generation: number }> {
  if (process.env.NEARBYTES_ALLOW_DESTRUCTIVE_MEGA_E2E_WIPE?.trim() !== '1') {
    throw new Error(
      'Refusing to rebuild MEGA ^!keys: set NEARBYTES_ALLOW_DESTRUCTIVE_MEGA_E2E_WIPE=1 (destructive; dev/e2e only).'
    );
  }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const apiClient = new MegaApiClient({ fetchImpl });
  const session = await createMegaPasswordSession(
    apiClient,
    undefined,
    options.email.trim(),
    options.password,
    options.mfaCode
  );
  return rebuildMegaSecurityAttribute(apiClient, session, options.signal);
}

/**
 * Compatibility wrapper for older tooling that still calls the reset helper name.
 */
export async function resetMegaSecurityAttributeForE2e(options: {
  email: string;
  password: string;
  mfaCode?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}): Promise<void> {
  await rebuildMegaSecurityAttributeForE2e(options);
}

