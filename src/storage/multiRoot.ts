import { promises as fs, constants as fsConstants } from 'fs';
import { dirname, join, relative } from 'path';
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

export interface RootConsolidationSource {
  readonly id: string;
  readonly kind: RootConfigEntry['kind'];
  readonly provider: RootConfigEntry['provider'];
  readonly path: string;
  readonly fileCount: number;
  readonly totalBytes: number;
}

export interface RootConsolidationCandidate {
  readonly id: string;
  readonly kind: RootConfigEntry['kind'];
  readonly provider: RootConfigEntry['provider'];
  readonly path: string;
  readonly sameDevice: boolean;
  readonly filesToTransfer: number;
  readonly bytesToTransfer: number;
  readonly availableBytes?: number;
  readonly enoughSpace: boolean;
  readonly eligible: boolean;
  readonly reason?: string;
}

export interface RootConsolidationPlan {
  readonly generatedAt: number;
  readonly source: RootConsolidationSource;
  readonly candidates: RootConsolidationCandidate[];
}

export interface RootConsolidationResult {
  readonly sourceId: string;
  readonly targetId: string;
  readonly movedFiles: number;
  readonly renamedFiles: number;
  readonly copiedFiles: number;
  readonly removedSourceFiles: number;
  readonly skippedExisting: number;
  readonly bytesTransferred: number;
  readonly sameDevice: boolean;
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

  async getConsolidationPlan(sourceId: string): Promise<RootConsolidationPlan> {
    const source = this.getRootStateById(sourceId);
    if (!source) {
      throw new StorageError(`Root not found: ${sourceId}`);
    }

    const sourceFiles = await listRootFiles(source.config.path);
    const sourceSummary: RootConsolidationSource = {
      id: source.config.id,
      kind: source.config.kind,
      provider: source.config.provider,
      path: source.config.path,
      fileCount: sourceFiles.length,
      totalBytes: sourceFiles.reduce((sum, file) => sum + file.size, 0),
    };

    const sourceStats = await safeStat(source.config.path);
    const candidates = await Promise.all(
      this.rootStates
        .filter((state) => state.config.id !== source.config.id)
        .map(async (target): Promise<RootConsolidationCandidate> => {
          const compatibility = this.getConsolidationCompatibility(source.config, target.config);
          if (!compatibility.ok) {
            return {
              id: target.config.id,
              kind: target.config.kind,
              provider: target.config.provider,
              path: target.config.path,
              sameDevice: false,
              filesToTransfer: 0,
              bytesToTransfer: 0,
              enoughSpace: false,
              eligible: false,
              reason: compatibility.reason,
            };
          }

          const targetStats = await safeStat(target.config.path);
          if (!targetStats || !targetStats.isDirectory()) {
            return {
              id: target.config.id,
              kind: target.config.kind,
              provider: target.config.provider,
              path: target.config.path,
              sameDevice: false,
              filesToTransfer: 0,
              bytesToTransfer: 0,
              enoughSpace: false,
              eligible: false,
              reason: 'Destination folder is missing or not a directory',
            };
          }

          if (!target.config.writable || !target.config.enabled) {
            return {
              id: target.config.id,
              kind: target.config.kind,
              provider: target.config.provider,
              path: target.config.path,
              sameDevice: sourceStats?.dev === targetStats.dev,
              filesToTransfer: 0,
              bytesToTransfer: 0,
              enoughSpace: false,
              eligible: false,
              reason: 'Destination root must be enabled and writable',
            };
          }

          const plan = await planTransfer(target.config.path, sourceFiles);
          const sameDevice = sourceStats ? sourceStats.dev === targetStats.dev : false;
          const availableBytes = await getAvailableBytes(target.config.path);
          const enoughSpace =
            sameDevice || availableBytes === undefined || availableBytes >= plan.bytesToTransfer;

          return {
            id: target.config.id,
            kind: target.config.kind,
            provider: target.config.provider,
            path: target.config.path,
            sameDevice,
            filesToTransfer: plan.filesToTransfer,
            bytesToTransfer: plan.bytesToTransfer,
            availableBytes,
            enoughSpace,
            eligible: enoughSpace,
            reason: enoughSpace ? undefined : 'Not enough free space in destination root',
          };
        })
    );

    return {
      generatedAt: Date.now(),
      source: sourceSummary,
      candidates,
    };
  }

