import { createCryptoOperations, type CryptoOperations } from 'nearbytes-crypto';
import { createChatService, type ChatService } from '../domain/chatService.js';
import { createFileService, type FileService } from '../domain/fileService.js';
import type { StorageBackend, ChannelPathMapper } from 'nearbytes-storage';
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
  const dependencies = {
    crypto,
    storage: options.storage,
    pathMapper: options.pathMapper,
    now: options.now,
  };

  return {
    crypto,
    storage: options.storage,
    fileService: createFileService(dependencies),
    chatService: createChatService(dependencies),
    volumeEvents: options.volumeEvents,
  };
}