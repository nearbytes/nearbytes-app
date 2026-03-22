import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { Router } from 'express';
import { spawn } from 'child_process';
import { timingSafeEqual } from 'crypto';
import { promises as fs, constants as fsConstants } from 'fs';
import { dirname, join, resolve } from 'path';
import os from 'os';
import multer from 'multer';
import { getSourceById, parseRootsConfig, saveRootsConfig } from '../config/roots.js';
import { discoverNearbytesSources, ensureNearbytesMarkers } from '../config/sourceDiscovery.js';
import { reconcileDiscoveredSources } from '../config/sourceReconcile.js';
import type { CryptoOperations } from '../crypto/index.js';
import type { ChatService } from '../domain/chatService.js';
import type { FileService } from '../domain/fileService.js';
import type { StorageBackend } from '../types/storage.js';
import { openVolume } from '../domain/volume.js';
import { joinLinkSpaceToSecretString } from '../domain/joinLinkCodec.js';
import {
  ManagedShareService,
  ManagedShareServiceError,
  type ManagedShareServiceOptions,
} from '../integrations/managedShares.js';
import { isProviderEnabled } from '../config/appConfig.js';
import { bytesToHex } from '../utils/encoding.js';
import { MultiRootStorageBackend, isMultiRootStorageBackend } from '../storage/multiRoot.js';
import { ApiError } from './errors.js';
import { encodeSecretToken, getSecretFromRequest, validateSecret } from './auth.js';
import type { SecretSessionStore } from './secretSessions.js';
import { VolumeWatchHub } from './volumeWatchHub.js';
import { SourceWatchHub } from './sourceWatchHub.js';
import {
  getStorageDiagnostics,
  getChannelDiagnostics,
} from './storageDiagnostics.js';
import type { UiDebugExecutor } from './uiDebug.js';
import {
  consolidateRootBodySchema,
  consolidateRootParamSchema,
  configureProviderBodySchema,
  connectProviderAccountBodySchema,
  createManagedShareBodySchema,
  inviteManagedShareBodySchema,
  attachManagedShareBodySchema,
  acceptManagedShareBodySchema,
  acceptProviderContactInviteBodySchema,
  exportRecipientReferencesBodySchema,
  exportReferencesBodySchema,
  fileHashParamSchema,
  fileNameParamSchema,
  importRecipientReferencesBodySchema,
  importSourceReferencesBodySchema,
  managedShareIdParamSchema,
  openPathInFileManagerBodySchema,
  openRootInFileManagerBodySchema,
  repairStorageLocationBodySchema,
  openJoinLinkBodySchema,
  openBodySchema,
  parseWithSchema,
  parseJoinLinkBodySchema,
  providerAccountIdParamSchema,
  providerIdParamSchema,
  publishIdentityBodySchema,
  reconcileDiscoveredSourcesBodySchema,
  renameFileBodySchema,
  renameFolderBodySchema,
  runUiDebugActionsBodySchema,
  sourceIdParamSchema,
  uiDebugDomSnapshotBodySchema,
  uiDebugScreenshotBodySchema,
  sendChatMessageBodySchema,
  uploadFieldsSchema,
} from './validation.js';

/**
 * Dependencies required to register API routes.
 */
export interface RouteDependencies {
  readonly fileService: FileService;
  readonly chatService: ChatService;
  readonly crypto: CryptoOperations;
  readonly storage: StorageBackend;
  readonly tokenKey?: Uint8Array;
  readonly sessionStore?: SecretSessionStore;
  readonly maxUploadBytes: number;
  /** Resolved absolute storage path; used for debug endpoints. */
  readonly resolvedStorageDir?: string;
  /** Absolute roots config path for /config/roots endpoints. */
  readonly rootsConfigPath?: string;
  /** Optional runtime token required in desktop mode. */
  readonly desktopApiToken?: string;
  /** Optional overrides for managed provider integrations. */
  readonly integrationOptions?: Omit<ManagedShareServiceOptions, 'storage' | 'rootsConfigPath'>;
  /** Optional pre-built service, mainly for tests. */
  readonly managedShareService?: ManagedShareService;
  /** Optional desktop-only UI automation/debugging bridge. */
  readonly uiDebugExecutor?: UiDebugExecutor;
}

