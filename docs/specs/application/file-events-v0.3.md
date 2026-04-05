# Nearbytes File Protocol v0.3

Status: draft normative specification.

Ordering status: non-final.

This document defines the encrypted inner file-command model for Nearbytes hubs after the move to opaque outer event envelopes.

## 1. Scope

This specification defines:

1. the decrypted file-command payloads carried inside opaque events;
2. replay semantics for file create/delete/rename operations;
3. the relationship between visible block references and decrypted file commands.

This specification does not define:

1. the outer event envelope itself;
2. standalone folder objects;
3. the final replay-order layer.

## 2. Design Rule

All file-command semantics are inside ciphertext.

Therefore the outer event envelope MUST NOT reveal:

1. file command type;
2. filenames;
3. timestamps;
4. wrapped file keys;
5. file metadata such as MIME type or plaintext size.

The only file-related information permitted in cleartext is the event's referenced ciphertext block list in the outer envelope.

## 3. Inner File Command Types

The decrypted payload MUST represent exactly one file command:

1. `CREATE_FILE`
2. `DELETE_FILE`
3. `RENAME_FILE`

## 4. `CREATE_FILE`

The decrypted command creates or overwrites a logical filename with one content descriptor and wrapped file key material.

Required inner fields:

1. `type = "CREATE_FILE"`
2. `filename`
3. `content`
4. `wrappedKey`
5. `createdAt`

Optional inner fields:

1. `mimeType`

Rules:

1. `content` MUST identify the ciphertext content to read for this file;
2. `wrappedKey` MUST be sufficient for an authorized hub reader to decrypt that content;
3. the outer event's cleartext `blockRefs` MUST include every ciphertext block directly mentioned by `content`.

## 5. `DELETE_FILE`

Required inner fields:

1. `type = "DELETE_FILE"`
2. `filename`
3. `deletedAt`

Rule:

1. the outer event `blockRefs` list SHOULD be empty.

## 6. `RENAME_FILE`

Required inner fields:

1. `type = "RENAME_FILE"`
2. `filename`
3. `toFilename`
4. `renamedAt`

Rule:

1. the outer event `blockRefs` list SHOULD be empty.

## 7. Replay Semantics

Clients reconstruct file state by:

1. authenticating outer events;
2. decrypting inner payloads;
3. selecting valid file commands;
4. replaying them under the implementation's current deterministic ordering rule.

Under the current provisional behavior:

1. `CREATE_FILE` sets or overwrites the logical filename;
2. `DELETE_FILE` removes the logical filename;
3. `RENAME_FILE` moves the logical filename if present.

## 8. Block Attribution

The storage layer MUST NOT inspect decrypted file-command fields to discover block dependencies.

Instead:

1. event writers MUST expose required ciphertext block hashes in the outer `blockRefs` list;
2. storage, sync, and retention layers MUST use only that visible dependency list.
