# Desktop Release and Installer Publishing

Nearbytes desktop installers are published from release tags.

## Local Tagging Flow

Use the helper script:

```bash
yarn deploy
# or
npm run deploy
```

The script:

1. Prompts for a version/tag (`1.2.3` or `v1.2.3`)
2. Verifies clean git worktree
3. Creates and pushes `v*` tag

Pushing the tag triggers CI installer builds and publishing.

## CI Release Workflow

Workflow file: `.github/workflows/desktop-release.yml`

Trigger:

- `push` on tags matching `v*`

Build matrix:

- `macos-latest`
- `windows-latest`
- `ubuntu-latest`

Command run:

```bash
npm run production-build:publish
```

## Required / Optional Secrets

Publishing:

- `GITHUB_TOKEN` (provided by Actions)

Optional signing/notarization (unsigned fallback when absent):

- `CSC_LINK`
- `CSC_KEY_PASSWORD`
- `CSC_NAME`
- `WIN_CSC_LINK`
- `WIN_CSC_KEY_PASSWORD`
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`

## Repo Portability

The release workflow resolves publish target dynamically from `GITHUB_REPOSITORY` and exports:

- `NEARBYTES_RELEASE_OWNER`
- `NEARBYTES_RELEASE_REPO`

This avoids hard-coding repository owner/name and supports org/repo migration.

