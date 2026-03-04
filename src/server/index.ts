#!/usr/bin/env node

import path from 'path';
import { createCryptoOperations } from '../crypto/index.js';
import { createFileService } from '../domain/fileService.js';
import { getDefaultStorageDir } from '../storagePath.js';
import { loadOrCreateRootsConfig } from '../config/roots.js';
import { ensureNearbytesMarkers } from '../config/sourceDiscovery.js';
import { MultiRootStorageBackend } from '../storage/multiRoot.js';
import { createApp } from './app.js';
import { parseTokenKey } from './auth.js';
import {
  getStorageDiagnostics,
  logStorageDiagnostics,
} from './storageDiagnostics.js';

const port = parsePort(process.env.PORT);
const defaultStorageDirRaw = getDefaultStorageDir();
const defaultStorageDir = path.resolve(defaultStorageDirRaw);
const corsOrigin = parseCorsOrigin(process.env.NEARBYTES_CORS_ORIGIN ?? 'http://localhost:5173');
const maxUploadBytes = parseMaxUploadBytes(process.env.NEARBYTES_MAX_UPLOAD_MB);
const tokenKey = process.env.NEARBYTES_SERVER_TOKEN_KEY
  ? parseTokenKey(process.env.NEARBYTES_SERVER_TOKEN_KEY)
  : undefined;

const crypto = createCryptoOperations();

async function main(): Promise<void> {
  const loaded = await loadOrCreateRootsConfig({
    defaultRootPath: defaultStorageDir,
  });
  if (loaded.created) {
    console.log(`Created default roots config at: ${loaded.configPath}`);
  }

  const markerResults = await ensureNearbytesMarkers(loaded.config.roots);
  const markerFailures = markerResults.filter((entry) => !entry.ok);
  if (markerFailures.length > 0) {
    for (const failure of markerFailures) {
      console.warn(
        `Warning: failed to ensure .nearbytes marker for root ${failure.rootId} (${failure.path}): ${failure.error}`
      );
    }
  }

  const storage = new MultiRootStorageBackend(loaded.config);
  const fileService = createFileService({ crypto, storage });
  const primaryMainRoot = loaded.config.roots.find((root) => root.kind === 'main')?.path ?? defaultStorageDir;

  console.log(`Using roots config: ${loaded.configPath}`);
  console.log(`Using default storage bootstrap path: ${defaultStorageDir}`);
  console.log(`Configured roots: ${loaded.config.roots.length}`);
  const diagnostics = await getStorageDiagnostics(primaryMainRoot);
  logStorageDiagnostics(diagnostics);

  // Ensure channels/ and blocks/ exist and are writable (fail fast if path wrong or read-only)
  await storage.createDirectory('channels');
  await storage.createDirectory('blocks');

  const app = createApp({
    fileService,
    crypto,
    storage,
    tokenKey,
    corsOrigin,
    maxUploadBytes,
    resolvedStorageDir: primaryMainRoot,
    rootsConfigPath: loaded.configPath,
  });

  app.listen(port, () => {
    console.log(`Nearbytes API server running at http://localhost:${port}`);
  });
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

function parsePort(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? '3000', 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return 3000;
  }
  return parsed;
}

function parseCorsOrigin(value: string): string | string[] | boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return false;
  }
  if (trimmed === '*') {
    return true;
  }
  if (trimmed.includes(',')) {
    return trimmed
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }
  return trimmed;
}

function parseMaxUploadBytes(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? '50', 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return 50 * 1024 * 1024;
  }
  return parsed * 1024 * 1024;
}
