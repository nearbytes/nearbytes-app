# MEGA Storage Verification Checklist

This document provides a step-by-step acceptance test to verify that MEGA-backed storage is working correctly.

## Prerequisites

- MEGA desktop app installed and running
- MEGA account set up
- Nearbytes repository cloned and built
- Terminal access

## Step-by-Step Verification

### Step 1: Create MEGA Sync Folder

```bash
mkdir -p "$HOME/MEGA/NearbytesStorage/NearbytesStorage"
```

**Verify:**
- Directory exists: `ls -la "$HOME/MEGA/NearbytesStorage/NearbytesStorage"`

### Step 2: Configure MEGA Desktop App

1. Open MEGA desktop application
2. Go to Settings → Sync
3. Add `$HOME/MEGA/NearbytesStorage/NearbytesStorage` as a sync folder
4. Wait for initial sync to complete

**Verify:**
- Folder appears in MEGA desktop app sync list
- Folder appears in MEGA web UI (https://mega.nz)

### Step 3: Start Backend with MEGA Storage

Storage defaults to `$HOME/MEGA/NearbytesStorage/NearbytesStorage`; set `NEARBYTES_STORAGE_DIR` only if your MEGA folder is elsewhere.

```bash
# Optional: only if MEGA folder is not at $HOME/MEGA/NearbytesStorage/NearbytesStorage
# export NEARBYTES_STORAGE_DIR="$HOME/MEGA/NearbytesStorage/NearbytesStorage"
npm run build
npm run server
```

**Verify:**
- Server starts without errors
- Console shows: `Using storage dir: /Users/yourname/MEGA/NearbytesStorage/NearbytesStorage` (or your custom path)
- Console shows: `Nearbytes API server running at http://localhost:3000`

### Step 4: Start UI

In a new terminal:

```bash
cd ui
npm run dev
```

**Verify:**
- UI starts on http://localhost:5173
- No console errors

### Step 5: Open UI and Enter Secret

1. Open http://localhost:5173 in browser
2. Enter a test secret (e.g., "test-volume")
3. Press Enter or wait for reactive update

**Verify:**
- Volume opens successfully
- Volume ID is displayed
- File count shows 0 (empty volume)

### Step 6: Upload a File

1. Drag a test file into the UI
2. Drop the file

**Verify:**
- File appears in the list immediately
- File shows correct name, size, and date
- No error messages

### Step 7: Verify Files in Local Directory

```bash
ls -la "$HOME/MEGA/NearbytesStorage/NearbytesStorage"
```

**Verify:**
- `blocks/` directory exists
- `channels/` directory exists
- Files appear in `blocks/` directory (encrypted blobs)
- Event logs appear in `channels/` directory

**Example output:**
```
blocks/
  - abc123...def.bin
  - 789xyz...abc.bin
channels/
  - <channel-id>/
    - event1.bin
```

### Step 8: Verify Files in MEGA Web UI

1. Open https://mega.nz in browser
2. Navigate to `NearbytesStorage` folder
3. Check `blocks/` and `channels/` directories

**Verify:**
- Files appear in MEGA web UI
- File structure matches local directory
- Files are synced (check sync status in MEGA desktop app)

### Step 9: Restart Backend and Verify Persistence

1. Stop the backend (Ctrl+C)
2. Restart backend:
   ```bash
   export NEARBYTES_STORAGE_DIR="$HOME/MEGA/NearbytesStorage/NearbytesStorage"
   npm run server
   ```
3. In UI, re-enter the same secret

**Verify:**
- Files materialize again
- File list matches previous session
- Volume ID is the same

### Step 10: Test Cross-Machine Sync (Optional)

If you have access to a second machine:

1. Install MEGA desktop app on second machine
2. Configure same sync folder: `$HOME/MEGA/NearbytesStorage/NearbytesStorage`
3. Wait for MEGA to sync files
4. Start Nearbytes server on second machine:
   ```bash
   export NEARBYTES_STORAGE_DIR="$HOME/MEGA/NearbytesStorage/NearbytesStorage"
   npm run build
   npm run server
   ```
5. Open UI and enter the same secret

**Verify:**
- Files appear on second machine
- Files are identical to first machine
- Uploads from second machine appear on first machine

## Troubleshooting

### Files Not Appearing Locally

- Check `NEARBYTES_STORAGE_DIR` is set correctly
- Verify directory exists and is writable
- Check server logs for errors
- Verify server startup log shows correct path

### Files Not Syncing to MEGA

- Check MEGA desktop app is running
- Verify sync folder is configured in MEGA settings
- Check MEGA web UI to see if files appear
- Wait a few minutes for sync to complete
- Check MEGA desktop app sync status

### Files Not Appearing on Second Machine

- Wait for MEGA sync to complete (check sync status)
- Verify same `NEARBYTES_STORAGE_DIR` path on both machines
- Ensure you're using the same secret
- Check MEGA web UI to confirm files are synced

### Server Won't Start

- Check `NEARBYTES_STORAGE_DIR` is set
- Verify directory exists: `mkdir -p "$HOME/MEGA/NearbytesStorage/NearbytesStorage"`
- Check directory permissions
- Review server error logs

## Success Criteria

All of the following must be true:

- ✅ Server starts and logs correct storage directory
- ✅ Files upload successfully via UI
- ✅ Files appear in local `$HOME/MEGA/NearbytesStorage/NearbytesStorage` directory
- ✅ Files appear in MEGA web UI
- ✅ Files persist after server restart
- ✅ Same secret reopens same volume with same files
- ✅ (Optional) Files sync to second machine

## Quick Verification Script

Run this script to quickly verify storage setup:

```bash
#!/bin/bash
set -euo pipefail

STORAGE_DIR="${NEARBYTES_STORAGE_DIR:-$HOME/MEGA/NearbytesStorage/NearbytesStorage}"

echo "Checking storage directory: $STORAGE_DIR"
if [ ! -d "$STORAGE_DIR" ]; then
  echo "❌ Directory does not exist"
  exit 1
fi

echo "✅ Directory exists"

if [ -d "$STORAGE_DIR/blocks" ]; then
  BLOCK_COUNT=$(find "$STORAGE_DIR/blocks" -type f | wc -l)
  echo "✅ Blocks directory exists ($BLOCK_COUNT files)"
else
  echo "⚠️  Blocks directory does not exist (expected if no files uploaded yet)"
fi

if [ -d "$STORAGE_DIR/channels" ]; then
  CHANNEL_COUNT=$(find "$STORAGE_DIR/channels" -type d -mindepth 1 | wc -l)
  echo "✅ Channels directory exists ($CHANNEL_COUNT channels)"
else
  echo "⚠️  Channels directory does not exist (expected if no volumes created yet)"
fi

echo ""
echo "Storage directory is ready for use!"
```

Save as `scripts/verify-storage.sh` and run:
```bash
chmod +x scripts/verify-storage.sh
./scripts/verify-storage.sh
```

## Next Steps

After verification is complete:

1. Review [MEGA Integration Guide](mega.md) for detailed information
2. Set up MEGA sync on additional machines if needed
3. Configure backup strategy for your secrets
4. Monitor MEGA sync status regularly
