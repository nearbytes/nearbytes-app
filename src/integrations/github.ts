import { Buffer } from 'buffer';
import { MirrorWorker } from './mirrorWorker.js';
import type { MirrorRemoteAdapter } from './adapters.js';
import type {
  ConnectProviderAccountInput,
  ConnectProviderAccountResult,
  ConfigureProviderInput,
  CreateManagedShareInput,
  ManagedShare,
  ProviderAccount,
  ProviderAuthSession,
  ProviderSetupState,
  TransportState,
} from './types.js';
import type { IntegrationRuntime } from './runtime.js';

const GITHUB_TOKEN_SECRET_PREFIX = 'provider-account:github:';
const GITHUB_CONFIG_SECRET_KEY = 'provider-config:github';
interface GitHubConfig {
  readonly clientId?: string;
}

interface GitHubTokenSecret {
  readonly accessToken: string;
  readonly tokenType?: string;
  readonly scope?: string;
}

interface GitHubAuthSession extends ProviderAuthSession {
  readonly deviceCode: string;
  readonly userCode: string;
  readonly verificationUri: string;
  readonly intervalSeconds: number;
  readonly nextPollAt: number;
  readonly requestedLabel?: string;
  readonly completedAccount?: {
    readonly login?: string;
    readonly email?: string;
    readonly label: string;
  };
}

interface GitHubDeviceCodeResponse {
  readonly device_code?: string;
  readonly user_code?: string;
  readonly verification_uri?: string;
  readonly expires_in?: number;
  readonly interval?: number;
}

interface GitHubTokenResponse {
  readonly access_token?: string;
  readonly token_type?: string;
  readonly scope?: string;
  readonly error?: string;
  readonly error_description?: string;
}

interface GitHubUserResponse {
  readonly login?: string;
  readonly name?: string;
  readonly email?: string | null;
}

interface GitHubEmailResponseEntry {
  readonly email?: string;
  readonly primary?: boolean;
  readonly verified?: boolean;
}

interface GitHubRepoResponse {
  readonly default_branch?: string;
  readonly full_name?: string;
}

interface GitHubBranchResponse {
  readonly commit?: {
    readonly commit?: {
      readonly tree?: {
        readonly sha?: string;
      };
    };
  };
}

interface GitHubTreeResponse {
  readonly tree?: Array<{
    readonly path?: string;
    readonly type?: string;
    readonly size?: number;
    readonly sha?: string;
  }>;
}

interface GitHubBlobResponse {
  readonly content?: string;
  readonly encoding?: string;
}

export class GitHubTransportAdapter {
  readonly provider = 'github';
  readonly label = 'GitHub';
  readonly description = 'Managed repo-backed shares synced through a configurable nearbytes subdirectory.';
  readonly supportsAccountConnection = true;

  private readonly authSessions = new Map<string, GitHubAuthSession>();
  private readonly syncStates = new Map<string, TransportState>();
  private readonly syncTimers = new Map<string, NodeJS.Timeout>();
  private readonly syncingShares = new Set<string>();
  private readonly mirrorWorker = new MirrorWorker();

