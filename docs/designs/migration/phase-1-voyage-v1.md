# Phase 1 Voyage v1

## Objective

Define the exact transition substeps whose end state is:

- desktop retains all current functionality;
- desktop retains current efficiency, latency, and reactivity;
- phone ships a usable app with the shared UI, file browser, chat, timeline, and LAN sync;
- desktop and phone expose the full UI surface from the same shared codebase, with runtime differences expressed through shared capability states;
- the resulting system is modular and extensible on both desktop and phone.

## Phase 1 Success Criteria

Phase 1 is complete only when all of the following are true.

### Desktop Success Criteria

- all current desktop user-visible features still work;
- updater, deep links, clipboard-image flows, file-manager helpers, runtime logs, provider flows, roots flows, and debug surfaces remain intact;
- no shared feature migrated in Phase 1 is slower or less reactive than the current desktop implementation;
- desktop can run the shared file browser, chat, timeline, and LAN surfaces through the portable core line;
- browser owns application-level crypto and application-level semantics for those shared surfaces.

### Phone Success Criteria

- the app uses the same shared shell and full feature surface structure as desktop;
- file browser is usable;
- chat is usable;
- timeline is usable;
- LAN peer discovery, peer status, and sync initiation are usable;
- the same settings and integration surfaces render from the shared UI codebase;
- the app remains useful without MEGA, provider accounts, or desktop-only helpers being runtime-complete;
- browser owns application-level crypto and application-level semantics for the shared surfaces.

### Architecture Success Criteria

- portable features depend on the host contract only;
- desktop-only features are isolated behind a desktop-only capability family;
- mobile host code does not fork shared feature code;
- the browser build shares the same portable code that mobile uses;
- the desktop and mobile UI surfaces are rendered from the same shared feature components and routes.
- shared surfaces no longer depend on backend-owned application materialization or cryptographic workflows.

## Phase 1 Workstreams

Phase 1 runs in four parallel but ordered workstreams.

1. host contract and capability freeze
2. portable core extraction for volume, timeline, chat, and LAN
3. desktop mixed-mode adoption with zero feature regression
4. Capacitor plus native LAN runtime delivery

## Detailed Substeps

### Step 1.0: Freeze The Current Capability Inventory

Purpose:

- make desktop parity explicit before any refactor

Deliverables:

- current capability matrix in `platform/phase-1-capability-matrix-v1.md`
- explicit list of desktop parity blockers

Desktop guarantee:

- no code change yet

Exit gate:

- every existing desktop capability is accounted for under one family

### Step 1.1: Introduce The Typed Host Contract

Purpose:

- create the seam that shared code can depend on

Deliverables:

- `host/contract/` types for capability, object, watch, LAN, shell, and legacy desktop families
- one app entry point for resolving the active host

Desktop guarantee:

- desktop implementation delegates to the current preload and HTTP client
- no behavior change

Phone relevance:

- creates the future Capacitor seam without forcing a fork

Exit gate:

- new shared code can ask for host services without importing desktop globals directly
- the contract is shaped around capabilities, opaque objects, watch feeds, and host services rather than long-term backend-owned application APIs

### Step 1.2: Add The Browser Object Mirror And Application Boundary

Purpose:

- give portable core features a browser-local opaque object store and event feed

Deliverables:

- mirror schema for opaque events, blocks, volume heads, LAN peer snapshots, and projection checkpoints
- batch import and change-notification APIs
- explicit browser-owned application boundary for files, chat, identity, references, and timeline semantics

Desktop guarantee:

- mirror is additive and not yet authoritative

Phone relevance:

- creates the structure that a native LAN runtime will feed later

Exit gate:

- mirror can be seeded and incrementally updated without a full page refresh
- the design no longer assumes the backend will remain the long-term owner of shared-surface application crypto

### Step 1.3: Build The Desktop Host Adapter In Compatibility Mode

Purpose:

- make desktop the first host that satisfies the new contract

Deliverables:

- desktop adapter wrapping current preload helpers
- desktop adapter wrapping current fetch-based API client
- desktop watch adapters preserving source and volume watch behavior
- explicit compatibility note that current high-level backend application APIs are transitional only for shared surfaces

Desktop guarantee:

- desktop continues to use the current Electron and Node runtime
- no extra mandatory process hop is introduced

Phone relevance:

- proves the contract against a real host before adding Capacitor

Exit gate:

- the app boots through the host resolver with no visible regression
- compatibility mode is clearly temporary and not mistaken for the Phase 1 end-state architecture

### Step 1.4: Extract Portable File Browser State

Purpose:

- move the file browser to shared app-core logic backed by the contract and mirror

Deliverables:

- shared volume-open workflow
- shared file-list and selection state
- shared file command orchestration for upload, rename, delete, and download intents
- browser-owned file encryption, decryption, verification, and projection logic for the shared file-browser surface

Desktop guarantee:

- desktop seeds the mirror from current `/open`, `/files`, `/file`, and watch flows
- desktop keeps current latency by reusing existing calls and incremental updates

Phone relevance:

- file browser becomes portable before the mobile shell arrives

Exit gate:

- desktop file browser uses shared app-core without losing current behavior
- shared file-browser semantics are browser-owned rather than backend-owned

### Step 1.5: Extract Portable Timeline And Event Detail

Purpose:

- move timeline and event inspection to shared app-core logic

Deliverables:

- shared timeline projection cache
- shared event-detail loading and invalidation rules
- shared event storage-location awareness where supported by the host
- browser-owned event verification, hydration, and timeline interpretation for the shared timeline surface

Desktop guarantee:

- desktop reuses current timeline and watch streams to maintain responsiveness
- event detail behavior and error handling stay intact

Phone relevance:

- timeline becomes a first-class portable surface required by Phase 1

