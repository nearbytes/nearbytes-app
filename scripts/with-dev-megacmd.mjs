#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

const childCommand = process.argv[2];
const childArgs = process.argv.slice(3);

if (!childCommand) {
  console.error('Usage: node scripts/with-dev-megacmd.mjs <command> [args...]');
  process.exit(1);
}

const commandDirectory = await ensureVendoredMegaCmd(repoRoot);
const exitCode = await runChildProcess(childCommand, childArgs, {
  ...process.env,
  NEARBYTES_MEGACMD_DIR: commandDirectory,
});
process.exit(exitCode);

async function ensureVendoredMegaCmd(rootDir) {
  const sourceDir = path.join(rootDir, 'vendor', 'MEGAcmd');
  const buildDir = path.join(sourceDir, 'build', 'build-cmake-Release');
  const commandDirectory = path.join(rootDir, '.nearbytes-dev', 'megacmd', `${process.platform}-${process.arch}`, 'bin');

  await ensureCmakeConfigured(sourceDir, buildDir);
  await runCommand('cmake', ['--build', buildDir, '--config', 'Release'], {
    cwd: rootDir,
    errorPrefix: 'Failed to build vendored MEGAcmd for dev mode',
  });
  await stageCommandDirectory(sourceDir, buildDir, commandDirectory);

  return commandDirectory;
}

async function ensureCmakeConfigured(sourceDir, buildDir) {
  try {
    await fs.access(path.join(buildDir, 'CMakeCache.txt'));
    return;
  } catch {
    // Fresh configure.
  }

  const configureArgs = ['-S', sourceDir, '-B', buildDir, '-DCMAKE_BUILD_TYPE=Release'];
  if (process.platform === 'darwin') {
    const sdkPath = (await captureCommand('xcrun', ['--show-sdk-path'], {
      cwd: sourceDir,
      errorPrefix: 'Failed to locate the active macOS SDK for vendored MEGAcmd',
    })).trim();
    if (sdkPath.length > 0) {
      configureArgs.push(`-DCMAKE_OSX_SYSROOT=${sdkPath}`);
    }
  }

  await runCommand('cmake', configureArgs, {
    cwd: sourceDir,
    errorPrefix: 'Failed to configure vendored MEGAcmd for dev mode',
  });
}

async function stageCommandDirectory(sourceDir, buildDir, commandDirectory) {
  await fs.rm(commandDirectory, { recursive: true, force: true });
  await fs.mkdir(commandDirectory, { recursive: true });

  if (process.platform === 'win32') {
    await stageWindowsCommandDirectory(sourceDir, buildDir, commandDirectory);
    return;
  }

  await stageUnixCommandDirectory(sourceDir, buildDir, commandDirectory);
}

async function stageUnixCommandDirectory(sourceDir, buildDir, commandDirectory) {
  const clientScriptsDir = path.join(sourceDir, 'src', 'client');
  const entries = await fs.readdir(clientScriptsDir, { withFileTypes: true });

  await writeShellWrapper(path.join(commandDirectory, 'mega-exec'), resolveUnixClientBinary(buildDir));
  await writeShellWrapper(path.join(commandDirectory, 'mega-cmd'), resolveUnixShellBinary(buildDir));
  await writeShellWrapper(path.join(commandDirectory, 'mega-cmd-server'), resolveUnixServerBinary(buildDir));

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    if (!entry.name.startsWith('mega-')) {
      continue;
    }
    if (entry.name === 'mega-exec') {
      continue;
    }
    if (entry.name.endsWith('.cpp') || entry.name.endsWith('.h')) {
      continue;
    }
    const sourcePath = path.join(clientScriptsDir, entry.name);
    const targetPath = path.join(commandDirectory, entry.name);
    await fs.copyFile(sourcePath, targetPath);
    await fs.chmod(targetPath, 0o755);
  }
}

