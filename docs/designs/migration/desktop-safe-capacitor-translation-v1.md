# Desktop-Safe Capacitor Translation v1

## Objective

Add a Capacitor host without weakening the shipped desktop app and without forking the shared web application.

The entire UI surface is expected to exist on desktop and mobile from the same shared codebase. Host differences are limited to runtime support and capability states.

## Acceptance Bar

- Desktop remains fully functional after every phase.
- Browser and desktop use the same shared app-core for every translated surface.
- Desktop and mobile use the same shared UI source tree for every feature surface.
- Shared surfaces end Phase 1 with browser-owned application crypto and semantics.
- Mobile-only code enters through host adapters, not through UI forks.
- No phase requires a flag day move of `ui/`, `electron/`, or `src/`.

## Three From-Scratch Revisions

### Revision 1: Fork `ui/` For Mobile

Rejected.

- It is the fastest path to a demo.
- It guarantees divergence in state, styling, and bug fixes.
- It violates the goal that anything ported to mobile should also land in the browser and desktop shared code.

### Revision 2: Immediate `apps/*` Plus `packages/*` Split

Rejected.

- It is the cleanest end-state hierarchy.
- It front-loads path churn before any host abstraction exists.
- It creates unnecessary desktop regression risk while the old and new seams are still undefined.

### Revision 3: Replace The Runtime First, Then Add Capacitor

Rejected.

- It is attractive if the runtime rewrite is the main objective.
- It delays the actual mobile host.
- It forces LAN and provider decisions before the UI and host bridge are stable.

### Selected Design: Bridge-First Progressive Translation

Accepted.

- It keeps the desktop app shippable.
- It unlocks a Capacitor shell early.
- It lets runtime work proceed behind a stable app-facing seam.
- It permits desktop, browser, and mobile to share translated code immediately.

## Phase Plan

### Phase 0: Freeze Current Host Behavior

Define the typed host contract from the existing Electron preload surface and the current fetch-based API client.

Desktop guarantee:

- zero behavior change
- same Electron preload surface
- same Node runtime

Exit criteria:

- every desktop-only capability is named in the contract
- browser-only absence is represented as a capability gap, not as a missing import

### Phase 1: Introduce Host Adapters Without Moving Behavior

Add `host/contract/`, `host/desktop/`, and `host/browser/`.

Desktop guarantee:

- desktop adapter delegates to the existing preload and HTTP flows
- browser adapter delegates to the current browser-safe paths
- `ui/src/lib/` remains as a shim layer while call sites migrate

Exit criteria:

- the app can resolve its host through one entry point
- no product behavior has changed yet

Note:

- this phase may still sit above backend-owned application services temporarily, but it does not define the final browser-owned boundary

### Phase 2: Extract Shared App-Core From UI Shell Code

Move state orchestration and workflows out of host-coupled helpers and out of the largest UI entry points.

Desktop guarantee:

- desktop still runs through the same runtime and preload bridge
- extracted code is shared with browser immediately

Exit criteria:

- ported logic depends on the host contract, not on direct desktop globals
- feature modules can be tested or reasoned about without Electron context

### Phase 3: Add A Minimal Capacitor Shell

Create a Capacitor host that boots the same shared web app.

Desktop guarantee:

- desktop host remains the default fully capable implementation
- Capacitor starts with a smaller capability set rather than forcing desktop downgrades

Exit criteria:

- mobile can boot the shared app
- missing mobile runtime capabilities surface as explicit shared unsupported states, not breakage or missing screens

### Phase 4: Port LAN Sync Through The Host Contract

Make LAN sync the first runtime-heavy feature translated through the bridge.

Desktop guarantee:

- desktop continues to use the current Node LAN runtime until the replacement path proves parity
- browser uses the same shared presentation logic even if it reports reduced capability

Exit criteria:

- peer lists, transport status, and sync requests are exposed through the host contract
- LAN-specific UI no longer imports desktop-specific helpers directly

### Phase 5: Introduce Background Runtime Ownership Per Host

Keep the shared app stable while each host chooses its runtime backing.

Desktop guarantee:

- desktop may keep the current runtime for as long as needed
- swapping runtime internals does not require UI rewrites

Exit criteria:

- runtime ownership is entirely behind the bridge
- the app shell does not care whether LAN comes from Node, native mobile code, or a future shared daemon
- shared-surface application semantics are no longer owned by the runtime beneath the bridge

### Phase 6: Extract Optional Sidecars Only After Bridge Stability

Move MEGA or future transports only when the bridge and shared app surface are already stable.

Desktop guarantee:

- current desktop provider flows remain valid until a sidecar or replacement proves parity
- no provider rewrite blocks the UI and LAN translation

Exit criteria:

- provider runtimes can evolve independently of the shared app

## What Must Never Happen Mid-Migration

- no mobile-only copy of the UI tree
- no desktop-only and mobile-only versions of the same feature component
- no removal of desktop-only features before a compatible bridge path exists
- no direct Capacitor imports from shared feature code
- no requirement that browser and desktop wait for a runtime rewrite before they can share translated code

## Regression Gates For Every Phase

Each phase is incomplete until the desktop app still supports:

- deep links
- updater state and install actions
- clipboard image flows
- directory chooser and reveal-in-file-manager actions
- runtime logs
- current account and transport flows
- the same UI feature surfaces remain present on desktop and mobile from the shared codebase, even when runtime support differs by host
- the migration step does not entrench backend-owned application crypto for the shared surfaces

## Immediate Next Move

The first code change after this design should be the introduction of a typed host contract and desktop/browser adapters that wrap the existing runtime behavior without changing it.

Detailed Phase 1 voyage: `migration/phase-1-voyage-v1.md`.