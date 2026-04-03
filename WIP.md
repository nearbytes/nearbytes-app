# Next Iteration Prompt

Open this repo fresh and review the current opaque-event refactor and the new DNS-SD plus QUIC LAN runtime with suspicion. Focus especially on protocol correctness, storage integrity boundaries, event encryption assumptions, real-network discovery behavior on Windows and mixed-interface machines, peer identity persistence versus transport certificate identity, provider-queue persistence or replay semantics, managed-share regressions, UI leaks of semantic event data, and test realism. Prefer finding concrete bugs, races, or transport mismatches over polishing prose. Keep working in small commits, and update the Diary and Implementation Notes sections of this file alongside the code. Treat this as one pass in a planned 3-4 iteration hardening cycle.

# WIP

## Goal

Nearbytes is moving to an opaque event model.

New rule:
- anything that reveals the semantic contents of an event must be encrypted

This is a clean break:
- no backward compatibility
- no migration support
- old local data may be wiped
- old specs can be superseded freely

## Locked Decisions

### Event envelope

Visible event envelope:
- protocol version
- full signing public key
- cleartext list of referenced block hashes
- ciphertext payload
- signature

Implicitly visible by storage nature:
- channel id
- event hash
- event file size

Not visible:
- event type
- file names
- timestamps
- wrapped keys
- nested protocol ids
- chat bodies
- identity records
- app-record semantics
- any other semantic payload content

### Event signing

- the event signature covers the whole visible envelope plus the ciphertext payload
- the event hash is computed from the same signed bytes, excluding only the signature field itself

### Crypto and versioning

- protocol version alone fixes the crypto or hash suite
- no separate cleartext crypto-suite marker is required

### Block references

- the cleartext block hash list is semantically unordered
- zero referenced blocks is allowed
- duplicates should not be emitted by the implementation
- block references mean "this event mentions these ciphertext blocks"
- the storage layer uses only this visible dependency list
- application semantics stay inside ciphertext
- the current protocol messages survive by moving into ciphertext, not by remaining visible as outer event types

### Namespace

There is no naked shared hash namespace.

Object identity is typed:
- `(event, H)`
- `(block, H)`

### LAN transport direction

- discovery is mDNS plus DNS-SD first, with compact UDP multicast fallback for resilience on hostile or flaky local networks
- LAN data transport is QUIC over UDP, not peer HTTP over TCP
- one shared UDP socket per peer is required for the transport
- peer identity stays independent of route, address, and port
- HTTP LAN routes are compatibility or debug scaffolding and must not define the long-term protocol
- transport acceptance is route-open, but trust and action must bind to accepted peer identities rather than IPs or ports

### Queue direction

- keep a separate persistent per-provider queue beside the future peer-log
- peer-log is shared sync or history
- per-provider queue is local delivery or work state for each integration

### Peer-log direction

- the sync history is per peer, not per volume
- it records one ordered stream of typed hash observations over unified storage
- both events and blocks participate in that same observation stream
- the observation stream is hash-addressed rather than numeric-sequence-addressed
- each observation entry should carry its own hash identity and a link to the previous observation entry
- typed identity avoids namespace clashes:
  - `(event, H)`
  - `(block, H)`
- peers must support "after X, what else have you seen?" exchange, optionally filtered to a set of volumes
- cursor state is disposable cache and must be recoverable through checkpoints or fresh anti-entropy

### Unknown-volume liveness

- unknown volumes should be mutually prefetched for liveness
- prefetched unknown data lives in normal Nearbytes storage
- unknown prefetched volumes may remain hidden in ordinary UX until locally recognized

### Compatibility

- no backward compatibility is required for this redesign
- superseded pre-opaque specs must not remain ambiguous or appear current

## Diary

- 2026-04-02: Opaque event-envelope refactor moved event semantics into encrypted payloads while keeping only the visible envelope at the storage layer.
- 2026-04-02: Added a persistent provider queue with typed `(event, hash)` / `(block, hash)` observations and route acknowledgment state.
- 2026-04-02: Reworked LAN sync to use queue-backed observation pulls first, with inventory reconciliation as recovery or fallback.
- 2026-04-03: Re-read the original user request and confirmed the multicast-plus-peer-HTTP LAN stack had drifted from the intended architecture.
- 2026-04-03: Standards review completed against RFC 6762, RFC 6763, RFC 9000, RFC 9001, and RFC 9221. The target LAN profile is DNS-SD over mDNS for discovery plus QUIC over UDP for transport.
- 2026-04-03: Added transport-profile code and tests that lock the DNS-SD TXT record shape and QUIC ALPN into the codebase.
- 2026-04-03: Replaced the live LAN runtime internals with a transport boundary and a default DNS-SD plus QUIC implementation. `LocalNetworkSyncService` now uses `LanPeerTransport`, and the default runtime transport is `QuicDnsSdLanTransport`.
- 2026-04-03: Added a real QUIC integration test that exercises JSON RPC, byte transfer, and sync-hint delivery over QUIC streams.
- 2026-04-03: Found and fixed a LAN runtime-state collision for custom storage roots. Provider-queue and cursor state had been sharing one global runtime folder, which leaked observations across independent instances and caused bogus missing-block sync errors.
- 2026-04-03: Reconciled the conversation against the specs and found that the provider queue and LAN cursor layer were still numeric-sequence based even though the agreed design had moved to hash-addressed peer observations.
- 2026-04-03: Reworked the provider queue, LAN transport profile, LAN sync service, HTTP debug routes, and tests to use hash-addressed observation entries with `observationId` and `prevObservationId` instead of public numeric sequence cursors.
- 2026-04-03: Verification is green at this checkpoint: `yarn test`, `yarn type-check`, `yarn build`, `yarn build:electron`, and `yarn --cwd ui build`.

