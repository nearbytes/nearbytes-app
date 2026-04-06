# Phase 1 Voyage v1

## Objective

Define the exact transition substeps whose end state is:

- desktop retains all current functionality;
- desktop retains current efficiency, latency, and reactivity;
- phone ships a usable app with the shared UI, shared navigation inventory, file browser, chat and identity, timeline, and LAN sync;
- desktop and phone expose the full UI surface from the same shared codebase, with runtime differences expressed through shared capability states;
- shared-surface application crypto and shared-surface semantics are browser-owned;
- the resulting system is modular and extensible on both desktop and phone.

## Working Definitions

- shared UI: the same navigation inventory, feature surfaces, and feature modules rendered from the same shared source files on desktop and phone
- shared browser app-core: browser-owned crypto, projections, mirror logic, and workflows for shared surfaces
- host contract: the typed capability, object, invalidation, LAN, shell, and legacy-desktop interface below the shared browser app-core
- native or runtime services: storage-location, transport, background sync, provider sessions, lifecycle integration, and shell integration below the contract
- legacy desktop runtime: the current Electron plus Node compatibility line that remains below the contract during migration

## Phase 1 Success Criteria

Phase 1 is complete only when all of the following are true.

### Desktop Success Criteria

- all current desktop user-visible features still work;
- updater, deep links, clipboard-image flows, file-manager helpers, runtime logs, provider flows, managed-share flows, roots flows, and debug surfaces remain intact;
- no shared feature migrated in Phase 1 is slower or less reactive than the current desktop implementation;
- desktop runs the shared file browser, timeline, chat, identity, references, and LAN surfaces through the shared browser app-core;
- browser owns application-level crypto and application-level semantics for those shared surfaces.

### Phone Success Criteria

- the app uses the same shared shell, navigation inventory, and full feature-surface inventory as desktop;
- file browser is usable;
- chat and identity flows are usable;
- timeline and event detail are usable;
- LAN peer discovery, peer status, and sync initiation are usable end to end;
- the same settings and integration surfaces render from the shared UI codebase;
- synced data remains usable across foreground, suspend, resume, and reopen flows;
- the app remains useful without MEGA, provider accounts, or desktop-only helpers being runtime-complete;
- browser owns application-level crypto and application-level semantics for the shared surfaces.

### Architecture Success Criteria

- portable features depend on the host contract only;
- the permanent host contract is capability, object, invalidation, LAN, shell, and legacy-desktop oriented rather than backend-shaped feature APIs;
- desktop-only features are isolated behind a legacy desktop capability family;
- phone host code does not fork shared feature code;
- the browser build shares the same portable code that phone uses;
- the desktop and phone UI surfaces are rendered from the same shared feature modules and navigation entry points;
- shared surfaces no longer depend on backend-owned application materialization or cryptographic workflows;
- compatibility adapters are clearly quarantined and shrinking rather than becoming the target architecture.

## Phase 1 Workstreams

Phase 1 runs in five parallel but ordered workstreams.

1. capability and surface freeze
2. contract and mirror foundation
3. portable-core extraction for files, timeline, chat, identity, references, and LAN presentation
4. desktop mixed-mode proof with zero feature regression
5. Capacitor plus native LAN runtime delivery

## Workstream Mapping

| Workstream | Step range | Notes |
| --- | --- | --- |
| capability and surface freeze | 1.0 to 1.1 | establishes the shared-surface inventory and permanent contract families |
| contract and mirror foundation | 1.2 to 1.3 | prepares the browser-owned boundary and desktop compatibility host |
| portable-core extraction | 1.4 to 1.7 | steps 1.4 to 1.7 may proceed in parallel once 1.3 is stable, as long as each preserves desktop parity |
| Capacitor plus native LAN runtime delivery | 1.8 to 1.10 | 1.8 starts once the contract is stable; 1.9 and 1.10 depend on the mirror foundation |
| desktop mixed-mode proof and release closeout | 1.11 to 1.12 | 1.11 is a blocking proof step for desktop quality and 1.12 cannot pass without it |

## Detailed Substeps

### Step 1.0: Freeze The Current Capability And Surface Inventory

Purpose:

- make desktop parity explicit before any refactor
- make phone shared-surface presence obligations explicit before any host-specific work

Deliverables:

