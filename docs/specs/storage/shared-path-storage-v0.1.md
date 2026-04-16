# Nearbytes Shared Path Storage v0.1

Status: draft normative specification.

This document defines a host-neutral path-keyed storage contract for shared Nearbytes runtime logic.

Its purpose is to let shared TypeScript runtime code run against desktop filesystems, phone IndexedDB-backed storage, and future native-backed stores without changing application or provider semantics.

## 1. Scope

This specification defines:

1. the logical storage namespace used by shared runtime code;
2. the minimum path-storage operations required by shared runtime libraries;
3. durability and visibility rules for event and block persistence;
4. non-regression rules for introducing a shared storage abstraction under existing working paths.

This specification does not define:

1. provider authentication or transport behavior;
2. MEGA-specific cryptographic rules;
3. UI event-stream payloads;
4. the physical backend used by a given host.

## 2. Design Goals

The shared path-storage contract MUST provide:

1. one logical path model across desktop and phone hosts;
2. durable persistence for production-capable hosts;
3. atomic local visibility for newly imported events and blocks;
4. enough filesystem-shaped behavior for shared runtime logic without requiring a real filesystem.

## 3. Logical Namespace

Shared runtime code MUST treat Nearbytes local storage as a logical path space.

Required paths:

1. blocks at `blocks/<blockHash>.bin`
2. events at `channels/<volumeId>/<eventHash>.bin`

Implementations MAY additionally expose internal settings or metadata paths, but those paths MUST remain outside the normative hub object namespace unless another specification says otherwise.

## 4. Required Operations

The shared path-storage contract MUST provide at least:

1. `writeFile(path, bytes)`
2. `readFile(path)`
3. `deleteFile(path)`
4. `exists(path)`
5. `listFiles(directory)`
6. `createDirectory(path)`

Interpretation:

1. these operations are logical-path operations, not promises about a host filesystem;
2. `listFiles(directory)` returns direct children for that logical directory;
3. `exists(path)` MUST succeed for an existing file, an explicitly created directory, or an implied directory that already contains descendants.

## 5. Path Rules

Implementations MUST normalize paths before storage.

Rules:

1. leading `/` characters MUST NOT change identity;
2. repeated `/` separators MUST collapse to one separator;
3. trailing `/` on file paths MUST NOT create distinct file identities;
4. path comparison for block and event object locations MUST use the normalized logical path.

## 6. Durability Profiles

The contract defines two durability profiles.

### 6.1 Durable Profile

The durable profile MUST survive process restart.

Examples:

1. desktop filesystem-backed storage;
2. phone IndexedDB-backed storage;
3. future native database or document-store backends.

### 6.2 Ephemeral Profile

The ephemeral profile MAY be used only for tests, previews, or explicitly unsupported fallback environments.

Rules:

1. the ephemeral profile MUST NOT be treated as production-capable durable hub storage;
2. a host using the ephemeral profile MUST NOT claim restart-safe persistence for imported objects.

## 7. Visibility Rule

Newly imported bytes MUST become locally visible only after the full object has been committed.

Rules:

1. a partially written event or block MUST NOT appear as present;
2. after `writeFile` resolves successfully, `exists(path)` and `readFile(path)` MUST observe the committed bytes;
3. duplicate writes of identical object bytes MAY be treated as a no-op.

## 8. Host Mapping

Host implementations MAY map the contract differently.

Examples:

1. desktop MAY back the contract with a real filesystem;
2. phone MAY back the contract with IndexedDB plus logical directory markers;
3. future native hosts MAY back the contract with a Swift or Rust storage layer.

The shared runtime MUST depend only on the contract, not on host-specific path APIs.

## 9. Relationship To Existing Working Paths

Introducing shared path storage MUST remain additive first.

Rules:

1. desktop MEGA and desktop local storage MAY continue using filesystem-backed implementations behind this contract;
2. embedded phone LAN imports MUST continue to persist to the same logical `blocks/` and `channels/` paths;
3. the contract MUST NOT change the local object namespace defined by existing storage and transport specifications.

## 10. Non-Regression Gates

Any implementation adopting this contract MUST preserve:

1. `transport/lan-sync-v0.4.md` steady-state phone LAN import behavior;
2. `transport/runtime-volume-events-v0.1.md` publication timing after local visibility;
3. `storage/storage-integration-stack-v1.md` layering, where storage remains below provider and reconciliation policy.

If a migration cannot preserve those three rules, it MUST remain behind an explicit compatibility gate and MUST NOT replace the current working path.