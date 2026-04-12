This directory is the design authoring workspace.

Authoritative shared UI source:
- `docs/specs/ui/system/components`
- `docs/specs/ui/system/tokens.ts`
- `docs/specs/ui/system/uiTransitionStore.ts`
- `docs/specs/ui/system/workspaceChrome.ts`

Production consumption:
- `ui/src/App.svelte` imports the shared components and state helpers from `docs/specs/ui/system`
- `ui/src/main.ts` imports the shared global styles and tokens from `docs/specs/ui/system`

Studio-only shell files:
- `App.svelte`
- `components/StudioNav.svelte`
- `components/StudioControls.svelte`
- `components/TransitionGraphPage.svelte`
- `studio.js`
- `studio-data.js`

Design rule:
- Change shared UI in `docs/specs/ui/system`
- Do not create a parallel copy under `ui/src`