  async consolidateRoot(sourceId: string, targetId: string): Promise<{
    config: RootsConfig;
    result: RootConsolidationResult;
  }> {
    const source = this.getRootStateById(sourceId);
    const target = this.getRootStateById(targetId);
    if (!source) {
      throw new StorageError(`Root not found: ${sourceId}`);
    }
    if (!target) {
      throw new StorageError(`Root not found: ${targetId}`);
    }
    if (source.config.id === target.config.id) {
      throw new StorageError('Source and destination roots must be different');
    }

    const compatibility = this.getConsolidationCompatibility(source.config, target.config);
    if (!compatibility.ok) {
      throw new StorageError(compatibility.reason);
    }
    if (!target.config.enabled || !target.config.writable) {
      throw new StorageError('Destination root must be enabled and writable');
    }

    const sourceFiles = await listRootFiles(source.config.path);
    const transferPlan = await planTransfer(target.config.path, sourceFiles);
    const sameDevice = await areSameDevice(source.config.path, target.config.path);
    if (!sameDevice) {
      const availableBytes = await getAvailableBytes(target.config.path);
      if (availableBytes !== undefined && transferPlan.bytesToTransfer > availableBytes) {
        throw new StorageError(
          `Not enough free space in destination root (${availableBytes} bytes available, ${transferPlan.bytesToTransfer} required)`
        );
      }
    }

    await ensureNearbytesMarker(target.config.path);
    const transferResult = await executeTransfer({
      sourcePath: source.config.path,
      targetPath: target.config.path,
      files: transferPlan.files,
    });

    const nextConfig: RootsConfig = {
      version: this.config.version,
      roots: this.config.roots.filter((root) => root.id !== source.config.id),
    };

    this.updateRootsConfig(nextConfig);

    return {
      config: nextConfig,
      result: {
        sourceId: source.config.id,
        targetId: target.config.id,
        movedFiles: transferResult.movedFiles,
        renamedFiles: transferResult.renamedFiles,
        copiedFiles: transferResult.copiedFiles,
        removedSourceFiles: transferResult.removedSourceFiles,
        skippedExisting: transferResult.skippedExisting,
        bytesTransferred: transferResult.bytesTransferred,
        sameDevice: transferResult.sameDevice,
      },
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

  private getRootStateById(rootId: string): RootState | undefined {
    return this.rootStates.find((state) => state.config.id === rootId);
  }

  private getConsolidationCompatibility(
    source: RootConfigEntry,
    target: RootConfigEntry
  ): { ok: true } | { ok: false; reason: string } {
    if (source.kind === 'main' || target.kind === 'main') {
      if (source.kind === 'main' && target.kind === 'main') {
        return { ok: true };
      }
      return {
        ok: false,
        reason: 'Main roots can only consolidate into another main root',
      };
    }

    if (source.strategy.name !== 'allowlist' || target.strategy.name !== 'allowlist') {
      return {
        ok: false,
        reason: 'Backup roots require allowlist strategies to consolidate',
      };
    }

    const sourceKeys = normalizeKeySet(source.strategy.channelKeys);
    const targetKeys = normalizeKeySet(target.strategy.channelKeys);
    if (sourceKeys.length !== targetKeys.length) {
      return {
        ok: false,
        reason: 'Backup roots must have the same allowed volume keys',
      };
    }
    for (let index = 0; index < sourceKeys.length; index += 1) {
      if (sourceKeys[index] !== targetKeys[index]) {
        return {
          ok: false,
          reason: 'Backup roots must have the same allowed volume keys',
        };
      }
    }

    return { ok: true };
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

interface RootFileEntry {
  readonly relativePath: string;
  readonly absolutePath: string;
  readonly size: number;
}

interface TransferPlan {
  readonly files: RootFileEntry[];
  readonly filesToTransfer: number;
  readonly bytesToTransfer: number;
}

interface TransferExecutionResult {
  readonly movedFiles: number;
  readonly renamedFiles: number;
  readonly copiedFiles: number;
  readonly removedSourceFiles: number;
  readonly skippedExisting: number;
  readonly bytesTransferred: number;
  readonly sameDevice: boolean;
}

async function listRootFiles(rootPath: string): Promise<RootFileEntry[]> {
  const rootStat = await safeStat(rootPath);
  if (!rootStat || !rootStat.isDirectory()) {
    return [];
  }

  const result: RootFileEntry[] = [];
  const queue: string[] = [rootPath];

  while (queue.length > 0) {
    const current = queue.pop();
    if (!current) {
      continue;
    }

    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.name === '.nearbytes') {
        continue;
      }

      const absolute = join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(absolute);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }

      let stats: Awaited<ReturnType<typeof fs.stat>>;
      try {
        stats = await fs.stat(absolute);
      } catch {
        continue;
      }

      result.push({
        relativePath: normalizeRelativePath(relative(rootPath, absolute)),
        absolutePath: absolute,
        size: stats.size,
      });
    }
  }

  result.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  return result;
}

async function planTransfer(targetPath: string, files: RootFileEntry[]): Promise<TransferPlan> {
  let filesToTransfer = 0;
  let bytesToTransfer = 0;

  for (const file of files) {
    const targetAbsolute = join(targetPath, file.relativePath);
    const destinationExists = await fileExists(targetAbsolute);
    if (!destinationExists) {
      filesToTransfer += 1;
      bytesToTransfer += file.size;
    }
  }

  return {
    files,
    filesToTransfer,
    bytesToTransfer,
  };
}

async function executeTransfer(options: {
  sourcePath: string;
  targetPath: string;
  files: RootFileEntry[];
}): Promise<TransferExecutionResult> {
  const sameDevice = await areSameDevice(options.sourcePath, options.targetPath);
  let movedFiles = 0;
  let renamedFiles = 0;
  let copiedFiles = 0;
  let removedSourceFiles = 0;
  let skippedExisting = 0;
  let bytesTransferred = 0;

  for (const file of options.files) {
    const destinationAbsolute = join(options.targetPath, file.relativePath);
    const destinationExists = await fileExists(destinationAbsolute);
    if (destinationExists) {
      await safeUnlink(file.absolutePath);
      removedSourceFiles += 1;
      skippedExisting += 1;
      continue;
    }

    await fs.mkdir(dirname(destinationAbsolute), { recursive: true });

    try {
      await fs.rename(file.absolutePath, destinationAbsolute);
      movedFiles += 1;
      renamedFiles += 1;
      removedSourceFiles += 1;
      bytesTransferred += file.size;
      continue;
    } catch (error) {
      if (!isCrossDeviceError(error)) {
        throw new StorageError(
          `Failed to move ${file.relativePath}: ${asError(error).message}`,
          asError(error)
        );
      }
    }

    await fs.copyFile(file.absolutePath, destinationAbsolute);
    await safeUnlink(file.absolutePath);
    movedFiles += 1;
    copiedFiles += 1;
    removedSourceFiles += 1;
    bytesTransferred += file.size;
  }

  await removeEmptyDirectories(options.sourcePath);

  return {
    movedFiles,
    renamedFiles,
    copiedFiles,
    removedSourceFiles,
    skippedExisting,
    bytesTransferred,
    sameDevice,
  };
}

async function removeEmptyDirectories(rootPath: string): Promise<void> {
  const queue: string[] = [rootPath];
  const directories: string[] = [];

  while (queue.length > 0) {
    const current = queue.pop();
    if (!current) {
      continue;
    }
    directories.push(current);
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        queue.push(join(current, entry.name));
      }
    }
  }

  directories.sort((left, right) => right.length - left.length);
  for (const directory of directories) {
    if (directory === rootPath) {
      continue;
    }
    try {
      await fs.rmdir(directory);
    } catch {
      // Keep best effort cleanup.
    }
  }
}

