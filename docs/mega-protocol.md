# MEGA Protocol Notes

This note captures the protocol pieces Nearbytes needs in order to replace the current MEGAcmd-dependent MEGA backend with direct Node code.

It is intentionally narrow. It covers the authenticated session flow, resumable readonly sync primitives, and the command shapes that matter first. It does not try to restate the entire SDK.

## Sources

- Vendored SDK login and session restore: [vendor/MEGAcmd/sdk/src/megaclient.cpp](../vendor/MEGAcmd/sdk/src/megaclient.cpp)
- Vendored SDK command builders: [vendor/MEGAcmd/sdk/src/commands.cpp](../vendor/MEGAcmd/sdk/src/commands.cpp)
- Vendored SDK action-packet handlers: [vendor/MEGAcmd/sdk/include/mega/megaclient.h](../vendor/MEGAcmd/sdk/include/mega/megaclient.h)
- Vendored SDK command declarations: [vendor/MEGAcmd/sdk/include/mega/command.h](../vendor/MEGAcmd/sdk/include/mega/command.h)
- Upstream SDK reference: https://github.com/meganz/sdk/blob/master/src/megaclient.cpp
- Upstream webclient reference for fetch/action-packet handling: https://github.com/meganz/webclient/blob/master/js/mega.js

## Login Flow

MEGA uses a two-step authenticated account flow.

1. Prelogin uses `us0` with `user` to discover the account authentication version and optional salt.
2. Login uses `us` with `user`, `uh`, optional `mfa`, optional `sek`, optional cached `sn`, and device identifier `si`.

Relevant vendored builders and handlers:

- `CommandPrelogin` in [vendor/MEGAcmd/sdk/src/commands.cpp](../vendor/MEGAcmd/sdk/src/commands.cpp)
- `CommandLogin` in [vendor/MEGAcmd/sdk/src/commands.cpp](../vendor/MEGAcmd/sdk/src/commands.cpp)
- `MegaClient::prelogin`, `MegaClient::login`, `MegaClient::login2`, `MegaClient::fastlogin` in [vendor/MEGAcmd/sdk/src/megaclient.cpp](../vendor/MEGAcmd/sdk/src/megaclient.cpp)

Important details for Nearbytes:

- Account version 1 uses the legacy email-hash path.
- Account version 2 derives a 32-byte key from password and salt, then uses the second half as `uh`.
- The login request can send cached `sn` so the server can tell the client whether local state continuity is still valid.
- Successful login returns the user handle, encrypted master key material, session identifiers, and optional `sek`.

## Session Persistence

The SDK persists reconnect information with `MegaClient::dumpsession()` and restores it with `MegaClient::login(string session, ...)`.

Relevant source:

- `MegaClient::dumpsession` in [vendor/MEGAcmd/sdk/src/megaclient.cpp](../vendor/MEGAcmd/sdk/src/megaclient.cpp)
- `MegaClient::login(string session, ...)` in [vendor/MEGAcmd/sdk/src/megaclient.cpp](../vendor/MEGAcmd/sdk/src/megaclient.cpp)

Observed account session formats:

- Version 0: raw `masterKey || sid`
- Version 1: `0x01 || ecb_encrypt(sessionKey, masterKey) || sid`

Important consequence:

- Version 1 blobs do not contain the plaintext master key. They are still resumable because the subsequent session-validation login returns `sek`, which the SDK uses to recover the master key.
- This is the format Nearbytes should persist for transparent reconnect. It is enough to re-authenticate and resume fetch/action-packet processing without asking the user again.

## Fetch-Nodes Snapshot

The full tree load is the `f` command.

Default authenticated request shape from `CommandFetchNodes`:

```json
{
  "a": "f",
  "c": 1,
  "r": 1,
  "ca": 1
}
```

For partial fetches the SDK also sends:

```json
{
  "n": "<root-handle>",
  "part": 1
}
```

Relevant source:

