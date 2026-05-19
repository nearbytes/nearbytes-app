import { createCryptoOperations, type CryptoOperations } from 'nearbytes-crypto';
import { createChatService, type ChatService } from '../domain/chatService.js';
import { createFileService, type FileService } from 'nearbytes-files';
import type { StorageBackend, ChannelPathMapper } from 'nearbytes-storage';
import { defaultPathMapper } from 'nearbytes-storage';
import { createLog } from 'nearbytes-log';
import type { RuntimeVolumeEventPublisher } from './volumeEvents.js';

// Shared service bundle per docs/specs/transport/shared-runtime-services-v0.1.md.
export interface RuntimeCoreServiceOptions {
  readonly storage: StorageBackend;
  readonly crypto?: CryptoOperations;
  readonly pathMapper?: ChannelPathMapper;
  readonly now?: () => number;
  readonly volumeEvents?: RuntimeVolumeEventPublisher;
}

export interface RuntimeCoreServices {
  readonly crypto: CryptoOperations;
  readonly storage: StorageBackend;
  readonly fileService: FileService;
  readonly chatService: ChatService;
  readonly volumeEvents?: RuntimeVolumeEventPublisher;
}

export function createRuntimeCoreServices(options: RuntimeCoreServiceOptions): RuntimeCoreServices {
  const crypto = options.crypto ?? createCryptoOperations();
  const pathMapper = options.pathMapper ?? defaultPathMapper;
  const log = createLog(options.storage, pathMapper);
  const fileDependencies = {
    log,
    crypto,
    now: options.now,
  };

  return {
    crypto,
    storage: options.storage,
    fileService: createFileService(fileDependencies),
    chatService: createChatService({ crypto, storage: options.storage, pathMapper, now: options.now }),
    volumeEvents: options.volumeEvents,
  };
}
