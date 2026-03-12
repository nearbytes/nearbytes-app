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
  return (req, res, next) => {
    const startedAt = Date.now();
    res.on('finish', () => {
      const durationMs = Date.now() - startedAt;
      console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${durationMs}ms`);
    });
    next();
  };
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
