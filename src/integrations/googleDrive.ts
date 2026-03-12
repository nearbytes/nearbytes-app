import { createHash, randomBytes } from 'crypto';
import path from 'path';
import { MirrorWorker } from './mirrorWorker.js';
import type { MirrorRemoteAdapter } from './adapters.js';
import type {
  AcceptManagedShareInput,
  ConnectProviderAccountInput,
  ConnectProviderAccountResult,
  ConfigureProviderInput,
  CreateManagedShareInput,
  InviteManagedShareInput,
  ManagedShare,
  ProviderAccount,
  ProviderAuthSession,
  ProviderSetupState,
  TransportState,
} from './types.js';
import type { IntegrationRuntime } from './runtime.js';

const GOOGLE_FOLDER_MIME = 'application/vnd.google-apps.folder';
const GOOGLE_TOKEN_SECRET_PREFIX = 'provider-account:gdrive:';
const GOOGLE_CONFIG_SECRET_KEY = 'provider-config:gdrive';
const GOOGLE_AUTH_SESSION_TTL_MS = 10 * 60 * 1000;
const GOOGLE_EXPIRY_SKEW_MS = 60_000;
const GOOGLE_CONSOLE_CLIENTS_URL = 'https://console.cloud.google.com/apis/credentials';

interface GoogleTokenSecret {
  readonly accessToken: string;
  readonly refreshToken?: string;
  readonly expiresAt: number;
  readonly tokenType?: string;
  readonly scope?: string;
}

interface GoogleAuthSession extends ProviderAuthSession {
  readonly state: string;
  readonly redirectUri: string;
  readonly codeVerifier: string;
  readonly requestedLabel?: string;
  readonly completedAccount?: {
    readonly email?: string;
    readonly label: string;
  };
}

interface GoogleDriveFileRecord {
  readonly id: string;
  readonly name: string;
  readonly mimeType?: string;
  readonly size?: string;
  readonly webViewLink?: string;
}

interface GoogleDriveListResponse {
  readonly files?: GoogleDriveFileRecord[];
  readonly nextPageToken?: string;
}

interface GoogleClientConfig {
  readonly clientId?: string;
  readonly clientSecret?: string;
}

export class GoogleDriveTransportAdapter {
  readonly provider = 'gdrive';
  readonly label = 'Google Drive';
  readonly description = 'Managed folders and shared mirrors backed by Google Drive.';
  readonly supportsAccountConnection = true;

