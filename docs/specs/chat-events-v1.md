# Nearbytes Chat Protocol v1

Status: draft normative specification.

This document defines how chat messages live inside a Nearbytes hub log. It covers the sender-signed message payload, the preferred outer event form that carries chat and identity state, and the attachment model for file references.

Its scope is basic message transport and replay inside a shared hub or channel. It does not define richer chat product features such as reactions, threads, or moderation.

## 1. Scope

This specification defines:

1. the identity-signed `nb.chat.message.v1` payload carried inside a hub log;
2. the preferred application-level carrier for chat and related identity material;
3. attachment semantics for source-bound file references in chat messages.

This specification does not define:

1. end-to-end encryption beyond hub access;
2. reactions, edits, threads, receipts, or moderation;
3. cross-hub federation;
4. out-of-band identity discovery.

Introductory model (non-normative):

1. the enclosing hub signature proves the record belongs to the hub log;
2. chat and identity payloads inside that record are additionally signed by sender identity keypairs;
3. a client that can open the hub can read the chat in v1;
4. sender identity comes from the nested signature, not from the hub key alone.

## 2. Relationship to Other Specs

1. Nearbytes file-system events are defined in `file-events-v2.md`.
2. Public sender profiles are defined in `identity-record-v1.md`.
3. Source-bound file references are defined in `nb-src-ref-v1.md` and `nb-src-refs-v1.md`.
4. Generic application-carried outer events are defined in `app-records-v1.md`.
5. Canonical identity publication is defined in `identity-channel-v1.md`.
6. Local hub materialization of identity state is defined in `identity-snapshot-v1.md`.
7. The enclosing hub model is defined in `hub-model-v1.md`.

## 3. Preferred Carrier

New chat-capable writers SHOULD emit chat and identity-related hub material as `APP_RECORD`.

Preferred mappings:

1. `protocol = "nb.chat.message.v1"` for chat messages;
2. `protocol = "nb.identity.snapshot.v1"` for foreign-hub identity materialization.

Legacy outer event types remain readable for compatibility only.

## 4. Legacy Outer Event Types

Older chat-capable hubs may still contain these outer event types:

1. `DECLARE_IDENTITY`
2. `CHAT_MESSAGE`

Replay rule:

1. file-system replay MUST ignore non-file event types;
2. chat replay MUST ignore file-system event types;
3. all event types share the authoritative ordering rules of the enclosing hub log.

## 5. `DECLARE_IDENTITY` (Legacy Compatibility)

Purpose:

1. preserve compatibility with older chat-capable hubs that embedded identity records directly in the hub log.

Required outer fields:

1. `type = "DECLARE_IDENTITY"`
2. `authorPublicKey` = identity public key hex
3. `record` = canonical JSON string encoding of a `nb.identity.record.v1`
4. `publishedAt`

Rules:

1. `authorPublicKey` MUST equal the `k` field inside the embedded identity record.
2. the embedded record MUST verify successfully according to `identity-record-v1.md`.
3. the enclosing hub event MUST still be signed by the hub key.

## 6. `nb.chat.message.v1`

Minimal required object:

```json
{
  "p": "nb.chat.message.v1",
  "k": "<identityPublicKeyHex>",
  "ts": 1731456000000,
  "body": "hello",
  "attachment": {
    "kind": "nb.src.ref.v1",
    "name": "notes/todo.txt",
    "mime": "text/plain",
    "ref": {
      "p": "nb.src.ref.v1",
      "s": "<sourceVolumeIdHex>",
      "c": { "t": "b", "h": "<64hex>", "z": 42 },
      "x": "<b64u>"
    }
  },
  "sig": "<b64u>"
}
```

Field requirements:

1. `p` MUST be `nb.chat.message.v1`.
2. `k` MUST be the signer identity public key.
3. `ts` MUST be a non-negative integer millisecond timestamp.
4. `body`, if present, MUST be a UTF-8 string.
5. `attachment`, if present, MUST follow the attachment rules below.
6. at least one of `body` or `attachment` MUST be present.
7. `sig` MUST be a valid signature by identity key `k` over the canonical JSON encoding of the object with `sig` omitted.

## 7. Attachment Rules

In v1, attachment payloads are source-bound file references.

Required attachment fields:

1. `kind = "nb.src.ref.v1"`
2. `name` = logical filename shown in the chat UI
3. `ref` = valid `nb.src.ref.v1`

Optional attachment fields:

1. `mime`
2. `createdAt`

Interpretation:

1. dragging a file into chat SHOULD produce a signed chat message carrying a source-bound reference to that file;
2. recipients who can open the same source hub MAY later import the referenced file;
3. the attachment is a reference, not a duplicated blob.

## 8. `CHAT_MESSAGE` (Legacy Compatibility)

Purpose:

1. preserve compatibility with older chat-capable hubs that emitted chat messages as their own outer event type.

Required outer fields:

1. `type = "CHAT_MESSAGE"`
2. `authorPublicKey`
3. `message` = canonical JSON string encoding of `nb.chat.message.v1`
4. `publishedAt`

Rules:

1. `authorPublicKey` MUST equal the `k` field inside the embedded message object.
2. the embedded message MUST verify successfully.
3. the enclosing hub event MUST still be signed by the hub key.

## 9. Ordering and Materialization

Chat clients reconstruct chat state by scanning the shared hub log and selecting:

1. valid `DECLARE_IDENTITY` events for legacy identity state;
2. valid `CHAT_MESSAGE` events for legacy message history;
3. valid `APP_RECORD` events carrying `nb.identity.snapshot.v1` for current identity state;
4. valid `APP_RECORD` events carrying `nb.chat.message.v1` for current message history.

Ordering rule:

1. authoritative order is the enclosing hub-log order;
2. `publishedAt` and nested `ts` fields are message metadata and SHOULD be shown to users, but they MUST NOT replace hub-log order for replay.

Materialized identity state:

1. latest valid identity material per identity public key in hub-log order, preferring `nb.identity.snapshot.v1` or other current app-record forms when present;
2. `DECLARE_IDENTITY` remains a legacy compatibility input only.

Materialized chat history:

1. all valid `nb.chat.message.v1` and legacy `CHAT_MESSAGE` entries in hub-log order.

## 10. Security Properties

In v1:

1. possession of the hub secret is sufficient to read chat messages;
2. sender authenticity comes from the nested identity signature;
3. hub membership comes from the outer hub signature;
4. a party without the relevant identity private key MUST NOT be able to forge a valid nested chat or identity payload for that sender.

## 11. Failure Conditions

Readers MUST ignore an individual chat or identity event if:

1. the outer event type is known but required fields are missing;
2. embedded canonical JSON cannot be parsed;
3. embedded protocol id is unknown or unsupported;
4. nested signature verification fails;
5. `authorPublicKey` disagrees with the nested signer key.

Readers MAY still continue processing the rest of the log.
