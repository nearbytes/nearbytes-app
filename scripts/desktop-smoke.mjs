import { mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { randomBytes } from 'crypto';

const runtimePath = path.join(process.cwd(), 'dist', 'server', 'runtime.js');
const runtimeModule = await import(pathToFileUrl(runtimePath));

if (typeof runtimeModule.startApiRuntime !== 'function') {
  throw new Error('Missing startApiRuntime export in dist/server/runtime.js');
}

const desktopToken = randomBytes(24).toString('base64url');
const storageDir = await mkdtemp(path.join(os.tmpdir(), 'nearbytes-desktop-smoke-'));

let runtime;
try {
  runtime = await runtimeModule.startApiRuntime({
    host: '127.0.0.1',
    port: 0,
    defaultStorageDir: storageDir,
    corsOrigin: false,
    desktopApiToken: desktopToken,
  });

  const baseUrl = `http://127.0.0.1:${runtime.port}`;
  const health = await fetch(`${baseUrl}/health`);
  if (!health.ok) {
    throw new Error(`Health check failed with ${health.status}`);
  }

  const missingToken = await fetch(`${baseUrl}/config/roots`);
  if (missingToken.status !== 401) {
    throw new Error(`Expected 401 without desktop token, got ${missingToken.status}`);
  }

  const withToken = await fetch(`${baseUrl}/config/roots`, {
    headers: {
      'x-nearbytes-desktop-token': desktopToken,
    },
  });
  if (!withToken.ok) {
    throw new Error(`Expected authorized config response, got ${withToken.status}`);
  }
} finally {
  if (runtime) {
    await runtime.stop();
  }
  await rm(storageDir, { recursive: true, force: true });
}

function pathToFileUrl(filePath) {
  const normalized = path.resolve(filePath).replace(/\\/g, '/');
  return `file://${normalized.startsWith('/') ? '' : '/'}${normalized}`;
}

