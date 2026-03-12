/**
 * File-level event types for the NearBytes file layer.
 */
export type FileEvent = CreateFileEvent | DeleteFileEvent | RenameFileEvent;

/**
 * Event emitted when a file is created or updated.
 */
export interface CreateFileEvent {
  type: 'CREATE_FILE';
  filename: string;
  blobHash: string;
  contentType: 'b' | 'm';
  size: number;
  mimeType?: string;
  createdAt: number;
}

/**
 * Event emitted when a file is deleted.
 */
export interface DeleteFileEvent {
  type: 'DELETE_FILE';
  filename: string;
  deletedAt: number;
}

/**
 * Event emitted when a file is renamed without changing its blob.
 */
export interface RenameFileEvent {
  type: 'RENAME_FILE';
  filename: string;
  toFilename: string;
  renamedAt: number;
}

/**
 * Materialized metadata for a file in the reconstructed state.
 */
export interface FileMetadata {
  filename: string;
  blobHash: string;
  contentType?: 'b' | 'm';
  size: number;
  mimeType?: string;
  createdAt: number;
}