- current capability matrix in `platform/phase-1-capability-matrix-v1.md`
- current shared navigation and surface inventory in `platform/phase-1-surface-inventory-v1.md`
- explicit list of desktop parity blockers and phone surface-presence obligations

Desktop guarantee:

- no code change yet

Exit gate:

- every existing desktop capability and current product surface is accounted for under either the portable core line or the legacy desktop family
- every shared-surface inventory item is explicitly classified as browser-owned, legacy-desktop-backed, or host-shell-backed

### Step 1.1: Introduce The Typed Host Contract

Purpose:

- create the seam that shared code can depend on

Deliverables:

- `host/contract/` types for capability, object, invalidation, LAN, shell, and legacy desktop families
- one app entry point for resolving the active host
- explicit rule that current high-level backend APIs live only behind compatibility adapters

Desktop guarantee:

- desktop implementation delegates to the current preload and HTTP client
- no behavior change

Phone relevance:

- creates the future Capacitor seam without forcing a fork

Exit gate:

- new shared code can ask for host services without importing desktop globals directly
- the permanent contract shape is capability, object, invalidation, LAN, shell, and legacy desktop rather than `/open`, `/files`, `/timeline`, or `/chat` style APIs

### Step 1.2: Add The Browser Object Mirror And Application Boundary

Purpose:

- give portable-core features a browser-local opaque object store and event feed

Deliverables:

- mirror schema for opaque events, blocks, volume heads, LAN peer snapshots, and projection checkpoints
- batch import and change-notification APIs
- browser-authored object submission path that persists opaque objects through the host contract, receives durable acknowledgement, and reconciles through mirror invalidation rather than host projections
- explicit browser-owned application boundary for files, chat, identity, references, and timeline semantics

Desktop guarantee:

- mirror is additive and not yet authoritative

Phone relevance:

- creates the structure that a native LAN runtime will feed later

Exit gate:

- mirror can be seeded and incrementally updated without a full page refresh
- portable feature state can read from mirror rather than direct backend materialization
- portable feature state can author opaque objects, persist them durably through the contract, and observe them back through mirror updates without host-owned projections becoming the source of truth
- the design no longer assumes the backend will remain the long-term owner of shared-surface application crypto

### Step 1.3: Build The Desktop Host Adapter In Compatibility Mode

Purpose:

- make desktop the first host that satisfies the new contract

Deliverables:

- desktop adapter wrapping current preload helpers
- compatibility adapters around `/open`, `/files`, `/timeline`, `/events/:hash`, `/chat`, `/chat/*`, `/upload`, `/references/*`, and `/file/:hash`
- desktop watch adapters preserving source and volume watch behavior
- explicit compatibility note that `NearbytesAPI`, `FileService`, and `ChatService` are transitional only for shared surfaces
- explicit removal conditions for each compatibility adapter:
	- `/open`, `/files`, `/upload`, and `/file/:hash` lose semantic authority after Step 1.4
	- `/timeline` and `/events/:hash` lose semantic authority after Step 1.5
	- `/chat`, `/chat/*`, and `/references/*` lose semantic authority after Step 1.6

Desktop guarantee:

- desktop continues to use the current Electron and Node runtime
- no extra mandatory process hop is introduced

Phone relevance:

- proves the contract against a real host before adding Capacitor

Exit gate:

- the app boots through the host resolver with no visible regression
- shared feature code does not depend on compatibility response shapes directly
- compatibility mode is clearly temporary and not mistaken for the Phase 1 end-state architecture

### Step 1.4: Extract Portable File Browser State

Purpose:

- move the file browser to shared browser app-core logic backed by the contract and mirror

Deliverables:

- shared volume-open workflow
- shared file-list, selection, and detail state
- shared file command orchestration for upload, rename, delete, and download intents
- explicit shell-boundary handoff for file pick and file export so upload and download semantics remain browser-owned
- browser-owned file encryption, decryption, verification, and reference logic for the shared file-browser surface
- mirror-driven incremental file-list updates

Desktop guarantee:

- desktop may seed the mirror from current `/open`, `/files`, `/file`, and watch flows beneath the compatibility adapter
- that seeding is bootstrap-only and may not remain authoritative for ongoing file-browser projections
- desktop keeps current latency by reusing existing calls and incremental updates until the lower-level object path replaces them

