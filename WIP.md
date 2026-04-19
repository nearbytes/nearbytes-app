# WIP

## Goal

Make the real desktop app and the real phone app sync the same hub state in both directions over push, with the phone app remaining self-contained and without periodic reconciliation being required for correctness.

## Constraints

1. The phone app must not depend on the separate dev phone API server for runtime correctness.
2. The sync chain must stay push-authoritative.
3. Polling must not be required for correctness.
4. Proof must come from the real desktop and real phone surfaces, not only lower-level probes.
5. Phone UI/runtime state must survive relaunch.

## Current Truth

The current WIP still does not have working bidirectional sync on the real `yarn dev-2-iphone-mega --no-wipe` stack.

Latest fresh repro on 2026-04-19 using:

- desktop API: `http://127.0.0.1:3000`
- phone API: `http://127.0.0.1:3300`
- desktop UI: `http://127.0.0.1:5177`
- phone UI: `http://127.0.0.1:5181`
- hub secret: `APM26`
- volume id:
  `0470f0f4b5e8692d7d80af007bb3998a45a28ef86039120c49a093f6d83db1eac6a7cea90d620dc3d2c3095f0247da0ce3f460291eb9dc467cedce958abf38d473`

Latest fresh files used:

- desktop -> phone: `nearbytes-desktop-sync-1776633206.txt`
- phone -> desktop: `nearbytes-phone-sync-1776633226.txt`

Observed result after waiting:

- desktop file appeared on desktop, but not on phone after 6s
- phone file appeared on phone with durable commit `acknowledged`, but not on desktop after 6s
- so both fresh directions are still failing on the latest patched stack

What improved relative to the previous repro:

- the phone now already sees older desktop-authored files such as `nearbytes-desktop-sync-1776632588.txt`
- that means the recipient root-handle mismatch patch is doing useful work
- but it is not sufficient to make fresh bidirectional sync reliable

Phone screenshot from that check:

- `/tmp/nearbytes-phone-bidir-check.png`

## Most Relevant Evidence

### 1. Desktop owner local-write path still races block availability

The latest desktop logs still show:

- `Managed share local write handling deferred for channels/.../8f3930b5fabe513ce55500a2212228dbe0fefc73996222597e846292a93f931a.bin: File not found in any root: blocks/2943615584144dde8687019fa3b632bd823ab62e1cb7a2617f605545ca46978e`
- repeated `Managed share local write retry deferred ... File not found in any root: blocks/294361...`

Why this matters:

- `294361...` is the blob hash of `nearbytes-desktop-sync-1776632588.txt`, which the phone now sees eventually
- the desktop owner path is still trying to publish a channel event before the referenced `blocks/*` object is durably visible in the runtime source
- the current in-process retry is still not enough under live load

### 2. Phone recipient still degrades into full refreshes and MEGA `-3`

The latest phone logs still contain:

- `MEGA immediate readonly apply failed; falling back to mirror refresh.`
- `MEGA tree did not include the requested root node.`
- `MEGA partial tree fetch failed; falling back to a full node snapshot.`
- `Incoming managed share reconciliation failed for mega:acct-mega-dev2-iphone-phone: MEGA API error -3.`

So desktop -> phone still is not reliable on the patched branch.

### 3. Phone -> desktop still is not proven despite the owner retry work

The latest fresh phone write:

- `nearbytes-phone-sync-1776633226.txt`
- phone upload completed with commit status `acknowledged`
- desktop `/open` still did not list it after 6s

So the owner-side fixes are still incomplete for fresh phone-authored writes too.

## Relevant Files

### Phone owner publication path

- `src/integrations/managedShares.ts`
- `src/integrations/mega.ts`
- `ui/src/lib/host/embeddedPhoneServices.ts`

### Desktop/server owner runtime-source bridge

- `src/server/megaOwnerMirrorSource.ts`
- `src/integrations/mega.ts`

## Fixes In Progress

Current implementation direction:

1. Treat `File not found: blocks/...` as a transient managed-share local-write failure so the event-scoped retry path runs instead of dropping the push.
2. Add a short in-process retry when the runtime-source event uploader cannot read a referenced `blocks/*` file immediately after the channel event write.
3. Preserve `AbortError` identity when owner-sync phase errors are wrapped, so deliberate sync preemption stays transient instead of surfacing as a hard owner-sync failure.
4. Treat top-level fetched `blocks` and mismatched shared-root names as canonical recipient paths so immediate readonly apply survives recipient handle-namespace mismatch.

What still appears necessary:

1. Strengthen owner runtime-source block visibility handling beyond the current short retry window.
2. Understand why the phone recipient keeps hitting MEGA partial-tree `-3` failures often enough to miss fresh events.

## Targeted Validation

Tests to run after the patch:

- `yarn test src/integrations/__tests__/managedShares.test.ts`
- `yarn test src/integrations/__tests__/megaAdapter.test.ts`

Live validation to rerun after tests:

1. Start `yarn dev-2-iphone-mega --no-wipe`
2. Open hub `APM26` on the phone app
3. Upload a fresh file from desktop and verify it appears on phone
4. Upload a fresh file from phone and verify it appears on desktop
5. Capture a fresh simulator screenshot if the phone surface is correct
