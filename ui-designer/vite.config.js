import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [
    svelte({
      dynamicCompileOptions({ filename }) {
        const normalizedFilename = filename.replace(/\\/g, '/');
        if (normalizedFilename.includes('/node_modules/lucide-svelte/')) {
          return { runes: false };
        }
      },
    }),
  ],
  server: {
    host: '127.0.0.1',
    port: 5186,
    strictPort: true,
  },
});
