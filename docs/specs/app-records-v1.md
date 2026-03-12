# Nearbytes App Records v1

Status: draft normative specification.

This document defines the generic outer log event used for non-filesystem application data in Nearbytes. Use it when a channel needs to carry structured records such as chat messages, identity updates, or future app-level payloads without inventing a new outer event type each time.

Its scope is only the shared outer envelope and replay contract. It does not define the inner schemas of specific application protocols.

## 1. Scope

This specification defines:

1. a generic outer channel event form for non-filesystem application payloads;
2. deterministic replay rules for those payloads inside any Nearbytes channel;
3. the relationship between outer channel signatures and nested application signatures.

This specification does not define:

1. the schema of individual nested protocols;
2. file-system `CREATE_FILE` / `DELETE_FILE` / `RENAME_FILE` events;
3. trust or moderation policies.

## 2. Outer Event Type

`APP_RECORD` is a generic append-only event type for non-filesystem application payloads.

Required outer fields:

1. `type = "APP_RECORD"`
2. `fileName = ""`
3. `hash = EMPTY_HASH`
4. `encryptedKey = empty`
5. `authorPublicKey`
6. `protocol`
7. `record`
8. `publishedAt`

Field rules:

1. `protocol` MUST equal the nested record's `p` field.
2. `record` MUST be RFC 8785 canonical JSON encoded as a UTF-8 string.
3. `authorPublicKey` MUST name the nested signer key for nested-signed records.
4. the enclosing event MUST still be signed by the channel owner key.

## 3. Channel Semantics

`APP_RECORD` MAY appear in:

1. secret-derived Nearbytes volumes;
2. public-key-addressed public channels such as identity channels;
3. future mixed-purpose channels.

All `APP_RECORD` events share the same deterministic ordering rules as the enclosing channel log.

## 4. Replay Rules

Readers MUST:

1. verify the outer event signature against the enclosing channel owner key;
2. parse the nested canonical JSON from `record`;
3. reject the individual record if `protocol` and nested `p` disagree;
4. dispatch the record to the protocol-specific reader identified by `protocol`.

Readers MAY ignore unsupported application protocols while continuing to replay the rest of the channel.

## 5. Relationship to Existing Event Types

In v1:

1. file-system events remain first-class outer event types;
2. new application payload families SHOULD use `APP_RECORD`;
3. legacy outer event types such as `DECLARE_IDENTITY` and `CHAT_MESSAGE` MAY remain readable for compatibility but SHOULD NOT be emitted by new writers once `APP_RECORD` is available.
