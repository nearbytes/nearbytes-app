# Nearbytes Identity Snapshot v1 (`nb.identity.snapshot.v1`)

Status: draft normative specification.

This document defines the record copied into a foreign volume when that volume needs a local, replayable view of an identity. A snapshot carries readable public profile data plus a precise reference back to the canonical identity-channel event it came from.

Its scope is this local materialization format. It is not the canonical identity log itself.

## 1. Scope

This specification defines a portable snapshot+reference record used to materialize identity state into a foreign volume while preserving a link back to the canonical identity channel.

## 2. Object Format

Minimal required object:

```json
{
  "p": "nb.identity.snapshot.v1",
  "k": "<identityPublicKeyHex>",
  "ts": 1731456000000,
  "ref": {
    "channel": "<identityPublicKeyHex>",
    "eventHash": "<64hex>"
  },
  "record": {
    "p": "nb.identity.record.v1",
    "k": "<identityPublicKeyHex>",
    "ts": 1731456000000,
    "profile": {
      "displayName": "Ada"
    },
    "sig": "<b64u>"
  },
  "sig": "<b64u>"
}
```

Field requirements:

1. `p` MUST be `nb.identity.snapshot.v1`.
2. `k` MUST be the identity public key.
3. `ts` MUST be a non-negative integer millisecond timestamp for the snapshot materialization.
4. `ref.channel` MUST equal the identity public key hex of the canonical identity channel.
5. `ref.eventHash` MUST be the outer event hash of the referenced identity-channel `APP_RECORD`.
6. `record` MUST be a valid `nb.identity.record.v1`.
7. `record.k` MUST equal `k`.
8. `sig` MUST be a valid signature by identity key `k` over the canonical JSON encoding of the object with `sig` omitted.

## 3. Publication Rules

Foreign volumes MUST emit identity snapshots as `APP_RECORD` events carrying:

1. `protocol = "nb.identity.snapshot.v1"`
2. `authorPublicKey = <identityPublicKeyHex>`
3. `record = canonical JSON string encoding of nb.identity.snapshot.v1`
4. `publishedAt`

The enclosing outer event MUST still be signed by the foreign volume key.

## 4. Materialization Policy

Clients SHOULD append a new snapshot into a foreign volume only on explicit identity use, such as:

1. joining a chat with that identity;
2. sending a chat message with that identity;
3. future identity-authenticated actions in that volume.

Clients SHOULD append a new snapshot only if either:

1. the foreign volume has no valid snapshot for that identity; or
2. the latest valid local snapshot references an older identity-channel event or carries different profile data.

## 5. Replay Semantics

Within any foreign volume:

1. readers MUST group snapshots by `k`;
2. readers MUST order valid snapshots by `publishedAt`, then enclosing event hash;
3. the latest valid snapshot becomes the active local profile for that identity in that volume.

Older snapshots remain part of the foreign volume's history but are superseded by later ones.
