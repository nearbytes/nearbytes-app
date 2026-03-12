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
  '/references',
  '/chat',
  '/health',
  '/timeline',
  '/snapshot',
  '/__debug',
  '/config',
  '/sources',
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

        const session = readDesktopSession();
        const targetUrl = new URL(
          session ? `http://127.0.0.1:${session.port}` : DEFAULT_SERVER_PROXY_TARGET
        );
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
          res.statusCode = 502;
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              error: {
                code: 'BAD_GATEWAY',
                message: `Nearbytes dev proxy error: ${error.message}`,
              },
            })
          );
        });

        req.pipe(proxyReq);
      });
    },
  };
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
      typeof parsed.port !== 'number' ||
      !Number.isFinite(parsed.port) ||
      parsed.port <= 0 ||
      typeof parsed.token !== 'string' ||
      parsed.token.trim().length === 0
    ) {
      return null;
    }
    return {
      port: parsed.port,
      token: parsed.token,
    };
  } catch {
    return null;
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
            urlPattern: /^\/(open|files|upload|file|references|chat|health|timeline|snapshot|config|sources|watch)/,
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
  },
});
