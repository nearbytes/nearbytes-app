import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { Router } from 'express';
import { promises as fs } from 'fs';
import os from 'os';
import multer from 'multer';
import { parseRootsConfig, saveRootsConfig } from '../config/roots.js';
import { discoverNearbytesSources, ensureNearbytesMarkers } from '../config/sourceDiscovery.js';
import type { CryptoOperations } from '../crypto/index.js';
import type { FileService } from '../domain/fileService.js';
import type { StorageBackend } from '../types/storage.js';
import { openVolume } from '../domain/volume.js';
import { bytesToHex } from '../utils/encoding.js';
import { MultiRootStorageBackend, isMultiRootStorageBackend } from '../storage/multiRoot.js';
import { ApiError } from './errors.js';
import { encodeSecretToken, getSecretFromRequest, validateSecret } from './auth.js';
import { VolumeWatchHub } from './volumeWatchHub.js';
import {
  getStorageDiagnostics,
  getChannelDiagnostics,
} from './storageDiagnostics.js';
import {
  fileHashParamSchema,
  fileNameParamSchema,
  openBodySchema,
  parseWithSchema,
  uploadFieldsSchema,
} from './validation.js';

/**
 * Dependencies required to register API routes.
 */
export interface RouteDependencies {
  readonly fileService: FileService;
  readonly crypto: CryptoOperations;
  readonly storage: StorageBackend;
  readonly tokenKey?: Uint8Array;
  readonly maxUploadBytes: number;
  /** Resolved absolute storage path; used for debug endpoints. */
  readonly resolvedStorageDir?: string;
  /** Absolute roots config path for /config/roots endpoints. */
  readonly rootsConfigPath?: string;
}

/**
 * Builds the API routes for the Nearbytes file server.
 */
