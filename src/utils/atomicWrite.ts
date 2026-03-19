import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import path from 'path';

const WINDOWS_RETRYABLE_RENAME_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);

interface AtomicWriteOps {
  mkdir(dirPath: string, options: { recursive: true }): Promise<unknown>;
  writeFile(filePath: string, contents: string, encoding: 'utf8'): Promise<unknown>;
  rename(from: string, to: string): Promise<unknown>;
  rm(targetPath: string, options: { force: true }): Promise<unknown>;
}

export async function writeFileAtomicallyWithRenameFallback(
  filePath: string,
  contents: string,
  options: {
    readonly retries?: number;
    readonly retryDelayMs?: number;
    readonly ops?: AtomicWriteOps;
  } = {}
): Promise<void> {
  const retries = Math.max(0, options.retries ?? 2);
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? 40);
  const ops = options.ops ?? fs;
  const tempPath = `${filePath}.${randomUUID()}.tmp`;
  await ops.mkdir(path.dirname(filePath), { recursive: true });
  await ops.writeFile(tempPath, contents, 'utf8');

  try {
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        await ops.rename(tempPath, filePath);
        return;
      } catch (error) {
        const code = extractFsErrorCode(error);
        if (!WINDOWS_RETRYABLE_RENAME_CODES.has(code ?? '') || attempt === retries) {
          break;
        }
        await delay(retryDelayMs * (attempt + 1));
      }
    }

    await ops.writeFile(filePath, contents, 'utf8');
  } finally {
    await ops.rm(tempPath, { force: true }).catch(() => undefined);
  }
}

function extractFsErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }
  if ('code' in error && typeof (error as { code?: unknown }).code === 'string') {
    return (error as { code: string }).code;
  }
  return undefined;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}