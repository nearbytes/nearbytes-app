# Professor Verification Guide

This guide helps verify that Nearbytes is working correctly after a fresh clone and setup.

## Prerequisites Check

Before starting, ensure:

- [ ] Node.js 18+ is installed (`node --version`)
- [ ] npm is installed (`npm --version`)
- [ ] MEGA desktop app is installed and running
- [ ] MEGA shared folder is synced at `$HOME/MEGA/NearbytesStorage/NearbytesStorage`
- [ ] The folder exists: `ls -la "$HOME/MEGA/NearbytesStorage/NearbytesStorage"`

## Step 1: Clone and Install

```bash
git clone <github-url-provided-to-you>
cd Nearbytes
npm install
cd ui && npm install && cd ..
```

**Note:** If you plan to use scripts directly (e.g., `./scripts/run-mega.sh`), make them executable:
```bash
chmod +x scripts/*.sh
```

**Verify:**
- No errors during installation
- `node_modules` directories exist in both root and `ui/`

## Step 2: MEGA Sync Sanity Check

**🚨 Critical First: Verify MEGA is NOT syncing your entire home directory**

Before proceeding, check that MEGA is configured correctly:

```bash
# This should ONLY show NearbytesStorage, nothing else
ls ~/MEGA
```

**Expected output:**
```
NearbytesStorage
```

**❌ If you see Desktop, Documents, Downloads, Applications, etc.:**
- MEGA is syncing your entire home directory (WRONG!)
- Go to MEGA Settings → Syncs
- Remove the sync that maps your whole home directory
- Add a new sync for ONLY: `/Users/yourname/MEGA/NearbytesStorage/NearbytesStorage` → `/MEGA/NearbytesStorage`
- This does NOT delete local files, only removes the sync configuration

**Why this matters:**
- Syncing your entire home directory is unnecessary, slow, and a privacy risk
- Nearbytes only needs the `NearbytesStorage` folder synced
- You only want encrypted Nearbytes blobs in MEGA, not your entire computer

---

**Now verify MEGA is properly synced:**

```bash
# Check if folder exists
ls -la "$HOME/MEGA/NearbytesStorage/NearbytesStorage" | head

# Check for blocks directory (should exist if files are synced)
ls -la "$HOME/MEGA/NearbytesStorage/NearbytesStorage/blocks" 2>/dev/null | head || echo "Blocks directory not found (expected if no files synced yet)"

# Check for channels directory (should exist if volumes are synced)
ls -la "$HOME/MEGA/NearbytesStorage/NearbytesStorage/channels" 2>/dev/null | head || echo "Channels directory not found (expected if no volumes created yet)"
```

**What to look for:**
- ✅ `~/MEGA` contains ONLY `NearbytesStorage` (not Desktop/Documents/etc.)
- ✅ Folder exists at `$HOME/MEGA/NearbytesStorage/NearbytesStorage`
- ✅ MEGA desktop app shows the folder is synced (check MEGA app status)
- ✅ If files should exist: `blocks/` and `channels/` directories contain `.bin` files
- ⚠️ If folder is empty: Ensure you **accepted the MEGA share** and **waited for sync to complete**

**Verify MEGA is running:**
- Check MEGA desktop app is running (menu bar icon on Mac, system tray on Windows/Linux)
- Check sync status in MEGA app - should show "Synced" or "Syncing" (not "Not synced")
- In MEGA Settings → Syncs, verify you have a sync for ONLY `NearbytesStorage`
- If using a different sync location, note the path for Step 3

## Step 3: Storage Directory (default is MEGA path only)

The app uses only the MEGA cloud synced path by default: when `NEARBYTES_STORAGE_DIR` is not set, it uses `$HOME/MEGA/NearbytesStorage/NearbytesStorage` (or the Windows equivalent).

**If your MEGA folder is at the standard path:** You do not need to set anything; just run the app.

**If your MEGA folder is in a different location:**
```bash
export NEARBYTES_STORAGE_DIR="/path/to/your/actual/mega/sync/folder"
```

**Verify:**
- Environment variable is set: `echo $NEARBYTES_STORAGE_DIR`
- Should output: `/Users/yourname/MEGA/NearbytesStorage/NearbytesStorage` (or your custom path)

## Step 4: Start Development Servers

```bash
npm run dev
```

