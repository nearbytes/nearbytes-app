// Re-export the storage interface
export type { StorageBackend, ChannelPathMapper } from '../types/storage.js';
export { defaultPathMapper } from '../types/storage.js';
export {
	createInMemoryPathRecordStore,
	createInMemoryPathRecordStoreAdapter,
	normalizeStorageDirectoryPath,
	normalizeStoragePath,
	PathRecordStorageBackend,
	type InMemoryPathRecordStore,
	type PathRecordStore,
	type StoredPathRecord,
} from './pathRecord.js';

