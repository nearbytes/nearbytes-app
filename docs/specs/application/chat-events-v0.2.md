# Nearbytes Chat Protocol v0.2

Status: draft normative specification.

Ordering status: non-final.

This document defines chat and identity material as encrypted inner application payloads carried by opaque Nearbytes events.

## 1. Scope

This specification defines:

1. the identity-signed `nb.chat.message.v1` payload;
2. the preferred encrypted inner carrier for chat and identity-related material;
3. attachment semantics for source-bound file references.

This specification does not define:

1. richer chat product features such as reactions or threads;
2. the outer event envelope wire format;
3. out-of-band identity discovery.

## 2. Preferred Carrier

New chat-capable writers SHOULD carry chat and identity-related material inside encrypted `APP_RECORD` inner payloads as defined by `application/app-records-v0.2.md`.

Preferred mappings:

1. `protocol = "nb.chat.message.v1"` for chat messages;
2. `protocol = "nb.identity.snapshot.v1"` for foreign-hub identity materialization;
3. `protocol = "nb.identity.record.v1"` for canonical identity publication channels.

## 3. Visibility Rule

The outer event envelope MUST NOT reveal:

1. that the event is chat-related;
2. the nested chat protocol ID;
3. the sender identity key;
4. the published timestamp;
5. the message body;
6. attachment metadata.

Only referenced ciphertext block hashes required by the event may remain visible in the outer `blockRefs` list.

## 4. `nb.chat.message.v1`

The nested chat message object itself remains unchanged in spirit:

1. `p = "nb.chat.message.v1"`
2. `k` = identity public key
3. `ts` = sender timestamp
4. optional `body`
5. optional `attachment`
6. `sig` = nested identity signature

At least one of `body` or `attachment` MUST be present.

## 5. Attachment Rules

Attachments remain source-bound file references.

If a chat message references ciphertext blocks through a nested attachment or related structure, the outer event `blockRefs` list MUST expose every ciphertext block required for storage and transport of that event.

## 6. Replay Rules

Chat clients reconstruct chat state by:

1. authenticating outer events;
2. decrypting inner payloads;
3. selecting valid `APP_RECORD` payloads carrying supported chat/identity protocols;
4. validating nested signatures;
5. ordering them under the implementation's current replay convention.

Legacy outer event types such as `DECLARE_IDENTITY` and `CHAT_MESSAGE` are obsolete in v2 and SHOULD NOT be emitted by new writers.