  private readonly authSessions = new Map<string, GoogleAuthSession>();
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
        detail: 'Google Drive is available for managed share planning.',
        badges: ['OAuth'],
      };
    }
    return {
      status: 'unsupported',
      detail: 'Google Drive does not handle this endpoint.',
      badges: ['Experimental'],
    };
  }

  async getSetupState(): Promise<ProviderSetupState> {
    const config = await this.getClientConfig();
    const clientId = config.clientId?.trim() || this.runtime.google.clientId?.trim();
    if (!clientId) {
      return {
        status: 'needs-config',
        detail: 'Google Drive needs a Desktop app OAuth client ID. Nearbytes uses PKCE, so no client secret is required.',
        docsUrl: GOOGLE_CONSOLE_CLIENTS_URL,
        canConfigure: true,
        config: {
          hasClientSecret: Boolean(config.clientSecret || this.runtime.google.clientSecret),
        },
      };
    }
    return {
      status: 'ready',
      detail: 'Google Drive is ready to connect.',
      docsUrl: GOOGLE_CONSOLE_CLIENTS_URL,
      canConfigure: true,
      config: {
        clientId,
        hasClientSecret: Boolean(config.clientSecret || this.runtime.google.clientSecret),
      },
    };
  }

  async configure(input: ConfigureProviderInput): Promise<ProviderSetupState> {
    await this.runtime.secretStore.set<GoogleClientConfig>(GOOGLE_CONFIG_SECRET_KEY, {
      clientId: input.clientId?.trim() || undefined,
      clientSecret: input.clientSecret?.trim() || undefined,
    });
    return this.getSetupState();
  }

  async connect(
    input: ConnectProviderAccountInput,
    context?: { callbackBaseUrl?: string }
  ): Promise<ConnectProviderAccountResult> {
    if (input.authSessionId) {
      return this.pollAuthSession(input.authSessionId);
    }

    const clientId = await this.getEffectiveClientId();
    if (!clientId) {
      throw new Error('Google Drive OAuth is not configured. Add a Desktop app client id in the provider card first.');
    }
    if (!context?.callbackBaseUrl) {
      throw new Error('Google Drive OAuth callback base URL is not available.');
    }

    const accountId = input.accountId?.trim() || createOpaqueId('acct-gdrive');
    const sessionId = createOpaqueId('oauth-gdrive');
    const state = createOpaqueId('state');
    const redirectUri = `${context.callbackBaseUrl.replace(/\/+$/u, '')}/oauth/google/callback`;
    const codeVerifier = createCodeVerifier();
    const codeChallenge = createCodeChallenge(codeVerifier);
    const now = this.runtime.now();
    const authUrl = new URL(this.runtime.google.authorizationBaseUrl);
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', this.runtime.google.scopes.join(' '));
    authUrl.searchParams.set('access_type', 'offline');
    authUrl.searchParams.set('prompt', 'consent');
    authUrl.searchParams.set('code_challenge', codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    authUrl.searchParams.set('state', state);

    const session: GoogleAuthSession = {
      id: sessionId,
      provider: this.provider,
      accountId,
      status: 'pending',
      detail: 'Finish Google sign-in in your browser.',
      authUrl: authUrl.toString(),
      openedAt: now,
      expiresAt: now + GOOGLE_AUTH_SESSION_TTL_MS,
      state,
      redirectUri,
      codeVerifier,
      requestedLabel: input.label?.trim() || undefined,
    };
    this.authSessions.set(sessionId, session);
    await this.runtime.openExternalUrl?.(session.authUrl!);
    return {
      status: 'pending',
      authSession: toPublicAuthSession(session),
    };
  }

  async handleOAuthCallback(query: URLSearchParams): Promise<string> {
    const state = query.get('state')?.trim();
    const session = state ? this.findSessionByState(state) : null;
    if (!session) {
      return renderCallbackPage('Google Drive sign-in could not be matched to an active Nearbytes session.', false);
    }

    if (this.runtime.now() > session.expiresAt) {
      this.authSessions.set(session.id, {
        ...session,
        status: 'failed',
        detail: 'Google sign-in expired. Start it again from Nearbytes.',
      });
      return renderCallbackPage('Google Drive sign-in expired. Start it again from Nearbytes.', false);
    }

    const error = query.get('error')?.trim();
    if (error) {
      this.authSessions.set(session.id, {
        ...session,
        status: 'failed',
        detail: `Google sign-in was not completed: ${error}.`,
      });
      return renderCallbackPage('Google Drive sign-in was not completed.', false);
    }

    const code = query.get('code')?.trim();
    if (!code) {
      this.authSessions.set(session.id, {
        ...session,
        status: 'failed',
        detail: 'Google did not return an authorization code.',
      });
      return renderCallbackPage('Google Drive did not return an authorization code.', false);
    }

    try {
      const tokenSecret = await this.exchangeCodeForToken(code, session);
      await this.runtime.secretStore.set(googleTokenSecretKey(session.accountId), tokenSecret);
      const account = await this.fetchAccountProfile(session.accountId);
      this.authSessions.set(session.id, {
        ...session,
        status: 'ready',
        detail: 'Google Drive is connected.',
        completedAccount: account,
      });
      return renderCallbackPage('Google Drive is connected. You can return to Nearbytes.', true);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.authSessions.set(session.id, {
        ...session,
        status: 'failed',
        detail: message,
      });
      return renderCallbackPage(message, false);
    }
  }

  async createManagedShare(
    input: CreateManagedShareInput,
    account: ProviderAccount
  ): Promise<Partial<ManagedShare>> {
    const folderLabel = `${slugify(input.label)}-${createOpaqueId('nb').slice(-6)}`;
    const rootFolderId = await this.ensureFolder(account.id, undefined, 'Nearbytes');
    const folderId = await this.ensureFolder(account.id, rootFolderId, folderLabel);
    const folder = await this.getFile(account.id, folderId, 'id,name,webViewLink');
    return {
      remoteDescriptor: {
        folderId,
        folderName: folder.name,
        webViewLink: folder.webViewLink ?? null,
      },
      capabilities: ['mirror', 'read', 'write', 'invite'],
    };
  }

  async invite(share: ManagedShare, input: InviteManagedShareInput, account: ProviderAccount): Promise<void> {
    const folderId = getStringDescriptor(share.remoteDescriptor, 'folderId');
    if (!folderId) {
      throw new Error('Google Drive share is missing its folder id.');
    }

    for (const email of input.emails) {
      await this.api(account.id, `/files/${encodeURIComponent(folderId)}/permissions?supportsAllDrives=true`, {
        method: 'POST',
        body: JSON.stringify({
          type: 'user',
          role: 'writer',
          emailAddress: email,
        }),
      });
    }
  }

  async acceptInvite(
    input: AcceptManagedShareInput,
    account: ProviderAccount
  ): Promise<Partial<ManagedShare>> {
    const folderId = getStringDescriptor(input.remoteDescriptor ?? {}, 'folderId');
    if (!folderId) {
      throw new Error('Google Drive attachment is missing folderId.');
    }
    const folder = await this.getFile(account.id, folderId, 'id,name,webViewLink,mimeType');
    if (folder.mimeType !== GOOGLE_FOLDER_MIME) {
      throw new Error('Google Drive attachment is not a folder.');
    }
    return {
      label: folder.name,
      remoteDescriptor: {
        folderId,
        folderName: folder.name,
        webViewLink: folder.webViewLink ?? null,
      },
      capabilities: ['mirror', 'read', 'write', 'accept'],
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
        detail: 'Reconnect Google Drive to resume this mirror.',
        badges: ['Reconnect'],
      };
    }
    return {
      status: 'idle',
      detail: 'Google Drive mirror is ready to sync.',
      badges: ['Mirror'],
    };
  }

  async ensureSync(share: ManagedShare, account: ProviderAccount): Promise<void> {
    if (this.syncTimers.has(share.id)) {
      return;
    }
    await this.syncShareNow(share, account);
    const timer = setInterval(() => {
      void this.syncShareNow(share, account);
    }, this.runtime.google.syncIntervalMs);
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
    await this.runtime.secretStore.delete(googleTokenSecretKey(account.id));
  }

  private async pollAuthSession(authSessionId: string): Promise<ConnectProviderAccountResult> {
    const session = this.authSessions.get(authSessionId);
    if (!session) {
      throw new Error('Google Drive sign-in session was not found.');
    }
    if (this.runtime.now() > session.expiresAt && session.status === 'pending') {
      const expired: GoogleAuthSession = {
        ...session,
        status: 'failed',
        detail: 'Google sign-in expired. Start it again from Nearbytes.',
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
          label: session.completedAccount?.label ?? 'Google Drive',
          email: session.completedAccount?.email,
          state: 'connected',
          detail: 'Google Drive is connected.',
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
    return {
      status: 'pending',
      authSession: toPublicAuthSession(session),
    };
  }

  private async syncShareNow(share: ManagedShare, account: ProviderAccount): Promise<void> {
    if (this.syncingShares.has(share.id)) {
      return;
    }
    this.syncingShares.add(share.id);
    this.syncStates.set(share.id, {
      status: 'syncing',
      detail: 'Syncing the local mirror with Google Drive.',
      badges: ['Syncing'],
      lastSyncAt: this.runtime.now(),
    });

    try {
      const remoteAdapter = new GoogleDriveMirrorRemoteAdapter(this, account.id, share);
      const result = await this.mirrorWorker.sync(share.localPath, remoteAdapter);
      this.syncStates.set(share.id, {
        status: 'ready',
        detail: summarizeMirrorResult('Google Drive mirror is up to date.', result),
        badges: ['Connected'],
        lastSyncAt: this.runtime.now(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.syncStates.set(share.id, {
        status: /oauth|token|unauthorized|401/i.test(message) ? 'needs-auth' : 'attention',
        detail: message,
        badges: ['Repair'],
        lastSyncAt: this.runtime.now(),
      });
    } finally {
      this.syncingShares.delete(share.id);
    }
  }

  private async exchangeCodeForToken(code: string, session: GoogleAuthSession): Promise<GoogleTokenSecret> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: session.redirectUri,
      client_id: await this.getRequiredClientId(),
      code_verifier: session.codeVerifier,
    });
    const clientSecret = await this.getEffectiveClientSecret();
    if (clientSecret) {
      body.set('client_secret', clientSecret);
    }

    const response = await this.fetchImpl(this.runtime.google.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });
    if (!response.ok) {
      throw await responseError(response, 'Google token exchange failed');
    }
    const payload = (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      token_type?: string;
      scope?: string;
    };
    if (!payload.access_token) {
      throw new Error('Google token exchange did not return an access token.');
    }
    return {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      expiresAt: this.runtime.now() + Math.max(1, payload.expires_in ?? 3600) * 1000,
      tokenType: payload.token_type,
      scope: payload.scope,
    };
  }

  private async fetchAccountProfile(accountId: string): Promise<{ email?: string; label: string }> {
    const response = await this.api<{ user?: { displayName?: string; emailAddress?: string } }>(
      accountId,
      '/about?fields=user(displayName,emailAddress)&supportsAllDrives=true'
    );
    const email = response.user?.emailAddress?.trim() || undefined;
    const displayName = response.user?.displayName?.trim() || undefined;
    return {
      email,
      label: displayName || email || 'Google Drive',
    };
  }

  async ensureFolder(accountId: string, parentId: string | undefined, name: string): Promise<string> {
    const existing = await this.findChildByName(accountId, parentId, name, GOOGLE_FOLDER_MIME);
    if (existing) {
      return existing.id;
    }

    const created = await this.api<GoogleDriveFileRecord>(accountId, '/files?supportsAllDrives=true', {
      method: 'POST',
      body: JSON.stringify({
        name,
        mimeType: GOOGLE_FOLDER_MIME,
        parents: parentId ? [parentId] : undefined,
      }),
    });
    return created.id;
  }

  async findChildByName(
    accountId: string,
    parentId: string | undefined,
    name: string,
    mimeType?: string
  ): Promise<GoogleDriveFileRecord | null> {
    const terms = [
      `name = '${escapeDriveQueryValue(name)}'`,
      'trashed = false',
      parentId ? `'${escapeDriveQueryValue(parentId)}' in parents` : `'root' in parents`,
    ];
    if (mimeType) {
      terms.push(`mimeType = '${escapeDriveQueryValue(mimeType)}'`);
    }
    const query = encodeURIComponent(terms.join(' and '));
    const response = await this.api<GoogleDriveListResponse>(
      accountId,
      `/files?q=${query}&pageSize=10&fields=files(id,name,mimeType,webViewLink)&supportsAllDrives=true&includeItemsFromAllDrives=true`
    );
    return response.files?.[0] ?? null;
  }

  private async getFile(accountId: string, fileId: string, fields: string): Promise<GoogleDriveFileRecord> {
    return this.api<GoogleDriveFileRecord>(
      accountId,
      `/files/${encodeURIComponent(fileId)}?fields=${encodeURIComponent(fields)}&supportsAllDrives=true`
    );
  }

  private async getAccessToken(accountId: string): Promise<string> {
    const secret = await this.runtime.secretStore.get<GoogleTokenSecret>(googleTokenSecretKey(accountId));
    if (!secret) {
      throw new Error('Google Drive is not connected for this account.');
    }
    if (secret.expiresAt > this.runtime.now() + GOOGLE_EXPIRY_SKEW_MS) {
      return secret.accessToken;
    }
    if (!secret.refreshToken) {
      throw new Error('Google Drive refresh token is missing. Reconnect the account.');
    }

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: secret.refreshToken,
      client_id: (await this.getRequiredClientId()) ?? '',
    });
    const clientSecret = await this.getEffectiveClientSecret();
    if (clientSecret) {
      body.set('client_secret', clientSecret);
    }

    const response = await this.fetchImpl(this.runtime.google.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });
    if (!response.ok) {
      throw await responseError(response, 'Google token refresh failed');
    }
    const payload = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
      token_type?: string;
      scope?: string;
    };
    if (!payload.access_token) {
      throw new Error('Google token refresh did not return an access token.');
    }
    const nextSecret: GoogleTokenSecret = {
      accessToken: payload.access_token,
      refreshToken: secret.refreshToken,
      expiresAt: this.runtime.now() + Math.max(1, payload.expires_in ?? 3600) * 1000,
      tokenType: payload.token_type ?? secret.tokenType,
      scope: payload.scope ?? secret.scope,
    };
    await this.runtime.secretStore.set(googleTokenSecretKey(accountId), nextSecret);
    return nextSecret.accessToken;
  }

  private async getClientConfig(): Promise<GoogleClientConfig> {
    return (await this.runtime.secretStore.get<GoogleClientConfig>(GOOGLE_CONFIG_SECRET_KEY)) ?? {};
  }

  private async getEffectiveClientId(): Promise<string | undefined> {
    const config = await this.getClientConfig();
    return config.clientId?.trim() || this.runtime.google.clientId?.trim() || undefined;
  }

  private async getRequiredClientId(): Promise<string> {
    const clientId = await this.getEffectiveClientId();
    if (!clientId) {
      throw new Error('Google Drive OAuth client id is missing.');
    }
    return clientId;
  }

  private async getEffectiveClientSecret(): Promise<string | undefined> {
    const config = await this.getClientConfig();
    return config.clientSecret?.trim() || this.runtime.google.clientSecret?.trim() || undefined;
  }

  async api<T>(accountId: string, requestPath: string, init: RequestInit = {}): Promise<T> {
    const token = await this.getAccessToken(accountId);
    const response = await this.fetchImpl(`${this.runtime.google.driveApiBaseUrl}${requestPath}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(init.body && !(init.body instanceof Blob) ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers ?? {}),
      },
    });
    if (!response.ok) {
      throw await responseError(response, 'Google Drive request failed');
    }
    return (await response.json()) as T;
  }

  async downloadFile(accountId: string, fileId: string): Promise<Uint8Array> {
    const token = await this.getAccessToken(accountId);
    const response = await this.fetchImpl(
      `${this.runtime.google.driveApiBaseUrl}/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );
    if (!response.ok) {
      throw await responseError(response, 'Google Drive download failed');
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  async uploadFile(accountId: string, parentId: string, name: string, data: Uint8Array): Promise<void> {
    const token = await this.getAccessToken(accountId);
    const boundary = `nearbytes-${createOpaqueId('upload')}`;
    const metadata = JSON.stringify({
      name,
      parents: [parentId],
    });
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
      `--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`,
      Buffer.from(data),
      `\r\n--${boundary}--\r\n`,
    ]);
    const response = await this.fetchImpl(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body,
      }
    );
    if (!response.ok) {
      throw await responseError(response, 'Google Drive upload failed');
    }
  }

  private findSessionByState(state: string): GoogleAuthSession | null {
    for (const session of this.authSessions.values()) {
      if (session.state === state) {
        return session;
      }
    }
    return null;
  }
}

