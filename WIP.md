# Handover Prompt

Paste this into a new chat:

```text
Continue debugging the JS-only MEGA bidirectional readonly-share transport in nearbytes-app. Read WIP.md first and treat it as authoritative state. You have 3 more attempts total. Do not restart the earlier ^!keys/pk investigation unless new evidence demands it.

Current state:
- local MEGA adapter tests and managed-shares reconnect tests are green again after the provisional incoming-share patch
- official MEGA docs + SDK + webclient have been reconciled with the live behavior
- pk returning -9 / API_ENOENT is benign "no pending keys", not the main bug
- stale cross-shares were real; revoke-only cleanup under skip-wipe reduced B's undecryptable incoming roots from 13 to 1
- Nearbytes now surfaces provisional incoming offers for `su` roots even when the root is still undecryptable, instead of hiding them behind `offerCount: 0`
- accepted readonly MEGA shares whose root exists but still lacks a usable key now stay in retrying `syncing` state instead of failing bootstrap immediately
- the remaining blocker is the fresh inbound root cIVQ2bjB from owner QGNK-vtVAPo: on B it appears as su=QGNK-vtVAPo, parent=QNkChQJJ, no sk, node.k owner cIVQ2bjB, and no usable key from sk, ^!keys.pendinginshares, or pk
- live transport still needs a rerun to confirm whether `cIVQ2bjB` now appears as a provisional offer and later becomes decryptable, or whether MEGA never delivers the usable root key

Focus the next attempt on a live rerun plus inbound-share action packets / share-row handling for the fresh share root, especially parity with the webclient's scparser 's' path, scinshare state, and nodedec inbound-share key application after the provisional offer is accepted. Update WIP.md again before stopping.
```

# Handover — MEGA bidirectional transport (2026-03-28)

This section is for the next developer or session: findings, what was tested, environment, and what to do next.

## What the “Undecrypted” badge is (MEGA web UI)

On **mega.nz** (Cloud Drive / shared folders), **Undecrypted** on directories means MEGA knows those nodes exist in the remote tree, but **your current session cannot decrypt them yet** — folder names and file contents stay hidden until the right keys are available. Common causes:

- **Incoming folder share** where the share key has not been applied or has not propagated to this client/session.
- **Contact / key-manager flow** incomplete (contact not accepted, or keys not loaded yet).
- **Transient MEGA API issues** (for example temporary lock `-3`) so a key or tree fetch failed partway through.
- **Stale or partial session** so the key snapshot does not include keys for nodes that show a sharing user (`su`).

In **Nearbytes logs**, the same situation often appears as **`skippedNoDecrypt`** during incoming-share discovery, or messages like **MEGA tree decryption: some nodes could not be decrypted**. Stabilizing transport E2E means getting share keys into the key-manager snapshot before classifying incoming offers.

**Important:** Orange **undecrypted** incoming rows on mega.nz for the disposable `+02` / `+03` pair were **produced by Nearbytes E2E / invite paths** (partial key handoff, aborted runs, many `nearbytes-e2e-*` roots), not by manual sharing alone. Cleaning **outgoing** access plus cloud data is required to stop the UI and API from surfacing stale share edges.

## Status at handover

- **Goal:** In-process bidirectional readonly MEGA transport (two accounts, no HTTP server) via `ManagedShareService` + `MegaTransportAdapter` (`yarn e2e:mega-bidirectional-transport`).
- **Unit/integration tests** were rerun after the latest MEGA incoming-share change: `megaAdapter.test.ts` passed with the new provisional-offer / pending-root cases, and the targeted managed-shares reconnect test passed too.
- **Live transport E2E** is still **not** confirmed green. The third pass materially improved the state: after revoke-only cleanup, recipient B's undecryptable incoming roots dropped from **13** to **1**. Nearbytes now exposes that kind of fresh root as a provisional offer and keeps retrying the accepted share when the root key is still pending, but the live transport needs to be rerun to see whether the remaining root actually heals. Current live blocker on B before the code change, and still the root to recheck live:
  - share root handle: **`cIVQ2bjB`**
  - owner handle: **`QGNK-vtVAPo`**
  - parent handle: **`QNkChQJJ`**
  - `sk`: absent
  - `node.k` owner: **`cIVQ2bjB`**
  - usable key source from `sk`, `^!keys.pendinginshares`, and `pk`: **none**
  - incoming discovery result before the patch: **`offerCount: 0`** after 4 passes
