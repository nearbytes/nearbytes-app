#!/usr/bin/env node

import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
  installBootLogFile();
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

function installBootLogFile(): void {
  const marker = '__nearbytesBootLogInstalled';
  const globalObject = globalThis as Record<string, unknown>;
  if (globalObject[marker] === true) {
    return;
  }
  globalObject[marker] = true;

  const logFilePath = path.join(os.homedir(), '.nearbytes', 'logs', 'runtime.log');
  mkdirSync(path.dirname(logFilePath), { recursive: true });
  // Reset per process boot as requested.
  writeFileSync(logFilePath, '', 'utf8');

  const methods: Array<'log' | 'info' | 'warn' | 'error' | 'debug'> = ['log', 'info', 'warn', 'error', 'debug'];
  for (const method of methods) {
    const original = console[method];
    if (typeof original !== 'function') {
      continue;
    }
    console[method] = ((...args: unknown[]) => {
      original(...args);
      try {
        const timestamp = new Date().toISOString();
        const payload = args.map(stringifyLogArg).join(' ');
        appendFileSync(logFilePath, `[${timestamp}] ${method.toUpperCase()} ${payload}\n`, 'utf8');
      } catch {
        // Best-effort only: logging to file must never break runtime logging.
      }
    }) as Console[typeof method];
  }
}

function stringifyLogArg(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value instanceof Error) {
    return value.stack ?? value.message;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
