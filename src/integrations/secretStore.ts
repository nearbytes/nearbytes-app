import { promises as fs } from 'fs';
import path from 'path';
import type { ProviderSecretStore } from './runtime.js';

export interface JsonFileSecretStoreOptions {
  readonly filePath: string;
  readonly encrypt?: (plaintext: Buffer) => Buffer;
  readonly decrypt?: (ciphertext: Buffer) => Buffer;
}

interface SerializedSecretsFile {
  readonly version: 1;
  readonly entries: Record<string, string>;
}

export class JsonFileSecretStore implements ProviderSecretStore {
  constructor(private readonly options: JsonFileSecretStoreOptions) {}

  async get<T>(key: string): Promise<T | null> {
    const snapshot = await this.readFile();
    const encoded = snapshot.entries[key];
    if (!encoded) {
      return null;
    }
    const rawBytes = Buffer.from(encoded, 'base64');
    const plaintext = this.options.decrypt ? this.options.decrypt(rawBytes) : rawBytes;
    return JSON.parse(plaintext.toString('utf8')) as T;
  }

  async set<T>(key: string, value: T): Promise<void> {
    const snapshot = await this.readFile();
    const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
    const encrypted = this.options.encrypt ? this.options.encrypt(plaintext) : plaintext;
    const next: SerializedSecretsFile = {
      version: 1,
      entries: {
        ...snapshot.entries,
        [key]: encrypted.toString('base64'),
      },
    };
    await this.writeFile(next);
  }

  async delete(key: string): Promise<void> {
    const snapshot = await this.readFile();
    if (!(key in snapshot.entries)) {
      return;
    }
    const entries = { ...snapshot.entries };
    delete entries[key];
    await this.writeFile({
      version: 1,
      entries,
    });
  }

  private async readFile(): Promise<SerializedSecretsFile> {
    try {
      const raw = await fs.readFile(this.options.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<SerializedSecretsFile>;
      if (parsed.version !== 1 || !parsed.entries || typeof parsed.entries !== 'object') {
        return { version: 1, entries: {} };
      }
      return {
        version: 1,
        entries: Object.fromEntries(
          Object.entries(parsed.entries).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
        ),
      };
    } catch (error) {
      if (isFileNotFound(error)) {
        return { version: 1, entries: {} };
      }
      throw error;
    }
  }

  private async writeFile(snapshot: SerializedSecretsFile): Promise<void> {
    const directory = path.dirname(this.options.filePath);
    await fs.mkdir(directory, { recursive: true });
    const tempPath = `${this.options.filePath}.${process.pid}.tmp`;
    await fs.writeFile(tempPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
    await fs.rename(tempPath, this.options.filePath);
  }
}

function isFileNotFound(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'ENOENT');
}
