import process from 'process';
import {
  runCommandInvocation,
  type CommandInvocation,
  type CommandResult,
} from '../src/integrations/runtime.js';

interface CommandWorkerRunRequest {
  readonly type: 'run';
  readonly id: string;
  readonly invocation: CommandInvocation;
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

const parentPort = process.parentPort;

if (!parentPort) {
  throw new Error('Nearbytes desktop command worker requires process.parentPort.');
}

parentPort.on('message', (event) => {
  const request = event.data as CommandWorkerRunRequest | undefined;
  if (!request || request.type !== 'run' || typeof request.id !== 'string' || !request.invocation?.command) {
    return;
  }
  void handleRunRequest(request);
});

async function handleRunRequest(request: CommandWorkerRunRequest): Promise<void> {
  try {
    const result = await runCommandInvocation(request.invocation);
    const response: CommandWorkerResultMessage = {
      type: 'result',
      id: request.id,
      result,
    };
    parentPort.postMessage(response);
  } catch (error) {
    const response: CommandWorkerErrorMessage = {
      type: 'error',
      id: request.id,
      error: serializeError(error),
    };
    parentPort.postMessage(response);
  }
}

function serializeError(error: unknown): SerializedCommandError {
  if (!error || typeof error !== 'object') {
    return {
      message: String(error),
    };
  }
  const value = error as Error & {
    code?: string;
    errno?: number;
    syscall?: string;
    path?: string;
    spawnargs?: readonly string[];
  };
  return {
    name: value.name,
    message: value.message,
    code: value.code,
    errno: value.errno,
    syscall: value.syscall,
    path: value.path,
    spawnargs: value.spawnargs,
    stack: value.stack,
  };
}