import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, webcrypto } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
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
import type { ManagedShareMirrorEntry, ManagedShareRemoteEntryProbe, MirrorRemoteEntry } from './adapters.js';
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
const MEGA_API_RETRY_DELAYS_MS = [250, 500, 1_000, 2_000] as const;
const EXPECTED_MEGA_TOP_LEVEL_NAMES = new Set(['blocks', 'channels', 'Nearbytes.html']);
const MEGA_WRITABLE_SHARE_ACCESS_LEVEL = 2;

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
    this.syncStates.clear();
    this.syncTasks.clear();
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
    const session = await this.loginWithPassword(email, password, mfaCode);
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
      const collaborators = collectMegaOwnerCollaborators(await this.fetchNodesSnapshot(session), root.root.handle);
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
        await this.apiCommand(
          buildMegaSetShareCommand(root, email, MEGA_WRITABLE_SHARE_ACCESS_LEVEL, {
            createShareKey: !hasExistingShares && index === 0,
          }),
          session
        );
      }
    });
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
    return listIncomingMegaShareOffers(
      resolved.snapshot,
      resolved.session,
      resolved.keyManager.shareKeys,
      this.provider,
      account.id
    );
  }

  async listManagedShareMirrors(account: ProviderAccount): Promise<ManagedShareMirrorEntry[]> {
    void account;
    return [];
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
      return this.withRecoveredAccountSession(account, async (session) => {
        const remotePath = getMegaShareRemotePath(share, this.runtime.mega.remoteBasePath);
        const root = await this.ensureOwnerRemoteRoot(session, remotePath);
        return collectMegaOwnerCollaborators(await this.fetchNodesSnapshot(session), root.root.handle);
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
      await this.runSyncLoop(share, account);
      this.startRecurringSyncTimer(share, account);
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
    await this.runSyncLoop(share, account);
    this.startRecurringSyncTimer(share, account);
  }

  async detachManagedShare(share: ManagedShare, _account: ProviderAccount | null): Promise<void> {
    const timer = this.syncTimers.get(share.id);
    if (timer) {
      clearInterval(timer);
      this.syncTimers.delete(share.id);
    }
    const controller = this.syncControllers.get(share.id);
    if (controller) {
      controller.abort();
      this.syncControllers.delete(share.id);
    }
    this.syncStates.delete(share.id);
    this.syncTasks.delete(share.id);
  }

  private async runSyncLoop(share: ManagedShare, account: ProviderAccount): Promise<void> {
    const existing = this.syncTasks.get(share.id);
    if (existing) {
      return existing;
    }

    const controller = new AbortController();
    this.syncControllers.set(share.id, controller);
    const timeout = setTimeout(() => {
      controller.abort();
    }, this.runtime.mega.syncTimeoutMs);
    timeout.unref?.();

    const task = this.syncShare(share, account, controller.signal).finally(() => {
      clearTimeout(timeout);
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
      this.runSyncLoop(share, account).catch((error) => {
        this.runtime.logger.warn('MEGA sync loop failed.', error);
      });
    }, this.runtime.mega.syncIntervalMs);
    timer.unref?.();
    this.syncTimers.set(share.id, timer);
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
      });
      const worker = new MirrorWorker();
      const result = await worker.sync(
        share.localPath,
        new MegaOwnerRemoteAdapter(this.fetchImpl, this.apiClient, session, root, signal)
      );
      console.log('[MEGA:owner-sync] owner share sync completed.', {
        shareId: share.id,
        uploaded: result.uploaded,
        downloaded: result.downloaded,
      });
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
      await this.runtime.secretStore.delete(secretKey(account.id));
      throw new Error(MEGA_RECONNECT_REQUIRED_MESSAGE);
    }

    const session = deserializeSession(secret, account.email ?? account.label);
    try {
      await this.fetchCurrentUser(session, signal);
      return session;
    } catch (error) {
      if (isMegaSessionInvalid(error)) {
        return this.refreshAccountSession(account, secret, error);
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
    cachedSecret?: MegaAccountSecret,
    cause?: unknown
  ): Promise<MegaSession> {
    const secret = cachedSecret ?? (await this.runtime.secretStore.get<MegaAccountSecret>(secretKey(account.id)));
    if (!secret || !isStoredMegaAccountSecret(secret)) {
      if (secret && !isStoredMegaAccountSecret(secret)) {
        await this.runtime.secretStore.delete(secretKey(account.id));
      }
      this.runtime.logger.warn('MEGA session refresh skipped because the stored account secret is missing or malformed.', {
        accountId: account.id,
        hadSecret: Boolean(secret),
      });
      throw createMegaReconnectRequiredError(cause);
    }

    const email = (typeof secret.email === 'string' && secret.email.trim() !== '' ? secret.email : account.email ?? '').trim();
    const password = typeof secret.password === 'string' ? secret.password : '';
    if (!email || !password) {
      this.runtime.logger.warn('MEGA session refresh skipped because reusable credentials are not available.', {
        accountId: account.id,
        hasEmail: email.length > 0,
        hasPassword: password.length > 0,
        hasMfaCode: typeof secret.mfaCode === 'string' && secret.mfaCode.trim().length > 0,
      });
      throw createMegaReconnectRequiredError(cause);
    }

    try {
      this.runtime.logger.log('Refreshing MEGA session with the stored account credentials.', {
        accountId: account.id,
        hasMfaCode: typeof secret.mfaCode === 'string' && secret.mfaCode.trim().length > 0,
      });
      const refreshed = await this.loginWithPassword(email, password, secret.mfaCode);
      await this.runtime.secretStore.set(secretKey(account.id), {
        ...secret,
        email,
        sid: refreshed.sid,
        masterKey: encodeMegaBase64Url(refreshed.masterKey),
        encryptedPrivateKey: refreshed.encryptedPrivateKey ?? secret.encryptedPrivateKey,
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
    const response = await this.apiCommand<Record<string, unknown>>(buildMegaFetchNodesCommand(), session, signal);
    return parseMegaFetchNodesSnapshot(response);
  }

  private async fetchCompleteTree(session: MegaSession, signal?: AbortSignal): Promise<MegaFetchedTree> {
    const snapshot = await this.fetchNodesSnapshot(session, signal);
    const keyManager = await this.fetchKeyManagerState(session, signal);
    const rootHandle = resolveMegaCloudDriveHandle(snapshot);
    return {
      snapshot,
      tree: decryptMegaTree(snapshot, session, rootHandle, keyManager.shareKeys),
    };
  }

  private async fetchPartialTreeWithSnapshot(
    session: MegaSession,
    rootHandle: string,
    signal?: AbortSignal
  ): Promise<MegaFetchedTree> {
    let snapshot: MegaFetchNodesSnapshot;
    try {
      const response = await this.apiCommand<Record<string, unknown>>(
        buildMegaFetchNodesCommand({ partialRoot: rootHandle }),
        session,
        signal
      );
      snapshot = parseMegaFetchNodesSnapshot(response);
    } catch (error) {
      if (!isMegaRetryableApiError(error) && !isMegaRetryableTransportError(error)) {
        throw error;
      }
      this.runtime.logger.warn('MEGA partial tree fetch failed; falling back to a full node snapshot.', {
        email: session.email,
        rootHandle,
        message: error instanceof Error ? error.message : String(error),
      });
      snapshot = await this.fetchNodesSnapshot(session, signal);
    }
    const keyManager = await this.fetchKeyManagerState(session, signal);
    try {
      return {
        snapshot,
        tree: decryptMegaTree(snapshot, session, rootHandle, keyManager.shareKeys),
      };
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'MEGA tree did not include the requested root node.') {
        throw error;
      }
      this.runtime.logger.warn('MEGA partial tree decryption missed the requested root; falling back to a full node snapshot.', {
        email: session.email,
        rootHandle,
      });
      const fullSnapshot = await this.fetchNodesSnapshot(session, signal);
      return {
        snapshot: fullSnapshot,
        tree: decryptMegaTree(fullSnapshot, session, rootHandle, keyManager.shareKeys),
      };
    }
  }

  private async fetchKeyManagerState(session: MegaSession, signal?: AbortSignal): Promise<MegaKeyManagerState> {
    try {
      const response = await this.apiCommand<Record<string, unknown>>(
        { a: 'uga', u: session.userHandle, ua: '^!keys', v: 1 },
        session,
        signal
      );
      return parseMegaKeyManagerState(response, session.masterKey);
    } catch (error) {
      this.runtime.logger.warn('MEGA key-manager state fetch failed.', {
        email: session.email,
        message: error instanceof Error ? error.message : String(error),
      });
      return { shareKeys: new Map() };
    }
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
      await this.createRemoteFolderNode(session, current.handle, segment, signal);
      const created = await this.waitForOwnerRemoteFolder(session, current.handle, segment, signal);
      fetched = created.fetched;
      current = created.node;
      continue;
    }

    return {
      path: normalizedPath,
      root: current,
      tree: fetched.tree,
    };
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
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const fetched = await this.fetchPartialTreeWithSnapshot(session, parentHandle, signal);
      const created = findChildNodeByName(fetched.tree, parentHandle, name, true);
      if (!created) {
        if (attempt < 5) {
          await waitForMegaRetry(250 * (attempt + 1), signal);
          continue;
        }
        throw new Error(`MEGA did not create ${name}.`);
      }
      return {
        fetched,
        node: created,
      };
    }
    throw new Error(`MEGA did not create ${name}.`);
  }

  private async createRemoteFolderNode(
    session: MegaSession,
    parentHandle: string,
    name: string,
    signal?: AbortSignal
  ): Promise<void> {
    const nodeKey = randomBytes(16);
    const encryptedNodeKey = encryptMegaNodeKeyForOwner(nodeKey, session.masterKey);
    await this.apiCommand(
      {
        a: 'p',
        v: 4,
        sm: 1,
        t: parentHandle,
        n: [
          {
            h: encodeMegaBase64Url(randomBytes(6)),
            t: 1,
            a: encryptMegaAttributes(name, nodeKey),
            k: encodeMegaBase64Url(encryptedNodeKey),
          },
        ],
      },
      session,
      signal
    );
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

function collectMegaOwnerCollaborators(
  snapshot: MegaFetchNodesSnapshot,
  rootHandle: string
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
    const nodeHandle = typeof record.h === 'string' ? record.h.trim() : '';
    if (!nodeHandle || nodeHandle !== rootHandle) {
      continue;
    }
    const userHandle = typeof record.u === 'string' ? record.u.trim() : '';
    const pendingHandle = typeof record.p === 'string' ? record.p.trim() : '';
    const email =
      (userHandle ? usersByHandle.get(userHandle)?.m : undefined) ??
      (pendingHandle ? pendingContactsByHandle.get(pendingHandle) : undefined) ??
      undefined;
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
    private readonly signal?: AbortSignal
  ) { }

  async list(): Promise<readonly MirrorRemoteEntry[]> {
    console.log('[MEGA:owner-adapter] listing remote entries.', {
      rootHandle: this.ownerRoot.root.handle,
      rootPath: this.ownerRoot.path,
    });
    const entries: MirrorRemoteEntry[] = [];
    await visitTree(this.ownerRoot.tree, async (relativePath, node) => {
      if (!isMirrorRelativePath(relativePath)) {
        return;
      }
      entries.push({
        path: normalizeRelativePath(relativePath),
        size: node.isFolder ? 0 : node.size,
      });
    });
    const sorted = entries.sort((left, right) => left.path.localeCompare(right.path));
    console.log('[MEGA:owner-adapter] remote entries listed.', {
      count: sorted.length,
      paths: sorted.map((e) => e.path),
    });
    return sorted;
  }

  async download(relativePath: string): Promise<Uint8Array> {
    console.log('[MEGA:owner-adapter] downloading file from owner root.', { relativePath });
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
    console.log('[MEGA:owner-adapter] download completed.', { relativePath, size: data.length });
    return data;
  }

  async upload(relativePath: string, data: Uint8Array): Promise<void> {
    const normalized = normalizeRelativePath(relativePath);
    const folderSegments = normalized.split('/').slice(0, -1);
    const name = normalized.split('/').at(-1)?.trim() ?? '';
    if (!name) {
      throw new Error('MEGA upload path must include a file name.');
    }

    console.log('[MEGA:owner-adapter] preparing upload.', {
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
      this.signal
    );
    const existing = findChildNodeByName(this.ownerRoot.tree, parent.handle, name, false);
    if (existing) {
      console.log('[MEGA:owner-adapter] upload skipped (already exists on remote).', {
        relativePath: normalized,
        existingHandle: existing.handle,
      });
      return;
    }

    console.log('[MEGA:owner-adapter] uploading file to MEGA.', {
      relativePath: normalized,
      parentHandle: parent.handle,
      name,
      dataSize: data.length,
    });
    await uploadMegaOwnerFile(this.fetchImpl, this.apiClient, this.session, parent.handle, name, Buffer.from(data), this.signal);
    console.log('[MEGA:owner-adapter] upload completed.', { relativePath: normalized });
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
  return (tree.childrenByParent.get(parentHandle) ?? []).find((node) => {
    if (folderOnly && !node.isFolder) {
      return false;
    }
    return node.name === name;
  });
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
    const createdHandle = await createMegaFolder(apiClient, session, current.handle, segment, signal);
    createdFolders.set(cacheKey, createdHandle);
    console.log('[MEGA:ensureTreePath] folder created.', { segment, parentHandle: current.handle, createdHandle });
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
  email: string,
  accessLevel: number,
  options: {
    readonly createShareKey?: boolean;
  } = {}
): Record<string, unknown> {
  const command: Record<string, unknown> = {
    a: 's2',
    n: ownerRoot.root.handle,
    ok: encodeMegaBase64Url(Buffer.alloc(16, 0)),
    ha: encodeMegaBase64Url(Buffer.alloc(16, 0)),
    s: [
      {
        u: email,
        r: accessLevel,
      },
    ],
  };
  if (options.createShareKey !== false) {
    command.cr = buildMegaShareNodeKeyRecords(ownerRoot, randomBytes(16));
  }
  return command;
}

function buildMegaShareNodeKeyRecords(ownerRoot: MegaOwnerRemoteRoot, shareKey: Buffer): readonly unknown[] {
  const shareHandles = [ownerRoot.root.handle];
  const itemHandles: string[] = [];
  const records: Array<readonly [number, number, string]> = [];
  const nodes = [ownerRoot.root, ...collectChildNodes(ownerRoot.tree, ownerRoot.root.handle)];
  for (const node of nodes) {
    const itemIndex = itemHandles.length;
    itemHandles.push(node.handle);
    records.push([0, itemIndex, encodeMegaBase64Url(encryptAesEcb(node.nodeKey, shareKey))]);
  }
  return [shareHandles, itemHandles, records];
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

async function fetchOwnerRootByPath(
  apiClient: MegaApiClient,
  session: MegaSession,
  remotePath: string,
  signal?: AbortSignal
): Promise<MegaOwnerRemoteRoot> {
  const snapshot = await withMegaApiRetry(async () => {
    const response = await apiClient.requestSingle<Record<string, unknown> | number>(buildMegaFetchNodesCommand(), {
      sessionId: session.sid,
      signal,
    });
    if (typeof response === 'number') {
      const error = new Error(`MEGA API error ${response}.`) as MegaApiError;
      error.code = response;
      throw error;
    }
    return parseMegaFetchNodesSnapshot(response);
  }, signal);
  const cloudDriveHandle = resolveMegaCloudDriveHandle(snapshot);
  const tree = decryptMegaTree(snapshot, session, cloudDriveHandle);
  let current = tree.root;
  const segments = normalizeMegaRemoteDisplayPath(remotePath).split('/').filter((entry) => entry.length > 0);
  console.log('[MEGA:fetchOwnerRootByPath] resolving path.', {
    remotePath,
    segments,
    cloudDriveHandle,
    rootHandle: tree.root.handle,
    rootName: tree.root.name,
  });
  for (const segment of segments) {
    const children = tree.childrenByParent.get(current.handle) ?? [];
    console.log('[MEGA:fetchOwnerRootByPath] looking for segment in parent.', {
      segment,
      parentHandle: current.handle,
      parentName: current.name,
      childCount: children.length,
      childNames: children.map((c) => ({ name: c.name, handle: c.handle, isFolder: c.isFolder })),
    });
    const next = findChildNodeByName(tree, current.handle, segment, true);
    if (!next) {
      throw new Error(`MEGA path ${remotePath} is missing ${segment}.`);
    }
    current = next;
  }
  return {
    path: normalizeMegaRemoteDisplayPath(remotePath),
    root: current,
    tree,
  };
}

async function createMegaFolder(
  apiClient: MegaApiClient,
  session: MegaSession,
  parentHandle: string,
  name: string,
  signal?: AbortSignal
): Promise<string> {
  return withMegaApiRetry(async () => {
    const nodeKey = randomBytes(16);
    const response = await apiClient.requestSingle<Record<string, unknown> | number>(
      {
        a: 'p',
        t: parentHandle,
        n: [
          {
            h: encodeMegaBase64Url(randomBytes(6)),
            t: 1,
            a: encryptMegaAttributes(name, nodeKey),
            k: encodeMegaBase64Url(encryptMegaNodeKeyForOwner(nodeKey, session.masterKey)),
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
    // Extract handle from response.f[0].h (standard 'p' command response)
    const createdNodes = Array.isArray(response.f) ? response.f : [];
    const createdNode = createdNodes[0] as Record<string, unknown> | undefined;
    const handle = typeof createdNode?.h === 'string' ? createdNode.h.trim() : '';
    if (!handle) {
      console.error('[MEGA:createMegaFolder] unexpected response.', {
        name, parentHandle,
        responseKeys: Object.keys(response),
        f: JSON.stringify(response.f)?.slice(0, 500),
      });
      throw new Error(`MEGA did not return a handle for the created folder ${name}.`);
    }
    console.log('[MEGA:createMegaFolder] folder created.', { name, parentHandle, handle });
    return handle;
  }, signal);
}

async function uploadMegaOwnerFile(
  fetchImpl: typeof fetch,
  apiClient: MegaApiClient,
  session: MegaSession,
  parentHandle: string,
  name: string,
  data: Buffer,
  signal?: AbortSignal
): Promise<void> {
  await withMegaApiRetry(async () => {
    console.log('[MEGA:upload] requesting upload slot.', {
      parentHandle,
      name,
      dataSize: data.length,
    });
    const transferKey = randomBytes(16);
    const iv = randomBytes(8);

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
      console.error('[MEGA:upload] upload reservation FAILED with API error.', { name, errorCode: uploadReservation });
      const error = new Error(`MEGA API error ${uploadReservation}.`) as MegaApiError;
      error.code = uploadReservation;
      throw error;
    }

    const uploadUrl = assertString(uploadReservation.p, `MEGA did not return an upload URL for ${name}.`);
    console.log('[MEGA:upload] upload slot obtained, encrypting and sending data.', {
      name,
      uploadUrl: uploadUrl.slice(0, 80) + '...',
      dataSize: data.length,
    });
    const encrypted = encryptMegaFileContent(data, transferKey, iv);
    const crc = computeMegaUploadChecksum(encrypted);
    const uploadResponse = await fetchImpl(`${uploadUrl}/0?d=${encodeMegaBase64Url(crc)}`, {
      method: 'POST',
      body: new Uint8Array(encrypted),
      signal,
    });
    if (!uploadResponse.ok) {
      console.error('[MEGA:upload] HTTP upload FAILED.', { name, status: uploadResponse.status });
      throw new Error(`MEGA upload failed with HTTP ${uploadResponse.status}.`);
    }
    const uploadToken = Buffer.from(await uploadResponse.arrayBuffer());
    if (uploadToken.length === 0) {
      console.error('[MEGA:upload] empty upload token received.', { name });
      throw new Error(`MEGA did not return an upload token for ${name}.`);
    }
    console.log('[MEGA:upload] data sent, committing node.', {
      name,
      uploadTokenLength: uploadToken.length,
    });

    const sentNodeKey = buildMegaFileNodeKey(transferKey, iv, computeMegaMetaMac(data, transferKey, iv));
    const response = await apiClient.requestSingle<Record<string, unknown> | number>(
      {
        a: 'p',
        v: 4,
        sm: 1,
        t: parentHandle,
        n: [
          {
            h: encodeMegaBase64Url(uploadToken),
            t: 0,
            a: encryptMegaAttributes(name, transferKey),
            k: encodeMegaBase64Url(encryptMegaNodeKeyForOwner(sentNodeKey, session.masterKey)),
          },
        ],
      },
      { sessionId: session.sid, signal }
    );
    if (typeof response === 'number') {
      console.error('[MEGA:upload] node commit FAILED with API error.', { name, errorCode: response });
      const error = new Error(`MEGA API error ${response}.`) as MegaApiError;
      error.code = response;
      throw error;
    }
    console.log('[MEGA:upload] file upload completed successfully.', { name, parentHandle });
  }, signal);
}

function encryptMegaNodeKeyForOwner(nodeKey: Buffer, masterKey: Buffer): Buffer {
  return encryptAesEcb(nodeKey, masterKey);
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

function acceptedShareCapabilities(descriptor: Record<string, unknown>): string[] {
  const accessLevel = (getStringDescriptor(descriptor, 'accessLevel') ?? '').trim().toLowerCase();
  if (accessLevel === '2' || accessLevel === '3' || accessLevel === 'full' || accessLevel === 'full access' || accessLevel === 'owner') {
    return ['mirror', 'read', 'write', 'accept'];
  }
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

function isMegaRetryableTransportError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /fetch failed/i.test(message) ||
    /ECONNRESET|ECONNREFUSED|ETIMEDOUT|network/i.test(message) ||
    /HTTP 5\d\d/i.test(message)
  );
}

async function withMegaApiRetry<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await operation();
    } catch (error) {
      if (
        (!isMegaRetryableApiError(error) && !isMegaRetryableTransportError(error)) ||
        attempt >= MEGA_API_RETRY_DELAYS_MS.length
      ) {
        throw error;
      }
      const delayMs = MEGA_API_RETRY_DELAYS_MS[attempt] ?? MEGA_API_RETRY_DELAYS_MS[MEGA_API_RETRY_DELAYS_MS.length - 1];
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
  extraShareKeys: ReadonlyMap<string, Buffer> = new Map()
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
  for (const shareRecord of snapshot.outgoingShares) {
    const handle = typeof shareRecord.t === 'string'
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

  const nodesByHandle = new Map<string, DecryptedMegaNode>();
  for (const node of snapshot.nodes) {
    const decrypted = decryptNodeRecord(node, session, shareKeys, usersByHandle);
    if (decrypted) {
      nodesByHandle.set(decrypted.handle, decrypted);
    }
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

function listIncomingMegaShareOffers(
  snapshot: MegaFetchNodesSnapshot,
  session: MegaSession,
  extraShareKeys: ReadonlyMap<string, Buffer>,
  provider: string,
  accountId: string
): IncomingManagedShareOffer[] {
  const usersByHandle = buildMegaUsersByHandle(snapshot);
  const shareKeys = collectMegaShareKeys(snapshot, session, extraShareKeys);
  const offers: IncomingManagedShareOffer[] = [];

  for (const node of snapshot.nodes) {
    const nodeMeta = node as Record<string, unknown>;
    const ownerHandle = typeof nodeMeta.su === 'string' ? nodeMeta.su.trim() : '';
    if (!ownerHandle || Number(node.t ?? 0) === 0) {
      continue;
    }
    const decrypted = decryptNodeRecord(node, session, shareKeys, usersByHandle);
    if (!decrypted || !decrypted.ownerHandle || decrypted.shareHandle !== decrypted.handle) {
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
  return offers;
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
  const accessLevel = typeof nodeMeta.r === 'number' ? describeAccessLevel(nodeMeta.r) : undefined;
  const shareHandle = ownerHandle ? handle : deriveShareHandle(typeof node.k === 'string' ? node.k : undefined, shareKeys);

  return {
    handle,
    parentHandle: typeof node.p === 'string' && node.p.trim() ? node.p.trim() : undefined,
    nodeType,
    isFolder: nodeType !== 0,
    size: Number(node.s ?? 0) || 0,
    name,
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

function decryptShareKey(value: string, session: MegaSession): Buffer | null {
  const payload = value.trim();
  if (!payload) {
    return null;
  }
  if (payload.length > 43) {
    if (!session.privateKey) {
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
  } else if (encoded.length > 12 && encoded[11] === ':' && encoded.slice(0, 11) === session.userHandle) {
    keyOwner = session.userHandle;
    payload = encoded.slice(12);
  } else {
    for (const segment of encoded.split('/')) {
      const colonIndex = segment.indexOf(':');
      if (colonIndex <= 0) {
        continue;
      }
      const owner = segment.slice(0, colonIndex).trim();
      const candidate = segment.slice(colonIndex + 1).trim();
      if (shareKeys.has(owner)) {
        keyOwner = owner;
        payload = candidate;
        break;
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
