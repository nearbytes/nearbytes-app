# Nearbytes Meta-Storage v2

Status: draft normative specification.

This document defines how Nearbytes stores, discovers, retains, and prunes encrypted events and blocks across configured storage roots. It is the storage-routing and durability layer above raw filesystems and below higher-level features.

Its scope is metadata-driven placement and retention policy. It does not define cryptographic content formats or secret handling.

## 1. Scope

This specification defines the meta-level storage model for Nearbytes:

1. Source-centric block discovery.
2. Volume-centric event and block placement.
3. Space-management and pruning policy.
4. Durable-storage guarantees expressed only in terms of:
   - configured source directories,
   - configured volume public keys,
   - cleartext event metadata already present in event files.

This specification does not define:

1. Cryptographic primitives.
2. Secret handling or password storage.
3. Cleartext inspection of encrypted block payloads.

## 2. Design Rule

All routing, retention, and pruning decisions MUST be made at the encrypted/meta layer.

Specifically:

1. Configuration MUST refer only to source directories and volume public keys.
2. A volume is identified only by the lowercase hex channel/public-key directory name.
3. The system MUST NOT require volume secrets in order to decide:
   - where events are stored,
   - where blocks are copied,
   - which blocks are retained,
   - which blocks may be pruned.
4. The only file-content metadata that may influence retention is metadata already written in cleartext inside event payloads.

## 3. Terms

1. **Source**: a filesystem directory that may contain Nearbytes `blocks/` and `channels/` subtrees and is scanned for incoming data.
2. **Volume ID**: lowercase hex public key used as the channel directory name.
3. **Volume Destination**: a configured rule saying how one volume's event log and blocks are stored inside one source.
4. **Durable Destination**: a destination that MUST retain all blocks referenced in cleartext by that volume's events for as long as the destination remains configured and enabled.
5. **Opportunistic Block**: a block present in a source but not currently protected by any durable destination policy for any volume.
6. **Referenced Block**: a block hash that appears in cleartext in a volume event payload.
7. **Prunable Replica**: a referenced block stored in a non-durable destination whose policy allows eviction when space runs low.

## 4. Source-Centric Model

Sources answer the question:

`In which directories can Nearbytes find blocks and event logs?`

Each source has:

1. stable `id`
2. `provider`
3. absolute `path`
4. `enabled`
5. `writable`
6. source-level free-space reservation
7. source-level policy for opportunistic blocks

Normative rules:

1. All enabled sources MUST be searched for reads.
2. Source discovery is advisory and separate from volume policy editing.
3. A source may exist without being a destination for any volume.
4. A source may also be used as a destination for one or more volumes.

## 5. Volume-Centric Model

Volumes answer the question:

`How should updates and referenced blocks for this volume be stored?`

Each configured volume policy is keyed only by `volumeId`.

Each volume has one or more destinations.

Each destination configures:

1. `sourceId`
2. whether volume events are stored there
3. whether referenced blocks are stored there
4. whether already-existing source blocks for that volume should be copied there
5. reserved free-space percentage for that destination
6. full-storage behavior:
   - `block-writes`
   - `drop-older-blocks`

Normative rules:

1. A destination that stores a volume's events MUST write that volume's `channels/<volumeId>/...` files into its source.
2. A destination with block storage enabled MUST store blocks referenced by new writes for that volume.
3. A destination with `copySourceBlocks=true` MUST attempt to backfill missing referenced blocks for that volume from any enabled source.
4. A destination with `copySourceBlocks=false` MUST NOT backfill missing referenced blocks automatically.

## 6. Durable Volume Guarantee

Nearbytes MUST reject a configuration that cannot preserve a configured volume.

For every configured volume, at least one enabled writable destination MUST be durable.

A durable destination is one where:

1. event storage is enabled
2. block storage is enabled
3. `copySourceBlocks=true`
4. full-storage behavior is `block-writes`

Interpretation:

1. A durable destination MUST never intentionally prune referenced blocks for that volume.
2. A durable destination MUST attempt best-effort backfill of referenced blocks already visible from other enabled sources.
3. Non-durable destinations may evict older replicas if another durable destination still protects the volume.

Clarification:

