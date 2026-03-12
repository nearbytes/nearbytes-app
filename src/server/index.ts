#!/usr/bin/env node

import { parseTokenKey } from './auth.js';
import { startApiRuntime } from './runtime.js';
import {
  getStorageDiagnostics,
  logStorageDiagnostics,
} from './storageDiagnostics.js';

const port = parsePort(process.env.PORT);
const corsOrigin = parseCorsOrigin(process.env.NEARBYTES_CORS_ORIGIN ?? 'http://localhost:5173');
const maxUploadBytes = parseMaxUploadBytes(process.env.NEARBYTES_MAX_UPLOAD_MB);
const tokenKey = process.env.NEARBYTES_SERVER_TOKEN_KEY
  ? parseTokenKey(process.env.NEARBYTES_SERVER_TOKEN_KEY)
  : undefined;

async function main(): Promise<void> {
  const runtime = await startApiRuntime({
    port,
    corsOrigin,
    maxUploadBytes,
    tokenKey,
  });

  console.log(`Using roots config: ${runtime.rootsConfigPath}`);
  console.log(`Using default storage bootstrap path: ${runtime.defaultStorageDir}`);
  const diagnostics = await getStorageDiagnostics(runtime.primaryMainRoot);
  logStorageDiagnostics(diagnostics);
  console.log(`Nearbytes API server running at http://localhost:${runtime.port}`);
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
