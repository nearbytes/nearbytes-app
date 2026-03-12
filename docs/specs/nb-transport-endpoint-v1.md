# Nearbytes Transport Endpoint v1 (`nb.transport.endpoint.v1`)

Status: draft normative specification.

This document defines one suggested transport endpoint. It is intentionally provider-agnostic and can describe provider-backed shares, plain HTTP mirrors, LAN peers, or future transport kinds.

## 1. Scope

This specification defines:

1. one endpoint suggestion object;
2. transport-independent ranking hints;
3. transport-independent capability labels.

This specification does not define:

1. provider auth protocols;
2. provider-specific folder semantics;
3. exact mirror reconciliation rules.

## 2. Object Format

Minimal object:

```json
{
  "p": "nb.transport.endpoint.v1",
  "transport": "provider-share",
  "provider": "gdrive",
  "priority": 100,
  "capabilities": ["mirror", "read", "write"],
  "descriptor": { "remoteId": "drive-folder-id" }
}
```

Optional fields:

1. `label`
2. `badges`

Field requirements:

1. `p` MUST be `nb.transport.endpoint.v1`.
2. `transport` MUST be a non-empty string.
3. `provider` MAY be omitted for non-provider transports.
4. `priority` MUST be an integer. Lower values are preferred over higher values.
5. `capabilities` MUST be an array of unique non-empty strings.
6. `descriptor` MUST be an object.

## 3. Known Transport Kinds

Initial known values:

1. `provider-share`
2. `http`
3. `peer-http`

These values are not closed forever. Future clients MAY add new transport kinds without changing the outer protocol id.

## 4. Capability Labels

Initial capability labels include:

1. `mirror`
2. `read`
3. `write`
4. `invite`
5. `accept`

Unknown capability labels MUST be ignored.

## 5. Forward Compatibility

1. Clients MUST reject an invalid `nb.transport.endpoint.v1` object.
2. Clients MAY understand only a subset of `transport` values.
3. Unknown `transport` values are still valid endpoint objects and MUST be preserved when possible by generic tooling.

## 6. Canonical Encoding

1. Wire encoding MUST be RFC 8785 canonical JSON, UTF-8 bytes.
2. Nested binary values inside `descriptor`, if any, MUST use base64url without padding.
