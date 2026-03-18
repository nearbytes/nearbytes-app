# Nearbytes Local API Server

Nearbytes Phase 2 exposes the Phase 1 file service over a local HTTP API.

**Auth rule:** `POST /open` receives the secret once and returns a compact
Bearer token backed by the running server process. Subsequent requests normally
use that short token. Direct `x-nearbytes-secret` auth is still accepted, and
legacy stateless Bearer tokens remain supported when `NEARBYTES_SERVER_TOKEN_KEY`
is configured.

## Base URL

```
http://localhost:3000
```

## Auth

Two auth modes are supported:

- `Authorization: Bearer <token>` (preferred, compact in-process session token)
- `x-nearbytes-secret: <secret>` (header secret)

**Precedence:** If both are provided, the Bearer token is used.

### Token mode

`POST /open` returns a compact bearer token that can be used for subsequent
requests. If `NEARBYTES_SERVER_TOKEN_KEY` is configured, the server also accepts
legacy stateless Bearer tokens for compatibility with older clients.

## Error format

```json
{
  "error": {
    "code": "INVALID_REQUEST",
    "message": "human readable message"
  }
}
```

## Endpoints

### GET /health

Returns `{ "ok": true }`.

### POST /open

Request:

```json
{ "secret": "string" }
```

Response:

```json
{
  "volumeId": "hex",
  "fileCount": 0,
  "files": [
    { "filename": "string", "blobHash": "string", "size": 123, "mimeType": "string", "createdAt": 1234567890 }
  ],
  "token": "optional bearer token"
}
```

### GET /files

Returns the file list for the authenticated volume.

```json
{
  "volumeId": "hex",
  "files": [
    { "filename": "string", "blobHash": "string", "size": 123, "mimeType": "string", "createdAt": 1234567890 }
  ]
}
```

### GET /timeline

Returns deterministic file events (chronological) for the authenticated volume.

```json
{
  "volumeId": "hex",
  "eventCount": 2,
  "events": [
    {
      "eventHash": "hex",
      "type": "CREATE_FILE",
      "filename": "photo.jpg",
      "timestamp": 1738790900000
    }
  ]
}
```

### POST /snapshot

Computes and persists an on-demand snapshot file in the volume channel directory.

```json
{
  "snapshot": {
    "generatedAt": 1738790900000,
    "eventCount": 12,
    "fileCount": 3,
    "lastEventHash": "hex-or-null"
  }
}
```

### POST /upload

Multipart upload. Fields:

- `file` (required)
- `filename` (optional)
- `mimeType` (optional)

Response:

```json
{
  "created": {
    "filename": "string",
    "blobHash": "string",
    "size": 123,
    "mimeType": "string",
    "createdAt": 1234567890
  }
}
```

### DELETE /files/:name

Deletes by logical filename.

```json
{ "deleted": true, "filename": "string" }
```

### GET /file/:hash

Downloads and decrypts the file by blob hash.

- `Content-Type`: best effort
- `Content-Disposition`: `attachment; filename="..."` (falls back to `<hash>.bin`)

Returns raw bytes (not JSON).

### POST /references/source/export

Exports one or more logical filenames from the authenticated source volume as a source-bound `nb.src.refs.v1` bundle.

Request:

```json
{
  "filenames": ["notes/todo.txt", "photos/a.jpg"]
}
```

### POST /references/source/import

Imports a source-bound `nb.src.refs.v1` bundle into the authenticated destination volume.

Request:

```json
{
  "sourceSecret": "string",
  "bundle": { "p": "nb.src.refs.v1", "s": "hex", "items": [] }
}
```

### POST /references/recipient/export

Exports one or more logical filenames from the authenticated source volume as a recipient-bound `nb.refs.v1` bundle.

Request:

```json
{
  "recipientVolumeId": "hex",
  "filenames": ["notes/todo.txt"]
}
```

### POST /references/recipient/import

Imports a recipient-bound `nb.refs.v1` bundle into the authenticated destination volume.

Request:

```json
{
  "bundle": { "p": "nb.refs.v1", "r": "hex", "items": [] }
}
```

### GET /config/roots (local-only)

Returns local multi-root configuration and runtime root status. Requests are accepted only from loopback clients.

```json
{
  "configPath": "/Users/alice/.nearbytes/roots.json",
  "config": { "version": 1, "roots": [] },
  "runtime": { "roots": [], "writeFailures": [] }
}
```

### PUT /config/roots (local-only)

Persists and applies multi-root configuration immediately.

Request body:

```json
{
  "config": {
    "version": 1,
    "roots": [
      {
        "id": "main-default",
        "kind": "main",
        "path": "/abs/path",
        "enabled": true,
        "writable": true,
        "strategy": { "name": "all-keys" }
      }
    ]
  }
}
```

