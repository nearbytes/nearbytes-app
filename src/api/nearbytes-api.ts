import type { Secret } from 'nearbytes-crypto';
import type { VolumeFileMetadata, VolumeFileSystemState, Volume } from 'nearbytes-files';
import type { Hash } from 'nearbytes-crypto';
import type { CryptoOperations } from 'nearbytes-crypto';
import type { Log } from 'nearbytes-log';
import { loadEventLog, openChannel } from 'nearbytes-log';
import { materializeVolume, getFile, listFiles } from 'nearbytes-files';
import { storeData, deleteFile, retrieveData } from 'nearbytes-files';
import { bytesToHex } from 'nearbytes-crypto';
import type { EventLogEntry } from 'nearbytes-log';

export interface OpenVolumeResult {
  readonly volume: Volume;
  readonly fileSystemState: VolumeFileSystemState;
  readonly publicKeyHex: string;
  readonly fileCount: number;
}

export interface AddFileResult {
  readonly fileName: string;
  readonly eventHash: Hash;
  readonly dataHash: Hash;
  readonly size: number;
}

export interface RemoveFileResult {
  readonly fileName: string;
  readonly eventHash: Hash;
}

/**
 * Framework-agnostic backend API for Nearbytes operations.
 */
export class NearbytesAPI {
  private readonly channelStorage: Log;
  private readonly crypto: CryptoOperations;

  constructor(crypto: CryptoOperations, log: Log) {
    this.crypto = crypto;
    this.channelStorage = log;
  }

  async openVolume(secret: Secret): Promise<OpenVolumeResult> {
    const volume = await openChannel(secret, this.crypto);
    const fileSystemState = await materializeVolume(volume, this.channelStorage, this.crypto);
    const publicKeyHex = bytesToHex(volume.publicKey);

    return {
      volume,
      fileSystemState,
      publicKeyHex,
      fileCount: fileSystemState.files.size,
    };
  }

  async listFiles(secret: Secret): Promise<VolumeFileMetadata[]> {
    const volume = await this.getVolume(secret);
    const fileSystemState = await materializeVolume(volume, this.channelStorage, this.crypto);
    return listFiles(fileSystemState);
  }

  async addFile(
    secret: Secret,
    fileName: string,
    data: Uint8Array | ArrayBuffer,
  ): Promise<AddFileResult> {
    const dataArray = data instanceof Uint8Array ? data : new Uint8Array(data);

    if (!fileName || fileName.trim().length === 0) {
      throw new Error('File name cannot be empty');
    }

    const { eventHash, dataHash } = await storeData(
      dataArray,
      fileName,
      secret,
      this.crypto,
      this.channelStorage,
    );

    return {
      fileName,
      eventHash,
      dataHash,
      size: dataArray.length,
    };
  }

  async removeFile(secret: Secret, fileName: string): Promise<RemoveFileResult> {
    const { eventHash } = await deleteFile(fileName, secret, this.crypto, this.channelStorage);
    return { fileName, eventHash };
  }

  async getFile(secret: Secret, fileName: string): Promise<Uint8Array> {
    const volume = await this.getVolume(secret);
    const fileSystemState = await materializeVolume(volume, this.channelStorage, this.crypto);
    const file = getFile(fileSystemState, fileName);
    if (!file) {
      throw new Error(`File not found: ${fileName}`);
    }
    return retrieveData(file.eventHash, secret, this.crypto, this.channelStorage);
  }

  async getFileByHash(secret: Secret, eventHash: Hash): Promise<Uint8Array> {
    return retrieveData(eventHash, secret, this.crypto, this.channelStorage);
  }

  async getEventLog(secret: Secret): Promise<EventLogEntry[]> {
    const volume = await this.getVolume(secret);
    return loadEventLog(volume, this.channelStorage, this.crypto);
  }

  private async getVolume(secret: Secret): Promise<Volume> {
    return openChannel(secret, this.crypto);
  }
}
