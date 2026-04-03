# Nearbytes File Commands v0.2

Status: draft normative specification.

This document defines user-level file operations above the opaque-event hub model.

Its scope is command semantics and default behavior, not UI design.

## 1. Scope

This specification defines:

1. `PUT_FILE`
2. `DELETE_FILE`
3. `RENAME_FILE`
4. `RENAME_FOLDER`
5. `COPY_FILES`
6. `PASTE_FILES`
7. `EXPORT_RECIPIENT_REFERENCES`
8. `IMPORT_RECIPIENT_REFERENCES`

This specification does not define:

1. UI-only commands such as preview or open-in-viewer;
2. access control beyond possession of the relevant volume secret;
3. final replay ordering.

Relationship to other specs:

1. the enclosing opaque hub/event model is defined in `application/hub-model-v0.2.md`;
2. encrypted inner file-command payloads are defined in `application/file-events-v0.3.md`;
3. recipient-bound references are defined in `references/nb-reference-v1.md` and `references/nb-refs-v1.md`;
4. source-bound references are defined in `references/nb-src-ref-v1.md` and `references/nb-src-refs-v1.md`.

## 2. Terms

1. **Source volume**: the volume from which a copy or export command originates.
2. **Destination volume**: the volume into which a paste or import command writes.
3. **Modern file command**: a decrypted inner `CREATE_FILE` command carrying wrapped per-file key material.
4. **Conflict rename**: automatic generation of a destination filename such as `name copy.ext` or `name copy 2.ext`.

## 3. Command Semantics

### 3.1 `PUT_FILE`

Writes or overwrites a logical filename in the active volume.

Rules:

1. writers MUST generate a fresh random FEK for each new write;
2. writers MUST encrypt file content with that FEK;
3. writers MUST place wrapped key material inside the decrypted inner `CREATE_FILE.wrappedKey` field;
4. writers MUST place any required ciphertext block hashes in the outer event `blockRefs` list;
5. writers SHOULD use the single-block content descriptor unless a manifest-backed representation is needed.

### 3.2 `DELETE_FILE`

Deletes a logical filename by appending an opaque event carrying an inner `DELETE_FILE` command.

### 3.3 `RENAME_FILE`

Renames a single logical filename by appending an opaque event carrying an inner `RENAME_FILE` command.

### 3.4 `RENAME_FOLDER`

Renames a virtual folder by appending one or more opaque events carrying inner `RENAME_FILE` commands.

### 3.5 `COPY_FILES`

Copies one or more logical filenames out of the active source volume.

Default output:

1. `COPY_FILES` MUST produce `nb.src.refs.v1` unless the caller explicitly requests recipient-bound export;
2. export MUST preserve exact logical filenames;
3. export MAY travel through clipboard, chat, or any other transport.

Legacy behavior:
None.

### 3.6 `PASTE_FILES`

Pastes one or more previously exported files into the active destination volume.

Rules:

1. `PASTE_FILES` MUST accept `nb.src.refs.v1`;
2. `PASTE_FILES` MAY also accept `nb.refs.v1` when recipient-bound import is requested;
3. source-bound paste MUST require local access to the referenced source volume context;
4. if the source volume is unavailable or locked locally, paste MUST fail clearly and MUST NOT partially import files;
5. paste MUST preserve original logical filenames unless a destination conflict requires conflict rename.

Conflict behavior:

1. default conflict policy is auto-rename copy;
2. the first conflicting import MUST use `name copy.ext`;
3. subsequent conflicts MUST use `name copy 2.ext`, `name copy 3.ext`, and so on.

### 3.7 `EXPORT_RECIPIENT_REFERENCES`

Exports one or more logical filenames as a recipient-bound `nb.refs.v1` bundle for an explicitly chosen destination volume.

Rules:

1. export requires the destination volume public identifier;
2. only that destination volume can directly unwrap the FEK capsules.

### 3.8 `IMPORT_RECIPIENT_REFERENCES`

Imports `nb.refs.v1` into the active destination volume.

Rules:

1. import MUST require the active volume ID to equal the bundle recipient volume ID;
2. import MUST fail closed if recipient binding does not match.

## 4. Compatibility and Reads

Read compatibility rules:

1. implementations in the active opaque-event line MUST read and write only the wrapped-key file-command model defined by `application/file-events-v0.3.md`;
2. no legacy plaintext outer file-event compatibility is required by this spec line.
