import path from 'path';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import type express from 'express';
import { createCryptoOperations } from '../crypto/index.js';
import { createChatService } from '../domain/chatService.js';
import { createFileService } from '../domain/fileService.js';
import { getDefaultStorageDir } from '../storagePath.js';
import { loadOrCreateRootsConfig, saveRootsConfig, type RootsConfig } from '../config/roots.js';
import { ensureNearbytesMarkers } from '../config/sourceDiscovery.js';
import { MultiRootStorageBackend } from '../storage/multiRoot.js';
import { createApp } from './app.js';

export interface RuntimeLogger {
  readonly log: (...args: unknown[]) => void;
  readonly warn: (...args: unknown[]) => void;
}

export interface ApiRuntimeOptions {
  readonly host?: string;
  readonly port?: number;
  readonly defaultStorageDir?: string;
  readonly rootsConfigPath?: string;
  readonly corsOrigin?: string | string[] | boolean;
  readonly maxUploadBytes?: number;
  readonly tokenKey?: Uint8Array;
  readonly desktopApiToken?: string;
  readonly uiDistPath?: string;
  readonly logger?: RuntimeLogger;
}

export interface ApiRuntimeHandle {
  readonly app: express.Express;
  readonly server: Server;
  readonly host: string;
  readonly port: number;
  readonly defaultStorageDir: string;
  readonly rootsConfigPath: string;
  readonly primaryMainRoot: string;
  stop(): Promise<void>;
}

const DEFAULT_HOST = '0.0.0.0';
const DEFAULT_PORT = 3000;
const DEFAULT_MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
let latestStop: (() => Promise<void>) | null = null;

/**
 * Starts the Nearbytes API runtime and returns a stop handle.
 * This is shared by CLI server mode and Electron desktop mode.
 */
export async function startApiRuntime(options: ApiRuntimeOptions = {}): Promise<ApiRuntimeHandle> {
  const logger = options.logger ?? console;
  const host = options.host ?? DEFAULT_HOST;
  const port = options.port ?? DEFAULT_PORT;
  const defaultStorageDir = path.resolve(options.defaultStorageDir ?? getDefaultStorageDir());
  const corsOrigin = options.corsOrigin ?? 'http://localhost:5173';
  const maxUploadBytes = options.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES;
  const tokenKey = options.tokenKey;

  const crypto = createCryptoOperations();
  const loaded = await loadOrCreateRootsConfig({
    configPath: options.rootsConfigPath,
    defaultRootPath: defaultStorageDir,
  });
  if (loaded.created) {
    logger.log(`Created default roots config at: ${loaded.configPath}`);
  }

  const markerResults = await ensureNearbytesMarkers(loaded.config.sources);
  const markerFailures = markerResults.filter((entry) => !entry.ok);
  if (markerFailures.length > 0) {
    for (const failure of markerFailures) {
      logger.warn(
        `Warning: failed to ensure Nearbytes.html marker for source ${failure.rootId} (${failure.path}): ${failure.error}`
      );
    }
  }

  const storage = new MultiRootStorageBackend(loaded.config);
  await resumePendingSourceMoves(storage, loaded.configPath, logger);
  const fileService = createFileService({ crypto, storage });
  const chatService = createChatService({ crypto, storage });
  const primaryMainRoot =
    storage
      .getRootsConfig()
      .defaultVolume.destinations
      .map((destination) => storage.getRootsConfig().sources.find((source) => source.id === destination.sourceId))
      .find((source) => source?.enabled)?.path ?? defaultStorageDir;

  await storage.createDirectory('channels');
  await storage.createDirectory('blocks');
  await storage.reconcileConfiguredVolumes();

  const app = createApp({
    fileService,
    chatService,
    crypto,
    storage,
    tokenKey,
    corsOrigin,
    maxUploadBytes,
    resolvedStorageDir: primaryMainRoot,
    rootsConfigPath: loaded.configPath,
    desktopApiToken: options.desktopApiToken,
    uiDistPath: options.uiDistPath,
  });

  const server = await listen(app, host, port);
  const bound = getBoundPort(server);

  const stop = createStop(server);
  latestStop = stop;

  return {
    app,
    server,
    host,
    port: bound,
    defaultStorageDir,
    rootsConfigPath: loaded.configPath,
    primaryMainRoot,
    stop,
  };
}

async function resumePendingSourceMoves(
  storage: MultiRootStorageBackend,
  rootsConfigPath: string,
  logger: RuntimeLogger
): Promise<void> {
  let progressed = true;
  while (progressed) {
    progressed = false;
    const config = storage.getRootsConfig();
    const pendingTargets = config.sources.filter(
      (source) => typeof source.moveFromSourceId === 'string' && source.moveFromSourceId.trim().length > 0
    );
    if (pendingTargets.length === 0) {
      return;
    }

    for (const target of pendingTargets) {
      const sourceId = target.moveFromSourceId!;
      const source = config.sources.find((entry) => entry.id === sourceId);
      if (!source) {
        const cleared = clearPendingMoveMarker(config, target.id);
        storage.updateRootsConfig(cleared);
        await saveRootsConfig(rootsConfigPath, cleared);
        logger.warn(`Cleared stale pending storage move marker on ${target.id}; source ${sourceId} no longer exists.`);
        progressed = true;
        break;
      }

      try {
        const consolidated = await storage.consolidateRoot(source.id, target.id);
        storage.updateRootsConfig(consolidated.config);
        await saveRootsConfig(rootsConfigPath, consolidated.config);
        logger.log(`Resumed pending storage move from ${source.id} to ${target.id}.`);
        progressed = true;
        break;
      } catch (error) {
        logger.warn(
          `Warning: failed to resume pending storage move from ${source.id} to ${target.id}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
  }
}

function clearPendingMoveMarker(config: RootsConfig, targetSourceId: string): RootsConfig {
  return {
    version: config.version,
    sources: config.sources.map((source) =>
      source.id === targetSourceId ? { ...source, moveFromSourceId: undefined } : source
    ),
    defaultVolume: config.defaultVolume,
    volumes: config.volumes,
  };
}

/**
 * Stops the most recently started API runtime, if any.
 * Intended for embedders that prefer module-level lifecycle calls.
 */
export async function stopApiRuntime(): Promise<void> {
  const stop = latestStop;
  latestStop = null;
  if (!stop) {
    return;
  }
  await stop();
}

function listen(app: express.Express, host: string, port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host);
    server.once('error', reject);
    server.once('listening', () => resolve(server));
  });
}

function getBoundPort(server: Server): number {
  const address = server.address();
  if (!address) {
    return DEFAULT_PORT;
  }
  if (typeof address === 'string') {
    return DEFAULT_PORT;
  }
  return (address as AddressInfo).port;
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function createStop(server: Server): () => Promise<void> {
  let stopped = false;
  const stopFn = async () => {
    if (stopped) {
      return;
    }
    stopped = true;
    await closeServer(server);
    if (latestStop === stopFn) {
      latestStop = null;
    }
  };
  return stopFn;
}
