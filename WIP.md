THE TASK IS STILL TO FIX THE REAL MEGA BIDIRECTIONAL FAILURE, NOT TO RE-REPORT THAT IT FAILS. IF FRESH LIVE WRITES DO NOT PROPAGATE, CONTINUE DEBUGGING.

# HANDOVER PROMPT

Continue debugging the real `yarn dev-2-iphone-mega --no-wipe` MEGA bidirectional sync failure on the `Test4` hub. Do not treat the no-wipe roots regression as the remaining issue; that part is fixed enough for live repro again. Current live truth: `POST /open` works on both desktop and phone, both homes retain `src-mega-managed-3`, but fresh writes still fail in both directions even after explicit recipient triggers and 90 seconds of polling. Latest hard evidence: desktop upload `nearbytes-desktop-live-poll-1776693181.txt` with blob hash `e2c0f983bca16c5b1c8bae588a4112f3646c0ab5019a6ede17bd335582c2c4eb` never appeared on phone within 90s; phone upload `nearbytes-phone-live-poll-1776693277.txt` with blob hash `78473cb296eea030a59c5104029781879527f1a820c97658036781a43a1ad966` never appeared on desktop within 90s. During that proof, desktop share `share-mega-2-e9bfdd` reported state `ready` with `MEGA_OWNER_SYNC_RETRYING`, desktop recipient `share-mega-1-749d88` reported `syncing`, phone logs showed repeated `MEGA partial tree fetch failed; falling back to a full node snapshot` and `MEGA partial tree decryption missed the requested root`, and both upload-probe / receive-probe debug endpoints were empty. The next agent should trace why fresh uploads are not entering the tracked probe path and determine whether the missing step is owner publication, SC event visibility, or recipient refresh ingestion.

# WIP

## Goal

Make the real desktop app and the real phone app sync the same hub state in both directions over push, with the phone app remaining self-contained and without periodic reconciliation being required for correctness.

Immediate task: fix the remaining real MEGA fresh-write propagation failure on the `Test4` stack. Do not stop at proving that the stack starts or that `open` works again.

## Constraints

1. The phone app must not depend on the separate dev phone API server for runtime correctness.
2. The sync chain must stay push-authoritative.
3. Polling must not be required for correctness.
4. Proof must come from the real desktop and real phone surfaces, not only lower-level probes.
5. Phone UI/runtime state must survive relaunch.

## Current Truth

The no-wipe runtime-state blocker is fixed enough to resume live repro, but the real bidirectional sync task is still not done.

What is fixed now:

- `yarn dev-2-iphone-mega --no-wipe` no longer destroys the owner managed source on startup.
- both current homes retain `src-mega-managed-3` in `.nearbytes/roots.json`
- both desktop and phone can `POST /open` for `Test4` again
- the dev launcher now preserves existing `roots.json` on `--no-wipe` and repairs missing provider-managed source entries from `.nearbytes/integrations.json` before startup

What is still broken now:

- fresh desktop writes still do not appear on phone
- fresh phone writes still do not appear on desktop
- this still fails after explicit recipient triggers
- this still fails after 90 seconds of polling on both directions

Current live stack details from the latest repro on 2026-04-20:

- desktop API: `http://127.0.0.1:3000`
- phone API: `http://127.0.0.1:3300`
- desktop UI: `http://127.0.0.1:5177`
- phone UI: `http://127.0.0.1:5181`
- volume secret: `Test4`
- volume id: `0489eac69beb82ec9eb88b45d7ce29d5cce350f01c6f85922e23750841fa86944aceefcf9326aa4363e349d73049c9a126ce36cdd14407b6c1fe33d6288ed03101`
- desktop owner share: `share-mega-2-e9bfdd`
- desktop recipient share: `share-mega-1-749d88`
- phone owner share: `share-mega-2-f3adfb`
- phone recipient share: `share-mega-1-046172`

Latest direct desktop -> phone proof result:

- fresh file: `nearbytes-desktop-live-1776693055.txt`
- blob hash: `354e0c2eaecc50ee2edbcccb66589b099692ece70499656ecc5c72a880795b9e`
- desktop upload returned `created` successfully
- phone trigger returned `{"ok":true,"shareId":"share-mega-1-046172"}`
- phone file list count was `23`
- `phoneFilePresent` was `false`

Latest stronger desktop -> phone proof with bounded polling:

- fresh file: `nearbytes-desktop-live-poll-1776693181.txt`
- blob hash: `e2c0f983bca16c5b1c8bae588a4112f3646c0ab5019a6ede17bd335582c2c4eb`
- polling duration: `90s`
- result: file never appeared on phone
- phone file count stayed at `24` for every poll sample

Latest stronger phone -> desktop proof with bounded polling:

- fresh file: `nearbytes-phone-live-poll-1776693277.txt`
- blob hash: `78473cb296eea030a59c5104029781879527f1a820c97658036781a43a1ad966`
- polling duration: `90s`
- result: file never appeared on desktop
- desktop file count stayed at `24` for every poll sample

So the issue is no longer just desktop -> phone. Fresh writes are currently not proving in either direction on the live stack.

## What Changed In Code

Work already landed in the repo during this debugging pass:

