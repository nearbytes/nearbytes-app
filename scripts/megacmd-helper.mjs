import { execFileSync, spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export async function ensureMegaCmdForDev(rootDir, options = {}) {
  const targetPlatform = options.platform ?? process.platform;
  const targetArch = options.arch ?? process.arch;
  const commandRoot = options.commandRoot ?? path.join(rootDir, '.nearbytes-dev', 'megacmd');
  const commandDirectory = path.join(commandRoot, `${targetPlatform}-${targetArch}`, 'bin');
  const mode =
    options.mode ??
    (targetPlatform === 'win32' ? 'release' : 'build');

  if (targetPlatform === 'win32' && mode !== 'build') {
    return ensureReleasedMegaCmd(rootDir, {
      ...options,
      platform: targetPlatform,
      arch: targetArch,
      commandDirectory,
    });
  }

  await ensureBuiltMegaCmd(rootDir, {
    ...options,
    platform: targetPlatform,
    arch: targetArch,
    commandDirectory,
  });
  return commandDirectory;
}

export async function ensureBuiltMegaCmd(rootDir, options = {}) {
  const targetPlatform = options.platform ?? process.platform;
  const targetArch = options.arch ?? process.arch;
  const sourceDir = path.join(rootDir, 'vendor', 'MEGAcmd');
  const buildDir = path.join(sourceDir, 'build', 'build-cmake-Release');
  const commandDirectory =
    options.commandDirectory ??
    path.join(
      options.commandRoot ?? path.join(rootDir, '.nearbytes-dev', 'megacmd'),
      `${targetPlatform}-${targetArch}`,
      'bin'
    );

  await ensureVendoredVcpkgRoot(rootDir);
  await ensureCmakeConfigured(sourceDir, buildDir, targetPlatform);
  const buildTargets =
    targetPlatform === 'win32'
      ? ['mega-exec', 'mega-cmd-server']
      : ['mega-exec', 'mega-cmd', 'mega-cmd-server'];

  await runCommand('cmake', ['--build', buildDir, '--config', 'Release', '--target', ...buildTargets], {
    cwd: rootDir,
    errorPrefix: 'Failed to build vendored MEGAcmd for dev mode',
  });
  await stageCommandDirectory(sourceDir, buildDir, commandDirectory, targetPlatform);

  return commandDirectory;
}

async function ensureReleasedMegaCmd(rootDir, options) {
  const commandDirectory = options.commandDirectory;
  const releaseConfig = resolveReleaseConfig(rootDir, options);
  const releaseInfo = await fetchReleaseInfo(releaseConfig);
  const asset = releaseInfo.assets.find((entry) => entry.name === releaseConfig.assetName);
  if (!asset) {
    throw new Error(
      `Failed to locate ${releaseConfig.assetName} in ${releaseConfig.owner}/${releaseConfig.repo} release ${releaseConfig.tag}`
    );
  }

  const cacheRoot = path.join(
    rootDir,
    '.nearbytes-dev',
    'cache',
    'megacmd',
    'releases',
    `${releaseConfig.owner}-${releaseConfig.repo}`,
    releaseConfig.tag,
    `${options.platform}-${options.arch}`
  );
  const manifestPath = path.join(cacheRoot, 'manifest.json');
  const extractRoot = path.join(cacheRoot, 'extracted');
  const extractedCommandDirectory = path.join(extractRoot, `${options.platform}-${options.arch}`, 'bin');

  if (await isCachedAssetReady(manifestPath, extractedCommandDirectory, asset.id)) {
    await mirrorCachedCommandDirectory(extractedCommandDirectory, commandDirectory);
    return commandDirectory;
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nearbytes-megacmd-release-'));
  try {
    const archivePath = path.join(tempDir, asset.name);
    await downloadFile(asset.browser_download_url, archivePath, releaseConfig.token);
    await fs.rm(cacheRoot, { recursive: true, force: true });
    await fs.mkdir(extractRoot, { recursive: true });
    await extractZipArchive(archivePath, extractRoot, rootDir);
    await assertCommandDirectory(extractedCommandDirectory);
    await fs.writeFile(
      manifestPath,
      `${JSON.stringify(
        {
          assetId: asset.id,
          assetName: asset.name,
          releaseId: releaseInfo.id,
          tag: releaseConfig.tag,
          updatedAt: asset.updated_at,
        },
        null,
        2
      )}\n`,
      'utf8'
    );
    await mirrorCachedCommandDirectory(extractedCommandDirectory, commandDirectory);
    return commandDirectory;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

function resolveReleaseConfig(rootDir, options) {
  const owner =
    options.releaseOwner ??
    process.env.NEARBYTES_MEGACMD_RELEASE_OWNER?.trim() ??
    process.env.NEARBYTES_RELEASE_OWNER?.trim() ??
    resolveRepositorySlug(rootDir)?.split('/')[0];
  const repo =
    options.releaseRepo ??
    process.env.NEARBYTES_MEGACMD_RELEASE_REPO?.trim() ??
    process.env.NEARBYTES_RELEASE_REPO?.trim() ??
    resolveRepositorySlug(rootDir)?.split('/')[1];

  if (!owner || !repo) {
    throw new Error('Unable to resolve the Nearbytes release repository for MEGAcmd helper downloads.');
  }

  const targetPlatform = options.platform ?? process.platform;
  const targetArch = options.arch ?? process.arch;
  return {
    owner,
    repo,
    tag:
      options.releaseTag ??
      process.env.NEARBYTES_MEGACMD_RELEASE_TAG?.trim() ??
      `megacmd-helper-${targetPlatform}-${targetArch}`,
    assetName:
      options.assetName ??
      process.env.NEARBYTES_MEGACMD_RELEASE_ASSET?.trim() ??
      `nearbytes-megacmd-${targetPlatform}-${targetArch}.zip`,
    token: process.env.GH_TOKEN?.trim() || process.env.GITHUB_TOKEN?.trim() || undefined,
  };
}

async function fetchReleaseInfo(config) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'nearbytes-megacmd-helper',
  };
  if (config.token) {
    headers.Authorization = `Bearer ${config.token}`;
  }
  const response = await fetch(
    `https://api.github.com/repos/${config.owner}/${config.repo}/releases/tags/${config.tag}`,
    { headers }
  );
  if (!response.ok) {
    throw new Error(
      `Failed to read release ${config.owner}/${config.repo}@${config.tag} (${response.status})`
    );
  }
  return response.json();
}

async function isCachedAssetReady(manifestPath, commandDirectory, assetId) {
  try {
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    if (manifest.assetId !== assetId) {
      return false;
    }
    await assertCommandDirectory(commandDirectory);
    return true;
  } catch {
    return false;
  }
}

async function mirrorCachedCommandDirectory(sourceDir, targetDir) {
  await assertCommandDirectory(sourceDir);
  await fs.rm(targetDir, { recursive: true, force: true });
  await copyDirectory(sourceDir, targetDir);
}

async function copyDirectory(sourceDir, targetDir) {
  await fs.mkdir(targetDir, { recursive: true });
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, targetPath);
      continue;
    }
    await fs.copyFile(sourcePath, targetPath);
  }
}

