import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { createCryptoOperations } from 'nearbytes-crypto';
import { EventType } from 'nearbytes-crypto';
import { createSecret } from 'nearbytes-crypto';
import { defaultPathMapper } from 'nearbytes-storage';
import { createLog } from 'nearbytes-log';
import { FilesystemStorageBackend } from 'nearbytes-storage';
import { createChatService } from '../chatService.js';
import { createFileService } from 'nearbytes-files';
import { hydrateSignedEvent } from 'nearbytes-log';

const START_TIME = 1800000000000;

describe('ChatService', () => {
  it('publishes canonical identity records to the identity channel and snapshots/messages to the volume log', async () => {
    const { chatService, crypto, storage, cleanup } = await createTestServices(START_TIME);
    const volumeSecret = 'chat:test:volume';
    const identitySecret = 'chat:test:identity';

    const published = await chatService.publishIdentity(volumeSecret, identitySecret, {
      displayName: 'Ada',
      bio: 'Testing nested signatures',
    });
    const sent = await chatService.sendMessage(volumeSecret, identitySecret, {
      body: 'hello from nearbytes chat',
    });
    const chat = await chatService.listChat(volumeSecret);

    expect(published.authorPublicKey).toBe(sent.authorPublicKey);
    expect(chat.identities).toHaveLength(1);
    expect(chat.identities[0].record.profile.displayName).toBe('Ada');
    expect(chat.messages).toHaveLength(1);
    expect(chat.messages[0].message.body).toBe('hello from nearbytes chat');

    const channelStorage = createLog(storage, defaultPathMapper);
    const volumeKeyPair = await crypto.deriveKeys(createSecret(volumeSecret));
    const identityKeyPair = await crypto.deriveKeys(createSecret(identitySecret));
    const identityEventHashes = await channelStorage.events.listEvents(identityKeyPair.publicKey);
    const volumeEventHashes = await channelStorage.events.listEvents(volumeKeyPair.publicKey);

    expect(identityEventHashes).toHaveLength(1);
    expect(volumeEventHashes).toHaveLength(2);

    const identityEvent = await hydrateSignedEvent(
      crypto,
      identityKeyPair.privateKey,
      await channelStorage.events.retrieveEvent(identityKeyPair.publicKey, identityEventHashes[0])
    );
    expect(identityEvent.payload.type).toBe(EventType.APP_RECORD);
    expect(identityEvent.payload.protocol).toBe('nb.identity.record.v1');

    const volumeEvents = await Promise.all(
      volumeEventHashes.map((eventHash) => channelStorage.events.retrieveEvent(volumeKeyPair.publicKey, eventHash))
    ).then((events) => Promise.all(events.map((event) => hydrateSignedEvent(crypto, volumeKeyPair.privateKey, event))));
    const volumeProtocols = volumeEvents
      .map((event) => event.payload.protocol)
      .filter((value): value is string => typeof value === 'string')
      .sort();

    expect(volumeEvents.every((event) => event.payload.type === EventType.APP_RECORD)).toBe(true);
    expect(volumeProtocols).toEqual(['nb.chat.message.v1', 'nb.identity.snapshot.v1']);

    await cleanup();
  });

  it('sends a plain text chat message', async () => {
    const { chatService, cleanup } = await createTestServices(START_TIME);
    const volumeSecret = 'chat:test:attachments';
    const identitySecret = 'chat:test:attachment-identity';

    await chatService.publishIdentity(volumeSecret, identitySecret, {
      displayName: 'Grace',
    });
    await chatService.sendMessage(volumeSecret, identitySecret, {
      body: 'hello from the test',
    });

    const chat = await chatService.listChat(volumeSecret);

    expect(chat.messages).toHaveLength(1);
    expect(chat.messages[0].message.body).toBe('hello from the test');

    await cleanup();
  });
});

async function createTestServices(startTime: number): Promise<{
  chatService: ReturnType<typeof createChatService>;
  fileService: ReturnType<typeof createFileService>;
  crypto: ReturnType<typeof createCryptoOperations>;
  storage: FilesystemStorageBackend;
  cleanup: () => Promise<void>;
}> {
  const dir = await mkdtemp(join(tmpdir(), 'nearbytes-chat-service-'));
  const storage = new FilesystemStorageBackend(dir);
  const crypto = createCryptoOperations();
  const now = createNow(startTime);

  return {
    chatService: createChatService({ crypto, storage, now }),
    fileService: createFileService({ log: createLog(storage, defaultPathMapper), crypto, now }),
    crypto,
    storage,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

function createNow(start: number): () => number {
  let current = start;
  return () => {
    const value = current;
    current += 1000;
    return value;
  };
}
