import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, '../../..');
const envE2ePath = path.join(workspaceRoot, '.env.e2e');

export function loadMegaLiveEnv(required: readonly string[]): void {
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

  const missing = required.filter((name) => !process.env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(
      `Missing live MEGA credentials: ${missing.join(', ')}. Add them to .env.e2e or the shell environment before running this suite.`
    );
  }
}
