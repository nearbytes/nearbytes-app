# Nearbytes Join Link v1 (`nb.join.v1`)

Status: draft normative specification.

This document defines one space join link that can carry both the space-open material and zero or more attachment recipes.

It also supports share-link usage where the exact volume id is known but the space secret is intentionally omitted.

## 1. Goal

`nb.join.v1` is the format Nearbytes should use when one action is meant to:

1. open or join a space; and
2. suggest one or more storage/provider routes that can satisfy that space.

## 2. Object Format

Minimal object:

```json
{
  "p": "nb.join.v1",
  "space": {
    "mode": "seed",
    "value": "alice-demo-space",
    "password": "optional-passphrase"
  },
  "attachments": [
    {
      "id": "att-main",
      "label": "Primary cloud mirror",
      "recipe": {
        "p": "nb.transport.recipe.v1",
        "id": "recipe-main",
        "label": "Primary cloud mirror",
        "purpose": "mirror",
        "endpoints": []
      }
    }
  ]
}
```

Field requirements:

1. `p` MUST be `nb.join.v1`.
2. `space` MUST be one of the currently supported space payload forms.
3. `attachments` MUST be an array. It MAY be empty.
4. Attachment ids MUST be unique within the link.

## 3. Space Payload Forms

### 3.1 Seed form

```json
{
  "mode": "seed",
  "value": "space-seed",
  "password": "optional-password"
}
```

Rules:

1. `value` MUST be the same seed/address string the current app already accepts.
2. `password`, when present, MUST be the same password string the current app already accepts.
3. Readers MUST derive the actual Nearbytes secret using current app semantics rather than defining a new crypto format here.

### 3.2 Secret-file form

```json
{
  "mode": "secret-file",
  "name": "space.secret",
  "mime": "application/octet-stream",
  "payload": "<base64url bytes>"
}
```

Rules:

1. `payload` MUST be raw bytes encoded as base64url without padding.
2. Readers MUST treat the decoded bytes as the same secret-file payload the current app already supports.

### 3.3 Volume-id form

```json
{
  "mode": "volume-id",
  "value": "<hex volume id>"
}
```

Rules:

1. `value` MUST be the lowercase or uppercase hex volume id of the target space.
2. This form does not reveal the space secret.
3. Readers MAY use this form to attach provider routes to the correct space policy, but they MUST NOT claim that the space contents can be opened from this form alone.
4. Producers SHOULD default to `volume-id` when generating a share link unless the user explicitly asks to include the secret.

## 4. Attachment Semantics

1. Each `attachments[i].recipe` MUST be a valid `nb.transport.recipe.v1` object.
2. Readers MUST open/join the space first.
3. For `space.mode = "volume-id"`, readers MAY skip immediate space opening and instead attach or plan compatible recipe endpoints against the declared volume id.
4. Readers MAY then plan or attach any compatible recipe endpoints.
5. Unknown endpoint kinds inside a recipe MUST be ignored without failing the whole link.

## 5. Failure Conditions

Readers MUST fail closed if:

1. `p` is unknown or unsupported;
2. `space` is missing or invalid;
3. duplicate attachment ids are present;
4. any nested recipe or endpoint object is structurally invalid.

## 6. Canonical Encoding

1. Wire encoding MUST be RFC 8785 canonical JSON, UTF-8 bytes.

## 7. Deep-Link Wrapper

Nearbytes desktop MAY wrap the same canonical `nb.join.v1` JSON payload in a custom-scheme deep link for OS handoff.

Recommended form:

```text
nearbytes://join?data=<base64url(utf8(canonical-json))>
```

Rules:

1. `data` MUST contain the exact same canonical JSON payload a producer would otherwise copy directly.
2. Readers MUST decode the wrapper back to the same `nb.join.v1` object and then apply the normal validation and planning rules from this specification.
3. Producers SHOULD keep `nearbytes://` links secretless by default by using `space.mode = "volume-id"` unless the user explicitly asks to include the secret.
4. If the secret-bearing payload is too large for a practical deep link, producers MAY fall back to copying the canonical JSON directly instead of the wrapper.
