#!/usr/bin/env node

import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, '..');
const defaultCacheKey = process.env.NEARBYTES_E2E_MEGA_CACHE_KEY?.trim() || 'cacheprobe2';
const port = Number.parseInt(process.env.NEARBYTES_MEGA_DEBUG_PORT?.trim() || '4311', 10);

const envE2ePath = path.join(workspaceRoot, '.env.e2e');
if (existsSync(envE2ePath)) {
  for (const rawLine of readFileSync(envE2ePath, 'utf8').split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

const { MultiRootStorageBackend } = await import('../dist/storage/multiRoot.js');
const { ManagedShareService } = await import('../dist/integrations/managedShares.js');
const { MegaTransportAdapter } = await import('../dist/integrations/mega.js');
const { createIntegrationRuntime } = await import('../dist/integrations/runtime.js');
const { JsonFileSecretStore } = await import('../dist/integrations/secretStore.js');

const peerContexts = new Map();

function sendJson(res, status, payload) {
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function createPeerLogger(peer) {
  return {
    log: (...args) => console.error(`[mega-debug][${peer}]`, ...args),
    warn: (...args) => console.error(`[mega-debug][${peer}] WARN`, ...args),
    error: (...args) => console.error(`[mega-debug][${peer}] ERROR`, ...args),
  };
}

function getPeerBase(cacheKey, peer) {
  return path.join(workspaceRoot, 'test-results', 'mega-live-cache', cacheKey, peer);
}

async function loadRootsConfig(rootsConfigPath) {
  return JSON.parse(await readFile(rootsConfigPath, 'utf8'));
}

async function openPeer(cacheKey, peer) {
  const key = `${cacheKey}:${peer}`;
  const existing = peerContexts.get(key);
  if (existing) {
    return existing;
  }

  const base = getPeerBase(cacheKey, peer);
  const mainRoot = path.join(base, 'main-root');
  const rootsConfigPath = path.join(base, 'roots.json');
  const integrationStatePath = path.join(base, 'integrations.json');
  const secretsPath = path.join(base, 'integration-secrets.json');
  if (!existsSync(rootsConfigPath) || !existsSync(integrationStatePath) || !existsSync(secretsPath)) {
    throw new Error(`Missing cached peer state for ${peer} under ${base}`);
  }

  await mkdir(mainRoot, { recursive: true });
  const rootsConfig = await loadRootsConfig(rootsConfigPath);
  const storage = new MultiRootStorageBackend(rootsConfig);
  const runtime = createIntegrationRuntime({
    secretStore: new JsonFileSecretStore({ filePath: secretsPath }),
    logger: createPeerLogger(peer),
    mega: {
      remoteBasePath: process.env.NEARBYTES_MEGA_REMOTE_BASE,
      syncIntervalMs: Number.parseInt(process.env.NEARBYTES_E2E_MEGA_SYNC_INTERVAL_MS?.trim() || '300000', 10),
      syncTimeoutMs: Number.parseInt(process.env.NEARBYTES_E2E_MEGA_SYNC_TIMEOUT_MS?.trim() || '60000', 10),
    },
  });
  const service = new ManagedShareService({
    storage,
    rootsConfigPath,
    integrationStatePath,
    mirrorRoot: mainRoot,
    adapters: [new MegaTransportAdapter(runtime)],
    readMaintenanceMode: 'background',
  });
  const context = { cacheKey, peer, key, base, mainRoot, rootsConfigPath, integrationStatePath, secretsPath, storage, runtime, service };
  peerContexts.set(key, context);
  return context;
}

function getMegaAdapter(context) {
  return context.service.adapters.get('mega');
}

async function getStateSnapshot(context) {
  const accounts = await context.service.listAccounts({ fast: true });
  const shares = await context.service.listManagedShares({ fast: true });
  return {
    peer: context.peer,
    cacheKey: context.cacheKey,
    base: context.base,
    accounts: accounts.accounts,
    shares: shares.shares.map((entry) => ({
      id: entry.share.id,
      role: entry.share.role,
      label: entry.share.label,
      localPath: entry.share.localPath,
      state: entry.state,
      remoteDescriptor: entry.share.remoteDescriptor,
    })),
  };
}

function matchesShare(summary, selector = {}) {
  if (selector.shareId && summary.share.id !== selector.shareId) return false;
  if (selector.role && summary.share.role !== selector.role) return false;
  const descriptor = summary.share.remoteDescriptor ?? {};
  if (selector.rootHandle && descriptor.rootHandle !== selector.rootHandle && descriptor.shareHandle !== selector.rootHandle) {
    return false;
  }
  if (selector.ownerEmail && descriptor.ownerEmail !== selector.ownerEmail) return false;
  return true;
}

async function resolveShare(context, selector = {}) {
  const state = await context.service.listManagedShares({ fast: true });
  const shareSummary = state.shares.find((entry) => matchesShare(entry, selector));
  if (!shareSummary) {
    throw new Error(`No managed share matched selector ${JSON.stringify(selector)}`);
  }
  const accounts = await context.service.listAccounts({ fast: true });
  const account = accounts.accounts.find((entry) => entry.id === shareSummary.share.accountId);
  if (!account) {
    throw new Error(`Account not found for share ${shareSummary.share.id}`);
  }
  return { shareSummary, account };
}

async function ensureShareSync(context, selector = {}) {
  const { shareSummary, account } = await resolveShare(context, selector);
  const adapter = getMegaAdapter(context);
  if (!adapter?.ensureSync) {
    throw new Error('MEGA adapter does not expose ensureSync');
  }
  await adapter.ensureSync(shareSummary.share, account);
  return context.service.getManagedShareState(shareSummary.share.id);
}

async function getManagedShareState(context, selector = {}) {
  const { shareSummary } = await resolveShare(context, selector);
  return context.service.getManagedShareState(shareSummary.share.id);
}

async function disposeAll() {
  await Promise.all(
    Array.from(peerContexts.values(), async (context) => {
      await context.service.dispose().catch(() => {});
    })
  );
  peerContexts.clear();
}

const server = createServer(async (req, res) => {
  try {
    if (!req.url) {
      sendJson(res, 400, { error: 'missing-url' });
      return;
    }
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, { ok: true, cacheKey: defaultCacheKey, openPeers: Array.from(peerContexts.keys()) });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/open') {
      const body = await readJson(req);
      const cacheKey = String(body.cacheKey || defaultCacheKey);
      const peer = String(body.peer || 'A');
      const context = await openPeer(cacheKey, peer);
      sendJson(res, 200, await getStateSnapshot(context));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/summary') {
      const body = await readJson(req);
      const cacheKey = String(body.cacheKey || defaultCacheKey);
      const peer = String(body.peer || 'A');
      const context = await openPeer(cacheKey, peer);
      sendJson(res, 200, await getStateSnapshot(context));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/share-state') {
      const body = await readJson(req);
      const cacheKey = String(body.cacheKey || defaultCacheKey);
      const peer = String(body.peer || 'A');
      const context = await openPeer(cacheKey, peer);
      sendJson(res, 200, await getManagedShareState(context, body.selector || {}));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/ensure-sync') {
      const body = await readJson(req);
      const cacheKey = String(body.cacheKey || defaultCacheKey);
      const peer = String(body.peer || 'A');
      const context = await openPeer(cacheKey, peer);
      sendJson(res, 200, await ensureShareSync(context, body.selector || {}));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/dispose') {
      await disposeAll();
      sendJson(res, 200, { ok: true });
      return;
    }
    sendJson(res, 404, { error: 'not-found', method: req.method, path: url.pathname });
  } catch (error) {
    sendJson(res, 500, {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
});

server.listen(port, '127.0.0.1', () => {
  console.error(`[mega-debug] listening on http://127.0.0.1:${port}`);
  console.error(`[mega-debug] default cache key: ${defaultCacheKey}`);
});

async function shutdown() {
  server.close();
  await disposeAll();
}

process.on('SIGINT', async () => {
  await shutdown();
  process.exit(0);
});
process.on('SIGTERM', async () => {
  await shutdown();
  process.exit(0);
});