import { randomBytes } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { MegaHelperInstaller } from './megaInstaller.js';
import type { ManagedShareMirrorEntry } from './adapters.js';
import type {
  AcceptManagedShareInput,
  ConnectProviderAccountInput,
  ConnectProviderAccountResult,
  ConfigureProviderInput,
  CreateManagedShareInput,
  IncomingManagedShareOffer,
  IncomingProviderContactInvite,
  InviteManagedShareInput,
  ManagedShareCollaborator,
  ManagedShare,
  ProviderAccount,
  ProviderAuthSession,
  ProviderSetupState,
  ShareStorageMetrics,
  TransportState,
} from './types.js';
import { resolveMegaInvocation, type IntegrationRuntime } from './runtime.js';

const MEGA_SESSION_SECRET_PREFIX = 'provider-account:mega:';

interface MegaSessionSecret {
  readonly email: string;
  readonly sessionToken: string;
}

interface MegaSyncRecord {
  readonly id?: string;
  readonly localPath?: string;
  readonly remotePath?: string;
  readonly runState?: string;
  readonly status?: string;
  readonly error?: string;
}

interface MegaSyncIssueDetail {
  readonly issueId: string;
  readonly parentSyncId: string;
  readonly reason: string;
  readonly filename?: string;
  readonly parentLocalPath?: string;
  readonly parentRemotePath?: string;
}

interface MegaStorageQuota {
  readonly usedBytes: number;
  readonly totalBytes: number;
  readonly availableBytes: number;
}

interface MegaShareCollaboratorRecord {
  readonly email: string;
  readonly accessLevel?: string;
}

interface MegaIncomingShareRecord {
  readonly ownerEmail: string;
  readonly shareName: string;
  readonly remotePath: string;
  readonly accessLevel?: string;
}

interface MegaIncomingContactInviteRecord {
  readonly id: string;
  readonly email: string;
}

interface MegaAuthSession extends ProviderAuthSession {
  readonly email: string;
  readonly password: string;
  readonly mfaCode?: string;
  readonly requestedLabel?: string;
}

const MEGA_AUTH_SESSION_TTL_MS = 1000 * 60 * 30;

export class MegaTransportAdapter {
  readonly provider = 'mega';
  readonly label = 'MEGA';
  readonly description = 'Managed folders and provider shares backed by MEGA CLI sync.';
  readonly supportsAccountConnection = true;

  private readonly authSessions = new Map<string, MegaAuthSession>();
  private readonly syncStates = new Map<string, TransportState>();
  private readonly syncTimers = new Map<string, NodeJS.Timeout>();
  private readonly pullTasks = new Map<string, Promise<void>>();
  private readOnlySyncSupport:
    | {
        readonly commandDirectory: string | undefined;
        readonly supported: boolean;
      }
    | undefined;
  private readonly installer: MegaHelperInstaller;

  constructor(
    private readonly runtime: IntegrationRuntime,
    installer?: MegaHelperInstaller
  ) {
    this.installer =
      installer ??
      new MegaHelperInstaller({
        secretStore: runtime.secretStore,
        commandExecutor: runtime.commandExecutor,
        logger: runtime.logger,
        configuredCommandDirectory: runtime.mega.commandDirectory,
      });
  }

  async probe(endpoint: import('./types.js').TransportEndpoint): Promise<TransportState> {
    if (endpoint.transport === 'provider-share' && endpoint.provider?.trim().toLowerCase() === this.provider) {
      return {
        status: 'ready',
        detail: 'MEGA CLI is available for managed share planning.',
        badges: ['CLI'],
      };
    }
    return {
      status: 'unsupported',
      detail: 'MEGA does not handle this endpoint.',
      badges: ['Experimental'],
    };
  }

  async getSetupState(): Promise<ProviderSetupState> {
    return this.installer.getSetupState();
  }

  async configure(_input: ConfigureProviderInput): Promise<ProviderSetupState> {
    return this.getSetupState();
  }

  async install(): Promise<ProviderSetupState> {
    return this.installer.install();
  }

  async connect(input: ConnectProviderAccountInput): Promise<ConnectProviderAccountResult> {
    if (input.authSessionId) {
      return this.pollAuthSession(input);
    }
    if (input.mode === 'signup') {
      return this.startSignup(input);
    }
    const credentials = input.credentials;
    const email = credentials?.email?.trim() || input.email?.trim();
    const password = credentials?.password ?? '';
    const mfaCode = credentials?.mfaCode?.trim() || '';
    if (!email || !password) {
      throw new Error('MEGA needs an email and password.');
    }

    const accountId = input.accountId?.trim() || createOpaqueId('acct-mega');
    return this.loginWithCredentials({
      accountId,
      email,
      password,
      mfaCode: mfaCode || undefined,
      label: input.label?.trim() || 'MEGA',
    });
  }

