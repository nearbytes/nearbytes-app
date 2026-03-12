import { promises as fs, constants as fsConstants } from 'fs';
import { dirname, join, relative } from 'path';
import {
  isDurableDestination,
  resolveVolumeDestinations,
  type RootsConfig,
  type SourceConfigEntry,
  type VolumeDestinationConfig,
} from '../config/roots.js';
import { ensureNearbytesMarker, NEARBYTES_MARKER_FILES } from '../config/sourceDiscovery.js';
import { StorageError } from '../types/errors.js';
import type { StorageBackend } from '../types/storage.js';
import { FilesystemStorageBackend } from './filesystem.js';

const CHANNEL_PATH_REGEX = /^channels\/([a-f0-9]{64,200})(?:\/|$)/i;
const BLOCK_PATH_REGEX = /^blocks\/([a-f0-9]{64})(?:\.bin)?$/i;
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
  readonly kind: 'source';
  readonly path: string;
  readonly enabled: boolean;
  readonly writable: boolean;
  readonly provider: SourceConfigEntry['provider'];
  readonly reservePercent: number;
  readonly opportunisticPolicy: SourceConfigEntry['opportunisticPolicy'];
  readonly exists: boolean;
  readonly isDirectory: boolean;
  readonly canWrite: boolean;
  readonly availableBytes?: number;
  readonly usage: SourceUsageSummary;
  readonly lastWriteFailure?: RootWriteFailure;
}

export interface SourceVolumeUsage {
  readonly volumeId: string;
  readonly historyBytes: number;
  readonly historyFileCount: number;
  readonly fileBytes: number;
  readonly fileCount: number;
}

export interface SourceUsageSummary {
  readonly totalBytes: number;
  readonly channelBytes: number;
  readonly blockBytes: number;
  readonly otherBytes: number;
  readonly blockCount: number;
  readonly volumeUsages: SourceVolumeUsage[];
}

export interface MultiRootRuntimeSnapshot {
  readonly sources: RootRuntimeStatus[];
  readonly writeFailures: RootWriteFailure[];
}

export interface RootConsolidationSource {
  readonly id: string;
  readonly kind: 'source';
  readonly provider: SourceConfigEntry['provider'];
  readonly path: string;
  readonly fileCount: number;
  readonly totalBytes: number;
}

export interface RootConsolidationCandidate {
  readonly id: string;
  readonly kind: 'source';
  readonly provider: SourceConfigEntry['provider'];
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
  readonly config: SourceConfigEntry;
  readonly backend: FilesystemStorageBackend;
}

interface VolumeDestinationTarget {
  readonly state: RootState;
  readonly policy: VolumeDestinationConfig;
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

  async reconcileConfiguredVolumes(): Promise<void> {
    for (const volume of this.config.volumes) {
      await this.reconcileVolumeData(volume.volumeId);
    }
  }

