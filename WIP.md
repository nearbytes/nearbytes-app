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
6. `src/integrations/megaProtocol.ts` no longer has top-level Node runtime imports, so the shared protocol helper layer is now import-safe at module load.
7. `src/integrations/runtime.ts` is now import-safe at module load instead of assuming `child_process` and `process.env` exist eagerly.
8. `src/integrations/mega.ts` no longer eagerly imports `path`, `fs`, `chokidar`, or `crypto`; those Node modules now load lazily instead of blocking phone import at module load.
9. The MEGA pairwise Cu25519 invite/key-exchange derivation no longer depends on Node DER key wrappers or `diffieHellman`; it now uses portable shared code.
10. The shared MEGA SHA-256 and HKDF helpers used for key fingerprints and key-manager derivation no longer depend on Node crypto.
11. The shared MEGA AES ECB/CBC/CTR/GCM helpers used by login, key-manager, attributes, and file decrypt/encrypt now run through portable code instead of Node crypto.
12. The embedded phone managed-share service now instantiates the real shared `MegaTransportAdapter` for MEGA instead of a phone-only catalog stub.
13. There is no longer a known product-level MEGA blocker on the embedded phone path; legacy private-attribute AES-CCM payloads now decrypt through the shared portable crypto path too.

## Missing Or Broken

1. Real device validation of the embedded phone MEGA path is still pending.
2. Provider-owned remote actions still need a final architecture choice per operation:
	- keep them in shared TypeScript after de-Node-ifying the needed runtime/protocol pieces
	- or move only the unavoidable runtime-owned pieces behind a native bridge
3. Functional parity with desktop still needs real-device confirmation even though the prior hard blocker has been removed.

## Remaining Plan

1. Split the MEGA stack into:
	- shared protocol/session code that can run on phone
	- Node-only filesystem/watcher mirror code that stays desktop-only
2. Keep the phone provider path on the shared MEGA session/contact-invite/reconciliation logic and verify it against real device traffic.
3. Use a native bridge only for the residual runtime seams that cannot be honestly shared in TypeScript.
4. Add focused tests for each newly shared phone-safe MEGA layer and keep the existing phone host suite passing.
5. Verify device-relevant flows again after each step instead of declaring completion from host tests alone.

## Immediate Steps

1. Run real-device MEGA connect, invite, incoming-share, and reconnect flows through the embedded phone host.
2. Run the same flows on target MEGA accounts that already contain long-lived security attributes and shared history.
3. Confirm the remaining phone/runtime seams are limited to explicit platform boundaries rather than hidden shared-runtime fallbacks.

## Definition Of Done

1. The iPhone app can own MEGA setup/auth/connectivity without a desktop runtime.
2. The shared TypeScript managed-share core remains the source of truth for share state and share bookkeeping.
3. The MEGA session/contact-invite/reconciliation path runs through shipped phone code rather than desktop-only Node runtime code.
4. The app architecture stays self-contained: shipped TypeScript plus shipped iOS native code only.
5. The result is close enough to desktop behavior that real device testing is meaningful and remaining gaps are explicit rather than hidden.
