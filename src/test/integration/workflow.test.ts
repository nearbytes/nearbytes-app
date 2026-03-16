import { describe, it, expect, beforeEach } from 'vitest';
import { promises as fs } from 'fs';
import { createCryptoOperations } from '../../crypto/index.js';
import { FilesystemStorageBackend } from '../../storage/filesystem.js';
import { ChannelStorage } from '../../storage/channel.js';
import { setupChannel, storeData, retrieveData } from '../../domain/operations.js';
import { createSecret } from '../../types/keys.js';

const TEST_DATA_DIR = './test-data';

describe('Nearbytes Workflow', () => {
  beforeEach(async () => {
    // Clean up test data directory
    try {
      await fs.rm(TEST_DATA_DIR, { recursive: true, force: true });
    } catch {
      // Ignore errors
    }
  });

  it('should complete full workflow: setup -> store -> retrieve', async () => {
    const secret = createSecret('test:channel:password');
    const crypto = createCryptoOperations();
    const storage = new FilesystemStorageBackend(TEST_DATA_DIR);
    const channelStorage = new ChannelStorage(storage, (pubKey) =>
      Array.from(pubKey)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
    );

    // 1. Setup channel
    const { publicKey } = await setupChannel(secret, crypto, storage);
    expect(publicKey.length).toBeGreaterThan(0);

    // 2. Store data
    const testData = new TextEncoder().encode('Hello, Nearbytes!');
    const { eventHash, dataHash } = await storeData(testData, 'test.txt', secret, crypto, channelStorage);
    expect(eventHash).toMatch(/^[0-9a-f]{64}$/);
    expect(dataHash).toMatch(/^[0-9a-f]{64}$/);

    // 3. Retrieve data
    const retrievedData = await retrieveData(eventHash, secret, crypto, channelStorage);
    expect(retrievedData).toEqual(testData);
  });

  it('should store and retrieve multiple events', async () => {
    const secret = createSecret('test:channel:password');
    const crypto = createCryptoOperations();
    const storage = new FilesystemStorageBackend(TEST_DATA_DIR);
    const channelStorage = new ChannelStorage(storage, (pubKey) =>
      Array.from(pubKey)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
    );

    await setupChannel(secret, crypto, storage);

    // Store multiple events
    const data1 = new TextEncoder().encode('First message');
    const data2 = new TextEncoder().encode('Second message');
    const data3 = new TextEncoder().encode('Third message');

    const result1 = await storeData(data1, 'file1.txt', secret, crypto, channelStorage);
    const result2 = await storeData(data2, 'file2.txt', secret, crypto, channelStorage);
    const result3 = await storeData(data3, 'file3.txt', secret, crypto, channelStorage);

    // Retrieve all
    const retrieved1 = await retrieveData(result1.eventHash, secret, crypto, channelStorage);
    const retrieved2 = await retrieveData(result2.eventHash, secret, crypto, channelStorage);
    const retrieved3 = await retrieveData(result3.eventHash, secret, crypto, channelStorage);

    expect(retrieved1).toEqual(data1);
    expect(retrieved2).toEqual(data2);
    expect(retrieved3).toEqual(data3);
  });
});

