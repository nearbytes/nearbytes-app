# WIP

## Most Important Requirements

1. Fully finish the iPhone MEGA implementation, not a partial bridge or mock path.
2. Keep the phone app self-contained: no desktop proxy, helper app, sidecar, or external connector.
3. Reuse the shared TypeScript implementation wherever that is technically possible.
4. Do not duplicate MEGA protocol logic unnecessarily in Swift or other native code.
5. Use native iPhone code only for the platform/runtime seams that the phone actually requires.
6. Make the phone own MEGA setup, auth, session refresh, contact invites, reconciliation, and remote operations.
7. Keep the shared managed-share/state model as the source of truth for provider/share state.
8. Remove placeholder phone behavior for required provider flows and replace it with real implementation.
9. Make the result ready for real device testing, not just host-surface tests.
10. Do not present transitional scaffolding as if it were the final architecture.

## Goal

Ship a self-contained iPhone Nearbytes app that reuses the shared TypeScript managed-share core, owns MEGA connectivity on-device through shipped native code, and does not depend on any desktop proxy, external helper app, or sidecar runtime.

## Current Baseline

1. The shared TypeScript managed-share core is now importable and usable from the phone host.
2. The phone host already supports embedded local provider/share state plus several local share mutations.
3. The iOS shell is not blank: it already has a real Capacitor native plugin surface in `ui/ios/App/CapApp-SPM/Sources/CapApp-SPM/NearbytesLanPlugin.swift` for LAN/runtime signaling.
4. There is now also a dedicated native provider bridge surface for provider setup/install semantics through `NearbytesProviderPlugin`.
5. The phone host no longer hard-blocks provider contact-invite acceptance at the API surface; it delegates into the embedded managed-share service.
6. The real remaining blocker is lower in the stack: the shared MEGA runtime/protocol path is still Node-bound.

## Missing Or Broken

1. True MEGA auth/session/runtime ownership on iPhone is still not implemented.
2. `src/integrations/mega.ts` still imports and uses Node-only runtime APIs such as `crypto`, `fs`, `path`, `chokidar`, and environment/process access.
3. `src/integrations/megaProtocol.ts` still imports Node-only runtime APIs at module load, which prevents it from being a clean phone/browser-safe shared layer.
4. Provider-owned remote actions still need a final architecture choice per operation:
	- keep them in shared TypeScript after de-Node-ifying the needed runtime/protocol pieces
	- or move only the unavoidable runtime-owned pieces behind a native bridge
5. Functional parity with desktop has not yet been reached, so the iPhone path is not ready to be described as complete.

## Remaining Plan

1. Make the shared MEGA protocol layer browser-safe enough to be imported by phone code without top-level Node runtime failures.
2. Split the MEGA stack into:
	- shared protocol/session code that can run on phone
	- Node-only filesystem/watcher mirror code that stays desktop-only
3. Reconnect the phone provider path to the shared MEGA session/contact-invite/reconciliation logic once those shared pieces are phone-safe.
4. Use a native bridge only for the residual runtime seams that cannot be honestly shared in TypeScript.
5. Add focused tests for each newly shared phone-safe MEGA layer and keep the existing phone host suite passing.
6. Verify device-relevant flows again after each step instead of declaring completion from host tests alone.

## Immediate Steps

1. Remove top-level Node runtime imports from `src/integrations/megaProtocol.ts` where they are not fundamentally required.
2. Prove that the phone can import and exercise the shared MEGA protocol/session helpers without pulling in desktop-only runtime code.
3. Identify the smallest MEGA session/auth/contact-invite slice that can be shared on phone next.
4. Only after that, decide which remaining MEGA runtime seams need native ownership.

## Definition Of Done

1. The iPhone app can own MEGA setup/auth/connectivity without a desktop runtime.
2. The shared TypeScript managed-share core remains the source of truth for share state and share bookkeeping.
3. The MEGA session/contact-invite/reconciliation path runs through shipped phone code rather than desktop-only Node runtime code.
4. The app architecture stays self-contained: shipped TypeScript plus shipped iOS native code only.
5. The result is close enough to desktop behavior that real device testing is meaningful and remaining gaps are explicit rather than hidden.
