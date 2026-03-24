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
import type { ManagedShareMirrorEntry } from './adapters.js';
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
  readonly entries: Record<string, ProviderRefreshManifestEntry>;
}

interface MegaFetchedTree {
  readonly snapshot: MegaFetchNodesSnapshot;
  readonly tree: DecryptedMegaTree;
}

interface DecryptedMegaNode {
  readonly handle: string;
  readonly parentHandle?: string;
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
  readonly description = 'Native MEGA readonly mirroring for public links and incoming shares.';
  readonly supportsAccountConnection = true;

  private readonly apiClient: MegaApiClient;
  private readonly fetchImpl: typeof fetch;
  private readonly syncStates = new Map<string, TransportState>();
  private readonly syncTimers = new Map<string, NodeJS.Timeout>();
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
        detail: 'MEGA native readonly mirroring is available.',
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
      detail: 'MEGA native sync is built in. No local helper install is required.',
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

  async invite(_share: ManagedShare, _input: InviteManagedShareInput, _account: ProviderAccount): Promise<void> {
    throw new Error('Native MEGA share invitations are not supported.');
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
    const tree = decryptMegaTree(resolved.snapshot, resolved.session, undefined, resolved.keyManager.shareKeys);
    const offers: IncomingManagedShareOffer[] = [];

    for (const node of tree.nodesByHandle.values()) {
      if (!node.isFolder || !node.ownerHandle || node.shareHandle !== node.handle) {
        continue;
      }
      const shareName = normalizeMegaIncomingShareName(node.name, node.handle);
      const ownerIdentity = normalizeMegaIncomingOwnerIdentity(node.ownerEmail, node.ownerHandle);
      const ownerLabel = normalizeMegaIncomingOwnerLabel(node.ownerEmail, node.ownerHandle);
      const remotePath = `${ownerIdentity}:${shareName}`;
      offers.push({
        id: `mega:incoming:${node.handle}`,
        provider: this.provider,
        accountId: account.id,
        label: shareName,
        ownerLabel,
        detail: `${ownerLabel} shared this MEGA location${node.accessLevel ? ` with ${node.accessLevel}` : ''}.`,
        remoteDescriptor: {
          remotePath,
          shareName,
          ownerEmail: ownerIdentity,
          accessLevel: node.accessLevel ?? 'read',
          shareHandle: node.handle,
          rootHandle: node.handle,
        },
      });
    }

    offers.sort((left, right) => left.label.localeCompare(right.label));
    return offers;
  }

  async listManagedShareMirrors(_account: ProviderAccount): Promise<ManagedShareMirrorEntry[]> {
    return [];
  }

  async listIncomingContactInvites(_account: ProviderAccount): Promise<IncomingProviderContactInvite[]> {
    return [];
  }

  async acceptIncomingContactInvite(_account: ProviderAccount, _inviteId: string): Promise<void> {
    throw new Error('Native MEGA contact invite acceptance is not supported.');
  }

