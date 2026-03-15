import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { resolveMegaInvocation, type CommandExecutor } from './runtime.js';
import type { ProviderSecretStore, IntegrationLogger } from './runtime.js';
import type { ProviderSetupState } from './types.js';

const MEGA_CONFIG_SECRET_KEY = 'provider-config:mega';
const MEGA_CMD_DOCS_URL = 'https://mega.io/cmd';

interface MegaConfigSecret {
  readonly commandDirectory?: string;
}

interface LinuxOsRelease {
  readonly id: string;
  readonly versionId: string;
}

export class MegaHelperInstaller {
  private installPromise: Promise<ProviderSetupState> | null = null;

  constructor(
    private readonly options: {
      secretStore: ProviderSecretStore;
      commandExecutor: CommandExecutor;
      logger: IntegrationLogger;
      configuredCommandDirectory?: string;
      homeDir?: string;
      fetchImpl?: typeof fetch;
      platform?: NodeJS.Platform;
      arch?: string;
      linuxRelease?: LinuxOsRelease;
    }
  ) {}

  async getSetupState(): Promise<ProviderSetupState> {
    if (this.installPromise) {
      return {
        status: 'installing',
        detail: 'Nearbytes is downloading and preparing MEGAcmd.',
        docsUrl: MEGA_CMD_DOCS_URL,
        canInstall: false,
      };
    }

    const commandDirectory = await this.getWorkingCommandDirectory();
    if (commandDirectory !== null) {
      return {
        status: 'ready',
        detail: 'MEGA CLI is ready to use.',
        docsUrl: MEGA_CMD_DOCS_URL,
        canInstall: true,
        config: {
          helperPath: commandDirectory || 'PATH',
        },
      };
    }

    const platform = this.options.platform ?? process.platform;
    if (!isSupportedPlatform(platform)) {
      return {
        status: 'unsupported',
        detail: `Automatic MEGAcmd setup is not supported on ${platform}.`,
        docsUrl: MEGA_CMD_DOCS_URL,
      };
    }

    return {
      status: 'needs-install',
      detail: 'Nearbytes can download and install MEGAcmd automatically the first time you connect MEGA.',
      docsUrl: MEGA_CMD_DOCS_URL,
      canInstall: true,
    };
  }

  async install(): Promise<ProviderSetupState> {
    if (this.installPromise) {
      return this.installPromise;
    }
    this.installPromise = this.performInstall();
    try {
      return await this.installPromise;
    } finally {
      this.installPromise = null;
    }
  }

  async getCommandDirectory(): Promise<string | undefined> {
    const working = await this.getWorkingCommandDirectory();
    return working === null || working === '' ? undefined : working;
  }

