# Nearbytes Data Correctness v1

Superseded note:

1. this document records the pre-opaque event design line;
2. it is retained only as a historical snapshot;
3. the current unreleased design line is `storage/data-correctness-v0.2.md`.

Status: draft normative specification.

This document defines when a file is valid Nearbytes storage data and therefore permitted to remain in canonical Nearbytes storage or to be forwarded to another storage location.

Its scope is correctness of persisted block files and channel event files. It does not define pruning policy, transport protocols, or application-specific UX behavior.

## 1. Scope

This specification defines:

1. canonical naming rules for files under `blocks/` and `channels/`;
2. content-address correctness for block and event files;
3. event-format and signature correctness for channel events;
4. cleanup and forwarding requirements derived from those rules.

## 2. Canonical Storage Paths

Canonical Nearbytes storage paths are:

```text
blocks/<hash>.bin
channels/<volumeId>/<eventHash>.bin
```

Normative rules:

1. `<hash>` MUST be lowercase 64-hex.
2. `<eventHash>` MUST be lowercase 64-hex.
3. `<volumeId>` MUST be the lowercase hex encoding of the uncompressed 65-byte P-256 public key and therefore MUST be exactly 130 lowercase hex characters.
4. Files outside those canonical path shapes are not valid Nearbytes storage data.

## 3. Block Correctness

A file is permitted to reside in `blocks/` if and only if:

1. its path is `blocks/<hash>.bin`;
2. `<hash>` is lowercase 64-hex;
3. `<hash>` equals the SHA-256 of the file bytes.

This matches the ciphertext-addressed block rules in `references/nb-content-v1.md`.

## 4. Channel Event Correctness

A file is permitted to reside in `channels/<volumeId>/` if and only if:

1. its path is `channels/<volumeId>/<eventHash>.bin`;
2. `<volumeId>` is a valid volume public key according to the crypto specifications;
3. `<eventHash>` is lowercase 64-hex;
4. the file bytes parse as a valid serialized Nearbytes event;
5. the event hash equals `SHA-256(serializeEventPayload(payload))`;
6. the outer event signature verifies against the public key identified by `<volumeId>`.

## 5. Nested Application Record Correctness

When the outer event type carries nested signed application data, the nested record is part of correctness.

Normative rules:

1. `APP_RECORD` MUST satisfy `application/app-records-v1.md`.
2. `APP_RECORD.payload.protocol` MUST equal the nested record's `p` field.
3. Supported nested `APP_RECORD` protocols MUST parse and verify according to their own specifications.
4. Legacy `DECLARE_IDENTITY` and `CHAT_MESSAGE` events MUST satisfy the corresponding compatibility rules in `application/chat-events-v1.md`, including nested signer consistency and nested signature verification.

## 6. Cleanup Requirement

Cleanup or repair of a Nearbytes storage root MUST treat as invalid any file under `blocks/` or `channels/` that does not satisfy this specification.

After successful cleanup, only files that satisfy this specification may remain in canonical Nearbytes storage directories.

## 7. Forwarding Requirement

Nearbytes MUST NOT copy, upload, download into canonical storage, mirror, reconcile, or otherwise forward a file as canonical Nearbytes storage data unless that file satisfies this specification.

If a candidate file fails validation, the runtime MUST treat it as invalid data rather than forwarding it.
