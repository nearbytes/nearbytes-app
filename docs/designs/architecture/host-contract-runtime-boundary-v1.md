# Host Contract Runtime Boundary v1

## Objective

Define the precise boundary among the shared UI, shared browser app-core, host contract, host adapters, native or runtime services, and the legacy desktop runtime.

The goal is to make the layering concrete enough that an implementer cannot accidentally keep shared-surface semantics in backend-shaped APIs while still claiming compliance.

## Layer Stack

### 1. Shared UI

Shared UI owns:

- the navigation inventory and surface entry points
- feature panels, dialogs, forms, tables, and lists
- capability-aware unavailable states
- responsive layout differences that do not fork feature ownership

Shared UI may depend on:

- shared browser app-core state and workflows
- host capability read models exposed through the shared app-core

Shared UI must not depend on:

- Electron, Capacitor, or Node-specific modules
- desktop-only or phone-only feature implementations for the same product surface
- raw compatibility responses from current backend-shaped APIs

### 2. Shared Browser App-Core

Shared browser app-core owns:

- browser crypto
- projection and materialization logic for shared surfaces
- mirror reads and writes
- feature workflows and action orchestration
- shared feature state for files, chat, identity, references, timeline, and LAN presentation

Shared browser app-core may depend on:

- browser-safe crypto and storage helpers
- host contract only

Shared browser app-core must not depend on:

- Electron globals
- Capacitor imports directly in shared feature code
- Node-only services
- high-level backend APIs as its permanent semantic source of truth

### 3. Host Contract

The host contract owns the only permanent app-facing seam below the shared browser app-core.

The contract may expose:

- capability discovery
- opaque object reads, writes, imports, and durable flush requests
- head and lightweight index enumeration
- object change batches and projection invalidation hints
- LAN state and sync actions
- shell requests such as file pick, share sheet, open external, reveal in file manager, updater actions, UI state persistence, and runtime logs
- desktop-only legacy capability families for provider, roots, updater, and similar desktop-specific runtime fulfillment

The contract may return:

- opaque encrypted objects and hashes
- durable write acknowledgements, commit status, and restart-safe pending-write status
- typed metadata needed to locate, watch, or batch objects
- capability and runtime status records
- shell outcomes and structured errors

The contract must not return:

- canonical file lists as a browser-invisible service decision
- canonical timeline materialization
- canonical chat or identity materialization
- decrypted shared-surface payload meaning
- feature-specific view models that bypass the shared browser app-core

## File Import And Export Boundary

File import and export cross the host boundary only at explicit shell edges.

Allowed host-side responsibilities at that boundary:

- presenting file pickers, share sheets, or save dialogs
- returning raw byte streams, handles, and advisory shell metadata such as suggested filename or MIME type
- writing browser-produced export bytes to a host destination or share target

Required browser-side responsibilities at that boundary:

- deciding whether selected bytes become Nearbytes file objects
- deciding filename, hash, reference, and record semantics for shared surfaces
- performing chunking, encryption, signing, verification, and decryption for shared-surface content
- deciding which decrypted bytes are exported for a shared-surface user action

Temporary helper routes for upload or download are allowed only below compatibility adapters. Phase 1 is incomplete while host-side upload or download helpers remain the semantic source of truth for shared file actions.

## Browser-Authored Object Commit Flow

For shared surfaces, browser-authored writes follow this lifecycle:

1. shared browser app-core decides the semantic mutation, derives hashes or chunks, and performs encryption and signing;
2. shared browser app-core submits only opaque objects, head-update intent, and lightweight persistence metadata through the object family;
3. host runtime durably persists those opaque objects and related head or index records before reporting success;
4. host contract returns only durable acknowledgement, commit status, and lightweight head or index hints. It does not return host-authored projections or decrypted meaning;
5. shared browser app-core may keep optimistic pending state, but it may treat a write as committed only after durable acknowledgement or an equivalent durable-confirmation event;
6. committed objects re-enter the browser mirror through the same change-batch and invalidation path used for remote or background-arrived objects, with deduplication by object hash or head;
7. LAN, provider, or other transport runtimes pick outbound sync work only from durable host storage, never from transient WebView memory.