class GoogleDriveMirrorRemoteAdapter implements MirrorRemoteAdapter {
  private fileMap = new Map<string, GoogleDriveFileRecord>();

  constructor(
    private readonly adapter: GoogleDriveTransportAdapter,
    private readonly accountId: string,
    private readonly share: ManagedShare
  ) {}

  async list(): Promise<readonly { path: string; size: number }[]> {
    this.fileMap.clear();
    const folderId = getStringDescriptor(this.share.remoteDescriptor, 'folderId');
    if (!folderId) {
      throw new Error('Google Drive share is missing folderId.');
    }
    const entries = await this.walkFolder(folderId, '');
    for (const entry of entries) {
      this.fileMap.set(entry.path, entry.file);
    }
    return entries.map((entry) => ({
      path: entry.path,
      size: Number.parseInt(entry.file.size ?? '0', 10) || 0,
    }));
  }

  async download(relativePath: string): Promise<Uint8Array> {
    const existing = this.fileMap.get(normalizeRelativePath(relativePath)) ?? (await this.findFile(relativePath));
    if (!existing) {
      throw new Error(`Google Drive file not found: ${relativePath}`);
    }
    return this.adapter.downloadFile(this.accountId, existing.id);
  }

  async upload(relativePath: string, data: Uint8Array): Promise<void> {
    const folderId = getStringDescriptor(this.share.remoteDescriptor, 'folderId');
    if (!folderId) {
      throw new Error('Google Drive share is missing folderId.');
    }
    const normalized = normalizeRelativePath(relativePath);
    const directory = path.posix.dirname(normalized);
    const fileName = path.posix.basename(normalized);
    const parentId = await this.ensurePath(folderId, directory === '.' ? '' : directory);
    await this.adapter.uploadFile(this.accountId, parentId, fileName, data);
  }

