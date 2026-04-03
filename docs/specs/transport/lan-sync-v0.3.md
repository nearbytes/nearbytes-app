# Nearbytes LAN Sync v0.3

Status: draft normative specification.

This document defines the Nearbytes zero-configuration local-network transport profile.

## 1. Scope

This specification defines:

1. LAN peer discovery using mDNS and DNS-SD;
2. LAN transport using QUIC over UDP;
3. peer identity binding independent of host and port;
4. automatic recovery and convergence using the Nearbytes observation log plus storage anti-entropy;
5. the relationship between the shared peer observation history and local per-provider queues.

This specification does not define:

1. relay transport;
2. browser-specific WebRTC carriage;
3. final trust UX for accepting peer identities;
4. provider-backed remote transports.

## 2. Required Standards Profile

Nearbytes LAN Sync v0.3 MUST use:

1. Multicast DNS as specified by RFC 6762 for link-local name and service discovery;
2. DNS-Based Service Discovery as specified by RFC 6763;
3. QUIC transport as specified by RFC 9000 and RFC 9001;
4. QUIC datagrams, when used, as specified by RFC 9221.

## 3. Design Goals

The transport profile MUST provide:

1. zero manual address and port entry;
2. automatic peer appearance on the local link;
3. identity-first routing, not address-first routing;
4. route migration without changing peer identity;
5. multiplexed control and object transfer without head-of-line blocking;
6. crash-safe recovery through persisted cursors and anti-entropy;
7. liveness even when a useful block is observed before the event that later references it.

## 4. Discovery Profile

Each Nearbytes peer MUST advertise exactly one DNS-SD service instance on each active local link.

Service type:

1. service name: `_nearbytes._udp.local`
2. DNS-SD type: `_nearbytes`
3. DNS-SD protocol: `_udp`

The service instance name SHOULD use a human-readable device label.

The service TXT record MUST remain compact. Implementations SHOULD keep the total TXT payload at or below 200 bytes.

## 4.1 TXT Record

The TXT record MUST contain:

1. `pv`: LAN protocol version string, currently `0.3`
2. `peer`: peer identity string
3. `alpn`: QUIC ALPN token, currently `nearbytes-lan/0.3`
4. `caps`: comma-separated capability labels

The TXT record SHOULD contain:

1. `head`: latest local observation-log head id known to the peer

Unknown TXT keys MUST be ignored.

## 5. Transport Profile

Discovery and data transport are separate:

1. discovery is mDNS/DNS-SD only;
2. data transport is QUIC only.

The QUIC listener port MUST be the service port published in DNS-SD.

The QUIC ALPN token for v0.3 is:

`nearbytes-lan/0.3`

Implementations MUST share one UDP socket for both incoming and outgoing QUIC traffic on a peer.

Rationale:

1. this preserves route continuity;
2. it supports NAT/firewall path reuse as well as the local environment permits;
3. it keeps peer identity stable across connection role changes.

## 6. Identity Model

Peer identity MUST be independent of IP address, hostname, and port.

Rules:

1. the peer identity string advertised in DNS-SD is the transport identity anchor;
2. DNS-SD service addresses are only route hints;
3. a route change MUST update reachability without changing peer identity;
4. application trust decisions MUST attach to peer identity, not route;
5. transport acceptance MAY be route-open, but trust and action MUST bind to accepted peer identities.

## 7. QUIC Session Layout

Each peer session MUST support at least:

1. one reliable control stream for hello, cursor sync, and sync hints;
2. reliable streams for event and block transfer;
3. optional QUIC datagrams for lossy sync hints or wake-up nudges.

The transport MUST NOT depend on QUIC datagrams for correctness.

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

Peers SHOULD support "after X, what else have you seen?" exchange, optionally filtered to a requested set of volumes.

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

The minimum sync loop is:

1. discover peer via DNS-SD;
2. open QUIC session using the advertised port and ALPN;
3. exchange peer identity and cursor state on the control stream;
4. pull unseen typed observations;
5. fetch missing events and blocks over QUIC streams;
6. validate and store them;
7. run inventory anti-entropy as recovery if cursors are missing or stale.

## 9. Unknown Volumes

Unknown volumes SHOULD be prefetched for liveness.

Rules:

1. prefetched data is stored in normal Nearbytes storage;
2. unknown volumes MAY remain hidden in ordinary UX until locally recognized;
3. the transport MUST still accept and retain their valid events and blocks.

## 10. Failure and Recovery

The transport MUST be self-healing.

Rules:

1. losing transport cursor state MUST degrade efficiency only, not correctness;
2. after cursor loss, a peer MUST recover through hello, checkpoint or head resynchronization, and storage anti-entropy;
3. stale discovery records or transient path failures MUST NOT mark a peer permanently failed;
4. peers MUST tolerate path changes and reconnect automatically.

## 11. Current Replacement Rule

Peer-HTTP transport is not the target LAN transport profile.

Rules:

1. HTTP/TCP LAN transfer is development scaffolding only;
2. it MUST NOT be treated as the final protocol shape;
3. QUIC plus DNS-SD is the normative v0.3 profile for Nearbytes LAN sync.