- **Latest live rerun (after the provisional-offer patch)** still timed out waiting for recipient B (`share-mega-2-b328ba`) to become ready. The SC listener was active and repeatedly logged packets, but the observed packets were only **`ua` account-level events**; no share-touching `s` / `s2` / `u` / `t` / `d` packets were seen on the mounted shares before timeout.
- **Latest live reruns after seeding pending-root recipient cursors** showed a real improvement: recipient shares now **do** join the SC channel in both directions and log their own action-packet batches. After filtering out account-level noise, those recipient batches are still only **`ua`** events, not share-touching `s` / `s2` / `u` / `t` / `d` packets.
- **Pending-root diagnostics now show the failing root is present but still keyless.** Example from the latest run on recipient A for incoming root **`JcsCiTSI`**: `nodePresent=true`, `hasSk=false`, `nodeKeyOwners=['JcsCiTSI']`, `hasShareKeyForRootHandle=false`, `pendingInShareCount=0`, `pendingInShareHasRootHandle=false`, and `matchingShareRowCount=0`.
- **Git:** Run `git status` and commit when stable; this document describes code that may land as one or more commits.

## Official source reconciliation (2026-03-28)

- **MEGA help**: undecrypted shared folders mean the recipient session is missing the right key; the documented remediation is logout/reload and, if needed, **remove and re-add the share**.
- **MEGAcmd SDK**: `pk` is a supplemental pending-key path. `CommandPendingKeys("pk")` returns pending inbound keys when present, but the client also keeps separate missing-key / pending-share state and promotes shares later.
- **MEGA webclient**: `pk` `ENOENT` is treated as ordinary "no pending inshare keys"; the client still keeps undecryptable `su` nodes as missing-key state. This matches the orange "Undecrypted" web UI rows and Nearbytes `skippedNoDecrypt` exactly.
- **Practical conclusion**: the last parser additions were correct but not sufficient. The remaining issue is now more likely in **fresh inbound share delivery / application** than in key-manager parsing.

## Wipe and revoke (disposable test storage)

Cleaning mega.nz for the two disposable accounts needs **two layers**: (1) **revoke cross-outgoing folder shares** between those emails, (2) **delete owned nodes** under Cloud Drive and Rubbish.

### Implemented methods

1. **`revokeMegaOutgoingSharesForPeers`** (`src/integrations/mega.ts`, exported)  
   - **Guard:** `NEARBYTES_ALLOW_DESTRUCTIVE_MEGA_E2E_WIPE=1`.  
   - Logs in as one account, loads `f` snapshot, scans **`s`** (outgoing) and **`ps`** (pending) rows; for any row whose resolved peer email is in the configured peer list, issues **`s2` without `ok`/`ha`/`r`** on the shared node handle — matching **MEGA SDK `ACCESS_UNKNOWN`** / **CommandSetShare** “remove share”.  
   - Dedupes by `(nodeHandle, peerEmail)`; loops up to 10 rounds so MEGA can reflect revokes.  
   - **Effect:** Removes the owner-side edge so the other account’s **Incoming shares** should drop those folders (stops accumulation of app-created undecrypted rows between `+02` and `+03`).

2. **`wipeMegaCloudDriveContentsForE2e`** (existing)  
   - Post-order delete of every node under **Cloud Drive** root, then **Rubbish Bin**, repeated until empty (same env guard).  
   - **Per-delete delay** in `wipeMegaSubtreeHandles` was reduced (**150ms → 25ms**) so wiping very large trees (tens of thousands of nodes) is **practical**; still **O(n) API calls**, so a full wipe can take **tens of minutes** on huge `nearbytes` mirrors.

3. **`yarn e2e:mega-wipe`** (`scripts/e2e-mega-wipe.mjs`)  
   - For **each** email in `NEARBYTES_E2E_MEGA_ACCOUNTS` or owner+recipient: first **`revokeMegaOutgoingSharesForPeers`** against the *other* account(s), then **`wipeMegaCloudDriveContentsForE2e`**.

4. **`yarn e2e:mega-bidirectional-transport`** when **`NEARBYTES_E2E_SKIP_MEGA_WIPE` is unset**  
   - Runs the **same revoke-then-wipe** sequence for both env accounts before the test (shared helper pattern as the wipe script).

