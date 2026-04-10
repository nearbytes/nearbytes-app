import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'path';
import { fileURLToPath } from 'url';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [svelte()],
  build: {
    rollupOptions: {
      input: {
        index: path.resolve(rootDir, 'index.html'),
        moodboard: path.resolve(rootDir, 'moodboard.html'),
        palette: path.resolve(rootDir, 'palette.html'),
        styles: path.resolve(rootDir, 'styles.html'),
        graph: path.resolve(rootDir, 'graph.html'),
        desktop: path.resolve(rootDir, 'desktop.html'),
        phone: path.resolve(rootDir, 'phone.html'),
      },
    },
  },
});