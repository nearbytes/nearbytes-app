# Nearbytes LAN Sync v0.2

Status: draft normative specification.

This document defines the Nearbytes local-network sync protocol for the opaque-event model.

## 1. Scope

This specification defines:

1. LAN peer discovery;
2. a per-peer hash-observation sync model;
3. event and block synchronization using opaque events and cleartext block references;
4. Local network transport UX expectations.

This specification does not define:

1. mandatory packet signatures yet;
2. final relay or peer-transport profiles;
3. final trust UX.

## 2. Design Goals

LAN sync v0.2 MUST optimize for:

1. zero manual network configuration;
2. automatic bidirectional sync;
3. liveness even when referencing events arrive later than blocks;
4. recovery from dropped packets through later reconciliation;
5. future route-independent identity and packet signing.

## 3. Peer-Log Model

Each peer maintains one ordered per-peer log of hash observations across its unified storage model.

The peer-log records observations of:

1. events;
2. blocks.

Object identity is typed:

1. `(event, H)`
2. `(block, H)`

The peer-log is not storage truth. It is a synchronization/liveness layer over Nearbytes storage.

## 4. Opaque Event Rule

LAN sync MUST treat events as opaque authenticated envelopes.

Interpretation:

1. peers may inspect the visible event envelope;
2. peers may inspect the cleartext `blockRefs` list;
3. peers MUST NOT require decrypted semantic event fields for transport-level synchronization.

## 5. Sync Algorithm

The minimum anti-entropy behavior is:

1. discover peers on the LAN;
2. exchange peer identity and peer-log progress;
3. fetch unseen typed hash observations;
4. fetch unseen opaque events and blocks;
5. validate event envelopes and block bytes;
6. use visible event `blockRefs` to discover required ciphertext blocks;
7. continue reconciling until convergence.

## 5.1 Provider Queue

Implementations SHOULD maintain a persistent per-provider or per-transport queue for local delivery work.

Purpose:

1. persist outbound work while a peer or provider is unavailable;
2. decouple local storage observation from immediate transport success;
3. resume delivery without requiring a full storage rescan first.

Queue items SHOULD reference typed object ids such as:

1. `(event, H)`
2. `(block, H)`

plus any provider-specific routing context needed by that integration.

This queue is not the peer-log:

1. the peer-log is the shared synchronization/history model;
2. the provider queue is a local runtime work queue.

## 6. Unknown Volumes

Unknown volumes SHOULD be prefetched for liveness.

Rules:

1. prefetched events and blocks are stored in normal Nearbytes storage;
2. unknown volumes may remain hidden in ordinary UI until locally adopted or recognized;
3. sync transport MUST still be willing to move their data.

## 7. Local Network UX

`Local network` is a transport tab, not a provider account.

Therefore:

1. it MUST NOT use generic provider-account connect/disconnect flows;
2. peer/service errors SHOULD remain scoped to Local network transport UI;
3. discovered peers SHOULD be shown as transport peers, not provider accounts.

Deprecated note:

1. v0.2 allowed provisional peer-HTTP transport scaffolding during development;
2. v0.3 replaces that with a normative DNS-SD plus WebRTC transport profile.
