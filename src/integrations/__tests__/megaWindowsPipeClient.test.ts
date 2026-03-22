import { EventEmitter } from 'events';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  connect: vi.fn(),
  userInfo: vi.fn(() => ({ username: 'tester' })),
}));

vi.mock('child_process', () => ({
  spawn: mocks.spawn,
}));

vi.mock('net', () => ({
  default: {
    connect: mocks.connect,
  },
}));

vi.mock('os', () => ({
  default: {
    userInfo: mocks.userInfo,
  },
}));

let MegaWindowsNamedPipeCommandClient: typeof import('../megaWindowsPipeClient.js').MegaWindowsNamedPipeCommandClient;

class FakeStream extends EventEmitter {}

class FakeChildProcess extends EventEmitter {
  stdout = new FakeStream();
  stderr = new FakeStream();
  killed = false;

  kill(): boolean {
    this.killed = true;
    this.emit('exit', 0, null);
    return true;
  }
}

class FakeSocket extends EventEmitter {
  destroyed = false;

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.emit('close');
  }

  write(_chunk: Buffer): boolean {
    return true;
  }
}

function createConnectSuccessSocket(onWrite?: () => void, response?: Buffer): FakeSocket {
  const socket = new FakeSocket();
  setTimeout(() => {
    socket.emit('connect');
    if (response) {
      setTimeout(() => {
        socket.emit('data', response);
        socket.emit('end');
      }, 0).unref?.();
    }
  }, 0).unref?.();
  if (onWrite) {
    socket.write = (_chunk: Buffer) => {
      setTimeout(onWrite, 0).unref?.();
      return true;
    };
  }
  return socket;
}

function createConnectErrorSocket(code = 'ENOENT'): FakeSocket {
  const socket = new FakeSocket();
  setTimeout(() => {
    const error = Object.assign(new Error(code), { code });
    socket.emit('error', error);
  }, 0).unref?.();
  return socket;
}

function int32Buffer(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeInt32LE(value, 0);
  return buffer;
}

afterEach(() => {
  mocks.spawn.mockReset();
  mocks.connect.mockReset();
});

beforeAll(async () => {
  ({ MegaWindowsNamedPipeCommandClient } = await import('../megaWindowsPipeClient.js'));
});

afterAll(() => {
  vi.resetModules();
});

describe('MegaWindowsNamedPipeCommandClient', () => {
  it('starts with --skip-lock-check without running stale-daemon cleanup in the hot path', async () => {
    const child = new FakeChildProcess();
    let currentSocket: FakeSocket | null = null;

    mocks.spawn.mockReturnValue(child);
    mocks.connect.mockImplementation((pipePath: string) => {
      if (/13$/u.test(pipePath)) {
        return createConnectSuccessSocket(undefined, Buffer.concat([int32Buffer(0), Buffer.from('OK', 'utf8')]));
      }
      if (mocks.spawn.mock.calls.length === 0) {
        return createConnectErrorSocket();
      }
      currentSocket = createConnectSuccessSocket(() => {
        currentSocket?.emit('data', int32Buffer(13));
      });
      return currentSocket;
    });

    const client = new MegaWindowsNamedPipeCommandClient({
      log() {},
      warn() {},
    });

    const result = await client.execute({
      commandDirectory: 'C:/MEGAcmd',
      subcommand: 'version',
      args: [],
      timeoutMs: 2_000,
    });

    expect(result.exitCode).toBe(0);
    expect(mocks.spawn).toHaveBeenCalledWith(
      'C:/MEGAcmd/MEGAcmdServer.exe',
      ['--skip-lock-check'],
      expect.objectContaining({
        cwd: 'C:/MEGAcmd',
        windowsHide: true,
      })
    );
  });

  it('adopts the daemon when the launcher exits before the pipe becomes available', async () => {
    const logger = {
      log() {},
      warn() {},
    };
    const child = new FakeChildProcess();
    let pipeReady = false;

    mocks.spawn.mockReturnValue(child);
    let currentSocket: FakeSocket | null = null;
    mocks.connect.mockImplementation((pipePath: string) => {
      if (/7$/u.test(pipePath)) {
        return createConnectSuccessSocket(undefined, Buffer.concat([int32Buffer(0), Buffer.from('OK', 'utf8')]));
      }
      if (mocks.spawn.mock.calls.length === 0 || !pipeReady) {
        return createConnectErrorSocket();
      }
      currentSocket = createConnectSuccessSocket(() => {
        currentSocket?.emit('data', int32Buffer(7));
      });
      return currentSocket;
    });

    setTimeout(() => {
      child.emit('exit', 0, null);
      pipeReady = true;
    }, 50).unref?.();

    const client = new MegaWindowsNamedPipeCommandClient(logger);
    const result = await client.execute({
      commandDirectory: 'C:/MEGAcmd',
      subcommand: 'version',
      args: [],
      timeoutMs: 2_000,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('OK');
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
  });

  it('retries transport errors without spawning a replacement for an external daemon', async () => {
    let basePipeConnections = 0;

    mocks.connect.mockImplementation((pipePath: string) => {
      if (/11$/u.test(pipePath)) {
        return createConnectSuccessSocket(undefined, Buffer.concat([int32Buffer(0), Buffer.from('OK', 'utf8')]));
      }

      basePipeConnections += 1;
      if (basePipeConnections === 2) {
        const socket = createConnectSuccessSocket(() => {
          const error = Object.assign(new Error('reset'), { code: 'ECONNRESET' });
          socket.emit('error', error);
        });
        return socket;
      }

      let socket: FakeSocket | null = null;
      socket = createConnectSuccessSocket(() => {
        socket?.emit('data', int32Buffer(11));
      });
      return socket;
    });

    const client = new MegaWindowsNamedPipeCommandClient({
      log() {},
      warn() {},
    });

    const result = await client.execute({
      commandDirectory: 'C:/MEGAcmd',
      subcommand: 'version',
      args: [],
      timeoutMs: 2_000,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('OK');
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(basePipeConnections).toBeGreaterThanOrEqual(4);
  });

  it('serializes concurrent startup so only one daemon is spawned', async () => {
    const child = new FakeChildProcess();
    let currentSocket: FakeSocket | null = null;

    mocks.spawn.mockReturnValue(child);
    mocks.connect.mockImplementation((pipePath: string) => {
      if (/17$/u.test(pipePath)) {
        return createConnectSuccessSocket(undefined, Buffer.concat([int32Buffer(0), Buffer.from('OK', 'utf8')]));
      }
      if (mocks.spawn.mock.calls.length === 0) {
        return createConnectErrorSocket();
      }
      currentSocket = createConnectSuccessSocket(() => {
        currentSocket?.emit('data', int32Buffer(17));
      });
      return currentSocket;
    });

    const client = new MegaWindowsNamedPipeCommandClient({
      log() {},
      warn() {},
    });

    const [first, second] = await Promise.all([
      client.execute({ commandDirectory: 'C:/MEGAcmd', subcommand: 'version', args: [], timeoutMs: 2_000 }),
      client.execute({ commandDirectory: 'C:/MEGAcmd', subcommand: 'version', args: [], timeoutMs: 2_000 }),
    ]);

    expect(first.stdout).toBe('OK');
    expect(second.stdout).toBe('OK');
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
  });
});