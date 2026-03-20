#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { ensureBuiltMegaCmd } from './megacmd-helper.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

if (process.platform !== 'win32') {
  console.error('package-vendored-megacmd-release.mjs only supports Windows packaging.');
  process.exit(1);
}

const outputRoot = resolveOutputRoot(process.argv.slice(2));
const platformArchRoot = path.join(outputRoot, `${process.platform}-${process.arch}`);
const commandRoot = outputRoot;

await fs.rm(platformArchRoot, { recursive: true, force: true });
const commandDirectory = await ensureBuiltMegaCmd(repoRoot, {
  mode: 'build',
  commandRoot,
});

const manifestPath = path.join(platformArchRoot, 'manifest.json');
await fs.mkdir(platformArchRoot, { recursive: true });
await fs.writeFile(
  manifestPath,
  `${JSON.stringify(
    {
      platform: process.platform,
      arch: process.arch,
      generatedAt: new Date().toISOString(),
      nearbytesCommit: git(['rev-parse', 'HEAD']),
      megacmdCommit: git(['-C', 'vendor/MEGAcmd', 'rev-parse', 'HEAD']),
      megaSdkCommit: git(['-C', 'vendor/MEGAcmd/sdk', 'rev-parse', 'HEAD']),
      commandDirectory: path.relative(platformArchRoot, commandDirectory).replace(/\\/gu, '/'),
    },
    null,
    2
  )}\n`,
  'utf8'
);

console.log(platformArchRoot);

function resolveOutputRoot(args) {
  const outputIndex = args.findIndex((arg) => arg === '--output-dir');
  if (outputIndex >= 0) {
    const candidate = args[outputIndex + 1];
    if (!candidate) {
      throw new Error('Missing value after --output-dir');
    }
    return path.resolve(repoRoot, candidate);
  }
  return path.join(repoRoot, 'artifacts', 'megacmd-release');
}

function git(args) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim();
}