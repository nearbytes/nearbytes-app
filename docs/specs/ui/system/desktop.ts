export interface DesktopUpdaterState {
  phase: 'idle' | 'checking' | 'downloading' | 'ready' | 'installing' | 'error';
  version: string;
  message: string;
  detail: string;
  progressPercent: number | null;
  transferredBytes: number;
  totalBytes: number;
  bytesPerSecond: number;
  canInstall: boolean;
  releaseUrl: string;
  assetName: string;
}

export interface DesktopRuntimeLogEntry {
  id: string;
  label: string;
  path: string;
  exists: boolean;
  size: number;
  updatedAt: number | null;
  content: string;
}

export interface DesktopRuntimeLogsResponse {
  generatedAt: number;
  entries: DesktopRuntimeLogEntry[];
}
