# MEGA Integration Guide

This guide describes the current Nearbytes MEGA model.

## Current Model

Nearbytes has two MEGA paths:

- Managed provider mode: preferred. The desktop app talks to MEGA directly through the JavaScript implementation.
- Legacy folder mode: optional. Nearbytes writes into a local MEGA-synced folder controlled by `NEARBYTES_STORAGE_DIR`.

Managed provider mode now supports writable owner shares, invite handling, incoming-share discovery, and automatic repair. The key rule is simple:

- Nearbytes publishes through your own writable MEGA Nearbytes root.
- Nearbytes reads from incoming MEGA shares as local copies.
- Nearbytes does not write directly into other people’s shared MEGA folders.

That keeps MEGA as a one-way publication channel per user while the existing Nearbytes storage merge layer combines local reads across sources.

## Managed Provider Behavior

When you connect a MEGA account, Nearbytes automatically:

1. Creates or reuses one writable owner base share at `/nearbytes` for that account.
2. Repairs the local source entry for that share if paths drift.
3. Adds that owner share to `defaultVolume` so it can publish blocks and channels.
4. Discovers incoming shares and exposes them as local sources for reading and merge input.

Incoming shares may carry MEGA permissions such as `read/write` or `full access`, and Nearbytes shows that provider access in the UI. Even so, accepted incoming shares stay read-only at the Nearbytes storage-routing layer. Local writes still go to the user’s own Nearbytes root.

## Storage Semantics

In managed provider mode, think of the local storage view like this:

- Owner MEGA root: writable publication destination.
- Incoming MEGA shares: readable local copies.
- Multi-root merge: combines reads from all enabled sources locally.

This avoids remote cross-account writes while still letting Nearbytes absorb updates from collaborators.

## Read/Write Invites

Nearbytes can send MEGA invites with these access levels:

- `read`
- `read/write`
- `full access`

The access level matters for MEGA itself and is reported in the share UI, but Nearbytes still treats accepted incoming shares as local read-only inputs. The writable publication path remains the owner’s `/nearbytes` share.

## Reliability Notes

The validated product path is the read/write owner-share flow. The old late-stage flake in the live test came from the test harness polling the wrong owner-side metadata path, not from the real app accept flow.

After switching validation to the same recipient-side incoming-offer discovery that the app uses, the read/write live matrix passed 5/5.

Readonly incoming-share reverse transport remains a MEGA-specific weak path and is not the recommended product configuration.

## Security Model

MEGA stores encrypted Nearbytes data only:

- encrypted block blobs
- signed channel/event files
- hash-based filenames and share metadata needed by the provider

MEGA does not receive plaintext file contents or Nearbytes secrets. Secrets stay local and keys are derived locally.

## Legacy Folder Mode

Legacy folder mode still works if you want MEGA desktop sync to mirror a local directory. In that setup, Nearbytes writes under the usual structure:

```text
$HOME/MEGA/NearbytesStorage/NearbytesStorage/
blocks/
channels/
```

Use this only when you explicitly want the MEGA desktop client in the loop. Managed provider mode is the main desktop path now.

## Troubleshooting

If the MEGA storage panel looks stalled:

- check whether the account needs recovery on mega.io
- wait for incoming-share discovery instead of reconnecting immediately
- inspect the MEGA runtime logs from the storage panel before changing credentials

If a share appears writable in MEGA but read-only in Nearbytes, that is expected for incoming shares. Nearbytes intentionally reads from those local copies and publishes only through the connected account’s own Nearbytes root.

## Recommendations

1. Use one connected MEGA account per user as that user’s publication root.
2. Accept incoming shares for reading and merge input, not as write targets.
3. Keep the owner `/nearbytes` share durable so new recipients can catch up later.
4. Prefer the managed provider flow over MEGA desktop sync unless you specifically need the legacy local folder path.

## See Also

- [verify-mega.md](verify-mega.md)
- [mega-protocol.md](mega-protocol.md)
- [file-system.md](file-system.md)
