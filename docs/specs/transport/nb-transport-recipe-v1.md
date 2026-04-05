# Nearbytes Transport Recipe v1 (`nb.transport.recipe.v1`)

Status: draft normative specification.

This document defines one logical attachment recipe containing one or more transport endpoint suggestions.

## 1. Goal

A recipe lets one Nearbytes attachment suggest several routes at once:

1. a provider-backed share such as Google Drive or MEGA;
2. a plain HTTP mirror;
3. a LAN peer;
4. any future transport kind.

## 2. Object Format

Minimal object:

```json
{
  "p": "nb.transport.recipe.v1",
  "id": "recipe-main",
  "label": "Primary mirror",
  "purpose": "mirror",
  "endpoints": [
    {
      "p": "nb.transport.endpoint.v1",
      "transport": "provider-share",
      "provider": "gdrive",
      "priority": 100,
      "capabilities": ["mirror", "read", "write"],
      "descriptor": { "remoteId": "drive-folder-id" }
    }
  ]
}
```

Field requirements:

1. `p` MUST be `nb.transport.recipe.v1`.
2. `id` MUST be a non-empty string unique within the surrounding object that carries it.
3. `label` MUST be a non-empty human-readable string.
4. `purpose` SHOULD be `mirror` unless another future purpose is defined.
5. `endpoints` MUST contain at least one valid `nb.transport.endpoint.v1` object.

## 3. Selection Semantics

Endpoints are suggestions, not commands.

Clients MUST rank compatible endpoints by effective priority:

1. already attached locally;
2. available without new auth;
3. backed by an already connected provider account;
4. matching a user-pinned provider preference;
5. lower numeric `priority`;
6. source order.

Clients SHOULD attach only the best unsatisfied compatible endpoint by default.

Clients MAY attach more than one endpoint later by explicit user choice or policy.

## 4. Unknown Endpoint Kinds

1. Clients MUST ignore unsupported endpoint `transport` kinds without failing the whole recipe.
2. Clients SHOULD surface unsupported endpoints in planning UI as non-selected options when useful.

## 5. Canonical Encoding

1. Wire encoding MUST be RFC 8785 canonical JSON, UTF-8 bytes.
