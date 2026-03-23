import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';

const DEFAULT_SERVER_PROXY_TARGET = 'http://127.0.0.1:3000';
const DESKTOP_SESSION_PATH = process.env.NEARBYTES_DESKTOP_SESSION_FILE?.trim()
  ? path.resolve(process.env.NEARBYTES_DESKTOP_SESSION_FILE)
  : path.join(os.homedir(), '.nearbytes', 'desktop-session.json');
const API_PREFIXES = [
  '/open',
  '/files',
  '/upload',
  '/file',
  '/events',
  '/references',
  '/chat',
  '/health',
  '/timeline',
  '/snapshot',
  '/__debug',
  '/config',
  '/sources',
  '/integrations',
  '/links',
  '/watch',
  '/folders',
];

function nearbytesDevApiProxy() {
  return {
    name: 'nearbytes-dev-api-proxy',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url || !isApiRequest(req.url)) {
          next();
          return;
        }

        proxyApiRequest(req, res, readDesktopSession(), true);
      });
    },
  };
}

function proxyApiRequest(req, res, session, allowRetry) {
  const targetUrl = new URL(session ? `http://127.0.0.1:${session.port}` : DEFAULT_SERVER_PROXY_TARGET);
  const headers = { ...req.headers, host: targetUrl.host };
  if (session?.token && !headers['x-nearbytes-desktop-token']) {
    headers['x-nearbytes-desktop-token'] = session.token;
  }

  const proxyReq = http.request(
    {
      protocol: targetUrl.protocol,
      hostname: targetUrl.hostname,
      port: targetUrl.port,
      method: req.method,
      path: req.url,
      headers,
    },
    (proxyRes) => {
      res.statusCode = proxyRes.statusCode ?? 502;
      Object.entries(proxyRes.headers).forEach(([key, value]) => {
        if (value !== undefined) {
          res.setHeader(key, value);
        }
      });
      proxyRes.pipe(res);
    }
  );

  proxyReq.on('error', (error) => {
    if (res.headersSent) {
      res.end();
      return;
    }

    if (session && shouldInvalidateDesktopSession(error)) {
      invalidateDesktopSession(session);
    }

    const canRetry = allowRetry && (req.method === 'GET' || req.method === 'HEAD');
    if (canRetry) {
      retryProxyRequest(req, res, session);
      return;
    }

    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        error: {
          code: 'BAD_GATEWAY',
          message: buildProxyErrorMessage(error, targetUrl, session),
        },
      })
    );
  });

  if (req.method === 'GET' || req.method === 'HEAD') {
    proxyReq.end();
    return;
  }

  req.pipe(proxyReq);
}

function retryProxyRequest(req, res, previousSession) {
  setTimeout(() => {
    if (res.headersSent || res.writableEnded) {
      return;
    }
    const refreshedSession = readDesktopSession();
    const sessionChanged = hasDesktopSessionChanged(previousSession, refreshedSession);
    if (sessionChanged) {
      proxyApiRequest(req, res, refreshedSession, false);
      return;
    }

    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/json');
    const targetUrl = new URL(
      refreshedSession ? `http://127.0.0.1:${refreshedSession.port}` : DEFAULT_SERVER_PROXY_TARGET
    );
    res.end(
      JSON.stringify({
        error: {
          code: 'BAD_GATEWAY',
          message: buildProxyErrorMessage(
            new Error('desktop runtime unavailable after auto-repair attempt'),
            targetUrl,
            refreshedSession
          ),
        },
      })
    );
  }, 150);
}

function buildProxyErrorMessage(error, targetUrl, session) {
  const targetLabel = `${targetUrl.hostname}:${targetUrl.port}`;
  if (session) {
    return `Nearbytes dev proxy could not reach the desktop runtime at ${targetLabel}. Restart with \"yarn dev-run\" or remove ${DESKTOP_SESSION_PATH}. Original error: ${error.message}`;
  }
  return `Nearbytes dev proxy could not reach the API target at ${targetLabel}. Start the desktop runtime with \"yarn dev-run\" or the standalone server on port 3000. Original error: ${error.message}`;
}

function isApiRequest(url) {
  return API_PREFIXES.some(
    (prefix) => url === prefix || url.startsWith(`${prefix}/`) || url.startsWith(`${prefix}?`)
  );
}

function readDesktopSession() {
  try {
    const raw = fs.readFileSync(DESKTOP_SESSION_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof parsed.pid !== 'number' ||
      !Number.isFinite(parsed.pid) ||
      parsed.pid <= 0 ||
      typeof parsed.port !== 'number' ||
      !Number.isFinite(parsed.port) ||
      parsed.port <= 0 ||
      typeof parsed.token !== 'string' ||
      parsed.token.trim().length === 0 ||
      typeof parsed.expiresAt !== 'number' ||
      !Number.isFinite(parsed.expiresAt) ||
      parsed.expiresAt <= Date.now() ||
      !isProcessAlive(parsed.pid)
    ) {
      invalidateDesktopSession();
      return null;
    }
    return {
      pid: parsed.pid,
      port: parsed.port,
      token: parsed.token,
    };
  } catch {
    return null;
  }
}

function shouldInvalidateDesktopSession(error) {
  const code = typeof error?.code === 'string' ? error.code : '';
  return code === 'ECONNRESET' || code === 'ECONNREFUSED' || code === 'EPIPE' || code === 'ETIMEDOUT';
}

function hasDesktopSessionChanged(previousSession, nextSession) {
  if (!previousSession && !nextSession) {
    return false;
  }
  if (!previousSession || !nextSession) {
    return true;
  }
  return (
    previousSession.pid !== nextSession.pid ||
    previousSession.port !== nextSession.port ||
    previousSession.token !== nextSession.token
  );
}

function invalidateDesktopSession(expectedSession) {
  try {
    if (!fs.existsSync(DESKTOP_SESSION_PATH)) {
      return;
    }

    if (expectedSession) {
      const raw = fs.readFileSync(DESKTOP_SESSION_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      if (
        parsed &&
        typeof parsed === 'object' &&
        parsed.pid === expectedSession.pid &&
        parsed.port === expectedSession.port &&
        parsed.token === expectedSession.token
      ) {
        fs.unlinkSync(DESKTOP_SESSION_PATH);
      }
      return;
    }

    fs.unlinkSync(DESKTOP_SESSION_PATH);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error) {
      const code = error.code;
      if (code === 'ENOENT') {
        return;
      }
    }
  }
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export default defineConfig({
  plugins: [
    nearbytesDevApiProxy(),
    svelte({
      dynamicCompileOptions({ filename }) {
        const normalizedFilename = filename.replace(/\\/g, '/');
        if (normalizedFilename.includes('/node_modules/lucide-svelte/')) {
          return { runes: false };
        }
      },
    }),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        runtimeCaching: [
          {
            urlPattern: /^\/(open|files|upload|file|events|references|chat|health|timeline|snapshot|config|sources|watch)/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'nearbytes-api-cache',
              networkTimeoutSeconds: 3,
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
        ],
      },
      manifest: {
        name: 'Nearbytes',
        short_name: 'Nearbytes',
        description: 'Cryptographic file storage with end-to-end encryption',
        theme_color: '#667eea',
        background_color: '#0a0a0f',
        display: 'standalone',
        icons: [
          {
            src: '/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    fs: {
      allow: [path.resolve(process.cwd(), '..')],
    },
  },
});
