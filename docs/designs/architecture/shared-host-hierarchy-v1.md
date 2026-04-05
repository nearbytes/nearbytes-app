# Shared Host Hierarchy v1

## Objective

Create one shared web application that can run inside desktop, browser, and Capacitor hosts while allowing LAN sync and later runtime work to move behind a narrow host bridge.

## Non-Negotiable Constraints

- Every migration step must leave the desktop app fully functional.
- No mobile-only UI fork is allowed.
- Desktop and mobile must render the product UI from the same shared source files.
- All application-level crypto and shared-surface data semantics must live in the browser application layer.
- Anything ported for Capacitor must land in shared web code first or at the same time.
- Existing Electron and Node runtime paths remain valid until their replacements prove parity.
- Host-specific capabilities must be explicit and discoverable through a typed bridge.

## Current Source of Truth

- `ui/` contains the Svelte application and the current fetch-based client surface.
- `electron/` contains the preload bridge and desktop shell behavior.
- `src/` contains the Node runtime, storage, LAN sync, and provider integrations.

## Transitional Hierarchy

Start here. This hierarchy can be introduced without a flag day move.

```text
ui/src/
  app/
    state/
    workflows/
  features/
    hub/
    storage/
    transport/
    chat/
  host/
    contract/
    browser/
    desktop/
    capacitor/
  bridge/
    commands/
    queries/
    events/
  components/
  lib/                  # legacy compatibility surface; shrinks over time

electron/
  host/
    shell/
    bridge/

src/
  runtime/
    api/
    transport/
    providers/
  legacy/               # only after code is moved out of the current paths
```

## Meaning Of Each Layer

- `app/`: host-agnostic state, orchestration, and workflows extracted from `App.svelte` and host-coupled helpers.
- `features/`: cohesive user-visible feature areas that can be rendered in any host.
- `host/contract/`: the single app-facing interface for capabilities, storage access, sync state, and host events.
- `host/browser/`, `host/desktop/`, `host/capacitor/`: thin host adapters that satisfy the same contract.
- `bridge/`: transport-agnostic request, response, and subscription helpers shared by all hosts.
- `lib/`: compatibility layer only. No new product logic should start here once `app/`, `features/`, and `host/` exist.

## Single-Codebase UI Rule

The same UI codebase means:

- the same route and panel structure on desktop and mobile;
- the same feature components for shared product areas;
- the same app-core workflows driving those features;
- host differences expressed through capability state and runtime data, not different feature implementations.

Allowed host differences:

- capability-gated actions
- host-specific shell integration
- host-specific runtime availability and status messages

Forbidden host differences:

- separate mobile pages for the same product feature
- parallel desktop and mobile implementations of file browser, timeline, chat, or LAN views
- hiding a feature on mobile simply because its backing runtime is deferred

See also: `architecture/browser-application-crypto-boundary-v1.md`.

## Final Target Hierarchy

Only adopt this after the bridge is stable and the desktop app already runs through it.

```text
apps/
  desktop/
  web/
  mobile/

packages/
  web-app/
  app-core/
  host-contract/
  host-browser/
  host-desktop/
  host-capacitor/
  runtime-types/

services/
  desktop-runtime/
  lan-runtime/
  mega-transport/
```

## Why The Final Hierarchy Is Delayed

The `apps/*` and `packages/*` split is logically clean, but it creates path churn across `ui/`, `electron/`, and `src/`. The desktop app should first consume the new host contract while all existing code still lives in familiar places. Only then is the extraction to `apps/*` and `packages/*` low-risk.

## Desktop Preservation Rules

The following desktop behaviors are treated as parity blockers and must remain available throughout the translation:

- runtime config resolution
- deep-link connection and delivery
- remote file fetch helper
- clipboard image status and read helpers
- UI state persistence
- updater state, install, and release-page actions
- theme export and PNG export helpers
- directory chooser and reveal-in-file-manager helpers
- runtime log access

If a new hierarchy step cannot preserve one of these behaviors, the step is incomplete.

## Change Discipline

- New shared logic enters `app/`, `features/`, `host/`, or `bridge/`.
- Existing call sites may continue to import from `lib/`, but only through shims that re-export the new location.
- Physical moves are preferred only after behavior is already proven through the new abstraction.
- If a desktop and mobile view would diverge, the design must first prove why the divergence is intrinsic to the host shell rather than a missing capability state in shared UI.

## Immediate Design Consequence

The first implementation step is not a Capacitor fork. The first implementation step is a typed host contract with desktop and browser adapters that delegate to the current Electron preload bridge and the current HTTP client while preparing the move of application-level crypto and semantics into the browser layer.

Detailed target-system design: `architecture/portable-core-system-v1.md`.