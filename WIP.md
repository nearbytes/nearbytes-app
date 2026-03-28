# Handover — MEGA bidirectional transport (2026-03-28)

This section is for the next developer or session: findings, what was tested, environment, and what to do next.

## What the “Undecrypted” badge is (MEGA web UI)

On **mega.nz** (Cloud Drive / shared folders), **Undecrypted** on directories means MEGA knows those nodes exist in the remote tree, but **your current session cannot decrypt them yet** — folder names and file contents stay hidden until the right keys are available. Common causes:

- **Incoming folder share** where the share key has not been applied or has not propagated to this client/session.
- **Contact / key-manager flow** incomplete (contact not accepted, or keys not loaded yet).
- **Transient MEGA API issues** (for example temporary lock `-3`) so a key or tree fetch failed partway through.
- **Stale or partial session** so the key snapshot does not include keys for nodes that show a sharing user (`su`).

In **Nearbytes logs**, the same situation often appears as **`skippedNoDecrypt`** during incoming-share discovery, or messages like **MEGA tree decryption: some nodes could not be decrypted**. Stabilizing transport E2E means getting share keys into the key-manager snapshot before classifying incoming offers.

## Status at handover

- **Goal:** In-process bidirectional readonly MEGA transport (two accounts, no HTTP server) via `ManagedShareService` + `MegaTransportAdapter` (`yarn e2e:mega-bidirectional-transport`).
- **Unit/integration tests** for `megaAdapter`, `mirrorWorker`, and `managedShares` passed after the hardening changes documented below; re-run them after any further edits to those modules.
- **Live transport E2E** was **not** confirmed green at handover. Recent failure patterns included **`No incoming MEGA offer … within 300000ms`** and diagnostics showing **incoming nodes with `skippedNoDecrypt`** when a later key-manager fetch returned empty share keys. Mitigations in flight include throttled managed-share polling, idempotent owner `ensureSync`, scoped partial-tree fetch (avoid accidental full snapshot on `-3` for sensitive owner paths), **share-key cache** reuse per session when a fetch returns empty keys, longer MEGA contact-invite soft timeout, isolated E2E remote base path (`NEARBYTES_MEGA_REMOTE_BASE` / per-run `remoteBasePath`), and an abort timeout on the wipe script.
- **Git:** The branch may still have **uncommitted** changes (`managedShares.ts`, `mega.ts`, e2e scripts, etc.). Run `git status`, review diffs, and commit when behavior is stable.

## Findings (concise)

| Area | Finding |
|------|--------|
| Polling vs owner sync | `getManagedShareState()` scheduled `ensureSync` on every poll → owner stuck “syncing”. **Mitigation:** throttle scheduling (~120s per share). |
| Owner bootstrap | Repeated `ensureSync` re-ran heavy initial sync even with watchers active. **Mitigation:** skip blocking initial `runSyncLoop` when the owner loop is already active. |
| List vs download | Different trees caused “listed but not downloadable”. **Mitigation:** `listCycleTree` + refetch fallback in owner adapter `download()`. |
| Phantom `channels/` | Entries listed but not resolvable blocked the whole mirror pass. **Mitigation:** `MirrorWorker` skips vanished / missing owner paths. |
| Partial fetch + `-3` | Full fallback after partial failure could enumerate huge trees. **Mitigation:** `allowTransientFullFallback` — readonly paths may full-fallback; owner folder operations use `false`. |
| Incoming offers | Tree shows shared nodes but decrypt fails without share keys → `skippedNoDecrypt`. **Mitigation:** cache last non-empty share keys per `userHandle` in `fetchKeyManagerState` wrapper. |
| Contact invites | Short lookup timeout was too tight for MEGA. **Mitigation:** longer `FULL_MEGA_CONTACT_INVITES_TIMEOUT_MS` for MEGA. |
| E2E isolation | Shared `/nearbytes` caused cross-run interference. **Mitigation:** per-run `remoteBasePath` (e.g. `/nearbytes-e2e-<id>`) and `NEARBYTES_MEGA_REMOTE_BASE`. |
| Wipe script | Process could hang on unsettled awaits. **Mitigation:** abort timeout in `e2e-mega-wipe.mjs`. |