  async getState(share: ManagedShare, account: ProviderAccount | null): Promise<TransportState> {
    if (isLegacyMegaLocalMirror(share)) {
      return {
        status: 'ready',
        detail: 'This legacy MEGA Nearbytes folder is attached locally. Nearbytes is preserving the local location after reconnect.',
        badges: ['Local'],
      };
    }
    const cached = this.syncStates.get(share.id);
    if (cached) {
      return cached;
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

  async getCollaborators(share: ManagedShare, _account: ProviderAccount | null): Promise<ManagedShareCollaborator[]> {
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

  async getShareStorageMetrics(_share: ManagedShare, _account: ProviderAccount | null): Promise<ShareStorageMetrics | undefined> {
    return undefined;
  }

  async ensureSync(share: ManagedShare, account: ProviderAccount): Promise<void> {
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
      throw new Error('Only readonly incoming MEGA shares are supported by the native adapter.');
    }

    await fs.mkdir(share.localPath, { recursive: true });
    await this.runSyncLoop(share, account);
    if (!this.syncTimers.has(share.id)) {
      const timer = setInterval(() => {
        this.runSyncLoop(share, account).catch((error) => {
          this.runtime.logger.warn('MEGA sync loop failed.', error);
        });
      }, this.runtime.mega.syncIntervalMs);
      timer.unref?.();
      this.syncTimers.set(share.id, timer);
    }
  }

  async detachManagedShare(share: ManagedShare, _account: ProviderAccount | null): Promise<void> {
    const timer = this.syncTimers.get(share.id);
    if (timer) {
      clearInterval(timer);
      this.syncTimers.delete(share.id);
    }
    this.syncStates.delete(share.id);
    this.syncTasks.delete(share.id);
  }

  private async runSyncLoop(share: ManagedShare, account: ProviderAccount): Promise<void> {
    const existing = this.syncTasks.get(share.id);
    if (existing) {
      return existing;
    }

    const task = this.syncShare(share, account).finally(() => {
      if (this.syncTasks.get(share.id) === task) {
        this.syncTasks.delete(share.id);
      }
    });
    this.syncTasks.set(share.id, task);
    await task;
  }

  private async syncShare(share: ManagedShare, account: ProviderAccount): Promise<void> {
    this.syncStates.set(share.id, {
      status: 'syncing',
      detail: 'Refreshing the MEGA readonly mirror.',
      badges: READONLY_BADGES,
    });

    try {
      const session = await this.getAccountSession(account);
      const descriptor = await this.resolveIncomingShareDescriptor(account, share.remoteDescriptor);
      const rootHandle = getStringDescriptor(descriptor, 'rootHandle') ?? getStringDescriptor(descriptor, 'shareHandle');
      if (!rootHandle) {
        throw new Error('MEGA share descriptor is missing a root handle.');
      }

      const manifest = await this.loadManifest(share.id);
      const incrementalScsn = manifest.rootHandle === rootHandle ? manifest.lastScsn?.trim() : undefined;
      if (incrementalScsn) {
        try {
          const actionBatch = await this.fetchActionPackets(session, incrementalScsn);
          if (actionBatch.scsn) {
            await this.updateManifestCursor(share.id, actionBatch.scsn);
          }
          if (!actionPacketBatchTouchesShare(actionBatch.packets, rootHandle, manifest)) {
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
        fetched: await this.fetchPartialTreeWithSnapshot(activeSession, rootHandle),
      }));
      const refreshResult = await this.refreshWorker.refresh(
        share.localPath,
        new MegaReadonlyRemoteAdapter(this.fetchImpl, this.apiClient, resolved.session, resolved.fetched.tree),
        { entries: manifest.entries }
      );
      await this.runtime.secretStore.set(mirrorManifestKey(share.id), {
        rootHandle: resolved.fetched.tree.root.handle,
        lastScsn: resolved.fetched.snapshot.scsn?.trim() || manifest.lastScsn,
        knownHandles: collectTreeHandles(resolved.fetched.tree),
        entries: refreshResult.manifest.entries,
      } satisfies MegaMirrorManifest);
      this.syncStates.set(share.id, {
        status: 'ready',
        detail: summarizeRefreshResult('MEGA readonly mirror is up to date.', refreshResult),
        badges: READONLY_BADGES,
        lastSyncAt: this.runtime.now(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const needsAuth = /session|auth|credential|login|MEGA API error -15/i.test(message);
      this.syncStates.set(share.id, {
        status: needsAuth ? 'needs-auth' : 'attention',
        detail: message,
        badges: [needsAuth ? 'Reconnect' : 'Repair'],
      });
      throw error;
    }
  }

  private async getAccountSession(account: ProviderAccount): Promise<MegaSession> {
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
      await this.fetchCurrentUser(session);
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

  private async fetchCurrentUser(session: MegaSession): Promise<Record<string, unknown>> {
    return this.apiCommand<Record<string, unknown>>({ a: 'ug' }, session);
  }

  private async fetchNodesSnapshot(session: MegaSession): Promise<MegaFetchNodesSnapshot> {
    const response = await this.apiCommand<Record<string, unknown>>(buildMegaFetchNodesCommand(), session);
    return parseMegaFetchNodesSnapshot(response);
  }

  private async fetchPartialTreeWithSnapshot(session: MegaSession, rootHandle: string): Promise<MegaFetchedTree> {
    const response = await this.apiCommand<Record<string, unknown>>(
      buildMegaFetchNodesCommand({ partialRoot: rootHandle }),
      session
    );
    const snapshot = parseMegaFetchNodesSnapshot(response);
    const keyManager = await this.fetchKeyManagerState(session);
    return {
      snapshot,
      tree: decryptMegaTree(snapshot, session, rootHandle, keyManager.shareKeys),
    };
  }

  private async fetchKeyManagerState(session: MegaSession): Promise<MegaKeyManagerState> {
    try {
      const response = await this.apiCommand<Record<string, unknown>>(
        { a: 'uga', u: session.userHandle, ua: '^!keys', v: 1 },
        session
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

  private async fetchActionPackets(session: MegaSession, scsn: string): Promise<MegaActionPacketBatch> {
    const response = await this.fetchImpl(buildMegaScChannelUrl({ scsn, sessionId: session.sid }), {
      method: 'GET',
      headers: {
        accept: 'application/json',
      },
    });
    if (!response.ok) {
      throw new Error(`MEGA action-packet request failed with HTTP ${response.status}.`);
    }
    const payload = (await response.json()) as unknown;
    if (typeof payload === 'number') {
      const error = new Error(`MEGA API error ${payload}.`) as MegaApiError;
      error.code = payload;
      throw error;
    }
    return parseMegaActionPacketBatch(payload);
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
    session?: MegaSession
  ): Promise<T> {
    const response = await this.apiClient.requestSingle<T | number>(command, {
      sessionId: session?.sid,
    });
    if (typeof response === 'number') {
      const error = new Error(`MEGA API error ${response}.`) as MegaApiError;
      error.code = response;
      throw error;
    }
    return response;
  }

  private usesPublicLinkMirror(share: ManagedShare): boolean {
    return resolveMegaPublicLinkTarget(share.remoteDescriptor) !== null;
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

function createMegaReconnectRequiredError(error: unknown): Error {
  const reason = error instanceof Error ? error.message.trim() : String(error).trim();
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

  const nodeKey = decryptNodeKey(node, session, shareKeys);
  if (!nodeKey) {
    return null;
  }
  const name = decryptNodeName(typeof node.a === 'string' ? node.a : undefined, nodeKey);
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
    isFolder: Number(node.t ?? 0) !== 0,
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
  expectedSize: number
): Promise<Uint8Array> {
  const response = await apiClient.requestSingle<Record<string, unknown> | number>({ a: 'g', g: 1, n: handle }, { sessionId: session.sid });
  if (typeof response === 'number') {
    throw new Error(`MEGA API error ${response}.`);
  }
  const url = assertString(response.g, `MEGA did not return a download URL for ${handle}.`);
  const download = await fetchImpl(url);
  if (!download.ok) {
    throw new Error(`MEGA file download failed with HTTP ${download.status}.`);
  }
  const ciphertext = Buffer.from(await download.arrayBuffer());
  const plaintext = decryptFileCiphertext(ciphertext, nodeKey);
  if (expectedSize > 0 && plaintext.length !== expectedSize) {
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

class MegaReadonlyRemoteAdapter implements ProviderRefreshRemoteAdapter {
  private readonly nodesByPath = new Map<string, DecryptedMegaNode>();

  constructor(
    private readonly fetchImpl: typeof fetch,
    private readonly apiClient: MegaApiClient,
    private readonly session: MegaSession,
    private readonly tree: DecryptedMegaTree
  ) {}

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
      node.size
    );
  }
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
