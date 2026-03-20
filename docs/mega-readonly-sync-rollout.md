# Nearbytes MEGA Read-Only Sync Rollout

## Current Answer

No, this is not fully done right now.

- The patched MEGAcmd and SDK code exists locally.
- The Nearbytes app now prefers native MEGA read-only sync when the active helper exposes `sync --down`.
- The app fallback to polling still exists for older helpers.
- The focused Nearbytes MEGA adapter test suite passes.
- We have not yet observed a full real-world incoming MEGA read-only share complete end-to-end live sync through the desktop app.
- We do not yet ship the patched helper inside the Nearbytes installer.
- We do not yet publish patched helper binaries for all supported platforms.

## What Is Possible Right Now

Yes, the target architecture is possible.

The current codebase already supports the key pieces needed for the final shape:

- Nearbytes can select a MEGA helper directory with `NEARBYTES_MEGACMD_DIR`.
- Nearbytes can auto-install a MEGAcmd helper for supported platforms.
- Nearbytes now detects whether the selected helper supports native read-only sync.
- The MEGAcmd fork is public.
- The SDK fork is public.

That means the remaining work is packaging, release automation, documentation, and end-to-end validation, not a fundamental product limitation.

## Required End State

Nearbytes should:

1. Ship a known patched MEGAcmd build with the desktop app installer.
2. Launch and restart that helper automatically.
3. Prefer native read-only MEGA sync for incoming restricted shares.
4. Fall back only when the bundled helper is unavailable or broken.
5. Repair the helper state automatically when the local MEGA command server is unhealthy.

The forked repos should:

1. Publish source in public repositories.
2. Publish binaries for supported Nearbytes desktop targets.
3. Explain clearly what is upstream and what is fork-specific.
4. Avoid duplicated documentation that would drift from upstream.

## Delivery Plan

### Phase 1: Prove the feature end to end

1. Validate a real incoming MEGA share with read-only or read-write access.
2. Confirm Nearbytes selects native `sync --down` instead of polling.
3. Capture the exact launcher/runtime conditions needed on macOS, Windows, and Linux.

Exit criteria:

- A real share syncs through Nearbytes with the patched helper.
- Nearbytes state reporting is stable after restart.
- Self-repair handles helper/server restarts cleanly.

### Phase 2: Bundle the helper in Nearbytes

1. Add packaged helper payloads to the desktop build pipeline.
2. Resolve helper location from the bundled app before any downloaded/system helper.
3. Keep `NEARBYTES_MEGACMD_DIR` as an advanced override for local testing.
4. Update self-repair so it only repairs the bundled helper runtime state, not the system installation.

Exit criteria:

- Fresh app install can use MEGA without separate helper installation.
- App restart restores helper availability automatically.

### Phase 3: Publish helper binaries from the fork repos

1. Publish versioned binaries from `nearbytes/MEGAcmd`.
2. Keep `nearbytes/sdk` source-first, but tie releases to the MEGAcmd release notes.
3. Make Nearbytes consume released helper artifacts instead of local ad hoc builds.

Exit criteria:

- A tagged fork release produces downloadable artifacts for supported platforms.
- Nearbytes installer pipeline can fetch or vendor those exact artifacts.

### Phase 4: Freeze the maintenance model

1. Keep upstream build and usage docs as the main reference.
2. Keep one short fork note per repo for Nearbytes-specific behavior.
3. Keep one short release policy doc per repo.
4. Link to upstream docs instead of copying them.

Exit criteria:

- Fork docs stay short.
- Most documentation maintenance remains upstream.

## Concrete Tasks Still Open

### Nearbytes app

- Bundle the patched helper into desktop installers.
- Add helper precedence rules: bundled helper first, configured override second, system helper last.
- Validate restart/self-repair behavior with a real MEGA account.
- Add smoke coverage for read-only share sync using the packaged helper path.

### nearbytes/MEGAcmd

- Tag and publish release artifacts.
- Add fork note and release policy.
- Keep changelog entries limited to Nearbytes-specific deltas.

### nearbytes/sdk

- Tag source releases aligned with MEGAcmd consumer releases.
- Add fork note describing the `TYPE_DOWN` exposure and validation change.

## Recommendation

Treat the current state as feature-complete at code level, but not release-complete.

The next engineering checkpoint should be a real end-to-end desktop validation with the patched helper running under the same lifecycle Nearbytes will own in production.