# Design Ownership Migration

## Rules

- Do not mark an item complete unless the runtime app imports the design-layer Svelte components for that surface or token set.
- Each completed item must include the commit id that landed it.
- Do not merge multiple unfinished migration steps into one completed item.
- Do not treat `docs/specs/ui` as shipped runtime code; use it as approved design source material until the equivalent Svelte runtime layer exists.
- Do not leave old app CSS overriding migrated design components.

## Goal

- End with one canonical design system implemented in Svelte under `ui/src/design`.
- End with the shipped app consuming that design system by importing Svelte components.
- End with `ui/src/App.svelte` acting as orchestration and runtime wiring, not as the place where visible UI structure and styling are invented.

## Completed Foundations

- [x] Move shared workspace chrome state into the design layer and route the runtime workspace chrome through that contract. Commit: `f9dbc08`
- [x] Move the visible app shell into design-layer Svelte components for header, workspace stage, timeline, and empty states. Commit: `3e675f4`

## Required Migration Steps

### Phase 1: Canonical Design System In Svelte

- [ ] Re-express the approved `docs/specs/ui` visual language as canonical runtime design tokens in `ui/src/design` so palette, type, spacing, surfaces, and motion come from one source. Commit:
- [ ] Re-express the approved chrome and shell patterns from `docs/specs/ui` as canonical Svelte design primitives and shell components in `ui/src/design/components`. Commit:
- [ ] Make the design host consume those canonical Svelte tokens and components rather than maintaining a parallel static implementation. Commit:
- [ ] Remove any design-host-only visual rules that are not represented in the canonical Svelte design layer. Commit:

### Phase 2: Remaining Runtime Surface Extraction

- [ ] Extract the file manager shell, file list shell, and preview pane shell into design-layer Svelte components. Commit:
- [ ] Extract the create chooser, identity manager, share dialog, join dialog, reset dialog, and timeline detail dialog shells into design-layer Svelte components. Commit:
- [ ] Extract updater and discovery toast/update surfaces into design-layer Svelte components. Commit:
- [ ] Extract remaining visible state wrappers, empty variants, and panel chrome so `ui/src/App.svelte` no longer owns visible shell markup for those surfaces. Commit:

### Phase 3: App Adoption And Cleanup

- [ ] Replace old app-owned CSS for migrated surfaces with the canonical design-layer CSS and delete obsolete selectors from `ui/src/App.svelte`. Commit:
- [ ] Replace old app-owned markup for migrated surfaces so runtime imports design-layer Svelte components everywhere those surfaces appear. Commit:
- [ ] Reduce `ui/src/App.svelte` to orchestration, runtime state derivation, provider wiring, and callbacks only. Commit:
- [ ] Ensure `ui/src/main.ts` and the normal shipped app path are driven by the canonical design-layer components rather than a separate visual path. Commit:

### Phase 4: Verification And Finalization

- [ ] Validate that changing a canonical component in `ui/src/design/components` changes both the design host and the shipped app surface that imports it. Commit:
- [ ] Validate the full UI build with the fully design-owned runtime path and record the final commit id. Commit:
- [ ] Record completion criteria in this file: design system canonical in Svelte, runtime app consuming it by import, no conflicting app-owned visual layer remaining for migrated surfaces. Commit:

## Definition Of Done

- The approved design system is implemented as Svelte runtime code under `ui/src/design`.
- The shipped app imports that design system directly.
- The design host and the shipped app render the same canonical components.
- Old app CSS no longer overrides migrated design surfaces.
- `ui/src/App.svelte` is orchestration-first rather than presentation-first.

## Notes

- `docs/specs/ui` is the approved design reference, not the final runtime implementation.
- Rebuilding that design system in Svelte is not optional; it is the core migration path.
- The shipped app is not fully design-owned until every visible runtime surface listed above is imported from `ui/src/design`.
