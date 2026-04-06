#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const uiDir = path.join(repoRoot, 'ui');
const iosDerivedDataPath = path.join(uiDir, 'ios', '.derived-dev-iphone');
const simulatorAppPath = path.join(iosDerivedDataPath, 'Build', 'Products', 'Debug-iphonesimulator', 'App.app');
const bundleId = 'org.nearbytes.mobile';
const defaultUiUrl = `http://127.0.0.1:${parsePort(process.env.NEARBYTES_WEB_DEV_PORT, 5177)}`;
const mobileServerUrl = process.env.NEARBYTES_MOBILE_SERVER_URL?.trim() || defaultUiUrl;

await main();

async function main() {
  const webDev = spawn('yarn', ['--cwd', 'ui', 'dev:raw'], {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit',
    shell: false,
  });
  const signalHandlers = installSignalHandlers(() => {
    if (webDev.exitCode === null) {
      webDev.kill('SIGTERM');
    }
  });

  webDev.once('error', (error) => {
    console.error(`[iphone-dev] failed to start UI dev server: ${formatError(error)}`);
  });

  try {
    await waitForHttpEndpoint(mobileServerUrl, 30_000, webDev, 'Nearbytes UI dev server');
    runYarnInRepo([
      '--cwd',
      'ui',
      'mobile:ios:sync',
    ], {
      ...process.env,
      NEARBYTES_MOBILE_SERVER_URL: mobileServerUrl,
    });
    await fs.rm(path.join(iosDerivedDataPath, 'Build'), { recursive: true, force: true });
    runCommand('xcodebuild', [
      '-resolvePackageDependencies',
      '-project',
      'ios/App/App.xcodeproj',
      '-scheme',
      'App',
      '-derivedDataPath',
      iosDerivedDataPath,
    ], {
      cwd: uiDir,
    });
    runCommand('xcodebuild', [
      '-project',
      'ios/App/App.xcodeproj',
      '-scheme',
      'App',
      '-configuration',
      'Debug',
      '-derivedDataPath',
      iosDerivedDataPath,
      '-destination',
      'generic/platform=iOS Simulator',
      'CODE_SIGNING_ALLOWED=NO',
      'build',
    ], {
      cwd: uiDir,
    });
    const simulator = selectSimulator();
    runCommand('open', ['-a', 'Simulator']);
    runCommand('xcrun', ['simctl', 'boot', simulator.udid], { allowNonZero: true });
    runCommand('xcrun', ['simctl', 'bootstatus', simulator.udid, '-b']);
    runCommand('xcrun', ['simctl', 'install', simulator.udid, simulatorAppPath]);
    runCommand('xcrun', ['simctl', 'launch', '--console', simulator.udid, bundleId]);
    console.log(`[iphone-dev] App launched in Simulator on ${simulator.name} using ${mobileServerUrl}. The backend is not started by this command.`);
    await waitForExitOrSignal(webDev, signalHandlers.stopPromise);
  } finally {
    signalHandlers.release();
    if (webDev.exitCode === null) {
      webDev.kill('SIGTERM');
      await waitForExitIgnoringFailure(webDev);
    }
  }
}

function runYarnInRepo(args, env = process.env) {
  const result = spawnSync('yarn', args, {
    cwd: repoRoot,
    env,
    stdio: 'inherit',
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(`command failed: yarn ${args.join(' ')}`);
  }
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? process.env,
    stdio: 'inherit',
    shell: false,
  });
  if (!options.allowNonZero && result.status !== 0) {
    throw new Error(`command failed: ${command} ${args.join(' ')}`);
  }
  return result;
}

async function waitForHttpEndpoint(url, timeoutMs, child, label) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode !== null) {
      throw new Error(`${label} exited before becoming ready (exit code ${child.exitCode}).`);
    }
    if (await isHttpEndpointReady(url, 1_000)) {
      return;
    }
    await delay(250);
  }
  throw new Error(`${label} did not become ready within ${Math.ceil(timeoutMs / 1000)} seconds.`);
}

async function isHttpEndpointReady(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const response = await fetch(url, { method: 'GET', signal: controller.signal });
    return response.ok || response.status >= 400;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function delay(timeoutMs) {
  return new Promise((resolve) => setTimeout(resolve, timeoutMs));
}

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) {
        resolve();
        return;
      }
      if (code && code !== 0) {
        reject(new Error(`Nearbytes UI dev server exited with code ${code}.`));
        return;
      }
      resolve();
    });
  });
}

async function waitForExitOrSignal(child, stopPromise) {
  await Promise.race([waitForExit(child), stopPromise]);
}

async function waitForExitIgnoringFailure(child) {
  try {
    await waitForExit(child);
  } catch {
    // Shutdown can propagate a non-zero exit from the dev server after an intentional stop.
  }
}

function installSignalHandlers(onSignal) {
  let resolved = false;
  let resolveStop;
  const stopPromise = new Promise((resolve) => {
    resolveStop = resolve;
  });
  const handler = () => {
    if (resolved) {
      return;
    }
    resolved = true;
    process.exitCode = 0;
    onSignal();
    resolveStop();
  };
  process.on('SIGINT', handler);
  process.on('SIGTERM', handler);
  return {
    stopPromise,
    release() {
      process.off('SIGINT', handler);
      process.off('SIGTERM', handler);
    },
  };
}

function parsePort(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function selectSimulator() {
  const requestedUdid = process.env.NEARBYTES_IOS_SIMULATOR_UDID?.trim();
  const devices = listAvailableIphoneSimulators();
  if (devices.length === 0) {
    throw new Error('No available iPhone simulators were found.');
  }
  if (requestedUdid) {
    const requested = devices.find((device) => device.udid === requestedUdid);
    if (!requested) {
      throw new Error(`Requested simulator ${requestedUdid} was not found among available iPhone devices.`);
    }
    return requested;
  }
  return devices.find((device) => device.state === 'Booted') ?? devices[0];
}

function listAvailableIphoneSimulators() {
  const result = spawnSync('xcrun', ['simctl', 'list', 'devices', 'available', '--json'], {
    cwd: repoRoot,
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(`command failed: xcrun simctl list devices available --json\n${result.stderr}`.trim());
  }
  const parsed = JSON.parse(result.stdout);
  const devices = [];
  for (const [runtime, entries] of Object.entries(parsed.devices ?? {})) {
    if (!runtime.includes('iOS')) {
      continue;
    }
    for (const entry of Array.isArray(entries) ? entries : []) {
      if (!entry.isAvailable || !String(entry.name).startsWith('iPhone')) {
        continue;
      }
      devices.push({
        name: String(entry.name),
        udid: String(entry.udid),
        state: String(entry.state ?? ''),
        runtime,
      });
    }
  }
  devices.sort((left, right) => {
    if (left.state === 'Booted' && right.state !== 'Booted') return -1;
    if (left.state !== 'Booted' && right.state === 'Booted') return 1;
    return left.name.localeCompare(right.name);
  });
  return devices;
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}