/**
 * Builds the API routes for the Nearbytes file server.
 */
export function createRoutes(deps: RouteDependencies): Router {
  const router = Router();
  const watchHub = new VolumeWatchHub(deps.storage, deps.resolvedStorageDir);
  const sourceWatchHub = new SourceWatchHub();
  const managedShareService =
    deps.managedShareService ??
    (deps.rootsConfigPath && isMultiRootStorageBackend(deps.storage)
      ? new ManagedShareService({
          storage: deps.storage,
          rootsConfigPath: deps.rootsConfigPath,
          readMaintenanceMode: 'background',
          ...deps.integrationOptions,
        })
      : null);
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

  if (isProviderEnabled('gdrive')) {
    router.get('/oauth/google/callback', asyncHandler(async (req, res) => {
      const service = getManagedShareServiceOrThrow(managedShareService);
      const query = toUrlSearchParams(req.query);
      const html = await service.handleProviderCallback('gdrive', query);
      res.type('html').send(html);
    }));
  }

  if (deps.desktopApiToken) {
    router.use((req, _res, next) => {
      if (!isDesktopProtectedApiPath(req.path) || req.path === '/health') {
        next();
        return;
      }
      const providedToken = req.get('x-nearbytes-desktop-token');
      if (!providedToken || !tokensEqual(providedToken, deps.desktopApiToken!)) {
        next(new ApiError(401, 'UNAUTHORIZED', 'Missing or invalid desktop token'));
        return;
      }
      next();
    });
  }

  router.get('/config/roots', asyncHandler(async (req, res) => {
    assertLocalConfigRequest(req);
    const multiRootStorage = getMultiRootStorageOrThrow(deps.storage);
    const includeUsage = req.query.includeUsage === '1';
    void ensureNearbytesMarkers(multiRootStorage.getRootsConfig().sources).catch(() => undefined);
    const runtime = await multiRootStorage.getRuntimeSnapshot({ includeUsage });
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
    multiRootStorage.scheduleReconcileConfiguredVolumes();
    await ensureNearbytesMarkers(nextConfig.sources);
    const runtime = await multiRootStorage.getRuntimeSnapshot();

    res.json({
      configPath: deps.rootsConfigPath,
      config: nextConfig,
      runtime,
    });
  }));

  router.get('/config/roots/consolidate/:sourceId/plan', asyncHandler(async (req, res) => {
    assertLocalConfigRequest(req);
    const multiRootStorage = getMultiRootStorageOrThrow(deps.storage);
    const { sourceId } = parseWithSchema(consolidateRootParamSchema, req.params);
    const plan = await multiRootStorage.getConsolidationPlan(sourceId);
    res.json({ plan });
  }));

  router.post('/config/roots/consolidate', asyncHandler(async (req, res) => {
    assertLocalConfigRequest(req);
    if (!deps.rootsConfigPath) {
      throw new ApiError(500, 'INTERNAL_ERROR', 'Roots config path is not configured');
    }

    const { sourceId, targetId } = parseWithSchema(consolidateRootBodySchema, req.body);
    const multiRootStorage = getMultiRootStorageOrThrow(deps.storage);
    const consolidated = await multiRootStorage.consolidateRoot(sourceId, targetId);
    await saveRootsConfig(deps.rootsConfigPath, consolidated.config);
    await ensureNearbytesMarkers(consolidated.config.sources);
    const runtime = await multiRootStorage.getRuntimeSnapshot();

    res.json({
      result: consolidated.result,
      configPath: deps.rootsConfigPath,
      config: consolidated.config,
      runtime,
    });
  }));

  const openRootInFileManagerHandler = asyncHandler(async (req, res) => {
    assertLocalConfigRequest(req);
    const { rootId } = parseWithSchema(openRootInFileManagerBodySchema, req.body);
    const multiRootStorage = getMultiRootStorageOrThrow(deps.storage);
    const source = getSourceById(multiRootStorage.getRootsConfig(), rootId);
    if (!source) {
      throw new ApiError(404, 'NOT_FOUND', `Source not found: ${rootId}`);
    }

    await openInFileManager(source.path);
    res.json({
      ok: true,
      rootId: source.id,
      path: source.path,
    });
  });
  router.post('/config/roots/open-file-manager', openRootInFileManagerHandler);
  router.post('/config/open-file-manager', openRootInFileManagerHandler);

  router.get('/config/roots/sources/:sourceId/repair', asyncHandler(async (req, res) => {
    assertLocalConfigRequest(req);
    const multiRootStorage = getMultiRootStorageOrThrow(deps.storage);
    const { sourceId } = parseWithSchema(sourceIdParamSchema, req.params);
    res.json({
      report: await multiRootStorage.inspectStorageLocation(sourceId),
    });
  }));

  router.post('/config/roots/sources/:sourceId/repair', asyncHandler(async (req, res) => {
    assertLocalConfigRequest(req);
    const multiRootStorage = getMultiRootStorageOrThrow(deps.storage);
    const { sourceId } = parseWithSchema(sourceIdParamSchema, req.params);
    const { action } = parseWithSchema(repairStorageLocationBodySchema, req.body);
    const result = await multiRootStorage.repairStorageLocation(sourceId, action, {
      structuralOnly: true,
    });
    res.json({
      result,
      report: await multiRootStorage.inspectStorageLocation(sourceId, {
        validateContents: false,
      }),
    });
  }));

  router.post('/config/open-path-in-file-manager', asyncHandler(async (req, res) => {
    assertLocalConfigRequest(req);
    const { path: targetPath } = parseWithSchema(openPathInFileManagerBodySchema, req.body);
    const resolvedTargetPath = resolve(targetPath);
    const allowedRoots = getAllowedFileManagerRoots(deps);
    if (allowedRoots.length > 0 && !allowedRoots.some((root) => isPathInsideRoot(root, resolvedTargetPath))) {
      throw new ApiError(
        400,
        'INVALID_REQUEST',
        'Path is outside configured Nearbytes storage roots and cannot be revealed.'
      );
    }
    await openInFileManager(resolvedTargetPath);
    res.json({
      ok: true,
      path: resolvedTargetPath,
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

  router.get('/integrations/accounts', asyncHandler(async (req, res) => {
    assertLocalConfigRequest(req);
    const service = getManagedShareServiceOrThrow(managedShareService);
    res.json(await service.listAccounts({ fast: req.query.fast === '1' }));
  }));

  router.post('/integrations/accounts/connect', asyncHandler(async (req, res) => {
    assertLocalConfigRequest(req);
    const service = getManagedShareServiceOrThrow(managedShareService);
    const input = parseWithSchema(connectProviderAccountBodySchema, req.body);
    res.json(await service.connectAccount(input, { callbackBaseUrl: getRequestOrigin(req) }));
  }));

  router.post('/integrations/providers/:provider/config', asyncHandler(async (req, res) => {
    assertLocalConfigRequest(req);
    const service = getManagedShareServiceOrThrow(managedShareService);
    const { provider } = parseWithSchema(providerIdParamSchema, req.params);
    const input = parseWithSchema(configureProviderBodySchema, req.body);
    res.json({
      setup: await service.configureProvider({
        provider,
        clientId: input.clientId,
        clientSecret: input.clientSecret,
      }),
    });
  }));

  router.post('/integrations/providers/:provider/install', asyncHandler(async (req, res) => {
    assertLocalConfigRequest(req);
    const service = getManagedShareServiceOrThrow(managedShareService);
    const { provider } = parseWithSchema(providerIdParamSchema, req.params);
    res.json({
      setup: await service.installProvider(provider),
    });
  }));

  router.post('/integrations/providers/:provider/reconcile', asyncHandler(async (req, res) => {
    assertLocalConfigRequest(req);
    const service = getManagedShareServiceOrThrow(managedShareService);
    const { provider } = parseWithSchema(providerIdParamSchema, req.params);
    res.json(await service.reconcileProviderManagedShareInventory(provider));
  }));

  router.delete('/integrations/accounts/:id', asyncHandler(async (req, res) => {
    assertLocalConfigRequest(req);
    const service = getManagedShareServiceOrThrow(managedShareService);
    const { id } = parseWithSchema(providerAccountIdParamSchema, req.params);
    await service.disconnectAccount(id);
    res.json({ ok: true });
  }));

  router.get('/integrations/shares', asyncHandler(async (req, res) => {
    assertLocalConfigRequest(req);
    const service = getManagedShareServiceOrThrow(managedShareService);
    res.json(await service.listManagedShares({ fast: req.query.fast === '1' }));
  }));

  router.get('/integrations/shares/incoming', asyncHandler(async (req, res) => {
    assertLocalConfigRequest(req);
    const service = getManagedShareServiceOrThrow(managedShareService);
    res.json(await service.listIncomingManagedShares({ fast: req.query.fast === '1' }));
  }));

  router.get('/integrations/providers/contact-invites', asyncHandler(async (req, res) => {
    assertLocalConfigRequest(req);
    const service = getManagedShareServiceOrThrow(managedShareService);
    res.json(await service.listIncomingProviderContactInvites({ fast: req.query.fast === '1' }));
  }));

  router.post('/integrations/providers/contact-invites/accept', asyncHandler(async (req, res) => {
    assertLocalConfigRequest(req);
    const service = getManagedShareServiceOrThrow(managedShareService);
    const input = parseWithSchema(acceptProviderContactInviteBodySchema, req.body);
    await service.acceptIncomingProviderContactInvite(input.provider, input.accountId, input.inviteId);
    res.json({ ok: true });
  }));

  router.post('/integrations/shares', asyncHandler(async (req, res) => {
    assertLocalConfigRequest(req);
    const service = getManagedShareServiceOrThrow(managedShareService);
    const input = parseWithSchema(createManagedShareBodySchema, req.body);
    res.json({
      summary: await service.createManagedShare(input),
    });
  }));

  router.post('/integrations/shares/:shareId/invite', asyncHandler(async (req, res) => {
    assertLocalConfigRequest(req);
    const service = getManagedShareServiceOrThrow(managedShareService);
    const { shareId } = parseWithSchema(managedShareIdParamSchema, req.params);
    const input = parseWithSchema(inviteManagedShareBodySchema, req.body);
    res.json({
      summary: await service.inviteManagedShare(shareId, input.emails),
    });
  }));

  router.post('/integrations/shares/:shareId/attach', asyncHandler(async (req, res) => {
    assertLocalConfigRequest(req);
    const service = getManagedShareServiceOrThrow(managedShareService);
    const { shareId } = parseWithSchema(managedShareIdParamSchema, req.params);
    const input = parseWithSchema(attachManagedShareBodySchema, req.body);
    res.json({
      summary: await service.attachManagedShare(shareId, input),
    });
  }));

  router.delete('/integrations/shares/:shareId', asyncHandler(async (req, res) => {
    assertLocalConfigRequest(req);
    const service = getManagedShareServiceOrThrow(managedShareService);
    const { shareId } = parseWithSchema(managedShareIdParamSchema, req.params);
    await service.removeManagedShare(shareId);
    res.json({ ok: true });
  }));

  router.post('/integrations/shares/accept', asyncHandler(async (req, res) => {
    assertLocalConfigRequest(req);
    const service = getManagedShareServiceOrThrow(managedShareService);
    const input = parseWithSchema(acceptManagedShareBodySchema, req.body);
    res.json({
      summary: await service.acceptManagedShare(input),
    });
  }));

  router.get('/integrations/shares/:shareId/state', asyncHandler(async (req, res) => {
    assertLocalConfigRequest(req);
    const service = getManagedShareServiceOrThrow(managedShareService);
    const { shareId } = parseWithSchema(managedShareIdParamSchema, req.params);
    res.json({
      summary: await service.getManagedShareState(shareId),
    });
  }));

  router.post('/links/join/parse', asyncHandler(async (req, res) => {
    assertLocalConfigRequest(req);
    const service = getManagedShareServiceOrThrow(managedShareService);
    const input = parseWithSchema(parseJoinLinkBodySchema, req.body);
    res.json(await service.parseJoinLink(input));
  }));

  router.post('/links/join/open', asyncHandler(async (req, res) => {
    assertLocalConfigRequest(req);
    const service = getManagedShareServiceOrThrow(managedShareService);
    const input = parseWithSchema(openJoinLinkBodySchema, req.body);
    const parsed = await service.parseJoinLink(input);
    const secret = joinLinkSpaceToSecretString(parsed.space);
    const volumeId =
      input.volumeId?.trim().toLowerCase() ??
      (parsed.space.mode === 'volume-id'
        ? parsed.space.value.trim().toLowerCase()
        : await getVolumeId(secret ?? '', deps.crypto, deps.storage));
    res.json(
      await service.openJoinLink(
        {
          ...input,
          volumeId,
        },
        {
          callbackBaseUrl: getRequestOrigin(req),
        }
      )
    );
  }));

  router.post('/sources/reconcile', asyncHandler(async (req, res) => {
    assertLocalConfigRequest(req);
    if (!deps.rootsConfigPath) {
      throw new ApiError(500, 'INTERNAL_ERROR', 'Roots config path is not configured');
    }

    const multiRootStorage = getMultiRootStorageOrThrow(deps.storage);
    const { knownVolumeIds } = parseWithSchema(reconcileDiscoveredSourcesBodySchema, req.body ?? {});
    const reconciled = await reconcileDiscoveredSources({
      currentConfig: multiRootStorage.getRootsConfig(),
      knownVolumeIds,
    });

    let activeConfig = multiRootStorage.getRootsConfig();
    if (reconciled.changed) {
      await saveRootsConfig(deps.rootsConfigPath, reconciled.config);
      multiRootStorage.updateRootsConfig(reconciled.config);
      await multiRootStorage.reconcileConfiguredVolumes();
      await ensureNearbytesMarkers(reconciled.config.sources);
      activeConfig = reconciled.config;
    }

    const runtime = await multiRootStorage.getRuntimeSnapshot();
    res.json({
      runKey: reconciled.runKey,
      changed: reconciled.changed,
      knownVolumeIds: reconciled.knownVolumeIds,
      summary: reconciled.summary,
      items: reconciled.items,
      configPath: deps.rootsConfigPath,
      config: activeConfig,
      runtime,
    });
  }));

  router.get('/watch/sources', async (req, res, next) => {
    try {
      assertLocalConfigRequest(req);
      const subscription = await sourceWatchHub.subscribe(
        (update) => writeSseEvent(res, 'source-watch-update', update),
        (error) =>
          writeSseEvent(res, 'watch-error', {
            message: error.message,
            timestamp: Date.now(),
          })
      );

      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();

      writeSseEvent(res, 'source-watch-ready', subscription.ready);

      if (!subscription.ready.autoUpdate) {
        writeSseEvent(res, 'watch-ended', {
          reason: 'Auto-discovery watch is unavailable for local source roots.',
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

  router.get('/__debug/ui', asyncHandler(async (_req, res) => {
    if (!deps.uiDebugExecutor) {
      res.json({
        available: false,
        actions: [],
        screenshot: false,
      });
      return;
    }
    res.json(await deps.uiDebugExecutor.getCapabilities());
  }));

  router.post('/__debug/ui/actions/run', asyncHandler(async (req, res) => {
    if (!deps.uiDebugExecutor) {
      throw new ApiError(501, 'NOT_IMPLEMENTED', 'Desktop UI debugging is not available in this runtime.');
    }
    const input = parseWithSchema(runUiDebugActionsBodySchema, req.body);
    res.json(await deps.uiDebugExecutor.run(input));
  }));

  router.post('/__debug/ui/screenshot', asyncHandler(async (req, res) => {
    if (!deps.uiDebugExecutor) {
      throw new ApiError(501, 'NOT_IMPLEMENTED', 'Desktop UI screenshots are not available in this runtime.');
    }
    const input = parseWithSchema(uiDebugScreenshotBodySchema, req.body);
    res.json(
      await deps.uiDebugExecutor.run({
        actions: [
          {
            type: 'screenshot',
            path: input.path,
            selector: input.selector,
            fullPage: input.fullPage,
          },
        ],
        stopOnError: true,
      })
    );
  }));

  router.post('/__debug/ui/dom', asyncHandler(async (req, res) => {
    if (!deps.uiDebugExecutor) {
      throw new ApiError(501, 'NOT_IMPLEMENTED', 'Desktop UI DOM snapshots are not available in this runtime.');
    }
    const input = parseWithSchema(uiDebugDomSnapshotBodySchema, req.body);
    res.json(
      await deps.uiDebugExecutor.run({
        actions: [
          {
            type: 'snapshotDom',
            selector: input.selector,
            maxLength: input.maxLength,
          },
        ],
        stopOnError: true,
      })
    );
  }));

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

      if (deps.sessionStore) {
        response.token = deps.sessionStore.createSession(validatedSecret);
      } else if (deps.tokenKey) {
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

  router.get(
    '/events/:hash',
    requireSecret(deps),
    asyncHandler(async (req, res) => {
      const { hash } = parseWithSchema(fileHashParamSchema, req.params);
      const secret = res.locals.secret as string;
      const detail = await deps.fileService.getEvent(secret, hash);
      res.json(detail);
    })
  );

  router.get(
    '/events/:hash/storage-locations',
    requireSecret(deps),
    asyncHandler(async (req, res) => {
      const { hash } = parseWithSchema(fileHashParamSchema, req.params);
      const secret = res.locals.secret as string;
      const detail = await deps.fileService.getEvent(secret, hash);
      const volumeId = await getVolumeId(secret, deps.crypto, deps.storage);

      const expectedEventRelativePath = join('channels', volumeId, `${hash}.bin`);
      const payloadHash = detail.event.payload.hash?.trim() ?? '';
      const expectedDataRelativePath =
        /^[a-f0-9]{64}$/i.test(payloadHash) && !/^0+$/i.test(payloadHash)
          ? join('blocks', `${payloadHash}.bin`)
          : null;

      const sourceEntries = isMultiRootStorageBackend(deps.storage)
        ? getMultiRootStorageOrThrow(deps.storage).getRootsConfig().sources.map((source) => ({
            rootId: source.id,
            provider: source.provider,
            path: source.path,
          }))
        : deps.resolvedStorageDir
          ? [
              {
                rootId: null,
                provider: 'local',
                path: deps.resolvedStorageDir,
              },
            ]
          : [];

      const locations = await Promise.all(
        sourceEntries.map(async (source) => {
          const eventPath = join(source.path, expectedEventRelativePath);
          const dataPath = expectedDataRelativePath ? join(source.path, expectedDataRelativePath) : null;
          const hasEventFile = await pathExists(eventPath);
          const hasDataBlock = dataPath ? await pathExists(dataPath) : false;
          return {
            rootId: source.rootId,
            provider: source.provider,
            rootPath: source.path,
            eventPath,
            dataPath,
            hasEventFile,
            hasDataBlock,
          };
        })
      );

      res.json({
        eventHash: hash,
        volumeId,
        expectedEventRelativePath,
        expectedDataRelativePath,
        locations,
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

  router.get(
    '/chat',
    requireSecret(deps),
    asyncHandler(async (_req, res) => {
      const secret = res.locals.secret as string;
      const chat = await deps.chatService.listChat(secret);
      res.json(chat);
    })
  );

  router.post(
    '/chat/identities',
    requireSecret(deps),
    asyncHandler(async (req, res) => {
      const { identitySecret, profile } = parseWithSchema(publishIdentityBodySchema, req.body);
      const secret = res.locals.secret as string;
      const published = await deps.chatService.publishIdentity(secret, identitySecret, profile);
      res.json({ published });
    })
  );

  router.post(
    '/chat/messages',
    requireSecret(deps),
    asyncHandler(async (req, res) => {
      const { identitySecret, body, attachment } = parseWithSchema(sendChatMessageBodySchema, req.body);
      const secret = res.locals.secret as string;
      const sent = await deps.chatService.sendMessage(secret, identitySecret, { body, attachment });
      res.json({ sent });
    })
  );

  router.post(
    '/upload',
    requireSecret(deps),
    upload.single('file') as unknown as RequestHandler,
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

  router.post(
    '/references/source/export',
    requireSecret(deps),
    asyncHandler(async (req, res) => {
      const { filenames } = parseWithSchema(exportReferencesBodySchema, req.body);
      const secret = res.locals.secret as string;
      const exported = await deps.fileService.exportSourceReferences(secret, filenames);
      res.json(exported);
    })
  );

  router.post(
    '/references/source/import',
    requireSecret(deps),
    asyncHandler(async (req, res) => {
      const { sourceSecret, bundle } = parseWithSchema(importSourceReferencesBodySchema, req.body);
      const secret = res.locals.secret as string;
      const imported = await deps.fileService.importSourceReferences(secret, bundle, sourceSecret);
      res.json({
        imported: imported.imported.map(mapFile),
        importedCount: imported.imported.length,
      });
    })
  );

  router.post(
    '/references/recipient/export',
    requireSecret(deps),
    asyncHandler(async (req, res) => {
      const { filenames, recipientVolumeId } = parseWithSchema(exportRecipientReferencesBodySchema, req.body);
      const secret = res.locals.secret as string;
      const exported = await deps.fileService.exportRecipientReferences(secret, filenames, recipientVolumeId);
      res.json(exported);
    })
  );

  router.post(
    '/references/recipient/import',
    requireSecret(deps),
    asyncHandler(async (req, res) => {
      const { bundle } = parseWithSchema(importRecipientReferencesBodySchema, req.body);
      const secret = res.locals.secret as string;
      const imported = await deps.fileService.importRecipientReferences(secret, bundle);
      res.json({
        imported: imported.imported.map(mapFile),
        importedCount: imported.imported.length,
      });
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

  router.post(
    '/files/rename',
    requireSecret(deps),
    asyncHandler(async (req, res) => {
      const { from, to } = parseWithSchema(renameFileBodySchema, req.body);
      const secret = res.locals.secret as string;
      const renamed = await deps.fileService.renameFile(secret, from, to);
      res.json({ renamed });
    })
  );

  router.post(
    '/folders/rename',
    requireSecret(deps),
    asyncHandler(async (req, res) => {
      const { from, to, merge } = parseWithSchema(renameFolderBodySchema, req.body);
      const secret = res.locals.secret as string;
      const renamed = await deps.fileService.renameFolder(secret, from, to, { merge });
      res.json({ renamed });
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
    void getSecretFromRequest(req, { tokenKey: deps.tokenKey, sessionStore: deps.sessionStore })
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
    Promise.resolve(handler(req, res, next)).catch((error) => {
      if (error instanceof ManagedShareServiceError) {
        const apiCode =
          error.status === 404
            ? 'NOT_FOUND'
            : error.status === 501
              ? 'NOT_IMPLEMENTED'
              : error.status === 401
                ? 'UNAUTHORIZED'
                : error.status === 403
                  ? 'FORBIDDEN'
                  : 'INVALID_REQUEST';
        next(new ApiError(error.status, apiCode, error.message));
        return;
      }
      next(error);
    });
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

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
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

function getManagedShareServiceOrThrow(
  service: ManagedShareService | null
): ManagedShareService {
  if (!service) {
    throw new ApiError(501, 'NOT_IMPLEMENTED', 'Managed provider integrations are not enabled');
  }
  return service;
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

function getRequestOrigin(req: Request): string {
  const protocol = req.protocol || 'http';
  const host = req.get('host');
  if (!host) {
    throw new ApiError(500, 'INTERNAL_ERROR', 'Request host is not available');
  }
  return `${protocol}://${host}`;
}

function toUrlSearchParams(query: Request['query']): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (entry !== undefined) {
          params.append(key, String(entry));
        }
      }
      continue;
    }
    if (value !== undefined) {
      params.append(key, String(value));
    }
  }
  return params;
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

function tokensEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual.trim());
  const expectedBuffer = Buffer.from(expected.trim());
  if (actualBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return timingSafeEqual(actualBuffer, expectedBuffer);
}

const DESKTOP_PROTECTED_API_PREFIXES = [
  '/open',
  '/files',
  '/upload',
  '/file',
  '/health',
  '/timeline',
  '/snapshot',
  '/config',
  '/sources',
  '/integrations',
  '/links',
  '/watch',
  '/folders',
  '/references',
  '/__debug',
] as const;

function isDesktopProtectedApiPath(pathname: string): boolean {
  return DESKTOP_PROTECTED_API_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

async function openInFileManager(targetPath: string): Promise<void> {
  const resolvedTargetPath = resolve(targetPath);
  const existingStat = await fs.stat(resolvedTargetPath).catch(() => null);
  const fallbackDirectory = existingStat
    ? existingStat.isDirectory()
      ? resolvedTargetPath
      : dirname(resolvedTargetPath)
    : await findNearestExistingDirectory(resolvedTargetPath);

  if (!fallbackDirectory) {
    throw new ApiError(404, 'NOT_FOUND', 'Target path does not exist and no parent directory could be opened.');
  }

  const launcher =
    process.platform === 'darwin'
      ? existingStat?.isFile()
        ? { command: 'open', args: ['-R', resolvedTargetPath] }
        : { command: 'open', args: [fallbackDirectory] }
      : process.platform === 'win32'
        ? existingStat?.isFile()
          ? { command: 'explorer', args: [`/select,${resolvedTargetPath}`] }
          : { command: 'explorer', args: [fallbackDirectory] }
        : { command: 'xdg-open', args: [fallbackDirectory] };

  await new Promise<void>((resolve, reject) => {
    const child = spawn(launcher.command, launcher.args, {
      stdio: 'ignore',
      detached: true,
    });

    child.once('error', (error) => reject(error));
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  }).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    throw new ApiError(500, 'INTERNAL_ERROR', `Failed to open file manager: ${message}`);
  });
}

function getAllowedFileManagerRoots(deps: RouteDependencies): string[] {
  if (isMultiRootStorageBackend(deps.storage)) {
    return getMultiRootStorageOrThrow(deps.storage)
      .getRootsConfig()
      .sources
      .map((source) => resolve(source.path));
  }
  if (deps.resolvedStorageDir) {
    return [resolve(deps.resolvedStorageDir)];
  }
  return [];
}

function normalizeComparablePath(value: string): string {
  const normalized = resolve(value).replace(/\\/g, '/').replace(/\/+$/u, '');
  if (process.platform === 'win32' || process.platform === 'darwin') {
    return normalized.toLowerCase();
  }
  return normalized;
}

function isPathInsideRoot(rootPath: string, targetPath: string): boolean {
  const normalizedRoot = normalizeComparablePath(rootPath);
  const normalizedTarget = normalizeComparablePath(targetPath);
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}/`);
}

async function findNearestExistingDirectory(targetPath: string): Promise<string | null> {
  let current = resolve(targetPath);

  while (true) {
    const stat = await fs.stat(current).catch(() => null);
    if (stat) {
      return stat.isDirectory() ? current : dirname(current);
    }
    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}
