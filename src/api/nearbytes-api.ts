import type { Secret } from 'nearbytes-crypto';
import type { VolumeFileMetadata, VolumeFileSystemState, Volume } from 'nearbytes-files';
import type { Hash } from 'nearbytes-crypto';
import type { CryptoOperations } from 'nearbytes-crypto';
import type { StorageBackend, ChannelPathMapper } from 'nearbytes-storage';
import { createLog, type Log } from 'nearbytes-log';
import { defaultPathMapper } from 'nearbytes-storage';
import { openVolume, materializeVolume, getFile, listFiles, loadEventLog } from 'nearbytes-files';
import { storeData, deleteFile, retrieveData } from 'nearbytes-files';
import { bytesToHex } from 'nearbytes-crypto';
import type { EventLogEntry } from 'nearbytes-log';

/**
 * Result of opening a volume
 */
export interface OpenVolumeResult {
  readonly volume: Volume;
  readonly fileSystemState: VolumeFileSystemState;
  readonly publicKeyHex: string;
  readonly fileCount: number;
}

/**
 * Result of adding a file
 */
export interface AddFileResult {
  readonly fileName: string;
  readonly eventHash: Hash;
  readonly dataHash: Hash;
  readonly size: number;
}

/**
 * Result of removing a file
 */
export interface RemoveFileResult {
  readonly fileName: string;
  readonly eventHash: Hash;
}

/**
 * Result of getting a file
 */
export interface GetFileResult {
  readonly fileName: string;
  readonly data: Uint8Array;
  readonly size: number;
  readonly contentAddress: Hash;
  readonly eventHash: Hash;
}

/**
 * Nearbytes API
 * 
 * Framework-agnostic backend API for Nearbytes operations.
 * Can be used from Electron IPC, web workers, or any other context.
 * 
 * This class has no CLI dependencies:
 * - No console.log
 * - No process.exit
 * - Returns structured data
 * - Throws errors (doesn't exit)
 */
export class NearbytesAPI {
  private readonly channelStorage: Log;
  private readonly crypto: CryptoOperations;

  constructor(
    crypto: CryptoOperations,
    storage: StorageBackend,
    pathMapper: ChannelPathMapper = defaultPathMapper
  ) {
    this.crypto = crypto;
    this.channelStorage = createLog(storage, pathMapper);
  }

  /**
   * Opens a volume from a secret
   * 
   * @param secret - Volume secret
   * @returns Volume information and file system state
   * @throws Error if volume cannot be opened or event log verification fails
   */
  async openVolume(secret: Secret): Promise<OpenVolumeResult> {
    // Open volume (derives keys)
    const volume = await openVolume(secret, this.crypto);

    // Materialize file system state
    const fileSystemState = await materializeVolume(volume, this.channelStorage, this.crypto);

    // Convert public key to hex string for display (browser-compatible)
    const publicKeyHex = bytesToHex(volume.publicKey);

    return {
      volume,
      fileSystemState,
      publicKeyHex,
      fileCount: fileSystemState.files.size,
    };
  }

  /**
   * Lists all files in a volume
   * 
   * @param secret - Volume secret
   * @returns Array of file metadata, sorted by name
   * @throws Error if volume cannot be opened
   */
  async listFiles(secret: Secret): Promise<VolumeFileMetadata[]> {
    const volume = await this.getVolume(secret);
    const fileSystemState = await materializeVolume(volume, this.channelStorage, this.crypto);
    return listFiles(fileSystemState);
  }

  /**
   * Adds a file to a volume
   * 
   * @param secret - Volume secret
   * @param fileName - Name of the file
   * @param data - File data (Uint8Array or ArrayBuffer)
   * @returns File metadata and hashes
   * @throws Error if file cannot be added
   */
  async addFile(
    secret: Secret,
    fileName: string,
    data: Uint8Array | ArrayBuffer
  ): Promise<AddFileResult> {
    // Convert ArrayBuffer to Uint8Array if needed
    const dataArray = data instanceof Uint8Array ? data : new Uint8Array(data);

    // Validate file name
    if (!fileName || fileName.trim().length === 0) {
      throw new Error('File name cannot be empty');
    }

    // Get volume (ensures it exists)
    await this.getVolume(secret);

    // Store file
    const result = await storeData(dataArray, fileName, secret, this.crypto, this.channelStorage);

    return {
      fileName,
      eventHash: result.eventHash,
      dataHash: result.dataHash,
      size: dataArray.length,
    };
  }

  /**
   * Removes a file from a volume
   * 
   * @param secret - Volume secret
   * @param fileName - Name of the file to remove
   * @returns Removal result
   * @throws Error if file cannot be removed
   */
  async removeFile(secret: Secret, fileName: string): Promise<RemoveFileResult> {
    // Validate file name
    if (!fileName || fileName.trim().length === 0) {
      throw new Error('File name cannot be empty');
    }

    // Get volume (ensures it exists)
    await this.getVolume(secret);

    // Delete file (creates DELETE_FILE event)
    const result = await deleteFile(fileName, secret, this.crypto, this.channelStorage);

    return {
      fileName,
      eventHash: result.eventHash,
    };
  }

  /**
   * Gets a file from a volume by name
   * 
   * @param secret - Volume secret
   * @param fileName - Name of the file to get
   * @returns File data and metadata
   * @throws Error if file doesn't exist or cannot be retrieved
   */
  async getFile(secret: Secret, fileName: string): Promise<GetFileResult> {
    // Validate file name
    if (!fileName || fileName.trim().length === 0) {
      throw new Error('File name cannot be empty');
    }

    // Get volume and materialize state
    const volume = await this.getVolume(secret);
    const fileSystemState = await materializeVolume(volume, this.channelStorage, this.crypto);

    // Get file metadata
    const file = getFile(fileSystemState, fileName);
    if (!file) {
      throw new Error(`File "${fileName}" does not exist in volume`);
    }

    // Retrieve file data
    const data = await retrieveData(file.eventHash, secret, this.crypto, this.channelStorage);

    return {
      fileName,
      data,
      size: data.length,
      contentAddress: file.contentAddress,
      eventHash: file.eventHash,
    };
  }

  /**
   * Gets the event log for a volume
   * 
   * @param secret - Volume secret
   * @returns Array of event log entries, sorted by event hash
   * @throws Error if volume cannot be opened
   */
  async getEventLog(secret: Secret): Promise<EventLogEntry[]> {
    const volume = await this.getVolume(secret);
    return await loadEventLog(volume, this.channelStorage, this.crypto);
  }

  /**
   * Gets or creates a volume from a secret
   * Internal helper method
   */
  private async getVolume(secret: Secret): Promise<Volume> {
    return await openVolume(secret, this.crypto);
  }
}
