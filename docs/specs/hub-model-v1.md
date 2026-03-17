# Nearbytes Hub Model v1

Status: draft normative specification.

Ordering status: non-final. This document intentionally leaves the final log-order model unspecified for now. Current implementations commonly use monotonic timestamps as a temporary replay aid, but that behavior is provisional and expected to change when the full stack ordering model is specified.

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

## 4. Ordering Status

The final ordering model of a Nearbytes hub is not specified yet.

For now:

1. this document defines a hub as an append-only authenticated log, but does not yet define the exact full-stack rule by which that append order is recovered and replayed;
2. current implementations commonly use signer-supplied timestamps such as `ts`, `createdAt`, or `publishedAt`, often with a deterministic tie-breaker, as a temporary approximation;
3. this timestamp-based behavior is non-final and SHOULD be treated as an implementation convention rather than a settled architectural rule.

Future Nearbytes specs are expected to define a stronger ordering layer that explains how append order, replay order, and any tie-breaking or causality metadata relate.

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

Because the final ordering model is not yet specified, any subsystem projection that depends on ordering MUST state which temporary implementation rule it assumes today.

## 7. Stack Levels (Provisional)

The current Nearbytes stack can already be described in layers, even though some boundaries are still evolving.

1. product/vocabulary layer: user-facing concepts such as hub, identity, file, storage location, and share;
2. application semantics layer: commands and projections such as file operations, identity lifecycle, chat behavior, and future subsystems;
3. application record layer: protocol payloads such as `nb.chat.message.v1`, `nb.identity.record.v1`, `nb.identity.snapshot.v1`, and future `nb.*` records;
4. log/event envelope layer: outer events such as `CREATE_FILE`, `DELETE_FILE`, `RENAME_FILE`, `APP_RECORD`, and legacy compatibility events;
5. ordering/replay layer: the rule that turns a set of authenticated log entries into a deterministic replay sequence; this layer is non-final and still needs its own proper specification;
6. cryptographic layer: secret derivation, signatures, hashes, wrapped file keys, and canonical encoding rules;
7. blob/reference layer: encrypted blocks, manifests, recipient-bound references, source-bound references, and attachment descriptors;
8. storage/transport layer: channels, roots, providers, synchronization, and discovery/transport recipes.

This layering is descriptive, not yet a fully normative stack specification.

## 8. Relationship to Public Channels

The same append-only protocol model also applies to public-key-addressed channels such as an identity publication channel.

However:

1. user-facing product language SHOULD reserve `hub` for the main logical unit opened and used like a shared or local Nearbytes space;
2. a public identity channel follows the same log principles but is not necessarily presented as a hub in the UI.

## 9. Relationship to Other Specs

1. generic application-carried records are defined in `app-records-v1.md`;
2. file subsystem replay is defined in `file-events-v2.md` and `file-commands-v1.md`;
3. identity management semantics are defined in `identity-management-v1.md`;
4. identity publication is defined in `identity-channel-v1.md`, `identity-record-v1.md`, and `identity-snapshot-v1.md`;
5. chat payloads are defined in `chat-events-v1.md`.

## 10. Open-Ended Extension Rule

Nearbytes hubs are intentionally open-ended.

Therefore:

1. the existence of files and chat in a hub does not exhaust the model;
2. future subsystems MAY coexist in the same hub log without changing the fundamental hub abstraction;
3. a compliant hub reader MAY support only a subset of subsystems, provided unsupported commands fail closed or are ignored exactly as the relevant subsystem specs require.