# Nearbytes Log Command / Spec Map v1

Superseded note:

1. this document records the pre-opaque event design line;
2. it is retained only as a historical snapshot;
3. the current unreleased design line is `transport/log-command-map-v0.4.md`.

Status: draft normative specification.

This document is the lookup table between known interpreted Nearbytes commands or carried log payloads and the normative specifications that govern them. Its purpose is simple: every known command or protocol family should have one clear spec home.

It does not redefine those commands. It only maps them to the documents that do.

## 0. Hub Model

1. hub/log model -> `application/hub-model-v1.md`
2. generic app-record carrier -> `application/app-records-v1.md`

## 1. File-System Commands

1. `PUT_FILE` -> `application/file-commands-v1.md`, emits `CREATE_FILE` defined in `application/file-events-v2.md`
2. `DELETE_FILE` -> `application/file-commands-v1.md`, emits `DELETE_FILE` defined in `application/file-events-v2.md`
3. `RENAME_FILE` -> `application/file-commands-v1.md`, emits `RENAME_FILE` defined in `application/file-events-v2.md`
4. `RENAME_FOLDER` -> `application/file-commands-v1.md`, emits one or more `RENAME_FILE` events defined in `application/file-events-v2.md`
5. `COPY_FILES` / `PASTE_FILES` -> `application/file-commands-v1.md`, `references/nb-src-ref-v1.md`, `references/nb-src-refs-v1.md`, may append `CREATE_FILE`
6. recipient-bound import/export -> `references/nb-reference-v1.md`, `references/nb-refs-v1.md`, may append `CREATE_FILE`

## 2. Identity Management Commands

1. `CREATE_IDENTITY` -> `identity/identity-management-v1.md`, may produce `nb.identity.record.v1` and `nb.identity.snapshot.v1`
2. `UPDATE_IDENTITY_PROFILE` -> `identity/identity-management-v1.md`, `identity/identity-record-v1.md`, `identity/identity-channel-v1.md`
3. `PUBLISH_IDENTITY` -> `identity/identity-management-v1.md`, `identity/identity-channel-v1.md`, `identity/identity-record-v1.md`
4. `MATERIALIZE_IDENTITY_IN_HUB` -> `identity/identity-management-v1.md`, `identity/identity-snapshot-v1.md`
5. `SELECT_IDENTITY_FOR_HUB` -> `identity/identity-management-v1.md` (local state only, not a shared log command)

## 3. Generic App-Record Commands

1. `APP_RECORD` outer event semantics -> `application/app-records-v1.md`
2. `protocol = "nb.chat.message.v1"` -> `application/chat-events-v1.md`
3. `protocol = "nb.identity.record.v1"` in an identity channel -> `identity/identity-channel-v1.md` and `identity/identity-record-v1.md`
4. `protocol = "nb.identity.snapshot.v1"` in a foreign volume -> `identity/identity-snapshot-v1.md`

## 4. Legacy Compatibility Commands

1. `DECLARE_IDENTITY` -> `application/chat-events-v1.md` (legacy compatibility path only)
2. `CHAT_MESSAGE` -> `application/chat-events-v1.md` (legacy compatibility path only)

New writers SHOULD use `APP_RECORD` for application-layer payloads instead of these legacy outer event types.
