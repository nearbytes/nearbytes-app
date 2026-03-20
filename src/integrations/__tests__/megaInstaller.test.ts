import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { MegaHelperInstaller } from '../megaInstaller.js';
import type { CommandExecutor, ProviderSecretStore } from '../runtime.js';

function createMemorySecretStore(): ProviderSecretStore {
  const entries = new Map<string, unknown>();
  return {
    async get<T>(key: string): Promise<T | null> {
      return (entries.get(key) as T | undefined) ?? null;
    },
    async set<T>(key: string, value: T): Promise<void> {
      entries.set(key, value);
    },
    async delete(key: string): Promise<void> {
      entries.delete(key);
    },
  };
}

function fakeFetch(): typeof fetch {
  return (async () =>
    new Response(Buffer.from('helper-bytes'), {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
      },
    })) as typeof fetch;
}

describe('MegaHelperInstaller', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((tempDir) => fs.rm(tempDir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it('installs the Windows helper into the Nearbytes helper directory', async () => {
    const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nearbytes-mega-win-'));
    tempDirs.push(homeDir);
    const installRoot = path.join(homeDir, '.nearbytes', 'helpers', 'megacmd');
    const isolatedLocalAppData = path.join(homeDir, 'AppData', 'Local');
    const previousLocalAppData = process.env.LOCALAPPDATA;
    process.env.LOCALAPPDATA = isolatedLocalAppData;

    try {
      const executor: CommandExecutor = {
        async run(invocation) {
          if (invocation.command.includes('MegaClient.exe') && invocation.args?.[0] === 'version') {
            const error = new Error('missing');
            (error as NodeJS.ErrnoException).code = 'ENOENT';
            throw error;
          }
          if (invocation.args?.some((arg) => arg.startsWith('/D='))) {
            await fs.mkdir(installRoot, { recursive: true });
            await fs.writeFile(path.join(installRoot, 'MegaClient.exe'), 'exe');
            await fs.writeFile(path.join(installRoot, 'mega-login.bat'), 'bat');
          }
          return { stdout: '', stderr: '', exitCode: 0 };
        },
      };

      const installer = new MegaHelperInstaller({
        secretStore: createMemorySecretStore(),
        commandExecutor: executor,
        logger: { log() {}, warn() {} },
        platform: 'win32',
        arch: 'x64',
        homeDir,
        fetchImpl: fakeFetch(),
      });

      const before = await installer.getSetupState();
      expect(before.status).toBe('needs-install');

      const after = await installer.install();
      expect(after.status).toBe('ready');
      expect(after.config?.helperPath).toBe(installRoot);
      await fs.access(path.join(installRoot, 'MegaClient.exe'));
    } finally {
      if (previousLocalAppData === undefined) {
        delete process.env.LOCALAPPDATA;
      } else {
        process.env.LOCALAPPDATA = previousLocalAppData;
      }
    }
  });

  it('detects the default Windows MEGAcmd install directory after silent install', async () => {
    const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nearbytes-mega-win-default-'));
    tempDirs.push(homeDir);
    const localAppDataDir = path.join(homeDir, 'AppData', 'Local');
    const defaultInstallRoot = path.join(localAppDataDir, 'MEGAcmd');

    const previousLocalAppData = process.env.LOCALAPPDATA;
    process.env.LOCALAPPDATA = localAppDataDir;

    try {
      const executor: CommandExecutor = {
        async run(invocation) {
          if (invocation.command.includes('MegaClient.exe') && invocation.args?.[0] === 'version') {
            const error = new Error('missing');
            (error as NodeJS.ErrnoException).code = 'ENOENT';
            throw error;
          }
          if (invocation.args?.some((arg) => arg.startsWith('/D='))) {
            await fs.mkdir(defaultInstallRoot, { recursive: true });
            await fs.writeFile(path.join(defaultInstallRoot, 'MEGAclient.exe'), 'exe');
            await fs.writeFile(path.join(defaultInstallRoot, 'mega-login.bat'), 'bat');
          }
          return { stdout: '', stderr: '', exitCode: 0 };
        },
      };

      const installer = new MegaHelperInstaller({
        secretStore: createMemorySecretStore(),
        commandExecutor: executor,
        logger: { log() {}, warn() {} },
        platform: 'win32',
        arch: 'x64',
        homeDir,
        fetchImpl: fakeFetch(),
      });

      const after = await installer.install();
      expect(after.status).toBe('ready');
      expect(after.config?.helperPath).toBe(defaultInstallRoot);
      await fs.access(path.join(defaultInstallRoot, 'MEGAclient.exe'));
    } finally {
      if (previousLocalAppData === undefined) {
        delete process.env.LOCALAPPDATA;
      } else {
        process.env.LOCALAPPDATA = previousLocalAppData;
      }
    }
  });

  it('installs the macOS helper bundle into the Nearbytes helper directory', async () => {
    const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nearbytes-mega-mac-'));
    tempDirs.push(homeDir);
    const installRoot = path.join(homeDir, '.nearbytes', 'helpers', 'megacmd');

    const executor: CommandExecutor = {
      async run(invocation) {
        if (invocation.command.includes('mega-version')) {
          const error = new Error('missing');
          (error as NodeJS.ErrnoException).code = 'ENOENT';
          throw error;
        }
        if (invocation.command === 'cp') {
          const target = invocation.args?.at(-1) ?? '';
          const commandDir = path.join(target, 'Contents', 'MacOS');
          await fs.mkdir(commandDir, { recursive: true });
          await fs.writeFile(path.join(commandDir, 'mega-login'), 'exe');
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      },
    };

    const installer = new MegaHelperInstaller({
      secretStore: createMemorySecretStore(),
      commandExecutor: executor,
      logger: { log() {}, warn() {} },
      platform: 'darwin',
      arch: 'x64',
      homeDir,
      fetchImpl: fakeFetch(),
    });

    const after = await installer.install();
    expect(after.status).toBe('ready');
    expect(after.config?.helperPath).toBe(path.join(installRoot, 'MEGAcmd.app', 'Contents', 'MacOS'));
    await fs.access(path.join(installRoot, 'MEGAcmd.app', 'Contents', 'MacOS', 'mega-login'));
  });

  it('extracts a Debian helper package locally on Linux', async () => {
    const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nearbytes-mega-linux-'));
    tempDirs.push(homeDir);
    const installRoot = path.join(homeDir, '.nearbytes', 'helpers', 'megacmd');

    const executor: CommandExecutor = {
      async run(invocation) {
        if (invocation.command.includes('mega-version')) {
          const error = new Error('missing');
          (error as NodeJS.ErrnoException).code = 'ENOENT';
          throw error;
        }
        if (invocation.command === 'ar') {
          await fs.writeFile(path.join(invocation.cwd ?? '', 'data.tar.xz'), 'fake-archive');
        }
        if (invocation.command === 'tar') {
          const commandDir = path.join(installRoot, 'usr', 'bin');
          await fs.mkdir(commandDir, { recursive: true });
          await fs.writeFile(path.join(commandDir, 'mega-login'), 'exe');
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      },
    };

    const installer = new MegaHelperInstaller({
      secretStore: createMemorySecretStore(),
      commandExecutor: executor,
      logger: { log() {}, warn() {} },
      platform: 'linux',
      arch: 'x64',
      homeDir,
      fetchImpl: fakeFetch(),
      linuxRelease: {
        id: 'ubuntu',
        versionId: '24.04',
      },
    });

    const after = await installer.install();
    expect(after.status).toBe('ready');
    expect(after.config?.helperPath).toBe(path.join(installRoot, 'usr', 'bin'));
    await fs.access(path.join(installRoot, 'usr', 'bin', 'mega-login'));
  });

  it('prefers the explicit command directory over a saved helper path', async () => {
    const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nearbytes-mega-configured-'));
    tempDirs.push(homeDir);
    const savedDir = path.join(homeDir, 'saved-helper');
    const configuredDir = path.join(homeDir, 'configured-helper');
    await fs.mkdir(savedDir, { recursive: true });
    await fs.mkdir(configuredDir, { recursive: true });
    await fs.writeFile(path.join(savedDir, 'mega-login'), 'saved');
    await fs.writeFile(path.join(configuredDir, 'mega-login'), 'configured');

    const secretStore = createMemorySecretStore();
    await secretStore.set('provider-config:mega', {
      commandDirectory: savedDir,
    });

    const installer = new MegaHelperInstaller({
      secretStore,
      commandExecutor: {
        async run() {
          return { stdout: '', stderr: '', exitCode: 0 };
        },
      },
      logger: { log() {}, warn() {} },
      configuredCommandDirectory: configuredDir,
      platform: 'linux',
      arch: 'x64',
      homeDir,
      fetchImpl: fakeFetch(),
      linuxRelease: {
        id: 'ubuntu',
        versionId: '24.04',
      },
    });

    await expect(installer.getCommandDirectory()).resolves.toBe(configuredDir);
  });
});
