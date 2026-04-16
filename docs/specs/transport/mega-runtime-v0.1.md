# Nearbytes MEGA Runtime v0.1

Status: draft normative specification.

This document defines the shared-runtime profile required for the Nearbytes MEGA provider implementation.

Its purpose is to separate MEGA-specific protocol and cryptographic behavior from host-specific storage and runtime glue so the MEGA runtime can remain mostly shared across desktop and future phone hosts.

## 1. Scope

This specification defines:

1. the MEGA-specific runtime capabilities that remain above shared storage and shared runtime services;
2. the cryptographic primitive families the active MEGA runtime depends on;
3. the non-regression rules for introducing a phone-capable MEGA runtime.

This specification does not define:

1. the host-neutral shared storage contract itself;
2. the general runtime services contract itself;
3. UI onboarding copy or layout;
4. legacy desktop-sync-folder product guidance.

## 2. Design Goals

The MEGA runtime profile MUST provide:

1. one shared MEGA protocol implementation across hosts where feasible;
2. no dependency on a real filesystem in MEGA-specific logic;
3. immediate semantic publication after local recipient state becomes visible;
4. explicit unsupported host behavior until the full provider path is ready.

## 3. Layering Rule

The MEGA runtime MUST sit above:

1. `storage/shared-path-storage-v0.1.md`
2. `transport/shared-runtime-services-v0.1.md`

The MEGA runtime MUST remain below:

1. storage reconciliation policy;
2. application-level share UX;
3. host capability presentation in the shared UI.

## 4. Required Cryptographic Primitive Families

The active MEGA runtime profile requires these primitive families.

### 4.1 Symmetric Encryption

Required algorithms:

1. AES-128-ECB for legacy password and key-wrapping flows;
2. AES-128-CBC for attribute and metadata handling;
3. AES-128-CTR for transfer and node payload handling;
4. AES-128-CCM for private-attribute payload variants;
5. AES-128-GCM for key-manager and private-attribute payload variants.

### 4.2 Hash and MAC

Required algorithms:

1. SHA-256;
2. HMAC-SHA256;
3. HKDF-SHA256.

### 4.3 Password Derivation

Required algorithms:

1. PBKDF2-SHA512 with the MEGA v2 account parameters;
2. the legacy MEGA v1 password-key flow built on repeated AES-128-ECB rounds.

### 4.4 Key Agreement and Key Material Handling

Required capabilities:

1. X25519-compatible pairwise key derivation for MEGA share flows;
2. public and private key import for the active MEGA key formats;
3. big-integer modular arithmetic for the legacy MEGA account and key-material paths that still require it.

## 5. Runtime Capabilities Above Shared Services

The MEGA runtime still requires host-neutral runtime capabilities above pure crypto.

Required behavior:

1. authenticated MEGA API requests with cancellation and retry control;
2. long-lived session and action-packet listening;
3. local mirror materialization into the shared path-storage namespace;
4. semantic volume-event publication immediately after a mirror apply or delete becomes locally visible.

## 6. Storage Expectations

The MEGA runtime MUST treat local provider state as path-keyed Nearbytes storage.

Rules:

1. local mirror objects MUST materialize under the ordinary `blocks/` and `channels/` namespace;
2. the MEGA runtime MUST NOT require direct host filesystem APIs in its provider-specific logic;
3. host-specific watcher or persistence details belong below the shared storage and runtime service contracts.

## 7. Phone Host Compatibility Rule

The phone host MUST keep MEGA capability explicit until the full MEGA runtime profile is available.

Rules:

1. a partial phone MEGA implementation MUST NOT present itself as supported in the host contract;
2. MEGA provider sign-in and share acceptance on phone MUST remain explicit unsupported behavior until the required runtime profile is complete;
3. a hidden or compatibility-only phone MEGA path MAY exist for development, but it MUST NOT replace the explicit unsupported public host behavior early.

## 8. Desktop Compatibility Rule

Desktop remains the current normative MEGA runtime host while the shared runtime profile is extracted.

Rules:

1. extracting shared storage or runtime services MUST NOT change desktop MEGA managed-provider semantics;
2. the desktop path MUST remain the reference implementation while phone capability is incomplete;
3. shared MEGA logic MUST be proved on desktop before phone capability is promoted.

## 9. Reactive Publication Rule

The MEGA runtime MUST continue publishing through the shared volume-event path.

Rules:

1. MEGA MUST publish only after recipient mirror apply or delete is locally visible;
2. the published event MUST remain compliant with `transport/runtime-volume-events-v0.1.md`;
3. adopting shared runtime services MUST NOT introduce UI polling as the normative MEGA refresh path.

## 10. Non-Regression Gates

Any MEGA port work MUST preserve:

1. current desktop MEGA owner and incoming-share behavior;
2. current phone LAN behavior, including storage-command import and semantic volume events;
3. explicit unsupported phone-provider behavior until the MEGA runtime profile is fully satisfied.

If a migration stage cannot satisfy all three gates, it MUST remain non-default and MUST NOT replace a working path.