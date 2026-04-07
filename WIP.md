# WIP

## Rules

- Strictly forbidden: checkmark any item in this file unless that exact item is implemented in the repo.
- An item is not implemented until the relevant code exists, the affected behavior is wired into the product path, and the most relevant verification for that item has been run.
- Do not collapse multiple unfinished items into one checkmark.

## Quality Metrics

- Implemented items: 12 / 16 active items
- Implemented deferred items ahead of schedule: 0 / 7 deferred items

## Execution Todo For Current Pass

- [ ] Commit the uncommitted MEGA reliability fixes left over from the previous iteration.
- [ ] Commit the uncommitted shared mobile-shell cleanup left over from the previous iteration.
- [ ] Commit the native iPhone embedded-runtime ownership cut so phone no longer falls back to desktop-proxy ownership.
- [ ] Regenerate and commit shipped UI build artifacts so the packaged phone shell matches source behavior.
- [ ] Implement embedded phone provider-account runtime support.
- [ ] Implement embedded phone managed-share runtime support.
- [ ] Implement embedded phone MEGA runtime support.
- [ ] Replace mirrored-only phone LAN sync with an embedded phone LAN runtime.

## Section 1: Phase 1 Remaining Items

- [x] Persist and surface a distinct embedded phone LAN peer identity in the shared phone host state.
- [x] Implement a phone-owned LAN service state path so phone LAN status does not depend on mirrored-only desktop-fed snapshots.
- [x] Implement a phone-owned LAN sync initiation path behind the host contract.
- [x] Bridge phone runtime object-batch updates into browser-mirror invalidation and resume handling.
- [x] Add a durable browser-authored object commit path with acknowledgement and retry-safe resume into the phone runtime.
- [x] Bootstrap the phone mirror from durable runtime heads instead of scan-first reopen behavior where possible.
- [x] Produce explicit mixed-mode desktop no-regression proof artifacts for the shared surfaces versus legacy desktop surfaces.
- [ ] Close the full Phase 1 release gate with end-to-end phone LAN validation and desktop parity validation.

### Actionable Next Items For The Final Release Gate

- [x] Unexclude `src/integrations/__tests__/megaAdapter.test.ts` and rerun it so the release gate reflects real MEGA parity status.
- [x] Capture and group the current `megaAdapter.test.ts` failures into concrete repair buckets with code-path references.
- [x] Repair the MEGA incoming-share mirror write regressions and rerun `megaAdapter.test.ts`.
- [x] Repair the MEGA session refresh regressions and rerun `megaAdapter.test.ts`.
- [x] Repair the MEGA writable invite and share-key regressions and rerun `megaAdapter.test.ts`.
- [ ] Record real multi-host LAN validation results in `WIP.md`.
- [ ] Record real physical iPhone validation results in `WIP.md`.
- [ ] Record release authority and platform decisions in `USER.md` or release notes.

## Section 2: Explicitly Deferred Runtime Items

- [ ] Phone MEGA runtime support.
- [ ] Phone provider-account runtime support.
- [ ] Phone managed-share runtime support.
- [ ] Phone roots and storage-location management runtime support.
- [ ] Phone updater runtime support.
- [ ] Full desktop runtime replacement.
- [ ] Transport sidecar extraction beyond what Phase 1 LAN delivery requires.