## Testing phase (what was run)

1. **Build + integration tests** — `yarn build` and `yarn test` on `src/integrations/__tests__/megaAdapter.test.ts`, `mirrorWorker.test.ts`, `managedShares.test.ts`.
2. **Serial two-account transport script** — especially `NEARBYTES_E2E_SKIP_MEGA_WIPE=1 yarn e2e:mega-bidirectional-transport` when accounts already contain legacy data; full wipe when chasing determinism.
3. **Failure evolution observed:** wrong login email (HTTP 402), `-3` locks, unstable owner “ready”, stale list/download tree, then **incoming offer timeout** and **empty key manager** on later polls (addressed in code with key cache and longer invite timeout; end-to-end success not re-verified in the last tool run).

## Commands and environment

- **Secrets:** repo-root `.env.e2e` (gitignored). Two MEGA accounts as required by the script (owner/recipient roles per script contract).
- **Primary transport E2E:**  
  `NEARBYTES_E2E_SKIP_MEGA_WIPE=1 yarn e2e:mega-bidirectional-transport`
- **With wipe:** omit `NEARBYTES_E2E_SKIP_MEGA_WIPE=1` (slower; wipe uses its own timeout).
- **Regression check after substantive changes:** `yarn build` plus the three integration test files above.

## Next steps for the next owner

1. Re-run **`yarn e2e:mega-bidirectional-transport`** (with or without skip-wipe as appropriate) and confirm a **green** run after the key-cache and script fixes. If offers still never appear, trace **`listIncomingMegaShareOffersWithDiag`** / decrypt for the relevant `su` nodes, contact acceptance timing, and consider a longer incoming poll than 300s or tighter offer matching (e.g. by owner email).
2. **Commit** any pending changes; keep this file aligned with actual behavior.
3. Optional: tie UI or support docs to the same concepts as **Undecrypted** / `skippedNoDecrypt` for easier diagnosis.

---

# MEGA Bidirectional Readonly Transport WIP

## Goal
Prove and stabilize end-to-end bidirectional Nearbytes synchronization over MEGA using two accounts:

- User A owns a writable `/nearbytes` MEGA root and shares it read-only to User B.
- User B owns a writable `/nearbytes` MEGA root and shares it read-only to User A.
- Nearbytes must mirror A -> B and B -> A over MEGA transport only.
- No Nearbytes HTTP server should be required for the core transport test.

## Local Test Setup

### Accounts
- User A: configured locally in `.env.e2e`
- User B: configured locally in `.env.e2e`
- Password is stored only in `.env.e2e` and is intentionally not committed.

### Primary runner
- Command:

```bash
yarn e2e:mega-bidirectional-transport
```

### Runner behavior
- Loads repo-root `.env.e2e`
- Optionally wipes both MEGA accounts unless `NEARBYTES_E2E_SKIP_MEGA_WIPE=1`
- Creates two isolated temp peers, each with:
  - dedicated `roots.json`
  - dedicated `integrations.json`
  - dedicated secret store
  - `ManagedShareService`
  - real `MegaTransportAdapter`
- Connects both accounts directly in-process
- Waits for owner shares to become ready
- Cross-invites readonly shares
- Accepts contact invites when available
- Accepts incoming readonly shares
- Pushes canonical files in both directions and waits for the mirrored file to appear on the other side

## Files Added Or Changed For This Investigation

### New files
- `scripts/e2e-mega-bidirectional-transport.mjs`
- `WIP.md`

### Existing files changed
- `package.json`
- `src/integrations/managedShares.ts`
- `src/integrations/mega.ts`
- `src/integrations/mirrorWorker.ts`

## What Was Fixed So Far

### 1. Re-entrant owner sync from polling
Problem:
- `getManagedShareState()` scheduled a fresh `ensureSync()` on every poll in inline mode.
- The E2E runner polls aggressively.
- Each poll could reset owner state back to `syncing`, so the test never saw a stable `ready`.

