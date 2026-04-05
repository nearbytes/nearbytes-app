# Shared Host Hierarchy v1

## Objective

Create one shared web application and one shared browser application core that run inside desktop, browser, and Capacitor hosts while keeping host differences behind a narrow, typed host contract.

## Non-Negotiable Constraints

- Every migration step must leave the desktop app fully functional.
- No phone-only or desktop-only UI fork is allowed for the same product surface.
- Desktop and phone must render the same shared navigation inventory, shared feature surfaces, and shared workflows from the same source files.
- Host differences are allowed only through capability states, runtime support differences, shell integration, and responsive layout adjustments.
- All application-level crypto and shared-surface data semantics must live in the browser application layer.
- Anything translated for Capacitor must land in shared web code first or at the same time.
- Existing Electron and Node runtime paths remain valid only behind the host contract until their replacements prove parity.
- The current Node reference implementation is transitional and may not grow into the long-term owner of shared file, chat, identity, reference, or timeline semantics.
- Host-specific capabilities must be explicit and discoverable through a typed bridge.

## Current Source Of Truth

- `ui/` contains the Svelte application and the current fetch-based client surface.
- `electron/` contains the preload bridge and desktop shell behavior.
- `src/` contains the Node runtime, storage, LAN sync, and provider integrations.

## Transitional Hierarchy

Start here. This hierarchy can be introduced without a flag day move.

```text
ui/src/
  features/              # shared UI surfaces only
  app/                   # shared browser app-core
    state/
    workflows/
    projection/
    crypto/
    mirror/
  host/
    contract/
    browser/
    desktop/
    capacitor/
    compatibility/       # explicit transitional adapters only
  bridge/
    commands/
    queries/
    events/
  components/
  lib/                   # compatibility surface; shrinks over time

electron/
  host/
    shell/
    bridge/

src/
  runtime/
    api/
    transport/
    providers/
  legacy/                # current Node/Electron implementation retained behind adapters
```

## Meaning Of Each Layer

- `features/`: shared UI entry points, panels, dialogs, forms, and capability-aware unavailable states.
- `app/`: shared browser app-core that owns product workflows, crypto, projection logic, mirror usage, and feature state.
- `host/contract/`: the permanent app-facing seam for capability, object, invalidation, LAN, shell, and legacy desktop families.
- `host/browser/`, `host/desktop/`, `host/capacitor/`: thin host adapters that satisfy the same contract.
- `host/compatibility/`: transitional wrappers around current backend-shaped desktop APIs. This layer exists only to help migration and does not define the target boundary.
- `bridge/`: serialization, request, response, and subscription helpers shared by all hosts.
- `lib/`: compatibility layer only. No new product logic should start here once `features/`, `app/`, and `host/` exist.
- `electron/host/*`: desktop shell and preload wiring below the shared contract.
- `src/runtime/*` and `src/legacy/*`: runtime services, storage-location and transport code, and the current desktop compatibility line.

## Dependency Direction

The required dependency direction is:

```text
shared UI -> shared browser app-core -> host contract -> host adapters -> runtime services
```

Nothing above the host contract may import Electron, Capacitor, Node-only modules, or current desktop runtime services directly.

The legacy desktop runtime may keep its current internal structure during Phase 1, but it must only be reachable through the host contract or explicit compatibility adapters.

## Single-Codebase UI Rule

The same UI codebase means:

- the same shared navigation inventory and primary navigation surfaces on desktop and phone;
- the same feature modules, state ownership, and action workflows for shared surfaces;
- the same settings and integration surfaces, even when a host lacks runtime backing for some actions;
- the same settings rows, sections, and integration affordances for a shared surface, with missing runtime expressed as disabled or annotated shared UI rather than per-host row removal;
- responsive or shell-specific layout differences are allowed, but feature ownership is not.

Today the app shell is mount-centric and panel or dialog-driven rather than URL-router-driven. This rule applies to that navigation inventory just as strictly as it would apply to URL routes.

The current Phase 1 shared-surface baseline is defined in `platform/phase-1-surface-inventory-v1.md`.

Allowed host differences:

- capability-gated action availability
- host-specific copy describing unavailable runtime support
- shell integration affordances such as pickers, share sheets, and updater actions
- device-appropriate layout density and navigation chrome

Forbidden host differences:

- separate phone-only navigation entries or screens for the same product feature
- parallel desktop and phone implementations of file browser, timeline, chat, identity, reference, or LAN surfaces
- separate phone-only state or workflow modules for a shared surface
- hiding a surface on phone simply because its backing runtime is deferred
- using a shared screen while silently keeping its semantics in a desktop-only backend service

## Shared UI Versus Legacy Desktop

The legacy desktop line preserves current desktop-only runtime support. It does not license a separate desktop-only UI tree.

Desktop-only runtime-backed feature surfaces still render from the shared UI codebase. On hosts without runtime support, those same shared surfaces resolve through capability-aware unavailable states.

The legacy desktop line is allowed to own runtime fulfillment for:

- updater and install flows
- deep-link plumbing
- filesystem chooser and reveal-in-file-manager actions
- runtime log access
- roots and storage-location management
- provider-account and managed-share operations
- desktop debug and automation hooks

The legacy desktop line is not allowed to remain the source of truth for shared-surface application semantics such as file browser materialization, timeline projection, chat and identity projection, reference semantics, or shared-surface crypto.

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
  transport-sidecars/
```

## Why The Final Hierarchy Is Delayed

The `apps/*` plus `packages/*` split is logically clean, but it creates path churn across `ui/`, `electron/`, and `src/`. The desktop app should first consume the new host contract while all existing code still lives in familiar places. Only then is the extraction to `apps/*` and `packages/*` low-risk.

## Desktop Preservation Rules

The following desktop behaviors are parity blockers and must remain available throughout the translation:

- runtime config resolution
- deep-link connection and delivery
- remote file fetch helper
- clipboard image status and read helpers
- UI state persistence
- updater state, install, and release-page actions
- theme export and PNG export helpers
- directory chooser and reveal-in-file-manager helpers
- runtime log access
- current provider-account setup and managed-share flows
- roots and storage-location management
- current debug and automation hooks

If a hierarchy step cannot preserve one of these behaviors, the step is incomplete.

## Change Discipline

- New shared logic enters `features/`, `app/`, `host/`, or `bridge/`.
- Existing call sites may continue to import from `lib/`, but only through shims that re-export the new location.
- Physical moves are preferred only after behavior is already proven through the new abstraction.
- If a desktop and phone view would diverge, the design must first prove why the divergence is intrinsic to shell chrome rather than a missing capability state in shared UI.
- New shared work may not expand the current backend-shaped desktop APIs as though they were the permanent app contract.

## Immediate Design Consequence

The first implementation step is a typed host contract whose permanent shape is capability, object, invalidation, LAN, shell, and legacy-desktop oriented.

Current app-shaped routes and services such as `/open`, `/files`, `/timeline`, `/chat`, `/upload`, `/references/*`, `FileService`, `ChatService`, and `NearbytesAPI` may survive only behind explicit compatibility adapters. They do not define the target architecture for shared surfaces.

Detailed boundary rules: `architecture/host-contract-runtime-boundary-v1.md` and `architecture/browser-application-crypto-boundary-v1.md`.