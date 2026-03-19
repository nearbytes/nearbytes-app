import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { VolumeWatchHub } from '../volumeWatchHub.js';

describe('VolumeWatchHub', () => {
  const cleanups: string[] = [];

  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((target) => rm(target, { recursive: true, force: true })));
  });

  it('ignores top-level housekeeping folders while reporting channel changes', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'nearbytes-volume-watch-'));
    cleanups.push(root);
    const volumeId = 'a'.repeat(64);
    const hub = new VolumeWatchHub({} as never, root);

    const updates: string[] = [];
    const errors: Error[] = [];
    const subscription = hub.subscribe(
      volumeId,
      (update) => updates.push(update.path),
      (error) => errors.push(error)
    );

    expect(subscription.ready.autoUpdate).toBe(true);
    await delay(200);

    await mkdir(path.join(root, 'Rubbish', '2026-03-19'), { recursive: true });
    await writeFile(path.join(root, 'Rubbish', '2026-03-19', 'ignored.txt'), 'x', 'utf8');
    await mkdir(path.join(root, 'channels', volumeId), { recursive: true });
    await writeFile(path.join(root, 'channels', volumeId, 'event.bin'), 'payload', 'utf8');
    await delay(450);

    subscription.unsubscribe();

    expect(errors).toEqual([]);
    expect(updates.some((value) => value.includes(`channels${path.sep}${volumeId}`))).toBe(true);
    expect(updates.some((value) => value.includes('Rubbish'))).toBe(false);
  });
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}