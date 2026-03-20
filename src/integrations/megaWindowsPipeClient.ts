import { spawn, type ChildProcess } from 'child_process';
import { createHash } from 'crypto';
import net from 'net';
import os from 'os';
import path from 'path';
import type { CommandResult, IntegrationLogger } from './runtime.js';

const MCMD_REQCONFIRM = -60;
const MCMD_REQSTRING = -61;
const MCMD_PARTIALOUT = -62;
const MCMD_PARTIALERR = -63;

interface MegaWindowsCommandRequest {
  readonly commandDirectory?: string;
  readonly subcommand: string;
  readonly args: readonly string[];
  readonly timeoutMs: number;
}

interface ManagedMegaServer {
  readonly key: string;
  readonly commandDirectory?: string;
  readonly pipeSuffix: string;
  readonly child: ChildProcess | null;
  startPromise: Promise<void>;
  ready: boolean;
  exited: boolean;
}

export interface MegaWindowsCommandClient {
  execute(request: MegaWindowsCommandRequest): Promise<CommandResult>;
}

export class MegaWindowsNamedPipeCommandClient implements MegaWindowsCommandClient {
  private readonly servers = new Map<string, ManagedMegaServer>();
  private readonly username = resolveWindowsMegaUsername();

  constructor(private readonly logger: IntegrationLogger) {}

  async execute(request: MegaWindowsCommandRequest): Promise<CommandResult> {
    const key = normalizeMegaServerKey(request.commandDirectory);
    let server = await this.ensureServer(key, request.commandDirectory);
    try {
      return await this.executeOnce(server, request);
    } catch (error) {
      this.logger.warn('Retrying MEGAcmd Windows pipe command after transport failure.', error);
      server = await this.restartServer(key, request.commandDirectory);
      return this.executeOnce(server, request);
    }
  }

  private async ensureServer(key: string, commandDirectory?: string): Promise<ManagedMegaServer> {
    const existing = this.servers.get(key);
    if (existing && !existing.exited) {
      await existing.startPromise;
      return existing;
    }
    return this.startServer(key, commandDirectory);
  }

  private async restartServer(key: string, commandDirectory?: string): Promise<ManagedMegaServer> {
    const existing = this.servers.get(key);
    if (existing) {
      this.killServer(existing);
      this.servers.delete(key);
    }
    return this.startServer(key, commandDirectory);
  }

  private async startServer(key: string, commandDirectory?: string): Promise<ManagedMegaServer> {
    const pipeSuffix = createStablePipeSuffix(key);
    const pipeName = resolveMegaPipeName(this.username, pipeSuffix);
    if (await canConnectToPipe(pipeName, 500)) {
      const existingServer: ManagedMegaServer = {
        key,
        commandDirectory,
        pipeSuffix,
        child: null,
        ready: true,
        exited: false,
        startPromise: Promise.resolve(),
      };
      this.servers.set(key, existingServer);
      return existingServer;
    }

    const serverCommand = resolveMegaServerCommand(commandDirectory);
    const env = buildMegaServerEnvironment(commandDirectory, pipeSuffix);
    const child = spawn(serverCommand, [], {
      cwd: commandDirectory || undefined,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const server: ManagedMegaServer = {
      key,
      commandDirectory,
      pipeSuffix,
      child,
      ready: false,
      exited: false,
      startPromise: Promise.resolve(),
    };

    server.startPromise = new Promise<void>((resolve, reject) => {
      let settled = false;
      const startDeadline = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        server.ready = true;
        resolve();
      }, 2_000);
      startDeadline.unref?.();

      const finishReady = () => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(startDeadline);
        server.ready = true;
        resolve();
      };

      const finishError = (error: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(startDeadline);
        reject(error);
      };

      child.stdout?.on('data', (chunk: Buffer | string) => {
        const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        if (/Listening to petitions/i.test(text)) {
          finishReady();
        }
      });

      child.stderr?.on('data', (chunk: Buffer | string) => {
        const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8').trim();
        if (text) {
          this.logger.warn(`[MEGAcmdServer] ${text}`);
        }
      });

      child.once('error', (error) => {
        server.exited = true;
        this.servers.delete(key);
        finishError(error instanceof Error ? error : new Error(String(error)));
      });

      child.once('exit', (code, signal) => {
        server.exited = true;
        server.ready = false;
        this.servers.delete(key);
        if (!settled) {
          finishError(
            new Error(`MEGAcmdServer exited before becoming ready (code=${code ?? 'null'}, signal=${signal ?? 'null'}).`)
          );
          return;
        }
        const detail = `MEGAcmdServer exited (code=${code ?? 'null'}, signal=${signal ?? 'null'}).`;
        this.logger.warn(detail);
      });
    });

