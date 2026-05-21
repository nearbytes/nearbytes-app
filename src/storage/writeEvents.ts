export interface StorageWriteEvent {
  readonly sourceId: string;
  readonly path: string;
  readonly size: number;
  readonly channelKeyHex?: string;
}

export type StorageWriteListener = (event: StorageWriteEvent) => void;
