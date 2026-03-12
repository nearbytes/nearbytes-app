import { spawn } from 'child_process';

export interface ProviderSecretStore {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface CommandInvocation {
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly input?: string;
  readonly timeoutMs?: number;
}

export interface CommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export interface CommandExecutor {
  run(invocation: CommandInvocation): Promise<CommandResult>;
}

export interface IntegrationLogger {
  readonly log: (...args: unknown[]) => void;
  readonly warn: (...args: unknown[]) => void;
}

export interface GoogleDriveRuntimeConfig {
  readonly clientId?: string;
  readonly clientSecret?: string;
  readonly authorizationBaseUrl: string;
  readonly tokenUrl: string;
  readonly driveApiBaseUrl: string;
  readonly scopes: readonly string[];
  readonly syncIntervalMs: number;
}

export interface MegaRuntimeConfig {
  readonly commandDirectory?: string;
  readonly remoteBasePath: string;
  readonly syncIntervalMs: number;
}

export interface IntegrationRuntime {
  readonly secretStore: ProviderSecretStore;
  readonly commandExecutor: CommandExecutor;
  readonly openExternalUrl?: (url: string) => Promise<void>;
  readonly now: () => number;
  readonly logger: IntegrationLogger;
  readonly google: GoogleDriveRuntimeConfig;
  readonly mega: MegaRuntimeConfig;
}

export interface IntegrationRuntimeOptions {
  readonly secretStore: ProviderSecretStore;
  readonly commandExecutor?: CommandExecutor;
  readonly openExternalUrl?: (url: string) => Promise<void>;
  readonly now?: () => number;
  readonly logger?: IntegrationLogger;
  readonly google?: Partial<GoogleDriveRuntimeConfig>;
  readonly mega?: Partial<MegaRuntimeConfig>;
}

const DEFAULT_GOOGLE_SCOPES = ['https://www.googleapis.com/auth/drive'] as const;
const DEFAULT_SYNC_INTERVAL_MS = 20_000;
export const DEFAULT_GOOGLE_DESKTOP_CLIENT_ID =
  '381193316033-b1g7h9dovqs5j22fi7obc4jug4o77vmi.apps.googleusercontent.com';

export function createIntegrationRuntime(options: IntegrationRuntimeOptions): IntegrationRuntime {
  return {
    secretStore: options.secretStore,
    commandExecutor: options.commandExecutor ?? new DefaultCommandExecutor(),
    openExternalUrl: options.openExternalUrl,
    now: options.now ?? Date.now,
    logger: options.logger ?? console,
    google: {
      clientId:
        options.google?.clientId?.trim() ||
        process.env.NEARBYTES_GOOGLE_CLIENT_ID?.trim() ||
        DEFAULT_GOOGLE_DESKTOP_CLIENT_ID,
      clientSecret:
        options.google?.clientSecret?.trim() || process.env.NEARBYTES_GOOGLE_CLIENT_SECRET?.trim() || undefined,
      authorizationBaseUrl:
        options.google?.authorizationBaseUrl?.trim() || 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: options.google?.tokenUrl?.trim() || 'https://oauth2.googleapis.com/token',
      driveApiBaseUrl: options.google?.driveApiBaseUrl?.trim() || 'https://www.googleapis.com/drive/v3',
      scopes: options.google?.scopes?.length ? [...options.google.scopes] : [...DEFAULT_GOOGLE_SCOPES],
      syncIntervalMs: positiveInt(options.google?.syncIntervalMs, DEFAULT_SYNC_INTERVAL_MS),
    },
    mega: {
      commandDirectory:
        options.mega?.commandDirectory?.trim() || process.env.NEARBYTES_MEGACMD_DIR?.trim() || undefined,
      remoteBasePath: normalizeMegaRemotePath(
        options.mega?.remoteBasePath?.trim() || process.env.NEARBYTES_MEGA_REMOTE_BASE?.trim() || '/Nearbytes'
      ),
      syncIntervalMs: positiveInt(options.mega?.syncIntervalMs, DEFAULT_SYNC_INTERVAL_MS),
    },
  };
}

export function resolveMegaCommand(commandDirectory: string | undefined, subcommand: string): string {
  const filename = `mega-${subcommand}`;
  if (!commandDirectory) {
    return filename;
  }
  const normalizedDirectory = commandDirectory.trim().replace(/[\\/]+$/u, '');
  if (normalizedDirectory === '') {
    return filename;
  }
  return `${normalizedDirectory}/${filename}`;
}

class DefaultCommandExecutor implements CommandExecutor {
  async run(invocation: CommandInvocation): Promise<CommandResult> {
    return new Promise<CommandResult>((resolve, reject) => {
      const child = spawn(invocation.command, [...(invocation.args ?? [])], {
        cwd: invocation.cwd,
        env: {
          ...process.env,
          ...normalizeEnv(invocation.env),
        },
        stdio: 'pipe',
      });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let settled = false;
      const timeoutMs = positiveInt(invocation.timeoutMs, 30_000);
      const timer = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        child.kill('SIGKILL');
        reject(new Error(`Command timed out after ${timeoutMs}ms: ${invocation.command}`));
      }, timeoutMs);
      timer.unref?.();

      child.stdout.on('data', (chunk: Buffer | string) => {
        stdoutChunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      });
      child.stderr.on('data', (chunk: Buffer | string) => {
        stderrChunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      });
      child.once('error', (error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
      child.once('close', (exitCode) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve({
          stdout: Buffer.concat(stdoutChunks).toString('utf8'),
          stderr: Buffer.concat(stderrChunks).toString('utf8'),
          exitCode: exitCode ?? 1,
        });
      });

      if (invocation.input) {
        child.stdin.write(invocation.input, 'utf8');
      }
      child.stdin.end();
    });
  }
}

function normalizeEnv(env: Readonly<Record<string, string | undefined>> | undefined): Record<string, string> {
  if (!env) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

function positiveInt(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || (value ?? 0) <= 0) {
    return fallback;
  }
  return Math.trunc(value!);
}

function normalizeMegaRemotePath(value: string): string {
  const trimmed = value.trim();
  if (trimmed === '') {
    return '/Nearbytes';
  }
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}