  async createManagedShare(
    input: CreateManagedShareInput,
    account: ProviderAccount
  ): Promise<Partial<ManagedShare>> {
    await this.ensureLoggedIn(account.id);
    const remoteBasePath = this.runtime.mega.remoteBasePath;
    const explicitRemotePath = getStringDescriptor(input.remoteDescriptor ?? {}, 'remotePath');
    const shareName =
      getStringDescriptor(input.remoteDescriptor ?? {}, 'shareName') ??
      createManagedFolderLabel(input.label, randomBytes(3).toString('hex'));
    const remotePath = explicitRemotePath ?? path.posix.join(remoteBasePath, shareName);
    await this.runMega('mkdir', ['-p', remotePath]).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      if (/already exists/i.test(message)) {
        return;
      }
      throw error;
    });
    const existingSync = await this.findSyncByRemotePath(remotePath, account.id);
    const requestedLocalPath = input.localPath ?? '';
    const resolvedLocalPath = requestedLocalPath || existingSync?.localPath?.trim() || '';
    if (requestedLocalPath && normalizeComparablePath(existingSync?.localPath ?? '') !== normalizeComparablePath(requestedLocalPath)) {
      await this.ensureSyncBinding(requestedLocalPath, remotePath, account.id);
    } else if (!existingSync) {
      await this.ensureSyncTarget(resolvedLocalPath, remotePath, null);
    }

    return {
      localPath: resolvedLocalPath,
      remoteDescriptor: {
        remotePath,
        shareName,
      },
      capabilities: ['mirror', 'read', 'write', 'invite'],
    };
  }

  async invite(share: ManagedShare, input: InviteManagedShareInput, account: ProviderAccount): Promise<void> {
    await this.ensureLoggedIn(account.id);
    const remotePath = getStringDescriptor(share.remoteDescriptor, 'remotePath');
    if (!remotePath) {
      throw new Error('MEGA share is missing remotePath.');
    }

    for (const email of input.emails) {
      await this.runMega('invite', [email]).catch(() => {
        // The user may already be a contact; sharing can still succeed.
      });
      await this.runMega('share', ['-a', `--with=${email}`, '--level=rw', remotePath], {
        timeoutMs: 60_000,
      });
    }
  }

  async acceptInvite(
    input: AcceptManagedShareInput,
    account: ProviderAccount
  ): Promise<Partial<ManagedShare>> {
    await this.ensureLoggedIn(account.id);
    const ownerEmail = getStringDescriptor(input.remoteDescriptor ?? {}, 'ownerEmail');
    if (ownerEmail) {
      await this.runMega('ipc', [ownerEmail, '-a']).catch(() => {
        // Ignore if there is no pending contact request.
      });
    }
    const remotePath =
      getStringDescriptor(input.remoteDescriptor ?? {}, 'remotePath') ??
      (await this.findRemoteSharePath(getStringDescriptor(input.remoteDescriptor ?? {}, 'shareName') ?? input.label));
    return {
      remoteDescriptor: {
        ...(input.remoteDescriptor ?? {}),
        remotePath,
      },
      capabilities: acceptedShareCapabilities({
        ...(input.remoteDescriptor ?? {}),
        remotePath,
      }),
    };
  }

  async listIncomingShares(account: ProviderAccount): Promise<IncomingManagedShareOffer[]> {
    await this.ensureLoggedIn(account.id);
    const result = await this.runMega('mount', [], {
      timeoutMs: 30_000,
    }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      if (isMegaMountTemporarilyUnavailableError(message)) {
        return { stdout: '', stderr: message };
      }
      throw error;
    });
    return parseMegaIncomingShares(result.stdout).map((entry) => {
      const hiddenName = isMegaHiddenShareName(entry.shareName);
      return {
        id: `mega:incoming:${entry.remotePath.toLowerCase()}`,
        provider: this.provider,
        accountId: account.id,
        label: hiddenName ? 'Shared MEGA folder' : entry.shareName,
        ownerLabel: entry.ownerEmail,
        detail: hiddenName
          ? `${entry.ownerEmail} shared a MEGA location, but MEGA has not revealed its folder name yet. Accept it to mirror it locally in Nearbytes.`
          : `${entry.ownerEmail} shared this MEGA location${entry.accessLevel ? ` with ${entry.accessLevel}` : ''}. Accept it to mirror it locally in Nearbytes.`,
        remoteDescriptor: {
          remotePath: entry.remotePath,
          shareName: entry.shareName,
          ownerEmail: entry.ownerEmail,
          accessLevel: entry.accessLevel,
        },
      };
    });
  }

  async listManagedShareMirrors(account: ProviderAccount): Promise<ManagedShareMirrorEntry[]> {
    const records = await this.listSyncRecords(account.id);
    const mirrors = new Map<string, MegaSyncRecord>();
    for (const record of records) {
      const remotePath = normalizeComparableRemotePath(record.remotePath ?? '');
      const localPath = record.localPath?.trim() ?? '';
      if (!remotePath || !localPath || !isManagedMirrorRemotePath(remotePath, this.runtime.mega.remoteBasePath)) {
        continue;
      }
      const existing = mirrors.get(remotePath);
      if (!existing || scoreMegaSyncRecord(record) > scoreMegaSyncRecord(existing)) {
        mirrors.set(remotePath, record);
      }
    }

    return Array.from(mirrors.values())
      .map((record) => ({
        label: labelForManagedShareRemotePath(record.remotePath ?? '', this.runtime.mega.remoteBasePath),
        localPath: path.resolve(record.localPath!.trim()),
        remotePath: normalizeComparableRemotePath(record.remotePath ?? ''),
      }))
      .sort((left, right) => left.remotePath.localeCompare(right.remotePath));
  }

  async listIncomingContactInvites(account: ProviderAccount): Promise<IncomingProviderContactInvite[]> {
    await this.ensureLoggedIn(account.id);
    const result = await this.runMega('showpcr', ['--in'], {
      timeoutMs: 30_000,
    });
    return parseMegaIncomingContactInvites(result.stdout).map((invite) => ({
      id: invite.id,
      provider: this.provider,
      accountId: account.id,
      label: invite.email,
      detail: `Accept ${invite.email} as a MEGA contact so shared storage locations from that person can appear in Nearbytes.`,
    }));
  }

  async acceptIncomingContactInvite(account: ProviderAccount, inviteId: string): Promise<void> {
    await this.ensureLoggedIn(account.id);
    await this.runMega('ipc', [inviteId, '-a'], {
      timeoutMs: 30_000,
    });
  }

  async getState(share: ManagedShare, account: ProviderAccount | null): Promise<TransportState> {
    const cached = this.syncStates.get(share.id);
    if (cached) {
      return cached;
    }
    if (!account) {
      return {
        status: 'needs-auth',
        detail: 'Reconnect MEGA to resume this share.',
        badges: ['Reconnect'],
        diagnostic: buildMegaDiagnostic({
          code: 'mega-auth-required',
          title: 'Reconnect MEGA',
          summary: 'This Nearbytes location cannot sync until the MEGA session is connected again.',
          detail: 'Reconnect MEGA to resume this share.',
          share,
        }, this.runtime.now()),
      };
    }
    if (await this.shouldUseIncomingPullMirror(share)) {
      try {
        await this.ensureLoggedIn(account.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const needsAuth = /login|session|auth|401|not connected/i.test(message);
        return {
          status: needsAuth ? 'needs-auth' : 'attention',
          detail: message,
          badges: [needsAuth ? 'Reconnect' : 'Repair'],
          diagnostic: buildMegaDiagnostic(
            {
              code: needsAuth ? 'mega-auth-required' : 'mega-download-check-failed',
              title: needsAuth ? 'Reconnect MEGA' : 'MEGA check failed',
              summary: needsAuth
                ? 'Reconnect MEGA so Nearbytes can refresh this shared location.'
                : 'Nearbytes could not check this shared MEGA location.',
              detail: message,
              share,
            },
            this.runtime.now()
          ),
        };
      }
      return this.readIncomingMirrorState(share);
    }
    return this.readSyncState(share, account.id);
  }

  async getShareStorageMetrics(_share: ManagedShare, account: ProviderAccount | null): Promise<ShareStorageMetrics | undefined> {
    if (!account) {
      return undefined;
    }
    await this.ensureLoggedIn(account.id);
    const quota = await this.readStorageQuota().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      if (isMegaDfTemporarilyUnavailableError(message)) {
        return null;
      }
      throw error;
    });
    if (!quota) {
      return undefined;
    }
    return {
      remoteAvailableBytes: quota.availableBytes,
      remoteTotalBytes: quota.totalBytes,
      remoteUsedBytes: quota.usedBytes,
    };
  }

  async getCollaborators(share: ManagedShare, account: ProviderAccount | null): Promise<ManagedShareCollaborator[]> {
    if (!account) {
      return [];
    }
    await this.ensureLoggedIn(account.id);
    const remotePath = getStringDescriptor(share.remoteDescriptor, 'remotePath');
    if (!remotePath) {
      return [];
    }
    const result = await this.runMega('share', [remotePath], {
      timeoutMs: 30_000,
    }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      if (isMegaMissingSharedPathError(message)) {
        return { stdout: '', stderr: message };
      }
      throw error;
    });
    return parseMegaShareCollaborators(result.stdout).map((entry) => ({
      label: entry.email,
      email: entry.email,
      role: mapMegaAccessLevel(entry.accessLevel),
      status: 'active',
      source: 'provider',
    }));
  }

  async ensureSync(share: ManagedShare, account: ProviderAccount): Promise<void> {
    if (this.syncTimers.has(share.id)) {
      return;
    }
    const remotePath = getStringDescriptor(share.remoteDescriptor, 'remotePath');
    if (!remotePath) {
      throw new Error('MEGA share is missing remotePath.');
    }
    if (await this.shouldUseIncomingPullMirror(share)) {
      try {
        await this.ensureLoggedIn(account.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const needsAuth = /login|session|auth|401|not connected/i.test(message);
        this.syncStates.set(share.id, {
          status: needsAuth ? 'needs-auth' : 'attention',
          detail: message,
          badges: [needsAuth ? 'Reconnect' : 'Repair'],
          lastSyncAt: this.runtime.now(),
          diagnostic: buildMegaDiagnostic(
            {
              code: needsAuth ? 'mega-auth-required' : 'mega-download-check-failed',
              title: needsAuth ? 'Reconnect MEGA' : 'MEGA check failed',
              summary: needsAuth
                ? 'Reconnect MEGA so Nearbytes can refresh this shared location.'
                : 'Nearbytes could not check this shared MEGA location.',
              detail: message,
              share,
            },
            this.runtime.now()
          ),
        });
        return;
      }
      await this.queueIncomingMirrorRefresh(share, account.id, remotePath);
      const timer = setInterval(() => {
        void this.queueIncomingMirrorRefresh(share, account.id, remotePath);
      }, this.runtime.mega.syncIntervalMs);
      timer.unref?.();
      this.syncTimers.set(share.id, timer);
      return;
    }
    await this.ensureLoggedIn(account.id);
    await this.ensureSyncBinding(share.localPath, remotePath, account.id, share);
    await this.refreshSyncState(share, account.id);
    const timer = setInterval(() => {
      void this.refreshSyncState(share, account.id);
    }, this.runtime.mega.syncIntervalMs);
    timer.unref?.();
    this.syncTimers.set(share.id, timer);
  }

  private async ensureSyncBinding(
    localPath: string,
    remotePath: string,
    accountId: string,
    share: ManagedShare | null = null
  ): Promise<void> {
    const matches = await this.findSyncMatches(localPath, remotePath, accountId);
    const localTarget = normalizeComparablePath(localPath);
    const remoteTarget = normalizeComparableRemotePath(remotePath);
    const exactSamePathError = Boolean(matches.exact?.error && /same path/i.test(matches.exact.error));

    if (exactSamePathError && matches.exact?.id) {
      await this.runMega('sync', megaSyncDeleteArgs(matches.exact), {
        timeoutMs: 60_000,
      });
      matches.exact = null;
    }

    if (
      matches.local?.id &&
      matches.local.id !== matches.exact?.id &&
      normalizeComparableRemotePath(matches.local.remotePath ?? '') !== remoteTarget
    ) {
      await this.runMega('sync', megaSyncDeleteArgs(matches.local), {
        timeoutMs: 60_000,
      });
      matches.local = null;
    }

    if (
      matches.remote?.id &&
      matches.remote.id !== matches.exact?.id &&
      matches.remote.id !== matches.local?.id &&
      normalizeComparablePath(matches.remote.localPath ?? '') !== localTarget
    ) {
      await this.runMega('sync', megaSyncDeleteArgs(matches.remote), {
        timeoutMs: 60_000,
      });
      matches.remote = null;
    }

    if (!matches.exact) {
      await this.ensureSyncTarget(localPath, remotePath, share);
    }
  }

  async detachManagedShare(share: ManagedShare, account: ProviderAccount | null): Promise<void> {
    const timer = this.syncTimers.get(share.id);
    if (timer) {
      clearInterval(timer);
      this.syncTimers.delete(share.id);
    }
    this.syncStates.delete(share.id);

    if (!account) {
      return;
    }
    await this.ensureLoggedIn(account.id).catch(() => {
      // Ignore logout/broken-session cleanup issues here.
    });
    if (await this.shouldUseIncomingPullMirror(share)) {
      return;
    }
    const syncRecord = await this.findSyncByLocalPath(share.localPath, account.id).catch(() => null);
    if (syncRecord?.id) {
      await this.runMega('sync', megaSyncDeleteArgs(syncRecord)).catch(() => {
        // Ignore failed sync teardown.
      });
    }
  }

  async disconnect(account: ProviderAccount): Promise<void> {
    await this.ensureLoggedIn(account.id).catch(() => {
      // Ignore stale local MEGA sessions.
    });
    await this.runMega('logout', []).catch(() => {
      // Ignore logout failures; local account metadata is still removed.
    });
    await this.runtime.secretStore.delete(megaSessionSecretKey(account.id));
  }

  private async startSignup(input: ConnectProviderAccountInput): Promise<ConnectProviderAccountResult> {
    const accountId = input.accountId?.trim() || createOpaqueId('acct-mega');
    const name = input.credentials?.name?.trim();
    const email = input.credentials?.email?.trim() || input.email?.trim();
    const password = input.credentials?.password ?? '';
    if (!name) {
      throw new Error('Enter your name first.');
    }
    if (!email || !password) {
      throw new Error('MEGA signup needs your name, email, and password.');
    }

    await this.runMega('signup', [email, password, `--name=${name}`], {
      timeoutMs: 60_000,
    });
    const now = this.runtime.now();
    const session: MegaAuthSession = {
      id: createOpaqueId('signup-mega'),
      provider: this.provider,
      accountId,
      status: 'pending',
      detail: 'Check your email, then paste the MEGA confirmation link here.',
      openedAt: now,
      expiresAt: now + MEGA_AUTH_SESSION_TTL_MS,
      email,
      password,
      requestedLabel: input.label?.trim() || 'MEGA',
    };
    this.authSessions.set(session.id, session);
    return {
      status: 'pending',
      authSession: toPublicAuthSession(session),
    };
  }

  private async pollAuthSession(input: ConnectProviderAccountInput): Promise<ConnectProviderAccountResult> {
    const authSessionId = input.authSessionId?.trim();
    if (!authSessionId) {
      throw new Error('MEGA sign-up session was not found.');
    }
    const session = this.authSessions.get(authSessionId);
    if (!session) {
      throw new Error('MEGA sign-up session was not found.');
    }

    const now = this.runtime.now();
    if (now > session.expiresAt) {
      const expired: MegaAuthSession = {
        ...session,
        status: 'failed',
        detail: 'MEGA sign-up expired. Start it again from Nearbytes.',
      };
      this.authSessions.set(authSessionId, expired);
      return {
        status: 'failed',
        authSession: toPublicAuthSession(expired),
      };
    }

    const confirmationLink = input.credentials?.confirmationLink?.trim();
    if (!confirmationLink) {
      return {
        status: session.status === 'failed' ? 'failed' : 'pending',
        authSession: toPublicAuthSession(session),
      };
    }

    try {
      await this.runMega('confirm', [confirmationLink, session.email, session.password], {
        timeoutMs: 60_000,
      });
      const connected = await this.loginWithCredentials({
        accountId: session.accountId,
        email: session.email,
        password: session.password,
        mfaCode: session.mfaCode,
        label: session.requestedLabel || 'MEGA',
      });
      this.authSessions.delete(authSessionId);
      return connected;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failed: MegaAuthSession = {
        ...session,
        status: 'failed',
        detail: message,
      };
      this.authSessions.set(authSessionId, failed);
      return {
        status: 'failed',
        authSession: toPublicAuthSession(failed),
      };
    }
  }

  private async loginWithCredentials(input: {
    accountId: string;
    email: string;
    password: string;
    mfaCode?: string;
    label: string;
  }): Promise<ConnectProviderAccountResult> {
    const loginArgs = input.mfaCode
      ? [`--auth-code=${input.mfaCode}`, input.email, input.password]
      : [input.email, input.password];
    await this.runMega('login', loginArgs, {
      timeoutMs: 60_000,
    });
    const sessionToken = await this.readSessionToken();
    await this.runtime.secretStore.set(megaSessionSecretKey(input.accountId), {
      email: input.email,
      sessionToken,
    } satisfies MegaSessionSecret);

    return {
      status: 'connected',
      account: {
        id: input.accountId,
        provider: this.provider,
        label: input.label,
        email: input.email,
        state: 'connected',
        detail: 'MEGA CLI is connected.',
        createdAt: 0,
        updatedAt: 0,
      },
    };
  }

  private async refreshSyncState(share: ManagedShare, accountId: string): Promise<void> {
    try {
      const state = await this.readSyncState(share, accountId);
      this.syncStates.set(share.id, state);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const needsAuth = /login|session|auth|401/i.test(message);
      this.syncStates.set(share.id, {
        status: needsAuth ? 'needs-auth' : 'attention',
        detail: message,
        badges: [needsAuth ? 'Reconnect' : 'Repair'],
        lastSyncAt: this.runtime.now(),
        diagnostic: buildMegaDiagnostic({
          code: needsAuth ? 'mega-auth-error' : 'mega-sync-refresh-failed',
          title: needsAuth ? 'Reconnect MEGA' : 'MEGA sync check failed',
          summary: summarizeMegaDiagnostic(message, needsAuth),
          detail: message,
          share,
        }, this.runtime.now()),
      });
    }
  }

  private async readSyncState(share: ManagedShare, accountId: string): Promise<TransportState> {
    await this.ensureLoggedIn(accountId);
    const remotePath = getStringDescriptor(share.remoteDescriptor, 'remotePath');
    const syncMatches = remotePath
      ? await this.findSyncMatches(share.localPath, remotePath, accountId)
      : {
          exact: null,
          local: await this.findSyncByLocalPath(share.localPath, accountId),
          remote: null,
        };
    const syncRecord = syncMatches.exact ?? syncMatches.local ?? syncMatches.remote;
    if (!syncRecord) {
      return {
        status: 'attention',
        detail: 'MEGA sync is not running for this share.',
        badges: ['Repair'],
        diagnostic: buildMegaDiagnostic({
          code: 'mega-sync-missing',
          title: 'MEGA sync missing',
          summary: 'Nearbytes cannot find an active MEGA sync for this local mirror.',
          detail: 'MEGA sync is not running for this share.',
          share,
        }, this.runtime.now()),
      };
    }
    let syncErrorDetail = syncRecord.error?.trim();
    if (syncErrorDetail) {
      const detail = syncErrorDetail;
      const syncIssueCount = parseMegaSyncIssueCount(detail);
      if (syncIssueCount !== null && syncRecord.id) {
        const issues = await this.readSyncIssues(accountId).catch(() => null);
        if (issues) {
          const ownIssues = issues.filter((issue) => issue.parentSyncId === syncRecord.id);
          if (ownIssues.length > 0) {
            const issueSummary = summarizeMegaSyncIssueDetails(ownIssues, syncIssueCount);
            return {
              status: 'attention',
              detail: issueSummary.detail,
              badges: ['Repair'],
              lastSyncAt: this.runtime.now(),
              diagnostic: buildMegaDiagnostic({
                code: issueSummary.code,
                title: issueSummary.title,
                summary: issueSummary.summary,
                detail: issueSummary.primaryReason,
                share,
                syncRecord,
                syncIssues: ownIssues,
              }, this.runtime.now()),
            };
          }
          syncErrorDetail = undefined;
        }
      }
    }
    if (syncErrorDetail) {
      return {
        status: 'attention',
        detail: syncErrorDetail,
        badges: ['Repair'],
        lastSyncAt: this.runtime.now(),
        diagnostic: buildMegaDiagnostic({
          code: 'mega-sync-error',
          title: 'MEGA reported a sync error',
          summary: summarizeMegaDiagnostic(syncErrorDetail, false),
          detail: syncErrorDetail,
          share,
          syncRecord,
        }, this.runtime.now()),
      };
    }
    const runState = (syncRecord.runState ?? '').trim().toLowerCase();
    const status = (syncRecord.status ?? '').trim().toLowerCase();
    if (runState.includes('run') || status.includes('up to date') || status.includes('synced')) {
      return {
        status: 'ready',
        detail: 'MEGA sync is running for this share.',
        badges: ['Connected'],
        lastSyncAt: this.runtime.now(),
      };
    }
    const detail = syncRecord.status?.trim() || 'MEGA sync is starting.';
    return {
      status: 'syncing',
      detail,
      badges: ['Syncing'],
      lastSyncAt: this.runtime.now(),
      diagnostic: buildMegaDiagnostic({
        code: 'mega-sync-progress',
        title: 'MEGA sync in progress',
        summary: summarizeMegaStatus(detail),
        detail,
        share,
        syncRecord,
      }, this.runtime.now()),
    };
  }

  private async ensureLoggedIn(accountId: string): Promise<void> {
    let secret = await this.runtime.secretStore.get<MegaSessionSecret>(megaSessionSecretKey(accountId));
    if (!secret?.sessionToken?.trim()) {
      secret = await this.recoverSessionSecret(accountId);
    }
    if (!secret?.sessionToken?.trim()) {
      throw new Error('MEGA is not connected for this account.');
    }
    try {
      await this.loginWithSessionToken(secret.sessionToken);
    } catch (error) {
      const recovered = await this.recoverSessionSecret(accountId);
      if (!recovered?.sessionToken?.trim() || recovered.sessionToken === secret.sessionToken) {
        throw error;
      }
      await this.loginWithSessionToken(recovered.sessionToken);
    }
  }

  private async loginWithSessionToken(sessionToken: string): Promise<void> {
    await this.runMega('login', [sessionToken], {
      timeoutMs: 60_000,
    }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      if (/already logged in|command not valid while login in: login/i.test(message)) {
        return;
      }
      throw error;
    });
  }

  private async recoverSessionSecret(accountId: string): Promise<MegaSessionSecret | null> {
    const sessionToken = await this.readSessionToken().catch(() => null);
    if (!sessionToken) {
      return null;
    }
    const email = await this.readCurrentAccountEmail().catch(() => `account-${accountId}`);
    const recovered: MegaSessionSecret = {
      email,
      sessionToken,
    };
    await this.runtime.secretStore.set(megaSessionSecretKey(accountId), recovered);
    return recovered;
  }

  private async readCurrentAccountEmail(): Promise<string> {
    const result = await this.runMega('whoami', [], {
      timeoutMs: 15_000,
    });
    const firstLine = firstMeaningfulLine(result.stdout);
    const match = firstLine?.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu);
    if (match?.[0]) {
      return match[0].toLowerCase();
    }
    return firstLine?.trim() || 'unknown@mega.local';
  }

  private async readSessionToken(): Promise<string> {
    const result = await this.runMega('session', []);
    const token = firstMeaningfulLine(result.stdout);
    if (!token) {
      throw new Error('MEGA did not return a session token.');
    }
    return token;
  }

  private async ensureSyncTarget(localPath: string, remotePath: string, share: ManagedShare | null): Promise<void> {
    if (!localPath.trim()) {
      throw new Error('Nearbytes share folder is missing.');
    }
    await fs.mkdir(localPath, { recursive: true });
    const syncArgs = (await this.shouldCreateIncomingReadOnlySync(share, remotePath))
      ? ['--down', localPath, remotePath]
      : [localPath, remotePath];
    await this.runMega('sync', syncArgs, {
      timeoutMs: 60_000,
    }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      if (/already.*sync|duplicated/i.test(message)) {
        return;
      }
      throw error;
    });
  }

  private async findSyncByLocalPath(localPath: string, accountId: string): Promise<MegaSyncRecord | null> {
    const target = normalizeComparablePath(localPath);
    if (!target) {
      return null;
    }
    return (await this.listSyncRecords(accountId))
      .find((record) => normalizeComparablePath(record.localPath ?? '') === target) ?? null;
  }

  private async findSyncByRemotePath(remotePath: string, accountId: string): Promise<MegaSyncRecord | null> {
    const target = normalizeComparableRemotePath(remotePath);
    if (!target) {
      return null;
    }
    return (await this.listSyncRecords(accountId))
      .find((record) => normalizeComparableRemotePath(record.remotePath ?? '') === target) ?? null;
  }

  private async listSyncRecords(accountId: string): Promise<MegaSyncRecord[]> {
    await this.ensureLoggedIn(accountId);
    const result = await this.runMega('sync', [
      '--path-display-size=0',
      '--col-separator=\t',
      '--output-cols=ID,LOCALPATH,REMOTEPATH,RUN_STATE,STATUS,ERROR',
    ], {
      timeoutMs: 12_000,
    });
    return parseMegaSyncTable(result.stdout);
  }

  private async findSyncMatches(
    localPath: string,
    remotePath: string,
    accountId: string
  ): Promise<{
    exact: MegaSyncRecord | null;
    local: MegaSyncRecord | null;
    remote: MegaSyncRecord | null;
  }> {
    const localTarget = normalizeComparablePath(localPath);
    const remoteTarget = normalizeComparableRemotePath(remotePath);
    const records = await this.listSyncRecords(accountId);
    const exact = records.find((record) =>
      normalizeComparablePath(record.localPath ?? '') === localTarget &&
      normalizeComparableRemotePath(record.remotePath ?? '') === remoteTarget
    ) ?? null;
    const local = records.find((record) => normalizeComparablePath(record.localPath ?? '') === localTarget) ?? null;
    const remote = records.find((record) => normalizeComparableRemotePath(record.remotePath ?? '') === remoteTarget) ?? null;
    return {
      exact,
      local,
      remote,
    };
  }
  private async findRemoteSharePath(shareName: string): Promise<string> {
    const result = await this.runMega('find', ['/', shareName, '-t', 'd'], {
      timeoutMs: 60_000,
    });
    const match = firstMeaningfulLine(result.stdout);
    if (!match) {
      throw new Error(`MEGA shared folder not found for "${shareName}".`);
    }
    return match.trim();
  }

  private async readStorageQuota(): Promise<MegaStorageQuota | null> {
    const result = await this.runMega('df', [], {
      timeoutMs: 30_000,
    });
    return parseMegaDf(result.stdout);
  }

  private async readSyncIssues(accountId: string): Promise<MegaSyncIssueDetail[]> {
    await this.ensureLoggedIn(accountId);
    const result = await this.runMega('sync-issues', ['--detail', '--all'], {
      timeoutMs: 60_000,
    }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      if (/no sync issues/i.test(message)) {
        return { stdout: '', stderr: '' };
      }
      throw error;
    });
    return parseMegaSyncIssueDetails(result.stdout);
  }

  private async runMega(
    subcommand: string,
    args: readonly string[],
    options: { timeoutMs?: number } = {}
  ): Promise<{ stdout: string; stderr: string }> {
    let installAttempted = false;
    let restartAttempted = false;
    while (true) {
      const commandDirectory = await this.installer.getCommandDirectory();
      const invocation = resolveMegaInvocation(commandDirectory, subcommand, args);
      const commandEnv = commandDirectory
        ? {
            PATH: `${commandDirectory}${path.delimiter}${process.env.PATH ?? ''}`,
          }
        : undefined;
      try {
        const result = await this.runtime.commandExecutor.run({
          command: invocation.command,
          args: invocation.args,
          cwd: commandDirectory || undefined,
          env: commandEnv,
          timeoutMs: options.timeoutMs ?? 30_000,
        });
        if (result.exitCode !== 0) {
          const rawOutput = result.stderr || result.stdout || `${subcommand} failed`;
          if (!restartAttempted && isMegaRecoverableCommandError(rawOutput)) {
            restartAttempted = await this.restartMegaServer(commandDirectory);
            if (restartAttempted) {
              continue;
            }
          }
          throw new Error(extractMegaError(rawOutput));
        }
        return {
          stdout: result.stdout,
          stderr: result.stderr,
        };
      } catch (error) {
        if (isCommandNotFound(error) && !installAttempted) {
          installAttempted = true;
          await this.installer.install();
          continue;
        }
        const message = error instanceof Error ? error.message : String(error);
        if (!restartAttempted && isMegaRecoverableCommandError(message)) {
          restartAttempted = await this.restartMegaServer(commandDirectory);
          if (restartAttempted) {
            continue;
          }
        }
        if (isCommandNotFound(error)) {
          throw new Error('MEGA CLI was not found. Install MEGAcmd or set NEARBYTES_MEGACMD_DIR.');
        }
        throw error;
      }
    }
  }

  private async restartMegaServer(commandDirectory: string | undefined): Promise<boolean> {
    if (process.platform !== 'win32') {
      return false;
    }
    const commandEnv = commandDirectory
      ? {
          PATH: `${commandDirectory}${path.delimiter}${process.env.PATH ?? ''}`,
        }
      : undefined;
    try {
      await this.runtime.commandExecutor.run({
        command: 'taskkill',
        args: ['/IM', 'MEGAcmdServer.exe', '/F'],
        timeoutMs: 10_000,
      }).catch(() => {
        // Ignore if there is no running MEGAcmdServer process.
      });

      const serverCommand = resolveMegaServerCommand(commandDirectory, process.platform);
      await this.runtime.commandExecutor.run({
        command: serverCommand,
        args: [],
        cwd: commandDirectory || undefined,
        env: commandEnv,
        timeoutMs: 20_000,
      });

      await new Promise<void>((resolve) => {
        setTimeout(resolve, 1200);
      });
      return true;
    } catch (error) {
      this.runtime.logger.warn('Failed to restart MEGAcmdServer after MEGA server access error.', error);
      return false;
    }
  }

  private async shouldUseIncomingPullMirror(share: ManagedShare): Promise<boolean> {
    const remotePath = getStringDescriptor(share.remoteDescriptor, 'remotePath') ?? '';
    if (share.role !== 'recipient' || !isMegaIncomingRemotePath(remotePath)) {
      return false;
    }
    if (incomingMegaShareSupportsLiveSync(share.remoteDescriptor)) {
      return false;
    }
    return !(await this.supportsIncomingReadOnlySync());
  }

  private async shouldCreateIncomingReadOnlySync(
    share: ManagedShare | null,
    remotePath: string
  ): Promise<boolean> {
    if (!share || share.role !== 'recipient' || !isMegaIncomingRemotePath(remotePath)) {
      return false;
    }
    if (incomingMegaShareSupportsLiveSync(share.remoteDescriptor)) {
      return false;
    }
    return this.supportsIncomingReadOnlySync();
  }

  private async supportsIncomingReadOnlySync(): Promise<boolean> {
    const commandDirectory = await this.installer.getCommandDirectory();
    if (this.readOnlySyncSupport && this.readOnlySyncSupport.commandDirectory === commandDirectory) {
      return this.readOnlySyncSupport.supported;
    }

    let supported = false;
    try {
      const result = await this.runMega('sync', ['--help'], {
        timeoutMs: 15_000,
      });
      supported = /--down|--read-only/i.test(`${result.stdout}\n${result.stderr}`);
    } catch {
      supported = false;
    }

    this.readOnlySyncSupport = {
      commandDirectory,
      supported,
    };
    return supported;
  }

  private async readIncomingMirrorState(share: ManagedShare): Promise<TransportState> {
    return (
      this.syncStates.get(share.id) ?? {
        status: 'syncing',
        detail: 'Nearbytes is downloading this shared MEGA location locally.',
        badges: ['Syncing'],
      }
    );
  }

  private async queueIncomingMirrorRefresh(
    share: ManagedShare,
    accountId: string,
    remotePath: string
  ): Promise<void> {
    const existing = this.pullTasks.get(share.id);
    if (existing) {
      await existing;
      return;
    }

    const task = this.refreshIncomingMirror(share, accountId, remotePath).finally(() => {
      this.pullTasks.delete(share.id);
    });
    this.pullTasks.set(share.id, task);
    await task;
  }

  private async refreshIncomingMirror(
    share: ManagedShare,
    accountId: string,
    remotePath: string
  ): Promise<void> {
    await this.ensureLoggedIn(accountId);
    const previous = this.syncStates.get(share.id);
    this.syncStates.set(share.id, {
      status: 'syncing',
      detail: 'Nearbytes is refreshing this shared MEGA location locally.',
      badges: ['Syncing'],
      lastSyncAt: previous?.lastSyncAt,
    });

    try {
      await this.pullIncomingShare(share.localPath, remotePath);
      this.syncStates.set(share.id, {
        status: 'ready',
        detail: 'A local read-only copy of this shared MEGA location is available.',
        badges: ['Connected'],
        lastSyncAt: this.runtime.now(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const needsAuth = /login|session|auth|401/i.test(message);
      this.syncStates.set(share.id, {
        status: needsAuth ? 'needs-auth' : 'attention',
        detail: message,
        badges: [needsAuth ? 'Reconnect' : 'Repair'],
        lastSyncAt: this.runtime.now(),
        diagnostic: buildMegaDiagnostic(
          {
            code: needsAuth ? 'mega-auth-error' : 'mega-download-failed',
            title: needsAuth ? 'Reconnect MEGA' : 'MEGA download failed',
            summary: needsAuth
              ? 'Reconnect MEGA so Nearbytes can refresh this shared location again.'
              : 'Nearbytes could not refresh the local copy of this shared MEGA location.',
            detail: message,
            share,
          },
          this.runtime.now()
        ),
      });
    }
  }

  private async pullIncomingShare(localPath: string, remotePath: string): Promise<void> {
    await fs.mkdir(localPath, { recursive: true });
    await this.cleanupIncomingMirrorMarkers(localPath);
    await this.runMega('get', ['-m', remotePath, localPath], {
      timeoutMs: 120_000,
    });
    await this.normalizeIncomingMirrorLayout(localPath, remotePath);
  }

  private async normalizeIncomingMirrorLayout(localPath: string, remotePath: string): Promise<void> {
    const entries = await fs.readdir(localPath, { withFileTypes: true }).catch(() => []);
    const hasTopLevelData = entries.some((entry) =>
      entry.isDirectory() && (entry.name === 'blocks' || entry.name === 'channels')
    );
    if (hasTopLevelData) {
      return;
    }

    const remoteSegments = normalizeComparableRemotePath(remotePath).split('/').filter(Boolean);
    const remoteLeaf = remoteSegments.length > 0 ? remoteSegments[remoteSegments.length - 1]!.toLowerCase() : '';
    const nestedRoots = await this.findIncomingMirrorNestedRoots(localPath, remoteLeaf);
    if (nestedRoots.length === 0) {
      return;
    }

    for (const nestedPath of nestedRoots) {
      await this.mergeIncomingMirrorDirectory(nestedPath, localPath);
    }
  }

  private async findIncomingMirrorNestedRoots(localPath: string, remoteLeaf: string): Promise<string[]> {
    const queue = [{ directory: localPath, depth: 0 }];
    const candidates: string[] = [];
    const seen = new Set<string>();

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) {
        continue;
      }
      const entries = await fs.readdir(current.directory, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }
        if (entry.name === 'blocks' || entry.name === 'channels') {
          continue;
        }
        const nestedPath = path.join(current.directory, entry.name);
        if (seen.has(nestedPath)) {
          continue;
        }
        seen.add(nestedPath);

        const nestedEntries = await fs.readdir(nestedPath, { withFileTypes: true }).catch(() => []);
        const hasNestedData = nestedEntries.some((nestedEntry) =>
          nestedEntry.isDirectory() && (nestedEntry.name === 'blocks' || nestedEntry.name === 'channels')
        );
        if (hasNestedData) {
          candidates.push(nestedPath);
          continue;
        }

        if (current.depth >= 2) {
          continue;
        }

        const normalizedName = entry.name.trim().toLowerCase();
        const shouldDescend =
          current.directory === localPath ||
          normalizedName === remoteLeaf ||
          normalizedName.startsWith(`${remoteLeaf} `) ||
          nestedEntries.some((nestedEntry) => nestedEntry.isDirectory());
        if (shouldDescend) {
          queue.push({ directory: nestedPath, depth: current.depth + 1 });
        }
      }
    }

    return candidates;
  }

  private async mergeIncomingMirrorDirectory(fromDirectory: string, targetDirectory: string): Promise<void> {
    const entries = await fs.readdir(fromDirectory, { withFileTypes: true }).catch(() => []);

    for (const entry of entries) {
      const fromPath = path.join(fromDirectory, entry.name);
      const toPath = path.join(targetDirectory, entry.name);
      const targetStats = await fs.lstat(toPath).catch(() => null);

      if (!targetStats) {
        await fs.rename(fromPath, toPath).catch(() => undefined);
        continue;
      }

      if (entry.isDirectory() && targetStats.isDirectory()) {
        await this.mergeIncomingMirrorDirectory(fromPath, toPath);
      }
    }

    const remainingEntries = await fs.readdir(fromDirectory).catch(() => []);
    if (remainingEntries.length === 0) {
      await fs.rm(fromDirectory, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async cleanupIncomingMirrorMarkers(localPath: string): Promise<void> {
    const entries = await fs.readdir(localPath, { withFileTypes: true }).catch(() => []);
    await Promise.all(
      entries
        .filter(
          (entry) =>
            entry.isFile() && /^Nearbytes(?: \(\d+\))?\.(?:html|json)$/iu.test(entry.name)
        )
        .map((entry) => fs.rm(path.join(localPath, entry.name), { force: true }).catch(() => undefined))
    );
  }
}

function megaSessionSecretKey(accountId: string): string {
  return `${MEGA_SESSION_SECRET_PREFIX}${accountId}`;
}

function createOpaqueId(prefix: string): string {
  return `${prefix}-${randomBytes(8).toString('hex')}`;
}

function createManagedFolderLabel(label: string, suffix: string): string {
  const cleaned = label
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .slice(0, 56)
    .trim();
  return `${cleaned || 'Nearbytes share'} ${suffix}`.trim();
}

function firstMeaningfulLine(value: string): string | null {
  for (const line of value.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return null;
}

function parseMegaSyncTable(stdout: string): MegaSyncRecord[] {
  const lines = stdout
    .split(/\r?\n/u)
    .map((line) => line.replace(/\r$/u, ''))
    .filter((line) => line.trim() !== '');
  if (lines.length === 0) {
    return [];
  }

  const header = lines.find((line) => /\bID\b/u.test(line) && /\bLOCALPATH\b/u.test(line) && /\bREMOTEPATH\b/u.test(line));
  const dataLines = lines.filter((line) => line !== header);
  if (!header) {
    return dataLines.map(parseMegaSyncLineWithWhitespaceColumns).filter((record): record is MegaSyncRecord => record !== null);
  }

  if (header.includes('\t')) {
    return dataLines
      .filter((line) => !/^ID\tLOCALPATH/i.test(line.trim()))
      .map((line) => {
        const [id, localPath, remotePath, runState, status, error] = line.split('\t');
        return {
          id: normalizeMegaCell(id),
          localPath: normalizeMegaCell(localPath),
          remotePath: normalizeMegaCell(remotePath),
          runState: normalizeMegaCell(runState),
          status: normalizeMegaCell(status),
          error: normalizeMegaCell(error),
        } satisfies MegaSyncRecord;
      });
  }

  return dataLines
    .map(parseMegaSyncLineWithWhitespaceColumns)
    .filter((record): record is MegaSyncRecord => record !== null);
}

function parseMegaSyncIssueCount(detail: string): number | null {
  const match = detail.match(/sync issues\s*\((\d+)\)/i);
  if (!match) {
    return null;
  }
  const parsed = Number.parseInt(match[1] ?? '', 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseMegaSyncIssueDetails(stdout: string): MegaSyncIssueDetail[] {
  const blocks = stdout
    .split(/\n(?=\[Details on issue )/u)
    .map((block) => block.trim())
    .filter(Boolean);
  const issues: MegaSyncIssueDetail[] = [];

  for (const block of blocks) {
    const lines = block.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
    const header = lines[0]?.match(/^\[Details on issue\s+([^\]]+)\]$/u);
    const reason = lines[1]?.trim();
    const parentLine = lines.find((line) => line.startsWith('Parent sync:'));
    const parentMatch = parentLine?.match(/^Parent sync:\s+(\S+)\s+\((.+)\s+to\s+(.+)\)$/u);
    if (!header || !reason || !parentMatch) {
      continue;
    }
    const filenameMatch = reason.match(/Unable to sync '([^']+)'/u);
    issues.push({
      issueId: header[1] ?? '',
      parentSyncId: parentMatch[1] ?? '',
      reason,
      filename: filenameMatch?.[1]?.trim(),
      parentLocalPath: parentMatch[2]?.trim(),
      parentRemotePath: parentMatch[3]?.trim(),
    });
  }

  return issues;
}

function normalizeMegaCell(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  if (/^(no|none|n\/a)$/i.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

function parseMegaSyncLineWithWhitespaceColumns(line: string): MegaSyncRecord | null {

function looksLikeMegaRemotePathToken(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  if (/^[A-Za-z]:[\\/]/u.test(trimmed)) {
    return false;
  }
  return trimmed.startsWith('/') || trimmed.startsWith('<CLOUD>') || /^[^\s@]+@[^\s:]+:.+/u.test(trimmed);
}
  const trimmedLine = line.trim();
  if (!trimmedLine || /^ID\s+LOCALPATH/i.test(trimmedLine)) {
    return null;
  }

  const tokens = trimmedLine.split(/\s+/u);
  if (tokens.length < 4) {
    return null;
  }

  const id = tokens[0] ?? '';
  const remotePathIndex = tokens.findIndex((token, index) => index > 0 && looksLikeMegaRemotePathToken(token));
  if (remotePathIndex <= 1 || remotePathIndex === -1) {
    return toMegaSyncRecord(trimmedLine.split(/\s{2,}/u));
  }

  const runStateIndex = remotePathIndex + 1;
  if (runStateIndex >= tokens.length) {
    return null;
  }

  const localPath = tokens.slice(1, remotePathIndex).join(' ');
  const remotePath = tokens[remotePathIndex] ?? '';
  const runState = tokens[runStateIndex] ?? '';
  const remaining = tokens.slice(runStateIndex + 1);
  const status = remaining[0] ?? '';
  const error = remaining.slice(1).join(' ');
  const values = [id, localPath, remotePath, runState, status, error];
  return toMegaSyncRecord(values);
}

function toMegaSyncRecord(values: readonly string[]): MegaSyncRecord | null {
  const [id, localPath, remotePath, runState, status, error] = values;
  if (!id && !localPath && !remotePath) {
    return null;
  }
  return {
    id: normalizeMegaCell(id),
    localPath: normalizeMegaCell(localPath),
    remotePath: normalizeMegaCell(remotePath),
    runState: normalizeMegaCell(runState),
    status: normalizeMegaCell(status),
    error: normalizeMegaCell(error),
  } satisfies MegaSyncRecord;
}

function megaSyncDeleteArgs(syncRecord: Pick<MegaSyncRecord, 'id' | 'localPath'>): string[] {
  const localPath = syncRecord.localPath?.trim();
  if (localPath) {
    return ['-d', localPath];
  }
  const syncId = syncRecord.id?.trim() ?? '';
  return ['-d', syncId];
}

function normalizeComparablePath(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/\/+$/u, '').toLowerCase();
}

function normalizeComparableRemotePath(value: string): string {
  const normalized = value.trim().replace(/\\/g, '/');
  if (!normalized) {
    return '';
  }
  const collapsed = path.posix.normalize(normalized).replace(/\/+$/u, '');
  return collapsed || '/';
}

function isManagedMirrorRemotePath(remotePath: string, remoteBasePath: string): boolean {
  const normalizedRemote = normalizeComparableRemotePath(remotePath);
  const normalizedBase = normalizeComparableRemotePath(remoteBasePath);
  return normalizedRemote === normalizedBase || normalizedRemote.startsWith(`${normalizedBase}/`);
}

function labelForManagedShareRemotePath(remotePath: string, remoteBasePath: string): string {
  const normalizedRemote = normalizeComparableRemotePath(remotePath);
  const normalizedBase = normalizeComparableRemotePath(remoteBasePath);
  if (normalizedRemote === normalizedBase) {
    return path.posix.basename(normalizedBase) || 'nearbytes';
  }
  return path.posix.basename(normalizedRemote) || 'nearbytes';
}

function scoreMegaSyncRecord(record: MegaSyncRecord): number {
  let score = 0;
  const runState = (record.runState ?? '').trim().toLowerCase();
  const status = (record.status ?? '').trim().toLowerCase();
  const error = (record.error ?? '').trim();
  if (runState.includes('run')) {
    score += 4;
  }
  if (status.includes('synced') || status.includes('up to date')) {
    score += 3;
  } else if (status.includes('pending') || status.includes('process')) {
    score += 1;
  }
  if (!error) {
    score += 2;
  } else if (/same path/i.test(error)) {
    score -= 2;
  } else {
    score -= 1;
  }
  return score;
}

function isMegaMountTemporarilyUnavailableError(message: string): boolean {
  return /command not valid while login in:\s*mount/i.test(message) || /session is not ready for this command yet/i.test(message);
}

function isMegaDfTemporarilyUnavailableError(message: string): boolean {
  return /command not valid while login in:\s*df/i.test(message) || /session is not ready for this command yet/i.test(message);
}

function isMegaMissingSharedPathError(message: string): boolean {
  return /no shared found for given path/i.test(message);
}

function isMegaHiddenShareName(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === 'no_key' || normalized === 'nokey' || normalized === 'no-key';
}

function extractMegaError(value: string): string {
  const firstLine = firstMeaningfulLine(value);
  if (!firstLine) {
    return 'MEGA command failed.';
  }

  const failedToAccessServer = firstLine.match(/failed to access server:\s*(\d+)/i);
  if (failedToAccessServer?.[1] === '231') {
    return 'MEGA network error 231: MEGAcmd could not reach MEGA (Failed to access server: 231). Reproduce on this machine with: mega-whoami and mega-sync --path-display-size=1024. Nearbytes keeps the raw error and capture timestamp in MEGA diagnostics so you can compare outputs.';
  }
  if (failedToAccessServer) {
    return `MEGA network error ${failedToAccessServer[1]}: MEGAcmd could not reach MEGA. Reproduce locally with mega-whoami and mega-sync --path-display-size=1024, then compare with the diagnostics captured by Nearbytes.`;
  }

  if (/command not valid while login in:\s*\w+/i.test(firstLine)) {
    return 'MEGA CLI session is not ready for this command yet. Retry in a few seconds.';
  }
  if (/not logged in|login required|session expired|invalid session|auth/i.test(firstLine)) {
    return 'MEGA session is invalid or expired. Reconnect your MEGA account in Nearbytes.';
  }

  return firstLine;
}

function isMegaServerAccessError(value: string): boolean {
  const normalized = value.trim();
  if (!normalized) {
    return false;
  }
  return /failed to access server:\s*231/i.test(normalized);
}

function isMegaRecoverableCommandError(value: string): boolean {
  const normalized = value.trim();
  if (!normalized) {
    return false;
  }
  return (
    isMegaServerAccessError(normalized) ||
    /command timed out after\s*\d+ms/i.test(normalized) ||
    /error reading output \(state change\):\s*109/i.test(normalized)
  );
}

function resolveMegaServerCommand(
  commandDirectory: string | undefined,
  platform: NodeJS.Platform = process.platform
): string {
  const filename = platform === 'win32' ? 'MEGAcmdServer.exe' : 'mega-cmd-server';
  if (!commandDirectory) {
    return filename;
  }
  const normalizedDirectory = commandDirectory.trim().replace(/[\\/]+$/u, '');
  if (normalizedDirectory === '') {
    return filename;
  }
  return `${normalizedDirectory}/${filename}`;
}

function getStringDescriptor(descriptor: Record<string, unknown>, key: string): string | undefined {
  const value = descriptor[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function parseMegaDf(stdout: string): MegaStorageQuota | null {
  for (const line of stdout.split(/\r?\n/u)) {
    const match = line.match(/USED STORAGE:\s*(\d+).*?of\s+(\d+)/i);
    if (!match) {
      continue;
    }
    const usedBytes = Number.parseInt(match[1] ?? '', 10);
    const totalBytes = Number.parseInt(match[2] ?? '', 10);
    if (!Number.isFinite(usedBytes) || !Number.isFinite(totalBytes) || totalBytes < usedBytes) {
      return null;
    }
    return {
      usedBytes,
      totalBytes,
      availableBytes: totalBytes - usedBytes,
    };
  }
  return null;
}

function parseMegaShareCollaborators(stdout: string): MegaShareCollaboratorRecord[] {
  const collaborators: MegaShareCollaboratorRecord[] = [];
  const seen = new Set<string>();
  for (const line of stdout.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const emailMatch = trimmed.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu);
    if (!emailMatch) {
      continue;
    }
    const email = emailMatch[0].toLowerCase();
    if (seen.has(email)) {
      continue;
    }
    seen.add(email);
    const accessLevelMatch = trimmed.match(/accessLevel\s*=\s*([^\s]+)/iu);
    collaborators.push({
      email,
      accessLevel: accessLevelMatch?.[1]?.trim(),
    });
  }
  return collaborators;
}

function parseMegaIncomingShares(stdout: string): MegaIncomingShareRecord[] {
  const shares: MegaIncomingShareRecord[] = [];
  const seen = new Set<string>();
  for (const line of stdout.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('INSHARE on //from/')) {
      continue;
    }
    const match = trimmed.match(/^INSHARE on \/\/from\/([^:]+):(.+?)(?: \((.+?)\))?$/u);
    if (!match) {
      continue;
    }
    const ownerEmail = (match[1] ?? '').trim().toLowerCase();
    const shareName = (match[2] ?? '').trim();
    const accessLevel = (match[3] ?? '').trim() || undefined;
    if (!ownerEmail || !shareName) {
      continue;
    }
    const remotePath = `${ownerEmail}:${shareName}`;
    const key = remotePath.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    shares.push({
      ownerEmail,
      shareName,
      remotePath,
      accessLevel,
    });
  }
  return shares;
}

function parseMegaIncomingContactInvites(stdout: string): MegaIncomingContactInviteRecord[] {
  const invites: MegaIncomingContactInviteRecord[] = [];
  const seen = new Set<string>();
  for (const line of stdout.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || /^Incoming PCRs:/i.test(trimmed) || /^Outgoing PCRs:/i.test(trimmed)) {
      continue;
    }
    const match = trimmed.match(/^([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}).*?\(id:\s*([^,\)\s]+)/iu);
    if (!match) {
      continue;
    }
    const email = (match[1] ?? '').trim().toLowerCase();
    const id = (match[2] ?? '').trim();
    if (!email || !id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    invites.push({ id, email });
  }
  return invites;
}

function mapMegaAccessLevel(accessLevel: string | undefined): string | undefined {
  switch ((accessLevel ?? '').trim().toLowerCase()) {
    case '0':
    case 'read':
    case 'read access':
    case 'ro':
      return 'reader';
    case '1':
    case 'readwrite':
    case 'read/write':
    case 'read-write':
    case 'read-write access':
    case 'rw':
    case 'full':
      return 'writer';
    case '2':
    case 'fullaccess':
    case 'full access':
      return 'full';
    case '3':
    case 'owner':
      return 'owner';
    default:
      return accessLevel?.trim() || undefined;
  }
}

function acceptedShareCapabilities(descriptor: Record<string, unknown>): string[] {
  const remotePath = getStringDescriptor(descriptor, 'remotePath') ?? '';
  if (incomingMegaShareSupportsLiveSync(descriptor)) {
    return ['mirror', 'read', 'write', 'accept'];
  }
  if (isMegaIncomingRemotePath(remotePath)) {
    return ['mirror', 'read', 'accept'];
  }
  return ['mirror', 'read', 'write', 'accept'];
}

function incomingMegaShareSupportsLiveSync(descriptor: Record<string, unknown>): boolean {
  const remotePath = getStringDescriptor(descriptor, 'remotePath') ?? '';
  if (!isMegaIncomingRemotePath(remotePath)) {
    return false;
  }
  return isMegaFullAccessLevel(getStringDescriptor(descriptor, 'accessLevel'));
}

function isMegaFullAccessLevel(accessLevel: string | undefined): boolean {
  switch ((accessLevel ?? '').trim().toLowerCase()) {
    case '2':
    case 'full':
    case 'fullaccess':
    case 'full access':
    case 'owner':
    case 'owner access':
    case '3':
      return true;
    default:
      return false;
  }
}

function isMegaIncomingRemotePath(value: string): boolean {
  const normalized = value.trim();
  return normalized !== '' && !normalized.startsWith('/') && normalized.includes(':');
}

function isCommandNotFound(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      ((error as { code?: string }).code === 'ENOENT' || (error as { message?: string }).message?.includes('ENOENT'))
  );
}

function buildMegaDiagnostic(
  input: {
    code: string;
    title: string;
    summary: string;
    detail?: string;
    share: ManagedShare;
    syncRecord?: MegaSyncRecord | null;
    syncIssues?: readonly MegaSyncIssueDetail[];
  },
  capturedAt: number
): NonNullable<TransportState['diagnostic']> {
  const facts = [
    { label: 'Share', value: input.share.label.trim() || 'Unnamed location' },
    { label: 'Local path', value: input.share.localPath },
    getStringDescriptor(input.share.remoteDescriptor, 'remotePath')
      ? { label: 'Remote path', value: getStringDescriptor(input.share.remoteDescriptor, 'remotePath')! }
      : null,
    input.syncRecord?.runState ? { label: 'Run state', value: input.syncRecord.runState } : null,
    input.syncRecord?.status ? { label: 'MEGA status', value: input.syncRecord.status } : null,
    input.syncIssues?.length ? { label: 'Issue count', value: String(input.syncIssues.length) } : null,
    input.syncIssues?.[0]?.filename ? { label: 'First file', value: input.syncIssues[0].filename } : null,
    { label: 'Captured', value: new Date(capturedAt).toISOString() },
  ].filter((entry): entry is { label: string; value: string } => Boolean(entry));
  return {
    code: input.code,
    title: input.title,
    summary: input.summary,
    detail: input.detail,
    facts,
  };
}

function summarizeMegaDiagnostic(detail: string, needsAuth: boolean): string {
  const normalized = detail.trim();
  if (!normalized) {
    return needsAuth ? 'The MEGA session needs to be connected again.' : 'MEGA reported a sync problem for this location.';
  }
  if (/network error 231|failed to access server:\s*231/i.test(normalized)) {
    return 'MEGA network error 231: MEGAcmd could not reach MEGA. Run mega-whoami and mega-sync --path-display-size=1024 on this machine and compare with the diagnostics facts (captured time, local path, remote path).';
  }
  if (/network error \d+|failed to access server:\s*\d+/i.test(normalized)) {
    return 'MEGA network access failed from this device. Reproduce with mega-whoami and mega-sync --path-display-size=1024, then use captured diagnostics to isolate where connectivity breaks.';
  }
  if (/quota|storage full|overquota/i.test(normalized)) {
    return 'The MEGA account appears to be out of space.';
  }
  if (/login|session|auth|401|expired/i.test(normalized)) {
    return 'The MEGA session appears to have expired and needs to be connected again.';
  }
  if (/not running|stopped|pause/i.test(normalized)) {
    return 'The MEGA sync appears to be stopped for this location.';
  }
  if (/permission|access denied|cannot write|read-only/i.test(normalized)) {
    return 'Nearbytes cannot write to the local MEGA mirror path.';
  }
  if (/same path/i.test(normalized)) {
    return 'MEGA thinks another sync already uses this local path.';
  }
  return normalized;
}

function summarizeMegaStatus(detail: string): string {
  const normalized = detail.trim();
  if (!normalized) {
    return 'MEGA is still checking this location.';
  }
  if (/sync|scan|index|pending|start/i.test(normalized)) {
    return normalized;
  }
  return `MEGA reported: ${normalized}`;
}

function summarizeMegaSyncIssueDetails(
  issues: readonly MegaSyncIssueDetail[],
  reportedCount: number | null
): {
  code: string;
  title: string;
  summary: string;
  detail: string;
  primaryReason: string;
} {
  const count = Math.max(issues.length, reportedCount ?? 0);
  const conflictingCopies = issues.every((issue) => /conflicting copies/i.test(issue.reason));
  if (conflictingCopies) {
    const message = count === 1
      ? 'MEGA found a conflicting copy for 1 file in this sync.'
      : `MEGA found conflicting copies for ${count} files in this sync.`;
    return {
      code: 'mega-sync-conflict',
      title: 'MEGA found conflicting copies',
      summary: message,
      detail: message,
      primaryReason: issues[0]?.reason ?? message,
    };
  }
  const firstReason = issues[0]?.reason?.trim() || 'MEGA reported sync issues for this location.';
  const summary = count > 1 ? `${firstReason} (${count} issues)` : firstReason;
  return {
    code: 'mega-sync-error',
    title: 'MEGA reported a sync error',
    summary,
    detail: summary,
    primaryReason: firstReason,
  };
}

function toPublicAuthSession(session: MegaAuthSession): ProviderAuthSession {
  return {
    id: session.id,
    provider: session.provider,
    accountId: session.accountId,
    status: session.status,
    detail: session.detail,
    authUrl: session.authUrl,
    openedAt: session.openedAt,
    expiresAt: session.expiresAt,
  };
}
