import { promises as fs, constants as fsConstants } from 'fs';
import { rootAcceptsChannel, type RootConfigEntry, type RootsConfig } from '../config/roots.js';
import { ensureNearbytesMarker } from '../config/sourceDiscovery.js';
import { StorageError } from '../types/errors.js';
import type { StorageBackend } from '../types/storage.js';
import { FilesystemStorageBackend } from './filesystem.js';

const CHANNEL_PATH_REGEX = /^channels\/([a-f0-9]{64,200})(?:\/|$)/i;
const RESOURCE_EXHAUSTED_CODES = new Set(['ENOSPC', 'EDQUOT']);
const UNAVAILABLE_CODES = new Set(['EACCES', 'EPERM', 'EROFS', 'ENOTDIR', 'EIO']);

export interface RootWriteFailure {
  readonly rootId: string;
  readonly code: string;
  readonly message: string;
  readonly at: number;
  readonly relativePath: string;
  readonly channelKeyHex?: string;
  readonly category: 'resource_exhausted' | 'unavailable' | 'unknown';
}

export interface RootRuntimeStatus {
  readonly id: string;
  readonly kind: RootConfigEntry['kind'];
  readonly path: string;
  readonly enabled: boolean;
  readonly writable: boolean;
  readonly exists: boolean;
  readonly isDirectory: boolean;
  readonly canWrite: boolean;
  readonly availableBytes?: number;
  readonly lastWriteFailure?: RootWriteFailure;
}

export interface MultiRootRuntimeSnapshot {
  readonly roots: RootRuntimeStatus[];
  readonly writeFailures: RootWriteFailure[];
}

interface RootState {
  readonly config: RootConfigEntry;
  readonly backend: FilesystemStorageBackend;
}

/**
 * Meta-level storage router for multi-root block/event storage.
 * Routes writes by channel key and merges reads across roots.
 */
export class MultiRootStorageBackend implements StorageBackend {
  private config: RootsConfig;
  private rootStates: RootState[];
  private readonly lastWriteFailures = new Map<string, RootWriteFailure>();

  constructor(initialConfig: RootsConfig) {
    this.config = initialConfig;
    this.rootStates = this.buildRootStates(initialConfig);
  }

  getRootsConfig(): RootsConfig {
    return this.config;
  }

  updateRootsConfig(nextConfig: RootsConfig): void {
    this.config = nextConfig;
    this.rootStates = this.buildRootStates(nextConfig);

    // Drop failures for roots that no longer exist.
    const rootIds = new Set(this.rootStates.map((state) => state.config.id));
    for (const rootId of this.lastWriteFailures.keys()) {
      if (!rootIds.has(rootId)) {
        this.lastWriteFailures.delete(rootId);
      }
    }
  }

  async getRuntimeSnapshot(): Promise<MultiRootRuntimeSnapshot> {
    const statuses = await Promise.all(this.rootStates.map((state) => this.getRootRuntimeStatus(state)));
    const writeFailures = Array.from(this.lastWriteFailures.values()).sort((left, right) => right.at - left.at);
    return {
      roots: statuses,
      writeFailures,
    };
  }

  async listFilesAcrossRoots(directory: string): Promise<string[]> {
    const files = new Set<string>();
    for (const state of this.getEnabledRootStates()) {
      try {
        const listed = await state.backend.listFiles(directory);
        for (const file of listed) {
          files.add(file);
        }
      } catch {
        // Ignore root-specific listing failures to keep cross-root reads best effort.
      }
    }
    return Array.from(files);
  }

  async writeFileForChannel(relativePath: string, data: Uint8Array, channelKeyHex: string): Promise<void> {
    const normalizedChannel = channelKeyHex.toLowerCase();
    await this.writeToChannelTargets(relativePath, data, normalizedChannel);
  }

  async readFileForChannel(relativePath: string, channelKeyHex: string): Promise<Uint8Array> {
    const normalizedChannel = channelKeyHex.toLowerCase();
    const prioritized = this.prioritizeRootsForChannel(normalizedChannel);
    return this.readFileFromRoots(relativePath, prioritized);
  }

  async existsForChannel(relativePath: string, channelKeyHex: string): Promise<boolean> {
    const normalizedChannel = channelKeyHex.toLowerCase();
    const prioritized = this.prioritizeRootsForChannel(normalizedChannel);
    for (const state of prioritized) {
      try {
        if (await state.backend.exists(relativePath)) {
          return true;
        }
      } catch {
        // Ignore and continue.
      }
    }
    return false;
  }

  async writeFile(relativePath: string, data: Uint8Array): Promise<void> {
    const parsedChannel = this.parseChannelKeyFromPath(relativePath);
    if (parsedChannel) {
      await this.writeToChannelTargets(relativePath, data, parsedChannel);
      return;
    }

    await this.writeToMainRoots(relativePath, data);
  }

