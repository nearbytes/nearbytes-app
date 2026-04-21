#!/usr/bin/env node
import { spawnSync } from 'child_process';

const yarnCommand = process.platform === 'win32' ? 'yarn.cmd' : 'yarn';
const args = [
  'vitest',
  'run',
  '--config',
  'vitest.live.config.ts',
  'src/integrations/__tests__/megaLayer1.live.test.ts',
  ...process.argv.slice(2),
];

const result = spawnSync(yarnCommand, args, {
  stdio: 'inherit',
  env: process.env,
});

if (typeof result.status === 'number') {
  process.exit(result.status);
}
if (result.error) {
  throw result.error;
}
process.exit(1);
