# Portable Core System v1

## Objective

Define the target system that supports:

- a fully functional desktop app with all current capabilities retained;
- no regressions in desktop efficiency, latency, or reactivity at any migration step;
- a usable phone app with the same shared application shell, file browser, chat, timeline, and LAN sync in Phase 1;
- the full UI surface existing on both desktop and phone from the same shared codebase, even where runtime support differs;
- all application-level crypto for shared surfaces living in the browser application layer;
- browser-resident application logic and crypto for the portable feature line;
- modular and extensible runtime ownership on desktop and phone.

## Stated Goals

This design is considered wrong unless all of the following stay true:

1. desktop keeps every current user-visible capability;
2. desktop does not accept slower or less reactive replacements during migration;
3. phone gets a real product surface, not a demo shell;
4. whatever is ported to phone also becomes shared with the browser and desktop shared app;
5. LAN is the first portable runtime feature;
6. MEGA and future transports plug in without forcing a fork of the shared app.
7. desktop and mobile expose the same UI surface from the same shared UI codebase.
8. application-level crypto and application-level semantics for shared surfaces are browser-owned.

## Architectural Thesis

The system is split into two explicit lines:

1. the portable core line;
2. the desktop legacy line.

The portable core line is the future shared product line. It contains the shared web app, browser crypto, browser-side projections, and host abstractions for opaque object storage and LAN sync.

The desktop legacy line preserves the current desktop-only capabilities that are not required for phone Phase 1, including updater behavior, filesystem management helpers, provider-management flows, and existing runtime internals.

Phase 1 succeeds when the portable core line powers the shared app on desktop and phone for file browser, chat, timeline, and LAN, while the desktop legacy line still preserves every existing desktop-only feature.

## Single-Codebase UI Requirement

The user interface is a single-codebase deliverable.

That means:

1. desktop and mobile render the same feature surfaces from the same shared source tree;
2. desktop and mobile use the same feature components for file browser, timeline, chat, transport views, settings surfaces, and navigation shell;
3. a runtime gap on mobile is represented by shared capability-aware UI states, not by removing or rewriting the feature for mobile;
4. the shared UI may branch on capabilities, but it may not branch into separate desktop and mobile feature implementations.

This requirement applies even when the runtime support is intentionally smaller on phone in Phase 1.

## Browser-Owned Application Layer Requirement

All application-level crypto and product semantics for the shared surfaces are browser-owned.

This includes files, chat, identity, references, application records, and timeline interpretation.

Hosts may optionally implement storage-location and transport concerns in browser code too, but they are not required to. Those concerns may stay native as long as they remain below the application boundary.

The authoritative boundary is defined in `architecture/browser-application-crypto-boundary-v1.md`.

## System Diagram

```text
Shared Web Application
  UI Features
    file browser
    timeline
    chat
    LAN status
    settings shell
  App Core
    browser crypto
    volume projection engine
    chat/timeline projection engine
    local browser object mirror
    host capability handling
  Host Contract
    command plane
    query plane
    watch plane
    shell plane

Desktop Host
  Electron shell
  desktop host adapter
  desktop legacy bridge
  current Node runtime

Capacitor Host
  Capacitor shell
  capacitor host adapter
  native LAN runtime
  native opaque object store

Browser Host
  browser host adapter
  local browser storage only
  no background daemon
```

## Portable Core Line

The portable core line owns the features that must be shared unchanged across desktop, browser, and phone.

### Portable Core Responsibilities

- volume open and view materialization
- file browser state and commands
- timeline state and event detail rendering
- chat state, identity publication, and message sending
- LAN peer state presentation
- settings and integration surfaces as shared UI, including host-gated unsupported states where runtime support is deferred
- browser-side crypto and materialization logic
- portable capability gating

These responsibilities are not optional. The portable core becomes the source of truth for shared-surface application semantics.

### Portable Core Design Rule

The portable core consumes opaque event and block data plus typed host events. It does not depend on Electron globals, direct Capacitor imports, or desktop-only route names.