  private async walkFolder(
    folderId: string,
    prefix: string
  ): Promise<Array<{ path: string; file: GoogleDriveFileRecord }>> {
    const children = await this.listChildren(folderId);
    const result: Array<{ path: string; file: GoogleDriveFileRecord }> = [];
    for (const child of children) {
      const nextPath = prefix ? `${prefix}/${child.name}` : child.name;
      if (child.mimeType === GOOGLE_FOLDER_MIME) {
        result.push(...(await this.walkFolder(child.id, nextPath)));
        continue;
      }
      const normalized = normalizeRelativePath(nextPath);
      if (!normalized.startsWith('blocks/') && !normalized.startsWith('channels/')) {
        continue;
      }
      result.push({
        path: normalized,
        file: child,
      });
    }
    return result;
  }

  private async listChildren(folderId: string): Promise<GoogleDriveFileRecord[]> {
    const encodedQuery = encodeURIComponent(`'${escapeDriveQueryValue(folderId)}' in parents and trashed = false`);
    const response = await this.adapter.api<GoogleDriveListResponse>(
      this.accountId,
      `/files?q=${encodedQuery}&pageSize=1000&fields=files(id,name,mimeType,size,webViewLink)&supportsAllDrives=true&includeItemsFromAllDrives=true`
    );
    return response.files ?? [];
  }

