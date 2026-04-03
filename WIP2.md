# WIP2

## Correct Design, Reconstructed From The Conversation

This file records the design we should have had if we had followed the conversation strictly from the start.

It is the authoritative handoff note for reconciliation between:
- the conversation
- `WIP.md`
- `docs/specs`
- the implementation

## 1. Conversation Decisions

### 1.1 Local-network transport

Locked outcome:
- zero-config LAN discovery is mDNS plus DNS-SD
- LAN transport is QUIC over UDP
- peer identity is independent of host, route, address, and port
- no manual IP or port entry is part of the intended product

Refinement from implementation hardening:
- DNS-SD is the normative primary discovery path
- compact UDP multicast fallback is acceptable as a resilience mechanism on local networks where DNS-SD visibility is unreliable
- fallback discovery is a route hint only and does not change identity or trust semantics

Interpretation:
- transport connections may arrive from any route
- parsing may be open to anyone
- trust and action must bind to accepted identities, not to routes

### 1.2 Sync model

Locked outcome:
- dropped or previously unknown packets are acceptable
- correctness must be recovered later through reconciliation
- the sync history is one per-peer global observation stream across all volumes
- that stream includes both events and blocks
- that stream is hash-addressed rather than numeric-sequence-addressed
- each observation entry links to the previous observation entry

Typed object identity:
- `(event, H)`
- `(block, H)`

Reason:
- there is no safe naked shared hash namespace between event files and block files

### 1.3 Query shape

Locked outcome:
- peers need "after X, what else have you seen?" exchange
- queries may optionally be filtered to a set of volumes
- the observation history is per peer, not per volume
- the external cursor should be an observation hash or head reference, not a numeric counter

### 1.4 Cursor and recovery

Locked outcome:
- cursor or sequence state belongs in separate LAN runtime state, not in storage roots
- cursor state is disposable cache
- losing it must cost efficiency, not correctness
- recovery happens through checkpoint or head resync plus storage anti-entropy

### 1.5 Unknown-volume liveness

Locked outcome:
- unknown volumes should still be prefetched
- that prefetch is important for liveness
- prefetched data goes into normal Nearbytes storage
- ordinary UI may still hide unknown prefetched volumes until locally recognized

### 1.6 Event envelope

Locked outcome:
- anything revealing semantic contents of an event must be encrypted
- channel id and event hash are naturally visible
- the visible outer event envelope is only:
  - protocol version
  - full public key
  - cleartext list of referenced block hashes
  - ciphertext payload
  - signature

Further locked details:
- protocol version alone fixes crypto and hash suite
- block hash list is semantically unordered
- zero blocks is valid
- signature covers the whole visible envelope plus ciphertext
- no backward compatibility is required

### 1.7 Application protocols

Locked outcome:
- current protocol messages survive by moving into ciphertext
- file commands such as `CREATE_FILE`, `DELETE_FILE`, and `RENAME_FILE` are inner commands
- generic application records are inner commands
- chat and identity material are inner payloads
- outer event meaning is not storage-visible

### 1.8 Block linkage

Locked outcome:
- cleartext outer block references are the storage-visible link between an event and the ciphertext blocks it carries along or depends on
- storage and transport must work without decryption
- application-level semantics may impose their own ordering or canonicalization, but that is not a storage-layer concern

### 1.9 Provider queue

Locked outcome:
- there must be a separate persistent per-provider queue
- it is distinct from the shared peer-log or peer observation history
- queue items should reference typed object ids and provider-routing context

### 1.10 Local-network UX

Locked outcome:
- `Local network` is not a provider account
- it must not use generic provider connect or disconnect flows
- LAN service and peer errors stay scoped to LAN transport UI

## 2. Active Design Line

The current intended active design line is:
- `application/hub-model-v0.2.md`
- `application/file-events-v0.3.md`
- `application/app-records-v0.2.md`
- `application/chat-events-v0.2.md`
- `storage/data-correctness-v0.2.md`
- `storage/meta-storage-v0.3.md`
- `transport/lan-sync-v0.3.md`

Supporting command and identity docs should follow the same line.

## 3. Design Corrections Required Of The Specs

The specs must satisfy all of the following at once:

1. pre-opaque docs must not remain ambiguously current
2. command and identity docs must refer to opaque outer events and inner commands
3. LAN sync must say both:
   - transport profile is DNS-SD plus QUIC
   - sync model is per-peer typed hash observations with a separate provider queue
4. registry and mapping docs must point to the active pre-1.0 line

## 4. Design Corrections Required Of The Implementation

The code must satisfy all of the following:

1. outer event handling must not depend on semantic plaintext fields
2. storage block attribution must use visible `blockRefs`
3. LAN sync must use the typed observation model and provider queue
4. LAN transport must be DNS-SD plus QUIC rather than peer HTTP
5. Local network UI must behave as a transport tab, not as a provider account

## 5. Reconciliation Checklist

- [x] `WIP.md` matches this file
- [x] registry points only to the active design line
- [x] command docs reflect inner encrypted commands
- [x] identity docs reflect opaque outer events
- [x] LAN spec includes both transport profile and typed observation/provider-queue model
- [x] superseded docs are clearly marked as historical and non-current
- [x] implementation matches the active design line for the decisions covered in this conversation, including DNS-SD-first discovery with multicast fallback
- [x] tests cover the decisions above