### GET /integrations/accounts (local-only)

Returns connected provider accounts plus provider cards the UI can render.

### POST /integrations/accounts/connect (local-only)

Starts or completes one provider account connection flow. Google Drive can return a pending OAuth session; MEGA completes immediately when credentials are valid.

Request:

```json
{
  "provider": "gdrive",
  "label": "Primary Drive",
  "preferred": true
}
```

MEGA request example:

```json
{
  "provider": "mega",
  "label": "Main MEGA",
  "credentials": {
    "email": "owner@example.com",
    "password": "secret",
    "mfaCode": "123456"
  }
}
```

Google OAuth polling request example:

```json
{
  "provider": "gdrive",
  "authSessionId": "oauth-gdrive-..."
}
```

### POST /integrations/providers/:provider/config (local-only)

Stores local provider setup needed before account connection. Nearbytes already ships with a built-in Google Drive Desktop app client ID, so this endpoint is mainly for advanced local overrides. The client secret field remains available only as an advanced local-only override.

Request:

```json
{
  "clientId": "1234567890-abc123.apps.googleusercontent.com"
}
```

### POST /integrations/providers/:provider/install (local-only)

Downloads and prepares provider-specific local helpers when a provider needs them. Nearbytes uses this for automatic MEGAcmd setup.

### POST /integrations/providers/:provider/reconcile (local-only)

Reconciles the provider's managed-share inventory against local Nearbytes state. This adopts live provider mirrors, retires stale local entries, and migrates stale managed-share data back into the primary local root instead of deleting it.

### GET /integrations/shares (local-only)

Returns Nearbytes-managed provider shares, their attached spaces, and current local mirror state.

### POST /integrations/shares (local-only)

Creates one managed provider share and optionally attaches it to a space.

Request:

```json
{
  "provider": "gdrive",
  "accountId": "acct-gdrive-...",
  "label": "Project mirror",
  "volumeId": "<spaceVolumeIdHex>",
  "remoteDescriptor": { "remoteId": "drive-folder-id" }
}
```

### POST /integrations/shares/:shareId/invite (local-only)

Adds invitee emails to the managed share record.

### POST /integrations/shares/:shareId/attach (local-only)

Attaches an existing managed share to one space.

### POST /integrations/shares/accept (local-only)

Creates a managed share record for a recipient-side route and optionally attaches it.

### GET /integrations/shares/:shareId/state (local-only)

Returns one managed share plus its attachment and mirror status summary.

### POST /links/join/parse (local-only)

Parses an `nb.join.v1` object or JSON string and returns the ranked transport plan for this device.

### POST /links/join/open (local-only)

Parses and plans an `nb.join.v1` payload, derives the target space volume id, and auto-attaches the best compatible managed provider routes when possible.

`allowCredentialBootstrap` MAY be set to `true` to let the server use endpoint-carried provider login material during open. Clients should default this to `false` and require an explicit user action before enabling it.

## Configuration

Environment variables:

- `PORT` (default `3000`)
- `NEARBYTES_STORAGE_DIR` (default `$HOME/MEGA/NearbytesStorage/NearbytesStorage` on macOS/Linux, `%USERPROFILE%\MEGA\NearbytesStorage\NearbytesStorage` on Windows)
- `NEARBYTES_ROOTS_CONFIG` (optional; default `~/.nearbytes/roots.json`) - local multi-root manifest path
- `NEARBYTES_SERVER_TOKEN_KEY` (optional; enables Bearer tokens)
- `NEARBYTES_CORS_ORIGIN` (default `http://localhost:5173`, use `*` for any origin)
- `NEARBYTES_MAX_UPLOAD_MB` (default `50`)
- `NEARBYTES_GOOGLE_CLIENT_ID` (optional override for the built-in Google Drive Desktop app client ID)
- `NEARBYTES_GOOGLE_CLIENT_SECRET` (advanced local-only override; not needed for the default Desktop app PKCE flow)
- `NEARBYTES_MEGACMD_DIR` (optional directory containing `mega-login`, `mega-sync`, and the rest of the MEGAcmd binaries)
- `NEARBYTES_MEGA_REMOTE_BASE` (default `/Nearbytes`) - remote MEGA folder prefix for Nearbytes-managed shares

## Example flow (header secret)

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

## Example flow (bearer token)

```bash
TOKEN=$(curl -s http://localhost:3000/open \
  -H "Content-Type: application/json" \
  -d '{"secret":"my volume"}' | jq -r '.token')

curl http://localhost:3000/files \
  -H "Authorization: Bearer ${TOKEN}"
```