It also does not delegate shared-surface application semantics back down into the host runtime.

## Desktop Legacy Line

The desktop legacy line remains valid until the portable core has already proven itself on the shared surfaces.

### Desktop Legacy Responsibilities

- updater and install flows
- desktop deep-link plumbing
- filesystem chooser and reveal-in-file-manager actions
- runtime log access
- current roots and storage-location management flows
- current provider-account and managed-share flows
- current desktop debug and automation hooks

### Legacy Preservation Rule

The desktop legacy line may remain in the current Electron plus Node structure for as long as needed. Migrating the portable core must never require weakening these features first.

The desktop legacy line does not license a separate desktop-only UI. It only licenses desktop-specific runtime backing behind the shared UI.

## Browser Object Mirror

The portable core requires a browser-local store of opaque Nearbytes objects and derived view state.

### Why The Mirror Exists

- browser crypto remains in the shared app;
- view materialization must be fast and reactive in the renderer;
- phone cannot afford expensive per-object native bridge calls for every UI render;
- desktop parity must preserve responsiveness even while runtimes differ below the bridge.

### Mirror Contents

- opaque event objects
- opaque block objects that need browser access
- compact per-volume indexes and heads
- LAN peer snapshots and transport status snapshots
- projection checkpoints and materialization cursors

### Mirror Rules

- the mirror stores opaque encrypted application data, not plaintext files;
- derived plaintext projections are in-memory by default unless a later design explicitly allows safe persisted caches;
- host adapters may batch object imports into the mirror;
- portable core features react to mirror updates rather than re-fetching full state.

## Host Contract

The host contract is the only system boundary visible to the shared app.

### Contract Families

1. capability family
2. object family
3. projection update family
4. LAN family
5. shell family
6. legacy desktop family

### Capability Family

The shared app must be able to ask:

- which transport families are available;
- whether background sync exists;
- whether provider accounts are available;
- whether filesystem and updater operations exist;
- whether deep links, logs, clipboard image, and external-open flows exist.

Capability queries do not transfer application ownership. They only describe which lower-level services the browser application may call.

### Object Family

The shared app must be able to:

- upsert opaque events and blocks;
- fetch opaque events and blocks in batches;
- enumerate per-volume object heads and lightweight indexes;
- subscribe to object-change batches;
- request durable flushes when required.

The object family is intentionally lower-level than the current backend application APIs. It exists so the browser application can own the cryptographic meaning of those objects.

### Projection Update Family

The shared app must be able to subscribe to:

- volume-change batches;
- source/config-change notifications;
- projection invalidation events;
- bootstrap completion events.

### LAN Family

The shared app must be able to:

- list peers;
- inspect sync and health state;
- request sync against a peer or a set of volumes;
- subscribe to LAN runtime state changes.

### Shell Family

The shared app must be able to request:

- file pick and share-sheet actions;
- open-external or open-release-page actions;
- UI-state persistence;
- theme export and logo export where supported.

### Legacy Desktop Family

Desktop-only flows that remain outside the portable core in Phase 1 are still exposed through the same host contract, but as a desktop-only capability set.

This covers:

- provider account and managed-share operations
- roots and storage-location management
- updater flows
- runtime logs
- file manager helpers

The shared UI still renders the corresponding product surfaces on mobile, but mobile resolves them through capability-aware unavailable states until runtime support arrives.

The legacy desktop family must not become a back door for keeping shared-surface application crypto in the runtime indefinitely.

## Runtime Composition Per Host

### Desktop Host

Desktop runs in mixed mode during Phase 1.

The portable core features use the shared host contract.

The legacy desktop features continue to delegate to the existing Electron preload and Node runtime paths.

Desktop is allowed to keep the current runtime internals, but the shared app must stop depending on those internals directly.

For shared surfaces, the desktop host must move toward supplying opaque objects and host capabilities rather than browser-invisible application materialization.

### Capacitor Host

Capacitor runs the same shared web application with a smaller capability set.

Its Phase 1 native runtime owns:

