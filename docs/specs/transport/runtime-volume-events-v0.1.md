# Runtime Volume Events v0.1

This document defines the runtime-to-UI push stream for Nearbytes hub updates.

## Goals

1. the UI MUST receive provider-originated change notifications without polling;
2. the push path MUST be backend-language-neutral at the wire level;
3. filesystem, LAN, and MEGA producers MUST share one volume-scoped event envelope;
4. pushed events MAY carry cursor hints, but correctness MUST continue to rely on cursor-driven timeline refresh;
5. the stream MUST remain modular so additional providers can publish without changing the UI contract.

## Transport

The runtime exposes a Server-Sent Events stream per hub:

- endpoint: `GET /watch/volume-events`
- authentication: the same secret or bearer-token rules used by `GET /watch/volume`
- event names:
  - `volume-event-ready`
  - `volume-event`
  - `watch-error`
  - `watch-ended`
  - `heartbeat`

SSE is sufficient for the current design because this path is runtime-to-UI only.

## Ready Event

`volume-event-ready` payload:

```json
{
  "volumeId": "<normalized volume id>",
  "autoUpdate": true,
  "mode": "semantic",
  "protocol": "nb.volume.event.v0.1"
}
```

If the runtime cannot provide semantic push for the active hub, it MUST send `autoUpdate: false` and SHOULD end the stream.

## Event Envelope

`volume-event` payload:

```json
{
  "p": "nb.volume.event.v0.1",
  "volumeId": "<normalized volume id>",
  "sequence": 17,
  "producer": "mega",
  "kind": "timeline-advanced",
  "timestamp": 1760000000000,
  "paths": ["channels/<volumeId>/<eventHash>.bin"],
  "eventHashes": ["<event hash>"],
  "nextCursor": "<event hash>",
  "invalidate": {
    "files": true,
    "timeline": true,
    "chat": true
  }
}
```

Fields:

1. `p` identifies the envelope family and version.
2. `volumeId` is the normalized target hub id.
3. `sequence` is runtime-local ordering for a single process lifetime.
4. `producer` is one of:
   - `filesystem`
   - `lan`
   - `mega`
5. `kind` is one of:
   - `filesystem-change`
   - `timeline-advanced`
6. `paths` is optional and carries storage-relative path hints.
7. `eventHashes` is optional and carries newly visible event hashes when known.
8. `nextCursor` is optional and MAY hint the new timeline head.
9. `invalidate` declares which UI projections should refresh immediately.

## Producer Rules

Filesystem producer:

1. MUST publish immediately when the runtime detects a relevant watched-path change for the hub.
2. SHOULD use `kind: filesystem-change`.
3. SHOULD set `invalidate.timeline = true` only when a channel path changed.

LAN producer:

1. MUST publish immediately after importing a new event into local storage.
2. SHOULD include the imported event hash in `eventHashes`.
3. SHOULD use `kind: timeline-advanced`.

MEGA producer:

1. MUST publish immediately after applying or deleting a recipient mirror change that advances local hub state.
2. SHOULD include the resulting event hash in `eventHashes` when known.
3. SHOULD use `kind: timeline-advanced`.

## UI Consumption

The UI MUST treat pushed volume events as immediate refresh triggers, not as an authoritative state snapshot.

The normative refresh path is:

1. receive `volume-event`
2. read the current accepted event-hash cursor for that hub
3. call the timeline delta API with `afterEventHash`
4. project files, timeline, and chat from the returned delta

This keeps the wire contract language-neutral and prevents provider-specific payload leakage into the UI.

## Recovery

If the UI misses events, reconnects, or receives an unusable cursor hint:

1. it MUST continue from its last accepted local cursor if possible;
2. the delta endpoint MAY respond with `reset: true`;
3. the UI MUST replace its local mirror snapshot when reset is requested.

This follows the recovery model defined in `application/hash-cursor-refresh-v0.1.md`.