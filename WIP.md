# WIP

## Goal

Ship a self-contained iPhone Nearbytes app that reuses the shared TypeScript managed-share core, owns MEGA connectivity on-device through shipped native code, and does not depend on any desktop proxy, external helper app, or sidecar runtime.

## Current Baseline

1. The shared TypeScript managed-share core is now importable and usable from the phone host.
2. The phone host already supports embedded local provider/share state plus several local share mutations.
3. The iOS shell is not blank: it already has a real Capacitor native plugin surface in `ui/ios/App/CapApp-SPM/Sources/CapApp-SPM/NearbytesLanPlugin.swift` for LAN/runtime signaling.
4. There is now also a dedicated native provider bridge surface for provider setup/install semantics through `NearbytesProviderPlugin`.
5. What remains is not another shared-core rewrite. It is extending the native iPhone bridge so provider auth, provider contact invites, and MEGA-backed remote operations are owned by the device.

## Progress Against Plan

1. Done: added a dedicated native iPhone provider plugin instead of overloading the LAN plugin.
2. Done: added the matching TypeScript bridge under `ui/src/lib/host/nativeProviderPlugin.ts`.
3. Done: routed `configureProviderSetup` and `installProviderHelper` through the new bridge.
4. Done: kept the focused phone host regression suite passing after the bridge work.
5. Remaining: `acceptIncomingProviderContactInvite` still requires real native/provider runtime behavior.
6. Remaining: true MEGA auth/session/runtime ownership on iPhone is still not implemented; the current shared MEGA adapter remains Node-bound.

## Finish Plan

1. Extend the native iPhone plugin surface beyond LAN so the app can perform provider runtime actions from JS through Capacitor.
2. Define a native provider bridge contract for:
	- provider setup state
	- provider configuration writes
	- account connect/disconnect
	- auth session polling/completion
	- incoming provider contact invite acceptance
	- remote managed-share inventory reads needed by reconciliation
3. Wire `ui/src/lib/host/phoneHost.ts` and `ui/src/lib/host/embeddedPhoneServices.ts` to prefer the native bridge for remote/provider-owned actions while preserving the shared TypeScript state model.
4. Keep purely local state and local-share bookkeeping in the shared TypeScript managed-share service.
5. Add focused tests for the host/native bridge boundaries and keep the existing phone host suite passing.
6. Verify desktop/phone dev flows still work, including `dev-2` and the iPhone LAN demo paths where relevant.

## Immediate Steps

1. Inspect the existing native LAN plugin and TS bridge patterns, then mirror that structure for provider/runtime actions.
2. Add a new native Capacitor plugin dedicated to phone provider/runtime operations instead of overloading the LAN plugin.
3. Add the matching TypeScript bridge in `ui/src/lib/host`.
4. Route the remaining phone `501` method through that bridge:
	- `acceptIncomingProviderContactInvite`
5. Replace embedded/local fallback connect semantics with true native-owned provider auth/session flows.

## Definition Of Done

1. The iPhone app can own MEGA setup/auth/connectivity without a desktop runtime.
2. The shared TypeScript managed-share core remains the source of truth for share state and share bookkeeping.
3. The remaining phone host provider APIs no longer return `501` because the native bridge supplies the required runtime behavior.
4. The app architecture stays self-contained: shipped TypeScript plus shipped iOS native code only.
