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
- desktop parity evidence improved, and the previously hidden MEGA adapter suite is now fully green after repo-side fixes

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

- 1 file passed
- 36 tests passed

Latest final rerun result:

- `yarn vitest run src/integrations/__tests__/megaAdapter.test.ts`
- 1 file passed
- 36 tests passed

Repo-side progress completed after the initial release-gate capture:

- fixed recipient bootstrap so repeated `ensureSync` calls preserve the stored manifest cursor and can use MEGA action-packet incremental updates
- fixed incoming-share key aliasing so cached extra share keys can be attached through 11-character MEGA user-handle owners as well as 8-character node handles
- removed the eager `fetch-nodes` call from `connect()` so session refresh recovery does not over-fetch or take the wrong reconnect path
- enabled owner share-key fallback from snapshot data even when the owner root has no separate explicit share handle
- passed fetched snapshots into key-manager share-key resolution so pending inshare keys can replace stale persisted keys before caching
- reran `megaAdapter.test.ts` to green: 36 passed

Actionable triage buckets for the next repo-side pass:

- incoming-share mirror write bucket
	- status:
		- closed in the repo-side pass
	- fixes landed:
		- recipient sync bootstrap no longer clears the persisted manifest cursor on every `ensureSync`
		- cached extra share keys now alias through MEGA user-handle key owners
	- verification:
		- `connects natively, lists incoming shares, and mirrors them without invoking a command executor` now passes
		- `mirrors an incoming share when a cached extra share key must be aliased onto the root key owner` now passes

- session refresh bucket
	- status:
		- closed in the repo-side pass
	- fixes landed:
		- `connect()` no longer performs an eager `fetch-nodes` call before any share discovery path needs it
	- verification:
		- `reuses the saved MEGA login to refresh an invalid session and still lists incoming shares` now passes
		- `requires reconnect when refreshing the MEGA session with saved credentials also fails` now passes

- writable invite or share-key bucket
	- status:
		- closed in the repo-side pass
	- fixes landed:
		- owner share-key resolution now falls back to snapshot data even without a distinct explicit share handle
		- internal share-key registration now accepts the 8 to 11 character MEGA handle shapes used across node and mocked owner-share records
		- incoming-share discovery now persists pending inshare replacements using the fetched snapshot when validating key-manager state
	- verification:
		- `manages native owner invitations and collaborator inventory` now passes
		- `rebuilds cr on the first invite even when fetch-nodes already lists an outgoing share on the owner root` now passes
		- `issues MEGA invites with the requested writable access level` now passes
		- `replaces a stale key-manager share key with the pending inshare key when the existing key no longer decrypts the root` now passes

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

Phase 1 should remain open until the required human validation is completed.