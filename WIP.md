# WIP

## Scope For This Pass

- Move only presentational UI shells and explicit structural transition surfaces into `ui-designer`.
- All real-app UI state transitions must be executed by invoking transition functions exported by `ui-designer`; the app must not directly mutate structural UI state when a design transition exists.
- Keep all runtime, network, backend, orchestration, crypto, parsing, bridge, and non-trivial computation in `ui/src`.
- Explicitly staying in `ui/src` for this pass: `StoragePanel.svelte`, `EventFlowPanel.svelte`, `VolumeChat.svelte`, `JoinLinkSections.svelte`, `NearbytesLogo.svelte`, `AppBrandMark.svelte`, `VolumeIdentity.svelte`, `AudioPreview.svelte`.

## Execution Rules

- Do one numbered step at a time.
- After each step: verify the affected behavior, commit it, record the commit id here, and update the remaining count.
- A step is not done until the app/designer import path is wired and the most relevant build check has passed.

## Steps

1. [x] Commit the pending designer palette scroll/layout fix in `ui-designer/src/app.css`.
	Commit: d9755c7
2. [x] Promote `AppDialog` and `ErrorBadge` into `ui-designer`, then rewire app consumers to the designer-owned versions.
	Commit: d302134
3. [x] Upgrade designer `ShareCard` and `ProviderStatusCard` to the app-safe prop contract, then rewire `StoragePanel` and related consumers to the designer-owned versions.
	Commit: f634ea4
4. [x] Promote `ArmedActionButton` and `IconToggle` into `ui-designer`, then rewire app consumers.
	Commit: fb2ecaf
5. [x] Promote `StatusNotice`, `SecretSeedFields`, and `SharedSecretEditor` into `ui-designer`, then rewire app consumers.
	Commit: 3db7315
6. [x] Expand the designer transition contract where needed and add a real-app transition adapter that invokes `ui-designer` transition functions for structural workspace UI state.
	Commit: 0f3736c
7. [x] Route the real app's current structural UI transitions through the designer transition adapter for overlays, timeline, event flow, pane/view mode, and related workspace chrome state.
	Commit: fda45a7
8. [ ] Promote `ShareSpaceLinkSection` and `VolumeShareDialog` into `ui-designer`, then rewire app consumers through the transition adapter path.
	Commit: pending
9. [ ] Promote `WorkspaceModeBar` and `MountRail` into `ui-designer`, then rewire app consumers so toolbar interactions dispatch designer transitions instead of mutating app UI state directly.
	Commit: pending

## Progress

- Completed steps: 7 / 9
- Remaining steps: 2
