# AGENT.md — nearbytes-app

Electron desktop app for NearBytes. Renderer = Svelte 5 + Tailwind consuming
`nearbytes-components`; main process owns the NearBytes runtime and boots
exactly like `nearbytes-cli` (skeleton → file service → sync).

## Read before editing
All work MUST follow **[SWE/CODING.md](./SWE/CODING.md)**.

## Architecture (explicit boundaries)
- `src/main` — Electron main process. `NearbytesService` boots the skeleton from
  config (`createFilesystemSkeletonFromConfig`) and applies profile/hub/friend
  changes via `writeConfig` + `skeleton.reloadSync` — identical sync semantics to
  the CLI. `window.ts`, `tray.ts`, `ipc.ts` handle shell concerns.
- `src/preload` — the ONLY renderer↔main bridge (`contextBridge` → `window.nb`).
- `src/shared/ipc.ts` — the typed IPC contract.
- `src/renderer` — bootstrap only: `App.svelte` provides state + adapter, renders
  `AppShell` from `nearbytes-components`. `lib/ipcAdapter.ts` implements
  `NearbytesAdapter`; `lib/hydrate.ts` wires push events. No layout/widgets here.
  No renderer code imports Node/Electron.

## Renderer-first
Everything that can live in the renderer does. Main-process code is limited to
capability that genuinely requires Node (fs, crypto, sockets) and is reached
only through `NearbytesAdapter`.

## Tray / lifecycle
Closing the window hides it; the app stays resident in the tray/menu bar/status
area (`tray.ts`). Quit only on explicit request.

## Dependencies — GitHub only, always freshest
Every UI/engine package is consumed **only** as `github:nearbytes/<pkg>` and is
built by its own `prepare`/`prepack` script during install. There are **no
local-sibling source aliases** — the app builds identically on any machine
(and in CI) from the published GitHub HEADs. Never reintroduce sibling-dir
resolution; iterate by committing/pushing the upstream package, then refreshing.

## Commands (fully automated build pipeline)
- `yarn refresh` — `scripts/refresh.mjs`: re-resolves every `nearbytes-*` dep to
  the **latest GitHub commit** (Yarn rebuilds only the packages that moved) and
  clears `node_modules/.vite` so the renderer can't serve a stale UI bundle.
- `yarn dev` — **refresh**, then `electron-vite dev` (HMR renderer + main).
- `yarn build` — **refresh**, then `electron-vite build` → `out/`.
- `yarn package` — **refresh**, build, then electron-builder.
- `yarn dev:fast` / `yarn build:fast` — skip the refresh (use the already-installed
  versions) for quick local iteration.
- `yarn check` / `yarn lint` — svelte-check.
