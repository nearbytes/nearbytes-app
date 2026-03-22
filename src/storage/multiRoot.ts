import { promises as fs, constants as fsConstants } from 'fs';
import { dirname, join, relative } from 'path';
import {
  isDurableDestination,
  resolveVolumeDestinations,
  type RootsConfig,
  type SourceConfigEntry,
  type VolumeDestinationConfig,
} from '../config/roots.js';
import {
  ensureNearbytesMarker,
  isNearbytesIgnoredTopLevelEntryName,
  normalizeNearbytesRoot,
  NEARBYTES_IGNORED_ROOT_FILES,
} from '../config/sourceDiscovery.js';
import { StorageError } from '../types/errors.js';
import type { StorageBackend } from '../types/storage.js';
import { FilesystemStorageBackend } from './filesystem.js';
import { validateBlockBytes, validateEventBytes, type IntegrityValidationResult } from './integrity.js';

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

interface RuntimeSnapshotOptions {
  readonly includeUsage?: boolean;
}

interface RepairMonitorOptions {
  readonly repairableDelayMs: number;
  readonly blockedDelayMs: number;
  readonly healthyDelayMs: number;
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

export interface StorageLocationIssue {
  readonly code:
    | 'unexpected-top-level-entry'
    | 'invalid-block-file-name'
    | 'invalid-channel-directory'
    | 'invalid-event-file-name'
    | 'block-hash-mismatch'
    | 'event-deserialize-failed'
    | 'event-hash-mismatch'
    | 'event-signature-invalid';
  readonly severity: 'warn' | 'error';
  readonly relativePath: string;
  readonly absolutePath: string;
  readonly detail: string;
}

export interface StorageLocationRepairReport {
  readonly sourceId: string;
  readonly path: string;
  readonly issueCount: number;
  readonly cleanupCandidateCount: number;
  readonly issues: StorageLocationIssue[];
}

export interface StorageLocationRepairResult {
  readonly sourceId: string;
  readonly removedCount: number;
  readonly issueCount: number;
  readonly cleanupCandidateCount: number;
  readonly action: 'delete' | 'trash';
}

interface StorageLocationInspectOptions {
  readonly validateContents?: boolean;
}

interface StorageLocationRepairOptions {
  readonly structuralOnly?: boolean;
}

export interface SourceConflictResolutionResult {
  readonly sourceIds: string[];
  readonly rewrittenMarkers: number;
  readonly removedLegacyMetadata: number;
  readonly clearedSources: number;
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
  private reconcileInFlight: Promise<void> | null = null;
  private runtimeSnapshotInFlight: Promise<MultiRootRuntimeSnapshot> | null = null;
  private reconcileQueued = false;
  private repairMonitorTimer: ReturnType<typeof setTimeout> | null = null;
  private repairMonitorRunning = false;
  private repairAuditInFlight = false;
  private repairMonitorOptions: RepairMonitorOptions = {
    repairableDelayMs: 5_000,
    blockedDelayMs: 30_000,
    healthyDelayMs: 120_000,
  };

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
    this.runtimeSnapshotInFlight = null;

    // Drop failures for roots that no longer exist.
    const rootIds = new Set(this.rootStates.map((state) => state.config.id));
    for (const rootId of this.lastWriteFailures.keys()) {
      if (!rootIds.has(rootId)) {
        this.lastWriteFailures.delete(rootId);
      }
    }
  }

  async reconcileConfiguredVolumes(): Promise<void> {
    const trackedVolumeIds = await this.listTrackedVolumeIds();
    for (const volumeId of Array.from(trackedVolumeIds).sort()) {
      await this.reconcileVolumeData(volumeId);
    }
    await this.collectUnknownProvenanceBlocksToLocalRoot();
  }

