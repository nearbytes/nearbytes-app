# Nearbytes Log Command / Spec Map v0.2

Status: draft normative specification.

This document maps current interpreted Nearbytes command families to their normative specs after the move to opaque events.

## 1. Hub / Event Layer

1. hub/log model -> `application/hub-model-v0.2.md`
2. generic app-record inner payload -> `application/app-records-v0.2.md`
3. LAN sync over opaque events -> `transport/lan-sync-v0.4.md`

## 2. File Commands

1. `PUT_FILE` -> `application/file-commands-v0.2.md`, emits an opaque event carrying an inner `CREATE_FILE` command defined in `application/file-events-v0.3.md`
2. `DELETE_FILE` -> `application/file-commands-v0.2.md`, emits an opaque event carrying an inner `DELETE_FILE` command defined in `application/file-events-v0.3.md`
3. `RENAME_FILE` -> `application/file-commands-v0.2.md`, emits an opaque event carrying an inner `RENAME_FILE` command defined in `application/file-events-v0.3.md`
4. `RENAME_FOLDER` -> `application/file-commands-v0.2.md`, emits one or more opaque events carrying inner `RENAME_FILE` commands

## 3. Identity / Chat / App Payloads

1. `protocol = "nb.chat.message.v1"` -> `application/chat-events-v0.2.md`
2. `protocol = "nb.identity.record.v1"` in an identity channel -> `identity/identity-channel-v0.2.md` and `identity/identity-record-v1.md`
3. `protocol = "nb.identity.snapshot.v1"` in a foreign volume -> `identity/identity-snapshot-v1.md`

## 4. Storage Rules

1. canonical event/block correctness -> `storage/data-correctness-v0.2.md`
2. meta-storage retention and block attribution -> `storage/meta-storage-v0.3.md`