5. **`NEARBYTES_E2E_SKIP_MEGA_WIPE=1 yarn e2e:mega-bidirectional-transport`**  
  - **Still revokes** outgoing cross-shares for the two env accounts before the transport test, but skips the expensive Cloud Drive/Rubbish wipe.
  - Set **`NEARBYTES_E2E_SKIP_MEGA_REVOKE=1`** only if you intentionally want to preserve stale incoming/outgoing share state too.

### Results so far (cleanup)

- **Revoke:** In a real run, **`+02` revoked 6** outgoing share rows to the peer; **`+03` revoked 4** — consistent with stacked E2E invites / folder shares.  
- **Full wipe:** A **56k+ node** Cloud Drive makes **sequential `d` deletes** extremely slow; a long-running wipe was **aborted mid-account** in one session after revoke had already completed. **Partial wipe** leaves debris; **incoming empty + owner `-3`** can still dominate the next transport run if trees stay huge.  
- **Third-pass live result:** Revoke-only preflight under `NEARBYTES_E2E_SKIP_MEGA_WIPE=1` reduced B's undecryptable incoming roots from **13** to **1**. This proved the bulk of the contamination was stale cross-shares, but it also isolated one **fresh** inbound root that still arrives without a usable key.
- **Conclusion:** For **deterministic** transport tests, prefer **revoke + full wipe** when time allows, or **manually** clear mega.nz once; otherwise expect **heavy `f` / `-3`** noise. If revoke-only leaves exactly one undecryptable incoming root, the investigation should pivot from cleanup to **fresh inbound-share key application**.

### Other related mitigations (incoming / keys)

- **`registerMegaShareKeyHandlesForNode`:** after decrypting node **`sk`**, register the share key under **`node.h`** and **every owner handle parsed from `node.k`**, so **`decryptNodeKey`** can resolve incoming nodes (MEGA often keys by sharer handle, not recipient copy handle).  
- **`fetchMegaPendingInShareKeys`:** `pk` returning **`-9` / `API_ENOENT`** is now treated as a benign "no pending keys" case, matching MEGA SDK/webclient behavior.  
- **`listIncomingShares`:** up to **4 passes** with delays when `su` nodes exist but **`skippedNoDecrypt`** and **no offers**, to allow key-manager / propagation.  
- **Provisional incoming offers:** when MEGA exposes an incoming root with `su` metadata but Nearbytes still cannot decrypt it, the adapter now surfaces a fallback offer from the root metadata instead of reporting `offerCount: 0`. This mirrors the webclient's ability to track inshares before the root name decrypts.
- **Pending-root bootstrap:** when an accepted incoming share exists but the requested root is still undecryptable, recipient bootstrap now stays in retrying `syncing` state instead of treating the first attempt as terminal.
- **Transport script:** **`inviteManagedShareWithMegaRetry`** on **`-3`**; **12s settle** after both invites; **serial** incoming polls (**`INCOMING_OFFER_TIMEOUT_MS` = 720_000**) instead of **parallel** `Promise.all` to reduce concurrent **`f`** / `-3`; and **revoke-only cleanup** now runs even when wipe is skipped.  
- **Not implemented / reverted:** Gmail “`+tag`” normalization for offer matching — test accounts use real addresses as-is; matching stays **trim + case-insensitive** equality only.

## Findings (concise)

