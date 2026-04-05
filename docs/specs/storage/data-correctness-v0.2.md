# Nearbytes Data Correctness v0.2

Status: draft normative specification.

This document defines when a file is valid Nearbytes storage data under the opaque-event model.

## 1. Scope

This specification defines:

1. canonical naming rules for block and event files;
2. content-address correctness for block and event files;
3. outer event-envelope correctness;
4. cleanup and forwarding requirements derived from those rules.

This specification does not define:

1. retention policy;
2. transport protocols;
3. decrypted application semantics beyond what is required for supported readers.

## 2. Canonical Storage Paths

Canonical Nearbytes storage paths remain:

```text
blocks/<hash>.bin
channels/<volumeId>/<eventHash>.bin
```

Rules:

1. `<hash>` MUST be lowercase 64-hex;
2. `<eventHash>` MUST be lowercase 64-hex;
3. `<volumeId>` MUST be the lowercase hex encoding of the uncompressed 65-byte P-256 public key.

## 3. Block Correctness

A file is valid in `blocks/` if and only if:

1. it is stored at `blocks/<hash>.bin`;
2. `<hash>` equals SHA-256 of the block bytes.

## 4. Channel Event Correctness

A file is valid in `channels/<volumeId>/` if and only if:

1. it is stored at `channels/<volumeId>/<eventHash>.bin`;
2. the file parses as a valid serialized Nearbytes event envelope;
3. `<eventHash>` equals SHA-256 of the canonical signed event bytes excluding only the signature field;
4. the outer event signature verifies against the public key named in the event envelope;
5. the signer public key in the event envelope matches `<volumeId>`;
6. the visible `blockRefs` list is syntactically valid.

## 5. Decrypted Payload Correctness

Supported readers MAY apply additional decrypted validation after event-envelope correctness succeeds.

Examples:

1. file-command payloads MAY be checked against `application/file-events-v0.3.md`;
2. app-record payloads MAY be checked against `application/app-records-v0.2.md`;
3. chat and identity payloads MAY be checked against their own nested protocol specs.

Failure of decrypted interpretation MUST NOT make the outer storage object cease to be a syntactically valid Nearbytes event envelope, but it MUST make the event unusable for that unsupported or invalid application projection.

## 6. Cleanup Requirement

Cleanup of canonical Nearbytes storage MUST remove any file under `blocks/` or `channels/` that does not satisfy this specification.

## 7. Forwarding Requirement

Nearbytes MUST NOT forward a candidate file as canonical Nearbytes storage data unless that file satisfies this specification.
