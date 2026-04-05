# Browser Application Crypto Boundary v1

## Objective

Make application-level Nearbytes logic browser-owned across desktop and mobile hosts.

This is a strict requirement.

By the end of Phase 1, the shared browser application must own application-level crypto and application semantics for the shared product surfaces.

## Strict Rule

All application-level crypto is done in the browser.

The browser may optionally implement storage-location and transport concerns too, but it is not required to.

Native or host runtimes may own storage-location, opaque object persistence, transport, background sync, provider sessions, and platform integration. They may not be the source of truth for file, chat, identity, reference, or timeline cryptographic semantics for the shared surfaces.

## What Counts As Application-Level

Application-level here means the logic that gives Nearbytes product meaning to opaque objects.

This includes:

- secret normalization and volume open semantics
- key derivation used by the application layer
- file encrypt, decrypt, sign, verify, and materialize logic
- chat identity publish, message authoring, signing, verification, and projection logic
- timeline payload verification, hydration, and interpretation
- reference export, import, wrapping, unwrapping, and recipient/source reference semantics
- application-record semantics for user-facing data flows

If the logic answers "what does this encrypted object mean to the user as a file, message, identity, or timeline event?", it belongs in the browser application layer.

## What Hosts May Still Own

Hosts and native runtimes may own:

- opaque event and block persistence
- object indexing and head tracking for efficient bootstrap
- storage-location management and mapping
- LAN and provider transport sessions
- background sync and durable retry
- provider account session management
- platform shell actions such as file pickers, deep links, updater flows, and runtime log access

These concerns may remain native, desktop-specific, or runtime-specific as long as they expose typed host capabilities and opaque object access to the shared browser application.

## What Hosts May Not Own For Shared Surfaces

Hosts and native runtimes may not remain the source of truth for:

- canonical file browser materialization
- canonical timeline projection
- canonical chat and identity projection
- application-layer encryption and decryption of shared-surface content
- application-layer event authoring for shared-surface features

Hosts may still offer compatibility helpers during migration, but Phase 1 is not complete while the shared surfaces depend on host-owned application semantics.

## Target Boundary

### Browser Application Owns

- `open volume` semantics for shared surfaces
- object verification and decryption for shared surfaces
- object creation, encryption, and signing for shared surfaces
- file browser projection
- timeline projection
- chat and identity projection
- reference and attachment semantics

### Host Runtime Owns

- opaque object store
- object watch and change batches
- LAN peer list and sync actions
- storage-location inventory and persistence
- transport endpoints and background sync
- platform shell capabilities

## Reference Implementation Divergence

The current reference implementation does not satisfy this boundary yet.

Today, significant application-level Nearbytes logic still lives in the Node runtime, including:

- `src/api/nearbytes-api.ts`
- `src/domain/fileService.ts`
- `src/domain/chatService.ts`

Those modules currently perform browser-target application responsibilities such as:

- volume open and file system materialization
- file add, delete, retrieve, rename, snapshot, timeline, and reference operations
- chat identity publication, message authoring, message verification, and chat materialization

This is acceptable only as a transitional reference implementation.

## Required Reference-Implementation Changes

The reference implementation must change in the following direction.

### Shared Browser App-Core Must Gain

- browser-native volume open and projection logic for shared surfaces
- browser-native file encryption, decryption, and reference workflows
- browser-native timeline verification and materialization
- browser-native chat and identity cryptographic workflows

### Host Contract Must Gain

- opaque object read and write primitives
- batched object import and watch notifications
- volume head and projection invalidation hints
- transport and LAN runtime status queries
- shell and legacy desktop capability families

### Desktop Runtime Must Lose Source-Of-Truth Status For Shared Surfaces

The desktop runtime may keep compatibility routes during the transition, but by the Phase 1 end state the shared surfaces must no longer rely on Node-side application materialization as their source of truth.

### Compatibility Note

Desktop-only features that are outside the portable core may still rely on the existing Node runtime in Phase 1. The strict browser-crypto rule applies to shared application surfaces such as file browser, timeline, chat, identity, and references.

## Transitional Compatibility Strategy

The migration may temporarily use compatibility adapters, but only under these rules:

1. compatibility adapters are bootstrap aids, not the target architecture;
2. any shared surface still backed by host-owned application crypto is considered mid-migration, not complete;
3. new shared features must be implemented directly against the browser-owned boundary rather than expanding the old backend-owned application surface.

## Phase 1 Release Gate Impact

Phase 1 is incomplete unless all of the following are true for the shared surfaces:

1. browser owns application-level crypto;
2. browser owns application-level projections;
3. host runtimes only provide opaque object, transport, storage-location, and platform capabilities;
4. desktop preserves all existing functionality and performance while this boundary is established.