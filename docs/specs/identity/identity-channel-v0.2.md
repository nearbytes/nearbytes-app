# Nearbytes Identity Publication v0.2

Status: draft normative specification.

Ordering status: non-final.

This document defines canonical identity publication in Nearbytes under the opaque-event model.

## 1. Scope

This specification defines:

1. how a sender identity owns a public Nearbytes channel;
2. how `nb.identity.record.v1` updates are appended to that channel;
3. how readers resolve the active public profile for an identity.

Relationship note:

1. command-level identity lifecycle semantics are defined in `identity/identity-management-v0.2.md`.

## 2. Channel Addressing

The identity channel is addressed by the identity public key.

Rules:

1. the channel path MUST be derived from the identity public key exactly like any other Nearbytes channel path;
2. reading the identity channel MUST NOT require the identity secret;
3. appending to the identity channel MUST require the identity private key.

## 3. Outer Event Form

Identity-channel updates MUST be emitted as opaque signed outer events whose decrypted inner payload is an `APP_RECORD` carrying:

1. `protocol = "nb.identity.record.v1"`
2. `authorPublicKey = <identityPublicKeyHex>`
3. `record = canonical JSON string encoding of nb.identity.record.v1`
4. `publishedAt`

Rules:

1. the outer event envelope remains opaque at the semantic level as defined in `application/hub-model-v0.2.md`;
2. the outer event MUST be signed by the same identity keypair that owns the channel;
3. `authorPublicKey` MUST equal the identity channel public key;
4. the nested `nb.identity.record.v1` MUST verify successfully according to `identity/identity-record-v1.md`.

## 4. Update Semantics

Multiple `nb.identity.record.v1` updates MAY appear in the identity channel over time.

Readers MUST:

1. authenticate outer events;
2. decrypt supported inner payloads;
3. load valid `APP_RECORD` payloads with `protocol = "nb.identity.record.v1"`;
4. verify the outer channel signature and the nested identity-record signature;
5. order them by the identity channel's current replay convention;
6. treat the latest valid identity record as the active public profile for that identity.