Phone relevance:

- file browser becomes portable before the mobile shell arrives

Exit gate:

- desktop file browser uses shared app-core without losing current behavior
- shared file-browser semantics are browser-owned rather than backend-owned

### Step 1.5: Extract Portable Timeline And Event Detail

Purpose:

- move timeline and event inspection to shared browser app-core logic

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

### Step 1.6: Extract Portable Chat, Identity, And Reference Flows

Purpose:

- move chat, identity publication, and shared-surface reference flows to shared browser app-core logic

Deliverables:

- shared chat state
- shared identity state
- shared send and publish workflows
- shared reference and attachment workflows for shared surfaces
- browser-owned identity signing, chat message authoring, verification, and projection logic for the shared chat surface

Desktop guarantee:

- desktop continues to use current backend commands only beneath the compatibility adapter
- no loss of current chat behavior

Phone relevance:

- chat becomes part of the portable core before LAN phone delivery

Exit gate:

- desktop chat, identity, and reference flows run through shared app-core
- shared chat, identity, and reference semantics are browser-owned rather than backend-owned

### Step 1.7: Extract Portable LAN Presentation

Purpose:

- make peer list, transport status, and sync actions part of the portable-core UI

Deliverables:

- shared LAN peer-list models
- shared sync-action models
- shared transport-status badges and detail views
- shared stale-state and unavailable-state handling for LAN

Desktop guarantee:

- desktop keeps using the current LAN runtime and current peer and sync endpoints
- no regression in peer freshness or action response

Phone relevance:

- defines the exact UI and host data shape the phone LAN runtime must provide

Exit gate:

- desktop LAN surfaces use the shared feature code

### Step 1.8: Add The Capacitor Shell

Purpose:

- boot the same shared app under Capacitor

Deliverables:

- Capacitor host project
- capability reporting for unsupported desktop-only families
- same shared navigation inventory, shell, primary navigation, and settings or integration surfaces as desktop

Desktop guarantee:

- none of the desktop runtime path changes

Phone relevance:

- establishes the real mobile app shell before Phase 1 closeout

Exit gate:

- phone boots the full shared UI with explicit capability fallbacks instead of broken imports, hidden screens, or missing surfaces

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
- browser-authored object commit path from shared app-core into the native store with durable acknowledgement and retry-safe resume semantics
- projection invalidation and resume logic
- startup bootstrap from durable native heads instead of full scan where possible

Desktop guarantee:

- desktop path remains unchanged

Phone relevance:

- enables file browser, chat, identity, references, and timeline from the same shared app-core used on desktop

Exit gate:

- phone renders synced file browser, chat, identity, references, and timeline from shared code
- phone can author shared-surface objects, durably persist them, survive suspend or resume, and hand them off to LAN sync without transient WebView ownership of the outbound queue
- phone shared surfaces are driven by browser-owned application crypto and projections over the mirrored opaque objects

### Step 1.11: Harden Mixed-Mode Desktop

Purpose:

- prove that shared portable surfaces and desktop legacy surfaces coexist without compromise

Deliverables:

- explicit shared-versus-legacy surface and capability map
- performance review of boot, open, file change propagation, timeline refresh, chat send, and LAN freshness on desktop
- no-regression checks for updater, roots, providers, managed shares, file-manager helpers, deep links, logs, and debug surfaces
- explicit proof that shared surfaces no longer depend on Node-side application services as their source of truth

Desktop guarantee:

- this step exists specifically to protect desktop quality

Phone relevance:

- ensures phone progress did not degrade the primary shipped app

Exit gate:

- desktop remains the full product with no feature removals and no accepted performance downgrade
- temporary compatibility adapters are no longer semantically authoritative for shared surfaces

### Step 1.12: Phase 1 Release Gate

Purpose:

- close Phase 1 only when both desktop and phone goals are met

Release gate:

- desktop full functionality
- desktop no accepted efficiency, latency, or reactivity regression
- phone shared shell and full feature-surface inventory from `platform/phase-1-surface-inventory-v1.md`
- phone usable file browser
- phone usable chat and identity flows
- phone usable timeline and event detail
- phone LAN sync usable end to end, including resume behavior
- shared UI and shared browser app-core confirmed for the portable surfaces
- browser-owned application crypto and application semantics confirmed for the shared surfaces
- current Node high-level services no longer act as the source of truth for shared surfaces
- no shared-surface inventory item is omitted from phone because runtime support is missing; unsupported actions are expressed inside the shared UI through capability states

