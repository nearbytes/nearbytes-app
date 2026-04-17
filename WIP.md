# WIP

## Current Status

- Phone provider/share state is now partly embedded and browser-backed.
- Implemented phone provider/share surfaces: `listProviderAccounts`, `connectProviderAccount`, `disconnectProviderAccount`, `reconcileProviderManagedShares`, `listManagedShares`, `listIncomingManagedShares`, `listIncomingProviderContactInvites`, `getManagedShareState`, `createManagedShare`, `inviteManagedShare`, `attachManagedShare`, `removeManagedShare`, `acceptManagedShare`.
- `yarn dev-2` is no longer blocked by the TypeScript build errors from the MEGA live tests/runtime wrapper. It now builds, starts both targets, connects both MEGA accounts, and stops at the expected destructive wipe confirmation prompt.
- No external helper app is part of the target architecture. Remaining phone work must be delivered through shipped TypeScript plus a real native phone host/plugin bridge.

## What Was Fixed In This Pass

1. Routed phone `getManagedShareState` through the embedded managed-share service instead of returning `501`.
2. Added phone host regression coverage for embedded managed-share state inspection.
3. Removed duplicate `integrationStatePath` object keys in the MEGA live tests so the repo builds cleanly again.
4. Removed unused type aliases from `src/integrations/runtime.ts` that were failing the TypeScript build.

## Remaining Work

1. Implement phone-native provider setup/auth surfaces:
	- `configureProviderSetup`
	- `installProviderHelper` (API name can stay for compatibility, but the implementation must be native runtime setup rather than an external helper app)
	- real provider-auth session ownership for browser/OAuth/device-flow/native login paths
2. Implement phone-native provider invite/runtime operations that still require provider-native behavior:
	- `acceptIncomingProviderContactInvite`
	- real incoming-share discovery and remote inventory adoption instead of local-only reconciliation fallbacks
3. Add the real iOS/native host plugin surface needed to own provider auth/runtime behavior on device. The current checked-in iOS shell is still UI-only.

## Execution Plan

1. Add the missing native phone host/plugin contract for provider auth, session ownership, provider contact invites, and runtime actions.
2. Replace the current embedded local account/share fallbacks with native-backed provider operations where remote behavior is required.
3. Extend phone host tests for each remaining method as it moves off `501`.
4. Re-run `CI=1 yarn dev-2` and only continue past the wipe prompt when destructive confirmation is explicitly intended.

## Verification Snapshot

- `CI=1 yarn vitest run ui/src/lib/host/phoneHost.test.ts --reporter=basic` passed.
- `CI=1 yarn dev-2` reached the manual destructive confirmation prompt after building and launching both targets.
