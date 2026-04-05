# Nearbytes Hub Model v0.2

Status: draft normative specification.

Ordering status: non-final. This document still does not define the final replay-order layer.

This document defines the core Nearbytes application model after the switch to opaque event payloads. A hub remains one append-only authenticated log plus associated encrypted content, but event semantics are no longer visible in the outer event envelope.

## 1. Scope

This specification defines:

1. the shared hub model;
2. the relationship between outer event envelopes and encrypted inner commands;
3. the relationship between hubs, encrypted blocks, and subsystem projections.

This specification does not define:

1. the concrete schema of encrypted file/chat/identity/app payloads;
2. the final replay-order model;
3. network transport or discovery.

## 2. Core Model

Every hub consists of:

1. an append-only authenticated log of events;
2. encrypted content blocks addressed by hash;
3. one or more subsystem protocols that interpret decrypted event payloads.

Subsystems include:

1. file state;
2. chat history;
3. identity material;
4. future application protocols.

## 3. Event Model

An event is a storage-layer object with:

1. a visible envelope;
2. an opaque encrypted payload;
3. a channel-owner signature.

The visible envelope contains only:

1. event protocol version;
2. signer public key;
3. cleartext list of referenced block hashes;
4. ciphertext payload;
5. signature.

The visible envelope MUST NOT reveal application semantics such as command type, filenames, timestamps, nested protocol IDs, or chat/identity/app content.

## 4. Subsystem Model

Subsystem semantics live inside the encrypted payload.

Examples:

1. file create/delete/rename commands;
2. chat messages;
3. identity publications and snapshots;
4. future app records.

Subsystem projections are reconstructed by:

1. reading authenticated outer events;
2. decrypting inner payloads using the enclosing hub/channel secret material;
3. replaying the decrypted commands according to the subsystem specification.

## 5. Block Reference Rule

The outer event envelope MAY reveal referenced block hashes.

Interpretation:

1. these block references are storage/liveness dependencies;
2. they do not reveal the semantic meaning of the event beyond ciphertext dependency;
3. subsystems may interpret them differently after decryption.

## 6. Ordering Status

The final ordering layer is still unspecified.

Current implementations MAY continue using provisional timestamp-based replay conventions internally, but that behavior remains non-final.

## 7. Relationship to Other Specs

1. file-event inner payloads are defined in `application/file-events-v0.3.md`;
2. generic application payload carriage is defined in `application/app-records-v0.2.md`;
3. chat payload semantics are defined in `application/chat-events-v0.2.md`;
4. storage correctness is defined in `storage/data-correctness-v0.2.md`;
5. storage routing/retention is defined in `storage/meta-storage-v0.3.md`;
6. LAN synchronization is defined in `transport/lan-sync-v0.4.md`.
