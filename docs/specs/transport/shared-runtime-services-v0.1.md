# Nearbytes Shared Runtime Services v0.1

Status: draft normative specification.

This document defines the host-neutral runtime service bundle used by shared Nearbytes transport and provider libraries.

Its purpose is to let shared TypeScript runtime logic reuse one explicit service boundary across desktop, web-backed compatibility hosts, and embedded phone hosts.

## 1. Scope

This specification defines:

1. the shared runtime service families required by transport and provider libraries;
2. explicit unsupported-capability behavior;
3. non-regression rules for adopting these services under existing LAN and runtime-to-UI flows.

This specification does not define:

1. the LAN wire protocol itself;
2. MEGA-specific protocol rules;
3. UI layout or UX behavior;
4. host-specific plugin internals.

## 2. Design Goals

The shared runtime services bundle MUST provide:

1. a language-neutral contract shape at the host boundary;
2. reusable transport and provider support code across hosts;
3. additive migration from current working paths;
4. explicit capability declarations rather than inferred desktop-only behavior.

## 3. Required Service Families

The runtime service bundle MUST expose at least these families:

1. **HTTP and request lifecycle** for request/response fetches with cancellation;
2. **Scheduler** for timeouts, retry delays, and long-lived background loops;
3. **Peer transport** for JSON and byte request-response carriage where a shared transport library needs peer RPC;
4. **Semantic volume events** for push publication after local visibility;
5. **Capability reporting** for explicit supported and unsupported runtime families.

## 4. HTTP and Request Lifecycle

The shared runtime service bundle MUST support:

1. request-scoped cancellation;
2. bounded waits and reconnect loops;
3. response handling for JSON and opaque bytes.

Implementations MAY map these capabilities to host-native APIs, but shared libraries MUST depend only on the abstract service family.

## 5. Scheduler

The scheduler service MUST support:

1. one-shot timers;
2. repeating timers;
3. cancellation or disposal of scheduled work.

Rules:

1. retry and backoff behavior MUST remain owned by the shared library using the scheduler;
2. host adapters MUST NOT silently rewrite transport or provider retry policy.

## 6. Peer Transport

When a host supports peer-to-peer transport, the runtime service bundle SHOULD expose a peer transport family that can carry:

1. JSON request-response messages;
2. byte request-response messages;
3. low-latency command notifications.

This family exists so shared libraries can reuse one peer RPC shape without depending on a specific WebRTC or native plugin implementation.

## 7. Semantic Volume Events

The shared runtime service bundle MUST expose publication into the volume-event path defined by `transport/runtime-volume-events-v0.1.md`.

Rules:

1. shared libraries MUST publish semantic events only after local visibility is complete;
2. provider-specific packet details MUST NOT leak into the UI event payload;
3. LAN, filesystem, and MEGA producers MUST be able to publish through the same service family.

## 8. Explicit Unsupported Behavior

If a host does not support a runtime family, that unsupported state MUST be explicit.

Rules:

1. unsupported provider capability MUST remain an explicit host-contract result;
2. adopting shared runtime services MUST NOT make an unsupported phone MEGA flow appear partially supported;
3. compatibility hosts MAY omit service families that the active host capability set does not claim.

## 9. Relationship To Existing Specs

This specification is a supporting contract specification.

It MUST preserve:

1. `transport/lan-sync-v0.4.md` for discovery, control-channel, and receiver-driven LAN transfer semantics;
2. `transport/storage-commands-v0.1.md` for storage-command hot-path behavior;
3. `transport/runtime-volume-events-v0.1.md` for runtime-to-UI push semantics.

It MUST NOT redefine those wire or event specifications.

## 10. Additive Migration Rule

Migration to shared runtime services MUST happen additively.

Rules:

1. existing working LAN phone paths MUST keep their current wire behavior while being rebound to the new service bundle;
2. existing desktop MEGA behavior MUST keep its current provider semantics while being rebound to the new service bundle;
3. a host MAY adopt one service family at a time;
4. no migration stage may require the UI to change semantics for already-supported flows.

## 11. Non-Regression Gates

Before a new host or provider path switches to this bundle as its normative implementation path, it MUST preserve:

1. explicit unsupported provider behavior where support is still incomplete;
2. phone LAN control-channel liveness and storage-command hot path;
3. semantic push publication for locally visible provider updates.

If those gates are not met, the shared service adoption MUST remain behind a compatibility boundary.