import type { FileEvent, FileMetadata } from './fileEvents.js';

/**
 * Reconstructs the current file state by replaying an append-only event log.
 *
 * Event sourcing treats the log as the single source of truth. By deterministically
 * applying all file events in chronological order, the current state can always be
 * derived without any mutable index. This guarantees that the same event history
 * produces the same file listing on every machine.
 *
 * @param events - File events to replay
 * @returns Map of filename to reconstructed file metadata
 */
export function reconstructFileState(events: FileEvent[]): Map<string, FileMetadata> {
  const ordered = [...events].sort((a, b) => {
    const timeDiff = getEventTimestamp(a) - getEventTimestamp(b);
    if (timeDiff !== 0) return timeDiff;

    const nameDiff = compareStrings(a.filename, b.filename);
    if (nameDiff !== 0) return nameDiff;

    return compareStrings(eventTieBreaker(a), eventTieBreaker(b));
  });

  const files = new Map<string, FileMetadata>();

  for (const event of ordered) {
    if (event.type === 'CREATE_FILE') {
      files.set(event.filename, {
        filename: event.filename,
        blobHash: event.blobHash,
        contentType: event.contentType,
        size: event.size,
        mimeType: event.mimeType,
        createdAt: event.createdAt,
      });
    } else if (event.type === 'DELETE_FILE') {
      files.delete(event.filename);
    } else if (event.type === 'RENAME_FILE') {
      const existing = files.get(event.filename);
      if (!existing) {
        continue;
      }
      files.delete(event.filename);
      files.set(event.toFilename, {
        ...existing,
        filename: event.toFilename,
      });
    }
  }

  return files;
}

function getEventTimestamp(event: FileEvent): number {
  if (event.type === 'CREATE_FILE') return event.createdAt;
  if (event.type === 'DELETE_FILE') return event.deletedAt;
  return event.renamedAt;
}

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function eventTieBreaker(event: FileEvent): string {
  if (event.type === 'CREATE_FILE') {
    return `C:${event.blobHash}`;
  }
  if (event.type === 'RENAME_FILE') {
    return `R:${event.toFilename}`;
  }
  return 'D';
}