  private async ensurePath(folderId: string, relativeDirectory: string): Promise<string> {
    if (!relativeDirectory) {
      return folderId;
    }
    let currentFolderId = folderId;
    for (const segment of normalizeRelativePath(relativeDirectory).split('/')) {
      currentFolderId = await this.adapter.ensureFolder(this.accountId, currentFolderId, segment);
    }
    return currentFolderId;
  }

  private async findFile(relativePath: string): Promise<GoogleDriveFileRecord | null> {
    const normalized = normalizeRelativePath(relativePath);
    const folderId = getStringDescriptor(this.share.remoteDescriptor, 'folderId');
    if (!folderId) {
      return null;
    }
    const segments = normalized.split('/');
    let currentFolderId = folderId;
    for (let index = 0; index < segments.length - 1; index += 1) {
      const child = await this.adapter.findChildByName(
        this.accountId,
        currentFolderId,
        segments[index],
        GOOGLE_FOLDER_MIME
      );
      if (!child) {
        return null;
      }
      currentFolderId = child.id;
    }
    return this.adapter.findChildByName(this.accountId, currentFolderId, segments.at(-1) ?? '');
  }
}

function googleTokenSecretKey(accountId: string): string {
  return `${GOOGLE_TOKEN_SECRET_PREFIX}${accountId}`;
}

