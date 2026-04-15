# Reactive Provider-to-UI Requirements

This document captures the product and system requirements derived from the current Nearbytes design direction for provider-originated updates.

Document role:

- feature-area system requirements for provider-backed hub reactivity
- architecture constraints for runtime-to-UI semantic event delivery

This document complements, and does not replace, the codebase-wide engineering constraints in [requirements/se-practices.md](/Users/vincenzo/data/local/repos/nearbytes-app/requirements/se-practices.md).

Scope:

- provider-backed hub updates originating from `filesystem`, `lan`, and `mega`
- runtime-to-UI change delivery
- recovery behavior after disconnects or missed events
- backend modularity constraints needed to keep the runtime implementation language-independent

Out of scope:

- provider account connection flows
- historical polling-only provider implementations such as Google Drive and GitHub until they are upgraded to this model
- transport-specific packet formats internal to a provider implementation

## Goals

1. user-visible hub state must react immediately to provider-originated changes without a manual refresh action
2. the runtime-to-UI contract must not depend on Node-specific filesystem watchers or TypeScript-only in-process APIs
3. providers must publish through one modular event path rather than per-provider UI integration code
4. missed events must degrade efficiency only, not correctness

## Functional Requirements

### [REQ-RX-001] Push-Driven Provider Updates

The system must deliver provider-originated hub updates to the UI through a push channel rather than by scheduled polling in the UI.

Acceptance criteria:

- a change imported from `filesystem`, `lan`, or `mega` triggers a runtime-to-UI event without requiring a UI timer tick
- the UI does not require a manual refresh to show the imported change
- the UI may still perform an explicit recovery fetch after receiving a push event

### [REQ-RX-002] Single Volume-Scoped Event Contract

The runtime must expose one volume-scoped event contract for provider-originated updates.

Acceptance criteria:

- the contract is keyed by hub `volumeId`
- `filesystem`, `lan`, and `mega` can publish into the same bus without UI code branching by provider implementation details
- the UI subscribes through a single watch family for semantic hub events

### [REQ-RX-003] Semantic Events, Not Provider-Specific UI Payloads

The runtime-to-UI event payload must communicate semantic refresh intent and cursor hints rather than provider-internal packet details.

Acceptance criteria:

- the payload identifies the target `volumeId`
- the payload indicates which projections are invalidated, at minimum `files`, `timeline`, and `chat`
- provider-specific remote protocol payloads are not exposed directly to the shared UI

### [REQ-RX-004] Immediate Local Visibility Publication

Each supported provider path must publish the semantic event as soon as the runtime has made the imported hub change locally visible.

Acceptance criteria:

- `filesystem` publishes when the runtime detects a relevant watched-path change for the hub
- `lan` publishes immediately after a newly imported hub event is written locally
- `mega` publishes immediately after a recipient mirror apply or delete makes the hub change locally visible

### [REQ-RX-005] Cursor-Driven Recovery

The UI must recover from dropped connections or missed push events using the timeline delta cursor model rather than full-time polling.

Acceptance criteria:

- the UI uses the latest accepted event-hash cursor when processing a pushed semantic event
- the runtime may respond with `reset: true` when the cursor is no longer usable
- the UI replaces its local projection when reset is required

### [REQ-RX-006] Shared UI Behavior Across Hosts

The reactive provider-to-UI model must be available through the shared UI host contract, including desktop/web compatibility hosts and the embedded phone host.

Acceptance criteria:

- the host contract exposes the semantic volume-event stream explicitly
- desktop/web hosts map that stream to a runtime transport endpoint
- phone host implementations expose an equivalent semantic stream even when backed by embedded runtime facilities

## Architecture Requirements

### [REQ-ARCH-RX-001] Language-Neutral Backend Boundary

The backend boundary for runtime-to-UI change delivery must be language-neutral.

Rationale:

- the backend is expected to remain implementable in multiple languages
- UI correctness must not depend on a specific in-process runtime language or object model

Acceptance criteria:

- the runtime-to-UI contract is defined as a versioned wire protocol
- the UI can consume the stream without importing backend implementation types
- changing the backend implementation language does not require changing the shared UI semantics

### [REQ-ARCH-RX-002] Modular Producer Integration

Provider producers must attach to a shared runtime bus rather than directly mutating UI-specific pathways.

Acceptance criteria:

- adding a new provider requires implementing a producer adapter, not inventing a new UI event family
- the bus is instantiated once per runtime process and shared by runtime subsystems
- routing from producer to UI stream does not require the UI to know which producer emitted the change in order to refresh correctly

### [REQ-ARCH-RX-003] Compatibility Fallback

The system may retain legacy invalidation or watcher paths during migration, but the semantic runtime event path is the normative path for provider-backed hub reactivity.

Acceptance criteria:

- legacy invalidation mechanisms are treated as compatibility or fallback behavior
- new provider-reactivity work must target the semantic event path first

## Non-Functional Requirements

### [NFR-RX-001] No Scheduled UI Polling For Owned Provider Data

The shared UI must not rely on periodic polling to discover changes in provider-backed hub data that the runtime already owns.

Allowed exception:

- an explicit recovery fetch after a pushed event or reconnect

### [NFR-RX-002] Efficiency-Only Failure Mode

Loss of a push event, stream reconnect, or stale cursor must degrade efficiency only, not correctness.

### [NFR-RX-003] Traceability

The system requirements in this document are realized by the transport specification in [docs/specs/transport/runtime-volume-events-v0.1.md](/Users/vincenzo/data/local/repos/nearbytes-app/docs/specs/transport/runtime-volume-events-v0.1.md).

Related specifications:

- [docs/specs/application/hash-cursor-refresh-v0.1.md](/Users/vincenzo/data/local/repos/nearbytes-app/docs/specs/application/hash-cursor-refresh-v0.1.md)

## Review Checklist

- [ ] No UI timer is required to discover provider-originated hub changes
- [ ] Filesystem, LAN, and MEGA publish into the shared volume event path
- [ ] The shared UI consumes semantic volume events rather than provider-specific payloads
- [ ] Cursor-based recovery is implemented for reconnect and missed-event cases
- [ ] The runtime-to-UI contract remains versioned and language-neutral