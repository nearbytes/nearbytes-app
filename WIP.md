# WIP

## Goal

Make the real desktop app and the real phone app sync the same hub state in both directions over push, with the phone app remaining self-contained and without periodic reconciliation being required for correctness.

## Constraints

1. The phone app must not depend on the separate dev phone API server.
2. The transmission chain must be push-authoritative.
3. Polling must not be required for sync correctness.
4. Proof must come from the real app surfaces, not only from lower-level probes.
5. Phone UI/runtime state must survive relaunch: opened hubs, joined chat identity state, and published identity-related UI state.

## Current Facts

1. The phone runtime is self-contained and uses the embedded shared backend/runtime path.
2. The phone persistence layer was overwriting saved UI state with partial payloads; this is now fixed in code.
3. Phone local writes now emit embedded storage write events into the managed-share layer.
4. Phone owner publication reaches the MEGA runtime path directly from the embedded runtime.
5. Desktop recipient apply is still not proven end-to-end from the real UI surface.
6. The app still contains active polling loops that explain the terminal spam.

## Plan

1. Finish and verify phone retention.
   - Rebuild the phone app with the persisted UI-state merge fix.
   - Prove that reopening the simulator preserves:
     - the opened hub/mount
     - the selected active hub
     - the joined chat identity assignment
     - configured identity state relevant to publishing/joining

2. Re-establish a clean reproducible sync baseline.
   - Kill stale dev processes.
   - Start one desktop runtime and one phone runtime only.
   - Reset the dev verification procedure so the proof comes from desktop UI plus phone UI for the same hub.

3. Debug desktop -> phone from the real app surface.
   - Create one fresh desktop file.
   - Compare:
     - desktop app file list
     - phone app file list
     - phone runtime `list-files`
     - recipient managed-share state and probes
   - Identify the first state boundary where the file disappears.
   - Fix that boundary and re-run the same proof.

4. Debug phone -> desktop from the real app surface.
   - Create one fresh phone file.
   - Compare:
     - phone app file list
     - desktop app file list
     - desktop runtime `/open`
     - desktop recipient probes
   - Identify the first state boundary where the file disappears.
   - Fix that boundary and re-run the same proof.

5. Remove polling from the live sync chain.
   - Enumerate each active polling loop currently visible in logs.
   - Separate:
     - sync-critical polling
     - automation/dev-only polling
     - unrelated UI polling
   - Replace sync-critical polling with evented or push-driven control flow.
   - Keep log messages unchanged while changing the behavior underneath.

6. Prove end-to-end push in both directions.
   - Desktop file appears on phone UI without manual refresh.
   - Phone file appears on desktop UI without manual refresh.
   - No periodic full sync is required for either proof.

## Definition Of Done

1. A fresh desktop-authored file appears on the phone UI.
2. A fresh phone-authored file appears on the desktop UI.
3. The phone remembers the active/open hub state and chat identity state across relaunch.
4. Periodic polling is not required for correctness of desktop <-> phone sync.
5. The remaining logs correspond only to intentional runtime activity, not hidden polling crutches in the sync path.
