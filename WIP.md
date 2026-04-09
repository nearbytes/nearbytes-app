# Design Ownership Migration

## Rules

- Do not mark an item complete unless the runtime app imports the design-layer Svelte components for that surface.
- Each completed item must include the commit id that landed it.
- Do not merge multiple unfinished migration steps into one completed item.

## Migration Steps

- [x] Move shared workspace chrome state into the design layer and route the runtime workspace chrome through that contract. Commit: `f9dbc08`
- [x] Move the visible app shell into design-layer Svelte components for header, workspace stage, timeline, and empty states. Commit: `3e675f4`
- [ ] Extract the file manager and preview pane into design-layer Svelte components. Commit:
- [ ] Extract modal shells and toast/update surfaces into design-layer Svelte components. Commit:
- [ ] Wire the remaining visible runtime surfaces so `ui/src/App.svelte` is orchestration-only. Commit:
- [ ] Validate the fully design-owned runtime path in the UI build and record the final commit id. Commit:

## Notes

- The current design layer lives under `ui/src/design`.
- The shipped app still has remaining visible surfaces owned in `ui/src/App.svelte` until the unchecked items above are completed.
