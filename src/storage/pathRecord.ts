import type { StorageBackend } from '../types/storage.js';

export interface StoredPathRecord {
  path: string;
  data: Uint8Array;
  updatedAt: number;
}

export interface InMemoryPathRecordStore {
  files: Map<string, StoredPathRecord>;
  directories: Set<string>;
}

export interface PathRecordStore {
  putRecord(path: string, data: Uint8Array): Promise<void>;
  getRecord(path: string): Promise<StoredPathRecord | null>;
  deleteRecord(path: string): Promise<void>;
  putDirectory(path: string): Promise<void>;
  hasDirectory(path: string): Promise<boolean>;
  listStoredPaths(): Promise<string[]>;
}

export function normalizeStoragePath(path: string): string {
  return path.replace(/^\/+/, '').replace(/\/+/g, '/').replace(/\/$/, '').trim();
}

export function normalizeStorageDirectoryPath(path: string): string {
  const normalized = normalizeStoragePath(path);
  return normalized === '' ? '' : `${normalized}/`;
}

export function createInMemoryPathRecordStore(
  initial?: Partial<InMemoryPathRecordStore>
): InMemoryPathRecordStore {
  return {
    files: initial?.files ?? new Map<string, StoredPathRecord>(),
    directories: initial?.directories ?? new Set<string>(),
  };
}

export function createInMemoryPathRecordStoreAdapter(
  store: InMemoryPathRecordStore
): PathRecordStore {
  return {
    async putRecord(path: string, data: Uint8Array): Promise<void> {
      store.files.set(path, {
        path,
        data: new Uint8Array(data),
        updatedAt: Date.now(),
      });
    },

    async getRecord(path: string): Promise<StoredPathRecord | null> {
      const record = store.files.get(path);
      if (!record) {
        return null;
      }
      return {
        path: record.path,
        data: new Uint8Array(record.data),
        updatedAt: record.updatedAt,
      };
    },

    async deleteRecord(path: string): Promise<void> {
      store.files.delete(path);
    },

    async putDirectory(path: string): Promise<void> {
      store.directories.add(path);
    },

    async hasDirectory(path: string): Promise<boolean> {
      return store.directories.has(path);
    },

    async listStoredPaths(): Promise<string[]> {
      return Array.from(store.files.keys());
    },
  };
}

export class PathRecordStorageBackend implements StorageBackend {
  constructor(private readonly store: PathRecordStore) {}

  async writeFile(path: string, data: Uint8Array): Promise<void> {
    await this.store.putRecord(normalizeStoragePath(path), data);
  }

  async readFile(path: string): Promise<Uint8Array> {
    const record = await this.store.getRecord(normalizeStoragePath(path));
    if (!record) {
      throw new Error(`File not found: ${path}`);
    }
    return new Uint8Array(record.data);
  }

  async listFiles(directory: string): Promise<string[]> {
    const prefix = normalizeStorageDirectoryPath(directory);
    const paths = await this.store.listStoredPaths();
    const files = new Set<string>();

    for (const path of paths) {
      if (prefix !== '' && !path.startsWith(prefix)) {
        continue;
      }
      const remainder = prefix === '' ? path : path.slice(prefix.length);
      if (remainder === '' || remainder.includes('/')) {
        continue;
      }
      files.add(remainder);
    }

    return Array.from(files).sort((left, right) => left.localeCompare(right));
  }

  async createDirectory(path: string): Promise<void> {
    await this.store.putDirectory(normalizeStoragePath(path));
  }

  async exists(path: string): Promise<boolean> {
    const normalized = normalizeStoragePath(path);
    if (normalized === '') {
      return true;
    }
    if (await this.store.getRecord(normalized)) {
      return true;
    }
    if (await this.store.hasDirectory(normalized)) {
      return true;
    }
    const prefix = `${normalized}/`;
    const paths = await this.store.listStoredPaths();
    return paths.some((entry) => entry.startsWith(prefix));
  }

  async deleteFile(path: string): Promise<void> {
    await this.store.deleteRecord(normalizeStoragePath(path));
  }
}