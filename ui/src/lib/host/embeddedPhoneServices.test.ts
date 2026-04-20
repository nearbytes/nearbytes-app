import { afterEach, describe, expect, it } from 'vitest';

import {
  embeddedPhoneDebugListMegaOwnerMirrorFiles,
  embeddedPhoneNormalizeNativeFetchUrlForTests,
  embeddedPhoneShouldUseNativeFetchBridgeForTests,
  embeddedPhoneUpdateRootsConfig,
  embeddedPhoneUpdateProviderEnabled,
  resetEmbeddedPhoneServicesForTests,
  seedEmbeddedPhoneIntegrationStateForTests,
  seedEmbeddedPhoneStoredRecordForTests,
} from './embeddedPhoneServices.js';

describe('embeddedPhoneMegaOwnerMirrorSource', () => {
  afterEach(() => {
    resetEmbeddedPhoneServicesForTests();
  });

  it('includes canonical referenced block files for attached owner volumes', async () => {
    const volumeId = '0489eac69beb82ec9eb88b45d7ce29d5cce350f01c6f85922e23750841fa86944aceefcf9326aa4363e349d73049c9a126ce36cdd14407b6c1fe33d6288ed03101';
    const eventHash = '02f45bdae4f287a57ec7cd2b6654534d5fbc213f24d25e7f038411f31a79461c';
    const blockHash = '77adcdb1c9e7ec1d22c03d2a79136718cb16c7df4207210582149e2dd05f234c';

    await seedEmbeddedPhoneIntegrationStateForTests({
      version: 1,
      preferredProviders: ['mega'],
      accounts: [
        {
          id: 'acct-mega-phone',
          provider: 'mega',
          label: 'MEGA',
          email: 'phone@example.com',
          state: 'connected',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      managedShares: [
        {
          id: 'share-mega-phone-owner',
          provider: 'mega',
          accountId: 'acct-mega-phone',
          label: 'Phone Share',
          role: 'owner',
          localPath: 'local/mega/phone-share',
          sourceId: 'src-embedded-phone',
          syncMode: 'mirror',
          remoteDescriptor: {
            remotePath: '/nearbytes',
            shareName: 'nearbytes',
          },
          attachments: [
            {
              id: `attach-share-mega-phone-owner-${volumeId}`,
              shareId: 'share-mega-phone-owner',
              sourceId: 'src-embedded-phone',
              volumeId,
              createdAt: 1,
            },
          ],
          capabilities: ['mirror', 'read', 'write'],
          invitationEmails: [],
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      maintenance: undefined,
    });

    await seedEmbeddedPhoneStoredRecordForTests(`blocks/${blockHash}.bin`, new TextEncoder().encode('block-bytes'));
    await seedEmbeddedPhoneStoredRecordForTests(
      `channels/${volumeId}/${eventHash}.bin`,
      new TextEncoder().encode(JSON.stringify({
        envelope: {
          version: '0.2',
          publicKey: 'ab'.repeat(65),
          blockRefs: [blockHash],
          ciphertext: '',
        },
        signature: '',
      }))
    );
    await embeddedPhoneUpdateProviderEnabled('mega', true);
    await embeddedPhoneUpdateRootsConfig({
      version: 2,
      sources: [
        {
          id: 'src-embedded-phone',
          provider: 'local',
          path: '',
          enabled: true,
          writable: true,
          reservePercent: 5,
          opportunisticPolicy: 'block-writes',
        },
      ],
      defaultVolume: {
        destinations: [
          {
            sourceId: 'src-embedded-phone',
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
          volumeId,
          destinations: [
            {
              sourceId: 'src-embedded-phone',
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

    await expect(embeddedPhoneDebugListMegaOwnerMirrorFiles('share-mega-phone-owner', 10)).resolves.toEqual({
      count: 2,
      paths: [
        `blocks/${blockHash}.bin`,
        `channels/${volumeId}/${eventHash}.bin`,
      ],
    });
  });

  it('upgrades MEGA worker URLs to https for the native fetch bridge', () => {
    expect(
      embeddedPhoneNormalizeNativeFetchUrlForTests('http://w.api.mega.co.nz/example-worker-path')
    ).toBe('https://w.api.mega.co.nz/example-worker-path');
    expect(
      embeddedPhoneNormalizeNativeFetchUrlForTests('https://g.api.mega.co.nz/cs?id=1')
    ).toBe('https://g.api.mega.co.nz/cs?id=1');
  });

  it('routes MEGA worker-host fetches away from the native bridge', () => {
    expect(
      embeddedPhoneShouldUseNativeFetchBridgeForTests('https://w.api.mega.co.nz/example-worker-path')
    ).toBe(false);
    expect(
      embeddedPhoneShouldUseNativeFetchBridgeForTests('https://g.api.mega.co.nz/cs?id=1')
    ).toBe(true);
  });
});