import { describe, expect, it } from 'vitest';
import { MultiRootStorageBackend } from '../../storage/multiRoot.js';
import type { RootsConfig } from '../../config/roots.js';
import { createStorageBackedMegaOwnerMirrorSource } from '../megaOwnerMirrorSource.js';

const STORAGE_CONFIG: RootsConfig = {
  version: 2,
  sources: [
    {
      id: 'local-main',
      provider: 'local',
      path: '/tmp/nearbytes-test-storage',
      enabled: true,
      writable: true,
      reservePercent: 5,
      opportunisticPolicy: 'block-writes',
    },
  ],
  defaultVolume: {
    destinations: [
      {
        sourceId: 'local-main',
        enabled: true,
        storeEvents: true,
        storeBlocks: true,
        copySourceBlocks: true,
        reservePercent: 5,
        fullPolicy: 'block-writes',
      },
    ],
  },
  volumes: [
    {
      volumeId: '041f3c3d23a0c9f2b013c83cd27c8417b42316160487d5556ab9820c4aa517e729fa78172e149ab57933f0a95e0d0b804bf9bc8e4ec12430c75e2d95f9b026f1e9',
      destinations: [
        {
          sourceId: 'local-main',
          enabled: true,
          storeEvents: true,
          storeBlocks: true,
          copySourceBlocks: true,
          reservePercent: 5,
          fullPolicy: 'block-writes',
        },
      ],
    },
    {
      volumeId: '0470f0f4b5e8692d7d80af007bb3998a45a28ef86039120c49a093f6d83db1eac6a7cea90d620dc3d2c3095f0247da0ce3f460291eb9dc467cedce958abf38d473',
      destinations: [
        {
          sourceId: 'local-main',
          enabled: true,
          storeEvents: true,
          storeBlocks: true,
          copySourceBlocks: true,
          reservePercent: 5,
          fullPolicy: 'block-writes',
        },
      ],
    },
  ],
};

describe('createStorageBackedMegaOwnerMirrorSource', () => {
  it('lists only the attached canonical channel files plus shared blocks', async () => {
    const storage = new MultiRootStorageBackend(STORAGE_CONFIG);
    const source = createStorageBackedMegaOwnerMirrorSource(storage);
    const attachedVolumeId =
      '041f3c3d23a0c9f2b013c83cd27c8417b42316160487d5556ab9820c4aa517e729fa78172e149ab57933f0a95e0d0b804bf9bc8e4ec12430c75e2d95f9b026f1e9';
    const foreignVolumeId =
      '0470f0f4b5e8692d7d80af007bb3998a45a28ef86039120c49a093f6d83db1eac6a7cea90d620dc3d2c3095f0247da0ce3f460291eb9dc467cedce958abf38d473';
    const blockHash = '95d6b2eaeb81cd9352e40e4f52ff63f50ffb99dcab2c0c9657122efb55b96b87';
    const attachedEventHash = '841b1af5d9cf1245d6c2ff43eea3ea6835a36006c950fe2ba399b774d6afdf7d';
    const foreignEventHash = '1f76b873d0a603149410b9f23578b266622c193b789a64bc19afb6a5cfa4a546';

    await storage.writeFile(`blocks/${blockHash}.bin`, new Uint8Array([1, 2, 3]));
    await storage.writeFile(`channels/${attachedVolumeId}/${attachedEventHash}.bin`, new Uint8Array([4, 5, 6]));
    await storage.writeFile(`channels/${foreignVolumeId}/${foreignEventHash}.bin`, new Uint8Array([7, 8, 9]));

    const files = await source.listMirrorFiles({
      id: 'share-mega-owner',
      sourceId: 'local-main',
      attachments: [{ volumeId: attachedVolumeId }],
    });

    expect(files).toEqual([
      `blocks/${blockHash}.bin`,
      `channels/${attachedVolumeId}/${attachedEventHash}.bin`,
    ]);
    await expect(source.readMirrorFile(
      { id: 'share-mega-owner', sourceId: 'local-main' },
      `channels/${attachedVolumeId}/${attachedEventHash}.bin`
    )).resolves.toEqual(new Uint8Array([4, 5, 6]));
  });

  it('treats default-volume owner destinations as attached even when the explicit volume policy omits them', async () => {
    const storage = new MultiRootStorageBackend({
      ...STORAGE_CONFIG,
      sources: [
        ...STORAGE_CONFIG.sources,
        {
          id: 'mega-owner',
          provider: 'mega',
          path: '/tmp/nearbytes-test-storage-owner',
          enabled: true,
          writable: true,
          reservePercent: 5,
          opportunisticPolicy: 'block-writes',
          integration: {
            kind: 'provider-managed',
            provider: 'mega',
            managedShareId: 'share-mega-owner',
          },
        },
        {
          id: 'mega-recipient',
          provider: 'mega',
          path: '/tmp/nearbytes-test-storage-recipient',
          enabled: true,
          writable: false,
          reservePercent: 5,
          opportunisticPolicy: 'block-writes',
          integration: {
            kind: 'provider-managed',
            provider: 'mega',
            managedShareId: 'share-mega-recipient',
          },
        },
      ],
      defaultVolume: {
        destinations: [
          ...STORAGE_CONFIG.defaultVolume.destinations,
          {
            sourceId: 'mega-owner',
            enabled: true,
            storeEvents: true,
            storeBlocks: true,
            copySourceBlocks: true,
            reservePercent: 5,
            fullPolicy: 'block-writes',
          },
        ],
      },
      volumes: [
        {
          volumeId:
            '041f3c3d23a0c9f2b013c83cd27c8417b42316160487d5556ab9820c4aa517e729fa78172e149ab57933f0a95e0d0b804bf9bc8e4ec12430c75e2d95f9b026f1e9',
          destinations: [
            {
              sourceId: 'mega-recipient',
              enabled: true,
              storeEvents: true,
              storeBlocks: true,
              copySourceBlocks: true,
              reservePercent: 5,
              fullPolicy: 'block-writes',
            },
          ],
        },
      ],
    });
    const source = createStorageBackedMegaOwnerMirrorSource(storage);
    const attachedVolumeId =
      '041f3c3d23a0c9f2b013c83cd27c8417b42316160487d5556ab9820c4aa517e729fa78172e149ab57933f0a95e0d0b804bf9bc8e4ec12430c75e2d95f9b026f1e9';
    const attachedEventHash = '841b1af5d9cf1245d6c2ff43eea3ea6835a36006c950fe2ba399b774d6afdf7d';

    await storage.writeFile(`channels/${attachedVolumeId}/${attachedEventHash}.bin`, new Uint8Array([4, 5, 6]));

    const files = await source.listMirrorFiles({
      id: 'share-mega-owner',
      sourceId: 'mega-owner',
    });

    expect(files).toContain(`channels/${attachedVolumeId}/${attachedEventHash}.bin`);
  });
});
