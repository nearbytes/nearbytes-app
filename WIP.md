# WIP

## Goal

Nearbytes is moving to an opaque event model.

New rule:
- anything that reveals the semantic contents of an event must be encrypted

This is a clean break:
- no backward compatibility
- no migration support
- old local data may be wiped
- old specs can be superseded freely

## Locked Decisions

### Event envelope

Visible event envelope:
- protocol version
- full signing public key
- cleartext list of referenced block hashes
- ciphertext payload
- signature

Implicitly visible by storage nature:
- channel id
- event hash
- event file size

Not visible:
- event type
- file names
- timestamps
- wrapped keys
- nested protocol ids
- chat bodies
- identity records
- app-record semantics
- any other semantic payload content

### Event signing

- the event signature covers the whole visible envelope plus the ciphertext payload
- the event hash is computed from the same signed bytes, excluding only the signature field itself

### Crypto/versioning

- protocol version alone fixes the crypto/hash suite
- no separate cleartext crypto-suite marker is required

### Block references

- the cleartext block hash list is semantically unordered
- zero referenced blocks is allowed
- duplicates should not be emitted by the implementation
- block references mean "this event mentions these ciphertext blocks"
- the storage layer uses only this visible dependency list
- application semantics stay inside ciphertext

### Signer hint

- the visible signer hint is the full public key

### Namespace

There is no naked shared hash namespace.

Object identity is typed:
- `(event, H)`
- `(block, H)`

This matters especially for the future peer-log.

## Event model direction

Events are storage-layer objects with:
- a visible envelope
- an opaque encrypted payload

The encrypted payload contains the application-level command or record.

Examples:
- file create/delete/rename commands live inside ciphertext
- chat message records live inside ciphertext
- identity records and identity snapshots live inside ciphertext
- generic app records live inside ciphertext

Important distinction:
- block references remain visible for storage/liveness
- event meaning does not

## LAN direction

Local network is not a provider account.
It must be its own transport tab.

Current bug:
- the generic provider connect flow is still used for `local-network`
- this produces `Unsupported provider: local-network`

Near-term LAN direction:
- remove provider-account behavior from Local network
- keep transport/service status separate from provider account UX
- make peer errors local to peer cards instead of global provider errors

Longer-term LAN sync direction:
- use a per-peer ordered log of hash observations
- the peer-log observes both events and blocks
- the peer-log is one sequence per peer, not per volume
- block observations are useful even before the referencing event is seen
- future queries should support "after X, what else have you seen?" optionally scoped to volumes

Important nuance:
- block observations do not carry volume attribution by themselves
- volume linkage comes from events, because events mention referenced block hashes

## Whitepaper note

The original whitepaper photo example is less strict than the new design.

In that example:
- ciphertext block contents are encrypted
- wrapped content keys are encrypted
- block hashes are visible
- event structure remains partly visible

This branch is intentionally moving to a stricter design than the original whitepaper example.

## Implementation blast radius

The current code still assumes semantic fields are visible in outer event payloads.

Main code areas that will need coordinated changes:

### Event types and serialization
- `src/types/events.ts`
- `src/storage/serialization.ts`
- `src/storage/integrity.ts`
- `src/storage/channel.ts`

### File protocol and replay
- `src/domain/fileEventCodec.ts`
- `src/domain/fileEvents.ts`
- `src/domain/fileService.ts`
- `src/domain/volume.ts`
- `src/domain/operations.ts`

### Chat / identity / app-record flow
- `src/domain/chatCodec.ts`
- `src/domain/chatService.ts`

### Multi-root / storage metadata
- `src/storage/multiRoot.ts`
- any code that currently infers referenced blocks from visible `CREATE_FILE` fields

### UI / API payload inspection
- `ui/src/App.svelte`
- `ui/src/lib/api.ts`
- any endpoint that exposes raw event payload details

### LAN sync
- `src/integrations/localNetworkSync.ts`
- `src/server/routes.ts`
- `src/server/runtime.ts`

### Tests
- domain tests
- storage tests
- provider adapter tests that synthesize events directly
- UI expectations around visible event payloads

## Current code assumptions that are now wrong

The following old assumptions must be removed:
- `CREATE_FILE` metadata is visible in the outer payload
- block attribution is derived from visible file-event fields
- chat and identity records are visible in the outer payload
- event type is visible at the storage layer
- Local network can reuse generic provider-account connect flows

## Target wire shape

Intended event object shape at a high level:

- `version`
- `publicKey`
- `blockRefs`
- `ciphertext`
- `signature`

Where:
- `version` is cleartext
- `publicKey` is cleartext
- `blockRefs` is cleartext
- `ciphertext` holds the application payload
- `signature` authenticates the full event envelope plus ciphertext

The encrypted inner payload should carry enough information to reconstruct:
- file operations
- chat timeline events
- identity publications / snapshots
- generic app records

## Spec rewrite plan

These specs need version bumps and rewrites because they currently describe too much cleartext:

- `docs/specs/application/file-events-v2.md`
- `docs/specs/application/chat-events-v1.md`
- `docs/specs/application/app-records-v1.md`
- `docs/specs/storage/meta-storage-v2.md`
- `docs/specs/storage/data-correctness-v1.md`
- `docs/specs/transport/lan-sync-v1.md`
- likely `docs/specs/registry/protocol-registry.md`

Likely new versions:
- file events v3
- chat events v2
- app records v2
- meta-storage v3
- data-correctness v2
- lan-sync v2

Reference docs may also need edits if they currently imply visible outer semantics.

## Intended implementation strategy

Recommended order:

1. rewrite and bump the normative specs
2. replace outer event payload types with a visible envelope + opaque ciphertext
3. move file/chat/identity/app command data into encrypted inner payload codecs
4. update integrity validation to validate only what remains visible plus decryptable application rules where appropriate
5. update replay/materialization code to decrypt inner payloads before interpreting commands
6. update multi-root block tracking to rely on visible block reference lists
7. update LAN sync to work with the new event envelope and fix the Local network UI/account split
8. update tests and UI tooling

## Important open implementation details

These are not product decisions anymore; they are implementation tasks:

- define the exact binary/JSON serialized shape of the new event envelope
- define the encrypted inner payload schema for file commands
- define the encrypted inner payload schema for app/chat/identity records
- ensure decryption keys are available from the volume secret path where replay happens
- ensure UI detail views do not assume visible semantic payload fields
- decide how much decrypted detail the API should expose to trusted local UI callers

## Recommended handoff note

If another agent picks this up, the immediate next safe step is:
- update the specs first
- then change `src/types/events.ts` and `src/storage/serialization.ts`
- then thread the new model through file/chat/identity replay

Do not try to patch LAN sync first.
The event format change is the root change.

## Implementation notes

Implementation notes must be kept in this same file while the work is in progress.

Rule:
- keep durable protocol/product decisions in the earlier sections
- keep temporary execution notes, discoveries, partial progress, and blockers in this section
- update this section alongside the implementation as work advances

Current execution note:
- the next concrete step is the spec rewrite, starting from event/storage specs and only then moving into the code
- spec rewrite is now underway with new versioned docs targeting the opaque-event model
- added draft specs: `hub-model-v2`, `file-events-v3`, `app-records-v2`, `chat-events-v2`, `data-correctness-v2`, `meta-storage-v3`, `lan-sync-v2`, and `log-command-map-v2`
- next implementation step: replace `EventPayload` with a visible envelope plus encrypted inner payload in `src/types/events.ts` and `src/storage/serialization.ts`