  async readFile(relativePath: string): Promise<Uint8Array> {
    return this.readFileFromRoots(relativePath, this.getEnabledRootStates());
  }

  async listFiles(directory: string): Promise<string[]> {
    return this.listFilesAcrossRoots(directory);
  }

  async createDirectory(relativePath: string): Promise<void> {
    const parsedChannel = this.parseChannelKeyFromPath(relativePath);
    if (parsedChannel) {
      const targets = this.getWritableChannelTargets(parsedChannel);
      if (targets.main.length === 0) {
        throw new StorageError(`No writable main roots configured for channel ${parsedChannel}`);
      }
      await this.createDirectoryInTargets(relativePath, [...targets.main, ...targets.backup]);
      return;
    }

    const writable = this.getWritableEnabledRootStates();
    if (writable.length === 0) {
      throw new StorageError('No writable roots configured');
    }
    await this.createDirectoryInTargets(relativePath, writable);
  }

  async exists(relativePath: string): Promise<boolean> {
    for (const state of this.getEnabledRootStates()) {
      try {
        if (await state.backend.exists(relativePath)) {
          return true;
        }
      } catch {
        // Ignore root-level errors.
      }
    }
    return false;
  }

  async deleteFile(relativePath: string): Promise<void> {
    const writable = this.getWritableEnabledRootStates();
    await Promise.all(
      writable.map(async (state) => {
        try {
          await state.backend.deleteFile(relativePath);
        } catch {
          // Keep idempotent and best effort.
        }
      })
    );
  }

  private async readFileFromRoots(relativePath: string, states: RootState[]): Promise<Uint8Array> {
    let lastError: Error | undefined;
    for (const state of states) {
      try {
        return await state.backend.readFile(relativePath);
      } catch (error) {
        if (isFileNotFoundError(error)) {
          continue;
        }
        lastError = asError(error);
      }
    }

    if (lastError) {
      throw new StorageError(`Failed to read ${relativePath}: ${lastError.message}`, lastError);
    }
    throw new StorageError(`File not found in any root: ${relativePath}`);
  }

  private async createDirectoryInTargets(relativePath: string, targets: RootState[]): Promise<void> {
    let successCount = 0;
    const failures: Error[] = [];

    await Promise.all(
      targets.map(async (state) => {
        try {
          await state.backend.createDirectory(relativePath);
          successCount += 1;
        } catch (error) {
          failures.push(asError(error));
        }
      })
    );

    if (successCount === 0) {
      const first = failures[0];
      throw new StorageError(
        `Failed to create directory ${relativePath} in any target root${first ? `: ${first.message}` : ''}`,
        first
      );
    }
  }

  private async writeToChannelTargets(relativePath: string, data: Uint8Array, channelKeyHex: string): Promise<void> {
    const targets = this.getWritableChannelTargets(channelKeyHex);
    if (targets.main.length === 0) {
      throw new StorageError(`No writable main roots configured for channel ${channelKeyHex}`);
    }

    const mainSuccessCount = await this.writeToRoots(targets.main, relativePath, data, channelKeyHex);
    await this.writeToRoots(targets.backup, relativePath, data, channelKeyHex);

    if (mainSuccessCount === 0) {
      const latestMainFailure = targets.main
        .map((state) => this.lastWriteFailures.get(state.config.id))
        .find((failure): failure is RootWriteFailure => failure !== undefined);

      throw new StorageError(
        `Failed to write ${relativePath} to any main root${latestMainFailure ? `: ${latestMainFailure.message}` : ''}`
      );
    }
  }

  private async writeToMainRoots(relativePath: string, data: Uint8Array): Promise<void> {
    const mainTargets = this.getWritableEnabledRootStates().filter((state) => state.config.kind === 'main');
    if (mainTargets.length === 0) {
      throw new StorageError('No writable main roots configured');
    }

    const successCount = await this.writeToRoots(mainTargets, relativePath, data);
    if (successCount === 0) {
      const latestFailure = mainTargets
        .map((state) => this.lastWriteFailures.get(state.config.id))
        .find((failure): failure is RootWriteFailure => failure !== undefined);
      throw new StorageError(
        `Failed to write ${relativePath} to any main root${latestFailure ? `: ${latestFailure.message}` : ''}`
      );
    }
  }