  private async performInstall(): Promise<ProviderSetupState> {
    const installRoot = await this.resolveInstallRoot();
    await fs.rm(installRoot, { recursive: true, force: true });
    await fs.mkdir(installRoot, { recursive: true });
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nearbytes-megacmd-'));

    try {
      const platform = this.options.platform ?? process.platform;
      if (platform === 'win32') {
        await this.installWindows(tempDir, installRoot);
      } else if (platform === 'darwin') {
        await this.installMac(tempDir, installRoot);
      } else if (platform === 'linux') {
        await this.installLinux(tempDir, installRoot);
      } else {
        throw new Error(`Automatic MEGAcmd setup is not supported on ${platform}.`);
      }

      const commandDirectory = await this.findInstalledCommandDirectory(installRoot);
      if (!commandDirectory) {
        throw new Error('Nearbytes could not find the installed MEGAcmd commands.');
      }
      await this.options.secretStore.set<MegaConfigSecret>(MEGA_CONFIG_SECRET_KEY, {
        commandDirectory,
      });
      return {
        status: 'ready',
        detail: 'MEGAcmd is installed and ready.',
        docsUrl: MEGA_CMD_DOCS_URL,
        canInstall: true,
        config: {
          helperPath: commandDirectory,
        },
      };
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }

  private async getWorkingCommandDirectory(): Promise<string | null> {
    const configured = await this.getConfiguredCommandDirectory();
    if (configured && (await isMegaCommandDirectory(configured))) {
      return configured;
    }
    for (const candidate of this.getPlatformCommandDirectoryCandidates()) {
      if (await isMegaCommandDirectory(candidate)) {
        return candidate;
      }
    }
    if (await this.isMegaAvailableOnPath()) {
      return '';
    }
    return null;
  }

  private async getConfiguredCommandDirectory(): Promise<string | undefined> {
    const secret = (await this.options.secretStore.get<MegaConfigSecret>(MEGA_CONFIG_SECRET_KEY)) ?? {};
    return secret.commandDirectory?.trim() || this.options.configuredCommandDirectory?.trim() || undefined;
  }

  private async resolveInstallRoot(): Promise<string> {
    const homeDir = this.options.homeDir ?? os.homedir();
    return path.join(homeDir, '.nearbytes', 'helpers', 'megacmd');
  }

  private async findInstalledCommandDirectory(installRoot: string): Promise<string | null> {
    const candidates = [installRoot, ...this.getPlatformCommandDirectoryCandidates()];
    const attempted = new Set<string>();
    for (const candidate of candidates) {
      const normalized = path.resolve(candidate);
      if (attempted.has(normalized)) {
        continue;
      }
      attempted.add(normalized);
      if (await isMegaCommandDirectory(normalized)) {
        return normalized;
      }
      const nested = await locateMegaCommandDirectory(normalized);
      if (nested) {
        return nested;
      }
    }
    return null;
  }

  private getPlatformCommandDirectoryCandidates(): string[] {
    const platform = this.options.platform ?? process.platform;
    if (platform !== 'win32') {
      return [];
    }

    const homeDir = this.options.homeDir ?? os.homedir();
    const localAppData = process.env.LOCALAPPDATA?.trim() || path.join(homeDir, 'AppData', 'Local');
    const candidates = [
      path.join(localAppData, 'MEGAcmd'),
      path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'MEGAcmd'),
      path.join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'MEGAcmd'),
    ];
    return Array.from(new Set(candidates.map((candidate) => path.resolve(candidate))));
  }

  private async installWindows(tempDir: string, installRoot: string): Promise<void> {
    const arch = this.options.arch ?? process.arch;
    const url = arch === 'ia32' ? 'https://mega.nz/MEGAcmdSetup32.exe' : 'https://mega.nz/MEGAcmdSetup64.exe';
    const installerPath = path.join(tempDir, 'MEGAcmdSetup.exe');
    await this.downloadFile(url, installerPath);
    await this.options.commandExecutor.run({
      command: installerPath,
      args: ['/S', `/D=${installRoot}`],
      timeoutMs: 120_000,
    });
  }

  private async installMac(tempDir: string, installRoot: string): Promise<void> {
    const dmgPath = path.join(tempDir, 'MEGAcmdSetup.dmg');
    const mountDir = path.join(tempDir, 'mnt');
    await this.downloadFile('https://mega.nz/MEGAcmdSetup.dmg', dmgPath);
    await fs.mkdir(mountDir, { recursive: true });
    await this.options.commandExecutor.run({
      command: 'hdiutil',
      args: ['attach', dmgPath, '-nobrowse', '-quiet', '-mountpoint', mountDir],
      timeoutMs: 120_000,
    });
    try {
      await this.options.commandExecutor.run({
        command: 'cp',
        args: ['-R', path.join(mountDir, 'MEGAcmd.app'), path.join(installRoot, 'MEGAcmd.app')],
        timeoutMs: 120_000,
      });
      await this.options.commandExecutor.run({
        command: 'xattr',
        args: ['-dr', 'com.apple.quarantine', path.join(installRoot, 'MEGAcmd.app')],
        timeoutMs: 30_000,
      }).catch(() => {
        // Ignore missing xattr or already-clean bundles.
      });
    } finally {
      await this.options.commandExecutor.run({
        command: 'hdiutil',
        args: ['detach', mountDir, '-quiet'],
        timeoutMs: 30_000,
      }).catch(() => {
        // Ignore detach failures; the temporary directory will still be removed.
      });
    }
  }

  private async installLinux(tempDir: string, installRoot: string): Promise<void> {
    const release = this.options.linuxRelease ?? (await readLinuxOsRelease());
    const packageInfo = resolveLinuxPackageUrl(release, this.options.arch ?? process.arch);
    const packagePath = path.join(tempDir, path.basename(packageInfo.url));
    await this.downloadFile(packageInfo.url, packagePath);

    if (packageInfo.kind === 'deb') {
      await this.options.commandExecutor.run({
        command: 'ar',
        args: ['x', packagePath],
        cwd: tempDir,
        timeoutMs: 60_000,
      });
      const dataArchive = (await fs.readdir(tempDir)).find((entry) => entry.startsWith('data.tar.'));
      if (!dataArchive) {
        throw new Error('The downloaded MEGAcmd Debian package did not contain a data archive.');
      }
      await this.options.commandExecutor.run({
        command: 'tar',
        args: ['-xf', path.join(tempDir, dataArchive), '-C', installRoot],
        timeoutMs: 120_000,
      });
      return;
    }

    if (packageInfo.kind === 'rpm') {
      await this.options.commandExecutor.run({
        command: 'sh',
        args: ['-lc', `rpm2cpio '${packagePath.replace(/'/g, "'\\''")}' | cpio -idmv`],
        cwd: installRoot,
        timeoutMs: 120_000,
      });
      return;
    }

    await this.options.commandExecutor.run({
      command: 'tar',
      args: ['--zstd', '-xf', packagePath, '-C', installRoot],
      timeoutMs: 120_000,
    });
  }

  private async isMegaAvailableOnPath(): Promise<boolean> {
    try {
      const invocation = resolveMegaInvocation(undefined, 'version', [], this.options.platform ?? process.platform);
      const result = await this.options.commandExecutor.run({
        command: invocation.command,
        args: invocation.args,
        timeoutMs: 15_000,
      });
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }

  private async downloadFile(url: string, filePath: string): Promise<void> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    this.options.logger.log(`Downloading MEGAcmd helper from ${url}`);
    const response = await fetchImpl(url);
    if (!response.ok) {
      throw new Error(`Failed to download MEGAcmd helper from ${url} (${response.status})`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    await fs.writeFile(filePath, bytes);
  }
}

async function isMegaCommandDirectory(commandDirectory: string): Promise<boolean> {
  for (const commandName of ['MegaClient.exe', 'MEGAclient.exe', 'mega-login.bat', 'mega-login.exe', 'mega-login']) {
    try {
      await fs.access(path.join(commandDirectory, commandName));
      return true;
    } catch {
      // Try the next candidate.
    }
  }
  return false;
}

async function locateMegaCommandDirectory(root: string): Promise<string | null> {
  const queue = [root];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (await isMegaCommandDirectory(current)) {
      return current;
    }
    let entries: import('fs').Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        queue.push(path.join(current, entry.name));
      }
    }
  }
  return null;
}

