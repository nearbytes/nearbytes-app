# Nearbytes Identity Channel v1

Status: draft normative specification.

This document defines the canonical public channel owned by a Nearbytes identity keypair. It explains where signed public profile updates live, how they are appended, and how readers decide which update is the current one.

Its scope is the identity's own channel. It does not define how other volumes cache or mirror that information.

## 1. Scope

This specification defines:

1. how a sender identity owns a public Nearbytes channel;
2. how `nb.identity.record.v1` updates are appended to that channel;
3. how readers resolve the active public profile for an identity.

## 2. Channel Addressing

The identity channel is addressed by the identity public key.

Rules:

1. the channel path MUST be derived from the identity public key exactly like any other Nearbytes channel path;
2. reading the identity channel MUST NOT require the identity secret;
3. appending to the identity channel MUST require the identity private key.

## 3. Outer Event Form

Identity-channel updates MUST be emitted as `APP_RECORD` events carrying:

1. `protocol = "nb.identity.record.v1"`
2. `authorPublicKey = <identityPublicKeyHex>`
3. `record = canonical JSON string encoding of nb.identity.record.v1`
4. `publishedAt`

Rules:

1. the enclosing `APP_RECORD` event MUST be signed by the same identity keypair that owns the channel;
2. `authorPublicKey` MUST equal the identity channel public key;
3. the nested `nb.identity.record.v1` MUST verify successfully according to `identity-record-v1.md`.

## 4. Update Semantics

Multiple `nb.identity.record.v1` updates MAY appear in the identity channel over time.

Readers MUST:

1. load valid `APP_RECORD` events with `protocol = "nb.identity.record.v1"`;
2. verify the outer channel signature and the nested identity-record signature;
3. order them by `publishedAt`, then outer event hash as tie-breaker;
4. treat the latest valid identity record as the active public profile for that identity.

Older valid updates remain part of identity history and MUST remain replayable.

## 5. Relationship to Other Channels

Other volumes do not become canonical identity sources.

They MAY:

1. refer to an identity channel by public key;
2. materialize a local snapshot of the latest known identity record;
3. keep older snapshots in their own append-only history.

They MUST NOT reinterpret their local snapshot log as the authoritative identity channel.
