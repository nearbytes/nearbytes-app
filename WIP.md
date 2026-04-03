# Next Iteration Prompt

Open this repo fresh and review the current opaque-event implementation and the active DNS-SD plus WebRTC LAN runtime with suspicion. Focus on protocol correctness, receiver-driven object transfer, storage integrity boundaries, event encryption assumptions, real multi-host discovery behavior on Windows and Linux, provider-queue persistence and replay semantics, and UI wording leaks. Prefer finding concrete races, stale assumptions, or transport mismatches over polishing prose. Keep working in small commits, and update the Diary and Implementation Notes sections of this file alongside the code.

# WIP

## Current Truth

- outer events are opaque signed envelopes
- semantic commands live inside ciphertext
- LAN discovery is DNS-SD first with multicast fallback
- LAN transport is WebRTC, not QUIC
- the backend on each machine is only that machine's local signaling or control surface
- events and blocks move only when the receiving peer explicitly requests them

## Locked Decisions

### Event envelope

Visible:
- protocol version
- full signing public key
- cleartext referenced block hashes
- ciphertext payload
- signature

Implicitly visible:
- channel id
- event hash
- event file size

Not visible:
- event type
- filenames
- timestamps
- wrapped keys
- chat bodies
- identity payloads
- app-record semantics
- any other semantic event meaning

### Event signing and versioning

- signature covers the whole visible envelope plus ciphertext
- event hash is derived from the signed envelope bytes, excluding only the signature field itself
- protocol version alone fixes the crypto and hash suite
- no backward compatibility is required

### Object identity and observations

- there is no naked shared hash namespace
- object identity is typed:
  - `(event, H)`
  - `(block, H)`
- the peer observation history is one per-peer ordered stream across both events and blocks
- the public cursor is hash-addressed, not numeric
- the provider queue is separate local runtime state, not shared truth

### LAN sync

- Local network is not a provider account
- discovery is mDNS plus DNS-SD first, with compact UDP multicast fallback
- transport is WebRTC data channels
- each machine runs its own backend; there is no central backend
- the backend is used only for local signaling and control, not for bulk peer transfer
- raw events and blocks are never blindly pushed
- peers advertise observations and hints; that is effectively the sender asking "do you want object X?"
- the receiver decides what it wants and requests only missing objects

### Unknown-volume liveness

- unknown volumes should be prefetched for liveness
- prefetched data goes into normal Nearbytes storage
- unknown volumes may remain hidden in normal UX until locally recognized

## Diary

- 2026-04-02: moved event semantics behind opaque encrypted payloads while keeping only the minimal visible storage envelope
- 2026-04-02: added persistent provider-queue observation storage with typed event and block observations and route acknowledgment state
- 2026-04-02: reworked LAN sync to pull observation pages first and use inventory anti-entropy as recovery
- 2026-04-03: re-read the conversation and confirmed the original QUIC implementation had drifted from the desired zero-config architecture in practice
- 2026-04-03: replaced the crashing native WebRTC experiment with a pure-TS `werift` transport implementation
- 2026-04-03: made DNS-SD service instance names collision-resistant by adding a short runtime suffix
- 2026-04-03: made WebRTC RPC channel shutdown graceful so response delivery is deterministic
- 2026-04-03: added a regression test proving receiver-driven transfer: already-present events and blocks are not re-requested
- 2026-04-03: updated the active LAN spec to WebRTC and wrote the receiver-driven transfer rule explicitly

## TODO

- [x] keep opaque event semantics in code and tests
- [x] keep typed provider-queue observations in persistent runtime state
- [x] keep LAN sync hash-addressed and receiver-driven
- [x] replace the active native QUIC transport path
- [x] make the active LAN transport WebRTC
- [x] keep LAN discovery DNS-SD first with multicast fallback
- [x] add transport tests for JSON RPC, bytes, and sync hints over the active transport
- [x] add a regression test that known objects are not re-fetched
- [ ] verify live multi-host behavior again on the real two-machine setup after the WebRTC switch
- [ ] review WIP2 and the remaining historical docs for any stale QUIC wording that could confuse later work

## Implementation Notes

- `src/integrations/webrtcDnsSdLanTransport.ts` is the active LAN transport implementation.
- It uses:
  - `bonjour-service` for DNS-SD
  - compact UDP multicast fallback for discovery resilience
  - `werift` for WebRTC peer connections and data channels
  - `POST /lan/transport/signal` only for signaling
- `src/integrations/localNetworkSync.ts` remains receiver-driven:
  - peers exchange hello and observation heads
  - the local side pulls observation pages
  - the local side requests only missing events and blocks
- `src/integrations/providerQueue.ts` remains the persisted local observation queue and route-state store.
