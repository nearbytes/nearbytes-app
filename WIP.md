# WIP

## Current Status

- Phone managed-share reads are now embedded and browser-backed.
- Implemented phone read surfaces: `listProviderAccounts`, `listManagedShares`, `listIncomingManagedShares`, `listIncomingProviderContactInvites`, `getManagedShareState`.
- `yarn dev-2` is no longer blocked by the TypeScript build errors from the MEGA live tests/runtime wrapper. It now builds, starts both targets, connects both MEGA accounts, and stops at the expected destructive wipe confirmation prompt.
- No external helper app is part of the target architecture. Remaining phone work must be delivered through shipped TypeScript plus a real native phone host/plugin bridge.

## What Was Fixed In This Pass

1. Routed phone `getManagedShareState` through the embedded managed-share service instead of returning `501`.
2. Added phone host regression coverage for embedded managed-share state inspection.
3. Removed duplicate `integrationStatePath` object keys in the MEGA live tests so the repo builds cleanly again.
4. Removed unused type aliases from `src/integrations/runtime.ts` that were failing the TypeScript build.

## Remaining Work

1. Implement phone-native provider account lifecycle:
	- `connectProviderAccount`
	- `disconnectProviderAccount`
	- `configureProviderSetup`
	- `installProviderHelper` (API name can stay for compatibility, but the implementation must be native runtime setup rather than an external helper app)
2. Implement phone-native provider inventory/runtime operations:
	- `reconcileProviderManagedShares`
	- `acceptIncomingProviderContactInvite`
3. Implement phone-native managed-share mutations:
	- `createManagedShare`
	- `inviteManagedShare`
	- `attachManagedShare`
	- `removeManagedShare`
	- `acceptManagedShare`
4. Add the real iOS/native host plugin surface needed to own provider auth/runtime behavior on device. The current checked-in iOS shell is still UI-only.

## Execution Plan

1. Add the missing native phone host/plugin contract for provider auth, session ownership, and runtime actions.
2. Wire `phoneHost.ts` provider account lifecycle methods to that native bridge.
3. Wire share mutation and reconciliation methods to the same bridge.
4. Extend phone host tests for each method as it moves off `501`.
5. Re-run `CI=1 yarn dev-2` and only continue past the wipe prompt when destructive confirmation is explicitly intended.

## Verification Snapshot

- `CI=1 yarn vitest run ui/src/lib/host/phoneHost.test.ts --reporter=basic` passed.
- `CI=1 yarn dev-2` reached the manual destructive confirmation prompt after building and launching both targets.
