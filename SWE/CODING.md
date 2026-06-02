# CODING.md — NearBytes UI engineering guidelines

Reference: NearBytes protocol repos (`nearbytes-files`, `nearbytes-chat`,
`nearbytes-skeleton`) and `nearbytes-specs`. These UI rules specialize the
house style for the desktop UI repos and OVERRIDE nothing in the protocol repos.

## 1. Renderer-first
- All logic that can run in the browser/renderer MUST run there.
- No Node, `fs`, `os`, `path`, Electron, or network access in `nearbytes-widgets`
  or `nearbytes-components`. Such access is only permitted in `nearbytes-app`'s
  main process and MUST be funneled through an explicit adapter boundary
  (see §8) backed by external repos (`nearbytes-files`, `nearbytes-skeleton`, …).

## 2. Tailwind-first styling
- Style with Tailwind utility classes only. No `<style>` blocks, no CSS modules,
  no inline `style=` except for dynamic, unrepresentable values (e.g. computed px).
- Colors, radii, fonts come ONLY from design tokens in
  `nearbytes-widgets/src/lib/styles/tokens.css`. Never hard-code hex values.
- Merge classes with `cn()`. Variant APIs use `tailwind-variants`.

## 3. shadcn-svelte-first widgets
- Prefer official shadcn-svelte components / `bits-ui` primitives before authoring
  bespoke interactive widgets. Bespoke widgets are allowed only when no primitive
  exists (Panel, SplitPane, List, EmptyState, StatusIndicator, FilePreview, chat/*).
- Icons come from `@lucide/svelte`, always via the `Icon` wrapper.

## 4. No invented NearBytes domain models
- Do NOT define file, volume, hub, profile, friend, chat, or identity types here.
- Import them from the protocol packages:
  `FileMetadata`, `DirectoryMetadata`, `VolumeFileSystemState` from `nearbytes-files`;
  `ChatMessage`, `ChatTimelineItem`, `IdentityProfile`, `IdentityRecord` from
  `nearbytes-chat`; `NearbytesConfig`, `VolumeConfig`, `ProfileConfig` from
  `nearbytes-skeleton`.
- Widgets are domain-agnostic and take only presentational props.

## 5. Small files & top-down composition
- One component per file. Target < 120 lines; hard cap 200.
- Compose downward: app → components → widgets → ui primitives. Never upward.
- A component renders children via snippets; it does not reach into siblings.

## 6. Svelte 5 conventions
- Runes only: `$props`, `$state`, `$derived`, `$effect`, `$bindable`.
- Pass sub-records of stores by reference and rely on Svelte 5 deep reactivity;
  do not clone state to pass it down.
- Public props are typed; no implicit `any`. `strict` + `noUncheckedIndexedAccess`.

## 7. Accessibility
- Interactive elements are real `<button>`/`<a>`/form controls or bits-ui
  primitives with correct roles. Provide `aria-*` where roles need names.
- Focus-visible styling is required; never remove outlines without replacement.

## 8. Explicit adapter boundaries & no hidden side effects
- Main-process / Electron APIs are reached only through a named adapter interface
  in `nearbytes-app` (`src/preload` + `src/renderer/lib/adapter`). Components depend
  on that typed interface, never on `window.require`, IPC channels, or globals.
- Components and widgets are pure render functions of props + injected stores.
  No module-level side effects, no singletons, no implicit I/O on import.
