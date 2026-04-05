# MEGA Storage Verification Checklist

This checklist verifies the current managed-provider MEGA flow.

## What To Validate

The expected behavior is:

1. Connecting MEGA creates or reuses one writable owner Nearbytes root.
2. Accepted incoming MEGA shares appear as local copies.
3. Incoming local copies are readable but not writable in Nearbytes.
4. New Nearbytes writes still publish through the connected account’s own MEGA root.

## Prerequisites

- the app builds and runs locally
- at least one MEGA account for owner-flow checks
- optionally, a second MEGA account for invite and incoming-share checks

## Manual Verification

### 1. Connect a MEGA account

1. Open the storage panel.
2. Sign in to MEGA.
3. Wait for the provider card to refresh.

Verify:

- the account shows as connected
- the storage panel shows a Nearbytes MEGA root for that account
- that owner root is writable in Nearbytes

### 2. Confirm automatic owner-root reuse

1. Refresh the storage panel.
2. Restart the app if needed.
3. Reopen storage.

Verify:

- Nearbytes reuses the same owner root instead of creating duplicates
- the owner root remains attached as the publication destination

### 3. Accept an incoming share

1. From another MEGA account, invite the connected account to a Nearbytes folder.
2. In Nearbytes, accept any pending contact request first.
3. Accept the incoming share from the storage panel.

Verify:

- the incoming share appears under saved locations
- the UI shows the MEGA access level reported by the provider
- the local source is read-only in Nearbytes, even if MEGA granted `read/write` or `full access`

### 4. Verify local read and owner-side publish

1. Attach the accepted incoming share to a hub if needed.
2. Confirm Nearbytes can read data from that local copy.
3. Make a new Nearbytes change from the connected account.

Verify:

- Nearbytes reads from the incoming share locally
- the write path still uses the account’s own writable MEGA root
- Nearbytes does not try to publish directly into the other person’s incoming folder

## Automated Verification

Run the focused unit coverage for the storage policy and presentation layer:

```bash
yarn vitest run src/integrations/__tests__/managedShares.test.ts ui/src/lib/megaSharePresentation.test.ts
```

For the full two-account live transport check, continue using the dedicated MEGA live tests and scripts in the repository workflow.

## Expected Outcomes

- owner MEGA Nearbytes root: writable
- accepted incoming MEGA share: read-only locally
- provider access label: preserved in the UI
- publication path: owner root only
- merge/read path: local multi-root sources

## Failure Signals

Investigate if any of the following happen:

- the storage panel reports a fixed short timeout while MEGA is still loading
- Nearbytes creates duplicate owner `/nearbytes` shares for the same account
- an accepted incoming MEGA share is writable locally
- the UI claims Nearbytes will sync changes both ways through an incoming MEGA share

## Notes

- A provider-side `read/write` invitation does not mean Nearbytes will write into that incoming share.
- The recommended product path is the managed provider flow, not the legacy MEGA desktop sync-folder path.
- If MEGA requires account recovery, complete that on mega.io first and then let Nearbytes retry.