async function readLinuxOsRelease(): Promise<LinuxOsRelease> {
  const raw = await fs.readFile('/etc/os-release', 'utf8');
  const values = Object.fromEntries(
    raw
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const [key, ...rest] = line.split('=');
        return [key, rest.join('=').replace(/^"|"$/g, '')];
      })
  );
  return {
    id: String(values.ID ?? '').trim().toLowerCase(),
    versionId: String(values.VERSION_ID ?? '').trim(),
  };
}

function resolveLinuxPackageUrl(release: LinuxOsRelease, rawArch: string): { url: string; kind: 'deb' | 'rpm' | 'arch' } {
  const arch = normalizeLinuxArch(rawArch);
  const versionMajor = release.versionId.split('.')[0] || release.versionId;
  if (release.id === 'ubuntu') {
    const version = normalizeUbuntuVersion(release.versionId);
    return {
      url: `https://mega.nz/linux/repo/xUbuntu_${version}/${arch === 'arm64' ? 'arm64' : 'amd64'}/megacmd-xUbuntu_${version}_${arch === 'arm64' ? 'arm64' : 'amd64'}.deb`,
      kind: 'deb',
    };
  }
  if (release.id === 'debian') {
    return {
      url: `https://mega.nz/linux/repo/Debian_${versionMajor}/${arch === 'arm64' ? 'arm64' : 'amd64'}/megacmd-Debian_${versionMajor}_${arch === 'arm64' ? 'arm64' : 'amd64'}.deb`,
      kind: 'deb',
    };
  }
  if (release.id === 'arch') {
    return {
      url: `https://mega.nz/linux/repo/Arch_Extra/${arch === 'x86_64' ? 'x86_64' : 'aarch64'}/megacmd-${arch === 'x86_64' ? 'x86_64' : 'aarch64'}.pkg.tar.zst`,
      kind: 'arch',
    };
  }
  if (release.id === 'fedora') {
    return {
      url: `https://mega.nz/linux/repo/Fedora_${versionMajor}/${arch === 'arm64' ? 'aarch64' : 'x86_64'}/megacmd-Fedora_${versionMajor}.${arch === 'arm64' ? 'aarch64' : 'x86_64'}.rpm`,
      kind: 'rpm',
    };
  }
  if (release.id === 'opensuse-tumbleweed') {
    return {
      url: `https://mega.nz/linux/repo/openSUSE_Tumbleweed/${arch === 'arm64' ? 'aarch64' : 'x86_64'}/megacmd-openSUSE_Tumbleweed.${arch === 'arm64' ? 'aarch64' : 'x86_64'}.rpm`,
      kind: 'rpm',
    };
  }
  if (release.id === 'opensuse-leap') {
    const version = release.versionId || '15.6';
    return {
      url: `https://mega.nz/linux/repo/openSUSE_Leap_${version}/${arch === 'arm64' ? 'aarch64' : 'x86_64'}/megacmd-openSUSE_Leap_${version}.${arch === 'arm64' ? 'aarch64' : 'x86_64'}.rpm`,
      kind: 'rpm',
    };
  }
  if (release.id === 'almalinux') {
    return {
      url: `https://mega.nz/linux/repo/AlmaLinux_${versionMajor}/${arch === 'arm64' ? 'aarch64' : 'x86_64'}/megacmd-AlmaLinux_${versionMajor}.${arch === 'arm64' ? 'aarch64' : 'x86_64'}.rpm`,
      kind: 'rpm',
    };
  }
  if (release.id === 'centos' || release.id === 'centos_stream') {
    return {
      url: `https://mega.nz/linux/repo/CentOS_Stream_${versionMajor}/${arch === 'arm64' ? 'aarch64' : 'x86_64'}/megacmd-CentOS_Stream_${versionMajor}.${arch === 'arm64' ? 'aarch64' : 'x86_64'}.rpm`,
      kind: 'rpm',
    };
  }

  throw new Error(`Automatic MEGAcmd setup is not supported on ${release.id || 'this Linux distribution'} yet.`);
}

function normalizeLinuxArch(arch: string): 'x86_64' | 'arm64' {
  return arch === 'arm64' ? 'arm64' : 'x86_64';
}

function normalizeUbuntuVersion(versionId: string): string {
  const parts = versionId.split('.');
  if (parts.length >= 2) {
    return `${parts[0]}.${parts[1]}`;
  }
  return versionId || '24.04';
}

function isSupportedPlatform(platform: NodeJS.Platform): boolean {
  return platform === 'win32' || platform === 'darwin' || platform === 'linux';
}
