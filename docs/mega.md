# MEGA Integration Guide

This guide explains how Nearbytes integrates with MEGA desktop sync folder to provide cloud-backed storage for encrypted files.

## Overview

At this time the app uses **only the MEGA cloud synced path** by default: when `NEARBYTES_STORAGE_DIR` is not set, the server uses `$HOME/MEGA/NearbytesStorage/NearbytesStorage` (or the Windows equivalent). Nearbytes writes files to that directory, and the MEGA desktop app syncs them to the cloud.

**Shared workflow:** The team uses a shared MEGA folder with structure **MEGA** (top level) → **NearbytesStorage** → **NearbytesStorage** → **blocks**, **channels**. Anyone who clones the repo and is a shared member of that MEGA folder should sync it locally to the standard path (or set `NEARBYTES_STORAGE_DIR`); with the shared secrets they can run the app and see the same photos; new channels and uploads sync via MEGA.

## Storage Structure

When the app uses the default path or you set `NEARBYTES_STORAGE_DIR` to a MEGA sync folder, Nearbytes writes the following structure:

```
$HOME/MEGA/NearbytesStorage/NearbytesStorage/
├── blocks/
│   ├── <hash1>.bin
│   ├── <hash2>.bin
│   └── ...
└── channels/
    └── <channel-id>/
        └── <event-hash>.bin
```

### Blocks Directory

- Contains encrypted file blobs
- Each blob is named by its SHA-256 hash
- Files are encrypted with AES-256-GCM before storage
- Content-addressed: same file content = same hash = same blob

### Channels Directory

- Contains event logs organized by channel (volume)
- Each channel is identified by a public key derived from the secret
- Event logs are signed and immutable
- File state is reconstructed by replaying events

## Setup Instructions

### 1. Create MEGA Sync Folder

Create the folder that will be synced:

```bash
mkdir -p "$HOME/MEGA/NearbytesStorage/NearbytesStorage"
```

### 2. Configure MEGA Desktop App

1. Open MEGA desktop application
2. Go to Settings → Sync
3. Add `$HOME/MEGA/NearbytesStorage/NearbytesStorage` as a sync folder
4. Wait for initial sync to complete (folder should appear in MEGA web UI)

### 3. Configure Nearbytes

If your MEGA folder is at the standard path (`$HOME/MEGA/NearbytesStorage/NearbytesStorage`), no environment variable is needed—the app uses it by default. If your MEGA folder is elsewhere, set the environment variable before starting the server:

```bash
export NEARBYTES_STORAGE_DIR="$HOME/MEGA/NearbytesStorage/NearbytesStorage"
npm run build
npm run server
```

The server will log: `Using storage dir: /Users/yourname/MEGA/NearbytesStorage/NearbytesStorage`

### 4. Verify Sync

1. Upload a file via the UI
2. Check local directory: `ls "$HOME/MEGA/NearbytesStorage/NearbytesStorage/blocks"`
3. Check MEGA web UI: files should appear in the MEGA web interface

## Security Model

### What MEGA Sees

MEGA only sees:
- Encrypted blobs (AES-256-GCM encrypted)
- Signed event files (events are signed; metadata is not additionally encrypted at the storage layer)
- Hash-based block/event filenames

MEGA **never** sees:
- Plaintext file contents
- Secrets or encryption keys

### Key Derivation

- Secrets are never stored in MEGA
- Keys are derived locally using PBKDF2 (100,000 iterations)
- Each volume has a unique key pair derived from its secret
- Without the secret, encrypted blobs are useless

## Cross-Machine Sync

### Setup on Second Machine

1. Install MEGA desktop app on second machine
2. Configure same sync folder: `$HOME/MEGA/NearbytesStorage/NearbytesStorage`
3. Wait for MEGA to sync files from cloud
4. Start Nearbytes server with same `NEARBYTES_STORAGE_DIR`
5. Enter the same secret in UI
6. Files will materialize (decrypted locally using the secret)

### Important Notes

- **Same secret required**: Files are encrypted with keys derived from the secret. You must use the same secret on all machines.
- **MEGA sync is automatic**: Once files are written locally, MEGA syncs them automatically. No manual upload needed.
- **Offline support**: If MEGA is offline, Nearbytes continues to work locally. Files will sync when MEGA reconnects.

## File Operations

### Upload

1. User uploads file via UI
2. Nearbytes encrypts file locally
3. Encrypted blob written to `blocks/<hash>.bin`
4. Event log entry written to `channels/<channel-id>/<event-hash>.bin`
5. MEGA desktop app detects new files and syncs to cloud

### Download

1. User requests file via UI
2. Nearbytes reads encrypted blob from `blocks/<hash>.bin`
3. Decrypts locally using secret-derived key
4. Returns plaintext to user

### Delete

1. User deletes file via UI
2. Nearbytes writes DELETE_FILE event to event log
3. File disappears from volume (but encrypted blob remains in blocks/)
4. Event log syncs to MEGA

## Troubleshooting

### Files Not Syncing

- Check MEGA desktop app is running
- Verify sync folder is configured in MEGA settings
- Check MEGA web UI to see if files appear there
- Ensure `NEARBYTES_STORAGE_DIR` points to the MEGA sync folder

### Files Not Appearing on Second Machine

- Wait for MEGA sync to complete (check MEGA desktop app status)
- Verify same `NEARBYTES_STORAGE_DIR` path on both machines
- Ensure you're using the same secret
- Check MEGA web UI to confirm files are synced

### Storage Directory Not Found

- Ensure directory exists: `mkdir -p "$HOME/MEGA/NearbytesStorage/NearbytesStorage"`
- Check permissions: directory must be writable
- Verify path in server startup log

## Best Practices

1. **Keep MEGA client running**: Files only sync when MEGA desktop app is running
2. **Don't move the folder**: If you move the MEGA folder, update `NEARBYTES_STORAGE_DIR` accordingly
3. **Backup your secrets**: Without the secret, encrypted files cannot be decrypted
4. **Monitor sync status**: Check MEGA desktop app to ensure files are syncing
5. **Don't commit to git**: Add MEGA folder to `.gitignore` if it's in your repository

## Limitations

- **No MEGA API**: Nearbytes does not use MEGA API. It relies entirely on desktop sync folder.
- **Sync delay**: Files sync asynchronously. There may be a delay before files appear on other machines.
- **Storage quota**: Subject to your MEGA storage quota limits.
- **No conflict resolution**: If two machines write simultaneously, MEGA handles conflicts at the file level.

## See Also

- [Verification Checklist](verify-mega.md) - Step-by-step verification steps
- [API Server Documentation](api-server.md) - Server configuration details
- [File System Model](file-system.md) - Storage structure details
