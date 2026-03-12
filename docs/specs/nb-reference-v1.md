# Nearbytes Encrypted Reference v1 (`nb.ref.v1`)

Status: draft normative specification.

This document defines the recipient-bound encrypted single-file reference used when a sender wants one chosen recipient context to be able to import a file. It covers the wrapped-key capsule, the bound content descriptor, and the import semantics that turn that reference back into a file entry.

Its scope is a single recipient-bound reference object. It does not carry ciphertext blocks and it is not the multi-file transport wrapper.

## 1. Scope

This specification defines:

1. `nb.ref.v1` encrypted references.
2. Recipient binding and capsule cryptography.
3. Import behavior that appends a valid `CREATE_FILE` event.
4. Descriptor targets for single-block and multi-block files.
5. A single-file capsule format intended to be embedded in richer transport wrappers.

This specification does not define:

1. Cross-user identity discovery.
2. Redundancy and repair semantics.
3. CBOR/COSE wire formats.
4. Logical filename transport for clipboard-oriented multi-file workflows.

Introductory use cases (non-normative):

1. **Per-destination-volume cut and paste**: a sender may target a specific destination volume public key, place the resulting reference on the clipboard or another transport, and rely on import succeeding only when that destination volume is open.
2. **Chat-style sharing by public key**: although this specification is written in terms of recipient volumes, the same recipient-binding pattern also fits systems where participants introduce themselves by public key and references are addressed to that key.
3. **Sealed delivery for later reveal**: a sender may derive a future recipient volume public key from a high-entropy secret, create references now, distribute them early, and reveal the secret later so holders can finally open the recipient volume and import the references.

These are all the same cryptographic shape: a reference is usable once the recipient context can derive the private key matching the targeted public key and can still reach the referenced ciphertext blocks.

Command note:

1. Recipient-bound export/import command semantics are defined in `file-commands-v1.md`.

## 2. Terms

1. **Volume Secret**: user input used to open a volume (`address` or `address:password`).
2. **Volume Keypair**: deterministic P-256 keypair derived from Volume Secret.
3. **Volume ID**: lowercase hex encoding of uncompressed 65-byte public key.
4. **FEK**: 32-byte random file encryption key.
5. **Descriptor**: content locator `{t,h,z}`.
6. **Capsule**: FEK encrypted for a recipient volume.

## 3. Recipient Volume Key Derivation

Recipient keypair derivation:

1. `seed = PBKDF2-HMAC-SHA256(secret, salt="nearbytes-private-key-v1", iterations=100000, dkLen=32)`
2. `priv = seed mod n(P-256)` with zero mapped to one.
3. `pub = P-256(priv * G)` in uncompressed 65-byte form.
4. `volumeId = hex(pub).lowercase`.

Security requirement:

1. Volume secrets MUST have high entropy.
2. Weak human passwords are vulnerable to offline guessing.

Security intuition (non-normative):

1. A holder that cannot derive the private key for recipient volume `k.r` cannot recover the FEK.
2. For such a holder, the reference is only a transport object containing hashes, sizes, recipient identity, and opaque capsule bytes.
3. The reference alone does not reveal plaintext file contents.

## 4. Wire Encoding

1. Wire encoding MUST be RFC 8785 canonical JSON, UTF-8 bytes.
2. Binary fields MUST be base64url without padding.
3. Hash fields MUST be lowercase 64-hex SHA-256.

## 5. Object Format

Minimal required object:

```json
{
  "p": "nb.ref.v1",
  "c": { "t": "b", "h": "<64hex>", "z": 12345 },
  "k": { "r": "<volumeIdHex>", "e": "<b64u>", "n": "<b64u>", "w": "<b64u>" }
}
```

Field requirements:

1. `p` MUST be `nb.ref.v1`.
2. `c.t` MUST be `b` or `m`.
3. `c.h` MUST be ciphertext hash (64-hex).
4. `c.z` MUST be plaintext file size (`uint64`).
5. `k.r` MUST be recipient Volume ID.
6. `k.e` MUST be ephemeral P-256 public key bytes (65 bytes).
7. `k.n` MUST be AES-GCM nonce (12 bytes).
8. `k.w` MUST be wrapped FEK ciphertext+tag.

No signature field is defined in v1.

Filename note:

1. `nb.ref.v1` intentionally does not carry a logical filename.
2. Clipboard or messaging workflows that need filenames or multiple files SHOULD wrap one or more `nb.ref.v1` objects inside `nb.refs.v1`.

## 6. Capsule Cryptography

To generate capsule `k`:

1. Generate ephemeral P-256 keypair `(esk, epk)`.
2. Compute `shared = ECDH(esk, recipientPub)`.
3. Derive `kek = HKDF-SHA256(shared, salt=SHA256("nb.ref.v1"), info="nb-ref-wrap-v1", L=32)`.
4. Build AAD as canonical JSON bytes of:

```json
{ "p": "nb.ref.v1", "c": { "t": "...", "h": "...", "z": ... }, "r": "<k.r>" }
```

5. Encrypt FEK (32 bytes) with AES-256-GCM using `kek`, nonce `k.n`, AAD above.
6. Store `epk` in `k.e` and ciphertext+tag in `k.w`.

Tampering rule:

1. Any change to `c` or `k.r` MUST cause unwrap failure via AAD authentication failure.

Practical interpretation (non-normative):

1. If you are not the targeted recipient volume, the copy/paste payload is not directly useful.
2. You can forward it, store it, or inspect its public metadata, but you cannot make semantic use of the file contents from the reference alone.

## 7. Multi-Block Target Rule

If `c.t == "m"`:

1. `c.h` points to an encrypted manifest block.
2. Manifest plaintext schema is `nb.manifest.v1` (see `nb-content-v1.md`).
3. Manifest MUST be encrypted with FEK before storage.

## 8. Import Procedure

Given active volume context:

1. Parse and validate canonical constraints.
2. Require `activeVolumeId == k.r`.
3. Derive recipient private key from active Volume Secret.
4. Derive KEK and decrypt `k.w` using bound AAD.
5. Obtain FEK.
6. Append `CREATE_FILE` event in active volume:
   - `hash = c.h`
   - `contentType = c.t`
   - `size = c.z`
   - `encryptedKey = WrapForVolume(FEK, activeVolumeSymmetricKey)`
7. Import MUST NOT rewrite ciphertext blocks; it appends metadata/event only.

## 9. Backward Compatibility

1. Legacy events without `contentType` MUST be treated as single-block (`b`).
2. Legacy events with empty `encryptedKey` continue legacy read path.
3. New writers SHOULD emit non-empty wrapped FEK and explicit `contentType`.

## 10. Failure Conditions

Import MUST fail if:

1. `p` is unknown or unsupported.
2. Any encoding, length, or hash validation fails.
3. `k.r` does not match active volume.
4. Capsule decrypt/authentication fails.
5. `c.t == "m"` and manifest validation fails.
