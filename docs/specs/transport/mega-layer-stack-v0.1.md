# Nearbytes MEGA Layer Stack v0.1

Status: draft normative specification.

This document defines the internal TypeScript layer order for the shared Nearbytes MEGA implementation.

Its purpose is to keep MEGA protocol, runtime, cryptographic, authentication, and orchestration concerns separated behind a one-directional dependency stack so desktop and phone hosts can share the same provider core without reintroducing mixed responsibilities.

## 1. Scope

This specification defines:

1. the ordered layer stack for the shared MEGA implementation;
2. the dependency-direction rules between those layers;
3. the separation between shared MEGA internals and the public adapter entrypoint.

This specification does not define:

1. the MEGA wire protocol itself;
2. generic shared runtime-service contracts;
3. application-level share UX or onboarding behavior;
4. host-specific plugin internals.

## 2. Design Goals

The MEGA layer stack MUST provide:

1. one-directional dependencies from lower-level primitives toward higher-level orchestration;
2. reuse of the same low-level MEGA logic across desktop and phone-capable hosts;
3. explicit boundaries between protocol, runtime, crypto, auth, and sync behavior;
4. additive extraction from the historical single-file adapter without changing provider semantics.

## 3. Normative Layer Order

The active shared MEGA implementation MUST follow this layer order, from lowest level upward:

1. `src/integrations/mega/protocol.ts`
2. `src/integrations/mega/core.ts`
3. `src/integrations/mega/runtime.ts`
4. `src/integrations/mega/errors.ts`
5. `src/integrations/mega/crypto.ts`
6. `src/integrations/mega/auth.ts`
7. `src/integrations/mega/publicLink.ts`
8. `src/integrations/mega/adapter.ts`

Test-only helpers such as `src/integrations/mega/liveTestEnv.ts` are not part of the runtime layer stack.

Adapter-support modules such as `src/integrations/mega/adapterConstants.ts`, `src/integrations/mega/adapterTypes.ts`, `src/integrations/mega/shareHelpers.ts`, `src/integrations/mega/syncUtils.ts`, `src/integrations/mega/nodeCrypto.ts`, `src/integrations/mega/keyManager.ts`, `src/integrations/mega/treeHelpers.ts`, and `src/integrations/mega/admin.ts` are implementation-detail support modules inside the top adapter layer, not new lower layers.

## 4. Layer Responsibilities

### 4.1 Protocol Layer

`src/integrations/mega/protocol.ts` MUST own MEGA request shaping, endpoint invocation, response parsing, protocol encoding helpers, and action-packet parsing primitives.

This layer MUST NOT depend on runtime adapter policy, sync strategy, or UI-facing semantics.

### 4.2 Core Layer

`src/integrations/mega/core.ts` MUST own shared MEGA types, constants, tags, retry tables, and low-level invariants used by higher layers.

This layer MUST remain data-only and MUST NOT perform transport, crypto, or auth operations.

### 4.3 Runtime Layer

`src/integrations/mega/runtime.ts` MUST own environment-dependent capability access such as Node crypto loading, browser crypto access, filesystem access, watcher loading, and phone runtime shims.

This layer MUST hide host-specific loading details from crypto, auth, and orchestration layers.

### 4.4 Error and Retry Policy Layer

`src/integrations/mega/errors.ts` MUST own MEGA-specific error classification, retryability rules, bounded backoff selection, reconnect-required signaling, and scheduler-driven wait helpers.

This layer MUST NOT implement account login flows or sync orchestration.

### 4.5 Crypto Layer

`src/integrations/mega/crypto.ts` MUST own MEGA cryptographic operations including key derivation, private-attribute parsing, key-manager container handling, legacy account-key logic, hashing, MAC generation, and pairwise key derivation.

This layer MAY depend on protocol encoding helpers, runtime capability access, and shared constants, but MUST NOT depend on the adapter orchestration layer.

### 4.6 Auth and Session Layer

`src/integrations/mega/auth.ts` MUST own account-session creation, session serialization and deserialization, persisted share-key encoding, reusable credential extraction, and authenticated low-level account bootstrap flows.

This layer MAY depend on protocol, crypto, runtime, and error-policy layers, but MUST NOT depend on sync orchestration.

### 4.7 Public Link Mirror Layer

`src/integrations/mega/publicLink.ts` MUST own MEGA public-link parsing and mirror materialization for read-only link targets.

This layer MAY depend on protocol helpers, but MUST remain outside account-session and managed-share orchestration concerns.

### 4.8 Adapter and Orchestration Layer

`src/integrations/mega/adapter.ts` MUST remain the internal provider adapter implementation entrypoint.

This layer MUST own connection lifecycle, managed-share behavior, owner and recipient orchestration, push and pull coordination, sync-loop policy, and host integration wiring.

This layer MUST consume lower layers and MUST NOT be depended on by them.

The adapter layer MAY be internally split into helper-family modules as long as those modules do not invert the layer stack.

Within the adapter layer, the current support-family responsibilities are:

1. `src/integrations/mega/adapterConstants.ts` for adapter-scoped constants and timing knobs;
2. `src/integrations/mega/adapterTypes.ts` for internal adapter-only types;
3. `src/integrations/mega/shareHelpers.ts` for share-descriptor, collaborator, invite, and access helpers;
4. `src/integrations/mega/syncUtils.ts` for sync-liveness helpers;
5. `src/integrations/mega/nodeCrypto.ts` for decrypted-node and authenticated-file helper logic that remains adapter-facing;
6. `src/integrations/mega/keyManager.ts` for MEGA key-manager parsing, share-key resolution, and incoming-share inventory helpers;
7. `src/integrations/mega/treeHelpers.ts` for remote-tree traversal, upload/delete helpers, manifest helpers, and readonly remote-adapter support;
8. `src/integrations/mega/admin.ts` for destructive dev/e2e maintenance helpers.

## 5. Dependency Direction Rules

The layer stack MUST remain acyclic.

Rules:

1. a lower layer MUST NOT import from a higher layer;
2. shared helper extraction MUST preserve or improve the current one-directional dependency shape;
3. new shared logic MUST be placed in the lowest layer that can own it without depending on higher semantics;
4. test-only helpers MUST remain outside the runtime dependency chain.

## 6. Public Entry Point Rule

The stable public integration surface for MEGA remains `src/integrations/mega.ts`.

Rules:

1. callers in desktop and phone host wiring MAY continue importing the public adapter entrypoint;
2. the public facade MUST re-export the internal adapter from `src/integrations/mega/adapter.ts`;
3. internal extracted layers under `src/integrations/mega/` MUST be treated as implementation detail modules;
4. public behavior preservation takes priority over internal file topology changes during extraction.

## 7. Relationship To Existing Specs

This specification is additive and sits beside the existing MEGA runtime profile.

It MUST remain compatible with:

1. `transport/mega-runtime-v0.1.md` for MEGA runtime scope and host-compatibility rules;
2. `transport/shared-runtime-services-v0.1.md` for shared runtime boundary expectations;
3. `storage/shared-path-storage-v0.1.md` for shared provider materialization expectations.

This specification does not replace those documents.

## 8. Next Extraction Rule

Further extraction above the current stack SHOULD keep splitting the adapter layer into narrower orchestration modules without changing the ordered lower-layer boundaries.

Expected future sub-families include:

1. connection and session liveness control;
2. owner push planning and upload coordination;
3. recipient pull and mirror-apply coordination;
4. sync-loop and reconciliation policy.

Those future modules would still belong above `src/integrations/mega/auth.ts` and below any UI-facing runtime host contract.