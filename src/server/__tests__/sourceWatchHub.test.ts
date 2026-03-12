import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { SourceWatchHub } from '../sourceWatchHub.js';

describe('SourceWatchHub', () => {
  const cleanups: string[] = [];

  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((target) => rm(target, { recursive: true, force: true })));
  });

  it('emits one rescan update for a burst of filesystem changes', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'nearbytes-source-watch-'));
    cleanups.push(root);

    const hub = new SourceWatchHub({
      debounceMs: 120,
      watchDepth: 4,
      rootsResolver: async () => [{ provider: 'dropbox', path: root }],
    });

    const updates: Array<{ changedPaths: string[] }> = [];
    const errors: Error[] = [];
    const subscription = await hub.subscribe(
      (update) => updates.push({ changedPaths: update.changedPaths }),
      (error) => errors.push(error)
    );

    expect(subscription.ready.autoUpdate).toBe(true);
    await delay(200);

    await mkdir(path.join(root, 'share-a'), { recursive: true });
    await writeFile(path.join(root, 'share-a', 'Nearbytes.html'), '<html></html>\n', 'utf8');
    await writeFile(path.join(root, 'share-a', 'touch.txt'), '1', 'utf8');
    await delay(450);

    subscription.unsubscribe();

    expect(errors).toEqual([]);
    expect(updates.length).toBeGreaterThanOrEqual(1);
    expect(
      updates.some((update) => update.changedPaths.some((value) => value.includes('share-a')))
    ).toBe(true);
  });

  it('reports unsupported mode when no local scan roots are available', async () => {
    const hub = new SourceWatchHub({
      rootsResolver: async () => [],
    });

    const subscription = await hub.subscribe(() => {
      throw new Error('should not receive updates');
    }, () => {
      throw new Error('should not receive errors');
    });

    expect(subscription.ready.autoUpdate).toBe(false);
    expect(subscription.ready.mode).toBe('none');
    subscription.unsubscribe();
  });
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