## Desktop No-Compromise Rules

The following are absolute blockers against claiming progress:

- losing any desktop-only current feature
- introducing manual refresh where the current app reacts automatically
- replacing watch streams with polling in shared UI code
- adding large binary payload conversions that materially hurt desktop responsiveness
- forcing desktop code through phone-only abstractions when the current path is already efficient
- meeting the phone schedule by forking the UI codebase
- meeting the phone schedule by expanding compatibility-only backend APIs instead of moving semantics into the browser
- declaring Phase 1 complete while shared surfaces still depend on backend-owned application crypto or materialization

## Phone Ship Rules

The following are required to avoid shipping a demo-only phone app:

- the same visual shell, navigation inventory, and feature surfaces as desktop from the same shared source files
- shared settings and integration rows remain visible in the shared UI even when the action is unsupported on phone
- real file browsing, not only sync diagnostics
- real chat, identity, and timeline, not only object counters
- LAN sync status and peer actions exposed in the UI
- synced data survives suspend, resume, and reopen flows without requiring a full destructive bootstrap each time
- unsupported runtime-backed actions fail clearly and compactly through shared capability gating rather than disappearing into a phone-only UI variant

## Compatibility Adapter Rules

Compatibility adapters may survive through Phase 1 only if all of the following remain true:

- they sit below the shared browser app-core
- new shared feature code does not depend on their response shapes directly
- they are explicitly documented as transitional
- they may populate the mirror or expose legacy desktop capabilities, but may not influence shared-surface projections or browser-owned feature state
- their removal condition is named and tied to a Phase 1 step

## Explicit Deferred Scope

Deferred until after Phase 1:

- phone MEGA runtime support
- phone provider-account runtime support
- phone managed-share runtime support
- phone roots and storage-location management runtime support
- phone updater runtime support
- full desktop runtime replacement
- transport sidecar extraction beyond what is required for Phase 1 LAN delivery

These are runtime deferrals, not UI deferrals. The corresponding shared surfaces still exist in Phase 1.

They also do not weaken the browser-owned application boundary for the shared surfaces.

## Why This Voyage Is Ordered This Way

The shared app and host contract come first because they are the durable seam.

The browser object mirror comes early because browser crypto and reactive projections need a local, renderer-friendly data source.

Desktop adopts the seam before phone so the migration can prove parity against the existing shipping app.

Capacitor arrives before a full runtime rewrite so the phone host becomes real early.

LAN runtime work lands before provider work because LAN is the actual phone Phase 1 product.

## Implementation Status Tracker

This section records concrete implementation progress against the active design line.

Implemented branch history before the current hardening loop:

- `69a44d7` `chore(mobile): add ios build helpers`
- `1544cbd` `chore(mobile): ignore xcode swiftpm metadata`
- `f46f7af` `feat(mobile): add capacitor ios shell`
- `a86e695` `refactor(ui): extract host bridge transport`
- `e269aa0` `refactor(ui): extract desktop shell host actions`
- `672a9de` `refactor(ui): extract host ui state persistence`
- `fd6859d` `feat(ui): make identity chat flow phone-usable`
- `71f502c` `docs(ui): require iphone-size shared layouts`

Status from that history:

- shared Capacitor shell exists
- host bridge extraction for the shared UI is in progress
- iPhone-size layout requirements are explicit in code and docs
- the design is still not fully implemented because shared surfaces still depend on backend-shaped app APIs and the mobile shell still needs release hardening

Checklist for the current hardening loop started on 2026-04-06:

- [ ] keep generated iOS derived-data output out of normal source control status
- [ ] narrow iOS development networking to explicit local exceptions instead of `NSAllowsArbitraryLoads`
- [ ] remove duplicate standalone join-dialog workflow markup in favor of shared dialog structure
- [ ] add focused regression coverage for extracted join-link presentation behavior
- [ ] update active implementation notes after the hardening commits land

Completion rule for this checklist:

- do not mark this hardening loop finished until the items above are implemented and this tracker is updated with the resulting commit ids