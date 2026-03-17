# Nearbytes Identity Management v1

Status: draft normative specification.

This document defines the application-level identity command model for Nearbytes clients. It covers how identities are created locally, how public metadata is edited, how canonical publication happens, and how identity state is materialized into hubs that need it.

Its scope is command semantics and state transitions. It does not define private secret storage or replace the wire-format specs for `nb.identity.record.v1` and `nb.identity.snapshot.v1`.

## 1. Scope

This specification defines:

1. the lifecycle of a Nearbytes identity from local creation through public publication;
2. the distinction between local private identity material and shared public identity material;
3. the command surface a Nearbytes client exposes for identity creation and metadata editing;
4. how identity state becomes visible inside a hub.

This specification does not define:

1. the private encoding or backup format of a local identity secret;
2. cross-device sync of unshared private identity material;
3. a social trust or verification system.

## 2. Core Model

An identity has two parts:

1. private secret material, held locally by the client;
2. public signed profile material, shared through Nearbytes protocols.

Rules:

1. the identity secret is private user input and MUST NOT be written into a shared hub log;
2. the identity public key is deterministically derived from that secret and MAY appear in shared logs;
3. editable public metadata such as display name and bio is shared by publishing a new signed public record, not by sharing the secret.

## 3. Relationship to Other Specs

1. the enclosing hub/log model is defined in `hub-model-v1.md`;
2. canonical public identity records are defined in `identity-record-v1.md`;
3. canonical publication of those records is defined in `identity-channel-v1.md`;
4. foreign-hub materialization is defined in `identity-snapshot-v1.md`;
5. chat usage of identities is defined in `chat-events-v1.md`.

## 4. Command Surface

Nearbytes identity management is defined in terms of application-level commands.

### 4.1 `CREATE_IDENTITY`

Purpose:

1. create a new local identity from private user input.

Required local inputs:

1. identity secret or equivalent local secret material;
2. optional password or extra secret factor if the client supports one;
3. initial public profile metadata, at minimum `displayName`.

Effects:

1. derive an identity keypair locally;
2. persist the private secret locally according to client policy;
3. create an initial public profile state for that identity;
4. optionally publish that state canonically;
5. optionally materialize that identity into the current hub when the user is acting there.

### 4.2 `UPDATE_IDENTITY_PROFILE`

Purpose:

1. change the public metadata associated with an existing identity key.

Supported v1 fields:

1. `displayName`
2. `bio`

Effects:

1. produce a new signed `nb.identity.record.v1` for the same identity public key;
2. append that record to the canonical identity publication channel;
3. append a new `nb.identity.snapshot.v1` into any hub where the client explicitly uses that identity and needs the latest public state.

### 4.3 `PUBLISH_IDENTITY`

Purpose:

1. make the current public identity profile canonical and replayable outside the local device.

Effect:

1. append an `APP_RECORD` with `protocol = "nb.identity.record.v1"` to the identity publication channel defined by `identity-channel-v1.md`.

### 4.4 `MATERIALIZE_IDENTITY_IN_HUB`

Purpose:

1. make a hub aware of the latest public state of an identity being used there.

Effect:

1. append an `APP_RECORD` with `protocol = "nb.identity.snapshot.v1"` to the target hub.

Typical triggers:

1. joining a hub chat with that identity;
2. sending a chat message with that identity;
3. future identity-authenticated hub actions.

### 4.5 `SELECT_IDENTITY_FOR_HUB`

Purpose:

1. choose which local identity a client will use when acting inside a specific hub.

Rule:

1. this is local application state and MUST NOT be treated as a shared hub-log command in v1.

## 5. Hub-Carried Identity State

A hub MAY carry identity-related state for its own application behavior.

In v1, the standardized shared forms are:

1. `nb.identity.snapshot.v1` for public identity material copied into a hub;
2. legacy `DECLARE_IDENTITY` for compatibility with older chat-capable hubs.

This means a hub can host identity-related commands and records even though the private identity secret remains local.

## 6. Replay and Authority

Authority is split by layer:

1. the identity secret authorizes local identity control;
2. the identity publication channel is the canonical public source for that identity's published profile;
3. any given hub may contain local snapshots of that public identity state for replay within the hub.

Replay rules:

1. clients MUST treat the canonical identity channel as the authoritative public publication source;
2. clients MUST treat hub snapshots as local materializations, not as canonical ownership transfer;
3. clients MUST use enclosing log order, not profile timestamps, when deciding which record is later within a given log.

## 7. Privacy and Security

1. clients MUST NOT serialize private identity secrets into shared hub records;
2. clients MUST NOT treat possession of a hub secret as authority to forge an identity record;
3. public profile updates MUST remain signed by the relevant identity keypair;
4. hubs MAY contain public identity material, but that does not imply disclosure of the underlying secret.

## 8. Extensibility

Future Nearbytes versions MAY extend identity management with:

1. richer public profile fields such as avatar references;
2. explicit delegation or device-link flows;
3. additional hub-scoped identity-authenticated commands.

Any such extension MUST preserve the split between:

1. local private identity control; and
2. shared public signed identity material.