    this.servers.set(key, server);
    await server.startPromise;
    return server;
  }

  private async executeOnce(server: ManagedMegaServer, request: MegaWindowsCommandRequest): Promise<CommandResult> {
    const pipeName = resolveMegaPipeName(this.username, server.pipeSuffix);
    const command = buildMegaCommandLine(request.subcommand, request.args);
    const generalSocket = await connectToPipe(pipeName, request.timeoutMs);
    const generalReader = new SocketReader(generalSocket);
    try {
      generalSocket.write(Buffer.from(command, 'utf16le'));
      const responsePipeId = await generalReader.readInt32(request.timeoutMs);
      generalSocket.destroy();

      const responseSocket = await connectToPipe(`${pipeName}${responsePipeId}`, request.timeoutMs);
      const responseReader = new SocketReader(responseSocket);
      try {
        let exitCode = await responseReader.readInt32(request.timeoutMs);
        let stdout = '';
        let stderr = '';

        while (exitCode === MCMD_PARTIALOUT || exitCode === MCMD_PARTIALERR) {
          const byteLength = process.arch === 'ia32' ? 4 : 8;
          const chunkSize = await responseReader.readUnsignedInteger(byteLength, request.timeoutMs);
          const chunk = await responseReader.readExactly(chunkSize, request.timeoutMs);
          if (exitCode === MCMD_PARTIALERR) {
            stderr += chunk.toString('utf8');
          } else {
            stdout += chunk.toString('utf8');
          }
          exitCode = await responseReader.readInt32(request.timeoutMs);
        }

        if (exitCode === MCMD_REQCONFIRM || exitCode === MCMD_REQSTRING) {
          throw new Error(`MEGAcmd requested interactive input for "${request.subcommand}", which Nearbytes cannot provide.`);
        }

        stdout += (await responseReader.readToEnd(request.timeoutMs)).toString('utf8');
        return {
          stdout,
          stderr,
          exitCode,
        };
      } finally {
        responseSocket.destroy();
      }
    } finally {
      generalSocket.destroy();
    }
  }

  private killServer(server: ManagedMegaServer): void {
    if (server.exited) {
      return;
    }
    try {
      server.child?.kill();
    } catch {
      // Ignore shutdown failures; we only need a best-effort restart.
    }
    server.exited = true;
    server.ready = false;
  }
}

class SocketReader {
  private readonly buffers: Buffer[] = [];
  private bufferedBytes = 0;
  private ended = false;
  private error: Error | null = null;
  private waiter: (() => void) | null = null;

  constructor(socket: net.Socket) {
    socket.on('data', (chunk: Buffer | string) => {
      const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      this.buffers.push(buffer);
      this.bufferedBytes += buffer.length;
      this.wake();
    });
    socket.once('end', () => {
      this.ended = true;
      this.wake();
    });
    socket.once('close', () => {
      this.ended = true;
      this.wake();
    });
    socket.once('error', (error) => {
      this.error = error instanceof Error ? error : new Error(String(error));
      this.wake();
    });
  }

  async readInt32(timeoutMs: number): Promise<number> {
    const buffer = await this.readExactly(4, timeoutMs);
    return buffer.readInt32LE(0);
  }

  async readUnsignedInteger(byteLength: number, timeoutMs: number): Promise<number> {
    const buffer = await this.readExactly(byteLength, timeoutMs);
    if (byteLength === 4) {
      return buffer.readUInt32LE(0);
    }
    const parsed = Number(buffer.readBigUInt64LE(0));
    if (!Number.isSafeInteger(parsed)) {
      throw new Error('MEGAcmd returned a chunk size that exceeds JavaScript safe integer limits.');
    }
    return parsed;
  }

  async readExactly(length: number, timeoutMs: number): Promise<Buffer> {
    await this.waitFor(() => this.bufferedBytes >= length || this.ended || Boolean(this.error), timeoutMs);
    if (this.bufferedBytes >= length) {
      return this.consume(length);
    }
    if (this.error) {
      throw this.error;
    }
    throw new Error(`MEGAcmd pipe closed before reading ${length} bytes.`);
  }

  async readToEnd(timeoutMs: number): Promise<Buffer> {
    await this.waitFor(() => this.ended || Boolean(this.error), timeoutMs);
    if (!this.error) {
      return this.consume(this.bufferedBytes);
    }
    if (this.bufferedBytes > 0 || isIgnorablePipeTerminationError(this.error)) {
      return this.consume(this.bufferedBytes);
    }
    if (this.error) {
      throw this.error;
    }
    return this.consume(this.bufferedBytes);
  }

