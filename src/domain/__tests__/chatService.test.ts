import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { createCryptoOperations } from '../../crypto/index.js';
import { EventType } from '../../types/events.js';
import { createSecret } from '../../types/keys.js';
import { defaultPathMapper } from '../../types/storage.js';
import { ChannelStorage } from '../../storage/channel.js';
import { FilesystemStorageBackend } from '../../storage/filesystem.js';
import { createChatService } from '../chatService.js';
import { createFileService } from '../fileService.js';

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

    const channelStorage = new ChannelStorage(storage, defaultPathMapper);
    const volumeKeyPair = await crypto.deriveKeys(createSecret(volumeSecret));
    const identityKeyPair = await crypto.deriveKeys(createSecret(identitySecret));
    const identityEventHashes = await channelStorage.listEvents(identityKeyPair.publicKey);
    const volumeEventHashes = await channelStorage.listEvents(volumeKeyPair.publicKey);

    expect(identityEventHashes).toHaveLength(1);
    expect(volumeEventHashes).toHaveLength(2);

    const identityEvent = await channelStorage.retrieveEvent(identityKeyPair.publicKey, identityEventHashes[0]);
    expect(identityEvent.payload.type).toBe(EventType.APP_RECORD);
    expect(identityEvent.payload.protocol).toBe('nb.identity.record.v1');

    const volumeEvents = await Promise.all(
      volumeEventHashes.map((eventHash) => channelStorage.retrieveEvent(volumeKeyPair.publicKey, eventHash))
    );
    const volumeProtocols = volumeEvents
      .map((event) => event.payload.protocol)
      .filter((value): value is string => typeof value === 'string')
      .sort();

    expect(volumeEvents.every((event) => event.payload.type === EventType.APP_RECORD)).toBe(true);
    expect(volumeProtocols).toEqual(['nb.chat.message.v1', 'nb.identity.snapshot.v1']);

    await cleanup();
  });

  it('carries source-bound file references as chat attachments', async () => {
    const { chatService, fileService, cleanup } = await createTestServices(START_TIME);
    const volumeSecret = 'chat:test:attachments';
    const identitySecret = 'chat:test:attachment-identity';

    await chatService.publishIdentity(volumeSecret, identitySecret, {
      displayName: 'Grace',
    });
    await fileService.addFile(volumeSecret, 'notes/todo.txt', Buffer.from('todo body'), 'text/plain');
    const exported = await fileService.exportSourceReferences(volumeSecret, ['notes/todo.txt']);
    const item = exported.bundle.items[0];

    await chatService.sendMessage(volumeSecret, identitySecret, {
      attachment: {
        kind: 'nb.src.ref.v1',
        name: item.name,
        mime: item.mime,
        createdAt: item.createdAt,
        ref: item.ref,
      },
    });

    const chat = await chatService.listChat(volumeSecret);

    expect(chat.messages).toHaveLength(1);
    expect(chat.messages[0].message.attachment?.name).toBe('notes/todo.txt');
    expect(chat.messages[0].message.attachment?.ref.s).toBe(exported.bundle.s);

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
    fileService: createFileService({ crypto, storage, now }),
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
