# Nearbytes LAN Sync v1

Superseded note:

1. this document records the provisional multicast plus peer-HTTP design line;
2. it is retained only as a historical snapshot;
3. the current unreleased design line is `transport/lan-sync-v0.4.md`.

Status: draft normative specification.

This document defines the first Nearbytes local-network sync protocol.

Its purpose is to let Nearbytes desktop peers on the same LAN discover each other automatically, exchange Nearbytes storage data optimistically, and recover any missed data later without manual IP or port entry.

This v1 protocol is intentionally simple:

1. transport reachability matters more than perfect delivery;
2. unknown or dropped packets MAY be ignored and recovered later by anti-entropy;
3. trust is transport-open in v1, while packet signing and accepted peer identities are reserved for a compatible future version.

## 1. Scope

This specification defines:

1. LAN peer discovery;
2. peer session establishment;
3. route-independent peer identification placeholders;
4. optimistic event and block synchronization;
5. automatic mapping of LAN peers into Nearbytes storage locations.

This specification does not define:

1. mandatory packet signatures;
2. internet relay routing;
3. browser-only transports;
4. user-facing trust approval UX.

## 2. Design Goals

Nearbytes LAN sync v1 MUST optimize for:

1. zero manual network configuration;
2. automatic bidirectional sync between peers on the same local network;
3. identity above route, even before signatures are enforced;
4. eventual convergence through repeated reconciliation;
5. easy implementation on desktop now and smartphones later.

## 3. Model

Each peer exposes a LAN sync service that speaks Nearbytes sync messages over a local transport.

Each peer also advertises itself on the LAN so other Nearbytes peers can find it automatically.

The sync model is anti-entropy, not reliable packet history.

Interpretation:

1. a peer MAY miss announcements, deltas, or transient packets;
2. a later inventory exchange MUST be sufficient to recover missing events and blocks;
3. correctness depends on repeated reconciliation against hashes, not on guaranteed delivery of every packet.

## 4. Transport Profile

Nearbytes LAN sync v1 defines one required profile:

1. discovery over UDP multicast on the local subnet;
2. session transport over HTTP on the local subnet.

Rationale:

1. UDP multicast is easy to implement on desktop and mobile platforms;
2. HTTP is already natural for Nearbytes desktop runtime integration;
3. the message model can later be carried over updated peer transports or relay transport without redefining sync semantics.

Future Nearbytes versions MAY define additional transport profiles that carry the same sync messages.

## 5. Peer Identity

Each peer instance MUST expose:

1. a `peerId`;
2. an instance label;
3. one or more reachable routes;
4. a capabilities list.

In v1:

1. `peerId` MAY be a randomly generated stable local identifier persisted by the app;
2. peers MUST treat `peerId` as the route-independent identifier for session tracking;
3. peers MUST NOT treat IP address or port as stable identity.

Forward-compatibility rule:

1. future versions MAY redefine `peerId` as a public-key-derived identifier;
2. future signed packets MUST preserve the same identity-above-route model.

## 6. Discovery

Each peer MUST periodically send a LAN announcement datagram to the Nearbytes multicast group.

Each announcement MUST include:

1. protocol family: `nearbytes.lan-sync.v1`;
2. `peerId`;
3. instance label;
4. TCP listening port for the HTTP sync endpoint;
5. capabilities;
6. current timestamp;
7. a monotonic announcement counter.

Peers SHOULD:

1. broadcast immediately at startup;
2. rebroadcast on a short interval while running;
3. expire peers that have not announced within the freshness window.

Peers MUST accept announcements from any route on the local subnet.

## 7. Session Endpoints

Each peer MUST expose an HTTP service with endpoints equivalent to:

1. `GET /lan/hello`
2. `GET /lan/peers/self`
3. `GET /lan/volumes`
4. `GET /lan/volumes/:volumeId/inventory`
5. `GET /lan/volumes/:volumeId/events/:eventHash`
6. `GET /lan/blocks/:blockHash`
7. `POST /lan/sync`

Endpoint naming MAY vary in code as long as semantics stay equivalent.

## 8. Hello Exchange

After discovery, a peer SHOULD call the remote hello endpoint.

The hello response MUST include:

1. `peerId`;
2. protocol version;
3. capabilities;
4. reachable route summary;
5. a summary of volumes currently known by the peer.

Hello is advisory.

If hello fails, the peer MAY retry later when discovery announces the peer again.

## 9. Volume Inventory

For each known volume, a peer MUST be able to expose an inventory summary containing at least:

1. `volumeId`;
2. observed channel identifiers;
3. event hashes known per channel;
4. block hashes referenced by those events or already present locally;
5. inventory timestamp.

Peers MAY use compact summaries later, but v1 MAY send plain arrays of hashes.

## 10. Sync Algorithm

The required sync behavior is anti-entropy pull/push.

For each peer pair and known volume:

1. compare inventory summaries;
2. determine missing event hashes;
3. fetch missing events;
4. validate event bytes using existing Nearbytes integrity rules;
5. derive referenced block hashes;
6. fetch missing blocks;
7. validate block bytes using existing Nearbytes integrity rules;
8. write recovered data into the local Nearbytes storage graph;
9. schedule another reconcile pass if new data arrived.

Peers MAY also send eager delta hints, but inventories remain authoritative.

## 11. Delivery Semantics

Nearbytes LAN sync v1 is intentionally tolerant of packet loss and unknown messages.

Rules:

1. a peer MAY ignore an unrecognized packet, message, or field;
2. a peer MAY drop a transient delta if later anti-entropy can recover it;
3. a peer MUST fail closed for malformed event or block payload bytes;
4. a peer MUST continue syncing other volumes and peers after one message failure.

## 12. Automatic Source Integration

LAN sync is surfaced as a storage provider named `Local network`.

Each discovered peer MUST be represented as an automatically managed storage source in the Nearbytes storage model.

That source conceptually represents:

1. the remote peer;
2. the remote peer's advertised volume and block inventory;
3. the ability to read missing Nearbytes data from that peer and replicate local data to it.

The source path is implementation-defined in v1.

The app MAY materialize LAN peer state in a local cache directory while still presenting it as a `Local network` provider.

## 13. Default User Experience

Nearbytes desktop SHOULD behave as follows:

1. enable LAN discovery automatically;
2. show discovered peers under the `Local network` provider tab;
3. automatically sync known volumes bidirectionally with discovered writable peers;
4. reconcile periodically even when no new announcements arrive;
5. recover after sleep, restart, or temporary network loss without manual action.

## 14. Security Posture For v1

LAN sync v1 is transport-open by default.

Interpretation:

1. the app MAY accept discovery and sync requests from any LAN peer;
2. content correctness is still protected by Nearbytes event and block validation;
3. peer authenticity is not fully solved in v1.

This is acceptable only as a transitional profile.

Implementations MUST reserve protocol fields for:

1. packet signature metadata;
2. accepted identity lists;
3. route-independent public-key identity binding;
4. replay protection.

## 15. Future Compatibility

Future versions SHOULD add:

1. signed discovery announcements;
2. signed sync messages;
3. accepted-peer trust policy;
4. relay-capable routes;
5. additional transport profiles beyond the active WebRTC LAN carriage;
6. mobile background-sync constraints;
7. compact inventories such as Bloom-filter or set-reconciliation summaries.

The sync semantics in this document are designed so those additions do not require changing the fundamental Nearbytes storage model.
