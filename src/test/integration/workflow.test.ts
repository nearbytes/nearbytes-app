import { describe, it, expect, beforeEach } from 'vitest';
import { promises as fs } from 'fs';
import { createCryptoOperations } from 'nearbytes-crypto';
import { createFilesystemLog } from 'nearbytes-log';
import { setupChannel, storeData, retrieveData } from 'nearbytes-files';
import { createSecret } from 'nearbytes-crypto';

const TEST_DATA_DIR = './test-data';

describe('Nearbytes Workflow', () => {
  beforeEach(async () => {
    try {
      await fs.rm(TEST_DATA_DIR, { recursive: true, force: true });
    } catch {}
  });

  it('should complete full workflow: setup -> store -> retrieve', async () => {
    const secret = createSecret('test:channel:password');
    const crypto = createCryptoOperations();
    const channelStorage = createFilesystemLog(TEST_DATA_DIR, (pubKey) =>
      `channels/${Array.from(pubKey)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')}`,
    );

    const { publicKey } = await setupChannel(secret, crypto);
    expect(publicKey.length).toBeGreaterThan(0);

    const testData = new TextEncoder().encode('Hello, Nearbytes!');
    const { eventHash, dataHash } = await storeData(testData, 'test.txt', secret, crypto, channelStorage);
    expect(eventHash).toMatch(/^[0-9a-f]{64}$/);
    expect(dataHash).toMatch(/^[0-9a-f]{64}$/);

    const retrievedData = await retrieveData(eventHash, secret, crypto, channelStorage);
    expect(retrievedData).toEqual(testData);
  });

  it('should store and retrieve multiple events', async () => {
    const secret = createSecret('test:channel:password');
    const crypto = createCryptoOperations();
    const channelStorage = createFilesystemLog(TEST_DATA_DIR, (pubKey) =>
      `channels/${Array.from(pubKey)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')}`,
    );

    await setupChannel(secret, crypto);

    const data1 = new TextEncoder().encode('First file');
    const data2 = new TextEncoder().encode('Second file');

    const result1 = await storeData(data1, 'file1.txt', secret, crypto, channelStorage);
    const result2 = await storeData(data2, 'file2.txt', secret, crypto, channelStorage);

    expect(result1.eventHash).not.toEqual(result2.eventHash);

    const retrieved1 = await retrieveData(result1.eventHash, secret, crypto, channelStorage);
    const retrieved2 = await retrieveData(result2.eventHash, secret, crypto, channelStorage);

    expect(retrieved1).toEqual(data1);
    expect(retrieved2).toEqual(data2);
  });
});
