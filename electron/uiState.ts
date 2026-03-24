import { app } from 'electron';
import { promises as fs } from 'fs';
import { readFile } from 'fs/promises';
import path from 'path';
import { writeFileAtomicallyWithRenameFallback } from '../src/utils/atomicWrite.js';

export interface DesktopUiState {
  readonly volumeMounts?: unknown;
  readonly sourceDiscovery?: unknown;
  readonly dismissedRootSuggestions?: unknown;
  readonly theme?: unknown;
}

const UI_STATE_FILENAME = 'ui-state.json';

export function resolveDesktopUiStatePath(): string {
  return path.join(app.getPath('userData'), UI_STATE_FILENAME);
}

export async function readDesktopUiState(): Promise<DesktopUiState> {
  try {
    const raw = await readFile(resolveDesktopUiStatePath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    return {
      volumeMounts: (parsed as DesktopUiState).volumeMounts,
      sourceDiscovery: (parsed as DesktopUiState).sourceDiscovery,
      dismissedRootSuggestions: (parsed as DesktopUiState).dismissedRootSuggestions,
      theme: (parsed as DesktopUiState).theme,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return {};
    }
    console.warn('Failed to read desktop UI state:', error);
    return {};
  }
}

export async function writeDesktopUiState(nextState: DesktopUiState): Promise<void> {
  const currentState = await readDesktopUiState();
  const mergedState: DesktopUiState = {
    ...currentState,
    ...nextState,
  };
  const filePath = resolveDesktopUiStatePath();
  await writeFileAtomicallyWithRenameFallback(filePath, JSON.stringify(mergedState, null, 2));
}

export async function clearDesktopUiState(): Promise<void> {
  try {
    await fs.rm(resolveDesktopUiStatePath(), { force: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      throw error;
    }
  }
}
