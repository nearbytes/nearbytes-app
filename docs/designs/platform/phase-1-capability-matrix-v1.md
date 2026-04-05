# Phase 1 Capability Matrix v1

## Purpose

This matrix defines the intended Phase 1 behavior per host.

It assumes a strict single-codebase UI requirement:

- desktop and phone render the same feature surfaces from the same shared UI codebase;
- host differences are expressed as runtime support differences and capability states.

## Core Interpretation Rules

The canonical shared-surface baseline for any row marked `Shared UI` is defined in `phase-1-surface-inventory-v1.md`.

`Shared UI` means the same shared navigation entry point, component tree, and shared workflow owner exist on that host. It does not license a host-specific replacement implementation.

`Full runtime` means the runtime backing required for Phase 1 is usable on that host for the primary actions, reactivity, and persistence expectations defined by the Phase 1 release gate.

`Limited runtime` means the same shared UI exists but capability-gated, smaller, or foreground-only runtime support is intentionally smaller.

`Browser-local runtime` means the row may be satisfied inside the browser host with browser-safe persistence or transport helpers. It does not imply native durable background execution, provider parity, or desktop shell parity.

`No runtime` means the same shared UI exists but the host is not required to provide the runtime backing in Phase 1. The surface and its shared settings or integration rows still render and must fail clearly through shared capability states rather than host-specific hiding.

`Browser-owned` means the shared browser app-core owns the shared-surface semantics and crypto on that host. It does not imply that the host also provides full background or native runtime support.

## Phase 1 Matrix

| Capability family | Desktop Phase 1 | Phone Phase 1 | Browser Phase 1 |
| --- | --- | --- | --- |
| Shared navigation inventory and surface entry points | Shared UI, Full runtime | Shared UI, Full runtime | Shared UI, No runtime |
| Shared portable feature-state and workflow ownership | Shared UI, Browser-owned | Shared UI, Browser-owned | Shared UI, Browser-owned |
| Application-level crypto and projections for shared surfaces | Shared UI, Browser-owned | Shared UI, Browser-owned | Shared UI, Browser-owned |
| Storage-location and transport runtime | Shared UI, Full runtime | Shared UI, Full runtime for LAN and local store | Shared UI, Browser-local or limited runtime |
| Shared app shell and navigation | Shared UI, Full runtime | Shared UI, Full runtime | Shared UI, No runtime |
| Volume open and file browser | Shared UI, Full runtime | Shared UI, Full runtime | Shared UI, Browser-owned and browser-local or limited runtime |
| Timeline and event detail | Shared UI, Full runtime | Shared UI, Full runtime | Shared UI, Browser-owned and browser-local or limited runtime |
| Chat and identity | Shared UI, Full runtime | Shared UI, Full runtime | Shared UI, Browser-owned and browser-local or limited runtime |
| References and attachments | Shared UI, Full runtime | Shared UI, Full runtime | Shared UI, Browser-owned and browser-local or limited runtime |
| LAN peers and sync actions | Shared UI, Full runtime | Shared UI, Full runtime | Shared UI, Limited runtime |
| Join-link flows | Shared UI, Full runtime | Shared UI, Limited runtime | Shared UI, Limited runtime |
| Source watch and volume watch reactivity | Shared UI, Full runtime | Shared UI, Full runtime via host events | Shared UI, Browser-local or limited runtime |
| Settings and integration surfaces | Shared UI, Full runtime | Shared UI, Limited and no runtime by capability | Shared UI, Limited runtime |
| Provider account setup | Shared UI, Full runtime | Shared UI, No runtime | Shared UI, No runtime by default |
| Managed shares and incoming share flows | Shared UI, Full runtime | Shared UI, No runtime | Shared UI, No runtime by default |
| MEGA transport | Shared UI, Full runtime | Shared UI, No runtime | Shared UI, No runtime |
| Roots and storage-location management | Shared UI, Full runtime | Shared UI, No runtime | Shared UI, No runtime |
| Directory chooser and reveal-in-file-manager | Shared UI, Full runtime | Shared UI, No runtime | Shared UI, No runtime |
| Updater flows | Shared UI, Full runtime | Shared UI, No runtime | Shared UI, No runtime |
| Deep-link system intake and shared-shell handoff | Shared UI, Full runtime | Shared UI, Limited runtime | Shared UI, Limited runtime |
| Clipboard image helpers | Shared UI, Full runtime | Shared UI, Limited runtime | Shared UI, Limited runtime |
| Runtime logs | Shared UI, Full runtime | Shared UI, Limited runtime | Shared UI, No runtime |
| UI debug and automation hooks | Shared UI, Full runtime | Shared UI, No runtime | Shared UI, Limited runtime |

## Interpretation

### Desktop Phase 1

Desktop remains the full product.

Portable surfaces move to shared code.

Desktop-only runtime fulfillment remains available through the legacy desktop capability family until later phases replace it.

Shared-surface application crypto is browser-owned even on desktop.

### Phone Phase 1

Phone is a LAN-first product.

It must not depend on provider accounts, MEGA, or roots management to be useful.

The same shell and full feature surfaces must exist, but unsupported runtime-backed actions are gated through capabilities rather than hidden by a forked codebase.

System deep-link intake is a host-runtime concern, but the destination shared surface and resulting workflow still belong to the shared UI.

Shared-surface application crypto is browser-owned even when storage-location and transport stay native.

### Browser Phase 1

The browser host exists to keep portable code genuinely portable.

It is not required to match desktop capability for background runtime, providers, or desktop shell helpers.

Browser rows marked `Browser-local runtime` or `Limited runtime` mean the shared browser app-core can still exercise the portable surface with browser-safe persistence or transport helpers.

They do not mean the browser host is expected to provide the same durable background runtime, native object store ownership, or desktop shell integration required on desktop or phone.

## Release Interpretation

Phase 1 is incomplete if any row marked `Shared UI` is implemented through host-specific feature code or omitted from phone because runtime support is missing.

Phase 1 is incomplete if any row marked `Browser-owned` still depends on Node-side or native-side application semantics as the source of truth.