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
- `src/renderer` — UI only. `lib/ipcAdapter.ts` implements `NearbytesAdapter`
  over the preload bridge; `lib/hydrate.ts` wires it into the app-state tree.
  No renderer code imports Node/Electron.

## Renderer-first
Everything that can live in the renderer does. Main-process code is limited to
capability that genuinely requires Node (fs, crypto, sockets) and is reached
only through `NearbytesAdapter`.

## Tray / lifecycle
Closing the window hides it; the app stays resident in the tray/menu bar/status
area (`tray.ts`). Quit only on explicit request.

## Commands
- `yarn dev` — electron-vite dev (HMR renderer + main).
- `yarn build` — electron-vite build → `out/`.
- `yarn check` / `yarn lint` — svelte-check.
- `yarn package` — electron-builder.

## Local development with sibling repos
`nearbytes-widgets` / `nearbytes-components` are referenced via `github:` like
the rest of the ecosystem. For local iteration, link them:
`yarn link ../nearbytes-widgets ../nearbytes-components` (or a Yarn `resolutions`
override) so renderer changes hot-reload across packages.