| Area | Finding |
|------|--------|
| Polling vs owner sync | `getManagedShareState()` scheduled `ensureSync` on every poll → owner stuck “syncing”. **Mitigation:** throttle scheduling (~120s per share). |
| Owner bootstrap | Repeated `ensureSync` re-ran heavy initial sync even with watchers active. **Mitigation:** skip blocking initial `runSyncLoop` when the owner loop is already active. |
| List vs download | Different trees caused “listed but not downloadable”. **Mitigation:** `listCycleTree` + refetch fallback in owner adapter `download()`. |
| Phantom `channels/` | Entries listed but not resolvable blocked the whole mirror pass. **Mitigation:** `MirrorWorker` skips vanished / missing owner paths. |
| Partial fetch + `-3` | Full fallback after partial failure could enumerate huge trees. **Mitigation:** `allowTransientFullFallback` — readonly paths may full-fallback; owner folder operations use `false`. |
| Incoming offers | Tree shows shared nodes but decrypt fails without share keys → `skippedNoDecrypt`. **Mitigation:** key-manager **cache** when a fetch returns empty; **multi-pass** `listIncomingShares`; **share-key handle aliases** on `k`/`h`. |
| Contact invites | Short lookup timeout was too tight for MEGA. **Mitigation:** longer `FULL_MEGA_CONTACT_INVITES_TIMEOUT_MS` for MEGA. |
| E2E isolation | Shared `/nearbytes` caused cross-run interference. **Mitigation:** per-run `remoteBasePath` (e.g. `/nearbytes-e2e-<id>`) and `NEARBYTES_MEGA_REMOTE_BASE`. |
| Wipe script | Hang risk + huge trees. **Mitigation:** abort timeout; **faster inter-delete delay** (25ms); **revoke-before-wipe** so incoming share list is cleared between the two disposable accounts. |
| Concurrent MEGA API | Two peers polling **incoming** in parallel plus multi-pass discovery amplifies **`-3`** and **empty** listings. **Mitigation:** **serial** incoming poll + longer timeout; invite **`-3` retries**. |
| Official client parity | **`pk` `-9` / `API_ENOENT`** is a normal "nothing pending" case in MEGA clients; it is not evidence of a separate failure. |
| Third-pass cleanup effect | Revoke-only cleanup cut B's stale undecryptable roots **13 -> 1**; the remaining failure is the **fresh** inbound root itself, not the old share pileup. |
| Incoming-root warmup | A fresh inshare root can exist before Nearbytes can decrypt its attributes. **Mitigation:** surface a provisional offer from `su` root metadata and keep accepted recipient bootstrap retrying while the root key is still pending. |

## Hypotheses (current)

1. **Stale cross-shares were a real problem**, and revoke-only cleanup is necessary even when wipe is skipped. That part is now confirmed by the **13 -> 1** reduction in B's undecryptable incoming roots.  
2. The **remaining** failure is **not** explained by stale pileup alone: the **fresh** inbound root **`cIVQ2bjB`** itself arrives on B without `sk` and without any usable key from current key-manager sources.  
3. Nearbytes now matches the MEGA clients more closely at the **discovery** layer by exposing undecryptable `su` roots as provisional offers, so if the live rerun still stalls the remaining root cause is narrower: **share-row / action-packet key delivery or application**, not offer enumeration.  
4. The latest diagnostics further narrow the gap: for the failing incoming root, Nearbytes can now prove the root node itself exists in the `f` snapshot while **all currently consumed key channels remain empty** (`sk`, share rows, pending inshares, resolved share keys).  
5. **`-3`** still adds noise, especially on B owner sync, but after cleanup it no longer explains the missing incoming offer by itself.

## Testing phase (what was run)

1. **Build + integration tests** — `yarn build` and `yarn test` on `megaAdapter`, `mirrorWorker`, `managedShares`.  
2. **`yarn e2e:mega-wipe`** — revoke + wipe; revoke **succeeded**; wipe **slow / interrupted** on very large drive.  
3. **Earlier `NEARBYTES_E2E_SKIP_MEGA_WIPE=1 yarn e2e:mega-bidirectional-transport` runs** — before revoke-only skip-wipe behavior was restored, B accumulated many undecryptable stale incoming roots and still timed out on incoming offers.  
4. **Final third-pass run with corrected revoke-only preflight** — `NEARBYTES_E2E_SKIP_MEGA_WIPE=1 yarn e2e:mega-bidirectional-transport` first revoked stale cross-shares, then ran transport. Result: B's undecryptable incoming roots dropped to **1**, but the remaining root **`cIVQ2bjB`** still never became an offer; B stayed at **`offerCount: 0`**.
5. **`yarn vitest run src/integrations/__tests__/megaAdapter.test.ts`** — **23 passed** after the provisional incoming-offer / pending-root retry change, including new regressions for those cases.
6. **`yarn vitest run src/integrations/__tests__/managedShares.test.ts -t "reconnecting MEGA keeps remote incoming shares pending when local managed-share state was lost"`** — **1 passed**.
7. **Long live pass before rebuilding `dist/`** — timed out, but it had already reached recipient readonly share sync attempts (`share-mega-2-*`) that failed with **`MEGA tree did not include the requested root node.`** That suggests the transport had progressed beyond the old zero-offer deadlock, but treat this only as a partial signal because `dist/` was rebuilt afterwards.
8. **`yarn build` + short rebuilt live pass** — confirmed the new provisional-offer / pending-root strings exist in `dist/integrations/mega.js`; the short rerun exited during owner-A bootstrap with no decisive end-to-end result, so a full rebuilt live rerun is still required.
9. **Fresh rebuilt live rerun** — `NEARBYTES_E2E_SKIP_MEGA_WIPE=1 yarn e2e:mega-bidirectional-transport` again failed waiting for recipient B (`share-mega-2-b328ba`) to become ready. The SC channel listener was clearly alive, but the packets observed during the timeout window were only `ua` account-level actions; no share-affecting packet batch was observed on the mounted shares before the run ended in repeated **`MEGA tree did not include the requested root node.`** failures.
10. **Recipient-cursor + pending-root-diagnostics live reruns** — recipient subscriptions now log their own SC batches in both directions, but those batches remain `ua`-only. The latest diagnostics show the failing root is present in `f` yet still has no `sk`, no share row, no pending-inshare entry, and no usable share key.

