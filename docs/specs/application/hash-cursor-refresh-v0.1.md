# Hash Cursor Refresh v0.1

This document defines the shared Nearbytes refresh cursor used by browser mirrors and compatible runtimes.

## Goals

1. refresh paths MUST fetch only data newer than an accepted cursor whenever the cursor remains valid;
2. the cursor MUST be opaque to the client and MAY be a content hash such as an event hash or block hash;
3. the server or runtime owns the local ordering behind that cursor;
4. cursor loss or rejection MUST degrade efficiency only, not correctness.

## Cursor Model

The canonical shared refresh cursor is an event-hash cursor.

- clients persist the last accepted event hash as their local refresh checkpoint;
- refresh requests send that hash back as `afterEventHash`;
- the server resolves that hash against its local ordered event log;
- if the hash is still known, the server returns only events that follow it in local order;
- if the hash is unknown, the server returns a full replay and marks the response as `reset: true`.

The same model applies to block-oriented refresh families when the payload family is block-native rather than event-native. In that case a block hash MAY serve as the opaque cursor, but the ordering contract remains server-owned.

## Response Contract

Cursor-driven refresh responses MUST include:

1. `requestedCursor`
2. `acceptedCursor`
3. `nextCursor`
4. `reset`
5. payload items newer than the accepted cursor

`acceptedCursor = null` means the caller MUST treat the payload as a full replay.

## Local Projection

Browser mirrors SHOULD materialize file, chat, identity, and timeline snapshots from the returned event delta instead of re-fetching whole projected inventories.

That means:

1. timeline snapshots append the returned events when the cursor is accepted;
2. file snapshots are updated by replaying only the returned file-affecting events against the existing local file snapshot;
3. chat and identity views are re-projected from the local timeline snapshot.

## Recovery

If a cursor is unknown, stale, or otherwise unusable:

1. the server returns a full replay;
2. the client replaces its local snapshot with the replayed state;
3. the client stores `nextCursor` as the new checkpoint.

This is the same efficiency-only fallback rule used elsewhere in Nearbytes transport recovery.