  constructor(
    private readonly runtime: IntegrationRuntime,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async probe(endpoint: import('./types.js').TransportEndpoint): Promise<TransportState> {
    if (endpoint.transport === 'provider-share' && endpoint.provider?.trim().toLowerCase() === this.provider) {
      return {
        status: 'ready',
        detail: 'GitHub provider shares are available.',
        badges: ['Device flow'],
      };
    }
    return {
      status: 'unsupported',
      detail: 'GitHub does not handle this endpoint.',
      badges: ['Unsupported'],
    };
  }

  async getSetupState(): Promise<ProviderSetupState> {
    const config = await this.getClientConfig();
    const clientId = config.clientId?.trim() || this.runtime.github.clientId?.trim();
    if (!clientId) {
      return {
        status: 'needs-config',
        detail: 'GitHub needs an OAuth app client ID with device flow enabled.',
        docsUrl: this.runtime.github.docsUrl,
        canConfigure: true,
        config: {
          clientId: undefined,
        },
      };
    }
    return {
      status: 'ready',
      detail: 'GitHub is ready to connect.',
      docsUrl: this.runtime.github.docsUrl,
      canConfigure: true,
      config: {
        clientId,
      },
    };
  }

  async configure(input: ConfigureProviderInput): Promise<ProviderSetupState> {
    await this.runtime.secretStore.set<GitHubConfig>(GITHUB_CONFIG_SECRET_KEY, {
      clientId: input.clientId?.trim() || undefined,
    });
    return this.getSetupState();
  }

  async connect(input: ConnectProviderAccountInput): Promise<ConnectProviderAccountResult> {
    if (input.authSessionId) {
      return this.pollAuthSession(input.authSessionId);
    }

    const clientId = await this.getEffectiveClientId();
    if (!clientId) {
      throw new Error('GitHub OAuth is not configured. Add the OAuth app client ID in the provider card first.');
    }

    const response = await this.fetchImpl(this.runtime.github.deviceCodeUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: clientId,
        scope: this.runtime.github.scopes.join(' '),
      }),
    });
    if (!response.ok) {
      throw await responseError(response, 'GitHub device sign-in could not start');
    }
    const payload = (await response.json()) as GitHubDeviceCodeResponse;
    if (!payload.device_code || !payload.user_code || !payload.verification_uri) {
      throw new Error('GitHub did not return a usable device sign-in session.');
    }

    const now = this.runtime.now();
    const session: GitHubAuthSession = {
      id: createOpaqueId('oauth-github'),
      provider: this.provider,
      accountId: input.accountId?.trim() || createOpaqueId('acct-github'),
      status: 'pending',
      detail: `Finish GitHub sign-in in the browser and enter code ${payload.user_code}.`,
      authUrl: payload.verification_uri,
      openedAt: now,
      expiresAt: now + Math.max(1, payload.expires_in ?? 900) * 1000,
      deviceCode: payload.device_code,
      userCode: payload.user_code,
      verificationUri: payload.verification_uri,
      intervalSeconds: Math.max(1, payload.interval ?? 5),
      nextPollAt: now + Math.max(1, payload.interval ?? 5) * 1000,
      requestedLabel: input.label?.trim() || undefined,
    };
    this.authSessions.set(session.id, session);
    await this.runtime.openExternalUrl?.(session.verificationUri);
    return {
      status: 'pending',
      authSession: toPublicAuthSession(session),
    };
  }

  async createManagedShare(
    input: CreateManagedShareInput,
    account: ProviderAccount
  ): Promise<Partial<ManagedShare>> {
    const repoOwner = requiredDescriptor(input.remoteDescriptor ?? {}, 'repoOwner', 'GitHub repo owner is required.');
    const repoName = requiredDescriptor(input.remoteDescriptor ?? {}, 'repoName', 'GitHub repo name is required.');
    const repo = await this.getRepo(account.id, repoOwner, repoName);
    const branch =
      getStringDescriptor(input.remoteDescriptor ?? {}, 'branch')?.trim() ||
      repo.default_branch?.trim() ||
      'main';
    const basePath = normalizeRepoPath(
      getStringDescriptor(input.remoteDescriptor ?? {}, 'basePath')?.trim() ||
      defaultGitHubBasePath(input.label)
    );

    return {
      remoteDescriptor: {
        repoOwner,
        repoName,
        repoFullName: repo.full_name ?? `${repoOwner}/${repoName}`,
        branch,
        basePath,
      },
      capabilities: ['mirror', 'read', 'write'],
    };
  }

  async getState(share: ManagedShare, account: ProviderAccount | null): Promise<TransportState> {
    const cached = this.syncStates.get(share.id);
    if (cached) {
      return cached;
    }
    if (!account) {
      return {
        status: 'needs-auth',
        detail: 'Reconnect GitHub to resume this share.',
        badges: ['Reconnect'],
      };
    }
    const repoFullName = getStringDescriptor(share.remoteDescriptor, 'repoFullName');
    const basePath = getStringDescriptor(share.remoteDescriptor, 'basePath');
    return {
      status: 'idle',
      detail: repoFullName && basePath ? `${repoFullName} → ${basePath}` : 'GitHub share is ready to sync.',
      badges: ['Repo'],
    };
  }

  async ensureSync(share: ManagedShare, account: ProviderAccount): Promise<void> {
    if (this.syncTimers.has(share.id)) {
      return;
    }
    await this.syncShareNow(share, account);
    const timer = setInterval(() => {
      void this.syncShareNow(share, account);
    }, this.runtime.github.syncIntervalMs);
    timer.unref?.();
    this.syncTimers.set(share.id, timer);
  }

  async detachManagedShare(share: ManagedShare): Promise<void> {
    const timer = this.syncTimers.get(share.id);
    if (timer) {
      clearInterval(timer);
      this.syncTimers.delete(share.id);
    }
    this.syncStates.delete(share.id);
    this.syncingShares.delete(share.id);
  }

  async disconnect(account: ProviderAccount): Promise<void> {
    await this.runtime.secretStore.delete(githubTokenSecretKey(account.id));
  }

  private async pollAuthSession(authSessionId: string): Promise<ConnectProviderAccountResult> {
    const session = this.authSessions.get(authSessionId);
    if (!session) {
      throw new Error('GitHub sign-in session was not found.');
    }
    const now = this.runtime.now();
    if (now > session.expiresAt && session.status === 'pending') {
      const expired: GitHubAuthSession = {
        ...session,
        status: 'failed',
        detail: 'GitHub sign-in expired. Start it again from Nearbytes.',
      };
      this.authSessions.set(authSessionId, expired);
      return {
        status: 'failed',
        authSession: toPublicAuthSession(expired),
      };
    }
    if (session.status === 'ready') {
      this.authSessions.delete(authSessionId);
      return {
        status: 'connected',
        account: {
          id: session.accountId,
          provider: this.provider,
          label: session.completedAccount?.label ?? 'GitHub',
          email: session.completedAccount?.email,
          state: 'connected',
          detail: 'GitHub is connected.',
          createdAt: 0,
          updatedAt: 0,
        },
      };
    }
    if (session.status === 'failed') {
      return {
        status: 'failed',
        authSession: toPublicAuthSession(session),
      };
    }
    if (now < session.nextPollAt) {
      return {
        status: 'pending',
        authSession: toPublicAuthSession(session),
      };
    }

    const payload = await this.exchangeDeviceCode(session);
    if (payload.error) {
      if (payload.error === 'authorization_pending') {
        const next = {
          ...session,
          nextPollAt: now + session.intervalSeconds * 1000,
        };
        this.authSessions.set(authSessionId, next);
        return {
          status: 'pending',
          authSession: toPublicAuthSession(next),
        };
      }
      if (payload.error === 'slow_down') {
        const next = {
          ...session,
          intervalSeconds: session.intervalSeconds + 5,
          nextPollAt: now + (session.intervalSeconds + 5) * 1000,
        };
        this.authSessions.set(authSessionId, next);
        return {
          status: 'pending',
          authSession: toPublicAuthSession(next),
        };
      }
      const failed = {
        ...session,
        status: 'failed' as const,
        detail: payload.error_description?.trim() || `GitHub sign-in failed: ${payload.error}.`,
      };
      this.authSessions.set(authSessionId, failed);
      return {
        status: 'failed',
        authSession: toPublicAuthSession(failed),
      };
    }

    if (!payload.access_token) {
      throw new Error('GitHub did not return an access token.');
    }

    await this.runtime.secretStore.set<GitHubTokenSecret>(githubTokenSecretKey(session.accountId), {
      accessToken: payload.access_token,
      tokenType: payload.token_type,
      scope: payload.scope,
    });
    const account = await this.fetchAccountProfile(session.accountId);
    const ready: GitHubAuthSession = {
      ...session,
      status: 'ready',
      detail: 'GitHub is connected.',
      completedAccount: account,
    };
    this.authSessions.set(authSessionId, ready);
    return {
      status: 'connected',
      account: {
        id: session.accountId,
        provider: this.provider,
        label: account.label,
        email: account.email,
        state: 'connected',
        detail: 'GitHub is connected.',
        createdAt: 0,
        updatedAt: 0,
      },
    };
  }

  private async exchangeDeviceCode(session: GitHubAuthSession): Promise<GitHubTokenResponse> {
    const response = await this.fetchImpl(this.runtime.github.tokenUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: await this.getRequiredClientId(),
        device_code: session.deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    });
    if (!response.ok) {
      throw await responseError(response, 'GitHub token exchange failed');
    }
    return (await response.json()) as GitHubTokenResponse;
  }

  private async fetchAccountProfile(accountId: string): Promise<{ login?: string; email?: string; label: string }> {
    const user = await this.api<GitHubUserResponse>(accountId, '/user');
    let email = user.email?.trim() || undefined;
    if (!email) {
      try {
        const emails = await this.api<GitHubEmailResponseEntry[]>(accountId, '/user/emails');
        email = emails.find((entry) => entry.primary && entry.verified)?.email?.trim()
          || emails.find((entry) => entry.verified)?.email?.trim()
          || emails.find((entry) => entry.email)?.email?.trim()
          || undefined;
      } catch {
        // Ignore optional email lookup failures.
      }
    }
    const login = user.login?.trim() || undefined;
    const name = user.name?.trim() || undefined;
    return {
      login,
      email,
      label: name || login || email || 'GitHub',
    };
  }

  private async syncShareNow(share: ManagedShare, account: ProviderAccount): Promise<void> {
    if (this.syncingShares.has(share.id)) {
      return;
    }
    this.syncingShares.add(share.id);
    this.syncStates.set(share.id, {
      status: 'syncing',
      detail: 'Syncing the local folder with GitHub.',
      badges: ['Syncing'],
      lastSyncAt: this.runtime.now(),
    });

    try {
      const remoteAdapter = new GitHubMirrorRemoteAdapter(this, account.id, share);
      const result = await this.mirrorWorker.sync(share.localPath, remoteAdapter);
      this.syncStates.set(share.id, {
        status: 'ready',
        detail: summarizeMirrorResult('GitHub share is up to date.', result),
        badges: ['Connected'],
        lastSyncAt: this.runtime.now(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.syncStates.set(share.id, {
        status: /token|oauth|auth|401|403/i.test(message) ? 'needs-auth' : 'attention',
        detail: message,
        badges: ['Repair'],
        lastSyncAt: this.runtime.now(),
      });
    } finally {
      this.syncingShares.delete(share.id);
    }
  }

  async listTree(accountId: string, owner: string, repo: string, branch: string): Promise<GitHubTreeResponse> {
    const branchInfo = await this.api<GitHubBranchResponse>(
      accountId,
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches/${encodeURIComponent(branch)}`
    );
    const treeSha = branchInfo.commit?.commit?.tree?.sha?.trim();
    if (!treeSha) {
      return { tree: [] };
    }
    return this.api<GitHubTreeResponse>(
      accountId,
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(treeSha)}?recursive=1`
    );
  }

  async downloadBlob(accountId: string, owner: string, repo: string, blobSha: string): Promise<Uint8Array> {
    const response = await this.api<GitHubBlobResponse>(
      accountId,
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/blobs/${encodeURIComponent(blobSha)}`
    );
    if (response.encoding !== 'base64' || typeof response.content !== 'string') {
      throw new Error(`GitHub did not return blob contents for ${blobSha}.`);
    }
    return decodeBase64(response.content);
  }

  async uploadFile(accountId: string, owner: string, repo: string, branch: string, repoPath: string, data: Uint8Array): Promise<void> {
    await this.api(
      accountId,
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodePath(repoPath)}`,
      {
        method: 'PUT',
        body: JSON.stringify({
          message: `nearbytes: sync ${repoPath}`,
          content: Buffer.from(data).toString('base64'),
          branch,
        }),
      }
    );
  }

  async getRepo(accountId: string, owner: string, repo: string): Promise<GitHubRepoResponse> {
    return this.api<GitHubRepoResponse>(accountId, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);
  }

  private async api<T = unknown>(accountId: string, pathname: string, init: RequestInit = {}): Promise<T> {
    const token = await this.runtime.secretStore.get<GitHubTokenSecret>(githubTokenSecretKey(accountId));
    if (!token?.accessToken) {
      throw new Error('GitHub account is not authenticated.');
    }
    const response = await this.fetchImpl(`${this.runtime.github.apiBaseUrl}${pathname}`, {
      ...init,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token.accessToken}`,
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(init.headers ?? {}),
      },
    });
    if (!response.ok) {
      throw await responseError(response, 'GitHub request failed');
    }
    return (await response.json()) as T;
  }

  private async getClientConfig(): Promise<GitHubConfig> {
    return (await this.runtime.secretStore.get<GitHubConfig>(GITHUB_CONFIG_SECRET_KEY)) ?? {};
  }

  private async getRequiredClientId(): Promise<string> {
    const clientId = await this.getEffectiveClientId();
    if (!clientId) {
      throw new Error('GitHub OAuth client ID is not configured.');
    }
    return clientId;
  }

  private async getEffectiveClientId(): Promise<string | undefined> {
    const config = await this.getClientConfig();
    return config.clientId?.trim() || this.runtime.github.clientId?.trim() || undefined;
  }
}

class GitHubMirrorRemoteAdapter implements MirrorRemoteAdapter {
  private readonly pathToSha = new Map<string, string>();

  constructor(
    private readonly adapter: GitHubTransportAdapter,
    private readonly accountId: string,
    private readonly share: ManagedShare
  ) {}

  async list(): Promise<readonly { path: string; size: number }[]> {
    const owner = requiredDescriptor(this.share.remoteDescriptor, 'repoOwner', 'GitHub share is missing repo owner.');
    const repo = requiredDescriptor(this.share.remoteDescriptor, 'repoName', 'GitHub share is missing repo name.');
    const branch = requiredDescriptor(this.share.remoteDescriptor, 'branch', 'GitHub share is missing branch.');
    const basePath = normalizeRepoPath(requiredDescriptor(this.share.remoteDescriptor, 'basePath', 'GitHub share is missing repo path.'));
    const tree = await this.adapter.listTree(this.accountId, owner, repo, branch);
    this.pathToSha.clear();
    return (tree.tree ?? [])
      .filter((entry) => entry.type === 'blob' && typeof entry.path === 'string' && entry.path.startsWith(`${basePath}/`))
      .map((entry) => {
        const path = entry.path!.slice(basePath.length + 1);
        if (entry.sha) {
          this.pathToSha.set(path, entry.sha);
        }
        return {
          path,
          size: Number(entry.size ?? 0),
        };
      })
      .filter((entry) => entry.path.startsWith('blocks/') || entry.path.startsWith('channels/'))
      .sort((left, right) => left.path.localeCompare(right.path));
  }

  async download(relativePath: string): Promise<Uint8Array> {
    const owner = requiredDescriptor(this.share.remoteDescriptor, 'repoOwner', 'GitHub share is missing repo owner.');
    const repo = requiredDescriptor(this.share.remoteDescriptor, 'repoName', 'GitHub share is missing repo name.');
    const normalizedPath = normalizeRepoPath(relativePath);
    const sha = this.pathToSha.get(normalizedPath);
    if (!sha) {
      throw new Error(`GitHub did not expose blob metadata for ${normalizedPath}.`);
    }
    return this.adapter.downloadBlob(this.accountId, owner, repo, sha);
  }

  async upload(relativePath: string, data: Uint8Array): Promise<void> {
    const owner = requiredDescriptor(this.share.remoteDescriptor, 'repoOwner', 'GitHub share is missing repo owner.');
    const repo = requiredDescriptor(this.share.remoteDescriptor, 'repoName', 'GitHub share is missing repo name.');
    const branch = requiredDescriptor(this.share.remoteDescriptor, 'branch', 'GitHub share is missing branch.');
    const basePath = normalizeRepoPath(requiredDescriptor(this.share.remoteDescriptor, 'basePath', 'GitHub share is missing repo path.'));
    await this.adapter.uploadFile(this.accountId, owner, repo, branch, `${basePath}/${normalizeRepoPath(relativePath)}`, data);
  }
}

function createOpaqueId(prefix: string): string {
  return `${prefix}-${Math.random().toString(16).slice(2, 10)}`;
}

function toPublicAuthSession(session: GitHubAuthSession): ProviderAuthSession {
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

function githubTokenSecretKey(accountId: string): string {
  return `${GITHUB_TOKEN_SECRET_PREFIX}${accountId}`;
}

async function responseError(response: Response, fallback: string): Promise<Error> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  const message =
    typeof payload === 'object' && payload && 'message' in payload && typeof (payload as { message?: unknown }).message === 'string'
      ? (payload as { message: string }).message
      : typeof payload === 'object' && payload && 'error_description' in payload && typeof (payload as { error_description?: unknown }).error_description === 'string'
        ? (payload as { error_description: string }).error_description
        : fallback;
  return new Error(message);
}

function summarizeMirrorResult(prefix: string, result: { uploaded: string[]; downloaded: string[] }): string {
  const changes = [];
  if (result.uploaded.length > 0) {
    changes.push(`${result.uploaded.length} uploaded`);
  }
  if (result.downloaded.length > 0) {
    changes.push(`${result.downloaded.length} downloaded`);
  }
  return changes.length > 0 ? `${prefix} ${changes.join(', ')}.` : prefix;
}

function getStringDescriptor(descriptor: Record<string, unknown>, key: string): string | undefined {
  const value = descriptor[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function requiredDescriptor(descriptor: Record<string, unknown>, key: string, message: string): string {
  const value = getStringDescriptor(descriptor, key);
  if (!value) {
    throw new Error(message);
  }
  return value;
}

function normalizeRepoPath(value: string): string {
  return value.trim().replace(/^\/+/u, '').replace(/\/+/gu, '/').replace(/\/+$/u, '');
}

function defaultGitHubBasePath(label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 40) || 'share';
  return `nearbytes/${slug}`;
}

function encodePath(value: string): string {
  return value
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function decodeBase64(value: string): Uint8Array {
  return Buffer.from(value.replace(/\n/gu, ''), 'base64');
}
