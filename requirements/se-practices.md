# Software Engineering Requirements & Practices

This document captures non-negotiable software engineering principles for the Nearbytes codebase. All contributors and AI agents must follow these requirements.

---

## UI / UX Requirements

### [REQ-UI-001] No Manual Refresh

**The application must never present the user with a manual "Refresh" button for data that the app owns and manages.**

- Rationale: Nearbytes is a reactive, event-driven application. Expecting users to poll for updates is a UX failure.
- Implementation: All data the app syncs (file lists, hub status, storage metrics, incoming shares) must refresh via reactive subscriptions, background timers, or event callbacks.
- Exceptions: Actions the user explicitly triggers (e.g. "scan for suggestions") may have a manual trigger, but must also run automatically on relevant events.
- Scope: Any `<button>` labelled "Refresh", "Reload", "Check again", etc. that calls a data-fetch function is a violation of this requirement unless it is a recovery action after an explicit error.

### [REQ-UI-002] Minimalist Information Density

- The UI must not explain what the app does in running prose within dialogs or panels.
- Status is communicated through compact badges, icons, and concise labels — not paragraphs.
- Empty states must be actionable (button) or silent — never explanatory paragraphs of text.
- Duplicate information (e.g. a badge that replicates what a toggle already shows) must be removed.

### [REQ-UI-003] Closeable Dialogs

- Every dialog or panel that can be opened must have an unambiguous close/dismiss action.
- Opening a secondary panel from within a dialog must not forcibly close the originating dialog.

### [REQ-UI-004] Shared UI Must Work At iPhone Size

- The shared UI is not desktop-only. It must remain usable on iPhone-width screens because the same app surface is reused by the mobile shell.
- All primary flows must remain operable at widths around `390px` without horizontal overflow, clipped action rows, or unreachable controls.
- Dialogs, workspace toolbars, file/chat panes, and identity flows must collapse into a phone-usable layout rather than assuming pointer-precision or wide-screen space.
- A UI change that works on desktop but makes the shared shell unusable on iPhone-sized screens is a regression.

---

## Code Quality Requirements

### [REQ-ARCH-001] Design System Owns Shared UI

- Shared surfaces, dialogs, shell composition, tokens, and presentation contracts must live under `docs/specs/ui/system`.
- `ui/src` must consume those design-owned modules instead of defining parallel visual copies.
- Shared surfaces under `docs/specs/ui/system/components` must not import `ui/src/lib/*` directly; they consume runtime behavior only through `docs/specs/ui/system/runtime.ts`.

### [REQ-ARCH-002] Studio Is A Pure Mocked Runtime

- `yarn design` must render without backend dependencies.
- The studio may use mock data and local persistence, but not runtime transports, backend fetches, or app-only shells to render its primary design views.
- The transition graph must drive the same UI store type used by the app, backed by mocked data in the studio.
- The studio-owned runtime implementation lives under `docs/specs/ui/system/mockRuntime.ts`.

### [REQ-ARCH-003] App Integrates Logic, Not Alternate Design

- The app may own browser/runtime effects, subscriptions, and transport logic.
- The app must not become a second place where shared UI surfaces are designed or re-authored.
- When a reusable UI surface changes, the change belongs in the design system and the app should pick it up through imports.
- The app must provide live runtime behavior to shared surfaces through `ui/src/lib/design/runtime.ts` and `docs/specs/ui/system/runtime.ts`, not by re-implementing those surfaces in `ui/src`.

### [REQ-CODE-001] No Dead Reactive Declarations

- Svelte `{@const}` bindings declared inside templates must be used in that template. Remove unused ones.

### [REQ-CODE-002] CSS Coupled to Markup

- CSS selectors in component `<style>` blocks must correspond to elements that exist in the component markup.
- Removing a structural element (e.g. `.hub-mode-summary`) must be accompanied by removing its CSS rules.

---

## Review Checklist (before merging UI changes)

- [ ] No "Refresh" buttons for auto-managed data (REQ-UI-001)
- [ ] No explanation paragraphs inside dialogs or side panels (REQ-UI-002)
- [ ] No duplicate badges/labels that repeat toggle state (REQ-UI-002)
- [ ] Every opened panel/dialog can be closed (REQ-UI-003)
- [ ] Primary flows remain usable at iPhone width with no horizontal overflow (REQ-UI-004)
- [ ] Shared surfaces live in `docs/specs/ui/system` and are consumed by the app, not duplicated (REQ-ARCH-001)
- [ ] Shared surfaces do not import `ui/src/lib/*` directly; runtime behavior is injected through `docs/specs/ui/system/runtime.ts` (REQ-ARCH-001)
- [ ] `yarn design` remains backend-free and graph-driven by the shared UI store type (REQ-ARCH-002)
- [ ] App-side changes do not re-author shared surface design in `ui/src` (REQ-ARCH-003)
- [ ] No unused `{@const}` declarations in templates (REQ-CODE-001)
- [ ] No orphaned CSS selectors (REQ-CODE-002)
- [ ] Build produces zero errors and zero unused-CSS warnings
