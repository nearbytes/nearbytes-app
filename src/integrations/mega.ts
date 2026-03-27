import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, webcrypto } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import chokidar, { type FSWatcher } from 'chokidar';
import {
  buildMegaScChannelUrl,
  buildMegaFetchNodesCommand,
  decodeMegaBase64Url,
  encodeMegaBase64Url,
  MegaApiClient,
  parseMegaActionPacketBatch,
  parseMegaFetchNodesSnapshot,
  parseMegaJsonResponse,
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
import { MirrorWorker } from './mirrorWorker.js';
import type {
  ManagedShareMirrorEntry,
  ManagedShareRemoteEntryProbe,
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

const MEGA_SECRET_PREFIX = 'provider-account:mega:';
const MEGA_MANIFEST_PREFIX = 'provider-share:mega:manifest:';
const MEGA_RECONNECT_REQUIRED_MESSAGE =
  'Reconnect MEGA to resume syncing. If MEGA asked you to unlock the account or change the password first, complete that on mega.io and then reconnect here.';
const ZERO_IV = Buffer.alloc(16, 0);
const READONLY_BADGES = ['Readonly'];
const MEGA_SYNC_TIMEOUT_CODE = 'MEGA_SYNC_TIMEOUT';
const MEGA_RETRYABLE_API_ERROR_CODES = new Set([-3, -4]);
const MEGA_LOCK_RETRY_DELAYS_MS = [500, 1_000, 2_000, 4_000, 8_000] as const;
const MEGA_RATE_LIMIT_RETRY_DELAYS_MS = [1_500, 3_000, 5_000, 8_000, 12_000, 18_000] as const;
const MEGA_TRANSIENT_RETRY_DELAYS_MS = [500, 1_000, 2_000, 4_000, 8_000] as const;
const MEGA_TRANSIENT_SYNC_COOLDOWN_MS = 30_000;
const MEGA_POST_UPLOAD_SETTLE_MS = 30_000;
const MEGA_LOCAL_WATCH_DEBOUNCE_MS = 500;
const MEGA_SC_LISTEN_TIMEOUT_MS = 90_000;
const MEGA_DEV_INVENTORY_REFRESH_MIN_INTERVAL_MS = 60_000;
const MEGA_OWNER_COLLABORATOR_CACHE_MS = 30_000;
const MEGA_CREATE_RECOVERY_ATTEMPTS = 7;
const MEGA_UPLOAD_RECOVERY_ATTEMPTS = 7;
const MEGA_NODE_APPEAR_ATTEMPTS = 7;
const MEGA_NODE_APPEAR_DELAYS_MS = [250, 500, 1_000, 1_500, 2_500, 4_000] as const;
const EXPECTED_MEGA_TOP_LEVEL_NAMES = new Set(['blocks', 'channels', 'Nearbytes.html']);
const MEGA_PUT_NODES_PLACEHOLDER_HANDLE = 'xxxxxxxx';
const MEGA_SHARE_ACCESS_LEVEL_READ_ONLY = 0;
/** Placeholder `u` for share targets who are not yet contacts (see MegaClient::EXPORTEDLINK in meganz/sdk). */
const MEGA_SHARE_INVITE_NON_CONTACT_USER = 'EXP';
const megaSyncActivityTouchers = new WeakMap<AbortSignal, () => void>();

interface MegaShareInviteTarget {
  readonly u: string;
  readonly e?: string;
}

interface MegaAdapterOptions {
  readonly fetchImpl?: typeof fetch;
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

interface MegaKeyManagerState {
  readonly shareKeys: ReadonlyMap<string, Buffer>;
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
  readonly description = 'Native MEGA sync for owner folders plus readonly mirroring for public links and incoming shares.';
  readonly supportsAccountConnection = true;

  private readonly apiClient: MegaApiClient;
  private readonly fetchImpl: typeof fetch;
  private readonly syncStates = new Map<string, TransportState>();
  private readonly syncTimers = new Map<string, NodeJS.Timeout>();
  private readonly syncControllers = new Map<string, AbortController>();
  private readonly syncTasks = new Map<string, Promise<void>>();
  private readonly refreshWorker = new ProviderRefreshWorker();
  private readonly devInventorySignatures = new Map<string, string>();
  private readonly devInventoryRefreshedAt = new Map<string, number>();
  private readonly syncRetryCooldowns = new Map<string, number>();
  private readonly collaboratorCache = new Map<string, { expiresAt: number; collaborators: ManagedShareCollaborator[] }>();
  private readonly localWatchers = new Map<string, FSWatcher>();
  private readonly scListenerControllers = new Map<string, AbortController>();
  private readonly shareScsn = new Map<string, string>();
  private readonly shareKnownHandles = new Map<string, string[]>();
  private readonly shareRootHandles = new Map<string, string>();

  constructor(
    private readonly runtime: IntegrationRuntime,
    options: MegaAdapterOptions = {}
  ) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.apiClient = new MegaApiClient({ fetchImpl: this.fetchImpl });
  }

  async dispose(): Promise<void> {
    for (const timer of this.syncTimers.values()) {
      clearInterval(timer);
    }
    this.syncTimers.clear();
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
    this.shareRootHandles.clear();
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
    let session: MegaSession;
    try {
      session = await this.loginWithPassword(email, password, mfaCode);
    } catch (error) {
      throw normalizeMegaConnectError(error, email);
    }
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
    } satisfies MegaAccountSecret);

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
    await this.withRecoveredAccountSession(account, async (session) => {
      const root = await this.ensureOwnerRemoteRoot(session, remotePath);
      let snapshot = await this.fetchNodesSnapshot(session);
      const collaborators = collectMegaOwnerCollaborators(snapshot, root.root.handle, root.root.shareHandle);
      const existingEmails = new Set(
        collaborators
          .map((collaborator) => collaborator.email?.trim().toLowerCase())
          .filter((value): value is string => Boolean(value))
      );
      const invitees = emails.filter((email) => !existingEmails.has(email.toLowerCase()));
      if (invitees.length === 0) {
        return;
      }

      const hasExistingShares = collaborators.length > 0;
      for (const [index, email] of invitees.entries()) {
        if (index > 0) {
          await waitForMegaRetry(400);
        }
        snapshot = await this.fetchNodesSnapshot(session);
        let cryptoNow = await this.resolveOwnerShareCryptoContext(session, root);
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
        const createShareKey = !hasExistingShares && index === 0 && !cryptoNow?.shareKey;
        const existingShareKey =
          createShareKey || !cryptoNow?.shareKey ? undefined : Buffer.from(cryptoNow.shareKey);
        if (!createShareKey && !existingShareKey) {
          throw new Error(
            'MEGA has collaborators listed for this folder but Nearbytes could not read the share encryption key. Reconnect MEGA or create the share once on mega.nz, then try inviting again.'
          );
        }
        let target = resolveMegaShareInviteTarget(snapshot, email);
        if (target.u === MEGA_SHARE_INVITE_NON_CONTACT_USER && target.e) {
          try {
            await this.apiCommand({ a: 'upc', u: target.e, aa: 'a' }, session);
            this.runtime.logger.log('MEGA invite: sent pending-contact request before share invite.', {
              email: target.e,
            });
          } catch (error) {
            // Ignore transient/duplicate contact-request failures and continue with s2.
            this.runtime.logger.warn('MEGA invite: pending-contact request failed; continuing with share invite.', {
              email: target.e,
              message: error instanceof Error ? error.message : String(error),
            });
          }
        }
        this.runtime.logger.log('MEGA invite: issuing s2 set-share.', {
          email: email.trim(),
          index,
          createShareKey,
          inviteTarget: target.u === MEGA_SHARE_INVITE_NON_CONTACT_USER ? 'EXP' : 'contact',
        });
        try {
          await this.apiCommand(
            buildMegaSetShareCommand(root, session, target, MEGA_SHARE_ACCESS_LEVEL_READ_ONLY, {
              createShareKey,
              existingShareKey,
            }),
            session
          );
        } catch (error) {
          const code = typeof (error as MegaApiError | undefined)?.code === 'number' ? (error as MegaApiError).code : null;
          const canFallbackToDirectEmail =
            code === -3 &&
            target.u === MEGA_SHARE_INVITE_NON_CONTACT_USER &&
            typeof target.e === 'string' &&
            target.e.trim().length > 0;
          if (!canFallbackToDirectEmail) {
            throw error;
          }
          const fallbackTarget: MegaShareInviteTarget = { u: target.e!.trim() };
          this.runtime.logger.warn('MEGA invite: EXP target returned API -3, retrying with direct email target.', {
            email: email.trim(),
          });
          await this.apiCommand(
            buildMegaSetShareCommand(root, session, fallbackTarget, MEGA_SHARE_ACCESS_LEVEL_READ_ONLY, {
              createShareKey,
              existingShareKey,
            }),
            session
          );
        }
      }

      this.collaboratorCache.delete(share.id);
      await this.waitForMegaOutgoingInviteReflection(session, root, invitees);
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
    throw new Error(
      `MEGA did not list ${expected.join(', ')} on outgoing shares within ${Math.round(timeoutMs / 1000)}s (fetch-nodes never reflected the invite). Check mega.nz while logged in as the same account, or try again.`
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
    const resolved = await this.withRecoveredAccountSession(account, async (session) => ({
      session,
      snapshot: await this.fetchNodesSnapshot(session),
      keyManager: await this.fetchKeyManagerState(session),
    }));
    const { offers, diag } = listIncomingMegaShareOffersWithDiag(
      resolved.snapshot,
      resolved.session,
      resolved.keyManager.shareKeys,
      this.provider,
      account.id
    );
    if (diag.nodesWithSharingUser > diag.offerCount) {
      this.runtime.logger.log('MEGA incoming share discovery: not every tree node with a sharing user became an offer.', {
        accountId: account.id,
        email: account.email,
        ...diag,
      });
    }
    return offers;
  }

  async listManagedShareMirrors(account: ProviderAccount): Promise<ManagedShareMirrorEntry[]> {
    void account;
    return [];
  }

  async getShareInventoryDebug(account: ProviderAccount): Promise<{
    incoming: ProviderShareInventoryDebugEntry[];
    outgoing: ProviderShareInventoryDebugEntry[];
  }> {
    const resolved = await this.withRecoveredAccountSession(account, async (session) => ({
      session,
      snapshot: await this.fetchNodesSnapshot(session),
      keyManager: await this.fetchKeyManagerState(session),
    }));
    return buildMegaShareInventoryDebugEntries(
      resolved.snapshot,
      resolved.session,
      resolved.keyManager.shareKeys
    );
  }

  async listIncomingContactInvites(account: ProviderAccount): Promise<IncomingProviderContactInvite[]> {
    const snapshot = await this.withRecoveredAccountSession(account, (session) => this.fetchNodesSnapshot(session));
    return snapshot.incomingPendingContacts
      .map((invite) => mapIncomingMegaContactInvite(invite, account.id, this.provider))
      .filter((value): value is IncomingProviderContactInvite => value !== null)
      .sort((left, right) => left.label.localeCompare(right.label));
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
        detail: 'Reconnect MEGA to resume this readonly mirror. If MEGA asked you to unlock the account or change the password first, complete that on mega.io and then reconnect here.',
        badges: ['Reconnect'],
      };
    }
    return {
      status: 'idle',
      detail: 'MEGA readonly mirror has not started yet.',
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
      throw new Error('Forced upload is supported only for writable MEGA owner shares.');
    }
    const normalizedPath = normalizeRelativePath(relativePath);
    if (!isMirrorRelativePath(normalizedPath)) {
      throw new Error('Only channels/* and blocks/* paths can be uploaded to MEGA.');
    }

    const localFilePath = path.join(share.localPath, normalizedPath);
    const localBytes = new Uint8Array(await fs.readFile(localFilePath));
    await this.withRecoveredAccountSession(account, async (session) => {
      const remotePath = getMegaShareRemotePath(share, this.runtime.mega.remoteBasePath);
      const root = await this.ensureOwnerRemoteRoot(session, remotePath);
      const shareCrypto = await this.resolveOwnerShareCryptoContext(session, root);
      const adapter = new MegaOwnerRemoteAdapter(this.fetchImpl, this.apiClient, session, root, shareCrypto);
      await adapter.upload(normalizedPath, localBytes);
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
      await fs.mkdir(share.localPath, { recursive: true });
      await ensureMegaOwnerLocalStructure(share.localPath);
      void this.logDevShareInventoryIfChanged(account, 'boot');
      await this.runSyncLoop(share, account);
      this.startOwnerPushPullSync(share, account);
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

    await fs.mkdir(share.localPath, { recursive: true });
    void this.logDevShareInventoryIfChanged(account, 'boot');
    await this.runSyncLoop(share, account);
    this.startScChannelListener(share, account);
    this.startRecurringSyncTimer(share, account);
  }

  async detachManagedShare(share: ManagedShare, _account: ProviderAccount | null): Promise<void> {
    const timer = this.syncTimers.get(share.id);
    if (timer) {
      clearInterval(timer);
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
    this.shareRootHandles.delete(share.id);
  }

  private async runSyncLoop(share: ManagedShare, account: ProviderAccount): Promise<void> {
    const existing = this.syncTasks.get(share.id);
    if (existing) {
      return existing;
    }

    const syncAbort = createMegaSyncAbortController(this.runtime.mega.syncTimeoutMs);
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
      const descriptor = await this.resolveIncomingShareDescriptor(account, share.remoteDescriptor);
      const rootHandle = getStringDescriptor(descriptor, 'rootHandle') ?? getStringDescriptor(descriptor, 'shareHandle');
      if (!rootHandle) {
        throw new Error('MEGA share descriptor is missing a root handle.');
      }

      const manifest = await this.loadManifest(share.id);
      const incrementalScsn = manifest.rootHandle === rootHandle ? manifest.lastScsn?.trim() : undefined;
      if (incrementalScsn) {
        try {
          const actionBatch = await this.fetchActionPackets(session, incrementalScsn, signal);
          const touchesShare = actionPacketBatchTouchesShare(actionBatch.packets, rootHandle, manifest);
          if (actionBatch.packets.length) {
            this.runtime.logger.log('MEGA push update received.', {
              shareId: share.id,
              rootHandle,
              packetCount: actionBatch.packets.length,
              actions: summarizeActionPacketActions(actionBatch.packets),
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
        } catch (error) {
          if (!shouldResetScCursor(error)) {
            throw error;
          }
        }
      }

      const resolved = await this.withRecoveredAccountSession(account, async (activeSession) => ({
        session: activeSession,
        fetched: await this.fetchPartialTreeWithSnapshot(activeSession, rootHandle, signal),
      }));
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
      await this.runtime.secretStore.set(mirrorManifestKey(share.id), fetchedManifest);
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
      logMegaMirrorRefreshEvents(this.runtime, share.id, manifest.entries, refreshResult);
      await this.runtime.secretStore.set(mirrorManifestKey(share.id), {
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
      const keepMirrorReady =
        localMirrorAvailable &&
        !needsAuth &&
        (failure.code === MEGA_SYNC_TIMEOUT_CODE ||
          failure.code === 'MEGA_FETCH_FAILED' ||
          failure.code === 'MEGA_API_LOCKED' ||
          failure.code === 'MEGA_RATE_LIMITED' ||
          failure.code === 'MEGA_LOCAL_MIRROR_CHANGED');
      this.syncStates.set(share.id, {
        status: keepMirrorReady ? 'ready' : needsAuth ? 'needs-auth' : 'attention',
        detail: keepMirrorReady
          ? 'MEGA readonly mirror is available locally. The latest refresh did not complete and will retry automatically.'
          : failure.detail,
        badges: keepMirrorReady ? [...READONLY_BADGES, 'Retrying'] : [needsAuth ? 'Reconnect' : 'Repair'],
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
    const timer = setInterval(() => {
      if (isDevLogsEnabled() && this.shouldRefreshDevInventory(account, share)) {
        void this.logDevShareInventoryIfChanged(account, 'change');
      }
      if (this.isSyncCoolingDown(share.id)) {
        return;
      }
      this.runSyncLoop(share, account).catch((error) => {
        this.runtime.logger.warn('MEGA sync loop failed.', error);
      });
    }, this.runtime.mega.syncIntervalMs);
    timer.unref?.();
    this.syncTimers.set(share.id, timer);
  }

  private startOwnerPushPullSync(share: ManagedShare, account: ProviderAccount): void {
    if (this.localWatchers.has(share.id)) {
      return;
    }

    const watcher = chokidar.watch(
      [path.join(share.localPath, 'blocks'), path.join(share.localPath, 'channels')],
      {
        persistent: true,
        ignoreInitial: true,
        depth: 10,
        awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
      }
    );

    let debounceTimer: NodeJS.Timeout | null = null;
    watcher.on('all', () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        if (this.isSyncCoolingDown(share.id)) {
          return;
        }
        console.log('[MEGA:push] local change detected, triggering owner sync.', { shareId: share.id });
        this.runSyncLoop(share, account).catch((error) => {
          this.runtime.logger.warn('MEGA owner push sync failed.', error);
        });
      }, MEGA_LOCAL_WATCH_DEBOUNCE_MS);
    });
    this.localWatchers.set(share.id, watcher);

    this.startScChannelListener(share, account);
    this.startRecurringSyncTimer(share, account);

    this.runtime.logger.log('Owner push/pull sync started.', {
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
    const controller = new AbortController();
    this.scListenerControllers.set(share.id, controller);
    void this.runScChannelLoop(share, account, controller.signal);
    this.runtime.logger.log('SC channel listener started.', {
      provider: this.provider,
      shareId: share.id,
    });
  }

  private async runScChannelLoop(share: ManagedShare, account: ProviderAccount, signal: AbortSignal): Promise<void> {
    let backoffMs = 0;

    while (!signal.aborted) {
      try {
        if (backoffMs > 0) {
          await waitForMegaRetry(backoffMs, signal);
        }

        const scsn = this.shareScsn.get(share.id);
        if (!scsn) {
          await waitForMegaRetry(5_000, signal);
          continue;
        }

        const session = await this.getAccountSession(account, signal);
        const actionBatch = await this.fetchActionPackets(session, scsn, signal);

        if (actionBatch.scsn) {
          this.shareScsn.set(share.id, actionBatch.scsn);
        }

        if (actionBatch.packets.length > 0) {
          const actions = summarizeActionPacketActions(actionBatch.packets);
          const rootHandle = this.shareRootHandles.get(share.id);
          let touchesShare = true;
          if (rootHandle) {
            const knownHandles = this.shareKnownHandles.get(share.id) ?? [];
            touchesShare = actionPacketBatchTouchesShare(actionBatch.packets, rootHandle, {
              entries: {},
              knownHandles,
            });
          }
          const triggerOwnerSync = share.role === 'owner' && !allActionsAreAccountLevel(actions);
          const shouldTriggerSync = touchesShare || triggerOwnerSync;

          if (actionBatch.packets.length) {
            this.runtime.logger.log('MEGA sc channel event received.', {
              shareId: share.id,
              rootHandle,
              packetCount: actionBatch.packets.length,
              actions,
              touchesShare,
              triggerOwnerSync,
              shouldTriggerSync,
            });
          }

          if (shouldTriggerSync) {
            console.log('[MEGA:sc] remote change detected, triggering sync.', { shareId: share.id });
            try {
              await this.runSyncLoop(share, account);
            } catch {
              // sync failure is logged inside runSyncLoop; listener continues
            }
          }
          backoffMs = 0;
          continue;
        }

        if (actionBatch.waitUrl) {
          try {
            const waitController = new AbortController();
            const onParentAbort = () => waitController.abort();
            signal.addEventListener('abort', onParentAbort, { once: true });
            const waitTimeout = setTimeout(() => waitController.abort(), MEGA_SC_LISTEN_TIMEOUT_MS);
            waitTimeout.unref?.();
            try {
              await this.fetchImpl(actionBatch.waitUrl, { method: 'GET', signal: waitController.signal });
            } finally {
              clearTimeout(waitTimeout);
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
        if (shouldResetScCursor(error)) {
          this.shareScsn.delete(share.id);
        }
        backoffMs = Math.min(backoffMs ? backoffMs * 2 : 2_000, 60_000);
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
    this.syncStates.set(share.id, {
      status: 'syncing',
      detail: 'Syncing the MEGA writable owner folder.',
      badges: ['Writable', 'Syncing'],
    });

    try {
      await fs.mkdir(share.localPath, { recursive: true });
      await ensureMegaOwnerLocalStructure(share.localPath);
      const session = await this.getAccountSession(account, signal);
      console.log('[MEGA:owner-sync] session obtained, resolving remote root.', { remotePath });
      const root = await this.ensureOwnerRemoteRoot(session, remotePath, signal);
      console.log('[MEGA:owner-sync] remote root resolved.', {
        rootHandle: root.root.handle,
        rootName: root.root.name,
        rootPath: root.path,
        scsn: root.scsn,
      });
      this.shareRootHandles.set(share.id, root.root.handle);
      const worker = new MirrorWorker();
      let shareCrypto = await this.resolveOwnerShareCryptoContext(session, root, signal);
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
      const result = await worker.sync(
        share.localPath,
        new MegaOwnerRemoteAdapter(this.fetchImpl, this.apiClient, session, root, shareCrypto, signal)
      );
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
      if (isMegaTransientSyncError(error)) {
        this.markSyncCooldown(share.id);
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
          title: needsAuth ? 'Reconnect MEGA to resume owner sync' : 'MEGA owner sync needs attention',
          summary: needsAuth ? 'Reconnect required' : 'MEGA owner sync failed',
          detail,
        },
      });
      throw error;
    }
  }

  private async getAccountSession(account: ProviderAccount, signal?: AbortSignal): Promise<MegaSession> {
    const secret = await this.runtime.secretStore.get<MegaAccountSecret>(secretKey(account.id));
    if (!secret) {
      throw new Error(MEGA_RECONNECT_REQUIRED_MESSAGE);
    }
    if (!isStoredMegaAccountSecret(secret)) {
      const recovered = await this.refreshAccountSession(account, secret);
      await this.fetchCurrentUser(recovered, signal);
      return recovered;
    }

    const session = deserializeSession(secret, account.email ?? account.label);
    try {
      await this.fetchCurrentUser(session, signal);
      return session;
    } catch (error) {
      if (isMegaSessionInvalid(error)) {
        return this.refreshAccountSession(account, secret, error);
      }
      if (isMegaTemporaryLockError(error)) {
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
        const refreshed = await this.refreshAccountSession(account, undefined, error);
        return operation(refreshed);
      }
      throw error;
    }
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
      } satisfies MegaAccountSecret);
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


  private async loginWithPassword(email: string, password: string, mfaCode?: string): Promise<MegaSession> {
    const prelogin = await this.apiCommand<{ v?: number; s?: string }>({ a: 'us0', user: email.trim() });
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
      uh = stringHash(email.trim().toLowerCase(), passwordKey);
    }

    const response = await this.apiCommand<Record<string, unknown>>({
      a: 'us',
      user: email.trim(),
      uh,
      ...(mfaCode ? { mfa: mfaCode } : {}),
    });

    this.runtime.logger.log('MEGA login response received.', {
      email: email.trim(),
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
      this.runtime.logger.log('Using temporary MEGA session identifier from login response.', {
        email: email.trim(),
      });
      validateTemporarySessionId(sid, masterKey);
    } else {
      if (!privateKey) {
        throw new Error('MEGA login response is missing the private key.');
      }
      const sidCiphertext = decodeMegaBase64Url(assertString(response.csid, 'MEGA login response is missing the session id.'));
      sid = decryptSessionIdFromCsid(sidCiphertext, privateKey, userHandle);
      this.runtime.logger.log('Using RSA-backed MEGA session identifier from login response.', {
        email: email.trim(),
      });
    }

    return {
      email: email.trim(),
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

  private async fetchCurrentUser(session: MegaSession, signal?: AbortSignal): Promise<Record<string, unknown>> {
    return this.apiCommand<Record<string, unknown>>({ a: 'ug' }, session, signal);
  }


  private async fetchNodesSnapshot(session: MegaSession, signal?: AbortSignal): Promise<MegaFetchNodesSnapshot> {
    return fetchMegaNodesSnapshot(this.apiClient, session, undefined, { useCache: false }, signal);
  }

  private async fetchCompleteTree(session: MegaSession, signal?: AbortSignal): Promise<MegaFetchedTree> {
    return fetchMegaDecryptedTree(this.apiClient, session, undefined, { useCache: false }, signal);
  }

  private async fetchPartialTreeWithSnapshot(
    session: MegaSession,
    rootHandle: string,
    signal?: AbortSignal
  ): Promise<MegaFetchedTree> {
    return fetchMegaDecryptedTree(this.apiClient, session, rootHandle, { useCache: false }, signal, this.runtime.logger);
  }

  private async fetchKeyManagerState(session: MegaSession, signal?: AbortSignal): Promise<MegaKeyManagerState> {
    return fetchMegaKeyManagerState(this.apiClient, session, signal, this.runtime.logger);
  }

  private async fetchActionPackets(session: MegaSession, scsn: string, signal?: AbortSignal): Promise<MegaActionPacketBatch> {
    return withMegaApiRetry(async () => {
      const response = await this.fetchImpl(buildMegaScChannelUrl({ scsn, sessionId: session.sid }), {
        method: 'GET',
        headers: {
          accept: 'application/json',
        },
        signal,
      });
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
    }, signal);
  }

  private async resolveIncomingShareDescriptor(
    account: ProviderAccount,
    descriptor: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const existingHandle = getStringDescriptor(descriptor, 'rootHandle') ?? getStringDescriptor(descriptor, 'shareHandle');
    if (existingHandle) {
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
    return (await this.runtime.secretStore.get<MegaMirrorManifest>(mirrorManifestKey(shareId))) ?? { entries: {} };
  }

  private async updateManifestCursor(shareId: string, scsn: string): Promise<void> {
    const manifest = await this.loadManifest(shareId);
    await this.runtime.secretStore.set(mirrorManifestKey(shareId), {
      ...manifest,
      lastScsn: scsn.trim(),
    } satisfies MegaMirrorManifest);
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
    let fetched = await this.fetchCompleteTree(session, signal);
    let current = fetched.tree.root;

    for (const segment of segments) {
      const existing = findChildNodeByName(fetched.tree, current.handle, segment, true);
      if (existing) {
        current = existing;
        continue;
      }
      const created = await this.ensureOwnerRemoteFolder(session, current.handle, segment, signal);
      fetched = created.fetched;
      current = created.node;
      continue;
    }

    return {
      path: normalizedPath,
      root: current,
      tree: fetched.tree,
      scsn: fetched.snapshot.scsn?.trim(),
    };
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
      const fetched = await this.fetchPartialTreeWithSnapshot(session, parentHandle, signal);
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
    const fetched = await this.fetchPartialTreeWithSnapshot(session, parentHandle, signal);
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
    const shareHandle = root.root.shareHandle?.trim();
    if (!shareHandle) {
      return undefined;
    }

    const keyManager = await this.fetchKeyManagerState(session, signal);
    const shareKey = keyManager.shareKeys.get(shareHandle);
    if (shareKey) {
      return { shareHandle, shareKey: Buffer.from(shareKey) };
    }

    // Fallback: look for the share key in the snapshot (outgoing shares `ok` field,
    // or the `sk` field on the root node itself).
    const snapshot = await this.fetchNodesSnapshot(session, signal);
    const snapshotShareKeys = collectMegaShareKeys(snapshot, session);
    const fallbackKey = snapshotShareKeys.get(shareHandle);
    if (fallbackKey) {
      this.runtime.logger.log('MEGA share crypto context resolved via snapshot fallback (key-manager miss).', {
        shareHandle,
        email: session.email,
      });
      return { shareHandle, shareKey: Buffer.from(fallbackKey) };
    }

    this.runtime.logger.warn('MEGA share crypto context could not be resolved — share key not found in key-manager or snapshot.', {
      shareHandle,
      email: session.email,
      keyManagerShareCount: keyManager.shareKeys.size,
      snapshotShareKeyCount: snapshotShareKeys.size,
    });
    return undefined;
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
    const shareHandle = root.root.shareHandle?.trim();
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
  for (const key of ['t', 'h'] as const) {
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

class MegaOwnerRemoteAdapter {
  // Cache of created folders: key is `${parentHandle}/${name}`, value is the created handle.
  // Prevents duplicate folder creation within a single sync cycle.
  private readonly createdFolders = new Map<string, string>();

  constructor(
    private readonly fetchImpl: typeof fetch,
    private readonly apiClient: MegaApiClient,
    private readonly session: MegaSession,
    private readonly ownerRoot: MegaOwnerRemoteRoot,
    private readonly shareCrypto: MegaShareCryptoContext | undefined,
    private readonly signal?: AbortSignal
  ) { }

  async list(): Promise<readonly MirrorRemoteEntry[]> {
    debugMegaLog('[MEGA:owner-adapter] listing remote entries.', {
      rootHandle: this.ownerRoot.root.handle,
      rootPath: this.ownerRoot.path,
    });
    const fetched = await fetchMegaDecryptedTree(
      this.apiClient,
      this.session,
      this.ownerRoot.root.handle,
      { useCache: false },
      this.signal
    );
    const entries: MirrorRemoteEntry[] = [];
    await visitTree(fetched.tree, async (relativePath, node) => {
      if (!isMirrorRelativePath(relativePath)) {
        return;
      }
      entries.push({
        path: normalizeRelativePath(relativePath),
        size: node.isFolder ? 0 : node.size,
      });
    });
    const sorted = entries.sort((left, right) => left.path.localeCompare(right.path));
    debugMegaLog('[MEGA:owner-adapter] remote entries listed.', {
      count: sorted.length,
      paths: sorted.map((e) => e.path),
    });
    return sorted;
  }

  async download(relativePath: string): Promise<Uint8Array> {
    debugMegaLog('[MEGA:owner-adapter] downloading file from owner root.', { relativePath });
    const node = findNodeByRelativePath(this.ownerRoot.tree, this.ownerRoot.root.handle, relativePath);
    if (!node || node.isFolder) {
      console.error('[MEGA:owner-adapter] download target not found in tree.', { relativePath });
      throw new Error(`MEGA owner folder is missing ${relativePath}.`);
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
    debugMegaLog('[MEGA:owner-adapter] download completed.', { relativePath, size: data.length });
    return data;
  }

  async upload(relativePath: string, data: Uint8Array): Promise<void> {
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

    const parent = await ensureTreePath(
      this.apiClient,
      this.session,
      this.ownerRoot,
      folderSegments,
      this.createdFolders,
      this.shareCrypto,
      this.signal
    );
    debugMegaLog('[MEGA:owner-adapter] checking remote for existing file via live tree.', { parentHandle: parent.handle, name });
    const existing = await findMegaRemoteChildNode(this.apiClient, this.session, parent.handle, name, false, this.signal);
    if (existing && existing.size === data.length) {
      debugMegaLog('[MEGA:owner-adapter] upload skipped (already exists on remote).', {
        relativePath: normalized,
        existingHandle: existing.handle,
      });
      return;
    }
    if (existing && existing.size !== data.length) {
      await deleteMegaNode(this.apiClient, this.session, existing.handle, this.signal);
    }

    debugMegaLog('[MEGA:owner-adapter] uploading file to MEGA.', {
      relativePath: normalized,
      parentHandle: parent.handle,
      name,
      dataSize: data.length,
    });
    await uploadMegaOwnerFile(
      this.fetchImpl,
      this.apiClient,
      this.session,
      parent.handle,
      name,
      Buffer.from(data),
      this.shareCrypto,
      this.signal
    );
    // Keep a hard visibility check so uploads only count once the final name is visible in MEGA snapshots.
    const visibleNode = await waitForMegaChildNodeInFullSnapshot(
      this.apiClient,
      this.session,
      parent.handle,
      name,
      false,
      this.signal
    );
    if (!visibleNode || visibleNode.isFolder) {
      throw new Error(`MEGA did not make the uploaded file visible for ${name}.`);
    }
    debugMegaLog('[MEGA:owner-adapter] upload completed.', { relativePath: normalized });
  }
}

function isMirrorRelativePath(value: string): boolean {
  return value.startsWith('blocks/') || value.startsWith('channels/');
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
  const candidates = [...(tree.childrenByParent.get(parentHandle) ?? [])].filter((node) => {
    if (folderOnly && !node.isFolder) {
      return false;
    }
    return node.name === name;
  });
  candidates.sort((left, right) => compareMegaNodeCandidates(tree, left, right));
  return candidates[0];
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

async function ensureTreePath(
  apiClient: MegaApiClient,
  session: MegaSession,
  ownerRoot: MegaOwnerRemoteRoot,
  segments: readonly string[],
  createdFolders: Map<string, string>,
  shareCrypto: MegaShareCryptoContext | undefined,
  signal?: AbortSignal
): Promise<DecryptedMegaNode> {
  let current = ownerRoot.root;
  for (const segment of segments) {
    // First check the initial tree snapshot.
    const existing = findChildNodeByName(ownerRoot.tree, current.handle, segment, true);
    if (existing) {
      current = existing;
      continue;
    }
    // Then check the cache of folders created during this sync cycle.
    const cacheKey = `${current.handle}/${segment}`;
    const cachedHandle = createdFolders.get(cacheKey);
    if (cachedHandle) {
      current = {
        handle: cachedHandle,
        parentHandle: current.handle,
        nodeType: 1,
        isFolder: true,
        size: 0,
        name: segment,
        nodeKey: Buffer.alloc(16),
      };
      continue;
    }
    // Create the folder and cache the handle.
    const createdHandle = await createMegaFolder(apiClient, session, current.handle, segment, shareCrypto, signal);
    createdFolders.set(cacheKey, createdHandle);
    debugMegaLog('[MEGA:ensureTreePath] folder created.', { segment, parentHandle: current.handle, createdHandle });
    current = {
      handle: createdHandle,
      parentHandle: current.handle,
      nodeType: 1,
      isFolder: true,
      size: 0,
      name: segment,
      nodeKey: Buffer.alloc(16),
    };
  }
  return current;
}

function buildMegaSetShareCommand(
  ownerRoot: MegaOwnerRemoteRoot,
  _session: MegaSession,
  invitee: MegaShareInviteTarget,
  accessLevel: number,
  options: {
    readonly createShareKey?: boolean;
    readonly existingShareKey?: Buffer;
  } = {}
): Record<string, unknown> {
  const shareKey = options.existingShareKey ?? randomBytes(16);
  // Match MEGA SDK behavior: modern API paths accept dummy all-zero ok/ha.
  // (See sdk/src/commands.cpp CommandSetShare TODO comment.)
  const dummy = Buffer.alloc(16, 0);
  const command: Record<string, unknown> = {
    a: 's2',
    n: ownerRoot.root.handle,
    ok: encodeMegaBase64Url(dummy),
    ha: encodeMegaBase64Url(dummy),
    s: [
      {
        u: invitee.u,
        r: accessLevel,
      },
    ],
  };
  if (invitee.e) {
    command.e = invitee.e;
  }
  if (options.createShareKey !== false) {
    command.cr = buildMegaShareNodeKeyRecords(ownerRoot, shareKey);
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
    logger?.warn?.('MEGA key-manager state fetch failed.', {
      email: session.email,
      message: error instanceof Error ? error.message : String(error),
    });
    return { shareKeys: new Map() };
  }
}

async function fetchMegaDecryptedTree(
  apiClient: MegaApiClient,
  session: MegaSession,
  rootHandle?: string,
  options: {
    readonly useCache?: boolean;
  } = {},
  signal?: AbortSignal,
  logger?: Pick<IntegrationRuntime['logger'], 'warn'>
): Promise<MegaFetchedTree> {
  let snapshot: MegaFetchNodesSnapshot;
  if (rootHandle) {
    try {
      snapshot = parseMegaFetchNodesSnapshot(await requestMegaNodesSnapshot(apiClient, session, rootHandle, options, signal));
    } catch (error) {
      if (!isMegaRetryableApiError(error) && !isMegaRetryableTransportError(error) && !isMegaAccessDeniedError(error)) {
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
  const expectedRootHandle = rootHandle?.trim() || resolveMegaCloudDriveHandle(snapshot);
  try {
    return {
      snapshot,
      tree: decryptMegaTree(snapshot, session, expectedRootHandle, keyManager.shareKeys, logger),
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
    return {
      snapshot: fullSnapshot,
      tree: decryptMegaTree(fullSnapshot, session, expectedRootHandle, keyManager.shareKeys, logger),
    };
  }
}

async function findMegaRemoteChildNode(
  apiClient: MegaApiClient,
  session: MegaSession,
  parentHandle: string,
  name: string,
  folderOnly: boolean,
  signal?: AbortSignal
): Promise<DecryptedMegaNode | undefined> {
  try {
    const fetched = await fetchMegaDecryptedTree(apiClient, session, parentHandle, {}, signal);
    return findChildNodeByName(fetched.tree, parentHandle, name, folderOnly);
  } catch (error) {
    if (!isMegaMissingRequestedRootError(error)) {
      throw error;
    }
    const fetched = await fetchMegaDecryptedTree(apiClient, session, undefined, {}, signal);
    return findChildNodeByName(fetched.tree, parentHandle, name, folderOnly);
  }
}

async function findMegaRemoteChildNodeInFullSnapshot(
  apiClient: MegaApiClient,
  session: MegaSession,
  parentHandle: string,
  name: string,
  folderOnly: boolean,
  signal?: AbortSignal
): Promise<DecryptedMegaNode | undefined> {
  const fetched = await fetchMegaDecryptedTree(apiClient, session, undefined, { useCache: false }, signal);
  return findChildNodeByName(fetched.tree, parentHandle, name, folderOnly);
}

async function waitForMegaChildNode(
  apiClient: MegaApiClient,
  session: MegaSession,
  parentHandle: string,
  name: string,
  folderOnly: boolean,
  signal?: AbortSignal
): Promise<DecryptedMegaNode | undefined> {
  for (let attempt = 0; attempt < MEGA_NODE_APPEAR_ATTEMPTS; attempt += 1) {
    const node = await findMegaRemoteChildNode(apiClient, session, parentHandle, name, folderOnly, signal);
    if (node) {
      return node;
    }
    if (attempt < MEGA_NODE_APPEAR_DELAYS_MS.length) {
      await waitForMegaRetry(MEGA_NODE_APPEAR_DELAYS_MS[attempt]!, signal);
    }
  }
  return undefined;
}

async function waitForMegaChildNodeInFullSnapshot(
  apiClient: MegaApiClient,
  session: MegaSession,
  parentHandle: string,
  name: string,
  folderOnly: boolean,
  signal?: AbortSignal
): Promise<DecryptedMegaNode | undefined> {
  for (let attempt = 0; attempt < MEGA_NODE_APPEAR_ATTEMPTS; attempt += 1) {
    const node = await findMegaRemoteChildNodeInFullSnapshot(apiClient, session, parentHandle, name, folderOnly, signal);
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
  const fetched = await fetchMegaDecryptedTree(apiClient, session, undefined, {}, signal);
  const tree = fetched.tree;
  let current = tree.root;
  const segments = normalizeMegaRemoteDisplayPath(remotePath).split('/').filter((entry) => entry.length > 0);
  for (const segment of segments) {
    const next = findChildNodeByName(tree, current.handle, segment, true);
    if (!next) {
      throw new Error(`MEGA path ${remotePath} is missing ${segment}.`);
    }
    current = next;
  }
  return {
    path: normalizeMegaRemoteDisplayPath(remotePath),
    root: current,
    tree: fetched.tree,
  };
}

async function createMegaFolder(
  apiClient: MegaApiClient,
  session: MegaSession,
  parentHandle: string,
  name: string,
  shareCrypto: MegaShareCryptoContext | undefined,
  signal?: AbortSignal
): Promise<string> {
  for (let attempt = 0; attempt < MEGA_CREATE_RECOVERY_ATTEMPTS; attempt += 1) {
    const nodeKey = randomBytes(16);
    try {
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
      const committedNode = await waitForMegaChildNode(apiClient, session, parentHandle, name, true, signal);
      if (!committedNode || !committedNode.isFolder) {
        throw new Error(`MEGA did not make the created folder visible for ${name}.`);
      }
      const globallyVisibleNode = await waitForMegaChildNodeInFullSnapshot(
        apiClient,
        session,
        parentHandle,
        name,
        true,
        signal
      );
      if (!globallyVisibleNode || !globallyVisibleNode.isFolder) {
        throw new Error(`MEGA did not make the created folder globally visible for ${name}.`);
      }
      debugMegaLog('[MEGA:create-folder] folder became globally visible.', {
        parentHandle,
        name,
        attempt,
        handle: globallyVisibleNode.handle,
      });
      return globallyVisibleNode.handle;
    } catch (error) {
      console.warn('[MEGA:create-folder] create attempt failed.', {
        parentHandle,
        name,
        attempt,
        message: error instanceof Error ? error.message : String(error),
      });
      const recovered = await findMegaRemoteChildNode(apiClient, session, parentHandle, name, true, signal);
      if (recovered?.isFolder) {
        const globallyVisibleNode = await findMegaRemoteChildNodeInFullSnapshot(
          apiClient,
          session,
          parentHandle,
          name,
          true,
          signal
        );
        if (globallyVisibleNode?.isFolder) {
          return globallyVisibleNode.handle;
        }
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
  signal?: AbortSignal
): Promise<DecryptedMegaNode> {
  for (let attempt = 0; attempt < MEGA_UPLOAD_RECOVERY_ATTEMPTS; attempt += 1) {
    try {
      const transferKey = randomBytes(16);
      const iv = randomBytes(8);

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
      const committedNode = await waitForMegaChildNode(apiClient, session, parentHandle, name, false, signal);
      if (!committedNode || committedNode.isFolder) {
        throw new Error(`MEGA did not make the uploaded file visible for ${name}.`);
      }
      const globallyVisibleNode = await waitForMegaChildNodeInFullSnapshot(
        apiClient,
        session,
        parentHandle,
        name,
        false,
        signal
      );
      if (!globallyVisibleNode || globallyVisibleNode.isFolder) {
        throw new Error(`MEGA did not make the uploaded file globally visible for ${name}.`);
      }
      return globallyVisibleNode;
    } catch (error) {
      const recovered = await findMegaRemoteChildNode(apiClient, session, parentHandle, name, false, signal);
      if (recovered && !recovered.isFolder) {
        const globallyVisibleNode = await findMegaRemoteChildNodeInFullSnapshot(
          apiClient,
          session,
          parentHandle,
          name,
          false,
          signal
        );
        if (globallyVisibleNode && !globallyVisibleNode.isFolder) {
          return globallyVisibleNode;
        }
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
  const cipher = createCipheriv('aes-128-cbc', key.subarray(0, 16), ZERO_IV);
  cipher.setAutoPadding(false);
  return encodeMegaBase64Url(Buffer.concat([cipher.update(padded), cipher.final()]));
}

function encryptMegaFileContent(data: Buffer, transferKey: Buffer, iv: Buffer): Buffer {
  const counter = Buffer.alloc(16, 0);
  iv.copy(counter, 0);
  const cipher = createCipheriv('aes-128-ctr', transferKey, counter);
  return Buffer.concat([cipher.update(data), cipher.final()]);
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
    return `Reconnect MEGA to resume the writable owner sync for ${remotePath}. ${message}`.trim();
  }
  return `Nearbytes could not sync the writable MEGA owner folder ${remotePath}. ${message}`.trim();
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

function acceptedShareCapabilities(_descriptor: Record<string, unknown>): string[] {
  return ['mirror', 'read', 'accept'];
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

function isMegaSessionInvalid(error: unknown): boolean {
  const code = typeof (error as MegaApiError | undefined)?.code === 'number' ? (error as MegaApiError).code : null;
  if (code === -15) {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /MEGA API error -15|session|auth|login/i.test(message);
}

function isMegaRetryableApiError(error: unknown): error is MegaApiError {
  const code = typeof (error as MegaApiError | undefined)?.code === 'number' ? (error as MegaApiError).code : null;
  return code !== null && MEGA_RETRYABLE_API_ERROR_CODES.has(code);
}

function isMegaTemporaryLockError(error: unknown): boolean {
  const code = typeof (error as MegaApiError | undefined)?.code === 'number' ? (error as MegaApiError).code : null;
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
  const code = typeof (error as MegaApiError | undefined)?.code === 'number' ? (error as MegaApiError).code : null;
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
  const apiCode = typeof (error as MegaApiError | undefined)?.code === 'number' ? (error as MegaApiError).code : null;
  const httpStatus = getMegaHttpStatus(error);
  return apiCode === -4 || httpStatus === 429;
}

function getMegaRetryDelayMs(error: unknown, attempt: number): number {
  const apiCode = typeof (error as MegaApiError | undefined)?.code === 'number' ? (error as MegaApiError).code : null;
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

async function waitForMegaRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    throw createMegaAbortError();
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, delayMs);
    timer.unref?.();

    const onAbort = () => {
      cleanup();
      reject(createMegaAbortError());
    };

    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function createMegaAbortError(): Error {
  const error = new Error('This operation was aborted.');
  error.name = 'AbortError';
  return error;
}

function isMegaMissingRequestedRootError(error: unknown): boolean {
  return error instanceof Error && error.message === 'MEGA tree did not include the requested root node.';
}

function createMegaSyncAbortController(timeoutMs: number): {
  controller: AbortController;
  dispose: () => void;
} {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | null = null;

  const scheduleAbort = () => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
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
        clearTimeout(timer);
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
  expectedRootHandle?: string,
  extraShareKeys: ReadonlyMap<string, Buffer> = new Map(),
  logger?: Pick<IntegrationRuntime['logger'], 'warn'>
): DecryptedMegaTree {
  const usersByHandle = new Map<string, MegaUserRecord>();
  for (const user of snapshot.users) {
    const handle = typeof user.u === 'string' ? user.u.trim() : '';
    if (handle) {
      usersByHandle.set(handle, user);
    }
  }

  const shareKeys = new Map<string, Buffer>();
  for (const [handle, shareKey] of extraShareKeys.entries()) {
    shareKeys.set(handle, shareKey);
  }
  for (const node of snapshot.nodes) {
    if (typeof node.h !== 'string' || typeof (node as Record<string, unknown>).su !== 'string' || typeof (node as Record<string, unknown>).sk !== 'string') {
      continue;
    }
    const shareKey = decryptShareKey(String((node as Record<string, unknown>).sk), session);
    if (shareKey) {
      shareKeys.set(node.h, shareKey);
    }
  }
  for (const shareRecord of [...snapshot.outgoingShares, ...snapshot.pendingShares]) {
    const handle = typeof shareRecord.t === 'string'
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
      shareKeys.set(handle, shareKey);
    }
  }

  const nodesByHandle = new Map<string, DecryptedMegaNode>();
  let undecryptedNodeCount = 0;
  for (const node of snapshot.nodes) {
    const decrypted = decryptNodeRecord(node, session, shareKeys, usersByHandle);
    if (decrypted) {
      nodesByHandle.set(decrypted.handle, decrypted);
    } else if (typeof node.h === 'string') {
      undecryptedNodeCount += 1;
    }
  }
  if (undecryptedNodeCount > 0 && logger) {
    logger.warn('MEGA tree decryption: some nodes could not be decrypted.', {
      undecryptedNodeCount,
      totalNodes: snapshot.nodes.length,
      decryptedNodes: nodesByHandle.size,
      shareKeysAvailable: shareKeys.size,
      hasPrivateKey: Boolean(session.privateKey),
      expectedRootHandle,
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
  const root = nodesByHandle.get(rootHandle);
  if (!root) {
    throw new Error('MEGA tree did not include the requested root node.');
  }

  return {
    root,
    nodesByHandle,
    childrenByParent,
  };
}

interface MegaIncomingShareDiscoveryDiag {
  readonly nodesWithSharingUser: number;
  readonly skippedExplicitFile: number;
  readonly skippedNoDecrypt: number;
  readonly skippedShareHandleMismatch: number;
  readonly offerCount: number;
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
  const offers: IncomingManagedShareOffer[] = [];
  let skippedExplicitFile = 0;
  let skippedNoDecrypt = 0;
  let skippedShareHandleMismatch = 0;
  let nodesWithSharingUser = 0;

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
      continue;
    }
    if (decrypted.shareHandle !== decrypted.handle) {
      skippedShareHandleMismatch += 1;
      continue;
    }
    const shareName = normalizeMegaIncomingShareName(decrypted.name, decrypted.handle);
    const ownerIdentity = normalizeMegaIncomingOwnerIdentity(decrypted.ownerEmail, decrypted.ownerHandle);
    const ownerLabel = normalizeMegaIncomingOwnerLabel(decrypted.ownerEmail, decrypted.ownerHandle);
    const remotePath = `${ownerIdentity}:${shareName}`;
    offers.push({
      id: `mega:incoming:${decrypted.handle}`,
      provider,
      accountId,
      label: shareName,
      ownerLabel,
      detail: `${ownerLabel} shared this MEGA location${decrypted.accessLevel ? ` with ${decrypted.accessLevel}` : ''}.`,
      remoteDescriptor: {
        remotePath,
        shareName,
        ownerEmail: ownerIdentity,
        accessLevel: decrypted.accessLevel ?? 'read',
        shareHandle: decrypted.handle,
        rootHandle: decrypted.handle,
      },
    });
  }

  offers.sort((left, right) => left.label.localeCompare(right.label));
  const diag: MegaIncomingShareDiscoveryDiag = {
    nodesWithSharingUser,
    skippedExplicitFile,
    skippedNoDecrypt,
    skippedShareHandleMismatch,
    offerCount: offers.length,
  };
  return { offers, diag };
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
      shareKeys.set(node.h, shareKey);
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
      shareKeys.set(handle, shareKey);
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
      shareKeys.set(handle, shareKey);
    }
  }
  return shareKeys;
}

function parseMegaKeyManagerState(response: Record<string, unknown>, masterKey: Buffer): MegaKeyManagerState {
  const encodedValue = typeof response.av === 'string' ? response.av.trim() : '';
  if (!encodedValue) {
    return { shareKeys: new Map() };
  }

  const container = decodeMegaBase64Url(encodedValue);
  const plaintext = decryptMegaKeyManagerContainer(container, masterKey);
  return {
    shareKeys: parseMegaKeyManagerShareKeys(plaintext),
  };
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
  const decipher = createDecipheriv('aes-128-gcm', derivedKey, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function deriveMegaKeyManagerKey(masterKey: Buffer): Buffer {
  return Buffer.from(hkdfSync('sha256', masterKey, Buffer.alloc(0), Buffer.from([1]), 16));
}

function parseMegaKeyManagerShareKeys(value: Buffer): Map<string, Buffer> {
  const result = new Map<string, Buffer>();
  let offset = 0;
  while (offset + 4 <= value.length) {
    const tag = value[offset] ?? 0;
    const length = ((value[offset + 1] ?? 0) << 16) | ((value[offset + 2] ?? 0) << 8) | (value[offset + 3] ?? 0);
    offset += 4;
    if (offset + length > value.length) {
      throw new Error('MEGA key-manager record is malformed.');
    }
    const payload = value.subarray(offset, offset + length);
    offset += length;
    if (tag !== 48) {
      continue;
    }
    for (let entryOffset = 0; entryOffset + 23 <= payload.length; entryOffset += 23) {
      const handle = encodeMegaBase64Url(payload.subarray(entryOffset, entryOffset + 6));
      const shareKey = payload.subarray(entryOffset + 6, entryOffset + 22);
      result.set(handle, Buffer.from(shareKey));
    }
  }
  return result;
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
  usersByHandle: ReadonlyMap<string, MegaUserRecord>
): DecryptedMegaNode | null {
  const handle = typeof node.h === 'string' ? node.h.trim() : '';
  if (!handle) {
    return null;
  }

  const nodeType = Number(node.t ?? 0);
  const isSpecialRoot = nodeType === 2 || nodeType === 3 || nodeType === 4;
  const nodeKey = decryptNodeKey(node, session, shareKeys) ?? (isSpecialRoot ? Buffer.alloc(16, 0) : null);
  if (!nodeKey) {
    return null;
  }
  const name = decryptNodeName(typeof node.a === 'string' ? node.a : undefined, nodeKey) ?? describeMegaSpecialNodeName(nodeType);
  if (!name) {
    return null;
  }

  const nodeMeta = node as Record<string, unknown>;
  const ownerHandle = typeof nodeMeta.su === 'string' ? nodeMeta.su.trim() : undefined;
  const ownerEmail = ownerHandle ? (typeof usersByHandle.get(ownerHandle)?.m === 'string' ? String(usersByHandle.get(ownerHandle)?.m) : undefined) : undefined;
  const accessLevel = megaIncomingAccessLevelFromMeta(nodeMeta);
  const shareHandle = ownerHandle ? handle : deriveShareHandle(typeof node.k === 'string' ? node.k : undefined, shareKeys);

    return {
      handle,
      parentHandle: typeof node.p === 'string' && node.p.trim() ? node.p.trim() : undefined,
      nodeType,
      isFolder: nodeType !== 0,
      size: Number(node.s ?? 0) || 0,
      name,
      modifiedAt: typeof node.ts === 'number' && Number.isFinite(node.ts) ? Math.trunc(node.ts) : undefined,
      nodeKey,
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
    if (shareKeys.has(handle)) {
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

function decryptNodeKey(
  node: MegaNodeRecord,
  session: MegaSession,
  shareKeys: ReadonlyMap<string, Buffer>
): Buffer | null {
  const encoded = typeof node.k === 'string' ? node.k.trim() : '';
  if (!encoded) {
    return null;
  }

  let keyOwner = '';
  let payload = '';
  if (encoded.length === 22 || encoded.length === 43) {
    keyOwner = session.userHandle;
    payload = encoded;
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
    const preferredOwner = ownedSegments.find((segment) => segment.owner === session.userHandle)
      ?? ownedSegments.find((segment) => shareKeys.has(segment.owner));
    if (preferredOwner) {
      keyOwner = preferredOwner.owner;
      payload = preferredOwner.payload;
    } else if (encoded.length > 12 && encoded[11] === ':') {
      const owner = encoded.slice(0, 11).trim();
      const candidate = encoded.slice(12).trim();
      if (owner === session.userHandle || shareKeys.has(owner)) {
        keyOwner = owner;
        payload = candidate;
      }
    }
  }

  if (!payload) {
    return null;
  }

  const encrypted = decodeMegaBase64Url(payload);
  if (payload.length > 43) {
    if (!session.privateKey) {
      return null;
    }
    const cleartext = rsaRawDecryptMpi(encrypted, session.privateKey);
    const keyLength = Number(node.t ?? 0) !== 0 ? 16 : 32;
    return cleartext.length >= keyLength ? cleartext.subarray(0, keyLength) : null;
  }

  const key = keyOwner === session.userHandle ? session.masterKey : shareKeys.get(keyOwner);
  if (!key || encrypted.length === 0 || encrypted.length % 16 !== 0) {
    return null;
  }
  return decryptAesEcb(encrypted, key);
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
  const decipher = createDecipheriv('aes-128-cbc', deriveAttributeKey(nodeKey), ZERO_IV);
  decipher.setAutoPadding(false);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8').replace(/\u0000+$/u, '');
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
  const decipher = createDecipheriv('aes-128-ctr', deriveAttributeKey(nodeKey), iv);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
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
  return action === 't' && !handles.length;
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

function allActionsAreAccountLevel(actions: readonly string[]): boolean {
  return actions.length > 0 && actions.every((action) => ACCOUNT_LEVEL_ACTIONS.has(action));
}

function sanitizePathSegment(value: string): string {
  const cleaned = value.replace(/[<>:"/\\|?*\u0000-\u001f]+/gu, ' ').trim();
  return cleaned || 'unnamed';
}

function createNodeFingerprint(node: DecryptedMegaNode): string {
  const hash = createHash('sha256');
  hash.update(node.handle);
  hash.update('\n');
  hash.update(String(node.size));
  hash.update('\n');
  hash.update(node.encodedAttributes ?? '');
  hash.update('\n');
  hash.update(node.encodedKey ?? '');
  return hash.digest('hex');
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
    manifest: { entries: Record<string, ProviderRefreshManifestEntry> };
  }
): void {
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
      const normalizedPath = normalizeRelativePath(relativePath);
      this.nodesByPath.set(normalizedPath, node);
      entries.push({
        path: normalizedPath,
        kind: node.isFolder ? 'folder' : 'file',
        fingerprint: createNodeFingerprint(node),
        size: node.isFolder ? undefined : node.size,
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
  const key = await webcrypto.subtle.importKey('raw', passwordBytes, 'PBKDF2', false, ['deriveBits']);
  const derived = Buffer.from(
    await webcrypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        hash: 'SHA-512',
        salt: saltBytes,
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
  const cipher = createCipheriv('aes-128-ecb', key.subarray(0, 16), null);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(value), cipher.final()]);
}

function decryptAesEcb(value: Buffer, key: Buffer): Buffer {
  const decipher = createDecipheriv('aes-128-ecb', key.subarray(0, 16), null);
  decipher.setAutoPadding(false);
  return Buffer.concat([decipher.update(value), decipher.final()]);
}

