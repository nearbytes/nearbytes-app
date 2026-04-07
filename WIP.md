# WIP

## Rules

- Strictly forbidden: checkmark any item in this file unless that exact item is implemented in the repo.
- An item is not implemented until the relevant code exists, the affected behavior is wired into the product path, and the most relevant verification for that item has been run.
- Do not collapse multiple unfinished items into one checkmark.

## Quality Metrics

- Implemented items: 2 / 8 active items
- Implemented deferred items ahead of schedule: 0 / 7 deferred items

## Section 1: Phase 1 Remaining Items

- [x] Persist and surface a distinct embedded phone LAN peer identity in the shared phone host state.
- [x] Implement a phone-owned LAN service state path so phone LAN status does not depend on mirrored-only desktop-fed snapshots.
- [ ] Implement a phone-owned LAN sync initiation path behind the host contract.
- [ ] Bridge phone runtime object-batch updates into browser-mirror invalidation and resume handling.
- [ ] Add a durable browser-authored object commit path with acknowledgement and retry-safe resume into the phone runtime.
- [ ] Bootstrap the phone mirror from durable runtime heads instead of scan-first reopen behavior where possible.
- [ ] Produce explicit mixed-mode desktop no-regression proof artifacts for the shared surfaces versus legacy desktop surfaces.
- [ ] Close the full Phase 1 release gate with end-to-end phone LAN validation and desktop parity validation.

## Section 2: Explicitly Deferred Runtime Items

- [ ] Phone MEGA runtime support.
- [ ] Phone provider-account runtime support.
- [ ] Phone managed-share runtime support.
- [ ] Phone roots and storage-location management runtime support.
- [ ] Phone updater runtime support.
- [ ] Full desktop runtime replacement.
- [ ] Transport sidecar extraction beyond what Phase 1 LAN delivery requires.