1. A source that is also a destination is sufficient to durably host a volume only if that destination stores events and blocks for the volume.
2. Therefore, yes: a separate copy-only destination is not required when one destination/source already durably stores the volume's blocks.

## 7. Referenced-Block Rule

Retention decisions may only use cleartext block references already visible in event metadata.

Normative rules:

1. If a `CREATE_FILE` event includes a cleartext block hash, that block is a referenced block.
2. The system MUST preserve referenced blocks according to destination policy.
3. The system MUST NOT assume knowledge of encrypted inner structure that is not exposed in cleartext metadata.
4. If only one manifest block hash is visible in cleartext, only that manifest block is meta-level trackable by this specification.

## 8. Space and Pruning Policy

Every source and every destination policy uses reserved free space.

### 8.1 Reserved Free Space

1. Reserved space is expressed as a percentage of total filesystem capacity.
2. The source MUST attempt to keep at least that percentage free.
3. Writes that would violate reserved free space MUST follow the configured full-storage policy.

### 8.2 Policies

Allowed policies:

1. `block-writes`
2. `drop-older-blocks`

`block-writes` means:

1. Do not delete protected data to make room.
2. Reject writes when space reservation cannot be honored.

`drop-older-blocks` means:

1. Evict oldest eligible blocks in that source until reservation is satisfied or no eligible blocks remain.
2. If enough space still cannot be reclaimed, reject the write.

### 8.3 Eligibility for Pruning

Pruning order MUST be:

1. opportunistic blocks first
2. prunable replicas second
3. durable referenced blocks never

Oldest means oldest filesystem modification time unless a more explicit meta-level timestamp index exists.

## 9. Source-Level Opportunistic Storage

Blocks that are not currently protected by any durable destination for any configured volume are opportunistic.

Normative rules:

1. Opportunistic blocks MAY be stored on any writable source.
2. Opportunistic blocks MAY be removed at any time to satisfy reserved-space policy.
3. Opportunistic blocks MUST NOT be treated as proof that a volume is durably preserved.

## 10. Configuration Shape

Canonical persisted configuration shape:

```json
{
  "version": 2,
  "sources": [
    {
      "id": "src-local",
      "provider": "local",
      "path": "/absolute/path",
      "enabled": true,
      "writable": true,
      "reservePercent": 10,
      "opportunisticPolicy": "drop-older-blocks"
    }
  ],
  "defaultVolume": {
    "destinations": []
  },
  "volumes": [
    {
      "volumeId": "<lowercase hex public key>",
      "destinations": [
        {
          "sourceId": "src-local",
          "storeEvents": true,
          "storeBlocks": true,
          "copySourceBlocks": true,
          "reservePercent": 10,
          "fullPolicy": "block-writes"
        }
      ]
    }
  ]
}
```

Validation rules:

1. `version` MUST be `2`.
2. source ids MUST be unique.
3. volume ids MUST be unique lowercase hex.
4. destination `sourceId` MUST exist.
5. every configured volume MUST have at least one durable destination.

## 11. Migration from Root-Centric v1

Existing `roots.json` version 1 MAY be migrated automatically.

Migration rules:

1. each old root becomes one source
2. enabled `main` roots become default durable destinations
3. `backup` roots with allowlists become explicit per-volume destinations
4. migrated durable destinations default to:
   - `storeEvents=true`
   - `storeBlocks=true`
   - `copySourceBlocks=true`
   - `fullPolicy=block-writes`

## 12. Runtime Responsibilities

The runtime MUST provide:

1. source discovery
2. source runtime status
3. per-volume destination status
4. best-effort reconciliation of `copySourceBlocks=true` destinations
5. pruning execution according to the rules above

## 13. UI Requirements

The UI MUST expose two separate surfaces:

1. Source-centric view:
   - discover sources
   - add/remove/edit source directories
   - inspect source capacity, reservation, and opportunistic policy
2. Volume-centric view:
   - configure where one volume stores events
   - configure where one volume stores referenced blocks
   - configure per-destination copy/backfill behavior
   - configure per-destination full-storage policy

The UI MAY display human-friendly mounted-volume labels, but persisted configuration MUST only store volume public keys.