Change:
- Added throttling in `ManagedShareService` so `getManagedShareState()` only schedules a sync at most once per share per 120 seconds.

Expected effect:
- State polling should observe stable owner readiness instead of constantly retriggering bootstrap.

### 2. Owner `ensureSync()` was blocking repeatedly
Problem:
- Once an owner share already had push/pull watchers and timers running, repeated `ensureSync()` still awaited a full `runSyncLoop()`.

Change:
- Owner `ensureSync()` now skips the blocking initial `runSyncLoop()` when the owner loop is already active.

Expected effect:
- Avoid repeated expensive full MEGA syncs due to harmless state/UI polling.

### 3. Owner adapter used inconsistent trees for `list()` vs `download()`
Problem:
- `MegaOwnerRemoteAdapter.list()` fetched a fresh MEGA tree.
- `download()` used the older `ownerRoot.tree` captured earlier.
- This produced cases where `list()` reported a file but `download()` could not find it.

Change:
- Added `listCycleTree` to reuse the tree fetched during `list()`.
- `download()` first resolves from `listCycleTree`, and only falls back to one fresh refetch if needed.

Expected effect:
- Eliminate stale-tree skew inside one sync pass.

### 4. Phantom MEGA entries were failing full owner sync
Observed:
- MEGA repeatedly exposes `channels/...` entries that appear during enumeration but are not resolvable when downloading.
- This previously failed the entire `MirrorWorker.sync()`.

Change:
- `MirrorWorker` now treats:
  - `MEGA owner folder is missing ...`
  - `MEGA mirror entry not found: ...`
  as skippable remote-path skew and continues the sync.

Expected effect:
- Owner sync should complete with skipped entries instead of failing the entire pass.

### 5. Owner transient timeout handling
Problem:
- Long owner syncs could abort and leave the share in a failing state.

Change:
- Owner sync now treats `AbortError` as transient in the owner-sync catch path and surfaces retryable behavior instead of a hard failure.

Expected effect:
- Long-running owner syncs keep retrying instead of poisoning the share state.

### 6. Background owner refresh should not always flip state back to `syncing`
Problem:
- Even after a successful owner sync, background refreshes could change the state back to `syncing`, making long polls unreliable.

Change:
- If a share is already `ready` with `Synced`, background owner refresh keeps that ready state rather than forcing a visible transition back to `syncing`.

Expected effect:
- Pollers can continue to observe readiness while background refresh happens.

### 7. Contact invites during cross-share setup
Problem:
- MEGA sometimes requires accepting a contact request before an incoming folder share becomes visible.

Change:
- The transport E2E script now:
  - explicitly checks incoming provider contact invites
  - accepts all MEGA contact invites during setup
  - also retries invite acceptance during incoming-share polling

Expected effect:
- Cross-invited readonly shares should become visible without manual browser intervention.

### 8. More realistic long-running MEGA timings
Changes in the transport E2E script:
- `syncTimeoutMs` increased to 900s
- owner/recipient ready waits increased to 960s
- incoming-share polling increased
- `syncIntervalMs` relaxed to reduce overlap with initial full sync

Expected effect:
- Large or noisy `/nearbytes` trees get enough time to converge.

## Confirmed Automated Results

### Unit / integration suites passing locally
- `src/integrations/__tests__/megaAdapter.test.ts`
- `src/integrations/__tests__/mirrorWorker.test.ts`
- `src/integrations/__tests__/managedShares.test.ts`

These passed after the transport hardening changes above.

## Live End-to-End Results So Far

### A. Original transport-only run
Result:
- Failed early on login when the wrong owner email was used.

Correction:
- Local `.env.e2e` was updated to use the correct owner and recipient addresses.

### B. Simultaneous account connect attempt
Result:
- Frequent MEGA API `-3` temporary lock behavior.
- One owner share never reached ready.

Interpretation:
- Bringing two accounts up concurrently is too aggressive for MEGA.

Adjustment:
- Serialized startup:
  - connect A
  - wait for A
  - cooldown
  - connect B

