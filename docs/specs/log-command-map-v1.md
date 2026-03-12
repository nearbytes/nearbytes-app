# Nearbytes Log Command / Spec Map v1

Status: draft normative specification.

This document is the lookup table between known interpreted Nearbytes commands or carried log payloads and the normative specifications that govern them. Its purpose is simple: every known command or protocol family should have one clear spec home.

It does not redefine those commands. It only maps them to the documents that do.

## 1. File-System Commands

1. `PUT_FILE` -> `file-commands-v1.md`, emits `CREATE_FILE` defined in `file-events-v2.md`
2. `DELETE_FILE` -> `file-commands-v1.md`, emits `DELETE_FILE` defined in `file-events-v2.md`
3. `RENAME_FILE` -> `file-commands-v1.md`, emits `RENAME_FILE` defined in `file-events-v2.md`
4. `RENAME_FOLDER` -> `file-commands-v1.md`, emits one or more `RENAME_FILE` events defined in `file-events-v2.md`
5. `COPY_FILES` / `PASTE_FILES` -> `file-commands-v1.md`, `nb-src-ref-v1.md`, `nb-src-refs-v1.md`, may append `CREATE_FILE`
6. recipient-bound import/export -> `nb-reference-v1.md`, `nb-refs-v1.md`, may append `CREATE_FILE`

## 2. Generic App-Record Commands

1. `APP_RECORD` outer event semantics -> `app-records-v1.md`
2. `protocol = "nb.chat.message.v1"` -> `chat-events-v1.md`
3. `protocol = "nb.identity.record.v1"` in an identity channel -> `identity-channel-v1.md` and `identity-record-v1.md`
4. `protocol = "nb.identity.snapshot.v1"` in a foreign volume -> `identity-snapshot-v1.md`

## 3. Legacy Compatibility Commands

1. `DECLARE_IDENTITY` -> `chat-events-v1.md` (legacy compatibility path only)
2. `CHAT_MESSAGE` -> `chat-events-v1.md` (legacy compatibility path only)

New writers SHOULD use `APP_RECORD` for application-layer payloads instead of these legacy outer event types.
