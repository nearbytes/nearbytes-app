import { promises as fs } from 'fs';
import { isProviderEnabled } from '../config/appConfig.js';
import { saveRootsConfig, type RootsConfig } from '../config/roots.js';
import { ensureNearbytesMarkers, inspectNearbytesRoot, normalizeNearbytesRoot } from '../config/sourceDiscovery.js';
import {
  loadIntegrationState,
  resolveIntegrationStatePath,
  saveIntegrationState,
  type IntegrationStateSnapshot,
} from './store.js';
import type {
  ManagedShareDirectoryEntry,
  ManagedShareFileHost,
  ManagedSharePathStats,
  ManagedShareRootHost,
  ManagedShareRootsConfigStore,
  ManagedShareStateStore,
} from './managedShares.js';

export interface ManagedShareNodeSupportOptions {
  readonly rootsConfigPath: string;
  readonly integrationStatePath?: string;
}

export function createManagedShareNodeStateStore(integrationStatePath: string): ManagedShareStateStore {
  return {
    async load(): Promise<IntegrationStateSnapshot> {
      return loadIntegrationState(integrationStatePath);
    },
    async save(snapshot: IntegrationStateSnapshot): Promise<void> {
      await saveIntegrationState(snapshot, integrationStatePath);
    },
  };
}

export function createManagedShareNodeRootsConfigStore(rootsConfigPath: string): ManagedShareRootsConfigStore {
  return {
    async save(config: RootsConfig): Promise<void> {
      await saveRootsConfig(rootsConfigPath, config);
    },
  };
}

export const managedShareNodeFileHost: ManagedShareFileHost = {
  async ensureDirectory(targetPath: string): Promise<void> {
    await fs.mkdir(targetPath, { recursive: true });
  },
  async removePath(targetPath: string, options): Promise<void> {
    await fs.rm(targetPath, {
      recursive: options?.recursive,
      force: options?.force,
    });
  },
  async renamePath(sourcePath: string, targetPath: string): Promise<void> {
    await fs.rename(sourcePath, targetPath);
  },
  async copyFile(sourcePath: string, targetPath: string): Promise<void> {
    await fs.copyFile(sourcePath, targetPath);
  },
  async readDirectoryEntries(dirPath: string): Promise<readonly ManagedShareDirectoryEntry[]> {
    try {
      return await fs.readdir(dirPath, { withFileTypes: true });
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? String((error as NodeJS.ErrnoException).code ?? '') : '';
      if (code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  },
  async statPath(targetPath: string): Promise<ManagedSharePathStats | null> {
    try {
      return await fs.stat(targetPath);
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? String((error as NodeJS.ErrnoException).code ?? '') : '';
      if (code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  },
};

export function createManagedShareNodeSupport(options: ManagedShareNodeSupportOptions): {
  readonly integrationStatePath: string;
  readonly isProviderEnabled: (provider: string) => boolean;
  readonly stateStore: ManagedShareStateStore;
  readonly rootsConfigStore: ManagedShareRootsConfigStore;
  readonly fileHost: ManagedShareFileHost;
  readonly rootHost: ManagedShareRootHost;
} {
  const integrationStatePath = resolveIntegrationStatePath(options.integrationStatePath);
  return {
    integrationStatePath,
    isProviderEnabled,
    stateStore: createManagedShareNodeStateStore(integrationStatePath),
    rootsConfigStore: createManagedShareNodeRootsConfigStore(options.rootsConfigPath),
    fileHost: managedShareNodeFileHost,
    rootHost: {
      ensureMarkers: ensureNearbytesMarkers,
      inspectRoot: inspectNearbytesRoot,
      normalizeRoot: normalizeNearbytesRoot,
    },
  };
}