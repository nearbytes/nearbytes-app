# Desktop-Safe Capacitor Translation v1

## Objective

Add a Capacitor host without weakening the shipped desktop app and without forking the shared web application.

The entire UI surface is expected to exist on desktop and phone from the same shared codebase. Host differences are limited to runtime support, capability states, shell integration, and device-appropriate layout density.

## Translation Invariants

- desktop remains fully functional after every phase;
- browser, desktop, and phone use the same shared browser app-core for every translated shared surface;
- desktop and phone use the same shared UI source tree and navigation inventory for every product surface;
- shared surfaces end Phase 1 with browser-owned application crypto and semantics;
- phone-only code enters through host adapters or native runtime services, not through UI forks or app-core forks;
- compatibility adapters are explicitly transitional, capped, and shrinking;
- no phase requires a flag day move of `ui/`, `electron/`, or `src/`.

## Three From-Scratch Revisions

### Revision 1: Fork `ui/` For Phone

Rejected.

- it is the fastest path to a demo;
- it guarantees divergence in state, styling, and bug fixes;
- it violates the rule that anything ported to phone must land in browser and desktop shared code at the same time.

### Revision 2: Immediate `apps/*` Plus `packages/*` Split

Rejected.

- it is the cleanest end-state hierarchy;
- it front-loads path churn before any host abstraction exists;
- it creates unnecessary desktop regression risk while the old and new seams are still undefined.

### Revision 3: Replace The Runtime First, Then Add Capacitor

Rejected.

- it is attractive if the runtime rewrite is the main objective;
- it delays the actual phone host;
- it forces LAN and provider decisions before the UI, browser-owned boundary, and host bridge are stable.

### Selected Design: Bridge-First Progressive Translation

Accepted.

- it keeps the desktop app shippable;
- it unlocks a real Capacitor shell before the full runtime rewrite is finished;
- it lets shared-surface semantics move into browser code behind a stable app-facing seam;
- it permits desktop, browser, and phone to share translated code immediately.

## High-Level Phase Plan

### Phase 0: Freeze Current Capability And Surface Inventory

Define the typed host contract and shared-surface inventory from the existing Electron preload surface, the current fetch-based API client, and the current desktop navigation and surface inventory.

Desktop guarantee:

- zero behavior change
- same Electron preload surface
- same Node runtime

Exit criteria:

- every desktop-only capability is named in the contract inventory
- every current desktop surface is mapped either to the portable core line or the legacy desktop family
- the canonical shared-surface baseline is captured in `platform/phase-1-surface-inventory-v1.md`
- phone obligations are expressed as capability gaps, not as missing screens or future forks

### Phase 1: Introduce Host Contract And Compatibility Adapters

Add `host/contract/`, `host/desktop/`, `host/browser/`, and explicit compatibility adapters below the contract.

Desktop guarantee:

- desktop adapter delegates to the existing preload and HTTP flows
- browser adapter delegates to the current browser-safe paths
- `ui/src/lib/` remains as a shim layer while call sites migrate

Exit criteria:

- the app can resolve its host through one entry point
- no product behavior has changed yet
- the permanent contract shape is capability, object, invalidation, LAN, shell, and legacy-desktop oriented rather than backend-shaped feature APIs

### Phase 2: Extract Shared Browser App-Core And Mirror Foundation

Move state orchestration and workflows out of host-coupled helpers and establish the browser object mirror needed for browser-owned semantics.

Desktop guarantee:

- desktop still runs through the same runtime and preload bridge
- extracted code is shared with browser immediately

Exit criteria:

- ported logic depends on the host contract, not on direct desktop globals
- the mirror can be seeded and incrementally updated
- feature modules can be tested or reasoned about without Electron context

### Phase 3: Establish Browser-Owned Shared Surfaces On Desktop Mixed-Mode

Move shared file, timeline, chat, identity, and reference semantics into browser code while desktop continues to use its current runtime beneath the bridge.

Desktop guarantee:

- desktop remains the primary full-capability host
- no accepted regression in efficiency, latency, or reactivity

Exit criteria:

- shared surfaces are browser-owned on desktop
- current backend-shaped services survive only as compatibility adapters or runtime fulfillment
- shared feature code no longer depends on backend-owned materialization as its source of truth

### Phase 4: Add The Full Shared Capacitor Shell

Create a Capacitor host that boots the same shared web app with the same shared navigation inventory and the same shared feature surfaces.

Desktop guarantee:

- desktop host remains the default fully capable implementation
- phone starts with a smaller capability set rather than forcing desktop downgrades

Exit criteria:

- phone boots the full shared UI surface inventory defined in `platform/phase-1-surface-inventory-v1.md`
- missing phone runtime capabilities surface as explicit shared unavailable states rather than breakage or missing screens
- this phase is explicitly a shell milestone, not a release-complete phone host milestone

### Phase 4.1: Harden The Mobile Shared Shell

Purpose:

- make the shared shell releasable on phone without weakening the shared-codebase rule

Deliverables:

