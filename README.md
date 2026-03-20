# The Nearbytes app

Nearbytes is a cryptographic protocol for storing and sharing mutable data collections with end-to-end encryption. See https://github.com/nearbytes/community for a quick introduction and more pointers to the initiative.

Repository note: the first version of this repo was created as [GabeGiancarlo/Nearbytes](https://github.com/GabeGiancarlo/Nearbytes) and copied on March 12, 2026.

## Overview

Nearbytes is a content-addressed storage system that provides:

- **Content-addressed storage**: Data identified by SHA-256 hash
- **End-to-end encryption**: AES-256-GCM for data, ECDSA P-256 for signatures
- **Immutable event logs**: Signed events streams that give rise to log-based immutability 
- **Channel-based organization**: Each channel identified by a public key
- **Deterministic key derivation**: Channels recreated from secrets

## Electron Desktop (Shared API/UI)

Nearbytes now supports a desktop runtime via Electron while preserving the existing
server-side and browser workflows.

### Dev / Build Targets

You can run these with `yarn <script>` or `npm run <script>`:

- `dev-run`: run Electron desktop in dev mode (Vite UI + shared API runtime), automatically building and using the vendored MEGAcmd helper in supported desktop dev environments
- `dev`: run the shared API runtime and Vite UI, automatically building and using the vendored MEGAcmd helper in supported desktop dev environments
- `desktop:run`: run Electron desktop against the dev UI, automatically building and using the vendored MEGAcmd helper in supported desktop dev environments
- `dev-test`: run shared tests + desktop smoke validation
- `dev-build`: build server + UI + Electron runtime artifacts
- `production-build`: build desktop installers (publish disabled)
- `production-build:publish`: build and publish desktop installers (CI/tag use)
- `deploy`: interactive tag helper that asks for version and pushes `v*` release tag

### Supported Dev Platforms

Nearbytes desktop development is supported on:

- macOS
- Windows
- Linux

The desktop dev flow depends on the vendored `vendor/MEGAcmd` fork and its vendored SDK. Do not remove or skip submodules.

### Deterministic Setup

Use this sequence for a fresh machine or CI-style bootstrap.

1. Clone with submodules:

```bash
git clone --recursive <repo-url>
cd nearbytes-app
```

If the repo is already cloned:

```bash
git submodule update --init --recursive
```

2. Install Node.js and Corepack.

- Use Node.js 20 LTS or newer for development.
- The repository minimum is Node.js 18, but Node.js 20 LTS is the recommended baseline.
- Keep Yarn pinned to the repository version through Corepack.

3. Enable the repository package manager:

```bash
corepack enable
corepack prepare yarn@4.10.3 --activate
```

4. Install JavaScript dependencies:

```bash
yarn install
```

5. Start the desired dev target:

```bash
yarn dev
```

or:

```bash
yarn dev-run
```

Important behavior:

- On Windows, `yarn dev`, `yarn desktop:run`, and `yarn dev-run` fetch the cached Nearbytes MEGAcmd helper release asset from GitHub when needed and stage it under `.nearbytes-dev/megacmd/<platform>-<arch>/bin`.
- On macOS and Linux, `yarn dev`, `yarn desktop:run`, and `yarn dev-run` still configure, build, and stage the vendored MEGAcmd helper from source when needed.
- In normal dev usage you do not need a separate global MEGAcmd installation.
- Always keep `vendor/MEGAcmd` and `vendor/MEGAcmd/sdk` initialized if you are building helper binaries from source or publishing the Windows helper release.

### Platform Prerequisites

Install the platform toolchain before running `yarn dev`, `yarn desktop:run`, or `yarn dev-run`.

#### macOS

Required:

- Xcode Command Line Tools
- Homebrew
- Git
- Node.js 20 LTS or newer
- CMake
- autotools pieces required by the vendored SDK and MEGAcmd build

Recommended command sequence:

```bash
xcode-select --install
brew install git node cmake ninja autoconf autoconf-archive automake pkg-config nasm libtool
corepack enable
corepack prepare yarn@4.10.3 --activate
```

Notes:

- The vendored MEGAcmd build on macOS requires a valid Apple SDK from `xcrun`.
- The Nearbytes dev bootstrap resolves the macOS SDK path automatically during CMake configure.

#### Windows

Required:

- Git
- Node.js 20 LTS or newer
- CMake
- Visual Studio 2022 Build Tools or Visual Studio 2022 Community
- Windows C++ toolchain and SDK components

Install Visual Studio 2022 with these components:

- Desktop development with C++
- MSVC build tools
- MSVC v142 compatibility tools
- Windows 10 or Windows 11 SDK

Recommended package installs from an elevated PowerShell session:

```powershell
winget install --id Git.Git -e
winget install --id OpenJS.NodeJS.LTS -e
winget install --id Kitware.CMake -e
winget install --id Ninja-build.Ninja -e
corepack enable
corepack prepare yarn@4.10.3 --activate
```

Notes:

- Windows dev mode uses the cached GitHub release helper by default.
- Set `NEARBYTES_MEGACMD_RELEASE_TAG` if you want to test a different published helper release.
- Do not rely on a global MEGAcmd install for Nearbytes desktop development unless you intentionally override with `NEARBYTES_MEGACMD_DIR`.

### Manual Windows Helper Release

The repository includes a manual GitHub Actions workflow at `.github/workflows/windows-megacmd-release.yml`.

Use it to build and publish the Windows vendored helper zip that `yarn dev` and `yarn dev-run` consume on Windows.

#### Linux

The documented baseline is Debian or Ubuntu and other distributions with equivalent packages.

Required:

- Git
- Node.js 20 LTS or newer
- C/C++ build toolchain
- CMake
- pkg-config
- autotools pieces required by the vendored SDK and MEGAcmd build

Recommended command sequence for Debian or Ubuntu:

```bash
sudo apt update
sudo apt install -y build-essential git curl zip unzip cmake ninja-build autoconf autoconf-archive automake pkg-config nasm libtool-bin python3
corepack enable
corepack prepare yarn@4.10.3 --activate
```

If Node.js 20 is not already installed, install it before `yarn install` using your preferred package source. One deterministic option is:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

### Verification Checklist

After prerequisites are installed, these checks should succeed:

```bash
node --version
yarn --version
cmake --version
git submodule status --recursive
```

For a full desktop validation run:

```bash
yarn dev-run
```

Expected result:

- the shared API runtime builds
- the Electron runtime builds
- the UI dev server starts
- the vendored MEGAcmd helper is built or reused
- Nearbytes launches with `NEARBYTES_MEGACMD_DIR` pointed at the staged local helper

### Override Behavior

The default development path is to use the vendored helper built from source.

If you intentionally want to point Nearbytes at another MEGAcmd directory, set:

```bash
export NEARBYTES_MEGACMD_DIR=/absolute/path/to/megacmd/bin
```

Nearbytes will then use that explicit command directory instead of a saved helper path.

### Desktop Security Model

- Desktop runtime binds API to `127.0.0.1` on a random port.
- API requires a runtime desktop token via `x-nearbytes-desktop-token`.
- Session `{port, token, expiresAt, pid}` is written locally with `0600` permissions.
- Desktop UI automation/debug endpoints are disabled unless `DEBUG` is set.
- Passing `--debug` to the desktop executable or CLI sets `DEBUG=nearbytes` automatically.
- Local trusted tools can discover current API runtime with:

```bash
nearbytes desktop api-info --json
```

When `DEBUG` is enabled, the desktop runtime also exposes debug-only UI automation endpoints:

- `GET /__debug/ui`
- `POST /__debug/ui/actions/run`
- `POST /__debug/ui/screenshot`

Without `DEBUG`, those endpoints stay unavailable.

### Desktop Environment Variables

- `NEARBYTES_ELECTRON_DEV_SERVER_URL` (default: empty) - when set, Electron loads this dev UI URL
- `NEARBYTES_DESKTOP_SESSION_FILE` (default: `~/.nearbytes/desktop-session.json`) - desktop API session file
- `NEARBYTES_DESKTOP_SESSION_TTL_MS` (default: `28800000`) - desktop API token/session lifetime
- `NEARBYTES_DISABLE_AUTO_UPDATE=1` - disables auto-update checks in desktop runtime
- Nearbytes ships with a built-in Google Drive Desktop app client ID for the default OAuth flow.
- `NEARBYTES_GOOGLE_CLIENT_ID` - optional override if you want to use your own Google OAuth client instead
- `NEARBYTES_GOOGLE_CLIENT_SECRET` - advanced local-only fallback for Google OAuth; not needed for the default Desktop app PKCE flow and should never be committed or shipped
- `NEARBYTES_MEGACMD_DIR` - optional override if you want to point Nearbytes at an existing MEGAcmd install; `yarn dev`, `yarn dev-run`, and `yarn desktop:run` now set this automatically to the vendored development build on supported platforms
- `NEARBYTES_MEGA_REMOTE_BASE` (default: `/Nearbytes`) - remote MEGA folder prefix for Nearbytes-managed shares
- `NEARBYTES_RELEASE_OWNER` / `NEARBYTES_RELEASE_REPO` - repository used by installer publishing and updater metadata

More details: [docs/electron.md](docs/electron.md), [docs/releasing-desktop.md](docs/releasing-desktop.md)

# Stacked information to be verified after recent updates

## Quick Start (CLI)

### 1. Setup a Channel

```bash
nearbytes setup --secret "mychannel:mypassword"
```

This creates a new channel and outputs the public key.

### 2. Store Data

```bash
nearbytes store --file ./photo.jpg --secret "mychannel:mypassword"
```

Outputs:
- Event hash: `abc123...`
- Data hash: `def456...`

### 3. List Events

```bash
nearbytes list --secret "mychannel:mypassword"
```

Lists all events in the channel.

### 4. Retrieve Data

```bash
nearbytes retrieve --event abc123... --secret "mychannel:mypassword" --output ./retrieved-photo.jpg
```

Retrieves and decrypts the data.

## Architecture Overview

Nearbytes follows a layered architecture:

1. **Crypto Layer**: Cryptographic primitives (hash, symmetric, asymmetric)
2. **Storage Layer**: Abstract storage backend with filesystem implementation
3. **Domain Layer**: High-level protocol operations
4. **CLI Layer**: Command-line interface
5. **Server Layer**: HTTP API server (Phase 2)
6. **UI Layer**: Web interface (Phase 3)

See [docs/architecture.md](docs/architecture.md) for details.

## Phase 1: Encrypted File Layer

Nearbytes includes a file-aware event layer that derives file state solely by replaying
the append-only event log for a secret-derived channel. There is no mutable index; the
current file list is reconstructed deterministically from events.

Example usage:

```ts
import { addFile, listFiles, getFile } from './src/domain/fileService.js';
import { readFileSync } from 'fs';

const secret = 'mychannel:mypassword';
await addFile(secret, 'photo.jpg', readFileSync('photo.jpg'), 'image/jpeg');
const files = await listFiles(secret);
const data = await getFile(secret, files[0].blobHash);
```

## Phase 2: Local File Server API

Nearbytes includes a local API server that exposes the Phase 1 file service over
HTTP. `POST /open` accepts the full secret in the request body and returns a
compact Bearer token backed by the running server process. Subsequent requests
normally use that short token instead of resending the secret.

### Run the server

```bash
npm install
npm run build
# Optional: set only if your MEGA folder is elsewhere (default is $HOME/MEGA/NearbytesStorage/NearbytesStorage)
# export NEARBYTES_STORAGE_DIR="$HOME/MEGA/NearbytesStorage/NearbytesStorage"
npm run server
```

The server runs on `http://localhost:3000` by default.

### Configuration

Environment variables:

- `PORT` (default: `3000`) - Server port
- `NEARBYTES_STORAGE_DIR` (default: `$HOME/MEGA/NearbytesStorage/NearbytesStorage` on macOS/Linux, `%USERPROFILE%\MEGA\NearbytesStorage\NearbytesStorage` on Windows) - Storage directory for the legacy direct-folder mode. Set this only if your MEGA sync folder is in a different location (see below).
- `NEARBYTES_ROOTS_CONFIG` (default: `~/.nearbytes/roots.json`) - Local multi-root manifest path
- `NEARBYTES_SERVER_TOKEN_KEY` (optional) - 32-byte key (hex or base64) to keep accepting legacy stateless Bearer tokens as a compatibility fallback
- `NEARBYTES_CORS_ORIGIN` (default: `http://localhost:5173`) - CORS origin
- `NEARBYTES_MAX_UPLOAD_MB` (default: `50`) - Maximum upload size in MB
- `NEARBYTES_GOOGLE_CLIENT_ID` - optional override if you want to use your own Google OAuth client
- `NEARBYTES_GOOGLE_CLIENT_SECRET` - advanced local-only fallback; not needed for the default Desktop app PKCE flow
- `NEARBYTES_MEGACMD_DIR` - optional directory containing the MEGAcmd binaries for Nearbytes-managed MEGA shares
- `NEARBYTES_MEGA_REMOTE_BASE` (default: `/Nearbytes`) - remote MEGA folder prefix for Nearbytes-managed shares

**Shared cloud structure:** The team uses a shared MEGA folder with structure **MEGA** (top level) → **NearbytesStorage** → **NearbytesStorage** → **blocks**, **channels**. Anyone who clones the repo and is a shared member of that MEGA folder should sync it locally to the standard path (or set `NEARBYTES_STORAGE_DIR`); with the shared secrets they can run the app and see the same photos; new channels and uploads sync via MEGA.

**Setting storage when MEGA is elsewhere (macOS / Linux / WSL):**
```bash
export NEARBYTES_STORAGE_DIR="$HOME/MEGA/NearbytesStorage/NearbytesStorage"
```
**Example MEGA paths:** macOS `~/MEGA/NearbytesStorage/NearbytesStorage`, Windows `%USERPROFILE%\MEGA\NearbytesStorage\NearbytesStorage`, Linux `$HOME/MEGA/NearbytesStorage/NearbytesStorage`, MEGA Cloud Drive on macOS `~/Library/CloudStorage/MEGA/...`.

**Quick verification (after starting the server):**
```bash
# See what path the server is using (from startup logs or debug endpoint)
curl -s http://localhost:3000/__debug/storage | jq .

# List channel dirs and block count (replace STORAGE_DIR with value from above)
ls -la "$NEARBYTES_STORAGE_DIR/channels"
ls "$NEARBYTES_STORAGE_DIR/blocks" | wc -l
```

**Debug endpoints (storage only; no secrets):**
- `GET /__debug/storage` - Resolved storage path, channel/block counts, MEGA path hints
- `GET /__debug/channel/:id` - Channel dir path, existence, event file list (name, size, mtime) for channel id (public key hex)
- `GET /config/roots` - Local-only multi-root configuration + runtime status
- `PUT /config/roots` - Local-only multi-root configuration update

### API Endpoints

- `POST /open` - Open a volume with a secret
- `GET /files` - List files in a volume
- `POST /upload` - Upload a file (multipart/form-data)
- `GET /file/:hash` - Download a file by blob hash
- `DELETE /files/:name` - Delete a file by name
- `GET /timeline` - Deterministic timeline of file events
- `POST /snapshot` - Compute/persist on-demand snapshot
- `GET /health` - Health check

### Try the API (secret header mode)

```bash
curl -X POST http://localhost:3000/open \
  -H "Content-Type: application/json" \
  -d '{"secret":"my volume"}'

curl http://localhost:3000/files \
  -H "x-nearbytes-secret: my volume"

curl -X POST http://localhost:3000/upload \
  -H "x-nearbytes-secret: my volume" \
  -F "file=@./photo.jpg"

curl -L http://localhost:3000/file/<hash> \
  -H "x-nearbytes-secret: my volume" \
  -o out.bin

curl -X DELETE http://localhost:3000/files/photo.jpg \
  -H "x-nearbytes-secret: my volume"

curl http://localhost:3000/timeline \
  -H "x-nearbytes-secret: my volume"

curl -X POST http://localhost:3000/snapshot \
  -H "x-nearbytes-secret: my volume"
```

### Try the API (bearer token mode)

```bash
TOKEN=$(curl -s http://localhost:3000/open \
  -H "Content-Type: application/json" \
  -d '{"secret":"my volume"}' | jq -r '.token')

curl http://localhost:3000/files \
  -H "Authorization: Bearer ${TOKEN}"
```

More details: [docs/api-server.md](docs/api-server.md)

## Phase 3: Branded Svelte 5 UI

Nearbytes includes a modern web UI built with Svelte 5 that provides a beautiful, reactive interface for managing encrypted files.

### Run the UI

**Option 1: Run both server and UI together (recommended):**
```bash
# Storage defaults to $HOME/MEGA/NearbytesStorage/NearbytesStorage; set NEARBYTES_STORAGE_DIR only if your MEGA folder is elsewhere
npm run dev
```

This starts both the backend server (port 3000) and UI dev server (port 5173).

**Option 2: Run separately:**

**Terminal 1 - Backend:**
```bash
npm run build
npm run server
```

**Terminal 2 - UI:**
```bash
cd ui
npm install  # First time only
npm run dev
```

Open `http://localhost:5173` in your browser.

### UI Features

- **Secret-based access**: Enter a secret to instantly materialize files
- **Drag & drop upload**: Drop files to add them to a volume
- **Download & delete**: Click files to download, delete button to remove
- **Offline support**: Cached file listings work offline
- **PWA**: Installable as a web app with service worker caching

The UI proxies API calls to the backend running on port 3000. See [docs/ui.md](docs/ui.md) for UI architecture and endpoint details.

More details: [docs/ui.md](docs/ui.md)

## Phase 4: MEGA-backed Storage (Desktop Sync Folder)

Nearbytes can use MEGA desktop sync folder as the storage backend. This enables automatic cloud sync of encrypted blobs and logs across multiple machines.

### Setup MEGA Storage

1. **Create MEGA sync folder:**
   ```bash
   mkdir -p "$HOME/MEGA/NearbytesStorage/NearbytesStorage"
   ```

2. **Configure MEGA desktop app:**
   - Open MEGA desktop app
   - Add `$HOME/MEGA/NearbytesStorage/NearbytesStorage` as a sync folder
   - Wait for initial sync to complete

3. **Run backend and UI together:**
   ```bash
   export NEARBYTES_STORAGE_DIR="$HOME/MEGA/NearbytesStorage/NearbytesStorage"
   npm run dev
   ```

   This starts both the backend server (port 3000) and UI dev server (port 5173).
   The server will log: `Using storage dir: /Users/yourname/MEGA/NearbytesStorage/NearbytesStorage`

   **Or run separately:**
   ```bash
   # Terminal 1 - Backend
   export NEARBYTES_STORAGE_DIR="$HOME/MEGA/NearbytesStorage/NearbytesStorage"
   npm run build
   npm run server

   # Terminal 2 - UI
   cd ui
   npm run dev
   ```

### How It Works

- **Local encryption**: Nearbytes encrypts all files locally before writing to storage
- **MEGA stores ciphertext + signed metadata**: Encrypted blobs are opaque ciphertext; event files are signed records and can include cleartext metadata like logical filename and timestamps
- **Secret controls access**: The secret is never stored in MEGA; it's only used locally to derive encryption keys
- **Cross-machine sync**: Share the MEGA folder across machines to enable shared storage

### Convenience Scripts

**Start server and UI together:**
```bash
export NEARBYTES_STORAGE_DIR="$HOME/MEGA/NearbytesStorage/NearbytesStorage"
npm run dev
```

**Or use the provided script to start just the server with MEGA storage:**
```bash
./scripts/run-mega.sh
```

This script automatically sets `NEARBYTES_STORAGE_DIR` and ensures the directory exists.

### Important Warnings

⚠️ **Do not rename or move the MEGA folder** once you start storing volumes unless you also update the `NEARBYTES_STORAGE_DIR` environment variable accordingly.

⚠️ **Keep MEGA client running** for automatic sync. Files written by Nearbytes will sync to MEGA cloud automatically.

⚠️ **Never commit the MEGA folder** into git. Add it to `.gitignore` if it's in your repository.

### Verification

See [docs/verify-mega.md](docs/verify-mega.md) for step-by-step verification instructions.

More details: [docs/mega.md](docs/mega.md)

## Storage Structure

Logical storage layout (conceptual, not hard-coded paths):

```
/storage
  /blocks/<hash>.bin          # Encrypted file blobs (content-addressed)
  /channels/<channel-id>/     # Event logs per channel
    /<event-hash>.bin         # Signed event entries
```

Files are stored as:
- **Blocks**: Encrypted file content, named by SHA-256 hash
- **Channels**: Event logs organized by channel (volume) public key
- **Events**: Immutable signed events that reconstruct file state

See [docs/file-system.md](docs/file-system.md) for detailed storage structure.

## Security

- All data is encrypted with AES-256-GCM
- Signatures use ECDSA P-256
- Keys derived using PBKDF2 with 100,000 iterations
- No external crypto libraries (Web Crypto API only)
- Secrets are never stored - only used locally to derive keys

See [docs/crypto.md](docs/crypto.md) for cryptographic details.

## Development

### Setup

```bash
# Install dependencies
npm install
cd ui && npm install && cd ..

# Build
npm run build

# Test
npm test

# Lint
npm run lint

# Format
npm run format
```

### Development Workflow

**Start both server and UI:**
```bash
npm run dev
```

**Start only server:**
```bash
npm run dev:server
```

**Start only UI:**
```bash
npm run dev:ui
```

### Scripts

- `npm run build` - Build TypeScript to JavaScript
- `npm run server` - Run backend server
- `npm run dev` - Run both server and UI together
- `npm run dev:server` - Build and run server
- `npm run dev:ui` - Run UI dev server
- `npm test` - Run tests
- `npm run lint` - Lint code
- `npm run format` - Format code

## Documentation

- [Architecture](docs/architecture.md) - System architecture overview
- [Cryptographic Details](docs/crypto.md) - Encryption and signing details
- [API Reference](docs/api.md) - API endpoint documentation
- [API Server Guide](docs/api-server.md) - Server setup and configuration
- [Usage Guide](docs/usage.md) - CLI usage examples
- [File System Model](docs/file-system.md) - Storage structure details
- [UI Documentation](docs/ui.md) - UI architecture and features
- [MEGA Integration](docs/mega.md) - MEGA storage setup guide
- [Professor Verification](docs/professor-verify.md) - Step-by-step verification
- [MEGA Verification](docs/verify-mega.md) - MEGA storage verification

## License

GNU GPL v3.0 - see [LICENSE](LICENSE)
