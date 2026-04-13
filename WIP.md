# WIP

## Scope For This Pass

- Move only presentational UI shells and explicit structural transition surfaces into `ui-designer`.
- Keep all runtime, network, backend, orchestration, crypto, parsing, bridge, and non-trivial computation in `ui/src`.
- Explicitly staying in `ui/src` for this pass: `StoragePanel.svelte`, `EventFlowPanel.svelte`, `VolumeChat.svelte`, `JoinLinkSections.svelte`, `NearbytesLogo.svelte`, `AppBrandMark.svelte`, `VolumeIdentity.svelte`, `AudioPreview.svelte`.

## Execution Rules

- Do one numbered step at a time.
- After each step: verify the affected behavior, commit it, record the commit id here, and update the remaining count.
- A step is not done until the app/designer import path is wired and the most relevant build check has passed.

## Steps

1. [x] Commit the pending designer palette scroll/layout fix in `ui-designer/src/app.css`.
	Commit: d9755c7
2. [ ] Promote `AppDialog` and `ErrorBadge` into `ui-designer`, then rewire app consumers to the designer-owned versions.
	Commit: pending
3. [ ] Upgrade designer `ShareCard` and `ProviderStatusCard` to the app-safe prop contract, then rewire `StoragePanel` and related consumers to the designer-owned versions.
	Commit: pending
4. [ ] Promote `ArmedActionButton` and `IconToggle` into `ui-designer`, then rewire app consumers.
	Commit: pending
5. [ ] Promote `StatusNotice`, `SecretSeedFields`, and `SharedSecretEditor` into `ui-designer`, then rewire app consumers.
	Commit: pending
6. [ ] Promote `ShareSpaceLinkSection` and `VolumeShareDialog` into `ui-designer`, then rewire app consumers.
	Commit: pending
7. [ ] Promote `WorkspaceModeBar` and `MountRail` into `ui-designer`, then rewire app consumers.
	Commit: pending

## Progress

- Completed steps: 1 / 7
- Remaining steps: 6
