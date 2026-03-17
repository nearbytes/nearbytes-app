# Nearbytes Protocol Registry

Status: draft normative registry for protocol identifiers and versioning.

This document is the registry of protocol identifiers used across the Nearbytes specifications. It defines how protocol IDs are named, how major versions mark compatibility boundaries, and which IDs are currently reserved or active.

Its scope is naming and versioning discipline, not the payload rules of each individual protocol.

## 1. Naming Rule

Protocol identifiers MUST use:

`nb.<domain>.<name>.v<major>`

Examples:

- `nb.ref.v1`
- `nb.manifest.v1`
- `nb.content.single.v1`
- `nb.content.manifest.v1`

## 2. Versioning Rule

1. The `v<major>` suffix is the compatibility boundary.
2. Readers MUST fail closed for unknown protocol identifiers.
3. Readers MUST fail closed for unsupported major versions.
4. Non-breaking clarifications do not change major version.
5. Breaking wire/schema/crypto changes MUST increment major version.
6. Open-string subtypes inside a known protocol MUST follow the specific protocol spec, not this registry-level default.

## 3. Initial Registry Entries

| Protocol ID | Scope | Version | Status |
| --- | --- | --- | --- |
| `nb.ref.v1` | Encrypted file reference object | `v1` | Draft |
| `nb.refs.v1` | Encrypted file reference bundle | `v1` | Draft |
| `nb.src.ref.v1` | Source-bound encrypted file reference object | `v1` | Draft |
| `nb.src.refs.v1` | Source-bound encrypted file reference bundle | `v1` | Draft |
| `nb.transport.endpoint.v1` | Transport endpoint suggestion object | `v1` | Draft |
| `nb.transport.recipe.v1` | Multi-endpoint attachment recipe | `v1` | Draft |
| `nb.join.v1` | Space join link carrying attachment recipes | `v1` | Draft |
| `nb.identity.record.v1` | Public signed sender identity record | `v1` | Draft |
| `nb.identity.snapshot.v1` | Identity snapshot plus canonical-channel reference | `v1` | Draft |
| `nb.chat.message.v1` | Identity-signed chat message payload | `v1` | Draft |
| `nb.manifest.v1` | Plaintext chunk manifest schema (encrypted at rest) | `v1` | Draft |
| `nb.content.single.v1` | Single-block encrypted file descriptor | `v1` | Draft |
| `nb.content.manifest.v1` | Encrypted-manifest file descriptor | `v1` | Draft |

## 4. Spec Families Without Standalone `nb.*` IDs

Some Nearbytes protocol families are specified as command/event-model documents rather than as one nested canonical JSON object with its own `nb.*` identifier.

Current examples:

1. hub/log model -> `hub-model-v1.md`
2. file command semantics -> `file-commands-v1.md`
3. file event/replay model -> `file-events-v2.md`
4. identity management command semantics -> `identity-management-v1.md`

## 5. Forward Compatibility Rule For Transport Recipes

1. Unknown protocol IDs still fail closed.
2. Known composite protocols MAY define open-string subtypes that must be ignored rather than rejected.
3. `nb.transport.recipe.v1` and `nb.join.v1` define that unknown endpoint `transport` kinds MUST be ignored by clients without rejecting the whole recipe or link.

## 6. Canonical Encoding Policy

Unless explicitly overridden by a specific protocol document:

1. Canonical wire encoding is RFC 8785 canonical JSON, UTF-8 bytes.
2. Binary values MUST be base64url without padding.
3. Hash values MUST be lowercase hexadecimal.

## 7. Change Control

Any new `nb.*` protocol ID or major-version increment MUST include:

1. A normative spec document in `docs/specs`.
2. A compatibility section describing migration and fallback behavior.
3. Test vectors or validation rules sufficient for independent implementation.
