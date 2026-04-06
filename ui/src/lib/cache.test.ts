import { afterEach, describe, expect, it } from 'vitest';

import { clearCache, getCachedFiles, getCacheTimestamp, setCachedFiles } from './cache.js';
import { resetBrowserMirrorForTests } from './mirror/browserMirror.js';

describe('cache compatibility wrapper', () => {
  afterEach(async () => {
    resetBrowserMirrorForTests();
    await clearCache();
  });

  it('persists cached files through the browser mirror volume snapshots', async () => {
    await setCachedFiles('vol-1', [{ filename: 'alpha.txt', blobHash: 'h1', size: 3, createdAt: 1 }]);

    await expect(getCachedFiles('vol-1')).resolves.toEqual([
      { filename: 'alpha.txt', blobHash: 'h1', size: 3, createdAt: 1 },
    ]);
    await expect(getCacheTimestamp('vol-1')).resolves.not.toBeNull();
  });

  it('clears cached files through the same mirror-backed volume store', async () => {
    await setCachedFiles('vol-2', [{ filename: 'beta.txt', blobHash: 'h2', size: 5, createdAt: 2 }]);

    await clearCache();

    await expect(getCachedFiles('vol-2')).resolves.toBeNull();
  });
});