import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { VolumeWatchHub } from '../volumeWatchHub.js';
import { createSingleSourceMultiRoot } from '../../test/singleSourceMultiRoot.js';

describe('VolumeWatchHub', () => {
  const cleanups: string[] = [];
  const volumeIdA = 'a'.repeat(130);
  const volumeIdB = 'b'.repeat(130);

  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((target) => rm(target, { recursive: true, force: true })));
  });

  it('ignores top-level housekeeping folders while reporting channel changes', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'nearbytes-volume-watch-'));
    cleanups.push(root);
    const volumeId = volumeIdA;
    const hub = new VolumeWatchHub(createSingleSourceMultiRoot(root), root);

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
  await mkdir(path.join(root, 'blocks'), { recursive: true });
  await writeFile(path.join(root, 'blocks', 'immutable.bin'), 'ciphertext', 'utf8');
    await mkdir(path.join(root, 'channels', volumeId), { recursive: true });
    await writeFile(path.join(root, 'channels', volumeId, 'event.bin'), 'payload', 'utf8');
    await delay(450);

    subscription.unsubscribe();

    const watchedVolumePath = normalizeWatchPath(path.join(root, 'channels', volumeId));
    expect(errors).toEqual([]);
    expect(updates).toContain(watchedVolumePath);
    expect(updates.some((value) => value.includes('/rubbish'))).toBe(false);
    expect(updates.some((value) => value.includes('/blocks/'))).toBe(false);
  });

  it('reports creation of the watched channel directory itself', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'nearbytes-volume-watch-'));
    cleanups.push(root);
    const volumeId = volumeIdB;
    const hub = new VolumeWatchHub(createSingleSourceMultiRoot(root), root);

    const updates: string[] = [];
    const errors: Error[] = [];
    const subscription = hub.subscribe(
      volumeId,
      (update) => updates.push(update.path),
      (error) => errors.push(error)
    );

    expect(subscription.ready.autoUpdate).toBe(true);
    await delay(200);

    await mkdir(path.join(root, 'channels', volumeId), { recursive: true });
    await delay(450);

    subscription.unsubscribe();

    const watchedVolumePath = normalizeWatchPath(path.join(root, 'channels', volumeId));
    expect(errors).toEqual([]);
    expect(updates).toContain(watchedVolumePath);
  });
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeWatchPath(value: string): string {
  const normalized = path.resolve(value).replace(/\\/g, '/');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}
