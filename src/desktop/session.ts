import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { z } from 'zod';

const SESSION_SCHEMA_VERSION = 1 as const;

const desktopSessionSchema = z.object({
  version: z.literal(SESSION_SCHEMA_VERSION),
  pid: z.number().int().positive(),
  port: z.number().int().min(1).max(65535),
  token: z.string().min(1),
  expiresAt: z.number().int().positive(),
  createdAt: z.number().int().positive(),
});

export type DesktopSession = z.infer<typeof desktopSessionSchema>;

export function resolveDesktopSessionPath(customPath?: string): string {
  const envPath = customPath ?? process.env.NEARBYTES_DESKTOP_SESSION_FILE;
  if (envPath && envPath.trim().length > 0) {
    return path.resolve(envPath);
  }
  return path.join(os.homedir(), '.nearbytes', 'desktop-session.json');
}

export async function readDesktopSession(customPath?: string): Promise<DesktopSession | null> {
  const sessionPath = resolveDesktopSessionPath(customPath);
  try {
    const raw = await fs.readFile(sessionPath, 'utf8');
    const parsed = desktopSessionSchema.parse(JSON.parse(raw));
    return parsed;
  } catch {
    return null;
  }
}

export async function writeDesktopSession(session: DesktopSession, customPath?: string): Promise<string> {
  const sessionPath = resolveDesktopSessionPath(customPath);
  const validated = desktopSessionSchema.parse(session);
  const dir = path.dirname(sessionPath);
  await fs.mkdir(dir, { recursive: true });

  const tempPath = `${sessionPath}.${process.pid}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(validated, null, 2)}\n`, 'utf8');
  await fs.chmod(tempPath, 0o600);
  await fs.rename(tempPath, sessionPath);
  await fs.chmod(sessionPath, 0o600);
  return sessionPath;
}

export async function clearDesktopSession(customPath?: string): Promise<void> {
  const sessionPath = resolveDesktopSessionPath(customPath);
  try {
    await fs.unlink(sessionPath);
  } catch (error) {
    if (!isFileNotFound(error)) {
      throw error;
    }
  }
}

export function isDesktopSessionExpired(session: DesktopSession, now = Date.now()): boolean {
  return session.expiresAt <= now;
}

function isFileNotFound(error: unknown): boolean {
  return (
    !!error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: string }).code === 'ENOENT'
  );
}

