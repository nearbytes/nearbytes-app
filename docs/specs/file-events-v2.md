# Nearbytes File Events v2

Status: draft normative specification.

This document defines the low-level filesystem event model for Nearbytes. It is the replay contract that turns an append-only log into the current file map.

Its scope is the event layer itself: file creation, deletion, rename, and replay semantics. It does not define higher-level command orchestration or standalone folder objects.

## 1. Scope

This specification defines:

1. The event model for the Nearbytes file-system layer.
2. A first-class `RENAME_FILE` log event.
3. Replay semantics for path-like filenames and virtual folders.

This specification does not define:

1. Standalone folder objects.
2. ACLs, locking, or concurrent merge policy.
3. Filesystem mount behavior outside the event log.

Command note:

1. User-level commands such as upload, copy, paste, recipient-bound export, and folder rename orchestration are defined in `file-commands-v1.md`.

## 2. Terms

1. **Logical filename**: UTF-8 path-like name stored in events, for example `photos/2026/a.jpg`.
2. **Virtual folder**: a UI/view concept derived from filename prefixes split on `/`.
3. **Current state**: the deterministic file map obtained by replaying the append-only event log.
4. **Blob**: encrypted content block addressed by SHA-256 hash.

## 3. Data Model

Nearbytes stores files as:

1. encrypted blobs, content-addressed by `blobHash`;
2. signed log events that bind logical filenames to blobs over time.

There are no standalone folder entries in v2. A “folder” exists only because filenames may contain `/`.

Example:

- `notes/todo.txt`
- `notes/archive/old.txt`

From these names, a client MAY present virtual folders `notes` and `notes/archive`.

## 4. Event Types

### 4.1 `CREATE_FILE`

Creates or overwrites a logical filename with a blob reference.

Required fields:

1. `type = "CREATE_FILE"`
2. `fileName`
3. `hash`
4. `encryptedKey`
5. `size`
6. `createdAt`

Optional fields:

1. `mimeType`

### 4.2 `DELETE_FILE`

Removes a logical filename from reconstructed state.

Required fields:

1. `type = "DELETE_FILE"`
2. `fileName`
3. `hash = EMPTY_HASH`
4. `encryptedKey = empty`
5. `deletedAt`

### 4.3 `RENAME_FILE`

Renames a single logical filename without changing the referenced blob.

Required fields:

1. `type = "RENAME_FILE"`
2. `fileName` = source logical filename
3. `toFileName` = destination logical filename
4. `hash = EMPTY_HASH`
5. `encryptedKey = empty`
6. `renamedAt`

Forbidden fields:

1. `size`
2. `mimeType`
3. `createdAt`
4. `deletedAt`

`RENAME_FILE` does not create a new blob and does not require blob re-upload.

## 5. Validity Rules

For `RENAME_FILE`:

1. `fileName` and `toFileName` MUST both be non-empty.
2. `fileName` and `toFileName` MUST NOT be equal.
3. Replay MUST treat rename as a metadata move, not a copy.
4. If the source does not exist at replay time, the rename is a no-op.
5. If the destination already exists at replay time, the destination MUST be overwritten by the moved file.

Rule 5 matches existing event-sourced overwrite semantics used by `CREATE_FILE`.

## 6. Replay Semantics

Clients reconstruct file state by replaying events in chronological order:

1. `CREATE_FILE(name, blob)` sets `state[name] = blob`.
2. `DELETE_FILE(name)` removes `state[name]`.
3. `RENAME_FILE(from, to)`:
   - if `state[from]` does not exist, do nothing;
   - otherwise move that entry to `to`;
   - remove `from`.

The moved metadata is:

1. `blobHash`
2. `size`
3. `mimeType`
4. original file creation time already associated with the file entry

The rename event timestamp is used only for event ordering, not as a replacement for file creation time.

## 7. Virtual Folder Behavior

Because folders are derived from path prefixes:

1. renaming a file across prefixes changes its apparent folder;
2. empty folders disappear automatically when no filenames remain under their prefix;
3. renaming a “folder” is syntactic sugar for applying file renames to every matching prefix.

So:

- file rename is a first-class log operation;
- folder rename remains a higher-level batch operation over path-prefixed filenames.

## 8. Wire Compatibility

v2 extends the event payload format with:

1. a new event discriminator `RENAME_FILE`;
2. `toFileName`;
3. `renamedAt`.

Readers that do not understand `RENAME_FILE` are not compatible with v2 logs and MUST fail closed.

## 9. Implementation Guidance

Writers SHOULD:

1. emit a single `RENAME_FILE` event for a single-file rename;
2. preserve existing blob references;
3. reject empty or identical names before signing.

Batch folder rename MAY be implemented by emitting one `RENAME_FILE` event per affected file.

## 10. Migration

Existing logs containing only `CREATE_FILE` and `DELETE_FILE` remain valid.

New logs that include `RENAME_FILE` require:

1. updated event deserialization;
2. updated state reconstruction;
3. updated timeline readers;
4. updated validation and signing logic.
