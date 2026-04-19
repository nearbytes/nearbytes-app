# WIP

## Goal

Make the real desktop app and the real phone app sync the same hub state in both directions over push, with the phone app remaining self-contained and without periodic reconciliation being required for correctness.

## Constraints

1. The phone app must not depend on the separate dev phone API server for runtime correctness.
2. The transmission chain must be push-authoritative.
3. Polling must not be required for sync correctness.
4. Proof must come from the real app surfaces, not only from lower-level probes.
5. Phone UI/runtime state must survive relaunch: opened hubs, joined chat identity state, and published identity-related UI state.

## Project-Level Instructions

1. Keep everything in English, including code comments, docs, and user-facing text.
2. Read and respect `requirements/se-practices.md`.
3. Do not solve this by re-enabling periodic full-sync polling.
4. Preserve the self-contained phone architecture: no regression back to proxying phone runtime duties through the separate dev phone API server.
5. Prefer targeted validation over full rebuilds unless a full build is strictly needed.
6. Proof of success must be on the real desktop UI/runtime surface and the real phone UI/runtime surface.

## Current Task

Finish the real end-to-end MEGA push sync so the real desktop app and the real phone app stay in sync in both directions without depending on periodic full reconciliation for correctness.

At handoff time:
- `desktop -> phone` is now proven working on the real phone UI.
- `phone -> desktop` is still broken.
- Phone retention work is partially fixed in code and tests, but the active blocker is `phone -> desktop`.

## What Is Already Proven

### 1. Phone retention bug in persisted UI state was fixed

Files:
- `ui/src/lib/host/persistedUiState.ts`
- `ui/src/lib/host/persistedUiState.test.ts`

Proof:
- `yarn test ui/src/lib/host/persistedUiState.test.ts` passed earlier.
- Root cause was partial state saves overwriting the whole saved UI state object.

### 2. Desktop launcher env issue was fixed

File:
- `scripts/run-dev.mjs`

Fix:
- strip `ELECTRON_RUN_AS_NODE` from the child env before launching Electron.

Why:
- shell env had `ELECTRON_RUN_AS_NODE=1`, which broke the desktop app launch.

### 3. Periodic MEGA sync is already OFF by default on phone embedded runtime

File:
- `ui/src/lib/host/embeddedPhoneServices.ts`

Current embedded MEGA config:
- `syncIntervalMs: 0`

### 4. Desktop -> phone is now proven on the real phone UI

Fresh desktop file created:
- `nearbytes-desktop-sync-1776582049.txt`

Phone screenshot after the fix:
- `/tmp/nearbytes-phone-check.png`

What the screenshot shows:
- phone UI on hub `APM26`
- file count `3`
- visible files include:
  - `nearbytes-desktop-sync-1776580800.txt`
  - `signal-2026-04-16-161922_003.jpeg`
  - `Foto del 17-04-26 alle 09.09 #3.jpg`

Then after another desktop write:
- fresh file: `nearbytes-desktop-sync-1776582049.txt`
- desktop `/open` showed it immediately
- later phone UI also showed desktop-authored files

### 5. Stale-handle push apply bug was fixed and regression-tested

Files:
- `src/integrations/mega.ts`
- `src/integrations/__tests__/megaAdapter.test.ts`

Fix:
- immediate recipient apply no longer aborts the whole push packet when an extra packet handle fetch fails with MEGA `-9`
- stale missing handle is skipped instead

Proof:
- `yarn test src/integrations/__tests__/megaAdapter.test.ts` passed with `51/51`

This matters because earlier the phone recipient log showed:
- `MEGA immediate readonly apply failed; falling back to mirror refresh.`

The fix prevents a stale extra handle from forcing that fallback.

## What Is Broken Right Now

### Phone -> desktop is still failing

Fresh phone-authored file:
- `nearbytes-phone-sync-1776582084.txt`

Phone automation upload result:
- action `upload-file`
- status `success`
- durable commit acknowledged
- created blob hash:
  - `4007f7e08f01a9466d6746f2000152004a80870f85db326f0bc5d6f13b12bbbb`

Phone UI screenshot after upload:
- `/tmp/nearbytes-phone-after-upload.png`

What the screenshot shows:
- phone UI file count `4`
- visible files include:
  - `nearbytes-phone-sync-1776582084.txt`
  - `nearbytes-desktop-sync-1776580800.txt`
  - `signal-2026-04-16-161922_003.jpeg`
  - `Foto del 17-04-26 alle 09.09 #3.jpg`