Write primitives must therefore support:

- idempotent resubmission of the same object batch after suspend, resume, or restart
- explicit distinction between accepted-for-durable-persistence, rejected, and still-pending states
- restart-safe recovery of pending authored objects without delegating shared-surface semantics back into the host runtime

### 4. Host Adapters

Host adapters translate the host contract onto browser, desktop, or Capacitor runtime implementations.

Host adapters may depend on:

- Electron preload APIs
- current desktop HTTP or IPC APIs
- Capacitor bridge APIs
- browser-local storage or worker helpers

Host adapters must not become the owner of:

- shared-surface crypto
- shared-surface projections
- shared-surface canonical feature state

### 5. Native And Runtime Services

Native and runtime services own:

- storage-location persistence and mapping
- transport sessions
- background sync and retry
- opaque object persistence, batching, and indexing
- provider sessions
- lifecycle integration and shell integration

Native and runtime services must not own:

- the user-visible meaning of shared-surface encrypted objects
- the canonical shared-surface feature state consumed by the browser UI
- shared-surface cryptographic authoring, verification, or materialization rules

### 6. Legacy Desktop Runtime

The legacy desktop runtime is the current Electron plus Node compatibility line.

It may keep its current structure during Phase 1, but it must stay below the host contract and must shrink over time.

It may fulfill desktop-only runtime responsibilities. It may not remain the canonical owner of shared file, chat, identity, reference, or timeline semantics.

## Required Contract Families

The permanent host contract must be organized around these families:

1. capability family
2. object family
3. invalidation and watch family
4. LAN family
5. shell family
6. legacy desktop family

These families are chosen specifically to keep the browser application in charge of meaning while still letting hosts own runtime fulfillment.

## Forbidden Permanent Contract Shapes

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

These names are not forbidden as temporary adapter internals. They are forbidden as the permanent contract that new shared feature code depends on.

## Compatibility Adapter Rules

Compatibility adapters are allowed only under all of the following conditions:

- they are explicitly named as compatibility code and live below the shared app-core
- shared feature code depends on host contract and mirror-facing models, not on compatibility response shapes
- new shared features may not be implemented by extending compatibility-only APIs
- each compatibility adapter has a stated removal condition
- the adapter translates current backend-shaped operations into object, invalidation, capability, or shell data before shared feature code sees them

A compatibility adapter is a migration tool, not a license to keep the browser boundary soft.

## Legacy Desktop Family Rules

The legacy desktop family exists to preserve desktop-only runtime fulfillment during Phase 1.

It may cover:

- provider account setup and session management
- managed-share and incoming-share operations
- roots and storage-location management
- updater flows
- runtime logs
- file-manager helpers
- desktop automation and debug hooks

It may not cover:

- canonical file browser projection
- canonical timeline projection
- canonical chat and identity projection
- shared-surface application crypto
- shared-surface reference semantics

The shared UI still renders the corresponding product surfaces from the same source tree on all hosts. The legacy desktop family only changes whether runtime-backed actions are available.

## Progressive Migration Consequence

The current desktop implementation may keep its Express routes, Electron preload helpers, and Node services during translation, but they must progressively collapse into adapters and runtime services below the contract.

That means:

- `src/server/routes.ts` is a compatibility delivery surface, not the future shared app contract
- `src/domain/fileService.ts`, `src/domain/chatService.ts`, and `src/api/nearbytes-api.ts` are compatibility and reference modules, not the final app-core API
- new shared feature work may not add more long-term semantics to those modules
- once a shared surface is browser-owned, the legacy runtime must no longer be the source of truth for that surface

## Phase 1 Completion Proof

Phase 1 is not complete until all of the following are true for shared file, chat, identity, reference, and timeline surfaces:

- shared feature code can run through host contract, browser mirror, and browser crypto without depending on high-level compatibility APIs as its source of truth
- desktop still preserves every legacy desktop feature and current responsiveness
- phone uses the same shared navigation inventory and feature modules as desktop
- host runtimes are limited to storage-location, transport, LAN, shell, and desktop-only legacy fulfillment responsibilities