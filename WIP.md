# Next Iteration Prompt

Open this repo fresh and review the current opaque-event refactor with suspicion. Focus on protocol correctness, storage integrity boundaries, event encryption assumptions, LAN-sync architecture fit, managed-share regressions, UI leaks of semantic event data, and test realism. Keep working in small commits, update the diary and implementation-notes sections of this file as you go, and prefer finding concrete bugs or mismatches over polishing prose. Treat this as one pass in a planned 3-4 iteration hardening cycle.

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

## Diary

- 2026-04-02: Opaque event-envelope refactor is in progress across storage, domain, API, and UI layers. Event semantics now live in encrypted payloads; storage integrity only validates the visible envelope.
- 2026-04-02: Current stabilization focus is managed-share/background-maintenance cleanup after the protocol refactor. Fast-path tests are timing out because background tasks can outlive their tests and integration-state writes still race on Windows.
- 2026-04-02: Rule for the remainder of this implementation: every meaningful implementation step must update the Implementation Notes section below before or alongside the code change.
- 2026-04-02: Managed-share stabilization pass completed. Root causes were confirmed as missing-service disposal in tests, background maintenance re-entry after shutdown, `ENOENT` retry backoff on missing integration-state reads, and duplicate incoming-share adoption races during contact-invite handling.
- 2026-04-02: Verification is green at this checkpoint: `yarn test`, `yarn type-check`, `yarn build`, and `yarn --cwd ui build` all pass.

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

### Provider queue direction

- keep a separate persistent per-provider queue beside the future peer-log
- peer-log is shared sync/history
- per-provider queue is local delivery/work state for each integration

## Implementation Notes

### Completed so far

- Introduced the new visible event envelope shape in code:
  - version
  - full public key
  - cleartext referenced block hashes
  - ciphertext payload
  - signature
- Updated event hashing/signing to cover the visible envelope plus ciphertext.
- Moved semantic payload handling behind explicit decrypt/hydrate steps in domain code.
- Storage integrity now validates only the outer envelope and channel/public-key match.
- Multi-root block dependency traversal now uses visible `blockRefs` instead of plaintext file-event metadata.
- UI event details were partially updated to show the visible envelope and optional decrypted payload separately.
- Local-network UI no longer routes its basic actions through provider-account connect/disconnect paths.
- Managed-share/background-maintenance stabilization is now in place:
  - managed-share tests dispose service instances after each run
  - `ManagedShareService.dispose()` now prevents follow-up maintenance scheduling after shutdown
  - integration-state writes are serialized per path
  - missing integration-state reads no longer retry `ENOENT` and therefore return defaults promptly in fast-mode APIs
  - contact-invite auto-adoption now waits for background maintenance to settle and tolerates stale share IDs during reconciliation

### Still in progress

- UI cleanup:
  - continue reviewing event-detail rendering for any stale assumptions about plaintext payloads
  - remove any remaining legacy wording that implies event semantics are storage-visible
- Protocol breadth:
  - chat, identity, file, app-record, and LAN surfaces all need another review pass for full alignment with the new specs
- Noise cleanup:
  - some managed-share tests still log expected fake-adapter warnings such as “Mirror inventory is not implemented by this fake adapter”; the suite passes, but the logs are noisier than ideal

### Immediate next implementation steps

- do a targeted UI review of event-detail and timeline rendering for any remaining assumptions that `event.payload` is always directly available
- review identity/app-record/file/chat protocol surfaces against the v0.x specs and remove transitional wording/types where possible
- review LAN sync code against the new opaque event model and decide the next clean protocol step instead of carrying forward the temporary implementation blindly
- consider reducing expected fake-adapter warning noise in integration tests now that correctness is restored

In addition to the per-peer log, each transport/provider runtime should maintain its own persistent queue of local delivery work.

Purpose:
- decouple local storage observation from provider availability
- survive provider outages or peer disappearance
- resume sending without requiring a full rescan first

Current intended model:
- the peer-log is the cross-peer/history model
- the per-provider queue is a local runtime work queue
- queue items reference typed object ids such as `(event, H)` or `(block, H)` plus provider-specific routing context

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
- file events v0.3
- chat events v0.2
- app records v0.2
- meta-storage v0.3
- data-correctness v0.2
- lan-sync v0.2

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
- added draft specs: `hub-model-v0.2`, `file-events-v0.3`, `app-records-v0.2`, `chat-events-v0.2`, `data-correctness-v0.2`, `meta-storage-v0.3`, `lan-sync-v0.2`, and `log-command-map-v0.2`
- the first spec batch did not yet explicitly define per-provider persistent queues; this is now recorded here and in the LAN spec as a follow-up refinement
- next implementation step: replace `EventPayload` with a visible envelope plus encrypted inner payload in `src/types/events.ts` and `src/storage/serialization.ts`
- implementation has now started on that root change:
  - `src/types/events.ts` now defines a visible `EventEnvelope` and encrypted stored `SignedEvent`
  - `src/storage/serialization.ts` now serializes the outer envelope separately from the inner payload
  - `src/domain/eventEnvelope.ts` was added to create and decrypt signed events
  - `src/storage/channel.ts`, `src/storage/integrity.ts`, `src/storage/multiRoot.ts`, `src/domain/volume.ts`, `src/domain/chatService.ts`, and `src/domain/fileService.ts` are in active transition
- current state is intentionally mid-refactor and not yet validated; the next step is to finish threading decrypted payload handling through file replay and the remaining APIs before running tests
