import path from 'path';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';
import { nearbytesDevApiProxy } from './devApiProxy.js';

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
