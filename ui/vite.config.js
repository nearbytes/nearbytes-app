import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    svelte(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        runtimeCaching: [
          {
            urlPattern: /^\/(open|files|upload|file|health|timeline|snapshot|config|sources|watch)/,
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
    proxy: {
      '/open': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/files': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/upload': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/file': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/timeline': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/snapshot': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/__debug': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/config': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/sources': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/watch': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