## Commands and environment

- **Secrets:** repo-root `.env.e2e` (gitignored). Two MEGA accounts (`NEARBYTES_E2E_MEGA_OWNER_EMAIL`, `NEARBYTES_E2E_MEGA_RECIPIENT_EMAIL`, `NEARBYTES_E2E_MEGA_PASSWORD`).  
- **Revoke + wipe both accounts:**  
  `yarn e2e:mega-wipe`  
  (sets `NEARBYTES_ALLOW_DESTRUCTIVE_MEGA_E2E_WIPE` internally via script.)  
- **Transport only (no wipe):**  
  `NEARBYTES_E2E_SKIP_MEGA_WIPE=1 yarn e2e:mega-bidirectional-transport`  
- **Transport with revoke skipped too (usually a bad idea while debugging stale shares):**  
  `NEARBYTES_E2E_SKIP_MEGA_WIPE=1 NEARBYTES_E2E_SKIP_MEGA_REVOKE=1 yarn e2e:mega-bidirectional-transport`  
- **Transport with revoke+wipe first:** omit `NEARBYTES_E2E_SKIP_MEGA_WIPE=1` (long).  
- **Regression:** `yarn build` + the three integration test files above.

## Next steps for the next owner

1. Start from the **handover prompt** at the top of this file and keep the next session to **3 more attempts total**.  
2. Re-run the live transport with revoke-only cleanup first and confirm whether the fresh root **`cIVQ2bjB`** now appears as a **provisional incoming offer** and whether accepting it transitions into a retrying recipient share instead of stalling at zero offers.  
3. Instrument the **fresh inbound root path** rather than key-manager parsing. Focus on the live root **`cIVQ2bjB`** on B and compare Nearbytes with the webclient's inbound-share flow: `scparser.$add('s')`, `scinshare`, `process_f`, and `nodedec.crypto_decryptnode` inbound-share root handling after the offer has been surfaced.  
4. In particular, explain why the recipient SC listeners now see only **`ua`** account-level packets and no share-affecting packets for the recreated inshare. Determine whether MEGA never delivers such packets for this case, or whether Nearbytes is seeding the cursor only after the relevant packet has already passed.  
5. Verify whether MEGA ever sends a decryptable key for the fresh share root through any follow-up fetch path that Nearbytes is not yet consulting, or whether the accept/invite flow needs an additional post-accept materialization step.  
6. Re-run the MEGA adapter and managed-shares tests after any code change; then rerun the live transport E2E with revoke-only cleanup first.  
7. **Commit** `mega.ts`, `e2e-mega-wipe.mjs`, `e2e-mega-bidirectional-transport.mjs`, `WIP.md`, and any temporary debug helpers once the next narrow hypothesis is validated.  
8. Optional: UI / ops text tying **Undecrypted** to **`skippedNoDecrypt`** and "remove share + reload" per [MEGA help](https://help.mega.io/files-folders/view-move/what-is-an-undecrypted-file-or-folder).

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
- Unless `NEARBYTES_E2E_SKIP_MEGA_WIPE=1`, **revokes outgoing cross-shares** between the two env accounts, then **wipes** Cloud Drive + Rubbish on both (same sequence as `yarn e2e:mega-wipe`)
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
- `scripts/e2e-mega-bidirectional-transport.mjs`
- `scripts/e2e-mega-wipe.mjs`
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
