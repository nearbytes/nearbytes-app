# Nearbytes Protocol Registry

Status: draft normative registry for protocol identifiers and versioning.

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

## 3. Initial Registry Entries

| Protocol ID | Scope | Version | Status |
| --- | --- | --- | --- |
| `nb.ref.v1` | Encrypted file reference object | `v1` | Draft |
| `nb.manifest.v1` | Plaintext chunk manifest schema (encrypted at rest) | `v1` | Draft |
| `nb.content.single.v1` | Single-block encrypted file descriptor | `v1` | Draft |
| `nb.content.manifest.v1` | Encrypted-manifest file descriptor | `v1` | Draft |

## 4. Canonical Encoding Policy

Unless explicitly overridden by a specific protocol document:

1. Canonical wire encoding is RFC 8785 canonical JSON, UTF-8 bytes.
2. Binary values MUST be base64url without padding.
3. Hash values MUST be lowercase hexadecimal.

## 5. Change Control

Any new `nb.*` protocol ID or major-version increment MUST include:

1. A normative spec document in `docs/specs`.
2. A compatibility section describing migration and fallback behavior.
3. Test vectors or validation rules sufficient for independent implementation.
