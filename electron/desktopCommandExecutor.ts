import { randomUUID } from 'crypto';
import { existsSync } from 'fs';
import path from 'path';
import { app, utilityProcess, type UtilityProcess } from 'electron';
import type {
  CommandExecutor,
  CommandInvocation,
  CommandResult,
  IntegrationLogger,
} from '../src/integrations/runtime.js';

interface CommandWorkerRunRequest {
  readonly type: 'run';
  readonly id: string;
  readonly invocation: SerializableCommandInvocation;
}

interface CommandWorkerResultMessage {
  readonly type: 'result';
  readonly id: string;
  readonly result: CommandResult;
}

interface SerializedCommandError {
  readonly name?: string;
  readonly message?: string;
  readonly code?: string;
  readonly errno?: number;
  readonly syscall?: string;
  readonly path?: string;
  readonly spawnargs?: readonly string[];
  readonly stack?: string;
}

interface CommandWorkerErrorMessage {
  readonly type: 'error';
  readonly id: string;
  readonly error: SerializedCommandError;
}

type CommandWorkerMessage = CommandWorkerResultMessage | CommandWorkerErrorMessage;

interface SerializableCommandInvocation {
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly input?: string;
  readonly timeoutMs?: number;
}

interface PendingRequest {
  readonly resolve: (value: CommandResult) => void;
  readonly reject: (reason: unknown) => void;
}

export interface DisposableCommandExecutor extends CommandExecutor {
  dispose(): void;
}

export function createDesktopCommandExecutor(logger: IntegrationLogger): DisposableCommandExecutor {
  return new DesktopCommandExecutor(logger);
}

class DesktopCommandExecutor implements DisposableCommandExecutor {
  private worker: UtilityProcess | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private disposed = false;

  constructor(private readonly logger: IntegrationLogger) {}

  async run(invocation: CommandInvocation): Promise<CommandResult> {
    if (this.disposed) {
      throw new Error('Nearbytes desktop command executor is disposed.');
    }
    const worker = this.ensureWorker();
    const id = randomUUID();
    const request: CommandWorkerRunRequest = {
      type: 'run',
      id,
      invocation: toSerializableInvocation(invocation),
    };
    return new Promise<CommandResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage(request);
    });
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.failPending(new Error('Nearbytes desktop command executor is shutting down.'));
    const worker = this.worker;
    this.worker = null;
    worker?.kill();
  }

  private ensureWorker(): UtilityProcess {
    if (this.worker) {
      return this.worker;
    }
    const workerPath = resolveDesktopCommandWorkerPath();
    if (!workerPath) {
      throw new Error('Could not locate the Nearbytes desktop command worker. Run `yarn build` first.');
    }

    const worker = utilityProcess.fork(workerPath, [], {
      serviceName: 'nearbytes-command-executor',
    });
    worker.on('message', (message) => {
      this.handleWorkerMessage(message as CommandWorkerMessage);
    });
    worker.on('spawn', () => {
      this.logger.log(`[desktop-command-executor] worker spawned (pid=${worker.pid ?? 'unknown'})`);
    });
    worker.on('exit', (code) => {
      if (this.worker === worker) {
        this.worker = null;
      }
      this.failPending(new Error(`Nearbytes desktop command worker exited with code ${code}.`));
    });
    worker.on('error', (type, location, report) => {
      this.logger.warn(
        `[desktop-command-executor] worker fatal error (${type}) at ${location}.`,
        report
      );
    });
    worker.stderr?.on('data', (chunk: Buffer | string) => {
      const value = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      const trimmed = value.trim();
      if (trimmed) {
        this.logger.warn(`[desktop-command-worker] ${trimmed}`);
      }
    });
    this.worker = worker;
    return worker;
  }

  private handleWorkerMessage(message: CommandWorkerMessage): void {
    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }
    this.pending.delete(message.id);
    if (message.type === 'result') {
      pending.resolve(message.result);
      return;
    }
    pending.reject(fromSerializedError(message.error));
  }

  private failPending(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}

function toSerializableInvocation(invocation: CommandInvocation): SerializableCommandInvocation {
  return {
    command: invocation.command,
    args: invocation.args ? [...invocation.args] : undefined,
    cwd: invocation.cwd,
    env: invocation.env ? normalizeSerializableEnv(invocation.env) : undefined,
    input: invocation.input,
    timeoutMs: invocation.timeoutMs,
  };
}

function normalizeSerializableEnv(env: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) {
      normalized[key] = value;
    }
  }
  return normalized;
}

function fromSerializedError(error: SerializedCommandError): Error {
  const restored = new Error(error.message ?? 'Command execution failed.');
  restored.name = error.name ?? restored.name;
  if (error.stack) {
    restored.stack = error.stack;
  }
  Object.assign(restored, {
    code: error.code,
    errno: error.errno,
    syscall: error.syscall,
    path: error.path,
    spawnargs: error.spawnargs,
  });
  return restored;
}

function resolveDesktopCommandWorkerPath(): string | null {
  const candidates = [
    path.join(app.getAppPath(), 'dist-electron', 'electron', 'commandWorker.js'),
    path.join(process.resourcesPath, 'app.asar.unpacked', 'dist-electron', 'electron', 'commandWorker.js'),
    path.join(process.cwd(), 'dist-electron', 'electron', 'commandWorker.js'),
  ];
  for (const candidate of candidates) {
    if (path.isAbsolute(candidate) && existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}