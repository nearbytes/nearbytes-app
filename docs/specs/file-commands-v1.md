# Nearbytes File Commands v1

Status: draft normative specification.

This document defines the user-level file operations that Nearbytes clients perform above the append-only log. It says what commands like upload, rename, copy, paste, and reference export mean, and which lower-level events or reference formats they are expected to use.

Its scope is command semantics and default behavior, not UI design.

## 1. Scope

This specification defines the Nearbytes-native file command surface above the append-only event log.

Covered commands:

1. `PUT_FILE`
2. `DELETE_FILE`
3. `RENAME_FILE`
4. `RENAME_FOLDER`
5. `COPY_FILES`
6. `PASTE_FILES`
7. `EXPORT_RECIPIENT_REFERENCES`
8. `IMPORT_RECIPIENT_REFERENCES`

This specification does not define:

1. UI-only commands such as preview, open-in-viewer, or download-to-host filesystem;
2. access control or multi-user authorization beyond possession of the relevant volume secret;
3. cut/move semantics across volumes.

Relationship to other specs:

1. Event append and replay are defined in `file-events-v2.md`.
2. Recipient-bound references are defined in `nb-reference-v1.md` and `nb-refs-v1.md`.
3. Source-bound references are defined in `nb-src-ref-v1.md` and `nb-src-refs-v1.md`.

## 2. Terms

1. **Source volume**: the volume from which a copy or export command originates.
2. **Destination volume**: the volume into which a paste or import command writes.
3. **Modern file**: a file whose `CREATE_FILE` event carries a wrapped per-file FEK in `encryptedKey`.
4. **Legacy file**: a file whose `CREATE_FILE` event carries an empty `encryptedKey` and therefore relies on the legacy volume-key decrypt path.
5. **Conflict rename**: automatic generation of a destination filename such as `name copy.ext` or `name copy 2.ext`.

## 3. Command Semantics

### 3.1 `PUT_FILE`

Writes or overwrites a logical filename in the active volume.

Rules:

1. Writers MUST generate a fresh random FEK for each new write.
2. Writers MUST encrypt file content with that FEK.
3. Writers MUST wrap the FEK for the active volume and store the wrapped FEK in `CREATE_FILE.encryptedKey`.
4. Writers SHOULD emit `contentType = "b"` unless a manifest-backed multi-block representation is used.

### 3.2 `DELETE_FILE`

Deletes a logical filename by appending a `DELETE_FILE` event.

### 3.3 `RENAME_FILE`

Renames a single logical filename by appending a `RENAME_FILE` event.

### 3.4 `RENAME_FOLDER`

Renames a virtual folder by appending one `RENAME_FILE` event for each affected logical filename.

### 3.5 `COPY_FILES`

Copies one or more logical filenames out of the active source volume.

Default output:

1. `COPY_FILES` MUST produce `nb.src.refs.v1` unless the caller explicitly requests recipient-bound export.
2. Export MUST preserve exact logical filenames.
3. Export MAY travel through clipboard, chat, or any other transport.

Legacy behavior:

1. If a selected file is legacy, the implementation SHOULD lazily upgrade it to a modern FEK-based representation before export.
2. Lazy upgrade appends a new `CREATE_FILE` for the same logical filename using a wrapped FEK and reusable blob reference.

### 3.6 `PASTE_FILES`

Pastes one or more previously exported files into the active destination volume.

Rules:

1. `PASTE_FILES` MUST accept `nb.src.refs.v1`.
2. `PASTE_FILES` MAY also accept `nb.refs.v1` when recipient-bound import is requested.
3. Source-bound paste MUST require local access to the referenced source volume context.
4. If the source volume is unavailable or locked locally, paste MUST fail with a clear explanation and MUST NOT partially import files.
5. Paste MUST preserve original logical filenames unless a destination conflict requires conflict rename.

Conflict behavior:

1. Default conflict policy is auto-rename copy.
2. The first conflicting import MUST use `name copy.ext`.
3. Subsequent conflicts MUST use `name copy 2.ext`, `name copy 3.ext`, and so on.

### 3.7 `EXPORT_RECIPIENT_REFERENCES`

Exports one or more logical filenames as a recipient-bound `nb.refs.v1` bundle for an explicitly chosen destination volume.

Rules:

1. Export requires the destination volume public identifier.
2. Only that destination volume can directly unwrap the FEK capsules.

### 3.8 `IMPORT_RECIPIENT_REFERENCES`

Imports `nb.refs.v1` into the active destination volume.

Rules:

1. Import MUST require the active volume ID to equal the bundle recipient volume ID.
2. Import MUST fail closed if recipient binding does not match.

## 4. Compatibility and Reads

Read compatibility rules:

1. Implementations MUST continue to read legacy files with empty `encryptedKey`.
2. Implementations MUST prefer wrapped-FEK reads when `encryptedKey` is present.
3. Legacy and modern files MAY coexist in the same volume.

## 5. API Mapping Guidance

Suggested API mapping:

1. `PUT_FILE` -> upload/add endpoint
2. `DELETE_FILE` -> delete endpoint
3. `RENAME_FILE` -> file rename endpoint
4. `RENAME_FOLDER` -> folder rename endpoint
5. `COPY_FILES` -> source-reference export endpoint
6. `PASTE_FILES` -> source-reference import endpoint
7. `EXPORT_RECIPIENT_REFERENCES` -> recipient-reference export endpoint
8. `IMPORT_RECIPIENT_REFERENCES` -> recipient-reference import endpoint