Exit gate:

- desktop timeline and event detail render through shared code
- shared timeline semantics are browser-owned rather than backend-owned

### Step 1.6: Extract Portable Chat And Identity

Purpose:

- move chat and identity publication to shared app-core logic

Deliverables:

- shared chat state
- shared identity state
- shared send and publish workflows
- browser-owned identity signing, chat message authoring, verification, and projection logic for the shared chat surface

Desktop guarantee:

- desktop continues to use current backend commands through the host contract
- no loss of current chat behavior

Phone relevance:

- chat becomes part of the portable core before LAN mobile delivery

Exit gate:

- desktop chat and identity flows run through shared app-core
- shared chat and identity semantics are browser-owned rather than backend-owned

### Step 1.7: Extract Portable LAN Presentation

Purpose:

- make peer list, transport status, and sync actions part of the portable core UI

Deliverables:

- shared LAN peer list models
- shared sync-action models
- shared transport-status badges and detail views

Desktop guarantee:

- desktop keeps using the current LAN runtime and current peer/sync endpoints
- no regression in peer freshness or action response

Phone relevance:

- defines the exact UI and host data shape the mobile LAN runtime must provide

Exit gate:

- desktop LAN surfaces use the shared feature code

### Step 1.8: Add The Capacitor Shell

Purpose:

- boot the same shared app under Capacitor

Deliverables:

- Capacitor host project
- capability reporting for unsupported desktop-only families
- same shared routing, shell, and primary navigation

Desktop guarantee:

- none of the desktop runtime path changes

Phone relevance:

- establishes the real mobile app shell early rather than at the end

Exit gate:

- mobile app boots the full shared UI with explicit capability fallbacks instead of broken imports or missing surfaces

### Step 1.9: Add The Native Phase 1 LAN Runtime For Capacitor

Purpose:

- give phone a durable LAN runtime and opaque object store

Deliverables:

- native opaque object store
- LAN discovery and sync runtime
- bridge events for peer state and object-batch updates
- runtime lifecycle handling for foreground and resumable background work

Desktop guarantee:

- no desktop behavior change

Phone relevance:

- creates the actual Phase 1 product runtime

Exit gate:

- phone can discover peers, request sync, receive objects, and persist them without the WebView being the runtime owner

### Step 1.10: Feed The Browser Object Mirror From The Phone Runtime

Purpose:

- make the shared app usable on phone with browser-side crypto and projections

Deliverables:

- batch import from native store into browser mirror
- projection invalidation and resume logic
- startup bootstrap from durable native heads instead of full scan where possible

Desktop guarantee:

- desktop path remains unchanged

Phone relevance:

- enables file browser, chat, and timeline from the same shared app-core used on desktop

Exit gate:

- phone renders synced file browser, chat, and timeline from shared code
- phone shared surfaces are driven by browser-owned application crypto and projections over the mirrored opaque objects

### Step 1.11: Harden Mixed-Mode Desktop

Purpose:

- prove that shared portable surfaces and desktop legacy surfaces coexist without compromise

Deliverables:

- explicit shared-versus-legacy routing map
- performance review of portable surfaces on desktop
- no-regression checks for updater, roots, providers, file-manager helpers, deep links, and logs
- explicit proof that shared surfaces no longer depend on Node-side application services as their source of truth

Desktop guarantee:

- this step exists specifically to protect desktop quality

Phone relevance:

- ensures mobile progress did not degrade the primary shipped app

Exit gate:

- desktop remains the full product with no feature removals and no accepted performance downgrade

### Step 1.12: Phase 1 Release Gate

Purpose:

- close Phase 1 only when both desktop and phone goals are met

Release gate:

- desktop full functionality
- desktop no accepted efficiency, latency, or reactivity regression
- phone usable file browser
- phone usable chat
- phone usable timeline
- phone LAN sync usable end to end
- shared UI and app-core confirmed for the portable surfaces
- browser-owned application crypto and application semantics confirmed for the shared surfaces

## Desktop No-Compromise Rules

The following are absolute blockers against claiming progress:

- losing any desktop-only current feature
- introducing manual refresh where the current app reacts automatically
- replacing watch streams with polling in shared UI code
- adding large binary payload conversions that materially hurt desktop responsiveness
- forcing desktop code through mobile-only abstractions when the current path is already efficient
- meeting the mobile schedule by forking the UI codebase
- declaring Phase 1 complete while shared surfaces still depend on backend-owned application crypto or materialization

## Phone Product Rules

The following are required to avoid shipping a demo-only phone app:

- the same visual shell, navigation model, and feature surfaces as desktop from the same shared source files
- real file browsing, not only sync diagnostics
- real chat and timeline, not only object counters
- LAN sync status and peer actions exposed in the UI
- unsupported runtime-backed actions must fail clearly and compactly through shared capability gating rather than disappearing into a mobile-only UI variant

## Explicit Deferred Scope

Deferred until after Phase 1:

- phone MEGA runtime support
- phone managed-share runtime support beyond LAN-backed core usage
- phone roots-management runtime support
- phone updater runtime support
- desktop runtime replacement
- desktop provider rewrite
- final `apps/*` plus `packages/*` repo split

Deferred scope here refers to runtime support, not to the presence of the corresponding shared UI surfaces.

It also does not weaken the browser-owned application boundary for the shared surfaces.

## Why This Voyage Is Ordered This Way

The shared app and host contract come first because they are the durable seam.

The browser object mirror comes early because browser crypto and reactive projections need a local, renderer-friendly data source.

Desktop adopts the seam before phone so the migration can prove parity against the existing shipping app.

Capacitor arrives before a full runtime rewrite so the mobile host becomes real early.

LAN runtime work lands before provider work because LAN is the actual phone Phase 1 product.