import type { PublicKey } from './keys.js';

export interface StorageWriteEvent {
  readonly sourceId: string;
  readonly path: string;
  readonly size: number;
  readonly channelKeyHex?: string;
}

export type StorageWriteListener = (event: StorageWriteEvent) => void;

/**
 * Storage backend interface for abstracting file operations
 */
export interface StorageBackend {
  /**
   * Write data to a file path
   * @param path - File path
   * @param data - Data to write
   */
  writeFile(path: string, data: Uint8Array): Promise<void>;

  /**
   * Read data from a file path
   * @param path - File path
   * @returns File contents
   */
  readFile(path: string): Promise<Uint8Array>;

  /**
   * List all files in a directory
   * @param directory - Directory path
   * @returns Array of file paths
   */
  listFiles(directory: string): Promise<string[]>;

  /**
   * Create a directory (and parent directories if needed)
   * @param path - Directory path
   */
  createDirectory(path: string): Promise<void>;

  /**
   * Check if a path exists
   * @param path - Path to check
   * @returns True if path exists
   */
  exists(path: string): Promise<boolean>;

  /**
   * Delete a file at the given path
   * @param path - File path to delete
   * @throws StorageError if file doesn't exist or deletion fails
   */
  deleteFile(path: string): Promise<void>;
}

/**
 * Function type for mapping public keys to channel directory paths
 */
export type ChannelPathMapper = (publicKey: PublicKey) => string;

/**
 * Default path mapper: converts public key to hex string in channels/ subdirectory
 * @param publicKey - Channel public key
 * @returns Path to channel directory: channels/[hex-string]
 */
export function defaultPathMapper(publicKey: PublicKey): string {
  const hexKey = Array.from(publicKey)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `channels/${hexKey}`;
}

