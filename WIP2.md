# WIP2

## Correct Design From The Conversation

This file records the design that matches the actual decisions taken in the conversation.

## Final Decisions

### Storage and events

- semantic event content must be encrypted
- the visible event envelope is:
  - protocol version
  - full public key
  - cleartext referenced block hashes
  - ciphertext payload
  - signature
- protocol version alone fixes the crypto suite
- no backward compatibility is required

### Unified object model

- observations cover both events and blocks
- identity is typed:
  - `(event, H)`
  - `(block, H)`
- there is no naked shared hash namespace
- the shared observation history is one per-peer ordered stream
- cursors are hash-addressed, not numeric

### Provider queue

- a separate persistent per-provider queue is required
- it is local runtime state, not shared truth
- losing it must cost efficiency only, not correctness

### LAN design

- Local network is not a provider account
- discovery is DNS-SD over mDNS first
- compact UDP multicast fallback is allowed for resilience
- transport is WebRTC
- each machine has its own backend; that backend is only the local signaling and control surface
- trust binds to peer identity, not route

### Transfer rule

- senders may advertise observations, heads, hints, and inventories
- raw event or block payloads move only when the receiving peer explicitly asks for them
- if the receiver already has an object, it should skip fetching it

### Unknown volumes

- unknown volumes should still be prefetched for liveness
- prefetched data goes into normal Nearbytes storage
- unknown volumes may remain hidden in ordinary UX until locally recognized

## Active Spec Line

- `docs/specs/application/hub-model-v0.2.md`
- `docs/specs/application/file-events-v0.3.md`
- `docs/specs/application/file-commands-v0.2.md`
- `docs/specs/application/app-records-v0.2.md`
- `docs/specs/application/chat-events-v0.2.md`
- `docs/specs/identity/identity-management-v0.2.md`
- `docs/specs/storage/data-correctness-v0.2.md`
- `docs/specs/storage/meta-storage-v0.3.md`
- `docs/specs/transport/lan-sync-v0.3.md`

## Implementation Match

- opaque event envelopes: yes
- typed hash-addressed observations: yes
- persistent provider queue: yes
- Local network as transport-only UX: yes
- DNS-SD first with multicast fallback: yes
- active LAN transport is WebRTC: yes
- receiver-driven event and block transfer: yes

## Remaining Review Targets

- real two-machine behavior after the WebRTC switch
- any stale historical docs that still speak as if QUIC were active
- long-running reconnect behavior and identity persistence across restarts