  private async waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
    if (predicate()) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiter = null;
        reject(new Error(`MEGAcmd pipe timed out after ${timeoutMs}ms.`));
      }, timeoutMs);
      timer.unref?.();

      this.waiter = () => {
        if (!predicate()) {
          return;
        }
        clearTimeout(timer);
        this.waiter = null;
        resolve();
      };
    });
  }

  private consume(length: number): Buffer {
    const chunks: Buffer[] = [];
    let remaining = length;
    while (remaining > 0 && this.buffers.length > 0) {
      const current = this.buffers[0]!;
      if (current.length <= remaining) {
        chunks.push(current);
        this.buffers.shift();
        this.bufferedBytes -= current.length;
        remaining -= current.length;
        continue;
      }
      chunks.push(current.subarray(0, remaining));
      this.buffers[0] = current.subarray(remaining);
      this.bufferedBytes -= remaining;
      remaining = 0;
    }
    return Buffer.concat(chunks, length);
  }

  private wake(): void {
    this.waiter?.();
  }
}

async function connectToPipe(pipePath: string, timeoutMs: number): Promise<net.Socket> {
  const startedAt = Date.now();
  let lastError: Error | null = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      return await connectToPipeOnce(pipePath, Math.max(250, Math.min(1_000, timeoutMs - (Date.now() - startedAt))));
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      await delay(100);
    }
  }
  throw new Error(`Timed out connecting to MEGAcmd pipe ${pipePath}: ${lastError?.message ?? 'unknown error'}`);
}

async function canConnectToPipe(pipePath: string, timeoutMs: number): Promise<boolean> {
  try {
    const socket = await connectToPipe(pipePath, timeoutMs);
    socket.destroy();
    return true;
  } catch {
    return false;
  }
}

async function connectToPipeOnce(pipePath: string, timeoutMs: number): Promise<net.Socket> {
  return new Promise<net.Socket>((resolve, reject) => {
    const socket = net.connect(pipePath);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Timed out connecting to pipe ${pipePath}.`));
    }, timeoutMs);
    timer.unref?.();

    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      socket.destroy();
      reject(error instanceof Error ? error : new Error(String(error)));
    });
  });
}

function resolveMegaServerCommand(commandDirectory: string | undefined): string {
  if (!commandDirectory) {
    return 'MEGAcmdServer.exe';
  }
  const normalized = commandDirectory.trim().replace(/[\\/]+$/u, '');
  return normalized ? `${normalized}/MEGAcmdServer.exe` : 'MEGAcmdServer.exe';
}

function buildMegaServerEnvironment(commandDirectory: string | undefined, pipeSuffix: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }
  if (commandDirectory) {
    env.PATH = `${commandDirectory}${path.delimiter}${process.env.PATH ?? ''}`;
  }
  env.MEGACMD_PIPE_SUFFIX = pipeSuffix;
  env.MEGACMD_WORKING_FOLDER_SUFFIX = pipeSuffix;
  return env;
}

function buildMegaCommandLine(subcommand: string, args: readonly string[]): string {
  return [subcommand, ...args.map(quoteMegaArgument)].join(' ');
}

function quoteMegaArgument(value: string): string {
  if (value === '') {
    return '""';
  }
  if (!/[\s"]/u.test(value)) {
    return value;
  }
  return `"${value.replace(/"/gu, '\\"')}"`;
}

function normalizeMegaServerKey(commandDirectory: string | undefined): string {
  if (!commandDirectory) {
    return 'path';
  }
  return path.resolve(commandDirectory).replace(/\\/g, '/').replace(/\/+$/u, '').toLowerCase();
}

function createStablePipeSuffix(key: string): string {
  return `nearbytes_${createHash('sha1').update(key).digest('hex').slice(0, 12)}`;
}

function resolveMegaPipeName(username: string, pipeSuffix: string): string {
  return `\\\\.\\pipe\\megacmdpipe_${username}_${pipeSuffix}`;
}

function resolveWindowsMegaUsername(): string {
  return os.userInfo().username || process.env.USERNAME?.trim() || 'unknown';
}

function delay(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    timer.unref?.();
  });
}

function isIgnorablePipeTerminationError(error: Error): boolean {
  const withCode = error as Error & { code?: string };
  return withCode.code === 'EPIPE' || withCode.code === 'ECONNRESET';
}
