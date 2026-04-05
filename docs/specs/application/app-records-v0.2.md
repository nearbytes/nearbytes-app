# Nearbytes App Records v0.2

Status: draft normative specification.

Ordering status: non-final.

This document defines the generic encrypted inner application-record payload used for non-file application data in Nearbytes after the move to opaque outer events.

## 1. Scope

This specification defines:

1. the generic inner application record carrier;
2. the relationship between outer event envelopes and nested application protocols;
3. replay expectations for decrypted app records.

This specification does not define:

1. individual nested protocol schemas;
2. the outer event envelope wire format;
3. the final replay-order layer.

## 2. Design Rule

Application-record semantics are encrypted.

Therefore the outer event envelope MUST NOT reveal:

1. application protocol ID;
2. nested canonical JSON record bytes;
3. nested author identity;
4. application timestamps.

## 3. Inner App Record Object

The decrypted payload for a generic application record contains:

1. `type = "APP_RECORD"`
2. `authorPublicKey`
3. `protocol`
4. `record`
5. `publishedAt`

Rules:

1. `protocol` MUST equal the nested record's `p` field;
2. `record` MUST be canonical JSON for the nested protocol;
3. `authorPublicKey` MUST name the nested signer when the nested protocol is signed;
4. the outer event remains signed by the channel signer key.

## 4. Replay Rules

Readers MUST:

1. verify the outer event signature;
2. decrypt the inner payload;
3. validate that `protocol` matches the nested record's `p` field;
4. dispatch to the protocol-specific reader named by `protocol`.

Readers MAY ignore unsupported nested application protocols while continuing to process the rest of the log.