function normalizeKeySet(values: readonly string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim().toLowerCase())))
    .filter((value) => value.length > 0)
    .sort((left, right) => left.localeCompare(right));
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

function isCrossDeviceError(error: unknown): boolean {
  return extractCode(error) === 'EXDEV';
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

async function fileExists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

async function safeUnlink(path: string): Promise<void> {
  try {
    await fs.unlink(path);
  } catch (error) {
    if (extractCode(error) === 'ENOENT') {
      return;
    }
    throw error;
  }
}

async function safeStat(path: string): Promise<Awaited<ReturnType<typeof fs.stat>> | null> {
  try {
    return await fs.stat(path);
  } catch {
    return null;
  }
}

async function areSameDevice(leftPath: string, rightPath: string): Promise<boolean> {
  const [leftStats, rightStats] = await Promise.all([safeStat(leftPath), safeStat(rightPath)]);
  if (!leftStats || !rightStats) {
    return false;
  }
  return leftStats.dev === rightStats.dev;
}

async function getAvailableBytes(path: string): Promise<number | undefined> {
  try {
    const stats = await fs.statfs(path);
    const free = Number(stats.bavail) * Number(stats.bsize);
    if (!Number.isFinite(free) || free < 0) {
      return undefined;
    }
    return free;
  } catch {
    return undefined;
  }
}

function asError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error(String(error));
}