Desktop state after waiting:
- desktop `/open` still showed only `4` files
- it did **not** include `nearbytes-phone-sync-1776582084.txt`

So the current truth is:
- phone has the file
- desktop does not
- therefore `phone -> desktop` is still broken

## Key Evidence For The Current Root Cause

The most important log line currently found in `/tmp/nearbytes-run/dev2-iphone-mega.out` is:

- `Managed share local write handling failed for channels/.../f77b4321...bin: MEGA API error -3.`

This happened after the successful phone file upload, on the canonical channel event path for volume:
- `0470f0f4b5e8692d7d80af007bb3998a45a28ef86039120c49a093f6d83db1eac6a7cea90d620dc3d2c3095f0247da0ce3f460291eb9dc467cedce958abf38d473`

Interpretation:
- the phone app did create the local canonical event
- the embedded phone owner-side managed-share local-write publication path tried to push it
- that push failed with MEGA API `-3`
- because of that, the new phone event did not reach desktop

This strongly narrows the remaining bug to:
- phone owner-side immediate local-write publication / retry behavior
- not phone file creation
- not desktop recipient apply
- not provider-managed read projection on the phone

## Most Relevant Code To Continue From

### Local-write publication path

- `src/integrations/managedShares.ts`
  - constructor storage write subscription
  - `handleStorageWrite(...)`

- `src/integrations/mega.ts`
  - `handleManagedShareLocalWrite(...)`
  - `forceManagedShareUpload(...)`
  - `forceManagedShareRuntimeSourceEventUpload(...)`

### Embedded phone self-contained runtime

- `ui/src/lib/host/embeddedPhoneServices.ts`

### Current push-apply fix already landed

- `src/integrations/mega.ts`
  - `applyRecipientHandleUpdate(...)`

## Likely Next Fix

The likely missing behavior is:
- transient MEGA local-write publication failure on phone owner path is currently just logged and dropped
- there is no authoritative event-driven retry for that failed owner publish

The next agent should verify this first, then implement the fix.

Most likely fix direction:
1. In `ManagedShareService.handleStorageWrite(...)`, do not drop transient owner-side local-write failures.
2. For transient MEGA errors like `-3` and `-4`, schedule a retry of the same local-write publication path.
3. Keep this retry push-driven and event-scoped.
4. Do not re-enable periodic full sweeps as the solution.
5. After the retry fix, prove `phone -> desktop` with a fresh phone-authored file and desktop real surface.

## Concrete Repro Procedure

Current live stack that was used:
- desktop API: `http://127.0.0.1:3000`
- phone backend dev server: `http://127.0.0.1:3300`
- desktop UI dev server: `http://127.0.0.1:5177`
- phone UI dev server: `http://127.0.0.1:5181`

Hub under test:
- secret: `APM26`
- volume id:
  - `0470f0f4b5e8692d7d80af007bb3998a45a28ef86039120c49a093f6d83db1eac6a7cea90d620dc3d2c3095f0247da0ce3f460291eb9dc467cedce958abf38d473`

Desktop runtime token:
- `UZDGqy4_KcahrRoBTWMOJG6p77UaqqoPViqMikkH7UI`

### Check desktop file list

Use:
- `curl -s -H 'x-nearbytes-runtime-token: UZDGqy4_KcahrRoBTWMOJG6p77UaqqoPViqMikkH7UI' -H 'content-type: application/json' -d '{"secret":"APM26"}' http://127.0.0.1:3000/open`

### Upload from desktop

Use:
- `curl -s -H 'x-nearbytes-runtime-token: UZDGqy4_KcahrRoBTWMOJG6p77UaqqoPViqMikkH7UI' -H 'x-nearbytes-secret: APM26' -F "file=@/tmp/somefile.txt;type=text/plain" http://127.0.0.1:3000/upload`

### Upload from phone

Use:
- `node scripts/iphone-phone-automation.mjs --action upload-file --secret APM26 --filename SOME_NAME.txt --content-base64 BASE64_CONTENT --timeout-ms 60000`

The phone automation upload was working again at handoff time.

### Capture phone UI proof

Use:
- `xcrun simctl io booted screenshot /tmp/nearbytes-phone.png`

Useful screenshots already captured:
- `/tmp/nearbytes-phone-check.png`
- `/tmp/nearbytes-phone-after-upload.png`

## Handoff Priority

Do this in order:
1. Fix phone owner local-write transient failure handling for MEGA `-3` / `-4`.
2. Prove `phone -> desktop` with a fresh phone-authored file.
3. Then verify whether any remaining polling/spam in the sync chain is still required for correctness or only dev plumbing.