- generated iOS build output stays outside source control and does not pollute working trees
- iOS development traffic is explicitly scoped to local development endpoints rather than blanket arbitrary network loads
- modal-heavy shared surfaces use the shared dialog primitives or a shared dialog body, not phone-specific duplicate overlays
- focused regression coverage lands when mobile layout fixes are made to join, identity, or other modal-heavy shared flows

Desktop guarantee:

- desktop behavior and desktop runtime paths remain unchanged

Phone relevance:

- prevents the phone shell from shipping as a fragile dev-only wrapper around otherwise shared UI
- keeps local developer iteration viable while preserving the rule that the phone cannot ship as a desktop-backed proxy client

Exit criteria:

- shared modal flows remain usable at iPhone sizes without duplicated host-specific workflow markup
- the mobile host allows only the minimum development network exceptions needed to boot the shared shell locally
- generated iOS build trees do not appear in normal git status output
- the design explicitly distinguishes local dev-server bootstrapping from the later independent phone runtime requirement

### Phase 5: Add Native Phase 1 LAN Runtime

Keep the shared app stable while the phone host gains durable LAN, opaque object storage, and resume behavior behind the same contract.

Desktop guarantee:

- desktop may keep the current runtime for as long as needed
- swapping runtime internals does not require UI rewrites

Exit criteria:

- phone LAN discovery, sync, and object persistence are behind the same host contract families
- phone mirror catch-up is incremental where possible
- the app shell does not care whether LAN comes from Node, native phone code, or a future shared daemon
- the phone host owns its peer identity, LAN advertisement, sync queue, and durable object store rather than delegating those responsibilities to a desktop-backed HTTP bridge
- simulator-on-same-machine testing only counts when the phone host presents as a distinct peer on the same `mDNSResponder` system and can retain synced state across relaunch without desktop runtime help

### Phase 5.1: Feed The Browser Mirror From The Native Phone Runtime

After the native runtime exists, switch the shared browser app to consume the phone-owned mirror feed instead of transient WebView-owned state.

Desktop guarantee:

- desktop runtime behavior remains unchanged
- browser-owned shared semantics stay shared across hosts

Exit criteria:

- phone file browser, timeline, chat, identity, and references render from mirrored opaque objects supplied by the native phone runtime
- browser-owned crypto and projections remain host-agnostic while runtime ownership stays native on phone
- a phone that has already synced remains useful after reopen before any fresh desktop-assisted bootstrap

### Phase 6: Extract Optional Sidecars Only After Boundary Stability

Move MEGA or future transports only when the bridge, browser-owned boundary, and shared app surface are already stable.

Desktop guarantee:

- current desktop provider flows remain valid until a sidecar or replacement proves parity
- no provider rewrite blocks the UI and LAN translation

Exit criteria:

- provider runtimes can evolve independently of the shared app

## Compatibility Adapter Budget

Compatibility adapters are allowed only if all of the following remain true:

- they sit below the shared browser app-core
- they do not define the permanent host contract
- new shared feature work does not depend on their response shapes directly
- each adapter has an explicit removal condition tied to a migration step

## What Must Never Happen Mid-Migration

- no phone-only copy of the UI tree
- no desktop-only and phone-only versions of the same feature component or shared-surface workflow
- no removal of desktop-only features before a compatible bridge path exists
- no direct Capacitor imports from shared feature code
- no requirement that browser and desktop wait for a runtime rewrite before they can share translated code
- no expansion of backend-shaped shared-surface APIs as though they were the long-term contract

## Regression Gates For Every Phase

Each phase is incomplete until the desktop app still supports:

- deep links
- updater state and install actions
- clipboard image flows
- directory chooser and reveal-in-file-manager actions
- runtime logs
- current provider, managed-share, and storage-location flows
- the same UI feature surfaces remaining present on desktop and phone from the shared codebase, even when runtime support differs by host
- no accepted regression in efficiency, latency, or reactivity for translated shared surfaces
- no entrenchment of backend-owned application crypto or semantics for the shared surfaces

Phone hardening is incomplete until the shared shell also supports:

- iPhone-size join, identity, and other dialog-heavy flows without overflow, trapped completion states, or duplicate workflow markup
- local-development networking through explicit ATS exceptions instead of blanket arbitrary-load allowances
- clean source control state after iOS simulator and Xcode build runs

Phone Phase 1 is incomplete until the product also supports:

- independent peer discovery and sync on the local network without a desktop-hosted proxy acting as the phone's practical backend
- durable local opaque-object retention across suspend, resume, and reopen flows
- distinct phone peer identity even during same-machine simulator testing

## Immediate Next Moves

1. introduce a typed host contract and desktop and browser adapters that wrap the existing runtime behavior without changing it.
2. carve the phone runtime seam so the shared shell no longer assumes desktop-owned HTTP fulfillment is the long-term phone path.
3. add the native phone LAN and object-store runtime behind that seam before calling Phase 1 complete.

Detailed Phase 1 voyage: `migration/phase-1-voyage-v1.md`.