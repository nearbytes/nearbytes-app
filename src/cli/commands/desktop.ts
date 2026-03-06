import type { Command } from 'commander';
import {
  isDesktopSessionExpired,
  readDesktopSession,
  resolveDesktopSessionPath,
} from '../../desktop/session.js';

interface ApiInfoOptions {
  readonly json?: boolean;
}

export function registerDesktopCommand(program: Command): void {
  const desktop = program
    .command('desktop')
    .description('Desktop runtime integration helpers');

  desktop
    .command('api-info')
    .description('Print local desktop API connection info for trusted local clients')
    .option('--json', 'Print machine-readable JSON')
    .action(async (options: ApiInfoOptions) => {
      const sessionPath = resolveDesktopSessionPath();
      const session = await readDesktopSession(sessionPath);
      if (!session) {
        fail(
          `Desktop session file not found at ${sessionPath}. Start the desktop app first.`,
          options.json
        );
      }
      if (isDesktopSessionExpired(session)) {
        fail(
          'Desktop session is expired. Restart desktop app to issue a fresh API token.',
          options.json
        );
      }
      if (!isPidRunning(session.pid)) {
        fail(
          'Desktop session points to a non-running process. Restart desktop app to refresh session.',
          options.json
        );
      }

      const payload = {
        apiBaseUrl: `http://127.0.0.1:${session.port}`,
        port: session.port,
        token: session.token,
        expiresAt: session.expiresAt,
        pid: session.pid,
        sessionPath,
      };
      if (options.json) {
        console.log(JSON.stringify(payload));
        return;
      }

      console.log(`API Base URL: ${payload.apiBaseUrl}`);
      console.log(`Token: ${payload.token}`);
      console.log(`Expires At: ${new Date(payload.expiresAt).toISOString()}`);
      console.log(`Desktop PID: ${payload.pid}`);
      console.log(`Session File: ${payload.sessionPath}`);
    });
}

function isPidRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? (error as { code?: string }).code
        : undefined;
    if (code === 'ESRCH') {
      return false;
    }
    return true;
  }
}

function fail(message: string, asJson: boolean | undefined): never {
  if (asJson) {
    console.log(JSON.stringify({ error: message }));
  } else {
    console.error(message);
  }
  process.exit(1);
}

