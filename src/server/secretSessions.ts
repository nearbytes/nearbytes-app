import { randomBytes } from 'crypto';

export interface SecretSessionStore {
  createSession(secret: string): string;
  getSecret(token: string): string | null;
}

interface SecretSessionEntry {
  secret: string;
  createdAt: number;
  lastAccessedAt: number;
}

export interface InMemorySecretSessionStoreOptions {
  readonly maxEntries?: number;
}

const DEFAULT_MAX_ENTRIES = 256;

export class InMemorySecretSessionStore implements SecretSessionStore {
  private readonly entries = new Map<string, SecretSessionEntry>();
  private readonly maxEntries: number;

  constructor(options: InMemorySecretSessionStoreOptions = {}) {
    this.maxEntries = Math.max(1, options.maxEntries ?? DEFAULT_MAX_ENTRIES);
  }

  createSession(secret: string): string {
    const token = randomBytes(24).toString('base64url');
    const now = Date.now();
    this.entries.set(token, {
      secret,
      createdAt: now,
      lastAccessedAt: now,
    });
    this.evictIfNeeded();
    return token;
  }

  getSecret(token: string): string | null {
    const entry = this.entries.get(token);
    if (!entry) {
      return null;
    }
    entry.lastAccessedAt = Date.now();
    return entry.secret;
  }

  private evictIfNeeded(): void {
    while (this.entries.size > this.maxEntries) {
      let oldestToken: string | null = null;
      let oldestTouchedAt = Number.POSITIVE_INFINITY;
      for (const [token, entry] of this.entries.entries()) {
        if (entry.lastAccessedAt < oldestTouchedAt) {
          oldestTouchedAt = entry.lastAccessedAt;
          oldestToken = token;
        }
      }
      if (!oldestToken) {
        return;
      }
      this.entries.delete(oldestToken);
    }
  }
}