## TODO

- [x] add a dedicated persistent provider queue store and types
- [x] add queue tests for persistence, dedupe, ordering, and acknowledgment behavior
- [x] produce typed storage observations `(event, H)` / `(block, H)` from the local storage model
- [x] expose LAN peer-log style APIs based on typed observations instead of only volume inventory polling
- [x] refactor `LocalNetworkSyncService` to synchronize via observation cursors plus object fetches
- [x] persist per-peer LAN cursor or progress separately from storage truth
- [x] wire LAN sync imports through the new queue or observation model
- [x] add integration tests for LAN queue or cursor sync and recovery
- [x] replace ad hoc multicast JSON discovery with DNS-SD service advertisement and browsing
- [x] replace peer-HTTP LAN transport with QUIC streams on a shared UDP socket
- [x] add end-to-end QUIC transport tests for cursor exchange and object transfer
- [x] replace public numeric observation cursors with hash-addressed observation ids and previous-entry links
- [x] verify desktop packaging and runtime behavior for the new QUIC and DNS-SD dependencies
- [x] rerun all tests and builds and keep this TODO list updated until empty

## Implementation Notes

Implementation notes must be kept in this same file while the work is in progress.

Rule:
- keep durable protocol or product decisions in the earlier sections
- keep temporary execution notes, discoveries, partial progress, and blockers in this section
- update this section alongside the implementation as work advances

### Completed so far

- Introduced the visible event envelope shape in code:
  - version
  - full public key
  - cleartext referenced block hashes
  - ciphertext payload
  - signature
- Updated event hashing and signing to cover the visible envelope plus ciphertext.
- Moved semantic payload handling behind explicit decrypt or hydrate steps in domain code.
- Storage integrity now validates only the outer envelope and channel or public-key match.
- Multi-root block dependency traversal now uses visible `blockRefs` instead of plaintext file-event metadata.
- UI event details were partially updated to show the visible envelope and optional decrypted payload separately.
- Local-network UI no longer routes its basic actions through provider-account connect or disconnect paths.
- `src/integrations/localNetworkSync.ts` now consumes a transport interface instead of hard-coding multicast plus fetch.
- `src/integrations/quicDnsSdLanTransport.ts` now provides the default LAN runtime using:
  - `bonjour-service` for DNS-SD advertisement and browsing
  - `@matrixai/quic` for QUIC sockets, server, client, and streams
  - a persisted self-signed runtime certificate and key pair
- `src/integrations/__tests__/localNetworkSync.test.ts` now drives the service through a fake `LanPeerTransport` instead of fetch stubs.
- `src/integrations/__tests__/quicDnsSdLanTransport.test.ts` now exercises real QUIC request or response flow over local UDP sockets.
- Runtime state for custom storage roots is now isolated under a per-storage-home namespace below the default runtime home, preventing provider-queue leakage across separate instances.
- The full verification suite currently passes:
  - `yarn test`
  - `yarn type-check`
  - `yarn build`
  - `yarn build:electron`
  - `yarn --cwd ui build`

### Still in progress

- UI cleanup:
  - continue reviewing event-detail rendering for any stale assumptions about plaintext payloads
  - remove any remaining legacy wording that implies event semantics are storage-visible
- Protocol breadth:
  - chat, identity, file, and app-record surfaces still deserve another hardening review pass for full alignment with the new specs
  - LAN should eventually bind peer identity to the real Nearbytes signing identity rather than only the runtime transport identity
- Noise cleanup:
  - some managed-share tests still log expected fake-adapter warnings such as `Mirror inventory is not implemented by this fake adapter`; the suite passes, but the logs are noisier than ideal

### Immediate next implementation steps

- do a targeted UI review of event-detail and timeline rendering for any remaining assumptions that `event.payload` is always directly available
- review identity, app-record, file, and chat protocol surfaces against the v0.x specs and remove transitional wording or types where possible
- review the QUIC transport against real multi-host and multi-interface behavior, especially discovery freshness, timeout or backoff policy, and certificate or peer-id persistence semantics
- keep this file and `WIP2.md` synchronized with any newly confirmed design decisions while implementation is still moving

## Current Blast Radius

Main code areas touched by the opaque-event and LAN transport work:
- `src/types/events.ts`
- `src/storage/serialization.ts`
- `src/storage/integrity.ts`
- `src/storage/channel.ts`
- `src/storage/multiRoot.ts`
- `src/domain/eventEnvelope.ts`
- `src/domain/fileService.ts`
- `src/domain/volume.ts`
- `src/domain/chatService.ts`
- `src/integrations/providerQueue.ts`
- `src/integrations/localNetworkSync.ts`
- `src/integrations/lanPeerTransport.ts`
- `src/integrations/quicDnsSdLanTransport.ts`
- `src/integrations/lanTransportProfile.ts`
- `src/server/routes.ts`
- `src/server/runtime.ts`
- `ui/src/lib/api.ts`
- `ui/src/components/StoragePanel.svelte`

## Whitepaper Note

The original whitepaper photo example is less strict than the new design.

In that example:
- ciphertext block contents are encrypted
- wrapped content keys are encrypted
- block hashes are visible
- event structure remains partly visible

This branch is intentionally moving to a stricter design than the original whitepaper example.
