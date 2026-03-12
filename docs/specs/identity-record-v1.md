# Nearbytes Identity Record v1 (`nb.identity.record.v1`)

Status: draft normative specification.

This document defines the signed public profile object for a Nearbytes identity. It is the portable statement a sender makes about their public-facing name and profile data, signed by that sender's identity key.

Its scope is the record format and its validation rules. It does not define discovery, trust policy, or private profile data.

## 1. Scope

This specification defines:

1. A public identity record signed by a Nearbytes-style identity keypair.
2. The minimal profile information required to represent a chat sender.
3. Validation and signature rules for identity records carried inside volume chat events.

This specification does not define:

1. discovery across unrelated transports or directories;
2. trust, moderation, or reputation systems;
3. per-field privacy controls;
4. encrypted private profile data.

Relationship note:

1. canonical publication of `nb.identity.record.v1` is defined in `identity-channel-v1.md`;
2. foreign-volume materialization of the same public profile is defined in `identity-snapshot-v1.md`.

Introductory note (non-normative):

1. An identity secret is private user input, exactly like a volume secret.
2. The corresponding identity public key is the stable public identifier of that sender.
3. The identity record itself is public and signed; no additional confidentiality is required in v1.

## 2. Terms

1. **Identity secret**: private user input used to deterministically derive an identity keypair.
2. **Identity public key**: lowercase hex encoding of the derived public key, using the usual Nearbytes public-key representation.
3. **Identity record**: a signed public profile object describing the holder of the identity keypair.

## 3. Wire Encoding

1. Wire encoding MUST be RFC 8785 canonical JSON, UTF-8 bytes.
2. Binary fields MUST be base64url without padding.
3. Public keys MUST be lowercase hexadecimal.

## 4. Object Format

Minimal required object:

```json
{
  "p": "nb.identity.record.v1",
  "k": "<identityPublicKeyHex>",
  "ts": 1731456000000,
  "profile": {
    "displayName": "Ada"
  },
  "sig": "<b64u>"
}
```

Field requirements:

1. `p` MUST be `nb.identity.record.v1`.
2. `k` MUST be the signer identity public key.
3. `ts` MUST be a non-negative integer millisecond timestamp.
4. `profile.displayName` MUST be a non-empty UTF-8 string.
5. `profile.bio`, if present, MUST be a UTF-8 string.
6. `sig` MUST be a valid signature by identity key `k` over the canonical JSON encoding of the object with `sig` omitted.

## 5. Signature Rule

The signer MUST compute the signature over the canonical JSON bytes of:

```json
{
  "p": "nb.identity.record.v1",
  "k": "<identityPublicKeyHex>",
  "ts": 1731456000000,
  "profile": {
    "displayName": "Ada",
    "bio": "optional"
  }
}
```

Verification MUST:

1. remove `sig`;
2. canonicalize the remaining object;
3. verify `sig` with public key `k`.

## 6. Update Semantics

Multiple identity records for the same `k` MAY appear over time.

Readers SHOULD:

1. group records by `k`;
2. sort valid records by `ts`, then by enclosing volume-log event hash if a tie-breaker is needed;
3. treat the latest valid record as the active profile for `k`.

Older valid records remain part of history but are superseded by later valid records.

## 7. Failure Conditions

Readers MUST reject the record if:

1. `p` is unknown or unsupported;
2. `k` is not a valid Nearbytes public key hex string;
3. required fields are missing or malformed;
4. `displayName` is empty after trimming;
5. signature verification fails.

## 8. Relationship to Chat

`nb.identity.record.v1` is used by chat-capable volume clients to attach human-readable sender information to identity public keys.

In v1:

1. chat messages identify senders by identity public key;
2. chat clients MAY resolve that key to the latest known `nb.identity.record.v1` in the same volume log;
3. identity selection in the app is local UI state, but the published identity record is a portable signed object.
