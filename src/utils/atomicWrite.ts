import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import path from 'path';

const WINDOWS_RETRYABLE_RENAME_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);

export async function writeFileAtomicallyWithRenameFallback(
  filePath: string,
  contents: string,
  options: {
    readonly retries?: number;
    readonly retryDelayMs?: number;
  } = {}
): Promise<void> {
  const retries = Math.max(0, options.retries ?? 2);
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? 40);
  const tempPath = `${filePath}.${randomUUID()}.tmp`;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(tempPath, contents, 'utf8');

  try {
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        await fs.rename(tempPath, filePath);
        return;
      } catch (error) {
        const code = extractFsErrorCode(error);
        if (!WINDOWS_RETRYABLE_RENAME_CODES.has(code ?? '') || attempt === retries) {
          break;
        }
        await delay(retryDelayMs * (attempt + 1));
      }
    }

    await fs.writeFile(filePath, contents, 'utf8');
  } finally {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
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