export function createRoutes(deps: RouteDependencies): Router {
  const router = Router();
  const watchHub = new VolumeWatchHub(deps.storage, deps.resolvedStorageDir);
  const upload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, callback) => callback(null, os.tmpdir()),
      filename: (_req, _file, callback) =>
        callback(null, `nearbytes-${Date.now()}-${Math.random().toString(16).slice(2)}`),
    }),
    limits: {
      fileSize: deps.maxUploadBytes,
    },
  });

  router.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  router.get('/config/roots', asyncHandler(async (req, res) => {
    assertLocalConfigRequest(req);
    const multiRootStorage = getMultiRootStorageOrThrow(deps.storage);
    await ensureNearbytesMarkers(multiRootStorage.getRootsConfig().roots);
    const runtime = await multiRootStorage.getRuntimeSnapshot();
    res.json({
      configPath: deps.rootsConfigPath ?? null,
      config: multiRootStorage.getRootsConfig(),
      runtime,
    });
  }));

  router.put('/config/roots', asyncHandler(async (req, res) => {
    assertLocalConfigRequest(req);
    if (!deps.rootsConfigPath) {
      throw new ApiError(500, 'INTERNAL_ERROR', 'Roots config path is not configured');
    }

    const candidate = extractRootsConfigBody(req.body);
    let nextConfig;
    try {
      nextConfig = parseRootsConfig(candidate);
    } catch (error) {
      throw new ApiError(
        400,
        'INVALID_REQUEST',
        error instanceof Error ? error.message : 'Invalid roots config'
      );
    }

    await saveRootsConfig(deps.rootsConfigPath, nextConfig);
    const multiRootStorage = getMultiRootStorageOrThrow(deps.storage);
    multiRootStorage.updateRootsConfig(nextConfig);
    await ensureNearbytesMarkers(nextConfig.roots);
    const runtime = await multiRootStorage.getRuntimeSnapshot();

    res.json({
      configPath: deps.rootsConfigPath,
      config: nextConfig,
      runtime,
    });
  }));

  router.get('/sources/discover', asyncHandler(async (req, res) => {
    assertLocalConfigRequest(req);
    const maxDepth = parseOptionalInt(req.query.maxDepth);
    const maxDirectories = parseOptionalInt(req.query.maxDirectories);
    const sources = await discoverNearbytesSources({
      maxDepth,
      maxDirectories,
    });

    res.json({
      scannedAt: Date.now(),
      sourceCount: sources.length,
      sources,
    });
  }));

  if (deps.resolvedStorageDir) {
    router.get('/__debug/storage', asyncHandler(async (_req, res) => {
      const result = await getStorageDiagnostics(deps.resolvedStorageDir!);
      res.json({
        storageDirAbs: result.storageDirAbs,
        channelsDirAbs: result.channelsDirAbs,
        blocksDirAbs: result.blocksDirAbs,
        channelsCount: result.channelsCount,
        blocksCount: result.blocksCount,
        sampleChannels: result.channelIds.slice(0, 5),
        megaHints: result.megaHints,
      });
    }));

    router.get('/__debug/channel/:id', asyncHandler(async (req, res) => {
      const id = (req.params as { id?: string }).id;
      if (!id || !/^[a-f0-9]+$/i.test(id) || id.length < 32 || id.length > 200) {
        throw new ApiError(400, 'INVALID_REQUEST', 'Channel id must be hex string (e.g. public key hex)');
      }
      const result = await getChannelDiagnostics(deps.resolvedStorageDir!, id);
      res.json(result);
    }));
  }

  router.post(
    '/open',
    asyncHandler(async (req, res) => {
      const { secret } = parseWithSchema(openBodySchema, req.body);
      const validatedSecret = validateSecret(secret);
      const volumeId = await getVolumeId(validatedSecret, deps.crypto, deps.storage);
      const files = await deps.fileService.listFiles(validatedSecret);

      const response: {
        volumeId: string;
        fileCount: number;
        files: ReturnType<typeof mapFile>[];
        token?: string;
        storageHint?: string;
      } = {
        volumeId,
        fileCount: files.length,
        files: files.map(mapFile),
      };

      if (deps.tokenKey) {
        response.token = await encodeSecretToken(validatedSecret, deps.tokenKey);
      }

      if (files.length === 0 && deps.resolvedStorageDir) {
        const diag = await getStorageDiagnostics(deps.resolvedStorageDir);
        if (diag.blocksCount === 0 && !diag.channelsDirExists) {
          response.storageHint =
            'Storage directory appears empty. Verify NEARBYTES_STORAGE_DIR points to the folder containing /blocks and /channels.';
        } else if (diag.blocksCount === 0 && diag.channelsCount <= 1) {
          const channelDiag = await getChannelDiagnostics(deps.resolvedStorageDir, volumeId);
          if (channelDiag.eventFiles.length === 0) {
            response.storageHint =
              'Storage directory appears empty. Verify NEARBYTES_STORAGE_DIR points to the folder containing /blocks and /channels.';
          }
        }
      }

      res.json(response);
    })
  );

  router.get(
    '/files',
    requireSecret(deps),
    asyncHandler(async (_req, res) => {
      const secret = res.locals.secret as string;
      const volumeId = await getVolumeId(secret, deps.crypto, deps.storage);
      const files = await deps.fileService.listFiles(secret);
      res.json({
        volumeId,
        files: files.map(mapFile),
      });
    })
  );

  router.get('/watch/volume', requireSecret(deps), async (req, res, next) => {
    try {
      const secret = res.locals.secret as string;
      const volumeId = await getVolumeId(secret, deps.crypto, deps.storage);

      const subscription = watchHub.subscribe(
        volumeId,
        (update) => writeSseEvent(res, 'volume-update', update),
        (error) =>
          writeSseEvent(res, 'watch-error', {
            volumeId,
            message: error.message,
            timestamp: Date.now(),
          })
      );

      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();

      writeSseEvent(res, 'watch-ready', subscription.ready);

      if (!subscription.ready.autoUpdate) {
        writeSseEvent(res, 'watch-ended', {
          volumeId,
          reason: 'Auto-update is unavailable for the active storage roots.',
          timestamp: Date.now(),
        });
        res.end();
        subscription.unsubscribe();
        return;
      }

      const heartbeatTimer = setInterval(() => {
        writeSseEvent(res, 'heartbeat', { timestamp: Date.now() });
      }, 20000);

      req.on('close', () => {
        clearInterval(heartbeatTimer);
        subscription.unsubscribe();
        res.end();
      });
    } catch (error) {
      next(error);
    }
  });

  router.get(
    '/timeline',
    requireSecret(deps),
    asyncHandler(async (_req, res) => {
      const secret = res.locals.secret as string;
      const volumeId = await getVolumeId(secret, deps.crypto, deps.storage);
      const events = await deps.fileService.getTimeline(secret);
      res.json({
        volumeId,
        eventCount: events.length,
        events,
      });
    })
  );

  router.post(
    '/snapshot',
    requireSecret(deps),
    asyncHandler(async (_req, res) => {
      const secret = res.locals.secret as string;
      const snapshot = await deps.fileService.computeSnapshot(secret);
      res.json({ snapshot });
    })
  );

  router.post(
    '/upload',
    requireSecret(deps),
    upload.single('file'),
    asyncHandler(async (req, res) => {
      if (!req.file) {
        throw new ApiError(400, 'INVALID_REQUEST', 'File is required');
      }

      const fields = parseWithSchema(uploadFieldsSchema, req.body);
      const secret = res.locals.secret as string;
      const overrideName = fields.filename?.trim();
      const filename = overrideName && overrideName.length > 0 ? overrideName : req.file.originalname;

      if (!filename || filename.trim().length === 0) {
        throw new ApiError(400, 'INVALID_REQUEST', 'Filename is required');
      }

      const overrideMime = fields.mimeType?.trim();
      const mimeType =
        overrideMime && overrideMime.length > 0 ? overrideMime : req.file.mimetype || undefined;

      const fileBuffer = await fs.readFile(req.file.path);
      try {
        const created = await deps.fileService.addFile(secret, filename, fileBuffer, mimeType);
        res.json({ created: mapFile(created) });
      } finally {
        await safeUnlink(req.file.path);
      }
    })
  );

  router.delete(
    '/files/:name',
    requireSecret(deps),
    asyncHandler(async (req, res) => {
      const { name } = parseWithSchema(fileNameParamSchema, req.params);
      const filename = decodeParam(name, 'filename');
      const secret = res.locals.secret as string;
      await deps.fileService.deleteFile(secret, filename);
      res.json({ deleted: true, filename });
    })
  );

  router.get(
    '/file/:hash',
    requireSecret(deps),
    asyncHandler(async (req, res) => {
      const { hash } = parseWithSchema(fileHashParamSchema, req.params);
      const secret = res.locals.secret as string;
      const data = await deps.fileService.getFile(secret, hash);

      // TODO: Replace with hash lookup to avoid replaying the log each request.
      const files = await deps.fileService.listFiles(secret);
      const match = files.find((file) => file.blobHash === hash);
      const filename = match?.filename ?? `${hash}.bin`;
      const mimeType = match?.mimeType ?? 'application/octet-stream';

      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${sanitizeFilename(filename)}"`);
      res.send(data);
    })
  );

  return router;
}

