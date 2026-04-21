import { defineConfig } from 'vitest/config';
import baseConfig from './vitest.config';

const exclude = Array.isArray(baseConfig.test?.exclude)
  ? baseConfig.test.exclude.filter((pattern) => pattern !== '**/*.live.test.ts')
  : baseConfig.test?.exclude;

export default defineConfig({
  ...baseConfig,
  test: {
    ...baseConfig.test,
    exclude,
  },
});