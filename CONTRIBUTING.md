# Contributing

## Ground Rules

- Keep changes focused. Do not mix transport, storage, UI, and release work in one patch unless the boundary demands it.
- Preserve the shared UI and shared protocol path across desktop and phone. Avoid reintroducing host-specific semantics into shared surfaces.
- Add or update tests for any protocol, transport, or parsing change.
- Update [WIP.md](./WIP.md) when a change materially shifts the active implementation state or closes an item that humans are tracking there.

## Setup

1. Clone with submodules.
2. Enable Corepack and install the pinned Yarn version.
3. Run `yarn install`.
4. Use `yarn dev`, `yarn dev-run`, or `yarn dev-iphone` depending on the surface you are changing.

See [README.md](./README.md) for platform prerequisites.

## Validation

Run the smallest relevant check first, then broaden if the area is sensitive.

- `yarn vitest run <path-to-test>`
- `yarn type-check`
- `yarn test`
- `yarn dev-test`

For phone and LAN work, unit tests are not enough. Record any real-device or multi-host verification in [USER.md](./USER.md) or [WIP.md](./WIP.md).

## Pull Requests

- Describe the behavior change, not just the files touched.
- Call out any migration risk, protocol compatibility assumption, or host/runtime tradeoff.
- Include exact validation commands and note any checks you could not run.