  async getRuntimeSnapshot(): Promise<MultiRootRuntimeSnapshot> {
    const referencedByVolume = await this.getReferencedBlockHashIndex();
    const statuses = await Promise.all(
      this.rootStates.map((state) => this.getRootRuntimeStatus(state, referencedByVolume))
    );
    const writeFailures = Array.from(this.lastWriteFailures.values()).sort((left, right) => right.at - left.at);
    return {
      sources: statuses,
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
      kind: 'source',
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
              kind: 'source',
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
              kind: 'source',
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
              kind: 'source',
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
            kind: 'source',
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
      sources: this.config.sources
        .filter((entry) => entry.id !== source.config.id)
        .map((entry) =>
          entry.id === target.config.id && entry.moveFromSourceId === source.config.id
            ? { ...entry, moveFromSourceId: undefined }
            : entry
        ),
      defaultVolume: this.config.defaultVolume,
      volumes: this.config.volumes.map((volume) => ({
        volumeId: volume.volumeId,
        destinations: volume.destinations.filter((destination) => destination.sourceId !== source.config.id),
      })),
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

    await this.writeToAllWritableSources(relativePath, data);
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
      const targets = this.getWritableVolumeDestinationTargets(parsedChannel, { requireBlocks: false });
      if (targets.length === 0) {
        throw new StorageError(`No writable destinations configured for volume ${parsedChannel}`);
      }
      await this.createDirectoryInTargets(relativePath, targets.map((target) => target.state));
      return;
    }

    const writable = this.getWritableEnabledRootStates();
    if (writable.length === 0) {
      throw new StorageError('No writable sources configured');
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
    const isBlockWrite = BLOCK_PATH_REGEX.test(normalizeRelativePath(relativePath));
    const targets = this.getWritableVolumeDestinationTargets(channelKeyHex, {
      requireBlocks: isBlockWrite,
    });
    if (targets.length === 0) {
      throw new StorageError(
        `No writable ${isBlockWrite ? 'block' : 'event'} destinations configured for volume ${channelKeyHex}`
      );
    }

    const successCount = await this.writeToDestinations(targets, relativePath, data, channelKeyHex);
    const durableTargets = targets.filter((target) =>
      isBlockWrite ? isDurableDestination(target.policy) : target.policy.enabled && target.policy.storeEvents
    );
    const durableSuccessCount = durableTargets.filter(
      (target) => !this.lastWriteFailures.has(target.state.config.id)
    ).length;

    if (durableTargets.length > 0 && durableSuccessCount === 0) {
      const latestFailure = durableTargets
        .map((target) => this.lastWriteFailures.get(target.state.config.id))
        .find((failure): failure is RootWriteFailure => failure !== undefined);
      throw new StorageError(
        `Failed to write ${relativePath} to any durable destination${latestFailure ? `: ${latestFailure.message}` : ''}`
      );
    }

    if (successCount === 0) {
      const latestFailure = targets
        .map((target) => this.lastWriteFailures.get(target.state.config.id))
        .find((failure): failure is RootWriteFailure => failure !== undefined);
      throw new StorageError(
        `Failed to write ${relativePath} to any destination${latestFailure ? `: ${latestFailure.message}` : ''}`
      );
    }
  }

  private async writeToAllWritableSources(relativePath: string, data: Uint8Array): Promise<void> {
    const writableSources = this.getWritableEnabledRootStates();
    if (writableSources.length === 0) {
      throw new StorageError('No writable sources configured');
    }

    const successCount = await this.writeToRoots(writableSources, relativePath, data);
    if (successCount === 0) {
      const latestFailure = writableSources
        .map((state) => this.lastWriteFailures.get(state.config.id))
        .find((failure): failure is RootWriteFailure => failure !== undefined);
      throw new StorageError(
        `Failed to write ${relativePath} to any source${latestFailure ? `: ${latestFailure.message}` : ''}`
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

  private async writeToDestinations(
    targets: VolumeDestinationTarget[],
    relativePath: string,
    data: Uint8Array,
    channelKeyHex: string
  ): Promise<number> {
    let successCount = 0;

    await Promise.all(
      targets.map(async (target) => {
        try {
          await this.prepareDestinationWrite(target, data.byteLength, channelKeyHex);
          await ensureNearbytesMarker(target.state.config.path);
          await target.state.backend.writeFile(relativePath, data);
          this.lastWriteFailures.delete(target.state.config.id);
          successCount += 1;
        } catch (error) {
          const failure = this.toWriteFailure(target.state.config.id, relativePath, error, channelKeyHex);
          this.lastWriteFailures.set(target.state.config.id, failure);
        }
      })
    );

    return successCount;
  }

  private prioritizeRootsForChannel(channelKeyHex: string): RootState[] {
    const prioritized: RootState[] = [];
    const fallback: RootState[] = [];
    const prioritizedSourceIds = new Set(
      this.getVolumeDestinationTargets(channelKeyHex, { requireBlocks: false }).map((target) => target.state.config.id)
    );

    for (const state of this.getEnabledRootStates()) {
      if (prioritizedSourceIds.has(state.config.id)) {
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

  private getVolumeDestinationTargets(
    channelKeyHex: string,
    options: { requireBlocks: boolean }
  ): VolumeDestinationTarget[] {
    const destinations = resolveVolumeDestinations(this.config, channelKeyHex);
    const targets: VolumeDestinationTarget[] = [];
    for (const destination of destinations) {
      const state = this.getRootStateById(destination.sourceId);
      if (!state) {
        continue;
      }
      if (!state.config.enabled || !state.config.writable || !destination.enabled) {
        continue;
      }
      if (!destination.storeEvents) {
        continue;
      }
      if (options.requireBlocks && (!destination.storeBlocks || !destination.copySourceBlocks)) {
        continue;
      }
      targets.push({ state, policy: destination });
    }
    return targets;
  }

  private getWritableVolumeDestinationTargets(
    channelKeyHex: string,
    options: { requireBlocks: boolean }
  ): VolumeDestinationTarget[] {
    return this.getVolumeDestinationTargets(channelKeyHex, options);
  }

  private async prepareDestinationWrite(
    target: VolumeDestinationTarget,
    bytesToWrite: number,
    channelKeyHex: string
  ): Promise<void> {
    const availableBytes = await getAvailableBytes(target.state.config.path);
    const totalBytes = await getTotalBytes(target.state.config.path);
    if (availableBytes === undefined || totalBytes === undefined) {
      return;
    }

    const reservePercent = Math.max(target.state.config.reservePercent, target.policy.reservePercent);
    const reservedBytes = Math.floor((totalBytes * reservePercent) / 100);
    if (availableBytes - bytesToWrite >= reservedBytes) {
      return;
    }

    await this.pruneSourceBlocks(target.state.config.id, reservedBytes + bytesToWrite, channelKeyHex, {
      preserveReplicaBlocks: true,
    });
    const afterSpareCleanupBytes = await getAvailableBytes(target.state.config.path);
    if (afterSpareCleanupBytes !== undefined && afterSpareCleanupBytes - bytesToWrite >= reservedBytes) {
      return;
    }

    if (target.policy.fullPolicy === 'drop-older-blocks') {
      await this.pruneSourceBlocks(target.state.config.id, reservedBytes + bytesToWrite, channelKeyHex, {
        preserveReplicaBlocks: false,
      });
      const nextAvailableBytes = await getAvailableBytes(target.state.config.path);
      if (nextAvailableBytes !== undefined && nextAvailableBytes - bytesToWrite >= reservedBytes) {
        return;
      }
    }

    throw new StorageError(
      `Destination ${target.state.config.id} does not have enough free space for volume ${channelKeyHex}`
    );
  }

  private async reconcileVolumeData(volumeId: string): Promise<void> {
    await this.reconcileVolumeEvents(volumeId);
    await this.reconcileVolumeBlocks(volumeId);
  }

  private async reconcileVolumeEvents(volumeId: string): Promise<void> {
    const eventTargets = this.getWritableVolumeDestinationTargets(volumeId, { requireBlocks: false });
    if (eventTargets.length === 0) {
      return;
    }

    const directory = `channels/${volumeId}`;
    const eventFiles = await this.listFilesAcrossRoots(directory);
    if (eventFiles.length === 0) {
      return;
    }

    for (const target of eventTargets) {
      for (const eventFile of eventFiles) {
        if (!eventFile.endsWith('.bin')) {
          continue;
        }

        const relativePath = `${directory}/${eventFile}`;
        try {
          if (await target.state.backend.exists(relativePath)) {
            continue;
          }
        } catch {
          // Continue into read/write path and let it record a concrete failure if needed.
        }

        let data: Uint8Array;
        try {
          data = await this.readFileFromRoots(relativePath, this.prioritizeRootsForChannel(volumeId));
        } catch {
          continue;
        }

        try {
          await this.prepareDestinationWrite(target, data.byteLength, volumeId);
          await target.state.backend.writeFile(relativePath, data);
          this.lastWriteFailures.delete(target.state.config.id);
        } catch (error) {
          this.lastWriteFailures.set(
            target.state.config.id,
            this.toWriteFailure(target.state.config.id, relativePath, error, volumeId)
          );
          break;
        }
      }
    }
  }

  private async reconcileVolumeBlocks(volumeId: string): Promise<void> {
    const referencedHashes = await this.collectReferencedBlockHashes(volumeId);
    if (referencedHashes.size === 0) {
      return;
    }

    const blockTargets = this.getWritableVolumeDestinationTargets(volumeId, { requireBlocks: true });
    for (const target of blockTargets) {
      for (const hash of referencedHashes) {
        const relativePath = `blocks/${hash}.bin`;
        try {
          if (await target.state.backend.exists(relativePath)) {
            continue;
          }
        } catch {
          // Continue into read/write path and let it record a concrete failure if needed.
        }

        let data: Uint8Array;
        try {
          data = await this.readFileFromRoots(relativePath, this.prioritizeRootsForChannel(volumeId));
        } catch {
          continue;
        }

        try {
          await this.prepareDestinationWrite(target, data.byteLength, volumeId);
          await target.state.backend.writeFile(relativePath, data);
          this.lastWriteFailures.delete(target.state.config.id);
        } catch (error) {
          this.lastWriteFailures.set(
            target.state.config.id,
            this.toWriteFailure(target.state.config.id, relativePath, error, volumeId)
          );
          break;
        }
      }
    }
  }

  private async pruneSourceBlocks(
    sourceId: string,
    requiredFreeBytes: number,
    currentVolumeId?: string,
    options: { preserveReplicaBlocks: boolean } = { preserveReplicaBlocks: false }
  ): Promise<void> {
    const state = this.getRootStateById(sourceId);
    if (!state) {
      return;
    }

    const durableBlocks = await this.collectProtectedBlockHashes(sourceId, 'durable', currentVolumeId);
    const replicaBlocks = await this.collectProtectedBlockHashes(sourceId, 'replica', currentVolumeId);
    const blocksDir = join(state.config.path, 'blocks');
    const entries = await safeReadDirEntries(blocksDir);
    const candidates: Array<{ path: string; hash: string; mtimeMs: number; priority: number }> = [];

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.bin')) {
        continue;
      }
      const hash = entry.name.slice(0, -4).toLowerCase();
      if (
        !/^[a-f0-9]{64}$/i.test(hash) ||
        durableBlocks.has(hash) ||
        (options.preserveReplicaBlocks && replicaBlocks.has(hash))
      ) {
        continue;
      }

      const absolutePath = join(blocksDir, entry.name);
      const stats = await safeStat(absolutePath);
      if (!stats) {
        continue;
      }
      candidates.push({
        path: absolutePath,
        hash,
        mtimeMs: Number(stats.mtimeMs),
        priority: replicaBlocks.has(hash) ? 1 : 0,
      });
    }

    candidates.sort((left, right) => {
      if (left.priority !== right.priority) {
        return left.priority - right.priority;
      }
      return left.mtimeMs - right.mtimeMs;
    });

    for (const candidate of candidates) {
      const available = await getAvailableBytes(state.config.path);
      if (available !== undefined && available >= requiredFreeBytes) {
        return;
      }
      await safeUnlink(candidate.path);
    }
  }

  private async collectProtectedBlockHashes(
    sourceId: string,
    mode: 'durable' | 'replica',
    currentVolumeId?: string
  ): Promise<Set<string>> {
    const hashes = new Set<string>();
    const volumeIds = await this.listTrackedVolumeIds();
    if (currentVolumeId) {
      volumeIds.add(currentVolumeId.toLowerCase());
    }

    for (const volumeId of volumeIds) {
      const destinations = resolveVolumeDestinations(this.config, volumeId).filter(
        (destination) =>
          destination.sourceId === sourceId &&
          destination.enabled &&
          destination.storeEvents &&
          destination.storeBlocks
      );
      if (destinations.length === 0) {
        continue;
      }
      const isDurable = destinations.some((destination) => isDurableDestination(destination));
      if ((mode === 'durable') !== isDurable) {
        continue;
      }
      const referenced = await this.collectReferencedBlockHashes(volumeId);
      for (const hash of referenced) {
        hashes.add(hash);
      }
    }

    return hashes;
  }

  private async listTrackedVolumeIds(): Promise<Set<string>> {
    const volumeIds = new Set<string>(this.config.volumes.map((volume) => volume.volumeId));
    for (const state of this.getEnabledRootStates()) {
      const channelsDir = join(state.config.path, 'channels');
      const entries = await safeReadDirEntries(channelsDir);
      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }
        const volumeId = entry.name.trim().toLowerCase();
        if (/^[a-f0-9]{64,200}$/i.test(volumeId)) {
          volumeIds.add(volumeId);
        }
      }
    }
    return volumeIds;
  }

  private async collectReferencedBlockHashes(volumeId: string): Promise<Set<string>> {
    const hashes = new Set<string>();
    const directory = `channels/${volumeId}`;
    const eventFiles = await this.listFilesAcrossRoots(directory);

    for (const eventFile of eventFiles) {
      if (!eventFile.endsWith('.bin')) {
        continue;
      }
      const relativePath = `${directory}/${eventFile}`;
      let bytes: Uint8Array;
      try {
        bytes = await this.readFileFromRoots(relativePath, this.prioritizeRootsForChannel(volumeId));
      } catch {
        continue;
      }

      try {
        const parsed = JSON.parse(new TextDecoder().decode(bytes)) as {
          payload?: { type?: string; hash?: string };
        };
        const hash = parsed.payload?.hash?.trim().toLowerCase();
        if (parsed.payload?.type === 'CREATE_FILE' && hash && /^[a-f0-9]{64}$/i.test(hash)) {
          hashes.add(hash);
        }
      } catch {
        // Ignore unreadable event payloads at the meta layer.
      }
    }

    return hashes;
  }

  private async getReferencedBlockHashIndex(): Promise<Map<string, Set<string>>> {
    const index = new Map<string, Set<string>>();
    const volumeIds = await this.listTrackedVolumeIds();
    for (const volumeId of volumeIds) {
      index.set(volumeId, await this.collectReferencedBlockHashes(volumeId));
    }
    return index;
  }

  private async collectSourceUsageSummary(
    state: RootState,
    referencedByVolume: ReadonlyMap<string, Set<string>>
  ): Promise<SourceUsageSummary> {
    const files = await listRootFiles(state.config.path);
    let totalBytes = 0;
    let channelBytes = 0;
    let blockBytes = 0;
    let otherBytes = 0;
    let blockCount = 0;
    const blockSizes = new Map<string, number>();
    const historyByVolume = new Map<string, { bytes: number; files: number }>();

    for (const file of files) {
      if (NEARBYTES_MARKER_FILES.includes(file.relativePath as (typeof NEARBYTES_MARKER_FILES)[number])) {
        continue;
      }
      totalBytes += file.size;

      const normalized = normalizeRelativePath(file.relativePath);
      const blockMatch = BLOCK_PATH_REGEX.exec(normalized);
      if (blockMatch) {
        const hash = blockMatch[1].toLowerCase();
        blockBytes += file.size;
        blockCount += 1;
        blockSizes.set(hash, file.size);
        continue;
      }

      if (normalized.startsWith('channels/')) {
        channelBytes += file.size;
        const parts = normalized.split('/');
        const volumeId = parts[1]?.trim().toLowerCase();
        if (volumeId && /^[a-f0-9]{64,200}$/i.test(volumeId)) {
          const current = historyByVolume.get(volumeId) ?? { bytes: 0, files: 0 };
          current.bytes += file.size;
          current.files += 1;
          historyByVolume.set(volumeId, current);
        }
        continue;
      }

      otherBytes += file.size;
    }

    const volumeIds = new Set<string>([...historyByVolume.keys(), ...referencedByVolume.keys()]);
    const volumeUsages: SourceVolumeUsage[] = [];

    for (const volumeId of Array.from(volumeIds).sort()) {
      const history = historyByVolume.get(volumeId) ?? { bytes: 0, files: 0 };
      let fileBytes = 0;
      let fileCount = 0;

      for (const hash of referencedByVolume.get(volumeId) ?? []) {
        const size = blockSizes.get(hash);
        if (size === undefined) {
          continue;
        }
        fileBytes += size;
        fileCount += 1;
      }

      if (history.bytes === 0 && fileBytes === 0) {
        continue;
      }

      volumeUsages.push({
        volumeId,
        historyBytes: history.bytes,
        historyFileCount: history.files,
        fileBytes,
        fileCount,
      });
    }

    return {
      totalBytes,
      channelBytes,
      blockBytes,
      otherBytes,
      blockCount,
      volumeUsages,
    };
  }

  private getRootStateById(rootId: string): RootState | undefined {
    return this.rootStates.find((state) => state.config.id === rootId);
  }

  private getConsolidationCompatibility(
    source: SourceConfigEntry,
    target: SourceConfigEntry
  ): { ok: true } | { ok: false; reason: string } {
    if (!source.enabled || !target.enabled) {
      return {
        ok: false,
        reason: 'Both sources must be enabled',
      };
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

  private async getRootRuntimeStatus(
    state: RootState,
    referencedByVolume: ReadonlyMap<string, Set<string>>
  ): Promise<RootRuntimeStatus> {
    const lastWriteFailure = this.lastWriteFailures.get(state.config.id);

    let exists = false;
    let isDirectory = false;
    let canWrite = false;
    let availableBytes: number | undefined;
    let usage: SourceUsageSummary = {
      totalBytes: 0,
      channelBytes: 0,
      blockBytes: 0,
      otherBytes: 0,
      blockCount: 0,
      volumeUsages: [],
    };

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

      usage = await this.collectSourceUsageSummary(state, referencedByVolume);
    }

    return {
      id: state.config.id,
      kind: 'source',
      path: state.config.path,
      provider: state.config.provider,
      enabled: state.config.enabled,
      writable: state.config.writable,
      reservePercent: state.config.reservePercent,
      opportunisticPolicy: state.config.opportunisticPolicy,
      exists,
      isDirectory,
      canWrite,
      availableBytes,
      usage,
      lastWriteFailure,
    };
  }

  private buildRootStates(config: RootsConfig): RootState[] {
    return config.sources.map((source) => ({
      config: source,
      backend: new FilesystemStorageBackend(source.path),
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
      if (NEARBYTES_MARKER_FILES.includes(entry.name as (typeof NEARBYTES_MARKER_FILES)[number])) {
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

async function getTotalBytes(path: string): Promise<number | undefined> {
  try {
    const stats = await fs.statfs(path);
    const total = Number(stats.blocks) * Number(stats.bsize);
    if (!Number.isFinite(total) || total < 0) {
      return undefined;
    }
    return total;
  } catch {
    return undefined;
  }
}

async function safeReadDirEntries(pathValue: string): Promise<import('fs').Dirent[]> {
  try {
    return await fs.readdir(pathValue, { withFileTypes: true });
  } catch {
    return [];
  }
}

function asError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error(String(error));
}
