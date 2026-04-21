import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { describe, expect, it } from 'vitest';
import { loadMegaLiveEnv } from '../mega/liveTestEnv.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, '../../..');

async function runCommand(command: string, args: string[], timeoutMs: number): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: workspaceRoot,
      env: process.env,
      stdio: 'inherit',
    });

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Command timed out after ${timeoutMs}ms: ${command} ${args.join(' ')}`));
    }, timeoutMs);

    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      if (signal) {
        reject(new Error(`Command exited via signal ${signal}: ${command} ${args.join(' ')}`));
        return;
      }
      resolve(code ?? 1);
    });
  });
}

describe('MegaTransportAdapter live MEGA flow (no mocks)', () => {
  it(
    'runs the readonly MEGA end-to-end script over real network connections',
    async () => {
      loadMegaLiveEnv([
        'NEARBYTES_E2E_MEGA_OWNER_EMAIL',
        'NEARBYTES_E2E_MEGA_RECIPIENT_EMAIL',
        'NEARBYTES_E2E_MEGA_PASSWORD',
      ]);
      const exitCode = await runCommand('node', ['scripts/e2e-mega-readonly-share.mjs'], 12 * 60_000);
      expect(exitCode).toBe(0);
    },
    13 * 60_000
  );
});