**Verify:**
- Both servers start without errors
- Backend logs: `Using storage dir: /Users/.../MEGA/NearbytesStorage/NearbytesStorage`
- Backend logs: `Nearbytes API server running at http://localhost:3000`
- UI logs: `Local: http://localhost:5173`

**Alternative:** Use the convenience script:
```bash
npm run mega
```
This automatically sets `NEARBYTES_STORAGE_DIR` and starts both servers.

## Step 5: Verify Server Health

In a new terminal:

```bash
curl http://localhost:3000/health
```

**Expected:** `{"ok":true}`

## Step 6: Open UI in Browser

1. Navigate to `http://localhost:5173`
2. Check browser console for errors (should be empty)

**Verify:**
- UI loads without errors
- Dark theme is applied
- Secret input field is visible

## Step 7: Test with "LeedsUnited" Secret

1. Type `LeedsUnited` in the secret input field
2. Press Enter or wait for automatic load

**Verify:**
- Volume ID appears (hex string)
- If MEGA folder is synced: files appear in the list
- If MEGA folder is empty: shows "No files yet" or empty list
- Last refresh timestamp is displayed

## Step 8: Verify File Download (if files exist)

1. Click on a file in the list
2. File should download

**Verify:**
- Download starts automatically
- File has correct name
- File content matches expected

## Step 9: Verify File Upload (optional)

1. Drag and drop an image file onto the UI
2. File should appear in the list

**Verify:**
- File appears immediately after upload
- File shows correct name, size, and timestamp
- Check MEGA folder: `ls -la "$HOME/MEGA/NearbytesStorage/NearbytesStorage/blocks"`
- New encrypted blob files should appear

## Common Issues

### MEGA Folder Not Synced / Empty Folder

**Symptom:** `ls -la "$HOME/MEGA/NearbytesStorage/NearbytesStorage"` shows empty folder or folder doesn't exist, but files should be there.

**Causes:**
1. **MEGA share not accepted yet** - Most common issue
2. **MEGA desktop app not running**
3. **Sync not completed** - MEGA is still syncing files
4. **Wrong folder path** - MEGA folder is in a different location

**Fix:**
1. **Check MEGA desktop app:**
   - Open MEGA desktop application
   - Check if you have any pending share invitations (usually shown in app)
   - Accept the share if you haven't already
   
2. **Verify sync status:**
   - In MEGA app, check the sync status for `NearbytesStorage` folder
   - Should show "Synced" (green checkmark) when complete
   - If showing "Syncing" or "Pending", wait for it to complete
   
3. **Check MEGA web interface:**
   - Log into MEGA web at https://mega.nz
   - Verify files exist in the shared folder in the cloud
   - If files are in cloud but not locally, sync hasn't completed yet
   
4. **Wait for sync:**
   - MEGA sync can take time depending on file size and internet speed
   - Check MEGA app for sync progress
   - Don't proceed until sync shows "Synced"
   
5. **Verify local files:**
   ```bash
   # Should show files if synced
   ls -la "$HOME/MEGA/NearbytesStorage/NearbytesStorage/blocks"
   ls -la "$HOME/MEGA/NearbytesStorage/NearbytesStorage/channels"
   ```

### MEGA Desktop App Not Running

**Symptom:** MEGA folder exists but files aren't syncing, or MEGA app icon not visible.

**Fix:**
1. Launch MEGA desktop application
2. Check system tray (Windows/Linux) or menu bar (Mac) for MEGA icon
3. Ensure MEGA is logged in and connected
4. Verify sync folder is still configured in MEGA settings

### Wrong MEGA Folder Path

**Symptom:** Server logs show wrong path, or files don't appear even though MEGA is synced.

**Fix:**
1. Find your actual MEGA sync folder location:
   ```bash
   # Check common locations
   ls -la ~/MEGA/NearbytesStorage/NearbytesStorage
   ls -la ~/Documents/MEGA/NearbytesStorage
   ls -la ~/Downloads/MEGA/NearbytesStorage
   ```
   
2. Set the correct path:
   ```bash
   export NEARBYTES_STORAGE_DIR="/actual/path/to/your/mega/folder"
   ```
   
3. Restart the server with the correct path

### MEGA Syncing Entire Home Directory

**Symptom:** `ls ~/MEGA` shows Desktop, Documents, Downloads, Applications, etc. instead of just `NearbytesStorage`.

