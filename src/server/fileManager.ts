import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import { dirname, resolve } from 'path';
import { ApiError } from './errors.js';

export interface FileManagerLaunchPlan {
  command: string;
  args: string[];
  windowsVerbatimArguments?: boolean;
}

type TargetKind = 'file' | 'directory';

export function buildFileManagerLaunchPlan(
  targetPath: string,
  fallbackDirectory: string,
  targetKind: TargetKind,
  platform: NodeJS.Platform = process.platform
): FileManagerLaunchPlan {
  if (platform === 'darwin') {
    return targetKind === 'file'
      ? { command: 'open', args: ['-R', targetPath] }
      : { command: 'open', args: [fallbackDirectory] };
  }

  if (platform === 'win32') {
    return targetKind === 'file'
      ? {
          command: 'explorer.exe',
          args: ['/select,', targetPath],
        }
      : {
          command: 'explorer.exe',
          args: [fallbackDirectory],
        };
  }

  return { command: 'xdg-open', args: [fallbackDirectory] };
}

export async function openInFileManager(targetPath: string): Promise<void> {
  const resolvedTargetPath = resolve(targetPath);
  const existingStat = await fs.stat(resolvedTargetPath).catch(() => null);
  const fallbackDirectory = existingStat
    ? existingStat.isDirectory()
      ? resolvedTargetPath
      : dirname(resolvedTargetPath)
    : await findNearestExistingDirectory(resolvedTargetPath);

  if (!fallbackDirectory) {
    throw new ApiError(404, 'NOT_FOUND', 'Target path does not exist and no parent directory could be opened.');
  }

  const launchPlan = buildFileManagerLaunchPlan(
    resolvedTargetPath,
    fallbackDirectory,
    existingStat?.isDirectory() ? 'directory' : 'file'
  );

  await new Promise<void>((resolveLaunch, rejectLaunch) => {
    const child = spawn(launchPlan.command, launchPlan.args, {
      stdio: 'ignore',
      detached: true,
      windowsVerbatimArguments: launchPlan.windowsVerbatimArguments ?? false,
    });

    child.once('error', (error) => rejectLaunch(error));
    child.once('spawn', () => {
      child.unref();
      resolveLaunch();
    });
  }).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    throw new ApiError(500, 'INTERNAL_ERROR', `Failed to open file manager: ${message}`);
  });
}

async function findNearestExistingDirectory(targetPath: string): Promise<string | null> {
  let current = resolve(targetPath);

  while (true) {
    const stat = await fs.stat(current).catch(() => null);
    if (stat) {
      return stat.isDirectory() ? current : dirname(current);
    }
    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}