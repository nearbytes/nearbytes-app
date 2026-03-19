import * as fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeFileAtomicallyWithRenameFallback } from '../atomicWrite.js';

describe('writeFileAtomicallyWithRenameFallback', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(tempDirs.splice(0).map((target) => fs.rm(target, { recursive: true, force: true })));
  });

  it('falls back to an in-place overwrite when Windows blocks the final rename', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nearbytes-atomic-write-'));
    tempDirs.push(tempDir);
    const targetPath = path.join(tempDir, 'ui-state.json');
    await fs.writeFile(targetPath, '{"old":true}\n', 'utf8');

    const originalRename = fs.rename;
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (String(to) === targetPath) {
        const error = new Error(`EPERM: operation not permitted, rename '${from}' -> '${to}'`) as NodeJS.ErrnoException;
        error.code = 'EPERM';
        throw error;
      }
      return originalRename(from, to);
    });

    await writeFileAtomicallyWithRenameFallback(targetPath, '{"next":true}\n', { retries: 0 });

    expect(await fs.readFile(targetPath, 'utf8')).toBe('{"next":true}\n');
  });
});