function requireSecret(deps: RouteDependencies): RequestHandler {
  return (req, res, next) => {
    void getSecretFromRequest(req, { tokenKey: deps.tokenKey })
      .then((secret) => {
        res.locals.secret = secret;
        next();
      })
      .catch((error: unknown) => next(error));
  };
}

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

function asyncHandler(handler: AsyncHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

async function getVolumeId(
  secret: string,
  crypto: CryptoOperations,
  storage: StorageBackend
): Promise<string> {
  const volume = await openVolume(validateSecret(secret), crypto, storage);
  return bytesToHex(volume.publicKey);
}

function mapFile(file: {
  filename: string;
  blobHash: string;
  size: number;
  mimeType?: string;
  createdAt: number;
}): {
  filename: string;
  blobHash: string;
  size: number;
  mimeType?: string;
  createdAt: number;
} {
  return {
    filename: file.filename,
    blobHash: file.blobHash,
    size: file.size,
    mimeType: file.mimeType,
    createdAt: file.createdAt,
  };
}

function decodeParam(value: string, label: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new ApiError(400, 'INVALID_REQUEST', `Invalid ${label}`);
  }
}

function sanitizeFilename(value: string): string {
  return value.replace(/[\r\n"]/g, '_');
}

async function safeUnlink(path: string): Promise<void> {
  try {
    await fs.unlink(path);
  } catch {
    // Ignore cleanup errors for temp files.
  }
}

function extractRootsConfigBody(value: unknown): unknown {
  if (!value || typeof value !== 'object' || !('config' in value)) {
    return value;
  }
  return (value as { config: unknown }).config;
}

function getMultiRootStorageOrThrow(storage: StorageBackend): MultiRootStorageBackend {
  if (!isMultiRootStorageBackend(storage)) {
    throw new ApiError(501, 'NOT_IMPLEMENTED', 'Multi-root storage is not enabled');
  }
  return storage;
}

function assertLocalConfigRequest(req: Request): void {
  const forwardedFor = req.get('x-forwarded-for');
  if (forwardedFor) {
    const first = forwardedFor.split(',')[0]?.trim();
    if (first && !isLoopbackAddress(first)) {
      throw new ApiError(403, 'FORBIDDEN', 'Config endpoints are local-only');
    }
  }

  const candidates = [req.ip, req.socket.remoteAddress];
  if (candidates.some((candidate) => isLoopbackAddress(candidate))) {
    return;
  }

  throw new ApiError(403, 'FORBIDDEN', 'Config endpoints are local-only');
}

function parseOptionalInt(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') {
    return undefined;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
    return undefined;
  }
  return parsed;
}

function writeSseEvent(res: Response, eventName: string, payload: unknown): void {
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function isLoopbackAddress(value: string | undefined): boolean {
  if (!value) return false;

  const normalized = value.trim().toLowerCase();
  if (normalized === '127.0.0.1' || normalized === '::1') {
    return true;
  }
  if (normalized.startsWith('::ffff:')) {
    return normalized.slice('::ffff:'.length) === '127.0.0.1';
  }
  return false;
}
