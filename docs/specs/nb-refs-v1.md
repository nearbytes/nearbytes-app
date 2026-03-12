# Nearbytes Encrypted Reference Bundle v1 (`nb.refs.v1`)

Status: draft normative specification.

This document defines the multi-file transport bundle for recipient-bound file references. It is the wrapper that carries one or more `nb.ref.v1` entries through clipboard, chat, or other transport layers.

Its scope is bundle structure and import semantics for grouped recipient-bound references. It is not a new cryptographic primitive beyond the nested single-file references.

## 1. Scope

This specification defines:

1. `nb.refs.v1` bundles containing one or more encrypted file references.
2. The transport metadata required for clipboard and messaging workflows.
3. Import behavior for multi-file paste into an active volume.

This specification does not define:

1. sender signatures or author identity;
2. ciphertext-block transport;
3. conflict-resolution UI beyond overwrite rejection.

Command note:

1. Recipient-bound bundle export/import command semantics are defined in `file-commands-v1.md`.

Security intuition (non-normative):

1. A party that cannot open recipient volume `r` cannot unwrap any nested FEK capsules in the bundle.
2. For such a party, the bundle is only filenames, hashes, sizes, recipient identity, and opaque wrapped-key material.
3. The bundle alone does not reveal plaintext file contents.

## 2. Terms

1. **Bundle**: a clipboard- or message-safe object containing one or more file reference entries.
2. **Entry**: one logical file plus its nested `nb.ref.v1` reference.
3. **Recipient Volume ID**: the target volume public identifier in lowercase hex.

## 3. Wire Encoding

1. Wire encoding MUST be RFC 8785 canonical JSON, UTF-8 bytes.
2. Binary fields MUST use base64url without padding.
3. Hash fields MUST use lowercase 64-hex SHA-256.

## 4. Object Format

Minimal required object:

```json
{
  "p": "nb.refs.v1",
  "r": "<volumeIdHex>",
  "items": [
    {
      "name": "notes/todo.txt",
      "ref": {
        "p": "nb.ref.v1",
        "c": { "t": "b", "h": "<64hex>", "z": 12345 },
        "k": { "r": "<volumeIdHex>", "e": "<b64u>", "n": "<b64u>", "w": "<b64u>" }
      }
    }
  ]
}
```

Optional entry fields:

1. `mime`
2. `createdAt`

Field requirements:

1. `p` MUST be `nb.refs.v1`.
2. `r` MUST be the recipient Volume ID for the whole bundle.
3. `items` MUST contain at least one entry.
4. Every `items[i].name` MUST be a non-empty logical filename.
5. Every `items[i].ref` MUST be a valid `nb.ref.v1` object.
6. Every `items[i].ref.k.r` MUST equal top-level `r`.

## 5. Validity Rules

1. Entry filenames MUST be unique within one bundle.
2. Importers MUST preserve entry order as encoded in `items`.
3. Importers MUST reject unknown top-level protocol IDs or unsupported versions.
4. Importers MUST fail closed if any nested `nb.ref.v1` object fails validation.
5. Importers MUST reject a bundle if active volume ID does not equal `r`.

## 6. Import Procedure

Given active volume context:

1. Parse and validate the bundle.
2. Require `activeVolumeId == r`.
3. For each entry in `items`, validate and unwrap nested `nb.ref.v1`.
4. Append one `CREATE_FILE` event per entry in bundle order:
   - `fileName = entry.name`
   - `hash = entry.ref.c.h`
   - `contentType = entry.ref.c.t`
   - `size = entry.ref.c.z`
   - `mimeType = entry.mime` if present
   - `createdAt = entry.createdAt` if present, otherwise importer-selected timestamp
   - `encryptedKey = WrapForVolume(FEK, activeVolumeSymmetricKey)`
5. Import MUST NOT rewrite ciphertext blocks when the nested reference remains valid for reuse.

## 7. Export Guidance

Writers SHOULD:

1. use `nb.refs.v1` when the sender intentionally targets a known destination volume, including for single-file transfer;
2. include each logical filename in `items[i].name`;
3. include `mime` when known;
4. include `createdAt` when preserving original file timestamps is desired.

Single-file bare `nb.ref.v1` remains valid, but it does not carry a logical filename and is therefore not sufficient by itself for clipboard-oriented multi-file paste UX.

Default clipboard note:

1. When destination volume is not known at copy time, writers SHOULD prefer `nb.src.refs.v1` instead of `nb.refs.v1`.

## 8. Failure Conditions

Import MUST fail if:

1. `p` is unknown or unsupported;
2. `items` is empty;
3. any entry name is empty or duplicated;
4. any nested `nb.ref.v1` validation or capsule unwrap fails;
5. active volume ID does not match `r`.
