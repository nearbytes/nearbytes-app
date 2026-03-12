# Nearbytes Content Descriptor v1

Status: draft normative specification.

This document defines the small content descriptors that point to encrypted file content in Nearbytes. It answers the question: what ciphertext object, or manifest of ciphertext objects, represents this file?

Its scope is content addressing and manifest structure. It does not define sharing capsules or recipient binding.

## 1. Scope

This document defines:

1. `nb.content.single.v1` descriptor (`t = "b"`).
2. `nb.content.manifest.v1` descriptor (`t = "m"`).
3. `nb.manifest.v1` plaintext manifest schema for chunked files.

This document does not define:

1. Reference capsules (`nb.ref.v1`).
2. Cross-user identity discovery.

## 2. Common Descriptor Schema

A content descriptor is:

```json
{ "t": "b|m", "h": "<64hex>", "z": 12345 }
```

Fields:

1. `t` (string): object type marker.
2. `h` (string): SHA-256 hash of a ciphertext block.
3. `z` (uint64): plaintext file size in bytes.

Validation:

1. `h` MUST match `^[0-9a-f]{64}$`.
2. `z` MUST be an integer in `[0, 2^64-1]`.
3. `t` MUST be exactly `b` or `m`.

## 3. `nb.content.single.v1`

Definition:

1. `t` MUST be `b`.
2. `h` points to one encrypted data block.
3. `z` is the plaintext file size for that block.

Read rule:

1. Fetch ciphertext block at `h`.
2. Decrypt with FEK.
3. Output plaintext bytes.
4. Output length MUST equal `z`.

## 4. `nb.content.manifest.v1`

Definition:

1. `t` MUST be `m`.
2. `h` points to one encrypted manifest block.
3. `z` is total plaintext file size.

Read rule:

1. Fetch ciphertext manifest block at `h`.
2. Decrypt with FEK to obtain `nb.manifest.v1` JSON.
3. Validate manifest.
4. Fetch/decrypt chunks in manifest order.
5. Concatenate chunk plaintext.
6. Final output length MUST equal `z`.

## 5. `nb.manifest.v1` Plaintext Schema

Manifest plaintext (before encryption):

```json
{
  "p": "nb.manifest.v1",
  "k": "file-chunks",
  "s": 12345,
  "ch": [
    { "h": "<64hex>", "z": 4096 },
    { "h": "<64hex>", "z": 4096 }
  ]
}
```

Fields:

1. `p` (string): MUST equal `nb.manifest.v1`.
2. `k` (string): MUST equal `file-chunks`.
3. `s` (uint64): total plaintext size.
4. `ch` (array): ordered chunks.
5. `ch[i].h` (string): ciphertext block hash.
6. `ch[i].z` (uint64): plaintext bytes for chunk.

Validation:

1. `ch` MUST be non-empty.
2. Each chunk hash MUST be lowercase 64-hex.
3. `sum(ch[*].z)` MUST equal `s`.
4. `s` MUST equal descriptor `z`.

## 6. Storage Rule

1. Manifest JSON MUST be encrypted before storage.
2. Encrypted manifest is stored in `blocks/<hash>.bin` like any encrypted block.
3. No plaintext manifest may be persisted in block storage.

## 7. Backward Compatibility

1. Legacy events without explicit content-type metadata are interpreted as single-block (`t = "b"`).
2. New writers SHOULD set explicit content-type metadata to avoid ambiguity.
