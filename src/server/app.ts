import express, { type RequestHandler } from 'express';
import cors from 'cors';
import path from 'path';
import { existsSync } from 'fs';
import type { CryptoOperations } from '../crypto/index.js';
import type { ChatService } from '../domain/chatService.js';
import type { FileService } from '../domain/fileService.js';
import type { StorageBackend } from '../types/storage.js';
import { createRoutes } from './routes.js';
import { errorHandler, notFoundHandler } from './errors.js';
import {
  InMemorySecretSessionStore,
  type SecretSessionStore,
} from './secretSessions.js';
import type { ManagedShareService, ManagedShareServiceOptions } from '../integrations/managedShares.js';
import type { UiDebugExecutor } from './uiDebug.js';

/**
 * Dependencies required to construct the API app.
 */
export interface AppDependencies {
  readonly fileService: FileService;
  readonly chatService: ChatService;
  readonly crypto: CryptoOperations;
  readonly storage: StorageBackend;
  readonly tokenKey?: Uint8Array;
  readonly sessionStore?: SecretSessionStore;
  readonly corsOrigin: string | string[] | boolean;
  readonly maxUploadBytes: number;
  /** Resolved absolute storage path; used for debug endpoints and diagnostics. */
  readonly resolvedStorageDir?: string;
  /** Absolute roots config path; used by /config/roots endpoints. */
  readonly rootsConfigPath?: string;
  /** Runtime token required by desktop mode for all API routes. */
  readonly desktopApiToken?: string;
  /** Optional static UI build directory served by the same process. */
  readonly uiDistPath?: string;
  /** Optional provider integration overrides, mainly for desktop/runtime wiring and tests. */
  readonly integrationOptions?: Omit<ManagedShareServiceOptions, 'storage' | 'rootsConfigPath'>;
  /** Optional pre-built managed share service. */
  readonly managedShareService?: ManagedShareService;
  /** Optional desktop-only UI automation/debugging bridge. */
  readonly uiDebugExecutor?: UiDebugExecutor;
}

/**
 * Creates the Express app without starting the server.
 */
export function createApp(deps: AppDependencies): express.Express {
  const app = express();
  const sessionStore = deps.sessionStore ?? new InMemorySecretSessionStore();
  app.disable('x-powered-by');

  app.use(
    cors({
      origin: deps.corsOrigin,
      methods: ['GET', 'POST', 'PUT', 'DELETE'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'x-nearbytes-secret',
        'x-nearbytes-desktop-token',
      ],
    })
  );

  app.use(express.json({ limit: '1mb' }));
  app.use(requestLogger());

  app.use(
    createRoutes({
      ...deps,
      sessionStore,
    })
  );

  const uiDistPath = resolveUiDistPath(deps.uiDistPath);
  if (uiDistPath) {
    const indexPath = path.join(uiDistPath, 'index.html');
    app.use(express.static(uiDistPath));
    app.get('*', (req, res, next) => {
      if (req.method !== 'GET') {
        next();
        return;
      }
      if (!req.accepts('html')) {
        next();
        return;
      }
      res.sendFile(indexPath, (error) => {
        if (error) {
          next(error);
        }
      });
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

function requestLogger(): RequestHandler {
  const enabled = isRequestDebugEnabled();
  return (req, res, next) => {
    if (!enabled) {
      next();
      return;
    }
    const startedAt = Date.now();
    res.on('finish', () => {
      const durationMs = Date.now() - startedAt;
      console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${durationMs}ms`);
    });
    next();
  };
}

function isRequestDebugEnabled(): boolean {
  const value = process.env.DEBUG?.trim();
  if (!value) {
    return false;
  }
  if (value === '1' || value.toLowerCase() === 'true' || value === '*') {
    return true;
  }
  return value
    .split(',')
    .map((entry) => entry.trim())
    .some((entry) => entry === 'nearbytes' || entry === 'nearbytes:requests' || entry === 'requests');
}

function resolveUiDistPath(value: string | undefined): string | null {
  if (!value || value.trim().length === 0) {
    return null;
  }
  const resolved = path.resolve(value);
  const indexPath = path.join(resolved, 'index.html');
  if (!existsSync(indexPath)) {
    return null;
  }
  return resolved;
}
