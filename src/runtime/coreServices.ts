import { createCryptoOperations, type CryptoOperations } from 'nearbytes-crypto';
import { createChatService, type ChatService } from '../domain/chatService.js';
import { createFileService, type FileService } from 'nearbytes-files/service';
import type { Log } from 'nearbytes-log';
import { defaultPathMapper, type ChannelPathMapper } from 'nearbytes-log';
import type { MultiRootStorageBackend } from '../storage/multiRoot.js';
import { createMultiRootLog } from '../storage/multiRootLog.js';
import type { RuntimeVolumeEventPublisher } from './volumeEvents.js';

export interface RuntimeCoreServiceOptions {
  readonly multiRoot?: MultiRootStorageBackend;
  readonly log?: Log;
  readonly crypto?: CryptoOperations;
  readonly pathMapper?: ChannelPathMapper;
  readonly now?: () => number;
  readonly volumeEvents?: RuntimeVolumeEventPublisher;
}

export interface RuntimeCoreServices {
  readonly crypto: CryptoOperations;
  readonly multiRoot?: MultiRootStorageBackend;
  readonly log: Log;
  readonly fileService: FileService;
  readonly chatService: ChatService;
  readonly volumeEvents?: RuntimeVolumeEventPublisher;
}

export function createRuntimeCoreServices(options: RuntimeCoreServiceOptions): RuntimeCoreServices {
  const crypto = options.crypto ?? createCryptoOperations();
  const log =
    options.log ??
    (options.multiRoot
      ? createMultiRootLog(options.multiRoot, options.pathMapper ?? defaultPathMapper)
      : (() => {
          throw new Error('createRuntimeCoreServices requires multiRoot or log');
        })());

  return {
    crypto,
    multiRoot: options.multiRoot,
    log,
    fileService: createFileService({ log, crypto, now: options.now }),
    chatService: createChatService({
      crypto,
      log,
      pathMapper: options.pathMapper,
      now: options.now,
    }),
    volumeEvents: options.volumeEvents,
  };
}
