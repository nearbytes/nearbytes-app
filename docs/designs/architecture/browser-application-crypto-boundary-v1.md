# Browser Application Crypto Boundary v1

## Objective

Make application-level Nearbytes logic browser-owned across desktop and phone hosts.

This is a strict requirement.

By the end of Phase 1, the shared browser application must own application-level crypto and application semantics for the shared product surfaces.

## Non-Negotiable Rule

For shared surfaces, the browser is the canonical owner of application-level crypto and application semantics.

The browser may optionally implement storage-location and transport concerns too, but it is not required to.

Native or host runtimes may store, transport, index, watch, and shell-integrate encrypted objects. They may not tell the browser what those objects mean as files, messages, identities, references, or timeline events.

## What Counts As Application-Level

Application-level here means the logic that gives Nearbytes product meaning to opaque objects.

This includes:

- secret normalization and volume open semantics
- key derivation used by the application layer
- file encrypt, decrypt, sign, verify, and materialize logic
- chat identity publish, message authoring, signing, verification, and projection logic
- timeline payload verification, hydration, and interpretation
- reference export, import, wrapping, unwrapping, and recipient or source reference semantics
- application-record semantics for user-facing data flows

If the logic answers "what does this encrypted object mean to the user as a file, message, identity, reference, or timeline event?", it belongs in the browser application layer.

## Browser-Owned Workflows For Shared Surfaces

The browser application owns, at minimum:

- volume open semantics for shared surfaces
- object verification and decryption for shared surfaces
- object creation, encryption, and signing for shared surfaces
- file browser projection and command intent orchestration
- timeline projection and event-detail hydration
- chat and identity projection, authoring, and verification
- reference and attachment semantics
- capability-aware shared-surface state derived from mirrored opaque objects and host status

Hosts may stream raw bytes at explicit shell boundaries such as file pick or file export, but the browser still owns the shared-surface cryptographic and semantic interpretation of those bytes.

## File Import And Export Rule

Shared file import and export are browser-owned workflows with host-owned shell edges.

That means:

- hosts may expose raw selected bytes, file handles, destination handles, and advisory shell metadata;
- browser app-core decides whether those bytes become Nearbytes file objects and how shared-surface metadata is authored;
- browser app-core performs shared-surface hashing, encryption, signing, verification, decryption, and reference creation;
- hosts may save or share bytes only after the browser decides what bytes should leave the shared-surface boundary.

Temporary host-authored upload or download helpers are allowed only as compatibility shims. They do not satisfy the Phase 1 browser-owned boundary.

## What Hosts May Still Own

Hosts and native runtimes may own:

- opaque event and block persistence
- object indexing and head tracking for efficient bootstrap
- storage-location management and mapping
- LAN and provider transport sessions
- background sync and durable retry
- provider account session management
- raw file selection, sharing, and save-to-disk shell actions
- platform shell actions such as deep links, updater flows, and runtime log access

These concerns may remain native, desktop-specific, or runtime-specific as long as they expose typed host capabilities and opaque object access to the shared browser application.

## What Hosts May Not Own For Shared Surfaces

Hosts and native runtimes may not remain the source of truth for:

- canonical file browser materialization
- canonical timeline projection
- canonical chat and identity projection
- canonical reference semantics
- application-layer encryption and decryption of shared-surface content
- application-layer event authoring for shared-surface features
- feature-specific view models that bypass the shared browser app-core

Hosts may still offer compatibility helpers during migration, but Phase 1 is not complete while the shared surfaces depend on host-owned application semantics.

## Permanent Host Contract Shape

The long-term app-facing contract for shared surfaces is data-shaped and capability-shaped, not product-semantics-shaped.

The permanent contract may expose:

- capability discovery
- opaque object read, write, import, and flush primitives
- head and lightweight index enumeration
- object change batches and projection invalidation hints
- LAN state and sync actions
- shell requests and shell outcomes
- desktop-only legacy capability families for desktop-specific runtime fulfillment

The permanent contract may not expose canonical shared-surface feature semantics.

Detailed contract rules are defined in `architecture/host-contract-runtime-boundary-v1.md`.

## Forbidden Permanent API Shapes

The following shapes are forbidden as the long-term app-facing boundary for shared surfaces:

- `openVolume`
- `listFiles`
- `getFile` when it implies host-owned decryption or host-owned filename semantics
- `getTimeline`
- `getEvent`
- `listChat`
- `publishIdentity`
- `sendMessage`
- `exportSourceReferences`
- `importSourceReferences`
- `exportRecipientReferences`
- `importRecipientReferences`
- `materializeVolume`
- any route or method that returns pre-projected file, chat, identity, reference, or timeline state as the canonical source of truth

These names are not banned as temporary adapter internals. They are banned as the permanent contract that new shared feature code depends on.

## Reference Implementation Divergence

The current reference implementation does not satisfy this boundary yet.

Today, significant application-level Nearbytes logic still lives in the Node runtime, including:

- `src/api/nearbytes-api.ts`
- `src/domain/fileService.ts`
- `src/domain/chatService.ts`
- `src/server/routes.ts`

Those modules and routes currently perform browser-target application responsibilities such as:

- volume open and file-system materialization
- file add, delete, retrieve, rename, snapshot, timeline, and reference operations
- chat identity publication, message authoring, message verification, and chat materialization
- high-level endpoints such as `/open`, `/files`, `/timeline`, `/events/:hash`, `/chat`, `/chat/*`, `/upload`, `/references/*`, and `/file/:hash`

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

### No-Expansion Rule

New shared feature work may not add more long-term shared-surface semantics to `NearbytesAPI`, `FileService`, `ChatService`, or the current high-level Express routes.

### Compatibility Note

Desktop-only features that are outside the portable core may still rely on the existing Node runtime in Phase 1. The strict browser-crypto rule applies to shared application surfaces such as file browser, timeline, chat, identity, and references.

## Transitional Compatibility Strategy

The migration may temporarily use compatibility adapters, but only under these rules:

1. compatibility adapters are bootstrap aids, not the target architecture;
2. compatibility adapters may populate the browser mirror or expose legacy desktop capabilities, but they may not decide shared-surface projections, decrypted meaning, or browser-owned feature state;
3. any shared surface still backed by host-owned application crypto is considered mid-migration, not complete;
4. new shared features must be implemented directly against the browser-owned boundary rather than expanding the old backend-owned application surface.

## Phase 1 Release Gate Impact

Phase 1 is incomplete unless all of the following are true for the shared surfaces:

1. browser owns application-level crypto;
2. browser owns application-level projections;
3. shared feature code no longer depends on Node materialization or high-level compatibility APIs as its source of truth;
4. host runtimes only provide opaque object, transport, storage-location, LAN, shell, and desktop-only legacy capabilities;
5. desktop preserves all existing functionality and performance while this boundary is established;
6. phone uses the same shared UI surface inventory as desktop while consuming the same browser-owned semantics.