async function assertCommandDirectory(commandDirectory) {
  try {
    await fs.access(path.join(commandDirectory, 'MegaClient.exe'));
  } catch {
    try {
      await fs.access(path.join(commandDirectory, 'MEGAclient.exe'));
    } catch (error) {
      throw new Error(`Missing staged MEGAcmd helper at ${commandDirectory}`, { cause: error });
    }
  }
}

async function extractZipArchive(archivePath, destinationDir, cwd) {
  const escapedArchive = escapePowerShellLiteral(archivePath);
  const escapedDestination = escapePowerShellLiteral(destinationDir);
  await runCommand(
    'powershell',
    [
      '-NoLogo',
      '-NoProfile',
      '-Command',
      `Expand-Archive -LiteralPath '${escapedArchive}' -DestinationPath '${escapedDestination}' -Force`,
    ],
    {
      cwd,
      errorPrefix: 'Failed to extract cached MEGAcmd helper archive',
    }
  );
}

function escapePowerShellLiteral(value) {
  return value.replace(/'/gu, "''");
}

async function ensureVendoredVcpkgRoot(rootDir) {
  const vcpkgRoot = path.join(rootDir, 'vendor', 'vcpkg');
  const toolchainPath = path.join(vcpkgRoot, 'scripts', 'buildsystems', 'vcpkg.cmake');
  try {
    await fs.access(toolchainPath);
  } catch {
    await fs.rm(vcpkgRoot, { recursive: true, force: true });
  }
}

async function ensureCmakeConfigured(sourceDir, buildDir, platform) {
  const cachePath = path.join(buildDir, 'CMakeCache.txt');
  try {
    await fs.access(cachePath);
    if (await isValidCmakeCache(cachePath, sourceDir)) {
      return;
    }
    await fs.rm(buildDir, { recursive: true, force: true });
  } catch {
    // Fresh configure.
  }

  const configureArgs = [
    '-S',
    sourceDir,
    '-B',
    buildDir,
    '-DCMAKE_BUILD_TYPE=Release',
    '-DFULL_REQS=OFF',
    '-DUSE_FFMPEG=OFF',
    '-DUSE_PDFIUM=OFF',
    '-DUSE_FREEIMAGE=OFF',
    '-DENABLE_MEDIA_FILE_METADATA=OFF',
    '-DUSE_MEDIAINFO=OFF',
    '-DUSE_LIBUV=OFF',
    '-DWITH_FUSE=OFF',
  ];
  if (platform === 'darwin') {
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

async function isValidCmakeCache(cachePath, sourceDir) {
  try {
    const cacheContent = await fs.readFile(cachePath, 'utf8');
    if (!cacheContent.includes('CMAKE_PROJECT_NAME:STATIC=')) {
      return false;
    }

    const homeDirectoryLine = cacheContent
      .split(/\r?\n/u)
      .find((line) => line.startsWith('CMAKE_HOME_DIRECTORY:INTERNAL='));

    if (!homeDirectoryLine) {
      return false;
    }

    const configuredSourceDir = homeDirectoryLine.slice('CMAKE_HOME_DIRECTORY:INTERNAL='.length);
    if (path.resolve(configuredSourceDir) !== path.resolve(sourceDir)) {
      return false;
    }

    const generatorLine = cacheContent
      .split(/\r?\n/u)
      .find((line) => line.startsWith('CMAKE_GENERATOR:INTERNAL='));

    if (!generatorLine) {
      return false;
    }

    const generator = generatorLine.slice('CMAKE_GENERATOR:INTERNAL='.length);
    const buildDir = path.dirname(cachePath);

    if (generator.startsWith('Visual Studio')) {
      try {
        await fs.access(path.join(buildDir, 'ALL_BUILD.vcxproj'));
        return true;
      } catch {
        return false;
      }
    }

    if (generator === 'Ninja' || generator === 'Ninja Multi-Config') {
      try {
        await fs.access(path.join(buildDir, 'build.ninja'));
        return true;
      } catch {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}

async function stageCommandDirectory(sourceDir, buildDir, commandDirectory, platform) {
  await fs.rm(commandDirectory, { recursive: true, force: true });
  await fs.mkdir(commandDirectory, { recursive: true });

  if (platform === 'win32') {
    await stageWindowsCommandDirectory(sourceDir, buildDir, commandDirectory);
    return;
  }

  await stageUnixCommandDirectory(sourceDir, buildDir, commandDirectory, platform);
}

async function stageUnixCommandDirectory(sourceDir, buildDir, commandDirectory, platform) {
  const clientScriptsDir = path.join(sourceDir, 'src', 'client');
  const entries = await fs.readdir(clientScriptsDir, { withFileTypes: true });

  await writeShellWrapper(path.join(commandDirectory, 'mega-exec'), resolveUnixClientBinary(buildDir, platform));
  await writeShellWrapper(path.join(commandDirectory, 'mega-cmd'), resolveUnixShellBinary(buildDir, platform));
  await writeShellWrapper(
    path.join(commandDirectory, 'mega-cmd-server'),
    resolveUnixServerBinary(buildDir, platform)
  );

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

function resolveUnixClientBinary(buildDir, platform) {
  if (platform === 'darwin') {
    return path.join(buildDir, 'mega-exec.app', 'Contents', 'MacOS', 'mega-exec');
  }
  return path.join(buildDir, 'mega-exec');
}

function resolveUnixShellBinary(buildDir, platform) {
  if (platform === 'darwin') {
    return path.join(buildDir, 'mega-cmd.app', 'Contents', 'MacOS', 'mega-cmd');
  }
  return path.join(buildDir, 'mega-cmd');
}

function resolveUnixServerBinary(buildDir, platform) {
  if (platform === 'darwin') {
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
  return `'${value.replace(/'/gu, `"'"'`)}'`;
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
    const child = spawn(resolveCommand(command), args, {
      cwd,
      env: process.env,
      stdio: 'pipe',
      shell: false,
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

function resolveCommand(command) {
  if (process.platform !== 'win32') {
    return command;
  }

  const extension = path.extname(command);
  if (extension.length > 0) {
    return command;
  }

  if (command === 'yarn' || command === 'npm' || command === 'npx' || command === 'pnpm') {
    return `${command}.cmd`;
  }

  return `${command}.exe`;
}

function resolveRepositorySlug(rootDir) {
  try {
    const remoteUrl = execFileSync('git', ['config', '--get', 'remote.origin.url'], {
      cwd: rootDir,
      encoding: 'utf8',
    }).trim();
    return parseRemoteUrl(remoteUrl);
  } catch {
    return null;
  }
}

function parseRemoteUrl(remoteUrl) {
  if (!remoteUrl) {
    return null;
  }

  const sshMatch = remoteUrl.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/i);
  if (sshMatch) {
    return `${sshMatch[1]}/${sshMatch[2]}`;
  }

  const httpsMatch = remoteUrl.match(/^https?:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/i);
  if (httpsMatch) {
    return `${httpsMatch[1]}/${httpsMatch[2]}`;
  }

  return null;
}

async function downloadFile(url, filePath, token) {
  const headers = {
    Accept: 'application/octet-stream',
    'User-Agent': 'nearbytes-megacmd-helper',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(url, { headers, redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`Failed to download ${url} (${response.status})`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  await fs.writeFile(filePath, bytes);
}