  private async writeToRoots(
    targets: RootState[],
    relativePath: string,
    data: Uint8Array,
    channelKeyHex?: string
  ): Promise<number> {
    let successCount = 0;

    await Promise.all(
      targets.map(async (state) => {
        try {
          await ensureNearbytesMarker(state.config.path);
          await state.backend.writeFile(relativePath, data);
          this.lastWriteFailures.delete(state.config.id);
          successCount += 1;
        } catch (error) {
          const failure = this.toWriteFailure(state.config.id, relativePath, error, channelKeyHex);
          this.lastWriteFailures.set(state.config.id, failure);
        }
      })
    );

    return successCount;
  }

  private getWritableChannelTargets(channelKeyHex: string): { main: RootState[]; backup: RootState[] } {
    const writableEligible = this.rootStates.filter(
      (state) => state.config.enabled && state.config.writable && rootAcceptsChannel(state.config, channelKeyHex)
    );

    return {
      main: writableEligible.filter((state) => state.config.kind === 'main'),
      backup: writableEligible.filter((state) => state.config.kind === 'backup'),
    };
  }

  private prioritizeRootsForChannel(channelKeyHex: string): RootState[] {
    const prioritized: RootState[] = [];
    const fallback: RootState[] = [];

    for (const state of this.getEnabledRootStates()) {
      if (rootAcceptsChannel(state.config, channelKeyHex)) {
        prioritized.push(state);
      } else {
        fallback.push(state);
      }
    }

    return [...prioritized, ...fallback];
  }

  private getEnabledRootStates(): RootState[] {
    return this.rootStates.filter((state) => state.config.enabled);
  }

  private getWritableEnabledRootStates(): RootState[] {
    return this.rootStates.filter((state) => state.config.enabled && state.config.writable);
  }

  private parseChannelKeyFromPath(relativePath: string): string | null {
    const normalized = normalizeRelativePath(relativePath);
    const match = CHANNEL_PATH_REGEX.exec(normalized);
    if (!match) {
      return null;
    }
    return match[1].toLowerCase();
  }

  private toWriteFailure(
    rootId: string,
    relativePath: string,
    error: unknown,
    channelKeyHex?: string
  ): RootWriteFailure {
    const parsed = parseErrorCode(error);
    const category = RESOURCE_EXHAUSTED_CODES.has(parsed.code)
      ? 'resource_exhausted'
      : UNAVAILABLE_CODES.has(parsed.code)
        ? 'unavailable'
        : 'unknown';

    return {
      rootId,
      code: parsed.code,
      message: parsed.message,
      at: Date.now(),
      relativePath,
      channelKeyHex,
      category,
    };
  }

  private async getRootRuntimeStatus(state: RootState): Promise<RootRuntimeStatus> {
    const lastWriteFailure = this.lastWriteFailures.get(state.config.id);

    let exists = false;
    let isDirectory = false;
    let canWrite = false;
    let availableBytes: number | undefined;

    try {
      const stats = await fs.stat(state.config.path);
      exists = true;
      isDirectory = stats.isDirectory();
    } catch {
      exists = false;
    }

    if (exists && isDirectory) {
      try {
        await fs.access(state.config.path, fsConstants.W_OK);
        canWrite = true;
      } catch {
        canWrite = false;
      }

      try {
        const statFs = await fs.statfs(state.config.path);
        const free = Number(statFs.bavail) * Number(statFs.bsize);
        if (Number.isFinite(free) && free >= 0) {
          availableBytes = free;
        }
      } catch {
        // Leave undefined when statfs is unavailable.
      }
    }

    return {
      id: state.config.id,
      kind: state.config.kind,
      path: state.config.path,
      enabled: state.config.enabled,
      writable: state.config.writable,
      exists,
      isDirectory,
      canWrite,
      availableBytes,
      lastWriteFailure,
    };
  }

  private buildRootStates(config: RootsConfig): RootState[] {
    return config.roots.map((root) => ({
      config: root,
      backend: new FilesystemStorageBackend(root.path),
    }));
  }
}

export function isMultiRootStorageBackend(storage: StorageBackend): storage is MultiRootStorageBackend {
  return storage instanceof MultiRootStorageBackend;
}

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\//, '');
}

function parseErrorCode(error: unknown): { code: string; message: string } {
  const code = extractCode(error) ?? 'UNKNOWN';
  const message = asError(error).message;
  return { code, message };
}

function extractCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }

  if ('code' in error && typeof (error as { code?: unknown }).code === 'string') {
    return (error as { code: string }).code;
  }

  if ('cause' in error) {
    return extractCode((error as { cause?: unknown }).cause);
  }

  return undefined;
}

function isFileNotFoundError(error: unknown): boolean {
  const code = extractCode(error);
  if (code === 'ENOENT') {
    return true;
  }

  if (error instanceof StorageError && error.message.startsWith('File not found:')) {
    return true;
  }

  return false;
}

function asError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error(String(error));
}
