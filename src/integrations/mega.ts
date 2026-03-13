import { randomBytes } from 'crypto';
import path from 'path';
import { MegaHelperInstaller } from './megaInstaller.js';
import type {
  AcceptManagedShareInput,
  ConnectProviderAccountInput,
  ConnectProviderAccountResult,
  ConfigureProviderInput,
  CreateManagedShareInput,
  InviteManagedShareInput,
  ManagedShare,
  ProviderAccount,
  ProviderSetupState,
  TransportState,
} from './types.js';
import { resolveMegaCommand, type IntegrationRuntime } from './runtime.js';

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

export class MegaTransportAdapter {
  readonly provider = 'mega';
  readonly label = 'MEGA';
  readonly description = 'Managed folders and provider shares backed by MEGA CLI sync.';
  readonly supportsAccountConnection = true;

  private readonly syncStates = new Map<string, TransportState>();
  private readonly syncTimers = new Map<string, NodeJS.Timeout>();
  private readonly installer: MegaHelperInstaller;

  constructor(private readonly runtime: IntegrationRuntime) {
    this.installer = new MegaHelperInstaller({
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
    const credentials = input.credentials;
    const email = credentials?.email?.trim() || input.email?.trim();
    const password = credentials?.password ?? '';
    const mfaCode = credentials?.mfaCode?.trim() || '';
    if (!email || !password) {
      throw new Error('MEGA needs an email and password.');
    }

    const accountId = input.accountId?.trim() || createOpaqueId('acct-mega');
    await this.runMega('login', [email, password, ...(mfaCode ? [mfaCode] : [])], {
      timeoutMs: 60_000,
    });
    const sessionToken = await this.readSessionToken();
    await this.runtime.secretStore.set(megaSessionSecretKey(accountId), {
      email,
      sessionToken,
    } satisfies MegaSessionSecret);

    return {
      status: 'connected',
      account: {
        id: accountId,
        provider: this.provider,
        label: input.label?.trim() || 'MEGA',
        email,
        state: 'connected',
        detail: 'MEGA CLI is connected.',
        createdAt: 0,
        updatedAt: 0,
      },
    };
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
    await this.runMega('mkdir', ['-p', remotePath]);
    await this.ensureSyncTarget(input.localPath ?? '', remotePath);

    return {
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
    await this.ensureSyncTarget(input.localPath ?? '', remotePath);
    return {
      remoteDescriptor: {
        ...(input.remoteDescriptor ?? {}),
        remotePath,
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
        detail: 'Reconnect MEGA to resume this share.',
        badges: ['Reconnect'],
      };
    }
    return this.readSyncState(share, account.id);
  }

  async ensureSync(share: ManagedShare, account: ProviderAccount): Promise<void> {
    if (this.syncTimers.has(share.id)) {
      return;
    }
    await this.ensureLoggedIn(account.id);
    const remotePath = getStringDescriptor(share.remoteDescriptor, 'remotePath');
    if (!remotePath) {
      throw new Error('MEGA share is missing remotePath.');
    }
    const syncRecord = await this.findSyncByLocalPath(share.localPath, account.id);
    if (!syncRecord) {
      await this.ensureSyncTarget(share.localPath, remotePath);
    }
    await this.refreshSyncState(share, account.id);
    const timer = setInterval(() => {
      void this.refreshSyncState(share, account.id);
    }, this.runtime.mega.syncIntervalMs);
    timer.unref?.();
    this.syncTimers.set(share.id, timer);
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
    const syncRecord = await this.findSyncByLocalPath(share.localPath, account.id).catch(() => null);
    if (syncRecord?.id) {
      await this.runMega('sync', ['-d', syncRecord.id]).catch(() => {
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

  private async refreshSyncState(share: ManagedShare, accountId: string): Promise<void> {
    try {
      const state = await this.readSyncState(share, accountId);
      this.syncStates.set(share.id, state);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.syncStates.set(share.id, {
        status: /login|session|auth|401/i.test(message) ? 'needs-auth' : 'attention',
        detail: message,
        badges: ['Repair'],
        lastSyncAt: this.runtime.now(),
      });
    }
  }

  private async readSyncState(share: ManagedShare, accountId: string): Promise<TransportState> {
    await this.ensureLoggedIn(accountId);
    const syncRecord = await this.findSyncByLocalPath(share.localPath, accountId);
    if (!syncRecord) {
      return {
        status: 'attention',
        detail: 'MEGA sync is not running for this share.',
        badges: ['Repair'],
      };
    }
    if (syncRecord.error?.trim()) {
      return {
        status: 'attention',
        detail: syncRecord.error.trim(),
        badges: ['Repair'],
        lastSyncAt: this.runtime.now(),
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
    return {
      status: 'syncing',
      detail: syncRecord.status?.trim() || 'MEGA sync is starting.',
      badges: ['Syncing'],
      lastSyncAt: this.runtime.now(),
    };
  }

  private async ensureLoggedIn(accountId: string): Promise<void> {
    const secret = await this.runtime.secretStore.get<MegaSessionSecret>(megaSessionSecretKey(accountId));
    if (!secret) {
      throw new Error('MEGA is not connected for this account.');
    }
    await this.runMega('login', [secret.sessionToken], {
      timeoutMs: 60_000,
    }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      if (/already logged in|command not valid while login in: login/i.test(message)) {
        return;
      }
      throw error;
    });
  }

  private async readSessionToken(): Promise<string> {
    const result = await this.runMega('session', []);
    const token = firstMeaningfulLine(result.stdout);
    if (!token) {
      throw new Error('MEGA did not return a session token.');
    }
    return token;
  }

  private async ensureSyncTarget(localPath: string, remotePath: string): Promise<void> {
    if (!localPath.trim()) {
      throw new Error('Nearbytes share folder is missing.');
    }
    await this.runMega('sync', [localPath, remotePath], {
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
    await this.ensureLoggedIn(accountId);
    const result = await this.runMega('sync', [
      '--path-display-size=0',
      '--col-separator=\t',
      '--output-cols=ID,LOCALPATH,REMOTEPATH,RUN_STATE,STATUS,ERROR',
    ]);
    const target = normalizeComparablePath(localPath);
    const records = parseMegaSyncTable(result.stdout);
    return (
      records.find((record) => normalizeComparablePath(record.localPath ?? '') === target) ??
      null
    );
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

  private async runMega(
    subcommand: string,
    args: readonly string[],
    options: { timeoutMs?: number } = {}
  ): Promise<{ stdout: string; stderr: string }> {
    const commandDirectory = await this.installer.getCommandDirectory();
    const command = resolveMegaCommand(commandDirectory, subcommand);
    try {
      const result = await this.runtime.commandExecutor.run({
        command,
        args,
        cwd: commandDirectory || undefined,
        env: commandDirectory
          ? {
              PATH: `${commandDirectory}${path.delimiter}${process.env.PATH ?? ''}`,
            }
          : undefined,
        timeoutMs: options.timeoutMs ?? 30_000,
      });
      if (result.exitCode !== 0) {
        throw new Error(extractMegaError(result.stderr || result.stdout || `${subcommand} failed`));
      }
      return {
        stdout: result.stdout,
        stderr: result.stderr,
      };
    } catch (error) {
      if (isCommandNotFound(error)) {
        throw new Error('MEGA CLI was not found. Install MEGAcmd or set NEARBYTES_MEGACMD_DIR.');
      }
      throw error;
    }
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
  return stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !/^ID\tLOCALPATH/i.test(line))
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

function normalizeComparablePath(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/\/+$/u, '').toLowerCase();
}

function extractMegaError(value: string): string {
  return firstMeaningfulLine(value) ?? 'MEGA command failed.';
}

function getStringDescriptor(descriptor: Record<string, unknown>, key: string): string | undefined {
  const value = descriptor[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function isCommandNotFound(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      ((error as { code?: string }).code === 'ENOENT' || (error as { message?: string }).message?.includes('ENOENT'))
  );
}