**This is WRONG and dangerous!** MEGA is syncing your entire computer.

**Fix:**
1. Open MEGA desktop app → Settings/Preferences → Syncs
2. Find the sync that maps your entire home directory (e.g., `/Users/yourname` → `/MEGA`)
3. **Remove/Delete that sync** (this does NOT delete local files, only removes sync config)
4. Add a new sync:
   - **Local folder:** `/Users/yourname/MEGA/NearbytesStorage/NearbytesStorage`
   - **MEGA folder:** `/MEGA/NearbytesStorage` (or the shared folder path)
5. Verify: `ls ~/MEGA` should now show ONLY `NearbytesStorage`

**Why this matters:**
- Syncing your entire home directory uploads unnecessary files (Desktop, Documents, etc.)
- This is slow, uses excessive bandwidth, and is a privacy risk
- Nearbytes only needs the `NearbytesStorage` folder synced

## Troubleshooting

### Wrong Storage Directory

**Symptom:** Files don't appear in MEGA folder, or server logs show wrong path.

**Fix:**
```bash
# Check current value
echo $NEARBYTES_STORAGE_DIR

# Set correctly
export NEARBYTES_STORAGE_DIR="$HOME/MEGA/NearbytesStorage/NearbytesStorage"

# Restart server
# (Stop with Ctrl+C, then run npm run dev again)
```

### MEGA Not Synced Yet

**Symptom:** Empty volume when typing "LeedsUnited", but files should exist.

**Fix:**
1. Check MEGA desktop app is running
2. Verify sync folder is configured in MEGA settings
3. Check MEGA web UI to see if files are in cloud
4. Wait for sync to complete (check MEGA desktop app status)
5. Verify files exist locally: `ls -la "$HOME/MEGA/NearbytesStorage/NearbytesStorage/blocks"`

### Backend Not Running

**Symptom:** UI shows "Backend unavailable" or connection errors.

**Fix:**
1. Check if backend is running: `curl http://localhost:3000/health`
2. If not running, check terminal for errors
3. Ensure `npm run dev` is running from repo root
4. Check port 3000 is not in use: `lsof -i :3000`

### Port Conflict

**Symptom:** Server fails to start with "port already in use" error.

**Fix:**
```bash
# Find process using port 3000
lsof -i :3000

# Kill the process (replace PID with actual process ID)
kill -9 <PID>

# Or use different port
PORT=3001 npm run dev
```

### UI Not Loading

**Symptom:** Browser shows connection error or blank page.

**Fix:**
1. Verify UI server is running (check terminal)
2. Check URL is correct: `http://localhost:5173`
3. Check browser console for errors
4. Try hard refresh: Cmd+Shift+R (Mac) or Ctrl+Shift+R (Windows/Linux)

### Files Not Appearing After Upload

**Symptom:** Upload succeeds but files don't appear in list.

**Fix:**
1. Click "Refresh" button
2. Check browser console for errors
3. Verify backend is running: `curl http://localhost:3000/health`
4. Check storage directory: `ls -la "$HOME/MEGA/NearbytesStorage/NearbytesStorage/blocks"`

### Wrong Files Showing

**Symptom:** Files with wrong names appear in the list.

**Fix:**
1. Hard refresh browser: Cmd+Shift+R (Mac) or Ctrl+Shift+R (Windows/Linux)
2. Clear browser cache
3. Ensure UI code is up to date (filename is now explicitly sent)
4. Re-upload files if needed

## Success Criteria

All of the following should be true:

- ✅ Server health check returns `{"ok":true}`
- ✅ UI loads at `http://localhost:5173` without errors
- ✅ Typing "LeedsUnited" shows files (if MEGA folder is synced)
- ✅ File download works (if files exist)
- ✅ File upload works and files appear in MEGA folder
- ✅ Server logs show correct storage directory

## Next Steps

After verification:

1. Review [MEGA Integration Guide](mega.md) for detailed information
2. Review [UI Documentation](ui.md) for UI-specific details
3. Review [API Server Documentation](api-server.md) for backend details

## Getting Help

If verification fails:

1. Check all prerequisites are met
2. Review troubleshooting section above
3. Check server logs for errors
4. Check browser console for errors
5. Verify MEGA folder is synced and contains files
