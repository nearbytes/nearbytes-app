# Mixed-Mode Desktop Proof Artifact

Date: 2026-04-07
Baseline commit: 187149c

## Purpose

Record the explicit mixed-mode desktop proof artifact required by Phase 1 Step 1.11.

This artifact is scoped to:

- shared-surface no-regression evidence while desktop still carries the legacy runtime line below the host contract
- explicit shared-versus-legacy capability ownership
- automated evidence captured in-repo on this baseline

This artifact does not claim to close the full Phase 1 release gate. Human-only release validation remains tracked separately.

## Shared Versus Legacy Surface Map

Shared browser-owned surfaces that must remain the same shared UI on desktop and phone:

- hub rail and active-hub shell
- files pane
- chat pane
- preview pane
- timeline panel
- join hub dialog
- share hub dialog
- identity manager
- create chooser
- sources and integrations panel
- storage location panel and per-hub storage dialog
- event flow inspection panel
- reset dialog
- join-link parse, preview, and open flows
- LAN peer status and sync-action surfaces

Shared-surface source-of-truth rule on this baseline:

- shared surfaces are driven through the host contract families and browser-side mirror or projection logic
- compatibility adapters may fulfill runtime access, but they are not the intended long-term semantic owner for shared surfaces
- legacy desktop remains below the contract and is not allowed to remain the source of truth for file browser materialization, timeline projection, chat or identity projection, reference semantics, or shared-surface crypto

Legacy desktop runtime obligations that remain valid on desktop in mixed mode:

- updater and install flows
- deep-link plumbing and handoff
- filesystem chooser and reveal-in-file-manager actions
- runtime log access
- roots and storage-location management
- provider-account and managed-share operations
- desktop debug and automation hooks

## Automated Evidence

### Shared-versus-legacy host boundary

Command:

```text
yarn vitest run ui/src/lib/host/compatibilityHost.test.ts ui/src/lib/host/resolveHost.test.ts ui/src/lib/host/runtimeTransport.test.ts
```

Result:

- 3 test files passed
- 16 tests passed

What this covers:

- runtime capability exposure from the active host config
- legacy desktop family requests routed through the shared transport boundary
- watch stream routing through the shared transport boundary
- LAN list and sync routing through the shared transport boundary
- active host selection and runtime token transport behavior

### Desktop shell and file-manager helper preservation

Command:

```text
yarn vitest run ui/src/lib/host/desktopShell.test.ts
```

Result:

- 1 test file passed
- 5 tests passed

What this covers:

- chooser availability reporting
- deep-link and shell delegation behavior
- persisted desktop UI state gating
- unavailable destructive-action error behavior
- reveal-in-file-manager capability handling

### Legacy desktop managed-share preservation

Command:

```text
yarn vitest run src/integrations/__tests__/managedShares.test.ts
```

Result:

- 1 test file passed
- 53 tests passed

What this covers:

- provider-account and managed-share lifecycle preservation
- incoming-share adoption and repair behavior
- reconnect and recovery flows for MEGA-backed managed shares
- storage-path preservation and account-scoped folder behavior
- disconnect behavior without silent rerouting

## Architectural Proof Notes

Evidence in the current codebase supports the mixed-mode desktop boundary claim:

- the permanent app-facing seam is the host contract family split in `ui/src/lib/host/contract.ts`
- the compatibility desktop line remains an adapter in `ui/src/lib/host/compatibilityHost.ts`
- browser-mirror and invalidation handling remain in the shared UI layer rather than being owned by Node-side product services
- recent embedded-phone runtime work proves the shared surfaces can operate against durable object and invalidation feeds without making Node-side app services semantically authoritative

## Remaining Human-Oriented Checks

This artifact intentionally does not claim completion for the following Step 1.11 and Step 1.12 concerns:

- measured desktop performance review for boot, volume open, visible file-change propagation, timeline update propagation, chat send confirmation, and LAN freshness
- updater release-path validation beyond unit-level shell coverage
- live provider validation beyond the managed-share regression suite
- the existing `mega-adapter-vitest` blocker called out in `USER.md`
- end-to-end desktop parity signoff and release authority decisions

## Conclusion

The mixed-mode desktop proof artifact now exists in-repo and captures:

- the explicit shared-versus-legacy surface map
- automated no-regression evidence for host routing, desktop shell helpers, and managed-share preservation
- the boundary claim that shared surfaces are no longer supposed to treat the legacy desktop line as their semantic source of truth

The remaining release-closeout work stays open and should be handled under the final release-gate item rather than silently folded into this proof step.