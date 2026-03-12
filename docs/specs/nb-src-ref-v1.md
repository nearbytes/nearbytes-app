# Nearbytes Source-Bound Reference v1 (`nb.src.ref.v1`)

Status: draft normative specification.

This document defines the single-file source-bound reference used when import depends on access to the source volume rather than a preselected recipient. It is designed for Nearbytes copy/paste and other shared-source workflows where the destination is chosen later.

Its scope is the source-bound single-file transport object and its import behavior. It is not recipient-bound sharing.

## 1. Scope

This specification defines:

1. `nb.src.ref.v1` source-bound encrypted references.
2. A single-file transport object for copy/paste and shared-source workflows.
3. Import behavior that appends a valid `CREATE_FILE` event into a destination volume.

This specification does not define:

1. sender signatures or author identity;
2. ciphertext-block transport;
3. recipient binding to a specific destination volume.

Introductory use cases (non-normative):

1. **Quick copy/paste between volumes**: copy in source volume `A`, then paste into destination volume `B` later, without knowing `B` at copy time.
2. **Cross-device shared-volume transfer**: send the reference through Telegram or any other transport, and import it on another device as long as that device can open the same source volume `A`.
3. **Shared-source collaboration**: multiple people may exchange references that point into a shared volume, while each importer chooses their own destination volume.

These workflows all depend on the same rule: the reference is useful only to a party that can derive the source volume key material locally and can still reach the referenced ciphertext blocks.

Command note:

1. Source-bound copy/paste command semantics are defined in `file-commands-v1.md`.

Security intuition (non-normative):

1. A holder that cannot open source volume `s` cannot recover the FEK from `x`.
2. For such a holder, the reference is only a transport object containing source identity, hashes, sizes, and opaque wrapped-key bytes.
3. The reference alone does not reveal plaintext file contents.

## 2. Terms

1. **Source Volume Secret**: user input used to open the source volume.
2. **Source Volume ID**: lowercase hex encoding of the source volume public key.
3. **Source-Wrapped FEK**: FEK encrypted under key material derived from the source volume.
4. **Descriptor**: content locator `{t,h,z}`.

## 3. Relationship to Recipient-Bound References

`nb.src.ref.v1` is a sibling of `nb.ref.v1`, not a subtype.

Comparison:

1. `nb.ref.v1` says: only recipient volume `R` may import this.
2. `nb.src.ref.v1` says: anyone who can open source volume `S` may import this somewhere else.

Operational consequences:

1. `nb.src.ref.v1` does not require a destination public key at copy time.
2. `nb.src.ref.v1` is suitable as the default clipboard format.
3. `nb.ref.v1` is suitable for explicit “copy for this destination volume” flows.

## 4. Wire Encoding

1. Wire encoding MUST be RFC 8785 canonical JSON, UTF-8 bytes.
2. Binary fields MUST be base64url without padding.
3. Hash fields MUST be lowercase 64-hex SHA-256.

## 5. Object Format

Minimal required object:

```json
{
  "p": "nb.src.ref.v1",
  "s": "<sourceVolumeIdHex>",
  "c": { "t": "b", "h": "<64hex>", "z": 12345 },
  "x": "<b64u>"
}
```

Field requirements:

1. `p` MUST be `nb.src.ref.v1`.
2. `s` MUST be the source Volume ID.
3. `c.t` MUST be `b` or `m`.
4. `c.h` MUST be ciphertext hash (64-hex).
5. `c.z` MUST be plaintext file size (`uint64`).
6. `x` MUST be a source-wrapped FEK ciphertext+tag.

No logical filename is carried in the bare single-file object.

## 6. Cryptographic Rule

1. `x` MUST contain the FEK wrapped under source-volume-derived key material.
2. A party that can open the source volume MUST be able to unwrap `x` and recover the FEK.
3. A party that cannot open the source volume MUST NOT be able to recover the FEK from `x` alone.

Practical interpretation (non-normative):

1. If you do not possess the source volume key, the copy/paste payload is not directly useful.
2. You may forward it or archive it, but it remains just hashes, sizes, source identity, and opaque ciphertext until the source volume can be opened locally.

This specification does not require the sender to know the destination volume at export time.

## 7. Import Procedure

Given local access to source volume context and an active destination volume:

1. Parse and validate canonical constraints.
2. Require local source-volume context for `s` to be available and unlocked.
3. Derive source key material from the source volume context.
4. Decrypt `x` to obtain FEK.
5. Append `CREATE_FILE` event in the destination volume:
   - `hash = c.h`
   - `contentType = c.t`
   - `size = c.z`
   - `encryptedKey = WrapForVolume(FEK, destinationVolumeSymmetricKey)`
6. Import MUST NOT rewrite ciphertext blocks when the referenced ciphertext remains valid for reuse.

## 8. Export Guidance

Writers SHOULD:

1. emit `nb.src.ref.v1` only when the source file is already represented by a reusable FEK-based blob reference;
2. prefer wrapping one or more `nb.src.ref.v1` objects inside `nb.src.refs.v1` for clipboard UX, because filenames and multi-selection matter in practice;
3. use `nb.ref.v1` instead when the sender intentionally targets a specific destination volume.

Legacy note:

1. If a source file is stored in a legacy format that does not preserve a reusable per-file FEK, the writer MAY re-encrypt the plaintext into a new FEK-based blob before emitting `nb.src.ref.v1`.
2. Therefore, source-bound export MAY be zero-copy for modern files and MAY require one-time re-encryption for legacy files.

## 9. Failure Conditions

Import MUST fail if:

1. `p` is unknown or unsupported;
2. any encoding, length, or hash validation fails;
3. the source volume context for `s` is unavailable or locked;
4. source unwrap of `x` fails;
5. `c.t == "m"` and manifest validation fails.