function createCodeVerifier(): string {
  return base64Url(randomBytes(32));
}

function createCodeChallenge(value: string): string {
  return base64Url(createHash('sha256').update(value).digest());
}

function base64Url(value: Buffer): string {
  return value.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

function createOpaqueId(prefix: string): string {
  return `${prefix}-${randomBytes(8).toString('hex')}`;
}

function toPublicAuthSession(session: GoogleAuthSession): ProviderAuthSession {
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

function renderCallbackPage(message: string, ok: boolean): string {
  const safe = escapeHtml(message);
  const title = ok ? 'Google Drive connected' : 'Google Drive sign-in failed';
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 0; background: #f4f1ea; color: #1d1b18; }
      main { max-width: 480px; margin: 8vh auto; padding: 32px; border-radius: 24px; background: white; box-shadow: 0 24px 80px rgba(29,27,24,0.12); }
      h1 { margin: 0 0 12px; font-size: 28px; }
      p { margin: 0; line-height: 1.5; }
    </style>
  </head>
  <body>
    <main>
      <h1>${title}</h1>
      <p>${safe}</p>
    </main>
    <script>setTimeout(() => window.close(), 1200);</script>
  </body>
</html>`;
}

async function responseError(response: Response, fallback: string): Promise<Error> {
  let message = fallback;
  try {
    const payload = await response.json();
    if (payload?.error_description) {
      message = String(payload.error_description);
    } else if (payload?.error?.message) {
      message = String(payload.error.message);
    } else if (payload?.error) {
      message = typeof payload.error === 'string' ? payload.error : JSON.stringify(payload.error);
    }
  } catch {
    // Ignore JSON parse failures.
  }
  return new Error(message);
}

function summarizeMirrorResult(
  prefix: string,
  result: { uploaded: readonly string[]; downloaded: readonly string[]; skipped: readonly string[] }
): string {
  const parts: string[] = [];
  if (result.uploaded.length > 0) {
    parts.push(`${result.uploaded.length} uploaded`);
  }
  if (result.downloaded.length > 0) {
    parts.push(`${result.downloaded.length} downloaded`);
  }
  if (parts.length === 0) {
    return `${prefix} No file changes were needed.`;
  }
  return `${prefix} ${parts.join(', ')}.`;
}

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+/u, '');
}

function slugify(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 42) || 'nearbytes'
  );
}

function getStringDescriptor(descriptor: Record<string, unknown>, key: string): string | undefined {
  const value = descriptor[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
