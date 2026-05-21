import { MultiRootStorageBackend } from '../storage/multiRoot.js';
import type { RootsConfig } from '../config/rootsShared.js';

/**
 * Builds a minimal multi-root config with one writable local source (tests).
 */
export function createSingleSourceMultiRoot(mainPath: string): MultiRootStorageBackend {
  const config: RootsConfig = {
    version: 2,
    sources: [
      {
        id: 'src-main',
        provider: 'local',
        path: mainPath,
        enabled: true,
        writable: true,
        reservePercent: 0,
        opportunisticPolicy: 'block-writes',
      },
    ],
    defaultVolume: {
      destinations: [
        {
          sourceId: 'src-main',
          enabled: true,
          storeEvents: true,
          storeBlocks: true,
          copySourceBlocks: true,
          reservePercent: 0,
          fullPolicy: 'block-writes',
        },
      ],
    },
    volumes: [],
  };
  return new MultiRootStorageBackend(config);
}
