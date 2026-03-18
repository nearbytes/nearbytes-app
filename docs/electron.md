# Nearbytes Electron Runtime

This document describes the desktop runtime architecture and security model.

## Goals

- Reuse the same server/domain/API code used by `npm run server`.
- Keep UI shared (`ui/`) with no duplicated frontend logic.
- Run API locally inside Electron with desktop-specific runtime controls.

## Runtime Architecture

1. Electron main starts shared API runtime (`startApiRuntime`) in-process.
2. API binds to `127.0.0.1` and random port (`port: 0`).
3. Main generates per-session desktop token.
4. Main writes desktop session file (`~/.nearbytes/desktop-session.json` by default).
5. Preload exposes runtime config (`apiBaseUrl`, `desktopToken`, `isDesktop`) to renderer.
6. Renderer uses existing API endpoints and adds desktop token header automatically.

## Security Controls

- API routes require `x-nearbytes-desktop-token` in desktop mode.
- `/health` is allowed without desktop token for local boot probes.
- Existing `/config/*` local-only checks remain active.
- Desktop UI automation/debug routes are only wired when `DEBUG` is set.
- Session file is written with `0600` permissions.
- BrowserWindow hardening:
  - `contextIsolation: true`
  - `sandbox: true`
  - `nodeIntegration: false`
  - external navigation blocked/opened outside app

## Shared-Code Guarantees

- API code path is shared through `src/server/runtime.ts`.
- CLI server mode (`src/server/index.ts`) calls same runtime.
- Electron mode imports and starts same runtime.
- UI API module remains shared and desktop-aware through bridge config only.

## Scripts

- `dev-run`
- `dev-test`
- `dev-build`
- `production-build`
- `production-build:publish`
- `deploy`

## External Local Integrations

For trusted local apps (e.g. future FUSE tools):

```bash
nearbytes desktop api-info --json
```

Returns runtime API URL + desktop token + expiration metadata.

## Debug-Only UI Automation API

The desktop runtime can expose a protected UI automation/debug API, but only when
debugging is explicitly enabled.

Enable it by either:

- setting `DEBUG=nearbytes`
- passing `--debug` to the CLI or desktop executable
- passing `--debug=<scope1,scope2>` if you want custom DEBUG scopes

When enabled, these routes become available behind the normal desktop token:

- `GET /__debug/ui`
- `POST /__debug/ui/actions/run`
- `POST /__debug/ui/screenshot`

When `DEBUG` is not set, those routes stay unavailable.
