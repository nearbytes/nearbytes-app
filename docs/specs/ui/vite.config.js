import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import fs from 'node:fs';
import path from 'path';
import { fileURLToPath } from 'url';

const rootDir = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = path.resolve(rootDir, '../../../');
const appConfigPath = path.resolve(repoRoot, 'app-config.json');

function studioAppConfigPlugin() {
  return {
    name: 'nearbytes-studio-app-config',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url || !req.url.startsWith('/__studio/app-config')) {
          next();
          return;
        }

        if (req.method === 'GET') {
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(`${JSON.stringify(readAppConfig(), null, 2)}\n`);
          return;
        }

        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }

        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => {
          try {
            const patch = body.trim() === '' ? {} : JSON.parse(body);
            const nextConfig = mergeAppConfig(readAppConfig(), patch);
            fs.writeFileSync(appConfigPath, `${JSON.stringify(nextConfig, null, 2)}\n`, 'utf8');
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true, config: nextConfig }));
          } catch (error) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                error: error instanceof Error ? error.message : 'Invalid app config payload',
              })
            );
          }
        });
      });
    },
  };
}

function readAppConfig() {
  try {
    return JSON.parse(fs.readFileSync(appConfigPath, 'utf8'));
  } catch (_error) {
    return {
      version: 1,
      studio: {
        moodboardId: 'harbor-night',
      },
    };
  }
}

function mergeAppConfig(current, patch) {
  const nextStudio = {
    ...(current && typeof current === 'object' && current.studio && typeof current.studio === 'object' ? current.studio : {}),
    ...(patch && typeof patch === 'object' && patch.studio && typeof patch.studio === 'object' ? patch.studio : {}),
  };

  return {
    ...(current && typeof current === 'object' ? current : {}),
    ...(patch && typeof patch === 'object' ? patch : {}),
    version: 1,
    studio: nextStudio,
  };
}

export default defineConfig({
  plugins: [studioAppConfigPlugin(), svelte()],
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