- runtime-source owner sync now uploads event-referenced `blocks/*.bin` before publishing `channels/*`
- runtime-source owner sync no longer does per-file remote visibility waits during a sweep
- post-upload MEGA `-3` refresh failures no longer abort the whole owner sync after files were already pushed
- owner local-write uploads now go through the per-account sync serializer
- incoming MEGA share discovery now also goes through the same per-account serializer
- explicit recipient trigger launch is detached and retries once after an aborted in-flight attempt
- large MEGA manifests are kept in memory instead of being forced into durable secret storage
- refresh worker now supports progress callbacks to keep long MEGA readonly refreshes alive
- no-wipe startup now preserves existing `roots.json`
- no-wipe startup repairs missing provider-managed sources from `.nearbytes/integrations.json`

Validated test status seen during this pass:

- `yarn vitest run src/integrations/__tests__/megaAdapter.test.ts` passed
- earlier managed-share / mega unit coverage added in this pass was passing when run

## Most Relevant Live Evidence

### 1. No-wipe roots regression is no longer the active blocker

Current roots state before the latest repro:

- desktop `.nearbytes/roots.json` contained `src-default`, `src-mega-managed-2`, and `src-mega-managed-3`
- phone `.nearbytes/roots.json` contained `src-default`, `src-mega-managed-2`, and `src-mega-managed-3`
- desktop default destinations also included `src-mega-managed-3`
- `POST /open` on both desktop and phone returned `ok`

This means the session is past the earlier `Unknown destination sourceId: src-mega-managed-3` failure mode.

### 2. Fresh writes still do not surface on the opposite side even after triggers and 90s polling

The strongest current proof is the 90s poll run in both directions:

- desktop -> phone: `nearbytes-desktop-live-poll-1776693181.txt` never appeared on phone
- phone -> desktop: `nearbytes-phone-live-poll-1776693277.txt` never appeared on desktop
- both sides stayed stuck at the same file count throughout the poll window

That means the system is not just delayed; it is failing to converge under the tested conditions.

### 3. Current share runtime states still indicate MEGA-side churn instead of clean propagation

Desktop share states after the failed proof:

- recipient `share-mega-1-749d88`: `syncing`, detail `Refreshing the MEGA readonly mirror.`
- owner `share-mega-2-e9bfdd`: `ready`, detail `MEGA temporarily asked Nearbytes to retry owner sync. The local writable mirror stays available and the next sync cycle will retry automatically.`
- owner diagnostic code: `MEGA_OWNER_SYNC_RETRYING`

This suggests owner publication is not landing cleanly enough to produce observable convergence.

### 4. Phone logs still show repeated partial-tree fallback churn

Recent phone backend log patterns during the failed proof window:

- repeated `MEGA sc channel event received`
- repeated `MEGA partial tree fetch failed; falling back to a full node snapshot`
- repeated `MEGA partial tree decryption missed the requested root; falling back to a full node snapshot`

This strongly suggests the phone recipient refresh path remains unstable under current live conditions.

### 5. Probe endpoints are still empty for the failed proof window

Observed during this pass:

- desktop `__debug/integrations/shares/share-mega-2-e9bfdd/upload-probes` returned `{"probes":[]}`
- phone `__debug/integrations/shares/share-mega-1-046172/receive-probes` returned `{"probes":[]}`

Interpretation:

- either the fresh writes are not entering the tracked MEGA publication / receipt path at all
- or the wrong share/path is being exercised and the current probe plumbing is not observing the live path that actually matters

### 6. Recent filename-specific log searches were not useful

Searching desktop and phone logs for the failed proof filenames and blob hashes did not return direct hits for the fresh files. That means filename search is not currently enough to prove where the path dies.

## Current Best Hypotheses

1. The live write path is still bypassing or missing the code path that records upload probes and/or receive probes.
2. Owner publication may still be getting stuck in retry scheduling before the fresh event becomes recipient-visible.
3. Recipient refresh may be seeing SC events but failing to materialize the new content due to the repeated partial-tree fallback / wrong-root behavior.
4. Since both directions now fail, there may be a shared missing step in fresh event publication or fresh event ingestion rather than a one-sided desktop-only bug.

## Relevant Files

Primary code under suspicion:

- `src/integrations/mega.ts`
- `src/integrations/managedShares.ts`
- `src/server/megaOwnerMirrorSource.ts`
- `ui/src/lib/host/embeddedPhoneServices.ts`
- `src/integrations/providerRefreshWorker.ts`
- `scripts/dev-2-iphone-mega.mjs`
- `scripts/lib/dev-orchestration.mjs`

Routes and debug plumbing already consulted:

- `src/server/routes.ts`

## Concrete Next Steps

1. Trace the exact live path for one fresh failed file from upload to MEGA publish attempt to recipient refresh attempt. Do not rely only on filename grep.
2. Instrument or inspect where upload probes are supposed to be written and why they stayed empty for `share-mega-2-e9bfdd`.
3. Instrument or inspect where receive probes are supposed to be written and why they stayed empty for `share-mega-1-046172`.
4. Determine whether the owner `MEGA_OWNER_SYNC_RETRYING` state corresponds to failed upload reservation, failed upload commit, failed post-upload refresh, or a later retry scheduler event.
5. Determine whether phone-side repeated partial-tree fallback is failing before content ingestion or after seeing the new remote state.
6. Once one direction is understood, rerun the same live `Test4` proof immediately rather than relying on historical assumptions.

## Live Validation Recipe

Use the real stack only:

1. Start `yarn dev-2-iphone-mega --no-wipe`
2. Confirm both desktop and phone can `POST /open` for `Test4`
3. Upload a fresh file from desktop and poll phone for up to 90s
4. Upload a fresh file from phone and poll desktop for up to 90s
5. Inspect share states and logs immediately after each failed proof
6. Do not claim progress as completion unless a fresh live file appears on the opposite device
