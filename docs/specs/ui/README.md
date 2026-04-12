This directory is the design authoring workspace.

Authoritative shared UI source:
- `docs/specs/ui/system/components`
- `docs/specs/ui/system/components/WorkspaceShell.svelte`
- `docs/specs/ui/system/branding.ts`
- `docs/specs/ui/system/contracts.ts`
- `docs/specs/ui/system/desktop.ts`
- `docs/specs/ui/system/joinLinkPresentation.ts`
- `docs/specs/ui/system/tokens.ts`
- `docs/specs/ui/system/uiTransitionStore.ts`
- `docs/specs/ui/system/workspaceChrome.ts`
- `docs/specs/ui/system/global.css`

Production consumption:
- `ui/src/App.svelte` imports the shared components and state helpers from `docs/specs/ui/system`
- `ui/src/App.svelte` consumes the design-owned `WorkspaceShell.svelte`
- `ui/src/lib/branding.ts` and `ui/src/lib/joinLinkPresentation.ts` re-export the design-owned contracts
- `ui/src/main.ts` imports the shared global styles and tokens from `docs/specs/ui/system`

Studio-only shell files:
- `App.svelte`
- `components/StudioNav.svelte`
- `components/StudioControls.svelte`
- `components/StudioOverviewPage.svelte`
- `components/StudioMoodboardPage.svelte`
- `components/StudioPalettePage.svelte`
- `components/TransitionGraphPage.svelte`
- `studio-data.js`

Design rule:
- Change shared UI in `docs/specs/ui/system`
- Do not create a parallel copy under `ui/src`
- Use `yarn design` for the standalone mocked design runtime
- Use `yarn dev` for the real app runtime
- The studio is pure Svelte and must not require a backend to render shared surfaces
- The transition graph must drive the same `UiTransitionStore` type used by the app shell
