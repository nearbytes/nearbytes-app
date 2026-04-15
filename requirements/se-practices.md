# Software Engineering Requirements & Practices

Document role:

- evergreen engineering constraints
- review-gate requirements
- implementation hygiene rules that apply across feature areas

This document is not the complete Nearbytes requirements set. See [requirements/README.md](/Users/vincenzo/data/local/repos/nearbytes-app/requirements/README.md) for the modular requirements library.

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

### [REQ-CODE-001] No Dead Reactive Declarations

- Svelte `{@const}` bindings declared inside templates must be used in that template. Remove unused ones.

### [REQ-CODE-002] CSS Coupled to Markup

- CSS selectors in component `<style>` blocks must correspond to elements that exist in the component markup.
- Removing a structural element (e.g. `.hub-mode-summary`) must be accompanied by removing its CSS rules.

---

## Architecture Requirements

### [REQ-ARCH-001] Language-Neutral Runtime Boundary

- Shared UI behavior must depend on versioned runtime contracts, not on in-process TypeScript-only implementation details.
- A backend/runtime feature that only works because the UI and runtime currently share a JavaScript environment is not an acceptable target architecture.

### [REQ-ARCH-002] Provider Reactivity Must Be Push-Driven

- Provider-backed hub data owned by the runtime must reach the UI through push-driven semantic events rather than scheduled UI polling.
- Legacy invalidation or watcher paths may remain temporarily as compatibility fallbacks, but new work must target the semantic event path as the normative design.

### [REQ-ARCH-003] Shared Producer Path

- Filesystem, LAN, and MEGA must publish hub reactivity through a shared runtime event path.
- New provider integrations must attach to that shared producer path rather than inventing a provider-specific UI refresh mechanism.

See also:

- [requirements/reactive-provider-ui.md](/Users/vincenzo/data/local/repos/nearbytes-app/requirements/reactive-provider-ui.md)
- [requirements/shared-ui-and-hosts.md](/Users/vincenzo/data/local/repos/nearbytes-app/requirements/shared-ui-and-hosts.md)

---

## Review Checklist (before merging UI changes)

- [ ] No "Refresh" buttons for auto-managed data (REQ-UI-001)
- [ ] No explanation paragraphs inside dialogs or side panels (REQ-UI-002)
- [ ] No duplicate badges/labels that repeat toggle state (REQ-UI-002)
- [ ] Every opened panel/dialog can be closed (REQ-UI-003)
- [ ] Primary flows remain usable at iPhone width with no horizontal overflow (REQ-UI-004)
- [ ] No unused `{@const}` declarations in templates (REQ-CODE-001)
- [ ] No orphaned CSS selectors (REQ-CODE-002)
- [ ] Runtime-to-UI behavior uses versioned, language-neutral contracts (REQ-ARCH-001)
- [ ] Provider-backed hub updates are push-driven rather than discovered by UI polling (REQ-ARCH-002)
- [ ] Filesystem, LAN, and MEGA use the shared producer path for UI reactivity (REQ-ARCH-003)
- [ ] Build produces zero errors and zero unused-CSS warnings