- `CommandFetchNodes::CommandFetchNodes` in [vendor/MEGAcmd/sdk/src/commands.cpp](../vendor/MEGAcmd/sdk/src/commands.cpp)
- `CommandFetchNodes::procresult` in [vendor/MEGAcmd/sdk/src/commands.cpp](../vendor/MEGAcmd/sdk/src/commands.cpp)
- `MegaClient::fetchnodes` in [vendor/MEGAcmd/sdk/src/megaclient.cpp](../vendor/MEGAcmd/sdk/src/megaclient.cpp)

Fields Nearbytes should preserve from the response:

- `f`: nodes
- `f2`: versioned nodes
- `s`: outgoing shares
- `ps`: pending shares
- `u`: users
- `ipc`: incoming pending contacts
- `opc`: outgoing pending contacts
- `ph`: public links
- `sn`: server-client sequence number
- `st`: sequence tag

For readonly sync, `sn` is the key field. It is the cursor that allows reconnect without a full rescan when cached state remains valid.

## Resumable Change Cursor

The resumable change cursor is `scsn`.

Relevant source:

- `SCSN` methods in [vendor/MEGAcmd/sdk/src/megaclient.cpp](../vendor/MEGAcmd/sdk/src/megaclient.cpp)
- local cache load/save paths in [vendor/MEGAcmd/sdk/src/megaclient.cpp](../vendor/MEGAcmd/sdk/src/megaclient.cpp)

Key facts:

- `sn` returned by fetch-nodes is persisted in the SDK state cache.
- If local cached state and `scsn` are accepted, the SDK can load the cached tree and continue from that cursor.
- If the SC channel reports `API_ETOOMANY` or the cursor becomes unusable, the SDK falls back to a new `f` request with `nocache = true`.

This is the correct MEGA-native replacement for the discarded `.nearbytes-sync` sidecar approach.

## Action Packets

After a successful fetch-nodes or cache resume, the SDK opens the SC channel and processes incremental changes from `sn` forward.

Relevant source:

- SC request construction in [vendor/MEGAcmd/sdk/src/megaclient.cpp](../vendor/MEGAcmd/sdk/src/megaclient.cpp)
- `MegaClient::procsc` in [vendor/MEGAcmd/sdk/src/megaclient.cpp](../vendor/MEGAcmd/sdk/src/megaclient.cpp)
- action-packet dispatcher declarations in [vendor/MEGAcmd/sdk/include/mega/megaclient.h](../vendor/MEGAcmd/sdk/include/mega/megaclient.h)

The non-streaming SC URL shape is:

- `.../sc?sn=<scsn>&sid=<session>` for full accounts
- folder-link sessions use `n=<publicHandle>` and may suppress `sid`

Packets Nearbytes cares about first:

- `u`: node attribute update
- `t`: new nodes
- `d`: delete or move precursor
- `s` and `s2`: share add, update, revoke
- `ipc`, `opc`, `upc`: contact and pending-contact changes
- `ph`: public link changes

For readonly block ingestion the minimal useful subset is `u`, `t`, `d`, and share packets affecting the mounted subtree.

## Share Commands

Writable and invitation flows are separate from readonly sync and should be layered on after authenticated readonly resume works.

Relevant command builders:

- `CommandSetShare` uses `s2` in [vendor/MEGAcmd/sdk/src/commands.cpp](../vendor/MEGAcmd/sdk/src/commands.cpp)
- pending-contact creation uses `upc`
- pending-contact update uses `upca`
- move uses `m`
- upload tree creation uses `p`

Important detail:

- Share packets can contain owner keys, share keys, signatures, and pending-share state. Nearbytes should not improvise this cryptography; it needs to follow the SDK structures exactly when the writable path is implemented.

## Implementation Order

Nearbytes should replace the CLI in this order:

1. Authenticated session persistence and restore.
2. Native `f` requests plus local persistence of session blob and `scsn`.
3. Native SC polling/catch-up using `sn` and action packets.
4. Readonly incoming-share materialization into local `blocks/` and `channels/` roots.
5. Writable node mutations and share management.

That order matches the SDK architecture and directly addresses the main product requirement: efficient readonly reconnect and transparent block gathering from saved app-side connection data.