### C. Post-serialization owner sync
Result:
- Owner sync still got stuck.
- Investigation showed re-entrant sync scheduling from `getManagedShareState()` was part of the problem.

Adjustment:
- Added throttling and idempotent owner bootstrap behavior.

### D. Stale-tree mismatch
Result:
- Logs repeatedly showed:
  - `download target not found in tree`
  - owner list saw files that owner download could not resolve

Adjustment:
- Added `listCycleTree` and fresh fallback resolution in `MegaOwnerRemoteAdapter.download()`.

### E. Large pre-existing owner tree
Result:
- Owner sync frequently encountered old `channels/...` entries listed by MEGA but missing on actual download.
- These entries were blocking owner readiness.

Adjustment:
- `MirrorWorker` now skips such unresolvable entries.

### F. Current latest live state
Current latest failure pattern:
- Owner A still does a very long first sync.
- Logs show many collaborator timeout messages while sync is in progress.
- Phantom channel entries are now skipped instead of aborting the entire sync.
- The most recent blocker has shifted to either:
  - owner A not surfacing stable `ready` quickly enough during the first long sync, or
  - incoming share discovery still not producing the cross-offer in time after invites

Representative latest failure:
- `No incoming MEGA offer from <other account> within 300000ms`

That means the pipeline now gets significantly further than earlier failures, but the cross-share visibility is still not reliable enough.

## Important Observations About MEGA

### 1. MEGA is eventually consistent and noisy
- `-3` temporary lock responses occur frequently.
- The same account can validate successfully and then hit transient lock behavior moments later.
- Incoming discovery can lag well behind invite creation.

### 2. `/nearbytes` on these accounts is not clean
- Even when skipping wipe, many historic `channels/...` files are visible.
- Some are phantom or inconsistently resolvable.
- This massively increases first-sync cost and noise.

### 3. Wipe likely matters for true determinism
The most reliable path to a real green transport E2E is probably:

1. wipe both accounts
2. create fresh owner roots
3. cross-invite
4. accept contact invites
5. wait for fresh incoming shares
6. perform A -> B and B -> A pushes

Without a wipe, the test is currently validating both:
- the new bidirectional transport flow
- the ability to survive historic account debris

That is a much harder problem.

## Current Main Hypotheses

### Hypothesis 1
Incoming share discovery still misses legitimate MEGA offers because:
- share keys are not yet available at the time of fetch/decrypt
- contact acceptance has propagated only partially
- the polling window is still too short for MEGA propagation under load

### Hypothesis 2
The initial owner sync is still too expensive on these accounts because old phantom `channels/*` entries force repeated download resolution work and timeouts.

### Hypothesis 3
Collaborator lookup timeouts are not the root cause, but they are adding noise and may be competing for the same MEGA session budget during first sync.

## Next Fix Directions

### High priority
- Relax or suppress collaborator lookups during first transport bootstrap in the transport runner path.
- Add stronger logging around:
  - contact invites found/accepted
  - incoming share offers found per account
  - inventory snapshots before and after invite acceptance
- Consider explicit polling of provider share inventory debug data when incoming offers are empty.

### Medium priority
- Make owner first-sync completion less sensitive to unresolved legacy channel nodes.
- Consider skipping remote downloads of entries that fail repeated resolution within one pass, rather than retrying them again inside the same long sync window.

### Strong recommendation for deterministic validation
- Run the transport E2E without `NEARBYTES_E2E_SKIP_MEGA_WIPE=1` once the current fixes are committed, so both MEGA roots are clean.

## Commands Used Repeatedly

```bash
yarn build
yarn test src/integrations/__tests__/megaAdapter.test.ts
yarn test src/integrations/__tests__/mirrorWorker.test.ts
yarn test src/integrations/__tests__/managedShares.test.ts
NEARBYTES_E2E_SKIP_MEGA_WIPE=1 yarn e2e:mega-bidirectional-transport
```

## Commit Intent
This file documents the current MEGA transport debugging state so the work can continue without losing context across long-running E2E attempts.
