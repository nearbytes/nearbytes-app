# Nearbytes Hub Model v1

Status: draft normative specification.

This document defines the core Nearbytes application model: a hub is an append-only authenticated log that may carry commands for multiple subsystems. Files, chat, identity material, and future features are not separate storage universes; they are different protocol families interpreted over the same hub log.

Its scope is the shared hub model. It does not define the payload schema of each subsystem command.

## 1. Scope

This specification defines:

1. what a Nearbytes hub is at the model level;
2. how a hub carries commands for multiple subsystems;
3. the relationship between the hub log, encrypted blobs, and application protocols;
4. the open-ended extension rule for future subsystems.

This specification does not define:

1. the concrete schema of file, chat, or identity records;
2. trust policy, moderation, or social policy;
3. transport/discovery rules for locating a hub.

## 2. Terms

1. **Hub**: the primary Nearbytes logical unit exposed to users; typically opened from a secret and interpreted as one append-only authenticated log plus associated encrypted content.
2. **Hub log**: the ordered sequence of signed commands appended to a hub.
3. **Subsystem**: a protocol family that interprets some subset of hub-log commands, for example files, chat, or identity materialization.
4. **Projection**: deterministic state reconstructed by replaying hub-log commands according to one subsystem specification.

## 3. Core Model

Every hub consists of:

1. an ordered append-only authenticated log;
2. optional encrypted content addressed by references stored in that log;
3. one or more subsystem protocols that interpret hub-log entries.

Examples of subsystems include:

1. file state;
2. chat history;
3. identity management material;
4. identity snapshots and publication references;
5. future app protocols not yet defined.

A hub MAY contain commands for one subsystem only, or for many subsystems mixed together.

## 4. Ordering Rule

The authoritative order is the hub log order.

Rules:

1. subsystem projections MUST be derived from the enclosing hub-log order;
2. signer-supplied timestamps such as `ts`, `createdAt`, or `publishedAt` are payload metadata and MUST NOT redefine the authoritative order of the log;
3. if two subsystem records disagree semantically, the subsystem specification decides the replay rule, but that rule MUST start from hub-log order.

Non-normative note:

1. some current implementations may use timestamps as a temporary approximation for display or replay, but that is not the intended long-term Nearbytes model.

## 5. Command Families

Hub-log entries are interpreted by command family.

In current Nearbytes specs:

1. file commands are represented by first-class outer file events such as `CREATE_FILE`, `DELETE_FILE`, and `RENAME_FILE`;
2. application commands are represented by `APP_RECORD` carrying nested protocol records such as `nb.chat.message.v1`, `nb.identity.record.v1`, or `nb.identity.snapshot.v1`;
3. legacy compatibility event types such as `DECLARE_IDENTITY` and `CHAT_MESSAGE` remain readable but are not the preferred long-term path.

Future command families MAY introduce new nested protocols or new outer event families, provided they define:

1. replay/materialization rules;
2. validation rules;
3. compatibility/versioning behavior.

## 6. Projection Rule

Each subsystem defines a projection over the hub log.

Examples:

1. the file subsystem projects the current file map;
2. the chat subsystem projects readable message history;
3. the identity subsystem projects the latest known public identity material relevant to the hub.

Subsystems MUST ignore commands outside their own scope unless explicitly defined otherwise.

## 7. Relationship to Public Channels

The same append-only protocol model also applies to public-key-addressed channels such as an identity publication channel.

However:

1. user-facing product language SHOULD reserve `hub` for the main logical unit opened and used like a shared or local Nearbytes space;
2. a public identity channel follows the same log principles but is not necessarily presented as a hub in the UI.

## 8. Relationship to Other Specs

1. generic application-carried records are defined in `app-records-v1.md`;
2. file subsystem replay is defined in `file-events-v2.md` and `file-commands-v1.md`;
3. identity management semantics are defined in `identity-management-v1.md`;
4. identity publication is defined in `identity-channel-v1.md`, `identity-record-v1.md`, and `identity-snapshot-v1.md`;
5. chat payloads are defined in `chat-events-v1.md`.

## 9. Open-Ended Extension Rule

Nearbytes hubs are intentionally open-ended.

Therefore:

1. the existence of files and chat in a hub does not exhaust the model;
2. future subsystems MAY coexist in the same hub log without changing the fundamental hub abstraction;
3. a compliant hub reader MAY support only a subset of subsystems, provided unsupported commands fail closed or are ignored exactly as the relevant subsystem specs require.