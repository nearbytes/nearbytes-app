# Phase 1 Capability Matrix v1

## Purpose

This matrix defines the intended Phase 1 behavior per host.

It assumes a strict single-codebase UI requirement:

- desktop and phone render the same feature surfaces from the same shared UI codebase;
- host differences are expressed as runtime support differences and capability states.

`Full` means the runtime backing must be fully usable on that host.

`Shared UI` means the same shared UI surface must exist on that host.

`Limited` means the shared UI exists but capability-gated runtime support is intentionally smaller.

`No runtime` means the shared UI exists but the host is not required to provide the runtime backing in Phase 1.

## Phase 1 Matrix

| Capability family | Desktop Phase 1 | Phone Phase 1 | Browser Phase 1 |
| --- | --- | --- | --- |
| Application-level crypto and projections for shared surfaces | Shared UI, Browser-owned | Shared UI, Browser-owned | Shared UI, Browser-owned |
| Storage-location and transport runtime | Shared UI, Full runtime | Shared UI, Full runtime for LAN and local store | Shared UI, Limited or browser-owned |
| Shared app shell and navigation | Shared UI, Full runtime | Shared UI, Full runtime | Shared UI, Full runtime |
| Volume open and file browser | Shared UI, Full runtime | Shared UI, Full runtime | Shared UI, Full runtime |
| Timeline and event detail | Shared UI, Full runtime | Shared UI, Full runtime | Shared UI, Full runtime |
| Chat and identity | Shared UI, Full runtime | Shared UI, Full runtime | Shared UI, Full runtime |
| LAN peers and sync actions | Shared UI, Full runtime | Shared UI, Full runtime | Shared UI, Limited runtime |
| Join-link flows | Shared UI, Full runtime | Shared UI, Limited runtime | Shared UI, Limited runtime |
| Source watch and volume watch reactivity | Shared UI, Full runtime | Shared UI, Full runtime via host events | Shared UI, Limited runtime |
| Provider account setup | Shared UI, Full runtime | Shared UI, No runtime | Shared UI, Limited runtime |
| Managed shares and incoming share flows | Shared UI, Full runtime | Shared UI, No runtime | Shared UI, Limited runtime |
| MEGA transport | Shared UI, Full runtime | Shared UI, No runtime | Shared UI, No runtime |
| Roots and storage-location management | Shared UI, Full runtime | Shared UI, No runtime | Shared UI, No runtime |
| Directory chooser and reveal-in-file-manager | Shared UI, Full runtime | Shared UI, No runtime | Shared UI, No runtime |
| Updater flows | Shared UI, Full runtime | Shared UI, No runtime | Shared UI, No runtime |
| Deep links | Shared UI, Full runtime | Shared UI, Limited runtime by host | Shared UI, Limited runtime |
| Clipboard image helpers | Shared UI, Full runtime | Shared UI, Limited runtime by host | Shared UI, Limited runtime |
| Runtime logs | Shared UI, Full runtime | Shared UI, Limited runtime | Shared UI, No runtime |
| UI debug and automation hooks | Shared UI, Full runtime | Shared UI, No runtime | Shared UI, Limited runtime |

## Interpretation

### Desktop Phase 1

Desktop remains the full product.

Portable surfaces move to shared code.

Desktop-only surfaces remain available through the legacy desktop capability family until later phases replace them.

Shared-surface application crypto is browser-owned even on desktop.

### Phone Phase 1

Phone is a LAN-first product.

It must not depend on provider accounts, MEGA, or roots management to be useful.

The same shell and full feature surfaces must exist, but unsupported runtime-backed actions are gated through capabilities rather than hidden by a forked codebase.

Shared-surface application crypto is browser-owned even when storage-location and transport stay native.

### Browser Phase 1

The browser host exists to keep portable code genuinely portable.

It is not required to match desktop capability for background runtime, providers, or desktop shell helpers.