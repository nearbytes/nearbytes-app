import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import type { TransportAdapter } from '../../integrations/adapters.js';
import { startApiRuntime } from '../runtime.js';

class DisposableAdapter implements TransportAdapter {
  readonly provider = 'mega';
  readonly label = 'MEGA';
  readonly description = 'Disposable test adapter';
  readonly supportsAccountConnection = true;
  disposeCalls = 0;

  async dispose(): Promise<void> {
    this.disposeCalls += 1;
  }

  async probe(): Promise<{ status: 'ready'; detail: string; badges: string[] }> {
    return {
      status: 'ready',
      detail: 'ready',
      badges: ['Test'],
    };
  }
}

const tempDirs: string[] = [];

describe('startApiRuntime', () => {
  afterAll(async () => {
    await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it('disposes managed share adapters when the runtime stops', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nearbytes-runtime-stop-'));
    tempDirs.push(tempDir);
    const storageDir = path.join(tempDir, 'storage');
    const rootsConfigPath = path.join(tempDir, 'roots.json');
    await fs.mkdir(storageDir, { recursive: true });
    const adapter = new DisposableAdapter();

    const runtime = await startApiRuntime({
      host: '127.0.0.1',
      port: 0,
      defaultStorageDir: storageDir,
      rootsConfigPath,
      integrationOptions: {
        adapters: [adapter],
      },
    });

    await runtime.stop();

    expect(adapter.disposeCalls).toBe(1);
  });
});