  scheduleReconcileConfiguredVolumes(): void {
    this.reconcileQueued = true;
    if (this.repairMonitorRunning) {
      this.scheduleRepairAudit(this.repairMonitorOptions.repairableDelayMs);
    }
    if (this.reconcileInFlight) {
      return;
    }
    this.reconcileInFlight = this.runScheduledReconcileLoop().finally(() => {
      this.reconcileInFlight = null;
      if (this.reconcileQueued) {
        this.scheduleReconcileConfiguredVolumes();
      }
    });
  }

  isReconcileScheduled(): boolean {
    return this.reconcileQueued || this.reconcileInFlight !== null;
  }

  startRepairMonitor(options: Partial<RepairMonitorOptions> = {}): void {
    this.repairMonitorOptions = {
      ...this.repairMonitorOptions,
      ...options,
    };
    if (this.repairMonitorRunning) {
      this.scheduleRepairAudit(this.repairMonitorOptions.repairableDelayMs);
      return;
    }
    this.repairMonitorRunning = true;
    this.scheduleRepairAudit(0);
  }

  stopRepairMonitor(): void {
    this.repairMonitorRunning = false;
    if (this.repairMonitorTimer) {
      clearTimeout(this.repairMonitorTimer);
      this.repairMonitorTimer = null;
    }
  }

  private async runScheduledReconcileLoop(): Promise<void> {
    while (this.reconcileQueued) {
      this.reconcileQueued = false;
      await this.reconcileConfiguredVolumes();
    }
  }

  private scheduleRepairAudit(delayMs: number): void {
    if (!this.repairMonitorRunning) {
      return;
    }
    if (this.repairMonitorTimer) {
      clearTimeout(this.repairMonitorTimer);
    }
    this.repairMonitorTimer = setTimeout(() => {
      this.repairMonitorTimer = null;
      void this.runRepairAudit();
    }, Math.max(0, delayMs));
    if (typeof this.repairMonitorTimer === 'object' && this.repairMonitorTimer && 'unref' in this.repairMonitorTimer) {
      this.repairMonitorTimer.unref();
    }
  }

  private async runRepairAudit(): Promise<void> {
    if (!this.repairMonitorRunning || this.repairAuditInFlight) {
      return;
    }
    this.repairAuditInFlight = true;
    try {
      const snapshot = await this.getRuntimeSnapshot();
      const repairState = this.inspectRepairState(snapshot);
      if (repairState === 'repairable') {
        this.scheduleReconcileConfiguredVolumes();
      }
      if (!this.repairMonitorRunning) {
        return;
      }
      if (repairState === 'repairable') {
        this.scheduleRepairAudit(this.repairMonitorOptions.repairableDelayMs);
        return;
      }
      if (repairState === 'blocked') {
        this.scheduleRepairAudit(this.repairMonitorOptions.blockedDelayMs);
        return;
      }
      this.scheduleRepairAudit(this.repairMonitorOptions.healthyDelayMs);
    } finally {
      this.repairAuditInFlight = false;
    }
  }

  private inspectRepairState(snapshot: MultiRootRuntimeSnapshot): 'repairable' | 'blocked' | 'healthy' {
    const volumeIds = new Set<string>();
    for (const source of snapshot.sources) {
      for (const usage of source.usage.volumeUsages) {
        volumeIds.add(usage.volumeId);
      }
    }

    for (const volumeId of Array.from(volumeIds.values()).sort()) {
      let expectedHistoryBytes = 0;
      let expectedFileBytes = 0;
      for (const source of snapshot.sources) {
        const usage = source.usage.volumeUsages.find((entry) => entry.volumeId === volumeId);
        if (!usage) {
          continue;
        }
        expectedHistoryBytes = Math.max(expectedHistoryBytes, usage.historyBytes);
        expectedFileBytes = Math.max(expectedFileBytes, usage.fileBytes);
      }

      const expectedBytes = expectedHistoryBytes + expectedFileBytes;
      if (expectedBytes === 0) {
        continue;
      }

      for (const destination of resolveVolumeDestinations(this.config, volumeId)) {
        if (!isDurableDestination(destination) || !destination.enabled) {
          continue;
        }
        const source = snapshot.sources.find((entry) => entry.id === destination.sourceId);
        if (!source || !source.enabled || !source.writable) {
          return 'blocked';
        }
        const usage = source.usage.volumeUsages.find((entry) => entry.volumeId === volumeId);
        const presentBytes = (usage?.historyBytes ?? 0) + (usage?.fileBytes ?? 0);
        if (presentBytes >= expectedBytes) {
          continue;
        }
        if (!source.exists || !source.isDirectory || !source.canWrite) {
          return 'blocked';
        }
        return 'repairable';
      }
    }

    return 'healthy';
  }

