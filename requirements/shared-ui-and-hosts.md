# Shared UI And Host Requirements

This document captures requirements for the shared Nearbytes UI surface and the host/runtime boundary it depends on.

Scope:

- shared UI behavior reused across desktop, web, and phone hosts
- host/runtime ownership boundaries visible to the UI
- iPhone-sized usability constraints for shared surfaces

Out of scope:

- provider-specific sync protocols
- internal storage layout details
- purely implementation-local coding style rules

## Goals

1. the shared UI must remain functionally usable across supported host types
2. host-specific runtime ownership details must not leak into user-facing behavior in inconsistent ways
3. the phone host must reuse the shared UI and shared TypeScript runtime logic wherever the capability allows

## Functional Requirements

### [REQ-HOST-001] Shared UI Must Remain Phone-Usable

The shared UI must remain operable at iPhone-sized widths.

Acceptance criteria:

- primary flows remain usable around `390px` width
- key actions are reachable without horizontal overflow
- dialogs and workspace panes collapse to a phone-usable layout rather than assuming wide desktop space

### [REQ-HOST-002] Core Shared Flows Must Exist On Phone

The phone host must expose the core shared flows supported by the shared UI, including opening a hub, adding a hub, file operations, and local chat operations.

Acceptance criteria:

- the shared UI does not hide the primary create/open hub flow on phone-sized layouts
- phone host implementations support the shared file and chat flows when those flows are locally owned by the embedded runtime

### [REQ-HOST-003] Host Contract Must Be Explicit

Capabilities provided by a host must be expressed through an explicit host contract rather than inferred from desktop-only assumptions in shared UI code.

Acceptance criteria:

- the shared UI talks to host families through explicit capability and operation contracts
- desktop/web and phone hosts present compatible shapes for shared features
- unsupported capability families are signaled explicitly rather than failing silently

## Architecture Requirements

### [REQ-HOST-ARCH-001] Runtime Ownership Must Be Deliberate

The shared UI must not assume that all capabilities are browser-owned or all capabilities are externally runtime-owned.

Acceptance criteria:

- runtime ownership is declared by the host
- shared UI logic can operate against embedded and non-embedded runtime owners without changing user-facing semantics for supported features

### [REQ-HOST-ARCH-002] Shared TypeScript Logic Is Preferred Over Forked Host Logic

When a capability is available on multiple hosts, shared TypeScript runtime logic is the preferred implementation path over duplicating behavior per host.

Acceptance criteria:

- phone-specific glue is limited to host/plugin edges where platform integration is genuinely different
- shared file, chat, and related hub semantics remain implemented in shared logic when feasible

### [REQ-HOST-ARCH-003] Unsupported Provider Capabilities Must Be Explicit

If a host does not yet support a provider capability, that unsupported state must be explicit in the host contract and user-visible behavior.

Acceptance criteria:

- unsupported provider flows on phone do not masquerade as fully supported behavior
- host implementations return explicit unsupported behavior rather than partially working silent fallbacks

## Non-Functional Requirements

### [NFR-HOST-001] Consistent Shared Semantics

The same user action in the shared UI should preserve the same semantic meaning across hosts, even when the backing runtime owner differs.

### [NFR-HOST-002] No Desktop-Only Regression Framing

A change that improves desktop behavior while making the shared surface unusable on phone is a regression.

## Traceability

Related requirements:

- [requirements/se-practices.md](/Users/vincenzo/data/local/repos/nearbytes-app/requirements/se-practices.md)
- [requirements/reactive-provider-ui.md](/Users/vincenzo/data/local/repos/nearbytes-app/requirements/reactive-provider-ui.md)

Related specifications:

- [docs/specs/application/hub-model-v0.2.md](/Users/vincenzo/data/local/repos/nearbytes-app/docs/specs/application/hub-model-v0.2.md)

## Review Checklist

- [ ] Shared UI remains operable at iPhone size
- [ ] Host capability differences are represented explicitly in the host contract
- [ ] Shared logic is reused instead of duplicating host behavior where feasible
- [ ] Unsupported host/provider capabilities remain explicit to users and developers