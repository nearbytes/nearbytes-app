# Nearbytes LAN Sync v0.3

Status: draft normative specification.

This document defines the active Nearbytes zero-configuration local-network transport profile.

## 1. Scope

This specification defines:

1. LAN peer discovery using mDNS and DNS-SD, with optional link-local multicast fallback;
2. LAN transport using WebRTC data channels;
3. peer identity binding independent of host and port;
4. automatic recovery and convergence using the Nearbytes observation log plus storage anti-entropy;
5. the relationship between the shared peer observation history and local per-provider queues.

This specification does not define:

1. relay transport;
2. browser-only carriage;
3. final trust UX for accepting peer identities;
4. provider-backed remote transports.

## 2. Required Standards Profile

Nearbytes LAN Sync v0.3 MUST use:

1. Multicast DNS as specified by RFC 6762 for link-local name and service discovery;
2. DNS-Based Service Discovery as specified by RFC 6763;
3. WebRTC peer connections and data channels;
4. ICE candidate exchange for route establishment.

Implementations MAY additionally use a compact Nearbytes-specific UDP multicast discovery fallback on the local link when DNS-SD is unavailable, filtered, or unreliable on the host environment.

## 3. Design Goals

The transport profile MUST provide:

1. zero manual address and port entry;
2. automatic peer appearance on the local link;
3. identity-first routing, not address-first routing;
4. route change tolerance without changing peer identity;
5. multiplexed control and object transfer without blind whole-volume pushing;
6. crash-safe recovery through persisted cursors and anti-entropy;
7. liveness even when a useful block is observed before the event that later references it.

## 4. Discovery Profile

Each Nearbytes peer MUST advertise exactly one DNS-SD service instance on each active local link.

Service type:

1. service name: `_nearbytes._udp.local`
2. DNS-SD type: `_nearbytes`
3. DNS-SD protocol: `_udp`

The service instance name SHOULD remain human-readable, but it MAY include a short runtime-unique suffix to avoid collisions between overlapping app instances on the same network.

The service TXT record MUST remain compact. Implementations SHOULD keep the total TXT payload at or below 200 bytes.

## 4.1 TXT Record

The TXT record MUST contain:

1. `pv`: LAN protocol version string, currently `0.3`
2. `peer`: peer identity string
3. `alpn`: transport profile token, currently `nearbytes-lan/0.3`
4. `caps`: comma-separated capability labels

The TXT record SHOULD contain:

1. `head`: latest local observation-log head id known to the peer

Unknown TXT keys MUST be ignored.

## 4.2 Discovery Fallback

DNS-SD is the normative primary discovery mechanism.

Implementations MAY also send and accept compact Nearbytes multicast discovery advertisements on the local link as a resilience fallback.

Fallback rules:

1. fallback discovery MUST NOT replace the DNS-SD advertisement model;
2. fallback discovery MUST carry the same peer identity, transport port, protocol version, transport profile token, and observation-head hints as the DNS-SD record, within normal size constraints;
3. fallback discovery MUST be treated as a route hint only, not as a trust signal;
4. when both DNS-SD and fallback discovery are available, implementations SHOULD prefer the DNS-SD record and use fallback only to improve liveness on networks or hosts where DNS-SD visibility is degraded.

## 5. Transport Profile

Discovery and data transport are separate:

1. discovery is mDNS/DNS-SD first, with optional multicast fallback for resilience;
2. data transport is WebRTC.

The service port published in discovery MUST identify the peer backend that handles signaling for WebRTC session establishment.

The transport profile token for v0.3 is:

`nearbytes-lan/0.3`

The peer backend is not a central server. Each machine runs its own Nearbytes backend, and that backend is used only as the peer's local signaling or control surface.

## 6. Session Layout

Each peer session MUST support at least:

1. one reliable control data channel for hello, cursor sync, and sync hints;
2. reliable data channels for event and block transfer;
3. dynamic per-request channels or an equivalent multiplexing model for concurrent object fetches.

The transport MUST NOT depend on unreliable delivery for correctness.

## 7. Identity Model

Peer identity MUST be independent of IP address, hostname, and port.

Rules:

1. the peer identity string advertised in discovery is the transport identity anchor;
2. discovery addresses are only route hints;
3. a route change MUST update reachability without changing peer identity;
4. application trust decisions MUST attach to peer identity, not route;
5. transport acceptance MAY be route-open, but trust and action MUST bind to accepted peer identities.

## 8. Object and Sync Model

LAN sync remains a transport for the existing Nearbytes storage model.

The authoritative data model is still:

1. opaque signed events;
2. ciphertext blocks;
3. typed observation-log entries over `(event, hash)` and `(block, hash)`.

The peer observation history is:

1. per peer, not per volume;
2. one ordered stream across both event and block observations;
3. hash-addressed rather than numeric-sequence-addressed;
4. a synchronization and liveness layer, not storage truth.

Each observation entry SHOULD include at least:

1. its own observation id;
2. the previous observation id, if any;
3. typed object identity, that is `(event, hash)` or `(block, hash)`;
4. observed-at metadata or equivalent local ordering metadata.

Implementations SHOULD also maintain a separate persistent per-provider or per-transport queue for local delivery work.

Queue rules:

1. queue items SHOULD reference typed object ids such as `(event, H)` or `(block, H)`;
2. the provider queue is local runtime state, not the shared peer history;
3. losing queue or cursor state MUST cost efficiency, not correctness.

## 9. Receiver-Driven Transfer Rule

Event and block bytes MUST be transferred only when the receiving peer explicitly requests them.

Rules:

1. a sender MUST NOT blindly push raw event or block payloads to another peer;
2. a sender MAY advertise observations, heads, hints, or inventories;
3. advertising an observation or inventory entry is the protocol-level equivalent of asking the receiver whether it wants object `X`;
4. the receiver decides whether it wants a given event or block;
5. if the receiver already has the object, it SHOULD skip fetching it;
6. this rule applies equally to known and unknown volumes.

The minimum sync loop is:

1. discover peer via DNS-SD;
2. establish a WebRTC session through peer-to-peer signaling;
3. exchange peer identity and cursor state on the control channel;
4. pull unseen typed observations;
5. determine which events and blocks are actually wanted locally;
6. request only the missing events and blocks;
7. validate and store them;
8. run inventory anti-entropy as recovery if cursors are missing or stale.

## 10. Unknown Volumes

Unknown volumes SHOULD be prefetched for liveness.

Rules:

1. prefetched data is stored in normal Nearbytes storage;
2. unknown volumes MAY remain hidden in ordinary UX until locally recognized;
3. the transport MUST still accept and retain their valid events and blocks.

## 11. Failure and Recovery

The transport MUST be self-healing.

Rules:

1. losing transport cursor state MUST degrade efficiency only, not correctness;
2. after cursor loss, a peer MUST recover through hello, head resynchronization, and storage anti-entropy;
3. stale discovery records or transient path failures MUST NOT mark a peer permanently failed;
4. peers MUST tolerate path changes and reconnect automatically;
5. peers that disappear from discovery SHOULD degrade to stale or offline status rather than preserving a hard error indefinitely.

## 12. Current Replacement Rule

Peer-HTTP transport is not the target LAN transport profile.

Rules:

1. HTTP/TCP LAN transfer is development scaffolding only;
2. it MUST NOT be treated as the final protocol shape;
3. WebRTC plus DNS-SD is the normative v0.3 profile for Nearbytes LAN sync;
4. multicast discovery fallback is permitted as an implementation hardening measure, but it does not replace the normative WebRTC plus DNS-SD profile.
