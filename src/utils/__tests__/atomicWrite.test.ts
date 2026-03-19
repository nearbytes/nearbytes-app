import * as fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { writeFileAtomicallyWithRenameFallback } from '../atomicWrite.js';

describe('writeFileAtomicallyWithRenameFallback', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((target) => fs.rm(target, { recursive: true, force: true })));
  });

  it('falls back to an in-place overwrite when Windows blocks the final rename', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nearbytes-atomic-write-'));
    tempDirs.push(tempDir);
    const targetPath = path.join(tempDir, 'ui-state.json');
    await fs.writeFile(targetPath, '{"old":true}\n', 'utf8');

    await writeFileAtomicallyWithRenameFallback(targetPath, '{"next":true}\n', {
      retries: 0,
      ops: {
        mkdir: (dirPath, options) => fs.mkdir(dirPath, options),
        writeFile: (filePath, contents, encoding) => fs.writeFile(filePath, contents, encoding),
        rename: async (from, to) => {
          if (String(to) === targetPath) {
            const error = new Error(`EPERM: operation not permitted, rename '${from}' -> '${to}'`) as NodeJS.ErrnoException;
            error.code = 'EPERM';
            throw error;
          }
          return fs.rename(from, to);
        },
        rm: (filePath, options) => fs.rm(filePath, options),
      },
    });

    expect(await fs.readFile(targetPath, 'utf8')).toBe('{"next":true}\n');
  });
});