- local opaque object storage
- LAN discovery and sync
- LAN peer state persistence
- bridge notifications that feed the browser object mirror

Its Phase 1 native runtime does not need to own:

- browser crypto
- MEGA
- provider account UI beyond unsupported capability states

It must also not become the owner of shared-surface application semantics merely because it is native.

### Browser Host

The browser host exists to keep portable code portable.

It owns:

- local browser storage only
- shared UI and browser crypto
- no background LAN runtime by default

Its purpose is architectural discipline, not feature parity with desktop.

It also acts as the proof that the application layer truly lives in browser code.

## Reactivity Model

The system is explicitly event-driven.

### Required Reactive Paths

- desktop source watch remains push-based
- desktop volume watch remains push-based
- portable core projections update from change batches, not manual refresh
- phone LAN state updates arrive as runtime events, not polling-only fetch loops

### Forbidden Downgrades

- replacing a current watch stream with a manual refresh button
- replacing push updates with periodic full-list polling in the UI
- forcing desktop users through extra bridge hops for actions that already happen locally today
- solving host differences by shipping a separate mobile feature implementation

## Performance Rules

Desktop migration steps are acceptable only if they preserve current perceived speed.

### Desktop Performance Requirements

1. no extra mandatory process hop may be added to a desktop action if the current path already stays local;
2. no large binary payload should be base64-wrapped merely to pass through the new bridge;
3. no ported feature may replace incremental watch updates with full recomputation on every change;
4. no migration step may force the desktop app to wait on mobile-only runtime boot;
5. the browser object mirror must support batched upserts and incremental projection invalidation.
6. migration toward browser-owned application crypto must not introduce avoidable desktop regressions compared to the current local reference implementation.

### Phone Performance Requirements

1. the shared app must read mostly from browser-local mirrored data during active use;
2. native-to-web bridge traffic should be batch-oriented and metadata-first;
3. background LAN sync must write into durable native storage without needing the WebView to stay alive;
4. when the WebView resumes, mirror catch-up must avoid full rescan when heads or cursors prove that only incremental sync is needed.

## Phase 1 Product Surface

### Desktop Phase 1 Must Deliver

- every current desktop capability remains available;
- the shared web app powers file browser, timeline, chat, and LAN through the portable core path;
- all remaining features continue to work through the legacy desktop path;
- efficiency, latency, and reactivity are not compromised;
- application-level crypto for the shared surfaces is browser-owned.

### Phone Phase 1 Must Deliver

- the same shared application shell, navigation model, and feature structure as desktop;
- usable file browser;
- usable chat;
- usable timeline and event detail;
- LAN peer list, sync status, and sync initiation;
- the same shared settings and integration surfaces, with unsupported runtime-backed actions represented through shared capability states;
- no MEGA or provider-account requirement for the phone app to be useful;
- application-level crypto for the shared surfaces is browser-owned.

### Phase 1 Explicit Non-Goals

- phone MEGA runtime support
- phone provider account runtime support
- phone updater runtime support
- phone filesystem-root-management runtime support
- replacing the full desktop runtime before the portable core is proven

These are runtime non-goals, not UI non-goals. The corresponding shared UI surfaces still exist in Phase 1.

They are also not exceptions to the browser-owned application boundary.

## Extensibility Rules

### New Hosts

Any future host must satisfy the host contract without changing shared feature code.

### New Transports

Any future transport must plug into the runtime side and expose:

- object availability
- sync status
- optional auth/bootstrap state

without requiring UI forks.

### New Desktop Features

Any new desktop-only feature must enter through the host contract so it can later become portable or explicitly remain desktop-only.

Any new UI introduced for such a feature must still live in the shared UI codebase, with hosts differing only in capability and runtime fulfillment.

## Phase 1 Architectural End State

At the end of Phase 1:

- desktop is still the full product;
- phone is a usable LAN-first product;
- file browser, chat, timeline, and LAN are shared surfaces;
- the portable core is real, not aspirational;
- legacy desktop paths still exist where needed but are isolated behind the host contract.