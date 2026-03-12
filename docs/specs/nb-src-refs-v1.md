# Nearbytes Source-Bound Reference Bundle v1 (`nb.src.refs.v1`)

Status: draft normative specification.

This document defines the multi-file bundle form of source-bound references. It is the default transport for Nearbytes copy/paste and for shared-source workflows where the importer can open the source volume and choose any destination volume at paste time.

Its scope is bundle structure and grouped import behavior for source-bound references. It is not recipient-bound sharing.

## 1. Scope

This specification defines:

1. `nb.src.refs.v1` bundles containing one or more source-bound file references.
2. The transport metadata required for default clipboard copy/paste and shared-source messaging workflows.
3. Import behavior for multi-file paste into an active destination volume.

This specification does not define:

1. sender signatures or author identity;
2. ciphertext-block transport;
3. recipient binding to a specific destination volume.

Introductory use cases (non-normative):

1. **Default `Cmd+C` / `Cmd+V` clipboard flow**: copy selected files in source volume `A`, then later paste them into any destination volume `B`.
2. **Cross-device transfer through arbitrary transport**: send the bundle through Telegram or any other medium, then import it on another machine as long as that machine can open source volume `A`.
3. **Shared-volume collaboration**: multiple people who can open the same source volume may exchange bundles and independently paste into their own volumes.

These workflows all depend on the same rule: the bundle is useful only to a party that can derive the source volume key material locally and can still reach the referenced ciphertext blocks.

Command note:

1. Source-bound bundle copy/paste command semantics are defined in `file-commands-v1.md`.

Security intuition (non-normative):

1. A party that cannot open source volume `s` cannot unwrap the nested source-bound FEK capsules.
2. For such a party, the bundle is only filenames, hashes, sizes, source identity, and opaque wrapped-key material.
3. The bundle alone does not reveal plaintext file contents.

## 2. Terms

1. **Bundle**: a clipboard- or message-safe object containing one or more source-bound reference entries.
2. **Entry**: one logical file plus its nested `nb.src.ref.v1` reference.
3. **Source Volume ID**: the shared source volume public identifier in lowercase hex.

## 3. Object Format

Minimal required object:

```json
{
  "p": "nb.src.refs.v1",
  "s": "<sourceVolumeIdHex>",
  "items": [
    {
      "name": "notes/todo.txt",
      "ref": {
        "p": "nb.src.ref.v1",
        "s": "<sourceVolumeIdHex>",
        "c": { "t": "b", "h": "<64hex>", "z": 12345 },
        "x": "<b64u>"
      }
    }
  ]
}
```

Optional entry fields:

1. `mime`
2. `createdAt`

Field requirements:

1. `p` MUST be `nb.src.refs.v1`.
2. `s` MUST be the source Volume ID for the whole bundle.
3. `items` MUST contain at least one entry.
4. Every `items[i].name` MUST be a non-empty logical filename.
5. Every `items[i].ref` MUST be a valid `nb.src.ref.v1` object.
6. Every `items[i].ref.s` MUST equal top-level `s`.

## 4. Validity Rules

1. Entry filenames MUST be unique within one bundle.
2. Importers MUST preserve entry order as encoded in `items`.
3. Importers MUST reject unknown top-level protocol IDs or unsupported versions.
4. Importers MUST fail closed if any nested `nb.src.ref.v1` object fails validation.
5. Importers MUST reject a bundle if local source-volume context for `s` is unavailable or locked.

## 5. Import Procedure

Given local access to source volume context and an active destination volume:

1. Parse and validate the bundle.
2. Require local source-volume context for `s` to be available and unlocked.
3. For each entry in `items`, validate and unwrap nested `nb.src.ref.v1`.
4. Append one `CREATE_FILE` event per entry in bundle order:
   - `fileName = entry.name`
   - `hash = entry.ref.c.h`
   - `contentType = entry.ref.c.t`
   - `size = entry.ref.c.z`
   - `mimeType = entry.mime` if present
   - `createdAt = entry.createdAt` if present, otherwise importer-selected timestamp
   - `encryptedKey = WrapForVolume(FEK, destinationVolumeSymmetricKey)`
5. Import MUST NOT rewrite ciphertext blocks when the referenced ciphertext remains valid for reuse.

## 6. Export Guidance

Writers SHOULD:

1. use `nb.src.refs.v1` as the default clipboard format because destination volume is often unknown at copy time;
2. include each logical filename in `items[i].name`;
3. include `mime` when known;
4. include `createdAt` when preserving original file timestamps is desired;
5. use `nb.refs.v1` instead when the sender intentionally targets a specific destination volume.

## 7. Failure Conditions

Import MUST fail if:

1. `p` is unknown or unsupported;
2. `items` is empty;
3. any entry name is empty or duplicated;
4. any nested `nb.src.ref.v1` validation or unwrap fails;
5. the source volume context for `s` is unavailable or locked.
