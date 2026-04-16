# Nearbytes iPhone MEGA Port Plan v0.1

Status: draft normative migration plan.

This document defines the staged migration plan for bringing the shared Nearbytes MEGA runtime to the iPhone host.

Its purpose is to make the port incremental, additive, and non-destructive to already working paths such as phone LAN and desktop MEGA.

## 1. Scope

This plan defines:

1. the staged delivery sequence for shared libraries and MEGA-specific port work;
2. the compatibility gates that block premature cutover;
3. the explicit rule that unsupported phone MEGA behavior remains visible until the final stage is complete.

This plan does not define:

1. the final MEGA product UX itself;
2. desktop-only release packaging;
3. a single giant cutover patch.

## 2. Port Strategy

The port MUST happen in four additive tracks:

1. shared path storage extraction;
2. shared runtime-services extraction;
3. shared desktop MEGA rebinding to those abstractions;
4. phone host enablement of the MEGA runtime profile.

No later track MAY start by replacing a currently working path wholesale.

## 3. Stage 0: Invariants

Before any port work, these invariants MUST be treated as fixed:

1. phone LAN remains governed by `transport/lan-sync-v0.4.md` and `transport/storage-commands-v0.1.md`;
2. runtime-to-UI provider reactivity remains governed by `transport/runtime-volume-events-v0.1.md`;
3. phone provider capability remains explicit unsupported behavior until full enablement;
4. desktop remains the normative MEGA runtime host.

## 4. Stage 1: Shared Path Storage

Deliverable:

1. implement the shared storage contract from `storage/shared-path-storage-v0.1.md` behind existing host backends.

Rules:

1. desktop MAY bind the contract to filesystem-backed storage;
2. phone MAY bind the contract to IndexedDB-backed storage;
3. no provider or LAN wire behavior may change in this stage.

Acceptance gate:

1. phone LAN imported blocks and events still persist under the same logical paths.

## 5. Stage 2: Shared Runtime Services

Deliverable:

1. implement the shared runtime services bundle from `transport/shared-runtime-services-v0.1.md`.

Rules:

1. the existing phone LAN implementation MAY be rebound to the new service bundle;
2. rebinding MUST preserve the same control-channel, storage-command, and semantic event behavior;
3. no MEGA capability is enabled on phone in this stage.

Acceptance gate:

1. phone LAN remains wire-compatible and behavior-compatible with the current working path.

## 6. Stage 3: Shared Desktop MEGA Rebinding

Deliverable:

1. move desktop MEGA runtime logic onto shared path storage and shared runtime services while keeping desktop as the active host.

Rules:

1. the desktop path stays normative;
2. MEGA logic extraction MUST prove itself first on the current working desktop path;
3. phone host behavior remains explicit unsupported for provider capability.

Acceptance gate:

1. desktop MEGA owner-share, incoming-share, reconnect, and reactive update behavior remain unchanged.

## 7. Stage 4: Phone-Internal MEGA Runtime Bring-Up

Deliverable:

1. satisfy `transport/mega-runtime-v0.1.md` inside the phone host behind a non-default capability gate.

Rules:

1. phone-internal MEGA runtime work MAY exist without public enablement;
2. the host contract MUST still report provider capability unsupported until all final gates pass;
3. LAN and local embedded runtime behavior MUST remain unaffected.

Acceptance gate:

1. the phone-internal MEGA runtime can connect, restore, and materialize local MEGA-backed Nearbytes state without regressing phone LAN.

## 8. Stage 5: Public Phone Capability Enablement

The host contract MAY expose phone MEGA support only after all prior stages are complete.

Required gates:

1. phone LAN still passes its current behavior matrix;
2. desktop MEGA still passes its current behavior matrix;
3. phone MEGA connect, restore, recipient mirror apply, and semantic push publication work through the shared host contract;
4. unsupported-provider fallbacks are removed only where phone support is actually complete.

## 9. Cutover Rules

The port MUST use additive cutovers.

Rules:

1. shared abstractions are introduced behind adapters first;
2. working paths are rebound one at a time;
3. host capability flags change only after the full target path is proven;
4. no stage may merge by deleting the current working implementation first and rebuilding afterward.

## 10. Required Non-Regression Matrix

Every implementation stage MUST preserve these working paths:

1. phone LAN discovery, connect, storage-command import, and semantic volume events;
2. embedded phone local file and chat flows;
3. desktop MEGA connect, reconnect, owner publish, incoming-share materialization, and semantic push publication;
4. explicit unsupported phone-provider behavior until enablement.

If a stage cannot preserve the full matrix, it MUST remain feature-gated and MUST NOT replace the working default path.

## 11. Review Rule

A change claiming to advance the iPhone MEGA port is incomplete if it does either of these:

1. weakens phone LAN behavior to make MEGA easier to add;
2. changes the host contract or UI to imply phone MEGA support before the runtime profile is actually complete.