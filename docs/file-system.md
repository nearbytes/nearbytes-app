# NearBytes File System Model (Phase 1)

## Overview

The file system layer is an event-sourced model built on top of the NearBytes
channel log. Every file operation is recorded as an immutable event. The
current file list is derived by replaying those events in order, which removes
any need for a mutable index.

## Deterministic Secret-Based Addressing

Each secret deterministically derives a channel key pair. The public key maps to
a channel identifier used by the storage backend, and the private key derives a
channel-wide symmetric key for encrypting file contents. This means:

- The same secret always maps to the same event log.
- File state is always reconstructible from the log.
- No central index is required to track files.

## File Events

Two event types represent all file operations:

### CREATE_FILE

Creates or overwrites a logical filename with a new encrypted blob.

Fields:

- `filename`: logical name (no storage path implied)
- `blobHash`: hash of the encrypted blob
- `size`: plaintext size in bytes
- `mimeType` (optional): content type
- `createdAt`: Unix timestamp (ms)

### DELETE_FILE

Removes a filename from the reconstructed state.

Fields:

- `filename`: logical name to remove
- `deletedAt`: Unix timestamp (ms)

## Event Sourcing and State Reconstruction

The file list is rebuilt by replaying events in chronological order:

1. Start with an empty map.
2. `CREATE_FILE` inserts or overwrites a filename entry.
3. `DELETE_FILE` removes the filename entry (idempotent).

Because the replay process is deterministic, any client with the same secret
and event log will compute the same file list.

## Blobs and Logs

File contents are encrypted and stored as blobs. Each event references a blob
by its hash (the hash of the encrypted blob). Events are stored in the channel
log as signed event files. Event payloads may include cleartext logical metadata
such as filename and timestamps; blob content remains encrypted.

Filesystem layout (relative to storage root):

```
blocks/
  <blob-hash>.bin
channels/
  <channel-public-key-hex>/
    <event-hash>.bin
    snapshot.latest.json   # On-demand snapshot (if computed)
```

## Filenames Are Logical Pointers

Filenames are logical identifiers that map to the latest blob hash in the
event-sourced state. They do not imply any storage path or directory structure.
Deleting a file only removes the logical pointer; the encrypted blob remains
content-addressed in storage.
