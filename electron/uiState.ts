import { app } from 'electron';
import { mkdir, readFile, rename, writeFile } from 'fs/promises';
import path from 'path';

export interface DesktopUiState {
  readonly volumeMounts?: unknown;
  readonly sourceDiscovery?: unknown;
  readonly dismissedRootSuggestions?: unknown;
}

const UI_STATE_FILENAME = 'ui-state.json';

function uiStatePath(): string {
  return path.join(app.getPath('userData'), UI_STATE_FILENAME);
}

export async function readDesktopUiState(): Promise<DesktopUiState> {
  try {
    const raw = await readFile(uiStatePath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    return {
      volumeMounts: (parsed as DesktopUiState).volumeMounts,
      sourceDiscovery: (parsed as DesktopUiState).sourceDiscovery,
      dismissedRootSuggestions: (parsed as DesktopUiState).dismissedRootSuggestions,
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
  const filePath = uiStatePath();
  const tempPath = `${filePath}.tmp`;
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(tempPath, JSON.stringify(mergedState, null, 2), 'utf8');
  await rename(tempPath, filePath);
}