  async getRuntimeSnapshot(options: RuntimeSnapshotOptions = {}): Promise<MultiRootRuntimeSnapshot> {
    const includeUsage = options.includeUsage !== false;
    const buildSnapshot = async (): Promise<MultiRootRuntimeSnapshot> => {
      const referencedByVolume = includeUsage ? await this.getReferencedBlockHashIndex() : new Map<string, Set<string>>();
      const statuses = await Promise.all(
        this.rootStates.map((state) => this.getRootRuntimeStatus(state, referencedByVolume, { includeUsage }))
      );
      const writeFailures = Array.from(this.lastWriteFailures.values()).sort((left, right) => right.at - left.at);
      return {
        sources: statuses,
        writeFailures,
      };
    };

    if (!includeUsage) {
      return buildSnapshot();
    }

    if (this.runtimeSnapshotInFlight) {
      return this.runtimeSnapshotInFlight;
    }

    const snapshotTask = buildSnapshot();
    this.runtimeSnapshotInFlight = snapshotTask;
    try {
      return await snapshotTask;
    } finally {
      if (this.runtimeSnapshotInFlight === snapshotTask) {
        this.runtimeSnapshotInFlight = null;
      }
    }
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
      defaultVolume: {
        destinations: this.config.defaultVolume.destinations.filter(
          (destination) => destination.sourceId !== source.config.id
        ),
      },
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

  async resolveSourceConflicts(options: {
    readonly sourceIds?: readonly string[];
    readonly resetTargets?: boolean;
    readonly rewriteMarker?: boolean;
    readonly ensureMarker?: boolean;
  } = {}): Promise<SourceConflictResolutionResult> {
    const targetedStates =
      options.sourceIds && options.sourceIds.length > 0
        ? options.sourceIds
            .map((sourceId) => this.getRootStateById(sourceId))
            .filter((state): state is RootState => Boolean(state))
        : this.rootStates;
    const uniqueStates = Array.from(
      new Map(targetedStates.map((state) => [state.config.id, state])).values()
    );
    await this.reconcileConfiguredVolumes();

    let clearedSources = 0;
    if (options.resetTargets) {
      for (const state of uniqueStates) {
        if (await clearNearbytesSourceData(state.config.path)) {
          clearedSources += 1;
        }
      }
    }

    let rewrittenMarkers = 0;
    let removedLegacyMetadata = 0;

    for (const state of uniqueStates) {
      const normalized = await normalizeNearbytesRoot(state.config.path, {
        rewriteMarker: options.rewriteMarker ?? true,
        ensureMarker: options.ensureMarker,
      });
      if (normalized.createdMarker || normalized.rewroteMarker) {
        rewrittenMarkers += 1;
      }
      if (normalized.removedLegacyMetadata) {
        removedLegacyMetadata += 1;
      }
    }

    return {
      sourceIds: uniqueStates.map((state) => state.config.id),
      rewrittenMarkers,
      removedLegacyMetadata,
      clearedSources,
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

  async readValidatedFileForChannel(
    relativePath: string,
    channelKeyHex: string,
    validate: (data: Uint8Array) => Promise<IntegrityValidationResult>
  ): Promise<Uint8Array> {
    const normalizedChannel = channelKeyHex.toLowerCase();
    const prioritized = this.prioritizeRootsForChannel(normalizedChannel);
    return this.readValidatedFileFromRoots(relativePath, prioritized, validate);
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

  async readValidatedFile(
    relativePath: string,
    validate: (data: Uint8Array) => Promise<IntegrityValidationResult>
  ): Promise<Uint8Array> {
    return this.readValidatedFileFromRoots(relativePath, this.getEnabledRootStates(), validate);
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

  async inspectStorageLocation(
    sourceId: string,
    options: StorageLocationInspectOptions = {}
  ): Promise<StorageLocationRepairReport> {
    const state = this.getRootStateById(sourceId);
    if (!state) {
      throw new StorageError(`Source not found: ${sourceId}`);
    }
    const issues = await this.inspectStorageLocationIssues(state, options);
    return {
      sourceId,
      path: state.config.path,
      issueCount: issues.length,
      cleanupCandidateCount: issues.length,
      issues: issues.sort((left, right) => left.relativePath.localeCompare(right.relativePath)),
    };
  }

  async repairStorageLocation(
    sourceId: string,
    action: 'delete' | 'trash',
    options: StorageLocationRepairOptions = {}
  ): Promise<StorageLocationRepairResult> {
    const report = await this.inspectStorageLocation(sourceId, {
      validateContents: options.structuralOnly !== true,
    });
    const uniquePaths = Array.from(new Set(report.issues.map((issue) => issue.absolutePath))).sort();
    for (const targetPath of uniquePaths) {
      await removeIssuePath(targetPath, action);
    }
    return {
      sourceId,
      removedCount: uniquePaths.length,
      issueCount: report.issueCount,
      cleanupCandidateCount: report.cleanupCandidateCount,
      action,
    };
  }

  private async inspectStorageLocationIssues(
    state: RootState,
    options: StorageLocationInspectOptions = {}
  ): Promise<StorageLocationIssue[]> {
    const issues: StorageLocationIssue[] = [];
    const validateContents = options.validateContents !== false;
    await this.auditTopLevelEntries(state, issues);
    await this.auditBlocks(state, issues, validateContents);
    await this.auditChannels(state, issues, validateContents);
    return issues;
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

  private async readValidatedFileFromRoots(
    relativePath: string,
    states: RootState[],
    validate: (data: Uint8Array) => Promise<IntegrityValidationResult>
  ): Promise<Uint8Array> {
    let lastError: Error | undefined;
    for (const state of states) {
      try {
        const data = await state.backend.readFile(relativePath);
        const result = await validate(data);
        if (result.ok) {
          return data;
        }
        await state.backend.deleteFile(relativePath).catch(() => undefined);
        lastError = new StorageError(
          `Rejected invalid copy of ${relativePath} from ${state.config.id}${result.detail ? `: ${result.detail}` : ''}`
        );
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

  private async auditTopLevelEntries(state: RootState, issues: StorageLocationIssue[]): Promise<void> {
    const entries = await safeReadDir(state.config.path);
    for (const entry of entries) {
      if (entry.name === 'blocks' || entry.name === 'channels' || isNearbytesIgnoredTopLevelEntryName(entry.name)) {
        continue;
      }
      issues.push({
        code: 'unexpected-top-level-entry',
        severity: 'warn',
        relativePath: entry.name,
        absolutePath: join(state.config.path, entry.name),
        detail: `Unexpected top-level entry: ${entry.name}`,
      });
    }
  }

  private async auditBlocks(
    state: RootState,
    issues: StorageLocationIssue[],
    validateContents: boolean
  ): Promise<void> {
    const blocksPath = join(state.config.path, 'blocks');
    const entries = await safeReadDir(blocksPath);
    for (const entry of entries) {
      const relativePath = normalizeRelativePath(join('blocks', entry.name));
      const absolutePath = join(blocksPath, entry.name);
      if (entry.isDirectory()) {
        issues.push({
          code: 'invalid-block-file-name',
          severity: 'error',
          relativePath,
          absolutePath,
          detail: `Unexpected directory inside blocks: ${entry.name}`,
        });
        continue;
      }
      if (!entry.isFile()) {
        issues.push({
          code: 'invalid-block-file-name',
          severity: 'error',
          relativePath,
          absolutePath,
          detail: `Unexpected entry inside blocks: ${entry.name}`,
        });
        continue;
      }
      const blockMatch = entry.name.match(/^([a-f0-9]{64})\.bin$/i);
      if (!blockMatch) {
        issues.push({
          code: 'invalid-block-file-name',
          severity: 'error',
          relativePath,
          absolutePath,
          detail: `Invalid block filename: ${entry.name}`,
        });
        continue;
      }
      if (!validateContents) {
        continue;
      }
      const bytes = await fs.readFile(absolutePath).then((buffer) => new Uint8Array(buffer)).catch(() => null);
      if (!bytes) {
        continue;
      }
      const result = await validateBlockBytes(blockMatch[1] ?? '', bytes);
      if (!result.ok) {
        issues.push({
          code: 'block-hash-mismatch',
          severity: 'error',
          relativePath,
          absolutePath,
          detail: result.detail ?? `Hash mismatch for ${entry.name}`,
        });
      }
    }
  }

  private async auditChannels(
    state: RootState,
    issues: StorageLocationIssue[],
    validateContents: boolean
  ): Promise<void> {
    const channelsPath = join(state.config.path, 'channels');
    const channelEntries = await safeReadDir(channelsPath);
    for (const channelEntry of channelEntries) {
      const channelRelativePath = normalizeRelativePath(join('channels', channelEntry.name));
      const channelAbsolute = join(channelsPath, channelEntry.name);
      if (!channelEntry.isDirectory()) {
        issues.push({
          code: 'invalid-channel-directory',
          severity: 'error',
          relativePath: channelRelativePath,
          absolutePath: channelAbsolute,
          detail: `Unexpected entry inside channels: ${channelEntry.name}`,
        });
        continue;
      }
      if (!/^[a-f0-9]{130}$/i.test(channelEntry.name)) {
        issues.push({
          code: 'invalid-channel-directory',
          severity: 'error',
          relativePath: channelRelativePath,
          absolutePath: channelAbsolute,
          detail: `Invalid channel directory: ${channelEntry.name}`,
        });
        continue;
      }
      const eventEntries = await safeReadDir(channelAbsolute);
      for (const eventEntry of eventEntries) {
        const relativePath = normalizeRelativePath(join('channels', channelEntry.name, eventEntry.name));
        const absolutePath = join(channelAbsolute, eventEntry.name);
        if (eventEntry.isDirectory()) {
          issues.push({
            code: 'invalid-event-file-name',
            severity: 'error',
            relativePath,
            absolutePath,
            detail: `Unexpected directory inside channel: ${eventEntry.name}`,
          });
          continue;
        }
        if (!eventEntry.isFile()) {
          issues.push({
            code: 'invalid-event-file-name',
            severity: 'error',
            relativePath,
            absolutePath,
            detail: `Unexpected entry inside channel: ${eventEntry.name}`,
          });
          continue;
        }
        const eventMatch = eventEntry.name.match(/^([a-f0-9]{64})\.bin$/i);
        if (!eventMatch) {
          issues.push({
            code: 'invalid-event-file-name',
            severity: 'error',
            relativePath,
            absolutePath,
            detail: `Invalid event filename: ${eventEntry.name}`,
          });
          continue;
        }
        if (!validateContents) {
          continue;
        }
        const bytes = await fs.readFile(absolutePath).then((buffer) => new Uint8Array(buffer)).catch(() => null);
        if (!bytes) {
          continue;
        }
        const result = await validateEventBytes(channelEntry.name, eventMatch[1] ?? '', bytes);
        if (!result.ok) {
          issues.push({
            code: (result.code as StorageLocationIssue['code']) ?? 'event-deserialize-failed',
            severity: 'error',
            relativePath,
            absolutePath,
            detail: result.detail ?? `Invalid event file: ${eventEntry.name}`,
          });
        }
      }
    }
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
      allowPublishedBlocks: isBlockWrite,
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
    options: { requireBlocks: boolean; allowPublishedBlocks?: boolean }
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
      if (options.requireBlocks && !destination.storeBlocks) {
        continue;
      }
      if (options.requireBlocks && !options.allowPublishedBlocks && !destination.copySourceBlocks) {
        continue;
      }
      targets.push({ state, policy: destination });
    }
    return targets;
  }

  private getWritableVolumeDestinationTargets(
    channelKeyHex: string,
    options: { requireBlocks: boolean; allowPublishedBlocks?: boolean }
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

    const blockTargets = this.getWritableVolumeDestinationTargets(volumeId, {
      requireBlocks: true,
      allowPublishedBlocks: false,
    });
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

  private async collectUnknownProvenanceBlocksToLocalRoot(): Promise<void> {
    const target = this.getPreferredLocalCollectionRoot();
    if (!target) {
      return;
    }

    const referencedHashes = await this.collectReferencedBlockHashesAcrossStates(this.rootStates);
    const targetBlocksDir = join(target.config.path, 'blocks');
    await fs.mkdir(targetBlocksDir, { recursive: true });
    await ensureNearbytesMarker(target.config.path);

    for (const source of this.rootStates) {
      if (source.config.id === target.config.id) {
        continue;
      }

      const blocksDir = join(source.config.path, 'blocks');
      const entries = await safeReadDirEntries(blocksDir);
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.bin')) {
          continue;
        }

        const hash = entry.name.slice(0, -4).toLowerCase();
        if (!/^[a-f0-9]{64}$/i.test(hash) || referencedHashes.has(hash)) {
          continue;
        }

        const sourceAbsolute = join(blocksDir, entry.name);
        const destinationAbsolute = join(targetBlocksDir, entry.name);
        const stats = await safeStat(sourceAbsolute);
        if (!stats || !stats.isFile()) {
          continue;
        }

        if (await fileExists(destinationAbsolute)) {
          await safeUnlink(sourceAbsolute);
          continue;
        }

        await fs.mkdir(dirname(destinationAbsolute), { recursive: true });
        try {
          await fs.rename(sourceAbsolute, destinationAbsolute);
        } catch (error) {
          if (!isCrossDeviceError(error)) {
            throw new StorageError(`Failed to collect ${entry.name} into local storage: ${asError(error).message}`, asError(error));
          }
          await fs.copyFile(sourceAbsolute, destinationAbsolute);
          await safeUnlink(sourceAbsolute);
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
    return this.listTrackedVolumeIdsInStates(this.getEnabledRootStates());
  }

  private async listTrackedVolumeIdsInStates(states: readonly RootState[]): Promise<Set<string>> {
    const volumeIds = new Set<string>(this.config.volumes.map((volume) => volume.volumeId));
    for (const state of states) {
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
    return this.collectReferencedBlockHashesForStates(volumeId, this.prioritizeRootsForChannel(volumeId));
  }

  private async collectReferencedBlockHashesForStates(volumeId: string, states: readonly RootState[]): Promise<Set<string>> {
    const hashes = new Set<string>();
    const directory = `channels/${volumeId}`;
    const eventFiles = await this.listFilesAcrossStates(directory, states);

    for (const eventFile of eventFiles) {
      if (!eventFile.endsWith('.bin')) {
        continue;
      }
      const relativePath = `${directory}/${eventFile}`;
      let bytes: Uint8Array;
      try {
        bytes = await this.readFileFromRoots(relativePath, Array.from(states));
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

  private async collectReferencedBlockHashesAcrossStates(states: readonly RootState[]): Promise<Set<string>> {
    const hashes = new Set<string>();
    const volumeIds = await this.listTrackedVolumeIdsInStates(states);
    for (const volumeId of volumeIds) {
      const referenced = await this.collectReferencedBlockHashesForStates(volumeId, states);
      for (const hash of referenced) {
        hashes.add(hash);
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
      if (NEARBYTES_IGNORED_ROOT_FILES.includes(file.relativePath as (typeof NEARBYTES_IGNORED_ROOT_FILES)[number])) {
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
    referencedByVolume: ReadonlyMap<string, Set<string>>,
    options: RuntimeSnapshotOptions = {}
  ): Promise<RootRuntimeStatus> {
    const includeUsage = options.includeUsage !== false;
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

      if (includeUsage) {
        usage = await this.collectSourceUsageSummary(state, referencedByVolume);
      }
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

  private getPreferredLocalCollectionRoot(): RootState | undefined {
    return (
      this.rootStates.find((state) => state.config.provider === 'local' && state.config.enabled && state.config.writable) ??
      this.rootStates.find((state) => state.config.provider === 'local' && state.config.writable) ??
      this.rootStates.find((state) => state.config.provider === 'local')
    );
  }

  private async listFilesAcrossStates(directory: string, states: readonly RootState[]): Promise<string[]> {
    const files = new Set<string>();
    for (const state of states) {
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
      if (NEARBYTES_IGNORED_ROOT_FILES.includes(entry.name as (typeof NEARBYTES_IGNORED_ROOT_FILES)[number])) {
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

async function clearNearbytesSourceData(rootPath: string): Promise<boolean> {
  const blocksPath = join(rootPath, 'blocks');
  const channelsPath = join(rootPath, 'channels');
  const hadBlocks = Boolean(await safeStat(blocksPath));
  const hadChannels = Boolean(await safeStat(channelsPath));
  const markerPaths = NEARBYTES_IGNORED_ROOT_FILES.map((name) => join(rootPath, name));

  await fs.rm(blocksPath, { recursive: true, force: true });
  await fs.rm(channelsPath, { recursive: true, force: true });
  await Promise.all(markerPaths.map((targetPath) => fs.rm(targetPath, { force: true })));

  return hadBlocks || hadChannels;
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

async function safeReadDir(directory: string): Promise<import('fs').Dirent[]> {
  try {
    return await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    const code = extractFsErrorCode(error);
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return [];
    }
    throw error;
  }
}

async function removeIssuePath(targetPath: string, action: 'delete' | 'trash'): Promise<void> {
  if (action === 'trash') {
    await movePathToTrash(targetPath).catch(() => fs.rm(targetPath, { recursive: true, force: true }));
    return;
  }
  await fs.rm(targetPath, { recursive: true, force: true });
}

async function movePathToTrash(targetPath: string): Promise<void> {
  const launcher =
    process.platform === 'darwin'
      ? {
          command: 'osascript',
          args: ['-e', `tell application "Finder" to delete POSIX file ${appleScriptString(targetPath)}`],
        }
      : process.platform === 'win32'
        ? {
            command: 'powershell',
            args: [
              '-NoProfile',
              '-Command',
              `Add-Type -AssemblyName Microsoft.VisualBasic; $path = ${powerShellString(targetPath)}; if (Test-Path -LiteralPath $path -PathType Container) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($path,'OnlyErrorDialogs','SendToRecycleBin') } else { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($path,'OnlyErrorDialogs','SendToRecycleBin') }`,
            ],
          }
        : {
            command: 'gio',
            args: ['trash', targetPath],
          };

  await new Promise<void>((resolve, reject) => {
    const child = require('child_process').spawn(launcher.command, launcher.args, {
      stdio: 'ignore',
    });
    child.once('error', reject);
    child.once('exit', (code: number | null) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Trash command exited with code ${code ?? -1}`));
    });
  });
}

function appleScriptString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function powerShellString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function extractFsErrorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error && typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : undefined;
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
