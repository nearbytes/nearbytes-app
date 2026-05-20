import { createSkeleton } from 'nearbytes-skeleton';
import type { CryptoOperations } from 'nearbytes-crypto';
import { createChatService, type ChatService } from '../domain/chatService.js';
import { createFileService, type FileService } from 'nearbytes-files';
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
  // The skeleton provides the canonical crypto + log wiring.
  // It is environment-neutral: same call would work in a browser with an
  // IndexedDB backend.  App-level services (fileService, chatService) are
  // layered on top here, in the messy app layer where they belong.
  const skeleton = createSkeleton(options.storage);
  const crypto = options.crypto ?? skeleton.crypto;
  const log = skeleton.log;

  return {
    crypto,
    storage: options.storage,
    fileService: createFileService({ log, crypto, now: options.now }),
    chatService: createChatService({
      crypto,
      storage: options.storage,
      pathMapper: options.pathMapper,
      now: options.now,
    }),
    volumeEvents: options.volumeEvents,
  };
}
