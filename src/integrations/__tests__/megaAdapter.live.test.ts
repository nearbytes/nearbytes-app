import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import { spawn } from 'child_process';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, '../../..');
const envE2ePath = path.join(workspaceRoot, '.env.e2e');

function ensureLiveMegaEnv(): void {
  if (existsSync(envE2ePath)) {
    for (const rawLine of readFileSync(envE2ePath, 'utf8').split(/\r?\n/u)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) {
        continue;
      }
      const eq = line.indexOf('=');
      if (eq <= 0) {
        continue;
      }
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }

  const required = [
    'NEARBYTES_E2E_MEGA_OWNER_EMAIL',
    'NEARBYTES_E2E_MEGA_RECIPIENT_EMAIL',
    'NEARBYTES_E2E_MEGA_PASSWORD',
  ] as const;

  const missing = required.filter((name) => !process.env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(
      `Missing live MEGA credentials: ${missing.join(', ')}. Add them to .env.e2e or the shell environment before running this suite.`
    );
  }
}

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
      ensureLiveMegaEnv();
      const exitCode = await runCommand('node', ['scripts/e2e-mega-readonly-share.mjs'], 12 * 60_000);
      expect(exitCode).toBe(0);
    },
    13 * 60_000
  );
});