async function stageWindowsCommandDirectory(sourceDir, buildDir, commandDirectory) {
  const builtClient = path.join(buildDir, 'MEGAclient.exe');
  const builtServer = path.join(buildDir, 'MEGAcmdServer.exe');
  const builtShell = path.join(buildDir, 'MEGAcmdShell.exe');

  await copyRequiredFile(builtClient, path.join(commandDirectory, 'MEGAclient.exe'));
  await copyRequiredFile(builtClient, path.join(commandDirectory, 'MegaClient.exe'));
  await copyRequiredFile(builtServer, path.join(commandDirectory, 'MEGAcmdServer.exe'));
  await copyOptionalFile(builtShell, path.join(commandDirectory, 'MEGAcmdShell.exe'));

  const clientScriptsDir = path.join(sourceDir, 'src', 'client', 'win');
  const entries = await fs.readdir(clientScriptsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.startsWith('mega-') || !entry.name.endsWith('.bat')) {
      continue;
    }
    await fs.copyFile(path.join(clientScriptsDir, entry.name), path.join(commandDirectory, entry.name));
  }

  const buildEntries = await fs.readdir(buildDir, { withFileTypes: true });
  for (const entry of buildEntries) {
    if (!entry.isFile()) {
      continue;
    }
    if (!isWindowsRuntimeDependency(entry.name)) {
      continue;
    }
    await fs.copyFile(path.join(buildDir, entry.name), path.join(commandDirectory, entry.name));
  }
}

function resolveUnixClientBinary(buildDir) {
  if (process.platform === 'darwin') {
    return path.join(buildDir, 'mega-exec.app', 'Contents', 'MacOS', 'mega-exec');
  }
  return path.join(buildDir, 'mega-exec');
}

function resolveUnixShellBinary(buildDir) {
  if (process.platform === 'darwin') {
    return path.join(buildDir, 'mega-cmd.app', 'Contents', 'MacOS', 'mega-cmd');
  }
  return path.join(buildDir, 'mega-cmd');
}

function resolveUnixServerBinary(buildDir) {
  if (process.platform === 'darwin') {
    return path.join(buildDir, 'MEGAcmd.app', 'Contents', 'MacOS', 'MEGAcmd');
  }
  return path.join(buildDir, 'mega-cmd-server');
}

async function writeShellWrapper(filePath, targetPath) {
  try {
    await fs.access(targetPath);
  } catch (error) {
    throw new Error(`Missing vendored MEGAcmd artifact: ${targetPath}`, { cause: error });
  }
  const escapedTarget = shellQuote(targetPath);
  await fs.writeFile(filePath, `#!/bin/sh\nexec ${escapedTarget} "$@"\n`, 'utf8');
  await fs.chmod(filePath, 0o755);
}

async function copyRequiredFile(sourcePath, targetPath) {
  try {
    await fs.copyFile(sourcePath, targetPath);
  } catch (error) {
    if (targetPath === sourcePath) {
      try {
        await fs.access(sourcePath);
        return;
      } catch {
        // Fall through to the generic error below.
      }
    }
    throw new Error(`Missing vendored MEGAcmd artifact: ${sourcePath}`, { cause: error });
  }
}

async function copyOptionalFile(sourcePath, targetPath) {
  try {
    await fs.copyFile(sourcePath, targetPath);
  } catch {
    // Optional in dev mode.
  }
}

function isWindowsRuntimeDependency(fileName) {
  return /\.(dll|manifest)$/iu.test(fileName);
}

function shellQuote(value) {
  return `'${value.replace(/'/gu, `'"'"'`)}'`;
}

async function runChildProcess(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
        return;
      }
      resolve(code ?? 0);
    });
  });
}

async function runCommand(command, args, options) {
  const { stdout, stderr, exitCode } = await captureProcess(command, args, options.cwd);
  if (exitCode !== 0) {
    const details = [stdout.trim(), stderr.trim()].filter((value) => value.length > 0).join('\n');
    throw new Error(details.length > 0 ? `${options.errorPrefix}\n${details}` : options.errorPrefix);
  }
}

async function captureCommand(command, args, options) {
  const { stdout, stderr, exitCode } = await captureProcess(command, args, options.cwd);
  if (exitCode !== 0) {
    const details = [stdout.trim(), stderr.trim()].filter((value) => value.length > 0).join('\n');
    throw new Error(details.length > 0 ? `${options.errorPrefix}\n${details}` : options.errorPrefix);
  }
  return stdout;
}

async function captureProcess(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: 'pipe',
      shell: process.platform === 'win32',
    });
    const stdoutChunks = [];
    const stderrChunks = [];

    child.stdout.on('data', (chunk) => {
      stdoutChunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderrChunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    });
    child.once('error', reject);
    child.once('close', (exitCode) => {
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        exitCode: exitCode ?? 1,
      });
    });
  });
}