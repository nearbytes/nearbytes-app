# Phase 1 Release Gate Status

Date: 2026-04-07
Baseline commit before this pass: 9c3856b

## Purpose

Record the honest state of the final Phase 1 release gate after the last automated repo pass.

This document is the release-gate companion to:

- `WIP.md`
- `USER.md`
- `logs/review-session-2026-04-07-mixed-mode-desktop-proof.md`

## Gate Status

Phase 1 release gate remains open.

Reason:

- required end-to-end phone LAN validation still requires real multi-host and physical iPhone execution
- desktop parity evidence improved, but one real automated MEGA regression suite now fails when unexcluded from Vitest

## Automated Checks Run In This Final Pass

### 1. Mixed-mode desktop host boundary

Command:

```text
yarn vitest run ui/src/lib/host/compatibilityHost.test.ts ui/src/lib/host/resolveHost.test.ts ui/src/lib/host/runtimeTransport.test.ts
```

Result:

- 3 files passed
- 16 tests passed

### 2. Desktop shell helper preservation

Command:

```text
yarn vitest run ui/src/lib/host/desktopShell.test.ts
```

Result:

- 1 file passed
- 5 tests passed

### 3. Managed-share desktop regression coverage

Command:

```text
yarn vitest run src/integrations/__tests__/managedShares.test.ts
```

Result:

- 1 file passed
- 53 tests passed

### 4. Embedded phone runtime durability and reopen coverage

Command:

```text
yarn vitest run ui/src/lib/host/phoneHost.test.ts ui/src/lib/host/phonePersistence.test.ts ui/src/lib/host/persistedUiState.test.ts
```

Result on the latest increments:

- 3 files passed
- 16 tests passed

What this validates:

- durable embedded authored commit queue
- durable acknowledgement and replay-safe resume
- runtime-head bootstrap for reopen without scan-first refresh where mirror heads already match

### 5. Type-check

Command:

```text
yarn type-check
```

Result:

- passed during this pass after each code increment

### 6. MEGA adapter regression suite

Command:

```text
yarn vitest run src/integrations/__tests__/megaAdapter.test.ts
```

Config change made in this pass:

- removed the stale explicit exclusion for `src/integrations/__tests__/megaAdapter.test.ts` from `vitest.config.ts`

Result:

- 1 file failed
- 8 tests failed
- 28 tests passed

The failing cases observed in this run include:

- `connects natively, lists incoming shares, and mirrors them without invoking a command executor`
- `manages native owner invitations and collaborator inventory`
- `rebuilds cr on the first invite even when fetch-nodes already lists an outgoing share on the owner root`
- `reuses the saved MEGA login to refresh an invalid session and still lists incoming shares`
- `requires reconnect when refreshing the MEGA session with saved credentials also fails`
- `issues MEGA invites with the requested writable access level`
- `replaces a stale key-manager share key with the pending inshare key when the existing key no longer decrypts the root`
- `mirrors an incoming share when a cached extra share key must be aliased onto the root key owner`

Representative failure classes:

- missing mirrored block writes (`ENOENT` on expected block files)
- session refresh path mismatch (`fetchNodesCount` and unexpected MEGA payload)
- outgoing-share key or invite handling mismatch
- incoming-share key replacement or aliasing mismatch

## Remaining Human Validation Required

The following release-gate requirements still cannot be truthfully closed by an automated repo pass alone:

- multi-host LAN verification across real machines
- physical iPhone runtime validation across suspend, resume, force-quit, and reopen
- release authority and distribution decisions

## Conclusion

The last automated Phase 1 pass improved release-gate honesty and coverage by:

- preserving the 7 of 8 implemented-item state in `WIP.md`
- surfacing the real MEGA adapter regression status instead of hiding it behind a Vitest exclusion
- recording an explicit release-gate artifact for the remaining blocker set

Phase 1 should remain open until the MEGA adapter regressions are triaged and the required human validation is completed.