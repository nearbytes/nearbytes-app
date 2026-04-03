# Nearbytes Storage Commands v0.1

Status: draft normative specification.

This document defines the steady-state Nearbytes LAN storage-command message family carried over the long-lived peer transport control channel.

## 1. Scope

This specification defines:

1. typed storage-command messages for newly observed events and blocks;
2. receiver-driven handling of those messages;
3. the relationship between storage commands and fallback observation-log replay.

This specification does not define:

1. discovery;
2. session establishment;
3. raw event or block byte formats;
4. anti-entropy recovery after missed commands.

## 2. Design Rule

Storage commands are the hot-path Nearbytes LAN delivery mechanism.

Rules:

1. when a peer newly observes a block or signed event, it SHOULD send a storage command immediately over the already-open control channel;
2. the receiver decides whether it wants the referenced object;
3. raw object bytes move only after the receiver decides they are missing;
4. observation-log replay and inventory anti-entropy remain mandatory fallback and recovery paths.

## 3. Command Types

The active storage-command family contains two command types:

1. `want-event`
2. `want-block`

These names are descriptive. Implementations MAY use different wire-level field names as long as the semantics are preserved.

## 4. Event Command

An event command identifies one opaque signed event.

Required fields:

1. sender peer identity
2. command type `want-event`
3. volume id
4. event hash

Optional fields:

1. observation id
2. previous observation id

Semantics:

1. the sender is asking the receiver whether it wants event `eventHash` in volume `volumeId`;
2. the receiver SHOULD skip the command if it already has that event;
3. otherwise the receiver SHOULD fetch the exact event bytes from the sender, validate them, and store them;
4. after storing the event, the receiver SHOULD inspect the event envelope block-reference list and fetch any missing referenced blocks.

## 5. Block Command

A block command identifies one ciphertext block.

Required fields:

1. sender peer identity
2. command type `want-block`
3. block hash

Optional fields:

1. observation id
2. previous observation id

Semantics:

1. the sender is asking the receiver whether it wants block `blockHash`;
2. the receiver SHOULD skip the command if it already has that block;
3. otherwise the receiver SHOULD fetch the exact block bytes from the sender, validate them, and store them.

## 6. Receiver-Driven Rule

Storage commands MUST remain receiver-driven.

Rules:

1. a storage command is an offer or hint, not a blind payload push;
2. the sender MUST NOT attach raw event or block bytes to the command itself;
3. the receiver MUST verify local presence before fetching;
4. the receiver MUST validate fetched bytes before storage;
5. duplicate commands MUST be harmless.

## 7. Relationship To Observation Logs

Storage commands do not replace the per-peer observation history.

Rules:

1. observation logs remain the durable replay and cursor layer;
2. storage commands are the low-latency hot path for already-connected peers;
3. if storage commands are missed, peers MUST recover through observation-log replay and anti-entropy;
4. observation ids carried in storage commands are hints only unless a stricter replay rule is defined later.
