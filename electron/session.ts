import {
  clearDesktopSession,
  resolveDesktopSessionPath,
  writeDesktopSession,
  type DesktopSession,
} from '../src/desktop/session.js';

export async function publishDesktopSession(session: DesktopSession): Promise<string> {
  return writeDesktopSession(session, resolveDesktopSessionPath());
}

export async function clearPublishedDesktopSession(): Promise<void> {
  await clearDesktopSession(resolveDesktopSessionPath());
}

